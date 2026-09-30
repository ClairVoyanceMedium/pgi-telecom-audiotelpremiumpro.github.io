import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("every identified customer portal action is wired to client-side code",()=>{
  const html=fs.readFileSync("client.html","utf8");
  const actionIds=[...html.matchAll(/<(?:button|a)[^>]*\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.ok(actionIds.length>=20,"expected a substantial customer action surface");

  const clientFiles=fs.readdirSync("assets")
    .filter(name=>/^client.*\.js$/.test(name))
    .map(name=>path.join("assets",name));
  const source=clientFiles.map(file=>fs.readFileSync(file,"utf8")).join("\n");

  const missing=actionIds.filter(id=>!source.includes(id));
  assert.deepEqual(missing,[],`customer actions without a matching implementation reference: ${missing.join(", ")}`);
});

test("customer portal does not expose placeholder javascript or empty action links",()=>{
  const html=fs.readFileSync("client.html","utf8");
  assert.doesNotMatch(html,/href\s*=\s*["']javascript:/i);
  assert.doesNotMatch(html,/href\s*=\s*["']\s*["']/i);
});


test("customer logo returns home only while disconnected",()=>{
  const html=fs.readFileSync("client.html","utf8");
  const auth=html.slice(html.indexOf('id="customer-auth"'),html.indexOf('id="customer-app"'));
  const app=html.slice(html.indexOf('id="customer-app"'));
  assert.match(auth,/<a class="cp-home-link" href="\/" aria-label="Retour à l’accueil Audiotel Premium Pro">/);
  assert.match(app,/<span class="cp-home-link cp-home-link-static"><img class="cp-logo-full cp-logo-header"/);
  assert.doesNotMatch(app,/<a class="cp-home-link"[^>]*href="\/"/);
});
