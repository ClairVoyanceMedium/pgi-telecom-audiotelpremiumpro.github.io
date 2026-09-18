const STATUSES=new Set(["open","reconciled","invoiced","paid","disputed"]);

export function normalizeSettlementPayload(input){
  if(!input||typeof input!=="object"||Array.isArray(input))throw problem("INVALID_SETTLEMENT");
  const carrierId=positiveInt(input.carrier_id,"carrier_id");
  const periodStart=dateOnly(input.period_start,"period_start");
  const periodEnd=dateOnly(input.period_end,"period_end");
  if(periodEnd<periodStart)throw problem("INVALID_SETTLEMENT_PERIOD");

  const status=String(input.status||"reconciled");
  if(!STATUSES.has(status))throw problem("INVALID_SETTLEMENT_STATUS");

  const currency=currencyCode(input.currency||"EUR");
  const marketId=input.market_id==null||input.market_id===""?null:positiveInt(input.market_id,"market_id");

  if(!Array.isArray(input.matches)||input.matches.length<1||input.matches.length>5000){
    throw problem("INVALID_SETTLEMENT_MATCHES");
  }

  const seen=new Set();
  const matches=input.matches.map((item,index)=>{
    if(!item||typeof item!=="object")throw problem("INVALID_SETTLEMENT_MATCH_"+index);
    const externalCallId=boundedString(item.external_call_id,1,160,"external_call_id");
    if(seen.has(externalCallId))throw problem("DUPLICATE_SETTLEMENT_CALL");
    seen.add(externalCallId);
    const amount=nonNegativeNumber(item.carrier_amount_ht,"carrier_amount_ht");
    return Object.freeze({external_call_id:externalCallId,carrier_amount_ht:roundCurrency(amount)});
  });

  const sourceFileHash=input.source_file_hash==null||input.source_file_hash===""?null:String(input.source_file_hash).toLowerCase();
  if(sourceFileHash&&!/^[a-f0-9]{64}$/.test(sourceFileHash))throw problem("INVALID_SOURCE_FILE_HASH");

  const paidAt=input.paid_at==null||input.paid_at===""?null:isoTimestamp(input.paid_at,"paid_at");
  if(status==="paid"&&!paidAt)throw problem("PAID_AT_REQUIRED");

  return Object.freeze({
    carrier_id:carrierId,
    period_start:periodStart,
    period_end:periodEnd,
    status,
    statement_reference:optionalString(input.statement_reference,200),
    invoice_reference:optionalString(input.invoice_reference,200),
    payment_due_date:input.payment_due_date?dateOnly(input.payment_due_date,"payment_due_date"):null,
    paid_at:paidAt,
    source_file_hash:sourceFileHash,
    currency,
    market_id:marketId,
    matches:Object.freeze(matches)
  });
}

function currencyCode(value){
  const code=String(value||"").trim().toUpperCase();
  if(!/^[A-Z]{3}$/.test(code))throw problem("INVALID_CURRENCY");
  return code;
}
function positiveInt(value,name){
  const n=Number(value);
  if(!Number.isInteger(n)||n<=0)throw problem("INVALID_"+name.toUpperCase());
  return n;
}
function nonNegativeNumber(value,name){
  const n=Number(value);
  if(!Number.isFinite(n)||n<0)throw problem("INVALID_"+name.toUpperCase());
  return n;
}
function dateOnly(value,name){
  const s=String(value||"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw problem("INVALID_"+name.toUpperCase());
  const d=new Date(s+"T00:00:00Z");
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s)throw problem("INVALID_"+name.toUpperCase());
  return s;
}
function isoTimestamp(value,name){
  const d=new Date(String(value));
  if(!Number.isFinite(d.getTime()))throw problem("INVALID_"+name.toUpperCase());
  return d.toISOString();
}
function optionalString(value,max){
  if(value==null||value==="")return null;
  return boundedString(value,1,max,"reference");
}
function boundedString(value,min,max,name){
  const s=String(value||"").trim();
  if(s.length<min||s.length>max)throw problem("INVALID_"+name.toUpperCase());
  return s;
}
function roundCurrency(value){
  return Math.round((Number(value)+Number.EPSILON)*1e6)/1e6;
}
function problem(code){
  const e=new Error(code);e.code=code;e.status=400;return e;
}
