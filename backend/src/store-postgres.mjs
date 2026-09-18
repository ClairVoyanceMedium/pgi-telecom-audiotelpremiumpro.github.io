
import {createHash} from "node:crypto";
import {sanitizeCdrPayload,deriveCallerHash} from "./cdr-privacy.mjs";
import {computeExpertCost} from "./expert-finance.mjs";
import {normalizeSettlementPayload} from "./settlement-finance.mjs";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const core=require("../../assets/core.js");

export class PostgresStore{
  constructor(sql,config,eventBus){
    this.sql=sql;
    this.config=config;
    this.eventBus=eventBus;
  }

  static async connect(config,eventBus){
    const mod=await import("postgres");
    const postgres=mod.default;
    const sql=postgres(config.databaseUrl,{
      max:config.databasePoolMax,
      idle_timeout:30,
      connect_timeout:10,
      prepare:true,
      ssl:config.databaseSsl==="require"?"require":false,
      transform:{undefined:null}
    });
    await sql.unsafe("select 1 as ok");
    return new PostgresStore(sql,config,eventBus);
  }

  async close(){await this.sql.end({timeout:5});}

  async summary(from,to){
    const rows=await this.sql.unsafe(
      "SELECT COALESCE(sum(retail_service_amount_ttc),0)::float8 AS generated_revenue_ttc,"+
      " COALESCE(sum(expected_payout_ht),0)::float8 AS expected_payout_ht,"+
      " COALESCE(sum(confirmed_payout_ht),0)::float8 AS confirmed_payout_ht,"+
      " COALESCE(sum(paid_payout_ht),0)::float8 AS paid_payout_ht,"+
      " COALESCE(sum(estimated_margin_ht),0)::float8 AS estimated_margin_ht,"+
      " COALESCE(sum(reconciliation_variance_ht),0)::float8 AS reconciliation_variance_ht,"+
      " count(*)::int AS calls_total,"+
      " count(*) FILTER (WHERE call_status='connected')::int AS calls_connected,"+
      " count(*) FILTER (WHERE call_status='abandoned')::int AS calls_abandoned,"+
      " count(*) FILTER (WHERE call_status NOT IN ('connected','abandoned'))::int AS calls_failed,"+
      " COALESCE(sum(billable_seconds),0)::float8/60.0 AS billable_minutes,"+
      " COALESCE(sum(payout_eligible_seconds),0)::float8/60.0 AS payout_eligible_minutes,"+
      " COALESCE(avg(conversation_seconds) FILTER (WHERE call_status='connected'),0)::float8 AS acd_seconds"+
      " FROM calls WHERE started_at >= $1::timestamptz AND started_at <= $2::timestamptz",
      [from,to]
    );
    const presence=await this.sql.unsafe(
      "SELECT count(*) FILTER (WHERE status='available' AND enabled)::int AS active_experts,"+
      " COALESCE(sum(active_calls),0)::int AS live_calls FROM experts"
    );
    const r=rows[0],p=presence[0];
    return {
      ...r,
      asr_percent:r.calls_total?Number(r.calls_connected)/Number(r.calls_total)*100:0,
      active_experts:p.active_experts,
      live_calls:p.live_calls,
      queue_depth:0
    };
  }

  async listCalls(params={}){
    const limit=clampInt(params.limit,100,1,250);
    const cursor=decodeCursor(params.cursor);
    const values=[
      params.from||null,params.to||null,params.expert_id?Number(params.expert_id):null,
      params.origin_carrier||null,params.status||null,cursor?.started_at||null,cursor?.id||null,limit+1
    ];
    const rows=await this.sql.unsafe(
      "SELECT c.id,c.external_call_id,c.started_at,c.ivr_started_at,c.queued_at,c.bridged_at,c.ended_at,"+
      " ca.caller_masked,oc.name AS origin_carrier,hc.name AS host_carrier,sn.display_number AS sva_number,"+
      " e.id AS expert_id,e.display_name AS expert_name,c.wait_seconds,c.conversation_seconds,c.total_seconds,"+
      " c.billable_seconds,c.payout_eligible_seconds,c.call_status,c.sip_final_code,c.hangup_cause,c.codec,"+
      " c.service_rate_ttc_per_min::float8,c.carrier_rate_ht_per_min::float8,c.retail_service_amount_ttc::float8,"+
      " c.expected_payout_ht::float8,COALESCE(c.confirmed_payout_ht,0)::float8 AS confirmed_payout_ht,"+
      " c.paid_payout_ht::float8,c.expert_cost_ht::float8,c.technical_cost_ht::float8,c.estimated_margin_ht::float8,"+
      " c.reconciliation_variance_ht::float8,c.reconciliation_status,q.rtp_packet_loss_percent::float8 AS packet_loss_percent,"+
      " q.jitter_ms::float8,q.latency_ms::float8,q.mos::float8"+
      " FROM calls c LEFT JOIN callers ca ON ca.id=c.caller_id LEFT JOIN carriers oc ON oc.id=c.origin_carrier_id"+
      " LEFT JOIN carriers hc ON hc.id=c.host_carrier_id LEFT JOIN sva_numbers sn ON sn.id=c.sva_number_id"+
      " LEFT JOIN experts e ON e.id=c.expert_id LEFT JOIN call_quality q ON q.call_id=c.id"+
      " WHERE ($1::timestamptz IS NULL OR c.started_at >= $1::timestamptz)"+
      " AND ($2::timestamptz IS NULL OR c.started_at <= $2::timestamptz)"+
      " AND ($3::bigint IS NULL OR c.expert_id=$3)"+
      " AND ($4::text IS NULL OR oc.name=$4)"+
      " AND ($5::text IS NULL OR c.call_status=$5)"+
      " AND ($6::timestamptz IS NULL OR (c.started_at,c.id) < ($6::timestamptz,$7::bigint))"+
      " ORDER BY c.started_at DESC,c.id DESC LIMIT $8",
      values
    );
    const hasMore=rows.length>limit;
    const page=hasMore?rows.slice(0,limit):rows;
    const last=page.at(-1);
    return {
      data:page.map(x=>({...x,quality:x.packet_loss_percent==null?null:{
        packet_loss_percent:x.packet_loss_percent,jitter_ms:x.jitter_ms,latency_ms:x.latency_ms,mos:x.mos
      }})),
      next_cursor:hasMore&&last?encodeCursor({started_at:last.started_at,id:Number(last.id)}):null
    };
  }

