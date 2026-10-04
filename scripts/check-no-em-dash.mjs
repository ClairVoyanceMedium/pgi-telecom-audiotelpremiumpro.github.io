import fs from "node:fs";
import path from "node:path";

const forbidden=String.fromCodePoint(0x2014);
const roots=["assets","backend","database","docs","infra","scripts","site","tests",".github"];
const files=["index.html","client.html","package.json","README.md","vercel.json","sitemap.xml","robots.txt","llms.txt","llms-full.txt"].filter(fs.existsSync);
const allowed=/\.(?:js|mjs|cjs|html|css|md|txt|json|yml|yaml|sql|sh|xml|webmanifest)$/i;
function walk(dir){
  if(!fs.existsSync(dir))return;
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())walk(full);
    else if(allowed.test(entry.name))files.push(full);
  }
}
for(const root of roots)walk(root);
const failures=[];
for(const file of [...new Set(files)].sort()){
  const content=fs.readFileSync(file,"utf8");
  const count=content.split(forbidden).length-1;
  if(count)failures.push(file+" : "+count);
}
if(failures.length){
  console.error("Tirets cadratins interdits détectés :");
  failures.forEach(x=>console.error(x));
  process.exit(1);
}
console.log("Ponctuation : aucun tiret cadratin détecté.");
