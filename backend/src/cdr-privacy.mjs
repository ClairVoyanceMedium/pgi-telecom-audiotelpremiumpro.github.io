import {createHmac} from "node:crypto";

const ALLOWED_KEYS=new Set([
  "external_call_id","started_at","ivr_started_at","queued_at","bridged_at","ended_at",
  "wait_seconds","conversation_seconds","total_seconds","call_status",
  "caller_masked","caller_hash","origin_carrier","origin_type","host_carrier","sva_number",
  "expert_id","expert_name","sip_final_code","hangup_cause","codec","quality"
]);
const QUALITY_KEYS=new Set(["packet_loss_percent","jitter_ms","latency_ms","mos","dtmf_errors"]);
const CALL_STATUSES=new Set(["connected","abandoned","failed","rejected","busy","cancelled"]);
const ORIGIN_TYPES=new Set(["mobile","fixed","unknown"]);
const TEXT_LIMITS=Object.freeze({
  external_call_id:160,
  started_at:64,
  ivr_started_at:64,
  queued_at:64,
  bridged_at:64,
  ended_at:64,
  origin_carrier:120,
  host_carrier:120,
  sva_number:32,
  expert_name:120,
  hangup_cause:96,
  codec:32
});
const QUALITY_LIMITS=Object.freeze({
  packet_loss_percent:[0,100],
  jitter_ms:[0,60000],
  latency_ms:[0,60000],
  mos:[0,5],
  dtmf_errors:[0,1000000]
});

export function sanitizeCdrPayload(input){
  const source=input&&typeof input==="object"&&!Array.isArray(input)?input:{};
  const out={};

  for(const [key,value] of Object.entries(source)){
    if(!ALLOWED_KEYS.has(key))continue;
    if(key==="caller_masked"||key==="caller_hash")continue;

    if(key==="quality"){
      if(value==null)continue;
      if(!value||typeof value!=="object"||Array.isArray(value))throw invalidField("quality");
      const quality={};
      for(const [qk,qv] of Object.entries(value)){
        if(!QUALITY_KEYS.has(qk))continue;
        if(qv==null||qv==="")continue;
        const n=Number(qv);
        const bounds=QUALITY_LIMITS[qk];
        if(!Number.isFinite(n)||n<bounds[0]||n>bounds[1])throw invalidField("quality."+qk);
        quality[qk]=qk==="dtmf_errors"?Math.round(n):n;
      }
      if(Object.keys(quality).length)out.quality=quality;
      continue;
    }

    if(Object.hasOwn(TEXT_LIMITS,key)){
      out[key]=boundedText(value,key,TEXT_LIMITS[key]);
      continue;
    }
    out[key]=value;
  }

  if(out.call_status!=null){
    const status=String(out.call_status).trim().toLowerCase();
    if(!CALL_STATUSES.has(status))throw invalidField("call_status");
    out.call_status=status;
  }
  if(out.origin_type!=null){
    const origin=String(out.origin_type).trim().toLowerCase();
    if(!ORIGIN_TYPES.has(origin))throw invalidField("origin_type");
    out.origin_type=origin;
  }

  out.caller_masked=safeMaskedCaller(source.caller_masked);
  if(typeof source.caller_hash==="string"&&/^[a-fA-F0-9]{64}$/.test(source.caller_hash)){
    out.caller_hash=source.caller_hash.toLowerCase();
  }
  return out;
}

export function deriveCallerHash(payload,{key,source,sourceEventId}){
  if(payload?.caller_hash&&/^[a-f0-9]{64}$/.test(payload.caller_hash))return payload.caller_hash;
  const secret=String(key||"simulator-caller-hash-key");
  const stable="anonymous:"+String(source||"unknown")+":"+String(payload?.external_call_id||sourceEventId||"unknown");
  return createHmac("sha256",secret).update(stable).digest("hex");
}

export function safeMaskedCaller(value){
  const text=String(value||"Masqué").trim();
  const digits=text.replace(/\D/g,"");
  if(digits.length>=8)return "•• •• •• "+digits.slice(-4,-2)+" "+digits.slice(-2);
  if(text.length>64)return "Masqué";
  return text||"Masqué";
}

function boundedText(value,key,max){
  const text=String(value??"").trim();
  if(text.length>max)throw invalidField(key);
  return text;
}
function invalidField(key){
  const error=new Error("Invalid CDR field: "+key);
  error.status=400;
  error.code="INVALID_CDR_FIELD";
  return error;
}
