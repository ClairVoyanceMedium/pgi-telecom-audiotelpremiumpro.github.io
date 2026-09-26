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
