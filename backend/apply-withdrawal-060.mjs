import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import postgres from "postgres";

const version="060_customer_withdrawal_requests";
const migrationPath=path.resolve("database/migrations/"+version+".sql");
const databaseUrl=process.env.PGI_DATABASE_URL||process.env.DATABASE_URL||"";
if(!databaseUrl)throw new Error("PGI_DATABASE_URL or DATABASE_URL is required");

const ssl=(process.env.PGI_DATABASE_SSL||"require").toLowerCase()==="require"?"require":false;
const raw=fs.readFileSync(migrationPath,"utf8");
const checksum=createHash("sha256").update(raw).digest("hex");
const body=raw.replace(/^\s*BEGIN;\s*/i,"").replace(/\s*COMMIT;\s*$/i,"");

const sql=postgres(databaseUrl,{
  max:1,
  idle_timeout:10,
  connect_timeout:15,
  prepare:false,
  ssl,
  transform:{undefined:null}
});

try{
  const metadata=await sql.unsafe("SELECT to_regclass('public.schema_migrations')::text AS name");
  if(!metadata[0]?.name)throw new Error("schema_migrations is missing; refusing one-off migration");

  let action="noop";
  await sql.begin(async tx=>{
    await tx.unsafe("SET LOCAL lock_timeout = '5s'");
    await tx.unsafe("SET LOCAL statement_timeout = '60s'");
    await tx.unsafe("SET LOCAL idle_in_transaction_session_timeout = '60s'");
    await tx.unsafe("SELECT pg_advisory_xact_lock(hashtext($1))",[version]);

    const existing=await tx.unsafe("SELECT checksum FROM schema_migrations WHERE version=$1",[version]);
    const table=await tx.unsafe("SELECT to_regclass('public.customer_withdrawal_requests')::text AS name");

    if(existing.length){
      if(existing[0].checksum!==checksum)throw new Error("Migration checksum mismatch: "+version);
      if(!table[0]?.name)throw new Error("Migration metadata exists but withdrawal table is missing");
      action="already_applied";
      return;
    }

    if(table[0]?.name)throw new Error("Withdrawal table exists without migration metadata; refusing repair");
    await tx.unsafe(body);
    await tx.unsafe("INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)",[version,checksum]);
    action="applied";
  });

  const verified=await sql.unsafe(
    "SELECT to_regclass('public.customer_withdrawal_requests') IS NOT NULL AS table_ready,"+
    " EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1 AND checksum=$2) AS migration_ready",
    [version,checksum]
  );
  if(verified[0]?.table_ready!==true||verified[0]?.migration_ready!==true)throw new Error("Migration verification failed: "+version);

  process.stdout.write(JSON.stringify({level:"info",event:"one_off_migration",version,action,status:"verified"})+"\n");
}finally{
  await sql.end({timeout:5});
}
