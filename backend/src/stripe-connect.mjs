import {createHash} from "node:crypto";

export const STRIPE_CONNECT_APPLICATION_FEE_BPS=490;

function error(status,code,message=code){
  const e=new Error(message);e.status=status;e.code=code;e.expose=status<500;return e;
}
function requireKey(config){
  const key=String(config?.stripeSecretKey||"").trim();
  if(!/^sk_(test|live)_[A-Za-z0-9]+$/.test(key))throw error(503,"STRIPE_CONNECT_NOT_CONFIGURED");
  return key;
}
function baseUrl(config){
  const value=String(config?.publicBaseUrl||"").replace(/\/$/,"");
  if(!/^https:\/\/[^/]+$/i.test(value))throw error(503,"PUBLIC_BASE_URL_NOT_CONFIGURED");
  return value;
}
async function jsonRequest(config,path,{method="GET",body,idempotencyKey,connectedAccount,preview=false}={}){
  const headers={Authorization:"Bearer "+requireKey(config),Accept:"application/json"};
  if(preview)headers["Stripe-Version"]="2026-08-26.preview";
  else if(config?.stripeApiVersion)headers["Stripe-Version"]=String(config.stripeApiVersion);
  if(body!==undefined)headers["Content-Type"]="application/json";
  if(idempotencyKey)headers["Idempotency-Key"]=String(idempotencyKey).slice(0,255);
  if(connectedAccount)headers["Stripe-Account"]=String(connectedAccount);
  let response,payload={};
  try{
    response=await fetch("https://api.stripe.com"+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
    payload=await response.json().catch(()=>({}));
  }catch{throw error(502,"STRIPE_CONNECT_UNAVAILABLE")}
  if(!response.ok){
    const raw=String(payload?.error?.code||payload?.error?.type||payload?.error?.message||"STRIPE_CONNECT_REQUEST_FAILED");
    const code=raw.toUpperCase().replace(/[^A-Z0-9]+/g,"_").slice(0,80);
    throw error(response.status>=500?502:422,code||"STRIPE_CONNECT_REQUEST_FAILED");
  }
  return payload;
}
async function formRequest(config,path,{fields,idempotencyKey,connectedAccount}={}){
  const form=new URLSearchParams();
  function add(prefix,value){
    if(value==null)return;
    if(Array.isArray(value)){value.forEach((v,i)=>add(prefix+"["+i+"]",v));return}
    if(typeof value==="object"){for(const [k,v] of Object.entries(value))add(prefix?prefix+"["+k+"]":k,v);return}
    form.append(prefix,String(value));
  }
  for(const [k,v] of Object.entries(fields||{}))add(k,v);
  const headers={
    Authorization:"Bearer "+requireKey(config),
    Accept:"application/json",
    "Content-Type":"application/x-www-form-urlencoded",
    "Stripe-Version":String(config?.stripeApiVersion||"2026-08-26.dahlia")
  };
  if(idempotencyKey)headers["Idempotency-Key"]=String(idempotencyKey).slice(0,255);
  if(connectedAccount)headers["Stripe-Account"]=String(connectedAccount);
  let response,payload={};
  try{
    response=await fetch("https://api.stripe.com"+path,{method:"POST",headers,body:form.toString(),signal:AbortSignal.timeout(12000)});
    payload=await response.json().catch(()=>({}));
  }catch{throw error(502,"STRIPE_CONNECT_UNAVAILABLE")}
  if(!response.ok){
    const raw=String(payload?.error?.code||payload?.error?.type||payload?.error?.message||"STRIPE_CONNECT_REQUEST_FAILED");
    const code=raw.toUpperCase().replace(/[^A-Z0-9]+/g,"_").slice(0,80);
    throw error(response.status>=500?502:422,code||"STRIPE_CONNECT_REQUEST_FAILED");
  }
  return payload;
}
function cleanCountry(v){const x=String(v||"FR").trim().toUpperCase();return /^[A-Z]{2}$/.test(x)?x:"FR"}
function cleanEmail(v){const x=String(v||"").trim().toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)?x:null}
function cleanText(v,max=180){return String(v||"").trim().replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").slice(0,max)}

export function stripeConnectState(config){
  const key=String(config?.stripeSecretKey||"");
  return {
    provider:"stripe_connect",
    configured:/^sk_(test|live)_/.test(key),
    live_mode:key.startsWith("sk_live_"),
    application_fee_bps:STRIPE_CONNECT_APPLICATION_FEE_BPS,
    application_fee_percent:STRIPE_CONNECT_APPLICATION_FEE_BPS/100,
    pricing_model:"direct_charges_stripe_owned_pricing",
    processing_fees_paid_by:"connected_account"
  };
}

export async function createStripeConnectedAccount(config,input={}){
  const email=cleanEmail(input.email),country=cleanCountry(input.country_code);
  if(!email)throw error(400,"INVALID_CONNECT_EMAIL");
  const body={
    contact_email:email,
    dashboard:"full",
    identity:{country},
    defaults:{
      responsibilities:{fees_collector:"stripe",losses_collector:"stripe"},
      profile:{
        business_url:baseUrl(config),
        product_description:"Services de consultation et de télécommunication proposés via Audiotel Premium Pro"
      }
    },
    configuration:{
      merchant:{
        capabilities:{card_payments:{requested:true}},
        support:{url:baseUrl(config)}
      }
    }
  };
  const account=await jsonRequest(config,"/v2/core/accounts",{method:"POST",body,idempotencyKey:input.idempotency_key,preview:true});
  if(!/^acct_[A-Za-z0-9]+$/.test(String(account?.id||"")))throw error(502,"STRIPE_CONNECT_ACCOUNT_INVALID");
  return account;
}

export async function retrieveStripeConnectedAccount(config,accountId){
  if(!/^acct_[A-Za-z0-9]+$/.test(String(accountId||"")))throw error(400,"INVALID_CONNECT_ACCOUNT");
  const query="?include%5B%5D=configuration.merchant&include%5B%5D=requirements&include%5B%5D=defaults";
  return jsonRequest(config,"/v2/core/accounts/"+encodeURIComponent(accountId)+query,{preview:true});
}

export function normalizeStripeConnectedAccount(account={}){
  const card=account?.configuration?.merchant?.capabilities?.card_payments||{};
  const requirements=account?.requirements||{};
  const cardStatus=String(card?.status||"").toLowerCase();
  const deadline=String(requirements?.summary?.minimum_deadline?.status||"").toLowerCase();
  const chargesEnabled=cardStatus==="active";
  const detailsSubmitted=!["currently_due","past_due","eventually_due"].includes(deadline)&&deadline!=="requirements_past_due";
  return {
    provider_account_reference:String(account?.id||""),
    charges_enabled:chargesEnabled,
    payouts_enabled:chargesEnabled,
    details_submitted:detailsSubmitted,
    requirements_state:deadline||cardStatus||"unknown",
    status:chargesEnabled?"active":detailsSubmitted?"restricted":"onboarding"
  };
}

export async function createStripeConnectOnboardingLink(config,accountId,input={}){
  if(!/^acct_[A-Za-z0-9]+$/.test(String(accountId||"")))throw error(400,"INVALID_CONNECT_ACCOUNT");
  const base=baseUrl(config);
  const body={
    account:String(accountId),
    use_case:{
      type:"account_onboarding",
      account_onboarding:{
        return_url:base+"/client.html?card_connect=return",
        refresh_url:base+"/client.html?card_connect=refresh",
        collection_options:{fields:"eventually_due"}
      }
    }
  };
  const link=await jsonRequest(config,"/v2/core/account_links",{method:"POST",body,idempotencyKey:input.idempotency_key,preview:true});
  if(!/^https:\/\//i.test(String(link?.url||"")))throw error(502,"STRIPE_CONNECT_LINK_INVALID");
  return {url:link.url,expires_at:link.expires_at||null};
}

export function calculateApplicationFee(amountMinor,bps=STRIPE_CONNECT_APPLICATION_FEE_BPS){
  const amount=Math.trunc(Number(amountMinor));
  const rate=Math.trunc(Number(bps));
  if(!Number.isInteger(amount)||amount<100||amount>100000000)throw error(400,"INVALID_CARD_PAYMENT_AMOUNT");
  if(!Number.isInteger(rate)||rate<0||rate>3000)throw error(500,"INVALID_APPLICATION_FEE_CONFIGURATION");
  return Math.min(amount,Math.max(0,Math.round(amount*rate/10000)));
}

export async function createStripeCardCheckout(config,input={}){
  const accountId=String(input.connected_account||"");
  if(!/^acct_[A-Za-z0-9]+$/.test(accountId))throw error(400,"INVALID_CONNECT_ACCOUNT");
  const amount=Math.trunc(Number(input.amount_minor)),bps=Math.trunc(Number(input.application_fee_bps||STRIPE_CONNECT_APPLICATION_FEE_BPS));
  const fee=calculateApplicationFee(amount,bps);
  const currency=String(input.currency||"EUR").trim().toLowerCase();
  if(!/^[a-z]{3}$/.test(currency))throw error(400,"INVALID_CARD_PAYMENT_CURRENCY");
  const description=cleanText(input.description,120);
  if(description.length<2)throw error(400,"INVALID_CARD_PAYMENT_DESCRIPTION");
  const requestId=String(input.request_public_id||"").trim();
  const base=baseUrl(config);
  const fields={
    mode:"payment",
    success_url:base+"/client.html?card_payment=success&session_id={CHECKOUT_SESSION_ID}",
    cancel_url:base+"/client.html?card_payment=cancelled",
    client_reference_id:requestId,
    line_items:[{
      quantity:1,
      price_data:{
        currency,
        unit_amount:amount,
        product_data:{name:description}
      }
    }],
    payment_intent_data:{
      application_fee_amount:fee,
      metadata:{
        pgi_card_payment_request:requestId,
        pgi_tenant_public_id:String(input.tenant_public_id||"")
      }
    },
    metadata:{
      pgi_card_payment_request:requestId,
      pgi_tenant_public_id:String(input.tenant_public_id||""),
      pgi_application_fee_bps:String(bps)
    }
  };
  const email=cleanEmail(input.customer_email);if(email)fields.customer_email=email;
  const session=await formRequest(config,"/v1/checkout/sessions",{fields,idempotencyKey:input.idempotency_key,connectedAccount:accountId});
  if(!/^cs_/.test(String(session?.id||""))||!/^https:\/\//i.test(String(session?.url||"")))throw error(502,"STRIPE_CHECKOUT_SESSION_INVALID");
  return {
    provider_checkout_session_reference:String(session.id),
    checkout_url:String(session.url),
    expires_at:session.expires_at?new Date(Number(session.expires_at)*1000).toISOString():null,
    application_fee_minor:fee,
    application_fee_bps:bps
  };
}

export function hashStripeEventPayload(event){
  return createHash("sha256").update(JSON.stringify(event||{})).digest("hex");
}


function stripeObjectId(value,prefix){
  const id=typeof value==="string"?value:(value&&typeof value.id==="string"?value.id:"");
  return id.startsWith(prefix)?id:null;
}
function stripeEventTime(event){
  const n=Number(event?.created);
  return Number.isFinite(n)&&n>0?new Date(n*1000).toISOString():new Date().toISOString();
}

export async function normalizeStripeConnectPaymentEvent(config,event={}){
  const type=String(event?.type||""),obj=event?.data?.object||{},connectedAccount=String(event?.account||"");
  if(!/^acct_[A-Za-z0-9]+$/.test(connectedAccount))return null;

  if(["checkout.session.completed","checkout.session.async_payment_succeeded","checkout.session.async_payment_failed","checkout.session.expired"].includes(type)){
    const meta=obj?.metadata&&typeof obj.metadata==="object"?obj.metadata:{};
    const requestId=String(meta.pgi_card_payment_request||obj.client_reference_id||"").trim();
    if(!/^[0-9a-f-]{36}$/i.test(requestId))return null;
    let status="open";
    if(type==="checkout.session.expired")status="expired";
    else if(type==="checkout.session.async_payment_failed")status="failed";
    else if(type==="checkout.session.async_payment_succeeded"||String(obj.payment_status||"").toLowerCase()==="paid")status="paid";
    return {
      provider:"stripe",provider_event_id:String(event.id||""),event_type:type,event_time:stripeEventTime(event),
      connected_account_reference:connectedAccount,request_public_id:requestId,status,
      provider_checkout_session_reference:stripeObjectId(obj.id,"cs_"),
      provider_payment_intent_reference:stripeObjectId(obj.payment_intent,"pi_"),
      provider_charge_reference:null
    };
  }

  if(type==="charge.refunded"){
    const requestId=String(obj?.metadata?.pgi_card_payment_request||"").trim();
    return {
      provider:"stripe",provider_event_id:String(event.id||""),event_type:type,event_time:stripeEventTime(event),
      connected_account_reference:connectedAccount,request_public_id:/^[0-9a-f-]{36}$/i.test(requestId)?requestId:null,
      status:"refunded",provider_checkout_session_reference:null,
      provider_payment_intent_reference:stripeObjectId(obj.payment_intent,"pi_"),
      provider_charge_reference:stripeObjectId(obj.id,"ch_")
    };
  }

  if(type==="charge.dispute.created"){
    const chargeId=stripeObjectId(obj.charge,"ch_");
    if(!chargeId)return null;
    let charge={};
    try{charge=await jsonRequest(config,"/v1/charges/"+encodeURIComponent(chargeId),{connectedAccount});}catch{return null}
    const requestId=String(charge?.metadata?.pgi_card_payment_request||"").trim();
    return {
      provider:"stripe",provider_event_id:String(event.id||""),event_type:type,event_time:stripeEventTime(event),
      connected_account_reference:connectedAccount,request_public_id:/^[0-9a-f-]{36}$/i.test(requestId)?requestId:null,
      status:"disputed",provider_checkout_session_reference:null,
      provider_payment_intent_reference:stripeObjectId(charge.payment_intent,"pi_"),
      provider_charge_reference:chargeId
    };
  }

  return null;
}
