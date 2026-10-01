const FREQUENCIES=new Set(["daily","weekly","monthly","interval_days"]);
const WEEKDAYS=new Set([1,2,3,4,5,6,7]);

function problem(code,message){
  const e=new Error(message||code);e.status=400;e.code=code;e.expose=true;return e;
}
function validTimezone(value){
  const timezone=String(value||"").trim()||"Europe/Paris";
  try{new Intl.DateTimeFormat("fr-FR",{timeZone:timezone}).format(new Date());}
  catch{throw problem("BUSINESS_LIVE_TIMEZONE_INVALID","Fuseau horaire invalide");}
  return timezone;
}
function parseTime(value){
  const raw=String(value||"09:00").trim(),m=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw);
  if(!m)throw problem("BUSINESS_LIVE_TIME_INVALID","Heure invalide");
  return raw;
}
function parseDate(value,fallback){
  const raw=String(value||fallback||"").trim(),m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if(!m)throw problem("BUSINESS_LIVE_ANCHOR_DATE_INVALID","Date de départ invalide");
  const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]),dt=new Date(Date.UTC(y,mo-1,d));
  if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==mo-1||dt.getUTCDate()!==d)throw problem("BUSINESS_LIVE_ANCHOR_DATE_INVALID","Date de départ invalide");
  return raw;
}
function partsAt(instant,timezone){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(instant);
  const out={};for(const p of parts)if(p.type!=="literal")out[p.type]=Number(p.value);
  return {year:out.year,month:out.month,day:out.day,hour:out.hour,minute:out.minute,second:out.second};
}
function ymdString(p){return String(p.year).padStart(4,"0")+"-"+String(p.month).padStart(2,"0")+"-"+String(p.day).padStart(2,"0");}
function localScalar(p){return Date.UTC(p.year,p.month-1,p.day,p.hour||0,p.minute||0,p.second||0);}
function dateOnlyScalar(p){return Date.UTC(p.year,p.month-1,p.day);}
function addLocalDays(p,days){
  const d=new Date(Date.UTC(p.year,p.month-1,p.day+days));
  return {year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate()};
}
function addLocalMonths(p,months){
  const d=new Date(Date.UTC(p.year,p.month-1+months,1));
  return {year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:1};
}
function daysInMonth(year,month){return new Date(Date.UTC(year,month,0)).getUTCDate();}
function weekday(p){const d=new Date(Date.UTC(p.year,p.month-1,p.day)).getUTCDay();return d===0?7:d;}
function localToInstant(dateParts,time,timezone){
  const [hour,minute]=time.split(":").map(Number),target={...dateParts,hour,minute,second:0},targetScalar=localScalar(target);
  let guess=targetScalar,seen=new Set(),bestAfter=null;
  for(let i=0;i<8;i++){
    const key=String(guess);if(seen.has(key))break;seen.add(key);
    const observed=partsAt(new Date(guess),timezone),observedScalar=localScalar(observed),delta=targetScalar-observedScalar;
    if(observedScalar===targetScalar)return new Date(guess);
    if(observedScalar>targetScalar&&(!bestAfter||observedScalar-targetScalar<bestAfter.diff))bestAfter={guess,diff:observedScalar-targetScalar};
    guess+=delta;
  }
  if(bestAfter)return new Date(bestAfter.guess);
  return new Date(guess);
}
function scheduleShape(row){
  if(!row)return null;
  return {
    id:row.id==null?null:Number(row.id),
    scope:String(row.scope||""),
    tenant_id:row.tenant_id==null?null:Number(row.tenant_id),
    enabled:row.enabled===true,
    frequency:String(row.frequency||"daily"),
    time:String(row.local_time||row.time||"09:00").slice(0,5),
    timezone:String(row.timezone||"Europe/Paris"),
    weekday:row.weekday==null?null:Number(row.weekday),
    month_day:row.month_day==null?null:Number(row.month_day),
    interval_days:row.interval_days==null?null:Number(row.interval_days),
    anchor_date:row.anchor_date?String(row.anchor_date).slice(0,10):null,
    next_run_at:row.next_run_at?new Date(row.next_run_at).toISOString():null,
    last_run_at:row.last_run_at?new Date(row.last_run_at).toISOString():null,
    run_count:Number(row.run_count||0),
    last_error:row.last_error||null,
    updated_at:row.updated_at?new Date(row.updated_at).toISOString():null
  };
}