  async listExperts(){
    return this.sql.unsafe(
      "SELECT id,code,display_name,destination_uri,status,active_calls,last_assigned_at,enabled,compensation_type,compensation_rate::float8"+
      " FROM experts ORDER BY display_name"
    );
  }

  async setExpertStatus(id,status){
    if(!["available","busy","away","offline"].includes(status))throw problem(400,"INVALID_STATUS");
    const result=await this.sql.begin(async tx=>{
      const rows=await tx.unsafe(
        "UPDATE experts SET status=$1 WHERE id=$2 RETURNING id,code,display_name,destination_uri,status,active_calls,last_assigned_at,enabled",
        [status,Number(id)]
      );
      const expert=rows[0];
      if(!expert)throw problem(404,"EXPERT_NOT_FOUND");
      await tx.unsafe("INSERT INTO expert_presence_events(expert_id,status,source) VALUES($1,$2,'api')",[expert.id,status]);
      await tx.unsafe(
        "INSERT INTO audit_log(action,entity_type,entity_id,details) VALUES('expert.status','expert',$1,$2::jsonb)",
        [String(expert.id),JSON.stringify({status})]
      );
      return expert;
    });
    this.eventBus.publish("expert.status",{id:result.id,status:result.status});
    return result;
  }

  async selectExpert(context={}){
    const svaNumber=String(context.svaNumber||"").trim();
    return this.sql.begin(async tx=>{
      let tenantId=null;
      if(svaNumber){
        const svaRows=await tx.unsafe(
          "SELECT id,tenant_id FROM sva_numbers WHERE (e164=$1 OR display_number=$1) AND status IN ('active','porting') LIMIT 1",
          [svaNumber]
        );
        const sva=svaRows[0];
        if(!sva)throw problem(404,"SVA_NUMBER_NOT_ROUTABLE");
        if(sva.tenant_id==null)throw problem(409,"SVA_TENANT_NOT_CONFIGURED");
        tenantId=Number(sva.tenant_id);
      }

      const rows=tenantId==null
        ?await tx.unsafe(
          "SELECT id,tenant_id,code,display_name,destination_uri,status,active_calls,last_assigned_at,enabled FROM experts"+
          " WHERE enabled AND status='available' AND destination_uri IS NOT NULL ORDER BY active_calls ASC,last_assigned_at NULLS FIRST,id ASC"+
          " LIMIT 1 FOR UPDATE SKIP LOCKED"
        )
        :await tx.unsafe(
          "SELECT id,tenant_id,code,display_name,destination_uri,status,active_calls,last_assigned_at,enabled FROM experts"+
          " WHERE tenant_id=$1 AND enabled AND status='available' AND destination_uri IS NOT NULL"+
          " ORDER BY active_calls ASC,last_assigned_at NULLS FIRST,id ASC LIMIT 1 FOR UPDATE SKIP LOCKED",
          [tenantId]
        );
      const expert=rows[0];
      if(!expert)return null;
      const updated=await tx.unsafe(
        "UPDATE experts SET last_assigned_at=now(),active_calls=active_calls+1,status='busy' WHERE id=$1"+
        (tenantId==null?"":" AND tenant_id=$2")+
        " RETURNING id,tenant_id,code,display_name,destination_uri,status,active_calls,last_assigned_at,enabled",
        tenantId==null?[expert.id]:[expert.id,tenantId]
      );
      return updated[0];
    });
  }

  async releaseExpert(id){
    const rows=await this.sql.unsafe(
      "UPDATE experts SET active_calls=GREATEST(active_calls-1,0),"+
      " status=CASE WHEN GREATEST(active_calls-1,0)=0 AND status='busy' THEN 'available' ELSE status END"+
      " WHERE id=$1 RETURNING id,code,display_name,destination_uri,status,active_calls,last_assigned_at,enabled",
      [Number(id)]
    );
    const expert=rows[0];
    if(!expert)throw problem(404,"EXPERT_NOT_FOUND");
    this.eventBus.publish("expert.released",{id:expert.id,status:expert.status,active_calls:expert.active_calls});
    return expert;
  }

