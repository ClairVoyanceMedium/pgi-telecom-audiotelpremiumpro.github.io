import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const skipDirs=new Set([".git","node_modules",".ci-recovery",".vercel","coverage"]);
const textExtensions=new Set([".js",".mjs",".cjs",".ts",".tsx",".jsx",".html",".css",".md",".json",".sql",".yml",".yaml",".txt",".xml",".svg",".webmanifest",".sh",".env"]);
const blocked=[
  {label:"U+2014 em dash",needle:"\u2014"},
  {label:"HTML mdash entity",needle:"&"+"mdash;"},
  {label:"HTML decimal em dash entity",needle:"&#"+"8212;"},
  {label:"HTML hexadecimal em dash entity",needle:"&#"+"x2014;"}
];

const failures=[];
function walk(dir){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    if(entry.isDirectory()){
      if(skipDirs.has(entry.name))continue;
      walk(path.join(dir,entry.name));
      continue;
    }
    if(!entry.isFile())continue;
    const full=path.join(dir,entry.name),ext=path.extname(entry.name).toLowerCase();
    if(!textExtensions.has(ext)&&!entry.name.startsWith(".env"))continue;
    let text;try{text=fs.readFileSync(full,"utf8");}catch{continue;}
    for(const rule of blocked){
      let offset=0;
      while((offset=text.indexOf(rule.needle,offset))>=0){
        const line=text.slice(0,offset).split("\n").length;
        failures.push({file:path.relative(root,full),line,label:rule.label});
        offset+=rule.needle.length;
      }
    }
  }
}
walk(root);
if(failures.length){
  for(const x of failures)process.stderr.write(x.file+":"+x.line+" "+x.label+"\n");
  process.stderr.write("Em dash policy failed with "+failures.length+" occurrence(s).\n");
  process.exit(1);
}
process.stdout.write("Em dash policy OK.\n");
