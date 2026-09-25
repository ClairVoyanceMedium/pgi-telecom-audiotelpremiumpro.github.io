import {createHmac,timingSafeEqual} from "node:crypto";

function failure(status,code,message=code){
  const e=new Error(message);e.status=status;e.code=code;e.expose=status<500;return e;
}
function requireStripe(config){
  const key=String(config?.stripeSecretKey||"").trim();
  if(!key)throw failure(503,"PAYMENT_PROVIDER_NOT_CONNECTED");
  return key;
}
function baseUrl(config){
  const value=String(config?.publicBaseUrl||"").replace(/\/$/,"");
  if(!/^https:\/\/[^/]+$/i.test(value))throw failure(503,"PUBLIC_BASE_URL_NOT_CONFIGURED");
  return value;
}
function appendForm(params,prefix,value){
  if(value==null)return;
  if(Array.isArray(value)){value.forEach((v,i)=>appendForm(params,prefix+"["+i+"]",v));return;}
  if(typeof value==="object"){
    for(const [k,v] of Object.entries(value))appendForm(params,prefix?prefix+"["+k+"]":k,v);
    return;
  }
  params.append(prefix,typeof value==="boolean"?(value?"true":"false"):String(value));
}
async function stripeApi(config,path,{method="GET",params={},idempotencyKey}={}){
  const key=requireStripe(config),form=new URLSearchParams();
  for(const [k,v] of Object.entries(params||{}))appendForm(form,k,v);
  let url="https://api.stripe.com"+path;
  const headers={Authorization:"Bearer "+key,"Stripe-Version":String(config?.stripeApiVersion||"2026-08-26.dahlia")};
  const init={method,headers,signal:AbortSignal.timeout(12000)};
  if(method==="GET"){if(form.size)url+="?"+form.toString();}
  else{headers["Content-Type"]="application/x-www-form-urlencoded";if(idempotencyKey)headers["Idempotency-Key"]=String(idempotencyKey);init.body=form.toString();}
  let response;
  try{response=await fetch(url,init);}catch{throw failure(502,"PAYMENT_PROVIDER_UNAVAILABLE");}
  let body={};try{body=await response.json();}catch{}
  if(!response.ok){
    const type=String(body?.error?.type||"").toUpperCase().replace(/[^A-Z0-9]+/g,"_").slice(0,50);
    throw failure(response.status>=500?502:422,type?"STRIPE_"+type:"STRIPE_REQUEST_FAILED");
  }
  return body;
}
function lookupKey(config,offer){
  const explicit=String(config?.stripePriceLookupKey||"").trim();
  if(explicit)return explicit;
  const currency=String(offer?.currency||"EUR").toLowerCase();
  const interval=String(offer?.billing_interval||"month").toLowerCase();
  const label=interval==="month"?"monthly":interval==="year"?"yearly":interval;
  return "pgi_audiotel_premium_pro_"+label+"_"+currency;
}
function validatePrice(price,offer){
  if(!price||price.active!==true||price.type!=="recurring")throw failure(409,"STRIPE_PRICE_NOT_ACTIVE");
  if(String(price.currency||"").toUpperCase()!==String(offer.currency||"").toUpperCase())throw failure(409,"STRIPE_PRICE_CURRENCY_MISMATCH");
  if(Number(price.unit_amount)!==Number(offer.amount_minor))throw failure(409,"STRIPE_PRICE_AMOUNT_MISMATCH");
  if(String(price.recurring?.interval||"")!==String(offer.billing_interval||""))throw failure(409,"STRIPE_PRICE_INTERVAL_MISMATCH");
  if(Number(price.recurring?.interval_count||1)!==Number(offer.interval_count||1))throw failure(409,"STRIPE_PRICE_INTERVAL_MISMATCH");
  if(offer.tax_behavior&&price.tax_behavior&&String(price.tax_behavior)!==String(offer.tax_behavior))throw failure(409,"STRIPE_PRICE_TAX_MISMATCH");
  return price;
}
async function resolvePrice(config,offer){
  if(String(offer?.provider||"").toLowerCase()==="stripe"&&offer?.provider_price_reference){
    const price=await stripeApi(config,"/v1/prices/"+encodeURIComponent(String(offer.provider_price_reference)));
    return validatePrice(price,offer);
  }
  const response=await stripeApi(config,"/v1/prices",{params:{"lookup_keys[]":[lookupKey(config,offer)],active:true,limit:2}});
  if(!Array.isArray(response.data)||response.data.length!==1)throw failure(409,"STRIPE_PRICE_LOOKUP_NOT_UNIQUE");
  return validatePrice(response.data[0],offer);
}
export function stripeProviderState(config){
  const api=Boolean(config?.externalBillingEnabled&&config?.stripeSecretKey&&config?.publicBaseUrl);
  const webhook=Boolean(config?.externalBillingEnabled&&config?.stripeWebhookSecret);
  return {api,webhook,connected:api&&webhook};
}
export async function createStripeCheckout(config,billing,idempotencyKey){
  const price=await resolvePrice(config,billing?.offer);
  const tenant=billing?.tenant||{},subscription=billing?.subscription||{};
  const metadata={
    tenant_public_id:String(tenant.id||""),
    price_version_id:String(billing?.offer?.price_version_id||""),
    plan_key:String(billing?.offer?.plan_key||"external-sva-access")
  };
  if(billing?.offer?.market_id!=null)metadata.market_id=String(billing.offer.market_id);
  const params={
    mode:"subscription",
    success_url:baseUrl(config)+"/client.html?billing=success&session_id={CHECKOUT_SESSION_ID}",
    cancel_url:baseUrl(config)+"/client.html?billing=cancelled",
    client_reference_id:String(tenant.id||""),
    line_items:[{price:price.id,quantity:1}],
    metadata,
    subscription_data:{metadata,description:"Abonnement plateforme PGI Telecom • Audiotel Premium Pro. Les reversements SVA restent distincts."},
    billing_address_collection:"required",
    tax_id_collection:{enabled:true},
    custom_text:{submit:{message:"Cet abonnement concerne l’accès à la plateforme PGI Telecom. Les reversements SVA et leurs conditions restent distincts."}},
    locale:"auto"
  };
  const customer=String(subscription.provider_customer_reference||"");
  if(/^cus_[A-Za-z0-9]+$/.test(customer)){
    params.customer=customer;
    params.customer_update={address:"auto",name:"auto"};
  }else if(tenant.billing_email){
    params.customer_email=String(tenant.billing_email);
  }
  const session=await stripeApi(config,"/v1/checkout/sessions",{method:"POST",params,idempotencyKey});
  if(!session?.url||!/^https:\/\/checkout\.stripe\.com\//i.test(session.url))throw failure(502,"STRIPE_CHECKOUT_URL_INVALID");
  return {url:session.url,session_id:session.id,price_id:price.id,provider:"stripe"};
}
export async function createStripePortalSession(config,billing){
  const customer=String(billing?.subscription?.provider_customer_reference||"");
  if(!/^cus_[A-Za-z0-9]+$/.test(customer))throw failure(409,"BILLING_CUSTOMER_NOT_AVAILABLE");
  const params={customer,return_url:baseUrl(config)+"/client.html?billing=portal-return"};
  if(config?.stripePortalConfigurationId)params.configuration=String(config.stripePortalConfigurationId);
  const session=await stripeApi(config,"/v1/billing_portal/sessions",{method:"POST",params});
  if(!session?.url||!/^https:\/\/billing\.stripe\.com\//i.test(session.url))throw failure(502,"STRIPE_PORTAL_URL_INVALID");
  return {url:session.url,provider:"stripe"};
}
async function readRaw(req,limit){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>limit)throw failure(413,"BODY_TOO_LARGE");chunks.push(chunk);}
  return Buffer.concat(chunks);
}
function signatureParts(header){
  const out={t:null,v1:[]};
  for(const part of String(header||"").split(",")){const i=part.indexOf("=");if(i<1)continue;const k=part.slice(0,i).trim(),v=part.slice(i+1).trim();if(k==="t")out.t=Number(v);if(k==="v1"&&v)out.v1.push(v);}
  return out;
}
export async function verifyStripeWebhook(req,config){
  const secret=String(config?.stripeWebhookSecret||"");
  if(!secret)throw failure(404,"STRIPE_WEBHOOK_DISABLED");
  const raw=await readRaw(req,Number(config?.bodyLimitBytes||262144));
  const parsed=signatureParts(req.headers?.["stripe-signature"]);
  if(!Number.isInteger(parsed.t)||!parsed.v1.length)throw failure(400,"STRIPE_SIGNATURE_INVALID");
  const tolerance=Number(config?.stripeWebhookToleranceSeconds||300),now=Math.floor(Date.now()/1000);
  if(Math.abs(now-parsed.t)>tolerance)throw failure(400,"STRIPE_SIGNATURE_EXPIRED");
  const expected=createHmac("sha256",secret).update(String(parsed.t)+".").update(raw).digest("hex");
  const a=Buffer.from(expected),valid=parsed.v1.some(v=>{const b=Buffer.from(String(v));return a.length===b.length&&timingSafeEqual(a,b);});
  if(!valid)throw failure(400,"STRIPE_SIGNATURE_INVALID");
  let event;try{event=JSON.parse(raw.toString("utf8"));}catch{throw failure(400,"INVALID_JSON");}
  if(!event||typeof event!=="object"||!String(event.id||"").startsWith("evt_"))throw failure(400,"STRIPE_EVENT_INVALID");
  return event;
}
function idValue(v){return typeof v==="string"?v:(v&&typeof v.id==="string"?v.id:null);}
function subscriptionItem(obj){return obj?.items?.data?.find(x=>x?.price)||obj?.items?.data?.[0]||null;}
function subscriptionMeta(obj){return obj?.metadata&&typeof obj.metadata==="object"?obj.metadata:{};}
function normalizeStatus(status,eventType){
  const s=String(status||"").toLowerCase();
  if(eventType==="customer.subscription.deleted")return "cancelled";
  if(["active","trialing"].includes(s))return "active";
  if(s==="past_due")return "past_due";
  if(["unpaid","paused","incomplete"].includes(s))return "suspended";
  if(["canceled","cancelled"].includes(s))return "cancelled";
  if(s==="incomplete_expired")return "ended";
  return "suspended";
}
function eventIso(event){const n=Number(event?.created);return Number.isFinite(n)?new Date(n*1000).toISOString():new Date().toISOString();}
function periodIso(value){const n=Number(value);return Number.isFinite(n)&&n>0?new Date(n*1000).toISOString():null;}
export function normalizeStripeSubscriptionEvent(event){
  const type=String(event?.type||""),obj=event?.data?.object;
  if(!obj)return null;
  if(type.startsWith("customer.subscription.")){
    const meta=subscriptionMeta(obj),item=subscriptionItem(obj),price=item?.price||item?.plan||{};
    if(!meta.tenant_public_id||!meta.price_version_id)return null;
    const eventTime=eventIso(event);
    return {
      provider:"stripe",provider_event_id:String(event.id),tenant_public_id:String(meta.tenant_public_id),
      provider_customer_reference:idValue(obj.customer),provider_subscription_reference:String(obj.id||""),
      event_type:type,status:normalizeStatus(obj.status,type),event_time:eventTime,
      price_version_id:Number(meta.price_version_id),market_id:meta.market_id?Number(meta.market_id):null,
      current_period_start:periodIso(item?.current_period_start||obj.current_period_start),
      current_period_end:periodIso(item?.current_period_end||obj.current_period_end),
      cancel_at_period_end:Boolean(obj.cancel_at_period_end),
      last_payment_status:["active","trialing"].includes(String(obj.status))?"paid":String(obj.status||""),
      ends_at:periodIso(obj.ended_at||obj.canceled_at),
      provider_price_reference:idValue(price),provider_price_amount_minor:price?.unit_amount==null?null:Number(price.unit_amount),
      provider_price_currency:price?.currency?String(price.currency).toUpperCase():null,
      provider_billing_interval:price?.recurring?.interval||null,
      provider_interval_count:price?.recurring?.interval_count==null?null:Number(price.recurring.interval_count)
    };
  }
  return null;
}


