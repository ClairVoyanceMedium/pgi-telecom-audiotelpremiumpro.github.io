(function(){
  "use strict";

  var RUNTIME=window.PGI_CONFIG||{mode:"demo",apiBaseUrl:"",features:{}};
  var CONFIG={serviceRate:0.80,payoutRate:0.46,expertCostPerMin:0.18,fixedCostPerCall:0.03};
  var state={period:"today",custom:null,baseline:null,resets:[],callFilters:{search:"",expert:"",carrier:"",status:""},diagnostics:{errors:0,lastRenderMs:0,apiStatus:"not_configured"},live:{calls:0,available:0,queue:0},authUser:null,eventSource:null,syncTimer:null,syncInFlight:false,system:null,route:null,wholesale:null,serverSummary:null,previousSummary:null,serverAnalytics:null,cdrSampleTruncated:false,market:null,marketCurrency:"EUR",mobileOverviewExpanded:false};
  var titles={overview:"Cockpit",calls:"Appels",finance:"Finance",experts:"Experts",carriers:"Opérateurs",wholesale:"Plateforme SVA",system:"Supervision",settings:"Paramètres"};
  var experts=["Frederick","Sofia","Emma","Lina","Clara","Nora"];
  var carriers=["Orange","SFR","Bouygues","Free"];
  var number089="0890 80 24 24";

  function $(id){return document.getElementById(id);}
  function qsa(sel){return Array.prototype.slice.call(document.querySelectorAll(sel));}
  function money(v){return moneyIn(v,state.marketCurrency||"EUR","fr-FR");}
  function moneyIn(v,currency,locale){
    var code=String(currency||"EUR").trim().toUpperCase();
    try{return new Intl.NumberFormat(locale||"fr-FR",{style:"currency",currency:code}).format(Number(v)||0);}
    catch(e){return nfmt(v,2)+" "+code;}
  }
  function nfmt(v,d){return new Intl.NumberFormat("fr-FR",{maximumFractionDigits:d==null?0:d}).format(Number(v)||0);}
  function pad(n){return String(n).padStart(2,"0");}
  function fmtDuration(sec){sec=Math.max(0,Math.round(sec||0));return Math.floor(sec/60)+":"+pad(sec%60);}
  function fmtDate(d){return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric"}).format(d);}
  function fmtTime(d){return new Intl.DateTimeFormat("fr-FR",{hour:"2-digit",minute:"2-digit"}).format(d);}
  function startOfDay(d){var x=new Date(d);x.setHours(0,0,0,0);return x;}
  function endOfDay(d){var x=new Date(d);x.setHours(23,59,59,999);return x;}
  function daysAgo(n){var d=new Date();d.setDate(d.getDate()-n);return d;}
  function seeded(seed){var x=Math.sin(seed)*10000;return x-Math.floor(x);}
  function maskPhone(i){var p=["06 •• •• 14 82","07 •• •• 91 26","06 •• •• 62 08","07 •• •• 35 41","06 •• •• 88 17","07 •• •• 05 73"];return p[i%p.length];}

  function buildDemoCalls(){
    var rows=[],now=new Date(),id=1;
    for(var day=0;day<92;day++){
      var base=new Date(now);base.setDate(now.getDate()-day);
      var count=day===0?18+Math.floor(seeded(31)*9):24+Math.floor(seeded(day+7)*28);
      for(var i=0;i<count;i++){
        var h=9+Math.floor(seeded(day*71+i*13)*14);
        var m=Math.floor(seeded(day*37+i*29)*60);
        var d=new Date(base);d.setHours(h,m,Math.floor(seeded(i+day)*59),0);
        if(d>now)continue;
        var r=seeded(day*901+i*53);
        var status=r<0.84?"connected":(r<0.94?"abandoned":"failed");
        var wait=Math.round(8+seeded(i*17+day)*85);
        var conv=status==="connected"?Math.round(140+seeded(i*23+day*3)*1900):0;
        var originType=(i+day)%3===0?"fixed":"mobile";
        var financial=status==="connected"&&window.PGICore?window.PGICore.computeCallFinancials(
          {conversationSeconds:conv,originType:originType},
          {serviceRateTtcPerMin:CONFIG.serviceRate,payoutRateHtPerMin:CONFIG.payoutRate,mobileDeductionHtPerMin:0,billingIncrementSeconds:60,minimumPayableSeconds:0,rounding:"ceil"}
        ):{billableSeconds:0,payoutEligibleSeconds:0,serviceAmountTtc:0,expectedPayoutHt:0};
        var billable=financial.billableSeconds/60;
        var expected=financial.expectedPayoutHt;
        var variance=status==="connected"?(seeded(day*11+i*101)<0.045?expected*(0.015+seeded(i)*0.035):0):0;
        var confirmed=Math.max(0,expected-variance);
        var ageDays=Math.floor((now-d)/86400000);
        var paid=ageDays>=60?confirmed:0;
        var ivrStarted=new Date(d.getTime()+2000);
        var queued=new Date(d.getTime()+7000);
        var bridged=status==="connected"?new Date(d.getTime()+wait*1000):null;
        var ended=new Date((bridged||d).getTime()+(status==="connected"?conv*1000:wait*1000));
        var qseed=seeded(day*19+i*7);
        rows.push({
          id:id++,ts:d,ivrStarted:ivrStarted,queued:queued,bridged:bridged,ended:ended,
          caller:maskPhone(i+day),carrier:carriers[(i+day)%carriers.length],number:number089,market:"FR",currency:"EUR",
          expert:experts[(i*3+day)%experts.length],wait:wait,conversation:conv,total:Math.max(0,Math.round((ended-d)/1000)),billable:billable,
          originType:originType,
          payoutEligible:financial.payoutEligibleSeconds/60,expected:expected,confirmed:confirmed,paid:paid,status:status,
          billableSeconds:financial.billableSeconds,payoutEligibleSeconds:financial.payoutEligibleSeconds,
          expectedPayoutHt:expected,confirmedPayoutHt:confirmed,paidPayoutHt:paid,
          expertCost:billable*CONFIG.expertCostPerMin,cost:CONFIG.fixedCostPerCall,
          expertCostHt:billable*CONFIG.expertCostPerMin,technicalCostHt:CONFIG.fixedCostPerCall,
          serviceAmount:financial.serviceAmountTtc,serviceAmountTtc:financial.serviceAmountTtc,
          serviceRate:CONFIG.serviceRate,carrierRate:CONFIG.payoutRate,
          variance:Math.max(0,expected-confirmed),
          sipFinalCode:status==="connected"?200:(status==="abandoned"?487:503),
          hangupCause:status==="connected"?"NORMAL_CLEARING":(status==="abandoned"?"ORIGINATOR_CANCEL":"NORMAL_TEMPORARY_FAILURE"),
          codec:"PCMA",
          packetLoss:+(qseed*0.35).toFixed(3),
          jitter:+(3+qseed*7).toFixed(2),
          latency:+(18+qseed*28).toFixed(2),
          mos:+(4.45-qseed*0.35).toFixed(2)
        });
      }
    }
    return rows.sort(function(a,b){return b.ts-a.ts;});
  }

  var allCalls=RUNTIME.mode==="production"?[]:buildDemoCalls();

  function apiCallToUi(c){
    var q=c.quality||{};
    var ts=new Date(c.started_at);
    var ivr=c.ivr_started_at?new Date(c.ivr_started_at):new Date(ts.getTime()+2000);
    var queued=c.queued_at?new Date(c.queued_at):ivr;
    var bridged=c.bridged_at?new Date(c.bridged_at):null;
    var ended=c.ended_at?new Date(c.ended_at):new Date(ts.getTime()+Number(c.total_seconds||0)*1000);
    var billableSeconds=Number(c.billable_seconds||0);
    var payoutEligibleSeconds=Number(c.payout_eligible_seconds||0);
    return {
      id:c.id,ts:ts,ivrStarted:ivr,queued:queued,bridged:bridged,ended:ended,
      caller:c.caller_masked||"—",carrier:c.origin_carrier||"Inconnu",number:c.sva_number||"—",
      market:c.market||"FR",currency:c.currency||"EUR",
      expert:c.expert_name||"Non attribué",expertId:c.expert_id||null,
      wait:Number(c.wait_seconds||0),conversation:Number(c.conversation_seconds||0),total:Number(c.total_seconds||0),
      billable:billableSeconds/60,originType:c.origin_type||"unknown",payoutEligible:payoutEligibleSeconds/60,
      expected:Number(c.expected_payout_ht||0),confirmed:c.confirmed_payout_ht==null?0:Number(c.confirmed_payout_ht||0),
      paid:Number(c.paid_payout_ht||0),status:c.call_status||"failed",
      billableSeconds:billableSeconds,payoutEligibleSeconds:payoutEligibleSeconds,
      expectedPayoutHt:Number(c.expected_payout_ht||0),confirmedPayoutHt:c.confirmed_payout_ht==null?0:Number(c.confirmed_payout_ht||0),
      paidPayoutHt:Number(c.paid_payout_ht||0),expertCost:Number(c.expert_cost_ht||0),cost:Number(c.technical_cost_ht||0),
      expertCostHt:Number(c.expert_cost_ht||0),technicalCostHt:Number(c.technical_cost_ht||0),
      serviceAmount:Number(c.retail_service_amount_ttc||0),serviceAmountTtc:Number(c.retail_service_amount_ttc||0),
      serviceRate:Number(c.service_rate_ttc_per_min||0),carrierRate:Number(c.carrier_rate_ht_per_min||0),
      variance:Number(c.reconciliation_variance_ht||0),sipFinalCode:Number(c.sip_final_code||0),
      hangupCause:c.hangup_cause||"—",codec:c.codec||"—",
      packetLoss:Number(q.packet_loss_percent||0),jitter:Number(q.jitter_ms||0),latency:Number(q.latency_ms||0),mos:Number(q.mos||0)
    };
  }

  function productionDataRange(){
    return getRange();
  }

  function comparisonRange(range){
    if(state.baseline)return null;
    var now=new Date(),effectiveTo=range.to<now?range.to:now;
    var duration=Math.max(1,effectiveTo-range.from);
    var to=new Date(range.from.getTime()-1);
    return {from:new Date(to.getTime()-duration),to:to};
  }

  async function loadAllApiCalls(from,to,market){
    var data=[],cursor=null,pages=0,maxPages=4;
    do{
      var params={from:from.toISOString(),to:to.toISOString(),limit:"250"};
      if(market)params.market=market;
      if(cursor)params.cursor=cursor;
      var page=await window.PGIApi.calls(params);
      data=data.concat(Array.isArray(page.data)?page.data:[]);
      cursor=page.next_cursor||null;
      pages++;
    }while(cursor&&pages<maxPages);
    return {data:data,truncated:!!cursor};
  }

  function setProductionLive(summary){
    state.live.calls=Number(summary&&summary.live_calls||0);
    state.live.available=Number(summary&&summary.active_experts||0);
    state.live.queue=Number(summary&&summary.queue_depth||0);
  }

  function syncMarketSelector(data){
    var markets=data&&Array.isArray(data.markets)?data.markets:[];
    var active=markets.filter(function(x){return String(x.status||"").toLowerCase()==="active";});
    var current=state.market;
    if(!active.some(function(x){return x.country_code===current;})){
      var preferred=active.find(function(x){return x.country_code==="FR";})||active[0]||null;
      current=preferred?preferred.country_code:null;
    }
    state.market=current;
    var selected=active.find(function(x){return x.country_code===current;})||null;
    state.marketCurrency=selected&&selected.default_currency?selected.default_currency:"EUR";

    var wrap=$("market-filter-wrap"),select=$("market-filter");
    if(select){
      select.innerHTML=active.map(function(x){
        var label=(x.display_name||x.country_code)+" ("+x.country_code+")";
        return '<option value="'+esc(x.country_code)+'">'+esc(label)+"</option>";
      }).join("");
      if(current)select.value=current;
      select.disabled=active.length<2;
    }
    if(wrap)wrap.hidden=active.length<2;
  }

  function showLogin(message){
    var dialog=$("auth-dialog");
    var msg=$("auth-message");
    if(msg)msg.textContent=message||"Identifiez-vous pour accéder aux données de production.";
    if(dialog&&typeof dialog.showModal==="function"&&!dialog.open)dialog.showModal();
  }

  function closeLogin(){
    var dialog=$("auth-dialog");
    if(dialog&&dialog.open)dialog.close();
  }

  function stopProductionEvents(){
    if(state.eventSource){
      try{state.eventSource.close();}catch(e){}
      state.eventSource=null;
    }
  }

  function clearProductionData(){
    if(RUNTIME.mode!=="production")return;
    allCalls=[];
    experts=[];
    carriers=[];
    state.system=null;
    state.route=null;
    state.wholesale=null;
    state.serverSummary=null;
    state.previousSummary=null;
    state.serverAnalytics=null;
    state.cdrSampleTruncated=false;
    setProductionLive({});
    render();
  }

  function requireProductionLogin(message){
    if(RUNTIME.mode!=="production")return;
    state.authUser=null;
    stopProductionEvents();
    var logout=$("logout-btn");if(logout)logout.hidden=true;
    clearProductionData();
    showLogin(message||"Session requise. Saisissez vos identifiants administrateur.");
  }

  async function logoutProduction(){
    if(RUNTIME.mode!=="production"||!window.PGIApi)return;
    var button=$("logout-btn");if(button)button.disabled=true;
    try{await window.PGIApi.logout();}catch(e){}
    finally{
      if(button)button.disabled=false;
      requireProductionLogin("Session fermée. Identifiez-vous pour continuer.");
    }
  }

  function scheduleProductionSync(){
    if(RUNTIME.mode!=="production")return;
    clearTimeout(state.syncTimer);
    state.syncTimer=setTimeout(function(){syncProductionData();},700);
  }

  function startProductionEvents(){
    if(RUNTIME.mode!=="production"||state.eventSource||!window.PGIApi)return;
    try{
      var es=window.PGIApi.events();
      state.eventSource=es;
      ["call.ingested","expert.status","expert.busy","expert.released","baseline.created","carrier.switched","carrier.rollback","alert"].forEach(function(name){
        es.addEventListener(name,scheduleProductionSync);
      });
      es.onerror=function(){
        if(es.readyState===EventSource.CLOSED){state.eventSource=null;}
      };
    }catch(e){recordRuntimeError();}
  }

  async function syncProductionData(){
    if(RUNTIME.mode!=="production"||!window.PGIApi||state.syncInFlight)return;
    state.syncInFlight=true;
    var refresh=$("refresh-btn");
    if(refresh)refresh.disabled=true;
    try{
      var me=await window.PGIApi.me();
      state.authUser=me&&me.user?me.user:null;
      closeLogin();
      var logout=$("logout-btn");if(logout)logout.hidden=false;
      var baselineResult=await window.PGIApi.baselines({scope:"global",limit:"20"});
      var baselineRows=Array.isArray(baselineResult&&baselineResult.data)?baselineResult.data:[];
      state.resets=baselineRows.map(function(x){return {at:x.effective_from||x.created_at,scope:x.scope,reason:x.reason||""};});
      state.baseline=baselineRows.length?new Date(baselineRows[0].effective_from||baselineRows[0].created_at):null;
      var wholesale=await window.PGIApi.wholesaleOverview().catch(function(){return null;});
      state.wholesale=wholesale;
      syncMarketSelector(wholesale);
      var range=getRange();
      var windowRange=productionDataRange();
      var prevRange=comparisonRange(range);
      var results=await Promise.all([
        loadAllApiCalls(windowRange.from,windowRange.to,state.market),
        window.PGIApi.summary(range.from.toISOString(),range.to.toISOString(),state.market),
        prevRange
          ?window.PGIApi.summary(prevRange.from.toISOString(),prevRange.to.toISOString(),state.market)
          :Promise.resolve(null),
        window.PGIApi.analytics(range.from.toISOString(),range.to.toISOString(),state.market).catch(function(){return null;}),
        window.PGIApi.experts(),
        window.PGIApi.systemHealth(),
        window.PGIApi.carrierRouting()
      ]);
      var sample=results[0]||{data:[],truncated:false};
      allCalls=(Array.isArray(sample.data)?sample.data:[]).map(apiCallToUi)
        .filter(function(x){return Number.isFinite(x.ts.getTime());})
        .sort(function(a,b){return b.ts-a.ts;});
      state.cdrSampleTruncated=!!sample.truncated;
      state.serverSummary=results[1]||null;
      state.previousSummary=results[2]||null;
      state.serverAnalytics=results[3]||null;
      if(state.serverSummary&&Number(state.serverSummary.currency_count||0)===1&&state.serverSummary.currency){
        state.marketCurrency=String(state.serverSummary.currency);
      }
      var expertRows=Array.isArray(results[4]&&results[4].data)?results[4].data:[];
      experts=expertRows.map(function(x){return x.display_name;}).filter(Boolean);
      var networkNames=Array.from(new Set(allCalls.map(function(x){return x.carrier;}).filter(Boolean)));
      carriers=networkNames;
      state.system=results[5]||null;
      state.route=results[6]||null;
      setProductionLive(state.serverSummary||{});
      state.diagnostics.apiStatus="ok";
      render();
      startProductionEvents();
    }catch(e){
      if(e&&e.status===401){
        requireProductionLogin("Session expirée. Identifiez-vous de nouveau.");
      }else{
        state.diagnostics.apiStatus="error";
        recordRuntimeError();
      }
    }finally{
      state.syncInFlight=false;
      if(refresh)refresh.disabled=false;
    }
  }

  function refreshData(){
    if(RUNTIME.mode==="production")syncProductionData();
    else render();
  }

  async function submitLogin(){
    var username=$("auth-username"),password=$("auth-password"),button=$("auth-submit"),msg=$("auth-message");
    if(!username||!password||!window.PGIApi)return;
    if(button)button.disabled=true;
    if(msg)msg.textContent="Connexion…";
    try{
      await window.PGIApi.login(username.value,password.value);
      password.value="";
      closeLogin();
      await syncProductionData();
    }catch(e){
      if(msg)msg.textContent=e&&e.status===429?"Trop de tentatives. Réessayez dans un instant.":"Identifiants invalides ou API indisponible.";
      password.focus();
    }finally{
      if(button)button.disabled=false;
    }
  }

  function loadState(){
    if(RUNTIME.mode==="production")return;
    try{
      var raw=localStorage.getItem("pgi-audiotel-state");
      if(raw){
        var parsed=JSON.parse(raw);
        if(parsed.baseline)state.baseline=new Date(parsed.baseline);
        if(Array.isArray(parsed.resets))state.resets=parsed.resets;
      }
    }catch(e){}
  }
  function saveState(){
    if(RUNTIME.mode==="production")return;
    try{localStorage.setItem("pgi-audiotel-state",JSON.stringify({baseline:state.baseline?state.baseline.toISOString():null,resets:state.resets}));}catch(e){}
  }

  function getRange(){
    var now=new Date(),from,to=endOfDay(now);
    if(state.period==="today"){from=startOfDay(now);}
    else if(state.period==="7d"){from=startOfDay(daysAgo(6));}
    else if(state.period==="week"){
      var n=now.getDay()||7;from=startOfDay(now);from.setDate(now.getDate()-n+1);
    }else if(state.period==="month"){from=new Date(now.getFullYear(),now.getMonth(),1);}
    else if(state.period==="year"){from=new Date(now.getFullYear(),0,1);}
    else if(state.period==="custom"&&state.custom){from=startOfDay(state.custom.from);to=endOfDay(state.custom.to);}
    else{from=startOfDay(now);}
    if(state.baseline&&state.baseline>from)from=new Date(state.baseline);
    return {from:from,to:to};
  }

  function filteredCalls(){
    var r=getRange();
    return allCalls.filter(function(c){return c.ts>=r.from&&c.ts<=r.to;});
  }

  function aggregate(rows){
    if(window.PGICore){
      var x=window.PGICore.aggregateCalls(rows);
      return {
        calls:x.calls,connected:x.connected,abandoned:x.abandoned,failed:x.failed,
        mins:x.billableSeconds/60,expected:x.expectedPayoutHt,confirmed:x.confirmedPayoutHt,paid:x.paidPayoutHt,
        ca:x.generatedRevenueTtc,margin:x.estimatedMarginHt,acd:x.acdSeconds,asr:x.asrPercent,gap:x.reconciliationVarianceHt
      };
    }
    return {calls:0,connected:0,abandoned:0,failed:0,mins:0,expected:0,confirmed:0,paid:0,ca:0,margin:0,acd:0,asr:0,gap:0};
  }

  function summaryAggregate(summary){
    var s=summary||{},mixed=!!s.mixed_currency;
    return {
      calls:Number(s.calls_total||0),connected:Number(s.calls_connected||0),
      abandoned:Number(s.calls_abandoned||0),failed:Number(s.calls_failed||0),
      mins:Number(s.billable_minutes||0),expected:mixed?NaN:Number(s.expected_payout_ht||0),
      confirmed:mixed?NaN:Number(s.confirmed_payout_ht||0),paid:mixed?NaN:Number(s.paid_payout_ht||0),
      ca:mixed?NaN:Number(s.generated_revenue_ttc||0),margin:mixed?NaN:Number(s.estimated_margin_ht||0),
      acd:Number(s.acd_seconds||0),asr:Number(s.asr_percent||0),
      gap:mixed?NaN:Number(s.reconciliation_variance_ht||0),mixedCurrency:mixed
    };
  }

  function currentAggregate(rows){
    return RUNTIME.mode==="production"&&state.serverSummary?summaryAggregate(state.serverSummary):aggregate(rows);
  }

  function monetaryLabel(value,mixed){
    return mixed?"Multi-devises":money(value);
  }

  function setText(id,val){var e=$(id);if(e)e.textContent=val;}

  function effectiveRate(rows,amountKey,secondsKey){
    var amount=0,seconds=0;
    rows.forEach(function(x){
      amount+=Number(x[amountKey]||0);
      seconds+=Number(x[secondsKey]||0);
    });
    return seconds>0?amount/(seconds/60):0;
  }

  function renderFinancialSettings(rows){
    var summary=RUNTIME.mode==="production"?state.serverSummary:null;
    var mixed=!!(summary&&summary.mixed_currency);
    var service=summary&&!mixed&&Number(summary.billable_minutes||0)>0
      ?Number(summary.generated_revenue_ttc||0)/Number(summary.billable_minutes)
      :effectiveRate(rows,"serviceAmountTtc","billableSeconds");
    var payout=summary&&!mixed&&Number(summary.payout_eligible_minutes||0)>0
      ?Number(summary.expected_payout_ht||0)/Number(summary.payout_eligible_minutes)
      :effectiveRate(rows,"expectedPayoutHt","payoutEligibleSeconds");
    var expert=summary&&!mixed&&Number(summary.billable_minutes||0)>0
      ?Number(summary.expert_cost_ht||0)/Number(summary.billable_minutes)
      :effectiveRate(rows,"expertCostHt","billableSeconds");
    setText("settings-finance-kicker",RUNTIME.mode==="production"?"CONFIGURATION RÉELLE":"CONFIGURATION DÉMO");
    setText("settings-finance-title",RUNTIME.mode==="production"?"Taux observés sur la période":"Hypothèses financières");
    setText("settings-service-rate",money(service)+"/min");
    setText("settings-payout-rate",money(payout)+"/min");
    setText("settings-expert-rate",money(expert)+"/min");
    setText("settings-finance-note",RUNTIME.mode==="production"
      ?"Taux effectifs dérivés des CDR et écritures financières de la période sélectionnée."
      :"Valeurs utilisées uniquement pour générer les données de démonstration.");
  }


  function revenueTrendPercent(currentRows){
    if(state.baseline)return null;
    if(RUNTIME.mode==="production"&&state.serverSummary&&state.previousSummary){
      var currentSummary=summaryAggregate(state.serverSummary);
      var previousSummary=summaryAggregate(state.previousSummary);
      if(currentSummary.mixedCurrency||previousSummary.mixedCurrency||previousSummary.ca<=0)return null;
      return (currentSummary.ca-previousSummary.ca)/previousSummary.ca*100;
    }
    var range=getRange(),now=new Date();
    var effectiveTo=range.to<now?range.to:now;
    var duration=Math.max(1,effectiveTo-range.from);
    var previousTo=new Date(range.from.getTime()-1);
    var previousFrom=new Date(previousTo.getTime()-duration);
    var previousRows=allCalls.filter(function(c){return c.ts>=previousFrom&&c.ts<=previousTo;});
    var current=aggregate(currentRows).ca;
    var previous=aggregate(previousRows).ca;
    if(previous<=0)return null;
    return (current-previous)/previous*100;
  }

  function renderKPIs(rows){
    var a=currentAggregate(rows),mixed=!!a.mixedCurrency;
    setText("kpi-ca",monetaryLabel(a.ca,mixed));
    setText("kpi-expected",monetaryLabel(a.expected,mixed));
    setText("kpi-paid",monetaryLabel(a.paid,mixed));
    setText("kpi-gap",mixed?"Écart : multi-devises":"Écart : "+money(a.gap));
    setText("kpi-margin",monetaryLabel(a.margin,mixed));
    setText("kpi-calls",nfmt(a.calls));
    setText("kpi-connected",nfmt(a.connected)+" aboutis");
    setText("kpi-minutes",nfmt(a.mins));
    setText("kpi-acd","ACD "+fmtDuration(a.acd));
    setText("kpi-asr",nfmt(a.asr,1)+"%");
    setText("kpi-abandon",nfmt(a.abandoned)+" abandons");
    setText("kpi-experts",String(Math.min(experts.length,Math.max(0,new Set(rows.filter(function(x){return x.status==="connected";}).map(function(x){return x.expert;})).size))));
    setText("kpi-live","Historique sélectionné");
    var payoutRate=RUNTIME.mode==="production"&&state.serverSummary&&Number(state.serverSummary.payout_eligible_minutes||0)>0&&!mixed
      ?Number(state.serverSummary.expected_payout_ht||0)/Number(state.serverSummary.payout_eligible_minutes)
      :effectiveRate(rows,"expectedPayoutHt","payoutEligibleSeconds");
    setText("kpi-rate",mixed?"Taux moyen : multi-devises":"Taux moyen : "+money(payoutRate)+"/min");
    setText("fin-ca",monetaryLabel(a.ca,mixed));
    setText("fin-expected",monetaryLabel(a.expected,mixed));
    setText("fin-confirmed",monetaryLabel(a.confirmed,mixed));
    setText("fin-paid",monetaryLabel(a.paid,mixed));
    setText("fin-gap",monetaryLabel(a.gap,mixed));
    setText("live-calls",String(state.live.calls||0));
    setText("live-available",String(state.live.available||0));
    setText("live-queue",String(state.live.queue||0));
    var trend=$("ca-trend");
    if(trend){
      var pct=revenueTrendPercent(rows);
      if(pct==null||!Number.isFinite(pct)){
        trend.textContent="—";
        trend.className="trend";
      }else{
        trend.textContent=(pct>=0?"+":"")+nfmt(pct,1)+"%";
        trend.className="trend "+(pct>=0?"up":"down");
      }
    }
  }

  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c];});}
  function chip(status){var label=status==="connected"?"ABOUTI":status==="abandoned"?"ABANDON":"ÉCHEC";return '<span class="status-chip '+status+'">'+label+"</span>";}

  function applyCallFilters(rows){
    var f=state.callFilters||{},s=(f.search||"").trim().toLowerCase();
    return rows.filter(function(c){
      if(f.expert&&c.expert!==f.expert)return false;
      if(f.carrier&&c.carrier!==f.carrier)return false;
      if(f.status&&c.status!==f.status)return false;
      if(s){
        var hay=[c.caller,c.carrier,c.expert,c.number,c.status].join(" ").toLowerCase();
        if(hay.indexOf(s)===-1)return false;
      }
      return true;
    });
  }

  function clamp(v,min,max){return Math.max(min,Math.min(max,v));}

  function previousPeriodRows(){
    if(state.baseline)return [];
    var r=getRange(),now=new Date(),effectiveTo=r.to<now?r.to:now;
    var duration=Math.max(1,effectiveTo-r.from);
    var prevTo=new Date(r.from.getTime()-1);
    var prevFrom=new Date(prevTo.getTime()-duration);
    return allCalls.filter(function(c){return c.ts>=prevFrom&&c.ts<=prevTo;});
  }

  function percentDelta(current,previous){
    if(!Number.isFinite(previous)||previous===0)return null;
    return (current-previous)/Math.abs(previous)*100;
  }

  function deltaText(current,previous,suffix){
    var d=percentDelta(current,previous);
    if(d==null||!Number.isFinite(d))return "—";
    return (d>=0?"+":"")+nfmt(d,1)+"%"+(suffix||"");
  }

  function qualityStats(rows){
    var valid=rows.filter(function(c){
      return c.status==="connected"&&Number.isFinite(c.mos)&&Number.isFinite(c.packetLoss)&&Number.isFinite(c.jitter)&&Number.isFinite(c.latency);
    });
    if(!valid.length)return {count:0,mos:0,loss:0,jitter:0,latency:0,score:0,grade:"—"};
    var avg=function(key){return valid.reduce(function(s,x){return s+Number(x[key]||0);},0)/valid.length;};
    var mos=avg("mos"),loss=avg("packetLoss"),jitter=avg("jitter"),latency=avg("latency");
    var score=clamp(
      (clamp((mos-1)/3.5*100,0,100)*.45)+
      (clamp(100-loss*22,0,100)*.20)+
      (clamp(100-jitter*2.5,0,100)*.15)+
      (clamp(100-latency*.55,0,100)*.20),0,100
    );
    var grade=score>=92?"A+":score>=86?"A":score>=78?"B":score>=68?"C":"D";
    return {count:valid.length,mos:mos,loss:loss,jitter:jitter,latency:latency,score:score,grade:grade};
  }

  function currentQuality(rows){
    var analytics=cockpitAnalytics(rows),q=analytics&&analytics.quality;
    if(q&&Number(q.samples||0)>0){
      var mos=Number(q.mos||0),loss=Number(q.packet_loss_percent||0),jitter=Number(q.jitter_ms||0),latency=Number(q.latency_ms||0);
      var score=clamp(
        (clamp((mos-1)/3.5*100,0,100)*.45)+
        (clamp(100-loss*22,0,100)*.20)+
        (clamp(100-jitter*2.5,0,100)*.15)+
        (clamp(100-latency*.55,0,100)*.20),0,100
      );
      var grade=score>=92?"A+":score>=86?"A":score>=78?"B":score>=68?"C":"D";
      return {count:Number(q.samples||0),mos:mos,loss:loss,jitter:jitter,latency:latency,score:score,grade:grade,dtmfErrors:Number(q.dtmf_errors||0)};
    }
    return qualityStats(rows);
  }

  function renderExecutive(rows){
    var cur=currentAggregate(rows),prev=RUNTIME.mode==="production"&&state.previousSummary?summaryAggregate(state.previousSummary):aggregate(previousPeriodRows()),q=currentQuality(rows);
    var recScore=cur.expected>0?clamp(100-(cur.gap/cur.expected*100*5),0,100):100;
    var asrScore=cur.calls?clamp(cur.asr/90*100,0,100):0;
    var ops=cur.calls?Math.round(asrScore*.45+recScore*.30+q.score*.25):0;
    setText("ops-score",String(ops));
    var ring=$("ops-score-ring");if(ring)ring.style.setProperty("--score",String(ops));
    var label=ops>=92?"Excellent":ops>=82?"Très solide":ops>=70?"Correct":ops>=55?"À renforcer":"Insuffisant";
    setText("ops-score-label",label);
    setText("ops-score-detail",cur.calls?"ASR "+nfmt(cur.asr,1)+"% • concordance "+nfmt(recScore,1)+"% • qualité "+q.grade:"Aucune donnée sur la période");

    setText("cmp-ca",deltaText(cur.ca,prev.ca));
    setText("cmp-calls",deltaText(cur.calls,prev.calls));
    setText("cmp-minutes",deltaText(cur.mins,prev.mins));
    var asrDiff=(prev.calls?cur.asr-prev.asr:null);
    setText("cmp-asr",asrDiff==null?"—":(asrDiff>=0?"+":"")+nfmt(asrDiff,1)+" pt");
  }

  function renderHeatmap(rows){
    var labels=["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"],matrix=[],max=0,peak={count:0,day:0,hour:0};
    for(var d=0;d<7;d++)matrix[d]=Array(24).fill(0);
    var analytics=cockpitAnalytics(rows);
    if(Array.isArray(analytics.heatmap)&&analytics.heatmap.length){
      analytics.heatmap.forEach(function(cell){
        var day=Math.max(0,Math.min(6,Number(cell.weekday||1)-1)),hour=Math.max(0,Math.min(23,Number(cell.hour||0)));
        matrix[day][hour]=Number(cell.calls_total||0);
      });
    }else{
      rows.forEach(function(c){
        var day=(c.ts.getDay()+6)%7,h=c.ts.getHours();
        matrix[day][h]++;
      });
    }
    for(var day=0;day<7;day++)for(var h=0;h<24;h++){
      var count=matrix[day][h];
      if(count>peak.count)peak={count:count,day:day,hour:h};
      if(count>max)max=count;
    }
    var html="";
    for(var day=0;day<7;day++){
      html+='<span class="heatmap-day">'+labels[day]+'</span><div class="heatmap-row">';
      for(var h=0;h<24;h++){
        var count=matrix[day][h],level=max?count/max:0;
        html+='<i class="heat-cell" style="--heat:'+level.toFixed(3)+'" title="'+labels[day]+' '+pad(h)+'h : '+count+' appel'+(count>1?"s":"")+'"></i>';
      }
      html+="</div>";
    }
    var el=$("traffic-heatmap");if(el)el.innerHTML=html;
    setText("peak-slot",peak.count?labels[peak.day]+" "+pad(peak.hour)+"h • "+peak.count:"Pic —");
  }

  function renderFunnel(rows){
    var analytics=cockpitAnalytics(rows),m=currentAggregate(rows);
    var durationMap={};
    (analytics.durations||[]).forEach(function(x){durationMap[x.dimension_key]=Number(x.calls_total||0);});
    var total=Number(m.calls||0),connected=Number(m.connected||0);
    var longCalls=(durationMap["10_20m"]||0)+(durationMap["20_30m"]||0)+(durationMap["gte_30m"]||0);
    var payable=connected;
    var stages=[["Entrants",total],["Aboutis",connected],["> 10 min",longCalls],["Éligibles reversement",payable]];
    var max=Math.max(1,total),el=$("call-funnel");
    if(el)el.innerHTML=stages.map(function(stage){
      var pct=stage[1]/max*100;
      return '<div class="funnel-stage"><div class="funnel-meta"><span>'+esc(stage[0])+'</span><strong>'+nfmt(stage[1])+' <small>'+nfmt(pct,1)+'%</small></strong></div><i><b style="width:'+pct.toFixed(1)+'%"></b></i></div>';
    }).join("");
  }

  function renderQuality(rows){
    var q=currentQuality(rows);
    setText("quality-grade",q.grade);
    setText("quality-mos",q.count?nfmt(q.mos,2):"—");
    setText("quality-loss",q.count?nfmt(q.loss,3)+"%":"—");
    setText("quality-jitter",q.count?nfmt(q.jitter,1)+" ms":"—");
    setText("quality-latency",q.count?nfmt(q.latency,1)+" ms":"—");
    var bars={
      "quality-mos-bar":q.count?clamp(q.mos/5*100,0,100):0,
      "quality-loss-bar":q.count?clamp(100-q.loss*20,0,100):0,
      "quality-jitter-bar":q.count?clamp(100-q.jitter*2,0,100):0,
      "quality-latency-bar":q.count?clamp(100-q.latency*.5,0,100):0
    };
    Object.keys(bars).forEach(function(id){var el=$(id);if(el)el.style.width=bars[id].toFixed(1)+"%";});
    setText("noc-voice-grade",q.grade);
  }

  function expertMetrics(rows){
    return experts.map(function(name){
      var r=rows.filter(function(x){return x.expert===name;}),m=aggregate(r);
      return {name:name,rows:r,m:m};
    });
  }

  function renderOverviewExpertRanking(rows){
    var el=$("overview-expert-ranking"),analytics=cockpitAnalytics(rows);
    if(RUNTIME.mode==="production"&&Array.isArray(analytics.experts)){
      var data=analytics.experts.slice(0,4);
      var max=data.length?Math.max.apply(null,data.map(function(x){return Number(x.expected_payout||x.calls_total||0);})):1;
      if(el)el.innerHTML=data.map(function(x,i){
        var value=Number(x.expected_payout||x.calls_total||0),width=max?value/max*100:0;
        var asr=Number(x.calls_total)?Number(x.calls_connected||0)/Number(x.calls_total)*100:0;
        return '<div class="ranking-item"><span class="rank-no">'+(i+1)+'</span><div class="rank-main"><div><strong>'+esc(x.dimension_label||"—")+'</strong><small>'+nfmt(Number(x.billable_seconds||0)/60)+' min • ASR '+nfmt(asr,1)+'%</small></div><i><b style="width:'+width.toFixed(1)+'%"></b></i></div><strong class="rank-value">'+(x.expected_payout==null?nfmt(x.calls_total)+" appels":money(x.expected_payout))+'</strong></div>';
      }).join("")||'<p class="muted">Aucune donnée.</p>';
      return;
    }
    var data=expertMetrics(rows).sort(function(a,b){return b.m.expected-a.m.expected;}).slice(0,4);
    var max=data.length?Math.max.apply(null,data.map(function(x){return x.m.expected;})):1;
    if(el)el.innerHTML=data.map(function(x,i){
      var width=max?x.m.expected/max*100:0;
      return '<div class="ranking-item"><span class="rank-no">'+(i+1)+'</span><div class="rank-main"><div><strong>'+esc(x.name)+'</strong><small>'+nfmt(x.m.mins)+' min • ASR '+nfmt(x.m.asr,1)+'%</small></div><i><b style="width:'+width.toFixed(1)+'%"></b></i></div><strong class="rank-value">'+money(x.m.expected)+'</strong></div>';
    }).join("")||'<p class="muted">Aucune donnée.</p>';
  }

  function renderNetworkMix(rows){
    var analytics=cockpitAnalytics(rows);
    var counts=RUNTIME.mode==="production"&&Array.isArray(analytics.carriers)
      ?analytics.carriers.slice(0,6).map(function(x){return {name:x.dimension_label||"Inconnu",count:Number(x.calls_total||0)};})
      :carriers.map(function(name){return {name:name,count:rows.filter(function(x){return x.carrier===name;}).length};});
    var actualTotal=counts.reduce(function(a,x){return a+x.count;},0),total=actualTotal||1,cum=0,stops=[],colors=["var(--cyan)","var(--purple)","var(--green)","var(--amber)","#4f9cff","#f472b6"];
    counts.forEach(function(x,i){var from=cum/total*100;cum+=x.count;var to=cum/total*100;stops.push(colors[i%colors.length]+" "+from.toFixed(2)+"% "+to.toFixed(2)+"%");});
    var donut=$("network-donut");if(donut)donut.style.background=stops.length?"conic-gradient("+stops.join(",")+")":"rgba(255,255,255,.03)";
    setText("network-total",nfmt(actualTotal));
    var legend=$("network-legend");
    if(legend)legend.innerHTML=counts.map(function(x,i){
      var pct=actualTotal?x.count/actualTotal*100:0;
      return '<div><i style="--dot:'+colors[i%colors.length]+'"></i><span>'+esc(x.name)+'</span><strong>'+nfmt(pct,1)+'%</strong></div>';
    }).join("");
  }

  function renderFinanceAnalytics(rows){
    var m=currentAggregate(rows);
    if(m.mixedCurrency){
      var mixedEl=$("finance-waterfall");
      if(mixedEl)mixedEl.innerHTML='<p class="muted">Plusieurs devises sont présentes. Sélectionnez un marché/devise pour obtenir des totaux financiers comparables.</p>';
      ["ratio-payout","ratio-confirmed","ratio-paid","ratio-margin"].forEach(function(id){setText(id,"—");});
      return;
    }
    var max=Math.max(1,m.ca,m.expected,m.confirmed,m.paid,Math.max(0,m.margin));
    var stages=[
      ["CA service TTC",m.ca,"cyan"],
      ["Reversement attendu",m.expected,"purple"],
      ["Confirmé",m.confirmed,"green"],
      ["Encaissé",m.paid,"green"],
      ["Marge estimée",Math.max(0,m.margin),"amber"]
    ];
    var el=$("finance-waterfall");
    if(el)el.innerHTML=stages.map(function(s){
      return '<div class="waterfall-row"><span>'+esc(s[0])+'</span><div><i><b class="'+s[2]+'" style="width:'+(s[1]/max*100).toFixed(1)+'%"></b></i><strong>'+money(s[1])+'</strong></div></div>';
    }).join("");
    setText("ratio-payout",m.ca? nfmt(m.expected/m.ca*100,1)+"%":"—");
    setText("ratio-confirmed",m.expected? nfmt(m.confirmed/m.expected*100,1)+"%":"—");
    setText("ratio-paid",m.confirmed? nfmt(m.paid/m.confirmed*100,1)+"%":"—");
    setText("ratio-margin",m.confirmed? nfmt(m.margin/m.confirmed*100,1)+"%":"—");
  }

  function renderExpertSummary(rows){
    var data=expertMetrics(rows).filter(function(x){return x.m.calls>0;});
    if(!data.length){
      ["expert-best","expert-best-acd","expert-best-asr"].forEach(function(id){setText(id,"—");});
      setText("expert-team-minutes","0");return;
    }
    var byContribution=data.slice().sort(function(a,b){return b.m.expected-a.m.expected;})[0];
    var byAcd=data.slice().sort(function(a,b){return b.m.acd-a.m.acd;})[0];
    var byAsr=data.slice().sort(function(a,b){return b.m.asr-a.m.asr;})[0];
    setText("expert-best",byContribution.name+" • "+money(byContribution.m.expected));
    setText("expert-best-acd",byAcd.name+" • "+fmtDuration(byAcd.m.acd));
    setText("expert-best-asr",byAsr.name+" • "+nfmt(byAsr.m.asr,1)+"%");
    setText("expert-team-minutes",nfmt(aggregate(rows).mins));
  }

  function cdrPipelineState(){
    if(RUNTIME.mode!=="production")return {label:"MODE DÉMO",overview:"DÉMO LOCALE",className:"warn"};
    if(state.diagnostics.apiStatus!=="ok")return {label:"API INDISPONIBLE",overview:"INDISPONIBLE",className:"warn"};
    if(!state.system)return {label:"EN ATTENTE",overview:"EN ATTENTE",className:"warn"};
    var total=Number(state.system.calls_total||0);
    if(total<=0)return {label:"AUCUN CDR REÇU",overview:"AUCUN CDR",className:"warn"};
    var lag=Number(state.system.cdr_lag_seconds);
    if(Number.isFinite(lag)&&lag>3600)return {label:"DERNIER CDR ANCIEN",overview:"CDR ANCIEN",className:"warn"};
    return {label:"CDR REÇUS",overview:"ACTIF",className:"ok"};
  }

  function renderSystemState(){
    var pipeline=cdrPipelineState();
    var cdrState=$("cdr-state");
    if(cdrState){cdrState.textContent=pipeline.label;cdrState.className="big-status "+pipeline.className;}
    var overviewCdr=$("overview-cdr-state");
    if(overviewCdr){overviewCdr.textContent=pipeline.overview;overviewCdr.className="health "+pipeline.className;}
    var system=state.system||{};
    var resilience=system.resilience||{};
    var queue=system.work_queue||{};
    setText("noc-regions-ready",nfmt(resilience.regions_ready||0)+" / "+nfmt(resilience.regions_total||0));
    setText("noc-work-pending",nfmt(queue.pending||0));
    setText("noc-work-oldest",nfmt(queue.oldest_pending_seconds||0,0)+" s");
    setText("noc-work-dead",nfmt(queue.dead_lettered||0));
    setText("noc-dr-targets",nfmt(resilience.dr_targets_total||0));
    var resilienceState=$("noc-resilience-state");
    if(resilienceState){
      var degraded=Number(queue.dead_lettered||0)>0||Number(queue.oldest_pending_seconds||0)>120||Number(resilience.regions_ready||0)<1;
      resilienceState.textContent=degraded?"ATTENTION":(Number(resilience.regions_ready||0)>1?"MULTI-RÉGION PRÊT":"MODE COMPACT SAIN");
      resilienceState.className="big-status "+(degraded?"warn":"ok");
    }
  }

  function renderNoc(rows){
    var m=currentAggregate(rows),q=currentQuality(rows);
    var backendState=RUNTIME.mode==="production"?(state.diagnostics.apiStatus==="ok"?"API OK":state.diagnostics.apiStatus==="error"?"API indisponible":"En attente"):(navigator.onLine?"Démo en ligne":"Démo hors ligne");
    setText("noc-availability",backendState);
    setText("noc-cdr-total",nfmt(RUNTIME.mode==="production"&&state.system?Number(state.system.calls_total||0):rows.length));
    setText("noc-fin-alerts",m.gap>.01?"1":"0");
    setText("noc-voice-grade",q.grade);
    renderSystemState();
  }

  function renderCalls(rows){
    var recent=rows.slice(0,7);
    var rhtml=recent.map(function(c){
      return "<tr><td>"+fmtTime(c.ts)+"</td><td>"+esc(c.caller)+"</td><td><strong>"+esc(c.expert)+"</strong></td><td>"+fmtDuration(c.conversation)+"</td><td>"+chip(c.status)+"</td><td>"+money(c.confirmed)+"</td></tr>";
    }).join("");
    if(!rhtml)rhtml='<tr><td colspan="6">Aucune donnée sur cette période.</td></tr>';
    $("recent-calls").innerHTML=rhtml;

    var tableRows=applyCallFilters(rows);
    var full=tableRows.slice(0,250).map(function(c){
      return "<tr><td>"+fmtDate(c.ts)+"</td><td>"+fmtTime(c.ts)+"</td><td>"+esc(c.caller)+"</td><td>"+esc(c.carrier)+"</td><td>"+esc(c.number)+"</td><td><strong>"+esc(c.expert)+"</strong></td><td>"+fmtDuration(c.wait)+"</td><td>"+fmtDuration(c.conversation)+"</td><td>"+c.billable+" min</td><td>"+money(c.expected)+"</td><td>"+chip(c.status)+'</td><td><button class="detail-btn" type="button" data-call-id="'+c.id+'">Voir</button></td></tr>';
    }).join("");
    if(!full)full='<tr><td colspan="12">Aucune donnée sur cette période.</td></tr>';
    $("calls-table").innerHTML=full;
    setText("calls-total-label",nfmt(tableRows.length)+" appels");
  }

  function cockpitAnalytics(rows){
    if(RUNTIME.mode==="production"&&state.serverAnalytics)return state.serverAnalytics;
    var range=getRange(),durationMs=Math.max(0,range.to-range.from);
    var granularity=durationMs>14*86400000?"day":"hour";
    var grouped=function(keyFn){
      var map=new Map();
      rows.forEach(function(x){
        var key=keyFn(x);
        if(!map.has(key))map.set(key,[]);
        map.get(key).push(x);
      });
      return map;
    };
    var summarize=function(items){
      var m=aggregate(items);
      return {
        calls_total:m.calls,calls_connected:m.connected,calls_abandoned:m.abandoned,calls_failed:m.failed,
        conversation_seconds:items.reduce(function(a,x){return a+Number(x.conversation||0);},0),
        billable_seconds:items.reduce(function(a,x){return a+Number(x.billableSeconds||x.billable*60||0);},0),
        revenue:m.ca,expected_payout:m.expected,margin:m.margin,currency:state.marketCurrency||"EUR",currency_count:1
      };
    };
    var bucket=function(c){
      var d=new Date(c.ts);
      if(granularity==="day")d.setHours(0,0,0,0);else d.setMinutes(0,0,0);
      return d.toISOString();
    };
    var series=[...grouped(bucket)].map(function(entry){return {bucket:entry[0],...summarize(entry[1])};})
      .sort(function(a,b){return Date.parse(a.bucket)-Date.parse(b.bucket);});
    var hours=[...grouped(function(c){return c.ts.getHours();})].map(function(entry){
      var x=summarize(entry[1]);return {hour:Number(entry[0]),calls_total:x.calls_total,calls_connected:x.calls_connected,billable_seconds:x.billable_seconds};
    }).sort(function(a,b){return a.hour-b.hour;});
    var weekdays=[...grouped(function(c){var d=c.ts.getDay();return d===0?7:d;})].map(function(entry){
      var x=summarize(entry[1]);return {weekday:Number(entry[0]),calls_total:x.calls_total,calls_connected:x.calls_connected,billable_seconds:x.billable_seconds};
    }).sort(function(a,b){return a.weekday-b.weekday;});
    var heatmap=[...grouped(function(c){var d=c.ts.getDay(),day=d===0?7:d;return day+":"+c.ts.getHours();})].map(function(entry){
      var parts=String(entry[0]).split(":");
      return {weekday:Number(parts[0]),hour:Number(parts[1]),calls_total:entry[1].length};
    }).sort(function(a,b){return a.weekday-b.weekday||a.hour-b.hour;});
    var dimension=function(type,keyFn,labelFn){
      return [...grouped(keyFn)].map(function(entry){
        var x=summarize(entry[1]);
        return {dimension_type:type,dimension_key:String(entry[0]),dimension_label:labelFn(entry[1][0]),...x};
      }).sort(function(a,b){return Number(b.calls_total)-Number(a.calls_total);});
    };
    var expertRows=dimension("expert",function(c){return c.expert||"Non affecté";},function(c){return c.expert||"Non affecté";}).slice(0,12);
    var carrierRows=dimension("carrier",function(c){return c.carrier||"Inconnu";},function(c){return c.carrier||"Inconnu";}).slice(0,12);
    var durationKey=function(c){return c.status!=="connected"?"not_connected":c.conversation<60?"lt_1m":c.conversation<300?"1_5m":c.conversation<600?"5_10m":c.conversation<1200?"10_20m":c.conversation<1800?"20_30m":"gte_30m";};
    var durationLabels={not_connected:"Non aboutis",lt_1m:"< 1 min","1_5m":"1–5 min","5_10m":"5–10 min","10_20m":"10–20 min","20_30m":"20–30 min",gte_30m:"30 min +"};
    var durationRows=dimension("duration",durationKey,function(c){return durationLabels[durationKey(c)]||"Autre";});
    return {granularity:granularity,series:series,hours:hours,weekdays:weekdays,heatmap:heatmap,experts:expertRows,carriers:carrierRows,durations:durationRows};
  }

  function analyticsBucketLabel(value,granularity){
    var d=new Date(value);
    if(!Number.isFinite(d.getTime()))return "—";
    if(granularity==="hour")return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit"}).format(d);
    return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit"}).format(d);
  }

  function renderMetricBars(id,items,valueFn,labelFn,valueLabelFn){
    var el=$(id);if(!el)return;
    var list=(items||[]).filter(function(x){return Number(valueFn(x)||0)>=0;});
    var max=list.length?Math.max.apply(null,list.map(function(x){return Number(valueFn(x)||0);})):0;
    el.innerHTML=list.map(function(x){
      var v=Number(valueFn(x)||0),w=max>0?v/max*100:0;
      return '<div class="metric-bar-row"><div><span>'+esc(labelFn(x))+'</span><strong>'+esc(valueLabelFn(x,v))+'</strong></div><i><b style="width:'+w.toFixed(1)+'%"></b></i></div>';
    }).join("")||'<p class="muted">Aucune donnée.</p>';
  }

  function renderDualTrend(svgId,seriesData,aKey,bKey,aLabel,bLabel,percentMode){
    var svg=$(svgId);if(!svg)return;
    var data=(seriesData||[]).map(function(x){
      var calls=Number(x.calls_total||0),connected=Number(x.calls_connected||0),abandoned=Number(x.calls_abandoned||0);
      var out={label:analyticsBucketLabel(x.bucket,(state.serverAnalytics||{}).granularity||cockpitAnalytics([]).granularity)};
      out[aKey]=aKey==="asr"? (calls?connected/calls*100:0):Number(x[aKey]||0);
      out[bKey]=bKey==="abandon_rate"? (calls?abandoned/calls*100:0):Number(x[bKey]||0);
      return out;
    });
    var w=760,h=220,p={l:40,r:16,t:30,b:28};
    if(!data.length){svg.innerHTML='<text x="380" y="110" text-anchor="middle" fill="#6d829a" font-size="12">Aucune donnée</text>';return;}
    var maxA=percentMode?100:Math.max(1,...data.map(function(x){return Number(x[aKey]||0);}));
    var maxB=percentMode?100:Math.max(1,...data.map(function(x){return Number(x[bKey]||0);}));
    var sx=function(i){return p.l+(data.length===1?(w-p.l-p.r)/2:(w-p.l-p.r)*i/(data.length-1));};
    var sy=function(v,max){return h-p.b-(h-p.t-p.b)*Number(v||0)/max;};
    var path=function(key,max){return data.map(function(d,i){return (i?"L":"M")+sx(i).toFixed(1)+" "+sy(d[key],max).toFixed(1);}).join(" ");};
    var grid="";for(var g=0;g<=4;g++){var y=p.t+(h-p.t-p.b)*g/4;grid+='<line class="chart-grid" x1="'+p.l+'" x2="'+(w-p.r)+'" y1="'+y+'" y2="'+y+'"/>';}
    var labels=data.map(function(d,i){if(data.length>10&&i%Math.ceil(data.length/8))return"";return '<text class="chart-axis" text-anchor="middle" x="'+sx(i)+'" y="'+(h-7)+'">'+esc(d.label)+'</text>';}).join("");
    svg.innerHTML=grid+labels+
      '<text x="'+p.l+'" y="14" class="chart-legend-a">'+esc(aLabel)+'</text><text x="'+(p.l+105)+'" y="14" class="chart-legend-b">'+esc(bLabel)+'</text>'+
      '<path class="cockpit-line-a" d="'+path(aKey,maxA)+'"/><path class="cockpit-line-b" d="'+path(bKey,maxB)+'"/>';
  }

  function renderCockpitIntelligence(rows){
    var data=cockpitAnalytics(rows),m=currentAggregate(rows),weekNames=["","Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
    setText("cockpit-analytics-mode",RUNTIME.mode==="production"?"AGRÉGATS SERVEUR":"CALCUL DÉMO");
    var hours=data.hours||[],days=data.weekdays||[];
    var peakHour=hours.slice().sort(function(a,b){return Number(b.calls_total)-Number(a.calls_total);})[0];
    var peakDay=days.slice().sort(function(a,b){return Number(b.calls_total)-Number(a.calls_total);})[0];
    setText("cockpit-peak-hour",peakHour?pad(Number(peakHour.hour))+"h":"—");
    setText("cockpit-peak-hour-detail",peakHour?nfmt(peakHour.calls_total)+" appel(s)":"0 appel");
    setText("cockpit-peak-day",peakDay?(weekNames[Number(peakDay.weekday)]||"—"):"—");
    setText("cockpit-peak-day-detail",peakDay?nfmt(peakDay.calls_total)+" appel(s)":"0 appel");
    setText("cockpit-value-call",m.mixedCurrency||!m.calls?"—":money(m.ca/m.calls));
    setText("cockpit-value-minute",m.mixedCurrency||!m.mins?"—":money(m.ca/m.mins));
    setText("cockpit-margin-call",m.mixedCurrency||!m.calls?"—":money(m.margin/m.calls));
    setText("cockpit-average-duration",m.connected?fmtDuration(m.acd):"—");
    setText("cockpit-volume-total",nfmt(m.calls)+" appels");
    setText("cockpit-asr-average","ASR "+nfmt(m.asr,1)+"%");

    var trend=(data.series||[]).map(function(x){
      return {...x,billable_minutes:Number(x.billable_seconds||0)/60};
    });
    renderDualTrend("cockpit-volume-chart",trend,"calls_total","billable_minutes","Appels","Minutes",false);
    renderDualTrend("cockpit-conversion-chart",trend,"asr","abandon_rate","ASR","Abandons",true);

    var fullHours=Array.from({length:24},function(_,i){
      return hours.find(function(x){return Number(x.hour)===i;})||{hour:i,calls_total:0};
    });
    renderMetricBars("cockpit-hour-bars",fullHours,function(x){return x.calls_total;},function(x){return pad(x.hour)+"h";},function(x,v){return nfmt(v);});
    var fullDays=Array.from({length:7},function(_,i){
      return days.find(function(x){return Number(x.weekday)===i+1;})||{weekday:i+1,calls_total:0};
    });
    renderMetricBars("cockpit-weekday-bars",fullDays,function(x){return x.calls_total;},function(x){return weekNames[x.weekday];},function(x,v){return nfmt(v);});

    var total=Math.max(1,m.calls),connected=Math.max(0,m.connected),abandoned=Math.max(0,m.abandoned),failed=Math.max(0,m.failed);
    var p1=connected/total*100,p2=(connected+abandoned)/total*100;
    var donut=$("cockpit-status-donut");
    if(donut)donut.style.background="conic-gradient(var(--green) 0 "+p1.toFixed(2)+"%,var(--amber) "+p1.toFixed(2)+"% "+p2.toFixed(2)+"%,var(--red) "+p2.toFixed(2)+"% 100%)";
    setText("cockpit-status-total",nfmt(m.calls));
    var legend=$("cockpit-status-legend");
    if(legend)legend.innerHTML=[
      ["Aboutis",connected,"var(--green)"],["Abandons",abandoned,"var(--amber)"],["Échecs",failed,"var(--red)"]
    ].map(function(x){return '<div><i style="--dot:'+x[2]+'"></i><span>'+x[0]+'</span><strong>'+nfmt(x[1])+' • '+nfmt(x[1]/total*100,1)+'%</strong></div>';}).join("");

    renderMetricBars("cockpit-duration-bars",data.durations||[],function(x){return x.calls_total;},function(x){return x.dimension_label;},function(x,v){return nfmt(v);});
    renderMetricBars("cockpit-expert-bars",(data.experts||[]).slice(0,7),function(x){return x.expected_payout==null?x.calls_total:x.expected_payout;},function(x){return x.dimension_label;},function(x,v){return x.expected_payout==null?nfmt(x.calls_total)+" appels":money(v);});
    renderMetricBars("cockpit-carrier-bars",(data.carriers||[]).slice(0,7),function(x){return x.calls_total;},function(x){return x.dimension_label;},function(x,v){return nfmt(v)+" appels";});

    var sampleNote=$("analytics-sample-note");
    if(sampleNote){
      sampleNote.hidden=!state.cdrSampleTruncated;
      sampleNote.textContent=state.cdrSampleTruncated
        ?"Les graphiques du Tour de contrôle utilisent les agrégats serveur exacts. Seuls la qualité RTP, la qualité RTP et certains détails CDR restent limités aux 1 000 appels récents chargés dans le navigateur."
        :"Les analyses affichées couvrent toute la période sélectionnée.";
    }
  }

  function bucketKey(d,range){
    var diff=(range.to-range.from)/(86400000);
    if(diff<=1)return pad(d.getHours())+"h";
    if(diff<=10)return pad(d.getDate())+"/"+pad(d.getMonth()+1);
    if(diff<=40)return pad(d.getDate())+"/"+pad(d.getMonth()+1);
    return new Intl.DateTimeFormat("fr-FR",{month:"short"}).format(d).replace(".","");
  }

  function series(rows){
    var analytics=cockpitAnalytics(rows);
    if(Array.isArray(analytics.series)&&analytics.series.length){
      var exact=analytics.series.map(function(x){
        return {
          label:analyticsBucketLabel(x.bucket,analytics.granularity),
          ca:Number(x.revenue||0),
          payout:Number(x.expected_payout||0)
        };
      });
      if(exact.length>24){
        var exactStep=Math.ceil(exact.length/24),exactCompressed=[];
        for(var ei=0;ei<exact.length;ei+=exactStep){
          var exactGroup=exact.slice(ei,ei+exactStep);
          exactCompressed.push({
            label:exactGroup[exactGroup.length-1].label,
            ca:exactGroup.reduce(function(a,x){return a+x.ca;},0),
            payout:exactGroup.reduce(function(a,x){return a+x.payout;},0)
          });
        }
        exact=exactCompressed;
      }
      return exact;
    }
    var r=getRange(),map={};
    rows.slice().reverse().forEach(function(c){
      var k=bucketKey(c.ts,r);
      if(!map[k])map[k]={label:k,ca:0,payout:0};
      if(c.status==="connected"){map[k].ca+=Number(c.serviceAmountTtc||0);map[k].payout+=Number(c.expectedPayoutHt||0);}
    });
    return Object.keys(map).map(function(k){return map[k];});
  }

  function renderChart(rows){
    var svg=$("revenue-chart"),agg=currentAggregate(rows),data=series(rows),w=760,h=250,p={l:42,r:14,t:18,b:28};
    if(agg.mixedCurrency){svg.innerHTML='<text x="380" y="125" text-anchor="middle" fill="#6d829a" font-size="12">Plusieurs devises : sélectionner un marché comparable</text>';return;}
    if(!data.length){svg.innerHTML='<text x="380" y="125" text-anchor="middle" fill="#6d829a" font-size="12">Aucune donnée sur cette période</text>';return;}
    var max=Math.max.apply(null,data.map(function(x){return x.ca;}));if(max<=0)max=1;
    var sx=function(i){return p.l+(data.length===1?0:(w-p.l-p.r)*i/(data.length-1));};
    var sy=function(v){return h-p.b-(h-p.t-p.b)*(v/max);};
    var line=function(key){return data.map(function(d,i){return (i?"L":"M")+sx(i).toFixed(1)+" "+sy(d[key]).toFixed(1);}).join(" ");};
    var grid="",labels="";
    for(var g=0;g<=4;g++){var y=p.t+(h-p.t-p.b)*g/4;grid+='<line class="chart-grid" x1="'+p.l+'" x2="'+(w-p.r)+'" y1="'+y+'" y2="'+y+'"/>';labels+='<text class="chart-axis" x="4" y="'+(y+3)+'">'+nfmt(max*(1-g/4),0)+"€</text>";}
    var xlabels=data.map(function(d,i){if(data.length>8&&i%2)return"";return '<text class="chart-axis" text-anchor="middle" x="'+sx(i)+'" y="'+(h-7)+'">'+esc(d.label)+'</text>';}).join("");
    var area=line("ca")+" L "+sx(data.length-1)+" "+(h-p.b)+" L "+sx(0)+" "+(h-p.b)+" Z";
    svg.innerHTML='<defs><linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#00d4ff" stop-opacity=".18"/><stop offset="100%" stop-color="#00d4ff" stop-opacity="0"/></linearGradient></defs>'+grid+labels+'<path class="chart-area-revenue" d="'+area+'"/><path class="chart-line-revenue" d="'+line("ca")+'"/><path class="chart-line-payout" d="'+line("payout")+'"/>'+xlabels;
  }

  function renderAlerts(rows){
    var a=aggregate(rows),items=[];
    if(a.gap>0.01)items.push({type:"warn",title:"Écart de reversement détecté",text:money(a.gap)+" à rapprocher entre CDR internes et données opérateur démo."});
    items.push({type:"info",title:"Données de démonstration",text:"Aucune donnée client réelle n’est stockée sur GitHub Pages. L’historique simulé est limité à 92 jours."});
    if(a.asr<80&&a.calls)items.push({type:"warn",title:"ASR sous le seuil cible",text:"Taux de décroché actuel : "+nfmt(a.asr,1)+"%."});
    $("alert-count").textContent=String(items.length);
    $("alerts-list").innerHTML=items.map(function(x){return '<div class="alert-item"><div class="alert-icon '+x.type+'">!</div><div><strong>'+esc(x.title)+'</strong><small>'+esc(x.text)+'</small></div></div>';}).join("");
  }

  function renderExperts(rows){
    var html=experts.map(function(name){
      var r=rows.filter(function(x){return x.expert===name;}),a=aggregate(r),share=aggregate(rows).expected?Math.min(100,a.expected/aggregate(rows).expected*100):0;
      return '<article class="entity-card"><h3>'+esc(name)+'</h3><div class="amount">'+money(a.expected)+'</div><small>Reversement généré</small><div class="progress"><span style="width:'+share.toFixed(1)+'%"></span></div><div class="entity-meta"><div><span>Appels</span><strong>'+a.connected+'</strong></div><div><span>Minutes</span><strong>'+a.mins+'</strong></div><div><span>ACD</span><strong>'+fmtDuration(a.acd)+'</strong></div><div><span>ASR</span><strong>'+nfmt(a.asr,1)+'%</strong></div></div></article>';
    }).join("");
    $("experts-grid").innerHTML=html;
  }

  function renderHostCarrier(){
    if(RUNTIME.mode==="production"&&state.route){
      setText("host-sva-number","089 à attribuer");
      setText("host-active-carrier",state.route.active_carrier||"Non configuré");
      setText("host-standby-carrier",state.route.standby_carrier||"Aucun");
      setText("host-route-generation",String(state.route.generation||1));
      setText("host-portability",state.route.active_carrier?"Route active":"À contractualiser");
      var connection=state.route.active_connection_state||"non configurée";
      setText("host-switch-state",state.route.active_carrier?"Connexion "+connection:"Prêt architecturalement");
      return;
    }
    setText("host-sva-number","089 à attribuer");
    setText("host-active-carrier","Non configuré");
    setText("host-standby-carrier","Aucun");
    setText("host-route-generation","1");
    setText("host-portability","À contractualiser");
    setText("host-switch-state","Prêt architecturalement");
  }

  function renderCarriers(rows){
    var total=aggregate(rows);
    $("carrier-grid").innerHTML=carriers.map(function(name){
      var r=rows.filter(function(x){return x.carrier===name;}),a=aggregate(r),pct=total.calls?a.calls/total.calls*100:0;
      return '<article class="entity-card"><h3>'+esc(name)+'</h3><div class="amount">'+nfmt(pct,1)+'%</div><small>Part des appels</small><div class="progress"><span style="width:'+pct.toFixed(1)+'%"></span></div><div class="entity-meta"><div><span>Appels</span><strong>'+a.calls+'</strong></div><div><span>Minutes</span><strong>'+a.mins+'</strong></div><div><span>Attendu</span><strong>'+money(a.expected)+'</strong></div><div><span>ASR</span><strong>'+nfmt(a.asr,1)+'%</strong></div></div></article>';
    }).join("");
  }

  function renderRecon(rows){
    var buckets={};
    rows.forEach(function(c){if(!buckets[c.carrier])buckets[c.carrier]=[];buckets[c.carrier].push(c);});
    $("recon-grid").innerHTML=carriers.map(function(name){
      var a=aggregate(buckets[name]||[]),ratio=a.expected?a.confirmed/a.expected*100:100;
      return '<article class="recon-card"><h3>'+esc(name)+'</h3><div class="amount">'+money(a.confirmed)+'</div><small>Confirmé / '+money(a.expected)+' attendu</small><div class="progress"><span style="width:'+Math.max(0,Math.min(100,ratio)).toFixed(1)+'%"></span></div><small>Concordance '+nfmt(ratio,2)+'%</small></article>';
    }).join("");
  }

  function csvCell(v){
    var s=String(v==null?"":v);
    return '"'+s.replace(/"/g,'""')+'"';
  }

  function exportCallsCsv(){
    var rows=applyCallFilters(filteredCalls());
    var header=["date","heure","appelant_masque","reseau","numero_sva","expert","attente_s","conversation_s","total_s","minutes_facturables","minutes_reversement","ca_service_ttc","reversement_attendu_ht","reversement_confirme_ht","ecart_ht","sip_code","cause_fin","codec","perte_paquets_pct","jitter_ms","latence_ms","mos","statut"];
    var lines=[header.join(";")];
    rows.forEach(function(c){
      lines.push([
        fmtDate(c.ts),fmtTime(c.ts),c.caller,c.carrier,c.number,c.expert,c.wait,c.conversation,c.total,c.billable,c.payoutEligible,
        c.serviceAmount.toFixed(2),c.expected.toFixed(2),c.confirmed.toFixed(2),c.variance.toFixed(2),c.sipFinalCode,c.hangupCause,c.codec,
        c.packetLoss,c.jitter,c.latency,c.mos,c.status
      ].map(csvCell).join(";"));
    });
    var button=$("export-csv");
    if(button&&button.disabled)return;
    if(button)button.disabled=true;
    var blob=new Blob(["\ufeff"+lines.join("\n")],{type:"text/csv;charset=utf-8"});
    var url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download="pgi-audiotel-cdr-"+new Date().toISOString().slice(0,10)+".csv";
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(function(){URL.revokeObjectURL(url);if(button)button.disabled=false;},1000);
  }

  function showCallDetail(id){
    var c=allCalls.find(function(x){return String(x.id)===String(id);});
    if(!c)return;
    var label=function(k,v){return '<div class="detail-metric"><span>'+esc(k)+'</span><strong>'+esc(v)+'</strong></div>';};
    setText("call-detail-title","Appel #"+c.id+" • "+fmtDate(c.ts)+" "+fmtTime(c.ts));
    $("call-detail-grid").innerHTML=
      label("Appelant",c.caller)+label("Réseau",c.carrier)+label("Numéro SVA",c.number)+label("Expert",c.expert)+
      label("Début",fmtTime(c.ts))+label("Entrée SVI",fmtTime(c.ivrStarted))+label("Mise en file",fmtTime(c.queued))+label("Mise en relation",c.bridged?fmtTime(c.bridged):"—")+
      label("Fin",fmtTime(c.ended))+label("Attente",fmtDuration(c.wait))+label("Conversation",fmtDuration(c.conversation))+label("Durée totale",fmtDuration(c.total))+
      label("Facturable",c.billable+" min")+label("Éligible reversement",c.payoutEligible+" min")+label("CA service TTC",money(c.serviceAmount))+label("Reversement attendu HT",money(c.expected))+
      label("Reversement confirmé HT",money(c.confirmed))+label("Reversement payé HT",money(c.paid))+label("Écart",money(c.variance))+label("SIP final",String(c.sipFinalCode))+label("Cause de fin",c.hangupCause)+
      label("Codec",c.codec)+label("Perte paquets",nfmt(c.packetLoss,3)+" %")+label("Jitter",nfmt(c.jitter,2)+" ms")+label("Latence",nfmt(c.latency,2)+" ms")+label("MOS",nfmt(c.mos,2));
    var d=$("call-dialog");if(d&&typeof d.showModal==="function")d.showModal();
  }

  function platformChip(value){
    var v=String(value||"unknown").toLowerCase();
    var ok=["active","verified","paid","reconciled","payable"].includes(v);
    var warn=["pending","pending_kyc","planned","onboarding","open","testing","not_started"].includes(v);
    var bad=["rejected","expired","suspended","disputed","closed"].includes(v);
    var label={
      active:"ACTIF",verified:"VÉRIFIÉ",paid:"PAYÉ",reconciled:"RAPPROCHÉ",payable:"À PAYER",
      pending:"EN ATTENTE",pending_kyc:"KYC EN ATTENTE",planned:"PLANIFIÉ",onboarding:"ONBOARDING",
      open:"OUVERT",testing:"TEST",not_started:"NON DÉMARRÉ",rejected:"REJETÉ",expired:"EXPIRÉ",
      suspended:"SUSPENDU",disputed:"LITIGE",closed:"FERMÉ"
    }[v]||String(value||"—").toUpperCase();
    return '<span class="platform-status '+(ok?"ok":warn?"warn":bad?"bad":"neutral")+'">'+esc(label)+"</span>";
  }

  function renderWholesale(){
    var data=RUNTIME.mode==="production"?state.wholesale:null;
    var summary=data&&data.summary?data.summary:{};
    var tenants=data&&Array.isArray(data.tenants)?data.tenants:[];
    var numbers=data&&Array.isArray(data.numbers)?data.numbers:[];
    var settlements=data&&Array.isArray(data.settlements)?data.settlements:[];
    var profiles=data&&Array.isArray(data.payment_profiles)?data.payment_profiles:[];
    var markets=data&&Array.isArray(data.markets)?data.markets:[];
    var currencyTotals=data&&Array.isArray(data.settlement_totals_by_currency)?data.settlement_totals_by_currency:[];
    var scale=data&&data.scale?data.scale:{
      clusters_total:1,clusters_ready:1,routing_buckets_active:4096,bucket_capacity:4096,
      call_fact_partitions:64,read_replica_enabled:false,process_role:"all"
    };
    var singleCurrency=currencyTotals.length===1?currencyTotals[0]:null;
    var currencyList=currencyTotals.map(function(x){return String(x.currency||"EUR");});
    var netPayoutLabel=singleCurrency
      ?moneyIn(singleCurrency.net_payout||0,singleCurrency.currency)
      :(currencyTotals.length>1?currencyTotals.length+" devises":money(0));
    var feeDetail=currencyTotals.length
      ?currencyTotals.map(function(x){return moneyIn(x.platform_fee||0,x.currency);}).join(" • ")
      :money(0);

    var real=RUNTIME.mode==="production"&&!!data;
    var carrierReady=!!(real&&state.route&&state.route.active_carrier);
    var numberReady=!!(real&&Number(summary.inventory_total||0)>0);
    var connectionState=String(state.route&&state.route.active_connection_state||"").toLowerCase();
    var sipReady=!!(carrierReady&&["active","ready"].includes(connectionState));
    var tenantCount=Number(summary.tenants_total||0);
    var kycPending=Number(summary.kyc_pending||0);
    var paymentReady=!!summary.payment_compliance_active;
    var complianceReady=tenantCount===0?true:(paymentReady&&kycPending===0);
    var readyCount=[carrierReady,numberReady,sipReady,complianceReady].filter(Boolean).length;

    setText("activation-steps",readyCount+"/4");
    var progress=$("activation-progress-bar");
    if(progress)progress.style.width=(readyCount*25)+"%";
    setText("activation-title",readyCount===4?"Chaîne SVA prête à exploiter":(real?"Activation SVA en cours":"Préparation du lancement SVA"));
    setText("activation-detail",real
      ?(readyCount===4?"Les prérequis techniques visibles dans PGI sont validés.":"PGI indique automatiquement le prochain blocage à lever avant exploitation.")
      :"Mode démo : la structure est prête, mais aucun contrat, numéro ou trunk réel n’est simulé.");

    function gate(id,label,ok){
      setText(id,label);
      var stateId=id+"-state";
      var el=$(stateId);
      if(el){el.textContent=ok?"PRÊT":"À FAIRE";el.className=ok?"ready":"pending";}
    }
    gate("gate-carrier",carrierReady?(state.route.active_carrier||"Route active"):"À contractualiser",carrierReady);
    gate("gate-number",numberReady?(nfmt(summary.inventory_total||0)+" numéro(s) configuré(s)"):"Aucun numéro réel",numberReady);
    gate("gate-sip",sipReady?"Route SIP active":(carrierReady?"Connexion "+(connectionState||"à configurer"):"Non connecté"),sipReady);
    gate("gate-compliance",tenantCount===0?"Fondation prête":(complianceReady?"KYC & paiements conformes":(kycPending>0?nfmt(kycPending)+" KYC en attente":"Paiements à activer")),complianceReady);

    var priority={title:"Plateforme prête",detail:"Aucune action bloquante détectée dans le cockpit.",go:"wholesale"};
    if(!carrierReady)priority={title:"Finaliser l’opérateur SVA amont",detail:"Obtenir le contrat 089, le reversement et la livraison SIP avant toute activation réelle.",go:"carriers"};
    else if(!numberReady)priority={title:"Configurer le premier numéro de service",detail:"Ajouter le numéro réellement affecté par l’opérateur, son marché, sa devise, son tarif et son statut.",go:"wholesale"};
    else if(!sipReady)priority={title:"Activer le trunk SIP et la route",detail:"Valider la connexion opérateur vers FreeSWITCH/SBC avant le premier appel.",go:"system"};
    else if(tenantCount>0&&kycPending>0)priority={title:"Traiter les KYC en attente",detail:"Aucun numéro client ne doit être activé tant que le dossier éditeur n’est pas vérifié.",go:"wholesale"};
    else if(tenantCount>0&&!paymentReady)priority={title:"Activer le cadre de paiement multi-clients",detail:"Le reversement de fonds tiers reste bloqué tant qu’aucun profil PSP/DSP2 actif n’est configuré.",go:"wholesale"};
    setText("priority-action-title",priority.title);
    setText("priority-action-detail",priority.detail);
    var priorityButton=$("priority-action-btn");
    if(priorityButton)priorityButton.setAttribute("data-go",priority.go);

    setText("overview-wh-state",real?(tenantCount>0?"Plateforme active":"Backend prêt"):"Fondation prête");
    setText("overview-wh-tenants",nfmt(tenantCount));
    setText("overview-wh-numbers",nfmt(summary.assignments_total||0));
    setText("overview-wh-stock",nfmt(summary.inventory_unassigned||0)+" libres");
    setText("overview-wh-kyc",nfmt(kycPending));
    setText("overview-wh-kyc-state",kycPending>0?"À traiter":"Aucun dossier");
    setText("overview-wh-net",netPayoutLabel);
    setText("overview-wh-payment-state",paymentReady?"Paiements actifs":(tenantCount>0?"PSP/DSP2 à activer":"Paiements non requis"));
    setText("wh-tenants-total",nfmt(summary.tenants_total||0));
    setText("wh-tenants-active",nfmt(summary.tenants_active||0)+" actifs");
    setText("wh-numbers-total",nfmt(summary.assignments_total||0));
    setText("wh-numbers-active",nfmt(summary.assignments_active||0)+" actifs");
    setText("wh-numbers-stock",nfmt(summary.inventory_unassigned||0)+" libres");
    setText("wh-kyc-verified",nfmt(summary.kyc_verified||0));
    setText("wh-kyc-pending",nfmt(summary.kyc_pending||0)+" en attente");
    setText("wh-net-payout",netPayoutLabel);
    setText("wh-platform-fees","Frais plateforme : "+feeDetail);
    setText("wh-markets-total",nfmt(summary.markets_total||markets.length||0));
    setText("wh-markets-active",nfmt(summary.markets_active||0)+" actifs");
    setText("wh-currency-count",nfmt(currencyTotals.length));
    setText("wh-currency-list",currencyList.length?currencyList.join(" • "):"Aucune");
    setText("wh-scale-clusters",nfmt(scale.clusters_total||0));
    setText("wh-scale-clusters-state",nfmt(scale.clusters_ready||0)+" prêt(s)");
    setText("wh-scale-buckets",nfmt(scale.routing_buckets_active||0)+" / "+nfmt(scale.bucket_capacity||4096));
    setText("wh-scale-partitions",nfmt(scale.call_fact_partitions||0));
    setText("wh-scale-read",scale.read_replica_enabled?"RÉPLIQUE":"PRIMARY");
    setText("wh-scale-regions",nfmt(scale.regions_ready||0)+" / "+nfmt(scale.regions_total||0));
    setText("wh-scale-dr",nfmt(scale.dr_targets_total||0)+" cible(s)");
    setText("wh-scale-dr-drills",nfmt(scale.dr_drills_passed||0)+" exercice(s) validé(s)");
    var roleLabels={all:"API + workers",api:"API stateless",worker:"Workers"};
    setText("wh-scale-role",roleLabels[scale.process_role]||String(scale.process_role||"all"));
    setText("wh-tenant-count",nfmt(tenants.length));
    setText("wh-number-count",nfmt(numbers.length));
    setText("wh-settlement-count",nfmt(settlements.length));

    setText("wh-foundation-status",real?"Backend wholesale connecté":"Prête architecturalement");
    setText("wh-foundation-detail",real
      ?nfmt(summary.tenants_total||0)+" client(s) • "+nfmt(summary.markets_total||markets.length||0)+" marché(s) • PostgreSQL"
      :"Aucun client réel chargé en mode démo.");
    setText("wh-compliance-badge",real?(summary.payment_compliance_active?"PSP ACTIF":"CONFORMITÉ À VALIDER"):"HYPERSCALE 1.15");
    setText("wh-check-kyc",real
      ?((summary.kyc_pending||0)>0?nfmt(summary.kyc_pending)+" dossier(s) en attente":((summary.tenants_total||0)>0?"Aucun KYC en attente":"Aucun éditeur réel"))
      :"Aucun éditeur réel");
    setText("wh-check-assignor",real
      ?((summary.assignments_total||0)>0?nfmt(summary.assignments_with_assignor||0)+"/"+nfmt(summary.assignments_total)+" affectation(s) tracée(s)":"Aucune affectation réelle")
      :"En attente du contrat amont");
    setText("wh-check-payments",real
      ?(summary.payment_compliance_active?"Profil de paiement actif":(profiles.length?"Profil présent, non actif":"Aucun profil actif"))
      :"Non activé");

    var tenantBody=$("wh-tenants-table");
    if(tenantBody)tenantBody.innerHTML=tenants.length?tenants.map(function(x){
      return "<tr><td><strong>"+esc(x.display_name||x.slug||"—")+"</strong></td><td>"+esc(x.tenant_type||"—")+"</td><td>"+esc(x.country_code||"—")+"</td><td>"+nfmt(x.markets||0)+"</td><td>"+esc(x.preferred_locale||"—")+"</td><td>"+esc(x.default_currency||"—")+"</td><td>"+platformChip(x.status)+"</td><td>"+platformChip(x.kyc_status)+"</td><td>"+nfmt(x.number_assignments||0)+"</td><td>"+nfmt(x.experts||0)+"</td></tr>";
    }).join(""):'<tr><td colspan="10">Aucun éditeur réel configuré.</td></tr>';

    var numberBody=$("wh-numbers-table");
    if(numberBody)numberBody.innerHTML=numbers.length?numbers.map(function(x){
      return "<tr><td><strong>"+esc(x.tenant||"—")+"</strong></td><td>"+esc(x.market||"—")+"</td><td>"+esc(x.display_number||x.e164||"—")+"</td><td>"+esc(x.number_type||"—")+"</td><td>"+esc(x.currency||"—")+"</td><td>"+esc(x.tariff_code||"—")+"</td><td>"+esc(x.assignment_type||"—")+"</td><td>"+platformChip(x.status)+"</td><td>"+platformChip(x.kyc_status)+"</td><td>"+esc(x.regulatory_assignor||"Non défini")+"</td></tr>";
    }).join(""):'<tr><td colspan="10">Aucune affectation réelle.</td></tr>';

    var settlementBody=$("wh-settlements-table");
    if(settlementBody)settlementBody.innerHTML=settlements.length?settlements.map(function(x){
      var period=(x.period_start||"—")+" → "+(x.period_end||"—");
      var currency=x.currency||"EUR";
      return "<tr><td><strong>"+esc(x.tenant||"—")+"</strong></td><td>"+esc(x.market||"—")+"</td><td>"+esc(currency)+"</td><td>"+esc(period)+"</td><td>"+moneyIn(x.upstream_payout_ht||0,currency)+"</td><td>"+moneyIn(x.platform_fee_ht||0,currency)+"</td><td><strong>"+moneyIn(x.net_payout_ht||0,currency)+"</strong></td><td>"+platformChip(x.status)+"</td></tr>";
    }).join(""):'<tr><td colspan="8">Aucun reversement client réel.</td></tr>';
  }

  function readMarketPreference(){
    try{
      var saved=String(localStorage.getItem("pgi_operating_market")||"").trim().toUpperCase();
      return /^[A-Z]{2}$/.test(saved)?saved:null;
    }catch(e){return null;}
  }

  function readMobileOverviewPreference(){
    try{
      var saved=localStorage.getItem("pgi_mobile_overview_expanded");
      if(saved==="1")return true;
      if(saved==="0")return false;
    }catch(e){}
    return false;
  }

  function applyMobileOverviewMode(){
    var view=$("view-overview");
    var button=$("mobile-overview-toggle");
    var expanded=!!state.mobileOverviewExpanded;
    if(view)view.classList.toggle("mobile-essential",!expanded);
    if(button){
      button.textContent=expanded?"Revenir à l’essentiel":"Voir l’analyse complète";
      button.setAttribute("aria-expanded",expanded?"true":"false");
    }
    setText("mobile-overview-mode",expanded?"Analyse complète":"Vue essentielle");
    setText("mobile-overview-note",expanded
      ?"Tous les indicateurs avancés sont affichés."
      :"Priorité au lancement SVA, aux finances, au temps réel et aux alertes.");
  }

  function toggleMobileOverview(){
    state.mobileOverviewExpanded=!state.mobileOverviewExpanded;
    try{localStorage.setItem("pgi_mobile_overview_expanded",state.mobileOverviewExpanded?"1":"0");}catch(e){}
    applyMobileOverviewMode();
  }

  function renderResetLog(){
    var label=state.baseline?new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"short"}).format(state.baseline):"Historique complet";
    setText("baseline-label",label);
    var log=$("reset-log");
    if(!state.resets.length){log.innerHTML='<p class="muted">Aucune remise à zéro enregistrée.</p>';return;}
    log.innerHTML=state.resets.slice().reverse().map(function(x){var d=new Date(x.at);return '<div class="reset-entry"><strong>Nouvelle baseline globale</strong><small>'+new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"short"}).format(d)+'</small></div>';}).join("");
  }

  function render(){
    var started=performance.now();
    var rows=filteredCalls();
    renderKPIs(rows);
    renderExecutive(rows);
    renderCalls(rows);
    renderChart(rows);
    renderHeatmap(rows);
    renderFunnel(rows);
    renderQuality(rows);
    renderCockpitIntelligence(rows);
    renderOverviewExpertRanking(rows);
    renderNetworkMix(rows);
    renderFinanceAnalytics(rows);
    renderExpertSummary(rows);
    renderNoc(rows);
    renderAlerts(rows);
    renderExperts(rows);
    renderHostCarrier();
    renderCarriers(rows);
    renderRecon(rows);
    renderFinancialSettings(rows);
    renderWholesale();
    renderResetLog();
    var now=new Date();
    state.diagnostics.lastRenderMs=Math.max(0,performance.now()-started);
    var syncLabel=new Intl.DateTimeFormat("fr-FR",{hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(now);
    setText("last-sync",syncLabel);
    setText("command-sync",syncLabel);
    setText("command-release",RUNTIME.releaseId?String(RUNTIME.releaseId).slice(0,12):(RUNTIME.mode==="production"?"inconnue":"demo"));
    var periodLabels={today:"Aujourd’hui","7d":"7 jours",week:"Semaine",month:"Mois",year:"Année",custom:"Personnalisée"};
    setText("command-period",(periodLabels[state.period]||"Période")+(state.market?" • "+state.market:""));
    var commandSystem=RUNTIME.mode!=="production"?"Mode démo":(state.diagnostics.apiStatus==="ok"?"Opérationnel":(state.diagnostics.apiStatus==="error"?"Dégradé":"Connexion"));
    setText("command-system",commandSystem);
    setText("render-time",nfmt(state.diagnostics.lastRenderMs,1)+" ms");
    setText("runtime-errors",String(state.diagnostics.errors));
    setText("runtime-version",RUNTIME.version||"dev");
    setText("runtime-release",RUNTIME.releaseId?String(RUNTIME.releaseId).slice(0,12):(RUNTIME.mode==="production"?"inconnue":"demo"));
    setText("data-mode",RUNTIME.mode==="production"?"Production":"Démo");
    if(RUNTIME.mode==="production"){
      var lag=state.system&&Number.isFinite(Number(state.system.cdr_lag_seconds))?Number(state.system.cdr_lag_seconds):null;
      setText("data-freshness",state.diagnostics.apiStatus==="ok"?(lag==null?"Synchronisée API":"CDR il y a "+fmtDuration(lag)):"En attente API");
      setText("cdr-errors","—");
    }else{
      setText("data-freshness","Générée localement");
      setText("cdr-errors","0");
    }
  }

  function switchView(name){
    qsa(".view").forEach(function(v){v.classList.toggle("active",v.id==="view-"+name);});
    qsa("[data-view]").forEach(function(b){b.classList.toggle("active",b.getAttribute("data-view")===name);});
    setText("view-title",titles[name]||"PGI • Telecom");
    window.scrollTo({top:0,behavior:"smooth"});
  }

  function bind(){
    qsa("[data-view]").forEach(function(b){b.addEventListener("click",function(){switchView(b.getAttribute("data-view"));});});
    qsa("[data-go]").forEach(function(b){b.addEventListener("click",function(){switchView(b.getAttribute("data-go"));});});
    qsa(".period").forEach(function(b){b.addEventListener("click",function(){
      state.period=b.getAttribute("data-period");state.custom=null;
      qsa(".period").forEach(function(x){x.classList.toggle("active",x===b);});refreshData();
    });});
    $("apply-custom").addEventListener("click",function(){
      var f=$("date-from").value,t=$("date-to").value;if(!f||!t)return;
      var fd=new Date(f+"T00:00:00"),td=new Date(t+"T00:00:00");if(td<fd){var tmp=fd;fd=td;td=tmp;}
      state.period="custom";state.custom={from:fd,to:td};qsa(".period").forEach(function(x){x.classList.remove("active");});refreshData();
    });
    $("refresh-btn").addEventListener("click",refreshData);
    var mobileOverviewToggle=$("mobile-overview-toggle");
    if(mobileOverviewToggle)mobileOverviewToggle.addEventListener("click",toggleMobileOverview);
    var marketFilter=$("market-filter");
    if(marketFilter)marketFilter.addEventListener("change",function(){
      state.market=marketFilter.value||null;
      try{
        if(state.market)localStorage.setItem("pgi_operating_market",state.market);
        else localStorage.removeItem("pgi_operating_market");
      }catch(e){}
      syncProductionData();
    });
    var more=$("mobile-more");
    if(more)more.addEventListener("click",function(){
      var d=$("mobile-menu-dialog");
      if(d&&typeof d.showModal==="function")d.showModal();
    });
    ["call-search","call-expert","call-carrier","call-status"].forEach(function(id){
      var el=$(id);if(!el)return;
      el.addEventListener(id==="call-search"?"input":"change",function(){
        state.callFilters.search=$("call-search").value||"";
        state.callFilters.expert=$("call-expert").value||"";
        state.callFilters.carrier=$("call-carrier").value||"";
        state.callFilters.status=$("call-status").value||"";
        renderCalls(filteredCalls());
      });
    });
    $("calls-table").addEventListener("click",function(e){
      var b=e.target.closest("[data-call-id]");if(b)showCallDetail(b.getAttribute("data-call-id"));
    });
    $("export-csv").addEventListener("click",exportCallsCsv);
    $("print-calls").addEventListener("click",function(){window.print();});
    $("print-finance").addEventListener("click",function(){window.print();});
    $("reset-metrics").addEventListener("click",function(){var d=$("reset-dialog");if(typeof d.showModal==="function")d.showModal();});
    $("confirm-reset").addEventListener("click",async function(){
      var at=new Date();
      try{
        if(RUNTIME.mode==="production"&&window.PGIApi){
          await window.PGIApi.createBaseline({scope:"global",reason:"Remise à zéro depuis le cockpit"},window.PGIApi.newIdempotencyKey());
        }
        state.baseline=at;state.resets.push({at:at.toISOString(),scope:"global"});saveState();refreshData();
      }catch(e){recordRuntimeError();}
    });
    var authForm=$("auth-form");
    if(authForm)authForm.addEventListener("submit",function(e){e.preventDefault();submitLogin();});
    var authDialog=$("auth-dialog");
    if(authDialog)authDialog.addEventListener("cancel",function(e){if(RUNTIME.mode==="production")e.preventDefault();});
    var logoutButton=$("logout-btn");
    if(logoutButton)logoutButton.addEventListener("click",logoutProduction);
    window.addEventListener("pgi:auth-required",function(){requireProductionLogin("Session expirée. Identifiez-vous de nouveau.");});
  }

  function recordRuntimeError(){
    state.diagnostics.errors++;
    setText("runtime-errors",String(state.diagnostics.errors));
  }

  function updateConnectivity(){
    var online=navigator.onLine;
    var stateEl=$("network-state");
    var banner=$("offline-banner");
    if(stateEl){
      stateEl.classList.toggle("offline",!online);
      stateEl.innerHTML='<i class="dot '+(online?"ok":"offline")+'"></i><span>'+(online?"En ligne":"Hors ligne")+'</span>';
    }
    if(banner)banner.hidden=online;
  }

  function applyRuntimeMode(){
    var el=$("runtime-mode");
    var demo=RUNTIME.mode!=="production";
    if(el){
      el.textContent=demo?"MODE DÉMO":"MODE PRODUCTION";
      el.classList.toggle("demo",demo);
      el.classList.toggle("production",!demo);
    }
    setText("runtime-version",RUNTIME.version||"dev");
    setText("runtime-release",RUNTIME.releaseId?String(RUNTIME.releaseId).slice(0,12):(RUNTIME.mode==="production"?"inconnue":"demo"));
    setText("sidebar-version","v"+(RUNTIME.version||"dev")+" • "+(demo?"Démo":"Production"));
    setText("data-mode",demo?"Démo":"Production");
    var live=$("live-mode-badge");
    if(live){
      live.innerHTML=demo?'<i class="dot offline"></i>DÉMO':'<i class="dot ok pulse"></i>LIVE';
    }
    var cdrState=$("overview-cdr-state");
    if(cdrState){
      cdrState.textContent=demo?"DÉMO LOCALE":"EN ATTENTE";
      cdrState.className="health warn";
    }
  }

  async function probeApiHealth(){
    var el=$("api-health-state");
    if(RUNTIME.mode!=="production"||!RUNTIME.apiBaseUrl||!window.PGIApi){
      state.diagnostics.apiStatus="not_configured";
      if(el){el.textContent="API NON CONNECTÉE";el.className="big-status warn";}
      var overviewApi=$("overview-api-state");
      if(overviewApi){overviewApi.textContent="NON CONNECTÉE";overviewApi.className="health warn";}
      renderSystemState();
      return;
    }
    try{
      await window.PGIApi.health();
      state.diagnostics.apiStatus="ok";
      if(el){el.textContent="API OPÉRATIONNELLE";el.className="big-status ok";}
      var overviewApi=$("overview-api-state");
      if(overviewApi){overviewApi.textContent="OPÉRATIONNELLE";overviewApi.className="health ok";}
      renderSystemState();
    }catch(e){
      state.diagnostics.apiStatus="error";
      if(el){el.textContent="API INDISPONIBLE";el.className="big-status warn";}
      var overviewApi=$("overview-api-state");
      if(overviewApi){overviewApi.textContent="INDISPONIBLE";overviewApi.className="health warn";}
      renderSystemState();
    }
  }

  function startHealthLoop(){
    probeApiHealth();
    setInterval(function(){
      if(!document.hidden)probeApiHealth();
    },30000);
  }

  function registerServiceWorker(){
    if(!("serviceWorker" in navigator))return;
    window.addEventListener("load",function(){
      navigator.serviceWorker.register("./service-worker.js").catch(function(){});
    },{once:true});
  }

  function clock(){
    setText("footer-clock",new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"medium"}).format(new Date()));
  }

  window.addEventListener("error",recordRuntimeError);
  window.addEventListener("unhandledrejection",recordRuntimeError);
  loadState();
  state.market=RUNTIME.mode==="production"?readMarketPreference():"FR";
  state.mobileOverviewExpanded=readMobileOverviewPreference();
  applyMobileOverviewMode();
  bind();
  applyRuntimeMode();
  updateConnectivity();
  startHealthLoop();
  window.addEventListener("online",updateConnectivity);
  window.addEventListener("offline",updateConnectivity);
  registerServiceWorker();
  if(RUNTIME.mode==="production")syncProductionData();else render();
  clock();
  setInterval(clock,1000);
})();