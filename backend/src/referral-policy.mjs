export const REFERRAL_CURRENCY="EUR";
export const REFERRAL_QUALIFICATION_PAID_INVOICES=3;
export const REFERRAL_TIERS=Object.freeze([
  Object.freeze({from:1,to:4,reward_minor:1000,label:"1 à 4"}),
  Object.freeze({from:5,to:9,reward_minor:1200,label:"5 à 9"}),
  Object.freeze({from:10,to:24,reward_minor:1500,label:"10 à 24"}),
  Object.freeze({from:25,to:null,reward_minor:2000,label:"25 et plus"})
]);
export const REFERRAL_MILESTONES=Object.freeze([
  Object.freeze({ordinal:1,bonus_minor:500,label:"1er filleul"}),
  Object.freeze({ordinal:5,bonus_minor:2000,label:"5e filleul"}),
  Object.freeze({ordinal:10,bonus_minor:5000,label:"10e filleul"})
]);

function positiveOrdinal(value){
  const n=Math.trunc(Number(value));
  if(!Number.isInteger(n)||n<1)throw Object.assign(new Error("INVALID_REFERRAL_ORDINAL"),{code:"INVALID_REFERRAL_ORDINAL"});
  return n;
}
export function referralRewardForOrdinal(value){
  const ordinal=positiveOrdinal(value);
  const tier=REFERRAL_TIERS.find(x=>ordinal>=x.from&&(x.to==null||ordinal<=x.to))||REFERRAL_TIERS[REFERRAL_TIERS.length-1];
  const milestone=REFERRAL_MILESTONES.find(x=>x.ordinal===ordinal)||null;
  const base_minor=tier.reward_minor,bonus_minor=milestone?.bonus_minor||0;
  return {
    ordinal,
    currency:REFERRAL_CURRENCY,
    base_minor,
    bonus_minor,
    total_minor:base_minor+bonus_minor,
    tier:{from:tier.from,to:tier.to,reward_minor:tier.reward_minor,label:tier.label},
    milestone:milestone?{ordinal:milestone.ordinal,bonus_minor:milestone.bonus_minor,label:milestone.label}:null
  };
}
export function referralCumulativeRewardForCount(value){
  const count=Math.max(0,Math.trunc(Number(value)||0));
  let total_minor=0;
  for(let ordinal=1;ordinal<=count;ordinal++)total_minor+=referralRewardForOrdinal(ordinal).total_minor;
  return {count,total_minor,currency:REFERRAL_CURRENCY};
}
export function referralPublicPolicy(){
  return {
    currency:REFERRAL_CURRENCY,
    qualification:"three_paid_monthly_invoices",
    qualification_paid_invoices:REFERRAL_QUALIFICATION_PAID_INVOICES,
    reward_minor:REFERRAL_TIERS[0].reward_minor,
    tiers:REFERRAL_TIERS.map(x=>({...x})),
    milestones:REFERRAL_MILESTONES.map(x=>({...x})),
    permanent_from_ordinal:25,
    permanent_reward_minor:2000,
    policy_version:"2026-10-05-fixed-v1"
  };
}
