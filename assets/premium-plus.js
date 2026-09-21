import{style,read,write,applyDisplay,displayCss,dialog,pane,setupVitals,setupPwa,tour,esc}from"./premium-plus-core.js";
const K="pgi_premium_plus_v1",D={contrast:false,motion:true,density:"comfortable",text:"normal"},prefs=read(K,D);
style("pgi-premium-plus-style",displayCss());applyDisplay(prefs);
const tabs=[{id:"notifications",label:"Notifications"},{id:"comfort",label:"Confort"},{id:"guide",label:"Guide"},{id:"app",label:"Application"},{id:"quality",label:"Qualité UX"}];
const d=dialog("pgi-premium-plus","Premium+",tabs),n=pane(d,"notifications"),c=pane(d,"comfort"),g=pane(d,"guide"),a=pane(d,"app"),q=pane(d,"quality");
let notifications=[],vitals={lcp:null,cls:0,inp:null},pwa=null;
function save(){write(K,prefs);applyDisplay(prefs)}
function button(){
  const host=document.querySelector(".top-actions");if(!host||document.getElementById("premium-plus-open"))return;
  const b=document.createElement("button");b.id="premium-plus-open";b.type="button";b.className="icon-btn pp-btn";b.setAttribute("aria-label","Ouvrir Premium+");b.innerHTML='✦<span class="pp-badge" hidden>0</span>';b.onclick=()=>{collect();render();d.showModal()};host.insertBefore(b,document.getElementById("refresh-btn"));
}
function collect(){
  const rows=[],seen=new Set(),add=(title,text,tone="neutral")=>{const k=title+"|"+text;if(!seen.has(k)){seen.add(k);rows.push({title,text,tone})}};
  document.querySelectorAll(".alert-item").forEach(x=>add("Alerte cockpit",(x.textContent||"").replace(/\s+/g," ").trim(),"warn"));
  document.querySelectorAll(".activation-gates i").forEach(x=>{const t=(x.textContent||"").trim();if(/À FAIRE|BLOQU/i.test(t))add("Préparation SVA",(x.closest("button")?.textContent||t).replace(/\s+/g," ").trim(),"warn")});
  document.querySelectorAll(".health.warn,.health.bad").forEach(x=>add("Supervision",(x.parentElement?.textContent||x.textContent).replace(/\s+/g," ").trim(),x.classList.contains("bad")?"bad":"warn"));
  notifications=rows.slice(0,20);
  const badge=document.querySelector("#premium-plus-open .pp-badge"),count=notifications.length;if(badge){badge.hidden=!count;badge.textContent=String(count)}
}
function render(){
  n.innerHTML='<p class="pp-note">Centre unifié des éléments qui demandent votre attention. Il reflète uniquement les états déjà présents dans PGI.</p><div class="pp-list">'+(notifications.length?notifications.map(x=>'<div class="pp-item" data-tone="'+x.tone+'"><strong>'+esc(x.title)+'</strong><p>'+esc(x.text)+'</p></div>').join(""):'<div class="pp-item"><strong>Aucune alerte visible</strong><p>Le cockpit ne présente actuellement aucun signal nécessitant une action.</p></div>')+'</div>';
  c.innerHTML='<p class="pp-note">Ces réglages restent sur cet appareil et ne modifient aucune donnée métier.</p>'+row("Texte agrandi","Améliore la lisibilité sur téléphone.",'<button class="pp-switch" data-pref="text" aria-pressed="'+(prefs.text==="large")+'"></button>')+row("Contraste renforcé","Renforce les bordures et textes secondaires.",'<button class="pp-switch" data-pref="contrast" aria-pressed="'+prefs.contrast+'"></button>')+row("Animations","Désactivez-les si vous préférez une interface plus stable.",'<button class="pp-switch" data-pref="motion" aria-pressed="'+(prefs.motion===false)+'"></button>')+row("Densité", "Choisissez le niveau d’espace entre les informations.",'<select data-density><option value="comfortable">Confortable</option><option value="compact">Compacte</option></select>');
  c.querySelector("[data-density]").value=prefs.density;c.querySelectorAll("[data-pref]").forEach(b=>b.onclick=()=>{const k=b.dataset.pref;if(k==="text")prefs.text=prefs.text==="large"?"normal":"large";if(k==="contrast")prefs.contrast=!prefs.contrast;if(k==="motion")prefs.motion=prefs.motion===false;save();render()});c.querySelector("[data-density]").onchange=e=>{prefs.density=e.target.value;save()};
  g.innerHTML='<div class="pp-card"><span>Prise en main</span><strong>Visite guidée du cockpit</strong><small>Retrouvez rapidement le cockpit, les appels, la finance, la plateforme SVA et la supervision.</small><button data-guide style="margin-top:10px;min-height:42px">Lancer le guide</button></div>';g.querySelector("[data-guide]").onclick=()=>{d.close();guide.start()};
  renderApp();renderQuality()
}
function row(title,text,control){return '<div class="pp-row"><label><strong>'+title+'</strong><small>'+text+'</small></label>'+control+'</div>'}
function renderApp(){
  const s=pwa?.state||{};a.innerHTML='<div class="pp-grid"><div class="pp-card"><span>Mode application</span><strong>'+(s.standalone?"Installée":s.installable?"Installation disponible":"Navigateur")+'</strong><small>PGI reste utilisable comme PWA et peut recevoir les nouvelles versions proprement.</small></div><div class="pp-card"><span>Mise à jour</span><strong>'+(s.update?"Disponible":"À jour")+'</strong><small>Le service worker contrôle les nouvelles versions sans toucher aux données métier.</small></div></div><div class="pp-row"><label><strong>Vérifier les mises à jour</strong><small>Recherche une nouvelle version de l’interface.</small></label><button data-check>Vérifier</button></div>'+(s.installable?'<div class="pp-row"><label><strong>Installer l’application</strong><small>Ajoute PGI sur l’écran d’accueil.</small></label><button data-install>Installer</button></div>':"")+(s.update?'<div class="pp-row"><label><strong>Activer la mise à jour</strong><small>La page sera rechargée sur la nouvelle version.</small></label><button data-update>Mettre à jour</button></div>':"");
  a.querySelector("[data-check]")?.addEventListener("click",()=>pwa.check());a.querySelector("[data-install]")?.addEventListener("click",()=>pwa.install());a.querySelector("[data-update]")?.addEventListener("click",()=>pwa.activate())
}
function grade(k,v){if(v==null)return"En mesure";if(k==="lcp")return v<=2500?"Bon":v<=4000?"À améliorer":"Lent";if(k==="cls")return v<=.1?"Bon":v<=.25?"À améliorer":"Instable";return v<=200?"Bon":v<=500?"À améliorer":"Lent"}
function renderQuality(){q.innerHTML='<p class="pp-note">Mesures locales de l’expérience réellement ressentie sur cet appareil. Elles ne sont pas envoyées à un tiers.</p><div class="pp-grid">'+metric("LCP",vitals.lcp==null?"—":vitals.lcp+" ms",grade("lcp",vitals.lcp),"Chargement du contenu principal")+metric("CLS",vitals.cls.toFixed(3),grade("cls",vitals.cls),"Stabilité visuelle")+metric("INP",vitals.inp==null?"—":vitals.inp+" ms",grade("inp",vitals.inp),"Réactivité aux interactions")+'</div>'}
function metric(label,value,state,note){return '<div class="pp-card"><span>'+label+'</span><strong>'+value+' · '+state+'</strong><small>'+note+'</small></div>'}
const guide=tour("pgi_admin_guide_v1",[
 {selector:".command-deck",title:"Cockpit",text:"Votre synthèse opérationnelle et financière."},
 {selector:'[data-view="calls"]',title:"Appels",text:"CDR, filtres, détails et exports."},
 {selector:'[data-view="finance"]',title:"Finance",text:"Reversements, rapprochement et suivi."},
 {selector:'[data-view="wholesale"]',title:"Plateforme SVA",text:"Clients, numéros, KYC et exploitation."},
 {selector:'[data-view="system"]',title:"Supervision",text:"API, SIP, CDR, résilience et NOC."}
]);
button();vitals=setupVitals(v=>{vitals=v;if(d.open)renderQuality()});pwa=setupPwa(()=>{if(d.open)renderApp()});collect();setInterval(collect,30000);
setTimeout(()=>{if(!guide.isDone())guide.start()},1400);
