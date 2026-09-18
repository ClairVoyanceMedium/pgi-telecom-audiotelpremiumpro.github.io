(function(){
  "use strict";

  var CONFIG={serviceRate:0.80,payoutRate:0.46,expertCostPerMin:0.18,fixedCostPerCall:0.03};
  var state={period:"today",custom:null,baseline:null,resets:[]};
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
        var billable=status==="connected"?Math.max(1,Math.ceil(conv/60)):0;
        var expected=billable*CONFIG.payoutRate;
        var variance=status==="connected"?(seeded(day*11+i*101)<0.045?expected*(0.015+seeded(i)*0.035):0):0;
        var confirmed=Math.max(0,expected-variance);
        rows.push({
          id:id++,ts:d,caller:maskPhone(i+day),carrier:carriers[(i+day)%carriers.length],number:number089,
          expert:experts[(i*3+day)%experts.length],wait:wait,conversation:conv,billable:billable,
          expected:expected,confirmed:confirmed,status:status,
          expertCost:billable*CONFIG.expertCostPerMin,cost:CONFIG.fixedCostPerCall
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
    var connected=rows.filter(function(x){return x.status==="connected";});
    var abandoned=rows.filter(function(x){return x.status==="abandoned";}).length;
    var mins=connected.reduce(function(s,x){return s+x.billable;},0);
    var expected=connected.reduce(function(s,x){return s+x.expected;},0);
    var confirmed=connected.reduce(function(s,x){return s+x.confirmed;},0);
    var ca=mins*CONFIG.serviceRate;
    var expert=connected.reduce(function(s,x){return s+x.expertCost;},0);
    var costs=rows.reduce(function(s,x){return s+x.cost;},0);
    var margin=confirmed-expert-costs;
    var acd=connected.length?connected.reduce(function(s,x){return s+x.conversation;},0)/connected.length:0;
    return {calls:rows.length,connected:connected.length,abandoned:abandoned,mins:mins,expected:expected,confirmed:confirmed,ca:ca,margin:margin,acd:acd,asr:rows.length?connected.length/rows.length*100:0,gap:expected-confirmed};
  }

  function setText(id,val){var e=$(id);if(e)e.textContent=val;}
  function renderKPIs(rows){
    var a=aggregate(rows);
    setText("kpi-ca",money(a.ca));
    setText("kpi-expected",money(a.expected));
    setText("kpi-paid",money(a.confirmed));
    setText("kpi-gap","Écart : "+money(a.gap));
    setText("kpi-margin",money(a.margin));
    setText("kpi-calls",nfmt(a.calls));
    setText("kpi-connected",nfmt(a.connected)+" aboutis");
    setText("kpi-minutes",nfmt(a.mins));
    setText("kpi-acd","ACD "+fmtDuration(a.acd));
    setText("kpi-asr",nfmt(a.asr,1)+"%");
    setText("kpi-abandon",nfmt(a.abandoned)+" abandons");
    setText("kpi-experts",String(Math.min(experts.length,Math.max(0,new Set(rows.filter(function(x){return x.status==="connected";}).map(function(x){return x.expert;})).size))));
    setText("kpi-live",rows.length?"2 appels en cours":"0 appel en cours");
    setText("kpi-rate","Taux moyen : "+money(CONFIG.payoutRate)+"/min");
    setText("fin-ca",money(a.ca));
    setText("fin-expected",money(a.expected));
    setText("fin-confirmed",money(a.confirmed));
    setText("fin-gap",money(a.gap));
    setText("live-calls",rows.length?"2":"0");
    setText("live-available",rows.length?"3":"0");
    setText("live-queue",rows.length?"1":"0");
    var trend=$("ca-trend");if(trend){trend.textContent=rows.length?"+8,4%":"+0%";trend.className="trend up";}
  }

  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c];});}
  function chip(status){var label=status==="connected"?"ABOUTI":status==="abandoned"?"ABANDON":"ÉCHEC";return '<span class="status-chip '+status+'">'+label+"</span>";}

  function renderCalls(rows){
    var recent=rows.slice(0,7);
    var rhtml=recent.map(function(c){
      return "<tr><td>"+fmtTime(c.ts)+"</td><td>"+esc(c.caller)+"</td><td><strong>"+esc(c.expert)+"</strong></td><td>"+fmtDuration(c.conversation)+"</td><td>"+chip(c.status)+"</td><td>"+money(c.confirmed)+"</td></tr>";
    }).join("");
    if(!rhtml)rhtml='<tr><td colspan="6">Aucune donnée sur cette période.</td></tr>';
    $("recent-calls").innerHTML=rhtml;

    var full=rows.slice(0,120).map(function(c){
      return "<tr><td>"+fmtDate(c.ts)+"</td><td>"+fmtTime(c.ts)+"</td><td>"+esc(c.caller)+"</td><td>"+esc(c.carrier)+"</td><td>"+esc(c.number)+"</td><td><strong>"+esc(c.expert)+"</strong></td><td>"+fmtDuration(c.wait)+"</td><td>"+fmtDuration(c.conversation)+"</td><td>"+c.billable+" min</td><td>"+money(c.expected)+"</td><td>"+chip(c.status)+"</td></tr>";
    }).join("");
    if(!full)full='<tr><td colspan="11">Aucune donnée sur cette période.</td></tr>';
    $("calls-table").innerHTML=full;
    setText("calls-total-label",nfmt(rows.length)+" appels");
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
    items.push({type:"info",title:"Données de démonstration",text:"Aucune donnée client réelle n’est stockée sur GitHub Pages."});
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

  function renderResetLog(){
    var label=state.baseline?new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"short"}).format(state.baseline):"Historique complet";
    setText("baseline-label",label);
    var log=$("reset-log");
    if(!state.resets.length){log.innerHTML='<p class="muted">Aucune remise à zéro enregistrée.</p>';return;}
    log.innerHTML=state.resets.slice().reverse().map(function(x){var d=new Date(x.at);return '<div class="reset-entry"><strong>Nouvelle baseline globale</strong><small>'+new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"short"}).format(d)+'</small></div>';}).join("");
  }

  function render(){
    var rows=filteredCalls();
    renderKPIs(rows);renderCalls(rows);renderChart(rows);renderAlerts(rows);renderExperts(rows);renderCarriers(rows);renderRecon(rows);renderResetLog();
    setText("last-sync",new Intl.DateTimeFormat("fr-FR",{hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(new Date()));
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
    $("reset-metrics").addEventListener("click",function(){var d=$("reset-dialog");if(typeof d.showModal==="function")d.showModal();});
    $("confirm-reset").addEventListener("click",function(){
      state.baseline=new Date();state.resets.push({at:state.baseline.toISOString(),scope:"global"});saveState();render();
    });
  }

  function clock(){
    setText("footer-clock",new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"medium"}).format(new Date()));
  }

  loadState();bind();render();clock();setInterval(clock,1000);
})();