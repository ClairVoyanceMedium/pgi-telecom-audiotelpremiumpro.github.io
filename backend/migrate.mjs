import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import postgres from "postgres";

const databaseUrl=process.env.PGI_DATABASE_URL||"";
if(!databaseUrl)throw new Error("PGI_DATABASE_URL is required for migrations");

const ssl=(process.env.PGI_DATABASE_SSL||"disable").toLowerCase()==="require"?"require":false;
const sql=postgres(databaseUrl,{
  max:1,
  idle_timeout:10,
  connect_timeout:10,
  prepare:false,
  ssl,
  transform:{undefined:null}
});

const migrationsDir=fileURLToPath(new URL("../database/migrations/",import.meta.url));

try{
  await sql.unsafe(
    "CREATE TABLE IF NOT EXISTS schema_migrations ("+
    "version text PRIMARY KEY,"+
    "checksum char(64) NOT NULL,"+
    "applied_at timestamptz NOT NULL DEFAULT now())"
  );

  const files=fs.readdirSync(migrationsDir)
    .filter(name=>/^\d{3}_[A-Za-z0-9_.-]+\.sql$/.test(name))
    .sort();

  if(!files.length)throw new Error("No migration files found");

  const appliedCount=await sql.unsafe("SELECT count(*)::int AS count FROM schema_migrations");
  if(Number(appliedCount[0]?.count||0)===0){
    const bootstrapTable=await sql.unsafe("SELECT to_regclass('public.schema_bootstrap_migrations') AS name");
    if(bootstrapTable[0]?.name){
      const bootstrapRows=await sql.unsafe("SELECT version,checksum FROM schema_bootstrap_migrations ORDER BY version");
      const fileChecksums=new Map(files.map(name=>{
        const content=fs.readFileSync(path.join(migrationsDir,name),"utf8");
        return [name.slice(0,-4),createHash("sha256").update(content).digest("hex")];
      }));
      for(const row of bootstrapRows){
        const actual=fileChecksums.get(row.version);
        if(!actual)throw new Error("Bootstrap migration missing from image: "+row.version);
        if(actual!==row.checksum)throw new Error("Bootstrap migration checksum mismatch: "+row.version);
      }
      if(bootstrapRows.length){
        await sql.begin(async tx=>{
          for(const row of bootstrapRows){
            await tx.unsafe(
              "INSERT INTO schema_migrations(version,checksum) VALUES($1,$2) ON CONFLICT(version) DO NOTHING",
              [row.version,row.checksum]
            );
          }
        });
        console.log("BOOTSTRAP",bootstrapRows.length,"migration(s) already present in fresh schema");
      }
    }
  }

  for(const name of files){
    const file=path.join(migrationsDir,name);
    const content=fs.readFileSync(file,"utf8");
    const version=name.slice(0,-4);
    const checksum=createHash("sha256").update(content).digest("hex");

    const existing=await sql.unsafe(
      "SELECT checksum FROM schema_migrations WHERE version=$1",
      [version]
    );

    if(existing.length){
      if(existing[0].checksum!==checksum)throw new Error("Migration checksum mismatch: "+version);
      console.log("SKIP",version);
      continue;
    }

    await sql.begin(async tx=>{
      await tx.unsafe("SET LOCAL lock_timeout = '5s'");
      await tx.unsafe("SET LOCAL statement_timeout = '60s'");
      await tx.unsafe("SET LOCAL idle_in_transaction_session_timeout = '60s'");
      await tx.unsafe(content);
      await tx.unsafe(
        "INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)",
        [version,checksum]
      );
    });

    const verified=await sql.unsafe(
      "SELECT checksum FROM schema_migrations WHERE version=$1",
      [version]
    );
    if(verified[0]?.checksum!==checksum)throw new Error("Migration verification failed: "+version);
    console.log("APPLY",version);
  }

  console.log("Database migrations: OK");
}finally{
  await sql.end({timeout:5});
}
