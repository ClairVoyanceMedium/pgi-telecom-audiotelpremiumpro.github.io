import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";

const dir="database/migrations";
const failures=[];
const files=fs.readdirSync(dir)
  .filter(name=>name.endsWith(".sql"))
  .sort();

if(!files.length)failures.push("no migration files found");

const seen=new Set();
let previous=0;
for(const file of files){
  const match=file.match(/^(\d{3})_[A-Za-z0-9_.-]+\.sql$/);
  if(!match){
    failures.push("invalid migration filename: "+file);
    continue;
  }
  const number=Number(match[1]);
  if(seen.has(number))failures.push("duplicate migration number: "+match[1]);
  seen.add(number);
  if(number<=previous)failures.push("migration order is not strictly increasing: "+file);
  previous=number;

  const raw=fs.readFileSync(path.join(dir,file),"utf8");
  const sql=raw
    .replace(/\/\*[\s\S]*?\*\//g," ")
    .replace(/--.*$/gm," ")
    .replace(/\s+/g," ")
    .trim()
    .toUpperCase();

  const forbidden=[
    [/\bDROP\s+(TABLE|SCHEMA|DATABASE|INDEX|VIEW|FUNCTION|TRIGGER|TYPE|COLUMN)\b/,"DROP"],
    [/\bTRUNCATE\b/,"TRUNCATE"],
    [/\bALTER\s+TABLE\b[\s\S]*\bDROP\b/,"ALTER TABLE DROP"],
    [/\bALTER\s+TABLE\b[\s\S]*\bRENAME\b/,"ALTER TABLE RENAME"],
    [/\bALTER\s+TABLE\b[\s\S]*\bALTER\s+COLUMN\b/,"ALTER COLUMN"],
    [/\bALTER\s+TYPE\b/,"ALTER TYPE"],
    [/\bDELETE\s+FROM\b/,"DELETE FROM"],
    [/\bCREATE\s+OR\s+REPLACE\s+(VIEW|FUNCTION|PROCEDURE|TRIGGER)\b/,"CREATE OR REPLACE behavioral object"]
  ];

  for(const [pattern,label] of forbidden){
    if(pattern.test(sql))failures.push(file+" contains destructive operation: "+label);
  }
}


const bootstrapSchema=fs.readFileSync("database/schema.sql","utf8");
const bootstrapRows=[...bootstrapSchema.matchAll(/\('([^']+)','([0-9a-f]{64})'\)/g)]
  .map(match=>({version:match[1],checksum:match[2]}))
  .filter(row=>/^\d{3}_[A-Za-z0-9_.-]+$/.test(row.version));
if(!bootstrapRows.length)failures.push("bootstrap migration manifest is empty");
for(const row of bootstrapRows){
  const migrationFile=path.join(dir,row.version+".sql");
  if(!fs.existsSync(migrationFile)){failures.push("bootstrap migration missing: "+row.version);continue;}
  const actual=createHash("sha256").update(fs.readFileSync(migrationFile,"utf8")).digest("hex");
  if(actual!==row.checksum)failures.push("bootstrap checksum mismatch: "+row.version);
}

if(failures.length){
  failures.forEach(x=>console.error("FAIL:",x));
  process.exit(1);
}
console.log("Migration safety: OK ("+files.length+" expand-only migration(s))");
