import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {defaultVoiceFlow,validateVoiceFlow,simulateVoiceFlow,voiceFlowChecksum} from "../backend/src/voice-studio-domain.mjs";

const [migration,store,server,clientApi,clientUi,clientPortal,buildStatic,checkStatic,sizeCheck]=await Promise.all([
  readFile(new URL("../database/migrations/036_voice_studio.sql",import.meta.url),"utf8"),
  readFile(new URL("../backend/src/store-postgres.mjs",import.meta.url),"utf8"),
  readFile(new URL("../backend/server.mjs",import.meta.url),"utf8"),
  readFile(new URL("../assets/client-portal-api.js",import.meta.url),"utf8"),
  readFile(new URL("../assets/client-voice-studio.js",import.meta.url),"utf8"),
  readFile(new URL("../assets/client-portal.js",import.meta.url),"utf8"),
  readFile(new URL("../scripts/build-static.mjs",import.meta.url),"utf8"),
  readFile(new URL("../scripts/check-static.mjs",import.meta.url),"utf8"),
  readFile(new URL("../scripts/check-size.mjs",import.meta.url),"utf8")
]);

test("new voice service fails closed until a real destination is supplied",()=>{
  const flow=defaultVoiceFlow();
  const result=validateVoiceFlow(flow);
  assert.equal(result.valid,false);
  assert.ok(result.errors.some(x=>["VOICE_QUEUE_EMPTY","VOICE_QUEUE_URI_INVALID"].includes(x.code)));
});

test("voice studio validates advanced flows and simulates without mutation",()=>{
  const flow=defaultVoiceFlow({destination_uri:"tel:+33123456789",overflow_uri:"tel:+33987654321"});
  flow.entry="access";
  flow.recording={policy:"always",purpose:"quality",consent_required:true,retention_days:30};
  const menu=flow.nodes.find(x=>x.id==="menu");
  menu.choices.find(x=>x.digit==="1").next="recording";menu.timeout_next="recording";
  flow.nodes.push({id:"recording",type:"recording_consent",text:"Cet appel peut être enregistré à des fins de qualité.",consent_next:"queue",decline_next:"queue"});
  flow.nodes.unshift({id:"access",type:"access_control",blacklist:["+33600"],whitelist:["+336001"],blocked_next:"blocked",allowed_next:"welcome"});
  flow.nodes.push({id:"blocked",type:"terminate",reason:"blocked"});
  const checked=validateVoiceFlow(flow);
  assert.equal(checked.valid,true);
  assert.ok(checked.features.includes("access_control"));
  const before=JSON.stringify(flow);
  const sim=simulateVoiceFlow(flow,{digits:"1",caller_number:"+33123456789",at:"2026-09-21T10:00:00Z"});
  assert.equal(sim.dry_run,true);
  assert.ok(sim.path.length>0);
  assert.equal(JSON.stringify(flow),before);
  assert.match(voiceFlowChecksum(flow),/^[0-9a-f]{64}$/);
});

test("recording publication rules require caller information and sensible retention",()=>{
  const flow=defaultVoiceFlow({destination_uri:"tel:+33123456789"});
  flow.recording={policy:"always",purpose:"quality",consent_required:false,retention_days:365};
  const checked=validateVoiceFlow(flow);
  assert.equal(checked.valid,false);
  assert.ok(checked.errors.some(x=>x.code==="VOICE_RECORDING_NOTICE_REQUIRED"));
  assert.ok(checked.errors.some(x=>x.code==="VOICE_RECORDING_NODE_REQUIRED"));
  assert.ok(checked.errors.some(x=>x.code==="VOICE_RECORDING_RETENTION_TOO_LONG"));
});