  async ingestCdr(envelope){
    validateEnvelope(envelope);
    const p=sanitizeCdrPayload(envelope.payload||{});
    const payloadHash=createHash("sha256").update(JSON.stringify(p)).digest("hex");
    const result=await this.sql.begin(async tx=>{
      const inserted=await tx.unsafe(
        "INSERT INTO raw_cdr_events(source,source_event_id,event_time,payload,payload_sha256)"+
        " VALUES($1,$2,$3::timestamptz,$4::jsonb,$5) ON CONFLICT(source,source_event_id) DO NOTHING RETURNING id",
        [envelope.source,envelope.source_event_id,envelope.event_time||null,JSON.stringify(p),payloadHash]
      );
      if(!inserted.length)return {duplicate:true};
      if(!p.external_call_id||!p.started_at||!p.ended_at)throw problem(400,"CDR_REQUIRED_FIELDS_MISSING");

      const status=p.call_status||"connected";
      const conversation=Math.max(0,Number(p.conversation_seconds||0));

      let hostRows;
      if(p.host_carrier){
        hostRows=await tx.unsafe("SELECT id,name FROM carriers WHERE name=$1 AND kind='sva_host' LIMIT 1",[String(p.host_carrier)]);
      }else{
        hostRows=await tx.unsafe(
          "SELECT c.id,c.name FROM logical_carrier_routes r JOIN carriers c ON c.id=r.active_carrier_id"+
          " WHERE r.route_key='sva-primary'"
        );
      }
      const host=hostRows[0];
      if(!host)throw problem(409,"HOST_CARRIER_NOT_CONFIGURED");

      const originRows=await tx.unsafe(
        "INSERT INTO carriers(name,kind) VALUES($1,'origin_network')"+
        " ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id,name",
        [String(p.origin_carrier||"Unknown")]
      );
      const origin=originRows[0];

      const svaRows=await tx.unsafe(
        "SELECT id,e164,display_number,tenant_id,service_rate_ttc_per_min::float8 FROM sva_numbers WHERE e164=$1 OR display_number=$1 LIMIT 1",
        [String(p.sva_number||"")]
      );
      const sva=svaRows[0];
      if(!sva)throw problem(409,"SVA_NUMBER_NOT_CONFIGURED");
      if(sva.tenant_id==null)throw problem(409,"SVA_TENANT_NOT_CONFIGURED");

      const contractRows=await tx.unsafe(
        "SELECT id,payout_rate_ht_per_min::float8,mobile_deduction_ht_per_min::float8,"+
        " minimum_payable_seconds,billing_increment_seconds,payout_rounding,settlement_delay_days"+
        " FROM carrier_contracts WHERE carrier_id=$1"+
        " AND (sva_number_id IS NULL OR sva_number_id=$2)"+
        " AND valid_from <= $3::timestamptz::date"+
        " AND (valid_to IS NULL OR valid_to >= $3::timestamptz::date)"+
        " ORDER BY (sva_number_id IS NOT NULL) DESC,valid_from DESC,id DESC LIMIT 1",
        [host.id,sva.id,p.started_at]
      );
      const contract=contractRows[0]||null;
      if(this.config.requireCarrierContract&&!contract)throw problem(409,"CARRIER_CONTRACT_NOT_CONFIGURED");

      const serviceRate=Number(sva.service_rate_ttc_per_min??this.config.serviceRateTtcPerMin);
      const payoutRate=Number(contract?.payout_rate_ht_per_min??this.config.payoutRateHtPerMin);
      const mobileDeduction=Number(contract?.mobile_deduction_ht_per_min??0);
      const billingIncrement=Number(contract?.billing_increment_seconds??60);
      const minimumPayable=Number(contract?.minimum_payable_seconds??0);
      const payoutRounding=contract?.payout_rounding==="floor"?"floor":contract?.payout_rounding==="nearest"?"nearest":"ceil";
      const financial=status==="connected"?core.computeCallFinancials(
        {conversationSeconds:conversation,originType:p.origin_type||"unknown"},
        {
          serviceRateTtcPerMin:serviceRate,
          payoutRateHtPerMin:payoutRate,
          mobileDeductionHtPerMin:mobileDeduction,
          billingIncrementSeconds:billingIncrement,
          minimumPayableSeconds:minimumPayable,
          rounding:payoutRounding
        }
      ):{billableSeconds:0,payoutEligibleSeconds:0,serviceAmountTtc:0,expectedPayoutHt:0};

      let expert=null;
      if(p.expert_id!=null){
        const expertRows=await tx.unsafe(
          "SELECT id,tenant_id,compensation_type,compensation_rate::float8 FROM experts WHERE id=$1 AND enabled LIMIT 1",
          [Number(p.expert_id)]
        );
        expert=expertRows[0]||null;
        if(!expert)throw problem(409,"EXPERT_NOT_CONFIGURED");
        if(expert.tenant_id==null)throw problem(409,"EXPERT_TENANT_NOT_CONFIGURED");
        if(Number(sva.tenant_id)!==Number(expert.tenant_id))throw problem(409,"EXPERT_TENANT_MISMATCH");
      }

      const callerHash=deriveCallerHash(p,{key:this.config.callerHashKey,source:envelope.source,sourceEventId:envelope.source_event_id});
      const callerRows=await tx.unsafe(
        "INSERT INTO callers(caller_hash,caller_masked,first_seen_at,last_seen_at,call_count,total_conversation_seconds)"+
        " VALUES($1,$2,$3::timestamptz,$3::timestamptz,1,$4)"+
        " ON CONFLICT(caller_hash) DO UPDATE SET caller_masked=EXCLUDED.caller_masked,"+
        " last_seen_at=GREATEST(callers.last_seen_at,EXCLUDED.last_seen_at),call_count=callers.call_count+1,"+
        " total_conversation_seconds=callers.total_conversation_seconds+EXCLUDED.total_conversation_seconds RETURNING id",
        [callerHash,String(p.caller_masked||"Masqué"),p.started_at,conversation]
      );
      const caller=callerRows[0];

      const hasConfirmed=p.confirmed_payout_ht!=null;
      const confirmed=hasConfirmed?Number(p.confirmed_payout_ht):null;
      const paid=p.paid_payout_ht==null?0:Number(p.paid_payout_ht);
      const recon=hasConfirmed?core.reconcileAmounts(financial.expectedPayoutHt,confirmed,this.config.reconciliationToleranceHt):null;
      const expertCost=computeExpertCost({
        type:expert?.compensation_type||"none",
        rate:expert?.compensation_rate||0,
        billableSeconds:financial.billableSeconds,
        expectedPayoutHt:financial.expectedPayoutHt,
        connected:status==="connected"
      });
      const technicalCost=Number(this.config.technicalCostHtPerCall||0);
      const totalSeconds=Math.max(0,Number(p.total_seconds||Math.round((Date.parse(p.ended_at)-Date.parse(p.started_at))/1000)));

      const callValues=[
        String(p.external_call_id),envelope.source,caller.id,sva.id,expert?.id||null,origin.id,host.id,
        p.started_at,p.ivr_started_at||null,p.queued_at||null,p.bridged_at||null,p.ended_at,
        Math.max(0,Number(p.wait_seconds||0)),conversation,totalSeconds,financial.billableSeconds,financial.payoutEligibleSeconds,
        status,p.sip_final_code==null?null:Number(p.sip_final_code),String(p.hangup_cause||""),String(p.codec||""),
        serviceRate,payoutRate,mobileDeduction,
        financial.serviceAmountTtc,financial.expectedPayoutHt,confirmed,paid,expertCost,technicalCost,
        Math.max(0,(confirmed||0)-expertCost-technicalCost),recon?recon.status:"pending",recon?recon.varianceHt:0,sva.tenant_id||null
      ];
      const callRows=await tx.unsafe(
        "INSERT INTO calls(external_call_id,cdr_source,caller_id,sva_number_id,expert_id,origin_carrier_id,host_carrier_id,"+
        " started_at,ivr_started_at,queued_at,bridged_at,ended_at,wait_seconds,conversation_seconds,total_seconds,billable_seconds,"+
        " payout_eligible_seconds,call_status,sip_final_code,hangup_cause,codec,service_rate_ttc_per_min,carrier_rate_ht_per_min,"+
        " mobile_deduction_ht_per_min,retail_service_amount_ttc,expected_payout_ht,confirmed_payout_ht,paid_payout_ht,"+
        " expert_cost_ht,technical_cost_ht,estimated_margin_ht,reconciliation_status,reconciliation_variance_ht,tenant_id)"+
        " VALUES($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz,$10::timestamptz,$11::timestamptz,$12::timestamptz,"+
        " $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34)"+
        " ON CONFLICT(host_carrier_id,external_call_id) WHERE host_carrier_id IS NOT NULL AND external_call_id IS NOT NULL"+
        " DO NOTHING RETURNING id",
        callValues
      );
      const call=callRows[0];
      if(!call){
        await tx.unsafe("UPDATE raw_cdr_events SET processing_status='duplicate',processed_at=now() WHERE id=$1",[inserted[0].id]);
        return {duplicate:true};
      }

      if(p.quality){
        await tx.unsafe(
          "INSERT INTO call_quality(call_id,rtp_packet_loss_percent,jitter_ms,latency_ms,mos,dtmf_errors) VALUES($1,$2,$3,$4,$5,$6)",
          [call.id,nullableNumber(p.quality.packet_loss_percent),nullableNumber(p.quality.jitter_ms),nullableNumber(p.quality.latency_ms),nullableNumber(p.quality.mos),Number(p.quality.dtmf_errors||0)]
        );
      }
      if(financial.expectedPayoutHt!==0)await ledger(tx,call.id,sva.tenant_id,"expected",financial.expectedPayoutHt,envelope);
      if(confirmed!=null&&confirmed!==0)await ledger(tx,call.id,sva.tenant_id,"confirmed",confirmed,envelope);
      if(paid!==0)await ledger(tx,call.id,sva.tenant_id,"paid",paid,envelope);

      await tx.unsafe(
        "INSERT INTO outbox_events(event_type,aggregate_type,aggregate_id,payload) VALUES('call.ingested','call',$1,$2::jsonb)",
        [String(call.id),JSON.stringify({external_call_id:p.external_call_id})]
      );
      await tx.unsafe(
        "INSERT INTO audit_log(tenant_id,action,entity_type,entity_id,details) VALUES($1,'cdr.ingest','call',$2,$3::jsonb)",
        [sva.tenant_id||null,String(call.id),JSON.stringify({source:envelope.source})]
      );
      await tx.unsafe("UPDATE raw_cdr_events SET processing_status='processed',processed_at=now() WHERE id=$1",[inserted[0].id]);
      return {duplicate:false,call_id:call.id};
    });

    if(!result.duplicate)this.eventBus.publish("call.ingested",{id:result.call_id});
    return result;
  }

