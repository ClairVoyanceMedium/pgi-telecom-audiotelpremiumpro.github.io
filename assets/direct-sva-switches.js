// Two admin switches of the future PGI direct SVA activity.
// The first is a persistent private preview; the second is locked until an
// independent regulatory, payment and technical release. No commercial side effect.
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
const css=".dss{padding:15px;border:1px solid rgba(148,171,193,.23);border-radius:12px;background:#0a1925;display:grid;gap:13px}.dss-head{display:flex;gap:12px;align-items:start;justify-content:space-between;flex-wrap:wrap}.dss h3{font-size:15px;margin:0}.dss p{margin:5px 0;color:#9cb0c2;font-size:11px;line-height:1.55}.dss-item{border:1px solid rgba(148,171,193,.19);padding:13px;border-radius:9px;display:flex;gap:14px;justify-content:space-between;align-items:center}.dss-item strong{display:block;font-size:12px}.dss-item small{display:block;color:#aec0ce;margin-top:4px;font-size:10px;max-width:620px;line-height:1.5}.dss-toggle{width:44px;min-width:44px;height:24px;accent-color:#8ad9c4;cursor:pointer}.dss-toggle:disabled{opacity:.42;cursor:not-allowed}.dss-alert{font-size:11px;color:#f3c49e;padding:8px 10px;border-radius:8px;background:rgba(161,106,45,.12)}.dss-badge{font-size:10px;color:#b4c6d6}.dss-error{color:#f6b4b4;font-size:11px}.dss-details{font-size:10px;color:#8ca1b3;line-height:1.6}.dss-details summary{cursor:pointer}.dss-details ul{padding-left:18px;margin:7px 0}@media(max-width:700px){.dss-item{align-items:start;gap:10px}.dss-head{gap:5px}}";
function style(){
 if(document.getElementById("pgi-direct-sva-switches-css"))return;
 const node=document.createElement("style");node.id="pgi-direct-sva-switches-css";
 node.textContent=css;document.head.appendChild(node);
}
function base(){
 const s=String(window.PGI_CONFIG?.apiBaseUrl||"").replace(/\/$/,"");
 if(!s)throw Error("API_NOT_CONFIGURED");
 return s;
}
function csrf(){
 const token="__Host-pgi_csrf=";
 for(const part of String(document.cookie||"").split(";")){
  const p=part.trim();
  if(p.startsWith(token))return decodeURIComponent(p.slice(token.length));
 }
 return "";
}
async function request(path,method="GET",body=null){
 const headers={Accept:"application/json"};
 if(method!=="GET"){headers["Content-Type"]="application/json";headers["X-CSRF-Token"]=csrf();}
 const response=await fetch(base()+path,{method,credentials:"include",cache:"no-store",headers,
  body:body===null?undefined:JSON.stringify(body)});
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw Object.assign(Error(data?.error?.code||"HTTP_"+response.status),{status:response.status});
 return data;
}
const BLOCKERS=Object.freeze([
 "Attribution des ressources Arcep et cadre AF2M/APNF",
 "Contrat de collecte et interconnexion valide",
 "Dispositif de paiement conforme pour les fonds de tiers",
 "Comptabilité légale commune, TVA et rapprochements validés",
 "Essais techniques, sécurité et recette indépendante",
 "Autorisation de lancement spécifique de PGI Telecom"
]);

export async function mountDirectSvaSwitches(host,{onPreviewChange}={}){
 if(!host)return;
 style();
 host.hidden=true;
 let current;
 try{current=await request("/platform/direct-sva-switches");}
 catch(error){
  if(error.status===401||error.status===403){host.replaceChildren();return;}
  host.hidden=false;
  host.innerHTML='<section class="dss"><h3>Commandes de distribution SVA directe</h3>'+
   '<p class="dss-error">Commandes indisponibles : '+esc(error.message)+'. Le distributeur reste désactivé. La migration dédiée doit être validée avant cette commande.</p></section>';
  return;
 }
 if(!host.isConnected)return;
 host.hidden=false;
 if(typeof onPreviewChange==="function")onPreviewChange(current.interface_preview_enabled===true);
 // A parent rerender may detach this instance on the first GET.
 if(!host.isConnected)return;
 host.innerHTML='<section class="dss" aria-label="Interrupteurs de la distribution SVA directe">'+
  '<div class="dss-head"><div><h3>Commandes de distribution SVA directe</h3>'+
  '<p>Une société, deux activités. Aucune commande ci-dessous ne modifie Audiotel Premium Pro.</p></div>'+
  '<span class="dss-badge">Réservé à l’administrateur</span></div>'+
  '<label class="dss-item"><span><strong>Interface distributeur</strong>'+
  '<small>Afficher ou masquer le cockpit de préparation. Sans numéros actifs, sans espace client public et sans versements.</small></span>'+
  '<input class="dss-toggle" role="switch" aria-label="Interface distributeur" data-dss-preview type="checkbox" '+
  (current.interface_preview_enabled?'checked':'')+'></label>'+
  '<label class="dss-item"><span><strong>Exploitation commerciale SVA directe</strong>'+
  '<small>Autoriser l’activité réelle seulement après validation des droits, contrats, tests et flux financiers. Impossible à activer en préparation.</small></span>'+
  '<input class="dss-toggle" role="switch" aria-label="Exploitation commerciale SVA directe" data-dss-commercial type="checkbox" disabled aria-disabled="true"></label>'+
  '<div class="dss-alert">Exploitation commerciale : désactivée et verrouillée. Le premier interrupteur ne l’active pas.</div>'+
  '<details class="dss-details"><summary>Conditions encore bloquantes</summary><ul>'+
  BLOCKERS.map(s=>'<li>'+esc(s)+'</li>').join("")+'</ul></details>'+
  '<div role="status" aria-live="polite" class="dss-badge" data-dss-result></div></section>';
 const preview=host.querySelector("[data-dss-preview]");
 preview?.addEventListener("change",async()=>{
  const requested=preview.checked,expected=current.interface_preview_enabled===true;
  preview.disabled=true;
  const feedback=host.querySelector("[data-dss-result]");
  feedback.textContent="Enregistrement sécurisé...";
  try{
   const result=await request("/platform/direct-sva-switches/interface","POST",{
    enabled:requested,expected_enabled:expected,
    evidence_reference:"ADMIN-UI-"+crypto.randomUUID()
   });
   if(result.commercial_operation_enabled!==false||result.side_effects_executed!==false)
    throw Error("DIRECT_SVA_SWITCH_RESPONSE_INVALID");
   current={...current,interface_preview_enabled:result.interface_preview_enabled};
   feedback.textContent=result.interface_preview_enabled
    ?"Aperçu administrateur activé. Exploitation commerciale toujours désactivée."
    :"Aperçu administrateur désactivé.";
   if(typeof onPreviewChange==="function")onPreviewChange(result.interface_preview_enabled===true);
  }catch(error){
   preview.checked=expected;
   feedback.textContent="Modification refusée : "+String(error.message||"erreur");
  }finally{preview.disabled=false;}
 });
}
