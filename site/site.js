(()=>{
const $=id=>document.getElementById(id);
const rate=$("rate"),hours=$("hours"),days=$("days");
if(!rate||!hours||!days)return;
const clamp=(n,min,max)=>Math.min(max,Math.max(min,Number.isFinite(n)?n:0));
const nf=new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0});
const money=new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:0});
function render(){
  const r=clamp(parseFloat(rate.value),0,1);
  const h=clamp(parseFloat(hours.value),0,24);
  const d=clamp(parseFloat(days.value),0,31);
  const minutes=h*60*d;
  const perDay=h*60*r;
  const perMonth=minutes*r;
  $("calc-minutes").textContent=nf.format(minutes);
  $("calc-day").textContent=money.format(perDay)+" HT";
  $("calc-month").textContent=money.format(perMonth)+" HT";
  $("calc-year").textContent=money.format(perMonth*12)+" HT";
}
[rate,hours,days].forEach(el=>el.addEventListener("input",render));
render();
})();