  async importSettlement(payload,actor){
    const settlement=normalizeSettlementPayload(payload);
    const result=await this.sql.begin(async tx=>{
      const carrierRows=await tx.unsafe(
        "SELECT id,name FROM carriers WHERE id=$1 AND enabled LIMIT 1",
        [settlement.carrier_id]
      );
      const carrier=carrierRows[0];
      if(!carrier)throw problem(404,"CARRIER_NOT_FOUND");

      const duplicate=await tx.unsafe(
        "SELECT id FROM carrier_settlements WHERE carrier_id=$1 AND period_start=$2::date AND period_end=$3::date LIMIT 1",
        [carrier.id,settlement.period_start,settlement.period_end]
      );
      if(duplicate.length)throw problem(409,"SETTLEMENT_PERIOD_EXISTS");

      const periodCalls=await tx.unsafe(
        "SELECT id,external_call_id,expected_payout_ht::float8,expert_cost_ht::float8,technical_cost_ht::float8"+
        " FROM calls WHERE host_carrier_id=$1 AND started_at::date BETWEEN $2::date AND $3::date",
        [carrier.id,settlement.period_start,settlement.period_end]
      );
      const byExternal=new Map(periodCalls.map(row=>[String(row.external_call_id),row]));
      const matched=settlement.matches.map(item=>{
        const call=byExternal.get(item.external_call_id);
        if(!call)throw problem(409,"SETTLEMENT_CALL_NOT_FOUND","Settlement call not found in carrier period: "+item.external_call_id);
        return {
          call_id:Number(call.id),
          external_call_id:item.external_call_id,
          amount:Number(item.carrier_amount_ht),
          expected:Number(call.expected_payout_ht||0)
        };
      });

      const expectedAmount=roundFinanceNumber(matched.reduce((sum,row)=>sum+row.expected,0));
      const confirmedAmount=roundFinanceNumber(matched.reduce((sum,row)=>sum+row.amount,0));
      const paidAmount=settlement.status==="paid"?confirmedAmount:0;

      const inserted=await tx.unsafe(
        "INSERT INTO carrier_settlements(carrier_id,period_start,period_end,statement_reference,invoice_reference,"+
        " expected_amount_ht,confirmed_amount_ht,paid_amount_ht,payment_due_date,paid_at,status,source_file_hash)"+
        " VALUES($1,$2::date,$3::date,$4,$5,$6,$7,$8,$9::date,$10::timestamptz,$11,$12)"+
        " RETURNING id,carrier_id,period_start,period_end,expected_amount_ht::float8,confirmed_amount_ht::float8,"+
        " paid_amount_ht::float8,status,statement_reference,invoice_reference,payment_due_date,paid_at,source_file_hash,created_at",
        [
          carrier.id,settlement.period_start,settlement.period_end,settlement.statement_reference,settlement.invoice_reference,
          expectedAmount,confirmedAmount,paidAmount,settlement.payment_due_date,settlement.paid_at,
          settlement.status,settlement.source_file_hash
        ]
      );
      const row=inserted[0];
      const matchJson=JSON.stringify(matched.map(x=>({call_id:x.call_id,amount:x.amount})));

      await tx.unsafe(
        "INSERT INTO settlement_call_matches(settlement_id,call_id,carrier_amount_ht)"+
        " SELECT $1,x.call_id,x.amount FROM jsonb_to_recordset($2::jsonb) AS x(call_id bigint,amount numeric)",
        [row.id,matchJson]
      );

      await tx.unsafe(
        "UPDATE calls c SET confirmed_payout_ht=x.amount,"+
        " paid_payout_ht=CASE WHEN $2::boolean THEN x.amount ELSE c.paid_payout_ht END,"+
        " reconciliation_variance_ht=c.expected_payout_ht-x.amount,"+
        " reconciliation_status=CASE WHEN abs(c.expected_payout_ht-x.amount) <= $3 THEN 'matched' ELSE 'variance' END,"+
        " estimated_margin_ht=GREATEST(x.amount-c.expert_cost_ht-c.technical_cost_ht,0)"+
        " FROM jsonb_to_recordset($1::jsonb) AS x(call_id bigint,amount numeric) WHERE c.id=x.call_id",
        [matchJson,settlement.status==="paid",this.config.reconciliationToleranceHt]
      );

      await tx.unsafe(
        "INSERT INTO financial_ledger(call_id,settlement_id,event_type,amount_ht,source_reference,source_hash,reason,created_by,metadata)"+
        " SELECT x.call_id,$1,'confirmed',x.amount,$2,$3,'carrier settlement import',$4,$5::jsonb"+
        " FROM jsonb_to_recordset($6::jsonb) AS x(call_id bigint,amount numeric) WHERE x.amount<>0",
        [
          row.id,settlement.statement_reference,settlement.source_file_hash,numericActor(actor),
          JSON.stringify({carrier:carrier.name,period_start:settlement.period_start,period_end:settlement.period_end}),matchJson
        ]
      );

      if(settlement.status==="paid"){
        await tx.unsafe(
          "INSERT INTO financial_ledger(call_id,settlement_id,event_type,amount_ht,source_reference,source_hash,reason,created_by,metadata)"+
          " SELECT x.call_id,$1,'paid',x.amount,$2,$3,'carrier settlement paid',$4,$5::jsonb"+
          " FROM jsonb_to_recordset($6::jsonb) AS x(call_id bigint,amount numeric) WHERE x.amount<>0",
          [
            row.id,settlement.statement_reference,settlement.source_file_hash,numericActor(actor),
            JSON.stringify({carrier:carrier.name}),matchJson
          ]
        );
      }

      await tx.unsafe(
        "INSERT INTO audit_log(user_id,action,entity_type,entity_id,details) VALUES($1,'settlement.import','carrier_settlement',$2,$3::jsonb)",
        [numericActor(actor),String(row.id),JSON.stringify({
          carrier_id:carrier.id,matches:matched.length,expected_amount_ht:expectedAmount,
          confirmed_amount_ht:confirmedAmount,status:settlement.status
        })]
      );
      await tx.unsafe(
        "INSERT INTO outbox_events(event_type,aggregate_type,aggregate_id,payload)"+
        " VALUES('settlement.imported','carrier_settlement',$1,$2::jsonb)",
        [String(row.id),JSON.stringify({carrier_id:carrier.id,status:settlement.status})]
      );

      return {...row,carrier_name:carrier.name,matches:matched.length};
    });
    this.eventBus.publish("settlement.imported",{id:result.id,carrier_id:result.carrier_id,status:result.status});
    return result;
  }

