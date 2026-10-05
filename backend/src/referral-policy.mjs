export const REFERRAL_POLICY_VERSION="ambassador_fixed_2026_10";
export const REFERRAL_QUALIFICATION_PAID_INVOICES=3;
export const REFERRAL_AMBASSADOR_FROM_RANK=25;

export const REFERRAL_TIERS=Object.freeze([
  Object.freeze({from:1,to:4,reward_minor:1000}),
  Object.freeze({from:5,to:9,reward_minor:1200}),
  Object.freeze({from:10,to:24,reward_minor:1500}),
  Object.freeze({from:25,to:null,reward_minor:2000})
]);

export const REFERRAL_MILESTONE_BONUSES=Object.freeze([
  Object.freeze({rank:1,bonus_minor:500}),
  Object.freeze({rank:5,bonus_minor:2000}),
  Object.freeze({rank:10,bonus_minor:5000})
]);

export function referralRewardForRank(value){
  const rank=Math.max(1,Math.trunc(Number(value)||1));
  const tier=REFERRAL_TIERS.find(x=>rank>=x.from&&(x.to==null||rank<=x.to))||REFERRAL_TIERS[REFERRAL_TIERS.length-1];
  const milestone=REFERRAL_MILESTONE_BONUSES.find(x=>x.rank===rank);
  const base_reward_minor=Number(tier.reward_minor);
  const milestone_bonus_minor=Number(milestone?.bonus_minor||0);
  return {
    rank,
    base_reward_minor,
    milestone_bonus_minor,
    total_reward_minor:base_reward_minor+milestone_bonus_minor,
    ambassador:rank>=REFERRAL_AMBASSADOR_FROM_RANK,
    tier_from:tier.from,
    tier_to:tier.to
  };
}

export function referralPolicyPublicState(){
  return {
    policy_version:REFERRAL_POLICY_VERSION,
    currency:"EUR",
    qualification:"three_paid_monthly_invoices",
    qualification_paid_invoices:REFERRAL_QUALIFICATION_PAID_INVOICES,
    ambassador_from_rank:REFERRAL_AMBASSADOR_FROM_RANK,
    admin_editable_amounts:false,
    tiers:REFERRAL_TIERS.map(x=>({...x})),
    milestone_bonuses:REFERRAL_MILESTONE_BONUSES.map(x=>({...x}))
  };
}

export function referralNextMilestone(rankValue){
  const rank=Math.max(0,Math.trunc(Number(rankValue)||0));
  const milestones=[1,5,10,25];
  const next=milestones.find(x=>x>rank)||null;
  if(next==null)return null;
  const reward=referralRewardForRank(next);
  return {rank:next,reward_minor:reward.base_reward_minor,bonus_minor:reward.milestone_bonus_minor};
}
