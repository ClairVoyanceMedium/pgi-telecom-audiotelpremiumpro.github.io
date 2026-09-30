export const CUSTOMER_ROLES=Object.freeze(["owner","admin","finance","operator","analyst","readonly"]);

const ROLE_PERMISSIONS=Object.freeze({
  owner:["*"],
  admin:["overview.read","calls.read","analytics.read","finance.read","finance.export","billing.manage","routing.read","incidents.read","incidents.write","team.read","team.manage","security.manage"],
  finance:["overview.read","calls.read","analytics.read","finance.read","finance.export","billing.manage","team.read"],
  operator:["overview.read","calls.read","analytics.read","routing.read","incidents.read","incidents.write","team.read"],
  analyst:["overview.read","calls.read","analytics.read","finance.read","team.read"],
  readonly:["overview.read","calls.read","analytics.read","finance.read","routing.read","incidents.read","team.read"]
});

export function customerPermissions(context={}){
  const role=String(context.customer_role||context.role||"readonly");
  const base=new Set(ROLE_PERMISSIONS[role]||ROLE_PERMISSIONS.readonly);
  const grants=Array.isArray(context.permission_grants)?context.permission_grants:[];
  const denials=new Set(Array.isArray(context.permission_denials)?context.permission_denials:[]);
  for(const permission of grants)if(typeof permission==="string"&&permission)base.add(permission);
  for(const permission of denials)base.delete(permission);
  return [...base].sort();
}

export function hasCustomerPermission(context,permission){
  const permissions=customerPermissions(context);
  return permissions.includes("*")||permissions.includes(String(permission||""));
}

function stripInternalCommercialFields(row={}){
  const {
    expected_payout_ht,
    upstream_payout_ht,
    platform_fee_ht,
    unallocated_amount_ht,
    estimated_upstream_payout_ht,
    upstream_rate_ht_per_second,
    platform_fee_bps,
    platform_fee_ht_per_min,
    collection_model,
    payout_term_matches,
    ...safe
  }=row||{};
  return safe;
}

function publicCustomerSettlement(row={}){
  return {
    id:row.id,
    currency:row.currency,
    period_start:row.period_start,
    period_end:row.period_end,
    net_payout_ht:row.net_payout_ht,
    held_amount_ht:row.held_amount_ht,
    status:row.status,
    payment_due_date:row.payment_due_date,
    paid_at:row.paid_at,
    statement_reference:row.statement_reference
  };
}

function publicCustomerNumberPerformance(row={}){
  const safe=stripInternalCommercialFields(row);
  const total=Number(row.calls_total||0),matches=Number(row.payout_term_matches||0);
  return {...safe,net_payout_available:total===0||matches>=total};
}

export function scopeCustomerPortalData(context,data={}){
  const allowed=permission=>hasCustomerPermission(context,permission);
  const out={
    ...data,
    financial_by_currency:(data.financial_by_currency||[]).map(stripInternalCommercialFields),
    live_financial_by_currency:(data.live_financial_by_currency||[]).map(stripInternalCommercialFields),
    number_performance:(data.number_performance||[]).map(publicCustomerNumberPerformance),
    settlements:(data.settlements||[]).map(publicCustomerSettlement)
  };
  if(!allowed("finance.read")){
    out.financial_by_currency=(out.financial_by_currency||[]).map(row=>{const {generated_revenue_ttc,estimated_client_net_ht,...rest}=row;return rest;});
    out.metric_net_payout_by_currency=[];
    out.live_financial_by_currency=[];
    out.series=(data.series||[]).map(row=>{const {generated_revenue_ttc,...rest}=row;return rest;});
    out.number_performance=(out.number_performance||[]).map(row=>{const {generated_revenue_ttc,estimated_client_net_ht,net_payout_available,...rest}=row;return rest;});
    out.settlements=[];
    out.subscriptions=(data.subscriptions||[]).map(row=>{const {amount_minor,price_currency,billing_currency,...rest}=row;return rest;});
  }
  if(!allowed("routing.read")){
    out.numbers=[];out.destinations=[];out.portability_requests=[];out.number_performance=[];
  }
  if(!allowed("incidents.read")){
    out.service_incidents=[];out.operational_alerts=[];
  }
  return out;
}

export function scopeCustomerAnnualProgressData(data={}){
  const safeRow=row=>{
    const safe=stripInternalCommercialFields(row);
    const available=row?.net_available===true||String(row?.net_available)==="true";
    return {...safe,net_payout_available:available};
  };
  const {monthly,...rest}=data||{};
  return {
    ...rest,
    summary:(data.summary||[]).map(safeRow),
    daily:(data.daily||[]).map(safeRow)
  };
}

export function requireCustomerPermission(context,permission){
  if(hasCustomerPermission(context,permission))return true;
  const error=new Error("Customer permission denied");
  error.status=403;
  error.code="CUSTOMER_PERMISSION_DENIED";
  error.permission=permission;
  throw error;
}

export function customerRoleLabel(role){
  return ({owner:"Propriétaire",admin:"Administrateur",finance:"Finance",operator:"Opérations",analyst:"Analyste",readonly:"Lecture seule"})[String(role||"")]||"Lecture seule";
}
