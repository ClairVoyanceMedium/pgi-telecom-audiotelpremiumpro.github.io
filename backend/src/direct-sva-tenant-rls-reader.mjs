// Prepared, not wired. Tenant-scoped PostgreSQL reads through a NO BYPASSRLS role.
// The current SQL owner bypasses RLS, so this wrapper must be used by the
// future customer data path only after full integration and permissions review.
function tenant(value){
 if(typeof value!=="number"&&typeof value!=="string")throw new TypeError("DIRECT_SVA_TENANT_REQUIRED");
 if(typeof value==="string"&&!/^[1-9][0-9]*$/.test(value))throw new TypeError("DIRECT_SVA_TENANT_REQUIRED");
 const id=Number(value);
 if(!Number.isSafeInteger(id)||id<1)throw new TypeError("DIRECT_SVA_TENANT_REQUIRED");
 return id;
}
export async function withDirectSvaTenantRead(store,authenticatedTenant,work){
 const id=tenant(authenticatedTenant);
 if(typeof work!=="function")throw new TypeError("DIRECT_SVA_READ_CALLBACK_REQUIRED");
 if(typeof store?.readSql?.begin!=="function")throw new Error("DIRECT_SVA_TRANSACTIONAL_READER_REQUIRED");
 return store.readSql.begin(async tx=>{
  if(typeof tx?.unsafe!=="function")throw new Error("DIRECT_SVA_TRANSACTIONAL_READER_REQUIRED");
  // SET LOCAL is tied to this transaction/connection, not to a connection pool.
  // The privilege is fixed and not user-controlled.
  await tx.unsafe("SET LOCAL ROLE pgi_dsva_tenant_reader");
  await tx.unsafe("SELECT set_config('app.pgi_dsva_tenant_id',$1,true)",[String(id)]);
  const [role]=await tx.unsafe("SELECT current_user AS name,rolbypassrls AS bypass FROM pg_roles WHERE rolname=current_user");
  if(role?.name!=="pgi_dsva_tenant_reader"||role?.bypass!==false){
   throw new Error("DIRECT_SVA_RLS_ROLE_VERIFICATION_FAILED");
  }
  return work({unsafe:(sql,args)=>tx.unsafe(sql,args)},id);
 });
}
