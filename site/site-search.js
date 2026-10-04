(()=>{
"use strict";
const root=document.querySelector("[data-site-search]");
if(!root)return;
const form=root.querySelector("[data-site-search-form]");
const input=root.querySelector("[data-site-search-input]");
const panel=root.querySelector("[data-site-search-results]");
if(!form||!input||!panel)return;

const normalize=value=>String(value||"")
  .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .toLowerCase()
  .replace(/[’']/g," ")
  .replace(/[^a-z0-9€%+.-]+/g," ")
  .replace(/\s+/g," ")
  .trim();

const aliases={
  "portabilite":["portage","transfert","conserver numero","garder numero","changer operateur"],
  "portage":["portabilite","transfert"],
  "operateur":["changer operateur","portabilite"],
  "numero":["numero sva","numero surtaxe","08","081","082","089"],
  "surtaxe":["numero surtaxe","08","081","082","089","sva"],
  "reversement":["revenu","gain","gains","commission","minute","remuneration"],
  "revenu":["reversement","gain","gains","simulation","comparateur"],
  "gain":["revenu","reversement","comparateur"],
  "tarif":["prix","cout","4,90 euro","4.90 euro","4,90€","4.90€","abonnement"],
  "prix":["tarif","cout","abonnement","4,90€","4.90€"],
  "carte":["paiement cb","paiement carte","cb"],
  "cb":["paiement cb","carte bancaire","paiement"],
  "paiement":["paiement cb","carte bancaire","abonnement"],
  "business":["business live","suivi direct","temps reel"],
  "live":["business live","temps reel","direct"],
  "siret":["sans siret","particulier","independant"],
  "resiliation":["resilier","contrat","abonnement"],
  "resilier":["resiliation","contrat"],
  "retractation":["droit de retractation","consommateur"],
  "confidentialite":["donnees","rgpd","vie privee"],
  "voyance":["audiotel voyance","consultation"],
  "coaching":["audiotel coaching","consultation"],
  "independant":["sans siret","professionnel","porteur projet"],
  "compte":["espace client","connexion","se connecter","client","dossier","abonnement","profil","mot de passe"],
  "connexion":["compte","espace client","se connecter","identifiant","mot de passe"],
  "dossier":["compte","client","ouverture","demande","suivi"]
};

const popular=[
  {title:"Portabilité de mon numéro",url:"/portabilite-numero-sva/",description:"Conserver un numéro surtaxé éligible et préparer son transfert."},
  {title:"Demander un nouveau numéro",url:"/numero-sva/",description:"Comprendre l’ouverture et préparer une demande de numéro SVA."},
  {title:"Comparer mon offre",url:"/comparateur-audiotel/",description:"Comparer reversements et potentiel à activité identique."},
  {title:"Tarif Audiotel Premium Pro",url:"/#tarif",description:"Voir le tarif de la plateforme et les conditions affichées."},
  {title:"Paiement par carte bancaire",url:"/paiement-cb-audiotel/",description:"Découvrir le service complémentaire de paiement CB sécurisé."}
];

let indexPromise=null,entries=[],active=-1,lastTrackedQuery="";
const loadIndex=()=>{
  if(indexPromise)return indexPromise;
  indexPromise=fetch("/site-search-index.json",{credentials:"same-origin",cache:"force-cache"})
    .then(r=>{if(!r.ok)throw new Error("search index");return r.json()})
    .then(data=>{
      entries=Array.isArray(data?.pages)?data.pages:[];
      entries.forEach(item=>{
        item._title=normalize(item.title);
        item._description=normalize(item.description);
        item._headings=normalize(item.headings);
        item._keywords=normalize(item.keywords);
        item._text=normalize(item.text);
        item._words=new Set((item._title+" "+item._headings+" "+item._keywords).split(" ").filter(Boolean));
      });
      return entries;
    }).catch(()=>[]);
  return indexPromise;
};

const distance=(a,b)=>{
  if(a===b)return 0;
  if(!a||!b)return Math.max(a.length,b.length);
  const prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    let diagonal=prev[0],left=i;
    prev[0]=i;
    for(let j=1;j<=b.length;j++){
      const up=prev[j],cost=a[i-1]===b[j-1]?0:1;
      const next=Math.min(up+1,left+1,diagonal+cost);
      diagonal=up;prev[j]=next;left=next;
    }
  }
  return prev[b.length];
};

const expandedTerms=query=>{
  const base=normalize(query).split(" ").filter(Boolean);
  const out=new Set(base);
  for(const term of base){
    for(const extra of aliases[term]||[]) normalize(extra).split(" ").forEach(x=>x&&out.add(x));
  }
  return [...out];
};

const fuzzyMatch=(entry,term)=>{
  if(term.length<4)return false;
  const limit=term.length>=8?2:1;
  for(const word of entry._words){
    if(Math.abs(word.length-term.length)>limit)continue;
    if(distance(word,term)<=limit)return true;
  }
  return false;
};

const intentBoost=(entry,q)=>{
  const path=String(entry.url||"");
  if(/\b(garder|conserver|transferer|transfert|portabilite|changer)\b/.test(q)&&/\b(08|numero|operateur)\b/.test(q)){
    if(path==="/portabilite-numero-sva/")return 280;
    if(path==="/changer-operateur-audiotel/")return 190;
  }
  if(/\b(combien|rapporte|gagner|gain|revenu)\b/.test(q)&&path==="/combien-rapporte-numero-surtaxe/")return 220;
  if(/\b(moneti|valoriser)\w*/.test(q)&&path==="/monetiser-ses-appels/")return 220;
  return 0;
};

const scoreEntry=(entry,query)=>{
  const q=normalize(query);
  if(!q)return 0;
  const terms=expandedTerms(q);
  let score=intentBoost(entry,q),matchedPrimary=0;
  if(entry._title.includes(q))score+=120;
  if(entry._headings.includes(q))score+=80;
  if(entry._keywords.includes(q))score+=70;
  if(entry._description.includes(q))score+=55;
  if(entry._text.includes(q))score+=18;
  const primary=normalize(query).split(" ").filter(Boolean);
  for(const term of terms){
    let hit=0;
    if(entry._title.includes(term)){score+=24;hit=1}
    if(entry._headings.includes(term)){score+=18;hit=1}
    if(entry._keywords.includes(term)){score+=20;hit=1}
    if(entry._description.includes(term)){score+=11;hit=1}
    if(entry._text.includes(term)){score+=3;hit=1}
    if(!hit&&fuzzyMatch(entry,term)){score+=4;hit=1}
    if(primary.includes(term)&&hit)matchedPrimary++;
  }
  if(primary.length&&matchedPrimary===primary.length)score+=35;
  if(primary.length>1&&matchedPrimary<Math.ceil(primary.length/2))score-=25;
  return score;
};

const escapeHtml=value=>String(value||"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));

const render=(items,query="",suggestions=false)=>{
  active=-1;
  if(!items.length){
    panel.innerHTML='<div class="public-search-empty"><strong>Aucun résultat</strong><span>Essayez un terme comme “portabilité”, “reversement”, “tarif”, “08” ou “paiement CB”.</span></div>';
    panel.hidden=false;input.setAttribute("aria-expanded","true");return;
  }
  const heading=suggestions?"Accès rapides":items.length+" résultat"+(items.length>1?"s":"")+" proposé"+(items.length>1?"s":"");
  panel.innerHTML='<div class="public-search-result-heading">'+heading+'</div>'+
    items.map((item,i)=>'<a class="public-search-result" role="option" id="site-search-option-'+i+'" aria-selected="false" data-search-index="'+i+'" href="'+escapeHtml(item.url)+'">'+
      '<strong>'+escapeHtml(item.title)+'</strong>'+
      '<span>'+escapeHtml(item.description||"")+'</span>'+
      (item.category?'<small>'+escapeHtml(item.category)+'</small>':'')+
    '</a>').join("");
  panel.hidden=false;input.setAttribute("aria-expanded","true");
  panel.querySelectorAll(".public-search-result").forEach(link=>{
    link.addEventListener("mouseenter",()=>setActive(Number(link.dataset.searchIndex)));
    link.addEventListener("click",()=>{
      try{window.PGIAnalytics?.track?.("select_content",{content_type:"internal_link",content_id:"site_search_result"})}catch(_e){}
    });
  });
};

const trackSearchQuery=query=>{
  const safe=String(query||"").trim().slice(0,80);
  const key=normalize(safe);
  if(!safe||safe.includes("@")||/\d{7,}/.test(safe)||key===lastTrackedQuery)return;
  lastTrackedQuery=key;
  try{window.PGIAnalytics?.track?.("search",{search_term:safe})}catch(_e){}
};

const hide=()=>{panel.hidden=true;input.setAttribute("aria-expanded","false");input.removeAttribute("aria-activedescendant");active=-1};
const setActive=i=>{
  const links=[...panel.querySelectorAll(".public-search-result")];
  if(!links.length)return;
  active=(i+links.length)%links.length;
  links.forEach((el,n)=>{const on=n===active;el.classList.toggle("is-active",on);el.setAttribute("aria-selected",on?"true":"false")});
  input.setAttribute("aria-activedescendant","site-search-option-"+active);
  links[active].scrollIntoView({block:"nearest"});
};
const search=async()=>{
  const query=input.value.trim();
  if(query.length<2){render(popular,"",true);return}
  const data=await loadIndex();
  const ranked=data.map(item=>({item,score:scoreEntry(item,query)}))
    .filter(x=>x.score>0)
    .sort((a,b)=>b.score-a.score||a.item.title.localeCompare(b.item.title,"fr"))
    .slice(0,10)
    .map(x=>x.item);
  render(ranked,query,false);
  trackSearchQuery(query);
};

let timer=0;
input.addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(search,70)});
input.addEventListener("focus",()=>{if(input.value.trim().length<2)render(popular,"",true);else search()});
input.addEventListener("keydown",e=>{
  if(e.key==="ArrowDown"){e.preventDefault();setActive(active+1)}
  else if(e.key==="ArrowUp"){e.preventDefault();setActive(active-1)}
  else if(e.key==="Escape"){hide();input.blur()}
  else if(e.key==="Enter"&&!panel.hidden){
    const links=[...panel.querySelectorAll(".public-search-result")];
    const target=active>=0?links[active]:null;
    e.preventDefault();
    if(target){target.click();location.href=target.href}else search();
  }
});
form.addEventListener("submit",e=>{e.preventDefault();search();input.focus()});
document.addEventListener("pointerdown",e=>{if(!root.contains(e.target))hide()});
document.addEventListener("keydown",e=>{
  if(e.key!=="/"||e.ctrlKey||e.metaKey||e.altKey)return;
  const tag=document.activeElement?.tagName;
  if(["INPUT","TEXTAREA","SELECT"].includes(tag)||document.activeElement?.isContentEditable)return;
  e.preventDefault();input.focus();
});
})();
