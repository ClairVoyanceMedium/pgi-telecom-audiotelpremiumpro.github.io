import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Vercel ne consomme les builds Hobby que sur main",()=>{
  const config=JSON.parse(fs.readFileSync("vercel.json","utf8"));
  assert.equal(config.$schema,"https://openapi.vercel.sh/vercel.json");
  assert.equal(config.git?.deploymentEnabled?.["**"],false);
  assert.equal(config.git?.deploymentEnabled?.main,true);
});
