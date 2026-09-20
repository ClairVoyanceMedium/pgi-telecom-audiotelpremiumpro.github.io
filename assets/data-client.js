(function(root){
  "use strict";

  var appBootstrapCache=null;
  var appBootstrapAt=0;

  function invalidateAppBootstrap(){
    appBootstrapCache=null;
    appBootstrapAt=0;
  }

  function mapCall(c){
    var q=c.quality||{};
    var ts=new Date(c.started_at);
    var ivr=c.ivr_started_at?new Date(c.ivr_started_at):new Date(ts.getTime()+2000);
    var queued=c.queued_at?new Date(c.queued_at):ivr;
    var bridged=c.bridged_at?new Date(c.bridged_at):null;
    var ended=c.ended_at?new Date(c.ended_at):new Date(ts.getTime()+Number(c.total_seconds||0)*1000);
    var billableSeconds=Number(c.billable_seconds||0);
    var payoutEligibleSeconds=Number(c.payout_eligible_seconds||0);
    return {
      id:c.id,ts:ts,ivrStarted:ivr,queued:queued,ringing:c.ringing_at?new Date(c.ringing_at):null,bridged:bridged,ended:ended,
      caller:c.caller_masked||"—",carrier:c.origin_carrier||"Inconnu",number:c.sva_number||"—",
      market:c.market||"FR",currency:c.currency||"EUR",
      expert:c.expert_name||"Non attribué",expertId:c.expert_id||null,
      wait:Number(c.wait_seconds||0),conversation:Number(c.conversation_seconds||0),total:Number(c.total_seconds||0),
      billable:billableSeconds/60,originType:c.origin_type||"unknown",payoutEligible:payoutEligibleSeconds/60,
      expected:Number(c.expected_payout_ht||0),confirmed:c.confirmed_payout_ht==null?0:Number(c.confirmed_payout_ht||0),
      paid:Number(c.paid_payout_ht||0),status:c.call_status||"failed",
      billableSeconds:billableSeconds,payoutEligibleSeconds:payoutEligibleSeconds,
      expectedPayoutHt:Number(c.expected_payout_ht||0),confirmedPayoutHt:c.confirmed_payout_ht==null?0:Number(c.confirmed_payout_ht||0),
      paidPayoutHt:Number(c.paid_payout_ht||0),expertCost:Number(c.expert_cost_ht||0),cost:Number(c.technical_cost_ht||0),
      expertCostHt:Number(c.expert_cost_ht||0),technicalCostHt:Number(c.technical_cost_ht||0),
      serviceAmount:Number(c.retail_service_amount_ttc||0),serviceAmountTtc:Number(c.retail_service_amount_ttc||0),
      serviceRate:Number(c.service_rate_ttc_per_min||0),carrierRate:Number(c.carrier_rate_ht_per_min||0),
      variance:Number(c.reconciliation_variance_ht||0),sipFinalCode:Number(c.sip_final_code||0),
      pddMs:c.post_dial_delay_ms==null?null:Number(c.post_dial_delay_ms),hangupCause:c.hangup_cause||"—",hangupParty:c.hangup_party||"unknown",codec:c.codec||"—",
      packetLoss:Number(q.packet_loss_percent||0),jitter:Number(q.jitter_ms||0),latency:Number(q.latency_ms||0),rtt:Number(q.rtt_ms||0),mos:Number(q.mos||0),
      packetsIn:Number(q.packets_in||0),packetsOut:Number(q.packets_out||0),packetsLost:Number(q.packets_lost||0),dtmfErrors:Number(q.dtmf_errors||0)
    };
  }

  async function loadCalls(api,from,to,market,maxPages){
    var data=[],cursor=null,pages=0;
    maxPages=Math.max(1,Math.min(4,Number(maxPages)||4));
    do{
      var params={from:from.toISOString(),to:to.toISOString(),limit:"250"};
      if(market)params.market=market;
      if(cursor)params.cursor=cursor;
      var page=await api.calls(params);
      data=data.concat(Array.isArray(page.data)?page.data:[]);
      cursor=page.next_cursor||null;
      pages++;
    }while(cursor&&pages<maxPages);
    return {data:data,truncated:!!cursor,pages:pages};
  }

  async function loadAppBootstrap(api,force){
    if(!force&&appBootstrapCache&&(Date.now()-appBootstrapAt)<60000)return appBootstrapCache;
    var result=null;
    if(api&&typeof api.appBootstrap==="function"){
      try{result=await api.appBootstrap();}catch(e){
        if(e&&e.status!==404&&e.status!==405)throw e;
      }
    }
    if(!result){
      var legacy=await Promise.all([
        api.me(),
        api.baselines({scope:"global",limit:"20"}),
        api.wholesaleOverview().catch(function(){return null;})
      ]);
      result={user:legacy[0]&&legacy[0].user?legacy[0].user:null,baselines:legacy[1],wholesale:legacy[2]};
    }
    appBootstrapCache=result;
    appBootstrapAt=Date.now();
    return result;
  }

  async function loadDashboardBootstrap(api,range,prevRange,market){
    if(api&&typeof api.dashboardBootstrap==="function"){
      try{
        return await api.dashboardBootstrap(
          range.from.toISOString(),range.to.toISOString(),market,
          prevRange?prevRange.from.toISOString():null,
          prevRange?prevRange.to.toISOString():null
        );
      }catch(e){
        if(e&&e.status!==404&&e.status!==405)throw e;
      }
    }
    var parts=await Promise.all([
      api.summary(range.from.toISOString(),range.to.toISOString(),market),
      prevRange?api.summary(prevRange.from.toISOString(),prevRange.to.toISOString(),market):Promise.resolve(null),
      api.analytics(range.from.toISOString(),range.to.toISOString(),market).catch(function(){return null;}),
      typeof api.voiceIntelligence==="function"?api.voiceIntelligence(range.from.toISOString(),range.to.toISOString(),market).catch(function(){return null;}):Promise.resolve(null),
      api.experts(),
      api.systemHealth(),
      api.carrierRouting(),
      api.reconciliation(range.from.toISOString(),range.to.toISOString(),market)
    ]);
    return {
      summary:parts[0],previous_summary:parts[1],analytics:parts[2],voice_intelligence:parts[3],
      experts:parts[4],system:parts[5],route:parts[6],reconciliation:parts[7]
    };
  }

  root.PGIDataClient=Object.freeze({
    mapCall:mapCall,
    loadCalls:loadCalls,
    loadAppBootstrap:loadAppBootstrap,
    loadDashboardBootstrap:loadDashboardBootstrap,
    invalidateAppBootstrap:invalidateAppBootstrap
  });
})(window);
