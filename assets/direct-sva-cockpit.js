// Direct SVA distribution cockpit. All data comes from isolated direct_sva tables.
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
const money=v=>new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR"}).format((Number(v)||0)/100);
const integer=v=>new Intl.NumberFormat("fr-FR").format(Number(v)||0);
const parisDate=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const nowMonth=()=>parisDate().slice(0,7);
const cssText=".ds{display:grid;gap:14px}.ds-header{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap}.ds-header h2{margin:2px 0 5px;font-size:23px}.ds-desc{color:#8fa2b5;font-size:12px;line-height:1.6;margin:4px 0}.ds-warning{padding:13px;border:1px solid rgba(245,158,11,.35);background:rgba(245,158,11,.08);border-radius:11px;color:#f4d7a5;font-size:12px;line-height:1.6}.ds-tabs{display:flex;gap:7px;flex-wrap:wrap}.ds-tab,.ds-button{border:1px solid rgba(140,166,190,.23);border-radius:9px;padding:9px 12px;background:#101d2c;color:#edf7ff;font-weight:700;cursor:pointer;font-size:12px}.ds-tab[aria-selected=true]{border-color:#8cc5ca;background:#183744;color:#fff}.ds-input{background:#07101b;color:#edf7ff;padding:9px;border:1px solid rgba(140,166,190,.3);border-radius:8px;min-width:0}.ds-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.ds-card,.ds-panel{padding:15px;background:#091522;border:1px solid rgba(140,166,190,.16);border-radius:12px}.ds-card span{display:block;color:#8fa2b5;font-size:11px}.ds-card strong{display:block;font-size:21px;margin:9px 0}.ds-card small{color:#8497a6;font-size:10px}.ds-panel h3{margin:0 0 10px;font-size:16px}.ds-status{font-size:11px;color:#8fa2b5;min-height:18px}.ds-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.ds-table{max-width:100%;overflow-x:auto}.ds-table table{width:100%;min-width:700px;border-collapse:collapse}.ds-table th,.ds-table td{border-bottom:1px solid rgba(140,166,190,.12);padding:10px 8px;text-align:left;white-space:nowrap;font-size:11px}.ds-table th{color:#97aabe}.ds-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.ds-form label{display:grid;gap:5px;color:#91a6b9;font-size:11px}.ds-form label.ds-wide{grid-column:1/-1}.ds-form input,.ds-form select{width:100%}.ds-lines{grid-column:1/-1;display:grid;gap:8px}.ds-line{display:grid;grid-template-columns:minmax(0,1fr) 100px 100px;gap:7px}.ds-actions{display:flex;gap:8px;flex-wrap:wrap}.ds-note{font-size:11px;color:#8fa2b5;line-height:1.6}.ds-ok{color:#a2e9cc}.ds-alert{color:#ffbd9e}.ds-list{display:grid;gap:7px}.ds-list>div{padding:8px 10px;background:#102132;border-radius:8px;font-size:11px}@media(max-width:900px){.ds-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:640px){.ds-cards,.ds-grid,.ds-form{grid-template-columns:1fr}.ds-line{grid-template-columns:minmax(0,1fr) 80px 80px}.ds-header h2{font-size:19px}}@media print{body *{visibility:hidden!important}#accounting-cockpit-root,#accounting-cockpit-root *{visibility:visible!important}#accounting-cockpit-root{position:absolute!important;left:0;top:0;width:100%}.ds-tabs,.ds-button,.ds-input,.ds-form{display:none!important}.ds,.ds-card,.ds-panel{background:#fff!important;color:#000!important;border-color:#aaa!important}}";
let host=null,month=nowMonth(),tab="overview",data=null,integrations=null,automations=null,complaints=null,busy=false,numberOfLines=2,message="",severity="";
function apiBase(){const b=String(window.PGI_CONFIG?.apiBaseUrl||"").replace(/\/$/,"");if(!b)throw Error("API_NOT_CONFIGURED");return b;}
function cookie(name){const prefix=encodeURIComponent(name)+"=";for(const part of String(document.cookie||"").split(";")){const v=part.trim();if(v.startsWith(prefix)){try{return decodeURIComponent(v.slice(prefix.length))}catch{return v.slice(prefix.length)}}}return"";}
async function request(path,method="GET",payload=null){
  const headers={Accept:"application/json"};
  if(payload!==null)headers["Content-Type"]="application/json";
  if(method!=="GET"){
    const csrf=cookie("__Host-pgi_csrf");
    if(csrf)headers["X-CSRF-Token"]=csrf;
    headers["Idempotency-Key"]=window.PGIApi?.newIdempotencyKey?.()||crypto.randomUUID();
  }
  const response=await fetch(apiBase()+path,{method,credentials:"include",cache:"no-store",headers,body:payload===null?undefined:JSON.stringify(payload)});
  const body=await response.json().catch(()=>null);
  if(!response.ok)throw Error(body?.error?.code||"DIRECT_SVA_HTTP_"+response.status);
  return body;
}
function addStyle(){if(document.getElementById("pgi-direct-sva-styles"))return;const s=document.createElement("style");s.id="pgi-direct-sva-styles";s.textContent=cssText;document.head.appendChild(s);}

