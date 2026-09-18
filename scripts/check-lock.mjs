import fs from "node:fs";

const pkg=JSON.parse(fs.readFileSync("package.json","utf8"));
const lock=JSON.parse(fs.readFileSync("package-lock.json","utf8"));
const failures=[];

if(lock.lockfileVersion!==3)failures.push("package-lock must be v3");
if(lock.packages?.[""]?.version!==pkg.version)failures.push("root version mismatch");
for(const [name,version] of Object.entries(pkg.dependencies||{})){
  const item=lock.packages?.["node_modules/"+name];
  if(!item)failures.push("missing locked dependency: "+name);
  else if(item.version!==version)failures.push("locked version mismatch for "+name);
  else if(!item.integrity)failures.push("integrity missing for "+name);
}
if(failures.length){
  failures.forEach(x=>console.error("FAIL:",x));
  process.exit(1);
}
console.log("Dependency lock: OK");
