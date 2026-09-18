(function(){
  "use strict";

  var RUNTIME=window.PGI_CONFIG||{mode:"demo",apiBaseUrl:"",features:{}};
  var CONFIG={serviceRate:0.80,payoutRate:0.46,expertCostPerMin:0.18,fixedCostPerCall:0.03};
  var state={period:"today",custom:null,baseline:null,resets:[],callFilters:{search:"",expert:"",carrier:"",status:""},diagnostics:{errors:0,lastRenderMs:0,apiStatus:"not_configured"}};
  var titles={overview:"Vue d’ensemble",calls:"Appels",finance:"Finance",experts:"Experts",carriers:"Opérateurs",system:"Système",settings:"Paramètres"};
  var experts=["Frederick","Sofia","Emma","Lina","Clara","Nora"];
  var carriers=["Orange","SFR","Bouygues","Free"];
  var number089="0890 80 24 24";

  function $(id){return document.getElementById(id);}
  function qsa(sel){return Array.prototype.slice.call(document.querySelectorAll(sel));}
  function money(v){return new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR"}).format(Number(v)||0);}
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
          caller:maskPhone(i+day),carrier:carriers[(i+day)%carriers.length],number:number089,
          expert:experts[(i*3+day)%experts.length],wait:wait,conversation:conv,total:Math.max(0,Math.round((ended-d)/1000)),billable:billable,
          originType:originType,
          payoutEligible:financial.payoutEligibleSeconds/60,expected:expected,confirmed:confirmed,paid:paid,status:status,
          billableSeconds:financial.billableSeconds,payoutEligibleSeconds:financial.payoutEligibleSeconds,
          expectedPayoutHt:expected,confirmedPayoutHt:confirmed,paidPayoutHt:paid,
          expertCost:billable*CONFIG.expertCostPerMin,cost:CONFIG.fixedCostPerCall,
          expertCostHt:billable*CONFIG.expertCostPerMin,technicalCostHt:CONFIG.fixedCostPerCall,
          serviceAmount:financial.serviceAmountTtc,serviceAmountTtc:financial.serviceAmountTtc,
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

  var allCalls=buildDemoCalls();

  function loadState(){
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

  function setText(id,val){var e=$(id);if(e)e.textContent=val;}

  function revenueTrendPercent(currentRows){
    if(state.baseline)return null;
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
    var a=aggregate(rows);
    setText("kpi-ca",money(a.ca));
    setText("kpi-expected",money(a.expected));
    setText("kpi-paid",money(a.paid));
    setText("kpi-gap","Écart : "+money(a.gap));
    setText("kpi-margin",money(a.margin));
    setText("kpi-calls",nfmt(a.calls));
    setText("kpi-connected",nfmt(a.connected)+" aboutis");
    setText("kpi-minutes",nfmt(a.mins));
    setText("kpi-acd","ACD "+fmtDuration(a.acd));
    setText("kpi-asr",nfmt(a.asr,1)+"%");
    setText("kpi-abandon",nfmt(a.abandoned)+" abandons");
    setText("kpi-experts",String(Math.min(experts.length,Math.max(0,new Set(rows.filter(function(x){return x.status==="connected";}).map(function(x){return x.expert;})).size))));
    setText("kpi-live","Historique sélectionné");
    setText("kpi-rate","Taux moyen : "+money(CONFIG.payoutRate)+"/min");
    setText("fin-ca",money(a.ca));
    setText("fin-expected",money(a.expected));
    setText("fin-confirmed",money(a.confirmed));
    setText("fin-paid",money(a.paid));
    setText("fin-gap",money(a.gap));
    setText("live-calls",rows.length?"2":"0");
    setText("live-available",rows.length?"3":"0");
    setText("live-queue",rows.length?"1":"0");
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

  function bucketKey(d,range){
    var diff=(range.to-range.from)/(86400000);
    if(diff<=1)return pad(d.getHours())+"h";
    if(diff<=10)return pad(d.getDate())+"/"+pad(d.getMonth()+1);
    if(diff<=40)return pad(d.getDate())+"/"+pad(d.getMonth()+1);
    return new Intl.DateTimeFormat("fr-FR",{month:"short"}).format(d).replace(".","");
  }

  function series(rows){
    var r=getRange(),map={};
    rows.slice().reverse().forEach(function(c){
      var k=bucketKey(c.ts,r);
      if(!map[k])map[k]={label:k,ca:0,payout:0};
      if(c.status==="connected"){map[k].ca+=c.billable*CONFIG.serviceRate;map[k].payout+=c.expected;}
    });
    var vals=Object.keys(map).map(function(k){return map[k];});
    if(vals.length>14){
      var step=Math.ceil(vals.length/14),compressed=[];
      for(var i=0;i<vals.length;i+=step){
        var group=vals.slice(i,i+step);
        compressed.push({label:group[group.length-1].label,ca:group.reduce(function(s,x){return s+x.ca;},0),payout:group.reduce(function(s,x){return s+x.payout;},0)});
      }
      vals=compressed;
    }
    return vals;
  }

  function renderChart(rows){
    var svg=$("revenue-chart"),data=series(rows),w=760,h=250,p={l:42,r:14,t:18,b:28};
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
    renderKPIs(rows);renderCalls(rows);renderChart(rows);renderAlerts(rows);renderExperts(rows);renderCarriers(rows);renderRecon(rows);renderResetLog();
    var now=new Date();
    state.diagnostics.lastRenderMs=Math.max(0,performance.now()-started);
    setText("last-sync",new Intl.DateTimeFormat("fr-FR",{hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(now));
    setText("render-time",nfmt(state.diagnostics.lastRenderMs,1)+" ms");
    setText("runtime-errors",String(state.diagnostics.errors));
    setText("runtime-version",RUNTIME.version||"dev");
    setText("data-mode",RUNTIME.mode==="production"?"Production":"Démo");
    setText("data-freshness",RUNTIME.mode==="production"?"En attente API":"Générée localement");
    setText("cdr-errors","0");
  }

  function switchView(name){
    qsa(".view").forEach(function(v){v.classList.toggle("active",v.id==="view-"+name);});
    qsa("[data-view]").forEach(function(b){b.classList.toggle("active",b.getAttribute("data-view")===name);});
    setText("view-title",titles[name]||"PGI Telecom");
    window.scrollTo({top:0,behavior:"smooth"});
  }

  function bind(){
    qsa("[data-view]").forEach(function(b){b.addEventListener("click",function(){switchView(b.getAttribute("data-view"));});});
    qsa("[data-go]").forEach(function(b){b.addEventListener("click",function(){switchView(b.getAttribute("data-go"));});});
    qsa(".period").forEach(function(b){b.addEventListener("click",function(){
      state.period=b.getAttribute("data-period");state.custom=null;
      qsa(".period").forEach(function(x){x.classList.toggle("active",x===b);});render();
    });});
    $("apply-custom").addEventListener("click",function(){
      var f=$("date-from").value,t=$("date-to").value;if(!f||!t)return;
      var fd=new Date(f+"T00:00:00"),td=new Date(t+"T00:00:00");if(td<fd){var tmp=fd;fd=td;td=tmp;}
      state.period="custom";state.custom={from:fd,to:td};qsa(".period").forEach(function(x){x.classList.remove("active");});render();
    });
    $("refresh-btn").addEventListener("click",render);
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
    $("confirm-reset").addEventListener("click",function(){
      state.baseline=new Date();state.resets.push({at:state.baseline.toISOString(),scope:"global"});saveState();render();
    });
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
    setText("data-mode",demo?"Démo":"Production");
  }

  async function probeApiHealth(){
    var el=$("api-health-state");
    if(RUNTIME.mode!=="production"||!RUNTIME.apiBaseUrl||!window.PGIApi){
      state.diagnostics.apiStatus="not_configured";
      if(el){el.textContent="API NON CONNECTÉE";el.className="big-status warn";}
      return;
    }
    try{
      await window.PGIApi.health();
      state.diagnostics.apiStatus="ok";
      if(el){el.textContent="API OPÉRATIONNELLE";el.className="big-status ok";}
    }catch(e){
      state.diagnostics.apiStatus="error";
      if(el){el.textContent="API INDISPONIBLE";el.className="big-status warn";}
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
  bind();
  applyRuntimeMode();
  updateConnectivity();
  startHealthLoop();
  window.addEventListener("online",updateConnectivity);
  window.addEventListener("offline",updateConnectivity);
  registerServiceWorker();
  render();
  clock();
  setInterval(clock,1000);
})();