export function computeExpertCost({type,rate,billableSeconds,expectedPayoutHt,connected=true}){
  if(!connected)return 0;
  const mode=String(type||"none");
  const r=nonNegative(rate);
  const seconds=nonNegative(billableSeconds);
  const payout=nonNegative(expectedPayoutHt);

  if(mode==="per_minute")return roundCurrency((seconds/60)*r);
  if(mode==="percentage"){
    if(r>100)throw new RangeError("percentage compensation rate must be <= 100");
    return roundCurrency(payout*(r/100));
  }
  if(mode==="fixed")return roundCurrency(r);
  if(mode==="none")return 0;
  throw new RangeError("unsupported expert compensation type");
}

function nonNegative(value){
  const n=Number(value||0);
  if(!Number.isFinite(n)||n<0)throw new RangeError("financial value must be a non-negative number");
  return n;
}
function roundCurrency(value){
  return Math.round((Number(value)+Number.EPSILON)*1e6)/1e6;
}