  async markSettlementPaid(id,payload,actor){
    const settlementId=Number(id);
    if(!Number.isInteger(settlementId)||settlementId<=0)throw problem(400,"INVALID_SETTLEMENT_ID");
    const paidAt=payload?.paid_at?new Date(payload.paid_at):new Date();
    if(!Number.isFinite(paidAt.getTime()))throw problem(400,"INVALID_PAID_AT");

    const result=await this.sql.begin(async tx=>{
      const rows=await tx.unsafe(
        "SELECT id,carrier_id,status,confirmed_amount_ht::float8,paid_amount_ht::float8 FROM carrier_settlements WHERE id=$1 FOR UPDATE",
        [settlementId]
      );
      const settlement=rows[0];
      if(!settlement)throw problem(404,"SETTLEMENT_NOT_FOUND");
      if(settlement.status==="paid")return {...settlement,changed:false};

      const matches=await tx.unsafe(
        "SELECT call_id,carrier_amount_ht::float8 AS amount FROM settlement_call_matches WHERE settlement_id=$1",
        [settlementId]
      );
      if(!matches.length)throw problem(409,"SETTLEMENT_HAS_NO_MATCHES");
      const matchJson=JSON.stringify(matches);

      const updated=await tx.unsafe(
        "UPDATE carrier_settlements SET paid_amount_ht=confirmed_amount_ht,paid_at=$2,status='paid' WHERE id=$1"+
        " RETURNING id,carrier_id,status,expected_amount_ht::float8,confirmed_amount_ht::float8,paid_amount_ht::float8,paid_at",
        [settlementId,paidAt.toISOString()]
      );

      await tx.unsafe(
        "UPDATE calls c SET paid_payout_ht=x.amount FROM jsonb_to_recordset($1::jsonb) AS x(call_id bigint,amount numeric)"+
        " WHERE c.id=x.call_id",
        [matchJson]
      );
      await tx.unsafe(
        "INSERT INTO financial_ledger(call_id,settlement_id,event_type,amount_ht,reason,created_by,metadata)"+
        " SELECT x.call_id,$1,'paid',x.amount,'carrier settlement marked paid',$2,$3::jsonb"+
        " FROM jsonb_to_recordset($4::jsonb) AS x(call_id bigint,amount numeric)"+
        " WHERE x.amount<>0 AND NOT EXISTS ("+
        " SELECT 1 FROM financial_ledger f WHERE f.settlement_id=$1 AND f.call_id=x.call_id AND f.event_type='paid')",
        [settlementId,numericActor(actor),JSON.stringify({paid_at:paidAt.toISOString()}),matchJson]
      );
      await tx.unsafe(
        "INSERT INTO audit_log(user_id,action,entity_type,entity_id,details) VALUES($1,'settlement.paid','carrier_settlement',$2,$3::jsonb)",
        [numericActor(actor),String(settlementId),JSON.stringify({paid_at:paidAt.toISOString()})]
      );
      await tx.unsafe(
        "INSERT INTO outbox_events(event_type,aggregate_type,aggregate_id,payload) VALUES('settlement.paid','carrier_settlement',$1,$2::jsonb)",
        [String(settlementId),JSON.stringify({paid_at:paidAt.toISOString()})]
      );

      return {...updated[0],changed:true};
    });
    if(result.changed)this.eventBus.publish("settlement.paid",{id:settlementId,paid_at:result.paid_at});
    return result;
  }

