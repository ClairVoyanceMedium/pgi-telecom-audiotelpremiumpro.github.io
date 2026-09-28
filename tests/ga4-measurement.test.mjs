import test from "node:test";
import assert from "node:assert/strict";
import {sanitizeGa4CheckoutContext,buildGa4PurchaseFromStripe,buildGa4RefundFromStripe,sendGa4Measurement} from "../backend/src/ga4-measurement.mjs";

test("GA4 checkout context accepts only non-PII Analytics identifiers",()=>{
  assert.deepEqual(sanitizeGa4CheckoutContext({ga_client_id:"123456789.987654321",ga_session_id:"1790630000",email:"client@example.test"}),{client_id:"123456789.987654321",session_id:"1790630000"});
  assert.equal(sanitizeGa4CheckoutContext({ga_client_id:"client@example.test",ga_session_id:"x"}),null);
});

test("GA4 purchase uses verified invoice facts and no customer identity",()=>{
  const payload=buildGa4PurchaseFromStripe({
    event_type:"invoice.paid",
    provider_invoice_reference:"in_123ABC",
    provider_invoice_amount_paid_minor:300,
    provider_invoice_currency:"EUR",
    ga_client_id:"123456789.987654321",
    ga_session_id:"1790630000"
  });
  assert.equal(payload.client_id,"123456789.987654321");
  assert.equal(payload.events[0].name,"purchase");
  assert.equal(payload.events[0].params.transaction_id,"in_123ABC");
  assert.equal(payload.events[0].params.value,3);
  assert.equal(payload.events[0].params.currency,"EUR");
  assert.equal(payload.events[0].params.session_id,1790630000);
  assert.equal(payload.events[0].params.items[0].item_id,"audiotel_premium_pro_platform");
  assert.doesNotMatch(JSON.stringify(payload),/@|email|phone|name.*client/i);
});

test("GA4 refund reports the individual refund against the original invoice",()=>{
  const payload=buildGa4RefundFromStripe({
    transaction_id:"in_123ABC",
    amount_minor:150,
    currency:"EUR",
    ga_client_id:"123456789.987654321"
  });
  assert.equal(payload.events[0].name,"refund");
  assert.equal(payload.events[0].params.transaction_id,"in_123ABC");
  assert.equal(payload.events[0].params.value,1.5);
});

test("GA4 Measurement Protocol remains disabled without the server secret",async()=>{
  const result=await sendGa4Measurement({ga4MeasurementEnabled:false,ga4MeasurementId:"G-SZY50J75N7",ga4ApiSecret:""}, {client_id:"1.2",events:[]});
  assert.deepEqual(result,{enabled:false,sent:false});
});

test("GA4 Measurement Protocol uses the EU endpoint and keeps the secret server-side",async()=>{
  const calls=[];
  const fetchImpl=async(url,init)=>{calls.push({url:String(url),init});return {ok:true,status:204};};
  const payload={client_id:"123456789.987654321",events:[{name:"purchase",params:{transaction_id:"in_123",currency:"EUR",value:3}}]};
  const result=await sendGa4Measurement({
    ga4MeasurementEnabled:true,
    ga4MeasurementId:"G-SZY50J75N7",
    ga4ApiSecret:"server-only-secret-value",
    ga4MeasurementTimeoutMs:1000
  },payload,{fetchImpl});
  assert.equal(result.sent,true);
  assert.equal(calls.length,1);
  assert.match(calls[0].url,/^https:\/\/region1\.google-analytics\.com\/mp\/collect\?/);
  assert.match(calls[0].url,/measurement_id=G-SZY50J75N7/);
  assert.match(calls[0].url,/api_secret=server-only-secret-value/);
  const sent=JSON.parse(calls[0].init.body);
  assert.equal(sent.client_id,"123456789.987654321");
  assert.deepEqual(sent.consent,{ad_user_data:"DENIED",ad_personalization:"DENIED"});
});
