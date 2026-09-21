import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("client command center remains local-first and explicit",()=>{
  const ui=fs.readFileSync("assets/client-experience-command-center.js","utf8");
  const server=fs.readFileSync("backend/server.mjs","utf8");
  const migration=fs.readFileSync("database/migrations/053_customer_experience_preferences.sql","utf8");
  assert.match(ui,/SANTÉ DU SERVICE/);
  assert.match(ui,/Projection non contractuelle/);
  assert.match(ui,/Aucun SMS, e-mail ou push externe n’est branché/);
  assert.match(ui,/statut opérateur externe ne sera affiché qu’après branchement effectif/);
  assert.doesNotMatch(ui,/https?:\/\//i);
  assert.match(server,/customer\/experience\/preferences/);
  assert.match(migration,/customer_experience_preferences/);
});