export function normalizeBusinessLiveSchedule(input={},defaults={}){
  const timezone=validTimezone(input.timezone||defaults.timezone||"Europe/Paris");
  const now=defaults.now instanceof Date?defaults.now:new Date(defaults.now||Date.now());
  const localNow=partsAt(now,timezone);
  const enabled=input.enabled!==false;
  const frequency=String(input.frequency||defaults.frequency||"daily").trim();
  if(!FREQUENCIES.has(frequency))throw problem("BUSINESS_LIVE_FREQUENCY_INVALID","Fréquence invalide");
  const time=parseTime(input.time||input.local_time||defaults.time||"09:00");
  let weekdayValue=null,monthDay=null,intervalDays=null,anchorDate=null;
  if(frequency==="weekly"){
    weekdayValue=Number(input.weekday??defaults.weekday??1);
    if(!WEEKDAYS.has(weekdayValue))throw problem("BUSINESS_LIVE_WEEKDAY_INVALID","Jour de semaine invalide");
  }
  if(frequency==="monthly"){
    monthDay=Number(input.month_day??defaults.month_day??1);
    if(!Number.isInteger(monthDay)||monthDay<1||monthDay>31)throw problem("BUSINESS_LIVE_MONTH_DAY_INVALID","Jour du mois invalide");
  }
  if(frequency==="interval_days"){
    intervalDays=Number(input.interval_days??defaults.interval_days??30);
    if(!Number.isInteger(intervalDays)||intervalDays<1||intervalDays>3650)throw problem("BUSINESS_LIVE_INTERVAL_INVALID","Intervalle invalide");
    anchorDate=parseDate(input.anchor_date||defaults.anchor_date,ymdString(localNow));
  }
  return {enabled,frequency,time,timezone,weekday:weekdayValue,month_day:monthDay,interval_days:intervalDays,anchor_date:anchorDate};
}

export function nextBusinessLiveRun(input,after=new Date()){
  const schedule=normalizeBusinessLiveSchedule(input,{now:after});
  if(!schedule.enabled)return null;
  const from=after instanceof Date?after:new Date(after);
  if(!Number.isFinite(from.getTime()))throw problem("BUSINESS_LIVE_AFTER_INVALID","Date de calcul invalide");
  const local=partsAt(from,schedule.timezone);
  let targetDate={year:local.year,month:local.month,day:local.day};
  let candidate;
  if(schedule.frequency==="daily"){
    candidate=localToInstant(targetDate,schedule.time,schedule.timezone);
    if(candidate.getTime()<=from.getTime())candidate=localToInstant(addLocalDays(targetDate,1),schedule.time,schedule.timezone);
  }else if(schedule.frequency==="weekly"){
    let delta=(schedule.weekday-weekday(targetDate)+7)%7;
    candidate=localToInstant(addLocalDays(targetDate,delta),schedule.time,schedule.timezone);
    if(candidate.getTime()<=from.getTime())candidate=localToInstant(addLocalDays(targetDate,delta+7),schedule.time,schedule.timezone);
  }else if(schedule.frequency==="monthly"){
    const make=(base)=>localToInstant({year:base.year,month:base.month,day:Math.min(schedule.month_day,daysInMonth(base.year,base.month))},schedule.time,schedule.timezone);
    candidate=make(targetDate);
    if(candidate.getTime()<=from.getTime())candidate=make(addLocalMonths(targetDate,1));
  }else{
    const [ay,am,ad]=schedule.anchor_date.split("-").map(Number),anchor={year:ay,month:am,day:ad};
    const diff=Math.floor((dateOnlyScalar(targetDate)-dateOnlyScalar(anchor))/86400000);
    let k=diff<=0?0:Math.floor(diff/schedule.interval_days);
    let date=addLocalDays(anchor,k*schedule.interval_days);
    candidate=localToInstant(date,schedule.time,schedule.timezone);
    if(candidate.getTime()<=from.getTime()){k++;date=addLocalDays(anchor,k*schedule.interval_days);candidate=localToInstant(date,schedule.time,schedule.timezone);}
  }
  return candidate;
}

export function businessLiveScheduleFromRow(row){return scheduleShape(row);}