function invoiceSubscriptionReference(invoice){
  return idValue(invoice?.parent?.subscription_details?.subscription)||idValue(invoice?.subscription);
}
function invoicePaymentStatus(type){
  if(type==="invoice.paid")return "paid";
  if(type==="invoice.payment_failed")return "failed";
  if(type==="invoice.payment_action_required")return "action_required";
  if(type==="invoice.updated")return "retry_scheduled";
  return null;
}
function invoiceAttemptCount(invoice){
  const n=Number(invoice?.attempt_count);
  return Number.isInteger(n)&&n>=0?n:null;
}
function invoiceNextPaymentAttempt(invoice){return periodIso(invoice?.next_payment_attempt);}
function invoiceReference(invoice){
  const id=idValue(invoice);
  return id&&/^in_[A-Za-z0-9]+$/.test(id)?id:null;
}
function trustedStripeDocumentUrl(value){
  if(!value)return null;
  try{
    const url=new URL(String(value));
    const host=url.hostname.toLowerCase();
    if(url.protocol!=="https:"||!(host==="stripe.com"||host.endsWith(".stripe.com")))return null;
    return url.toString();
  }catch{return null;}
}
export async function normalizeStripeBillingEvent(event,config){
  const direct=normalizeStripeSubscriptionEvent(event);
  if(direct)return direct;
  const type=String(event?.type||"");
  if(!["invoice.paid","invoice.payment_failed","invoice.payment_action_required","invoice.updated"].includes(type))return null;
  const invoice=event?.data?.object;
  if(type==="invoice.updated"&&!(Number(invoice?.attempt_count)>0&&invoice?.next_payment_attempt))return null;
  const subscriptionId=invoiceSubscriptionReference(invoice);
  if(!/^sub_[A-Za-z0-9]+$/.test(String(subscriptionId||"")))return null;
  const subscription=await stripeApi(config,"/v1/subscriptions/"+encodeURIComponent(subscriptionId));
  const synthetic={
    id:String(event.id||""),type:"customer.subscription.updated",created:event?.created,
    data:{object:subscription}
  };
  const normalized=normalizeStripeSubscriptionEvent(synthetic);
  if(!normalized)return null;
  normalized.provider_event_id=String(event.id||"");
  normalized.event_type=type;
  normalized.event_time=eventIso(event);
  normalized.last_payment_status=invoicePaymentStatus(type);
  normalized.provider_invoice_reference=invoiceReference(invoice);
  normalized.provider_invoice_url=trustedStripeDocumentUrl(invoice?.hosted_invoice_url);
  normalized.provider_invoice_pdf_url=trustedStripeDocumentUrl(invoice?.invoice_pdf);
  normalized.payment_attempt_count=invoiceAttemptCount(invoice);
  normalized.next_payment_attempt=invoiceNextPaymentAttempt(invoice);
  if(type==="invoice.paid"){
    if(["active","trialing"].includes(String(subscription?.status||"").toLowerCase()))normalized.status="active";
  }else if(!["cancelled","ended","suspended"].includes(normalized.status)){
    normalized.status="past_due";
  }
  return normalized;
}
