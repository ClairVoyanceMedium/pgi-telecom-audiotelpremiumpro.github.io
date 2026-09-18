import {createHmac} from "node:crypto";

const ALLOWED_KEYS=new Set([
  "external_call_id","started_at","ivr_started_at","queued_at","bridged_at","ended_at",
  "wait_seconds","conversation_seconds","total_seconds","call_status",
  "caller_masked","caller_hash","origin_carrier","origin_type","host_carrier","sva_number",
  "expert_id","expert_name","sip_final_code","hangup_cause","codec","quality",
  "confirmed_payout_ht","paid_payout_ht","technical_cost_ht"
]);
const QUALITY_KEYS=new Set(["packet_loss_percent","jitter_ms","latency_ms","mos","dtmf_errors"]);

export function sanitizeCdrPayload(input){
  const source=input&&typeof input==="object"&&!Array.isArray(input)?input:{};
  const out={};
  for(const [key,value] of Object.entries(source)){
    if(!ALLOWED_KEYS.has(key))continue;
    if(key==="quality"){
      if(value&&typeof value==="object"&&!Array.isArray(value)){
        const quality={};
        for(const [qk,qv] of Object.entries(value))if(QUALITY_KEYS.has(qk))quality[qk]=qv;
        out.quality=quality;
      }
      continue;
    }
    out[key]=value;
  }
  out.caller_masked=safeMaskedCaller(source.caller_masked);
  if(typeof source.caller_hash==="string"&&/^[a-fA-F0-9]{64}$/.test(source.caller_hash)){
    out.caller_hash=source.caller_hash.toLowerCase();
  }else{
    delete out.caller_hash;
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