export function assertDirectSvaCockpitPayload(value,kind="overview"){
 const invalid=()=>{throw Error("DIRECT_SVA_COCKPIT_RESPONSE_INVALID");};
 if(!value||typeof value!=="object")invalid();
 if(kind==="overview"){
  if(value.business_unit!=="direct_sva"||value.source!=="independent_direct_sva_tables"||
     value.separated_from!=="audiotel_platform"||value.currency!=="EUR"||
     value.operator_mode!=="preparation"||value.activation_authorized!==false||
     value.payout_authorized!==false||value.number_activation_enabled!==false||
     value.automatic_payout_enabled!==false||!value.accounting||
     !Array.isArray(value.number_blocks)||!Array.isArray(value.number_inventory)||
     !Array.isArray(value.interconnections)||!Array.isArray(value.accounting.entries))invalid();
  const a=value.accounting;
  for(const key of ["revenue_minor","expenses_minor","operating_result_minor",
    "receivables_change_minor","publisher_liabilities_change_minor","suspense_change_minor"]){
   if(typeof a[key]!=="number"||!Number.isSafeInteger(a[key]))invalid();
  }
  if(!Number.isSafeInteger(a.revenue_minor-a.expenses_minor)||
     a.operating_result_minor!==a.revenue_minor-a.expenses_minor)invalid();
 }else if(kind==="settlement"){
  if(value.business_unit!=="direct_sva"||value.analysis_mode!=="untrusted_source_preview"||
     value.approved_by_operator!==false||value.accounting_write_authorized!==false||
     value.bank_payout_authorized!==false||value.number_activation_authorized!==false||
     !Array.isArray(value.issues))invalid();
 }else if(kind==="integrations"){
  if(value.all_direct_integrations_disabled!==true||
     !Array.isArray(value.checks)||value.checks.length!==6||
     !Array.isArray(value.units)||value.units.length!==2||
     !value.units.some(u=>u.code==="direct_sva"&&u.label==="PGI Telecom Distribution")||
     !value.units.some(u=>u.code==="audiotel_platform"&&u.label==="Audiotel Premium Pro")||
     value.checks.some(c=>c.data_sending_enabled!==false))invalid();
 }else if(kind==="automation"){
  if(value.business_unit!=="direct_sva"||value.mode!=="preparation"||
     value.external_execution_enabled!==false||value.transfers_enabled!==false||
     value.automatic_number_activation!==false||!Array.isArray(value.jobs)||
     value.jobs.length!==13||value.jobs.some(j=>j.execution_authorized!==false))invalid();
 }else if(kind==="complaints"){
  if(value.business_unit!=="direct_sva"||value.public_form_enabled!==false||
     value.payments_enabled!==false||value.gmail_delivery_active!==false||
     value.hubspot_delivery_active!==false)invalid();
 }else invalid();
 return value;
}

