import {createRequire} from "node:module";
import {createHash,randomUUID} from "node:crypto";
import {sanitizeCdrPayload,deriveCallerHash} from "./cdr-privacy.mjs";
import {selectExpert} from "./expert-router.mjs";
import {normalizeVoiceServiceInput,validateVoiceFlow,simulateVoiceFlow,voiceFlowChecksum} from "./voice-studio-domain.mjs";
import {evaluateOperationalPolicy} from "./operational-policy.mjs";
import {simulateDigitalTwin} from "./digital-twin.mjs";
import {assessShadowBilling} from "./shadow-billing.mjs";
import {assessOperationalRisk} from "./risk-engine.mjs";
import {assessOperationalSlo} from "./slo-assurance.mjs";

const require=createRequire(import.meta.url);
const core=require("../../assets/core.js");

export class MemoryStore{
  constructor(config,eventBus){
    this.config=config;
    this.eventBus=eventBus;
    this.calls=[];
    this.experts=[
      {id:1,code:"ACC",display_name:"Accueil",destination_uri:"loopback/9101",status:"available",enabled:true,active_calls:0,last_assigned_at:null},
      {id:2,code:"COM",display_name:"Service commercial",destination_uri:"loopback/9102",status:"available",enabled:true,active_calls:0,last_assigned_at:null},
      {id:3,code:"SUP",display_name:"Support client",destination_uri:"loopback/9103",status:"away",enabled:true,active_calls:0,last_assigned_at:null},
      {id:4,code:"TECH",display_name:"Service technique",destination_uri:"loopback/9104",status:"available",enabled:true,active_calls:0,last_assigned_at:null}
    ];
    this.callDestinations=[];
    this.liveFinancialSessions=[];
    this.nextDestinationId=1;
    this.voiceServices=[];
    this.nextVoiceServiceId=1;
    this.nextVoiceVersionId=1;
    this.baselines=[];
    this.jackpotBaselines=[];
    this.rawEventKeys=new Set();
    this.outbox=[];
    this.workQueue=[];
    this.idempotency=new Map();
    this.audit=[];
    this.route={
      route_key:"sva-primary",active_carrier:null,standby_carrier:null,
      generation:1,updated_at:new Date().toISOString()
    };
    this.switches=[];
    this.changeRequests=[];
    this.nextChangeRequestId=1;
    this.nextCallId=1;
    this.nextBaselineId=1;
    this.nextSwitchId=1;
    this.subscriptionPrices=[{id:1,plan_key:"external-sva-access",currency:"EUR",amount_minor:300,tax_behavior:"inclusive",billing_interval:"month",interval_count:1,effective_from:"2026-09-20T19:33:00Z",effective_to:null}];
    this.subscriptionEvents=new Set();
    this.adminAlerts=[];
    this.customerExperiencePreferencesMap=new Map();
    this.customerLegalAcceptances=[];
    this.customerWithdrawalRequests=[];
    this.staffUsers=[{id:1,public_id:randomUUID(),login_name:"local-admin",email:"local-admin@staff.pgi.invalid",display_name:"Local Simulator",role:"admin",enabled:true,password_hash:null,session_version:1,last_login_at:null,created_at:new Date().toISOString()}];
    this.nextStaffUserId=2;
  }

  seedSimulator(days=21){
    if(this.calls.length)return;
    const now=Date.now();
    const networks=["Orange","SFR","Bouygues","Free"];
    const statuses=["connected","connected","connected","connected","abandoned","failed"];
    for(let day=0;day<days;day++){
      const count=12+(day%7)*3;
      for(let i=0;i<count;i++){
        const started=new Date(now-day*86400000-(i+1)*31*60000);
        if(started.getTime()>now)continue;
        const status=statuses[(i+day)%statuses.length];
        const conversation=status==="connected"?120+((i*83+day*41)%1700):0;
        const originType=(i+day)%3===0?"fixed":"mobile";
        const financial=status==="connected"?core.computeCallFinancials(
          {conversationSeconds:conversation,originType},
          {
            serviceRateTtcPerMin:this.config.serviceRateTtcPerMin,
            payoutRateHtPerMin:this.config.payoutRateHtPerMin,
            mobileDeductionHtPerMin:0,
            billingIncrementSeconds:60,
            minimumPayableSeconds:0,
            rounding:"ceil"
          }
        ):{billableSeconds:0,payoutEligibleSeconds:0,serviceAmountTtc:0,expectedPayoutHt:0};
        const variance=status==="connected"&&((i+day)%19===0)?Math.min(financial.expectedPayoutHt,.04):0;
        const confirmed=Math.max(0,financial.expectedPayoutHt-variance);
        const paid=day>=7?confirmed:0;
        const expert=this.experts[(i+day)%this.experts.length];
        const wait=8+((i*11+day)%75);
        const bridged=status==="connected"?new Date(started.getTime()+wait*1000):null;
        const ended=new Date((bridged||started).getTime()+(conversation||wait)*1000);
        this.calls.push({
          id:this.nextCallId++,
          external_call_id:"sim-"+day+"-"+i,
          source:"simulator",
          started_at:started.toISOString(),
          ivr_started_at:new Date(started.getTime()+2000).toISOString(),
          queued_at:new Date(started.getTime()+5000).toISOString(),
          bridged_at:bridged?bridged.toISOString():null,
          ended_at:ended.toISOString(),
          caller_masked:(i%2?"06":"07")+" •• •• "+String((i*7)%100).padStart(2,"0")+" "+String((i*13)%100).padStart(2,"0"),
          caller_hash:createHash("sha256").update("sim-caller-"+(i%17)).digest("hex"),
          origin_carrier:networks[(i+day)%networks.length],
          origin_type:originType,
          host_carrier:"SIMULATOR",
          sva_number:"089 SIMULÉ",
          expert_id:expert.id,
          expert_name:expert.display_name,
          wait_seconds:wait,
          conversation_seconds:conversation,
          total_seconds:Math.max(0,Math.round((ended-started)/1000)),
          billable_seconds:financial.billableSeconds,
          payout_eligible_seconds:financial.payoutEligibleSeconds,
          call_status:status,
          sip_final_code:status==="connected"?200:(status==="abandoned"?487:503),
          hangup_cause:status==="connected"?"NORMAL_CLEARING":(status==="abandoned"?"ORIGINATOR_CANCEL":"NORMAL_TEMPORARY_FAILURE"),
          codec:"PCMA",
          service_rate_ttc_per_min:this.config.serviceRateTtcPerMin,
          carrier_rate_ht_per_min:this.config.payoutRateHtPerMin,
          retail_service_amount_ttc:financial.serviceAmountTtc,
          expected_payout_ht:financial.expectedPayoutHt,
          confirmed_payout_ht:confirmed,
          paid_payout_ht:paid,
          expert_cost_ht:(financial.billableSeconds/60)*this.config.expertCostHtPerMin,
          technical_cost_ht:status==="connected"?.03:0,
          estimated_margin_ht:Math.max(0,confirmed-(financial.billableSeconds/60)*this.config.expertCostHtPerMin-(status==="connected"?.03:0)),
          reconciliation_variance_ht:variance,
          reconciliation_status:variance>this.config.reconciliationToleranceHt?"variance":"matched",
          quality:{packet_loss_percent:((i+day)%5)*.05,jitter_ms:3+((i+day)%7),latency_ms:18+((i+day)%10)*2,mos:4.2}
        });
      }
    }
    this.calls.sort((a,b)=>Date.parse(b.started_at)-Date.parse(a.started_at));
  }

  async summary(from,to,market=null){
    void market;
    const rows=this.#range(from,to);
    const mapped=rows.map(toCoreRow);
    const a=core.aggregateCalls(mapped);
    const live=await this.liveFinancialSnapshot();
    const liveSingle=live.currency_count===1?live.by_currency[0]||null:null;
    return {
      generated_revenue_ttc:a.generatedRevenueTtc,
      expected_payout_ht:a.expectedPayoutHt,
      confirmed_payout_ht:a.confirmedPayoutHt,
      paid_payout_ht:a.paidPayoutHt,
      estimated_margin_ht:a.estimatedMarginHt,
      reconciliation_variance_ht:a.reconciliationVarianceHt,
      calls_total:a.calls,
      calls_connected:a.connected,
      calls_abandoned:a.abandoned,
      calls_failed:a.failed,
      billable_minutes:a.billableSeconds/60,
      payout_eligible_minutes:a.payoutEligibleSeconds/60,
      acd_seconds:a.acdSeconds,
      asr_percent:a.asrPercent,
      active_experts:this.experts.filter(x=>x.status==="available").length,
      live_calls:Math.max(this.experts.reduce((s,x)=>s+Number(x.active_calls||0),0),live.active_calls),
      queue_depth:0,
      live_currency_count:live.currency_count,
      live_mixed_currency:live.currency_count>1,
      live_currency:liveSingle?.currency||null,
      live_upstream_payout_ht:liveSingle?.estimated_upstream_payout_ht??null,
      live_client_net_ht:liveSingle?.estimated_client_net_ht??null,
      live_service_revenue_ttc:liveSingle?.estimated_service_revenue_ttc??null,
      live_upstream_rate_ht_per_second:liveSingle?.upstream_rate_ht_per_second??null,
      live_client_rate_ht_per_second:liveSingle?.client_rate_ht_per_second??null,
      live_service_rate_ttc_per_second:liveSingle?.service_rate_ttc_per_second??null,
      live_as_of:live.as_of,
      live_financial_by_currency:live.by_currency
    };
  }

  async liveFinancialSnapshot(tenantId=null,market=null){
    void tenantId;void market;
    const now=Date.now(),groups=new Map();
    for(const row of this.liveFinancialSessions){
      if(row.status!=="active")continue;
      const elapsed=Math.max(0,Math.min(86400,(now-Date.parse(row.billable_started_at))/1000));
      if(!Number.isFinite(elapsed)||elapsed>86400)continue;
      const currency=row.currency||"EUR";
      if(!groups.has(currency))groups.set(currency,{currency,active_calls:0,estimated_service_revenue_ttc:0,estimated_upstream_payout_ht:0,estimated_client_net_ht:0,service_rate_ttc_per_second:0,upstream_rate_ht_per_second:0,client_rate_ht_per_second:0});
      const g=groups.get(currency);
      g.active_calls++;
      g.estimated_service_revenue_ttc+=elapsed/60*Number(row.service_rate_ttc_per_min||0);
      g.estimated_upstream_payout_ht+=elapsed/60*Number(row.upstream_payout_rate_ht_per_min||0);
      g.estimated_client_net_ht+=elapsed/60*Number(row.net_client_rate_ht_per_min||0);
      g.service_rate_ttc_per_second+=Number(row.service_rate_ttc_per_min||0)/60;
      g.upstream_rate_ht_per_second+=Number(row.upstream_payout_rate_ht_per_min||0)/60;
      g.client_rate_ht_per_second+=Number(row.net_client_rate_ht_per_min||0)/60;
    }
    const byCurrency=[...groups.values()].map(roundFinance);
    return {as_of:new Date(now).toISOString(),active_calls:byCurrency.reduce((a,x)=>a+Number(x.active_calls||0),0),currency_count:byCurrency.length,by_currency:byCurrency};
  }


