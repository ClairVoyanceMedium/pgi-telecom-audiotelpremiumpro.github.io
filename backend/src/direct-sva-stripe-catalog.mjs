// Distribution catalog exists in Stripe live mode but is intentionally inactive.
// This module is a read-only catalog classifier: no customer payments, payouts,
// refunds, billing sessions, subscriptions or webhooks are created here.
export const DIRECT_SVA_STRIPE_PRODUCT_ID="prod_VPxqF47RlQ0uoi";
export const AUDIOTEL_EXISTING_STRIPE_PRODUCT_ID="prod_VJeVHmZAUiMfc7";
export const DIRECT_SVA_STRIPE_UNIT="direct_sva";
export const DIRECT_SVA_STRIPE_COST_CENTER="DSVA";

function error(code){const e=new Error(code);e.code=code;e.status=422;return e;}
const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj||{},key);

export function inspectDirectSvaStripeCatalog(products=[],prices=[],webhookEndpoints=[]){
 if(!Array.isArray(products)||!Array.isArray(prices)||!Array.isArray(webhookEndpoints))
  throw error("DIRECT_SVA_STRIPE_CATALOG_INVALID");
 const match=products.filter(p=>p?.id===DIRECT_SVA_STRIPE_PRODUCT_ID);
 if(match.length!==1)throw error("DIRECT_SVA_STRIPE_PRODUCT_MISSING_OR_DUPLICATED");
 const product=match[0];
 const metadata=product.metadata||{};
 if(product.livemode!==true||metadata.pgi_business_unit!=="direct_sva"||
  metadata.pgi_cost_center!=="DSVA"||metadata.pgi_legal_entity!=="pgi_primary"||
  metadata.pgi_checkout_enabled!=="false"||metadata.pgi_payments_enabled!=="false")
  throw error("DIRECT_SVA_STRIPE_CATALOG_METADATA_DRIFT");
 const audiotel=products.filter(p=>p?.id===AUDIOTEL_EXISTING_STRIPE_PRODUCT_ID);
 if(audiotel.length!==1||audiotel[0]?.metadata?.pgi_business_unit==="direct_sva")
  throw error("DIRECT_SVA_STRIPE_AUDIOTEL_ISOLATION_FAILED");
 const ownPrices=prices.filter(p=>p?.product===DIRECT_SVA_STRIPE_PRODUCT_ID);
 const foreignMetadata=ownPrices.some(p=>p?.metadata?.pgi_business_unit&&p.metadata.pgi_business_unit!=="direct_sva");
 if(foreignMetadata)throw error("DIRECT_SVA_STRIPE_PRICE_CROSS_BUSINESS");
 const activePrices=ownPrices.filter(p=>p.active===true);
 const targeted=webhookEndpoints.filter(x=>/\/api\/v1\/billing\/stripe\/direct-sva-webhook(?:\?|$)/.test(String(x?.url||"")));
 return Object.freeze({
  business_unit:"direct_sva",stripe_product_id:DIRECT_SVA_STRIPE_PRODUCT_ID,
  stripe_product_created:true,live_catalog:true,
  product_active:product.active===true,
  product_has_default_price:typeof product.default_price==="string",
  configured_distribution_prices:ownPrices.length,
  active_distribution_prices:activePrices.length,
  distribution_webhook_endpoints:targeted.length,
  active_distribution_webhook_endpoints:targeted.filter(x=>x.status==="enabled").length,
  // A valid catalog record alone does NOT validate financial flows.
  ready_to_charge:false,ready_to_refund:false,ready_to_payout:false,
  customer_checkout_created:false,existing_audiotel_unchanged:true,
  state:product.active===false&&ownPrices.length===0&&targeted.length===0?"catalog_prepared_inactive":"catalog_configuration_requires_review"
 });
}

export function inspectVerifiedDirectSvaStripeEvent(event,{signature_verified=false}={}){
 // Caller must verify using a separately configured Stripe webhook secret
 // before invoking this diagnostic. It NEVER records or fulfils a payment.
 if(signature_verified!==true)throw error("DIRECT_SVA_STRIPE_SIGNATURE_NOT_VERIFIED");
 if(typeof event?.id!=="string"||!/^evt_[A-Za-z0-9]+$/.test(event.id)||
    typeof event.type!=="string")throw error("DIRECT_SVA_STRIPE_EVENT_INVALID");
 const obj=event?.data?.object;
 const meta=obj?.metadata;
 if(!meta||typeof meta!=="object")return Object.freeze({
  event_id:event.id,business_unit:null,belongs_to_distribution:false,requires_manual_review:true,
  financial_write_allowed:false,reason:"missing_business_unit"
 });
 if(meta.pgi_business_unit==="audiotel_platform"||meta.platform==="pgi-telecom-audiotel-premium-pro")
  return Object.freeze({event_id:event.id,business_unit:"audiotel_platform",
   belongs_to_distribution:false,requires_manual_review:false,
   financial_write_allowed:false,reason:"belongs_to_existing_audiotel"});
 if(meta.pgi_business_unit!=="direct_sva")return Object.freeze({
  event_id:event.id,business_unit:null,belongs_to_distribution:false,requires_manual_review:true,
  financial_write_allowed:false,reason:"unknown_business_unit"
 });
 if(meta.pgi_stripe_product_id!==DIRECT_SVA_STRIPE_PRODUCT_ID||
    meta.pgi_legal_entity!=="pgi_primary"||
    meta.pgi_cost_center!=="DSVA")throw error("DIRECT_SVA_STRIPE_EVENT_CATALOG_MISMATCH");
 if(typeof meta.pgi_source_reference!=="string"||
    !/^DSVA-[A-Za-z0-9_-]{6,80}$/.test(meta.pgi_source_reference))
  throw error("DIRECT_SVA_STRIPE_EVENT_REFERENCE_INVALID");
 return Object.freeze({
  event_id:event.id,business_unit:"direct_sva",belongs_to_distribution:true,
  reference:meta.pgi_source_reference,requires_manual_review:true,
  financial_write_allowed:false,reason:"pending_provider_event_reconciliation"
 });
}
