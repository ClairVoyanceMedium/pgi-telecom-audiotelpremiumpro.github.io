import test from "node:test";
import assert from "node:assert/strict";
import {createEmailVerificationChallenge,verificationTokenHash,emailVerificationCodeHash} from "../backend/src/resend-email.mjs";
const config={emailVerificationPepper:"p".repeat(48),emailVerificationTtlMinutes:10,emailVerificationResendSeconds:60};
test("email verification challenge stores hashes, not the OTP",()=>{
  const now=Date.parse("2026-09-24T08:00:00.000Z"),challenge=createEmailVerificationChallenge(config,null,now);
  assert.match(challenge.code,/^[0-9]{6}$/);assert.ok(challenge.token.length>=32);
  assert.match(challenge.record.token_hash,/^[a-f0-9]{64}$/);assert.match(challenge.record.code_hash,/^[a-f0-9]{64}$/);
  assert.equal(challenge.record.token_hash,verificationTokenHash(challenge.token));
  assert.equal(challenge.record.code_hash,emailVerificationCodeHash(config,challenge.token,challenge.code));
  assert.equal(JSON.stringify(challenge.record).includes(challenge.code),false);
  assert.equal(challenge.record.expires_at,"2026-09-24T08:10:00.000Z");assert.equal(challenge.record.resend_after,"2026-09-24T08:01:00.000Z");
});
test("resend retains the opaque verification token",()=>{
  const token="fixed-verification-token-"+("x".repeat(24)),a=createEmailVerificationChallenge(config,token,0),b=createEmailVerificationChallenge(config,token,1000);
  assert.equal(a.token,b.token);assert.equal(a.record.token_hash,b.record.token_hash);assert.match(b.record.code_hash,/^[a-f0-9]{64}$/);
});