  async reconciliation(from,to){
    return this.sql.unsafe(
      "SELECT COALESCE(hc.name,'Unknown') AS carrier,count(*)::int AS calls,"+
      " COALESCE(sum(c.expected_payout_ht),0)::float8 AS expected_payout_ht,"+
      " COALESCE(sum(c.confirmed_payout_ht),0)::float8 AS confirmed_payout_ht,"+
      " COALESCE(sum(c.paid_payout_ht),0)::float8 AS paid_payout_ht,"+
      " COALESCE(sum(c.reconciliation_variance_ht),0)::float8 AS variance_ht,"+
      " count(*) FILTER(WHERE c.reconciliation_status='variance')::int AS variance_calls"+
      " FROM calls c LEFT JOIN carriers hc ON hc.id=c.host_carrier_id"+
      " WHERE c.started_at >= $1::timestamptz AND c.started_at <= $2::timestamptz"+
      " GROUP BY hc.name ORDER BY hc.name",
      [from,to]
    );
  }

  async listBaselines(params={}){
    const scope=params.scope||"global";
    if(!["global","expert","sva_number"].includes(scope))throw problem(400,"INVALID_SCOPE");
    const limit=clampInt(params.limit,20,1,100);
    return this.sql.unsafe(
      "SELECT id,scope,scope_id,reason,created_at,effective_from,created_by"+
      " FROM metric_baselines WHERE scope=$1 ORDER BY effective_from DESC,id DESC LIMIT $2",
      [scope,limit]
    );
  }

  async createBaseline(payload,actor){
    if(!["global","expert","sva_number"].includes(payload.scope))throw problem(400,"INVALID_SCOPE");
    const rows=await this.sql.unsafe(
      "INSERT INTO metric_baselines(created_by,scope,scope_id,reason,effective_from) VALUES($1,$2,$3,$4,now())"+
      " RETURNING id,scope,scope_id,reason,created_at,effective_from",
      [numericActor(actor),payload.scope,payload.scope_id==null?null:Number(payload.scope_id),String(payload.reason||"")]
    );
    const row=rows[0];
    await this.sql.unsafe(
      "INSERT INTO audit_log(user_id,action,entity_type,entity_id,details) VALUES($1,'baseline.create','metric_baseline',$2,$3::jsonb)",
      [numericActor(actor),String(row.id),JSON.stringify({scope:row.scope})]
    );
    this.eventBus.publish("baseline.created",{id:row.id,scope:row.scope});
    return row;
  }

  async carrierRouting(){
    const rows=await this.sql.unsafe(
      "SELECT r.route_key,r.generation,r.updated_at,a.name AS active_carrier,s.name AS standby_carrier,"+
      " ac.state AS active_connection_state,sc.state AS standby_connection_state"+
      " FROM logical_carrier_routes r LEFT JOIN carriers a ON a.id=r.active_carrier_id"+
      " LEFT JOIN carriers s ON s.id=r.standby_carrier_id LEFT JOIN carrier_connections ac ON ac.id=r.active_connection_id"+
      " LEFT JOIN carrier_connections sc ON sc.id=r.standby_connection_id WHERE r.route_key='sva-primary'"
    );
    return rows[0]||{route_key:"sva-primary",generation:1,active_carrier:null,standby_carrier:null};
  }

