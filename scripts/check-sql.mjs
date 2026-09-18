import fs from "node:fs";

const schema=fs.readFileSync("database/schema.sql","utf8");
const smoke=fs.readFileSync("database/smoke.sql","utf8");
const failures=[];

const functionCount=(schema.match(/CREATE OR REPLACE FUNCTION/g)||[]).length;
const dollarBodies=(schema.match(/LANGUAGE plpgsql\s+AS \$\$/g)||[]).length;

if(functionCount!==dollarBodies){
  failures.push(`PL/pgSQL functions=${functionCount}, valid dollar bodies=${dollarBodies}`);
}
if(/LANGUAGE plpgsql\s+AS \$\s*\n/.test(schema)){
  failures.push("single-dollar PL/pgSQL delimiter detected");
}
if(!/DO \$\$/.test(smoke)||!/END \$\$;/.test(smoke)){
  failures.push("smoke.sql DO block is not dollar quoted correctly");
}

if(failures.length){
  failures.forEach(x=>console.error("FAIL:",x));
  process.exit(1);
}
console.log("SQL structural checks: OK");
