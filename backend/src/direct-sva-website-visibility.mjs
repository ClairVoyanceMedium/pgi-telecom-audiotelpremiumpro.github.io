import {createHash} from "node:crypto";

// Visibility of the navigation is NOT visibility to Google.
// Pages must stay HTTP 200, indexable and listed in the sitemap after a
// separately approved content publication, even when this switch is OFF.
function fail(status,code){
 const e=new Error(code);e.status=status;e.code=code;return e;
}
function parse(row){
 if(!row)throw fail(503,"DIRECT_SVA_WEBSITE_MIGRATION_REQUIRED");
 if(typeof row.public_content_authorized!=="boolean"||
    typeof row.navigation_enabled!=="boolean"||
    row.commercial_calls_to_action_enabled!==false)
  throw fail(503,"DIRECT_SVA_WEBSITE_INVALID_STATE");
 return Object.freeze({
  business_unit:"direct_sva",
  publication_authorized:row.public_content_authorized===true,
  navigation_visible:row.public_content_authorized===true&&row.navigation_enabled===true,
  navigation_preference:row.navigation_enabled===true,
  seo_pages_accessible:row.public_content_authorized===true,
  seo_continuity_when_hidden:true,
  sitemap_active:row.public_content_authorized===true,
  commercial_requests_enabled:false,
  existing_audiotel_unchanged:true,
  changed_at:row.changed_at||null
 });
}
export function normalizeDirectSvaWebsiteState(row){return parse(row);}
export async function readDirectSvaWebsiteVisibility(store){
 const sql=store?.readSql?.unsafe||store?.sql?.unsafe;
 if(!sql)return {business_unit:"direct_sva",publication_authorized:false,
  navigation_visible:false,navigation_preference:false,seo_pages_accessible:false,
  seo_continuity_when_hidden:true,sitemap_active:false,commercial_requests_enabled:false,
  existing_audiotel_unchanged:true,status:"database_unavailable"};
 try{
  const rows=await sql.call(store.readSql?.unsafe?store.readSql:store.sql,
   "SELECT public_content_authorized,navigation_enabled,commercial_calls_to_action_enabled,changed_at FROM direct_sva_website_visibility WHERE id=1");
  return parse(rows[0]);
 }catch{
  return {business_unit:"direct_sva",publication_authorized:false,
   navigation_visible:false,navigation_preference:false,seo_pages_accessible:false,
   seo_continuity_when_hidden:true,sitemap_active:false,commercial_requests_enabled:false,
   existing_audiotel_unchanged:true,status:"unavailable_or_invalid"};
 }
}
export async function setDirectSvaWebsiteNavigation(store,actor,input={}){
 if(actor?.role!=="admin"||typeof actor?.sub!=="string"||!actor.sub.trim())
  throw fail(403,"DIRECT_SVA_ADMIN_REQUIRED");
 if(!store?.sql?.begin||!store?.sql?.unsafe)throw fail(503,"DIRECT_SVA_POSTGRES_REQUIRED");
 if(typeof input.enabled!=="boolean"||typeof input.expected_enabled!=="boolean")
  throw fail(400,"DIRECT_SVA_NAVIGATION_BOOLEAN_REQUIRED");
 const evidence=String(input.evidence_reference||"").trim();
 if(evidence.length<8||evidence.length>240)throw fail(400,"DIRECT_SVA_NAVIGATION_EVIDENCE_REQUIRED");
 const actorHash=createHash("sha256").update("pgi-direct-sva-website-navigation:v1:"+actor.sub).digest("hex");
 return store.sql.begin(async tx=>{
  const rows=await tx.unsafe(
   "SELECT public_content_authorized,navigation_enabled,commercial_calls_to_action_enabled,changed_at FROM direct_sva_website_visibility WHERE id=1 FOR UPDATE");
  const before=parse(rows[0]);
  if(before.navigation_preference!==input.expected_enabled)
   throw fail(409,"DIRECT_SVA_NAVIGATION_STATE_CHANGED_REFRESH");
  if(input.enabled!==input.expected_enabled){
   await tx.unsafe("UPDATE direct_sva_website_visibility SET navigation_enabled=$1,changed_at=now(),actor_hash=$2 WHERE id=1",
    [input.enabled,actorHash]);
  }
  await tx.unsafe(
   "INSERT INTO direct_sva_website_visibility_audit (previous_value,requested_value,result,actor_hash,evidence_reference) VALUES($1,$2,$3,$4,$5)",
   [before.navigation_preference,input.enabled,input.enabled===before.navigation_preference?"unchanged":"applied",actorHash,evidence]);
  const next=parse({...rows[0],navigation_enabled:input.enabled});
  return Object.freeze({...next,changed:input.enabled!==before.navigation_preference,
   seo_indexation_changed:false,commercial_activation_authorized:false,
   next_step:next.publication_authorized?"navigation_updated":"prelaunch_setting_saved_only"});
 });
}
