import {createHash,createHmac,randomBytes,randomInt} from "node:crypto";

const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SENDER_LOCAL=Object.freeze({
  notifications:"notifications",
  billing:"facturation",
  support:"support"
});

export function normalizeEmail(value){
  const email=String(value||"").trim().toLowerCase();
  if(email.length>320||!EMAIL_RE.test(email))throw providerError("INVALID_EMAIL_RECIPIENT",400);
  return email;
}

export function emailHash(value){
  return createHash("sha256").update(normalizeEmail(value)).digest("hex");
}

export function createEmailVerificationChallenge(config,existingToken=null,nowMs=Date.now()){
  const token=existingToken||randomBytes(32).toString("base64url");
  const code=String(randomInt(0,1000000)).padStart(6,"0");
  const ttlMs=Number(config.emailVerificationTtlMinutes||10)*60000;
  const resendMs=Number(config.emailVerificationResendSeconds||60)*1000;
  return {
    token,
    code,
    record:{
      required:true,
      token_hash:verificationTokenHash(token),
      code_hash:emailVerificationCodeHash(config,token,code),
      expires_at:new Date(nowMs+ttlMs).toISOString(),
      resend_after:new Date(nowMs+resendMs).toISOString(),
      attempts:0,
      sent_at:new Date(nowMs).toISOString()
    }
  };
}

export function verificationTokenHash(token){
  return createHash("sha256").update(String(token||"")).digest("hex");
}

export function emailVerificationCodeHash(config,token,code){
  const pepper=String(config.emailVerificationPepper||"");
  if(pepper.length<32)throw new Error("EMAIL_VERIFICATION_PEPPER_NOT_CONFIGURED");
  return createHmac("sha256",pepper).update(String(token||"")+":"+String(code||"")).digest("hex");
}

export async function sendResendVerificationCode(config,{email,name,code,idempotencyKey}){
  if(!config.emailVerificationEnabled)throw providerError("EMAIL_VERIFICATION_DISABLED");
  return sendTransactionalEmail(config,{
    to:email,
    name,
    senderRole:"notifications",
    templateKey:"email_verification",
    data:{code,ttl_minutes:Number(config.emailVerificationTtlMinutes||10)},
    idempotencyKey,
    internalEventId:idempotencyKey
  });
}

