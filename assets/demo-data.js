(function(root){
  "use strict";

  function seeded(seed){var x=Math.sin(seed)*10000;return x-Math.floor(x);}
  function maskPhone(i){
    var phones=["06 •• •• 14 82","07 •• •• 91 26","06 •• •• 62 08","07 •• •• 35 41","06 •• •• 88 17","07 •• •• 05 73"];
    return phones[i%phones.length];
  }

  function buildCalls(options){
    options=options||{};
    var config=options.config||{},experts=options.experts||[],carriers=options.carriers||[],number=options.number||"—",core=options.core||null;
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
        var originType=(i+day)%3===0?"fixed":"mobile";
        var financial=status==="connected"&&core?core.computeCallFinancials(
          {conversationSeconds:conv,originType:originType},
          {serviceRateTtcPerMin:config.serviceRate,payoutRateHtPerMin:config.payoutRate,mobileDeductionHtPerMin:0,billingIncrementSeconds:60,minimumPayableSeconds:0,rounding:"ceil"}
        ):{billableSeconds:0,payoutEligibleSeconds:0,serviceAmountTtc:0,expectedPayoutHt:0};
        var billable=financial.billableSeconds/60;
        var expected=financial.expectedPayoutHt;
        var variance=status==="connected"?(seeded(day*11+i*101)<0.045?expected*(0.015+seeded(i)*0.035):0):0;
        var confirmed=Math.max(0,expected-variance);
        var ageDays=Math.floor((now-d)/86400000);
        var paid=ageDays>=60?confirmed:0;
        var ivrStarted=new Date(d.getTime()+2000);
        var queued=new Date(d.getTime()+7000);
        var bridged=status==="connected"?new Date(d.getTime()+wait*1000):null;
        var ended=new Date((bridged||d).getTime()+(status==="connected"?conv*1000:wait*1000));
        var qseed=seeded(day*19+i*7);
        rows.push({
          id:id++,ts:d,ivrStarted:ivrStarted,queued:queued,bridged:bridged,ended:ended,
          caller:maskPhone(i+day),carrier:carriers[(i+day)%Math.max(1,carriers.length)]||"Inconnu",number:number,market:"FR",currency:"EUR",
          expert:experts[(i*3+day)%Math.max(1,experts.length)]||"Non attribué",wait:wait,conversation:conv,total:Math.max(0,Math.round((ended-d)/1000)),billable:billable,
          originType:originType,payoutEligible:financial.payoutEligibleSeconds/60,expected:expected,confirmed:confirmed,paid:paid,status:status,
          billableSeconds:financial.billableSeconds,payoutEligibleSeconds:financial.payoutEligibleSeconds,
          expectedPayoutHt:expected,confirmedPayoutHt:confirmed,paidPayoutHt:paid,
          expertCost:billable*Number(config.expertCostPerMin||0),cost:Number(config.fixedCostPerCall||0),
          expertCostHt:billable*Number(config.expertCostPerMin||0),technicalCostHt:Number(config.fixedCostPerCall||0),
          serviceAmount:financial.serviceAmountTtc,serviceAmountTtc:financial.serviceAmountTtc,
          serviceRate:Number(config.serviceRate||0),carrierRate:Number(config.payoutRate||0),
          variance:Math.max(0,expected-confirmed),
          sipFinalCode:status==="connected"?200:(status==="abandoned"?487:503),
          hangupCause:status==="connected"?"NORMAL_CLEARING":(status==="abandoned"?"ORIGINATOR_CANCEL":"NORMAL_TEMPORARY_FAILURE"),
          codec:"PCMA",packetLoss:+(qseed*0.35).toFixed(3),jitter:+(3+qseed*7).toFixed(2),
          latency:+(18+qseed*28).toFixed(2),mos:+(4.45-qseed*0.35).toFixed(2)
        });
      }
    }
    return rows.sort(function(a,b){return b.ts-a.ts;});
  }

  root.PGIDemoData=Object.freeze({buildCalls:buildCalls});
})(window);
