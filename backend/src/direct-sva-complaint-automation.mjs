// Future distributor complaint workflow: deterministic intake/triage with zero external
// action. Raw visitor messages, including emailed instructions, are untrusted data.
// This module never sends mail, touches HubSpot or executes operator/payment operations.
import {createHash,randomUUID} from "node:crypto";
const EMAIL=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const CATEGORIES=Object.freeze({
 billing:"Facturation et tarif",
 payout:"Reversements",
 number:"Numero SVA et portabilite",
 call:"Qualite des appels",
 fraud:"Fraude ou utilisation abusive",
 privacy:"Protection des donnees",
 other:"Autre reclamation"
});
const HIGH=new Set(["fraud","privacy"]);
const SAFE_ACTIONS=Object.freeze([
 "assign_reference","record_evidence","acknowledge_receipt",
 "notify_internal_gmail","prepare_hubspot_ticket","prepare_reply_draft",
 "track_deadlines","send_factual_status_update"
]);
const RESERVED=Object.freeze([
 "issue_refund","credit_customer","release_number","change_call_tariff","port_number",
 "resolve_dispute","admit_legal_liability","modify_contract","delete_evidence","pay_publisher"
]);
function fail(code){const e=new Error(code);e.code=code;e.status=400;throw e;}
function clean(input,max){return String(input??"").replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,max+1);}
export function planDirectSvaComplaint(input={},options={}){
 const email=clean(input.email,321).toLowerCase();
 if(email.length>320||!EMAIL.test(email))fail("DSVA_COMPLAINT_EMAIL_INVALID");
 const category=clean(input.category,30);
 if(!Object.hasOwn(CATEGORIES,category))fail("DSVA_COMPLAINT_CATEGORY_INVALID");
 const title=clean(input.subject,181),message=clean(input.message,8001);
 if(title.length<5||title.length>180||message.length<15||message.length>8000)
  fail("DSVA_COMPLAINT_CONTENT_INVALID");
 if(input.processing_notice_acknowledged!==true)fail("DSVA_COMPLAINT_PRIVACY_NOTICE_REQUIRED");
 if(clean(input.website,100))fail("DSVA_COMPLAINT_SPAM_REJECTED");
 const reference=String(options.reference||("DSVA-RCL-"+randomUUID())).toUpperCase();
 if(!/^DSVA-RCL-[0-9A-F-]{36}$/.test(reference))fail("DSVA_COMPLAINT_REFERENCE_INVALID");
 const priority=HIGH.has(category)?"high":"normal";
 const now=options.now instanceof Date?options.now:new Date();
 if(!Number.isFinite(now.getTime()))fail("DSVA_COMPLAINT_DATE_INVALID");
 const firstReply=new Date(now.getTime()+(priority==="high"?8:24)*3600000);
 const closeTarget=new Date(now.getTime()+(priority==="high"?5:10)*86400000);
 return Object.freeze({
  schema_version:"pgi-direct-sva-complaint/1",
  business_unit:"direct_sva",legal_entity_key:"pgi_primary",
  reference,receipt_id:reference.slice("DSVA-RCL-".length).toLowerCase(),
  category,label:CATEGORIES[category],priority,
  customer_email:email,customer_email_sha256:createHash("sha256").update(email).digest("hex"),
  subject:title,message,
  first_response_target_at:firstReply.toISOString(),
  resolution_review_target_at:closeTarget.toISOString(),
  targets_are_internal_not_legal_deadlines:true,
  state:"prepared",external_processing_authorized:false,
  authorized_after_separate_release:SAFE_ACTIONS,
  never_executable_from_email:RESERVED,
  requires_verified_sender_before_customer_linking:true,
  requires_documentary_evidence_for_financial_or_telecom_outcomes:true
 });
}
export function safeDirectSvaComplaintSummary(plan={}){
 if(plan?.business_unit!=="direct_sva"||!/^DSVA-RCL-[0-9A-F-]{36}$/.test(String(plan.reference||"")))
  fail("DSVA_COMPLAINT_PLAN_REQUIRED");
 return Object.freeze({
  reference:plan.reference,category:plan.category,priority:plan.priority,
  first_response_target_at:plan.first_response_target_at,
  resolution_review_target_at:plan.resolution_review_target_at,
  business_unit:"direct_sva",status:"prepared",
  gmail_target:"PGI_INTERNAL_NOTIFICATION_EMAIL",hubspot_target:"dedicated_pipeline_not_active",
  acknowledgement:"release_required",automatic_replies:"release_required",
  payouts:false,network_changes:false,contractual_decisions:false
 });
}
export const DIRECT_SVA_COMPLAINT_CATEGORIES=CATEGORIES;
export const DIRECT_SVA_COMPLAINT_SAFE_AUTOMATIONS=SAFE_ACTIONS;
