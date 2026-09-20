import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeFrenchSvaRio,
  rioFingerprint,
  encryptPortabilityCredential,
  decryptPortabilityCredential
} from "../backend/src/portability-identity.mjs";

const secret="p".repeat(48);

test("French SVA RIO checksum is verified against the ported number",()=>{
  const rio="01AABC1235CI";
  assert.equal(normalizeFrenchSvaRio(rio,"+33890123456"),rio);
  assert.throws(()=>normalizeFrenchSvaRio("01AABC1235CJ","+33890123456"),e=>e.code==="INVALID_PORTABILITY_RIO");
  assert.throws(()=>normalizeFrenchSvaRio("01EABC1235CI","+33890123456"),e=>e.code==="INVALID_PORTABILITY_RIO");
});

test("RIO is encrypted at rest and can be recovered only with the portability secret",()=>{
  const rio="01AABC1235CI";
  const encrypted=encryptPortabilityCredential(rio,secret);
  assert.ok(Buffer.isBuffer(encrypted));
  assert.equal(encrypted.includes(Buffer.from(rio)),false);
  assert.equal(decryptPortabilityCredential(encrypted,secret),rio);
  assert.match(rioFingerprint(rio,"+33890123456",secret),/^[0-9a-f]{64}$/);
});
