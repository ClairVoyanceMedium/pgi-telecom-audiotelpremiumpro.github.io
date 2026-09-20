import {createHash} from "node:crypto";

const TYPES=new Set(["announcement","tts","menu","direct_dial","schedule","route","queue","weighted_split","recording_consent","access_control","language","voicemail","terminate"]);
const NEXT_FIELDS=["next","open_next","closed_next","timeout_next","invalid_next","overflow_next","blocked_next","allowed_next","fallback_next","failover_next","consent_next","decline_next"];
const URI=/^(?:tel:\+[1-9][0-9]{6,14}|sips?:[^\s@]+@[^\s@]+)$/i;
const NODE_ID=/^[a-z][a-z0-9_-]{0,63}$/i;
const LOCALE=/^[a-z]{2,3}(?:-[A-Z]{2})?$/;
const TIME=/^(?:[01]\d|2[0-3]):[0-5]\d$/;

function text(value,max=1500){return String(value??"").trim().slice(0,max);}
function integer(value,fallback,min,max){const n=Number(value);return Number.isInteger(n)&&n>=min&&n<=max?n:fallback;}
function uniqueStrings(values,max=500,itemMax=80){return [...new Set((Array.isArray(values)?values:[]).map(x=>text(x,itemMax)).filter(Boolean))].slice(0,max);}
function clone(value){return JSON.parse(JSON.stringify(value==null?{}:value));}
function problem(code,message){const e=new Error(message||code);e.status=400;e.code=code;throw e;}

export function defaultVoiceFlow(input={}){
  const locale=LOCALE.test(String(input.locale||""))?String(input.locale):"fr-FR";
  const destination=URI.test(String(input.destination_uri||""))?String(input.destination_uri):"";
  const overflow=URI.test(String(input.overflow_uri||""))?String(input.overflow_uri):destination;
  return {
    schema_version:1,
    entry:"welcome",
    default_locale:locale,
    max_steps:50,
    max_call_minutes:integer(input.max_call_minutes,30,1,180),
    anti_abuse:{calls_per_10m:integer(input.calls_per_10m,30,1,1000),block_anonymous:Boolean(input.block_anonymous)},
    recording:{policy:"off",consent_required:true,retention_days:30},
    nodes:[
      {id:"welcome",type:"tts",text:text(input.greeting||"Bienvenue. Votre appel va être orienté.",1500),locale,next:"schedule"},
      {id:"schedule",type:"schedule",timezone:text(input.timezone||"Europe/Paris",80),weekly:[{days:[1,2,3,4,5],start:"09:00",end:"18:00"}],holidays:[],open_next:"menu",closed_next:"closed"},
      {id:"menu",type:"menu",prompt:"Tapez 1 pour être mis en relation, 2 pour laisser un message.",timeout_seconds:6,max_retries:2,choices:[{digit:"1",label:"Mise en relation",next:"queue"},{digit:"2",label:"Message",next:"voicemail"}],timeout_next:"queue",invalid_next:"menu"},
      {id:"queue",type:"queue",strategy:"least_busy",ring_seconds:25,destination_uris:[destination],overflow_next:"overflow"},
      {id:"overflow",type:"route",destination_uri:overflow,failover_next:"voicemail"},
      {id:"voicemail",type:"voicemail",max_seconds:120,next:"end"},
      {id:"closed",type:"tts",text:"Le service est actuellement fermé. Vous pouvez laisser un message.",locale,next:"voicemail"},
      {id:"end",type:"terminate",reason:"normal"}
    ]
  };
}

export function normalizeVoiceFlow(value={}){
  const flow=clone(value);
  flow.schema_version=integer(flow.schema_version,1,1,10);
  flow.entry=text(flow.entry,64);
  flow.default_locale=LOCALE.test(String(flow.default_locale||""))?String(flow.default_locale):"fr-FR";
  flow.max_steps=integer(flow.max_steps,50,5,100);
  flow.max_call_minutes=integer(flow.max_call_minutes,30,1,180);
  flow.anti_abuse={
    calls_per_10m:integer(flow.anti_abuse?.calls_per_10m,30,1,1000),
    block_anonymous:Boolean(flow.anti_abuse?.block_anonymous)
  };
  const policy=["off","on_demand","always"].includes(flow.recording?.policy)?flow.recording.policy:"off";
  const purpose=["quality","training","contract_evidence","other"].includes(flow.recording?.purpose)?flow.recording.purpose:"quality";
  flow.recording={policy,purpose,consent_required:flow.recording?.consent_required!==false,retention_days:integer(flow.recording?.retention_days,30,1,365)};
  flow.nodes=(Array.isArray(flow.nodes)?flow.nodes:[]).slice(0,200).map(raw=>{
    const n=clone(raw);n.id=text(n.id,64);n.type=text(n.type,40);
    if(n.text!=null)n.text=text(n.text,1500);
    if(n.prompt!=null)n.prompt=text(n.prompt,1500);
    if(n.locale!=null)n.locale=text(n.locale,20);
    if(n.destination_uri!=null)n.destination_uri=text(n.destination_uri,512);
    if(Array.isArray(n.destination_uris))n.destination_uris=uniqueStrings(n.destination_uris,50,512);
    if(n.type==="direct_dial"){
      n.min_digits=integer(n.min_digits,1,1,6);n.max_digits=integer(n.max_digits,6,1,6);n.timeout_seconds=integer(n.timeout_seconds,6,1,30);
      n.codes=(Array.isArray(n.codes)?n.codes:[]).slice(0,100).map(raw=>({code:text(raw?.code,6),label:text(raw?.label,120),destination_uri:text(raw?.destination_uri,512),next:text(raw?.next,64)}));
    }
    if(Array.isArray(n.blacklist))n.blacklist=uniqueStrings(n.blacklist,500,80);
    if(Array.isArray(n.whitelist))n.whitelist=uniqueStrings(n.whitelist,500,80);
    return n;
  });
  return flow;
}

