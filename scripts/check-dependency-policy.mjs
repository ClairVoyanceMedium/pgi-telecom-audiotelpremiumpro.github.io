import fs from "node:fs";

const p=JSON.parse(fs.readFileSync("config/dependency-policy.json","utf8"));
const failures=[];

if(p.schemaVersion!==1)failures.push("unsupported schemaVersion");
if(p.policy!=="strict-minimum-external-dependencies")failures.push("invalid dependency policy");

const requiredCore=[
  "dashboard","api","database","sip_proxy","media_server","ivr",
  "expert_routing","internal_cdr","financial_engine","reconciliation","monitoring","audit"
];
for(const item of requiredCore){
  if(!p.coreOwnedByPGI.includes(item))failures.push("PGI core ownership missing: "+item);
}

const required=p.externalRequired||[];
if(required.length!==1)failures.push("architecture must expose exactly one required external role");
else if(required[0].role!=="sva_host_operator")failures.push("required external role must be sva_host_operator");
else if(required[0].replaceable!==true)failures.push("SVA host operator must be replaceable");

for(const forbidden of p.forbiddenHardDependencies||[]){
  if(!String(forbidden).startsWith("carrier_specific_"))failures.push("unexpected forbidden dependency declaration");
}

if(failures.length){
  failures.forEach(x=>console.error("FAIL:",x));
  process.exit(1);
}
console.log("Dependency sovereignty policy: OK");