  async planCarrierSwitch(payload,actor){
    const connections=await this.sql.unsafe(
      "SELECT cc.id,cc.carrier_id,c.name AS carrier_name,cc.state FROM carrier_connections cc JOIN carriers c ON c.id=cc.carrier_id"+
      " WHERE cc.id=$1 AND cc.carrier_id=$2 AND cc.purpose='sip_inbound' AND cc.state IN ('ready','active','standby')",
      [Number(payload.connection_id),Number(payload.to_carrier_id)]
    );
    const connection=connections[0];
    if(!connection)throw problem(409,"TARGET_CONNECTION_NOT_READY");
    const routes=await this.sql.unsafe("SELECT active_carrier_id FROM logical_carrier_routes WHERE route_key=$1",[payload.route_key||"sva-primary"]);
    const route=routes[0];
    if(!route)throw problem(404,"ROUTE_NOT_FOUND");
    const rollbackMinutes=clampInt(payload.rollback_window_minutes,1440,5,10080);
    const rows=await this.sql.unsafe(
      "INSERT INTO carrier_switches(route_key,from_carrier_id,to_carrier_id,requested_by,scheduled_for,status,validation,notes)"+
      " VALUES($1,$2,$3,$4,$5::timestamptz,'ready',$6::jsonb,$7) RETURNING *",
      [payload.route_key||"sva-primary",route.active_carrier_id,connection.carrier_id,numericActor(actor),payload.scheduled_for||null,JSON.stringify({connection_id:connection.id,rollback_window_minutes:rollbackMinutes}),String(payload.notes||"")]
    );
    return rows[0];
  }

  async activateCarrierSwitch(id){
    const result=await this.sql.begin(async tx=>{
      const switchRows=await tx.unsafe("SELECT * FROM carrier_switches WHERE id=$1 FOR UPDATE",[Number(id)]);
      const sw=switchRows[0];
      if(!sw)throw problem(404,"SWITCH_NOT_FOUND");
      if(!["ready","planned"].includes(sw.status))throw problem(409,"SWITCH_NOT_READY");
      const connectionId=Number(sw.validation?.connection_id);
      const rollbackMinutes=clampInt(sw.validation?.rollback_window_minutes,1440,5,10080);
      const gens=await tx.unsafe("SELECT activate_logical_carrier_route($1,$2,$3) AS generation",[sw.route_key,sw.to_carrier_id,connectionId]);
      const updated=await tx.unsafe(
        "UPDATE carrier_switches SET status='completed',started_at=COALESCE(started_at,now()),completed_at=now(),"+
        " rollback_deadline=now()+make_interval(mins=>$1) WHERE id=$2 RETURNING *",
        [rollbackMinutes,sw.id]
      );
      await tx.unsafe("UPDATE carrier_connections SET state='active',updated_at=now() WHERE id=$1",[connectionId]);
      if(sw.from_carrier_id)await tx.unsafe(
        "UPDATE carrier_connections SET state='standby',updated_at=now() WHERE carrier_id=$1 AND purpose='sip_inbound' AND state='active'",
        [sw.from_carrier_id]
      );
      await tx.unsafe(
        "INSERT INTO audit_log(action,entity_type,entity_id,details) VALUES('carrier_switch.activate','carrier_switch',$1,$2::jsonb)",
        [String(sw.id),JSON.stringify({generation:gens[0].generation})]
      );
      return {switch:updated[0],route:await routeWith(tx,sw.route_key)};
    });
    this.eventBus.publish("carrier.switched",{id:Number(id),active:result.route.active_carrier,generation:result.route.generation});
    return result;
  }

  async rollbackCarrierSwitch(id){
    const result=await this.sql.begin(async tx=>{
      const switchRows=await tx.unsafe("SELECT * FROM carrier_switches WHERE id=$1 FOR UPDATE",[Number(id)]);
      const sw=switchRows[0];
      if(!sw)throw problem(404,"SWITCH_NOT_FOUND");
      if(sw.status!=="completed")throw problem(409,"SWITCH_NOT_COMPLETED");
      if(sw.rollback_deadline&&Date.now()>Date.parse(sw.rollback_deadline))throw problem(409,"ROLLBACK_WINDOW_EXPIRED");
      const routeRows=await tx.unsafe("SELECT * FROM logical_carrier_routes WHERE route_key=$1 FOR UPDATE",[sw.route_key]);
      const route=routeRows[0];
      if(!route?.standby_carrier_id||!route?.standby_connection_id)throw problem(409,"NO_STANDBY_ROUTE");
      await tx.unsafe("SELECT activate_logical_carrier_route($1,$2,$3)",[sw.route_key,route.standby_carrier_id,route.standby_connection_id]);
      const updated=await tx.unsafe("UPDATE carrier_switches SET status='rolled_back' WHERE id=$1 RETURNING *",[sw.id]);
      await tx.unsafe(
        "INSERT INTO audit_log(action,entity_type,entity_id,details) VALUES('carrier_switch.rollback','carrier_switch',$1,'{}'::jsonb)",
        [String(sw.id)]
      );
      return {switch:updated[0],route:await routeWith(tx,sw.route_key)};
    });
    this.eventBus.publish("carrier.rollback",{id:Number(id),active:result.route.active_carrier,generation:result.route.generation});
    return result;
  }