export async function sendTransactionalEmail(config,options={}){
  if(!config.resendApiKey)throw providerError("RESEND_NOT_CONFIGURED");
  const to=normalizeEmail(options.to);
  const senderRole=SENDER_LOCAL[options.senderRole]?options.senderRole:"notifications";
  const domain=String(config.transactionalDomain||"").trim().toLowerCase();
  if(!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain))throw providerError("RESEND_SENDER_NOT_CONFIGURED");
  const local=SENDER_LOCAL[senderRole];
  const fromEmail=local+"@"+domain;
  const replyTo=normalizeEmail(config.transactionalReplyTo||config.internalNotificationEmail||fromEmail);
  const message=buildTransactionalMessage(config,options.templateKey,options.data||{});
  const eventId=String(options.internalEventId||options.idempotencyKey||"").trim().slice(0,180);
  const idem=safeIdempotencyKey(options.idempotencyKey||eventId||("email-"+Date.now()));
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),Number(config.resendTimeoutMs||8000));
  const body={
    from:(config.transactionalFromName||"Audiotel Premium Pro")+" <"+fromEmail+">",
    to:[to],
    reply_to:replyTo,
    subject:message.subject,
    text:message.text,
    html:message.html,
    headers:eventId?{"X-PGI-Event-ID":eventId}:{},
    tags:[
      {name:"category",value:safeTag(String(options.templateKey||"transactional"))},
      {name:"sender",value:safeTag(senderRole)}
    ]
  };
  try{
    const response=await fetch("https://api.resend.com/emails",{
      method:"POST",
      headers:{
        accept:"application/json",
        authorization:"Bearer "+config.resendApiKey,
        "content-type":"application/json",
        "idempotency-key":idem
      },
      body:JSON.stringify(body),
      signal:controller.signal
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw providerError("RESEND_SEND_FAILED",response.status,safeProviderCode(payload));
    return {message_id:String(payload.id||"")||null,idempotency_key:idem};
  }catch(error){
    if(error?.code)throw error;
    throw providerError(error?.name==="AbortError"?"RESEND_TIMEOUT":"RESEND_SEND_FAILED");
  }finally{
    clearTimeout(timeout);
  }
}

export function buildTransactionalMessage(config,templateKey,data={}){
  const key=String(templateKey||"").trim();
  const name=cleanText(data.name||"",120);
  const firstName=name?name.split(/\s+/)[0]:"";
  const greeting=firstName?"Bonjour "+firstName+",":"Bonjour,";
  const portalUrl=sameOriginUrl(config,"/client.html");
  const billingUrl=sameOriginUrl(config,"/client.html?billing=payment-required");
  const logoUrl=sameOriginUrl(config,"/assets/audiotel-brand-logo-v33.png");
  const homeUrl=sameOriginUrl(config,"/");
  const cases={
    email_verification:{
      subject:"Votre code de vérification Audiotel Premium Pro",
      title:"Vérification de votre adresse e-mail",
      lead:greeting,
      paragraphs:["Utilisez le code ci-dessous pour confirmer votre adresse e-mail et poursuivre la création de votre espace Audiotel Premium Pro."],
      code:String(data.code||""),
      foot:"Ce code expire dans "+Number(data.ttl_minutes||10)+" minutes. Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail."
    },
    registration_received:{
      subject:"Votre demande d’ouverture a bien été reçue",
      title:"Demande d’ouverture enregistrée",
      lead:greeting,
      paragraphs:["Votre demande d’ouverture Audiotel Premium Pro a bien été enregistrée.","Vous pouvez suivre les étapes de votre dossier depuis votre espace client. La création du compte ne vaut pas activation d’un service SVA."],
      cta:{label:"Accéder à mon espace",url:portalUrl}
    },
    registration_internal:{
      subject:"Nouvelle demande d’ouverture Audiotel Premium Pro",
      title:"Nouvelle demande d’ouverture",
      lead:"Une nouvelle demande a été enregistrée.",
      paragraphs:[safeDetail("Compte",data.tenant_name),safeDetail("Pays",data.country_code),safeDetail("Type",data.account_type),safeDetail("Besoin",data.service_intent)].filter(Boolean)
    },
    account_activated:{
      subject:"Votre compte Audiotel Premium Pro est activé",
      title:"Compte activé",
      lead:greeting,
      paragraphs:["Votre compte Audiotel Premium Pro est désormais actif.","L’accès aux fonctions SVA reste conditionné aux contrôles techniques, contractuels et réglementaires applicables."],
      cta:{label:"Ouvrir mon espace client",url:portalUrl}
    },
    account_suspended:{
      subject:"Mise à jour importante concernant votre compte",
      title:"Accès au compte mis à jour",
      lead:greeting,
      paragraphs:["Le statut de votre compte a été placé en suspension.","Vos données ne sont pas supprimées. Connectez-vous à votre espace client pour consulter la situation et les actions disponibles."],
      cta:{label:"Consulter mon espace",url:portalUrl}
    },
    subscription_created:{
      subject:"Abonnement Audiotel Premium Pro créé",
      title:"Abonnement enregistré",
      lead:greeting,
      paragraphs:["Votre abonnement Audiotel Premium Pro a été enregistré.","La facturation de la plateforme est distincte des reversements liés au trafic SVA."],
      cta:{label:"Consulter la facturation",url:billingUrl}
    },
    payment_succeeded:{
      subject:"Paiement Audiotel Premium Pro confirmé",
      title:"Paiement confirmé",
      lead:greeting,
      paragraphs:["Votre paiement d’abonnement a été confirmé.","Aucune action n’est nécessaire de votre part."],
      cta:{label:"Consulter la facturation",url:billingUrl}
    },
    payment_recovered:{
      subject:"Paiement Audiotel Premium Pro régularisé",
      title:"Paiement régularisé",
      lead:greeting,
      paragraphs:["Le paiement précédemment en attente est maintenant régularisé.","Votre état de facturation a été mis à jour automatiquement."],
      cta:{label:"Consulter la facturation",url:billingUrl}
    },
    payment_failed:{
      subject:"Action requise : paiement Audiotel Premium Pro non abouti",
      title:"Paiement à régulariser",
      lead:greeting,
      paragraphs:["Le dernier paiement de votre abonnement n’a pas abouti.","Votre compte et vos données sont conservés. Utilisez votre espace client pour ouvrir le portail de facturation sécurisé et mettre à jour votre moyen de paiement."],
      cta:{label:"Régulariser ma facturation",url:billingUrl}
    },
    payment_action_required:{
      subject:"Action requise pour finaliser votre paiement Audiotel Premium Pro",
      title:"Validation de paiement requise",
      lead:greeting,
      paragraphs:["Votre prestataire de paiement demande une action supplémentaire pour finaliser le règlement.","Connectez-vous à votre espace client pour poursuivre via le portail Stripe sécurisé."],
      cta:{label:"Finaliser le paiement",url:billingUrl}
    },
    payment_reminder:{
      subject:"Rappel : régularisation de votre abonnement Audiotel Premium Pro",
      title:"Rappel de régularisation",
      lead:greeting,
      paragraphs:["Votre abonnement reste en attente de régularisation.","Le service existant peut rester disponible pendant le délai de récupération prévu, mais certaines fonctions pourront être suspendues à son échéance."],
      cta:{label:"Régulariser ma facturation",url:billingUrl}
    },
    subscription_suspended:{
      subject:"Abonnement Audiotel Premium Pro suspendu",
      title:"Abonnement suspendu",
      lead:greeting,
      paragraphs:["Le délai de régularisation est arrivé à échéance et les fonctions payantes peuvent être suspendues.","Votre compte et vos données restent conservés. La régularisation du paiement permet la reprise selon les règles du service."],
      cta:{label:"Régulariser ma facturation",url:billingUrl}
    },
    subscription_cancelled:{
      subject:"Résiliation de votre abonnement Audiotel Premium Pro",
      title:"Abonnement résilié",
      lead:greeting,
      paragraphs:["La résiliation de votre abonnement Audiotel Premium Pro a été enregistrée.","Votre compte n’est pas supprimé par cet e-mail. Les conditions de fin de service restent celles affichées dans votre espace client."],
      cta:{label:"Consulter mon espace",url:portalUrl}
    },
    payout_available:{
      subject:"Votre reversement Audiotel est disponible",
      title:"Reversement disponible",
      lead:greeting,
      paragraphs:["Un reversement issu du trafic SVA a franchi les contrôles nécessaires et est maintenant indiqué comme disponible dans votre espace client.","Le statut affiché dans votre espace reste la référence pour le suivi du règlement."],
      cta:{label:"Consulter mes reversements",url:portalUrl}
    },
    portability_received:{
      subject:"Votre demande de portabilité a été reçue",
      title:"Demande de portabilité enregistrée",
      lead:greeting,
      paragraphs:["Votre demande de portabilité a été enregistrée et sera traitée selon les contrôles applicables.","Aucun transfert n’est présenté comme réalisé tant que l’opérateur n’a pas confirmé la portabilité."],
      cta:{label:"Suivre ma demande",url:portalUrl}
    },
    portability_internal:{
      subject:"Nouvelle demande de portabilité",
      title:"Portabilité à traiter",
      lead:"Une nouvelle demande de portabilité a été enregistrée.",
      paragraphs:[safeDetail("Client",data.tenant_name),safeDetail("Pays",data.country_code)].filter(Boolean)
    },
    support_received:{
      subject:"Votre demande d’assistance a été reçue",
      title:"Demande d’assistance enregistrée",
      lead:greeting,
      paragraphs:["Votre demande a bien été enregistrée dans le centre de service.","Vous pouvez suivre son état dans votre espace client."],
      cta:{label:"Consulter le centre de service",url:portalUrl}
    },
    support_opened:{
      subject:"Un dossier d’assistance a été ouvert",
      title:"Dossier d’assistance ouvert",
      lead:greeting,
      paragraphs:["Un dossier d’assistance a été ouvert pour votre compte.","Consultez votre espace client pour suivre son évolution."],
      cta:{label:"Consulter le dossier",url:portalUrl}
    },
    support_internal:{
      subject:"Nouvelle demande d’assistance client",
      title:"Nouvelle demande d’assistance",
      lead:"Une nouvelle demande client nécessite un suivi.",
      paragraphs:[safeDetail("Client",data.tenant_name),safeDetail("Priorité",data.severity)].filter(Boolean)
    },
    support_customer_reply:{
      subject:"Nouveau message client dans un dossier d’assistance",
      title:"Nouveau message client",
      lead:"Un client a ajouté un message à un dossier d’assistance.",
      paragraphs:[safeDetail("Client",data.tenant_name)].filter(Boolean)
    },
    support_response:{
      subject:"Nouvelle réponse à votre demande d’assistance",
      title:"Votre dossier a été mis à jour",
      lead:greeting,
      paragraphs:["Une nouvelle réponse est disponible dans votre dossier d’assistance.","Pour protéger les informations du dossier, le contenu complet reste consultable dans votre espace sécurisé."],
      cta:{label:"Consulter la réponse",url:portalUrl}
    },
    support_resolved:{
      subject:"Votre demande d’assistance a été résolue",
      title:"Dossier résolu",
      lead:greeting,
      paragraphs:["Votre dossier d’assistance a été marqué comme résolu.","L’historique reste disponible dans votre espace client."],
      cta:{label:"Consulter le dossier",url:portalUrl}
    }
  };
  const model=cases[key];
  if(!model)throw providerError("EMAIL_TEMPLATE_NOT_FOUND",500);
  return renderMessage(model,{logoUrl,homeUrl});
}

function renderMessage(model,brand={}){
  const subject=cleanText(model.subject,180);
  const lead=cleanText(model.lead,300);
  const paragraphs=(model.paragraphs||[]).map(x=>cleanText(x,1200)).filter(Boolean);
  const text=[
    model.title,lead,...paragraphs,
    model.code?"Code : "+cleanText(model.code,20):"",
    model.cta?.url?(cleanText(model.cta.label,120)+": "+model.cta.url):"",
    model.foot||"",
    "Audiotel Premium Pro | Une solution PGI Telecom"
  ].filter(Boolean).join("\n\n");
  const paragraphHtml=paragraphs.map(p=>'<p style="margin:0 0 14px;line-height:1.6;color:#332a25">'+escapeHtml(p)+'</p>').join("");
  const codeHtml=model.code?'<div style="font-size:34px;font-weight:700;letter-spacing:8px;text-align:center;padding:20px 10px;margin:20px 0;background:#f5f1ed;border-radius:12px;color:#1f1713">'+escapeHtml(cleanText(model.code,20))+'</div>':"";
  const ctaHtml=model.cta?.url?'<p style="margin:24px 0"><a href="'+escapeHtml(model.cta.url)+'" style="display:inline-block;background:#33251f;color:#fff;text-decoration:none;padding:13px 18px;border-radius:9px;font-weight:700">'+escapeHtml(cleanText(model.cta.label,120))+'</a></p>':"";
  const footHtml=model.foot?'<p style="font-size:13px;line-height:1.5;color:#6c6059;margin:24px 0 0">'+escapeHtml(cleanText(model.foot,1000))+'</p>':"";
  const logoHtml=brand.logoUrl?'<div style="text-align:center;margin:0 0 18px"><a href="'+escapeHtml(brand.homeUrl||brand.logoUrl)+'" target="_blank" rel="noopener noreferrer" style="text-decoration:none"><img src="'+escapeHtml(brand.logoUrl)+'" width="180" alt="Audiotel Premium Pro" style="display:inline-block;width:180px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none"></a></div>':"";
  const html='<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@media only screen and (max-width:600px){.pgi-wrap{padding:12px!important}.pgi-card{padding:20px!important}.pgi-title{font-size:22px!important}.pgi-btn{display:block!important;text-align:center!important}}</style></head><body style="margin:0;background:#f4f1ee;font-family:Arial,Helvetica,sans-serif;color:#221914"><div class="pgi-wrap" style="padding:28px 12px"><div class="pgi-card" style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #ded6d0;border-radius:14px;padding:30px">'+logoHtml+'<div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#78675d;margin-bottom:12px;text-align:center">Audiotel Premium Pro</div><h1 class="pgi-title" style="font-size:26px;line-height:1.25;margin:0 0 18px;color:#211812">'+escapeHtml(cleanText(model.title,180))+'</h1><p style="margin:0 0 14px;line-height:1.6;color:#332a25">'+escapeHtml(lead)+'</p>'+paragraphHtml+codeHtml+ctaHtml+footHtml+'<hr style="border:0;border-top:1px solid #ece6e2;margin:28px 0 16px"><p style="font-size:12px;line-height:1.5;color:#81736a;margin:0 0 8px">Audiotel Premium Pro | Une solution PGI Telecom</p><p style="font-size:12px;line-height:1.5;color:#81736a;margin:0">Message transactionnel lié à votre compte ou à une demande de service. Aucun mot de passe ne vous sera demandé par e-mail.</p></div></div></body></html>';
  return {subject,text,html};
}

function sameOriginUrl(config,path){
  const base=String(config.publicBaseUrl||"").replace(/\/$/,"");
  if(!/^https:\/\/[^/]+$/i.test(base))throw providerError("PUBLIC_BASE_URL_NOT_CONFIGURED",500);
  const url=new URL(path,base+"/");
  if(url.origin!==base)throw providerError("EMAIL_LINK_ORIGIN_INVALID",500);
  return url.toString();
}
function safeDetail(label,value){
  const v=cleanText(value||"",200);
  return v?cleanText(label,80)+" : "+v:"";
}
function cleanText(value,max=500){
  return String(value??"").replace(/[\u0000-\u001f\u007f]+/g," ").replace(/\s+/g," ").trim().slice(0,max);
}
function escapeHtml(value){
  return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function safeTag(value){
  const v=String(value||"").toLowerCase().replace(/[^a-z0-9_-]+/g,"_").replace(/^_+|_+$/g,"").slice(0,50);
  return v||"transactional";
}
function safeIdempotencyKey(value){
  const v=String(value||"").replace(/[^A-Za-z0-9_./:-]+/g,"_").slice(0,256);
  if(!v)throw providerError("INVALID_EMAIL_IDEMPOTENCY_KEY",400);
  return v;
}
function safeProviderCode(payload){
  const code=String(payload?.name||payload?.code||payload?.error?.name||"").replace(/[^A-Za-z0-9_.:-]+/g,"_").slice(0,120);
  return code||null;
}
function providerError(code,status=503,providerCode=null){
  const e=new Error(code);e.code=code;e.status=status;e.provider_code=providerCode;return e;
}
