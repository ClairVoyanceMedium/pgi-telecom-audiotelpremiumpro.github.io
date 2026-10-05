const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=(minor,c="EUR")=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c}).format((Number(minor)||0)/100)}catch{return ((Number(minor)||0)/100).toFixed(2)+" "+c}};
let ctx=null,busy=false;
function apiBase(){return String(window.PGI_CONFIG?.apiBaseUrl||"").replace(/\/$/,"")}
function cookie(name){const p=encodeURIComponent(name)+"=";for(const x of String(document.cookie||"").split(";")){const v=x.trim();if(v.indexOf(p)===0)try{return decodeURIComponent(v.slice(p.length))}catch{return v.slice(p.length)}}return""}
async function req(path,method="GET",body=null){
 const h={"Accept":"application/json"};
 if(body!==null)h["Content-Type"]="application/json";
 if(method!=="GET"){const c=cookie("__Host-pgi_csrf");if(c)h["X-CSRF-Token"]=c;h["Idempotency-Key"]=window.PGIApi.newIdempotencyKey()}
 const r=await fetch(apiBase()+path,{method,credentials:"include",cache:"no-store",headers:h,body:body===null?undefined:JSON.stringify(body)}),p=await r.json().catch(()=>({}));
 if(!r.ok){const e=new Error(p?.error?.code||"HTTP_"+r.status);e.code=p?.error?.code||"HTTP_"+r.status;throw e}return p;
}
function feedback(m,t=""){ctx?.feedback?.(m,t)}
function tiers(s){return (s.tiers||[]).map(x=>'<div><span>'+esc(x.to?x.from+" à "+x.to:x.from+" et +")+'</span><strong>'+money(x.reward_minor,s.currency)+'</strong></div>').join("")}
function render(d){
 const r=ctx.root,s=d.summary||{},profiles=d.profiles||[];
 r.hidden=false;
 r.innerHTML='<div class="pa-head" style="padding:0 0 12px;border:0"><div><p>AMBASSADEURS</p><h2>Acquisition au résultat</h2></div><button class="pa-btn" data-amb-close>Fermer</button></div>'+
 '<div class="pa-state"><div><span>Programme</span><strong>'+(d.enabled?"ACTIF":"DÉSACTIVÉ")+'</strong></div><div><span>Ambassadeurs actifs</span><strong>'+esc(s.profiles_active||0)+'</strong></div><div><span>Clients qualifiés</span><strong>'+esc(s.referrals_qualified||0)+'</strong></div><div><span>À verser</span><strong>'+money(s.payable_minor||0)+'</strong></div></div>'+
 '<div class="pa-card"><h3>Barème fixe</h3><div class="pa-state">'+tiers(d)+'</div><p class="pa-note">Bonus fixes : 1er +5€, 5e +20€, 10e +50€, 25e +100€. Qualification après '+esc(d.qualification_paid_invoices)+' mensualités réellement payées. Seuil de versement : '+money(d.minimum_payout_minor,d.currency)+'. Les montants ne sont pas modifiables dans le cockpit.</p></div>'+
 '<label class="pa-field">Programme<select id="amb-admin-enabled"><option value="true" '+(d.enabled?"selected":"")+'>Actif</option><option value="false" '+(!d.enabled?"selected":"")+'>Désactivé</option></select></label>'+
 '<label class="pa-field">Emails de motivation<select id="amb-admin-emails"><option value="true" '+(d.motivation_email_enabled?"selected":"")+'>Actifs</option><option value="false" '+(!d.motivation_email_enabled?"selected":"")+'>Suspendus</option></select></label>'+
 '<div class="pa-actions"><button class="pa-btn" data-amb-save>Enregistrer</button></div>'+
 '<div class="pa-list">'+(profiles.map(p=>'<div class="pa-row"><div><strong>'+esc(p.display_name)+' · '+esc(p.code)+'</strong><small>'+esc(p.email)+' · '+esc(p.qualified||0)+' qualifiés · '+money(p.earned_minor||0)+' à verser · '+money(p.paid_minor||0)+' versé</small></div><div class="pa-actions"><select data-amb-status="'+esc(p.id)+'"><option value="active" '+(p.status==="active"?"selected":"")+'>Actif</option><option value="suspended" '+(p.status==="suspended"?"selected":"")+'>Suspendu</option><option value="closed" '+(p.status==="closed"?"selected":"")+'>Fermé</option></select><select data-amb-compliance="'+esc(p.id)+'"><option value="pending" '+(p.payout_compliance_status==="pending"?"selected":"")+'>Paiement à vérifier</option><option value="verified" '+(p.payout_compliance_status==="verified"?"selected":"")+'>Paiement vérifié</option><option value="blocked" '+(p.payout_compliance_status==="blocked"?"selected":"")+'>Paiement bloqué</option></select><button class="pa-btn" data-amb-update="'+esc(p.id)+'">Mettre à jour</button>'+(Number(p.earned_minor||0)>=Number(d.minimum_payout_minor||2000)&&p.payout_compliance_status==="verified"?'<button class="pa-btn success" data-amb-pay="'+esc(p.id)+'">Enregistrer le versement</button>':'')+'</div></div>').join("")||'<p class="pa-note">Aucun Ambassadeur inscrit.</p>')+'</div>';
}
async function load(){ctx.root.hidden=false;ctx.root.innerHTML='<p class="pa-note">Chargement...</p>';try{render(await req("/platform/ambassadors"))}catch(e){ctx.root.innerHTML='<p class="pa-note">Gestion Ambassadeur indisponible : '+esc(e.code||"erreur")+'</p>'}}
async function click(e){
 if(busy)return;
 if(e.target.closest("[data-amb-close]")){ctx.root.hidden=true;ctx.root.innerHTML="";return}
 if(e.target.closest("[data-amb-save]")){
   busy=true;
   try{await req("/platform/ambassador-program","POST",{enabled:document.getElementById("amb-admin-enabled").value==="true",motivation_email_enabled:document.getElementById("amb-admin-emails").value==="true"});feedback("Programme Ambassadeur mis à jour.","ok");await load()}
   catch(x){feedback(x.code||"Mise à jour impossible","error")}finally{busy=false}return;
 }
 const u=e.target.closest("[data-amb-update]");
 if(u){
   const id=u.dataset.ambUpdate,st=document.querySelector('[data-amb-status="'+id+'"]'),comp=document.querySelector('[data-amb-compliance="'+id+'"]');
   busy=true;try{await req("/platform/ambassadors/"+encodeURIComponent(id)+"/status","POST",{status:st.value,payout_compliance_status:comp.value});feedback("Ambassadeur mis à jour.","ok");await load()}catch(x){feedback(x.code||"Mise à jour impossible","error")}finally{busy=false}return;
 }
 const p=e.target.closest("[data-amb-pay]");
 if(p){
   const ref=prompt("Référence du virement réellement effectué :");if(!ref||ref.trim().length<3)return;
   if(!confirm("Confirmer que le virement a déjà été effectué puis l’enregistrer ?"))return;
   busy=true;try{const x=await req("/platform/ambassadors/"+encodeURIComponent(p.dataset.ambPay)+"/payout","POST",{paid_reference:ref.trim()});feedback("Versement de "+money(x.amount_minor,x.currency)+" enregistré.","ok");await load()}catch(x){feedback(x.code||"Versement impossible","error")}finally{busy=false}
 }
}
export async function open(o={}){ctx=o;if(!ctx.root)throw new Error("AMBASSADOR_ADMIN_ROOT_MISSING");if(!ctx.root.dataset.ambBound){ctx.root.dataset.ambBound="1";ctx.root.addEventListener("click",click)}await load()}