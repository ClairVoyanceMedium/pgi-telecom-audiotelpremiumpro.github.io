import {createHash} from "node:crypto";

function fail(code){
 const error=new Error(code);error.code=code;error.status=400;return error;
}
function eurosMinor(value,label){
 if(!Number.isSafeInteger(value)||value<0||value>1000000000000)throw fail("DIRECT_SVA_INVALID_"+label);
 return value;
}
function stringRef(value,label){
 const ref=String(value??"").trim();
 if(ref.length<6||ref.length>120||!/^[\w.:/-]+$/.test(ref))throw fail("DIRECT_SVA_INVALID_"+label);
 return ref;
}
export function analyzeDirectSvaSettlement(payload={}){
 const operatorReference=stringRef(payload.operator_reference,"OPERATOR_REFERENCE");
 const statementReference=stringRef(payload.statement_reference,"STATEMENT_REFERENCE");
 const currency=String(payload.currency||"EUR").trim().toUpperCase();
 if(currency!=="EUR")throw fail("DIRECT_SVA_CURRENCY_REQUIRES_REVIEW");
 const period=String(payload.period||"");
 if(!/^20[2-9]\d-(?:0[1-9]|1[0-2])$/.test(period))throw fail("DIRECT_SVA_SETTLEMENT_PERIOD_INVALID");
 if(!Array.isArray(payload.rows)||payload.rows.length<1||payload.rows.length>500)throw fail("DIRECT_SVA_SETTLEMENT_ROWS_INVALID");
 const seen=new Set(),issues=[],byNumber=new Map();
 let accepted=0,net=0,margin=0,publisher=0,balanced=true;
 for(let i=0;i<payload.rows.length;i++){
  const row=payload.rows[i]||{},n=i+1;
  let cdr;
  try{cdr=stringRef(row.cdr_reference,"CDR_REFERENCE")}
  catch(error){issues.push({row:n,code:error.code});balanced=false;continue;}
  if(seen.has(cdr)){
   issues.push({row:n,cdr_reference:cdr,code:"DUPLICATE_CDR_REFERENCE"});
   balanced=false;continue;
  }
  seen.add(cdr);
  if(!/^\+33(?:81|82|89)\d{7}$/.test(String(row.called_number||""))){
   issues.push({row:n,cdr_reference:cdr,code:"INVALID_DIRECT_SVA_NUMBER"});
   balanced=false;continue;
  }
  const duration=Number(row.billable_seconds);
  if(!Number.isSafeInteger(duration)||duration<0||duration>86400){
   issues.push({row:n,cdr_reference:cdr,code:"INVALID_BILLABLE_DURATION"});
   balanced=false;continue;
  }
  let upstream,fee,due;
  try{
   upstream=eurosMinor(row.upstream_net_minor,"UPSTREAM_AMOUNT");
   fee=eurosMinor(row.pgi_margin_minor,"PGI_MARGIN");
   due=eurosMinor(row.publisher_due_minor,"PUBLISHER_PAYOUT");
  }catch(error){issues.push({row:n,cdr_reference:cdr,code:error.code});balanced=false;continue;}
  if(fee+due!==upstream){
   issues.push({row:n,cdr_reference:cdr,code:"UNBALANCED_DISTRIBUTION",difference_minor:upstream-fee-due});
   balanced=false;continue;
  }
  accepted++;net+=upstream;margin+=fee;publisher+=due;
  if(!Number.isSafeInteger(net)||!Number.isSafeInteger(margin)||!Number.isSafeInteger(publisher))throw fail("DIRECT_SVA_TOTAL_TOO_LARGE");
  const number=String(row.called_number),current=byNumber.get(number)||{calls:0,upstream_net_minor:0,pgi_margin_minor:0,publisher_due_minor:0};
  current.calls++;current.upstream_net_minor+=upstream;current.pgi_margin_minor+=fee;current.publisher_due_minor+=due;
  byNumber.set(number,current);
 }
 const fingerprint=createHash("sha256").update(JSON.stringify({
  operator_reference:operatorReference,statement_reference:statementReference,period,currency,
  rows:payload.rows
 })).digest("hex");
 return Object.freeze({
  schema_version:"pgi-direct-sva-settlement-preview/1",
  business_unit:"direct_sva",
  analysis_mode:"untrusted_source_preview",
  operator_reference:operatorReference,statement_reference:statementReference,period,currency,
  input_rows:payload.rows.length,accepted_rows:accepted,rejected_rows:payload.rows.length-accepted,
  total_upstream_net_minor:net,total_pgi_margin_minor:margin,total_publisher_due_minor:publisher,
  balanced:balanced&&issues.length===0,
  source_fingerprint:fingerprint,
  issues:Object.freeze(issues),
  by_number:Object.freeze([...byNumber.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([number,v])=>({number,...v}))),
  approved_by_operator:false,
  cdr_reconciled_with_trusted_source:false,
  funds_collected_verified:false,
  kyc_verified:false,
  accounting_write_authorized:false,
  bank_payout_authorized:false,
  number_activation_authorized:false,
  next_action:"Contrat operateur, CDR source authentifies, KYC et justification comptable requis"
 });
}
