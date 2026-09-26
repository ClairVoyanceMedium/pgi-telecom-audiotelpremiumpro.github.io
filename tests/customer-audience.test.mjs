import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html=fs.readFileSync("client.html","utf8");
const portal=fs.readFileSync("assets/client-portal.js","utf8");
const audience=fs.readFileSync("assets/client-audience.js","utf8");
const premium=fs.readFileSync("assets/client-premium-plus.js","utf8");
const postgres=fs.readFileSync("backend/src/store-postgres.mjs","utf8");
const memory=fs.readFileSync("backend/src/store-memory.mjs","utf8");

test("registration explicitly supports individual and business customers",()=>{
  assert.match(html,/id="register-account-type"/);
  assert.match(html,/value="individual">Particulier \/ projet/);
  assert.match(html,/value="business">Professionnel \/ entreprise/);
  assert.match(html,/id="register-business-company-wrap" hidden/);
  assert.match(html,/id="register-business-number-wrap" hidden/);
  assert.match(html,/SIRET<\/span> <span class="cp-optional">\(facultatif à l’inscription\)/);
  assert.match(portal,/account_type:\$\("register-account-type"\)\.value/);
  assert.match(portal,/client-audience\.js/);
  assert.match(audience,/type==="individual"/);
  assert.match(audience,/type==="business"/);
});

test("server persists a stable audience profile without breaking legacy registration",()=>{
  assert.match(postgres,/accountTypeInput\|\|\(\(companyName\|\|registrationRaw\)\?"business":"individual"\)/);
  assert.match(postgres,/accountType==="individual"\?"individual":"company"/);
  assert.match(postgres,/AS customer_type/);
  assert.match(postgres,/account_type:accountType/);
  assert.match(memory,/accountTypeInput\|\|\(\(company\|\|registration\)\?"business":"individual"\)/);
});

test("individual customers receive a simplified access experience",()=>{
  assert.match(premium,/customer_type\|\|"business"/);
  assert.match(premium,/type==="individual"/);
  assert.match(premium,/Compte est identifié comme particulier|compte est identifié comme particulier/i);
  assert.match(premium,/label:"Accès"/);
});