export function validateVoiceFlow(input={}){
  const flow=normalizeVoiceFlow(input),errors=[],warnings=[],ids=new Set(),refs=[];
  if(!flow.nodes.length)errors.push({code:"VOICE_FLOW_EMPTY",message:"Le parcours vocal ne contient aucune étape."});
  if(flow.nodes.length>200)errors.push({code:"VOICE_FLOW_TOO_LARGE",message:"Le parcours dépasse 200 étapes."});
  for(const n of flow.nodes){
    if(!NODE_ID.test(n.id))errors.push({code:"VOICE_NODE_ID_INVALID",node:n.id,message:"Identifiant d’étape invalide."});
    if(ids.has(n.id))errors.push({code:"VOICE_NODE_ID_DUPLICATE",node:n.id,message:"Identifiant d’étape dupliqué."});
    ids.add(n.id);
    if(!TYPES.has(n.type))errors.push({code:"VOICE_NODE_TYPE_INVALID",node:n.id,message:"Type d’étape non autorisé."});
    for(const key of NEXT_FIELDS)if(n[key])refs.push([n.id,key,String(n[key])]);
    if(n.type==="tts"||n.type==="announcement"){
      if(!text(n.text))errors.push({code:"VOICE_PROMPT_REQUIRED",node:n.id,message:"Un texte ou une annonce est requis."});
      if(n.locale&&!LOCALE.test(n.locale))errors.push({code:"VOICE_LOCALE_INVALID",node:n.id,message:"Langue invalide."});
    }
    if(n.type==="menu"){
      const choices=Array.isArray(n.choices)?n.choices:[],digits=new Set();
      if(!choices.length)errors.push({code:"VOICE_MENU_EMPTY",node:n.id,message:"Le menu doit contenir au moins un choix."});
      for(const ch of choices){
        const digit=String(ch.digit||"");
        if(!/^[0-9*#]$/.test(digit))errors.push({code:"VOICE_DTMF_INVALID",node:n.id,message:"Touche de menu invalide."});
        if(digits.has(digit))errors.push({code:"VOICE_DTMF_DUPLICATE",node:n.id,message:"Une touche est utilisée plusieurs fois."});
        digits.add(digit);if(ch.next)refs.push([n.id,"choice:"+digit,String(ch.next)]);
      }
    }
    if(n.type==="direct_dial"){
      const codes=Array.isArray(n.codes)?n.codes:[],seen=new Set();
      if(!text(n.prompt))errors.push({code:"VOICE_DIRECT_PROMPT_REQUIRED",node:n.id,message:"Une annonce de saisie du code est requise."});
      if(!codes.length)errors.push({code:"VOICE_DIRECT_CODES_EMPTY",node:n.id,message:"Ajoutez au moins un code direct."});
      if(Number(n.min_digits)>Number(n.max_digits))errors.push({code:"VOICE_DIRECT_DIGIT_RANGE_INVALID",node:n.id,message:"La longueur minimale du code dépasse la longueur maximale."});
      for(const item of codes){
        const code=String(item.code||"");
        if(!/^[0-9]{1,6}$/.test(code))errors.push({code:"VOICE_DIRECT_CODE_INVALID",node:n.id,message:"Un code direct doit contenir de 1 à 6 chiffres."});
        if(seen.has(code))errors.push({code:"VOICE_DIRECT_CODE_DUPLICATE",node:n.id,message:"Un code direct est utilisé plusieurs fois."});
        seen.add(code);
        if(item.destination_uri&&!URI.test(String(item.destination_uri)))errors.push({code:"VOICE_DIRECT_URI_INVALID",node:n.id,message:"Destination d’un code direct invalide."});
        if(item.next)refs.push([n.id,"code:"+code,String(item.next)]);else errors.push({code:"VOICE_DIRECT_TARGET_REQUIRED",node:n.id,message:"Chaque code direct doit cibler une étape."});
      }
    }
    if(n.type==="route"&& !URI.test(String(n.destination_uri||"")))errors.push({code:"VOICE_ROUTE_URI_INVALID",node:n.id,message:"Destination de routage invalide."});
    if(n.type==="queue"){
      const uris=Array.isArray(n.destination_uris)?n.destination_uris:[];
      if(!uris.length)errors.push({code:"VOICE_QUEUE_EMPTY",node:n.id,message:"La file doit contenir au moins une destination."});
      for(const uri of uris)if(!URI.test(String(uri)))errors.push({code:"VOICE_QUEUE_URI_INVALID",node:n.id,message:"Destination de file invalide."});
    }
    if(n.type==="weighted_split"){
      const branches=Array.isArray(n.branches)?n.branches:[],total=branches.reduce((s,b)=>s+Number(b.weight||0),0);
      if(!branches.length||Math.abs(total-100)>0.001)errors.push({code:"VOICE_SPLIT_WEIGHT_INVALID",node:n.id,message:"La répartition pondérée doit totaliser 100 %."});
      for(const b of branches)if(b.next)refs.push([n.id,"branch",String(b.next)]);
    }
    if(n.type==="language"){
      const branches=Array.isArray(n.branches)?n.branches:[];
      if(!branches.length)errors.push({code:"VOICE_LANGUAGE_EMPTY",node:n.id,message:"Le choix de langue doit contenir au moins une branche."});
      for(const b of branches){if(!LOCALE.test(String(b.locale||"")))errors.push({code:"VOICE_LOCALE_INVALID",node:n.id,message:"Langue invalide."});if(b.next)refs.push([n.id,"language",String(b.next)]);}
    }
    if(n.type==="schedule"){
      const weekly=Array.isArray(n.weekly)?n.weekly:[];
      for(const slot of weekly){
        if(!TIME.test(String(slot.start||""))||!TIME.test(String(slot.end||"")))errors.push({code:"VOICE_SCHEDULE_TIME_INVALID",node:n.id,message:"Horaire invalide."});
        if(!(Array.isArray(slot.days)&&slot.days.every(d=>Number.isInteger(Number(d))&&Number(d)>=1&&Number(d)<=7)))errors.push({code:"VOICE_SCHEDULE_DAY_INVALID",node:n.id,message:"Jour d’ouverture invalide."});
      }
    }
    if(n.type==="recording_consent"&&flow.recording.policy!=="off"&&!text(n.text||n.consent_text))warnings.push({code:"VOICE_RECORDING_CONSENT_TEXT_RECOMMENDED",node:n.id,message:"Ajouter une annonce de consentement avant enregistrement."});
  }
  if(flow.entry&&!ids.has(flow.entry))errors.push({code:"VOICE_ENTRY_NOT_FOUND",message:"L’étape d’entrée n’existe pas."});
  for(const [node,key,target] of refs)if(!ids.has(target))errors.push({code:"VOICE_TARGET_NOT_FOUND",node,field:key,target,message:"Une transition cible une étape inexistante."});
  if(flow.recording.policy!=="off"&&!flow.recording.consent_required)errors.push({code:"VOICE_RECORDING_NOTICE_REQUIRED",message:"Une annonce d’information est obligatoire avant enregistrement."});
  if(flow.recording.policy!=="off"&&!flow.nodes.some(n=>n.type==="recording_consent"))errors.push({code:"VOICE_RECORDING_NODE_REQUIRED",message:"Le parcours doit contenir une étape d’information avant enregistrement."});
  if(flow.recording.policy!=="off"&&["quality","training"].includes(flow.recording.purpose)&&flow.recording.retention_days>180)errors.push({code:"VOICE_RECORDING_RETENTION_TOO_LONG",message:"Pour la qualité ou la formation, la conservation active ne doit pas dépasser 180 jours."});
  const featureTypes=[...new Set(flow.nodes.map(n=>n.type))];
  return {valid:errors.length===0,errors,warnings,node_count:flow.nodes.length,features:featureTypes,flow};
}

function minutesOf(value){const [h,m]=String(value||"00:00").split(":").map(Number);return h*60+m;}
function isOpenSchedule(node,at){
  const d=new Date(at);if(Number.isNaN(d.getTime()))return true;
  const zone=text(node.timezone||"UTC",80)||"UTC",days={Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6,Sun:7};
  let parts;try{parts=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:zone,weekday:"short",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(d).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));}catch(_e){parts={weekday:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getUTCDay()],year:String(d.getUTCFullYear()),month:String(d.getUTCMonth()+1).padStart(2,"0"),day:String(d.getUTCDate()).padStart(2,"0"),hour:String(d.getUTCHours()).padStart(2,"0"),minute:String(d.getUTCMinutes()).padStart(2,"0")};}
  const isoDay=days[parts.weekday]||1,minute=Number(parts.hour)*60+Number(parts.minute),localDate=parts.year+"-"+parts.month+"-"+parts.day;
  if((node.holidays||[]).includes(localDate))return false;
  return (node.weekly||[]).some(s=>(s.days||[]).map(Number).includes(isoDay)&&minute>=minutesOf(s.start)&&minute<minutesOf(s.end));
}

