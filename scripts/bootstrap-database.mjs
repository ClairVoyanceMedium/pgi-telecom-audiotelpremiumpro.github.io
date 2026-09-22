import fs from "node:fs";
import path from "node:path";
const {default:postgres}=await import("postgres");
const url=process.env.PGI_DATABASE_URL||process.env.DATABASE_URL||"";
if(!url)throw new Error("PGI_DATABASE_URL or DATABASE_URL is required");

const ssl=(process.env.PGI_DATABASE_SSL||"").toLowerCase()==="require"?"require":false;
const sql=postgres(url,{max:1,connect_timeout:15,idle_timeout:10,prepare:false,ssl});

try{
  const rows=await sql.unsafe("select to_regclass('public.calls')::text as calls,to_regclass('public.schema_migrations')::text as migrations");
  const state=rows[0]||{};
  if(!state.calls){
    if(state.migrations)throw new Error("Database has migration metadata but baseline schema is missing; refusing destructive bootstrap");
    const schema=fs.readFileSync(path.resolve("database/schema.sql"),"utf8");
    const views=fs.readFileSync(path.resolve("database/views.sql"),"utf8");
    await sql.begin(async tx=>{
      await tx.unsafe(schema);
      await tx.unsafe(views);
    });
    process.stdout.write(JSON.stringify({level:"info",event:"database_bootstrap",status:"created"})+"\n");
  }else{
    process.stdout.write(JSON.stringify({level:"info",event:"database_bootstrap",status:"existing"})+"\n");
  }
}finally{
  await sql.end({timeout:5});
}
