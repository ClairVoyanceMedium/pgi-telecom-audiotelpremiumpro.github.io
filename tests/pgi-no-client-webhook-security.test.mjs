// Pure, fake-data verification of Stripe event routing and direct-distribution safeguards.
// Does not reach Stripe, any customer account, an operator, Gmail or HubSpot.
import test from "node:test";
import assert from "node:assert/strict";
import {normalizeStripePortabilityPriorityEvent} from "../backend/src/stripe-billing.mjs";
import {normalizeStripeConnectPaymentEvent} from "../backend/src/stripe-connect.mjs";
import {getDirectSvaSwitches,setDirectSvaCommercial} from "../backend/src/direct-sva-admin-switches.mjs";
import {transitionReadiness} from "../backend/src/direct-sva-customer-transition.mjs";
import {planDirectSvaComplaint,safeDirectSvaComplaintSummary,directSvaComplaintPreparatoryOverview} from "../backend/src/direct-sva-complaint-automation.mjs";

const fakeTenant="110e8400-e29b-41d4-a716-446655440000";
const fakeRequest="220e8400-e29b-41d4-a716-446655440000";
const ev={id:"evt_SYNTHETIC",type:"checkout.session.completed",created:1791630000,data:{object:{
 id:"cs_test_synthetic",payment_status:"paid",amount_total:990,currency:"eur",
 metadata:{service_type:"portability_priority",tenant_public_id:fakeTenant,portability_request_id:"17",currency:"EUR"}
}}};

test("a synthetic 9.90 EUR priority checkout event is normalized with the right service",()=>{
 const out=normalizeStripePortabilityPriorityEvent(ev);
 assert.equal(out.status,"paid");
 assert.equal(out.amount_minor,990);
 assert.equal(out.currency,"EUR");
 assert.equal(out.tenant_public_id,fakeTenant);
});
test("a callback marked as another business is never accepted as portability priority",()=>{
 assert.equal(normalizeStripePortabilityPriorityEvent({...ev,data:{object:{
  ...ev.data.object,metadata:{service_type:"direct_sva"}
 }}}),null);
});
test("async payment failure and expiry are distinct from successful payment",()=>{
 assert.equal(normalizeStripePortabilityPriorityEvent({...ev,type:"checkout.session.async_payment_failed"}).status,"failed");
 assert.equal(normalizeStripePortabilityPriorityEvent({...ev,type:"checkout.session.expired"}).status,"expired");
});

const cardEvent={id:"evt_SYNTHETIC_CARD",account:"acct_SYNTHETIC1234",type:"checkout.session.completed",
 created:1791630000,data:{object:{
  id:"cs_test_synthetic",payment_status:"paid",metadata:{pgi_card_payment_request:fakeRequest}
 }}};
test("synthetic card payment webhook retains the expected connected account and transaction reference",async()=>{
 const out=await normalizeStripeConnectPaymentEvent({},cardEvent);
 assert.equal(out.status,"paid");
 assert.equal(out.connected_account_reference,cardEvent.account);
 assert.equal(out.request_public_id,fakeRequest);
});
test("card callback without connected account is not attributed to a customer",async()=>{
 assert.equal(await normalizeStripeConnectPaymentEvent({}, {...cardEvent,account:undefined}),null);
});

const mockStore={sql:{
 unsafe:async()=>[{interface_preview_enabled:false,commercial_operation_enabled:false}],
 begin:async fn=>fn({unsafe:async()=>[]})
}};
test("future commercial operation switch cannot be turned on by the administrator",async()=>{
 await assert.rejects(()=>setDirectSvaCommercial(mockStore,{role:"admin",sub:"synthetic-admin"},
  {enabled:true}),{code:"DIRECT_SVA_COMMERCIAL_APPROVALS_INCOMPLETE"});
});
test("preview switch reports that the existing Audiotel activity is unchanged",async()=>{
 const out=await getDirectSvaSwitches(mockStore);
 assert.equal(out.commercial_activation_locked,true);
 assert.equal(out.current_audiotel_unchanged,true);
});

test("an unapproved change of telephone provider cannot be executed",()=>{
 const out=transitionReadiness();
 assert.equal(out.evidences_documented,0);
 assert.equal(out.missing.length,10);
 assert.equal(out.porting_execution_authorized,false);
});
test("a complete simulated transition checklist remains non-executing without external release",()=>{
 const all=Object.fromEntries(transitionReadiness().missing.map(key=>[key,true]));
 const out=transitionReadiness(all);
 assert.equal(out.evidences_documented,10);
 assert.equal(out.commercial_cutover_authorized,false);
 assert.equal(out.payout_execution_authorized,false);
});
const complaint={email:"fictif@example.test",category:"fraud",subject:"Signalement fictif d'une erreur",
 message:"Ceci est un dossier de simulation sans opération réelle ni client.",processing_notice_acknowledged:true};
test("fraud claim gets internal priority but cannot trigger a payout or number port",()=>{
 const out=planDirectSvaComplaint(complaint,{reference:"DSVA-RCL-"+fakeTenant,now:new Date("2026-10-10T12:00:00Z")});
 assert.equal(out.priority,"high");
 assert.equal(out.external_processing_authorized,false);
 assert.ok(out.never_executable_from_email.includes("pay_publisher"));
 const summary=safeDirectSvaComplaintSummary(out);
 assert.equal(summary.payouts,false);
 assert.equal(summary.network_changes,false);
});
test("consent to personal-data handling is required for complaint filing",()=>{
 assert.throws(()=>planDirectSvaComplaint({...complaint,processing_notice_acknowledged:false},
  {reference:"DSVA-RCL-"+fakeTenant}),{code:"DSVA_COMPLAINT_PRIVACY_NOTICE_REQUIRED"});
});
test("staged complaint overview cannot report active automated Gmail or HubSpot delivery",async()=>{
 const store={readSql:{unsafe:async sql=>sql.includes("to_regclass(")?[{complaints:true,delivery:true}]:[]}};
 const out=await directSvaComplaintPreparatoryOverview(store);
 assert.equal(out.public_form_enabled,false);
 assert.equal(out.gmail_delivery_active,false);
 assert.equal(out.hubspot_delivery_active,false);
 assert.equal(out.payments_enabled,false);
});
