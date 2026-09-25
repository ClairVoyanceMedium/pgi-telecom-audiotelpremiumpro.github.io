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

export async function sendResendVerificationCode(config,{email,name,code,locale,idempotencyKey}){
  if(!config.emailVerificationEnabled)throw providerError("EMAIL_VERIFICATION_DISABLED");
  return sendTransactionalEmail(config,{
    to:email,
    name,
    senderRole:"notifications",
    templateKey:"email_verification",
    data:{code,ttl_minutes:Number(config.emailVerificationTtlMinutes||10),locale},
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
    reply_to:"Audiotel Premium Pro Support <"+replyTo+">",
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
  const privacyUrl=sameOriginUrl(config,"/confidentialite/");
  const termsUrl=sameOriginUrl(config,"/conditions-abonnement/");
  const actionUrl=safeActionUrl(config,data.action_url);
  const invoiceUrl=safeExternalHttpsUrl(data.invoice_url,["stripe.com"]);
  const invoicePdfUrl=safeExternalHttpsUrl(data.invoice_pdf_url,["stripe.com"]);
  const cases={
    email_verification:{
      subject:"Votre code de vérification Audiotel Premium Pro",
      title:"Vérification de votre adresse email",
      lead:greeting,
      paragraphs:["Utilisez le code ci-dessous pour confirmer votre adresse email et poursuivre la création de votre espace Audiotel Premium Pro."],
      code:String(data.code||""),
      foot:"Ce code expire dans "+Number(data.ttl_minutes||10)+" minutes. Si vous n’êtes pas à l’origine de cette demande, ignorez cet email."
    },
    password_reset:{
      subject:"Réinitialisation de votre mot de passe Audiotel Premium Pro",
      title:"Réinitialiser votre mot de passe",
      lead:greeting,
      paragraphs:["Une demande de réinitialisation a été reçue pour votre compte.","Utilisez le bouton ci-dessous dans le délai indiqué. Si vous n’êtes pas à l’origine de cette demande, aucune action n’est nécessaire."],
      cta:actionUrl?{label:"Choisir un nouveau mot de passe",url:actionUrl}:null,
      foot:"Pour votre sécurité, ce lien est temporaire et ne peut être utilisé qu’une seule fois."
    },
    password_changed:{
      subject:"Votre mot de passe Audiotel Premium Pro a été modifié",
      title:"Mot de passe modifié",
      lead:greeting,
      paragraphs:["Le mot de passe de votre compte vient d’être modifié.","Toutes les sessions existantes sont invalidées. Si vous n’êtes pas à l’origine de cette modification, contactez immédiatement l’assistance."],
      cta:{label:"Accéder à mon espace",url:portalUrl}
    },
    email_change_confirmation:{
      subject:"Confirmez votre nouvelle adresse email Audiotel Premium Pro",
      title:"Confirmer votre nouvelle adresse email",
      lead:greeting,
      paragraphs:["Une modification de l’adresse email de votre compte a été demandée.","Confirmez cette nouvelle adresse avec le bouton ci-dessous. Le lien est temporaire et à usage unique."],
      cta:actionUrl?{label:"Confirmer mon adresse email",url:actionUrl}:null
    },
    email_changed:{
      subject:"Votre adresse email Audiotel Premium Pro a été mise à jour",
      title:"Adresse email mise à jour",
      lead:greeting,
      paragraphs:["Votre nouvelle adresse email est maintenant confirmée et rattachée à votre compte.","Toutes les sessions existantes ont été invalidées par mesure de sécurité."],
      cta:{label:"Me reconnecter",url:portalUrl}
    },
    email_change_notice_old:{
      subject:"L’adresse email de votre compte Audiotel Premium Pro a changé",
      title:"Information de sécurité",
      lead:greeting,
      paragraphs:["L’adresse email associée à votre compte vient d’être modifiée.","Si vous n’êtes pas à l’origine de cette modification, contactez immédiatement l’assistance Audiotel Premium Pro."]
    },
    passkey_added:{
      subject:"Une clé d’accès a été ajoutée à votre compte Audiotel Premium Pro",
      title:"Nouvelle clé d’accès",
      lead:greeting,
      paragraphs:["Une nouvelle clé d’accès a été enregistrée pour votre compte.","Si vous n’êtes pas à l’origine de cette action, modifiez votre mot de passe et contactez immédiatement l’assistance."],
      cta:{label:"Consulter mon espace",url:portalUrl}
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
      cta:invoiceUrl?{label:"Consulter ma facture",url:invoiceUrl}:{label:"Consulter la facturation",url:billingUrl},
      secondaryCta:invoicePdfUrl?{label:"Télécharger la facture PDF",url:invoicePdfUrl}:null
    },
    payment_recovered:{
      subject:"Paiement Audiotel Premium Pro régularisé",
      title:"Paiement régularisé",
      lead:greeting,
      paragraphs:["Le paiement précédemment en attente est maintenant régularisé.","Votre état de facturation a été mis à jour automatiquement."],
      cta:invoiceUrl?{label:"Consulter ma facture",url:invoiceUrl}:{label:"Consulter la facturation",url:billingUrl},
      secondaryCta:invoicePdfUrl?{label:"Télécharger la facture PDF",url:invoicePdfUrl}:null
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
      paragraphs:["La résiliation de votre abonnement Audiotel Premium Pro a été enregistrée.","Votre compte n’est pas supprimé par cet email. Les conditions de fin de service restent celles affichées dans votre espace client."],
      cta:{label:"Consulter mon espace",url:portalUrl}
    },
    payout_available:{
      subject:"Votre reversement Audiotel Premium Pro est disponible",
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
  const localized=localizeTransactionalModel(key,model,data.locale,data.name);
  return renderMessage(localized,{logoUrl,homeUrl,privacyUrl,termsUrl,locale:normalizeLocale(data.locale)});
}

function renderMessage(model,brand={}){
  const subject=cleanText(model.subject,180);
  const lead=cleanText(model.lead,300);
  const paragraphs=(model.paragraphs||[]).map(x=>cleanText(x,1200)).filter(Boolean);
  const text=[
    model.title,lead,...paragraphs,
    model.code?"Code : "+cleanText(model.code,20):"",
    model.cta?.url?(cleanText(model.cta.label,120)+": "+model.cta.url):"",
    model.secondaryCta?.url?(cleanText(model.secondaryCta.label,120)+": "+model.secondaryCta.url):"",
    model.foot||"",
    "Audiotel Premium Pro | Une solution PGI Telecom",
    brand.privacyUrl?("Confidentialité: "+brand.privacyUrl):"",
    brand.termsUrl?("Conditions d’abonnement: "+brand.termsUrl):""
  ].filter(Boolean).join("\n\n");
  const paragraphHtml=paragraphs.map(p=>'<p style="margin:0 0 14px;line-height:1.6;color:#332a25">'+escapeHtml(p)+'</p>').join("");
  const codeHtml=model.code?'<div style="font-size:34px;font-weight:700;letter-spacing:8px;text-align:center;padding:20px 10px;margin:20px 0;background:#f5f1ed;border-radius:12px;color:#1f1713">'+escapeHtml(cleanText(model.code,20))+'</div>':"";
  const ctaHtml=model.cta?.url?'<p style="margin:24px 0"><a href="'+escapeHtml(model.cta.url)+'" style="display:inline-block;background:#33251f;color:#fff;text-decoration:none;padding:13px 18px;border-radius:9px;font-weight:700">'+escapeHtml(cleanText(model.cta.label,120))+'</a></p>':"";
  const secondaryCtaHtml=model.secondaryCta?.url?'<p style="margin:10px 0 20px"><a href="'+escapeHtml(model.secondaryCta.url)+'" style="color:#5f493d;text-decoration:underline;font-weight:600">'+escapeHtml(cleanText(model.secondaryCta.label,120))+'</a></p>':"";
  const footHtml=model.foot?'<p style="font-size:13px;line-height:1.5;color:#6c6059;margin:24px 0 0">'+escapeHtml(cleanText(model.foot,1000))+'</p>':"";
  const logoHtml=brand.logoUrl?'<div style="text-align:center;margin:0 0 18px"><a href="'+escapeHtml(brand.homeUrl||brand.logoUrl)+'" target="_blank" rel="noopener noreferrer" style="text-decoration:none"><img src="'+escapeHtml(brand.logoUrl)+'" width="180" alt="Audiotel Premium Pro" style="display:inline-block;width:180px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none"></a></div>':"";
  const lang=escapeHtml(String(brand.locale||"fr").split("-")[0]);
  const footerCopy={
    fr:{privacy:"Confidentialité",terms:"Conditions d’abonnement",notice:"Message transactionnel lié à votre compte ou à une demande de service. Aucun mot de passe ne vous sera demandé par email."},
    en:{privacy:"Privacy",terms:"Subscription terms",notice:"Transactional message related to your account or a service request. You will never be asked for your password by email."},
    es:{privacy:"Privacidad",terms:"Condiciones de suscripción",notice:"Mensaje transaccional relacionado con su cuenta o una solicitud de servicio. Nunca se le pedirá su contraseña por email."},
    it:{privacy:"Privacy",terms:"Condizioni di abbonamento",notice:"Messaggio transazionale relativo al suo account o a una richiesta di servizio. Non le verrà mai chiesta la password via email."},
    pt:{privacy:"Privacidade",terms:"Condições de subscrição",notice:"Mensagem transacional relacionada com a sua conta ou um pedido de serviço. Nunca lhe será pedida a palavra passe por email."},
    de:{privacy:"Datenschutz",terms:"Abonnementbedingungen",notice:"Transaktionsnachricht zu Ihrem Konto oder einer Serviceanfrage. Ihr Passwort wird niemals per Email angefordert."},
    sv:{privacy:"Integritet",terms:"Abonnemangsvillkor",notice:"Transaktionsmeddelande som gäller ditt konto eller en servicebegäran. Du kommer aldrig att bli ombedd att lämna ditt lösenord via email."}
  }[lang]||null;
  const legal=footerCopy||{privacy:"Confidentialité",terms:"Conditions d’abonnement",notice:"Message transactionnel lié à votre compte ou à une demande de service. Aucun mot de passe ne vous sera demandé par email."};
  const legalHtml='<p style="font-size:11px;line-height:1.5;color:#91847c;margin:10px 0 0"><a href="'+escapeHtml(brand.privacyUrl||brand.homeUrl||"")+'" style="color:#78675d">'+escapeHtml(legal.privacy)+'</a> | <a href="'+escapeHtml(brand.termsUrl||brand.homeUrl||"")+'" style="color:#78675d">'+escapeHtml(legal.terms)+'</a></p>';
  const html='<!doctype html><html lang="'+lang+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@media only screen and (max-width:600px){.pgi-wrap{padding:12px!important}.pgi-card{padding:20px!important}.pgi-title{font-size:22px!important}.pgi-btn{display:block!important;text-align:center!important}}</style></head><body style="margin:0;background:#f4f1ee;font-family:Arial,Helvetica,sans-serif;color:#221914"><div class="pgi-wrap" style="padding:28px 12px"><div class="pgi-card" style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #ded6d0;border-radius:14px;padding:30px">'+logoHtml+'<div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#78675d;margin-bottom:12px;text-align:center">Audiotel Premium Pro</div><h1 class="pgi-title" style="font-size:26px;line-height:1.25;margin:0 0 18px;color:#211812">'+escapeHtml(cleanText(model.title,180))+'</h1><p style="margin:0 0 14px;line-height:1.6;color:#332a25">'+escapeHtml(lead)+'</p>'+paragraphHtml+codeHtml+ctaHtml+secondaryCtaHtml+footHtml+'<hr style="border:0;border-top:1px solid #ece6e2;margin:28px 0 16px"><p style="font-size:12px;line-height:1.5;color:#81736a;margin:0 0 8px">Audiotel Premium Pro | Une solution PGI Telecom</p><p style="font-size:12px;line-height:1.5;color:#81736a;margin:0">'+escapeHtml(legal.notice)+'</p>'+legalHtml+'</div></div></body></html>';
  return {subject,text,html};
}

function sameOriginUrl(config,path){
  const base=String(config.publicBaseUrl||"").replace(/\/$/,"");
  if(!/^https:\/\/[^/]+$/i.test(base))throw providerError("PUBLIC_BASE_URL_NOT_CONFIGURED",500);
  const url=new URL(path,base+"/");
  if(url.origin!==base)throw providerError("EMAIL_LINK_ORIGIN_INVALID",500);
  return url.toString();
}
function safeActionUrl(config,value){
  if(!value)return null;
  try{
    const base=String(config.publicBaseUrl||"").replace(/\/$/,""),url=new URL(String(value),base+"/");
    if(url.protocol!=="https:"||url.origin!==base)return null;
    return url.toString();
  }catch{return null;}
}
function safeExternalHttpsUrl(value,allowedSuffixes=[]){
  if(!value)return null;
  try{
    const url=new URL(String(value));
    if(url.protocol!=="https:")return null;
    const host=url.hostname.toLowerCase();
    if(!allowedSuffixes.some(s=>host===s||host.endsWith("."+s)))return null;
    return url.toString();
  }catch{return null;}
}
function normalizeLocale(value){
  const raw=String(value||"fr-FR").trim().toLowerCase(),lang=raw.split("-")[0];
  return ["fr","en","es","it","pt","de","sv"].includes(lang)?lang:"fr";
}

function localizeTransactionalModel(key,model,locale,name){
  const lang=normalizeLocale(locale);
  if(lang==="fr"||key.endsWith("_internal")||key==="support_customer_reply")return model;
  const first=cleanText(name||"",120).split(/\s+/)[0]||"";
  const greetings={
    en:first?"Hello "+first+",":"Hello,",
    es:first?"Hola "+first+",":"Hola,",
    it:first?"Buongiorno "+first+",":"Buongiorno,",
    pt:first?"Olá "+first+",":"Olá,",
    de:first?"Guten Tag "+first+",":"Guten Tag,",
    sv:first?"Hej "+first+",":"Hej,"
  };
  const packs={
    en:{
      email_verification:["Your Audiotel Premium Pro verification code","Verify your email address",["Use the code below to confirm your email address and continue creating your Audiotel Premium Pro account."],"This code expires in "+Number(model.code?10:10)+" minutes. If you did not request this, ignore this email.","Open my account"],
      password_reset:["Reset your Audiotel Premium Pro password","Reset your password",["A password reset request was received for your account.","Use the button below within the allowed time. If you did not request this, no action is required."],"For your security, this link is temporary and can only be used once.","Choose a new password"],
      password_changed:["Your Audiotel Premium Pro password has been changed","Password changed",["Your account password has just been changed.","All existing sessions have been invalidated. If you did not make this change, contact support immediately."],null,"Open my account"],
      email_change_confirmation:["Confirm your new Audiotel Premium Pro email address","Confirm your new email address",["A request was made to change the email address on your account.","Confirm the new address using the button below. The link is temporary and can only be used once."],null,"Confirm my email address"],
      email_changed:["Your Audiotel Premium Pro email address has been updated","Email address updated",["Your new email address is now confirmed and linked to your account.","All existing sessions have been invalidated as a security measure."],null,"Sign in again"],
      email_change_notice_old:["The email address on your Audiotel Premium Pro account has changed","Security information",["The email address linked to your account has just been changed.","If you did not make this change, contact Audiotel Premium Pro support immediately."]],
      passkey_added:["A passkey was added to your Audiotel Premium Pro account","New passkey",["A new passkey has been registered for your account.","If you did not perform this action, change your password and contact support immediately."],null,"Open my account"],
      registration_received:["Your account opening request has been received","Account opening request recorded",["Your Audiotel Premium Pro account opening request has been recorded.","You can follow the progress from your client portal. Creating the account does not by itself activate an SVA service."],null,"Open my account"],
      account_activated:["Your Audiotel Premium Pro account is active","Account activated",["Your Audiotel Premium Pro account is now active.","Access to SVA functions remains subject to the applicable technical, contractual and regulatory checks."],null,"Open my client portal"],
      account_suspended:["Important update about your account","Account access updated",["Your account has been placed in suspended status.","Your data has not been deleted. Sign in to your client portal to review the situation and available actions."],null,"View my account"],
      subscription_created:["Audiotel Premium Pro subscription created","Subscription recorded",["Your Audiotel Premium Pro subscription has been recorded.","Platform billing is separate from payouts related to SVA traffic."],null,"View billing"],
      payment_succeeded:["Audiotel Premium Pro payment confirmed","Payment confirmed",["Your subscription payment has been confirmed.","No action is required from you."],null,model.cta?.label==="Consulter ma facture"?"View my invoice":"View billing"],
      payment_recovered:["Audiotel Premium Pro payment resolved","Payment resolved",["The payment that was previously pending has now been resolved.","Your billing status was updated automatically."],null,model.cta?.label==="Consulter ma facture"?"View my invoice":"View billing"],
      payment_failed:["Action required: Audiotel Premium Pro payment unsuccessful","Payment requires attention",["The latest payment for your subscription was unsuccessful.","Your account and data are preserved. Use your client portal to open the secure billing portal and update your payment method."],null,"Resolve billing"],
      payment_action_required:["Action required to complete your Audiotel Premium Pro payment","Payment validation required",["Your payment provider requires an additional action to complete the payment.","Sign in to your client portal to continue through the secure Stripe portal."],null,"Complete payment"],
      payment_reminder:["Reminder: resolve your Audiotel Premium Pro subscription","Payment reminder",["Your subscription still requires payment resolution.","The existing service may remain available during the recovery period, but some functions may be suspended when it ends."],null,"Resolve billing"],
      subscription_suspended:["Audiotel Premium Pro subscription suspended","Subscription suspended",["The payment resolution period has ended and paid functions may be suspended.","Your account and data remain preserved. Payment resolution allows service restoration under the service rules."],null,"Resolve billing"],
      subscription_cancelled:["Your Audiotel Premium Pro subscription has been cancelled","Subscription cancelled",["The cancellation of your Audiotel Premium Pro subscription has been recorded.","This email does not delete your account. End of service conditions remain those shown in your client portal."],null,"View my account"],
      payout_available:["Your Audiotel payout is available","Payout available",["A payout generated by SVA traffic has passed the required checks and is now shown as available in your client portal.","The status displayed in your portal remains the reference for payment tracking."],null,"View my payouts"],
      portability_received:["Your portability request has been received","Portability request recorded",["Your portability request has been recorded and will be processed according to the applicable checks.","No transfer is presented as completed until the operator confirms portability."],null,"Track my request"],
      support_received:["Your support request has been received","Support request recorded",["Your request has been recorded in the service center.","You can follow its status in your client portal."],null,"Open the service center"],
      support_opened:["A support case has been opened","Support case opened",["A support case has been opened for your account.","Open your client portal to follow its progress."],null,"View the case"],
      support_response:["New reply to your support request","Your case has been updated",["A new reply is available in your support case.","To protect case information, the full content remains available in your secure portal."],null,"View the reply"],
      support_resolved:["Your support request has been resolved","Case resolved",["Your support case has been marked as resolved.","The history remains available in your client portal."],null,"View the case"]
    },
    es:{
      email_verification:["Su código de verificación de Audiotel Premium Pro","Verifique su dirección de correo",["Use el código siguiente para confirmar su dirección de correo y continuar con la creación de su espacio Audiotel Premium Pro."],"Este código caduca pronto. Si no ha solicitado esta acción, ignore este correo."],
      password_reset:["Restablecimiento de su contraseña Audiotel Premium Pro","Restablecer su contraseña",["Se ha recibido una solicitud para restablecer la contraseña de su cuenta.","Use el botón siguiente dentro del plazo indicado. Si no ha solicitado esta acción, no es necesario hacer nada."],"Por su seguridad, este enlace es temporal y solo puede utilizarse una vez.","Elegir una nueva contraseña"],
      password_changed:["Su contraseña Audiotel Premium Pro ha sido modificada","Contraseña modificada",["La contraseña de su cuenta acaba de ser modificada.","Todas las sesiones existentes han sido invalidadas. Si usted no realizó este cambio, contacte inmediatamente con soporte."],null,"Acceder a mi cuenta"],
      email_change_confirmation:["Confirme su nueva dirección de correo de Audiotel Premium Pro","Confirmar nueva dirección de correo",["Se ha solicitado cambiar la dirección de correo de su cuenta.","Confirme la nueva dirección con el botón siguiente. El enlace es temporal y de un solo uso."],null,"Confirmar mi dirección de correo"],
      email_changed:["Su dirección de correo Audiotel Premium Pro ha sido actualizada","Dirección de correo actualizada",["Su nueva dirección de correo está confirmada y vinculada a su cuenta.","Todas las sesiones existentes han sido invalidadas por seguridad."],null,"Volver a iniciar sesión"],
      email_change_notice_old:["La dirección de correo de su cuenta Audiotel Premium Pro ha cambiado","Información de seguridad",["La dirección de correo vinculada a su cuenta acaba de cambiar.","Si usted no realizó este cambio, contacte inmediatamente con soporte Audiotel Premium Pro."]],
      passkey_added:["Se ha añadido una clave de acceso a su cuenta Audiotel Premium Pro","Nueva clave de acceso",["Se ha registrado una nueva clave de acceso para su cuenta.","Si usted no realizó esta acción, cambie su contraseña y contacte inmediatamente con soporte."],null,"Acceder a mi cuenta"],
      registration_received:["Hemos recibido su solicitud de apertura","Solicitud de apertura registrada",["Su solicitud de apertura de Audiotel Premium Pro ha sido registrada.","Puede seguir las etapas de su expediente desde su espacio cliente. La creación de la cuenta no implica la activación de un servicio SVA."],null,"Acceder a mi espacio"],
      account_activated:["Su cuenta Audiotel Premium Pro está activa","Cuenta activada",["Su cuenta Audiotel Premium Pro está ahora activa.","El acceso a las funciones SVA sigue sujeto a los controles técnicos, contractuales y reglamentarios aplicables."],null,"Abrir mi espacio cliente"],
      account_suspended:["Actualización importante sobre su cuenta","Acceso a la cuenta actualizado",["El estado de su cuenta ha sido suspendido.","Sus datos no se han eliminado. Acceda a su espacio cliente para consultar la situación y las acciones disponibles."],null,"Consultar mi cuenta"],
      subscription_created:["Suscripción Audiotel Premium Pro creada","Suscripción registrada",["Su suscripción Audiotel Premium Pro ha sido registrada.","La facturación de la plataforma es independiente de los pagos relacionados con el tráfico SVA."],null,"Consultar facturación"],
      payment_succeeded:["Pago Audiotel Premium Pro confirmado","Pago confirmado",["El pago de su suscripción ha sido confirmado.","No es necesaria ninguna acción por su parte."],null,model.cta?.label==="Consulter ma facture"?"Consultar mi factura":"Consultar facturación"],
      payment_recovered:["Pago Audiotel Premium Pro regularizado","Pago regularizado",["El pago anteriormente pendiente ya está regularizado.","Su estado de facturación se ha actualizado automáticamente."],null,model.cta?.label==="Consulter ma facture"?"Consultar mi factura":"Consultar facturación"],
      payment_failed:["Acción necesaria: pago Audiotel Premium Pro no realizado","Pago pendiente de regularización",["El último pago de su suscripción no se ha completado.","Su cuenta y sus datos se conservan. Use su espacio cliente para abrir el portal de facturación seguro y actualizar su método de pago."],null,"Regularizar facturación"],
      payment_action_required:["Acción necesaria para finalizar su pago Audiotel Premium Pro","Validación de pago necesaria",["Su proveedor de pago requiere una acción adicional para finalizar el pago.","Acceda a su espacio cliente para continuar mediante el portal seguro de Stripe."],null,"Finalizar el pago"],
      payment_reminder:["Recordatorio: regularización de su suscripción Audiotel Premium Pro","Recordatorio de regularización",["Su suscripción sigue pendiente de regularización.","El servicio existente puede permanecer disponible durante el periodo de recuperación, pero algunas funciones pueden suspenderse al finalizar."],null,"Regularizar facturación"],
      subscription_suspended:["Suscripción Audiotel Premium Pro suspendida","Suscripción suspendida",["El periodo de regularización ha finalizado y las funciones de pago pueden quedar suspendidas.","Su cuenta y sus datos se conservan. La regularización del pago permite la reanudación según las reglas del servicio."],null,"Regularizar facturación"],
      subscription_cancelled:["Cancelación de su suscripción Audiotel Premium Pro","Suscripción cancelada",["La cancelación de su suscripción Audiotel Premium Pro ha sido registrada.","Este correo no elimina su cuenta. Las condiciones de fin de servicio son las mostradas en su espacio cliente."],null,"Consultar mi cuenta"],
      payout_available:["Su pago Audiotel está disponible","Pago disponible",["Un pago procedente del tráfico SVA ha superado los controles necesarios y aparece disponible en su espacio cliente.","El estado mostrado en su espacio sigue siendo la referencia para el seguimiento."],null,"Consultar mis pagos"],
      portability_received:["Hemos recibido su solicitud de portabilidad","Solicitud de portabilidad registrada",["Su solicitud de portabilidad ha sido registrada y será tratada según los controles aplicables.","Ninguna transferencia se considera realizada hasta que el operador confirme la portabilidad."],null,"Seguir mi solicitud"],
      support_received:["Hemos recibido su solicitud de asistencia","Solicitud de asistencia registrada",["Su solicitud ha sido registrada en el centro de servicio.","Puede seguir su estado en su espacio cliente."],null,"Consultar el centro de servicio"],
      support_opened:["Se ha abierto un expediente de asistencia","Expediente de asistencia abierto",["Se ha abierto un expediente de asistencia para su cuenta.","Consulte su espacio cliente para seguir su evolución."],null,"Consultar el expediente"],
      support_response:["Nueva respuesta a su solicitud de asistencia","Su expediente ha sido actualizado",["Hay una nueva respuesta disponible en su expediente de asistencia.","Para proteger la información, el contenido completo permanece disponible en su espacio seguro."],null,"Consultar la respuesta"],
      support_resolved:["Su solicitud de asistencia ha sido resuelta","Expediente resuelto",["Su expediente de asistencia ha sido marcado como resuelto.","El historial permanece disponible en su espacio cliente."],null,"Consultar el expediente"]
    },
    it:{
      email_verification:["Il suo codice di verifica Audiotel Premium Pro","Verifica dell’indirizzo email",["Utilizzi il codice qui sotto per confermare il suo indirizzo email e proseguire con la creazione del suo spazio Audiotel Premium Pro."],"Questo codice scade a breve. Se non ha richiesto questa operazione, ignori questa email."],
      password_reset:["Reimpostazione della password Audiotel Premium Pro","Reimpostare la password",["È stata ricevuta una richiesta di reimpostazione della password per il suo account.","Utilizzi il pulsante qui sotto entro il tempo indicato. Se non ha effettuato la richiesta, non è necessaria alcuna azione."],"Per la sua sicurezza, questo link è temporaneo e può essere utilizzato una sola volta.","Scegliere una nuova password"],
      password_changed:["La password Audiotel Premium Pro è stata modificata","Password modificata",["La password del suo account è stata appena modificata.","Tutte le sessioni esistenti sono state invalidate. Se non ha effettuato questa modifica, contatti immediatamente l’assistenza."],null,"Accedere al mio account"],
      email_change_confirmation:["Confermi il nuovo indirizzo email Audiotel Premium Pro","Confermare il nuovo indirizzo email",["È stata richiesta una modifica dell’indirizzo email del suo account.","Confermi il nuovo indirizzo con il pulsante qui sotto. Il link è temporaneo e monouso."],null,"Confermare il mio indirizzo email"],
      email_changed:["Il suo indirizzo email Audiotel Premium Pro è stato aggiornato","Indirizzo email aggiornato",["Il suo nuovo indirizzo email è ora confermato e associato al suo account.","Tutte le sessioni esistenti sono state invalidate per sicurezza."],null,"Accedere di nuovo"],
      email_change_notice_old:["L’indirizzo email del suo account Audiotel Premium Pro è cambiato","Informazione di sicurezza",["L’indirizzo email associato al suo account è stato appena modificato.","Se non ha effettuato questa modifica, contatti immediatamente l’assistenza Audiotel Premium Pro."]],
      passkey_added:["È stata aggiunta una passkey al suo account Audiotel Premium Pro","Nuova passkey",["È stata registrata una nuova passkey per il suo account.","Se non ha effettuato questa operazione, modifichi la password e contatti immediatamente l’assistenza."],null,"Accedere al mio account"],
      registration_received:["La sua richiesta di apertura è stata ricevuta","Richiesta di apertura registrata",["La sua richiesta di apertura Audiotel Premium Pro è stata registrata.","Può seguire le fasi della pratica dal suo spazio cliente. La creazione dell’account non equivale all’attivazione di un servizio SVA."],null,"Accedere al mio spazio"],
      account_activated:["Il suo account Audiotel Premium Pro è attivo","Account attivato",["Il suo account Audiotel Premium Pro è ora attivo.","L’accesso alle funzioni SVA resta soggetto ai controlli tecnici, contrattuali e normativi applicabili."],null,"Aprire il mio spazio cliente"],
      account_suspended:["Aggiornamento importante sul suo account","Accesso all’account aggiornato",["Lo stato del suo account è stato sospeso.","I suoi dati non sono stati eliminati. Acceda al suo spazio cliente per consultare la situazione e le azioni disponibili."],null,"Consultare il mio account"],
      subscription_created:["Abbonamento Audiotel Premium Pro creato","Abbonamento registrato",["Il suo abbonamento Audiotel Premium Pro è stato registrato.","La fatturazione della piattaforma è distinta dai riversamenti relativi al traffico SVA."],null,"Consultare la fatturazione"],
      payment_succeeded:["Pagamento Audiotel Premium Pro confermato","Pagamento confermato",["Il pagamento del suo abbonamento è stato confermato.","Non è richiesta alcuna azione."],null,model.cta?.label==="Consulter ma facture"?"Consultare la mia fattura":"Consultare la fatturazione"],
      payment_recovered:["Pagamento Audiotel Premium Pro regolarizzato","Pagamento regolarizzato",["Il pagamento precedentemente in sospeso è ora regolarizzato.","Lo stato della fatturazione è stato aggiornato automaticamente."],null,model.cta?.label==="Consulter ma facture"?"Consultare la mia fattura":"Consultare la fatturazione"],
      payment_failed:["Azione richiesta: pagamento Audiotel Premium Pro non riuscito","Pagamento da regolarizzare",["L’ultimo pagamento del suo abbonamento non è andato a buon fine.","Il suo account e i suoi dati sono conservati. Utilizzi lo spazio cliente per aprire il portale di fatturazione sicuro e aggiornare il metodo di pagamento."],null,"Regolarizzare la fatturazione"],
      payment_action_required:["Azione richiesta per completare il pagamento Audiotel Premium Pro","Convalida del pagamento richiesta",["Il suo fornitore di pagamento richiede un’azione aggiuntiva per completare il pagamento.","Acceda al suo spazio cliente per continuare tramite il portale sicuro Stripe."],null,"Completare il pagamento"],
      payment_reminder:["Promemoria: regolarizzazione dell’abbonamento Audiotel Premium Pro","Promemoria di regolarizzazione",["Il suo abbonamento è ancora in attesa di regolarizzazione.","Il servizio esistente può restare disponibile durante il periodo di recupero, ma alcune funzioni possono essere sospese alla scadenza."],null,"Regolarizzare la fatturazione"],
      subscription_suspended:["Abbonamento Audiotel Premium Pro sospeso","Abbonamento sospeso",["Il periodo di regolarizzazione è scaduto e le funzioni a pagamento possono essere sospese.","Il suo account e i suoi dati restano conservati. La regolarizzazione permette la ripresa secondo le regole del servizio."],null,"Regolarizzare la fatturazione"],
      subscription_cancelled:["Cancellazione dell’abbonamento Audiotel Premium Pro","Abbonamento cancellato",["La cancellazione del suo abbonamento Audiotel Premium Pro è stata registrata.","Questa email non elimina il suo account. Le condizioni di fine servizio restano quelle indicate nel suo spazio cliente."],null,"Consultare il mio account"],
      payout_available:["Il suo riversamento Audiotel è disponibile","Riversamento disponibile",["Un riversamento derivante dal traffico SVA ha superato i controlli necessari ed è ora indicato come disponibile nel suo spazio cliente.","Lo stato visualizzato nello spazio cliente resta il riferimento per il monitoraggio del pagamento."],null,"Consultare i miei riversamenti"],
      portability_received:["La sua richiesta di portabilità è stata ricevuta","Richiesta di portabilità registrata",["La sua richiesta di portabilità è stata registrata e sarà trattata secondo i controlli applicabili.","Nessun trasferimento viene indicato come completato finché l’operatore non conferma la portabilità."],null,"Seguire la mia richiesta"],
      support_received:["La sua richiesta di assistenza è stata ricevuta","Richiesta di assistenza registrata",["La sua richiesta è stata registrata nel centro servizi.","Può seguirne lo stato nel suo spazio cliente."],null,"Consultare il centro servizi"],
      support_opened:["È stato aperto un caso di assistenza","Caso di assistenza aperto",["È stato aperto un caso di assistenza per il suo account.","Consulti il suo spazio cliente per seguirne l’evoluzione."],null,"Consultare il caso"],
      support_response:["Nuova risposta alla sua richiesta di assistenza","Il suo caso è stato aggiornato",["È disponibile una nuova risposta nel suo caso di assistenza.","Per proteggere le informazioni, il contenuto completo resta disponibile nel suo spazio sicuro."],null,"Consultare la risposta"],
      support_resolved:["La sua richiesta di assistenza è stata risolta","Caso risolto",["Il suo caso di assistenza è stato contrassegnato come risolto.","La cronologia resta disponibile nel suo spazio cliente."],null,"Consultare il caso"]
    },
    pt:{
      email_verification:["O seu código de verificação Audiotel Premium Pro","Verificar o endereço de email",["Utilize o código abaixo para confirmar o seu endereço de email e continuar a criação do seu espaço Audiotel Premium Pro."],"Este código expira em breve. Se não solicitou esta ação, ignore este email."],
      password_reset:["Redefinição da sua palavra-passe Audiotel Premium Pro","Redefinir a palavra-passe",["Foi recebido um pedido de redefinição da palavra-passe da sua conta.","Utilize o botão abaixo dentro do prazo indicado. Se não fez este pedido, não é necessária nenhuma ação."],"Para sua segurança, esta ligação é temporária e só pode ser utilizada uma vez.","Escolher uma nova palavra-passe"],
      password_changed:["A sua palavra-passe Audiotel Premium Pro foi alterada","Palavra-passe alterada",["A palavra-passe da sua conta acabou de ser alterada.","Todas as sessões existentes foram invalidadas. Se não fez esta alteração, contacte imediatamente o suporte."],null,"Aceder à minha conta"],
      email_change_confirmation:["Confirme o seu novo endereço de email Audiotel Premium Pro","Confirmar novo endereço de email",["Foi solicitada uma alteração do endereço de email da sua conta.","Confirme o novo endereço através do botão abaixo. A ligação é temporária e de utilização única."],null,"Confirmar o meu endereço de email"],
      email_changed:["O seu endereço de email Audiotel Premium Pro foi atualizado","Endereço de email atualizado",["O seu novo endereço de email está confirmado e associado à sua conta.","Todas as sessões existentes foram invalidadas por segurança."],null,"Iniciar sessão novamente"],
      email_change_notice_old:["O endereço de email da sua conta Audiotel Premium Pro foi alterado","Informação de segurança",["O endereço de email associado à sua conta acabou de ser alterado.","Se não fez esta alteração, contacte imediatamente o suporte Audiotel Premium Pro."]],
      passkey_added:["Foi adicionada uma chave de acesso à sua conta Audiotel Premium Pro","Nova chave de acesso",["Foi registada uma nova chave de acesso na sua conta.","Se não realizou esta ação, altere a palavra-passe e contacte imediatamente o suporte."],null,"Aceder à minha conta"],
      registration_received:["O seu pedido de abertura foi recebido","Pedido de abertura registado",["O seu pedido de abertura Audiotel Premium Pro foi registado.","Pode acompanhar as etapas do processo no seu espaço de cliente. A criação da conta não significa a ativação de um serviço SVA."],null,"Aceder ao meu espaço"],
      account_activated:["A sua conta Audiotel Premium Pro está ativa","Conta ativada",["A sua conta Audiotel Premium Pro está agora ativa.","O acesso às funções SVA continua sujeito aos controlos técnicos, contratuais e regulamentares aplicáveis."],null,"Abrir o meu espaço de cliente"],
      account_suspended:["Atualização importante sobre a sua conta","Acesso à conta atualizado",["O estado da sua conta foi colocado em suspensão.","Os seus dados não foram eliminados. Aceda ao seu espaço de cliente para consultar a situação e as ações disponíveis."],null,"Consultar a minha conta"],
      subscription_created:["Subscrição Audiotel Premium Pro criada","Subscrição registada",["A sua subscrição Audiotel Premium Pro foi registada.","A faturação da plataforma é distinta dos pagamentos relacionados com o tráfego SVA."],null,"Consultar faturação"],
      payment_succeeded:["Pagamento Audiotel Premium Pro confirmado","Pagamento confirmado",["O pagamento da sua subscrição foi confirmado.","Não é necessária qualquer ação da sua parte."],null,model.cta?.label==="Consulter ma facture"?"Consultar a minha fatura":"Consultar faturação"],
      payment_recovered:["Pagamento Audiotel Premium Pro regularizado","Pagamento regularizado",["O pagamento anteriormente pendente está agora regularizado.","O seu estado de faturação foi atualizado automaticamente."],null,model.cta?.label==="Consulter ma facture"?"Consultar a minha fatura":"Consultar faturação"],
      payment_failed:["Ação necessária: pagamento Audiotel Premium Pro não concluído","Pagamento a regularizar",["O último pagamento da sua subscrição não foi concluído.","A sua conta e os seus dados são mantidos. Utilize o espaço de cliente para abrir o portal de faturação seguro e atualizar o método de pagamento."],null,"Regularizar faturação"],
      payment_action_required:["Ação necessária para concluir o pagamento Audiotel Premium Pro","Validação de pagamento necessária",["O seu prestador de pagamento exige uma ação adicional para concluir o pagamento.","Aceda ao seu espaço de cliente para continuar através do portal seguro Stripe."],null,"Concluir o pagamento"],
      payment_reminder:["Lembrete: regularização da sua subscrição Audiotel Premium Pro","Lembrete de regularização",["A sua subscrição continua a aguardar regularização.","O serviço existente pode permanecer disponível durante o período de recuperação, mas algumas funções poderão ser suspensas no final."],null,"Regularizar faturação"],
      subscription_suspended:["Subscrição Audiotel Premium Pro suspensa","Subscrição suspensa",["O período de regularização terminou e as funções pagas podem ser suspensas.","A sua conta e os seus dados continuam preservados. A regularização do pagamento permite a retoma segundo as regras do serviço."],null,"Regularizar faturação"],
      subscription_cancelled:["Cancelamento da sua subscrição Audiotel Premium Pro","Subscrição cancelada",["O cancelamento da sua subscrição Audiotel Premium Pro foi registado.","Este email não elimina a sua conta. As condições de fim de serviço continuam a ser as apresentadas no espaço de cliente."],null,"Consultar a minha conta"],
      payout_available:["O seu pagamento Audiotel está disponível","Pagamento disponível",["Um pagamento proveniente do tráfego SVA passou pelos controlos necessários e aparece agora como disponível no seu espaço de cliente.","O estado apresentado no seu espaço continua a ser a referência para o acompanhamento."],null,"Consultar os meus pagamentos"],
      portability_received:["O seu pedido de portabilidade foi recebido","Pedido de portabilidade registado",["O seu pedido de portabilidade foi registado e será tratado de acordo com os controlos aplicáveis.","Nenhuma transferência é apresentada como concluída até o operador confirmar a portabilidade."],null,"Acompanhar o meu pedido"],
      support_received:["O seu pedido de assistência foi recebido","Pedido de assistência registado",["O seu pedido foi registado no centro de serviço.","Pode acompanhar o estado no seu espaço de cliente."],null,"Consultar o centro de serviço"],
      support_opened:["Foi aberto um processo de assistência","Processo de assistência aberto",["Foi aberto um processo de assistência para a sua conta.","Consulte o seu espaço de cliente para acompanhar a evolução."],null,"Consultar o processo"],
      support_response:["Nova resposta ao seu pedido de assistência","O seu processo foi atualizado",["Está disponível uma nova resposta no seu processo de assistência.","Para proteger as informações, o conteúdo completo permanece disponível no seu espaço seguro."],null,"Consultar a resposta"],
      support_resolved:["O seu pedido de assistência foi resolvido","Processo resolvido",["O seu processo de assistência foi marcado como resolvido.","O histórico continua disponível no seu espaço de cliente."],null,"Consultar o processo"]
    },
    de:{
      email_verification:["Ihr Audiotel Premium Pro Bestätigungscode","Email-Adresse bestätigen",["Verwenden Sie den folgenden Code, um Ihre Email-Adresse zu bestätigen und die Einrichtung Ihres Audiotel Premium Pro Zugangs fortzusetzen."],"Dieser Code läuft in Kürze ab. Wenn Sie dies nicht angefordert haben, ignorieren Sie diese Email."],
      password_reset:["Zurücksetzen Ihres Audiotel Premium Pro Passworts","Passwort zurücksetzen",["Für Ihr Konto wurde eine Anfrage zum Zurücksetzen des Passworts gestellt.","Verwenden Sie die Schaltfläche unten innerhalb der angegebenen Frist. Wenn Sie dies nicht angefordert haben, ist keine Aktion erforderlich."],"Zu Ihrer Sicherheit ist dieser Link nur vorübergehend und kann nur einmal verwendet werden.","Neues Passwort wählen"],
      password_changed:["Ihr Audiotel Premium Pro Passwort wurde geändert","Passwort geändert",["Das Passwort Ihres Kontos wurde soeben geändert.","Alle bestehenden Sitzungen wurden ungültig gemacht. Wenn Sie diese Änderung nicht vorgenommen haben, kontaktieren Sie sofort den Support."],null,"Mein Konto öffnen"],
      email_change_confirmation:["Bestätigen Sie Ihre neue Audiotel Premium Pro Email-Adresse","Neue Email-Adresse bestätigen",["Eine Änderung der Email-Adresse Ihres Kontos wurde angefordert.","Bestätigen Sie die neue Adresse über die Schaltfläche unten. Der Link ist vorübergehend und nur einmal verwendbar."],null,"Email-Adresse bestätigen"],
      email_changed:["Ihre Audiotel Premium Pro Email-Adresse wurde aktualisiert","Email-Adresse aktualisiert",["Ihre neue Email-Adresse ist jetzt bestätigt und mit Ihrem Konto verknüpft.","Alle bestehenden Sitzungen wurden aus Sicherheitsgründen ungültig gemacht."],null,"Erneut anmelden"],
      email_change_notice_old:["Die Email-Adresse Ihres Audiotel Premium Pro Kontos wurde geändert","Sicherheitsinformation",["Die mit Ihrem Konto verknüpfte Email-Adresse wurde soeben geändert.","Wenn Sie diese Änderung nicht vorgenommen haben, kontaktieren Sie sofort den Audiotel Premium Pro Support."]],
      passkey_added:["Ihrem Audiotel Premium Pro Konto wurde ein Passkey hinzugefügt","Neuer Passkey",["Für Ihr Konto wurde ein neuer Passkey registriert.","Wenn Sie diese Aktion nicht durchgeführt haben, ändern Sie Ihr Passwort und kontaktieren Sie sofort den Support."],null,"Mein Konto öffnen"],
      registration_received:["Ihre Kontoeröffnungsanfrage ist eingegangen","Kontoeröffnungsanfrage erfasst",["Ihre Anfrage für Audiotel Premium Pro wurde erfasst.","Sie können den Vorgang in Ihrem Kundenbereich verfolgen. Die Kontoerstellung allein aktiviert keinen SVA Dienst."],null,"Meinen Bereich öffnen"],
      account_activated:["Ihr Audiotel Premium Pro Konto ist aktiv","Konto aktiviert",["Ihr Audiotel Premium Pro Konto ist jetzt aktiv.","Der Zugriff auf SVA Funktionen bleibt von den geltenden technischen, vertraglichen und regulatorischen Prüfungen abhängig."],null,"Kundenbereich öffnen"],
      account_suspended:["Wichtige Aktualisierung zu Ihrem Konto","Kontozugriff aktualisiert",["Ihr Konto wurde auf den Status gesperrt gesetzt.","Ihre Daten wurden nicht gelöscht. Melden Sie sich im Kundenbereich an, um die Situation und verfügbare Maßnahmen zu prüfen."],null,"Mein Konto ansehen"],
      subscription_created:["Audiotel Premium Pro Abonnement erstellt","Abonnement erfasst",["Ihr Audiotel Premium Pro Abonnement wurde erfasst.","Die Plattformabrechnung ist von Auszahlungen aus SVA Verkehr getrennt."],null,"Abrechnung ansehen"],
      payment_succeeded:["Audiotel Premium Pro Zahlung bestätigt","Zahlung bestätigt",["Ihre Abonnementzahlung wurde bestätigt.","Von Ihnen ist keine Aktion erforderlich."],null,model.cta?.label==="Consulter ma facture"?"Meine Rechnung ansehen":"Abrechnung ansehen"],
      payment_recovered:["Audiotel Premium Pro Zahlung ausgeglichen","Zahlung ausgeglichen",["Die zuvor ausstehende Zahlung ist jetzt ausgeglichen.","Ihr Abrechnungsstatus wurde automatisch aktualisiert."],null,model.cta?.label==="Consulter ma facture"?"Meine Rechnung ansehen":"Abrechnung ansehen"],
      payment_failed:["Aktion erforderlich: Audiotel Premium Pro Zahlung fehlgeschlagen","Zahlung ausstehend",["Die letzte Zahlung für Ihr Abonnement war nicht erfolgreich.","Ihr Konto und Ihre Daten bleiben erhalten. Verwenden Sie den Kundenbereich, um das sichere Abrechnungsportal zu öffnen und Ihre Zahlungsmethode zu aktualisieren."],null,"Abrechnung klären"],
      payment_action_required:["Aktion erforderlich, um Ihre Audiotel Premium Pro Zahlung abzuschließen","Zahlungsbestätigung erforderlich",["Ihr Zahlungsanbieter verlangt eine zusätzliche Aktion, um die Zahlung abzuschließen.","Melden Sie sich in Ihrem Kundenbereich an, um über das sichere Stripe Portal fortzufahren."],null,"Zahlung abschließen"],
      payment_reminder:["Erinnerung: Audiotel Premium Pro Abonnement ausgleichen","Erinnerung zur Zahlung",["Ihr Abonnement wartet weiterhin auf Zahlungsausgleich.","Der bestehende Dienst kann während des Wiederherstellungszeitraums verfügbar bleiben, einige Funktionen können danach jedoch gesperrt werden."],null,"Abrechnung klären"],
      subscription_suspended:["Audiotel Premium Pro Abonnement gesperrt","Abonnement gesperrt",["Der Zeitraum zur Zahlungsklärung ist abgelaufen und kostenpflichtige Funktionen können gesperrt werden.","Ihr Konto und Ihre Daten bleiben erhalten. Nach Zahlungsausgleich kann der Dienst gemäß den Regeln wieder aufgenommen werden."],null,"Abrechnung klären"],
      subscription_cancelled:["Ihr Audiotel Premium Pro Abonnement wurde gekündigt","Abonnement gekündigt",["Die Kündigung Ihres Audiotel Premium Pro Abonnements wurde erfasst.","Diese Email löscht Ihr Konto nicht. Die Bedingungen zum Dienstende bleiben die im Kundenbereich angezeigten."],null,"Mein Konto ansehen"],
      payout_available:["Ihre Audiotel Auszahlung ist verfügbar","Auszahlung verfügbar",["Eine Auszahlung aus SVA Verkehr hat die erforderlichen Prüfungen durchlaufen und wird nun im Kundenbereich als verfügbar angezeigt.","Der dort angezeigte Status bleibt maßgeblich für die Zahlungsnachverfolgung."],null,"Meine Auszahlungen ansehen"],
      portability_received:["Ihre Portierungsanfrage ist eingegangen","Portierungsanfrage erfasst",["Ihre Portierungsanfrage wurde erfasst und wird entsprechend den geltenden Prüfungen bearbeitet.","Eine Übertragung gilt erst als abgeschlossen, wenn der Betreiber die Portierung bestätigt."],null,"Anfrage verfolgen"],
      support_received:["Ihre Supportanfrage ist eingegangen","Supportanfrage erfasst",["Ihre Anfrage wurde im Servicecenter erfasst.","Sie können den Status im Kundenbereich verfolgen."],null,"Servicecenter öffnen"],
      support_opened:["Ein Supportfall wurde eröffnet","Supportfall eröffnet",["Für Ihr Konto wurde ein Supportfall eröffnet.","Öffnen Sie den Kundenbereich, um den Verlauf zu verfolgen."],null,"Fall ansehen"],
      support_response:["Neue Antwort auf Ihre Supportanfrage","Ihr Fall wurde aktualisiert",["In Ihrem Supportfall ist eine neue Antwort verfügbar.","Zum Schutz der Informationen bleibt der vollständige Inhalt in Ihrem sicheren Bereich verfügbar."],null,"Antwort ansehen"],
      support_resolved:["Ihre Supportanfrage wurde gelöst","Fall gelöst",["Ihr Supportfall wurde als gelöst markiert.","Der Verlauf bleibt in Ihrem Kundenbereich verfügbar."],null,"Fall ansehen"]
    },
    sv:{
      email_verification:["Din verifieringskod för Audiotel Premium Pro","Verifiera din e-postadress",["Använd koden nedan för att bekräfta din e-postadress och fortsätta skapa ditt Audiotel Premium Pro konto."],"Koden upphör snart att gälla. Om du inte begärde detta kan du ignorera meddelandet."],
      password_reset:["Återställning av ditt Audiotel Premium Pro lösenord","Återställ lösenord",["En begäran om återställning av lösenordet har tagits emot för ditt konto.","Använd knappen nedan inom angiven tid. Om du inte gjorde begäran behöver du inte göra något."],"Av säkerhetsskäl är länken tillfällig och kan bara användas en gång.","Välj ett nytt lösenord"],
      password_changed:["Ditt Audiotel Premium Pro lösenord har ändrats","Lösenord ändrat",["Lösenordet för ditt konto har just ändrats.","Alla befintliga sessioner har ogiltigförklarats. Om du inte gjorde ändringen, kontakta supporten omedelbart."],null,"Öppna mitt konto"],
      email_change_confirmation:["Bekräfta din nya e-postadress för Audiotel Premium Pro","Bekräfta ny e-postadress",["En ändring av e-postadressen för ditt konto har begärts.","Bekräfta den nya adressen med knappen nedan. Länken är tillfällig och kan bara användas en gång."],null,"Bekräfta min e-postadress"],
      email_changed:["Din e-postadress för Audiotel Premium Pro har uppdaterats","E-postadress uppdaterad",["Din nya e-postadress är nu bekräftad och kopplad till ditt konto.","Alla befintliga sessioner har ogiltigförklarats av säkerhetsskäl."],null,"Logga in igen"],
      email_change_notice_old:["E-postadressen för ditt Audiotel Premium Pro konto har ändrats","Säkerhetsinformation",["E-postadressen som är kopplad till ditt konto har just ändrats.","Om du inte gjorde ändringen, kontakta Audiotel Premium Pro supporten omedelbart."]],
      passkey_added:["En passkey har lagts till i ditt Audiotel Premium Pro konto","Ny passkey",["En ny passkey har registrerats för ditt konto.","Om du inte gjorde detta, ändra lösenordet och kontakta supporten omedelbart."],null,"Öppna mitt konto"],
      registration_received:["Din begäran om kontoöppning har tagits emot","Begäran registrerad",["Din begäran om Audiotel Premium Pro har registrerats.","Du kan följa stegen i kundportalen. Att skapa kontot innebär inte i sig att en SVA tjänst aktiveras."],null,"Öppna mitt konto"],
      account_activated:["Ditt Audiotel Premium Pro konto är aktivt","Konto aktiverat",["Ditt Audiotel Premium Pro konto är nu aktivt.","Åtkomst till SVA funktioner är fortsatt beroende av tillämpliga tekniska, avtalsmässiga och regulatoriska kontroller."],null,"Öppna kundportalen"],
      account_suspended:["Viktig uppdatering om ditt konto","Kontoåtkomst uppdaterad",["Ditt konto har satts i avstängt läge.","Dina data har inte raderats. Logga in i kundportalen för att se situationen och tillgängliga åtgärder."],null,"Visa mitt konto"],
      subscription_created:["Audiotel Premium Pro abonnemang skapat","Abonnemang registrerat",["Ditt Audiotel Premium Pro abonnemang har registrerats.","Plattformsfakturering är separat från utbetalningar kopplade till SVA trafik."],null,"Visa fakturering"],
      payment_succeeded:["Audiotel Premium Pro betalning bekräftad","Betalning bekräftad",["Din abonnemangsbetalning har bekräftats.","Ingen åtgärd krävs från dig."],null,model.cta?.label==="Consulter ma facture"?"Visa min faktura":"Visa fakturering"],
      payment_recovered:["Audiotel Premium Pro betalning reglerad","Betalning reglerad",["Betalningen som tidigare väntade är nu reglerad.","Din faktureringsstatus har uppdaterats automatiskt."],null,model.cta?.label==="Consulter ma facture"?"Visa min faktura":"Visa fakturering"],
      payment_failed:["Åtgärd krävs: Audiotel Premium Pro betalning misslyckades","Betalning behöver åtgärdas",["Den senaste betalningen för ditt abonnemang misslyckades.","Ditt konto och dina data bevaras. Använd kundportalen för att öppna den säkra faktureringsportalen och uppdatera betalningsmetoden."],null,"Åtgärda fakturering"],
      payment_action_required:["Åtgärd krävs för att slutföra din Audiotel Premium Pro betalning","Betalningsverifiering krävs",["Din betalningsleverantör kräver en ytterligare åtgärd för att slutföra betalningen.","Logga in i kundportalen för att fortsätta via den säkra Stripe portalen."],null,"Slutför betalning"],
      payment_reminder:["Påminnelse: åtgärda ditt Audiotel Premium Pro abonnemang","Betalningspåminnelse",["Ditt abonnemang väntar fortfarande på att betalningen ska regleras.","Tjänsten kan fortsätta vara tillgänglig under återhämtningsperioden, men vissa funktioner kan stängas av när perioden löper ut."],null,"Åtgärda fakturering"],
      subscription_suspended:["Audiotel Premium Pro abonnemang avstängt","Abonnemang avstängt",["Tiden för betalningsåtgärd har löpt ut och betalda funktioner kan stängas av.","Ditt konto och dina data bevaras. När betalningen har reglerats kan tjänsten återupptas enligt reglerna."],null,"Åtgärda fakturering"],
      subscription_cancelled:["Ditt Audiotel Premium Pro abonnemang har avslutats","Abonnemang avslutat",["Avslutningen av ditt Audiotel Premium Pro abonnemang har registrerats.","Detta meddelande raderar inte ditt konto. Villkoren för tjänstens avslut är de som visas i kundportalen."],null,"Visa mitt konto"],
      payout_available:["Din Audiotel utbetalning är tillgänglig","Utbetalning tillgänglig",["En utbetalning från SVA trafik har klarat de nödvändiga kontrollerna och visas nu som tillgänglig i kundportalen.","Statusen i kundportalen är referensen för betalningsuppföljning."],null,"Visa mina utbetalningar"],
      portability_received:["Din portabilitetsbegäran har tagits emot","Portabilitetsbegäran registrerad",["Din portabilitetsbegäran har registrerats och behandlas enligt tillämpliga kontroller.","Ingen överföring betraktas som slutförd innan operatören har bekräftat portabiliteten."],null,"Följ min begäran"],
      support_received:["Din supportbegäran har tagits emot","Supportbegäran registrerad",["Din begäran har registrerats i servicecentret.","Du kan följa statusen i kundportalen."],null,"Öppna servicecentret"],
      support_opened:["Ett supportärende har öppnats","Supportärende öppnat",["Ett supportärende har öppnats för ditt konto.","Öppna kundportalen för att följa utvecklingen."],null,"Visa ärendet"],
      support_response:["Nytt svar på din supportbegäran","Ditt ärende har uppdaterats",["Ett nytt svar finns tillgängligt i ditt supportärende.","För att skydda informationen finns hela innehållet kvar i din säkra portal."],null,"Visa svaret"],
      support_resolved:["Din supportbegäran har lösts","Ärende löst",["Ditt supportärende har markerats som löst.","Historiken finns kvar i kundportalen."],null,"Visa ärendet"]
    }
  };
  const t=packs[lang]?.[key];
  if(!t)return {...model,lead:greetings[lang]||model.lead};
  const [subject,title,paragraphs,foot,ctaLabel]=t;
  const out={...model,subject,title,lead:greetings[lang]||model.lead,paragraphs:paragraphs||model.paragraphs};
  if(foot!==undefined&&foot!==null)out.foot=foot;
  if(out.cta&&ctaLabel)out.cta={...out.cta,label:ctaLabel};
  if(out.secondaryCta){
    const labels={en:"Download invoice PDF",es:"Descargar factura PDF",it:"Scaricare la fattura PDF",pt:"Transferir fatura PDF",de:"Rechnung als PDF herunterladen",sv:"Ladda ner faktura som PDF"};
    out.secondaryCta={...out.secondaryCta,label:labels[lang]||out.secondaryCta.label};
  }
  return out;
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
