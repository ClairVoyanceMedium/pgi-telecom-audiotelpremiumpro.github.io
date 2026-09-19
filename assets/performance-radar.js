const $=id=>document.getElementById(id);
const n=(v,d=1)=>new Intl.NumberFormat("fr-FR",{maximumFractionDigits:d,minimumFractionDigits:d?d:0}).format(Number(v)||0);
const money=(v,c="EUR")=>{try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:c}).format(Number(v)||0);}catch{return n(v,2)+" €";}};
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
const pct=(v,t)=>Number(t)>0?Number(v||0)/Number(t)*100:0;
const median=a=>{const x=a.filter(Number.isFinite).slice().sort((a,b)=>a-b),m=x.length>>1;return x.length?(x.length%2?x[m]:(x[m-1]+x[m])/2):0;};
const fmtSec=s=>{s=Math.max(0,Math.round(Number(s)||0));return s<60?s+" s":Math.floor(s/60)+"m "+String(s%60).padStart(2,"0")+"s";};

function signal(name,values,mode,format){
  const clean=values.filter(Number.isFinite),current=clean.at(-1);
  if(clean.length<4||current==null)return {name,state:"neutral",label:"Historique court",current:current??0,reference:null,delta:null,score:0,format};
  const history=clean.slice(0,-1).slice(-12),reference=median(history);
  const mad=median(history.map(x=>Math.abs(x-reference)));
  const floor=Math.max(Math.abs(reference)*.05,.1),scale=Math.max(mad*1.4826,floor);
  const signed=(current-reference)/scale;
  const bad=mode==="high"?Math.max(0,signed):mode==="low"?Math.max(0,-signed):Math.abs(signed);
  const favorable=mode==="high"?signed<-.75:mode==="low"?signed>.75:false;
  const state=bad>=3.5?"bad":bad>=2.5?"warn":favorable?"good":"neutral";
  const label=state==="bad"?"Anomalie forte":state==="warn"?"Écart notable":state==="good"?"Amélioration":"Stable";
  return {name,state,label,current,reference,delta:current-reference,score:bad,format};
}

function valueText(s,v){
  if(s.format==="percent")return n(v,1)+"%";
  if(s.format==="seconds")return fmtSec(v);
  if(s.format==="money")return money(v,s.currency);
  return n(v,1);
}
function deltaText(s){
  if(s.reference==null)return "Référence insuffisante";
  const d=s.delta||0,sign=d>0?"+":"";
  if(s.format==="percent")return sign+n(d,1)+" pt vs médiane";
  if(s.format==="seconds")return sign+n(d,1)+" s vs médiane";
  if(s.format==="money")return sign+money(d,s.currency)+" vs médiane";
  return sign+n(d,1)+" vs médiane";
}

function renderSignals(root,d,currency){
  const series=d.series||[],exp=d.experience_series||[],quality=d.quality_series||[];
  const signals=[
    signal("Trafic",series.map(x=>Number(x.calls_total||0)),"both","number"),
    signal("Taux de décroché",series.map(x=>Number(x.calls_total||0)?pct(x.calls_connected,x.calls_total):0),"low","percent"),
    signal("Abandons",series.map(x=>Number(x.calls_total||0)?pct(x.calls_abandoned,x.calls_total):0),"high","percent"),
    signal("Attente moyenne",exp.map(x=>Number(x.avg_wait_seconds||0)),"high","seconds"),
    signal("Chiffre d’affaires",series.map(x=>Number(x.revenue||0)),"low","money"),
    signal("MOS",quality.map(x=>Number(x.mos||0)).filter(x=>x>0),"low","number")
  ];
  signals.forEach(x=>x.currency=currency);
  const alerts=signals.filter(x=>x.state==="bad"||x.state==="warn").length;
  const badge=alerts?alerts+" signal"+(alerts>1?"s":"")+" actif"+(alerts>1?"s":""):"Aucun signal";
  return '<div class="radar-signals-head"><div><p class="panel-kicker">DÉTECTION STATISTIQUE</p><h3>Dérives de la dernière période</h3><small>Comparaison robuste avec la médiane des 12 périodes précédentes.</small></div><span class="metric-badge '+(alerts?"warn":"ok")+'">'+badge+'</span></div>'+
    '<div class="radar-signal-grid">'+signals.map(s=>
      '<article class="radar-signal '+s.state+'"><div><span>'+esc(s.name)+'</span><b>'+esc(s.label)+'</b></div><strong>'+esc(valueText(s,s.current))+'</strong><small>'+esc(deltaText(s))+'</small><i><b style="width:'+Math.min(100,s.score/3.5*100).toFixed(0)+'%"></b></i></article>'
    ).join("")+'</div>';
}

function dimensionStats(rows,total){
  return (rows||[]).map(x=>{
    const calls=Number(x.calls_total||0),connected=Number(x.calls_connected||0),conv=Number(x.conversation_seconds||0);
    return {...x,calls,connected,share:pct(calls,total),asr:pct(connected,calls),acd:connected?conv/connected:0,valueCall:calls&&x.revenue!=null?Number(x.revenue)/calls:null,margin:Number.isFinite(Number(x.margin))?Number(x.margin):null};
  });
}
function concentration(rows,total,count){return total?rows.slice(0,count).reduce((s,x)=>s+Number(x.calls_total||0),0)/total*100:0;}

