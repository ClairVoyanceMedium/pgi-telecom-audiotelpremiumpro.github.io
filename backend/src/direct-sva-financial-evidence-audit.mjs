// Reconciliation quality gate for prepared Distribution records only.
// Does not call Stripe, a bank, a telephone carrier or execute any payment.
function error(code){const e=new Error(code);e.code=code;e.status=422;return e;}
function minor(n){if(!Number.isSafeInteger(n)||n<0||n>1e12)throw error("DIRECT_SVA_AMOUNT_INVALID");return n;}
function ref(value){const v=String(value||"");if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/.test(v))throw error("DIRECT_SVA_EVIDENCE_REFERENCE_INVALID");return v;}
export function auditDirectSvaFinancialEvidence(events=[]){
 if(!Array.isArray(events)||events.length>10000)throw error("DIRECT_SVA_EVENTS_INVALID");
 const seen=new Map(),t={expected_minor:0,confirmed_minor:0,paid_minor:0};
 let exactDuplicates=0,unverified=0;
 for(const e of events){
  if(e?.business_unit!=="direct_sva")throw error("DIRECT_SVA_CROSS_BUSINESS_EVIDENCE");
  const id=ref(e.event_reference),adapter=String(e.source_adapter||"");
  if(!["network","bank","payment_psp"].includes(adapter))throw error("DIRECT_SVA_SOURCE_UNKNOWN");
  if(e.currency!=="EUR")throw error("DIRECT_SVA_CURRENCY_MISMATCH");
  const expected=minor(e.expected_minor),confirmed=minor(e.confirmed_minor),paid=minor(e.paid_minor);
  if(paid>confirmed||confirmed>expected)throw error("DIRECT_SVA_FINANCE_INVARIANT_FAILED");
  const digest=String(e.source_payload_digest||"");
  if(!/^[a-f0-9]{64}$/.test(digest))throw error("DIRECT_SVA_DIGEST_INVALID");
  const key=adapter+":"+id;
  const fingerprint=JSON.stringify([e.business_unit,e.currency,expected,confirmed,paid,digest,e.source_verification_state]);
  if(seen.has(key)){
   if(seen.get(key)!==fingerprint)throw error("DIRECT_SVA_CONFLICTING_EXTERNAL_EVENT");
   exactDuplicates++;
   continue;
  }
  seen.set(key,fingerprint);
  if(e.source_verification_state!=="verified"){unverified++;continue;}
  for(const [k,v] of [["expected_minor",expected],["confirmed_minor",confirmed],["paid_minor",paid]]){
   if(t[k]>Number.MAX_SAFE_INTEGER-v)throw error("DIRECT_SVA_FINANCIAL_TOTAL_OVERFLOW");
   t[k]+=v;
  }
 }
 return Object.freeze({business_unit:"direct_sva",schema_version:"direct-sva-financial-audit/1",
  received_events:events.length,unique_external_events:seen.size,exact_duplicates:exactDuplicates,
  unverified_unique_events:unverified,totals_for_review:Object.freeze(t),
  live_bank_settlement_verified:false,network_sources_authorized:false,
  customer_payout_authorized:false,external_payment_executed:false,
  posting_authorized:false,production_ready:false});
}
