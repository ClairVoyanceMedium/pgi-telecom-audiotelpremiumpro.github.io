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