  async customerJackpotSnapshot(tenantId){
    const id=Number(tenantId),all=this.jackpotBaselines.filter(x=>x.tenant_id===id).sort((a,b)=>Date.parse(b.effective_from||b.created_at)-Date.parse(a.effective_from||a.created_at));
    const resetAt=(all[0]&&all[0].effective_from)||new Date().toISOString(),resetMs=Date.parse(resetAt),now=Date.now(),groups=new Map();
    for(const row of this.liveFinancialSessions){
      if(Number(row.tenant_id||0)!==id||!["active","ended"].includes(row.status))continue;
      const start=Math.max(Date.parse(row.billable_started_at),resetMs),end=row.status==="active"?now:Date.parse(row.ended_at||row.updated_at||row.billable_started_at);
      if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)continue;
      const cur=row.currency||"EUR";if(!groups.has(cur))groups.set(cur,{currency:cur,active_calls:0,completed_calls:0,jackpot_client_net_ht:0,live_client_net_ht:0,client_rate_ht_per_second:0});
      const g=groups.get(cur),value=Math.min(86400,(end-start)/1000)/60*Number(row.net_client_rate_ht_per_min||0);g.jackpot_client_net_ht+=value;
      if(row.status==="active"){g.active_calls++;g.live_client_net_ht+=value;g.client_rate_ht_per_second+=Number(row.net_client_rate_ht_per_min||0)/60}else g.completed_calls++;
    }
    return {as_of:new Date(now).toISOString(),reset_at:resetAt,default_currency:"EUR",currency_count:groups.size,by_currency:[...groups.values()],estimate:true,accounting_impact:"none"};
  }

  async liveFinancialByTenant(limit=50){
    const now=Date.now(),groups=new Map();
    for(const row of this.liveFinancialSessions){
      if(row.status!=="active")continue;const tenant=Number(row.tenant_id||0),cur=row.currency||"EUR",key=tenant+":"+cur,start=Date.parse(row.billable_started_at),elapsed=Math.max(0,Math.min(86400,(now-start)/1000));
      if(!groups.has(key))groups.set(key,{tenant_public_id:String(tenant),display_name:"Client "+tenant,currency:cur,active_calls:0,generated_upstream_payout_ht:0,generated_client_net_ht:0,pgi_margin_ht:0,upstream_rate_ht_per_second:0,client_rate_ht_per_second:0,pgi_margin_rate_ht_per_second:0});
      const g=groups.get(key),up=Number(row.upstream_payout_rate_ht_per_min||0),net=Number(row.net_client_rate_ht_per_min||0),margin=Math.max(0,up-net);g.active_calls++;g.generated_upstream_payout_ht+=elapsed/60*up;g.generated_client_net_ht+=elapsed/60*net;g.pgi_margin_ht+=elapsed/60*margin;g.upstream_rate_ht_per_second+=up/60;g.client_rate_ht_per_second+=net/60;g.pgi_margin_rate_ht_per_second+=margin/60;
    }
    const data=[...groups.values()].sort((a,b)=>b.generated_upstream_payout_ht-a.generated_upstream_payout_ht).slice(0,Math.max(1,Math.min(100,Number(limit)||50)));
    return {as_of:new Date(now).toISOString(),active_calls:data.reduce((a,x)=>a+x.active_calls,0),by_client:data};
  }

  async dashboardAnalytics(from,to,market=null){
    void market;
    const rows=this.#range(from,to);
    const durationMs=Math.max(0,Date.parse(to)-Date.parse(from));
    const granularity=durationMs>14*86400000?"day":"hour";
    const group=(items,keyFn)=>{
      const map=new Map();
      for(const x of items){
        const key=keyFn(x);
        if(!map.has(key))map.set(key,[]);
        map.get(key).push(x);
      }
      return map;
    };
    const sum=(items,key)=>items.reduce((a,x)=>a+Number(x[key]||0),0);
    const summarize=(items)=>({
      calls_total:items.length,
      calls_connected:items.filter(x=>x.call_status==="connected").length,
      calls_abandoned:items.filter(x=>x.call_status==="abandoned").length,
      calls_failed:items.filter(x=>!["connected","abandoned"].includes(x.call_status)).length,
      conversation_seconds:sum(items,"conversation_seconds"),
      billable_seconds:sum(items,"billable_seconds"),
      payout_eligible_seconds:sum(items,"payout_eligible_seconds"),
      revenue:sum(items,"retail_service_amount_ttc"),
      expected_payout:sum(items,"expected_payout_ht"),
      confirmed_payout:sum(items,"confirmed_payout_ht"),
      paid_payout:sum(items,"paid_payout_ht"),
      expert_cost:sum(items,"expert_cost_ht"),
      technical_cost:sum(items,"technical_cost_ht"),
      margin:sum(items,"estimated_margin_ht"),
      reconciliation_variance:sum(items,"reconciliation_variance_ht"),
      currency:"EUR",currency_count:1
    });
    const bucketKey=x=>{
      const d=new Date(x.started_at);
      if(granularity==="day")d.setHours(0,0,0,0);
      else d.setMinutes(0,0,0);
      return d.toISOString();
    };
    const series=[...group(rows,bucketKey)].map(([bucket,items])=>({bucket,...summarize(items)})).sort((a,b)=>Date.parse(a.bucket)-Date.parse(b.bucket));
    const hours=[...group(rows,x=>new Date(x.started_at).getHours())].map(([hour,items])=>({hour:Number(hour),calls_total:items.length,calls_connected:items.filter(x=>x.call_status==="connected").length,billable_seconds:sum(items,"billable_seconds")})).sort((a,b)=>a.hour-b.hour);
    const weekdays=[...group(rows,x=>{const d=new Date(x.started_at).getDay();return d===0?7:d;})].map(([weekday,items])=>({weekday:Number(weekday),calls_total:items.length,calls_connected:items.filter(x=>x.call_status==="connected").length,billable_seconds:sum(items,"billable_seconds")})).sort((a,b)=>a.weekday-b.weekday);
    const heatmap=[...group(rows,x=>{
      const d=new Date(x.started_at),day=d.getDay()===0?7:d.getDay();
      return day+":"+d.getHours();
    })].map(([key,items])=>{
      const parts=String(key).split(":");
      return {weekday:Number(parts[0]),hour:Number(parts[1]),calls_total:items.length};
    }).sort((a,b)=>a.weekday-b.weekday||a.hour-b.hour);
    const dim=(type,keyFn,labelFn)=>{
      const out=[...group(rows,keyFn)].map(([dimension_key,items])=>({
        dimension_type:type,dimension_key:String(dimension_key),dimension_label:labelFn(items[0]),
        calls_total:items.length,calls_connected:items.filter(x=>x.call_status==="connected").length,
        conversation_seconds:sum(items,"conversation_seconds"),billable_seconds:sum(items,"billable_seconds"),
        revenue:sum(items,"retail_service_amount_ttc"),expected_payout:sum(items,"expected_payout_ht")
      }));
      return out.sort((a,b)=>b.calls_total-a.calls_total);
    };
    const expertsRows=dim("expert",x=>x.expert_id||"unassigned",x=>x.expert_name||"Non affecté").slice(0,12);
    const carriersRows=dim("carrier",x=>x.origin_carrier||"unknown",x=>x.origin_carrier||"Inconnu").slice(0,12);
    const durationKey=x=>x.call_status!=="connected"?"not_connected":x.conversation_seconds<60?"lt_1m":x.conversation_seconds<300?"1_5m":x.conversation_seconds<600?"5_10m":x.conversation_seconds<1200?"10_20m":x.conversation_seconds<1800?"20_30m":"gte_30m";
    const durationLabels={not_connected:"Non aboutis",lt_1m:"< 1 min","1_5m":"1–5 min","5_10m":"5–10 min","10_20m":"10–20 min","20_30m":"20–30 min",gte_30m:"30 min +"};
    const durations=dim("duration",durationKey,x=>durationLabels[durationKey(x)]||durationKey(x));
    const qualityRows=rows.filter(x=>x.quality&&Number.isFinite(Number(x.quality.mos))&&Number.isFinite(Number(x.quality.packet_loss_percent))&&Number.isFinite(Number(x.quality.jitter_ms))&&Number.isFinite(Number(x.quality.latency_ms)));
    const qavg=key=>qualityRows.length?qualityRows.reduce((a,x)=>a+Number(x.quality[key]||0),0)/qualityRows.length:null;
    const quality={
      samples:qualityRows.length,
      mos:qavg("mos"),
      packet_loss_percent:qavg("packet_loss_percent"),
      jitter_ms:qavg("jitter_ms"),
      latency_ms:qavg("latency_ms"),
      dtmf_errors:qualityRows.reduce((a,x)=>a+Number(x.quality.dtmf_errors||0),0),
      affected_samples:qualityRows.filter(x=>Number(x.quality.packet_loss_percent||0)>=5||Number(x.quality.jitter_ms||0)>5||Number(x.quality.latency_ms||0)>150).length,
      low_mos_samples:qualityRows.filter(x=>Number(x.quality.mos||0)<3.5).length
    };
    const qualitySeries=[...group(qualityRows,bucketKey)].map(([bucket,items])=>{
      const avg=key=>items.length?items.reduce((a,x)=>a+Number(x.quality[key]||0),0)/items.length:null;
      return {
        bucket,samples:items.length,mos:avg("mos"),packet_loss_percent:avg("packet_loss_percent"),
        jitter_ms:avg("jitter_ms"),latency_ms:avg("latency_ms"),
        dtmf_errors:items.reduce((a,x)=>a+Number(x.quality.dtmf_errors||0),0),
        affected_samples:items.filter(x=>Number(x.quality.packet_loss_percent||0)>=5||Number(x.quality.jitter_ms||0)>5||Number(x.quality.latency_ms||0)>150).length,
        low_mos_samples:items.filter(x=>Number(x.quality.mos||0)<3.5).length
      };
    }).sort((a,b)=>Date.parse(a.bucket)-Date.parse(b.bucket));
    const connected=rows.filter(x=>x.call_status==="connected"),abandoned=rows.filter(x=>x.call_status==="abandoned");
    const avg=(items,fn)=>items.length?items.reduce((a,x)=>a+Number(fn(x)||0),0)/items.length:0;
    const ivrRows=rows.filter(x=>x.ivr_started_at&&x.queued_at),queueRows=rows.filter(x=>x.queued_at);
    const waitBucket=x=>x.wait_seconds<=10?"wait_le_10s":x.wait_seconds<=20?"wait_10_20s":x.wait_seconds<=30?"wait_20_30s":x.wait_seconds<=60?"wait_30_60s":x.wait_seconds<=120?"wait_60_120s":"wait_gt_120s";
    const experience={
      samples:rows.length,connected:connected.length,abandoned:abandoned.length,
      avg_wait_seconds:avg(rows,x=>x.wait_seconds),avg_answered_wait_seconds:avg(connected,x=>x.wait_seconds),
      avg_abandoned_wait_seconds:avg(abandoned,x=>x.wait_seconds),
      answered_le_20s_percent:connected.length?connected.filter(x=>x.wait_seconds<=20).length/connected.length*100:0,
      abandoned_le_10s_percent:abandoned.length?abandoned.filter(x=>x.wait_seconds<=10).length/abandoned.length*100:0,
      avg_ivr_seconds:avg(ivrRows,x=>(Date.parse(x.queued_at)-Date.parse(x.ivr_started_at))/1000),
      avg_queue_seconds:avg(queueRows,x=>(Date.parse(x.bridged_at||x.ended_at)-Date.parse(x.queued_at))/1000),
      wait_le_10s:0,wait_10_20s:0,wait_20_30s:0,wait_30_60s:0,wait_60_120s:0,wait_gt_120s:0
    };
    rows.forEach(x=>{experience[waitBucket(x)]++;});
    const experienceSeries=[...group(rows,bucketKey)].map(([bucket,items])=>{
      const con=items.filter(x=>x.call_status==="connected"),abd=items.filter(x=>x.call_status==="abandoned"),q=items.filter(x=>x.queued_at);
      return {
        bucket,samples:items.length,avg_wait_seconds:avg(items,x=>x.wait_seconds),
        answered_le_20s_percent:con.length?con.filter(x=>x.wait_seconds<=20).length/con.length*100:0,
        abandoned_le_10s_percent:abd.length?abd.filter(x=>x.wait_seconds<=10).length/abd.length*100:0,
        avg_queue_seconds:avg(q,x=>(Date.parse(x.bridged_at||x.ended_at)-Date.parse(x.queued_at))/1000)
      };
    }).sort((a,b)=>Date.parse(a.bucket)-Date.parse(b.bucket));
    return {granularity,series,hours,weekdays,heatmap,quality,quality_series:qualitySeries,experience,experience_series:experienceSeries,experts:expertsRows.slice(0,50),carriers:carriersRows.slice(0,50),durations};
  }

  async voiceIntelligence(from,to,market=null){
    void market;
    const rows=this.#range(from,to);
    const summarize=items=>{
      const quality=items.filter(x=>x.quality);
      const count=(fn)=>items.filter(fn).length;
      const qavg=key=>quality.length?quality.reduce((a,x)=>a+Number(x.quality?.[key]||0),0)/quality.length:null;
      const pdd=items.filter(x=>Number.isFinite(Number(x.post_dial_delay_ms)));
      return {
        calls_total:items.length,calls_connected:count(x=>x.call_status==="connected"),
        calls_failed:count(x=>!["connected","abandoned"].includes(x.call_status)),
        pdd_samples:pdd.length,avg_pdd_ms:pdd.length?pdd.reduce((a,x)=>a+Number(x.post_dial_delay_ms||0),0)/pdd.length:null,
        high_pdd_calls:pdd.filter(x=>Number(x.post_dial_delay_ms)>8000).length,
        quality_samples:quality.length,
        network_affected_calls:quality.filter(x=>Number(x.quality?.packet_loss_percent||0)>=5||Number(x.quality?.jitter_ms||0)>5||Number(x.quality?.latency_ms||0)>150).length,
        low_mos_calls:quality.filter(x=>Number(x.quality?.mos||0)<3.5).length,
        mos:qavg("mos"),packet_loss_percent:qavg("packet_loss_percent"),jitter_ms:qavg("jitter_ms"),latency_ms:qavg("latency_ms"),rtt_ms:qavg("rtt_ms"),
        sip_4xx_calls:count(x=>Number(x.sip_final_code)>=400&&Number(x.sip_final_code)<500),
        sip_5xx_calls:count(x=>Number(x.sip_final_code)>=500&&Number(x.sip_final_code)<600),
        caller_hangups:count(x=>x.hangup_party==="caller"),callee_hangups:count(x=>x.hangup_party==="callee"),network_hangups:count(x=>x.hangup_party==="network")
      };
    };
    const group=(role)=>{
      const map=new Map();
      for(const x of rows){
        const carrier=role==="host"?(x.host_carrier||"Unknown"):(x.origin_carrier||"Unknown");
        if(!map.has(carrier))map.set(carrier,[]);
        map.get(carrier).push(x);
      }
      return [...map].map(([carrier,items],i)=>({carrier_role:role,carrier_id:i+1,carrier,...summarize(items)})).sort((a,b)=>b.calls_total-a.calls_total);
    };
    const sip=new Map();
    for(const x of rows){const code=Number(x.sip_final_code);if(code>=100&&code<=699)sip.set(code,(sip.get(code)||0)+1);}
    return {
      summary:summarize(rows),
      carriers:group("host").concat(group("origin")),
      sip_codes:[...sip].map(([sip_final_code,calls_total])=>({sip_final_code,calls_total})).sort((a,b)=>b.calls_total-a.calls_total).slice(0,20),
      incidents:[]
    };
  }

  async scanVoiceIncidents(){return [];}

  async listCalls(params={}){
    const limit=clampInt(params.limit,100,1,250);
    const offset=decodeCursor(params.cursor);
    let rows=this.calls.slice();
    if(params.from)rows=rows.filter(x=>Date.parse(x.started_at)>=Date.parse(params.from));
    if(params.to)rows=rows.filter(x=>Date.parse(x.started_at)<=Date.parse(params.to));
    if(params.expert_id)rows=rows.filter(x=>String(x.expert_id)===String(params.expert_id));
    if(params.origin_carrier)rows=rows.filter(x=>x.origin_carrier===params.origin_carrier);
    if(params.status)rows=rows.filter(x=>x.call_status===params.status);
    const page=rows.slice(offset,offset+limit);
    return {
      data:page.map(x=>({...x})),
      next_cursor:offset+limit<rows.length?encodeCursor(offset+limit):null,
      total:rows.length
    };
  }

  async listExperts(){
    return this.experts.map(x=>({...x}));
  }

  async setExpertStatus(id,status){
    if(!["available","busy","away","offline"].includes(status))throw problem(400,"INVALID_STATUS");
    const expert=this.experts.find(x=>String(x.id)===String(id));
    if(!expert)throw problem(404,"EXPERT_NOT_FOUND");
    expert.status=status;
    this.#audit("expert.status",String(id),{status});
    this.eventBus.publish("expert.status",{id:expert.id,status});
    return {...expert};
  }

  async selectCallDestination(context={}){
    const active=this.callDestinations.filter(x=>x.status==="active"&&(!x.max_concurrent_calls||x.active_calls<x.max_concurrent_calls)).sort((a,b)=>a.priority-b.priority||a.active_calls-b.active_calls||a.id-b.id)[0];
    if(active){active.active_calls++;active.last_assigned_at=new Date().toISOString();return {...active,route_kind:"destination",call_destination_id:active.id,expert_id:null};}
    const expert=await this.selectExpert(context);return expert?{...expert,route_kind:"expert",call_destination_id:null,expert_id:expert.id,label:expert.display_name}:null;
  }
  async startLiveCallFinancial(payload={}){
    const externalCallId=String(payload.external_call_id||"").trim();
    if(!externalCallId||externalCallId.length>240)throw problem(400,"INVALID_EXTERNAL_CALL_ID");
    const at=String(payload.billable_started_at||payload.started_at||new Date().toISOString());
    if(!Number.isFinite(Date.parse(at)))throw problem(400,"INVALID_LIVE_CALL_START");
    let row=this.liveFinancialSessions.find(x=>x.external_call_id===externalCallId);
    if(!row){
      const upstream=Math.max(0,Number(this.config.payoutRateHtPerMin||0));
      const feeRate=upstream*.10;
      row={
        id:this.liveFinancialSessions.length+1,external_call_id:externalCallId,tenant_id:1,market_id:null,
        sva_number_id:1,currency:"EUR",billable_started_at:new Date(at).toISOString(),ended_at:null,status:"active",
        origin_type:["fixed","mobile"].includes(String(payload.origin_type||""))?String(payload.origin_type):"unknown",
        service_rate_ttc_per_min:Number(this.config.serviceRateTtcPerMin||0),
        upstream_payout_rate_ht_per_min:upstream,platform_fee_bps:1000,platform_fee_ht_per_min:0,
        net_client_rate_ht_per_min:upstream-feeRate,payout_terms_id:1
      };
      this.liveFinancialSessions.push(row);
      this.eventBus.publish("live_call.started",{id:row.id,tenant_id:row.tenant_id,currency:row.currency});
    }
    return structuredClone(row);
  }

  async stopLiveCallFinancial(externalCallId,status="ended",endedAt=null){
    const id=String(externalCallId||"").trim();
    if(!id)throw problem(400,"INVALID_EXTERNAL_CALL_ID");
    const row=this.liveFinancialSessions.find(x=>x.external_call_id===id);
    if(!row||row.status!=="active")return {external_call_id:id,status:status==="cancelled"?"cancelled":"ended",already_closed:true};
    row.status=status==="cancelled"?"cancelled":"ended";row.ended_at=new Date(endedAt||Date.now()).toISOString();
    this.eventBus.publish("live_call.ended",{id:row.id,tenant_id:row.tenant_id,currency:row.currency,status:row.status});
    return structuredClone(row);
  }

  async releaseCallDestination(id){const row=this.callDestinations.find(x=>x.id===Number(id));if(!row)throw problem(404,"CALL_DESTINATION_NOT_FOUND");row.active_calls=Math.max(0,Number(row.active_calls||0)-1);return {...row};}

  async selectExpert(context={}){
    void context;
    const expert=selectExpert(this.experts);
    if(!expert)return null;
    expert.last_assigned_at=new Date().toISOString();
    expert.active_calls=Number(expert.active_calls||0)+1;
    expert.status="busy";
    this.eventBus.publish("expert.busy",{id:expert.id,active_calls:expert.active_calls});
    return {...expert};
  }

  async releaseExpert(id){
    const expert=this.experts.find(x=>String(x.id)===String(id));
    if(!expert)throw problem(404,"EXPERT_NOT_FOUND");
    expert.active_calls=Math.max(0,Number(expert.active_calls||0)-1);
    if(expert.active_calls===0&&expert.status==="busy")expert.status="available";
    this.eventBus.publish("expert.released",{id:expert.id,status:expert.status,active_calls:expert.active_calls});
    return {...expert};
  }

  async ingestCdr(envelope){
    validateEnvelope(envelope);
    const key=envelope.source+":"+envelope.source_event_id;
    if(this.rawEventKeys.has(key))return {duplicate:true};
    this.rawEventKeys.add(key);

    const p=sanitizeCdrPayload(envelope.payload||{});
    if(!p.external_call_id||!p.started_at||!p.ended_at)throw problem(400,"CDR_REQUIRED_FIELDS_MISSING");
    if(this.calls.some(x=>x.external_call_id===p.external_call_id))return {duplicate:true};

    const status=p.call_status||"connected";
    const conversation=Math.max(0,Number(p.conversation_seconds||0));
    const originType=p.origin_type||"unknown";
    const financial=status==="connected"?core.computeCallFinancials(
      {conversationSeconds:conversation,originType},
      {
        serviceRateTtcPerMin:this.config.serviceRateTtcPerMin,
        payoutRateHtPerMin:this.config.payoutRateHtPerMin,
        mobileDeductionHtPerMin:Number(p.mobile_deduction_ht_per_min||0),
        billingIncrementSeconds:Number(p.billing_increment_seconds||60),
        minimumPayableSeconds:Number(p.minimum_payable_seconds||0),
        rounding:p.payout_rounding||"ceil"
      }
    ):{billableSeconds:0,payoutEligibleSeconds:0,serviceAmountTtc:0,expectedPayoutHt:0};

    const hasConfirmed=p.confirmed_payout_ht!=null;
    const confirmed=hasConfirmed?Number(p.confirmed_payout_ht):null;
    const paid=p.paid_payout_ht==null?0:Number(p.paid_payout_ht);
    const reconciliation=hasConfirmed?core.reconcileAmounts(financial.expectedPayoutHt,confirmed,this.config.reconciliationToleranceHt):null;
    const call={
      id:this.nextCallId++,
      external_call_id:String(p.external_call_id),
      source:envelope.source,
      started_at:new Date(p.started_at).toISOString(),
      ivr_started_at:p.ivr_started_at?new Date(p.ivr_started_at).toISOString():null,
      queued_at:p.queued_at?new Date(p.queued_at).toISOString():null,
      ringing_at:p.ringing_at?new Date(p.ringing_at).toISOString():null,
      bridged_at:p.bridged_at?new Date(p.bridged_at).toISOString():null,
      ended_at:new Date(p.ended_at).toISOString(),
      post_dial_delay_ms:p.post_dial_delay_ms==null?null:Number(p.post_dial_delay_ms),
      caller_masked:String(p.caller_masked||"Masqué"),
      caller_hash:deriveCallerHash(p,{key:this.config.callerHashKey,source:envelope.source,sourceEventId:envelope.source_event_id}),
      origin_carrier:String(p.origin_carrier||"Unknown"),
      origin_type:originType,
      host_carrier:String(p.host_carrier||this.route.active_carrier||"Unknown"),
      sva_number:String(p.sva_number||"Unknown"),
      expert_id:p.expert_id==null?null:Number(p.expert_id),
      expert_name:String(p.expert_name||""),
      call_destination_id:p.call_destination_id==null?null:Number(p.call_destination_id),
      call_destination_label:String(p.destination_label||""),
      wait_seconds:Math.max(0,Number(p.wait_seconds||0)),
      conversation_seconds:conversation,
      total_seconds:Math.max(0,Number(p.total_seconds||Math.round((Date.parse(p.ended_at)-Date.parse(p.started_at))/1000))),
      billable_seconds:financial.billableSeconds,
      payout_eligible_seconds:financial.payoutEligibleSeconds,
      call_status:status,
      sip_final_code:p.sip_final_code==null?null:Number(p.sip_final_code),
      hangup_cause:String(p.hangup_cause||""),
      hangup_party:p.hangup_party||"unknown",
      codec:String(p.codec||""),
      service_rate_ttc_per_min:this.config.serviceRateTtcPerMin,
      carrier_rate_ht_per_min:this.config.payoutRateHtPerMin,
      retail_service_amount_ttc:financial.serviceAmountTtc,
      expected_payout_ht:financial.expectedPayoutHt,
      confirmed_payout_ht:confirmed,
      paid_payout_ht:paid,
      expert_cost_ht:(financial.billableSeconds/60)*this.config.expertCostHtPerMin,
      technical_cost_ht:Number(this.config.technicalCostHtPerCall||0),
      estimated_margin_ht:Math.max(0,(confirmed||0)-(financial.billableSeconds/60)*this.config.expertCostHtPerMin-Number(this.config.technicalCostHtPerCall||0)),
      reconciliation_variance_ht:reconciliation?reconciliation.varianceHt:0,
      reconciliation_status:reconciliation?reconciliation.status:"pending",
      quality:p.quality||null
    };
    this.calls.unshift(call);
    const live=this.liveFinancialSessions.find(x=>x.external_call_id===call.external_call_id&&x.status==="active");
    if(live){
      live.status="ended";live.ended_at=call.ended_at;
      this.eventBus.publish("live_call.ended",{id:live.id,external_call_id:call.external_call_id,tenant_id:live.tenant_id,market_id:live.market_id,currency:live.currency,status:"ended",source:"cdr"});
    }
    this.#outbox("call.ingested","call",String(call.id),{external_call_id:call.external_call_id});
    this.#audit("cdr.ingest",String(call.id),{source:envelope.source});
    this.eventBus.publish("call.ingested",{id:call.id,status:call.call_status,tenant_id:live?.tenant_id||1,market_id:live?.market_id||null,currency:live?.currency||"EUR"});
    return {duplicate:false,call:{...call}};
  }

  async reconciliation(from,to,market=null){
    void market;
    const rows=this.#range(from,to);
    const groups=new Map();
    for(const c of rows){
      const key=c.host_carrier||"Unknown";
      if(!groups.has(key))groups.set(key,{carrier:key,calls:0,expected_payout_ht:0,confirmed_payout_ht:0,paid_payout_ht:0,variance_ht:0,variance_calls:0});
      const g=groups.get(key);
      g.calls++;
      g.expected_payout_ht+=c.expected_payout_ht;
      g.confirmed_payout_ht+=c.confirmed_payout_ht;
      g.paid_payout_ht+=c.paid_payout_ht;
      g.variance_ht+=c.reconciliation_variance_ht;
      if(c.reconciliation_status==="variance")g.variance_calls++;
    }
    return [...groups.values()].map(roundFinance);
  }

  async effectiveMetricRanges(from,to,tenantId=null){
    const fromMs=Date.parse(from),toMs=Date.parse(to);
    if(!Number.isFinite(fromMs)||!Number.isFinite(toMs))throw problem(400,"INVALID_RANGE");
    const keys=["calls","minutes","revenue","payout","quality"];
    const scope="global",id=tenantId==null?null:Number(tenantId);
    const rows=this.baselines.filter(x=>x.scope===scope&&(id==null?x.tenant_id==null:Number(x.tenant_id)===id))
      .slice().sort((a,b)=>Date.parse(b.effective_from||b.created_at)-Date.parse(a.effective_from||a.created_at));
    const latest={};
    for(const row of rows){const key=row.metric_key||"all";if(latest[key]==null)latest[key]=new Date(row.effective_from||row.created_at);}
    const all=latest.all||null,result={};
    for(const key of keys){
      const own=latest[key]||null,baseline=!all?own:!own?all:(all.getTime()>own.getTime()?all:own);
      const effectiveFrom=baseline&&baseline.getTime()>fromMs?baseline:new Date(fromMs);
      result[key]={from:effectiveFrom.toISOString(),to:new Date(toMs).toISOString(),baseline:baseline?baseline.toISOString():null,reset_applied:Boolean(baseline&&baseline.getTime()>fromMs),empty:effectiveFrom.getTime()>toMs};
    }
    return result;
  }

  async effectiveMetricRange(from,to,options={}){
    const ranges=await this.effectiveMetricRanges(from,to,options?.tenant_id??null);
    return ranges[String(options?.metric_key||"calls")]||ranges.calls;
  }

  async listBaselines(params={}){
    const scope=params.scope||"global";
    const limit=clampInt(params.limit,20,1,100),tenantId=params.tenant_id==null?null:Number(params.tenant_id);
    return this.baselines
      .filter(x=>x.scope===scope&&(tenantId==null||Number(x.tenant_id)===tenantId))
      .slice()
      .sort((a,b)=>Date.parse(b.effective_from||b.created_at)-Date.parse(a.effective_from||a.created_at))
      .slice(0,limit)
      .map(x=>({...x,metric_key:x.metric_key||"all"}));
  }

  async createBaseline(payload,actor){
    if(!["global","expert","sva_number"].includes(payload.scope))throw problem(400,"INVALID_SCOPE");
    const metricKey=String(payload.metric_key||"all");
    if(!["all","calls","minutes","revenue","payout","quality"].includes(metricKey))throw problem(400,"INVALID_METRIC_KEY");
    const tenantId=payload.tenant_id==null?null:Number(payload.tenant_id);
        const now=new Date().toISOString();
    const row={id:this.nextBaselineId++,tenant_id:tenantId,scope:payload.scope,scope_id:payload.scope_id??null,metric_key:metricKey,reason:String(payload.reason||""),created_at:now,effective_from:now,created_by:actor?.sub||null};
    this.baselines.push(row);
    this.#audit("baseline.create",String(row.id),row);
    this.eventBus.publish("baseline.created",{id:row.id,scope:row.scope,tenant_id:row.tenant_id,metric_key:row.metric_key});
    return {...row};
  }


  async createCustomerJackpotReset(tenantId,customerPrincipalId){
    const id=Number(tenantId),now=new Date().toISOString(),row={id:this.nextBaselineId++,tenant_id:id,scope:"global",scope_id:null,metric_key:"jackpot",reason:"Remise à zéro du jackpot personnel",created_at:now,effective_from:now,created_by:null,created_by_customer_principal_id:customerPrincipalId||null};
    this.baselines.push(row);this.#audit("customer.jackpot.reset",String(row.id),{tenant_id:id,accounting_impact:"none"});this.eventBus.publish("customer.jackpot.reset",{tenant_id:id,reset_at:now});return {jackpot_reset_at:now,accounting_impact:"none"};
  }

  async createCustomerMetricReset(tenantId,metricKeys,customerPrincipalId){
    const allowed=["calls","minutes","revenue","payout","quality"],id=Number(tenantId);
    let keys=Array.isArray(metricKeys)?metricKeys.map(String):[];
    if(keys.includes("all"))keys=allowed.slice();
    keys=[...new Set(keys)];
    if(!keys.length||keys.some(x=>!allowed.includes(x)))throw problem(400,"INVALID_METRIC_SELECTION");
    const now=new Date().toISOString(),rows=keys.map(key=>({id:this.nextBaselineId++,tenant_id:id,scope:"global",scope_id:null,metric_key:key,reason:"Remise à zéro depuis l’espace client",created_at:now,effective_from:now,created_by:null,created_by_customer_principal_id:customerPrincipalId||null}));
    this.baselines.push(...rows);
    this.#audit("customer.metrics.reset",String(rows[0].id),{tenant_id:id,metric_keys:keys});
    this.eventBus.publish("customer.metrics.reset",{tenant_id:id,metric_keys:keys});
    return {data:structuredClone(rows),metric_keys:keys,effective_from:now};
  }

  async carrierRouting(){
    return {...this.route};
  }

  async carrierAdminOverview(){
    return {route:{...this.route},targets:[],recent_switches:this.switches.slice(-20).reverse().map(x=>({...x}))};
  }

  async planCarrierSwitch(payload,actor){
    if(!payload.to_carrier_id)throw problem(400,"TO_CARRIER_REQUIRED");
    const requester=String(actor?.sub||"admin");
    const sw={
      id:this.nextSwitchId++,route_key:payload.route_key||"sva-primary",
      from_carrier:this.route.active_carrier,to_carrier:String(payload.to_carrier_id),
      connection_id:payload.connection_id??null,status:"ready",
      requested_at:new Date().toISOString(),requested_by:requester,
      scheduled_for:payload.scheduled_for||null,
      rollback_window_minutes:clampInt(payload.rollback_window_minutes,1440,5,10080)
    };
    this.switches.push(sw);
    const approvalPayload={route_key:sw.route_key,to_carrier:sw.to_carrier,connection_id:sw.connection_id,rollback_window_minutes:sw.rollback_window_minutes,scheduled_for:sw.scheduled_for};
    const cr={
      id:this.nextChangeRequestId++,public_id:randomUUID(),change_type:"carrier_switch_activation",entity_type:"carrier_switch",entity_id:String(sw.id),
      risk_level:"critical",status:"pending",payload_sha256:createHash("sha256").update(JSON.stringify(approvalPayload)).digest("hex"),
      request_reason:String(payload.notes||"Bascule opérateur"),requested_by:requester,requested_by_name:requester,requested_at:new Date().toISOString(),
      expires_at:new Date(Date.now()+86400000).toISOString(),approved_by:null,approved_by_name:null,approved_at:null,decision_reason:null
    };
    this.changeRequests.push(cr);
    this.#audit("carrier_switch.plan",String(sw.id),{...sw,change_request_id:cr.id,dual_control_required:true});
    return {...sw,change_request_id:cr.id,change_request_public_id:cr.public_id,change_request_status:cr.status,change_request_expires_at:cr.expires_at};
  }

  async ensureLegacyStaffIdentity(loginName){
    const login=String(loginName||"local-admin").trim();
    let row=this.staffUsers.find(x=>x.login_name.toLowerCase()===login.toLowerCase());
    if(!row){
      row={id:this.nextStaffUserId++,public_id:randomUUID(),login_name:login,email:"legacy-"+this.nextStaffUserId+"@staff.pgi.invalid",display_name:"Administrator",role:"admin",enabled:true,password_hash:null,session_version:1,last_login_at:null,created_at:new Date().toISOString()};
      this.staffUsers.push(row);
    }
    return structuredClone(row);
  }

  async staffLoginIdentity(loginName){
    const row=this.staffUsers.find(x=>x.enabled&&x.password_hash&&x.login_name.toLowerCase()===String(loginName||"").trim().toLowerCase());
    return row?structuredClone(row):null;
  }

  async recordStaffAuthFailure(){return;}
  async recordStaffAuthSuccess(id){const row=this.staffUsers.find(x=>Number(x.id)===Number(id));if(row)row.last_login_at=new Date().toISOString();}

  async listStaffUsers(){
    return this.staffUsers.map(({password_hash,...x})=>({...structuredClone(x),password_login_enabled:Boolean(password_hash),password_changed_at:null,locked_until:null}));
  }

  async staffCredentialById(appUserId){const id=Number(appUserId);const u=this.staffUsers?.find?.(x=>Number(x.id)===id);return u?.password_hash?structuredClone(u):null;}
  async createStaffUser(input={},passwordHash,actor={}){
    const login=String(input.login_name||"").trim(),email=String(input.email||"").trim().toLowerCase(),display=String(input.display_name||"").trim(),role=String(input.role||"readonly").trim().toLowerCase();
    if(login.length<3||login.length>120||!/^[A-Za-z0-9._@+-]+$/.test(login))throw problem(400,"INVALID_STAFF_LOGIN");
    if(display.length<2||display.length>120)throw problem(400,"INVALID_STAFF_DISPLAY_NAME");
    if(email.length<5||!email.includes("@"))throw problem(400,"INVALID_STAFF_EMAIL");
    if(!["admin","finance","readonly"].includes(role))throw problem(400,"INVALID_STAFF_ROLE");
    if(this.staffUsers.some(x=>x.login_name.toLowerCase()===login.toLowerCase()||x.email===email))throw problem(409,"STAFF_LOGIN_OR_EMAIL_EXISTS");
    const row={id:this.nextStaffUserId++,public_id:randomUUID(),login_name:login,email,display_name:display,role,enabled:true,password_hash:passwordHash,session_version:1,last_login_at:null,created_at:new Date().toISOString()};
    this.staffUsers.push(row);this.#audit("staff_user.create",String(row.id),{login_name:login,email,role,created_by:actor?.sub||null});
    const {password_hash,...safe}=row;return structuredClone(safe);
  }

  async listPlatformChangeRequests(params={}){
    const status=String(params.status||"active"),limit=clampInt(params.limit,30,1,100),now=Date.now();
    let rows=this.changeRequests.slice();
    if(status==="pending")rows=rows.filter(x=>x.status==="pending"&&Date.parse(x.expires_at)>now);
    else if(status==="approved")rows=rows.filter(x=>x.status==="approved"&&Date.parse(x.expires_at)>now);
    else if(status!=="history")rows=rows.filter(x=>["pending","approved"].includes(x.status)&&Date.parse(x.expires_at)>now);
    return {data:rows.slice(-limit).reverse().map(x=>structuredClone(x)),dual_control:true};
  }

  async approvePlatformChangeRequest(id,actor={},input={}){
    const row=this.changeRequests.find(x=>String(x.id)===String(id));
    if(!row)throw problem(404,"CHANGE_REQUEST_NOT_FOUND");
    if(row.status!=="pending")throw problem(409,"CHANGE_REQUEST_NOT_PENDING");
    if(Date.now()>=Date.parse(row.expires_at))throw problem(409,"CHANGE_REQUEST_EXPIRED");
    const approver=String(actor?.sub||"admin-2");
    if(approver===String(row.requested_by))throw problem(409,"FOUR_EYES_SECOND_APPROVER_REQUIRED");
    row.status="approved";row.approved_by=approver;row.approved_by_name=approver;row.approved_at=new Date().toISOString();row.decision_reason=String(input.reason||"").slice(0,500)||null;
    this.#audit("platform_change.approve",String(row.id),{change_type:row.change_type,target_id:row.entity_id});
    return structuredClone(row);
  }

  async rejectPlatformChangeRequest(id,actor={},input={}){
    const row=this.changeRequests.find(x=>String(x.id)===String(id));
    if(!row)throw problem(404,"CHANGE_REQUEST_NOT_FOUND");
    if(row.status!=="pending")throw problem(409,"CHANGE_REQUEST_NOT_PENDING");
    const rejector=String(actor?.sub||"admin-2"),reason=String(input.reason||"").trim();
    if(rejector===String(row.requested_by))throw problem(409,"FOUR_EYES_SECOND_APPROVER_REQUIRED");
    if(!reason)throw problem(400,"CHANGE_REJECTION_REASON_REQUIRED");
    row.status="rejected";row.rejected_by=rejector;row.rejected_at=new Date().toISOString();row.decision_reason=reason.slice(0,500);
    this.#audit("platform_change.reject",String(row.id),{change_type:row.change_type,target_id:row.entity_id,reason:row.decision_reason});
    return structuredClone(row);
  }

  async activateCarrierSwitch(id,actor={}){
    const sw=this.switches.find(x=>String(x.id)===String(id));
    if(!sw)throw problem(404,"SWITCH_NOT_FOUND");
    if(!["ready","planned"].includes(sw.status))throw problem(409,"SWITCH_NOT_READY");
    const approval=this.changeRequests.slice().reverse().find(x=>x.change_type==="carrier_switch_activation"&&x.entity_id===String(sw.id)&&x.status==="approved"&&Date.parse(x.expires_at)>Date.now());
    if(!approval)throw problem(409,"DUAL_CONTROL_APPROVAL_REQUIRED");
    const previous=this.route.active_carrier;
    this.route.standby_carrier=previous;this.route.active_carrier=sw.to_carrier;this.route.generation++;this.route.updated_at=new Date().toISOString();
    sw.status="completed";sw.completed_at=new Date().toISOString();sw.rollback_deadline=new Date(Date.now()+sw.rollback_window_minutes*60000).toISOString();
    approval.status="executed";approval.executed_at=new Date().toISOString();
    this.#audit("carrier_switch.activate",String(sw.id),{from:previous,to:sw.to_carrier,change_request_id:approval.id,approved_by:approval.approved_by,executed_by:actor?.sub||null});
    this.eventBus.publish("carrier.switched",{from:previous,to:sw.to_carrier,generation:this.route.generation});
    return {switch:{...sw},route:{...this.route},change_request_id:approval.id};
  }

  async rollbackCarrierSwitch(id){
    const sw=this.switches.find(x=>String(x.id)===String(id));
    if(!sw)throw problem(404,"SWITCH_NOT_FOUND");
    if(sw.status!=="completed")throw problem(409,"SWITCH_NOT_COMPLETED");
    if(sw.rollback_deadline&&Date.now()>Date.parse(sw.rollback_deadline))throw problem(409,"ROLLBACK_WINDOW_EXPIRED");
    const current=this.route.active_carrier;this.route.active_carrier=this.route.standby_carrier;this.route.standby_carrier=current;this.route.generation++;this.route.updated_at=new Date().toISOString();
    sw.status="rolled_back";this.#audit("carrier_switch.rollback",String(sw.id),{active:this.route.active_carrier});
    this.eventBus.publish("carrier.rollback",{active:this.route.active_carrier,generation:this.route.generation});
    return {switch:{...sw},route:{...this.route}};
  }

  async idempotent(key,operation,requestBody,fn){
    if(!key)throw problem(400,"IDEMPOTENCY_KEY_REQUIRED");
    const requestHash=createHash("sha256").update(JSON.stringify(requestBody??null)).digest("hex");
    const existing=this.idempotency.get(key);
    if(existing){
      if(existing.operation!==operation||existing.requestHash!==requestHash)throw problem(409,"IDEMPOTENCY_KEY_REUSED");
      return {replayed:true,value:structuredClone(existing.value)};
    }
    const value=await fn();
    this.idempotency.set(key,{operation,requestHash,value:structuredClone(value),createdAt:Date.now()});
    return {replayed:false,value};
  }

  async withTenantContext(tenantId,fn){
    const id=Number(tenantId);
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_CONTEXT");
    if(typeof fn!=="function")throw problem(500,"TENANT_CONTEXT_HANDLER_REQUIRED");
    return fn(this);
  }

  async acquireWorkerLease(){
    return true;
  }

  async releaseWorkerLease(){
    return true;
  }

  async drainOutbox(handler,limit=100){
    const pending=this.outbox.filter(x=>!x.published_at).slice(0,limit);
    let published=0;
    for(const event of pending){
      try{
        await handler({...event});
        event.published_at=new Date().toISOString();
        event.attempts++;
        event.last_error=null;
        published++;
      }catch(err){
        event.attempts++;
        event.last_error=String(err?.message||"handler failed").slice(0,200);
      }
    }
    return {processed:pending.length,published,pending:this.outbox.filter(x=>!x.published_at).length};
  }

  async enqueueWork(queueName,payload={},options={}){
    const now=new Date().toISOString();
    const dedupe=options.dedupe_key?String(options.dedupe_key):null;
    if(dedupe){
      const existing=this.workQueue.find(x=>x.queue_name===queueName&&x.dedupe_key===dedupe&&!x.completed_at&&!x.failed_at);
      if(existing)return structuredClone(existing);
    }
    const row={
      id:this.workQueue.length+1,queue_name:String(queueName),tenant_id:options.tenant_id??null,
      dedupe_key:dedupe,priority:Number(options.priority||100),payload:structuredClone(payload||{}),
      available_at:options.available_at||now,locked_at:null,locked_by:null,lease_expires_at:null,
      attempts:0,max_attempts:Number(options.max_attempts||10),correlation_id:randomUUID(),
      trace_id:options.trace_id||null,completed_at:null,failed_at:null,dead_lettered_at:null,last_error:null,created_at:now
    };
    this.workQueue.push(row);
    return structuredClone(row);
  }

  async claimWork(queueName,workerId,limit=25,leaseSeconds=60){
    const now=Date.now(),ttl=Math.max(15,Math.min(900,Number(leaseSeconds)||60))*1000;
    const ready=this.workQueue
      .filter(x=>x.queue_name===String(queueName)&&!x.completed_at&&!x.failed_at&&!x.dead_lettered_at&&Date.parse(x.available_at)<=now&&(!x.locked_at||!x.lease_expires_at||Date.parse(x.lease_expires_at)<=now))
      .sort((a,b)=>a.priority-b.priority||Date.parse(a.available_at)-Date.parse(b.available_at)||a.id-b.id)
      .slice(0,Math.max(1,Math.min(100,Number(limit)||25)));
    for(const row of ready){
      row.locked_at=new Date(now).toISOString();
      row.locked_by=String(workerId);
      row.lease_expires_at=new Date(now+ttl).toISOString();
      row.attempts++;
    }
    return structuredClone(ready);
  }

  async extendWorkLease(id,workerId,leaseSeconds=60){
    const row=this.workQueue.find(x=>x.id===Number(id)&&x.locked_by===String(workerId)&&!x.completed_at&&!x.failed_at&&!x.dead_lettered_at);
    if(!row)throw problem(409,"WORK_LEASE_LOST");
    const ttl=Math.max(15,Math.min(900,Number(leaseSeconds)||60))*1000;
    row.lease_expires_at=new Date(Date.now()+ttl).toISOString();
    return {id:row.id,lease_expires_at:row.lease_expires_at};
  }

  async completeWork(id,workerId){
    const row=this.workQueue.find(x=>x.id===Number(id)&&x.locked_by===String(workerId)&&!x.completed_at&&!x.failed_at&&!x.dead_lettered_at);
    if(!row)throw problem(409,"WORK_LEASE_LOST");
    row.completed_at=new Date().toISOString();
    row.locked_at=null;row.locked_by=null;row.lease_expires_at=null;row.last_error=null;
    return structuredClone(row);
  }

  async failWork(id,workerId,errorMessage,retryDelaySeconds=30){
    const row=this.workQueue.find(x=>x.id===Number(id)&&x.locked_by===String(workerId)&&!x.completed_at&&!x.failed_at&&!x.dead_lettered_at);
    if(!row)throw problem(409,"WORK_LEASE_LOST");
    row.last_error=String(errorMessage||"worker failed").slice(0,1000);
    if(row.attempts>=row.max_attempts){
      row.failed_at=new Date().toISOString();
      row.dead_lettered_at=row.failed_at;
      row.locked_at=null;row.locked_by=null;row.lease_expires_at=null;
      return {id:row.id,state:"dead_lettered",attempts:row.attempts};
    }
    const delay=Math.min(3600,Math.max(1,Number(retryDelaySeconds)||30)*Math.pow(2,Math.max(0,row.attempts-1)));
    row.available_at=new Date(Date.now()+delay*1000).toISOString();
    row.locked_at=null;row.locked_by=null;row.lease_expires_at=null;
    return {id:row.id,state:"retry",attempts:row.attempts,retry_in_seconds:Math.round(delay)};
  }

  async scanOutboundPortabilityAutomation(){return [];}
  async workQueueHealth(){
    const pending=this.workQueue.filter(x=>!x.completed_at&&!x.failed_at&&!x.dead_lettered_at);
    const oldest=pending.length?Math.max(0,(Date.now()-Math.min(...pending.map(x=>Date.parse(x.created_at))))/1000):0;
    return {
      pending:pending.length,
      leased:pending.filter(x=>x.locked_at).length,
      dead_lettered:this.workQueue.filter(x=>x.dead_lettered_at).length,
      oldest_pending_seconds:oldest
    };
  }

  async subscriptionBillingOverview(){
    const current=this.subscriptionPrices.filter(x=>!x.effective_to||Date.parse(x.effective_to)>Date.now()).sort((a,b)=>Date.parse(b.effective_from)-Date.parse(a.effective_from))[0]||null;
    return {
      plan_key:"external-sva-access",billing_model:"subscription",cadence:"monthly",internal_usage_exempt:true,
      current_price:current,
      summary:{external_tenants:0,access_enabled:0,access_blocked:0,internal_exempt:1,active_subscriptions:0},
      price_history:this.subscriptionPrices.slice().sort((a,b)=>Date.parse(b.effective_from)-Date.parse(a.effective_from)),
      tenant_access:[]
    };
  }

  async createSubscriptionPrice(payload={}){
    const amount=Number(payload.amount_minor);
    if(!Number.isInteger(amount)||amount<=0)throw problem(400,"INVALID_SUBSCRIPTION_PRICE");
    const currency=String(payload.currency||"EUR").trim().toUpperCase();
    if(!/^[A-Z]{3}$/.test(currency))throw problem(400,"INVALID_SUBSCRIPTION_CURRENCY");
    const effective=payload.effective_from||new Date().toISOString();
    if(!Number.isFinite(Date.parse(effective)))throw problem(400,"INVALID_EFFECTIVE_FROM");
    const current=this.subscriptionPrices.filter(x=>x.currency===currency&&!x.effective_to).sort((a,b)=>Date.parse(b.effective_from)-Date.parse(a.effective_from))[0];
    if(current&&Date.parse(effective)<=Date.parse(current.effective_from))throw problem(409,"SUBSCRIPTION_PRICE_NOT_LATER");
    if(current)current.effective_to=effective;
    const price={id:this.subscriptionPrices.length+1,plan_key:"external-sva-access",currency,amount_minor:amount,tax_behavior:"inclusive",billing_interval:"month",interval_count:1,effective_from:effective,effective_to:null};
    this.subscriptionPrices.push(price);
    return structuredClone(price);
  }

  async applySubscriptionBillingEvent(payload={}){
    const key=String(payload.provider||"")+":"+String(payload.provider_event_id||"");
    if(this.subscriptionEvents.has(key))return {duplicate:true,subscription_id:null};
    this.subscriptionEvents.add(key);
    return {duplicate:false,subscription_id:1,tenant_id:null,status:String(payload.status||"active")};
  }

  async tenantDuplicateCandidates(input={}){void input;return {data:[]};}
  async createTenant(payload={}){
    const name=String(payload.display_name||"").trim();
    if(name.length<2)throw problem(400,"TENANT_DISPLAY_NAME_REQUIRED");
    return {public_id:randomUUID(),slug:"demo-"+Date.now(),display_name:name,legal_name:String(payload.legal_name||name),tenant_type:String(payload.tenant_type||"customer"),status:"pending",country_code:String(payload.country_code||"FR").toUpperCase(),billing_email:payload.billing_email||null,preferred_locale:payload.preferred_locale||"fr-FR",default_currency:payload.default_currency||"EUR",timezone:payload.timezone||"Europe/Paris"};
  }

  async listTenants(params={}){
    void params;
    return {data:[],next_cursor:null};
  }

  async listTenantAssignments(params={}){
    void params;
    return {data:[],next_cursor:null};
  }

  async tenantControlDetail(publicId){
    void publicId;
    throw problem(404,"TENANT_NOT_FOUND");
  }

  async tenantInternalNotes(publicId){void publicId;return {data:[]};}
  async createTenantInternalNote(publicId,input={},actor={}){void publicId;void input;void actor;throw problem(404,"TENANT_NOT_FOUND");}
  async archiveTenantInternalNote(id,actor={}){void id;void actor;throw problem(404,"INTERNAL_NOTE_NOT_FOUND");}

  async tenantAdminExport(publicId,actor={}){
    void publicId;void actor;
    throw problem(404,"TENANT_NOT_FOUND");
  }

  async createTenantPayoutTerms(publicId,input={}){
    void publicId;void input;
    throw problem(404,"TENANT_NOT_FOUND");
  }

  async setTenantStatus(publicId,status){
    void publicId;void status;
    throw problem(404,"TENANT_NOT_FOUND");
  }

  async setTenantAssignmentStatus(id,status){
    void id;void status;
    throw problem(404,"ASSIGNMENT_NOT_FOUND");
  }

  async regulatoryEvidencePack(id,actor={}){
    void id;void actor;throw problem(404,"ASSIGNMENT_NOT_FOUND");
  }
  async upsertSvaRegulatoryProfile(id,input={},actor={}){
    void id;void input;void actor;throw problem(404,"ASSIGNMENT_NOT_FOUND");
  }
  async recordSvaRegulatoryEvidence(id,input={},actor={}){
    void id;void input;void actor;throw problem(404,"ASSIGNMENT_NOT_FOUND");
  }
  async createSvaAbuseCase(id,input={},actor={}){
    void id;void input;void actor;throw problem(404,"ASSIGNMENT_NOT_FOUND");
  }

  async customerVoiceStudio(tenantId){void tenantId;return {data:structuredClone(this.voiceServices)};}

  async createCustomerVoiceService(tenantId,input={},actorSubject=""){
    void tenantId;const normalized=normalizeVoiceServiceInput(input),check=validateVoiceFlow(normalized.flow),checksum=voiceFlowChecksum(check.flow);
    const id=this.nextVoiceServiceId++,version={id:this.nextVoiceVersionId++,service_id:id,version_no:1,state:"draft",flow:check.flow,validation:{valid:check.valid,errors:check.errors,warnings:check.warnings,node_count:check.node_count,features:check.features},checksum_sha256:checksum,created_at:new Date().toISOString()};
    const service={id,sva_number_id:normalized.sva_number_id,name:normalized.name,status:"draft",timezone:normalized.timezone,default_locale:normalized.default_locale,active_version_id:null,published_at:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),versions:[version],events:[{event_type:"created",actor_type:"customer",actor_subject:String(actorSubject||""),occurred_at:new Date().toISOString()}]};
    this.voiceServices.unshift(service);return structuredClone({...service,draft:version});
  }

  async saveCustomerVoiceDraft(tenantId,serviceId,input={},actorSubject=""){
    void tenantId;const service=this.voiceServices.find(x=>x.id===Number(serviceId));if(!service)throw problem(404,"VOICE_SERVICE_NOT_FOUND");
    const normalized=normalizeVoiceServiceInput(input),check=validateVoiceFlow(normalized.flow),checksum=voiceFlowChecksum(check.flow),versionNo=Math.max(0,...service.versions.map(x=>x.version_no))+1;
    const version={id:this.nextVoiceVersionId++,service_id:service.id,version_no:versionNo,state:"draft",flow:check.flow,validation:{valid:check.valid,errors:check.errors,warnings:check.warnings,node_count:check.node_count,features:check.features},checksum_sha256:checksum,created_at:new Date().toISOString()};
    service.name=normalized.name;service.sva_number_id=normalized.sva_number_id;service.timezone=normalized.timezone;service.default_locale=normalized.default_locale;service.updated_at=new Date().toISOString();service.versions.unshift(version);service.events.unshift({event_type:"draft_saved",actor_type:"customer",actor_subject:String(actorSubject||""),version_id:version.id,occurred_at:new Date().toISOString()});
    return structuredClone({...service,draft:version,validation:version.validation});
  }

  async simulateCustomerVoiceService(tenantId,serviceId,input={}){
    void tenantId;const service=this.voiceServices.find(x=>x.id===Number(serviceId));if(!service)throw problem(404,"VOICE_SERVICE_NOT_FOUND");
    const flow=input.flow&&typeof input.flow==="object"?input.flow:service.versions[0]?.flow;if(!flow)throw problem(404,"VOICE_SERVICE_VERSION_NOT_FOUND");
    const result=simulateVoiceFlow(flow,input.simulation||{});service.events.unshift({event_type:"simulated",actor_type:"customer",occurred_at:new Date().toISOString()});return result;
  }

  async publishCustomerVoiceService(tenantId,serviceId,actorSubject=""){
    void tenantId;const service=this.voiceServices.find(x=>x.id===Number(serviceId));if(!service)throw problem(404,"VOICE_SERVICE_NOT_FOUND");
    const version=service.versions[0];if(!version)throw problem(404,"VOICE_SERVICE_VERSION_NOT_FOUND");const check=validateVoiceFlow(version.flow);if(!check.valid)throw problem(409,"VOICE_FLOW_INVALID");
    service.versions.forEach(x=>{if(x.state==="published")x.state="retired";});version.state="published";version.published_at=new Date().toISOString();service.active_version_id=version.id;service.status="published";service.published_at=version.published_at;service.updated_at=version.published_at;service.events.unshift({event_type:"published",actor_type:"customer",actor_subject:String(actorSubject||""),version_id:version.id,occurred_at:version.published_at});
    return structuredClone({...service,version,validation:{valid:true,errors:[],warnings:check.warnings,node_count:check.node_count,features:check.features}});
  }

  async rollbackCustomerVoiceService(tenantId,serviceId,versionId,actorSubject=""){
    void tenantId;const service=this.voiceServices.find(x=>x.id===Number(serviceId));if(!service)throw problem(404,"VOICE_SERVICE_NOT_FOUND");
    const source=service.versions.find(x=>x.id===Number(versionId));if(!source)throw problem(404,"VOICE_SERVICE_VERSION_NOT_FOUND");const check=validateVoiceFlow(source.flow);if(!check.valid)throw problem(409,"VOICE_FLOW_INVALID");
    service.versions.forEach(x=>{if(x.state==="published")x.state="retired";});const next=Math.max(...service.versions.map(x=>x.version_no))+1,version={id:this.nextVoiceVersionId++,service_id:service.id,version_no:next,state:"published",flow:structuredClone(check.flow),validation:{valid:true,errors:[],warnings:check.warnings,node_count:check.node_count,features:check.features},checksum_sha256:voiceFlowChecksum(check.flow),source_version_id:source.id,published_at:new Date().toISOString(),created_at:new Date().toISOString()};
    service.versions.unshift(version);service.active_version_id=version.id;service.status="published";service.published_at=version.published_at;service.updated_at=version.published_at;service.events.unshift({event_type:"rolled_back",actor_type:"customer",actor_subject:String(actorSubject||""),version_id:version.id,occurred_at:version.published_at});
    return structuredClone({...service,version});
  }

  async createCallDestination(publicId,input={}){void publicId;const label=String(input.label||"").trim(),destination_uri=String(input.destination_uri||"").trim();if(!label||!destination_uri)throw problem(400,"INVALID_CALL_DESTINATION");const row={id:this.nextDestinationId++,tenant_id:null,sva_number_id:null,label,destination_type:String(input.destination_type||"pstn"),destination_uri,priority:Number(input.priority||100),status:"testing",max_concurrent_calls:input.max_concurrent_calls==null?null:Number(input.max_concurrent_calls),active_calls:0};this.callDestinations.push(row);return structuredClone(row);}
  async setCallDestinationStatus(id,status){const row=this.callDestinations.find(x=>x.id===Number(id));if(!row)throw problem(404,"CALL_DESTINATION_NOT_FOUND");if(!["active","testing","disabled"].includes(status))throw problem(400,"INVALID_CALL_DESTINATION_STATUS");row.status=status;if(status==="disabled")row.active_calls=0;return structuredClone(row);}

  async createTenantServiceIncident(publicId,input={}){void publicId;void input;throw problem(404,"TENANT_NOT_FOUND");}
  async serviceIncidentDetail(id){void id;throw problem(404,"SERVICE_INCIDENT_NOT_FOUND");}
  async updateServiceIncident(id,input={}){void id;void input;throw problem(404,"SERVICE_INCIDENT_NOT_FOUND");}
  async addServiceIncidentNote(id,input={}){void id;void input;throw problem(404,"SERVICE_INCIDENT_NOT_FOUND");}
  async simulateTenantRouting(publicId,input={}){void publicId;return this.simulateTenantRoutingById(1,input);}
  async simulateTenantRoutingById(tenantId,input={}){
    void tenantId;
    const numberId=input.sva_number_id==null||input.sva_number_id===""?null:Number(input.sva_number_id);
    const rows=this.callDestinations.filter(x=>(numberId==null||x.sva_number_id==null||Number(x.sva_number_id)===numberId));
    const candidates=rows.map(x=>({...structuredClone(x),eligible:x.status==="active"&&(x.max_concurrent_calls==null||Number(x.active_calls)<Number(x.max_concurrent_calls))}));
    const selected=candidates.filter(x=>x.eligible).sort((a,b)=>Number(a.priority||100)-Number(b.priority||100)||Number(a.active_calls||0)-Number(b.active_calls||0))[0]||null;
    return {tenant_id:1,sva_number_id:numberId,dry_run:true,safe_to_activate:Boolean(selected),selected,candidates,warnings:selected?[]:["Aucune destination actuellement disponible"]};
  }
  async scanTenantServiceIncidents(){return [];}

  async scanRegulatoryReviews(){return [];}
  async listRegulatoryReviewAlerts(){return {data:[],next_cursor:null};}
  async acknowledgeRegulatoryReviewAlert(){throw problem(409,"ALERT_NOT_OPEN");}

  async scanUnpaidSubscriptions(){
    return [];
  }

  async listAdminAlerts(params={}){
    const state=String(params.state||"open");
    const rows=state==="all"?this.adminAlerts:state==="unresolved"?this.adminAlerts.filter(x=>x.state!=="resolved"):this.adminAlerts.filter(x=>x.state===state);
    return {data:structuredClone(rows),next_cursor:null};
  }

  async acknowledgeAdminAlert(id){
    const row=this.adminAlerts.find(x=>x.id===Number(id)&&x.state==="open");
    if(!row)throw problem(409,"ALERT_NOT_OPEN");
    row.state="acknowledged";row.acknowledged_at=new Date().toISOString();
    return structuredClone(row);
  }

  async selfServiceRegister(input={},passwordHash){
    const first=String(input.first_name||"").trim(),last=String(input.last_name||"").trim(),email=String(input.email||"").trim().toLowerCase();
    const company=String(input.company_name||"").trim(),registration=String(input.registration_number||"").trim(),accountTypeInput=String(input.account_type||"").trim().toLowerCase(),accountType=accountTypeInput||((company||registration)?"business":"individual");
    if(!first||!last)throw problem(400,"CUSTOMER_NAME_REQUIRED");
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw problem(400,"INVALID_CUSTOMER_EMAIL");
    if(String(passwordHash||"").length<20)throw problem(400,"INVALID_PASSWORD_HASH");
    if(!["individual","business"].includes(accountType))throw problem(400,"INVALID_CUSTOMER_ACCOUNT_TYPE");
    if(input.authority_confirmed!==true)throw problem(400,"REGISTRATION_AUTHORITY_REQUIRED");
    if(input.legal_terms_accepted!==true||input.privacy_notice_acknowledged!==true)throw problem(400,"REGISTRATION_LEGAL_TERMS_REQUIRED");
    if(String(input.legal_version||"")!=="2026-09-26-b2b-b2c-v3")throw problem(409,"LEGAL_DOCUMENT_VERSION_OUTDATED");
    this.customerLegalAcceptances.push({acceptance_type:"account_terms",document_version:"2026-09-26-b2b-b2c-v3",documents:{cgu:"/conditions-utilisation/",conditions:"/conditions-abonnement/",privacy:"/confidentialite/",cookies:"/cookies-traceurs/"},account_type:accountType,evidence:{source:"self_service_registration",authority_confirmed:true,privacy_notice_acknowledged:true},accepted_at:new Date().toISOString()});
    return {id:randomUUID(),email,display_name:(first+" "+last).trim(),status:"active",email_verified:false,session_version:1,tenant_id:1,tenant_public_id:"00000000-0000-4000-8000-000000000001",tenant_name:accountType==="business"?(company||(first+" "+last).trim()):(first+" "+last).trim(),tenant_status:"pending",customer_role:"owner",authorization_version:1,customer_type:accountType};
  }
  async customerGoogleSignIn(){throw problem(403,"GOOGLE_INVITATION_REQUIRED");}
  async customerAuthLookup(){return null;}
  async recordCustomerAuthFailure(){return;}
  async recordCustomerAuthSuccess(){return;}
  async updateCustomerPassword(){return {ok:true,session_version:2};}
  async beginCustomerPasswordReset(){return null;}
  async completeCustomerPasswordReset(){throw problem(400,"PASSWORD_RESET_INVALID");}
  async beginCustomerEmailChange(_principalId,newEmail){return {id:"demo-customer",email:"demo@example.test",display_name:"Client Démo",preferred_locale:"fr-FR",new_email:String(newEmail||"").trim().toLowerCase()};}
  async completeCustomerEmailChange(){throw problem(400,"EMAIL_CHANGE_INVALID");}
  async customerSessionContext(actor){
    if(!actor?.tenant_id)throw problem(401,"CUSTOMER_AUTH_REQUIRED");
    return {id:actor.sub,email:"demo@example.test",display_name:actor.name||"Client Démo",status:"active",email_verified:false,session_version:actor.session_version||1,tenant_id:Number(actor.tenant_id),customer_role:actor.customer_role||"readonly",permission_grants:[],permission_denials:[],tenant_public_id:actor.tenant_public_id||"00000000-0000-4000-8000-000000000001",tenant_name:"Société Démo",tenant_status:"pending",authorization_version:actor.authorization_version||1,default_currency:"EUR",country_code:"FR"};
  }
  async createCustomerPortalInvitation(publicId,input={},tokenHash){return {id:"demo-invitation",tenant_public_id:publicId,tenant_name:"Société Démo",email:input.email,role:input.role||"readonly",status:"pending",expires_at:new Date(Date.now()+72*3600000).toISOString(),token_hash:tokenHash};}
  async activateCustomerPortalInvitation(){throw problem(409,"CUSTOMER_PORTAL_DEMO_ONLY");}
  async customerPortalUsers(){return [];}
  async customerTeam(){
    this.customerTeamMembers??=[{id:"11111111-1111-4111-8111-111111111111",email:"demo@example.test",display_name:"Client Démo",email_verified:true,last_authenticated_at:new Date().toISOString(),role:"owner",membership_status:"active",permission_grants:[],permission_denials:[],joined_at:new Date().toISOString()}];
    this.customerTeamInvitations??=[];
    return {members:structuredClone(this.customerTeamMembers),invitations:structuredClone(this.customerTeamInvitations.filter(x=>x.status==="pending"))};
  }
  async createCustomerTeamInvitation(_tenantId,input={},_tokenHash,actorPrincipalId){
    this.customerTeamInvitations??=[];
    const row={id:randomUUID(),email:String(input.email||"").trim().toLowerCase(),role:String(input.role||"readonly"),status:"pending",expires_at:new Date(Date.now()+72*3600000).toISOString(),created_at:new Date().toISOString(),invited_by_customer_principal_id:actorPrincipalId};
    this.customerTeamInvitations.push(row);return structuredClone(row);
  }
  async updateCustomerTeamMember(_tenantId,principalId,input={},actorPrincipalId){
    if(String(principalId)===String(actorPrincipalId))throw problem(409,"SELF_ACCESS_CHANGE_FORBIDDEN");
    this.customerTeamMembers??=[];
    const row=this.customerTeamMembers.find(x=>String(x.id)===String(principalId));if(!row)throw problem(404,"CUSTOMER_TEAM_MEMBER_NOT_FOUND");
    if(row.role==="owner"&&row.membership_status==="active"&&(input.role!=="owner"||input.status!=="active"))throw problem(409,"LAST_CUSTOMER_OWNER_REQUIRED");
    row.role=String(input.role||row.role);row.membership_status=String(input.status||row.membership_status);return structuredClone(row);
  }
  async revokeCustomerTeamInvitation(_tenantId,invitationId){
    this.customerTeamInvitations??=[];
    const row=this.customerTeamInvitations.find(x=>String(x.id)===String(invitationId));if(!row)throw problem(404,"CUSTOMER_INVITATION_NOT_FOUND");
    if(row.status!=="pending")throw problem(409,"CUSTOMER_INVITATION_NOT_PENDING");
    row.status="revoked";return structuredClone(row);
  }
  async createCustomerWithdrawalRequest(input={}){
    const publicId=randomUUID(),submittedAt=new Date().toISOString(),reference="RET-"+publicId.slice(0,8).toUpperCase();
    const row={public_id:publicId,tenant_id:null,first_name:String(input.first_name||""),last_name:String(input.last_name||""),contract_email:String(input.contract_email||""),acknowledgement_email:String(input.acknowledgement_email||""),contract_reference:input.contract_reference||null,contract_details:String(input.contract_details||""),contract_date:input.contract_date||null,legal_version:String(input.legal_version||""),source:"online",request_sha256:String(input.request_sha256||""),requester_ip_sha256:input.requester_ip_sha256||null,user_agent_sha256:input.user_agent_sha256||null,submitted_at:submittedAt,reference};
    this.customerWithdrawalRequests.push(row);
    this.#outbox("consumer.withdrawal.received","customer_withdrawal_request",publicId,{withdrawal_public_id:publicId,reference,first_name:row.first_name,last_name:row.last_name,contract_email:row.contract_email,acknowledgement_email:row.acknowledgement_email,contract_reference:row.contract_reference,contract_details:row.contract_details,contract_date:row.contract_date,submitted_at:submittedAt,legal_version:row.legal_version});
    this.#audit("consumer.withdrawal.received",publicId,{reference});
    return structuredClone({public_id:publicId,reference,submitted_at:submittedAt});
  }

  async recordCustomerLegalAcceptance(tenantId,principalId,input={}){
    if(String(input.document_version||"")!=="2026-09-26-b2b-b2c-v3")throw problem(409,"LEGAL_DOCUMENT_VERSION_OUTDATED");
    const row={public_id:randomUUID(),tenant_id:Number(tenantId),customer_principal_id:String(principalId),acceptance_type:String(input.acceptance_type||""),document_version:"2026-09-26-b2b-b2c-v3",documents:structuredClone(input.documents&&typeof input.documents==="object"?input.documents:{}),immediate_performance_requested:input.immediate_performance_requested===true,evidence:structuredClone(input.evidence&&typeof input.evidence==="object"?input.evidence:{}),accepted_at:new Date().toISOString()};
    this.customerLegalAcceptances.push(row);this.#audit("customer.legal_acceptance",String(principalId),{acceptance_type:row.acceptance_type,document_version:row.document_version});return structuredClone(row);
  }

  async customerBillingPreparation(tenantId){void tenantId;return {tenant:{id:"00000000-0000-4000-8000-000000000001",name:"Société Démo",billing_email:"demo@example.test",country_code:"FR",locale:"fr-FR",currency:"EUR",timezone:"Europe/Paris",status:"pending"},offer:{price_version_id:1,plan_key:"external-sva-access",plan_name:"External SVA Access",market:null,currency:"EUR",amount_minor:300,tax_behavior:"inclusive",billing_interval:"month",interval_count:1},reference_offer:{price_version_id:1,plan_key:"external-sva-access",plan_name:"External SVA Access",currency:"EUR",amount_minor:300,tax_behavior:"inclusive",billing_interval:"month",interval_count:1},pricing_state:"local_price_ready",subscription:null,premium_call_access:false,billing_currency:{currency:"EUR",source:"country_default",catalog_version:"2026-09-20",accepted_currencies:["EUR"],local_price_configured:true},checkout_prefill:{email:"demo@example.test",locale:"fr-FR",country_code:"FR",currency:"EUR"},return_paths:{success:"client.html?billing=success",cancel:"client.html?billing=cancelled"}};}
  async customerExperiencePreferences(tenantId,principalId){
    const key=String(tenantId)+":"+String(principalId||"");
    return this.customerExperiencePreferencesMap.get(key)||{alerts:{calls_below:{enabled:false,threshold:10},abandon_rate_above:{enabled:false,threshold:25},revenue_target:{enabled:false,threshold:100},drop_vs_average:{enabled:false,threshold:30}},updated_at:null};
  }
  async saveCustomerExperiencePreferences(tenantId,principalId,input={}){
    const bounded=(v,min,max,fallback)=>{const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;},src=input.alerts||{};
    const value={alerts:{
      calls_below:{enabled:src.calls_below?.enabled===true,threshold:bounded(src.calls_below?.threshold,0,1000000,10)},
      abandon_rate_above:{enabled:src.abandon_rate_above?.enabled===true,threshold:bounded(src.abandon_rate_above?.threshold,0,100,25)},
      revenue_target:{enabled:src.revenue_target?.enabled===true,threshold:bounded(src.revenue_target?.threshold,0,100000000,100)},
      drop_vs_average:{enabled:src.drop_vs_average?.enabled===true,threshold:bounded(src.drop_vs_average?.threshold,0,100,30)}
    },updated_at:new Date().toISOString()};
    this.customerExperiencePreferencesMap.set(String(tenantId)+":"+String(principalId||""),value);return value;
  }
  async createCustomerConsumptionReceipt(){throw problem(409,"CUSTOMER_PORTAL_DEMO_ONLY");}
  async customerConsumptionReceipts(){return [];}
  async tenantConsumptionReceipts(){return [];}
  async tenantConsumptionToday(){return {schema_version:"audiotel-consumption-receipt/1",range:{from:new Date().toISOString(),to:new Date().toISOString()},tenant_timezone:"Europe/Paris",metric_ranges:{},metrics:{currency:"EUR",calls_total:0,calls_connected:0,calls_abandoned:0,calls_failed:0,billable_seconds:0,generated_revenue_ttc:0,net_payout_ht:0},snapshot_sha256:"0".repeat(64),generated_at:new Date().toISOString(),basis:"demo"};}
  async reconcileTenantConsumptionReceipt(){throw problem(404,"CONSUMPTION_RECEIPT_NOT_FOUND");}
  async customerPortalOverview(tenantId,from,to){void tenantId;const voice=await this.voiceIntelligence(from,to),live=await this.liveFinancialSnapshot();return {tenant:{display_name:"Société Démo",default_currency:"EUR",status:"active",customer_type:"business"},financial_by_currency:[],live_financial_by_currency:live.by_currency,series:[],activity_breakdown:[],numbers:[],settlements:[],subscriptions:[],destinations:[],service_incidents:[],operational_alerts:[],recent_calls:[],voice_quality:voice.summary,range:{from,to}};}
  async customerServiceIncidents(_tenantId,params={}){if(params.incident_id)throw problem(404,"SERVICE_INCIDENT_NOT_FOUND");return {data:[],alerts:[]};}
  async createCustomerServiceIncident(){throw problem(409,"CUSTOMER_PORTAL_DEMO_ONLY");}
  async addCustomerServiceIncidentNote(){throw problem(409,"CUSTOMER_PORTAL_DEMO_ONLY");}
  async customerPortalComparison(_tenantId,from,to){return {financial_by_currency:[],range:{from,to}};}
  async customerPortalCalls(){return {data:[],next_cursor:null};}

  async listServiceIncidents(){return {data:[],next_cursor:null};}

  async customerRelationsOverview(){return {schema_version:"audiotel-customer-relations/1",tenant:null,cases:[],exits:[],events:[],actions:[],evidence:[],holds:[],agent_policy_version:"customer-relations/1"};}
  async createCustomerRelationCase(){throw problem(409,"CUSTOMER_PORTAL_DEMO_ONLY");}
  async createCustomerExitRequest(){throw problem(409,"CUSTOMER_PORTAL_DEMO_ONLY");}
  async addCustomerRelationMessage(){throw problem(409,"CUSTOMER_PORTAL_DEMO_ONLY");}
  async cancelCustomerRelationCase(){throw problem(409,"CUSTOMER_PORTAL_DEMO_ONLY");}
  async tenantCustomerRelations(){return this.customerRelationsOverview();}
  async listCustomerRelationsQueue(){return {data:[]};}
  async relationAgentContext(){throw problem(404,"RELATION_CASE_NOT_FOUND");}
  async createRelationAgentAction(){throw problem(409,"CUSTOMER_RELATIONS_DEMO_ONLY");}
  async approveRelationAction(){throw problem(409,"CUSTOMER_RELATIONS_DEMO_ONLY");}
  async confirmCustomerRelationAction(){throw problem(409,"CUSTOMER_PORTAL_DEMO_ONLY");}
  async completeRelationExternalAction(){throw problem(409,"CUSTOMER_RELATIONS_DEMO_ONLY");}

  async customerProfitability(params={}){void params;return {schema_version:"audiotel-customer-profitability/1",period:"365d",since:null,currency:"EUR",currencies:["EUR"],accounting_basis:"tenant_revenue_distributions.platform_fee_ht",cash_basis:"carrier paid amount / confirmed amount",excludes:["general_platform_overhead","unconnected_subscription_cash"],tenant:null,summary:{upstream_payout_ht:0,margin_booked_ht:0,margin_collected_ht:0,client_net_payout_ht:0,unallocated_amount_ht:0,customers_with_distribution:0,top5_margin_collected_ht:0,top5_concentration_percent:0},ranking:[],trend:[]};}

  async customerAdminSummary(){
    return {tenants_total:0,tenants_active:0,tenants_new_24h:0,tenants_new_7d:0,latest_tenant_created_at:null,kyc_pending:0,subscription_unpaid_alerts:0,subscription_access_blocked:0,assignments_active:0,service_incidents_open:0,service_incidents_critical:0,service_sla_attention:0,routing_attention:0,portability_attention:0};
  }

  async svaComplianceOverview(){
    const frameworks=[
      ["apnf_rsva","APNF / RSVA","Référentiel SVA"],["af2m_sva_2026","af2m","Recommandations SVA 2026"],["dgccrf_consumer","DGCCRF","Protection consommateur"],["cnil_privacy","CNIL","Données personnelles"],["af2m_33700","af2m / 33700","Signalements"],["consumer_mediation","Médiation consommation","Médiation"],["acpr_dsp2_scope","ACPR","Périmètre DSP2"]
    ].map(x=>({framework_key:x[0],authority_name:x[1],framework_name:x[2]}));
    return {schema_version:"audiotel-sva-compliance/1",generated_at:new Date().toISOString(),summary:{numbers_total:0,numbers_ready:0,controls_verified:0,controls_blocking:0,evidence_events:0,tariff_changes_open:0},frameworks,framework_status:[],catalog:[],numbers:[],states:[],tariff_change_plans:[],external_connections_active:false,certification_claimed:false};
  }
  async upsertSvaServiceComplianceProfile(){return {ecosystem_ready:false,af2m_reference_version:"2026-09-01"};}
  async recordSvaEcosystemEvidence(){return {event:{id:1,event_hash:"0".repeat(64)},ecosystem_ready:false};}
  async planSvaTariffChange(id,input={}){return {id:1,public_id:randomUUID(),current_tariff_code:null,proposed_tariff_code:input.proposed_tariff_code,effective_on:input.effective_on,status:"planned"};}

  async operationalPolicyEvaluation(input={}){
    const intent=String(input.intent||"").trim().toLowerCase();
    const facts={
      tenant_active:intent==="carrier_switch"?null:true,
      assignment_exists:true,
      subscription_active:true,
      payout_terms_ready:true,
      kyc_verified:true,
      regulatory_ready:true,
      arcep_2026_ready:true,
      ecosystem_ready:true,
      destination_ready:true,
      portability_dossier_ready:false,
      operator_adapter_connected:false,
      target_carrier_ready:false,
      rollback_ready:true,
      settlement_reconciled:false,
      payment_provider_connected:false
    };
    return {...evaluateOperationalPolicy(intent,facts),context:intent==="carrier_switch"?null:{tenant_public_id:"00000000-0000-4000-8000-000000000001",tenant:"Société Démo",assignment_id:1,assignment_status:"testing"}};
  }

  async digitalTwinSimulation(input={}){
    const baseline={
      active_assignments:12,active_subscriptions:12,ready_numbers:10,total_numbers:12,regulatory_blocking:0,
      service_incidents_critical:0,route_standby_ready:true,destination_capacity:120,current_concurrent:18,
      regions_ready:2,regions_total:2,dr_targets:2,read_replica_enabled:true,queue_pending:this.workQueue.length,queue_dead_lettered:this.workQueue.filter(x=>x.dead_lettered_at).length,bucket_capacity:4096
    };
    return simulateDigitalTwin(input.scenario,baseline,input.parameters||{});
  }

  async performanceResilienceLab(){
    const queue=await this.workQueueHealth();
    return {
      schema_version:"audiotel-performance-resilience-lab/1",generated_at:new Date().toISOString(),
      capacity_proof:"unproven",preproduction_gate:{ready:false,blockers:[{code:"LOAD_PROOF_MISSING",label:"Aucun test de charge réel enregistré en mode démonstration."}]},
      database:{name:"memory",size_bytes:0,max_connections:0,connections_total:0,connections_active:0,connections_idle_in_transaction:0,connection_headroom_percent:100,pool_max:0,read_pool_max:0,tables:[],attention:[]},
      queue,synthetic:{checks_24h:0,successes_24h:0,success_percent:null,avg_latency_ms:0,max_latency_ms:0,last_checked_at:null,last_failure_at:null},
      load:{latest:null,latest_passed:null,runs:[]},disaster_recovery:{targets:[],latest_restore:null,drills:[]},
      rate_limits:{global_per_minute:Number(this.config.rateLimitPerMinute||0),heavy_read_per_minute:Number(this.config.heavyReadRateLimitPerMinute||0),write_per_minute:Number(this.config.writeRateLimitPerMinute||0)},
      claims:{capacity_guaranteed:false,external_connections_active:false}
    };
  }
  async recordPerformanceLabRun(input={},actor={}){void input;void actor;throw problem(409,"PERFORMANCE_LAB_PERSISTENCE_REQUIRED");}
  async recordSyntheticProbe(input={}){void input;throw problem(409,"PERFORMANCE_LAB_PERSISTENCE_REQUIRED");}

  async controlTowerOverview(){
    const queue=await this.workQueueHealth(),service=await this.serviceOperationsHealth();
    const risk=assessOperationalRisk({calls_7d:this.calls.length,failed_7d:this.calls.filter(x=>!["connected","abandoned"].includes(x.call_status)).length,expected_7d:this.calls.reduce((a,x)=>a+Number(x.expected_payout_ht||0),0),variance_7d:this.calls.reduce((a,x)=>a+Math.abs(Number(x.reconciliation_variance_ht||0)),0),calls_last_hour:this.calls.filter(x=>Date.parse(x.started_at)>=Date.now()-3600000).length,avg_hourly_7d:this.calls.length/168,service_critical:0,regulatory_blocking:0,queue_dead_lettered:queue.dead_lettered});
    const shadowBilling=assessShadowBilling([]);
    const slo=assessOperationalSlo({cdr_lag_seconds:0,queue_oldest_seconds:queue.oldest_pending_seconds,queue_dead_lettered:queue.dead_lettered,service_critical:0,resolution_overdue:0,regions_total:2,regions_ready:2});
    const changes=(await this.listPlatformChangeRequests({status:"active",limit:20})).data,pending=changes.filter(x=>x.status==="pending").length;
    const priorities=pending?[{severity:"warning",code:"FOUR_EYES_PENDING",title:"Validations 4 yeux",detail:pending+" changement(s) critique(s) attendent un second administrateur."}]:[{severity:"info",code:"DEMO_MODE",title:"Mode démonstration",detail:"Aucune connexion opérateur, Stripe, APNF/RSVA ou PSP réelle n’est active."}];
    return {
      schema_version:"audiotel-control-tower/2",generated_at:new Date().toISOString(),status:pending?"attention":"healthy",readiness_score:96,
      kpis:{customers_active:0,customers_total:0,assignments_active:0,numbers_ready:0,subscription_blocked:0,regulatory_blocking:0,service_critical:0,portability_attention:0,queue_dead_lettered:queue.dead_lettered,destination_capacity:120,concurrent_in_use:18,regions_ready:2,regions_total:2,risk_score:risk.score,slo_score:slo.score,approvals_pending:pending,shadow_billing_status:shadowBilling.status},
      priorities,assurance:{risk,slo,shadow_billing:shadowBilling,change_requests:changes,dual_control_required:true},
      carrier_route:await this.carrierRouting(),queue,service_operations:service,
      regulatory:{numbers_total:0,numbers_ready:0,review_blocking:0,review_today:0,review_soon:0},
      scale:{regions_total:2,regions_ready:2,dr_targets_total:2,bucket_capacity:4096},
      capabilities:{policy_intents:["activate_number","port_in","payout_customer","carrier_switch","customer_access"],digital_twin_scenarios:["carrier_outage","traffic_spike","mass_portability","regulatory_expiry","billing_failure","region_failure","database_failure","worker_backlog","settlement_mismatch","hyperscale_growth"],external_connections_active:false,dual_control:true,shadow_billing:true,risk_engine:true,slo_snapshot:true}
    };
  }

  async wholesaleOverview(){
    return {
      foundation_version:"1.16",
      summary:{
        tenants_total:0,tenants_active:0,kyc_verified:0,kyc_pending:0,
        markets_total:1,markets_active:1,tenant_markets_active:0,
        inventory_total:0,inventory_unassigned:0,
        assignments_total:0,assignments_active:0,assignments_with_assignor:0,
        settlement_currency_count:0,settlement_currency:null,
        upstream_payout_ht:0,platform_fee_ht:0,net_payout_ht:0,
        payment_compliance_active:false,
        external_subscriptions_active:0,subscription_access_enabled:0,subscription_access_blocked:0,
        subscription_unpaid_alerts:0,subscription_price_minor:300,subscription_price_currency:"EUR",internal_billing_exempt:true
      },
      tenants:[],
      numbers:[],
      settlements:[],
      payment_profiles:[],
      markets:[{country_code:"FR",display_name:"France",status:"active",default_currency:"EUR",default_locale:"fr-FR",timezone:"Europe/Paris",tenants:0,numbers:0}],
      settlement_totals_by_currency:[],
      scale:{
        clusters_total:1,clusters_ready:1,routing_buckets_active:4096,
        placements_active:1,call_fact_partitions:64,bucket_capacity:4096,
        regions_total:1,regions_ready:1,dr_targets_total:4,dr_drills_passed:0,
        read_replica_enabled:false,process_role:this.config.processRole||"all"
      },
      regulatory_trust:{
        summary:{numbers_total:0,numbers_ready:0,arcep_2026_ready:0,evidence_events:0,arcep_2026_evidence_events:0,abuse_open:0,abuse_critical:0,platform_controls_verified:0,platform_controls_attention:0,review_attention_total:0,review_blocking:0,review_today:0,review_soon:0},
        numbers:[],platform_controls:[],review_alerts:[]
      }
    };
  }


  async listWebauthnCredentials(ownerType,ownerId){this._passkeys=this._passkeys||[];return structuredClone(this._passkeys.filter(x=>x.owner_type===ownerType&&String(x.owner_id)===String(ownerId)).map(({public_key_spki,...x})=>x));}
  async registerWebauthnCredential(ownerType,ownerId,input={}){this._passkeys=this._passkeys||[];if(this._passkeys.some(x=>x.credential_id===input.credential_id))throw problem(409,"WEBAUTHN_CREDENTIAL_EXISTS");const row={id:this._passkeys.length+1,public_id:randomUUID(),owner_type:ownerType,owner_id:String(ownerId),credential_id:input.credential_id,public_key_spki:input.public_key_spki,sign_count:Number(input.sign_count||0),transports:input.transports||[],label:input.label||"Passkey",enabled:true,created_at:new Date().toISOString(),last_verified_at:null};this._passkeys.push(row);const{public_key_spki,...safe}=row;return structuredClone(safe);}
  async webauthnCredential(ownerType,ownerId,credentialId){this._passkeys=this._passkeys||[];return structuredClone(this._passkeys.find(x=>x.owner_type===ownerType&&String(x.owner_id)===String(ownerId)&&x.credential_id===credentialId&&x.enabled)||null);}
  async markWebauthnVerified(id,signCount){this._passkeys=this._passkeys||[];const x=this._passkeys.find(v=>v.id===Number(id));if(!x)throw problem(404,"WEBAUTHN_CREDENTIAL_NOT_FOUND");if(Number(signCount)>0)x.sign_count=Number(signCount);x.last_verified_at=new Date().toISOString();return{id:x.id,public_id:x.public_id,last_verified_at:x.last_verified_at,sign_count:x.sign_count};}

  async serviceOperationsHealth(){return {service_incidents_open:0,service_incidents_critical:0,service_first_response_overdue:0,service_resolution_overdue:0,routing_unavailable:0,portability_attention:0};}

  async systemSnapshot(){
    const last=this.calls[0],rows=this.baselines.filter(x=>x.scope==="global"&&x.tenant_id==null&&["all","calls"].includes(x.metric_key||"all")).sort((a,b)=>Date.parse(b.effective_from||b.created_at)-Date.parse(a.effective_from||a.created_at));
    const resetAt=rows[0]?Date.parse(rows[0].effective_from||rows[0].created_at):-Infinity;
    return {
      mode:this.config.mode,
      store:"memory",
      calls_total:this.calls.filter(x=>Date.parse(x.started_at)>=resetAt).length,
      experts_available:this.experts.filter(x=>x.status==="available").length,
      cdr_lag_seconds:last?Math.max(0,(Date.now()-Date.parse(last.ended_at))/1000):0,
      outbox_pending:this.outbox.filter(x=>!x.published_at).length,
      ...(await this.serviceOperationsHealth()),
      event_subscribers:this.eventBus.size,
      carrier_route:{...this.route},
      work_queue:await this.workQueueHealth(),
      resilience:{regions_total:1,regions_ready:1,dr_targets_total:4},
      service_operations:await this.serviceOperationsHealth()
    };
  }

  metrics(){
    return {
      calls_total:this.calls.length,
      calls_connected:this.calls.filter(x=>x.call_status==="connected").length,
      cdr_duplicate_total:0,
      outbox_pending:this.outbox.filter(x=>!x.published_at).length,
      event_subscribers:this.eventBus.size
    };
  }

  #range(from,to){
    const f=from?Date.parse(from):-Infinity,t=to?Date.parse(to):Infinity;
    return this.calls.filter(x=>Date.parse(x.started_at)>=f&&Date.parse(x.started_at)<=t);
  }
  #outbox(type,aggregateType,aggregateId,payload){
    this.outbox.push({id:randomUUID(),event_type:type,aggregate_type:aggregateType,aggregate_id:aggregateId,payload,created_at:new Date().toISOString(),published_at:null,attempts:0,last_error:null});
  }
  #audit(action,entityId,details){
    this.audit.push({id:randomUUID(),occurred_at:new Date().toISOString(),action,entity_id:entityId,details});
  }
}