  async idempotent(key,operation,requestBody,fn){
    if(!key)throw problem(400,"IDEMPOTENCY_KEY_REQUIRED");
    const requestHash=createHash("sha256").update(JSON.stringify(requestBody??null)).digest("hex");
    const claimed=await this.sql.unsafe(
      "INSERT INTO api_idempotency_keys(idempotency_key,operation,request_sha256,expires_at)"+
      " VALUES($1::uuid,$2,$3,now()+interval '24 hours') ON CONFLICT(idempotency_key) DO NOTHING RETURNING idempotency_key",
      [key,operation,requestHash]
    );
    if(!claimed.length){
      const rows=await this.sql.unsafe(
        "SELECT operation,request_sha256,response_status,response_body FROM api_idempotency_keys WHERE idempotency_key=$1::uuid",
        [key]
      );
      const existing=rows[0];
      if(!existing||existing.operation!==operation||existing.request_sha256!==requestHash)throw problem(409,"IDEMPOTENCY_KEY_REUSED");
      if(existing.response_status==null)throw problem(409,"IDEMPOTENCY_REQUEST_IN_PROGRESS");
      return {replayed:true,value:existing.response_body};
    }
    try{
      const value=await fn();
      await this.sql.unsafe(
        "UPDATE api_idempotency_keys SET response_status=200,response_body=$1::jsonb WHERE idempotency_key=$2::uuid",
        [JSON.stringify(value),key]
      );
      return {replayed:false,value};
    }catch(error){
      await this.sql.unsafe("DELETE FROM api_idempotency_keys WHERE idempotency_key=$1::uuid AND response_status IS NULL",[key]);
      throw error;
    }
  }

  async drainOutbox(handler,limit=100){
    const claimed=await this.sql.begin(async tx=>{
      const rows=await tx.unsafe(
        "SELECT id,event_type,aggregate_type,aggregate_id,payload,created_at,attempts FROM outbox_events"+
        " WHERE published_at IS NULL AND available_at<=now() ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED",
        [limit]
      );
      if(rows.length)await tx.unsafe(
        "UPDATE outbox_events SET attempts=attempts+1,available_at=now()+interval '30 seconds' WHERE id=ANY($1::bigint[])",
        [rows.map(x=>Number(x.id))]
      );
      return rows;
    });
    let published=0;
    for(const event of claimed){
      try{
        await handler(event);
        await this.sql.unsafe("UPDATE outbox_events SET published_at=now(),last_error=NULL WHERE id=$1",[event.id]);
        published++;
      }catch(error){
        await this.sql.unsafe("UPDATE outbox_events SET last_error=$1 WHERE id=$2",[String(error?.message||"handler failed").slice(0,500),event.id]);
      }
    }
    const rows=await this.sql.unsafe("SELECT count(*)::int AS count FROM outbox_events WHERE published_at IS NULL");
    return {processed:claimed.length,published,pending:rows[0].count};
  }

  async systemSnapshot(){
    const [counts,last,route]=await Promise.all([
      this.sql.unsafe(
        "SELECT count(*)::int AS calls_total,(SELECT count(*)::int FROM experts WHERE enabled AND status='available') AS experts_available,"+
        " (SELECT count(*)::int FROM outbox_events WHERE published_at IS NULL) AS outbox_pending FROM calls"
      ),
      this.sql.unsafe("SELECT ended_at FROM calls ORDER BY ended_at DESC LIMIT 1"),
      this.carrierRouting()
    ]);
    return {
      mode:this.config.mode,store:"postgres",
      calls_total:counts[0].calls_total,experts_available:counts[0].experts_available,
      cdr_lag_seconds:last[0]?Math.max(0,(Date.now()-Date.parse(last[0].ended_at))/1000):0,
      outbox_pending:counts[0].outbox_pending,event_subscribers:this.eventBus.size,carrier_route:route
    };
  }

  async metrics(){
    const [calls,outbox]=await Promise.all([
      this.sql.unsafe("SELECT count(*)::int AS calls_total,count(*) FILTER(WHERE call_status='connected')::int AS calls_connected FROM calls"),
      this.sql.unsafe("SELECT count(*)::int AS outbox_pending FROM outbox_events WHERE published_at IS NULL")
    ]);
    return {...calls[0],...outbox[0],event_subscribers:this.eventBus.size};
  }
}

async function ledger(tx,callId,tenantId,type,amount,envelope){
  await tx.unsafe(
    "INSERT INTO financial_ledger(tenant_id,call_id,event_type,amount_ht,source_reference,metadata) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
    [tenantId||null,callId,type,amount,envelope.source_event_id,JSON.stringify({source:envelope.source})]
  );
}
async function routeWith(sql,key){
  const rows=await sql.unsafe(
    "SELECT r.route_key,r.generation,r.updated_at,a.name AS active_carrier,s.name AS standby_carrier,"+
    " ac.state AS active_connection_state,sc.state AS standby_connection_state"+
    " FROM logical_carrier_routes r LEFT JOIN carriers a ON a.id=r.active_carrier_id"+
    " LEFT JOIN carriers s ON s.id=r.standby_carrier_id LEFT JOIN carrier_connections ac ON ac.id=r.active_connection_id"+
    " LEFT JOIN carrier_connections sc ON sc.id=r.standby_connection_id WHERE r.route_key=$1",
    [key]
  );
  return rows[0];
}
function roundFinanceNumber(value){
  return Math.round((Number(value)+Number.EPSILON)*1e6)/1e6;
}
function numericActor(actor){
  const n=Number(actor?.sub);
  return Number.isInteger(n)&&n>0?n:null;
}
function nullableNumber(v){
  if(v==null||v==="")return null;
  const n=Number(v);return Number.isFinite(n)?n:null;
}
function clampInt(v,fallback,min,max){
  const n=v==null||v===""?fallback:Number(v);
  if(!Number.isInteger(n))return fallback;
  return Math.max(min,Math.min(max,n));
}
function encodeCursor(x){return Buffer.from(JSON.stringify(x)).toString("base64url");}
function decodeCursor(v){
  if(!v)return null;
  try{
    const x=JSON.parse(Buffer.from(String(v),"base64url").toString("utf8"));
    if(!x.started_at||!Number.isInteger(Number(x.id)))return null;
    return {started_at:x.started_at,id:Number(x.id)};
  }catch{return null;}
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
function problem(status,code,message=code){
  const e=new Error(message);e.status=status;e.code=code;return e;
}
