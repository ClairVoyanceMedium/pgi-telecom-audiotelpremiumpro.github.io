export function applyClientAccessVisibility(data={},demo=false){
  const permissions=data.user?.permissions||[],all=demo||permissions.includes("*"),can=p=>all||permissions.includes(p);
  const byId=id=>document.getElementById(id);
  const hideId=(id,hidden)=>{const el=byId(id);if(el)el.hidden=hidden};
  const hideCard=(id,hidden)=>{const el=byId(id),card=el?.closest("article");if(card)card.hidden=hidden};
  const hideNav=(href,hidden)=>{const el=document.querySelector('.cp-section-nav a[href="'+href+'"]');if(el)el.hidden=hidden};
  const finance=!can("finance.read"),routing=!can("routing.read"),incidents=!can("incidents.read");
  hideId("client-finance",finance);hideNav("#client-finance",finance);hideCard("kpi-revenue",finance);hideCard("kpi-payout",finance);hideCard("revenue-chart",finance);hideCard("payout-bars",finance);
  hideId("client-routing",routing);hideNav("#client-routing",routing);hideCard("numbers-list",routing);hideCard("portability-open",routing);
  hideId("client-service-center",incidents);
}
