function cleanText(value,max=200){
  return String(value==null?"":value).trim().replace(/[\r\n\t]+/g," ").slice(0,max);
}
function validClientId(value){
  const v=cleanText(value,120);
  return /^\d{1,20}\.\d{1,20}$/.test(v)?v:"";
}
function validSessionId(value){
  const v=cleanText(value,40);
  return /^\d{1,20}$/.test(v)?v:"";
}
function validTransactionId(value){
  const v=cleanText(value,128);
  return /^[A-Za-z0-9_-]{1,128}$/.test(v)?v:"";
}
function validCurrency(value){
  const v=cleanText(value,3).toUpperCase();
  return /^[A-Z]{3}$/.test(v)?v:"";
}
function analyticsEnabled(config){
  return Boolean(config?.ga4MeasurementEnabled&&config?.ga4MeasurementId&&config?.ga4ApiSecret);
}
export function ga4MeasurementState(config){
  return {
    enabled:analyticsEnabled(config),
    measurement_id_configured:Boolean(config?.ga4MeasurementId),
    api_secret_configured:Boolean(config?.ga4ApiSecret)
  };
}
export function sanitizeGa4CheckoutContext(input={}){
  const client_id=validClientId(input.ga_client_id);
  const session_id=validSessionId(input.ga_session_id);
  return client_id?{client_id,...(session_id?{session_id}:{})}:null;
}
export function buildGa4PurchaseFromStripe(normalized={}){
  if(String(normalized.event_type||"")!=="invoice.paid")return null;
  const client_id=validClientId(normalized.ga_client_id);
  const transaction_id=validTransactionId(normalized.provider_invoice_reference);
  const currency=validCurrency(normalized.provider_invoice_currency||normalized.provider_price_currency);
  const amountMinor=Number(normalized.provider_invoice_amount_paid_minor);
  if(!client_id||!transaction_id||!currency||!Number.isInteger(amountMinor)||amountMinor<0)return null;
  const session_id=validSessionId(normalized.ga_session_id);
  const value=Math.round((amountMinor/100)*100)/100;
  return {
    client_id,
    events:[{
      name:"purchase",
      params:{
        transaction_id,
        currency,
        value,
        ...(session_id?{session_id:Number(session_id)}:{}),
        engagement_time_msec:1,
        items:[{
          item_id:"audiotel_premium_pro_platform",
          item_name:"Audiotel Premium Pro",
          price:value,
          quantity:1
        }]
      }
    }]
  };
}
export function buildGa4RefundFromStripe(input={}){
  const client_id=validClientId(input.ga_client_id);
  const transaction_id=validTransactionId(input.transaction_id);
  const currency=validCurrency(input.currency);
  const amountMinor=Number(input.amount_minor);
  if(!client_id||!transaction_id||!currency||!Number.isInteger(amountMinor)||amountMinor<=0)return null;
  const session_id=validSessionId(input.ga_session_id);
  const value=Math.round((amountMinor/100)*100)/100;
  return {
    client_id,
    events:[{
      name:"refund",
      params:{
        transaction_id,
        currency,
        value,
        ...(session_id?{session_id:Number(session_id)}:{}),
        engagement_time_msec:1,
        items:[{
          item_id:"audiotel_premium_pro_platform",
          item_name:"Audiotel Premium Pro",
          price:value,
          quantity:1
        }]
      }
    }]
  };
}
export async function sendGa4Measurement(config,payload,options={}){
  if(!analyticsEnabled(config)||!payload)return {enabled:false,sent:false};
  const fetchImpl=options.fetchImpl||globalThis.fetch;
  if(typeof fetchImpl!=="function")return {enabled:true,sent:false,error:"FETCH_UNAVAILABLE"};
  const endpoint="https://region1.google-analytics.com/mp/collect?measurement_id="+encodeURIComponent(config.ga4MeasurementId)+"&api_secret="+encodeURIComponent(config.ga4ApiSecret);
  try{
    const response=await fetchImpl(endpoint,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload),
      signal:AbortSignal.timeout(Number(config.ga4MeasurementTimeoutMs||3000))
    });
    return response.ok?{enabled:true,sent:true,status:response.status}:{enabled:true,sent:false,status:response.status,error:"GA4_MEASUREMENT_REJECTED"};
  }catch(error){
    return {enabled:true,sent:false,error:error?.name==="AbortError"?"GA4_MEASUREMENT_TIMEOUT":"GA4_MEASUREMENT_UNAVAILABLE"};
  }
}