function statRows(rows){if(!rows?.length)return '<p class="ds-note">Aucune donnée enregistrée. Cela ne signifie pas que PGI possède des numéros actifs.</p>';return '<div class="ds-table"><table><thead><tr><th>Statut</th><th>Nombre</th></tr></thead><tbody>'+rows.map(x=>'<tr><td>'+esc(x.status)+'</td><td>'+integer(x.count)+'</td></tr>').join("")+'</tbody></table></div>';}
function kpi(label,value,note){return '<article class="ds-card"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(note)+'</small></article>';}
function cards(){const a=data.accounting;return '<div class="ds-cards">'+
 kpi("Produits directs enregistrés",money(a.revenue_minor),"Écritures validées, traitement fiscal à confirmer")+
 kpi("Charges d'exploitation directes",money(a.expenses_minor),"Sans les charges de la plateforme Audiotel")+
 kpi("Résultat comptable provisoire",money(a.operating_result_minor),"Hors éléments non comptabilisés et impôts")+
 kpi("Écritures en attente",integer(a.draft_entries),"Validation à deux personnes obligatoire")+
 '</div>';}
function banner(){return '<div class="ds-warning"><strong>PGI Telecom Distribution en préparation.</strong> Aucun bloc Arcep attribué à PGI n’est présumé actif, aucun acheminement direct n’est activé et aucun reversement ne peut être déclenché depuis ce cockpit. La comptabilité ci-dessous est un sous-journal distinct et non un FEC certifié.</div>';}
function overview(){
  const blocks=(data.number_blocks||[]).reduce((n,x)=>n+x.count,0),nums=(data.number_inventory||[]).reduce((n,x)=>n+x.count,0),links=(data.interconnections||[]).reduce((n,x)=>n+x.count,0);
  return '<div class="ds-cards">'+
    kpi("Blocs répertoriés",integer(blocks),"Préparés ou attribués : vérifier les décisions Arcep")+
    kpi("Numéros au registre direct",integer(nums),"Inventaire totalement indépendant des numéros partenaires")+
    kpi("Contrats techniques",integer(links),"Collecte, transport et interconnexion")+
    kpi("Mode d’exploitation","Préparation","Numérotation et versements désactivés")+'</div>'+
    '<div class="ds-grid"><section class="ds-panel"><h3>Inventaire de numérotation</h3>'+statRows(data.number_inventory)+'</section><section class="ds-panel"><h3>Contrats et interconnexions</h3>'+statRows(data.interconnections)+'</section></div>'+
    '<section class="ds-panel"><h3>Seuils de sécurité</h3><div class="ds-list"><div>Attribution de numéros : <strong class="ds-alert">Désactivée</strong></div><div>Déclenchement de reversements : <strong class="ds-alert">Désactivé</strong></div><div>Écritures comptables : <strong>journal propre à la distribution directe</strong></div><div>Validation comptable : <strong>séparation préparateur / approbateur</strong></div></div></section>';
}
function numbers(){return '<div class="ds-grid"><section class="ds-panel"><h3>Blocs de numéros PGI</h3>'+statRows(data.number_blocks)+'</section><section class="ds-panel"><h3>Statuts des numéros</h3>'+statRows(data.number_inventory)+'</section></div>'+
  '<section class="ds-panel"><h3>Logique d’attribution</h3><p class="ds-note">Aucun numéro ne peut être commercialisé sous le statut de numéro attribué par PGI sans décision d’attribution Arcep, contrôle du titulaire, contrat éditeur et preuves réglementaires. L’inventaire du distributeur direct n’est pas confondu avec celui des partenaires SVA.</p></section>';}
function listAccounts(){return (data?.accounting?.accounts||[]).map(x=>'<option value="'+esc(x.code)+'">'+esc(x.code+" : "+x.label)+'</option>').join("");}
function entryLine(i){return '<div class="ds-line" data-ds-line><select class="ds-input" data-ds-account aria-label="Compte ligne '+i+'">'+listAccounts()+'</select><input class="ds-input" type="number" min="0" step="0.01" data-ds-debit placeholder="Débit €" aria-label="Débit ligne '+i+'"><input class="ds-input" type="number" min="0" step="0.01" data-ds-credit placeholder="Crédit €" aria-label="Crédit ligne '+i+'"></div>';}
function journals(){
  const a=data.accounting,entries=a.entries||[];
  return cards()+'<section class="ds-panel"><h3>Registre comptable indépendant</h3><p class="ds-note">Période : '+esc(month)+' | Écritures validées : '+integer(a.posted_entries)+' | Période : '+esc(a.period_status)+'. Les créances et dettes affichées sont des variations mensuelles, pas des soldes bancaires réels.</p>'+
   '<div class="ds-cards">'+kpi("Variation créances opérateurs",money(a.receivables_change_minor),"Compte propre distributeur")+
   kpi("Variation dettes éditeurs",money(a.publisher_liabilities_change_minor),"Aucun virement automatique")+
   kpi("Variation compte d’attente",money(a.suspense_change_minor),"Ventilation à contrôler")+
   kpi("Écritures validées",integer(a.posted_entries),"Piste d’audit propre")+'</div></section>'+
   '<section class="ds-panel"><h3>Historique des écritures du mois</h3><div class="ds-actions"><button class="ds-button" data-ds-export type="button">Exporter le sous-journal mensuel complet (CSV)</button><button class="ds-button" data-ds-print type="button">Imprimer</button></div>'+
   (entries.length?'<div class="ds-table"><table><thead><tr><th>Date</th><th>Référence</th><th>Libellé</th><th>Statut</th><th>Débit</th><th>Crédit</th><th>Action</th></tr></thead><tbody>'+
     entries.map(x=>'<tr><td>'+esc(x.date)+'</td><td>'+esc(x.source_reference)+'</td><td>'+esc(x.description)+'</td><td>'+esc(x.status)+'</td><td>'+esc(money(x.debit_minor))+'</td><td>'+esc(money(x.credit_minor))+'</td><td>'+(x.status==="draft"?'<button type="button" class="ds-button" data-ds-approve="'+esc(x.id)+'">Approuver</button>':'Validée')+'</td></tr>').join("")+
     '</tbody></table></div>':'<p class="ds-note">Aucune écriture pour cette période.</p>')+'</section>'+
   '<section class="ds-panel"><h3>Nouveau brouillon comptable</h3><p class="ds-note">Saisie manuelle uniquement sur justificatif. Somme des débits égale à la somme des crédits, références traçables et seconde personne obligatoire pour l’approbation. Aucun versement bancaire n’en découle.</p>'+
   '<form class="ds-form" data-ds-form><label>Date<input class="ds-input" name="entry_date" type="date" required value="'+esc(parisDate())+'"></label>'+
   '<label>Référence unique (DSVA-...)<input class="ds-input" name="source_reference" required minlength="8" placeholder="DSVA-PIECE-0001"></label>'+
   '<label class="ds-wide">Description<input class="ds-input" name="description" required minlength="6" placeholder="Pièce comptable justifiée, aucune simulation"></label>'+
   '<label class="ds-wide">Référence du justificatif<input class="ds-input" name="evidence_reference" required minlength="6" placeholder="Document et référence vérifiable"></label>'+
   '<div class="ds-lines"><strong>Lignes comptables</strong>'+Array.from({length:numberOfLines},(_,i)=>entryLine(i+1)).join("")+'</div>'+
   '<div class="ds-actions"><button class="ds-button" type="button" data-ds-add-line>Ajouter une ligne</button><button class="ds-button" type="submit">Enregistrer le brouillon</button></div></form></section>'+
   '<section class="ds-panel"><h3>Lecture financière prudente</h3><p class="ds-note">Le sous-journal est séparé de la comptabilité générale existante. Une intégration à la comptabilité statutaire et au FEC devra être contrôlée par l’expert-comptable, avec règles de TVA, comptes de tiers, cut-off, rapprochements et justificatifs. Ne pas confondre produits comptabilisés et trésorerie encaissée.</p></section>';
}
function reconciliation(){
 return '<section class="ds-panel"><h3>Rapprochement des relevés du distributeur</h3>'+
 '<p class="ds-note">Pré-analyse d’un relevé issu d’un futur opérateur de collecte. Détection des références CDR dupliquées, des numéros incorrects et des répartitions financières déséquilibrées. Aucun montant n’est enregistré en comptabilité et aucun virement n’est déclenché.</p>'+
 '<label class="ds-desc" for="direct-sva-reconciliation-input">Relevé JSON anonymisé, sans numéros d’appelants</label>'+
 '<textarea class="ds-input" id="direct-sva-reconciliation-input" data-ds-reconcile-payload rows="9" style="width:100%;font-family:monospace" placeholder="{&quot;operator_reference&quot;:&quot;OPERATEUR-001&quot;,&quot;statement_reference&quot;:&quot;RELEVE-001&quot;,&quot;period&quot;:&quot;2026-10&quot;,&quot;currency&quot;:&quot;EUR&quot;,&quot;rows&quot;:[{&quot;cdr_reference&quot;:&quot;CDR-0001&quot;,&quot;called_number&quot;:&quot;+33891234567&quot;,&quot;billable_seconds&quot;:60,&quot;upstream_net_minor&quot;:100,&quot;pgi_margin_minor&quot;:20,&quot;publisher_due_minor&quot;:80}]}"></textarea>'+
 '<div class="ds-actions"><button class="ds-button" type="button" data-ds-reconcile>Analyser le relevé sans l’enregistrer</button></div><div data-ds-reconcile-result class="ds-status" aria-live="polite"></div></section>';
}
function showReconciliationResult(result){
 const target=host?.querySelector("[data-ds-reconcile-result]");
 if(!target)return;
 const issues=Array.isArray(result.issues)?result.issues:[];
 target.innerHTML='<div class="ds-cards">'+
 kpi("Lignes analysées",integer(result.input_rows),"Relevé non authentifié")+
 kpi("Lignes acceptées",integer(result.accepted_rows),"Contrôles structurels uniquement")+
 kpi("Marge PGI théorique",money(result.total_pgi_margin_minor),"Non comptabilisée")+
 kpi("Net dû aux éditeurs",money(result.total_publisher_due_minor),"Aucun paiement autorisé")+'</div>'+
 '<p class="ds-note">Empreinte du fichier : '+esc(result.source_fingerprint)+'. '+(result.balanced?"Répartition arithmétique cohérente.":"Anomalies détectées.")+' Le rapprochement avec des CDR authentifiés reste obligatoire.</p>'+
 (issues.length?'<div class="ds-list">'+issues.map(x=>'<div class="ds-alert">Ligne '+integer(x.row)+' : '+esc(x.code)+' '+esc(x.cdr_reference||"")+'</div>').join("")+'</div>':'<p class="ds-note">Aucune anomalie arithmétique dans ce relevé, sans présumer de sa validité contractuelle.</p>');
}
function integrationView(){
 const title='<section class="ds-panel"><h3>Connexions futures, sans partage des chiffres</h3><p class="ds-note">Une société, deux centres de profit et des flux commerciaux distincts. La propriété GA4 dédiée à la distribution directe, l’espace Search Console de sous-répertoire et le pipeline HubSpot dédié restent à créer ou à valider avant tout lancement. Aucune synchronisation n’est activée ici.</p></section>';
 if(!integrations)return title+'<section class="ds-panel"><p class="ds-note">Registre technique non consulté. Aucun branchement direct présumé prêt.</p><button class="ds-button" type="button" data-ds-integrations-refresh>Contrôler les connexions préparées</button></section>';
 return title+'<section class="ds-panel"><h3>Entreprise et centres analytiques</h3><div class="ds-list">'+
 (integrations.units||[]).map(u=>'<div><strong>'+esc(u.label)+'</strong> | centre '+esc(u.analytic_cost_center)+' | profil légal commun '+esc(u.shared_accounting_profile_id)+' | '+esc(u.lifecycle)+'</div>').join("")+
 '</div><p class="ds-note">Un seul FEC légal pour la société, avec ventilation analytique et aucune double comptabilisation.</p></section>'+
 '<section class="ds-panel"><h3>Préparation de la comptabilité légale commune</h3><div class="ds-list">'+
 (integrations.shared_legal_accounting?.legal_profile_criteria||[]).map(x=>'<div><strong>'+esc(x.label)+'</strong> : <span class="'+(x.ok?'ds-ok':'ds-alert')+'">'+(x.ok?'Renseigné':'À compléter ou valider')+'</span></div>').join("")+
 '</div><p class="ds-note">FEC légal en production : '+(integrations.shared_legal_accounting?.fec_active?'Option activée, non certifiée':'Désactivé')+'. Les écritures du distributeur direct ne sont pas encore raccordées au FEC.</p></section>'+
 '<section class="ds-panel"><h3>États des intégrations</h3><div class="ds-table"><table><thead><tr><th>Système</th><th>Rôle de l’intégration</th><th>État préparatoire</th><th>Envoi de données</th></tr></thead><tbody>'+
 (integrations.checks||[]).map(x=>'<tr><td>'+esc(x.label)+'</td><td>'+esc(x.target)+'</td><td>'+esc(x.recorded_state)+'</td><td class="ds-alert">Désactivé</td></tr>').join("")+
 '</tbody></table></div><p class="ds-note">Les états ci-dessus proviennent du registre PostgreSQL distinct. Ils ne garantissent pas l’existence de contrats, de dimensions GA4 ni de propriétés HubSpot.</p>'+
 '<button type="button" class="ds-button" data-ds-integrations-refresh>Revérifier le registre</button></section>';
}
async function refreshIntegrations(){
 if(!host)return;
 try{integrations=assertDirectSvaCockpitPayload(await request("/platform/direct-sva/integrations"),"integrations");message="Registre des intégrations consulté. Toutes les nouvelles transmissions restent désactivées.";severity="ds-ok";show();}
 catch(error){integrations=null;message="Intégrations non disponibles : "+String(error.message);severity="ds-alert";show();}
}
function automationView(){
 const intro='<section class="ds-panel"><h3>Automatisations de la distribution directe</h3>'+
 '<p class="ds-note">Treize circuits autonomes prévus : acquisition, conformité, contrats, attribution, portabilité, appels, rapprochement, comptabilité, factures, reversements, CRM, Analytics et suivi du support. Ils ne reprennent aucun flux Audiotel et ne sont pas exécutables en phase de préparation.</p>'+
 '<div class="ds-warning"><strong>Sécurité :</strong> exécution extérieure, activation des numéros et transferts financiers désactivés. Aucun indicateur "terminé" n’est simulé.</div></section>';
 if(!automations)return intro+'<section class="ds-panel"><p class="ds-note">La file de supervision n’a pas encore été consultée.</p><button type="button" class="ds-button" data-ds-automation-refresh>Charger l’état des automatisations</button></section>';
 return intro+'<section class="ds-panel"><h3>Files et contrôles requis</h3><div class="ds-table"><table><thead><tr><th>Processus</th><th>En attente</th><th>Preuves requises</th><th>Exécution</th></tr></thead><tbody>'+
 (automations.jobs||[]).map(j=>'<tr><td>'+esc(j.workflow)+'</td><td>'+integer(j.count)+'</td><td>'+esc(j.required_evidence.join(", "))+'</td><td class="ds-alert">Bloquée</td></tr>').join("")+
 '</tbody></table></div>'+(automations.jobs?.length?'':'<p class="ds-note">Aucun traitement direct engagé. Les règles des 13 processus sont configurées dans le moteur de préparation.</p>')+
 '<button type="button" class="ds-button" data-ds-automation-refresh>Actualiser la file</button></section>';
}
async function refreshAutomations(){
 try{automations=assertDirectSvaCockpitPayload(await request("/platform/direct-sva/automation"),"automation");message="Files directes consultées, aucune exécution en production.";severity="ds-ok";show();}
 catch(error){automations=null;message="Automatisations indisponibles : "+String(error.message);severity="ds-alert";show();}
}
function complaintView(){
 const intro='<section class="ds-panel"><h3>Réclamations et boîte Gmail</h3>'+
 '<p class="ds-note">La future adresse de réclamation sera acheminée via Resend vers la boîte Gmail interne configurée. Les messages seront classés séparément des tickets Audiotel. Aucune décision financière, juridique ou de portabilité ne sera exécutée depuis un e-mail.</p>'+
 '<div class="ds-warning">PGI Telecom Distribution non commercialisée : le formulaire public et les transmissions CRM restent bloqués jusqu’au lancement réglementaire et à la recette e-mail.</div></section>';
 if(!complaints)return intro+'<section class="ds-panel"><p class="ds-note">Diagnostic du registre de réclamations non chargé.</p><button class="ds-button" data-ds-complaints-refresh type="button">Contrôler les réclamations</button></section>';
 const rows=complaints.categories||[];
 return intro+'<div class="ds-cards">'+
 kpi("Dossiers préparatoires",complaints.prepared_cases==null?"Non installé":integer(complaints.prepared_cases),"Aucune réclamation commerciale reçue")+
 kpi("Actions en attente",complaints.pending_external_automations==null?"Non installé":integer(complaints.pending_external_automations),"Exécutions externes non autorisées")+
 kpi("Formulaire vers Gmail",complaints.gmail_delivery_active?"Actif":"En préparation","Raccordement et recette nécessaires")+
 kpi("HubSpot direct",complaints.hubspot_delivery_active?"Actif":"Bloqué","Pipeline indépendant obligatoire")+'</div>'+
 '<section class="ds-panel"><h3>Répartition des dossiers</h3><div class="ds-list">'+
 (rows.length?rows.map(r=>'<div>'+esc(r.category)+' | '+esc(r.priority)+' : '+integer(r.count)+'</div>').join(""):'<div>Aucun dossier enregistré ou migration non appliquée.</div>')+
 '</div><div class="ds-actions"><button type="button" class="ds-button" data-ds-complaints-refresh>Actualiser</button></div></section>';
}
async function refreshComplaints(){
 try{complaints=assertDirectSvaCockpitPayload(await request("/platform/direct-sva/complaints/readiness"),"complaints");
 message="Contrôle du circuit de réclamations consulté. Réception publique et notifications directes non actives.";severity="ds-ok";show();}
 catch(error){complaints=null;message="Réclamations non disponibles : "+String(error.message);severity="ds-alert";show();}
}
function compliance(){return '<div class="ds-grid"><section class="ds-panel"><h3>Prérequis opérateur</h3><div class="ds-list">'+[
 "Identifiant CE et décision d’attribution Arcep",
 "Cadre AF2M, APNF et RSVA",
 "Contrats d’interconnexion et de collecte",
 "Gestion de la portabilité, SIP et CDR",
 "KYC éditeurs, protection des consommateurs et antifraude",
 "Contrats et mandat financier approprié pour les fonds de tiers",
 "Comptabilité, contrôle interne et audit de lancement"
 ].map(s=>'<div><span class="ds-alert">À documenter : </span>'+esc(s)+'</div>').join("")+'</div></section>'+
 '<section class="ds-panel"><h3>Contrôle du cloisonnement</h3><div class="ds-list"><div>Activité courante : <strong>Audiotel Premium Pro</strong></div><div>Nouvelle activité : <strong>PGI Telecom Distribution</strong></div><div>Tables financières : <strong>direct_sva_*</strong></div><div>Écritures historiques Audiotel : <strong>inchangées</strong></div><div>Publication et activation : <strong class="ds-alert">Aucune</strong></div></div></section></div>';}
function show(){
 if(!host||!data)return;
 host.innerHTML='<div class="ds"><div class="ds-header"><div><p class="panel-kicker">ACTIVITÉ DISTINCTE | PGI TELECOM</p><h2>PGI Telecom Distribution</h2><p class="ds-desc">Pilotage opérateur et comptabilité isolés de la plateforme Audiotel actuelle.</p></div><label class="ds-desc">Mois comptable <input type="month" class="ds-input" data-ds-month value="'+esc(month)+'"></label></div>'+banner()+
 '<div class="ds-tabs" role="tablist" aria-label="Rubriques PGI Telecom Distribution">'+
 [["overview","Vue générale"],["numbers","Numérotation"],["accounting","Comptabilité directe"],["reconciliation","Rapprochement"],["integrations","Intégrations"],["automation","Automatisations"],["complaints","Réclamations"],["transitions","Changer de distributeur"],["compliance","Conformité"]].map(([key,label])=>'<button type="button" role="tab" class="ds-tab" data-ds-tab="'+key+'" aria-selected="'+(key===tab)+'">'+label+'</button>').join("")+'</div>'+
 '<div class="ds-status '+esc(severity)+'" aria-live="polite">'+esc(message)+'</div>'+
 (tab==="overview"?overview():tab==="numbers"?numbers():tab==="accounting"?journals():tab==="reconciliation"?reconciliation():tab==="integrations"?integrationView():tab==="automation"?automationView()+'<div data-ds-automation-lab-root></div>':tab==="complaints"?complaintView():tab==="transitions"?'<section class="ds-panel"><div data-ds-transitions-root></div></section>':compliance())+
 '</div>';
 attach();
 if(tab==="transitions")import("./direct-sva-transitions.js").then(m=>m.mountDirectSvaTransitions(host.querySelector("[data-ds-transitions-root]"))).catch(()=>{});
 if(tab==="automation"){const root=host.querySelector("[data-ds-automation-lab-root]");if(root)import("./direct-sva-automation-lab.js").then(m=>{if(root.isConnected)m.mountDirectSvaRehearsals(root)}).catch(()=>{if(root.isConnected)root.textContent="Laboratoire de test indisponible.";});}
}
function amountMinor(v){
 const raw=String(v??"").trim();
 if(!/^\d{1,12}(\.\d{1,2})?$/.test(raw))throw Error("MONTANT_INVALIDE");
 const [whole,decimals=""]=raw.split(".");
 const minor=Number(whole)*100+Number(decimals.padEnd(2,"0"));
 if(!Number.isSafeInteger(minor))throw Error("MONTANT_TROP_ELEVE");
 return minor;
}
async function createDraft(form){
 const fd=new FormData(form);
 const lines=Array.from(form.querySelectorAll("[data-ds-line]")).map(row=>({
  account_code:row.querySelector("[data-ds-account]").value,
  label:row.querySelector("[data-ds-account]").selectedOptions[0]?.textContent||"Écriture SVA directe",
  debit_minor:row.querySelector("[data-ds-debit]").value?amountMinor(row.querySelector("[data-ds-debit]").value):0,
  credit_minor:row.querySelector("[data-ds-credit]").value?amountMinor(row.querySelector("[data-ds-credit]").value):0
 }));
 return request("/platform/direct-sva/accounting/drafts","POST",{
  entry_date:fd.get("entry_date"),source_reference:fd.get("source_reference"),
  description:fd.get("description"),evidence_reference:fd.get("evidence_reference"),currency:"EUR",lines
 });
}
let exportInProgress=false;
async function exportCsv(){
 if(exportInProgress)return;
 exportInProgress=true;
 try{
  const report=await request("/platform/direct-sva/accounting/export?month="+encodeURIComponent(month));
  if(report.business_unit!=="direct_sva"||report.complete_for_period!==true||report.document_type!=="management_subledger_not_legal_fec"){
   throw Error("DIRECT_SVA_EXPORT_INTEGRITY_CHECK_FAILED");
  }
  const rows=[["Unité analytique","Date","ID écriture","Système source","Référence source",
   "Empreinte SHA256","Description","Statut","N° ligne","Compte","Libellé ligne",
   "Débit EUR","Crédit EUR","Justificatif"]];
  for(const x of report.rows||[]){
   rows.push(["DSVA",x.entry_date,String(x.journal_entry_id),x.source_system,x.source_reference,
    x.source_digest,x.description,x.status,String(x.line_no),x.account_code,x.line_label,
    (x.debit_minor/100).toFixed(2),(x.credit_minor/100).toFixed(2),x.evidence_reference]);
  }
  // Neutralize spreadsheet formulas in free-text fields while retaining numeric decimal cells.
  function csvCell(value){
   let raw=String(value??"");
   if(/^[=+@\- \t\r\n]/.test(raw)&&!/^-?[0-9]+(?:\.[0-9]+)?$/.test(raw))raw="'"+raw;
   return '"'+raw.replace(/"/g,'""')+'"';
  }
  const csv="\ufeff"+rows.map(row=>row.map(csvCell).join(";")).join("\r\n")+"\r\n";
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
  const u=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=u;a.download="pgi-telecom-distribution-sous-journal-"+month+"-NON-FEC.csv";
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000);
  message=integer(report.exported_entries)+" écriture(s), "+integer(report.exported_lines)+" ligne(s) exportées. Export de gestion, non FEC.";
  severity="ds-ok";show();
 }catch(error){
  message="Export non effectué : "+String(error.message||"erreur");severity="ds-alert";show();
 }finally{exportInProgress=false;}
}
function attach(){
 host.querySelector("[data-ds-reconcile]")?.addEventListener("click",async()=>{
  const target=host.querySelector("[data-ds-reconcile-result]");
  try{
   const payload=JSON.parse(host.querySelector("[data-ds-reconcile-payload]").value);
   target.textContent="Analyse du relevé...";
   const result=await request("/platform/direct-sva/reconciliation/preview","POST",payload);
   showReconciliationResult(assertDirectSvaCockpitPayload(result,"settlement"));
  }catch(error){target.textContent="Analyse refusée : "+String(error.message||"format incorrect");}
 });

 host.querySelector("[data-ds-month]")?.addEventListener("change",event=>{month=event.target.value||month;load();});
 host.querySelectorAll("[data-ds-tab]").forEach(btn=>btn.addEventListener("click",()=>{tab=btn.dataset.dsTab;show();if(tab==="integrations"&&!integrations)refreshIntegrations();if(tab==="automation"&&!automations)refreshAutomations();if(tab==="complaints"&&!complaints)refreshComplaints();}));
 host.querySelector("[data-ds-integrations-refresh]")?.addEventListener("click",refreshIntegrations);
 host.querySelector("[data-ds-automation-refresh]")?.addEventListener("click",refreshAutomations);
 host.querySelector("[data-ds-complaints-refresh]")?.addEventListener("click",refreshComplaints);
 host.querySelector("[data-ds-export]")?.addEventListener("click",exportCsv);
 host.querySelector("[data-ds-print]")?.addEventListener("click",()=>window.print());
 host.querySelector("[data-ds-add-line]")?.addEventListener("click",()=>{if(numberOfLines>=50){message="Limite de 50 lignes atteinte.";severity="ds-alert";return;}numberOfLines++;host.querySelector(".ds-lines")?.insertAdjacentHTML("beforeend",entryLine(numberOfLines));});
 host.querySelector("[data-ds-form]")?.addEventListener("submit",async event=>{
  event.preventDefault();if(busy)return;
  busy=true;const submission=createDraft(event.currentTarget);message="Enregistrement du brouillon...";severity="";
  try{await submission;numberOfLines=2;message="Brouillon enregistré dans le seul journal distributeur direct.";severity="ds-ok";busy=false;await load();}
  catch(error){message="Écriture non enregistrée : "+String(error.message||"erreur");severity="ds-alert";show();}
  finally{busy=false;}
 });
 host.querySelectorAll("[data-ds-approve]").forEach(btn=>btn.addEventListener("click",async()=>{
  const proof=window.prompt("Référence documentaire de l’approbation indépendante (6 caractères minimum) :");
  if(proof===null)return;
  if(proof.trim().length<6){message="Justificatif d’approbation insuffisant.";severity="ds-alert";show();return;}
  try{await request("/platform/direct-sva/accounting/drafts/"+encodeURIComponent(btn.dataset.dsApprove)+"/approve","POST",{approval_evidence:proof.trim()});message="Écriture approuvée et verrouillée.";severity="ds-ok";await load();}
  catch(error){message="Validation refusée : "+String(error.message||"erreur");severity="ds-alert";show();}
 }));
}
async function load(){
 if(!host||busy)return;
 busy=true;host.innerHTML='<div class="ds-panel">Chargement des données propres au distributeur direct...</div>';
 try{data=assertDirectSvaCockpitPayload(await request("/platform/direct-sva/overview?month="+encodeURIComponent(month)));show();}
 catch(error){data=null;host.innerHTML='<div class="ds-warning"><strong>PGI Telecom Distribution indisponible.</strong> Les données restent isolées. Vérifier la connexion PostgreSQL, la migration dédiée et les droits administrateur. Détail : '+esc(error.message)+'</div>';}
 finally{busy=false;}
}
export function mountDirectSvaCockpit(element,options={}){
 if(!element)return;
 addStyle();
 if(host===element&&data&&!options.force){show();return;}
 host=element;load();
}