function matrix(title,rows,currency){
  const body=rows.slice(0,8).map(x=>'<tr><td><strong>'+esc(x.dimension_label||"—")+'</strong></td><td>'+n(x.share,1)+'%</td><td>'+n(x.calls,0)+'</td><td>'+n(x.asr,1)+'%</td><td>'+fmtSec(x.acd)+'</td><td>'+(x.valueCall==null?"—":money(x.valueCall,currency))+'</td><td>'+(x.margin==null?"—":money(x.margin,currency))+'</td></tr>').join("");
  return '<article class="panel radar-matrix"><div class="panel-head"><div><p class="panel-kicker">BENCHMARK</p><h3>'+esc(title)+'</h3></div></div><div class="table-wrap"><table><thead><tr><th>Entité</th><th>Part</th><th>Appels</th><th>ASR</th><th>ACD</th><th>CA/appel</th><th>Marge</th></tr></thead><tbody>'+body+'</tbody></table></div></article>';
}

function scatter(id,title,rows,platformAsr){
  const W=760,H=240,p={l:44,r:20,t:34,b:32},maxCalls=Math.max(1,...rows.map(x=>x.calls)),sx=v=>p.l+(W-p.l-p.r)*Math.min(100,Math.max(0,v))/100,sy=v=>H-p.b-(H-p.t-p.b)*Math.min(100,Math.max(0,v))/100;
  const avgY=sy(platformAsr||0);
  const points=rows.slice(0,12).map((x,i)=>{
    const radius=5+11*Math.sqrt(x.calls/maxCalls),cx=sx(x.share),cy=sy(x.asr),cls=x.asr>=platformAsr?"above":"below";
    const label=i<5?'<text class="radar-point-label" x="'+(cx+radius+4)+'" y="'+(cy+3)+'">'+esc(String(x.dimension_label||"").slice(0,14))+'</text>':"";
    return '<g class="radar-point '+cls+'"><circle cx="'+cx+'" cy="'+cy+'" r="'+radius.toFixed(1)+'"><title>'+esc(x.dimension_label||"—")+' • '+n(x.share,1)+'% volume • ASR '+n(x.asr,1)+'%</title></circle>'+label+'</g>';
  }).join("");
  const grid=[0,25,50,75,100].map(v=>'<line class="chart-grid" x1="'+p.l+'" x2="'+(W-p.r)+'" y1="'+sy(v)+'" y2="'+sy(v)+'"/><text class="chart-axis" x="4" y="'+(sy(v)+3)+'">'+v+'%</text>').join("");
  return '<article class="panel radar-scatter"><div class="panel-head"><div><p class="panel-kicker">MATRICE VOLUME × ASR</p><h3>'+esc(title)+'</h3></div><span class="metric-badge">ASR plateforme '+n(platformAsr,1)+'%</span></div><div class="chart-wrap"><svg id="'+id+'" viewBox="0 0 760 240" role="img">'+grid+'<line class="radar-benchmark" x1="'+p.l+'" x2="'+(W-p.r)+'" y1="'+avgY+'" y2="'+avgY+'"/>'+points+'<text class="chart-axis" x="'+p.l+'" y="'+(H-8)+'">0% part trafic</text><text class="chart-axis" text-anchor="end" x="'+(W-p.r)+'" y="'+(H-8)+'">100%</text></svg></div></article>';
}

export function render(ctx){
  const root=$("performance-radar");if(!root)return;
  const d=ctx.data||{},m=ctx.m||{},currency=ctx.currency||"EUR",total=Math.max(0,Number(m.calls||0));
  const experts=dimensionStats(d.experts,total),carriers=dimensionStats(d.carriers,total);
  const e1=concentration(experts,total,1),e3=concentration(experts,total,3),c1=concentration(carriers,total,1),c3=concentration(carriers,total,3);
  root.innerHTML='<div class="cockpit-section-head radar-head"><div><p class="panel-kicker">PERFORMANCE RADAR</p><h2>Benchmark & anomalies</h2><p>Détection adaptative, concentration et comparaison des contributeurs.</p></div><span class="metric-badge">ANALYSE LOCALE</span></div>'+
    renderSignals(root,d,currency)+
    '<div class="radar-concentration"><div><span>Top expert</span><strong>'+n(e1,1)+'%</strong><small>Top 3 '+n(e3,1)+'%</small></div><div><span>Top opérateur</span><strong>'+n(c1,1)+'%</strong><small>Top 3 '+n(c3,1)+'%</small></div><div><span>Experts mesurés</span><strong>'+n(experts.length,0)+'</strong><small>sur la période</small></div><div><span>Réseaux mesurés</span><strong>'+n(carriers.length,0)+'</strong><small>sur la période</small></div></div>'+
    '<div class="radar-scatter-grid">'+scatter("expert-performance-scatter","Experts",experts,Number(m.asr||0))+scatter("carrier-performance-scatter","Opérateurs",carriers,Number(m.asr||0))+'</div>'+
    '<div class="radar-matrix-grid">'+matrix("Performance experts",experts,currency)+matrix("Performance opérateurs",carriers,currency)+'</div>';
}
