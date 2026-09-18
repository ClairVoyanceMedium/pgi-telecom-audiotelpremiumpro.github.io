import fs from "node:fs";
import path from "node:path";

const dir=path.resolve("config/carriers");
const failures=[];
for(const name of fs.readdirSync(dir)){
  if(!name.endsWith(".json"))continue;
  const file=path.join(dir,name);
  const data=JSON.parse(fs.readFileSync(file,"utf8"));
  const required=["schemaVersion","adapterKey","carrier","capabilities","sip","cdr","settlement"];
  for(const key of required){
    if(!(key in data))failures.push(`${name}: missing ${key}`);
  }
  if(data.schemaVersion!==1)failures.push(`${name}: unsupported schemaVersion`);
  if(!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(data.adapterKey||""))failures.push(`${name}: invalid adapterKey`);
  if(!data.carrier||!data.carrier.code||!data.carrier.displayName)failures.push(`${name}: carrier identity incomplete`);
  if(data.sip){
    if(!["udp","tcp","tls"].includes(data.sip.transport))failures.push(`${name}: invalid SIP transport`);
    if(!Array.isArray(data.sip.codecs)||!data.sip.codecs.length)failures.push(`${name}: codecs required`);
    if(data.sip.secretRef && /(password|token|secret)=/i.test(data.sip.secretRef))failures.push(`${name}: secretRef looks like a secret value`);
  }
  if(data.cdr&&!data.cdr.fields)failures.push(`${name}: CDR field mapping missing`);
  if(data.settlement&&!data.settlement.fields)failures.push(`${name}: settlement field mapping missing`);
}

if(failures.length){
  failures.forEach(x=>console.error("FAIL:",x));
  process.exit(1);
}
console.log("Carrier profiles: OK");