export function simulateVoiceFlow(input={},simulation={}){
  const checked=validateVoiceFlow(input);if(!checked.valid)return {...checked,dry_run:true,path:[],result:null};
  const flow=checked.flow,byId=new Map(flow.nodes.map(n=>[n.id,n])),digits=String(simulation.digits||"").split(""),path=[],max=flow.max_steps||50;
  const caller=text(simulation.caller_number,32),locale=text(simulation.locale||flow.default_locale,20),bucket=Math.max(0,Math.min(99,Number(simulation.bucket)||0));
  let id=flow.entry,result=null;
  for(let step=0;step<max&&id;step++){
    const n=byId.get(id);if(!n)break;path.push({id:n.id,type:n.type});
    if(n.type==="terminate"){result={action:"terminate",reason:n.reason||"normal"};break;}
    if(n.type==="route"){result={action:"route",destination_uri:n.destination_uri,failover_next:n.failover_next||null};break;}
    if(n.type==="queue"){result={action:"queue",strategy:n.strategy||"least_busy",destination_uris:n.destination_uris||[],ring_seconds:integer(n.ring_seconds,25,5,120),overflow_next:n.overflow_next||null};break;}
    if(n.type==="voicemail"){result={action:"voicemail",max_seconds:integer(n.max_seconds,120,15,600)};break;}
    if(n.type==="schedule"){id=isOpenSchedule(n,simulation.at||new Date().toISOString())?n.open_next:n.closed_next;continue;}
    if(n.type==="menu"){
      const digit=digits.shift()||"",choice=(n.choices||[]).find(x=>String(x.digit)===digit);
      id=choice?.next||n.timeout_next||n.invalid_next||n.next;continue;
    }
    if(n.type==="direct_dial"){
      const maxDigits=integer(n.max_digits,6,1,6),entered=digits.splice(0,maxDigits).join("").split("#")[0],selected=(n.codes||[]).find(x=>String(x.code)===entered);
      id=selected?.next||n.fallback_next||n.timeout_next||n.invalid_next||n.next;continue;
    }
    if(n.type==="weighted_split"){
      let acc=0,selected=null;for(const b of n.branches||[]){acc+=Number(b.weight||0);if(bucket<acc){selected=b;break;}}id=selected?.next||n.fallback_next;continue;
    }
    if(n.type==="language"){
      const selected=(n.branches||[]).find(x=>String(x.locale)===locale)||(n.branches||[])[0];id=selected?.next||n.fallback_next;continue;
    }
    if(n.type==="access_control"){
      const black=(n.blacklist||[]).some(x=>caller&&caller.startsWith(String(x))),white=(n.whitelist||[]).some(x=>caller&&caller.startsWith(String(x)));
      if(black&&!white)id=n.blocked_next||n.fallback_next;else id=n.allowed_next||n.next;continue;
    }
    id=n.next||n.consent_next||n.allowed_next||n.fallback_next||null;
  }
  if(!result&&path.length>=max)result={action:"safety_stop",reason:"max_steps"};
  return {...checked,dry_run:true,path,result};
}

export function voiceFlowChecksum(flow){
  return createHash("sha256").update(JSON.stringify(normalizeVoiceFlow(flow))).digest("hex");
}

export function normalizeVoiceServiceInput(input={}){
  const name=text(input.name,120);if(name.length<2)problem("VOICE_SERVICE_NAME_REQUIRED","Nom du service vocal requis.");
  const timezone=text(input.timezone||"Europe/Paris",80)||"Europe/Paris";
  const defaultLocale=LOCALE.test(String(input.default_locale||""))?String(input.default_locale):"fr-FR";
  const svaNumberId=input.sva_number_id==null||input.sva_number_id===""?null:Number(input.sva_number_id);
  if(svaNumberId!=null&&(!Number.isInteger(svaNumberId)||svaNumberId<=0))problem("INVALID_SVA_NUMBER_ID");
  const flow=normalizeVoiceFlow(input.flow&&typeof input.flow==="object"?input.flow:defaultVoiceFlow({timezone,locale:defaultLocale}));
  return {name,timezone,default_locale:defaultLocale,sva_number_id:svaNumberId,flow};
}
