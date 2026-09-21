import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {
  webauthnConfigured,issueWebAuthnState,verifyWebAuthnState,
  validateWebAuthnRegistration,verifyWebAuthnAssertion,publicPasskeyOptions
} from "../backend/src/webauthn.mjs";
import {loadConfig} from "../backend/src/config.mjs";

const cfg={sessionSecret:"s".repeat(64),webauthnRpId:"secure.example.test",webauthnOrigin:"https://secure.example.test"};
const b64=v=>Buffer.from(v).toString("base64url");
function clientData(type,challenge,origin=cfg.webauthnOrigin){
  return b64(JSON.stringify({type,challenge,origin,crossOrigin:false}));
}
function authData(counter=1,flags=0x05){
  const out=Buffer.alloc(37);
  createHash("sha256").update(cfg.webauthnRpId).digest().copy(out,0);
  out[32]=flags;
  out.writeUInt32BE(counter,33);
  return out;
}

test("WebAuthn reste fail-closed sans RP ID et origin HTTPS",()=>{
  assert.equal(webauthnConfigured({sessionSecret:"x".repeat(40),webauthnRpId:"",webauthnOrigin:""}),false);
  assert.equal(webauthnConfigured(cfg),true);
});

test("WebAuthn state lie challenge purpose subject et expiration",()=>{
  const issued=issueWebAuthnState(cfg,"assert","customer:abc");
  assert.match(issued.challenge,/^[A-Za-z0-9_-]+$/);
  const state=verifyWebAuthnState(cfg,issued.state,"assert","customer:abc");
  assert.equal(state.c,issued.challenge);
  assert.throws(()=>verifyWebAuthnState(cfg,issued.state,"register","customer:abc"),/WEBAUTHN_STATE_INVALID/);
  assert.throws(()=>verifyWebAuthnState(cfg,issued.state+"x","assert","customer:abc"),/WEBAUTHN_STATE_INVALID/);
});

test("registration exige origin RP ID présence et vérification utilisateur",()=>{
  const {publicKey}=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
  const spki=b64(publicKey.export({format:"der",type:"spki"}));
  const issued=issueWebAuthnState(cfg,"register","customer:abc");
  const state=verifyWebAuthnState(cfg,issued.state,"register","customer:abc");
  const valid=validateWebAuthnRegistration(cfg,{
    credential_id:b64(Buffer.from("credential-id-1234567890")),
    client_data_json:clientData("webauthn.create",issued.challenge),
    authenticator_data:b64(authData(0)),
    public_key_spki:spki,
    transports:["internal"],
    label:"Téléphone"
  },state);
  assert.equal(valid.label,"Téléphone");
  assert.equal(valid.sign_count,0);
  assert.throws(()=>validateWebAuthnRegistration(cfg,{
    credential_id:b64(Buffer.from("credential-id-1234567890")),
    client_data_json:clientData("webauthn.create",issued.challenge,"https://evil.example"),
    authenticator_data:b64(authData(0)),
    public_key_spki:spki
  },state),/WEBAUTHN_CLIENT_DATA_INVALID/);
  assert.throws(()=>validateWebAuthnRegistration(cfg,{
    credential_id:b64(Buffer.from("credential-id-1234567890")),
    client_data_json:clientData("webauthn.create",issued.challenge),
    authenticator_data:b64(authData(0,0x01)),
    public_key_spki:spki
  },state),/WEBAUTHN_USER_VERIFICATION_REQUIRED/);
});

test("assertion WebAuthn vérifie signature et compteur anti-rejeu",()=>{
  const {publicKey,privateKey}=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
  const credentialId=b64(Buffer.from("credential-id-assert-123456"));
  const issued=issueWebAuthnState(cfg,"assert","staff:42");
  const state=verifyWebAuthnState(cfg,issued.state,"assert","staff:42");
  const cd=Buffer.from(clientData("webauthn.get",issued.challenge),"base64url");
  const ad=authData(8);
  const signed=Buffer.concat([ad,createHash("sha256").update(cd).digest()]);
  const signature=sign("sha256",signed,privateKey).toString("base64url");
  const credential={id:7,credential_id:credentialId,public_key_spki:b64(publicKey.export({format:"der",type:"spki"})),sign_count:7,enabled:true};
  const result=verifyWebAuthnAssertion(cfg,{
    credential_id:credentialId,client_data_json:cd.toString("base64url"),
    authenticator_data:ad.toString("base64url"),signature
  },state,credential);
  assert.equal(result.verified,true);
  assert.equal(result.sign_count,8);
  assert.throws(()=>verifyWebAuthnAssertion(cfg,{
    credential_id:credentialId,client_data_json:cd.toString("base64url"),
    authenticator_data:ad.toString("base64url"),signature
  },state,{...credential,sign_count:8}),/WEBAUTHN_COUNTER_REPLAY/);
});

test("options imposent ES256 et user verification",()=>{
  const register=publicPasskeyOptions(cfg,"customer:abc","Client",[],"register");
  assert.equal(register.publicKey.pubKeyCredParams[0].alg,-7);
  assert.equal(register.publicKey.authenticatorSelection.userVerification,"required");
  const assertion=publicPasskeyOptions(cfg,"customer:abc","Client",[{credential_id:"abc123",enabled:true,transports:["internal"]}],"assert");
  assert.equal(assertion.publicKey.userVerification,"required");
  assert.equal(assertion.publicKey.allowCredentials[0].id,"abc123");
});


test("configuration WebAuthn refuse origin et RP ID incohérents",()=>{
  const ok=loadConfig({PGI_WEBAUTHN_RP_ID:"example.test",PGI_WEBAUTHN_ORIGIN:"https://secure.example.test"});
  assert.equal(ok.webauthnRpId,"example.test");
  assert.equal(ok.webauthnOrigin,"https://secure.example.test");
  assert.throws(()=>loadConfig({PGI_WEBAUTHN_RP_ID:"example.test",PGI_WEBAUTHN_ORIGIN:"http://example.test"}),/exact HTTPS origin/);
  assert.throws(()=>loadConfig({PGI_WEBAUTHN_RP_ID:"other.test",PGI_WEBAUTHN_ORIGIN:"https://secure.example.test"}),/match the origin host/);
  assert.throws(()=>loadConfig({PGI_WEBAUTHN_RP_ID:"example.test"}),/configured together/);
});
