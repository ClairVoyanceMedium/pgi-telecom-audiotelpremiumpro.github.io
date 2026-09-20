import {createHmac} from "node:crypto";

export function normalizeFreeSwitchCdr(raw,{uuid,callerHashKey}){
  if(!raw||typeof raw!=="object")throw problem(400,"INVALID_FREESWITCH_CDR");
  const v=raw.variables||{};
  const id=String(v.uuid||uuid||"").trim();
  if(!id)throw problem(400,"FREESWITCH_UUID_MISSING");

  const started=toIso(v.start_epoch,v.start_uepoch,v.start_stamp);
  const answered=toIso(v.answer_epoch,v.answer_uepoch,v.answer_stamp);
  const ringingCandidates=[
    toIso(v.progress_epoch,v.progress_uepoch,v.progress_stamp),
    toIso(v.progress_media_epoch,v.progress_media_uepoch,v.progress_media_stamp)
  ].filter(Boolean).filter(x=>Date.parse(x)>=Date.parse(started));
  const ringing=ringingCandidates.sort((a,b)=>Date.parse(a)-Date.parse(b))[0]||null;
  const ended=toIso(v.end_epoch,v.end_uepoch,v.end_stamp);
  if(!started||!ended)throw problem(400,"FREESWITCH_TIMESTAMPS_MISSING");

  const duration=nonNegativeInt(v.duration,Math.max(0,Math.round((Date.parse(ended)-Date.parse(started))/1000)));
  const billsec=nonNegativeInt(v.billsec,answered?Math.max(0,Math.round((Date.parse(ended)-Date.parse(answered))/1000)):0);
  const wait=answered?Math.max(0,Math.round((Date.parse(answered)-Date.parse(started))/1000)):duration;
  const hangup=String(v.hangup_cause||v.bridge_hangup_cause||"");
  const status=billsec>0?"connected":(["ORIGINATOR_CANCEL","NO_ANSWER","NORMAL_CLEARING"].includes(hangup)?"abandoned":"failed");
  const caller=String(v.caller_id_number||v.ani||"").trim();
  const destination=String(v.destination_number||"").trim();

  const payload={
    external_call_id:id,
    started_at:started,
    ivr_started_at:toIso(v.pgi_ivr_epoch,null,v.pgi_ivr_stamp)||started,
    queued_at:toIso(v.pgi_queue_epoch,null,v.pgi_queue_stamp)||null,
    ringing_at:ringing,
    bridged_at:answered,
    ended_at:ended,
    post_dial_delay_ms:ringing?Math.max(0,Math.round(Date.parse(ringing)-Date.parse(started))):null,
    wait_seconds:wait,
    conversation_seconds:billsec,
    total_seconds:duration,
    call_status:status,
    caller_masked:maskCaller(caller),
    caller_hash:caller?createHmac("sha256",callerHashKey).update(caller).digest("hex"):createHmac("sha256",callerHashKey).update("anonymous:"+id).digest("hex"),
    origin_carrier:String(v.pgi_origin_carrier||"Unknown"),
    origin_type:String(v.pgi_origin_type||"unknown"),
    sva_number:destination,
    expert_id:nullableInt(v.pgi_expert_id),
    expert_name:String(v.pgi_expert_name||""),
    sip_final_code:nullableInt(v.sip_term_status||v.last_bridge_proto_specific_hangup_cause),
    hangup_cause:hangup,
    hangup_party:hangupParty(v,status),
    codec:String(v.read_codec||v.write_codec||""),
    quality:qualityFrom(v,raw.callStats)
  };
  if(v.pgi_host_carrier)payload.host_carrier=String(v.pgi_host_carrier);
  return {
    source:"freeswitch",
    source_event_id:id,
    event_time:ended,
    payload
  };
}

function qualityFrom(v,stats){
  const packetLoss=firstNumber(
    v.rtp_audio_in_packet_loss_percent,
    stats?.audio?.inbound?.packet_loss_percent
  );
  const jitter=firstNumber(v.rtp_audio_in_jitter_max_variance,stats?.audio?.inbound?.jitter_ms);
  const latency=firstNumber(stats?.audio?.inbound?.latency_ms);
  const rtt=firstNumber(v.rtp_audio_in_rtt,stats?.audio?.inbound?.rtt_ms,stats?.audio?.inbound?.round_trip_time_ms);
  const mos=firstNumber(v.rtp_audio_in_mos,stats?.audio?.inbound?.mos);
  const packetsIn=firstNumber(v.rtp_audio_in_packet_count,stats?.audio?.inbound?.packets_received);
  const packetsOut=firstNumber(v.rtp_audio_out_packet_count,stats?.audio?.outbound?.packets_sent);
  const packetsLost=firstNumber(v.rtp_audio_in_packet_loss,stats?.audio?.inbound?.packets_lost);
  const bytesIn=firstNumber(v.rtp_audio_in_media_bytes,stats?.audio?.inbound?.bytes_received);
  const bytesOut=firstNumber(v.rtp_audio_out_media_bytes,stats?.audio?.outbound?.bytes_sent);
  if(packetLoss==null&&jitter==null&&latency==null&&rtt==null&&mos==null&&packetsIn==null&&packetsOut==null&&packetsLost==null&&bytesIn==null&&bytesOut==null)return null;
  return {
    packet_loss_percent:packetLoss,jitter_ms:jitter,latency_ms:latency,rtt_ms:rtt,mos,
    packets_in:packetsIn,packets_out:packetsOut,packets_lost:packetsLost,bytes_in:bytesIn,bytes_out:bytesOut
  };
}
function hangupParty(v,status){
  const explicit=String(v.pgi_hangup_party||"").trim().toLowerCase();
  if(["caller","callee","network","unknown"].includes(explicit))return explicit;
  const disposition=String(v.sip_hangup_disposition||"").trim().toLowerCase();
  if(status!=="connected")return "network";
  if(disposition==="recv_bye")return "caller";
  if(disposition==="send_bye")return "callee";
  return "unknown";
}
function firstNumber(...xs){
  for(const x of xs){
    if(x==null||x==="")continue;
    const n=Number(x);if(Number.isFinite(n))return n;
  }
  return null;
}
function nullableInt(v){
  if(v==null||v==="")return null;
  const n=Number(v);return Number.isInteger(n)?n:null;
}
function nonNegativeInt(v,fallback=0){
  const n=Number(v);return Number.isFinite(n)&&n>=0?Math.round(n):Math.max(0,Math.round(fallback));
}
function toIso(epoch,uepoch,stamp){
  const e=Number(epoch);
  if(Number.isFinite(e)&&e>0){
    const ms=e>1e12?e:e*1000;
    const d=new Date(ms);if(Number.isFinite(d.getTime()))return d.toISOString();
  }
  const u=Number(uepoch);
  if(Number.isFinite(u)&&u>0){
    const d=new Date(u/1000);if(Number.isFinite(d.getTime()))return d.toISOString();
  }
  if(stamp){
    const d=new Date(String(stamp));if(Number.isFinite(d.getTime()))return d.toISOString();
  }
  return null;
}
function maskCaller(value){
  if(!value)return "Masqué";
  const digits=value.replace(/\D/g,"");
  if(digits.length<4)return "Masqué";
  return "•• •• •• "+digits.slice(-4,-2)+" "+digits.slice(-2);
}
function problem(status,code){
  const e=new Error(code);e.status=status;e.code=code;return e;
}
