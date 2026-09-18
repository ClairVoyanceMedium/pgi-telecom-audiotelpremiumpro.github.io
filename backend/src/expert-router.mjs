export function selectExpert(experts){
  const candidates=(experts||[])
    .filter(x=>x&&x.enabled!==false&&x.status==="available")
    .slice()
    .sort((a,b)=>{
      const activeA=Number(a.active_calls||0),activeB=Number(b.active_calls||0);
      if(activeA!==activeB)return activeA-activeB;
      const ta=a.last_assigned_at?Date.parse(a.last_assigned_at):0;
      const tb=b.last_assigned_at?Date.parse(b.last_assigned_at):0;
      if(ta!==tb)return ta-tb;
      return Number(a.id||0)-Number(b.id||0);
    });
  return candidates[0]||null;
}
