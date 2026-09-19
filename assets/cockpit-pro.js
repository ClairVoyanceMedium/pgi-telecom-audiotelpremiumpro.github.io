(function(root){
"use strict";
var $=function(id){return document.getElementById(id);};
var clamp=function(v,a,b){return Math.max(a,Math.min(b,Number(v)||0));};
var pct=function(v,t){return Number(t)>0?Number(v||0)/Number(t)*100:0;};
var nf=function(v,d){return new Intl.NumberFormat("fr-FR",{maximumFractionDigits:d==null?1:d,minimumFractionDigits:d==null?0:d}).format(Number(v)||0);};
var money=function(v,c){try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c||"EUR"}).format(Number(v)||0);}catch{return nf(v,2)+" €";}};
var esc=function(s){return String(s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c];});};
var label=function(value,g){var d=new Date(value);if(!Number.isFinite(d.getTime()))return "—";return new Intl.DateTimeFormat("fr-FR",g==="hour"?{day:"2-digit",month:"2-digit",hour:"2-digit"}:{day:"2-digit",month:"2-digit"}).format(d);};
function tone(v,g,w,inv){v=Number(v)||0;return inv?(v<=g?"good":v<=w?"warn":"bad"):(v>=g?"good":v>=w?"warn":"bad");}
function pulse(id,text,width,t,note){
  var e=$(id);if(e)e.textContent=text;
  var b=$(id+"-bar");if(b)b.style.width=clamp(width,0,100).toFixed(1)+"%";
  var n=$(id+"-note");if(n&&note!=null)n.textContent=note;
  var card=e&&e.closest?e.closest(".pulse-card"):null;
  if(card){card.classList.remove("good","warn","bad");if(t)card.classList.add(t);}
}
function multi(id,rows,defs,g){
  var svg=$(id);if(!svg)return;
  var data=(rows||[]).map(function(x){var o={l:label(x.bucket,g)};defs.forEach(function(d){o[d.k]=Number(d.v?d.v(x):x[d.k]||0);});return o;});
  if(!data.length){svg.innerHTML='<text x="380" y="110" text-anchor="middle" fill="#6d829a" font-size="12">Aucune donnée</text>';return;}
  var w=760,h=220,p={l:42,r:16,t:32,b:28},max=Math.max(1,...data.flatMap(function(x){return defs.map(function(d){return Number(x[d.k]||0);});}));
  var sx=function(i){return p.l+(data.length===1?(w-p.l-p.r)/2:(w-p.l-p.r)*i/(data.length-1));},sy=function(v){return h-p.b-(h-p.t-p.b)*Number(v||0)/max;};
  var path=function(k){return data.map(function(d,i){return (i?"L":"M")+sx(i).toFixed(1)+" "+sy(d[k]).toFixed(1);}).join(" ");};
  var grid="";for(var i=0;i<=4;i++){var y=p.t+(h-p.t-p.b)*i/4;grid+='<line class="chart-grid" x1="'+p.l+'" x2="'+(w-p.r)+'" y1="'+y+'" y2="'+y+'"/>';}
  var xlabels=data.map(function(d,i){if(data.length>10&&i%Math.ceil(data.length/8))return"";return '<text class="chart-axis" text-anchor="middle" x="'+sx(i)+'" y="'+(h-7)+'">'+esc(d.l)+'</text>';}).join("");
  svg.innerHTML=grid+xlabels+defs.map(function(d,i){return '<text x="'+(p.l+i*128)+'" y="14" class="chart-multi-legend c'+i+'">'+esc(d.n)+'</text>';}).join("")+defs.map(function(d,i){return '<path class="cockpit-line-multi c'+i+'" d="'+path(d.k)+'"/>';}).join("");
}
function dual(id,rows,a,b,an,bn,g){
  var svg=$(id);if(!svg)return;
  var data=(rows||[]).map(function(x){return {l:label(x.bucket,g),a:Number(x[a]||0),b:Number(x[b]||0)};});
  if(!data.length){svg.innerHTML='<text x="380" y="110" text-anchor="middle" fill="#6d829a" font-size="12">Aucune donnée</text>';return;}
  var w=760,h=220,p={l:42,r:16,t:32,b:28},ma=Math.max(1,...data.map(function(x){return x.a;})),mb=Math.max(.1,...data.map(function(x){return x.b;}));
  var sx=function(i){return p.l+(data.length===1?(w-p.l-p.r)/2:(w-p.l-p.r)*i/(data.length-1));},sy=function(v,m){return h-p.b-(h-p.t-p.b)*Number(v||0)/m;};
  var path=function(k,m){return data.map(function(d,i){return (i?"L":"M")+sx(i).toFixed(1)+" "+sy(d[k],m).toFixed(1);}).join(" ");};
  var grid="";for(var i=0;i<=4;i++){var y=p.t+(h-p.t-p.b)*i/4;grid+='<line class="chart-grid" x1="'+p.l+'" x2="'+(w-p.r)+'" y1="'+y+'" y2="'+y+'"/>';}
  svg.innerHTML=grid+'<text x="'+p.l+'" y="14" class="chart-multi-legend c0">'+esc(an)+'</text><text x="'+(p.l+120)+'" y="14" class="chart-multi-legend c1">'+esc(bn)+'</text><path class="cockpit-line-multi c0" d="'+path("a",ma)+'"/><path class="cockpit-line-multi c1" d="'+path("b",mb)+'"/>';
}
function outcomes(id,rows,g){
  var svg=$(id);if(!svg)return;
  var d=(rows||[]).map(function(x){return {l:label(x.bucket,g),c:Number(x.calls_connected||0),a:Number(x.calls_abandoned||0),f:Number(x.calls_failed||0)};});
  if(!d.length){svg.innerHTML='<text x="380" y="110" text-anchor="middle" fill="#6d829a" font-size="12">Aucune donnée</text>';return;}
  var w=760,h=220,p={l:38,r:14,t:30,b:28},max=Math.max(1,...d.map(function(x){return x.c+x.a+x.f;})),slot=(w-p.l-p.r)/d.length,bw=Math.max(4,Math.min(34,slot*.62)),sy=function(v){return (h-p.t-p.b)*v/max;};
  var bars=d.map(function(x,i){var xx=p.l+i*slot+(slot-bw)/2,y=h-p.b,hc=sy(x.c),ha=sy(x.a),hf=sy(x.f),lab=(d.length>10&&i%Math.ceil(d.length/8))?"":'<text class="chart-axis" text-anchor="middle" x="'+(xx+bw/2)+'" y="'+(h-7)+'">'+esc(x.l)+'</text>';return '<rect class="outcome-connected" x="'+xx+'" y="'+(y-hc)+'" width="'+bw+'" height="'+hc+'"/><rect class="outcome-abandoned" x="'+xx+'" y="'+(y-hc-ha)+'" width="'+bw+'" height="'+ha+'"/><rect class="outcome-failed" x="'+xx+'" y="'+(y-hc-ha-hf)+'" width="'+bw+'" height="'+hf+'"/>'+lab;}).join("");
  svg.innerHTML='<text x="'+p.l+'" y="14" class="chart-multi-legend c0">Aboutis</text><text x="'+(p.l+105)+'" y="14" class="chart-multi-legend c1">Abandons</text><text x="'+(p.l+220)+'" y="14" class="chart-multi-legend c2">Échecs</text>'+bars;
}
function ladder(m,c){
  var e=$("cockpit-payment-bars");if(!e)return;
  if(m.mixedCurrency){e.innerHTML='<p class="muted">Analyse financière désactivée sur une sélection multi-devises.</p>';return;}
  var ex=Math.max(0,Number(m.expected||0)),rows=[["Attendu",ex,100],["Confirmé",Math.max(0,Number(m.confirmed||0)),ex?pct(m.confirmed,ex):0],["Encaissé",Math.max(0,Number(m.paid||0)),ex?pct(m.paid,ex):0]];
  e.innerHTML=rows.map(function(x){return '<div class="payment-step"><div><span>'+x[0]+'</span><strong>'+money(x[1],c)+'</strong><small>'+nf(x[2],1)+'%</small></div><i><b style="width:'+clamp(x[2],0,100).toFixed(1)+'%"></b></i></div>';}).join("");
  var gap=$("cockpit-payment-gap");if(gap)gap.textContent=ex?"Écart "+money(m.gap,c):"Écart —";
}
function render(ctx){
  var d=ctx.data||{},m=ctx.m||{},q=ctx.q||{},c=ctx.currency||"EUR",total=Number(m.calls||0),connected=Number(m.connected||0),ar=pct(m.abandoned,total),fr=pct(m.failed,total),dm={};
  (d.durations||[]).forEach(function(x){dm[x.dimension_key]=Number(x.calls_total||0);});
  var lr=pct((dm["10_20m"]||0)+(dm["20_30m"]||0)+(dm.gte_30m||0),connected),er=pct(m.payoutEligibleMins,m.mins),mr=!m.mixedCurrency&&m.ca>0?pct(m.margin,m.ca):0,cr=!m.mixedCurrency&&m.expected>0?pct(m.confirmed,m.expected):0,pr=!m.mixedCurrency&&m.expected>0?pct(m.paid,m.expected):0,rr=!m.mixedCurrency&&m.expected>0?clamp(100-Math.abs(m.gap)/m.expected*100,0,100):0,xe=(d.experts||[])[0],xc=(d.carriers||[])[0],xs=total&&xe?pct(xe.calls_total,total):0,cs=total&&xc?pct(xc.calls_total,total):0;
  pulse("pulse-asr",nf(m.asr,1)+"%",m.asr,tone(m.asr,85,70,false));pulse("pulse-abandon",nf(ar,1)+"%",ar,tone(ar,5,12,true));pulse("pulse-failed",nf(fr,1)+"%",fr,tone(fr,3,8,true));pulse("pulse-long-calls",nf(lr,1)+"%",lr,tone(lr,45,25,false));pulse("pulse-eligible",nf(er,1)+"%",er,tone(er,90,75,false));pulse("pulse-margin-rate",m.mixedCurrency?"—":nf(mr,1)+"%",mr,tone(mr,25,12,false));pulse("pulse-confirmed",m.mixedCurrency?"—":nf(cr,1)+"%",cr,tone(cr,98,90,false));pulse("pulse-paid",m.mixedCurrency?"—":nf(pr,1)+"%",pr,tone(pr,95,80,false));pulse("pulse-recon",m.mixedCurrency?"—":nf(rr,1)+"%",rr,tone(rr,99,96,false));pulse("pulse-quality",q.count?nf(q.score,0)+"/100":"—",q.score,tone(q.score,86,72,false),q.count?"MOS "+nf(q.mos,2)+" • "+nf(q.count,0)+" échant.":"Aucun échantillon RTP");pulse("pulse-top-expert",xe?nf(xs,1)+"%":"—",xs,tone(xs,35,55,true));pulse("pulse-top-carrier",xc?nf(cs,1)+"%":"—",cs,tone(cs,45,70,true));
  var s=d.series||[],g=d.granularity||"hour";
  multi("cockpit-finance-trend",s,[{k:"revenue",n:"CA"},{k:"expected_payout",n:"Reversement"},{k:"margin",n:"Marge"}],g);outcomes("cockpit-outcome-chart",s,g);dual("cockpit-quality-chart",d.quality_series||[],"mos","packet_loss_percent","MOS","Perte %",g);
  multi("cockpit-unit-chart",s.map(function(x){var n=Number(x.calls_total||0);return {...x,value_per_call:n?Number(x.revenue||0)/n:0,margin_per_call:n?Number(x.margin||0)/n:0};}),[{k:"value_per_call",n:"CA / appel"},{k:"margin_per_call",n:"Marge / appel"}],g);
  var a=$("cockpit-margin-badge");if(a)a.textContent=m.mixedCurrency?"Marge multi-devises":"Marge "+nf(mr,1)+"%";a=$("cockpit-loss-badge");if(a)a.textContent="Pertes "+nf(ar+fr,1)+"%";a=$("cockpit-quality-samples");if(a)a.textContent=nf(q.count,0)+" échantillon"+(q.count>1?"s":"");a=$("cockpit-unit-badge");if(a)a.textContent=m.mixedCurrency?"Multi-devises":(m.calls?money(m.ca/m.calls,c)+"/appel":"—");ladder(m,c);
}
root.PGICockpitPro=Object.freeze({render:render});
})(window);
