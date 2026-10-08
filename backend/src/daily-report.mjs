import {sendDailyReportEmail} from "./resend-email.mjs";

const TZ="Europe/Paris";
const RUN_HOURS=new Set([20,21]);

function parisParts(now=new Date()){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"}).formatToParts(now);
  const values=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return {date:values.year+"-"+values.month+"-"+values.day,hour:Number(values.hour)};
}
function frDate(iso){
  const [y,m,d]=String(iso).split("-");
  return d+"/"+m+"/"+y;
}
function n(value){const x=Number(value);return Number.isFinite(x)?x:0;}
function unavailable(label){return label+" : non disponible côté serveur pour le moment.";}

export function dailyReportScheduleState(now=new Date()){
  const p=parisParts(now);
  return {...p,should_run:RUN_HOURS.has(p.hour),retry:p.hour===21};
}

export function buildDailyReportText(date,snapshot={}){
  const service=snapshot.service||{},mail=snapshot.mail||{},system=snapshot.system||{},cats=Array.isArray(snapshot.categories)?snapshot.categories:[];
  const categoryText=cats.length?cats.map(x=>String(x.category||"other")+" "+n(x.count)).join(", "):"aucune";
  return [
    "Bilan PGI Telecom | "+frDate(date),
    "",
    "Période : journée civile "+frDate(date)+" Europe/Paris.",
    "",
    "Service clients et exploitation",
    "Tickets créés : "+n(service.created_today),
    "Tickets résolus ou fermés : "+n(service.resolved_today),
    "Tickets ouverts : "+n(service.open_now),
    "Tickets en attente client : "+n(service.waiting_customer),
    "Tickets critiques ouverts : "+n(service.critical_open),
    "Premières réponses en retard : "+n(service.first_response_overdue),
    "Résolutions en retard : "+n(service.resolution_overdue),
    "Catégories actives : "+categoryText,
    "Emails entrants rattachés automatiquement à un dossier : "+n(mail.inbound_resolved),
    "",
    "Emails transactionnels PGI",
    "Créés : "+n(mail.created),
    "Acceptés ou envoyés : "+n(mail.accepted_or_sent),
    "Livrés : "+n(mail.delivered),
    "Échecs ou rebonds : "+n(mail.failed_or_bounced),
    "",
    "Plateforme",
    "Clients créés : "+n(system.tenants_created),
    "Appels : "+n(system.calls_total),
    "Appels connectés : "+n(system.calls_connected),
    "Événements en attente dans l outbox : "+n(system.outbox_pending),
    "",
    "Données externes",
    "HubSpot : les tickets PGI restent synchronisés lorsque l intégration CRM est configurée. Ce bilan de secours utilise Neon comme source opérationnelle.",
    unavailable("Google Search Console"),
    unavailable("GA4 Data API"),
    unavailable("Gmail"),
    "",
    "Note : ce bilan de secours est volontairement factuel. Il ne remplace aucune donnée externe indisponible et n invente aucun chiffre.",
    "",
    "PGI Telecom",
    "Audiotel Premium Pro"
  ].join("\n");
}

export async function runDailyReportCron({store,config,now=new Date()}){
  const schedule=dailyReportScheduleState(now);
  if(!config?.dailyReportEnabled)return {ok:true,skipped:true,reason:"disabled",...schedule};
  if(!schedule.should_run)return {ok:true,skipped:true,reason:"outside_paris_window",...schedule};
  if(!config?.transactionalEmailEnabled||!config?.resendApiKey)return {ok:false,skipped:true,reason:"resend_not_ready",...schedule};
  const recipient=String(config.dailyReportRecipient||"").trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))return {ok:false,skipped:true,reason:"recipient_not_configured",...schedule};
  if(!store||typeof store.dailyReportSnapshot!=="function")return {ok:false,skipped:true,reason:"snapshot_unavailable",...schedule};
  const snapshot=await store.dailyReportSnapshot({date:schedule.date});
  const subject="Bilan PGI Telecom | "+frDate(schedule.date);
  const text=buildDailyReportText(schedule.date,snapshot);
  const key="bilan-pgi-"+schedule.date;
  const result=await sendDailyReportEmail(config,{to:recipient,subject,text,idempotencyKey:key});
  return {ok:true,skipped:false,date:schedule.date,hour:schedule.hour,retry:schedule.retry,idempotency_key:key,message_id:result.message_id||null};
}