function toCoreRow(x){
  return {
    status:x.call_status,
    billableSeconds:x.billable_seconds,
    payoutEligibleSeconds:x.payout_eligible_seconds,
    conversationSeconds:x.conversation_seconds,
    serviceAmountTtc:x.retail_service_amount_ttc,
    expectedPayoutHt:x.expected_payout_ht,
    confirmedPayoutHt:x.confirmed_payout_ht,
    paidPayoutHt:x.paid_payout_ht,
    expertCostHt:x.expert_cost_ht,
    technicalCostHt:x.technical_cost_ht
  };
}

function validateEnvelope(x){
  if(!x||typeof x!=="object"||Array.isArray(x))throw problem(400,"INVALID_CDR_ENVELOPE");
  const source=String(x.source||"").trim();
  const eventId=String(x.source_event_id||"").trim();
  if(!source||!eventId||!x.payload)throw problem(400,"CDR_ENVELOPE_FIELDS_MISSING");
  if(source.length>64||eventId.length>160)throw problem(400,"CDR_ENVELOPE_FIELD_INVALID");
  if(typeof x.payload!=="object"||Array.isArray(x.payload))throw problem(400,"INVALID_CDR_PAYLOAD");
  if(x.event_time!=null&&!Number.isFinite(Date.parse(String(x.event_time))))throw problem(400,"INVALID_CDR_EVENT_TIME");
  x.source=source;
  x.source_event_id=eventId;
  if(x.event_time!=null)x.event_time=new Date(String(x.event_time)).toISOString();
}
function clampInt(v,fallback,min,max){
  const n=v==null||v===""?fallback:Number(v);
  if(!Number.isInteger(n))return fallback;
  return Math.max(min,Math.min(max,n));
}
function encodeCursor(n){return Buffer.from(String(n)).toString("base64url");}
function decodeCursor(v){
  if(!v)return 0;
  const n=Number(Buffer.from(String(v),"base64url").toString("utf8"));
  return Number.isInteger(n)&&n>=0?n:0;
}
function roundFinance(x){
  for(const k of ["expected_payout_ht","confirmed_payout_ht","paid_payout_ht","variance_ht"])x[k]=Math.round((x[k]+Number.EPSILON)*1e6)/1e6;
  return x;
}
export function problem(status,code,message=code){
  const e=new Error(message);e.status=status;e.code=code;return e;
}