test("direct dial routes multi-digit service codes and rejects duplicates",()=>{
  const flow=defaultVoiceFlow({destination_uri:"tel:+33123456789"});
  flow.entry="direct";
  flow.nodes.unshift(
    {id:"direct",type:"direct_dial",prompt:"Saisissez votre code service.",min_digits:1,max_digits:6,timeout_seconds:6,codes:[{code:"101",label:"Commercial",destination_uri:"tel:+33111111111",next:"sales"},{code:"202",label:"Support",destination_uri:"tel:+33222222222",next:"support"}],fallback_next:"menu"},
    {id:"sales",type:"route",destination_uri:"tel:+33111111111"},
    {id:"support",type:"route",destination_uri:"tel:+33222222222"}
  );
  const checked=validateVoiceFlow(flow);
  assert.equal(checked.valid,true,JSON.stringify(checked.errors));
  const simulated=simulateVoiceFlow(flow,{digits:"202#",at:"2026-09-21T10:00:00+02:00"});
  assert.equal(simulated.result?.action,"route");
  assert.equal(simulated.result?.destination_uri,"tel:+33222222222");
  flow.nodes[0].codes.push({code:"202",label:"Doublon",destination_uri:"tel:+33333333333",next:"sales"});
  const duplicate=validateVoiceFlow(flow);
  assert.equal(duplicate.valid,false);
  assert.ok(duplicate.errors.some(x=>x.code==="VOICE_DIRECT_CODE_DUPLICATE"));
});

test("weighted routing is rejected unless weights total exactly 100",()=>{
  const flow={schema_version:1,entry:"split",default_locale:"fr-FR",nodes:[
    {id:"split",type:"weighted_split",branches:[{weight:60,next:"a"},{weight:30,next:"b"}]},
    {id:"a",type:"route",destination_uri:"tel:+33123456789"},
    {id:"b",type:"route",destination_uri:"tel:+33987654321"}
  ]};
  const checked=validateVoiceFlow(flow);
  assert.equal(checked.valid,false);
  assert.ok(checked.errors.some(x=>x.code==="VOICE_SPLIT_WEIGHT_INVALID"));
});

test("voice studio schema is tenant scoped, versioned and rollback-ready",()=>{
  for(const token of [
    "CREATE TABLE tenant_voice_services",
    "CREATE TABLE tenant_voice_service_versions",
    "CREATE TABLE tenant_voice_access_rules",
    "CREATE TABLE tenant_voice_service_events",
    "tenant_scoped_voice_services",
    "tenant_scoped_voice_service_versions",
    "security_barrier=true",
    "active_version_id",
    "source_version_id"
  ])assert.ok(migration.includes(token),token);
  assert.doesNotMatch(migration,/^\s*(DROP|TRUNCATE|DELETE)\b/im);
});

test("customer voice studio API supports draft simulation publish and rollback",()=>{
  for(const token of [
    "/api/v1/customer/voice-studio",
    "customer.voice_service.create",
    "customer.voice_service.draft",
    "customer.voice_service.simulate",
    "customer.voice_service.publish",
    "customer.voice_service.rollback"
  ])assert.ok(server.includes(token),token);
  for(const token of ["customerVoiceStudio","createCustomerVoiceService","saveCustomerVoiceDraft","simulateCustomerVoiceService","publishCustomerVoiceService","rollbackCustomerVoiceService"])assert.ok(store.includes(token),token);
  for(const token of ["voiceStudio:function","createVoiceService:function","saveVoiceServiceDraft:function","simulateVoiceService:function","publishVoiceService:function","rollbackVoiceService:function"])assert.ok(clientApi.includes(token),token);
});

test("customer voice studio exceeds basic SVI configuration surface with safety controls",()=>{
  for(const token of [
    "Simulation avant publication",
    "Versions & retour arrière",
    "Horaires & jours fériés",
    "Liste noire / blanche",
    "Multi-langue",
    "Codes directs multi-chiffres",
    "Hybride code + menu",
    "Répartition pondérée",
    "Débordement",
    "Information enregistrement",
    "Anti-abus"
  ])assert.ok(clientUi.includes(token),token);
  assert.match(clientPortal,/client-voice-studio\.js/);
  assert.match(buildStatic,/client-voice-studio\.js/);
  assert.match(checkStatic,/client-voice-studio\.js/);
  assert.match(sizeCheck,/client-voice-studio\.js/);
});
