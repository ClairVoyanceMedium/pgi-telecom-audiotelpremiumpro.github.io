let dialog=null,context=null;
const $=id=>document.getElementById(id);
const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const days=[["1","Lundi"],["2","Mardi"],["3","Mercredi"],["4","Jeudi"],["5","Vendredi"],["6","Samedi"],["7","Dimanche"]];
function ensureCss(){if(document.getElementById("business-live-reset-schedule-css"))return;const l=document.createElement("link");l.id="business-live-reset-schedule-css";l.rel="stylesheet";l.href="assets/business-live-reset-schedule.css";document.head.appendChild(l)}
function browserTimezone(){try{return Intl.DateTimeFormat().resolvedOptions().timeZone||"Europe/Paris"}catch{return"Europe/Paris"}}
function today(){const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function formatNext(v){if(!v)return"Aucune échéance programmée";try{return new Intl.DateTimeFormat(navigator.language||"fr-FR",{dateStyle:"full",timeStyle:"short"}).format(new Date(v))}catch{return String(v)}}
function markup(s){
 const x=s||{},frequency=x.frequency||"daily",enabled=x.enabled===true;
 return '<dialog id="business-live-reset-schedule-dialog" class="bls-dialog"><form method="dialog" class="bls-card"><div class="bls-head"><div><small>BUSINESS LIVE</small><h2>Automatisation de remise à zéro</h2></div><button class="bls-close" value="cancel" aria-label="Fermer">×</button></div><p>Le compteur Business Live peut repartir automatiquement de 0,00 €. Les CDR, règlements, reversements validés et statistiques officielles restent inchangés.</p><label class="bls-switch"><input id="bls-enabled" type="checkbox" '+(enabled?"checked":"")+'><span>Activer la remise à zéro automatique</span></label><div class="bls-grid"><label>Fréquence<select id="bls-frequency"><option value="daily">Tous les jours</option><option value="weekly">Chaque semaine</option><option value="monthly">Chaque mois</option><option value="interval_days">Tous les N jours</option></select></label><label>Heure<input id="bls-time" type="time" value="'+esc(x.time||"09:00")+'" required></label><label id="bls-weekday-wrap">Jour de semaine<select id="bls-weekday">'+days.map(d=>'<option value="'+d[0]+'">'+d[1]+'</option>').join("")+'</select></label><label id="bls-month-day-wrap">Jour du mois<input id="bls-month-day" type="number" min="1" max="31" value="'+esc(x.month_day||1)+'"></label><label id="bls-interval-wrap">Nombre de jours<input id="bls-interval" type="number" min="1" max="3650" value="'+esc(x.interval_days||30)+'"></label><label id="bls-anchor-wrap">Date de départ<input id="bls-anchor" type="date" value="'+esc(x.anchor_date||today())+'"></label><label class="bls-wide">Fuseau horaire<input id="bls-timezone" type="text" value="'+esc(x.timezone||browserTimezone())+'" autocomplete="off"></label></div><small class="bls-note">Pour un jour 29, 30 ou 31 absent d’un mois, la remise à zéro est effectuée le dernier jour de ce mois.</small><div class="bls-next">Prochaine échéance actuelle : <strong>'+esc(formatNext(x.next_run_at))+'</strong></div><div id="bls-status" class="bls-status" role="status"></div><div class="bls-actions"><button value="cancel" class="bls-secondary">Annuler</button><button id="bls-save" type="button" class="bls-primary">Enregistrer</button></div></form></dialog>';
}
function syncFields(){
 const f=$("bls-frequency").value;
 $("bls-weekday-wrap").hidden=f!=="weekly";$("bls-month-day-wrap").hidden=f!=="monthly";$("bls-interval-wrap").hidden=f!=="interval_days";$("bls-anchor-wrap").hidden=f!=="interval_days";
}
function payload(){
 const f=$("bls-frequency").value;
 return {enabled:$("bls-enabled").checked,frequency:f,time:$("bls-time").value||"09:00",timezone:$("bls-timezone").value.trim()||browserTimezone(),weekday:f==="weekly"?Number($("bls-weekday").value):null,month_day:f==="monthly"?Number($("bls-month-day").value):null,interval_days:f==="interval_days"?Number($("bls-interval").value):null,anchor_date:f==="interval_days"?$("bls-anchor").value:null};
}
async function save(){
 const status=$("bls-status"),button=$("bls-save");button.disabled=true;status.textContent="Enregistrement…";
 try{
  const p=payload(),api=context.scope==="platform"?window.PGIApi:window.PGICustomerApi;
  const fn=context.scope==="platform"?api?.saveLiveFinanceSchedule:api?.saveJackpotSchedule;
  let result;
  if(context.demo===true){
   result={...p,next_run_at:null,last_run_at:null,run_count:0};
   try{localStorage.setItem("pgi_demo_business_live_reset_schedule",JSON.stringify(result))}catch(_e){}
  }else{
   if(typeof fn!=="function")throw new Error("API indisponible");
   result=await fn(p,api.newIdempotencyKey());
  }
  context.schedule=result.reset_schedule||result;status.textContent=p.enabled?"Automatisation enregistrée.":"Automatisation désactivée.";
  if(typeof context.onSaved==="function")await context.onSaved(context.schedule);
  setTimeout(()=>dialog?.close(),350);
 }catch(err){status.textContent=err?.payload?.error?.message||err?.message||"Impossible d’enregistrer la programmation."}
 finally{button.disabled=false}
}
export function openBusinessLiveResetSchedule(options={}){
 ensureCss();context={scope:options.scope==="platform"?"platform":"tenant",demo:options.demo===true,schedule:options.schedule||null,onSaved:options.onSaved};
 dialog?.remove();document.body.insertAdjacentHTML("beforeend",markup(context.schedule));dialog=$("business-live-reset-schedule-dialog");
 $("bls-frequency").value=context.schedule?.frequency||"daily";$("bls-weekday").value=String(context.schedule?.weekday||1);syncFields();
 $("bls-frequency").addEventListener("change",syncFields);$("bls-save").addEventListener("click",save);dialog.addEventListener("close",()=>{dialog?.remove();dialog=null});
 dialog.showModal();
}
