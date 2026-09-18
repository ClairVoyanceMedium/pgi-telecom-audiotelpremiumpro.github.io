import {createRequire} from "node:module";
import {createHash,randomUUID} from "node:crypto";
import {sanitizeCdrPayload,deriveCallerHash} from "./cdr-privacy.mjs";
import {selectExpert} from "./expert-router.mjs";

const require=createRequire(import.meta.url);
const core=require("../../assets/core.js");

export class MemoryStore{
  constructor(config,eventBus){
    this.config=config;
    this.eventBus=eventBus;
    this.calls=[];
    this.experts=[
      {id:1,code:"FRED",display_name:"Frederick",destination_uri:"loopback/9101",status:"available",enabled:true,active_calls:0,last_assigned_at:null},
      {id:2,code:"SOFIA",display_name:"Sofia",destination_uri:"loopback/9102",status:"available",enabled:true,active_calls:0,last_assigned_at:null},
      {id:3,code:"EMMA",display_name:"Emma",destination_uri:"loopback/9103",status:"away",enabled:true,active_calls:0,last_assigned_at:null},
      {id:4,code:"LINA",display_name:"Lina",destination_uri:"loopback/9104",status:"available",enabled:true,active_calls:0,last_assigned_at:null}
    ];
    this.baselines=[];
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
    this.nextCallId=1;
    this.nextBaselineId=1;
    this.nextSwitchId=1;
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
      live_calls:this.experts.reduce((s,x)=>s+Number(x.active_calls||0),0),
      queue_depth:0
    };
  }

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
      bridged_at:p.bridged_at?new Date(p.bridged_at).toISOString():null,
      ended_at:new Date(p.ended_at).toISOString(),
      caller_masked:String(p.caller_masked||"Masqué"),
      caller_hash:deriveCallerHash(p,{key:this.config.callerHashKey,source:envelope.source,sourceEventId:envelope.source_event_id}),
      origin_carrier:String(p.origin_carrier||"Unknown"),
      origin_type:originType,
      host_carrier:String(p.host_carrier||this.route.active_carrier||"Unknown"),
      sva_number:String(p.sva_number||"Unknown"),
      expert_id:p.expert_id==null?null:Number(p.expert_id),
      expert_name:String(p.expert_name||""),
      wait_seconds:Math.max(0,Number(p.wait_seconds||0)),
      conversation_seconds:conversation,
      total_seconds:Math.max(0,Number(p.total_seconds||Math.round((Date.parse(p.ended_at)-Date.parse(p.started_at))/1000))),
      billable_seconds:financial.billableSeconds,
      payout_eligible_seconds:financial.payoutEligibleSeconds,
      call_status:status,
      sip_final_code:p.sip_final_code==null?null:Number(p.sip_final_code),
      hangup_cause:String(p.hangup_cause||""),
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
    this.#outbox("call.ingested","call",String(call.id),{external_call_id:call.external_call_id});
    this.#audit("cdr.ingest",String(call.id),{source:envelope.source});
    this.eventBus.publish("call.ingested",{id:call.id,status:call.call_status});
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

  async listBaselines(params={}){
    const scope=params.scope||"global";
    const limit=clampInt(params.limit,20,1,100);
    return this.baselines
      .filter(x=>x.scope===scope)
      .slice()
      .sort((a,b)=>Date.parse(b.effective_from||b.created_at)-Date.parse(a.effective_from||a.created_at))
      .slice(0,limit)
      .map(x=>({...x}));
  }

  async createBaseline(payload,actor){
    if(!["global","expert","sva_number"].includes(payload.scope))throw problem(400,"INVALID_SCOPE");
    const now=new Date().toISOString();
    const row={id:this.nextBaselineId++,scope:payload.scope,scope_id:payload.scope_id??null,reason:String(payload.reason||""),created_at:now,effective_from:now,created_by:actor?.sub||null};
    this.baselines.push(row);
    this.#audit("baseline.create",String(row.id),row);
    this.eventBus.publish("baseline.created",{id:row.id,scope:row.scope});
    return {...row};
  }

  async carrierRouting(){
    return {...this.route};
  }

  async planCarrierSwitch(payload,actor){
    if(!payload.to_carrier_id)throw problem(400,"TO_CARRIER_REQUIRED");
    const sw={
      id:this.nextSwitchId++,route_key:payload.route_key||"sva-primary",
      from_carrier:this.route.active_carrier,to_carrier:String(payload.to_carrier_id),
      connection_id:payload.connection_id??null,status:"ready",
      requested_at:new Date().toISOString(),requested_by:actor?.sub||null,
      scheduled_for:payload.scheduled_for||null,
      rollback_window_minutes:clampInt(payload.rollback_window_minutes,1440,5,10080)
    };
    this.switches.push(sw);
    this.#audit("carrier_switch.plan",String(sw.id),sw);
    return {...sw};
  }

  async activateCarrierSwitch(id){
    const sw=this.switches.find(x=>String(x.id)===String(id));
    if(!sw)throw problem(404,"SWITCH_NOT_FOUND");
    if(!["ready","planned"].includes(sw.status))throw problem(409,"SWITCH_NOT_READY");
    const previous=this.route.active_carrier;
    this.route.standby_carrier=previous;
    this.route.active_carrier=sw.to_carrier;
    this.route.generation++;
    this.route.updated_at=new Date().toISOString();
    sw.status="completed";
    sw.completed_at=new Date().toISOString();
    sw.rollback_deadline=new Date(Date.now()+sw.rollback_window_minutes*60000).toISOString();
    this.#audit("carrier_switch.activate",String(sw.id),{from:previous,to:sw.to_carrier});
    this.eventBus.publish("carrier.switched",{from:previous,to:sw.to_carrier,generation:this.route.generation});
    return {switch:{...sw},route:{...this.route}};
  }

  async rollbackCarrierSwitch(id){
    const sw=this.switches.find(x=>String(x.id)===String(id));
    if(!sw)throw problem(404,"SWITCH_NOT_FOUND");
    if(sw.status!=="completed")throw problem(409,"SWITCH_NOT_COMPLETED");
    if(sw.rollback_deadline&&Date.now()>Date.parse(sw.rollback_deadline))throw problem(409,"ROLLBACK_WINDOW_EXPIRED");
    const current=this.route.active_carrier;
    this.route.active_carrier=this.route.standby_carrier;
    this.route.standby_carrier=current;
    this.route.generation++;
    this.route.updated_at=new Date().toISOString();
    sw.status="rolled_back";
    this.#audit("carrier_switch.rollback",String(sw.id),{active:this.route.active_carrier});
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

  async listTenants(params={}){
    void params;
    return {data:[],next_cursor:null};
  }

  async wholesaleOverview(){
    return {
      foundation_version:"1.14",
      summary:{
        tenants_total:0,tenants_active:0,kyc_verified:0,kyc_pending:0,
        markets_total:1,markets_active:1,tenant_markets_active:0,
        inventory_total:0,inventory_unassigned:0,
        assignments_total:0,assignments_active:0,assignments_with_assignor:0,
        settlement_currency_count:0,settlement_currency:null,
        upstream_payout_ht:0,platform_fee_ht:0,net_payout_ht:0,
        payment_compliance_active:false
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
      }
    };
  }

  async systemSnapshot(){
    const last=this.calls[0];
    return {
      mode:this.config.mode,
      store:"memory",
      calls_total:this.calls.length,
      experts_available:this.experts.filter(x=>x.status==="available").length,
      cdr_lag_seconds:last?Math.max(0,(Date.now()-Date.parse(last.ended_at))/1000):0,
      outbox_pending:this.outbox.filter(x=>!x.published_at).length,
      event_subscribers:this.eventBus.size,
      carrier_route:{...this.route},
      work_queue:await this.workQueueHealth(),
      resilience:{regions_total:1,regions_ready:1,dr_targets_total:4}
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
