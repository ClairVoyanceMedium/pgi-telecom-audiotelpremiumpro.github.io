const base=String(process.env.PGI_PRODUCTION_URL||"https://audiotel-premium-pro.com").replace(/\/$/,"");
const checks=[];
async function fetchCheck(name,path,expected,tokens=[],jsonCheck=null){
  const started=performance.now();let response,text="",body=null,error=null;
  try{
    response=await fetch(base+path,{redirect:"follow",cache:"no-store",headers:{"User-Agent":"PGI-Production-Smoke/1","Accept":"*/*"},signal:AbortSignal.timeout(12000)});
    text=await response.text();
    if((response.headers.get("content-type")||"").includes("application/json"))try{body=JSON.parse(text);}catch{}
    const tokenOk=tokens.every(t=>text.includes(t));
    const jsonOk=jsonCheck?jsonCheck(body):true;
    const pass=response.status===expected&&tokenOk&&jsonOk;
    checks.push({name,path,pass,status:response.status,latency_ms:Math.round(performance.now()-started),missing:tokens.filter(t=>!text.includes(t))});
  }catch(e){error=e?.name||"FETCH_FAILED";checks.push({name,path,pass:false,status:null,latency_ms:Math.round(performance.now()-started),error});}
}
await fetchCheck("site.home","/",200,["Demander l’ouverture","/demande-ouverture/","client.html"]);
await fetchCheck("site.application","/demande-ouverture/",200,["id=\"order-form\""]);
await fetchCheck("site.application.logic","/site/site.js",200,["client.html?register=1","sessionStorage"]);
await fetchCheck("site.client","/client.html",200,["id=\"customer-login-form\"","id=\"client-billing-start\"","id=\"portability-open\"","id=\"service-incident-open\""]);
await fetchCheck("site.cockpit","/cockpit.html",200,["id=\"auth-form\"","ACCÈS PRODUCTION"]);
await fetchCheck("site.terms","/conditions-abonnement/",200,["3,00 € TTC par mois"]);
await fetchCheck("site.privacy","/confidentialite/",200,["CONFIDENTIALITÉ","RGPD"]);
await fetchCheck("site.legal","/mentions-legales/",200,["Mentions légales"]);
await fetchCheck("site.terms-of-use","/conditions-utilisation/",200,["Conditions générales d’utilisation"]);
await fetchCheck("site.cookies","/cookies-traceurs/",200,["Cookies et traceurs"]);
await fetchCheck("site.cancellation","/resilier-contrat/",200,["Résilier votre contrat","client.html?action=cancel-subscription"]);
await fetchCheck("site.withdrawal","/retractation/",200,["14 jours"]);
await fetchCheck("api.health","/api/v1/health",200,[],b=>b&&b.status==="ok"&&b.mode==="production");
await fetchCheck("auth.boundary","/api/v1/customer/auth/me",401,["AUTH_REQUIRED"]);
await fetchCheck("billing.boundary","/api/v1/customer/billing/status",401,["AUTH_REQUIRED"]);
const home=await fetch(base+"/",{cache:"no-store",signal:AbortSignal.timeout(12000)});
const headers={
  hsts:home.headers.get("strict-transport-security")||"",
  nosniff:home.headers.get("x-content-type-options")||"",
  frame:home.headers.get("x-frame-options")||""
};
checks.push({name:"security.headers",path:"/",pass:/max-age=/.test(headers.hsts)&&headers.nosniff==="nosniff"&&headers.frame==="DENY",status:home.status,headers});
const failed=checks.filter(x=>!x.pass);
console.log(JSON.stringify({target:base,checked_at:new Date().toISOString(),status:failed.length?"failed":"passed",checks},null,2));
if(failed.length)process.exitCode=1;
