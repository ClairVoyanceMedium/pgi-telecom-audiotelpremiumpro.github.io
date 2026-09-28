import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("every identified staff cockpit action has an implementation reference",()=>{
  const html=fs.readFileSync("index.html","utf8");
  const actionIds=[...html.matchAll(/<(?:button|a)[^>]*\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.ok(actionIds.length>=10,"expected a substantial staff action surface");

  const source=fs.readdirSync("assets")
    .filter(name=>name.endsWith(".js"))
    .map(name=>fs.readFileSync("assets/"+name,"utf8"))
    .join("\n");

  const missing=actionIds.filter(id=>!source.includes(id));
  assert.deepEqual(missing,[],`staff actions without a matching implementation reference: ${missing.join(", ")}`);
});

test("staff cockpit contains no javascript pseudo-links or empty href actions",()=>{
  const html=fs.readFileSync("index.html","utf8");
  assert.doesNotMatch(html,/href\s*=\s*["']javascript:/i);
  assert.doesNotMatch(html,/href\s*=\s*["']\s*["']/i);
});
