
import {createHash} from "node:crypto";
import {normalizeFrenchSvaRio,rioFingerprint,encryptPortabilityCredential} from "./portability-identity.mjs";
import {sanitizeCdrPayload,deriveCallerHash} from "./cdr-privacy.mjs";
import {computeExpertCost} from "./expert-finance.mjs";
import {normalizeSettlementPayload} from "./settlement-finance.mjs";
import {computeTenantCallDistribution,summarizeTenantDistribution} from "./tenant-revenue-finance.mjs";
import {resolveBillingCurrency} from "./billing-country-currency.mjs";
import {normalizeVoiceServiceInput,validateVoiceFlow,simulateVoiceFlow,voiceFlowChecksum} from "./voice-studio-domain.mjs";
import {evaluateOperationalPolicy} from "./operational-policy.mjs";
import {simulateDigitalTwin} from "./digital-twin.mjs";
import {assessShadowBilling} from "./shadow-billing.mjs";
import {assessOperationalRisk} from "./risk-engine.mjs";
import {assessOperationalSlo} from "./slo-assurance.mjs";
import {relationCaseDeadlines,relationNextActions,relationActionPolicy,sanitizeRelationPayload,safeAgentContext,RELATION_POLICY_VERSION} from "./customer-relations-policy.mjs";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const core=require("../../assets/core.js");

const CONSUMPTION_RECEIPT_SCHEMA="audiotel-consumption-receipt/1";
const CONSUMPTION_METRIC_KEYS=["calls","minutes","revenue","payout","quality"];
function roundMetric(value){const n=Number(value||0);return Number.isFinite(n)?Math.round(n*1e6)/1e6:0;}
function normalizeConsumptionRanges(ranges,from,to){
  const out={};
  for(const key of CONSUMPTION_METRIC_KEYS){
    const r=ranges?.[key]||{};
    out[key]={from:r.from||from,to:r.to||to,baseline:r.baseline||null,empty:Boolean(r.empty)};
  }
  return out;
}
function consumptionSnapshot(data,from,to,ranges){
  const financial=Array.isArray(data?.financial_by_currency)?data.financial_by_currency:[],currency=data?.tenant?.default_currency||financial[0]?.currency||"EUR";
  let calls=0,connected=0,abandoned=0,failed=0,billable=0,updatedAt=null;
  for(const row of financial){
    calls+=Number(row.calls_total||0);connected+=Number(row.calls_connected||0);abandoned+=Number(row.calls_abandoned||0);failed+=Number(row.calls_failed||0);billable+=Number(row.billable_seconds||0);
    if(row.updated_at&&(!updatedAt||Date.parse(row.updated_at)>Date.parse(updatedAt)))updatedAt=row.updated_at;
  }
  const revenue=financial.filter(x=>x.currency===currency).reduce((a,x)=>a+Number(x.generated_revenue_ttc||0),0);
  const payoutRows=Array.isArray(data?.metric_net_payout_by_currency)?data.metric_net_payout_by_currency:[];
  const payout=payoutRows.filter(x=>x.currency===currency).reduce((a,x)=>a+Number(x.net_payout_ht||0),0);
  return {
    schema_version:CONSUMPTION_RECEIPT_SCHEMA,
    range:{from,to},
    tenant_timezone:data?.tenant?.timezone||"Europe/Paris",
    metric_ranges:normalizeConsumptionRanges(ranges,from,to),
    metrics:{
      currency,
      calls_total:Math.trunc(calls),
      calls_connected:Math.trunc(connected),
      calls_abandoned:Math.trunc(abandoned),
      calls_failed:Math.trunc(failed),
      billable_seconds:roundMetric(billable),
      generated_revenue_ttc:roundMetric(revenue),
      net_payout_ht:roundMetric(payout)
    },
    source_updated_at:updatedAt||null
  };
}
function consumptionSnapshotHash(snapshot){
  const canonical={schema_version:snapshot.schema_version,range:snapshot.range,tenant_timezone:snapshot.tenant_timezone,metric_ranges:snapshot.metric_ranges,metrics:snapshot.metrics};
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
function publicConsumptionReceipt(row){
  if(!row)return null;
  const publicId=String(row.public_id);
  return {
    public_id:publicId,reference:"CR-"+publicId.slice(0,8).toUpperCase(),
    requested_from:row.requested_from,requested_to:row.requested_to,tenant_timezone:row.tenant_timezone,
    metrics:row.metrics,metric_ranges:row.metric_ranges,snapshot_sha256:row.snapshot_sha256,
    source_updated_at:row.source_updated_at,created_at:row.created_at
  };
}
function consumptionDiff(stored,current){
  const keys=["calls_total","calls_connected","calls_abandoned","calls_failed","billable_seconds","generated_revenue_ttc","net_payout_ht"],out=[];
  if(String(stored.currency||"")!==String(current.currency||""))out.push({metric:"currency",stored:stored.currency,current:current.currency,difference:null});
  for(const key of keys){
    const a=Number(stored[key]||0),b=Number(current[key]||0),d=roundMetric(b-a);
    if(Math.abs(d)>0.000001)out.push({metric:key,stored:a,current:b,difference:d});
  }
  return out;
}

export class PostgresStore{
  constructor(sql,config,eventBus,readSql=null){
    this.sql=sql;
    this.readSql=readSql||sql;
    this.config=config;
    this.eventBus=eventBus;
  }

  static async connect(config,eventBus){
    const mod=await import("postgres");
    const postgres=mod.default;
    const makeClient=(url,max)=>postgres(url,{
      max,
      idle_timeout:30,
      connect_timeout:10,
      prepare:true,
      ssl:config.databaseSsl==="require"?"require":false,
      transform:{undefined:null}
    });
    const sql=makeClient(config.databaseUrl,config.databasePoolMax);
    await sql.unsafe("select 1 as ok");
    let readSql=sql;
    if(config.databaseReadUrl){
      readSql=makeClient(config.databaseReadUrl,config.databaseReadPoolMax);
      await readSql.unsafe("select 1 as ok");
    }
    return new PostgresStore(sql,config,eventBus,readSql);
  }

  async close(){
    if(this.readSql!==this.sql)await this.readSql.end({timeout:5});
    await this.sql.end({timeout:5});
  }

  async summary(from,to,market=null){
    const rows=await this.readSql.unsafe(
      "WITH bounds AS ("+
      " SELECT $1::timestamptz AS from_ts,$2::timestamptz AS to_ts,"+
      " CASE WHEN $1::timestamptz=date_trunc('hour',$1::timestamptz)"+
      " THEN $1::timestamptz ELSE date_trunc('hour',$1::timestamptz)+interval '1 hour' END AS full_from,"+
      " date_trunc('hour',$2::timestamptz) AS full_to,"+
      " (SELECT id FROM operating_markets WHERE country_code=$3) AS market_id"+
      "), rollup_rows AS ("+
      " SELECT r.currency,r.calls_total,r.calls_connected,r.calls_abandoned,r.calls_failed,r.conversation_seconds,"+
      " r.billable_seconds,r.payout_eligible_seconds,r.generated_revenue_ttc,r.expected_payout_ht,"+
      " r.confirmed_payout_ht,r.paid_payout_ht,r.expert_cost_ht,r.technical_cost_ht,"+
      " r.estimated_margin_ht,r.reconciliation_variance_ht"+
      " FROM platform_rollups_hourly_sharded r CROSS JOIN bounds b"+
      " WHERE b.full_to>b.full_from AND r.bucket_start>=b.full_from AND r.bucket_start<b.full_to"+
      " AND ($3::text IS NULL OR r.market_id=b.market_id)"+
      "), edge_rows AS ("+
      " SELECT f.currency,1::bigint AS calls_total,"+
      " (f.call_status='connected')::int::bigint AS calls_connected,"+
      " (f.call_status='abandoned')::int::bigint AS calls_abandoned,"+
      " (f.call_status NOT IN ('connected','abandoned'))::int::bigint AS calls_failed,"+
      " f.conversation_seconds::bigint,f.billable_seconds::bigint,f.payout_eligible_seconds::bigint,"+
      " f.retail_service_amount_ttc AS generated_revenue_ttc,f.expected_payout_ht,f.confirmed_payout_ht,"+
      " f.paid_payout_ht,f.expert_cost_ht,f.technical_cost_ht,f.estimated_margin_ht,f.reconciliation_variance_ht"+
      " FROM call_facts f CROSS JOIN bounds b"+
      " WHERE f.started_at>=b.from_ts AND f.started_at<=b.to_ts"+
      " AND NOT (b.full_to>b.full_from AND f.started_at>=b.full_from AND f.started_at<b.full_to)"+
      " AND ($3::text IS NULL OR f.market_id=b.market_id)"+
      "), combined AS ("+
      " SELECT * FROM rollup_rows UNION ALL SELECT * FROM edge_rows"+
      ") SELECT"+
      " CASE WHEN count(DISTINCT currency)<=1 THEN COALESCE(sum(generated_revenue_ttc),0)::float8 ELSE NULL END AS generated_revenue_ttc,"+
      " CASE WHEN count(DISTINCT currency)<=1 THEN COALESCE(sum(expected_payout_ht),0)::float8 ELSE NULL END AS expected_payout_ht,"+
      " CASE WHEN count(DISTINCT currency)<=1 THEN COALESCE(sum(confirmed_payout_ht),0)::float8 ELSE NULL END AS confirmed_payout_ht,"+
      " CASE WHEN count(DISTINCT currency)<=1 THEN COALESCE(sum(paid_payout_ht),0)::float8 ELSE NULL END AS paid_payout_ht,"+
      " CASE WHEN count(DISTINCT currency)<=1 THEN COALESCE(sum(estimated_margin_ht),0)::float8 ELSE NULL END AS estimated_margin_ht,"+
      " CASE WHEN count(DISTINCT currency)<=1 THEN COALESCE(sum(reconciliation_variance_ht),0)::float8 ELSE NULL END AS reconciliation_variance_ht,"+
      " COALESCE(sum(calls_total),0)::bigint AS calls_total,"+
      " COALESCE(sum(calls_connected),0)::bigint AS calls_connected,"+
      " COALESCE(sum(calls_abandoned),0)::bigint AS calls_abandoned,"+
      " COALESCE(sum(calls_failed),0)::bigint AS calls_failed,"+
      " COALESCE(sum(billable_seconds),0)::float8/60.0 AS billable_minutes,"+
      " COALESCE(sum(payout_eligible_seconds),0)::float8/60.0 AS payout_eligible_minutes,"+
      " COALESCE(sum(expert_cost_ht),0)::float8 AS expert_cost_ht,"+
      " COALESCE(sum(technical_cost_ht),0)::float8 AS technical_cost_ht,"+
      " count(DISTINCT currency)::int AS currency_count,min(currency) AS currency,"+
      " CASE WHEN COALESCE(sum(calls_connected),0)>0"+
      " THEN COALESCE(sum(conversation_seconds),0)::float8/sum(calls_connected) ELSE 0 END AS acd_seconds"+
      " FROM combined",
      [from,to,market||null]
    );
    const [presence,liveFinancial]=await Promise.all([
      this.readSql.unsafe(
        "SELECT count(*) FILTER (WHERE status='available' AND enabled)::int AS active_experts,"+
        " COALESCE(sum(active_calls),0)::int AS live_calls FROM experts"
      ),
      this.liveFinancialSnapshot(null,null)
    ]);
    const r=numberFields(rows[0],[
      "calls_total","calls_connected","calls_abandoned","calls_failed","currency_count"
    ]);
    const p=numberFields(presence[0],["active_experts","live_calls"]);
    const liveSingle=liveFinancial.currency_count===1?liveFinancial.by_currency[0]||null:null;
    return {
      ...r,
      mixed_currency:r.currency_count>1,
      asr_percent:r.calls_total?r.calls_connected/r.calls_total*100:0,
      active_experts:p.active_experts,
      live_calls:Math.max(p.live_calls,liveFinancial.active_calls),
      queue_depth:0,
      live_currency_count:liveFinancial.currency_count,
      live_mixed_currency:liveFinancial.currency_count>1,
      live_currency:liveSingle?.currency||null,
      live_upstream_payout_ht:liveSingle?.estimated_upstream_payout_ht??null,
      live_client_net_ht:liveSingle?.estimated_client_net_ht??null,
      live_service_revenue_ttc:liveSingle?.estimated_service_revenue_ttc??null,
      live_upstream_rate_ht_per_second:liveSingle?.upstream_rate_ht_per_second??null,
      live_client_rate_ht_per_second:liveSingle?.client_rate_ht_per_second??null,
      live_service_rate_ttc_per_second:liveSingle?.service_rate_ttc_per_second??null,
      live_as_of:liveFinancial.as_of,
      live_financial_by_currency:liveFinancial.by_currency
    };
  }

  async liveFinancialSnapshot(tenantId=null,market=null){
    const rows=await this.readSql.unsafe(
      "SELECT l.currency,count(*)::int AS active_calls,"+
      " COALESCE(sum(LEAST(86400,GREATEST(0,EXTRACT(EPOCH FROM (now()-l.billable_started_at))))/60.0*l.service_rate_ttc_per_min),0)::float8 AS estimated_service_revenue_ttc,"+
      " COALESCE(sum(LEAST(86400,GREATEST(0,EXTRACT(EPOCH FROM (now()-l.billable_started_at))))/60.0*l.upstream_payout_rate_ht_per_min),0)::float8 AS estimated_upstream_payout_ht,"+
      " COALESCE(sum(LEAST(86400,GREATEST(0,EXTRACT(EPOCH FROM (now()-l.billable_started_at))))/60.0*l.net_client_rate_ht_per_min),0)::float8 AS estimated_client_net_ht,"+
      " COALESCE(sum(l.service_rate_ttc_per_min)/60.0,0)::float8 AS service_rate_ttc_per_second,"+
      " COALESCE(sum(l.upstream_payout_rate_ht_per_min)/60.0,0)::float8 AS upstream_rate_ht_per_second,"+
      " COALESCE(sum(l.net_client_rate_ht_per_min)/60.0,0)::float8 AS client_rate_ht_per_second"+
      " FROM live_call_financial_sessions l LEFT JOIN operating_markets m ON m.id=l.market_id"+
      " WHERE l.status='active' AND l.billable_started_at>now()-interval '24 hours'"+
      " AND ($1::bigint IS NULL OR l.tenant_id=$1) AND ($2::text IS NULL OR m.country_code=$2)"+
      " GROUP BY l.currency ORDER BY l.currency",
      [tenantId==null?null:Number(tenantId),market||null]
    );
    const byCurrency=rows.map(row=>numberFields(row,[
      "active_calls","estimated_service_revenue_ttc","estimated_upstream_payout_ht","estimated_client_net_ht",
      "service_rate_ttc_per_second","upstream_rate_ht_per_second","client_rate_ht_per_second"
    ]));
    return {
      as_of:new Date().toISOString(),
      active_calls:byCurrency.reduce((sum,row)=>sum+Number(row.active_calls||0),0),
      currency_count:byCurrency.length,
      by_currency:byCurrency
    };
  }


  async customerJackpotSnapshot(tenantId){
    const id=Number(tenantId);
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_CONTEXT");
    const tenantRows=await this.readSql.unsafe("SELECT id,default_currency,created_at FROM tenants WHERE id=$1",[id]);
    const tenant=tenantRows[0];if(!tenant)throw problem(404,"TENANT_NOT_FOUND");
    const resetRows=await this.readSql.unsafe("SELECT effective_from FROM customer_jackpot_baselines WHERE tenant_id=$1 ORDER BY effective_from DESC,id DESC LIMIT 1",[id]);
    const resetAt=new Date(resetRows[0]?.effective_from||tenant.created_at).toISOString();
    const rows=await this.withTenantReadContext(id,async tx=>tx.unsafe(
      "SELECT currency,count(*) FILTER(WHERE status='active')::int AS active_calls,count(*) FILTER(WHERE status='ended')::int AS completed_calls,"+
      " COALESCE(sum(CASE WHEN COALESCE(ended_at,now())>GREATEST(billable_started_at,$1::timestamptz) THEN LEAST(86400,GREATEST(0,EXTRACT(EPOCH FROM (COALESCE(ended_at,now())-GREATEST(billable_started_at,$1::timestamptz)))))/60.0*net_client_rate_ht_per_min ELSE 0 END),0)::float8 AS jackpot_client_net_ht,"+
      " COALESCE(sum(CASE WHEN status='active' AND now()>GREATEST(billable_started_at,$1::timestamptz) THEN LEAST(86400,GREATEST(0,EXTRACT(EPOCH FROM (now()-GREATEST(billable_started_at,$1::timestamptz)))))/60.0*net_client_rate_ht_per_min ELSE 0 END),0)::float8 AS live_client_net_ht,"+
      " COALESCE(sum(net_client_rate_ht_per_min) FILTER(WHERE status='active')/60.0,0)::float8 AS client_rate_ht_per_second"+
      " FROM tenant_scoped_live_call_financial_sessions WHERE status IN ('active','ended') AND COALESCE(ended_at,now())>$1::timestamptz AND billable_started_at<=now() GROUP BY currency ORDER BY currency",[resetAt]
    ));
    const byCurrency=rows.map(row=>numberFields(row,["active_calls","completed_calls","jackpot_client_net_ht","live_client_net_ht","client_rate_ht_per_second"]));
    return {as_of:new Date().toISOString(),reset_at:resetAt,default_currency:tenant.default_currency||"EUR",currency_count:byCurrency.length,by_currency:byCurrency,estimate:true,accounting_impact:"none"};
  }

  async liveFinancialByTenant(limit=50){
    const safe=clampInt(limit,50,1,100);
    const rows=await this.readSql.unsafe(
      "SELECT t.public_id AS tenant_public_id,t.display_name,l.currency,count(*)::int AS active_calls,"+
      " COALESCE(sum(LEAST(86400,GREATEST(0,EXTRACT(EPOCH FROM (now()-l.billable_started_at))))/60.0*l.upstream_payout_rate_ht_per_min),0)::float8 AS generated_upstream_payout_ht,"+
      " COALESCE(sum(LEAST(86400,GREATEST(0,EXTRACT(EPOCH FROM (now()-l.billable_started_at))))/60.0*l.net_client_rate_ht_per_min),0)::float8 AS generated_client_net_ht,"+
      " COALESCE(sum(LEAST(86400,GREATEST(0,EXTRACT(EPOCH FROM (now()-l.billable_started_at))))/60.0*GREATEST(0,l.upstream_payout_rate_ht_per_min-l.net_client_rate_ht_per_min)),0)::float8 AS pgi_margin_ht,"+
      " COALESCE(sum(l.upstream_payout_rate_ht_per_min)/60.0,0)::float8 AS upstream_rate_ht_per_second,"+
      " COALESCE(sum(l.net_client_rate_ht_per_min)/60.0,0)::float8 AS client_rate_ht_per_second,"+
      " COALESCE(sum(GREATEST(0,l.upstream_payout_rate_ht_per_min-l.net_client_rate_ht_per_min))/60.0,0)::float8 AS pgi_margin_rate_ht_per_second"+
      " FROM live_call_financial_sessions l JOIN tenants t ON t.id=l.tenant_id WHERE l.status='active' AND l.billable_started_at>now()-interval '24 hours'"+
      " GROUP BY t.public_id,t.display_name,l.currency ORDER BY generated_upstream_payout_ht DESC,t.display_name LIMIT $1",[safe]
    );
    const data=rows.map(row=>numberFields(row,["active_calls","generated_upstream_payout_ht","generated_client_net_ht","pgi_margin_ht","upstream_rate_ht_per_second","client_rate_ht_per_second","pgi_margin_rate_ht_per_second"]));
    return {as_of:new Date().toISOString(),active_calls:data.reduce((a,x)=>a+Number(x.active_calls||0),0),by_client:data};
  }

  async dashboardAnalytics(from,to,market=null){
    const durationMs=Math.max(0,Date.parse(to)-Date.parse(from));
    const granularity=durationMs>14*86400000?"day":"hour";
    const baseCte=
      "WITH bounds AS ("+
      " SELECT $1::timestamptz AS from_ts,$2::timestamptz AS to_ts,"+
      " CASE WHEN $1::timestamptz=date_trunc('hour',$1::timestamptz) THEN $1::timestamptz"+
      " ELSE date_trunc('hour',$1::timestamptz)+interval '1 hour' END AS full_from,"+
      " date_trunc('hour',$2::timestamptz) AS full_to,"+
      " (SELECT id FROM operating_markets WHERE country_code=$3) AS market_id"+
      "), base AS ("+
      " SELECT r.bucket_start AS ts,r.currency,r.calls_total,r.calls_connected,r.calls_abandoned,r.calls_failed,"+
      " r.conversation_seconds,r.billable_seconds,r.payout_eligible_seconds,r.generated_revenue_ttc,r.expected_payout_ht,"+
      " r.confirmed_payout_ht,r.paid_payout_ht,r.expert_cost_ht,r.technical_cost_ht,r.estimated_margin_ht,r.reconciliation_variance_ht"+
      " FROM platform_rollups_hourly_sharded r CROSS JOIN bounds b"+
      " WHERE b.full_to>b.full_from AND r.bucket_start>=b.full_from AND r.bucket_start<b.full_to"+
      " AND ($3::text IS NULL OR r.market_id=b.market_id)"+
      " UNION ALL"+
      " SELECT f.started_at AS ts,f.currency,1::bigint,"+
      " (f.call_status='connected')::int::bigint,(f.call_status='abandoned')::int::bigint,"+
      " (f.call_status NOT IN ('connected','abandoned'))::int::bigint,"+
      " f.conversation_seconds::bigint,f.billable_seconds::bigint,f.payout_eligible_seconds::bigint,"+
      " f.retail_service_amount_ttc,f.expected_payout_ht,f.confirmed_payout_ht,f.paid_payout_ht,"+
      " f.expert_cost_ht,f.technical_cost_ht,f.estimated_margin_ht,f.reconciliation_variance_ht"+
      " FROM call_facts f CROSS JOIN bounds b"+
      " WHERE f.started_at>=b.from_ts AND f.started_at<=b.to_ts"+
      " AND NOT (b.full_to>b.full_from AND f.started_at>=b.full_from AND f.started_at<b.full_to)"+
      " AND ($3::text IS NULL OR f.market_id=b.market_id)"+
      ") ";

    const [series,hours,weekdays,heatmap,quality,qualitySeries,experience,experienceSeries,dimensions]=await Promise.all([
      this.readSql.unsafe(
        baseCte+
        "SELECT date_trunc($4::text,ts) AS bucket,min(currency) AS currency,count(DISTINCT currency)::int AS currency_count,"+
        " sum(calls_total)::bigint AS calls_total,sum(calls_connected)::bigint AS calls_connected,"+
        " sum(calls_abandoned)::bigint AS calls_abandoned,sum(calls_failed)::bigint AS calls_failed,"+
        " sum(conversation_seconds)::bigint AS conversation_seconds,sum(billable_seconds)::bigint AS billable_seconds,"+
        " sum(payout_eligible_seconds)::bigint AS payout_eligible_seconds,"+
        " CASE WHEN count(DISTINCT currency)<=1 THEN sum(generated_revenue_ttc)::float8 ELSE NULL END AS revenue,"+
        " CASE WHEN count(DISTINCT currency)<=1 THEN sum(expected_payout_ht)::float8 ELSE NULL END AS expected_payout,"+
        " CASE WHEN count(DISTINCT currency)<=1 THEN sum(confirmed_payout_ht)::float8 ELSE NULL END AS confirmed_payout,"+
        " CASE WHEN count(DISTINCT currency)<=1 THEN sum(paid_payout_ht)::float8 ELSE NULL END AS paid_payout,"+
        " CASE WHEN count(DISTINCT currency)<=1 THEN sum(expert_cost_ht)::float8 ELSE NULL END AS expert_cost,"+
        " CASE WHEN count(DISTINCT currency)<=1 THEN sum(technical_cost_ht)::float8 ELSE NULL END AS technical_cost,"+
        " CASE WHEN count(DISTINCT currency)<=1 THEN sum(estimated_margin_ht)::float8 ELSE NULL END AS margin,"+
        " CASE WHEN count(DISTINCT currency)<=1 THEN sum(reconciliation_variance_ht)::float8 ELSE NULL END AS reconciliation_variance"+
        " FROM base GROUP BY date_trunc($4::text,ts) ORDER BY bucket",
        [from,to,market||null,granularity]
      ),
      this.readSql.unsafe(
        baseCte+
        "SELECT EXTRACT(hour FROM ts)::int AS hour,sum(calls_total)::bigint AS calls_total,"+
        " sum(calls_connected)::bigint AS calls_connected,sum(billable_seconds)::bigint AS billable_seconds"+
        " FROM base GROUP BY EXTRACT(hour FROM ts) ORDER BY hour",
        [from,to,market||null]
      ),
      this.readSql.unsafe(
        baseCte+
        "SELECT EXTRACT(isodow FROM ts)::int AS weekday,sum(calls_total)::bigint AS calls_total,"+
        " sum(calls_connected)::bigint AS calls_connected,sum(billable_seconds)::bigint AS billable_seconds"+
        " FROM base GROUP BY EXTRACT(isodow FROM ts) ORDER BY weekday",
        [from,to,market||null]
      ),
      this.readSql.unsafe(
        baseCte+
        "SELECT EXTRACT(isodow FROM ts)::int AS weekday,EXTRACT(hour FROM ts)::int AS hour,"+
        " sum(calls_total)::bigint AS calls_total"+
        " FROM base GROUP BY EXTRACT(isodow FROM ts),EXTRACT(hour FROM ts) ORDER BY weekday,hour",
        [from,to,market||null]
      ),
      this.readSql.unsafe(
        "WITH bounds AS ("+
        " SELECT $1::timestamptz AS from_ts,$2::timestamptz AS to_ts,"+
        " CASE WHEN $1::timestamptz=date_trunc('hour',$1::timestamptz) THEN $1::timestamptz"+
        " ELSE date_trunc('hour',$1::timestamptz)+interval '1 hour' END AS full_from,"+
        " date_trunc('hour',$2::timestamptz) AS full_to,"+
        " (SELECT id FROM operating_markets WHERE country_code=$3) AS market_id"+
        "), qbase AS ("+
        " SELECT r.quality_samples,r.mos_sum,r.packet_loss_sum,r.jitter_ms_sum,r.latency_ms_sum,r.dtmf_errors,r.affected_samples,r.low_mos_samples"+
        " FROM quality_rollups_hourly_sharded r CROSS JOIN bounds b"+
        " WHERE b.full_to>b.full_from AND r.bucket_start>=b.full_from AND r.bucket_start<b.full_to"+
        " AND ($3::text IS NULL OR r.market_id=b.market_id)"+
        " UNION ALL"+
        " SELECT 1::bigint,COALESCE(q.mos,0),COALESCE(q.rtp_packet_loss_percent,0),COALESCE(q.jitter_ms,0),COALESCE(q.latency_ms,0),COALESCE(q.dtmf_errors,0)::bigint,"+
        " (COALESCE(q.rtp_packet_loss_percent,0)>=5 OR COALESCE(q.jitter_ms,0)>5 OR COALESCE(q.latency_ms,0)>150)::int::bigint,"+
        " (q.mos IS NOT NULL AND q.mos<3.5)::int::bigint"+
        " FROM calls c JOIN call_quality q ON q.call_id=c.id CROSS JOIN bounds b"+
        " WHERE c.started_at>=b.from_ts AND c.started_at<=b.to_ts"+
        " AND NOT (b.full_to>b.full_from AND c.started_at>=b.full_from AND c.started_at<b.full_to)"+
        " AND ($3::text IS NULL OR c.market_id=b.market_id)"+
        ") SELECT COALESCE(sum(quality_samples),0)::bigint AS samples,"+
        " CASE WHEN sum(quality_samples)>0 THEN (sum(mos_sum)/sum(quality_samples))::float8 ELSE NULL END AS mos,"+
        " CASE WHEN sum(quality_samples)>0 THEN (sum(packet_loss_sum)/sum(quality_samples))::float8 ELSE NULL END AS packet_loss_percent,"+
        " CASE WHEN sum(quality_samples)>0 THEN (sum(jitter_ms_sum)/sum(quality_samples))::float8 ELSE NULL END AS jitter_ms,"+
        " CASE WHEN sum(quality_samples)>0 THEN (sum(latency_ms_sum)/sum(quality_samples))::float8 ELSE NULL END AS latency_ms,"+
        " COALESCE(sum(dtmf_errors),0)::bigint AS dtmf_errors,"+
        " COALESCE(sum(affected_samples),0)::bigint AS affected_samples,COALESCE(sum(low_mos_samples),0)::bigint AS low_mos_samples FROM qbase",
        [from,to,market||null]
      ),
      this.readSql.unsafe(
        "WITH bounds AS ("+
        " SELECT $1::timestamptz AS from_ts,$2::timestamptz AS to_ts,"+
        " CASE WHEN $1::timestamptz=date_trunc('hour',$1::timestamptz) THEN $1::timestamptz"+
        " ELSE date_trunc('hour',$1::timestamptz)+interval '1 hour' END AS full_from,"+
        " date_trunc('hour',$2::timestamptz) AS full_to,"+
        " (SELECT id FROM operating_markets WHERE country_code=$3) AS market_id"+
        "), qbase AS ("+
        " SELECT r.bucket_start AS ts,r.quality_samples,r.mos_sum,r.packet_loss_sum,r.jitter_ms_sum,r.latency_ms_sum,r.dtmf_errors,r.affected_samples,r.low_mos_samples"+
        " FROM quality_rollups_hourly_sharded r CROSS JOIN bounds b"+
        " WHERE b.full_to>b.full_from AND r.bucket_start>=b.full_from AND r.bucket_start<b.full_to"+
        " AND ($3::text IS NULL OR r.market_id=b.market_id)"+
        " UNION ALL"+
        " SELECT c.started_at AS ts,1::bigint,COALESCE(q.mos,0),COALESCE(q.rtp_packet_loss_percent,0),"+
        " COALESCE(q.jitter_ms,0),COALESCE(q.latency_ms,0),COALESCE(q.dtmf_errors,0)::bigint,"+
        " (COALESCE(q.rtp_packet_loss_percent,0)>=5 OR COALESCE(q.jitter_ms,0)>5 OR COALESCE(q.latency_ms,0)>150)::int::bigint,"+
        " (q.mos IS NOT NULL AND q.mos<3.5)::int::bigint"+
        " FROM calls c JOIN call_quality q ON q.call_id=c.id CROSS JOIN bounds b"+
        " WHERE c.started_at>=b.from_ts AND c.started_at<=b.to_ts"+
        " AND NOT (b.full_to>b.full_from AND c.started_at>=b.full_from AND c.started_at<b.full_to)"+
        " AND ($3::text IS NULL OR c.market_id=b.market_id)"+
        ") SELECT date_trunc($4::text,ts) AS bucket,COALESCE(sum(quality_samples),0)::bigint AS samples,"+
        " CASE WHEN sum(quality_samples)>0 THEN (sum(mos_sum)/sum(quality_samples))::float8 ELSE NULL END AS mos,"+
        " CASE WHEN sum(quality_samples)>0 THEN (sum(packet_loss_sum)/sum(quality_samples))::float8 ELSE NULL END AS packet_loss_percent,"+
        " CASE WHEN sum(quality_samples)>0 THEN (sum(jitter_ms_sum)/sum(quality_samples))::float8 ELSE NULL END AS jitter_ms,"+
        " CASE WHEN sum(quality_samples)>0 THEN (sum(latency_ms_sum)/sum(quality_samples))::float8 ELSE NULL END AS latency_ms,"+
        " COALESCE(sum(dtmf_errors),0)::bigint AS dtmf_errors,COALESCE(sum(affected_samples),0)::bigint AS affected_samples,"+
        " COALESCE(sum(low_mos_samples),0)::bigint AS low_mos_samples"+
        " FROM qbase GROUP BY date_trunc($4::text,ts) ORDER BY bucket",
        [from,to,market||null,granularity]
      ),
      this.readSql.unsafe(
        "WITH bounds AS ("+
        " SELECT $1::timestamptz AS from_ts,$2::timestamptz AS to_ts,"+
        " CASE WHEN $1::timestamptz=date_trunc('hour',$1::timestamptz) THEN $1::timestamptz"+
        " ELSE date_trunc('hour',$1::timestamptz)+interval '1 hour' END AS full_from,"+
        " date_trunc('hour',$2::timestamptz) AS full_to,"+
        " (SELECT id FROM operating_markets WHERE country_code=$3) AS market_id"+
        "), ebase AS ("+
        " SELECT r.calls_total,r.calls_connected,r.calls_abandoned,r.wait_seconds_sum,r.wait_connected_seconds_sum,"+
        " r.wait_abandoned_seconds_sum,r.answered_le_20s,r.abandoned_le_10s,r.ivr_seconds_sum,r.ivr_samples,"+
        " r.queue_seconds_sum,r.queue_samples,r.wait_le_10s,r.wait_10_20s,r.wait_20_30s,r.wait_30_60s,r.wait_60_120s,r.wait_gt_120s"+
        " FROM experience_rollups_hourly_sharded r CROSS JOIN bounds b"+
        " WHERE b.full_to>b.full_from AND r.bucket_start>=b.full_from AND r.bucket_start<b.full_to"+
        " AND ($3::text IS NULL OR r.market_id=b.market_id)"+
        " UNION ALL"+
        " SELECT 1::bigint,(c.call_status='connected')::int::bigint,(c.call_status='abandoned')::int::bigint,"+
        " c.wait_seconds::bigint,(CASE WHEN c.call_status='connected' THEN c.wait_seconds ELSE 0 END)::bigint,"+
        " (CASE WHEN c.call_status='abandoned' THEN c.wait_seconds ELSE 0 END)::bigint,"+
        " (c.call_status='connected' AND c.wait_seconds<=20)::int::bigint,"+
        " (c.call_status='abandoned' AND c.wait_seconds<=10)::int::bigint,"+
        " (CASE WHEN c.queued_at IS NOT NULL AND c.ivr_started_at IS NOT NULL THEN GREATEST(0,EXTRACT(EPOCH FROM (c.queued_at-c.ivr_started_at))) ELSE 0 END)::bigint,"+
        " (c.queued_at IS NOT NULL AND c.ivr_started_at IS NOT NULL)::int::bigint,"+
        " (CASE WHEN c.queued_at IS NOT NULL THEN GREATEST(0,EXTRACT(EPOCH FROM (COALESCE(c.bridged_at,c.ended_at)-c.queued_at))) ELSE 0 END)::bigint,"+
        " (c.queued_at IS NOT NULL)::int::bigint,(c.wait_seconds<=10)::int::bigint,"+
        " (c.wait_seconds>10 AND c.wait_seconds<=20)::int::bigint,(c.wait_seconds>20 AND c.wait_seconds<=30)::int::bigint,"+
        " (c.wait_seconds>30 AND c.wait_seconds<=60)::int::bigint,(c.wait_seconds>60 AND c.wait_seconds<=120)::int::bigint,"+
        " (c.wait_seconds>120)::int::bigint"+
        " FROM calls c CROSS JOIN bounds b"+
        " WHERE c.started_at>=b.from_ts AND c.started_at<=b.to_ts"+
        " AND NOT (b.full_to>b.full_from AND c.started_at>=b.full_from AND c.started_at<b.full_to)"+
        " AND ($3::text IS NULL OR c.market_id=b.market_id)"+
        ") SELECT COALESCE(sum(calls_total),0)::bigint AS samples,COALESCE(sum(calls_connected),0)::bigint AS connected,"+
        " COALESCE(sum(calls_abandoned),0)::bigint AS abandoned,"+
        " CASE WHEN sum(calls_total)>0 THEN sum(wait_seconds_sum)::float8/sum(calls_total) ELSE 0 END AS avg_wait_seconds,"+
        " CASE WHEN sum(calls_connected)>0 THEN sum(wait_connected_seconds_sum)::float8/sum(calls_connected) ELSE 0 END AS avg_answered_wait_seconds,"+
        " CASE WHEN sum(calls_abandoned)>0 THEN sum(wait_abandoned_seconds_sum)::float8/sum(calls_abandoned) ELSE 0 END AS avg_abandoned_wait_seconds,"+
        " CASE WHEN sum(calls_connected)>0 THEN sum(answered_le_20s)::float8/sum(calls_connected)*100 ELSE 0 END AS answered_le_20s_percent,"+
        " CASE WHEN sum(calls_abandoned)>0 THEN sum(abandoned_le_10s)::float8/sum(calls_abandoned)*100 ELSE 0 END AS abandoned_le_10s_percent,"+
        " CASE WHEN sum(ivr_samples)>0 THEN sum(ivr_seconds_sum)::float8/sum(ivr_samples) ELSE 0 END AS avg_ivr_seconds,"+
        " CASE WHEN sum(queue_samples)>0 THEN sum(queue_seconds_sum)::float8/sum(queue_samples) ELSE 0 END AS avg_queue_seconds,"+
        " COALESCE(sum(wait_le_10s),0)::bigint AS wait_le_10s,COALESCE(sum(wait_10_20s),0)::bigint AS wait_10_20s,"+
        " COALESCE(sum(wait_20_30s),0)::bigint AS wait_20_30s,COALESCE(sum(wait_30_60s),0)::bigint AS wait_30_60s,"+
        " COALESCE(sum(wait_60_120s),0)::bigint AS wait_60_120s,COALESCE(sum(wait_gt_120s),0)::bigint AS wait_gt_120s"+
        " FROM ebase",
        [from,to,market||null]
      ),
      this.readSql.unsafe(
        "WITH bounds AS ("+
        " SELECT $1::timestamptz AS from_ts,$2::timestamptz AS to_ts,"+
        " CASE WHEN $1::timestamptz=date_trunc('hour',$1::timestamptz) THEN $1::timestamptz"+
        " ELSE date_trunc('hour',$1::timestamptz)+interval '1 hour' END AS full_from,"+
        " date_trunc('hour',$2::timestamptz) AS full_to,"+
        " (SELECT id FROM operating_markets WHERE country_code=$3) AS market_id"+
        "), ebase AS ("+
        " SELECT r.bucket_start AS ts,r.calls_total,r.calls_connected,r.calls_abandoned,r.wait_seconds_sum,r.wait_connected_seconds_sum,"+
        " r.wait_abandoned_seconds_sum,r.answered_le_20s,r.abandoned_le_10s,r.queue_seconds_sum,r.queue_samples"+
        " FROM experience_rollups_hourly_sharded r CROSS JOIN bounds b"+
        " WHERE b.full_to>b.full_from AND r.bucket_start>=b.full_from AND r.bucket_start<b.full_to"+
        " AND ($3::text IS NULL OR r.market_id=b.market_id)"+
        " UNION ALL"+
        " SELECT c.started_at AS ts,1::bigint,(c.call_status='connected')::int::bigint,(c.call_status='abandoned')::int::bigint,"+
        " c.wait_seconds::bigint,(CASE WHEN c.call_status='connected' THEN c.wait_seconds ELSE 0 END)::bigint,"+
        " (CASE WHEN c.call_status='abandoned' THEN c.wait_seconds ELSE 0 END)::bigint,"+
        " (c.call_status='connected' AND c.wait_seconds<=20)::int::bigint,(c.call_status='abandoned' AND c.wait_seconds<=10)::int::bigint,"+
        " (CASE WHEN c.queued_at IS NOT NULL THEN GREATEST(0,EXTRACT(EPOCH FROM (COALESCE(c.bridged_at,c.ended_at)-c.queued_at))) ELSE 0 END)::bigint,"+
        " (c.queued_at IS NOT NULL)::int::bigint"+
        " FROM calls c CROSS JOIN bounds b"+
        " WHERE c.started_at>=b.from_ts AND c.started_at<=b.to_ts"+
        " AND NOT (b.full_to>b.full_from AND c.started_at>=b.full_from AND c.started_at<b.full_to)"+
        " AND ($3::text IS NULL OR c.market_id=b.market_id)"+
        ") SELECT date_trunc($4::text,ts) AS bucket,COALESCE(sum(calls_total),0)::bigint AS samples,"+
        " CASE WHEN sum(calls_total)>0 THEN sum(wait_seconds_sum)::float8/sum(calls_total) ELSE 0 END AS avg_wait_seconds,"+
        " CASE WHEN sum(calls_connected)>0 THEN sum(answered_le_20s)::float8/sum(calls_connected)*100 ELSE 0 END AS answered_le_20s_percent,"+
        " CASE WHEN sum(calls_abandoned)>0 THEN sum(abandoned_le_10s)::float8/sum(calls_abandoned)*100 ELSE 0 END AS abandoned_le_10s_percent,"+
        " CASE WHEN sum(queue_samples)>0 THEN sum(queue_seconds_sum)::float8/sum(queue_samples) ELSE 0 END AS avg_queue_seconds"+
        " FROM ebase GROUP BY date_trunc($4::text,ts) ORDER BY bucket",
        [from,to,market||null,granularity]
      ),
      this.readSql.unsafe(
        "SELECT d.dimension_type,d.dimension_key,max(d.dimension_label) AS dimension_label,"+
        " sum(d.calls_total)::bigint AS calls_total,sum(d.calls_connected)::bigint AS calls_connected,"+
        " sum(d.conversation_seconds)::bigint AS conversation_seconds,sum(d.billable_seconds)::bigint AS billable_seconds,"+
        " CASE WHEN count(DISTINCT d.currency)<=1 THEN sum(d.generated_revenue_ttc)::float8 ELSE NULL END AS revenue,"+
        " CASE WHEN count(DISTINCT d.currency)<=1 THEN sum(d.expected_payout_ht)::float8 ELSE NULL END AS expected_payout,"+
        " CASE WHEN count(DISTINCT d.currency)<=1 THEN sum(d.estimated_margin_ht)::float8 ELSE NULL END AS margin"+
        " FROM dashboard_dimension_rollups_daily d LEFT JOIN operating_markets m ON m.id=d.market_id"+
        " WHERE d.bucket_date BETWEEN $1::timestamptz::date AND $2::timestamptz::date"+
        " AND ($3::text IS NULL OR m.country_code=$3)"+
        " GROUP BY d.dimension_type,d.dimension_key"+
        " ORDER BY d.dimension_type,calls_total DESC",
        [from,to,market||null]
      )
    ]);

    const countKeys=["calls_total","calls_connected","calls_abandoned","calls_failed","conversation_seconds","billable_seconds","payout_eligible_seconds","currency_count"];
    const dimensionKeys=["calls_total","calls_connected","conversation_seconds","billable_seconds"];
    const normalizedDimensions=dimensions.map(row=>numberFields(row,dimensionKeys));
    const byType={expert:[],carrier:[],duration:[]};
    for(const row of normalizedDimensions)if(byType[row.dimension_type])byType[row.dimension_type].push(row);
    return {
      granularity,
      series:series.map(row=>numberFields(row,countKeys)),
      hours:hours.map(row=>numberFields(row,["hour","calls_total","calls_connected","billable_seconds"])),
      weekdays:weekdays.map(row=>numberFields(row,["weekday","calls_total","calls_connected","billable_seconds"])),
      heatmap:heatmap.map(row=>numberFields(row,["weekday","hour","calls_total"])),
      quality:quality[0]?numberFields(quality[0],["samples","dtmf_errors","affected_samples","low_mos_samples"]):{samples:0,mos:null,packet_loss_percent:null,jitter_ms:null,latency_ms:null,dtmf_errors:0,affected_samples:0,low_mos_samples:0},
      quality_series:qualitySeries.map(row=>numberFields(row,["samples","dtmf_errors","affected_samples","low_mos_samples"])),
      experience:experience[0]?numberFields(experience[0],["samples","connected","abandoned","wait_le_10s","wait_10_20s","wait_20_30s","wait_30_60s","wait_60_120s","wait_gt_120s"]):{samples:0},
      experience_series:experienceSeries.map(row=>numberFields(row,["samples"])),
      experts:byType.expert.slice(0,50),
      carriers:byType.carrier.slice(0,50),
      durations:byType.duration
    };
  }

  async voiceIntelligence(from,to,market=null){
    const commonCte=
      "WITH bounds AS ("+
      " SELECT $1::timestamptz AS from_ts,$2::timestamptz AS to_ts,"+
      " CASE WHEN $1::timestamptz=date_trunc('hour',$1::timestamptz) THEN $1::timestamptz ELSE date_trunc('hour',$1::timestamptz)+interval '1 hour' END AS full_from,"+
      " date_trunc('hour',$2::timestamptz) AS full_to,(SELECT id FROM operating_markets WHERE country_code=$3) AS market_id"+
      "), vbase AS ("+
      " SELECT r.carrier_role,r.carrier_id,r.calls_total,r.calls_connected,r.calls_failed,r.pdd_samples,r.pdd_ms_sum,r.high_pdd_calls,"+
      " r.quality_samples,r.network_affected_calls,r.low_mos_calls,r.mos_sum,r.packet_loss_sum,r.jitter_ms_sum,r.latency_ms_sum,r.rtt_ms_sum,"+
      " r.sip_4xx_calls,r.sip_5xx_calls,r.caller_hangups,r.callee_hangups,r.network_hangups"+
      " FROM voice_carrier_health_hourly_sharded r CROSS JOIN bounds b"+
      " WHERE b.full_to>b.full_from AND r.bucket_start>=b.full_from AND r.bucket_start<b.full_to"+
      " AND ($3::text IS NULL OR r.market_id=b.market_id)"+
      " UNION ALL"+
      " SELECT cr.carrier_role,cr.carrier_id,1::bigint,(c.call_status='connected')::int::bigint,"+
      " (c.call_status NOT IN ('connected','abandoned'))::int::bigint,(c.post_dial_delay_ms IS NOT NULL)::int::bigint,"+
      " COALESCE(c.post_dial_delay_ms,0)::bigint,(COALESCE(c.post_dial_delay_ms,0)>8000)::int::bigint,(q.call_id IS NOT NULL)::int::bigint,"+
      " (q.call_id IS NOT NULL AND (COALESCE(q.rtp_packet_loss_percent,0)>=5 OR COALESCE(q.jitter_ms,0)>5 OR COALESCE(q.latency_ms,0)>150))::int::bigint,"+
      " (q.call_id IS NOT NULL AND q.mos IS NOT NULL AND q.mos<3.5)::int::bigint,COALESCE(q.mos,0),COALESCE(q.rtp_packet_loss_percent,0),"+
      " COALESCE(q.jitter_ms,0),COALESCE(q.latency_ms,0),COALESCE(q.rtt_ms,0),(c.sip_final_code BETWEEN 400 AND 499)::int::bigint,"+
      " (c.sip_final_code BETWEEN 500 AND 599)::int::bigint,(c.hangup_party='caller')::int::bigint,(c.hangup_party='callee')::int::bigint,"+
      " (c.hangup_party='network')::int::bigint"+
      " FROM calls c LEFT JOIN call_quality q ON q.call_id=c.id CROSS JOIN bounds b"+
      " CROSS JOIN LATERAL (VALUES ('origin'::text,c.origin_carrier_id),('host'::text,c.host_carrier_id)) AS cr(carrier_role,carrier_id)"+
      " WHERE c.started_at>=b.from_ts AND c.started_at<=b.to_ts"+
      " AND NOT (b.full_to>b.full_from AND c.started_at>=b.full_from AND c.started_at<b.full_to)"+
      " AND cr.carrier_id IS NOT NULL AND ($3::text IS NULL OR c.market_id=b.market_id)"+
      ") ";

    const aggregateSql=
      "SELECT COALESCE(sum(calls_total),0)::bigint AS calls_total,COALESCE(sum(calls_connected),0)::bigint AS calls_connected,"+
      " COALESCE(sum(calls_failed),0)::bigint AS calls_failed,COALESCE(sum(pdd_samples),0)::bigint AS pdd_samples,"+
      " CASE WHEN sum(pdd_samples)>0 THEN sum(pdd_ms_sum)::float8/sum(pdd_samples) ELSE NULL END AS avg_pdd_ms,"+
      " COALESCE(sum(high_pdd_calls),0)::bigint AS high_pdd_calls,COALESCE(sum(quality_samples),0)::bigint AS quality_samples,"+
      " COALESCE(sum(network_affected_calls),0)::bigint AS network_affected_calls,COALESCE(sum(low_mos_calls),0)::bigint AS low_mos_calls,"+
      " CASE WHEN sum(quality_samples)>0 THEN sum(mos_sum)::float8/sum(quality_samples) ELSE NULL END AS mos,"+
      " CASE WHEN sum(quality_samples)>0 THEN sum(packet_loss_sum)::float8/sum(quality_samples) ELSE NULL END AS packet_loss_percent,"+
      " CASE WHEN sum(quality_samples)>0 THEN sum(jitter_ms_sum)::float8/sum(quality_samples) ELSE NULL END AS jitter_ms,"+
      " CASE WHEN sum(quality_samples)>0 THEN sum(latency_ms_sum)::float8/sum(quality_samples) ELSE NULL END AS latency_ms,"+
      " CASE WHEN sum(quality_samples)>0 THEN sum(rtt_ms_sum)::float8/sum(quality_samples) ELSE NULL END AS rtt_ms,"+
      " COALESCE(sum(sip_4xx_calls),0)::bigint AS sip_4xx_calls,COALESCE(sum(sip_5xx_calls),0)::bigint AS sip_5xx_calls,"+
      " COALESCE(sum(caller_hangups),0)::bigint AS caller_hangups,COALESCE(sum(callee_hangups),0)::bigint AS callee_hangups,"+
      " COALESCE(sum(network_hangups),0)::bigint AS network_hangups";

    const [summaryRows,carrierRows,sipRows,incidentRows]=await Promise.all([
      this.readSql.unsafe(commonCte+aggregateSql+" FROM vbase WHERE carrier_role='host'",[from,to,market||null]),
      this.readSql.unsafe(
        commonCte+"SELECT v.carrier_role,v.carrier_id,c.name AS carrier,"+aggregateSql.replace(/^SELECT /,"")+
        " FROM vbase v JOIN carriers c ON c.id=v.carrier_id GROUP BY v.carrier_role,v.carrier_id,c.name ORDER BY v.carrier_role,calls_total DESC LIMIT 100",
        [from,to,market||null]
      ),
      this.readSql.unsafe(
        "WITH bounds AS (SELECT $1::timestamptz AS from_ts,$2::timestamptz AS to_ts,"+
        " CASE WHEN $1::timestamptz=date_trunc('hour',$1::timestamptz) THEN $1::timestamptz ELSE date_trunc('hour',$1::timestamptz)+interval '1 hour' END AS full_from,"+
        " date_trunc('hour',$2::timestamptz) AS full_to,(SELECT id FROM operating_markets WHERE country_code=$3) AS market_id), s AS ("+
        " SELECT r.sip_final_code,r.calls_total FROM voice_sip_code_hourly_sharded r CROSS JOIN bounds b"+
        " WHERE b.full_to>b.full_from AND r.bucket_start>=b.full_from AND r.bucket_start<b.full_to AND ($3::text IS NULL OR r.market_id=b.market_id)"+
        " UNION ALL SELECT c.sip_final_code,1::bigint FROM calls c CROSS JOIN bounds b"+
        " WHERE c.sip_final_code BETWEEN 100 AND 699 AND c.started_at>=b.from_ts AND c.started_at<=b.to_ts"+
        " AND NOT (b.full_to>b.full_from AND c.started_at>=b.full_from AND c.started_at<b.full_to)"+
        " AND ($3::text IS NULL OR c.market_id=b.market_id))"+
        " SELECT sip_final_code,COALESCE(sum(calls_total),0)::bigint AS calls_total FROM s GROUP BY sip_final_code ORDER BY calls_total DESC,sip_final_code LIMIT 20",
        [from,to,market||null]
      ),
      this.readSql.unsafe(
        "SELECT i.id,i.incident_type,i.severity,i.carrier_role,c.name AS carrier,m.country_code AS market,i.state,i.title,i.details,"+
        " i.started_at,i.last_detected_at,i.resolved_at FROM telecom_incidents i"+
        " LEFT JOIN carriers c ON c.id=i.carrier_id LEFT JOIN operating_markets m ON m.id=i.market_id"+
        " WHERE ($1::text IS NULL OR m.country_code=$1) ORDER BY (i.state='open') DESC,i.last_detected_at DESC LIMIT 50",
        [market||null]
      )
    ]);
    const keys=["calls_total","calls_connected","calls_failed","pdd_samples","avg_pdd_ms","high_pdd_calls","quality_samples","network_affected_calls","low_mos_calls","mos","packet_loss_percent","jitter_ms","latency_ms","rtt_ms","sip_4xx_calls","sip_5xx_calls","caller_hangups","callee_hangups","network_hangups"];
    const summary=numberFields(summaryRows[0]||{},keys);
    const carriers=carrierRows.map(row=>numberFields(row,keys));
    return {
      summary,
      carriers,
      sip_codes:sipRows.map(row=>numberFields(row,["sip_final_code","calls_total"])),
      incidents:incidentRows.map(row=>({...row,id:Number(row.id)}))
    };
  }

  async scanVoiceIncidents(){
    const rows=await this.sql.unsafe(
      "SELECT r.market_id,r.carrier_id,c.name AS carrier,COALESCE(sum(r.calls_total),0)::bigint AS calls_total,"+
      " COALESCE(sum(r.calls_connected),0)::bigint AS calls_connected,COALESCE(sum(r.pdd_samples),0)::bigint AS pdd_samples,"+
      " COALESCE(sum(r.high_pdd_calls),0)::bigint AS high_pdd_calls,COALESCE(sum(r.quality_samples),0)::bigint AS quality_samples,"+
      " COALESCE(sum(r.network_affected_calls),0)::bigint AS network_affected_calls,COALESCE(sum(r.sip_5xx_calls),0)::bigint AS sip_5xx_calls"+
      " FROM voice_carrier_health_hourly_sharded r JOIN carriers c ON c.id=r.carrier_id"+
      " WHERE r.carrier_role='host' AND r.bucket_start>=date_trunc('hour',now())-interval '1 hour'"+
      " GROUP BY r.market_id,r.carrier_id,c.name"
    );
    const types=["connection_low","network_degraded","pdd_high","sip_5xx_high"];
    const changes=[];
    await this.sql.begin(async tx=>{
      for(const raw of rows){
        const row=numberFields(raw,["market_id","carrier_id","calls_total","calls_connected","pdd_samples","high_pdd_calls","quality_samples","network_affected_calls","sip_5xx_calls"]);
        const connection=row.calls_total?row.calls_connected/row.calls_total*100:100;
        const affected=row.quality_samples?row.network_affected_calls/row.quality_samples*100:0;
        const highPdd=row.pdd_samples?row.high_pdd_calls/row.pdd_samples*100:0;
        const sip5xx=row.calls_total?row.sip_5xx_calls/row.calls_total*100:0;
        const conditions={
          connection_low:row.calls_total>=20&&connection<75,
          network_degraded:row.quality_samples>=10&&affected>=15,
          pdd_high:row.pdd_samples>=10&&highPdd>=15,
          sip_5xx_high:row.calls_total>=20&&sip5xx>=10
        };
        const meta={
          connection_low:{title:"Taux de connexion opérateur dégradé",value:connection,critical:connection<60},
          network_degraded:{title:"Qualité réseau opérateur dégradée",value:affected,critical:affected>=30},
          pdd_high:{title:"Temps avant sonnerie anormalement élevé",value:highPdd,critical:highPdd>=30},
          sip_5xx_high:{title:"Erreurs SIP 5xx élevées",value:sip5xx,critical:sip5xx>=20}
        };
        for(const type of types){
          const open=await tx.unsafe(
            "SELECT id,severity FROM telecom_incidents WHERE incident_type=$1 AND carrier_role='host' AND carrier_id=$2 AND market_id=$3 AND state='open' LIMIT 1",
            [type,row.carrier_id,row.market_id]
          );
          if(conditions[type]){
            const severity=meta[type].critical?"critical":"warning";
            const details=JSON.stringify({carrier:row.carrier,calls:row.calls_total,value_percent:Number(meta[type].value.toFixed(2)),window:"2h"});
            if(open[0]){
              await tx.unsafe("UPDATE telecom_incidents SET severity=$2,title=$3,details=$4::jsonb,last_detected_at=now() WHERE id=$1",[open[0].id,severity,meta[type].title,details]);
              if(open[0].severity!==severity)changes.push({event:"voice.incident",id:Number(open[0].id),type,severity,carrier:row.carrier});
            }else{
              const created=await tx.unsafe(
                "INSERT INTO telecom_incidents(incident_type,severity,carrier_role,carrier_id,market_id,state,title,details)"+
                " VALUES($1,$2,'host',$3,$4,'open',$5,$6::jsonb) RETURNING id",
                [type,severity,row.carrier_id,row.market_id,meta[type].title,details]
              );
              changes.push({event:"voice.incident",id:Number(created[0].id),type,severity,carrier:row.carrier});
            }
          }else if(open[0]){
            await tx.unsafe("UPDATE telecom_incidents SET state='resolved',resolved_at=now(),last_detected_at=now() WHERE id=$1",[open[0].id]);
            changes.push({event:"voice.incident.resolved",id:Number(open[0].id),type,carrier:row.carrier});
          }
        }
      }
      const stale=await tx.unsafe(
        "UPDATE telecom_incidents SET state='resolved',resolved_at=now() WHERE state='open' AND last_detected_at<now()-interval '90 minutes' RETURNING id,incident_type"
      );
      for(const row of stale)changes.push({event:"voice.incident.resolved",id:Number(row.id),type:row.incident_type});
    });
    for(const change of changes)this.eventBus.publish(change.event,change);
    return changes;
  }

  async listCalls(params={}){
    const limit=clampInt(params.limit,100,1,250);
    const cursor=decodeCursor(params.cursor);
    const values=[
      params.from||null,params.to||null,params.expert_id?Number(params.expert_id):null,
      params.origin_carrier||null,params.status||null,params.market||null,
      cursor?.started_at||null,cursor?.id||null,limit+1
    ];
    const rows=await this.sql.unsafe(
      "SELECT c.id,c.external_call_id,c.started_at,c.ivr_started_at,c.queued_at,c.ringing_at,c.bridged_at,c.ended_at,c.post_dial_delay_ms,c.hangup_party,"+
      " ca.caller_masked,oc.name AS origin_carrier,hc.name AS host_carrier,sn.display_number AS sva_number,"+
      " c.currency,m.country_code AS market,e.id AS expert_id,e.display_name AS expert_name,c.call_destination_id,c.call_destination_label,d.destination_type,d.destination_uri,c.wait_seconds,c.conversation_seconds,c.total_seconds,"+
      " c.billable_seconds,c.payout_eligible_seconds,c.call_status,c.sip_final_code,c.hangup_cause,c.codec,"+
      " c.service_rate_ttc_per_min::float8,c.carrier_rate_ht_per_min::float8,c.retail_service_amount_ttc::float8,"+
      " c.expected_payout_ht::float8,COALESCE(c.confirmed_payout_ht,0)::float8 AS confirmed_payout_ht,"+
      " c.paid_payout_ht::float8,c.expert_cost_ht::float8,c.technical_cost_ht::float8,c.estimated_margin_ht::float8,"+
      " c.reconciliation_variance_ht::float8,c.reconciliation_status,q.rtp_packet_loss_percent::float8 AS packet_loss_percent,"+
      " q.jitter_ms::float8,q.latency_ms::float8,q.rtt_ms::float8,q.mos::float8,q.packets_in,q.packets_out,q.packets_lost,q.bytes_in,q.bytes_out,q.dtmf_errors"+
      " FROM call_facts f JOIN calls c ON c.id=f.call_id AND c.tenant_bucket=f.tenant_bucket"+
      " LEFT JOIN callers ca ON ca.id=c.caller_id LEFT JOIN carriers oc ON oc.id=c.origin_carrier_id"+
      " LEFT JOIN carriers hc ON hc.id=c.host_carrier_id LEFT JOIN sva_numbers sn ON sn.id=c.sva_number_id"+
      " LEFT JOIN operating_markets m ON m.id=c.market_id"+
      " LEFT JOIN experts e ON e.id=c.expert_id LEFT JOIN tenant_call_destinations d ON d.id=c.call_destination_id LEFT JOIN call_quality q ON q.call_id=c.id"+
      " WHERE ($1::timestamptz IS NULL OR f.started_at >= $1::timestamptz)"+
      " AND ($2::timestamptz IS NULL OR f.started_at <= $2::timestamptz)"+
      " AND ($3::bigint IS NULL OR c.expert_id=$3)"+
      " AND ($4::text IS NULL OR oc.name=$4)"+
      " AND ($5::text IS NULL OR c.call_status=$5)"+
      " AND ($6::text IS NULL OR m.country_code=$6)"+
      " AND ($7::timestamptz IS NULL OR (c.started_at,c.id) < ($7::timestamptz,$8::bigint))"+
      " ORDER BY c.started_at DESC,c.id DESC LIMIT $9",
      values
    );
    const hasMore=rows.length>limit;
    const page=hasMore?rows.slice(0,limit):rows;
    const last=page.at(-1);
    return {
      data:page.map(x=>({...x,quality:x.packet_loss_percent==null?null:{
        packet_loss_percent:x.packet_loss_percent,jitter_ms:x.jitter_ms,latency_ms:x.latency_ms,rtt_ms:x.rtt_ms,mos:x.mos,packets_in:x.packets_in,packets_out:x.packets_out,packets_lost:x.packets_lost,bytes_in:x.bytes_in,bytes_out:x.bytes_out,dtmf_errors:x.dtmf_errors
      }})),
      next_cursor:hasMore&&last?encodeCursor({started_at:last.started_at,id:Number(last.id)}):null
    };
  }

  async listExperts(){
    return this.readSql.unsafe(
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

  async selectCallDestination(context={}){
    const svaNumber=String(context.svaNumber||"").trim();
    const routed=await this.sql.begin(async tx=>{
      let tenantId=null,marketId=null,svaId=null;
      if(svaNumber){
        const svaRows=await tx.unsafe(
          "SELECT sn.id,sn.tenant_id,sn.market_id,t.tenant_type FROM sva_numbers sn"+
          " LEFT JOIN tenants t ON t.id=sn.tenant_id LEFT JOIN sva_number_aliases a ON a.sva_number_id=sn.id AND a.enabled"+
          " WHERE (sn.e164=$1 OR sn.display_number=$1 OR a.alias=$1) AND sn.status IN ('active','porting')"+
          " ORDER BY CASE WHEN sn.e164=$1 THEN 0 WHEN sn.display_number=$1 THEN 1 ELSE 2 END LIMIT 1",[svaNumber]);
        const sva=svaRows[0];
        if(!sva)throw problem(404,"SVA_NUMBER_NOT_ROUTABLE");
        if(sva.tenant_id==null)throw problem(409,"SVA_TENANT_NOT_CONFIGURED");
        tenantId=Number(sva.tenant_id);marketId=sva.market_id==null?null:Number(sva.market_id);svaId=Number(sva.id);
        const access=await tx.unsafe("SELECT pgi_tenant_has_premium_call_access($1,$2,now()) AS allowed",[tenantId,marketId]);
        if(!access[0]?.allowed)throw problem(402,"SVA_SUBSCRIPTION_REQUIRED");
        if(sva.tenant_type!=="internal"){
          const assignments=await tx.unsafe("SELECT id FROM tenant_number_assignments WHERE tenant_id=$1 AND sva_number_id=$2 AND status='active' AND (valid_from IS NULL OR valid_from<=now()) AND (valid_to IS NULL OR valid_to>=now()) LIMIT 1",[tenantId,svaId]);
          if(!assignments.length)throw problem(423,"SVA_ASSIGNMENT_INACTIVE");
          const payout=await tx.unsafe("SELECT pgi_tenant_has_payout_terms($1,$2,$3,now()) AS allowed",[tenantId,marketId,svaId]);
          if(!payout[0]?.allowed)throw problem(423,"SVA_PAYOUT_TERMS_REQUIRED");
        }
      }
      if(tenantId==null)return null;
      const rows=await tx.unsafe(
        "SELECT id,tenant_id,sva_number_id,label,destination_type,destination_uri,priority,status,failover_enabled,max_concurrent_calls,active_calls,last_assigned_at"+
        " FROM tenant_call_destinations WHERE tenant_id=$1 AND status='active' AND (sva_number_id=$2 OR sva_number_id IS NULL)"+
        " AND (max_concurrent_calls IS NULL OR active_calls<max_concurrent_calls)"+
        " ORDER BY CASE WHEN sva_number_id=$2 THEN 0 ELSE 1 END,priority ASC,active_calls ASC,last_assigned_at NULLS FIRST,id ASC LIMIT 1 FOR UPDATE SKIP LOCKED",[tenantId,svaId]);
      const destination=rows[0];if(!destination)return null;
      const updated=await tx.unsafe(
        "UPDATE tenant_call_destinations SET active_calls=active_calls+1,last_assigned_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2"+
        " RETURNING id,tenant_id,sva_number_id,label,destination_type,destination_uri,priority,status,failover_enabled,max_concurrent_calls,active_calls,last_assigned_at",[destination.id,tenantId]);
      const row=updated[0];return {...row,route_kind:"destination",call_destination_id:Number(row.id),expert_id:null};
    });
    if(routed)return routed;
    const legacy=await this.selectExpert(context);
    return legacy?{...legacy,route_kind:"expert",call_destination_id:null,expert_id:Number(legacy.id),label:legacy.display_name}:null;
  }

  async startLiveCallFinancial(payload={}){
    const externalCallId=String(payload.external_call_id||"").trim();
    const svaNumber=String(payload.sva_number||"").trim();
    const billableStartedAt=String(payload.billable_started_at||payload.started_at||new Date().toISOString());
    const originType=["fixed","mobile"].includes(String(payload.origin_type||"").toLowerCase())?String(payload.origin_type).toLowerCase():"unknown";
    if(!externalCallId||externalCallId.length>240)throw problem(400,"INVALID_EXTERNAL_CALL_ID");
    if(!svaNumber||svaNumber.length>64)throw problem(400,"INVALID_SVA_NUMBER");
    if(!Number.isFinite(Date.parse(billableStartedAt)))throw problem(400,"INVALID_LIVE_CALL_START");
    const session=await this.sql.begin(async tx=>{
      const svaRows=await tx.unsafe(
        "SELECT sn.id,sn.tenant_id,sn.market_id,sn.currency,sn.service_rate_ttc_per_min::float8,t.tenant_type"+
        " FROM sva_numbers sn LEFT JOIN tenants t ON t.id=sn.tenant_id LEFT JOIN sva_number_aliases a ON a.sva_number_id=sn.id AND a.enabled"+
        " WHERE (sn.e164=$1 OR sn.display_number=$1 OR a.alias=$1) AND sn.status IN ('active','porting')"+
        " ORDER BY CASE WHEN sn.e164=$1 THEN 0 WHEN sn.display_number=$1 THEN 1 ELSE 2 END LIMIT 1",
        [svaNumber]
      );
      const sva=svaRows[0];
      if(!sva)throw problem(404,"SVA_NUMBER_NOT_ROUTABLE");
      if(sva.tenant_id==null)throw problem(409,"SVA_TENANT_NOT_CONFIGURED");
      const hostRows=await tx.unsafe(
        "SELECT c.id FROM logical_carrier_routes r JOIN carriers c ON c.id=r.active_carrier_id WHERE r.route_key='sva-primary' LIMIT 1"
      );
      const host=hostRows[0]||null;
      if(this.config.requireCarrierContract&&!host)throw problem(409,"HOST_CARRIER_NOT_CONFIGURED");
      const contractRows=host?await tx.unsafe(
        "SELECT payout_rate_ht_per_min::float8,mobile_deduction_ht_per_min::float8 FROM carrier_contracts"+
        " WHERE carrier_id=$1 AND (sva_number_id IS NULL OR sva_number_id=$2)"+
        " AND valid_from <= $3::timestamptz::date AND (valid_to IS NULL OR valid_to >= $3::timestamptz::date)"+
        " ORDER BY (sva_number_id IS NOT NULL) DESC,valid_from DESC,id DESC LIMIT 1",
        [host.id,sva.id,billableStartedAt]
      ):[];
      const contract=contractRows[0]||null;
      if(this.config.requireCarrierContract&&!contract)throw problem(409,"CARRIER_CONTRACT_NOT_CONFIGURED");
      const termRows=await tx.unsafe(
        "SELECT id,platform_fee_bps,platform_fee_ht_per_min::float8 FROM tenant_payout_terms"+
        " WHERE tenant_id=$1 AND status='active' AND effective_from<=$4::timestamptz"+
        " AND (effective_to IS NULL OR effective_to>$4::timestamptz)"+
        " AND (market_id IS NULL OR market_id=$2) AND (sva_number_id IS NULL OR sva_number_id=$3)"+
        " ORDER BY (sva_number_id IS NOT NULL) DESC,(market_id IS NOT NULL) DESC,effective_from DESC,id DESC LIMIT 1",
        [sva.tenant_id,sva.market_id,sva.id,billableStartedAt]
      );
      const terms=termRows[0]||null;
      if(sva.tenant_type!=="internal"&&!terms)throw problem(423,"SVA_PAYOUT_TERMS_REQUIRED");
      const serviceRate=Math.max(0,Number(sva.service_rate_ttc_per_min??this.config.serviceRateTtcPerMin)||0);
      const basePayout=Math.max(0,Number(contract?.payout_rate_ht_per_min??this.config.payoutRateHtPerMin)||0);
      const mobileDeduction=originType==="mobile"?Math.max(0,Number(contract?.mobile_deduction_ht_per_min||0)):0;
      const upstreamRate=Math.max(0,basePayout-mobileDeduction);
      const bps=Math.min(10000,Math.max(0,Number(terms?.platform_fee_bps||0)));
      const feePerMinute=Math.max(0,Number(terms?.platform_fee_ht_per_min||0));
      const platformFeeRate=Math.min(upstreamRate,upstreamRate*bps/10000+feePerMinute);
      const clientRate=terms?Math.max(0,upstreamRate-platformFeeRate):0;
      const inserted=await tx.unsafe(
        "INSERT INTO live_call_financial_sessions(external_call_id,tenant_id,market_id,sva_number_id,currency,billable_started_at,status,origin_type,"+
        " service_rate_ttc_per_min,upstream_payout_rate_ht_per_min,platform_fee_bps,platform_fee_ht_per_min,net_client_rate_ht_per_min,payout_terms_id)"+
        " VALUES($1,$2,$3,$4,$5,$6::timestamptz,'active',$7,$8,$9,$10,$11,$12,$13)"+
        " ON CONFLICT(external_call_id) DO NOTHING"+
        " RETURNING id,external_call_id,tenant_id,market_id,sva_number_id,currency,billable_started_at,status,origin_type,"+
        " service_rate_ttc_per_min::float8,upstream_payout_rate_ht_per_min::float8,net_client_rate_ht_per_min::float8",
        [externalCallId,sva.tenant_id,sva.market_id,sva.id,String(sva.currency||"EUR"),billableStartedAt,originType,serviceRate,upstreamRate,bps,feePerMinute,clientRate,terms?.id||null]
      );
      if(inserted[0])return inserted[0];
      const existing=await tx.unsafe(
        "SELECT id,external_call_id,tenant_id,market_id,sva_number_id,currency,billable_started_at,status,origin_type,"+
        " service_rate_ttc_per_min::float8,upstream_payout_rate_ht_per_min::float8,net_client_rate_ht_per_min::float8"+
        " FROM live_call_financial_sessions WHERE external_call_id=$1 LIMIT 1",[externalCallId]
      );
      return existing[0];
    });
    if(session?.status==="active")this.eventBus.publish("live_call.started",{id:session.id,tenant_id:session.tenant_id,market_id:session.market_id,currency:session.currency});
    return session;
  }

  async stopLiveCallFinancial(externalCallId,status="ended",endedAt=null){
    const id=String(externalCallId||"").trim();
    if(!id||id.length>240)throw problem(400,"INVALID_EXTERNAL_CALL_ID");
    const finalStatus=status==="cancelled"?"cancelled":"ended";
    const at=endedAt==null?new Date().toISOString():String(endedAt);
    if(!Number.isFinite(Date.parse(at)))throw problem(400,"INVALID_LIVE_CALL_END");
    const rows=await this.sql.unsafe(
      "UPDATE live_call_financial_sessions SET status=$2,ended_at=GREATEST(billable_started_at,$3::timestamptz),updated_at=now()"+
      " WHERE external_call_id=$1 AND status='active'"+
      " RETURNING id,external_call_id,tenant_id,market_id,currency,status,ended_at",
      [id,finalStatus,at]
    );
    const row=rows[0]||null;
    if(row)this.eventBus.publish("live_call.ended",{id:row.id,tenant_id:row.tenant_id,market_id:row.market_id,currency:row.currency,status:row.status});
    return row||{external_call_id:id,status:finalStatus,already_closed:true};
  }

  async releaseCallDestination(id){
    id=Number(id);if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_CALL_DESTINATION_ID");
    const rows=await this.sql.unsafe("UPDATE tenant_call_destinations SET active_calls=GREATEST(active_calls-1,0),updated_at=now() WHERE id=$1 RETURNING id,tenant_id,label,destination_type,destination_uri,status,active_calls,last_assigned_at",[id]);
    const destination=rows[0];if(!destination)throw problem(404,"CALL_DESTINATION_NOT_FOUND");
    this.eventBus.publish("call_destination.released",{id:destination.id,tenant_id:destination.tenant_id,active_calls:destination.active_calls});
    return destination;
  }

  async selectExpert(context={}){
    const svaNumber=String(context.svaNumber||"").trim();
    return this.sql.begin(async tx=>{
      let tenantId=null,marketId=null;
      if(svaNumber){
        const svaRows=await tx.unsafe(
          "SELECT sn.id,sn.tenant_id,sn.market_id,t.tenant_type FROM sva_numbers sn"+
          " LEFT JOIN tenants t ON t.id=sn.tenant_id LEFT JOIN sva_number_aliases a ON a.sva_number_id=sn.id AND a.enabled"+
          " WHERE (sn.e164=$1 OR sn.display_number=$1 OR a.alias=$1) AND sn.status IN ('active','porting')"+
          " ORDER BY CASE WHEN sn.e164=$1 THEN 0 WHEN sn.display_number=$1 THEN 1 ELSE 2 END LIMIT 1",
          [svaNumber]
        );
        const sva=svaRows[0];
        if(!sva)throw problem(404,"SVA_NUMBER_NOT_ROUTABLE");
        if(sva.tenant_id==null)throw problem(409,"SVA_TENANT_NOT_CONFIGURED");
        tenantId=Number(sva.tenant_id);
        marketId=sva.market_id==null?null:Number(sva.market_id);
        const accessRows=await tx.unsafe(
          "SELECT pgi_tenant_has_premium_call_access($1,$2,now()) AS allowed",
          [tenantId,marketId]
        );
        if(!accessRows[0]?.allowed)throw problem(402,"SVA_SUBSCRIPTION_REQUIRED");
        if(sva.tenant_type!=="internal"){
          const assignmentRows=await tx.unsafe(
            "SELECT id FROM tenant_number_assignments WHERE tenant_id=$1 AND sva_number_id=$2 AND status='active'"+
            " AND (valid_from IS NULL OR valid_from<=now()) AND (valid_to IS NULL OR valid_to>=now()) LIMIT 1",
            [tenantId,sva.id]
          );
          if(!assignmentRows.length)throw problem(423,"SVA_ASSIGNMENT_INACTIVE");
          const payoutRows=await tx.unsafe("SELECT pgi_tenant_has_payout_terms($1,$2,$3,now()) AS allowed",[tenantId,marketId,sva.id]);
          if(!payoutRows[0]?.allowed)throw problem(423,"SVA_PAYOUT_TERMS_REQUIRED");
        }
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
    const rawPayload={...p};
    delete rawPayload.caller_masked;
    delete rawPayload.caller_hash;
    const payloadHash=createHash("sha256").update(JSON.stringify(rawPayload)).digest("hex");
    const result=await this.sql.begin(async tx=>{
      const inserted=await tx.unsafe(
        "INSERT INTO raw_cdr_events(source,source_event_id,event_time,payload,payload_sha256)"+
        " VALUES($1,$2,$3::timestamptz,$4::jsonb,$5) ON CONFLICT(source,source_event_id) DO NOTHING RETURNING id",
        [envelope.source,envelope.source_event_id,envelope.event_time||null,JSON.stringify(rawPayload),payloadHash]
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
        "SELECT sn.id,sn.e164,sn.display_number,sn.tenant_id,sn.market_id,sn.currency,sn.service_rate_ttc_per_min::float8"+
        " FROM sva_numbers sn LEFT JOIN sva_number_aliases a ON a.sva_number_id=sn.id AND a.enabled"+
        " WHERE sn.e164=$1 OR sn.display_number=$1 OR a.alias=$1"+
        " ORDER BY CASE WHEN sn.e164=$1 THEN 0 WHEN sn.display_number=$1 THEN 1 ELSE 2 END LIMIT 1",
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

      let callDestination=null;
      if(p.call_destination_id!=null){
        const rows=await tx.unsafe("SELECT id,tenant_id,label,destination_type,destination_uri FROM tenant_call_destinations WHERE id=$1 LIMIT 1",[Number(p.call_destination_id)]);
        callDestination=rows[0]||null;if(!callDestination)throw problem(409,"CALL_DESTINATION_NOT_CONFIGURED");
        if(Number(sva.tenant_id)!==Number(callDestination.tenant_id))throw problem(409,"CALL_DESTINATION_TENANT_MISMATCH");
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
        String(p.external_call_id),envelope.source,caller.id,sva.id,expert?.id||null,callDestination?.id||null,callDestination?.label||p.destination_label||null,origin.id,host.id,
        p.started_at,p.ivr_started_at||null,p.queued_at||null,p.ringing_at||null,p.bridged_at||null,p.ended_at,
        p.post_dial_delay_ms==null?null:Math.max(0,Math.round(Number(p.post_dial_delay_ms))),
        Math.max(0,Number(p.wait_seconds||0)),conversation,totalSeconds,financial.billableSeconds,financial.payoutEligibleSeconds,
        status,p.sip_final_code==null?null:Number(p.sip_final_code),String(p.hangup_cause||""),p.hangup_party||null,String(p.codec||""),
        serviceRate,payoutRate,mobileDeduction,
        financial.serviceAmountTtc,financial.expectedPayoutHt,confirmed,paid,expertCost,technicalCost,
        Math.max(0,(confirmed||0)-expertCost-technicalCost),recon?recon.status:"pending",recon?recon.varianceHt:0,
        sva.tenant_id||null,sva.market_id||null,String(sva.currency||"EUR")
      ];
      const callRows=await tx.unsafe(
        "INSERT INTO calls(external_call_id,cdr_source,caller_id,sva_number_id,expert_id,call_destination_id,call_destination_label,origin_carrier_id,host_carrier_id,"+
        " started_at,ivr_started_at,queued_at,ringing_at,bridged_at,ended_at,post_dial_delay_ms,wait_seconds,conversation_seconds,total_seconds,billable_seconds,"+
        " payout_eligible_seconds,call_status,sip_final_code,hangup_cause,hangup_party,codec,service_rate_ttc_per_min,carrier_rate_ht_per_min,"+
        " mobile_deduction_ht_per_min,retail_service_amount_ttc,expected_payout_ht,confirmed_payout_ht,paid_payout_ht,"+
        " expert_cost_ht,technical_cost_ht,estimated_margin_ht,reconciliation_status,reconciliation_variance_ht,tenant_id,market_id,currency)"+
        " VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11::timestamptz,$12::timestamptz,$13::timestamptz,$14::timestamptz,$15::timestamptz,"+
        " $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41)"+
        " ON CONFLICT(host_carrier_id,external_call_id) WHERE host_carrier_id IS NOT NULL AND external_call_id IS NOT NULL"+
        " DO NOTHING RETURNING id,tenant_bucket",
        callValues
      );
      const call=callRows[0];
      if(!call){
        await tx.unsafe("UPDATE raw_cdr_events SET processing_status='duplicate',processed_at=now() WHERE id=$1",[inserted[0].id]);
        return {duplicate:true};
      }

      await tx.unsafe(
        "INSERT INTO call_facts("+
        " tenant_bucket,call_id,tenant_id,market_id,currency,sva_number_id,expert_id,origin_carrier_id,host_carrier_id,"+
        " started_at,ended_at,call_status,conversation_seconds,billable_seconds,payout_eligible_seconds,"+
        " retail_service_amount_ttc,expected_payout_ht,confirmed_payout_ht,paid_payout_ht,expert_cost_ht,technical_cost_ht,"+
        " estimated_margin_ht,reconciliation_variance_ht,created_at)"+
        " SELECT tenant_bucket,id,tenant_id,market_id,currency,sva_number_id,expert_id,origin_carrier_id,host_carrier_id,"+
        " started_at,ended_at,call_status,conversation_seconds,billable_seconds,payout_eligible_seconds,"+
        " retail_service_amount_ttc,expected_payout_ht,COALESCE(confirmed_payout_ht,0),paid_payout_ht,expert_cost_ht,technical_cost_ht,"+
        " estimated_margin_ht,reconciliation_variance_ht,created_at FROM calls WHERE id=$1"+
        " ON CONFLICT (tenant_bucket,call_id) DO NOTHING",
        [call.id]
      );

      await tx.unsafe(
        "UPDATE live_call_financial_sessions SET status='ended',ended_at=GREATEST(billable_started_at,$2::timestamptz),updated_at=now()"+
        " WHERE external_call_id=$1 AND status='active'",
        [String(p.external_call_id),p.ended_at]
      );

      await writeHourlyRollup(tx,call.id);
      await writeTenantDailyRollup(tx,call.id);
      await writeDashboardDimensionRollups(tx,call.id);
      await writeExperienceRollup(tx,call.id);

      if(p.quality){
        await tx.unsafe(
          "INSERT INTO call_quality(call_id,rtp_packet_loss_percent,jitter_ms,latency_ms,rtt_ms,mos,packets_in,packets_out,packets_lost,bytes_in,bytes_out,dtmf_errors)"+
          " VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
          [
            call.id,nullableNumber(p.quality.packet_loss_percent),nullableNumber(p.quality.jitter_ms),nullableNumber(p.quality.latency_ms),
            nullableNumber(p.quality.rtt_ms),nullableNumber(p.quality.mos),nullableNumber(p.quality.packets_in),nullableNumber(p.quality.packets_out),
            nullableNumber(p.quality.packets_lost),nullableNumber(p.quality.bytes_in),nullableNumber(p.quality.bytes_out),Number(p.quality.dtmf_errors||0)
          ]
        );
        await writeQualityRollup(tx,call.id);
      }
      await writeVoiceCarrierHealthRollup(tx,call.id);
      await writeTenantVoiceDailyRollup(tx,call.id);
      await writeSipCodeRollup(tx,call.id);
      if(financial.expectedPayoutHt!==0)await ledger(tx,call.id,sva.tenant_id,sva.market_id,sva.currency,"expected",financial.expectedPayoutHt,envelope);
      if(confirmed!=null&&confirmed!==0)await ledger(tx,call.id,sva.tenant_id,sva.market_id,sva.currency,"confirmed",confirmed,envelope);
      if(paid!==0)await ledger(tx,call.id,sva.tenant_id,sva.market_id,sva.currency,"paid",paid,envelope);

      await tx.unsafe(
        "INSERT INTO outbox_events(tenant_id,market_id,event_type,aggregate_type,aggregate_id,payload)"+
        " VALUES($1,$2,'call.ingested','call',$3,$4::jsonb)",
        [sva.tenant_id||null,sva.market_id||null,String(call.id),JSON.stringify({external_call_id:p.external_call_id})]
      );
      await tx.unsafe(
        "INSERT INTO audit_log(tenant_id,action,entity_type,entity_id,details) VALUES($1,'cdr.ingest','call',$2,$3::jsonb)",
        [sva.tenant_id||null,String(call.id),JSON.stringify({source:envelope.source})]
      );
      await tx.unsafe("UPDATE raw_cdr_events SET processing_status='processed',processed_at=now() WHERE id=$1",[inserted[0].id]);
      return {duplicate:false,call_id:call.id,tenant_id:sva.tenant_id||null,market_id:sva.market_id||null,currency:String(sva.currency||"EUR")};
    });

    if(!result.duplicate){
      this.eventBus.publish("live_call.ended",{external_call_id:p.external_call_id,tenant_id:result.tenant_id,market_id:result.market_id,currency:result.currency,status:"ended",source:"cdr"});
      this.eventBus.publish("call.ingested",{id:result.call_id,tenant_id:result.tenant_id,market_id:result.market_id,currency:result.currency});
    }
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
        "SELECT id,external_call_id,tenant_bucket,market_id,currency,expected_payout_ht::float8,expert_cost_ht::float8,technical_cost_ht::float8"+
        " FROM calls WHERE host_carrier_id=$1 AND started_at::date BETWEEN $2::date AND $3::date"+
        " AND currency=$4",
        [carrier.id,settlement.period_start,settlement.period_end,settlement.currency]
      );
      const byExternal=new Map(periodCalls.map(row=>[String(row.external_call_id),row]));
      const matched=settlement.matches.map(item=>{
        const call=byExternal.get(item.external_call_id);
        if(!call)throw problem(409,"SETTLEMENT_CALL_NOT_FOUND","Settlement call not found in carrier period/currency: "+item.external_call_id);
        if(settlement.market_id!=null&&Number(call.market_id)!==Number(settlement.market_id))throw problem(409,"SETTLEMENT_MARKET_MISMATCH");
        return {
          call_id:Number(call.id),
          tenant_bucket:Number(call.tenant_bucket||0),
          external_call_id:item.external_call_id,
          market_id:call.market_id==null?null:Number(call.market_id),
          currency:String(call.currency||settlement.currency),
          amount:Number(item.carrier_amount_ht),
          expected:Number(call.expected_payout_ht||0)
        };
      });

      const marketIds=[...new Set(matched.map(row=>row.market_id).filter(x=>x!=null))];
      if(marketIds.length>1)throw problem(409,"SETTLEMENT_MULTIPLE_MARKETS");
      const marketId=settlement.market_id??marketIds[0]??null;
      const expectedAmount=roundFinanceNumber(matched.reduce((sum,row)=>sum+row.expected,0));
      const confirmedAmount=roundFinanceNumber(matched.reduce((sum,row)=>sum+row.amount,0));
      const paidAmount=settlement.status==="paid"?confirmedAmount:0;

      const inserted=await tx.unsafe(
        "INSERT INTO carrier_settlements(carrier_id,market_id,currency,period_start,period_end,statement_reference,invoice_reference,"+
        " expected_amount_ht,confirmed_amount_ht,paid_amount_ht,payment_due_date,paid_at,status,source_file_hash)"+
        " VALUES($1,$2,$3,$4::date,$5::date,$6,$7,$8,$9,$10,$11::date,$12::timestamptz,$13,$14)"+
        " RETURNING id,carrier_id,market_id,currency,period_start,period_end,expected_amount_ht::float8,confirmed_amount_ht::float8,"+
        " paid_amount_ht::float8,status,statement_reference,invoice_reference,payment_due_date,paid_at,source_file_hash,created_at",
        [
          carrier.id,marketId,settlement.currency,settlement.period_start,settlement.period_end,
          settlement.statement_reference,settlement.invoice_reference,
          expectedAmount,confirmedAmount,paidAmount,settlement.payment_due_date,settlement.paid_at,
          settlement.status,settlement.source_file_hash
        ]
      );
      const row=inserted[0];
      const matchJson=JSON.stringify(matched.map(x=>({call_id:x.call_id,tenant_bucket:x.tenant_bucket,amount:x.amount})));

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
        "UPDATE call_facts f SET confirmed_payout_ht=x.amount,"+
        " paid_payout_ht=CASE WHEN $2::boolean THEN x.amount ELSE f.paid_payout_ht END,"+
        " reconciliation_variance_ht=f.expected_payout_ht-x.amount,"+
        " estimated_margin_ht=GREATEST(x.amount-f.expert_cost_ht-f.technical_cost_ht,0)"+
        " FROM jsonb_to_recordset($1::jsonb) AS x(call_id bigint,tenant_bucket smallint,amount numeric)"+
        " WHERE f.tenant_bucket=x.tenant_bucket AND f.call_id=x.call_id",
        [matchJson,settlement.status==="paid"]
      );

      await refreshHourlyRollupsForCalls(tx,matchJson);

      await tx.unsafe(
        "INSERT INTO financial_ledger(market_id,call_id,settlement_id,event_type,amount_ht,currency,source_reference,source_hash,reason,created_by,metadata)"+
        " SELECT c.market_id,x.call_id,$1,'confirmed',x.amount,c.currency,$2,$3,'carrier settlement import',$4,$5::jsonb"+
        " FROM jsonb_to_recordset($6::jsonb) AS x(call_id bigint,amount numeric)"+
        " JOIN calls c ON c.id=x.call_id WHERE x.amount<>0",
        [
          row.id,settlement.statement_reference,settlement.source_file_hash,numericActor(actor),
          JSON.stringify({carrier:carrier.name,period_start:settlement.period_start,period_end:settlement.period_end}),matchJson
        ]
      );

      if(settlement.status==="paid"){
        await tx.unsafe(
          "INSERT INTO financial_ledger(market_id,call_id,settlement_id,event_type,amount_ht,currency,source_reference,source_hash,reason,created_by,metadata)"+
          " SELECT c.market_id,x.call_id,$1,'paid',x.amount,c.currency,$2,$3,'carrier settlement paid',$4,$5::jsonb"+
          " FROM jsonb_to_recordset($6::jsonb) AS x(call_id bigint,amount numeric)"+
          " JOIN calls c ON c.id=x.call_id WHERE x.amount<>0",
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

      const tenantDistributions=await rebuildTenantRevenueDistributions(tx,row.id,numericActor(actor));
      return {...row,carrier_name:carrier.name,matches:matched.length,tenant_distributions:tenantDistributions.length};
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
        "SELECT id,carrier_id,market_id,currency,status,confirmed_amount_ht::float8,paid_amount_ht::float8 FROM carrier_settlements WHERE id=$1 FOR UPDATE",
        [settlementId]
      );
      const settlement=rows[0];
      if(!settlement)throw problem(404,"SETTLEMENT_NOT_FOUND");
      if(settlement.status==="paid")return {...settlement,changed:false};

      const matches=await tx.unsafe(
        "SELECT scm.call_id,c.tenant_bucket,scm.carrier_amount_ht::float8 AS amount"+
        " FROM settlement_call_matches scm JOIN calls c ON c.id=scm.call_id WHERE scm.settlement_id=$1",
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
        "UPDATE call_facts f SET paid_payout_ht=x.amount"+
        " FROM jsonb_to_recordset($1::jsonb) AS x(call_id bigint,tenant_bucket smallint,amount numeric)"+
        " WHERE f.tenant_bucket=x.tenant_bucket AND f.call_id=x.call_id",
        [matchJson]
      );

      await refreshHourlyRollupsForCalls(tx,matchJson);
      await tx.unsafe(
        "INSERT INTO financial_ledger(market_id,call_id,settlement_id,event_type,amount_ht,currency,reason,created_by,metadata)"+
        " SELECT c.market_id,x.call_id,$1,'paid',x.amount,c.currency,'carrier settlement marked paid',$2,$3::jsonb"+
        " FROM jsonb_to_recordset($4::jsonb) AS x(call_id bigint,amount numeric)"+
        " JOIN calls c ON c.id=x.call_id"+
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
      const tenantDistributions=await rebuildTenantRevenueDistributions(tx,settlementId,numericActor(actor));

      return {...updated[0],changed:true,tenant_distributions:tenantDistributions.length};
    });
    if(result.changed)this.eventBus.publish("settlement.paid",{id:settlementId,paid_at:result.paid_at});
    return result;
  }

  async reconciliation(from,to,market=null){
    return this.sql.unsafe(
      "SELECT COALESCE(hc.name,'Unknown') AS carrier,count(*)::int AS calls,"+
      " COALESCE(sum(f.expected_payout_ht),0)::float8 AS expected_payout_ht,"+
      " COALESCE(sum(f.confirmed_payout_ht),0)::float8 AS confirmed_payout_ht,"+
      " COALESCE(sum(f.paid_payout_ht),0)::float8 AS paid_payout_ht,"+
      " COALESCE(sum(f.reconciliation_variance_ht),0)::float8 AS variance_ht,"+
      " count(*) FILTER(WHERE abs(f.reconciliation_variance_ht)>$4)::int AS variance_calls"+
      " FROM call_facts f LEFT JOIN carriers hc ON hc.id=f.host_carrier_id"+
      " LEFT JOIN operating_markets m ON m.id=f.market_id"+
      " WHERE f.started_at >= $1::timestamptz AND f.started_at <= $2::timestamptz"+
      " AND ($3::text IS NULL OR m.country_code=$3)"+
      " GROUP BY hc.name ORDER BY hc.name",
      [from,to,market||null,this.config.reconciliationToleranceHt]
    );
  }

  async effectiveMetricRanges(from,to,tenantId=null){
    const fromMs=Date.parse(from),toMs=Date.parse(to);
    if(!Number.isFinite(fromMs)||!Number.isFinite(toMs))throw problem(400,"INVALID_RANGE");
    const keys=["calls","minutes","revenue","payout","quality"];
    const id=tenantId==null?null:Number(tenantId);
    if(tenantId!=null&&(!Number.isInteger(id)||id<=0))throw problem(400,"INVALID_TENANT_CONTEXT");
    const rows=await this.readSql.unsafe(
      id==null
        ?"SELECT metric_key,effective_from FROM metric_baselines WHERE scope='global' AND tenant_id IS NULL AND metric_key=ANY($1::text[]) ORDER BY effective_from DESC,id DESC"
        :"SELECT metric_key,effective_from FROM metric_baselines WHERE scope='global' AND tenant_id=$2 AND metric_key=ANY($1::text[]) ORDER BY effective_from DESC,id DESC",
      id==null?[["all",...keys]]:[["all",...keys],id]
    );
    const latest={};
    for(const row of rows)if(latest[row.metric_key]==null)latest[row.metric_key]=new Date(row.effective_from);
    const all=latest.all||null,result={};
    for(const key of keys){
      const own=latest[key]||null;
      const baseline=!all?own:!own?all:(all.getTime()>own.getTime()?all:own);
      const effectiveFrom=baseline&&baseline.getTime()>fromMs?baseline:new Date(fromMs);
      result[key]={
        from:effectiveFrom.toISOString(),to:new Date(toMs).toISOString(),
        baseline:baseline?baseline.toISOString():null,
        reset_applied:Boolean(baseline&&baseline.getTime()>fromMs),
        empty:effectiveFrom.getTime()>toMs
      };
    }
    return result;
  }

  async effectiveMetricRange(from,to,options={}){
    const tenantId=options&&typeof options==="object"?options.tenant_id??null:null;
    const metricKey=options&&typeof options==="object"?String(options.metric_key||"calls"):"calls";
    const ranges=await this.effectiveMetricRanges(from,to,tenantId);
    return ranges[metricKey]||ranges.calls;
  }

  async listBaselines(params={}){
    const scope=params.scope||"global";
    if(!["global","expert","sva_number"].includes(scope))throw problem(400,"INVALID_SCOPE");
    const limit=clampInt(params.limit,20,1,100);
    const tenantId=params.tenant_id==null?null:Number(params.tenant_id);
        return this.sql.unsafe(
      "SELECT id,tenant_id,scope,scope_id,metric_key,reason,created_at,effective_from,created_by,created_by_customer_principal_id"+
      " FROM metric_baselines WHERE scope=$1 AND ($2::bigint IS NULL OR tenant_id=$2) ORDER BY effective_from DESC,id DESC LIMIT $3",
      [scope,tenantId,limit]
    );
  }

  async createBaseline(payload,actor){
    const scope=String(payload.scope||"global");
    if(!["global","expert","sva_number"].includes(scope))throw problem(400,"INVALID_SCOPE");
    const metricKey=String(payload.metric_key||"all");
    if(!["all","calls","minutes","revenue","payout","quality"].includes(metricKey))throw problem(400,"INVALID_METRIC_KEY");
    const tenantId=payload.tenant_id==null?null:Number(payload.tenant_id);
        const rows=await this.sql.unsafe(
      "INSERT INTO metric_baselines(created_by,tenant_id,scope,scope_id,metric_key,reason,effective_from) VALUES($1,$2,$3,$4,$5,$6,now())"+
      " RETURNING id,tenant_id,scope,scope_id,metric_key,reason,created_at,effective_from",
      [numericActor(actor),tenantId,scope,payload.scope_id==null?null:Number(payload.scope_id),metricKey,String(payload.reason||"")]
    );
    const row=rows[0];
    await this.sql.unsafe(
      "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'baseline.create','metric_baseline',$3,$4::jsonb)",
      [tenantId,numericActor(actor),String(row.id),JSON.stringify({scope:row.scope,metric_key:row.metric_key})]
    );
    this.eventBus.publish("baseline.created",{id:row.id,scope:row.scope,tenant_id:row.tenant_id,metric_key:row.metric_key});
    return row;
  }


  async createCustomerJackpotReset(tenantId,customerPrincipalId){
    const id=Number(tenantId),principal=String(customerPrincipalId||"");
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_CONTEXT");
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(principal))throw problem(400,"INVALID_CUSTOMER_PRINCIPAL");
    const rows=await this.sql.unsafe("INSERT INTO customer_jackpot_baselines(tenant_id,reason,effective_from,created_by_customer_principal_id) VALUES($1,'Remise à zéro du jackpot personnel',now(),$2::uuid) RETURNING id,tenant_id,effective_from",[id,principal]);
    const row=rows[0];
    await this.sql.unsafe("INSERT INTO audit_log(tenant_id,action,entity_type,entity_id,details) VALUES($1,'customer.jackpot.reset','customer_jackpot_baseline',$2,$3::jsonb)",[id,String(row.id),JSON.stringify({metric_key:"jackpot",customer_principal_id:principal,accounting_impact:"none"})]);
    this.eventBus.publish("customer.jackpot.reset",{tenant_id:id,reset_at:row.effective_from});
    return {jackpot_reset_at:row.effective_from,accounting_impact:"none"};
  }

  async createCustomerMetricReset(tenantId,metricKeys,customerPrincipalId){
    const id=Number(tenantId);
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_CONTEXT");
    const allowed=["calls","minutes","revenue","payout","quality"];
    let keys=Array.isArray(metricKeys)?metricKeys.map(x=>String(x)):[];
    if(keys.includes("all"))keys=allowed.slice();
    keys=[...new Set(keys)];
    if(!keys.length||keys.some(x=>!allowed.includes(x)))throw problem(400,"INVALID_METRIC_SELECTION");
    const principal=String(customerPrincipalId||"");
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(principal))throw problem(400,"INVALID_CUSTOMER_PRINCIPAL");
    const rows=await this.sql.begin(async tx=>{
      const created=[];
      for(const key of keys){
        const inserted=await tx.unsafe(
          "INSERT INTO metric_baselines(tenant_id,scope,metric_key,reason,effective_from,created_by_customer_principal_id)"+
          " VALUES($1,'global',$2,'Remise à zéro depuis l’espace client',now(),$3::uuid)"+
          " RETURNING id,tenant_id,scope,metric_key,reason,created_at,effective_from",
          [id,key,principal]
        );
        created.push(inserted[0]);
      }
      await tx.unsafe(
        "INSERT INTO audit_log(tenant_id,action,entity_type,entity_id,details) VALUES($1,'customer.metrics.reset','metric_baseline',$2,$3::jsonb)",
        [id,String(created[0].id),JSON.stringify({metric_keys:keys,customer_principal_id:principal})]
      );
      return created;
    });
    this.eventBus.publish("customer.metrics.reset",{tenant_id:id,metric_keys:keys});
    return {data:rows,metric_keys:keys,effective_from:rows[0]?.effective_from||null};
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

  async carrierAdminOverview(){
    const [routeRows,targets,switches]=await Promise.all([
      this.readSql.unsafe(
        "SELECT r.route_key,r.generation,r.active_carrier_id,r.active_connection_id,r.standby_carrier_id,r.standby_connection_id,r.updated_at,"+
        " a.name AS active_carrier,s.name AS standby_carrier,ac.state AS active_connection_state,sc.state AS standby_connection_state"+
        " FROM logical_carrier_routes r LEFT JOIN carriers a ON a.id=r.active_carrier_id LEFT JOIN carriers s ON s.id=r.standby_carrier_id"+
        " LEFT JOIN carrier_connections ac ON ac.id=r.active_connection_id LEFT JOIN carrier_connections sc ON sc.id=r.standby_connection_id"+
        " WHERE r.route_key='sva-primary'"
      ),
      this.readSql.unsafe(
        "SELECT cc.id AS connection_id,cc.carrier_id,c.name AS carrier_name,cc.connection_name,cc.state,cc.transport,cc.last_health_at,cc.last_health_status"+
        " FROM carrier_connections cc JOIN carriers c ON c.id=cc.carrier_id"+
        " WHERE cc.purpose='sip_inbound' AND cc.state IN ('ready','active','standby') AND c.enabled"+
        " ORDER BY CASE cc.state WHEN 'active' THEN 0 WHEN 'standby' THEN 1 ELSE 2 END,c.name,cc.id LIMIT 50"
      ),
      this.readSql.unsafe(
        "SELECT sw.id,sw.route_key,sw.from_carrier_id,fc.name AS from_carrier,sw.to_carrier_id,tc.name AS to_carrier,"+
        " sw.scheduled_for,sw.started_at,sw.completed_at,sw.rollback_deadline,sw.status,sw.validation,sw.notes,sw.requested_at AS created_at"+
        " FROM carrier_switches sw LEFT JOIN carriers fc ON fc.id=sw.from_carrier_id LEFT JOIN carriers tc ON tc.id=sw.to_carrier_id"+
        " WHERE sw.route_key='sva-primary' ORDER BY sw.id DESC LIMIT 20"
      )
    ]);
    return {route:routeRows[0]||{route_key:"sva-primary",generation:1},targets,recent_switches:switches};
  }

  async planCarrierSwitch(payload,actor){
    const actorId=numericActor(actor);
    if(!actorId)throw problem(403,"STAFF_IDENTITY_REQUIRED");
    const result=await this.sql.begin(async tx=>{
      const connections=await tx.unsafe(
        "SELECT cc.id,cc.carrier_id,c.name AS carrier_name,cc.state FROM carrier_connections cc JOIN carriers c ON c.id=cc.carrier_id"+
        " WHERE cc.id=$1 AND cc.carrier_id=$2 AND cc.purpose='sip_inbound' AND cc.state IN ('ready','active','standby') FOR UPDATE",
        [Number(payload.connection_id),Number(payload.to_carrier_id)]
      );
      const connection=connections[0];
      if(!connection)throw problem(409,"TARGET_CONNECTION_NOT_READY");
      const routes=await tx.unsafe("SELECT active_carrier_id FROM logical_carrier_routes WHERE route_key=$1 FOR UPDATE",[payload.route_key||"sva-primary"]);
      const route=routes[0];
      if(!route)throw problem(404,"ROUTE_NOT_FOUND");
      const rollbackMinutes=clampInt(payload.rollback_window_minutes,1440,5,10080);
      const rows=await tx.unsafe(
        "INSERT INTO carrier_switches(route_key,from_carrier_id,to_carrier_id,requested_by,scheduled_for,status,validation,notes)"+
        " VALUES($1,$2,$3,$4,$5::timestamptz,'ready',$6::jsonb,$7) RETURNING *",
        [payload.route_key||"sva-primary",route.active_carrier_id,connection.carrier_id,actorId,payload.scheduled_for||null,JSON.stringify({connection_id:connection.id,rollback_window_minutes:rollbackMinutes}),String(payload.notes||"")]
      );
      const sw=rows[0];
      const approvalPayload={route_key:sw.route_key,to_carrier_id:Number(connection.carrier_id),connection_id:Number(connection.id),rollback_window_minutes:rollbackMinutes,scheduled_for:sw.scheduled_for||null};
      const payloadHash=createHash("sha256").update(JSON.stringify(approvalPayload)).digest("hex");
      const approvals=await tx.unsafe(
        "INSERT INTO platform_change_requests(change_type,entity_type,entity_id,risk_level,payload_sha256,request_reason,requested_by)"+
        " VALUES('carrier_switch_activation','carrier_switch',$1,'critical',$2,$3,$4) RETURNING id,public_id::text AS public_id,status,expires_at",
        [String(sw.id),payloadHash,String(payload.notes||"Bascule opérateur"),actorId]
      );
      const approval=approvals[0];
      await appendChangeApprovalEvent(tx,approval.id,"requested",actorId,{entity_type:"carrier_switch",entity_id:String(sw.id),payload_sha256:payloadHash});
      await tx.unsafe(
        "INSERT INTO audit_log(user_id,action,entity_type,entity_id,details) VALUES($1,'carrier_switch.plan','carrier_switch',$2,$3::jsonb)",
        [actorId,String(sw.id),JSON.stringify({...approvalPayload,change_request_id:Number(approval.id),dual_control_required:true})]
      );
      return {...sw,change_request_id:Number(approval.id),change_request_public_id:approval.public_id,change_request_status:approval.status,change_request_expires_at:approval.expires_at};
    });
    return result;
  }

  async activateCarrierSwitch(id,actor={}){
    const actorId=numericActor(actor);
    if(!actorId)throw problem(403,"STAFF_IDENTITY_REQUIRED");
    const result=await this.sql.begin(async tx=>{
      const switchRows=await tx.unsafe("SELECT * FROM carrier_switches WHERE id=$1 FOR UPDATE",[Number(id)]);
      const sw=switchRows[0];
      if(!sw)throw problem(404,"SWITCH_NOT_FOUND");
      if(!["ready","planned"].includes(sw.status))throw problem(409,"SWITCH_NOT_READY");
      const approvalRows=await tx.unsafe(
        "SELECT * FROM platform_change_requests WHERE change_type='carrier_switch_activation' AND entity_type='carrier_switch' AND entity_id=$1 AND status='approved' AND expires_at>now() ORDER BY id DESC LIMIT 1 FOR UPDATE",
        [String(sw.id)]
      );
      const approval=approvalRows[0];
      if(!approval)throw problem(409,"DUAL_CONTROL_APPROVAL_REQUIRED");
      if(Number(approval.requested_by)===Number(approval.approved_by))throw problem(409,"DUAL_CONTROL_INVALID");
      let validation=sw.validation;
      if(typeof validation==="string"){try{validation=JSON.parse(validation);}catch{validation={};}}
      if(!validation||typeof validation!=="object")validation={};
      const connectionId=Number(validation.connection_id);
      if(!Number.isInteger(connectionId)||connectionId<=0)throw problem(409,"SWITCH_CONNECTION_MISSING");
      const rollbackMinutes=clampInt(validation.rollback_window_minutes,1440,5,10080);
      const connectionRows=await tx.unsafe(
        "SELECT id,carrier_id,state FROM carrier_connections WHERE id=$1 AND carrier_id=$2 AND purpose='sip_inbound' AND state IN ('ready','active','standby') FOR UPDATE",
        [connectionId,sw.to_carrier_id]
      );
      if(!connectionRows.length)throw problem(409,"TARGET_CONNECTION_NOT_READY");
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
      await tx.unsafe("UPDATE platform_change_requests SET status='executed',executed_at=now(),updated_at=now() WHERE id=$1",[approval.id]);
      await appendChangeApprovalEvent(tx,approval.id,"executed",actorId,{generation:Number(gens[0].generation)});
      await tx.unsafe(
        "INSERT INTO audit_log(user_id,action,entity_type,entity_id,details) VALUES($1,'carrier_switch.activate','carrier_switch',$2,$3::jsonb)",
        [actorId,String(sw.id),JSON.stringify({generation:gens[0].generation,change_request_id:Number(approval.id),approved_by:Number(approval.approved_by)})]
      );
      return {switch:updated[0],route:await routeWith(tx,sw.route_key),change_request_id:Number(approval.id)};
    });
    this.eventBus.publish("carrier.switched",{id:Number(id),active:result.route.active_carrier,generation:result.route.generation});
    return result;
  }

  async rollbackCarrierSwitch(id,actor={}){
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
        "INSERT INTO audit_log(user_id,action,entity_type,entity_id,details) VALUES($1,'carrier_switch.rollback','carrier_switch',$2,'{}'::jsonb)",
        [numericActor(actor),String(sw.id)]
      );
      return {switch:updated[0],route:await routeWith(tx,sw.route_key)};
    });
    this.eventBus.publish("carrier.rollback",{id:Number(id),active:result.route.active_carrier,generation:result.route.generation});
    return result;
  }

  async ensureLegacyStaffIdentity(loginName){
    const login=staffLoginName(loginName);
    const existing=await this.sql.unsafe("SELECT id,login_name,display_name,role,enabled FROM app_users WHERE lower(login_name)=lower($1) LIMIT 1",[login]);
    if(existing[0])return existing[0];
    const suffix=createHash("sha256").update(login.toLowerCase()).digest("hex").slice(0,16);
    await this.sql.unsafe(
      "INSERT INTO app_users(email,display_name,role,enabled,login_name) VALUES($1,$2,'admin',true,$3) ON CONFLICT DO NOTHING",
      ["legacy-"+suffix+"@staff.pgi.invalid","Administrator",login]
    );
    const rows=await this.sql.unsafe("SELECT id,login_name,display_name,role,enabled FROM app_users WHERE lower(login_name)=lower($1) LIMIT 1",[login]);
    if(!rows[0])throw problem(500,"STAFF_IDENTITY_BOOTSTRAP_FAILED");
    return rows[0];
  }

  async staffLoginIdentity(loginName){
    const login=String(loginName||"").trim();
    if(login.length<3||login.length>120)return null;
    const rows=await this.sql.unsafe(
      "SELECT u.id,u.login_name,u.display_name,u.role,u.enabled,c.password_hash,c.session_version,c.failed_attempts,c.first_failure_at,c.locked_until"+
      " FROM app_users u JOIN staff_password_credentials c ON c.app_user_id=u.id"+
      " WHERE lower(u.login_name)=lower($1) LIMIT 1",
      [login]
    );
    return rows[0]||null;
  }

  async staffCredentialById(appUserId){
    const id=Number(appUserId);if(!Number.isInteger(id)||id<=0)return null;
    const rows=await this.readSql.unsafe("SELECT u.id,u.login_name,u.enabled,c.password_hash,c.session_version,c.locked_until FROM app_users u JOIN staff_password_credentials c ON c.app_user_id=u.id WHERE u.id=$1 LIMIT 1",[id]);
    return rows[0]||null;
  }

  async recordStaffAuthFailure(appUserId,maxFailures=8,windowSeconds=900){
    const max=clampInt(maxFailures,8,2,50),window=clampInt(windowSeconds,900,60,86400);
    await this.sql.unsafe(
      "UPDATE staff_password_credentials SET"+
      " failed_attempts=CASE WHEN first_failure_at IS NULL OR first_failure_at<now()-make_interval(secs=>$2) THEN 1 ELSE failed_attempts+1 END,"+
      " first_failure_at=CASE WHEN first_failure_at IS NULL OR first_failure_at<now()-make_interval(secs=>$2) THEN now() ELSE first_failure_at END,"+
      " locked_until=CASE WHEN (CASE WHEN first_failure_at IS NULL OR first_failure_at<now()-make_interval(secs=>$2) THEN 1 ELSE failed_attempts+1 END)>=$3 THEN now()+interval '15 minutes' ELSE locked_until END,"+
      " updated_at=now() WHERE app_user_id=$1",
      [Number(appUserId),window,max]
    );
  }

  async recordStaffAuthSuccess(appUserId){
    await this.sql.unsafe("UPDATE staff_password_credentials SET failed_attempts=0,first_failure_at=NULL,locked_until=NULL,updated_at=now() WHERE app_user_id=$1",[Number(appUserId)]);
    await this.sql.unsafe("UPDATE app_users SET last_login_at=now() WHERE id=$1",[Number(appUserId)]);
  }

  async listStaffUsers(){
    return this.readSql.unsafe(
      "SELECT u.id,u.public_id::text AS public_id,u.login_name,u.email,u.display_name,u.role,u.enabled,u.last_login_at,u.created_at,"+
      " (c.app_user_id IS NOT NULL) AS password_login_enabled,c.password_changed_at,c.locked_until"+
      " FROM app_users u LEFT JOIN staff_password_credentials c ON c.app_user_id=u.id"+
      " WHERE u.login_name IS NOT NULL ORDER BY u.enabled DESC,u.display_name,u.id"
    );
  }

  async createStaffUser(input={},passwordHash,actor={}){
    const login=staffLoginName(input.login_name),role=staffRole(input.role);
    const email=String(input.email||"").trim().toLowerCase();
    const display=String(input.display_name||"").trim();
    if(display.length<2||display.length>120)throw problem(400,"INVALID_STAFF_DISPLAY_NAME");
    if(email.length<5||email.length>254||!email.includes("@"))throw problem(400,"INVALID_STAFF_EMAIL");
    if(typeof passwordHash!=="string"||passwordHash.length<20)throw problem(400,"INVALID_STAFF_PASSWORD_HASH");
    const created=await this.sql.begin(async tx=>{
      const rows=await tx.unsafe(
        "INSERT INTO app_users(email,display_name,role,enabled,login_name) VALUES($1,$2,$3,true,$4) RETURNING id,public_id::text AS public_id,login_name,email,display_name,role,enabled,created_at",
        [email,display,role,login]
      );
      const user=rows[0];
      await tx.unsafe("INSERT INTO staff_password_credentials(app_user_id,password_hash) VALUES($1,$2)",[user.id,passwordHash]);
      await tx.unsafe(
        "INSERT INTO audit_log(user_id,action,entity_type,entity_id,details) VALUES($1,'staff_user.create','app_user',$2,$3::jsonb)",
        [numericActor(actor),String(user.id),JSON.stringify({login_name:login,email,role})]
      );
      return user;
    }).catch(error=>{
      if(String(error?.code)==="23505")throw problem(409,"STAFF_LOGIN_OR_EMAIL_EXISTS");
      throw error;
    });
    return created;
  }

  async listPlatformChangeRequests(params={}){
    const limit=clampInt(params.limit,30,1,100);
    const status=String(params.status||"active").toLowerCase();
    const filter=status==="pending"?" AND cr.status='pending' AND cr.expires_at>now()":status==="approved"?" AND cr.status='approved' AND cr.expires_at>now()":status==="history"?"":" AND cr.status IN ('pending','approved') AND cr.expires_at>now()";
    const rows=await this.readSql.unsafe(
      "SELECT cr.id,cr.public_id::text AS public_id,cr.change_type,cr.entity_type,cr.entity_id,cr.risk_level,cr.status,cr.request_reason,cr.requested_at,cr.expires_at,cr.approved_at,cr.decision_reason,"+
      " requester.display_name AS requested_by_name,approver.display_name AS approved_by_name,cr.requested_by,cr.approved_by"+
      " FROM platform_change_requests cr JOIN app_users requester ON requester.id=cr.requested_by LEFT JOIN app_users approver ON approver.id=cr.approved_by"+
      " WHERE 1=1"+filter+" ORDER BY cr.requested_at DESC,cr.id DESC LIMIT $1",
      [limit]
    );
    return {data:rows,dual_control:true};
  }

  async approvePlatformChangeRequest(id,actor={},input={}){
    const actorId=numericActor(actor);
    if(!actorId)throw problem(403,"STAFF_IDENTITY_REQUIRED");
    return this.sql.begin(async tx=>{
      const rows=await tx.unsafe("SELECT * FROM platform_change_requests WHERE id=$1 FOR UPDATE",[Number(id)]);
      const row=rows[0];
      if(!row)throw problem(404,"CHANGE_REQUEST_NOT_FOUND");
      if(row.status!=="pending")throw problem(409,"CHANGE_REQUEST_NOT_PENDING");
      if(Date.now()>=Date.parse(row.expires_at))throw problem(409,"CHANGE_REQUEST_EXPIRED");
      if(Number(row.requested_by)===actorId)throw problem(409,"FOUR_EYES_SECOND_APPROVER_REQUIRED");
      const reason=optionalText(input.reason,500);
      const updated=await tx.unsafe("UPDATE platform_change_requests SET status='approved',approved_by=$1,approved_at=now(),decision_reason=$2,updated_at=now() WHERE id=$3 RETURNING id,public_id::text AS public_id,status,approved_at,approved_by",[actorId,reason,Number(id)]);
      await appendChangeApprovalEvent(tx,row.id,"approved",actorId,{reason});
      await tx.unsafe("INSERT INTO audit_log(user_id,action,entity_type,entity_id,details) VALUES($1,'platform_change.approve','platform_change_request',$2,$3::jsonb)",[actorId,String(row.id),JSON.stringify({change_type:row.change_type,target_type:row.entity_type,target_id:row.entity_id})]);
      return updated[0];
    });
  }

  async rejectPlatformChangeRequest(id,actor={},input={}){
    const actorId=numericActor(actor);
    if(!actorId)throw problem(403,"STAFF_IDENTITY_REQUIRED");
    const reason=optionalText(input.reason,500);
    if(!reason)throw problem(400,"CHANGE_REJECTION_REASON_REQUIRED");
    return this.sql.begin(async tx=>{
      const rows=await tx.unsafe("SELECT * FROM platform_change_requests WHERE id=$1 FOR UPDATE",[Number(id)]);
      const row=rows[0];
      if(!row)throw problem(404,"CHANGE_REQUEST_NOT_FOUND");
      if(row.status!=="pending")throw problem(409,"CHANGE_REQUEST_NOT_PENDING");
      if(Number(row.requested_by)===actorId)throw problem(409,"FOUR_EYES_SECOND_APPROVER_REQUIRED");
      const updated=await tx.unsafe("UPDATE platform_change_requests SET status='rejected',rejected_by=$1,rejected_at=now(),decision_reason=$2,updated_at=now() WHERE id=$3 RETURNING id,public_id::text AS public_id,status,rejected_at",[actorId,reason,Number(id)]);
      await appendChangeApprovalEvent(tx,row.id,"rejected",actorId,{reason});
      await tx.unsafe("INSERT INTO audit_log(user_id,action,entity_type,entity_id,details) VALUES($1,'platform_change.reject','platform_change_request',$2,$3::jsonb)",[actorId,String(row.id),JSON.stringify({change_type:row.change_type,target_type:row.entity_type,target_id:row.entity_id,reason})]);
      return updated[0];
    });
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

  async withTenantContext(tenantId,fn){
    const id=Number(tenantId);
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_CONTEXT");
    if(typeof fn!=="function")throw problem(500,"TENANT_CONTEXT_HANDLER_REQUIRED");
    return this.sql.begin(async tx=>{
      await tx.unsafe("SELECT set_config('pgi.tenant_id',$1,true)",[String(id)]);
      return fn(tx);
    });
  }

  async withTenantReadContext(tenantId,fn){
    const id=Number(tenantId);
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_CONTEXT");
    if(typeof fn!=="function")throw problem(500,"TENANT_CONTEXT_HANDLER_REQUIRED");
    return this.readSql.begin(async tx=>{
      await tx.unsafe("SELECT set_config('pgi.tenant_id',$1,true)",[String(id)]);
      return fn(tx);
    });
  }

  async acquireWorkerLease(leaseKey,ownerId,ttlSeconds=45){
    const rows=await this.sql.unsafe(
      "INSERT INTO worker_leases(lease_key,owner_id,expires_at)"+
      " VALUES($1,$2,now()+make_interval(secs=>$3))"+
      " ON CONFLICT(lease_key) DO UPDATE SET"+
      " owner_id=EXCLUDED.owner_id,heartbeat_at=now(),expires_at=EXCLUDED.expires_at"+
      " WHERE worker_leases.owner_id=EXCLUDED.owner_id OR worker_leases.expires_at<=now()"+
      " RETURNING lease_key,owner_id,expires_at",
      [String(leaseKey),String(ownerId),Math.max(10,Math.min(300,Number(ttlSeconds)||45))]
    );
    return rows.length>0;
  }

  async releaseWorkerLease(leaseKey,ownerId){
    const rows=await this.sql.unsafe(
      "DELETE FROM worker_leases WHERE lease_key=$1 AND owner_id=$2 RETURNING lease_key",
      [String(leaseKey),String(ownerId)]
    );
    return rows.length>0;
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

  async scanPortabilityAutomation(limit=100){
    const take=clampInt(limit,100,1,500);
    return this.sql.unsafe(
      "INSERT INTO work_queue(queue_name,tenant_id,dedupe_key,priority,payload,available_at,max_attempts)"+
      " SELECT 'portability',p.tenant_id,'portability:'||p.id||CASE WHEN p.status='cancelled' THEN ':cancel' ELSE ':auto' END,20,"+
      " jsonb_build_object('request_id',p.id,'action',CASE WHEN p.status='cancelled' THEN 'cancel' ELSE 'auto' END),now(),20"+
      " FROM tenant_portability_requests p"+
      " WHERE ("+
      "   (p.status NOT IN ('ported','rejected','cancelled') AND p.automation_state IN ('queued','checking','submitting','operator_pending','scheduled','action_required','failed'))"+
      "   OR (p.status='cancelled' AND p.operator_portability_reference IS NOT NULL AND p.automation_state IN ('cancelling','action_required','failed'))"+
      " )"+
      " AND p.automation_next_at<=now()"+
      " ORDER BY p.automation_next_at ASC,p.id ASC LIMIT $1"+
      " ON CONFLICT(queue_name,dedupe_key) WHERE dedupe_key IS NOT NULL AND completed_at IS NULL AND failed_at IS NULL"+
      " DO UPDATE SET available_at=LEAST(work_queue.available_at,EXCLUDED.available_at)"+
      " RETURNING id,tenant_id,dedupe_key,available_at",
      [take]
    );
  }

  async claimWork(queueName,workerId,limit=25,leaseSeconds=60){
    const queue=String(queueName||"").trim();
    const owner=String(workerId||"").trim();
    if(!queue||queue.length>80)throw problem(400,"INVALID_QUEUE_NAME");
    if(!owner||owner.length>160)throw problem(400,"INVALID_WORKER_ID");
    const take=clampInt(limit,25,1,100);
    const ttl=clampInt(leaseSeconds,60,15,900);
    return this.sql.begin(async tx=>{
      const candidates=await tx.unsafe(
        "SELECT id FROM work_queue"+
        " WHERE queue_name=$1 AND completed_at IS NULL AND failed_at IS NULL AND dead_lettered_at IS NULL"+
        " AND available_at<=now()"+
        " AND (locked_at IS NULL OR lease_expires_at IS NULL OR lease_expires_at<=now())"+
        " ORDER BY priority ASC,available_at ASC,id ASC LIMIT $2 FOR UPDATE SKIP LOCKED",
        [queue,take]
      );
      if(!candidates.length)return [];
      return tx.unsafe(
        "UPDATE work_queue SET locked_at=now(),locked_by=$2,"+
        " lease_expires_at=now()+make_interval(secs=>$3),attempts=attempts+1"+
        " WHERE id=ANY($1::bigint[])"+
        " RETURNING id,queue_name,tenant_id,tenant_bucket,dedupe_key,priority,payload,available_at,"+
        " locked_at,locked_by,lease_expires_at,attempts,max_attempts,correlation_id,trace_id,created_at",
        [candidates.map(x=>Number(x.id)),owner,ttl]
      );
    });
  }

  async extendWorkLease(id,workerId,leaseSeconds=60){
    const ttl=clampInt(leaseSeconds,60,15,900);
    const rows=await this.sql.unsafe(
      "UPDATE work_queue SET lease_expires_at=now()+make_interval(secs=>$3)"+
      " WHERE id=$1 AND locked_by=$2 AND completed_at IS NULL AND failed_at IS NULL AND dead_lettered_at IS NULL"+
      " RETURNING id,lease_expires_at",
      [Number(id),String(workerId||""),ttl]
    );
    if(!rows.length)throw problem(409,"WORK_LEASE_LOST");
    return rows[0];
  }

  async completeWork(id,workerId){
    const rows=await this.sql.unsafe(
      "UPDATE work_queue SET completed_at=now(),locked_at=NULL,locked_by=NULL,lease_expires_at=NULL,last_error=NULL"+
      " WHERE id=$1 AND locked_by=$2 AND completed_at IS NULL AND failed_at IS NULL AND dead_lettered_at IS NULL"+
      " RETURNING id,queue_name,completed_at",
      [Number(id),String(workerId||"")]
    );
    if(!rows.length)throw problem(409,"WORK_LEASE_LOST");
    return rows[0];
  }

  async failWork(id,workerId,errorMessage,retryDelaySeconds=30){
    const owner=String(workerId||"");
    const message=String(errorMessage||"worker failed").slice(0,1000);
    const delay=clampInt(retryDelaySeconds,30,1,3600);
    return this.sql.begin(async tx=>{
      const rows=await tx.unsafe(
        "SELECT id,queue_name,tenant_id,correlation_id,trace_id,payload,attempts,max_attempts"+
        " FROM work_queue WHERE id=$1 AND locked_by=$2 AND completed_at IS NULL"+
        " AND failed_at IS NULL AND dead_lettered_at IS NULL FOR UPDATE",
        [Number(id),owner]
      );
      const work=rows[0];
      if(!work)throw problem(409,"WORK_LEASE_LOST");
      if(Number(work.attempts)>=Number(work.max_attempts)){
        await tx.unsafe(
          "UPDATE work_queue SET failed_at=now(),dead_lettered_at=now(),last_error=$2,"+
          " locked_at=NULL,locked_by=NULL,lease_expires_at=NULL WHERE id=$1",
          [Number(id),message]
        );
        await tx.unsafe(
          "INSERT INTO work_queue_dead_letters(work_id,queue_name,tenant_id,correlation_id,trace_id,payload,attempts,last_error)"+
          " VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) ON CONFLICT(work_id) DO NOTHING",
          [Number(id),work.queue_name,work.tenant_id,work.correlation_id,work.trace_id,JSON.stringify(work.payload||{}),Number(work.attempts),message]
        );
        return {id:Number(id),state:"dead_lettered",attempts:Number(work.attempts)};
      }
      const exponential=Math.min(3600,delay*Math.pow(2,Math.max(0,Number(work.attempts)-1)));
      await tx.unsafe(
        "UPDATE work_queue SET available_at=now()+make_interval(secs=>$3),last_error=$4,"+
        " locked_at=NULL,locked_by=NULL,lease_expires_at=NULL WHERE id=$1 AND locked_by=$2",
        [Number(id),owner,Math.round(exponential),message]
      );
      return {id:Number(id),state:"retry",attempts:Number(work.attempts),retry_in_seconds:Math.round(exponential)};
    });
  }

  async enqueueWork(queueName,payload={},options={}){
    const queue=String(queueName||"").trim();
    if(!queue||queue.length>80)throw problem(400,"INVALID_QUEUE_NAME");
    const tenantId=options.tenant_id==null?null:Number(options.tenant_id);
    const priority=clampInt(options.priority,100,1,1000);
    const maxAttempts=clampInt(options.max_attempts,10,1,50);
    const availableAt=options.available_at||new Date().toISOString();
    const dedupe=options.dedupe_key?String(options.dedupe_key).slice(0,200):null;
    const rows=await this.sql.unsafe(
      "INSERT INTO work_queue(queue_name,tenant_id,dedupe_key,priority,payload,available_at,max_attempts,trace_id)"+
      " VALUES($1,$2,$3,$4,$5::jsonb,$6::timestamptz,$7,$8)"+
      " ON CONFLICT(queue_name,dedupe_key) WHERE dedupe_key IS NOT NULL AND completed_at IS NULL AND failed_at IS NULL"+
      " DO UPDATE SET available_at=LEAST(work_queue.available_at,EXCLUDED.available_at)"+
      " RETURNING id,queue_name,tenant_id,dedupe_key,priority,available_at,max_attempts,correlation_id,trace_id,created_at",
      [queue,tenantId,dedupe,priority,JSON.stringify(payload||{}),availableAt,maxAttempts,options.trace_id?String(options.trace_id).slice(0,64):null]
    );
    return rows[0];
  }

  async scanOutboundPortabilityAutomation(limit=100){
    limit=clampInt(limit,100,1,500);
    const rows=await this.readSql.unsafe(
      "SELECT public_id::text AS public_id,tenant_id,action_type FROM tenant_relation_actions"+
      " WHERE status='queued' AND execution_mode='external_confirmation'"+
      " AND action_type IN ('request_outbound_rio','submit_port_out','request_port_out_report','request_port_out_cancel','request_port_out_return_back')"+
      " ORDER BY created_at,id LIMIT $1",
      [limit]
    );
    const queued=[];
    for(const row of rows){
      const work=await this.enqueueWork("portability_outbound",{action_public_id:row.public_id},{
        tenant_id:Number(row.tenant_id),priority:250,max_attempts:50,dedupe_key:"portability_outbound:"+row.public_id
      });
      queued.push({action_public_id:row.public_id,action_type:row.action_type,work_id:Number(work.id)});
    }
    return queued;
  }

  async workQueueHealth(){
    const rows=await this.sql.unsafe(
      "SELECT"+
      " count(*) FILTER(WHERE completed_at IS NULL AND failed_at IS NULL AND dead_lettered_at IS NULL)::int AS pending,"+
      " count(*) FILTER(WHERE locked_at IS NOT NULL AND completed_at IS NULL AND failed_at IS NULL AND dead_lettered_at IS NULL)::int AS leased,"+
      " count(*) FILTER(WHERE dead_lettered_at IS NOT NULL)::int AS dead_lettered,"+
      " COALESCE(EXTRACT(EPOCH FROM (now()-min(created_at) FILTER(WHERE completed_at IS NULL AND failed_at IS NULL AND dead_lettered_at IS NULL))),0)::float8 AS oldest_pending_seconds"+
      " FROM work_queue"
    );
    return rows[0];
  }

  async subscriptionBillingOverview(){
    const [summaryRows,priceRows,recentPrices,accessRows]=await Promise.all([
      this.readSql.unsafe(
        "SELECT"+
        " (SELECT count(*)::bigint FROM tenants WHERE tenant_type<>'internal') AS external_tenants,"+
        " (SELECT count(*)::bigint FROM tenant_subscription_access WHERE tenant_type<>'internal' AND premium_call_access) AS access_enabled,"+
        " (SELECT count(*)::bigint FROM tenant_subscription_access WHERE tenant_type<>'internal' AND NOT premium_call_access) AS access_blocked,"+
        " (SELECT count(*)::bigint FROM tenant_subscription_access WHERE tenant_type='internal' AND billing_exempt) AS internal_exempt,"+
        " (SELECT count(*)::bigint FROM tenant_subscriptions s JOIN service_plans p ON p.id=s.service_plan_id WHERE p.plan_key='external-sva-access' AND s.status='active' AND s.current_period_end>now()) AS active_subscriptions"
      ),
      this.readSql.unsafe(
        "SELECT v.id,p.plan_key,p.display_name,v.market_id,m.country_code AS market,v.currency,v.amount_minor,v.tax_behavior,"+
        " v.billing_interval,v.interval_count,v.effective_from,v.effective_to,v.provider,v.provider_price_reference"+
        " FROM service_plan_price_versions v JOIN service_plans p ON p.id=v.service_plan_id"+
        " LEFT JOIN operating_markets m ON m.id=v.market_id"+
        " WHERE p.plan_key='external-sva-access' AND v.effective_from<=now()"+
        " AND (v.effective_to IS NULL OR v.effective_to>now())"+
        " ORDER BY (v.market_id IS NULL) DESC,v.effective_from DESC LIMIT 1"
      ),
      this.readSql.unsafe(
        "SELECT v.id,v.currency,v.amount_minor,v.tax_behavior,v.billing_interval,v.interval_count,v.effective_from,v.effective_to,"+
        " m.country_code AS market,v.provider,v.provider_price_reference"+
        " FROM service_plan_price_versions v JOIN service_plans p ON p.id=v.service_plan_id"+
        " LEFT JOIN operating_markets m ON m.id=v.market_id"+
        " WHERE p.plan_key='external-sva-access' ORDER BY v.effective_from DESC LIMIT 20"
      ),
      this.readSql.unsafe(
        "SELECT tenant_public_id,display_name,tenant_type,tenant_status,billing_exempt,premium_call_access,"+
        " subscription_status,billing_currency,current_period_end,cancel_at_period_end,last_payment_status,billing_provider,amount_minor"+
        " FROM tenant_subscription_access WHERE tenant_type<>'internal' ORDER BY display_name LIMIT 100"
      )
    ]);
    return {
      plan_key:"external-sva-access",
      billing_model:"subscription",
      cadence:"monthly",
      internal_usage_exempt:true,
      current_price:priceRows[0]||null,
      summary:numberFields(summaryRows[0]||{},["external_tenants","access_enabled","access_blocked","internal_exempt","active_subscriptions"]),
      price_history:recentPrices,
      tenant_access:accessRows
    };
  }

  async createSubscriptionPrice(payload={},actor={}){
    const amountMinor=Number(payload.amount_minor);
    if(!Number.isInteger(amountMinor)||amountMinor<=0||amountMinor>100000000)throw problem(400,"INVALID_SUBSCRIPTION_PRICE");
    const currency=String(payload.currency||"EUR").trim().toUpperCase();
    if(!/^[A-Z]{3}$/.test(currency))throw problem(400,"INVALID_SUBSCRIPTION_CURRENCY");
    const marketId=payload.market_id==null||payload.market_id===""?null:Number(payload.market_id);
    if(marketId!=null&&(!Number.isInteger(marketId)||marketId<=0))throw problem(400,"INVALID_MARKET_ID");
    const effectiveFrom=payload.effective_from||new Date().toISOString();
    if(!Number.isFinite(Date.parse(effectiveFrom)))throw problem(400,"INVALID_EFFECTIVE_FROM");
    const provider=payload.provider==null||payload.provider===""?null:String(payload.provider).trim().toLowerCase();
    const providerPriceReference=payload.provider_price_reference==null||payload.provider_price_reference===""?null:String(payload.provider_price_reference).trim();
    if(provider&&!/^[a-z0-9_.-]{2,40}$/.test(provider))throw problem(400,"INVALID_BILLING_PROVIDER");
    if(providerPriceReference&&(!provider||providerPriceReference.length>200))throw problem(400,"INVALID_PROVIDER_PRICE_REFERENCE");
    const actorId=numericActor(actor);
    const rows=await this.sql.begin(async tx=>{
      const created=await tx.unsafe(
        "SELECT pgi_publish_service_plan_price('external-sva-access',$1::char(3),$2,$3::timestamptz,$4,$5,$6,$7) AS id",
        [currency,amountMinor,effectiveFrom,marketId,actorId,provider,providerPriceReference]
      );
      const id=Number(created[0]?.id);
      const price=await tx.unsafe(
        "SELECT v.id,p.plan_key,v.market_id,m.country_code AS market,v.currency,v.amount_minor,v.tax_behavior,v.billing_interval,v.interval_count,"+
        " v.effective_from,v.effective_to FROM service_plan_price_versions v JOIN service_plans p ON p.id=v.service_plan_id"+
        " LEFT JOIN operating_markets m ON m.id=v.market_id WHERE v.id=$1",
        [id]
      );
      await tx.unsafe(
        "INSERT INTO audit_log(user_id,action,entity_type,entity_id,details) VALUES($1,'subscription.price.publish','service_plan_price',$2,$3::jsonb)",
        [actorId,String(id),JSON.stringify({plan_key:"external-sva-access",currency,amount_minor:amountMinor,tax_behavior:"inclusive",market_id:marketId,effective_from:effectiveFrom})]
      );
      return price;
    });
    return rows[0];
  }

  async applySubscriptionBillingEvent(payload={}){
    const provider=String(payload.provider||"").trim().toLowerCase();
    const eventId=String(payload.provider_event_id||"").trim();
    const tenantPublicId=String(payload.tenant_public_id||"").trim();
    const providerSubscription=String(payload.provider_subscription_reference||"").trim();
    const providerCustomer=String(payload.provider_customer_reference||"").trim()||null;
    const eventType=String(payload.event_type||"subscription.updated").trim();
    const status=String(payload.status||"").trim().toLowerCase();
    const eventTime=payload.event_time||new Date().toISOString();
    const periodStart=payload.current_period_start||null;
    const periodEnd=payload.current_period_end||null;
    const endsAtInput=payload.ends_at||null;
    const priceVersionId=Number(payload.price_version_id);
    const marketId=payload.market_id==null||payload.market_id===""?null:Number(payload.market_id);
    const lastPaymentStatus=payload.last_payment_status==null?null:String(payload.last_payment_status).trim().toLowerCase();
    const providerInvoiceReference=payload.provider_invoice_reference==null?null:String(payload.provider_invoice_reference).trim();
    const paymentAttemptCount=payload.payment_attempt_count==null?null:Number(payload.payment_attempt_count);
    const nextPaymentAttempt=payload.next_payment_attempt||null;
    const providerPriceReference=payload.provider_price_reference==null?null:String(payload.provider_price_reference).trim();
    const providerPriceAmount=payload.provider_price_amount_minor==null?null:Number(payload.provider_price_amount_minor);
    const providerPriceCurrency=payload.provider_price_currency==null?null:String(payload.provider_price_currency).trim().toUpperCase();
    const providerBillingInterval=payload.provider_billing_interval==null?null:String(payload.provider_billing_interval).trim().toLowerCase();
    const providerIntervalCount=payload.provider_interval_count==null?null:Number(payload.provider_interval_count);
    if(!/^[a-z0-9_.-]{2,40}$/.test(provider))throw problem(400,"INVALID_BILLING_PROVIDER");
    if(!eventId||eventId.length>200)throw problem(400,"INVALID_BILLING_EVENT_ID");
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantPublicId))throw problem(400,"INVALID_BILLING_TENANT");
    if(!providerSubscription||providerSubscription.length>200)throw problem(400,"INVALID_BILLING_SUBSCRIPTION_REFERENCE");
    if(providerCustomer&&providerCustomer.length>200)throw problem(400,"INVALID_BILLING_CUSTOMER_REFERENCE");
    if(!eventType||eventType.length>120||!/^[A-Za-z0-9_.:-]+$/.test(eventType))throw problem(400,"INVALID_BILLING_EVENT_TYPE");
    if(!["active","past_due","suspended","cancelled","ended"].includes(status))throw problem(400,"INVALID_SUBSCRIPTION_STATUS");
    if(!Number.isInteger(priceVersionId)||priceVersionId<=0)throw problem(400,"INVALID_PRICE_VERSION");
    if(marketId!=null&&(!Number.isInteger(marketId)||marketId<=0))throw problem(400,"INVALID_MARKET_ID");
    if(!Number.isFinite(Date.parse(eventTime)))throw problem(400,"INVALID_BILLING_EVENT_TIME");
    if(periodStart&&!Number.isFinite(Date.parse(periodStart)))throw problem(400,"INVALID_SUBSCRIPTION_PERIOD_START");
    if(periodEnd&&!Number.isFinite(Date.parse(periodEnd)))throw problem(400,"INVALID_SUBSCRIPTION_PERIOD_END");
    if(periodStart&&periodEnd&&Date.parse(periodEnd)<=Date.parse(periodStart))throw problem(400,"INVALID_SUBSCRIPTION_PERIOD");
    if(endsAtInput&&!Number.isFinite(Date.parse(endsAtInput)))throw problem(400,"INVALID_SUBSCRIPTION_END");
    if(status==="active"&&(!periodEnd||Date.parse(periodEnd)<=Date.parse(eventTime)))throw problem(400,"ACTIVE_SUBSCRIPTION_PERIOD_REQUIRED");
    if(providerInvoiceReference&&providerInvoiceReference.length>200)throw problem(400,"INVALID_PROVIDER_INVOICE_REFERENCE");
    if(paymentAttemptCount!=null&&(!Number.isInteger(paymentAttemptCount)||paymentAttemptCount<0||paymentAttemptCount>100))throw problem(400,"INVALID_PAYMENT_ATTEMPT_COUNT");
    if(nextPaymentAttempt&&!Number.isFinite(Date.parse(nextPaymentAttempt)))throw problem(400,"INVALID_NEXT_PAYMENT_ATTEMPT");
    if(providerPriceReference&&providerPriceReference.length>200)throw problem(400,"INVALID_PROVIDER_PRICE_REFERENCE");
    if(providerPriceAmount!=null&&(!Number.isInteger(providerPriceAmount)||providerPriceAmount<0))throw problem(400,"INVALID_PROVIDER_PRICE_AMOUNT");
    if(providerPriceCurrency&&!/^[A-Z]{3}$/.test(providerPriceCurrency))throw problem(400,"INVALID_PROVIDER_PRICE_CURRENCY");
    if(providerBillingInterval&& !["month","year"].includes(providerBillingInterval))throw problem(400,"INVALID_PROVIDER_BILLING_INTERVAL");
    if(providerIntervalCount!=null&&(!Number.isInteger(providerIntervalCount)||providerIntervalCount<=0))throw problem(400,"INVALID_PROVIDER_INTERVAL_COUNT");
    const normalized={
      provider,provider_event_id:eventId,tenant_public_id:tenantPublicId,provider_customer_reference:providerCustomer,
      provider_subscription_reference:providerSubscription,event_type:eventType,status,event_time:eventTime,
      price_version_id:priceVersionId,market_id:marketId,current_period_start:periodStart,current_period_end:periodEnd,
      cancel_at_period_end:!!payload.cancel_at_period_end,last_payment_status:lastPaymentStatus,ends_at:endsAtInput,
      provider_invoice_reference:providerInvoiceReference,payment_attempt_count:paymentAttemptCount,next_payment_attempt:nextPaymentAttempt,
      provider_price_reference:providerPriceReference,provider_price_amount_minor:providerPriceAmount,provider_price_currency:providerPriceCurrency,
      provider_billing_interval:providerBillingInterval,provider_interval_count:providerIntervalCount
    };
    const hash=createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
    const result=await this.sql.begin(async tx=>{
      await tx.unsafe("SELECT pg_advisory_xact_lock(hashtext($1))",[provider+":"+eventId]);
      const seen=await tx.unsafe("SELECT id,subscription_id,payload_sha256 FROM subscription_billing_events WHERE provider=$1 AND provider_event_id=$2",[provider,eventId]);
      if(seen.length){
        if(String(seen[0].payload_sha256)!==hash)throw problem(409,"BILLING_EVENT_ID_COLLISION");
        return {duplicate:true,subscription_id:seen[0].subscription_id};
      }
      const tenantRows=await tx.unsafe("SELECT id,tenant_type,status FROM tenants WHERE public_id=$1::uuid LIMIT 1",[tenantPublicId]);
      const tenant=tenantRows[0];
      if(!tenant)throw problem(404,"BILLING_TENANT_NOT_FOUND");
      if(tenant.tenant_type==="internal")throw problem(409,"INTERNAL_TENANT_BILLING_EXEMPT");
      const priceRows=await tx.unsafe(
        "SELECT v.id,v.service_plan_id,v.currency,v.market_id,v.amount_minor,v.billing_interval,v.interval_count,v.provider,v.provider_price_reference FROM service_plan_price_versions v"+
        " JOIN service_plans p ON p.id=v.service_plan_id WHERE v.id=$1 AND p.plan_key='external-sva-access' LIMIT 1",
        [priceVersionId]
      );
      const price=priceRows[0];
      if(!price)throw problem(404,"SUBSCRIPTION_PRICE_NOT_FOUND");
      if(price.market_id!=null&&Number(price.market_id)!==marketId)throw problem(409,"SUBSCRIPTION_PRICE_MARKET_MISMATCH");
      if(providerPriceAmount!=null&&Number(price.amount_minor)!==providerPriceAmount)throw problem(409,"SUBSCRIPTION_PRICE_AMOUNT_MISMATCH");
      if(providerPriceCurrency&&String(price.currency).toUpperCase()!==providerPriceCurrency)throw problem(409,"SUBSCRIPTION_PRICE_CURRENCY_MISMATCH");
      if(providerBillingInterval&&String(price.billing_interval)!==providerBillingInterval)throw problem(409,"SUBSCRIPTION_PRICE_INTERVAL_MISMATCH");
      if(providerIntervalCount!=null&&Number(price.interval_count)!==providerIntervalCount)throw problem(409,"SUBSCRIPTION_PRICE_INTERVAL_MISMATCH");
      if(price.provider&&String(price.provider)!==provider)throw problem(409,"SUBSCRIPTION_PRICE_PROVIDER_MISMATCH");
      if(price.provider_price_reference&&providerPriceReference&&String(price.provider_price_reference)!==providerPriceReference)throw problem(409,"SUBSCRIPTION_PRICE_PROVIDER_REFERENCE_MISMATCH");
      let subscriptions=await tx.unsafe(
        "SELECT id,tenant_id,last_event_at,provider_customer_reference FROM tenant_subscriptions WHERE billing_provider=$1 AND provider_subscription_reference=$2 LIMIT 1 FOR UPDATE",
        [provider,providerSubscription]
      );
      if(subscriptions.length&&Number(subscriptions[0].tenant_id)!==Number(tenant.id))throw problem(409,"BILLING_SUBSCRIPTION_TENANT_MISMATCH");
      if(subscriptions.length&&providerCustomer&&subscriptions[0].provider_customer_reference&&String(subscriptions[0].provider_customer_reference)!==providerCustomer)throw problem(409,"BILLING_CUSTOMER_REFERENCE_MISMATCH");
      let subscriptionId;
      const startsAt=periodStart||eventTime;
      const endsAt=["cancelled","ended"].includes(status)?(endsAtInput||eventTime):null;
      if(!subscriptions.length){
        const inserted=await tx.unsafe(
          "INSERT INTO tenant_subscriptions(tenant_id,service_plan_id,market_id,status,billing_currency,external_billing_reference,"+
          " starts_at,current_period_start,current_period_end,ends_at,price_version_id,billing_provider,provider_customer_reference,"+
          " provider_subscription_reference,cancel_at_period_end,last_payment_status,last_event_at,metadata)"+
          " VALUES($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9::timestamptz,$10::timestamptz,$11,$12,$13,$14,$15,$16,$17::timestamptz,$18::jsonb) RETURNING id",
          [tenant.id,price.service_plan_id,marketId,status,price.currency,providerSubscription,startsAt,periodStart,periodEnd,endsAt,
           priceVersionId,provider,providerCustomer,providerSubscription,!!payload.cancel_at_period_end,lastPaymentStatus,eventTime,
           JSON.stringify({source:"billing_provider"})]
        );
        subscriptionId=Number(inserted[0].id);
      }else{
        subscriptionId=Number(subscriptions[0].id);
        const last=Date.parse(subscriptions[0].last_event_at||"");
        if(!Number.isFinite(last)||Date.parse(eventTime)>=last){
          await tx.unsafe(
            "UPDATE tenant_subscriptions SET service_plan_id=$2,market_id=$3,status=$4,billing_currency=$5,"+
            " current_period_start=$6::timestamptz,current_period_end=$7::timestamptz,ends_at=$8::timestamptz,price_version_id=$9,"+
            " provider_customer_reference=$10,cancel_at_period_end=$11,last_payment_status=$12,last_event_at=$13::timestamptz,updated_at=now() WHERE id=$1",
            [subscriptionId,price.service_plan_id,marketId,status,price.currency,periodStart,periodEnd,endsAt,priceVersionId,
             providerCustomer,!!payload.cancel_at_period_end,lastPaymentStatus,eventTime]
          );
        }
      }
      await tx.unsafe(
        "INSERT INTO subscription_billing_events(provider,provider_event_id,tenant_id,subscription_id,event_type,event_time,payload_sha256,normalized_details)"+
        " VALUES($1,$2,$3,$4,$5,$6::timestamptz,$7,$8::jsonb)",
        [provider,eventId,tenant.id,subscriptionId,eventType,eventTime,hash,JSON.stringify(normalized)]
      );
      await tx.unsafe(
        "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,NULL,'subscription.billing_event','tenant_subscription',$2,$3::jsonb)",
        [tenant.id,String(subscriptionId),JSON.stringify({provider,event_type:eventType,status,provider_event_id:eventId,price_version_id:priceVersionId})]
      );
      await tx.unsafe(
        "INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload) VALUES($1,'subscription.changed','tenant_subscription',$2,$3::jsonb)",
        [tenant.id,String(subscriptionId),JSON.stringify({status,provider,event_type:eventType})]
      );
      const paymentFailed=eventType==="invoice.payment_failed"||lastPaymentStatus==="failed";
      const paymentActionRequired=eventType==="invoice.payment_action_required"||lastPaymentStatus==="action_required";
      const paymentRecovered=eventType==="invoice.paid"||(status==="active"&&["paid","succeeded","success"].includes(lastPaymentStatus||""));
      if(paymentFailed||paymentActionRequired){
        const recoveryState=paymentActionRequired?"action_required":((paymentAttemptCount||1)>1?"retrying":"grace");
        const attempts=Math.max(1,paymentAttemptCount||1);
        await tx.unsafe(
          "INSERT INTO subscription_recovery_states(subscription_id,tenant_id,recovery_state,first_failed_at,last_failed_at,grace_until,recovery_deadline,next_retry_at,attempt_count,last_invoice_reference,last_payment_status,recovered_at)"+
          " VALUES($1,$2,$3,$4::timestamptz,$4::timestamptz,$4::timestamptz+interval '7 days',$4::timestamptz+interval '14 days',$5::timestamptz,$6,$7,$8,NULL)"+
          " ON CONFLICT(subscription_id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id,"+
          " recovery_state=CASE WHEN subscription_recovery_states.recovery_state IN ('healthy','recovered') THEN EXCLUDED.recovery_state"+
          " WHEN EXCLUDED.recovery_state='action_required' THEN 'action_required' ELSE 'retrying' END,"+
          " first_failed_at=CASE WHEN subscription_recovery_states.recovery_state IN ('healthy','recovered') OR subscription_recovery_states.first_failed_at IS NULL THEN EXCLUDED.first_failed_at ELSE subscription_recovery_states.first_failed_at END,"+
          " last_failed_at=EXCLUDED.last_failed_at,"+
          " grace_until=CASE WHEN subscription_recovery_states.recovery_state IN ('healthy','recovered') OR subscription_recovery_states.grace_until IS NULL THEN EXCLUDED.grace_until ELSE subscription_recovery_states.grace_until END,"+
          " recovery_deadline=CASE WHEN subscription_recovery_states.recovery_state IN ('healthy','recovered') OR subscription_recovery_states.recovery_deadline IS NULL THEN EXCLUDED.recovery_deadline ELSE subscription_recovery_states.recovery_deadline END,"+
          " next_retry_at=EXCLUDED.next_retry_at,attempt_count=GREATEST(subscription_recovery_states.attempt_count,EXCLUDED.attempt_count),"+
          " last_invoice_reference=COALESCE(EXCLUDED.last_invoice_reference,subscription_recovery_states.last_invoice_reference),last_payment_status=EXCLUDED.last_payment_status,recovered_at=NULL",
          [subscriptionId,tenant.id,recoveryState,eventTime,nextPaymentAttempt,attempts,providerInvoiceReference,lastPaymentStatus||recoveryState]
        );
        await tx.unsafe(
          "INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload) VALUES($1,'subscription.payment_attention','tenant_subscription',$2,$3::jsonb)",
          [tenant.id,String(subscriptionId),JSON.stringify({status,recovery_state:recoveryState,attempt_count:attempts,next_payment_attempt:nextPaymentAttempt,grace_days:7,recovery_days:14,provider,event_type:eventType})]
        );
      }else if(paymentRecovered){
        await tx.unsafe(
          "INSERT INTO subscription_recovery_states(subscription_id,tenant_id,recovery_state,last_payment_status,recovered_at,attempt_count)"+
          " VALUES($1,$2,'recovered',$3,$4::timestamptz,0)"+
          " ON CONFLICT(subscription_id) DO UPDATE SET recovery_state='recovered',last_payment_status=EXCLUDED.last_payment_status,recovered_at=EXCLUDED.recovered_at,"+
          " grace_until=NULL,recovery_deadline=NULL,next_retry_at=NULL,attempt_count=0",
          [subscriptionId,tenant.id,lastPaymentStatus||"paid",eventTime]
        );
        await tx.unsafe(
          "INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload) VALUES($1,'subscription.payment_recovered','tenant_subscription',$2,$3::jsonb)",
          [tenant.id,String(subscriptionId),JSON.stringify({status,provider,event_type:eventType,recovered_at:eventTime})]
        );
      }
      if(status==="active"&&periodEnd&&Date.parse(periodEnd)>Date.parse(eventTime)&&(!lastPaymentStatus||["paid","succeeded","success"].includes(lastPaymentStatus))){
        await tx.unsafe(
          "UPDATE tenant_admin_alerts SET state='resolved',resolved_at=now(),updated_at=now() WHERE tenant_id=$1 AND subscription_id=$2 AND alert_type='subscription_unpaid' AND state<>'resolved'",
          [tenant.id,subscriptionId]
        );
      }
      return {duplicate:false,subscription_id:subscriptionId,tenant_id:Number(tenant.id),status};
    });
    if(!result.duplicate)this.eventBus.publish("subscription.changed",{id:result.subscription_id,tenant_id:result.tenant_id,status:result.status});
    return result;
  }

  async tenantDuplicateCandidates(input={}){
    const email=String(input.email||input.billing_email||"").trim().toLowerCase().slice(0,320);
    const name=String(input.company_name||input.legal_name||input.display_name||"").trim().slice(0,200);
    const country=String(input.country_code||"").trim().toUpperCase();
    const registration=String(input.registration_number||"").trim().replace(/\s+/g,"").slice(0,64);
    const phone=String(input.phone||"").trim().replace(/[^0-9+]/g,"").slice(0,40);
    if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw problem(400,"INVALID_CUSTOMER_EMAIL");
    if(country&&!/^[A-Z]{2}$/.test(country))throw problem(400,"INVALID_COUNTRY_CODE");
    if(!email&&!name&&!registration&&!phone)return {data:[]};
    const rows=await this.readSql.unsafe(
      "SELECT DISTINCT t.public_id,t.display_name,t.legal_name,t.country_code,t.billing_email,t.status,t.created_at,k.registration_number,"+
      " (lower(btrim(COALESCE(t.billing_email,'')))=$1 OR EXISTS (SELECT 1 FROM customer_tenant_memberships cm JOIN customer_principals cp ON cp.id=cm.customer_principal_id WHERE cm.tenant_id=t.id AND cp.email_normalized=$1)) AS email_match,"+
      " ($2<>'' AND (lower(btrim(t.display_name))=lower(btrim($2)) OR lower(btrim(COALESCE(t.legal_name,'')))=lower(btrim($2))) AND ($3='' OR t.country_code=$3)) AS name_match,"+
      " ($4<>'' AND k.registration_number=$4 AND ($3='' OR k.registration_country=$3)) AS registration_match,"+
      " ($5<>'' AND EXISTS (SELECT 1 FROM customer_tenant_memberships cm JOIN customer_principals cp ON cp.id=cm.customer_principal_id WHERE cm.tenant_id=t.id AND regexp_replace(COALESCE(cp.metadata->>'phone',''),'[^0-9+]','','g')=$5)) AS phone_match"+
      " FROM tenants t LEFT JOIN tenant_kyc_profiles k ON k.tenant_id=t.id WHERE t.tenant_type<>'internal' AND ("+
      " ($1<>'' AND (lower(btrim(COALESCE(t.billing_email,'')))=$1 OR EXISTS (SELECT 1 FROM customer_tenant_memberships cm JOIN customer_principals cp ON cp.id=cm.customer_principal_id WHERE cm.tenant_id=t.id AND cp.email_normalized=$1)))"+
      " OR ($2<>'' AND (lower(btrim(t.display_name))=lower(btrim($2)) OR lower(btrim(COALESCE(t.legal_name,'')))=lower(btrim($2))) AND ($3='' OR t.country_code=$3))"+
      " OR ($4<>'' AND k.registration_number=$4 AND ($3='' OR k.registration_country=$3))"+
      " OR ($5<>'' AND EXISTS (SELECT 1 FROM customer_tenant_memberships cm JOIN customer_principals cp ON cp.id=cm.customer_principal_id WHERE cm.tenant_id=t.id AND regexp_replace(COALESCE(cp.metadata->>'phone',''),'[^0-9+]','','g')=$5))"+
      " ) ORDER BY t.created_at DESC LIMIT 10",
      [email,name,country,registration,phone]
    );
    return {data:rows.map(row=>({...row,reasons:["email_match","registration_match","phone_match","name_match"].filter(k=>row[k]).map(k=>k.replace("_match",""))}))};
  }

  async createTenant(payload={},actor={}){
    const displayName=String(payload.display_name||"").trim().slice(0,160);
    const legalName=String(payload.legal_name||displayName).trim().slice(0,200);
    const tenantType=String(payload.tenant_type||"customer").trim().toLowerCase();
    const country=String(payload.country_code||"").trim().toUpperCase();
    const billingEmail=String(payload.billing_email||"").trim().toLowerCase().slice(0,254);
    const localeInput=payload.preferred_locale==null?"":String(payload.preferred_locale).trim().slice(0,35);
    const currencyInput=payload.default_currency==null?"":String(payload.default_currency).trim().toUpperCase();
    const timezoneInput=payload.timezone==null?"":String(payload.timezone).trim().slice(0,80);
    if(displayName.length<2)throw problem(400,"TENANT_DISPLAY_NAME_REQUIRED");
    if(!["customer","reseller"].includes(tenantType))throw problem(400,"INVALID_TENANT_TYPE");
    if(!/^[A-Z]{2}$/.test(country))throw problem(400,"INVALID_COUNTRY_CODE");
    if(billingEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingEmail))throw problem(400,"INVALID_BILLING_EMAIL");
    if(currencyInput&&!/^[A-Z]{3}$/.test(currencyInput))throw problem(400,"INVALID_TENANT_CURRENCY");
    if(localeInput&&!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(localeInput))throw problem(400,"INVALID_TENANT_LOCALE");
    if(timezoneInput&&!/^[A-Za-z0-9_+\-/]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(timezoneInput))throw problem(400,"INVALID_TENANT_TIMEZONE");
    const slugBase=displayName.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,48)||"client";
    const actorId=numericActor(actor);
    const result=await this.sql.begin(async tx=>{
      const markets=await tx.unsafe("SELECT id,default_locale,default_currency,timezone,data_region FROM operating_markets WHERE country_code=$1 LIMIT 1",[country]);
      const market=markets[0]||null;
      const billingDefault=resolveBillingCurrency(country);
      const locale=localeInput||market?.default_locale||"en";
      const currency=currencyInput||billingDefault?.currency||market?.default_currency||"EUR";
      const timezone=timezoneInput||market?.timezone||"UTC";
      const rows=await tx.unsafe(
        "INSERT INTO tenants(slug,display_name,legal_name,tenant_type,status,country_code,billing_email,preferred_locale,default_currency,timezone)"+
        " VALUES($1||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,8),$2,$3,$4,'pending',$5,$6,$7,$8,$9)"+
        " RETURNING id,public_id,slug,display_name,legal_name,tenant_type,status,country_code,billing_email,preferred_locale,default_currency,timezone,home_region,capacity_tier,created_at",
        [slugBase,displayName,legalName,tenantType,country,billingEmail||null,locale,currency,timezone]
      );
      const tenant=rows[0];
      await tx.unsafe(
        "INSERT INTO tenant_kyc_profiles(tenant_id,entity_type,registration_country,status) VALUES($1,'company',$2,'pending') ON CONFLICT(tenant_id) DO NOTHING",
        [tenant.id,country]
      );
      await tx.unsafe(
        "INSERT INTO tenant_market_profiles(tenant_id,market_id,status,preferred_locale,billing_currency,timezone,compliance_status,data_residency_region)"+
        " SELECT $1,m.id,'onboarding',$2,$3,$4,'not_started',m.data_region FROM operating_markets m WHERE m.country_code=$5"+
        " ON CONFLICT(tenant_id,market_id) DO NOTHING",
        [tenant.id,locale,currency,timezone,country]
      );
      await tx.unsafe(
        "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'tenant.create','tenant',$3,$4::jsonb)",
        [tenant.id,actorId,String(tenant.id),JSON.stringify({public_id:tenant.public_id,country_code:country,tenant_type:tenantType,status:"pending"})]
      );
      await tx.unsafe(
        "INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload) VALUES($1,'tenant.created','tenant',$2,$3::jsonb)",
        [tenant.id,String(tenant.id),JSON.stringify({public_id:tenant.public_id,display_name:displayName,country_code:country,status:"pending"})]
      );
      return tenant;
    });
    this.eventBus.publish("tenant.created",{public_id:result.public_id,display_name:result.display_name,country_code:result.country_code,status:result.status});
    return result;
  }

  async listTenants(params={}){
    const limit=clampInt(params.limit,50,1,250);
    const cursor=decodeNumericCursor(params.cursor);
    const q=String(params.q||"").trim().toLowerCase();
    if(q.length>120)throw problem(400,"TENANT_SEARCH_TOO_LONG");
    const status=params.status?String(params.status):null;
    if(status&&!["pending","active","suspended","closed"].includes(status))throw problem(400,"INVALID_TENANT_STATUS");
    const country=params.country?String(params.country).trim().toUpperCase():null;
    if(country&&!/^[A-Z]{2}$/.test(country))throw problem(400,"INVALID_COUNTRY_CODE");
    const number=String(params.number||"").replace(/[^0-9+]/g,"").replace(/^\+/,"").slice(0,24);
    const billing=params.billing?String(params.billing).trim().toLowerCase():null;
    if(billing&&!["active","unpaid","blocked"].includes(billing))throw problem(400,"INVALID_BILLING_FILTER");
    const kyc=params.kyc?String(params.kyc).trim().toLowerCase():null;
    if(kyc&&!["verified","pending","rejected","expired","not_started"].includes(kyc))throw problem(400,"INVALID_KYC_FILTER");
    const createdSince=params.created_since?new Date(String(params.created_since)):null;
    if(createdSince&&!Number.isFinite(createdSince.getTime()))throw problem(400,"INVALID_CREATED_SINCE");
    const rows=await this.readSql.unsafe(
      "WITH page AS ("+
      " SELECT t.id,t.public_id,t.slug,t.display_name,t.legal_name,t.tenant_type,t.status,t.country_code,t.billing_email,"+
      " t.preferred_locale,t.default_currency,t.timezone,t.home_region,t.capacity_tier,t.created_at"+
      " FROM tenants t WHERE t.tenant_type<>'internal'"+
      " AND ($1::text IS NULL OR t.slug_search LIKE $1||'%' OR t.display_name_search LIKE $1||'%' OR t.legal_name_search LIKE $1||'%' OR lower(t.country_code)=$1"+
      " OR EXISTS (SELECT 1 FROM customer_tenant_memberships cm JOIN customer_principals cp ON cp.id=cm.customer_principal_id WHERE cm.tenant_id=t.id AND cp.email_normalized=$1))"+
      " AND ($2::text IS NULL OR t.status=$2) AND ($3::text IS NULL OR t.country_code=$3)"+
      " AND ($4::text IS NULL OR ($4='active' AND pgi_tenant_has_premium_call_access(t.id,NULL,now()))"+
      " OR ($4='unpaid' AND NOT EXISTS (SELECT 1 FROM tenant_subscriptions s JOIN service_plans p ON p.id=s.service_plan_id WHERE s.tenant_id=t.id AND p.plan_key='external-sva-access' AND s.status='active' AND s.current_period_end>now()))"+
      " OR ($4='blocked' AND t.status='suspended'))"+
      " AND ($5::text IS NULL OR EXISTS (SELECT 1 FROM tenant_number_assignments ta JOIN sva_numbers sn ON sn.id=ta.sva_number_id WHERE ta.tenant_id=t.id AND sn.e164 LIKE $5||'%'))"+
      " AND ($6::text IS NULL OR ($6='not_started' AND NOT EXISTS (SELECT 1 FROM tenant_kyc_profiles kf WHERE kf.tenant_id=t.id)) OR EXISTS (SELECT 1 FROM tenant_kyc_profiles kf WHERE kf.tenant_id=t.id AND kf.status=$6))"+
      " AND ($7::bigint IS NULL OR t.id<$7) AND ($8::timestamptz IS NULL OR t.created_at>=$8) ORDER BY t.id DESC LIMIT $9"+
      ") SELECT page.id AS _cursor_id,page.public_id,page.slug,page.display_name,page.legal_name,page.tenant_type,page.status,page.country_code,page.billing_email,"+
      " page.preferred_locale,page.default_currency,page.timezone,page.home_region,page.capacity_tier,COALESCE(k.status,'not_started') AS kyc_status,page.created_at,"+
      " COALESCE(a.assignment_count,0)::int AS number_assignments,COALESCE(a.active_assignments,0)::int AS active_assignments,"+
      " s.status AS subscription_status,s.current_period_end,s.last_payment_status,s.cancel_at_period_end,s.billing_provider,"+
      " COALESCE(pgi_tenant_has_premium_call_access(page.id,NULL,now()),false) AS premium_call_access"+
      " FROM page LEFT JOIN tenant_kyc_profiles k ON k.tenant_id=page.id"+
      " LEFT JOIN LATERAL (SELECT count(*) AS assignment_count,count(*) FILTER (WHERE status='active') AS active_assignments FROM tenant_number_assignments a WHERE a.tenant_id=page.id) a ON true"+
      " LEFT JOIN LATERAL (SELECT x.status,x.current_period_end,x.last_payment_status,x.cancel_at_period_end,x.billing_provider FROM tenant_subscriptions x JOIN service_plans sp ON sp.id=x.service_plan_id WHERE x.tenant_id=page.id AND sp.plan_key='external-sva-access' ORDER BY x.created_at DESC,x.id DESC LIMIT 1) s ON true"+
      " ORDER BY page.id DESC",
      [q||null,status,country,billing,number||null,kyc,cursor,createdSince?createdSince.toISOString():null,limit+1]
    );
    const hasMore=rows.length>limit;
    const page=hasMore?rows.slice(0,limit):rows;
    const nextCursor=hasMore&&page.length?encodeNumericCursor(Number(page.at(-1)._cursor_id)):null;
    return {data:page.map(row=>{const {_cursor_id,...publicRow}=row;return publicRow;}),next_cursor:nextCursor};
  }

  async listTenantAssignments(params={}){
    const limit=clampInt(params.limit,50,1,250),cursor=decodeNumericCursor(params.cursor);
    const tenantPublicId=String(params.tenant_public_id||"").trim();
    if(tenantPublicId&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantPublicId))throw problem(400,"INVALID_TENANT_PUBLIC_ID");
    const status=params.status?String(params.status).trim().toLowerCase():null;
    if(status&&!["planned","pending_kyc","testing","active","suspended","ended"].includes(status))throw problem(400,"INVALID_ASSIGNMENT_STATUS");
    const country=params.country?String(params.country).trim().toUpperCase():null;
    if(country&&!/^[A-Z]{2}$/.test(country))throw problem(400,"INVALID_COUNTRY_CODE");
    const q=String(params.q||"").replace(/\s+/g,"").trim();
    if(q.length>40)throw problem(400,"NUMBER_SEARCH_TOO_LONG");
    const rows=await this.readSql.unsafe(
      "SELECT a.id AS _cursor_id,a.id,t.public_id AS tenant_public_id,t.display_name AS tenant,sn.display_number,sn.e164,sn.currency,sn.number_type,"+
      " m.country_code AS market,a.tariff_code,a.assignment_type,a.status,a.kyc_status,a.valid_from,a.valid_to,"+
      " c.name AS regulatory_assignor,pgi_tenant_has_premium_call_access(t.id,m.id,now()) AS premium_call_access"+
      " FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id JOIN sva_numbers sn ON sn.id=a.sva_number_id"+
      " LEFT JOIN operating_markets m ON m.id=sn.market_id LEFT JOIN carriers c ON c.id=a.regulatory_assignor_carrier_id"+
      " WHERE t.tenant_type<>'internal' AND ($1::uuid IS NULL OR t.public_id=$1::uuid)"+
      " AND ($2::text IS NULL OR a.status=$2) AND ($3::text IS NULL OR m.country_code=$3)"+
      " AND ($4::text IS NULL OR sn.e164 LIKE $4||'%' OR regexp_replace(COALESCE(sn.display_number,''),'[^0-9]','','g') LIKE $4||'%')"+
      " AND ($5::bigint IS NULL OR a.id<$5) ORDER BY a.id DESC LIMIT $6",
      [tenantPublicId||null,status,country,q||null,cursor,limit+1]
    );
    const hasMore=rows.length>limit,page=hasMore?rows.slice(0,limit):rows;
    return {data:page.map(row=>{const {_cursor_id,...publicRow}=row;return publicRow;}),next_cursor:hasMore&&page.length?encodeNumericCursor(Number(page.at(-1)._cursor_id)):null};
  }

  async setTenantStatus(publicId,status,actor={},reason=""){
    publicId=String(publicId||"").trim();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(publicId))throw problem(400,"INVALID_TENANT_PUBLIC_ID");
    status=String(status||"").trim().toLowerCase();
    if(!["active","suspended"].includes(status))throw problem(400,"INVALID_TENANT_CONTROL_STATUS");
    reason=String(reason||"").trim().slice(0,500);
    const actorId=numericActor(actor);
    const result=await this.sql.begin(async tx=>{
      const rows=await tx.unsafe("SELECT id,public_id,display_name,tenant_type,status,country_code FROM tenants WHERE public_id=$1::uuid FOR UPDATE",[publicId]);
      const tenant=rows[0];if(!tenant)throw problem(404,"TENANT_NOT_FOUND");
      if(tenant.tenant_type==="internal")throw problem(409,"INTERNAL_TENANT_PROTECTED");
      const previous=tenant.status;
      if(previous===status)return {...tenant,status,previous_status:previous,changed:false,suspended_assignments:0};
      const updated=await tx.unsafe("UPDATE tenants SET status=$1,updated_at=now() WHERE id=$2 RETURNING id,public_id,display_name,tenant_type,status,country_code",[status,tenant.id]);
      if(status==="active"){
        const access=await tx.unsafe("SELECT pgi_tenant_has_premium_call_access($1,NULL,now()) AS allowed",[tenant.id]);
        if(!access[0]?.allowed)throw problem(409,"PAID_SUBSCRIPTION_REQUIRED_FOR_ACTIVATION");
      }
      let suspendedAssignments=0;
      if(status==="suspended"){
        const assignments=await tx.unsafe("UPDATE tenant_number_assignments SET status='suspended' WHERE tenant_id=$1 AND status='active' RETURNING id",[tenant.id]);
        suspendedAssignments=assignments.length;
      }
      await tx.unsafe(
        "INSERT INTO tenant_control_events(tenant_id,actor_user_id,action,previous_status,new_status,reason,details) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
        [tenant.id,actorId,status==="suspended"?"tenant.suspend":"tenant.activate",previous,status,reason,JSON.stringify({suspended_assignments:suspendedAssignments})]
      );
      await tx.unsafe(
        "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,'tenant',$4,$5::jsonb)",
        [tenant.id,actorId,"tenant.status."+status,String(tenant.id),JSON.stringify({previous_status:previous,status,reason})]
      );
      await tx.unsafe(
        "INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload) VALUES($1,'tenant.status','tenant',$2,$3::jsonb)",
        [tenant.id,String(tenant.id),JSON.stringify({public_id:publicId,previous_status:previous,status})]
      );
      return {...updated[0],previous_status:previous,changed:true,suspended_assignments:suspendedAssignments};
    });
    if(result.changed)this.eventBus.publish("tenant.status",{public_id:publicId,status:result.status,previous_status:result.previous_status});
    return result;
  }

  async setTenantAssignmentStatus(id,status,actor={},reason=""){
    id=Number(id);if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_ASSIGNMENT_ID");
    status=String(status||"").trim().toLowerCase();
    if(!["active","suspended"].includes(status))throw problem(400,"INVALID_ASSIGNMENT_CONTROL_STATUS");
    reason=String(reason||"").trim().slice(0,500);const actorId=numericActor(actor);
    const result=await this.sql.begin(async tx=>{
      const rows=await tx.unsafe(
        "SELECT a.id,a.tenant_id,a.sva_number_id,a.status,t.public_id,t.display_name,t.tenant_type,sn.market_id,sn.e164,sn.display_number FROM tenant_number_assignments a"+
        " JOIN tenants t ON t.id=a.tenant_id JOIN sva_numbers sn ON sn.id=a.sva_number_id WHERE a.id=$1 FOR UPDATE",[id]
      );
      const row=rows[0];if(!row)throw problem(404,"ASSIGNMENT_NOT_FOUND");
      if(row.tenant_type==="internal")throw problem(409,"INTERNAL_ASSIGNMENT_PROTECTED");
      const previous=row.status;
      if(previous===status)return {...row,status,previous_status:previous,changed:false};
      if(status==="active"){
        const payout=(await tx.unsafe("SELECT pgi_tenant_has_payout_terms($1,$2,$3,now()) AS allowed",[row.tenant_id,row.market_id,row.sva_number_id]))[0];
        if(!payout?.allowed)throw problem(409,"PAYOUT_TERMS_REQUIRED");
      }
      const updated=await tx.unsafe("UPDATE tenant_number_assignments SET status=$1 WHERE id=$2 RETURNING id,tenant_id,status,kyc_status,valid_from,valid_to",[status,id]);
      await tx.unsafe(
        "INSERT INTO tenant_control_events(tenant_id,assignment_id,actor_user_id,action,previous_status,new_status,reason,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
        [row.tenant_id,id,actorId,status==="suspended"?"assignment.suspend":"assignment.activate",previous,status,reason,JSON.stringify({e164:row.e164})]
      );
      await tx.unsafe(
        "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,'tenant_number_assignment',$4,$5::jsonb)",
        [row.tenant_id,actorId,"assignment.status."+status,String(id),JSON.stringify({previous_status:previous,status,reason,e164:row.e164})]
      );
      await tx.unsafe(
        "INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload) VALUES($1,'number.assignment.status','tenant_number_assignment',$2,$3::jsonb)",
        [row.tenant_id,String(id),JSON.stringify({tenant_public_id:row.public_id,status,previous_status:previous})]
      );
      return {...updated[0],tenant_public_id:row.public_id,tenant:row.display_name,e164:row.e164,display_number:row.display_number,previous_status:previous,changed:true};
    });
    if(result.changed)this.eventBus.publish("number.assignment.status",{id,status:result.status,tenant_public_id:result.tenant_public_id});
    return result;
  }

  async regulatoryEvidencePack(id,actor={}){
    id=Number(id);if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_ASSIGNMENT_ID");
    const actorId=numericActor(actor),actorSubject=String(actor?.sub||actor?.username||"").slice(0,200);
    return this.sql.begin(async tx=>{
      await tx.unsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const assignment=(await tx.unsafe(
        "SELECT a.id,a.tenant_id,a.sva_number_id,a.assignment_type,a.status AS assignment_status,a.valid_from,a.valid_to,a.tariff_code AS assignment_tariff_code,a.upstream_assignment_reference,"+
        " t.public_id::text AS tenant_public_id,t.display_name AS tenant_name,t.legal_name,t.status AS tenant_status,t.country_code AS tenant_country,"+
        " sn.e164,sn.display_number,sn.number_type,sn.currency,sn.tariff_code AS number_tariff_code,sn.service_rate_ttc_per_min::float8,sn.status AS number_status,sn.market_id,"+
        " m.country_code AS market,m.regulator_name,m.numbering_authority,c.name AS regulatory_assignor,"+
        " pgi_sva_regulatory_ready(a.tenant_id,a.sva_number_id) AS regulatory_ready,"+
        " pgi_arcep_2026_number_ready(a.tenant_id,a.sva_number_id) AS arcep_2026_ready,"+
        " pgi_sva_ecosystem_ready(a.tenant_id,a.sva_number_id) AS sva_ecosystem_ready,"+
        " (pgi_sva_regulatory_ready(a.tenant_id,a.sva_number_id) AND pgi_arcep_2026_number_ready(a.tenant_id,a.sva_number_id) AND pgi_sva_ecosystem_ready(a.tenant_id,a.sva_number_id)) AS activation_ready"+
        " FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id JOIN sva_numbers sn ON sn.id=a.sva_number_id"+
        " LEFT JOIN operating_markets m ON m.id=sn.market_id LEFT JOIN carriers c ON c.id=a.regulatory_assignor_carrier_id"+
        " WHERE a.id=$1 FOR SHARE OF a,t,sn",
        [id]
      ))[0];
      if(!assignment)throw problem(404,"ASSIGNMENT_NOT_FOUND");
      if(assignment.tenant_status==="closed")throw problem(409,"TENANT_CLOSED");
      const e164Plus=String(assignment.e164||"").startsWith("+")?String(assignment.e164):"+"+String(assignment.e164||"");
      const [kycRows,profileRows,evidence,arcepProfileRows,arcepEvidence,ecosystemProfileRows,ecosystemStates,ecosystemEvidence,tariffPlans,portability,operatorEvents,carrierAssignments,controlEvents,incidents,abuseCases,platformControls,routeRows,switches]=await Promise.all([
        tx.unsafe("SELECT entity_type,registration_country,registration_number,legal_representative_verified,bank_account_verified,status,reviewed_at,expires_at,updated_at FROM tenant_kyc_profiles WHERE tenant_id=$1",[assignment.tenant_id]),
        tx.unsafe("SELECT regulatory_role,service_name,service_description,provider_name,provider_website,provider_address,complaint_contact,signaletic_model,numbering_rights_status,editor_identity_status,rsva_status,tariff_transparency_status,mgit_status,complaint_process_status,fraud_monitoring_status,last_reviewed_at,next_review_at,created_at,updated_at FROM sva_regulatory_profiles WHERE tenant_id=$1 AND sva_number_id=$2",[assignment.tenant_id,assignment.sva_number_id]),
        tx.unsafe("SELECT id,control_key,status,source,evidence_reference,previous_hash,event_hash,actor_subject,occurred_at FROM sva_regulatory_evidence_events WHERE tenant_id=$1 AND sva_number_id=$2 ORDER BY id",[assignment.tenant_id,assignment.sva_number_id]),
        tx.unsafe("SELECT decision_reference,exclusive_stable_assignee_status,single_service_status,portability_offered_status,tariff_ceiling_status,no_temporary_contact_use_status,public_body_eligibility_status,caller_id_block_status,parental_control_classification_status,last_reviewed_at,next_review_at,created_at,updated_at FROM sva_arcep_2026_profiles WHERE tenant_id=$1 AND sva_number_id=$2",[assignment.tenant_id,assignment.sva_number_id]),
        tx.unsafe("SELECT id,control_key,status,source,evidence_reference,previous_hash,event_hash,actor_subject,occurred_at FROM sva_arcep_2026_evidence_events WHERE tenant_id=$1 AND sva_number_id=$2 ORDER BY id",[assignment.tenant_id,assignment.sva_number_id]),
        tx.unsafe("SELECT service_category,audience,billing_mode,per_call_price_ttc::float8,max_billable_duration_seconds,monthly_user_cap_ttc::float8,mgit_required,mgit_duration_seconds,mgit_tariff_first,mgit_optout_instruction,mgit_no_background_music,mgit_beep_before_billing,privacy_notice_url,consumer_contact,mediation_reference,af2m_reference_version,last_reviewed_at,next_review_at,created_at,updated_at,pgi_sva_ecosystem_ready(tenant_id,sva_number_id) AS ecosystem_ready FROM sva_service_compliance_profiles WHERE tenant_id=$1 AND sva_number_id=$2",[assignment.tenant_id,assignment.sva_number_id]),
        tx.unsafe("SELECT s.control_key,c.framework_key,c.label,c.required_for_activation,c.allow_not_applicable,s.status,s.evidence_reference,s.evidence_event_hash,s.reviewed_at,s.valid_until,s.updated_at FROM sva_ecosystem_control_states s JOIN sva_ecosystem_control_catalog c ON c.control_key=s.control_key WHERE s.tenant_id=$1 AND s.sva_number_id=$2 ORDER BY c.framework_key,s.control_key",[assignment.tenant_id,assignment.sva_number_id]),
        tx.unsafe("SELECT id,control_key,status,source,evidence_reference,valid_until,previous_hash,event_hash,actor_subject,occurred_at FROM sva_ecosystem_evidence_events WHERE tenant_id=$1 AND sva_number_id=$2 ORDER BY id",[assignment.tenant_id,assignment.sva_number_id]),
        tx.unsafe("SELECT public_id::text AS public_id,current_tariff_code,proposed_tariff_code,proposed_service_rate_ttc_per_min::float8,proposed_service_price_ttc_per_call::float8,effective_on,declaration_due_at,status,rsva_reference,created_at,declared_at,confirmed_at,notes FROM sva_tariff_change_plans WHERE tenant_id=$1 AND sva_number_id=$2 ORDER BY effective_on,id",[assignment.tenant_id,assignment.sva_number_id]),
        tx.unsafe(
          "SELECT p.id,p.country_code,p.requested_e164,p.display_number,p.service_family,p.current_operator_name,p.current_operator_reference,p.desired_port_date,p.status,p.ownership_status,p.authorization_confirmed,p.number_owner_confirmed,"+
          " c.name AS target_carrier,p.operator_portability_reference,p.scheduled_at,p.completed_at,p.rejection_reason,p.tariff_code,p.service_rate_ttc_per_min::float8,p.currency,p.tariff_verification_status,p.tariff_verified_at,"+
          " p.rio_validation_status,p.rio_validated_at,p.source_contract_transfer_mode,p.source_contract_liability_acknowledged,p.automation_state,p.automation_last_error,p.automation_last_sync_at,p.operator_status,p.created_at,p.updated_at"+
          " FROM tenant_portability_requests p LEFT JOIN carriers c ON c.id=p.target_carrier_id"+
          " WHERE p.tenant_id=$1 AND (p.sva_number_id=$2 OR p.requested_e164=$3) ORDER BY p.created_at,p.id",
          [assignment.tenant_id,assignment.sva_number_id,e164Plus]
        ),
        tx.unsafe(
          "SELECT e.id,e.portability_request_id,c.name AS carrier,e.direction,e.event_type,e.provider_event_id,e.operator_reference,e.http_status,e.occurred_at"+
          " FROM portability_operator_events e JOIN tenant_portability_requests p ON p.id=e.portability_request_id LEFT JOIN carriers c ON c.id=e.carrier_id"+
          " WHERE e.tenant_id=$1 AND (p.sva_number_id=$2 OR p.requested_e164=$3) ORDER BY e.occurred_at,e.id",
          [assignment.tenant_id,assignment.sva_number_id,e164Plus]
        ),
        tx.unsafe(
          "SELECT n.id,c.name AS carrier,n.valid_from,n.valid_to,n.assignment_status,n.portability_reference,n.portability_status,n.created_at"+
          " FROM number_carrier_assignments n JOIN carriers c ON c.id=n.carrier_id WHERE n.sva_number_id=$1 ORDER BY n.valid_from,n.id",
          [assignment.sva_number_id]
        ),
        tx.unsafe("SELECT id,action,previous_status,new_status,reason,occurred_at FROM tenant_control_events WHERE tenant_id=$1 AND assignment_id=$2 ORDER BY occurred_at,id",[assignment.tenant_id,id]),
        tx.unsafe("SELECT public_id::text AS public_id,category,severity,status,source,title,assigned_team,first_response_due_at,target_resolution_at,first_responded_at,resolved_at,closed_at,created_at,updated_at FROM tenant_service_incidents WHERE tenant_id=$1 AND sva_number_id=$2 ORDER BY created_at,id",[assignment.tenant_id,assignment.sva_number_id]),
        tx.unsafe("SELECT public_id::text AS public_id,source,external_reference,category,severity,status,suspension_required,first_response_due_at,resolution_due_at,summary,opened_at,resolved_at,created_at,updated_at FROM sva_abuse_cases WHERE tenant_id=$1 AND sva_number_id=$2 ORDER BY opened_at,id",[assignment.tenant_id,assignment.sva_number_id]),
        tx.unsafe("SELECT m.country_code AS market,c.control_key,c.status,c.evidence_reference,c.evidence_sha256,c.verified_at,c.valid_until,c.updated_at FROM platform_regulatory_controls c LEFT JOIN operating_markets m ON m.id=c.market_id WHERE c.market_id IS NULL OR c.market_id=$1 ORDER BY c.control_key",[assignment.market_id]),
        tx.unsafe("SELECT r.route_key,r.generation,r.updated_at,ac.name AS active_carrier,sc.name AS standby_carrier,cc.state AS active_connection_state FROM logical_carrier_routes r LEFT JOIN carriers ac ON ac.id=r.active_carrier_id LEFT JOIN carriers sc ON sc.id=r.standby_carrier_id LEFT JOIN carrier_connections cc ON cc.id=r.active_connection_id WHERE r.route_key='sva-primary'"),
        tx.unsafe("SELECT s.id,s.status,s.requested_at,s.started_at,s.completed_at,s.rollback_deadline,fc.name AS from_carrier,tc.name AS to_carrier FROM carrier_switches s LEFT JOIN carriers fc ON fc.id=s.from_carrier_id LEFT JOIN carriers tc ON tc.id=s.to_carrier_id WHERE s.route_key='sva-primary' ORDER BY s.requested_at DESC,s.id DESC LIMIT 50")
      ]);
      const chainLinksValid=evidence.every((event,index)=>index===0?!event.previous_hash:event.previous_hash===evidence[index-1].event_hash);
      const arcepChainLinksValid=arcepEvidence.every((event,index)=>index===0?!event.previous_hash:event.previous_hash===arcepEvidence[index-1].event_hash);
      const ecosystemChainLinksValid=ecosystemEvidence.every((event,index)=>index===0?!event.previous_hash:event.previous_hash===ecosystemEvidence[index-1].event_hash);
      const allLinksValid=chainLinksValid&&arcepChainLinksValid&&ecosystemChainLinksValid;
      const generatedAt=new Date().toISOString();
      const body={
        schema:"audiotel-regulatory-evidence-pack/1",
        generated_at:generatedAt,
        assignment,
        kyc:kycRows[0]||null,
        regulatory_profile:profileRows[0]||null,
        evidence_ledger:evidence,
        arcep_2026_profile:arcepProfileRows[0]||null,
        arcep_2026_evidence_ledger:arcepEvidence,
        sva_ecosystem_profile:ecosystemProfileRows[0]||null,
        sva_ecosystem_control_states:ecosystemStates,
        sva_ecosystem_evidence_ledger:ecosystemEvidence,
        sva_tariff_change_plans:tariffPlans,
        portability,
        portability_operator_events:operatorEvents,
        carrier_assignments:carrierAssignments,
        assignment_control_history:controlEvents,
        service_incidents:incidents,
        abuse_cases:abuseCases,
        platform_regulatory_controls:platformControls,
        routing:{current:routeRows[0]||null,recent_switches:switches},
        privacy:{raw_rio_included:false,portability_credentials_included:false,caller_numbers_included:false,call_content_included:false}
      };
      const packHash=createHash("sha256").update(JSON.stringify(body)).digest("hex");
      const chainHead=evidence.length?evidence.at(-1).event_hash:null;
      const arcepChainHead=arcepEvidence.length?arcepEvidence.at(-1).event_hash:null;
      const ecosystemChainHead=ecosystemEvidence.length?ecosystemEvidence.at(-1).event_hash:null;
      const totalEvidenceEvents=evidence.length+arcepEvidence.length+ecosystemEvidence.length;
      const exportRow=(await tx.unsafe(
        "INSERT INTO sva_regulatory_evidence_pack_exports(tenant_id,assignment_id,sva_number_id,generated_at,pack_sha256,evidence_chain_head,evidence_links_valid,evidence_events,actor_subject,arcep_2026_chain_head,arcep_2026_links_valid,arcep_2026_evidence_events,ecosystem_chain_head,ecosystem_links_valid,ecosystem_evidence_events)"+
        " VALUES($1,$2,$3,$4::timestamptz,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING public_id::text AS public_id,created_at",
        [assignment.tenant_id,id,assignment.sva_number_id,generatedAt,packHash,chainHead,allLinksValid,totalEvidenceEvents,actorSubject||null,arcepChainHead,arcepChainLinksValid,arcepEvidence.length,ecosystemChainHead,ecosystemChainLinksValid,ecosystemEvidence.length]
      ))[0];
      await tx.unsafe(
        "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'regulatory.evidence_pack.export','tenant_number_assignment',$3,jsonb_build_object('export_public_id',$4::text,'generated_at',$5::timestamptz,'pack_sha256',$6::text,'evidence_chain_head',$7::text,'arcep_2026_chain_head',$8::text,'ecosystem_chain_head',$9::text,'evidence_links_valid',$10::boolean))",
        [assignment.tenant_id,actorId,String(id),exportRow.public_id,generatedAt,packHash,chainHead,arcepChainHead,ecosystemChainHead,allLinksValid]
      );
      return {...body,integrity:{algorithm:"sha256",export_id:exportRow.public_id,pack_sha256:packHash,evidence_chain_head:chainHead,arcep_2026_chain_head:arcepChainHead,ecosystem_chain_head:ecosystemChainHead,evidence_links_valid:allLinksValid,legacy_evidence_links_valid:chainLinksValid,arcep_2026_links_valid:arcepChainLinksValid,ecosystem_links_valid:ecosystemChainLinksValid,evidence_events:totalEvidenceEvents,legacy_evidence_events:evidence.length,arcep_2026_evidence_events:arcepEvidence.length,ecosystem_evidence_events:ecosystemEvidence.length}};
    });
  }

  async svaComplianceOverview(){
    const [frameworks,catalog,summary,numbers,states,plans,frameworkStatus]=await Promise.all([
      this.readSql.unsafe("SELECT framework_key,authority_name,framework_name,category,reference_version,effective_from,source_reference,description FROM regulatory_framework_registry ORDER BY category,authority_name,framework_key"),
      this.readSql.unsafe("SELECT control_key,framework_key,label,required_for_activation,allow_not_applicable,default_review_days,description FROM sva_ecosystem_control_catalog ORDER BY framework_key,control_key"),
      this.readSql.unsafe(
        "SELECT"+
        " (SELECT count(*)::int FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id JOIN sva_numbers n ON n.id=a.sva_number_id LEFT JOIN operating_markets m ON m.id=n.market_id WHERE t.tenant_type<>'internal' AND COALESCE(m.country_code,'FR')='FR') AS numbers_total,"+
        " (SELECT count(*)::int FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id JOIN sva_numbers n ON n.id=a.sva_number_id LEFT JOIN operating_markets m ON m.id=n.market_id WHERE t.tenant_type<>'internal' AND COALESCE(m.country_code,'FR')='FR' AND pgi_sva_ecosystem_ready(a.tenant_id,a.sva_number_id)) AS numbers_ready,"+
        " (SELECT count(*)::int FROM sva_ecosystem_control_states WHERE status='verified' AND (valid_until IS NULL OR valid_until>now())) AS controls_verified,"+
        " (SELECT count(*)::int FROM sva_ecosystem_control_states WHERE status IN ('failed','expired')) AS controls_blocking,"+
        " (SELECT count(*)::int FROM sva_ecosystem_evidence_events) AS evidence_events,"+
        " (SELECT count(*)::int FROM sva_tariff_change_plans WHERE status IN ('planned','declared')) AS tariff_changes_open"
      ),
      this.readSql.unsafe(
        "SELECT a.id AS assignment_id,a.tenant_id,t.public_id::text AS tenant_public_id,t.display_name AS tenant,sn.id AS sva_number_id,sn.display_number,sn.e164,sn.service_rate_ttc_per_min::float8,m.country_code AS market,a.status AS assignment_status,"+
        " p.service_category,p.audience,p.billing_mode,p.per_call_price_ttc::float8,p.max_billable_duration_seconds,p.monthly_user_cap_ttc::float8,p.mgit_required,p.mgit_duration_seconds,p.mgit_tariff_first,p.mgit_optout_instruction,p.mgit_no_background_music,p.mgit_beep_before_billing,p.privacy_notice_url,p.consumer_contact,p.mediation_reference,p.af2m_reference_version,p.last_reviewed_at,p.next_review_at,"+
        " pgi_sva_ecosystem_ready(a.tenant_id,a.sva_number_id) AS ecosystem_ready"+
        " FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id JOIN sva_numbers sn ON sn.id=a.sva_number_id LEFT JOIN operating_markets m ON m.id=sn.market_id LEFT JOIN sva_service_compliance_profiles p ON p.tenant_id=a.tenant_id AND p.sva_number_id=a.sva_number_id"+
        " WHERE t.tenant_type<>'internal' AND COALESCE(m.country_code,'FR')='FR' ORDER BY a.created_at DESC LIMIT 100"
      ),
      this.readSql.unsafe(
        "SELECT s.tenant_id,s.sva_number_id,s.control_key,s.status,s.evidence_reference,s.evidence_event_hash,s.reviewed_at,s.valid_until,s.updated_at,c.framework_key,c.label,c.required_for_activation,c.allow_not_applicable"+
        " FROM sva_ecosystem_control_states s JOIN sva_ecosystem_control_catalog c ON c.control_key=s.control_key ORDER BY s.updated_at DESC,s.control_key"
      ),
      this.readSql.unsafe(
        "SELECT p.id,p.public_id::text AS public_id,p.tenant_id,p.sva_number_id,p.current_tariff_code,p.proposed_tariff_code,p.proposed_service_rate_ttc_per_min::float8,p.proposed_service_price_ttc_per_call::float8,p.effective_on,p.declaration_due_at,p.status,p.rsva_reference,p.created_at,p.declared_at,p.confirmed_at,p.notes"+
        " FROM sva_tariff_change_plans p ORDER BY p.effective_on DESC,p.id DESC LIMIT 100"
      ),
      this.readSql.unsafe(
        "WITH assignments AS ("+
        " SELECT a.tenant_id,a.sva_number_id FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id JOIN sva_numbers n ON n.id=a.sva_number_id LEFT JOIN operating_markets m ON m.id=n.market_id"+
        " WHERE t.tenant_type<>'internal' AND COALESCE(m.country_code,'FR')='FR'"+
        "), expected AS ("+
        " SELECT f.framework_key,f.authority_name,f.framework_name,c.control_key,c.allow_not_applicable,a.tenant_id,a.sva_number_id"+
        " FROM regulatory_framework_registry f JOIN sva_ecosystem_control_catalog c ON c.framework_key=f.framework_key AND c.required_for_activation CROSS JOIN assignments a"+
        ") SELECT e.framework_key,e.authority_name,e.framework_name,count(*)::int AS required_total,"+
        " count(*) FILTER(WHERE s.status='verified' AND (s.valid_until IS NULL OR s.valid_until>now()) OR s.status='not_applicable' AND e.allow_not_applicable AND (s.valid_until IS NULL OR s.valid_until>now()))::int AS ready_total,"+
        " count(*) FILTER(WHERE s.status IN ('failed','expired') OR s.valid_until IS NOT NULL AND s.valid_until<=now())::int AS blocking_total,"+
        " count(*) FILTER(WHERE s.control_key IS NULL OR s.status IN ('not_started','pending'))::int AS pending_total"+
        " FROM expected e LEFT JOIN sva_ecosystem_control_states s ON s.tenant_id=e.tenant_id AND s.sva_number_id=e.sva_number_id AND s.control_key=e.control_key"+
        " GROUP BY e.framework_key,e.authority_name,e.framework_name ORDER BY e.authority_name,e.framework_key"
      )
    ]);
    return {schema_version:"audiotel-sva-compliance/1",generated_at:new Date().toISOString(),summary:summary[0]||{},frameworks,framework_status:frameworkStatus,catalog,numbers,states,tariff_change_plans:plans,external_connections_active:false,certification_claimed:false};
  }

  async upsertSvaServiceComplianceProfile(id,input={},actor={}){
    id=Number(id);if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_ASSIGNMENT_ID");
    const serviceCategory=String(input.service_category||"other").trim().toLowerCase();
    const audience=String(input.audience||"consumer").trim().toLowerCase();
    const billingMode=String(input.billing_mode||"per_minute").trim().toLowerCase();
    if(!["general","advice","connection","payment","stock_information","distance_selling","m2m","automated_content","classifieds","telephony","access_code","directory_assistance","user_matching","minors","other"].includes(serviceCategory))throw problem(400,"INVALID_SVA_SERVICE_CATEGORY");
    if(!["consumer","professional","mixed"].includes(audience))throw problem(400,"INVALID_SVA_AUDIENCE");
    if(!["free","normal","per_minute","per_call","mixed"].includes(billingMode))throw problem(400,"INVALID_SVA_BILLING_MODE");
    const perCall=input.per_call_price_ttc==null||input.per_call_price_ttc===""?null:Number(input.per_call_price_ttc);
    const maxDuration=input.max_billable_duration_seconds==null||input.max_billable_duration_seconds===""?null:Number(input.max_billable_duration_seconds);
    const monthlyCap=input.monthly_user_cap_ttc==null||input.monthly_user_cap_ttc===""?300:Number(input.monthly_user_cap_ttc);
    const mgitRequired=input.mgit_required!==false;
    const mgitDuration=input.mgit_duration_seconds==null||input.mgit_duration_seconds===""?null:Number(input.mgit_duration_seconds);
    if(perCall!=null&&(!Number.isFinite(perCall)||perCall<0||perCall>24))throw problem(400,"SVA_PER_CALL_CAP_EXCEEDED");
    if(maxDuration!=null&&(!Number.isInteger(maxDuration)||maxDuration<1||maxDuration>86400))throw problem(400,"INVALID_SVA_MAX_DURATION");
    if(!Number.isFinite(monthlyCap)||monthlyCap<=0||monthlyCap>300)throw problem(400,"SVA_MONTHLY_CAP_EXCEEDED");
    if(mgitDuration!=null&&(!Number.isInteger(mgitDuration)||mgitDuration<1||mgitDuration>60))throw problem(400,"INVALID_MGIT_DURATION");
    const privacyUrl=optionalText(input.privacy_notice_url,500);if(privacyUrl&&!/^https:\/\//i.test(privacyUrl))throw problem(400,"SVA_PRIVACY_URL_HTTPS_REQUIRED");
    let nextReview=null;if(input.next_review_at){const d=new Date(input.next_review_at);if(!Number.isFinite(d.getTime())||d.getTime()<=Date.now())throw problem(400,"INVALID_REGULATORY_REVIEW_DATE");nextReview=d.toISOString();}
    const actorId=numericActor(actor),actorSubject=String(actor?.sub||actor?.username||"").slice(0,200);
    return this.sql.begin(async tx=>{
      const assignment=(await tx.unsafe("SELECT a.tenant_id,a.sva_number_id,t.tenant_type,sn.e164,sn.service_rate_ttc_per_min::float8 FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id JOIN sva_numbers sn ON sn.id=a.sva_number_id WHERE a.id=$1 FOR UPDATE",[id]))[0];
      if(!assignment)throw problem(404,"ASSIGNMENT_NOT_FOUND");
      if(assignment.tenant_type==="internal")throw problem(409,"INTERNAL_ASSIGNMENT_PROTECTED");
      if(Number(assignment.service_rate_ttc_per_min||0)>.20&&(!maxDuration||maxDuration>1800))throw problem(400,"SVA_HIGH_RATE_MAX_DURATION_REQUIRED");
      if(mgitRequired&&(!mgitDuration||mgitDuration<10||mgitDuration>20))throw problem(400,"SVA_MGIT_10_20_SECONDS_REQUIRED");
      const rows=await tx.unsafe(
        "INSERT INTO sva_service_compliance_profiles AS p(tenant_id,sva_number_id,service_category,audience,billing_mode,per_call_price_ttc,max_billable_duration_seconds,monthly_user_cap_ttc,mgit_required,mgit_duration_seconds,mgit_tariff_first,mgit_optout_instruction,mgit_no_background_music,mgit_beep_before_billing,privacy_notice_url,consumer_contact,mediation_reference,af2m_reference_version,last_reviewed_at,next_review_at,updated_at)"+
        " VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'2026-09-01',now(),$18,now())"+
        " ON CONFLICT(tenant_id,sva_number_id) DO UPDATE SET service_category=EXCLUDED.service_category,audience=EXCLUDED.audience,billing_mode=EXCLUDED.billing_mode,per_call_price_ttc=EXCLUDED.per_call_price_ttc,max_billable_duration_seconds=EXCLUDED.max_billable_duration_seconds,monthly_user_cap_ttc=EXCLUDED.monthly_user_cap_ttc,mgit_required=EXCLUDED.mgit_required,mgit_duration_seconds=EXCLUDED.mgit_duration_seconds,mgit_tariff_first=EXCLUDED.mgit_tariff_first,mgit_optout_instruction=EXCLUDED.mgit_optout_instruction,mgit_no_background_music=EXCLUDED.mgit_no_background_music,mgit_beep_before_billing=EXCLUDED.mgit_beep_before_billing,privacy_notice_url=EXCLUDED.privacy_notice_url,consumer_contact=EXCLUDED.consumer_contact,mediation_reference=EXCLUDED.mediation_reference,af2m_reference_version='2026-09-01',last_reviewed_at=now(),next_review_at=COALESCE(EXCLUDED.next_review_at,p.next_review_at),updated_at=now() RETURNING *",
        [assignment.tenant_id,assignment.sva_number_id,serviceCategory,audience,billingMode,perCall,maxDuration,monthlyCap,mgitRequired,mgitDuration,Boolean(input.mgit_tariff_first),Boolean(input.mgit_optout_instruction),Boolean(input.mgit_no_background_music),Boolean(input.mgit_beep_before_billing),privacyUrl,optionalText(input.consumer_contact,500),optionalText(input.mediation_reference,500),nextReview]
      );
      await tx.unsafe("INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'sva.compliance.profile.update','sva_service_compliance_profile',$3,$4::jsonb)",[assignment.tenant_id,actorId,String(assignment.sva_number_id),JSON.stringify({assignment_id:id,e164:assignment.e164,actor_subject:actorSubject,af2m_reference_version:"2026-09-01"})]);
      return {...rows[0],ecosystem_ready:Boolean((await tx.unsafe("SELECT pgi_sva_ecosystem_ready($1,$2) AS ready",[assignment.tenant_id,assignment.sva_number_id]))[0]?.ready)};
    });
  }

  async recordSvaEcosystemEvidence(id,input={},actor={}){
    id=Number(id);if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_ASSIGNMENT_ID");
    const control=String(input.control_key||"").trim().toLowerCase(),status=String(input.status||"").trim().toLowerCase(),source=String(input.source||"internal").trim().toLowerCase();
    if(!["not_started","pending","verified","failed","expired","not_applicable"].includes(status))throw problem(400,"INVALID_REGULATORY_STATUS");
    if(!["internal","customer","operator","apnf_rsva","af2m","arcep","dgccrf","cnil","33700","mediator","acpr","other"].includes(source))throw problem(400,"INVALID_REGULATORY_SOURCE");
    const reference=optionalText(input.evidence_reference,500);
    if(status==="verified"&&!reference)throw problem(400,"REGULATORY_EVIDENCE_REFERENCE_REQUIRED");
    const validUntil=input.valid_until?new Date(input.valid_until):null;if(validUntil&&!Number.isFinite(validUntil.getTime()))throw problem(400,"INVALID_REGULATORY_VALID_UNTIL");
    const metadata=input.metadata&&typeof input.metadata==="object"&&!Array.isArray(input.metadata)?input.metadata:{};
    const actorId=numericActor(actor),actorSubject=String(actor?.sub||actor?.username||"").slice(0,200);
    return this.sql.begin(async tx=>{
      const assignment=(await tx.unsafe("SELECT a.tenant_id,a.sva_number_id,t.tenant_type,sn.e164 FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id JOIN sva_numbers sn ON sn.id=a.sva_number_id WHERE a.id=$1 FOR UPDATE",[id]))[0];
      if(!assignment)throw problem(404,"ASSIGNMENT_NOT_FOUND");
      if(assignment.tenant_type==="internal")throw problem(409,"INTERNAL_ASSIGNMENT_PROTECTED");
      const catalog=(await tx.unsafe("SELECT control_key,allow_not_applicable FROM sva_ecosystem_control_catalog WHERE control_key=$1",[control]))[0];
      if(!catalog)throw problem(400,"INVALID_SVA_ECOSYSTEM_CONTROL");
      if(status==="not_applicable"&&!catalog.allow_not_applicable)throw problem(400,"SVA_CONTROL_NOT_APPLICABLE_FORBIDDEN");
      if(status==="not_applicable"&&!reference&&!optionalText(metadata.reason,500))throw problem(400,"SVA_NOT_APPLICABLE_REASON_REQUIRED");
      const event=(await tx.unsafe("INSERT INTO sva_ecosystem_evidence_events(tenant_id,sva_number_id,control_key,status,source,evidence_reference,valid_until,metadata,actor_subject) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) RETURNING id,control_key,status,source,evidence_reference,valid_until,previous_hash,event_hash,occurred_at",[assignment.tenant_id,assignment.sva_number_id,control,status,source,reference,validUntil?validUntil.toISOString():null,JSON.stringify(metadata),actorSubject||null]))[0];
      const ready=Boolean((await tx.unsafe("SELECT pgi_sva_ecosystem_ready($1,$2) AS ready",[assignment.tenant_id,assignment.sva_number_id]))[0]?.ready);
      await tx.unsafe("INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'sva.compliance.evidence.append','sva_ecosystem_evidence',$3,$4::jsonb)",[assignment.tenant_id,actorId,String(event.id),JSON.stringify({assignment_id:id,e164:assignment.e164,control_key:control,status,source,event_hash:event.event_hash})]);
      return {event,ecosystem_ready:ready};
    });
  }

  async planSvaTariffChange(id,input={},actor={}){
    id=Number(id);if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_ASSIGNMENT_ID");
    const proposedCode=String(input.proposed_tariff_code||"").trim();if(!proposedCode||proposedCode.length>80)throw problem(400,"INVALID_SVA_TARIFF_CODE");
    const effective=String(input.effective_on||"").trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(effective))throw problem(400,"INVALID_SVA_TARIFF_EFFECTIVE_DATE");
    const date=new Date(effective+"T00:00:00Z");if(!Number.isFinite(date.getTime())||date.getUTCDate()!==1)throw problem(400,"SVA_TARIFF_CHANGE_FIRST_DAY_REQUIRED");
    if(date.getTime()<Date.now()+7*86400000)throw problem(400,"SVA_TARIFF_CHANGE_SEVEN_DAY_NOTICE_REQUIRED");
    const perMinute=input.proposed_service_rate_ttc_per_min==null||input.proposed_service_rate_ttc_per_min===""?null:Number(input.proposed_service_rate_ttc_per_min);
    const perCall=input.proposed_service_price_ttc_per_call==null||input.proposed_service_price_ttc_per_call===""?null:Number(input.proposed_service_price_ttc_per_call);
    if(perMinute!=null&&(!Number.isFinite(perMinute)||perMinute<0))throw problem(400,"INVALID_SVA_TARIFF_RATE");
    if(perCall!=null&&(!Number.isFinite(perCall)||perCall<0||perCall>24))throw problem(400,"SVA_PER_CALL_CAP_EXCEEDED");
    const actorId=numericActor(actor);
    return this.sql.begin(async tx=>{
      const assignment=(await tx.unsafe("SELECT a.tenant_id,a.sva_number_id,a.tariff_code,t.tenant_type,sn.e164 FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id JOIN sva_numbers sn ON sn.id=a.sva_number_id WHERE a.id=$1 FOR UPDATE",[id]))[0];
      if(!assignment)throw problem(404,"ASSIGNMENT_NOT_FOUND");
      if(assignment.tenant_type==="internal")throw problem(409,"INTERNAL_ASSIGNMENT_PROTECTED");
      const row=(await tx.unsafe("INSERT INTO sva_tariff_change_plans(tenant_id,sva_number_id,current_tariff_code,proposed_tariff_code,proposed_service_rate_ttc_per_min,proposed_service_price_ttc_per_call,effective_on,status,rsva_reference,requested_by,notes) VALUES($1,$2,$3,$4,$5,$6,$7::date,'planned',$8,$9,$10) RETURNING id,public_id::text AS public_id,current_tariff_code,proposed_tariff_code,proposed_service_rate_ttc_per_min::float8,proposed_service_price_ttc_per_call::float8,effective_on,declaration_due_at,status,rsva_reference,created_at",[assignment.tenant_id,assignment.sva_number_id,assignment.tariff_code,proposedCode,perMinute,perCall,effective,optionalText(input.rsva_reference,500),actorId,optionalText(input.notes,1000)]))[0];
      await tx.unsafe("INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'sva.tariff_change.plan','sva_tariff_change_plan',$3,$4::jsonb)",[assignment.tenant_id,actorId,String(row.id),JSON.stringify({assignment_id:id,e164:assignment.e164,effective_on:effective,proposed_tariff_code:proposedCode})]);
      return row;
    });
  }

  async upsertSvaRegulatoryProfile(id,input={},actor={}){
    id=Number(id);if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_ASSIGNMENT_ID");
    const signaletic=input.signaletic_model==null||input.signaletic_model===""?null:String(input.signaletic_model).trim().toLowerCase();
    if(signaletic&&!["free","normal","majorated"].includes(signaletic))throw problem(400,"INVALID_SIGNALETIC_MODEL");
    const fields={
      service_name:optionalText(input.service_name,200),
      service_description:optionalText(input.service_description,1000),
      provider_name:optionalText(input.provider_name,200),
      provider_website:optionalText(input.provider_website,500),
      provider_address:optionalText(input.provider_address,1000),
      complaint_contact:optionalText(input.complaint_contact,500)
    };
    if(fields.provider_website&&!/^https:\/\//i.test(fields.provider_website))throw problem(400,"REGULATORY_PROVIDER_WEBSITE_HTTPS_REQUIRED");
    let nextReview=null;
    if(input.next_review_at){const d=new Date(input.next_review_at);if(!Number.isFinite(d.getTime()))throw problem(400,"INVALID_REGULATORY_REVIEW_DATE");nextReview=d.toISOString();}
    const actorId=numericActor(actor),actorSubject=String(actor?.sub||actor?.username||"").slice(0,200);
    return this.sql.begin(async tx=>{
      const assignment=(await tx.unsafe(
        "SELECT a.id,a.tenant_id,a.sva_number_id,t.tenant_type,sn.e164 FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id JOIN sva_numbers sn ON sn.id=a.sva_number_id WHERE a.id=$1 FOR UPDATE",
        [id]
      ))[0];
      if(!assignment)throw problem(404,"ASSIGNMENT_NOT_FOUND");
      if(assignment.tenant_type==="internal")throw problem(409,"INTERNAL_ASSIGNMENT_PROTECTED");
      const rows=await tx.unsafe(
        "INSERT INTO sva_regulatory_profiles AS p(tenant_id,sva_number_id,service_name,service_description,provider_name,provider_website,provider_address,complaint_contact,signaletic_model,next_review_at,updated_at)"+
        " VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())"+
        " ON CONFLICT(tenant_id,sva_number_id) DO UPDATE SET"+
        " service_name=COALESCE(EXCLUDED.service_name,p.service_name),service_description=COALESCE(EXCLUDED.service_description,p.service_description),"+
        " provider_name=COALESCE(EXCLUDED.provider_name,p.provider_name),provider_website=COALESCE(EXCLUDED.provider_website,p.provider_website),"+
        " provider_address=COALESCE(EXCLUDED.provider_address,p.provider_address),complaint_contact=COALESCE(EXCLUDED.complaint_contact,p.complaint_contact),"+
        " signaletic_model=COALESCE(EXCLUDED.signaletic_model,p.signaletic_model),next_review_at=COALESCE(EXCLUDED.next_review_at,p.next_review_at),updated_at=now()"+
        " RETURNING *",
        [assignment.tenant_id,assignment.sva_number_id,fields.service_name,fields.service_description,fields.provider_name,fields.provider_website,fields.provider_address,fields.complaint_contact,signaletic,nextReview]
      );
      await tx.unsafe(
        "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'regulatory.profile.update','sva_regulatory_profile',$3,$4::jsonb)",
        [assignment.tenant_id,actorId,String(assignment.sva_number_id),JSON.stringify({assignment_id:id,e164:assignment.e164,actor_subject:actorSubject})]
      );
      await tx.unsafe("UPDATE regulatory_review_alerts SET state='resolved',resolved_at=now(),updated_at=now() WHERE assignment_id=$1 AND framework='regulatory_trust' AND state<>'resolved'",[id]);
      return {...rows[0],regulatory_ready:Boolean((await tx.unsafe("SELECT pgi_sva_regulatory_ready($1,$2) AS ready",[assignment.tenant_id,assignment.sva_number_id]))[0]?.ready)};
    });
  }

  async recordSvaRegulatoryEvidence(id,input={},actor={}){
    id=Number(id);if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_ASSIGNMENT_ID");
    const control=String(input.control_key||"").trim().toLowerCase();
    const status=String(input.status||"").trim().toLowerCase();
    const source=String(input.source||"internal").trim().toLowerCase();
    const legacyControls=new Set(["numbering_rights","editor_identity","rsva","tariff_transparency","mgit","complaint_process","fraud_monitoring"]);
    const arcep2026Controls=new Set(["exclusive_stable_assignee","single_service","portability_offered","tariff_ceiling","no_temporary_contact_use","public_body_eligibility","caller_id_block","parental_control_classification"]);
    const statuses=new Set(["not_started","pending","verified","failed","expired","not_applicable"]);
    const sources=new Set(["internal","customer","operator","apnf_rsva","af2m","arcep","dgccrf","33700","other"]);
    if(!legacyControls.has(control)&&!arcep2026Controls.has(control))throw problem(400,"INVALID_REGULATORY_CONTROL");
    if(!statuses.has(status))throw problem(400,"INVALID_REGULATORY_STATUS");
    if(!sources.has(source))throw problem(400,"INVALID_REGULATORY_SOURCE");
    if(arcep2026Controls.has(control)&&source==="33700")throw problem(400,"INVALID_REGULATORY_SOURCE");
    const reference=optionalText(input.evidence_reference,500);
    if(status==="verified"&&!reference)throw problem(400,"REGULATORY_EVIDENCE_REFERENCE_REQUIRED");
    let nextReview=null;
    if(input.next_review_at){const d=new Date(input.next_review_at);if(!Number.isFinite(d.getTime())||d.getTime()<=Date.now())throw problem(400,"INVALID_REGULATORY_REVIEW_DATE");nextReview=d.toISOString();}
    const metadata=input.metadata&&typeof input.metadata==="object"&&!Array.isArray(input.metadata)?input.metadata:{};
    const actorId=numericActor(actor),actorSubject=String(actor?.sub||actor?.username||"").slice(0,200);
    return this.sql.begin(async tx=>{
      const assignment=(await tx.unsafe(
        "SELECT a.id,a.tenant_id,a.sva_number_id,t.tenant_type,sn.e164 FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id JOIN sva_numbers sn ON sn.id=a.sva_number_id WHERE a.id=$1 FOR UPDATE",
        [id]
      ))[0];
      if(!assignment)throw problem(404,"ASSIGNMENT_NOT_FOUND");
      if(assignment.tenant_type==="internal")throw problem(409,"INTERNAL_ASSIGNMENT_PROTECTED");
      const isArcep2026=arcep2026Controls.has(control);
      const table=isArcep2026?"sva_arcep_2026_evidence_events":"sva_regulatory_evidence_events";
      const event=(await tx.unsafe(
        "INSERT INTO "+table+"(tenant_id,sva_number_id,control_key,status,source,evidence_reference,metadata,actor_subject) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING id,control_key,status,source,evidence_reference,previous_hash,event_hash,occurred_at",
        [assignment.tenant_id,assignment.sva_number_id,control,status,source,reference,JSON.stringify(metadata),actorSubject||null]
      ))[0];
      if(nextReview){
        const profileTable=isArcep2026?"sva_arcep_2026_profiles":"sva_regulatory_profiles";
        await tx.unsafe("UPDATE "+profileTable+" SET next_review_at=$3::timestamptz,updated_at=now() WHERE tenant_id=$1 AND sva_number_id=$2",[assignment.tenant_id,assignment.sva_number_id,nextReview]);
      }
      const profile=isArcep2026
        ?(await tx.unsafe("SELECT *,pgi_arcep_2026_number_ready(tenant_id,sva_number_id) AS arcep_2026_ready FROM sva_arcep_2026_profiles WHERE tenant_id=$1 AND sva_number_id=$2",[assignment.tenant_id,assignment.sva_number_id]))[0]
        :(await tx.unsafe("SELECT *,pgi_sva_regulatory_ready(tenant_id,sva_number_id) AS regulatory_ready FROM sva_regulatory_profiles WHERE tenant_id=$1 AND sva_number_id=$2",[assignment.tenant_id,assignment.sva_number_id]))[0];
      await tx.unsafe("UPDATE regulatory_review_alerts SET state='resolved',resolved_at=now(),updated_at=now() WHERE assignment_id=$1 AND framework=$2 AND state<>'resolved'",[id,isArcep2026?"arcep_2026":"regulatory_trust"]);
      await tx.unsafe(
        "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'regulatory.evidence.append',$3,$4,$5::jsonb)",
        [assignment.tenant_id,actorId,isArcep2026?"sva_arcep_2026_evidence":"sva_regulatory_evidence",String(event.id),JSON.stringify({assignment_id:id,e164:assignment.e164,framework:isArcep2026?"arcep_2026":"regulatory_trust",control_key:control,status,source,event_hash:event.event_hash})]
      );
      return {event,profile,framework:isArcep2026?"arcep_2026":"regulatory_trust"};
    });
  }

  async createSvaAbuseCase(id,input={},actor={}){
    id=Number(id);if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_ASSIGNMENT_ID");
    const source=String(input.source||"internal").trim().toLowerCase(),category=String(input.category||"other").trim().toLowerCase(),severity=String(input.severity||"normal").trim().toLowerCase();
    if(!["33700","arcep","dgccrf","operator","consumer","internal","other"].includes(source))throw problem(400,"INVALID_ABUSE_SOURCE");
    if(!["spam","fraud","spoofing","tariff","content","identity","routing","other"].includes(category))throw problem(400,"INVALID_ABUSE_CATEGORY");
    if(!["low","normal","high","critical"].includes(severity))throw problem(400,"INVALID_ABUSE_SEVERITY");
    const summary=String(input.summary||"").trim();if(summary.length<3||summary.length>500)throw problem(400,"INVALID_ABUSE_SUMMARY");
    const externalReference=optionalText(input.external_reference,500),suspensionRequired=Boolean(input.suspension_required);
    const sla={low:[240,2880],normal:[120,1440],high:[30,240],critical:[15,120]}[severity];
    const details=input.details&&typeof input.details==="object"&&!Array.isArray(input.details)?input.details:{};
    const actorId=numericActor(actor);
    return this.sql.begin(async tx=>{
      const assignment=(await tx.unsafe("SELECT a.tenant_id,a.sva_number_id,t.tenant_type,sn.e164 FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id JOIN sva_numbers sn ON sn.id=a.sva_number_id WHERE a.id=$1",[id]))[0];
      if(!assignment)throw problem(404,"ASSIGNMENT_NOT_FOUND");
      if(assignment.tenant_type==="internal")throw problem(409,"INTERNAL_ASSIGNMENT_PROTECTED");
      const row=(await tx.unsafe(
        "INSERT INTO sva_abuse_cases(tenant_id,sva_number_id,source,external_reference,category,severity,status,suspension_required,first_response_due_at,resolution_due_at,summary,details)"+
        " VALUES($1,$2,$3,$4,$5,$6,'open',$7,now()+($8::int*interval '1 minute'),now()+($9::int*interval '1 minute'),$10,$11::jsonb) RETURNING *",
        [assignment.tenant_id,assignment.sva_number_id,source,externalReference,category,severity,suspensionRequired,sla[0],sla[1],summary,JSON.stringify(details)]
      ))[0];
      await tx.unsafe(
        "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'regulatory.abuse.open','sva_abuse_case',$3,$4::jsonb)",
        [assignment.tenant_id,actorId,String(row.public_id),JSON.stringify({assignment_id:id,e164:assignment.e164,source,category,severity,suspension_required:suspensionRequired})]
      );
      await tx.unsafe(
        "INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload) VALUES($1,'regulatory.abuse.opened','sva_abuse_case',$2,$3::jsonb)",
        [assignment.tenant_id,String(row.public_id),JSON.stringify({assignment_id:id,source,category,severity,suspension_required:suspensionRequired})]
      );
      return row;
    });
  }

  async createCallDestination(publicId,input={},actor={}){
    publicId=String(publicId||"").trim();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(publicId))throw problem(400,"INVALID_TENANT_PUBLIC_ID");
    const label=String(input.label||"").trim();if(!label||label.length>120)throw problem(400,"INVALID_CALL_DESTINATION_LABEL");
    const type=String(input.destination_type||"").trim().toLowerCase();if(!["pstn","sip","pbx","contact_center"].includes(type))throw problem(400,"INVALID_CALL_DESTINATION_TYPE");
    const uri=String(input.destination_uri||"").trim(),isTel=/^tel:\+[1-9][0-9]{6,14}$/.test(uri),isSip=/^sips?:[^\s@]+@[^\s@]+$/i.test(uri);
    if(type==="pstn"?!isTel:type==="sip"?!isSip:!(isTel||isSip))throw problem(400,"INVALID_CALL_DESTINATION_URI");
    const priority=Number(input.priority??100);if(!Number.isInteger(priority)||priority<1||priority>10000)throw problem(400,"INVALID_CALL_DESTINATION_PRIORITY");
    const max=input.max_concurrent_calls==null||input.max_concurrent_calls===""?null:Number(input.max_concurrent_calls);
    if(max!=null&&(!Number.isInteger(max)||max<1||max>100000))throw problem(400,"INVALID_CALL_DESTINATION_CAPACITY");
    const assignmentId=input.assignment_id==null||input.assignment_id===""?null:Number(input.assignment_id);
    if(assignmentId!=null&&(!Number.isInteger(assignmentId)||assignmentId<=0))throw problem(400,"INVALID_ASSIGNMENT_ID");
    const actorId=numericActor(actor);
    const result=await this.sql.begin(async tx=>{
      const tenants=await tx.unsafe("SELECT id,public_id,display_name,tenant_type FROM tenants WHERE public_id=$1::uuid FOR UPDATE",[publicId]);
      const tenant=tenants[0];if(!tenant)throw problem(404,"TENANT_NOT_FOUND");if(tenant.tenant_type==="internal")throw problem(409,"INTERNAL_TENANT_PROTECTED");
      let svaId=null,displayNumber=null;
      if(assignmentId!=null){
        const rows=await tx.unsafe("SELECT a.sva_number_id,sn.display_number FROM tenant_number_assignments a JOIN sva_numbers sn ON sn.id=a.sva_number_id WHERE a.id=$1 AND a.tenant_id=$2 LIMIT 1",[assignmentId,tenant.id]);
        if(!rows[0])throw problem(404,"ASSIGNMENT_NOT_FOUND");svaId=Number(rows[0].sva_number_id);displayNumber=rows[0].display_number;
      }
      const inserted=await tx.unsafe("INSERT INTO tenant_call_destinations(tenant_id,sva_number_id,label,destination_type,destination_uri,priority,status,failover_enabled,max_concurrent_calls) VALUES($1,$2,$3,$4,$5,$6,'testing',true,$7) RETURNING id,tenant_id,sva_number_id,label,destination_type,destination_uri,priority,status,failover_enabled,max_concurrent_calls,active_calls,created_at",[tenant.id,svaId,label,type,uri,priority,max]);
      const row=inserted[0];
      await tx.unsafe("INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'call_destination.create','tenant_call_destination',$3,$4::jsonb)",[tenant.id,actorId,String(row.id),JSON.stringify({label,destination_type:type,priority,assignment_id:assignmentId,display_number:displayNumber})]);
      await tx.unsafe("INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload) VALUES($1,'call_destination.created','tenant_call_destination',$2,$3::jsonb)",[tenant.id,String(row.id),JSON.stringify({tenant_public_id:publicId,label,status:row.status})]);
      return {...row,tenant_public_id:publicId,tenant:tenant.display_name,display_number:displayNumber};
    });
    this.eventBus.publish("call_destination.created",{id:result.id,tenant_public_id:publicId,status:result.status});return result;
  }

  async setCallDestinationStatus(id,status,actor={},reason=""){
    id=Number(id);if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_CALL_DESTINATION_ID");
    status=String(status||"").trim().toLowerCase();if(!["active","testing","disabled"].includes(status))throw problem(400,"INVALID_CALL_DESTINATION_STATUS");
    reason=String(reason||"").trim().slice(0,500);const actorId=numericActor(actor);
    const result=await this.sql.begin(async tx=>{
      const rows=await tx.unsafe("SELECT d.id,d.tenant_id,d.status,d.label,t.public_id,t.tenant_type FROM tenant_call_destinations d JOIN tenants t ON t.id=d.tenant_id WHERE d.id=$1 FOR UPDATE",[id]);
      const row=rows[0];if(!row)throw problem(404,"CALL_DESTINATION_NOT_FOUND");if(row.tenant_type==="internal")throw problem(409,"INTERNAL_TENANT_PROTECTED");
      const previous=row.status;if(previous===status)return {...row,previous_status:previous,changed:false};
      const updated=await tx.unsafe("UPDATE tenant_call_destinations SET status=$1,active_calls=CASE WHEN $1='disabled' THEN 0 ELSE active_calls END,updated_at=now() WHERE id=$2 RETURNING id,tenant_id,label,destination_type,destination_uri,priority,status,max_concurrent_calls,active_calls",[status,id]);
      await tx.unsafe("INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,'tenant_call_destination',$4,$5::jsonb)",[row.tenant_id,actorId,"call_destination.status."+status,String(id),JSON.stringify({previous_status:previous,status,reason})]);
      return {...updated[0],tenant_public_id:row.public_id,previous_status:previous,changed:true};
    });
    if(result.changed)this.eventBus.publish("call_destination.status",{id,status:result.status,tenant_public_id:result.tenant_public_id});return result;
  }


  async scanRegulatoryReviews(limit=500){
    limit=clampInt(limit,500,1,5000);
    const rows=await this.sql.begin(async tx=>{
      await tx.unsafe(
        "WITH candidates AS ("+
        " SELECT 'regulatory:trust:control:'||a.id::text AS alert_key,a.tenant_id,a.id AS assignment_id,a.sva_number_id,NULL::bigint AS platform_control_id,"+
        " 'regulatory_trust'::text AS framework,'control_blocking'::text AS alert_kind,'critical'::text AS severity,"+
        " 'Trust Center bloquant'::text AS title,('Le numéro '||COALESCE(sn.display_number,sn.e164)||' est actif mais son profil réglementaire n’est plus prêt.')::text AS message,"+
        " NULL::timestamptz AS due_at,jsonb_build_object('display_number',COALESCE(sn.display_number,sn.e164),'assignment_status',a.status) AS details"+
        " FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id JOIN sva_numbers sn ON sn.id=a.sva_number_id"+
        " JOIN sva_regulatory_profiles p ON p.tenant_id=a.tenant_id AND p.sva_number_id=a.sva_number_id"+
        " WHERE t.tenant_type<>'internal' AND a.status='active' AND (p.next_review_at IS NULL OR p.next_review_at>now())"+
        " AND NOT pgi_sva_regulatory_ready(a.tenant_id,a.sva_number_id)"+
        " UNION ALL"+
        " SELECT 'regulatory:trust:review:'||a.id::text,a.tenant_id,a.id,a.sva_number_id,NULL::bigint,'regulatory_trust',"+
        " CASE WHEN p.next_review_at IS NULL THEN 'review_schedule_missing' WHEN p.next_review_at<=now() THEN 'review_overdue' WHEN p.next_review_at<=now()+interval '24 hours' THEN 'review_due_today' ELSE 'review_due_soon' END,"+
        " CASE WHEN p.next_review_at<=now() THEN 'critical' WHEN p.next_review_at<=now()+interval '24 hours' THEN 'warning' ELSE 'info' END,"+
        " 'Revue Trust Center'::text,"+
        " CASE WHEN p.next_review_at IS NULL THEN ('Le numéro '||COALESCE(sn.display_number,sn.e164)||' est prêt mais aucune prochaine revue n’est planifiée.')"+
        " WHEN p.next_review_at<=now() THEN ('La revue Trust Center du numéro '||COALESCE(sn.display_number,sn.e164)||' est dépassée.')"+
        " ELSE ('La revue Trust Center du numéro '||COALESCE(sn.display_number,sn.e164)||' approche.') END,"+
        " p.next_review_at,jsonb_build_object('display_number',COALESCE(sn.display_number,sn.e164),'next_review_at',p.next_review_at)"+
        " FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id JOIN sva_numbers sn ON sn.id=a.sva_number_id"+
        " JOIN sva_regulatory_profiles p ON p.tenant_id=a.tenant_id AND p.sva_number_id=a.sva_number_id"+
        " WHERE t.tenant_type<>'internal' AND a.status<>'ended' AND ("+
        " (p.next_review_at IS NULL AND pgi_sva_regulatory_ready(a.tenant_id,a.sva_number_id)) OR"+
        " (p.next_review_at IS NOT NULL AND p.next_review_at<=now()+interval '30 days'))"+
        " UNION ALL"+
        " SELECT 'regulatory:arcep2026:control:'||a.id::text,a.tenant_id,a.id,a.sva_number_id,NULL::bigint,'arcep_2026','control_blocking','critical',"+
        " 'ARCEP 2026 bloquant',('Le numéro '||COALESCE(sn.display_number,sn.e164)||' est actif mais un garde-fou ARCEP 2026 n’est plus prêt.'),NULL::timestamptz,"+
        " jsonb_build_object('display_number',COALESCE(sn.display_number,sn.e164),'assignment_status',a.status)"+
        " FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id JOIN sva_numbers sn ON sn.id=a.sva_number_id"+
        " JOIN sva_arcep_2026_profiles p ON p.tenant_id=a.tenant_id AND p.sva_number_id=a.sva_number_id"+
        " WHERE t.tenant_type<>'internal' AND a.status='active' AND (p.next_review_at IS NULL OR p.next_review_at>now())"+
        " AND NOT pgi_arcep_2026_number_ready(a.tenant_id,a.sva_number_id)"+
        " UNION ALL"+
        " SELECT 'regulatory:arcep2026:review:'||a.id::text,a.tenant_id,a.id,a.sva_number_id,NULL::bigint,'arcep_2026',"+
        " CASE WHEN p.next_review_at IS NULL THEN 'review_schedule_missing' WHEN p.next_review_at<=now() THEN 'review_overdue' WHEN p.next_review_at<=now()+interval '24 hours' THEN 'review_due_today' ELSE 'review_due_soon' END,"+
        " CASE WHEN p.next_review_at<=now() THEN 'critical' WHEN p.next_review_at<=now()+interval '24 hours' THEN 'warning' ELSE 'info' END,"+
        " 'Revue ARCEP 2026'::text,"+
        " CASE WHEN p.next_review_at IS NULL THEN ('Le numéro '||COALESCE(sn.display_number,sn.e164)||' est prêt mais aucune prochaine revue ARCEP 2026 n’est planifiée.')"+
        " WHEN p.next_review_at<=now() THEN ('La revue ARCEP 2026 du numéro '||COALESCE(sn.display_number,sn.e164)||' est dépassée.')"+
        " ELSE ('La revue ARCEP 2026 du numéro '||COALESCE(sn.display_number,sn.e164)||' approche.') END,"+
        " p.next_review_at,jsonb_build_object('display_number',COALESCE(sn.display_number,sn.e164),'next_review_at',p.next_review_at)"+
        " FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id JOIN sva_numbers sn ON sn.id=a.sva_number_id"+
        " JOIN sva_arcep_2026_profiles p ON p.tenant_id=a.tenant_id AND p.sva_number_id=a.sva_number_id"+
        " WHERE t.tenant_type<>'internal' AND a.status<>'ended' AND ("+
        " (p.next_review_at IS NULL AND pgi_arcep_2026_number_ready(a.tenant_id,a.sva_number_id)) OR"+
        " (p.next_review_at IS NOT NULL AND p.next_review_at<=now()+interval '30 days'))"+
        " UNION ALL"+
        " SELECT 'regulatory:platform:'||c.id::text,NULL::bigint,NULL::bigint,NULL::bigint,c.id,'platform',"+
        " CASE WHEN c.status IN ('failed','expired') OR (c.valid_until IS NOT NULL AND c.valid_until<=now()) THEN 'control_blocking' ELSE 'control_expiring' END,"+
        " CASE WHEN c.status IN ('failed','expired') OR (c.valid_until IS NOT NULL AND c.valid_until<=now()) THEN 'critical' WHEN c.valid_until<=now()+interval '24 hours' THEN 'warning' ELSE 'info' END,"+
        " ('Contrôle plateforme : '||replace(c.control_key,'_',' ')),"+
        " CASE WHEN c.status IN ('failed','expired') OR (c.valid_until IS NOT NULL AND c.valid_until<=now()) THEN 'Ce contrôle plateforme exige une action avant toute nouvelle activation concernée.' ELSE 'La preuve de ce contrôle plateforme approche de son échéance.' END,"+
        " c.valid_until,jsonb_build_object('control_key',c.control_key,'market',m.country_code,'status',c.status,'valid_until',c.valid_until)"+
        " FROM platform_regulatory_controls c LEFT JOIN operating_markets m ON m.id=c.market_id"+
        " WHERE c.status IN ('failed','expired') OR (c.status='verified' AND c.valid_until IS NOT NULL AND c.valid_until<=now()+interval '30 days')"+
        "), limited AS ("+
        " SELECT * FROM candidates ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,due_at NULLS LAST,alert_key LIMIT $1"+
        ")"+
        " INSERT INTO regulatory_review_alerts(alert_key,tenant_id,assignment_id,sva_number_id,platform_control_id,framework,alert_kind,severity,title,message,due_at,details)"+
        " SELECT alert_key,tenant_id,assignment_id,sva_number_id,platform_control_id,framework,alert_kind,severity,title,message,due_at,details FROM limited"+
        " ON CONFLICT(alert_key) DO UPDATE SET"+
        " alert_kind=EXCLUDED.alert_kind,severity=EXCLUDED.severity,title=EXCLUDED.title,message=EXCLUDED.message,due_at=EXCLUDED.due_at,details=EXCLUDED.details,last_detected_at=now(),updated_at=now(),resolved_at=NULL,"+
        " state=CASE WHEN regulatory_review_alerts.state='resolved' OR regulatory_review_alerts.alert_kind IS DISTINCT FROM EXCLUDED.alert_kind OR regulatory_review_alerts.severity IS DISTINCT FROM EXCLUDED.severity THEN 'open' ELSE regulatory_review_alerts.state END,"+
        " acknowledged_at=CASE WHEN regulatory_review_alerts.state='resolved' OR regulatory_review_alerts.alert_kind IS DISTINCT FROM EXCLUDED.alert_kind OR regulatory_review_alerts.severity IS DISTINCT FROM EXCLUDED.severity THEN NULL ELSE regulatory_review_alerts.acknowledged_at END,"+
        " acknowledged_by=CASE WHEN regulatory_review_alerts.state='resolved' OR regulatory_review_alerts.alert_kind IS DISTINCT FROM EXCLUDED.alert_kind OR regulatory_review_alerts.severity IS DISTINCT FROM EXCLUDED.severity THEN NULL ELSE regulatory_review_alerts.acknowledged_by END",
        [limit]
      );

      await tx.unsafe(
        "UPDATE regulatory_review_alerts r SET state='resolved',resolved_at=now(),updated_at=now()"+
        " WHERE r.state<>'resolved' AND r.alert_key LIKE 'regulatory:trust:control:%' AND NOT EXISTS ("+
        " SELECT 1 FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id JOIN sva_regulatory_profiles p ON p.tenant_id=a.tenant_id AND p.sva_number_id=a.sva_number_id"+
        " WHERE a.id=r.assignment_id AND t.tenant_type<>'internal' AND a.status='active' AND (p.next_review_at IS NULL OR p.next_review_at>now()) AND NOT pgi_sva_regulatory_ready(a.tenant_id,a.sva_number_id))"
      );
      await tx.unsafe(
        "UPDATE regulatory_review_alerts r SET state='resolved',resolved_at=now(),updated_at=now()"+
        " WHERE r.state<>'resolved' AND r.alert_key LIKE 'regulatory:trust:review:%' AND NOT EXISTS ("+
        " SELECT 1 FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id JOIN sva_regulatory_profiles p ON p.tenant_id=a.tenant_id AND p.sva_number_id=a.sva_number_id"+
        " WHERE a.id=r.assignment_id AND t.tenant_type<>'internal' AND a.status<>'ended' AND ((p.next_review_at IS NULL AND pgi_sva_regulatory_ready(a.tenant_id,a.sva_number_id)) OR (p.next_review_at IS NOT NULL AND p.next_review_at<=now()+interval '30 days')))"
      );
      await tx.unsafe(
        "UPDATE regulatory_review_alerts r SET state='resolved',resolved_at=now(),updated_at=now()"+
        " WHERE r.state<>'resolved' AND r.alert_key LIKE 'regulatory:arcep2026:control:%' AND NOT EXISTS ("+
        " SELECT 1 FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id JOIN sva_arcep_2026_profiles p ON p.tenant_id=a.tenant_id AND p.sva_number_id=a.sva_number_id"+
        " WHERE a.id=r.assignment_id AND t.tenant_type<>'internal' AND a.status='active' AND (p.next_review_at IS NULL OR p.next_review_at>now()) AND NOT pgi_arcep_2026_number_ready(a.tenant_id,a.sva_number_id))"
      );
      await tx.unsafe(
        "UPDATE regulatory_review_alerts r SET state='resolved',resolved_at=now(),updated_at=now()"+
        " WHERE r.state<>'resolved' AND r.alert_key LIKE 'regulatory:arcep2026:review:%' AND NOT EXISTS ("+
        " SELECT 1 FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id JOIN sva_arcep_2026_profiles p ON p.tenant_id=a.tenant_id AND p.sva_number_id=a.sva_number_id"+
        " WHERE a.id=r.assignment_id AND t.tenant_type<>'internal' AND a.status<>'ended' AND ((p.next_review_at IS NULL AND pgi_arcep_2026_number_ready(a.tenant_id,a.sva_number_id)) OR (p.next_review_at IS NOT NULL AND p.next_review_at<=now()+interval '30 days')))"
      );
      await tx.unsafe(
        "UPDATE regulatory_review_alerts r SET state='resolved',resolved_at=now(),updated_at=now()"+
        " WHERE r.state<>'resolved' AND r.framework='platform' AND NOT EXISTS ("+
        " SELECT 1 FROM platform_regulatory_controls c WHERE c.id=r.platform_control_id AND (c.status IN ('failed','expired') OR (c.status='verified' AND c.valid_until IS NOT NULL AND c.valid_until<=now()+interval '30 days')))"
      );
      return tx.unsafe(
        "SELECT r.id,r.alert_key,r.framework,r.alert_kind,r.severity,r.state,r.title,r.message,r.due_at,r.details,r.first_detected_at,r.last_detected_at,"+
        " t.public_id AS tenant_public_id,t.display_name AS tenant,t.country_code,sn.display_number,sn.e164,m.country_code AS market"+
        " FROM regulatory_review_alerts r LEFT JOIN tenants t ON t.id=r.tenant_id LEFT JOIN sva_numbers sn ON sn.id=r.sva_number_id"+
        " LEFT JOIN platform_regulatory_controls pc ON pc.id=r.platform_control_id LEFT JOIN operating_markets m ON m.id=COALESCE(sn.market_id,pc.market_id)"+
        " WHERE r.state<>'resolved' ORDER BY CASE r.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,r.due_at NULLS LAST,r.id DESC LIMIT $1",
        [limit]
      );
    });
    return rows;
  }

  async listRegulatoryReviewAlerts(params={}){
    const limit=clampInt(params.limit,50,1,250),cursor=decodeNumericCursor(params.cursor);
    const state=params.state?String(params.state).trim().toLowerCase():"unresolved";
    if(!["open","acknowledged","resolved","unresolved","all"].includes(state))throw problem(400,"INVALID_ALERT_STATE");
    const rows=await this.readSql.unsafe(
      "SELECT r.id AS _cursor_id,r.id,r.assignment_id,r.sva_number_id,r.platform_control_id,r.alert_key,r.framework,r.alert_kind,r.severity,r.state,r.title,r.message,r.due_at,r.details,r.first_detected_at,r.last_detected_at,r.acknowledged_at,r.resolved_at,"+
      " CASE WHEN r.severity='critical' THEN 'blocking' WHEN r.due_at IS NOT NULL AND r.due_at<=now()+interval '24 hours' THEN 'today' ELSE 'soon' END AS attention_bucket,"+
      " t.public_id AS tenant_public_id,t.display_name AS tenant,t.country_code,sn.display_number,sn.e164,m.country_code AS market"+
      " FROM regulatory_review_alerts r LEFT JOIN tenants t ON t.id=r.tenant_id LEFT JOIN sva_numbers sn ON sn.id=r.sva_number_id"+
      " LEFT JOIN platform_regulatory_controls pc ON pc.id=r.platform_control_id LEFT JOIN operating_markets m ON m.id=COALESCE(sn.market_id,pc.market_id)"+
      " WHERE ($1='all' OR ($1='unresolved' AND r.state<>'resolved') OR r.state=$1) AND ($2::bigint IS NULL OR r.id<$2)"+
      " ORDER BY r.id DESC LIMIT $3",
      [state,cursor,limit+1]
    );
    const hasMore=rows.length>limit,page=hasMore?rows.slice(0,limit):rows;
    return {data:page.map(row=>{const {_cursor_id,...publicRow}=row;return publicRow;}),next_cursor:hasMore&&page.length?encodeNumericCursor(Number(page.at(-1)._cursor_id)):null};
  }

  async acknowledgeRegulatoryReviewAlert(id,actor={}){
    id=Number(id);if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_ALERT_ID");
    const actorId=numericActor(actor);
    const row=(await this.sql.unsafe(
      "UPDATE regulatory_review_alerts SET state='acknowledged',acknowledged_at=now(),acknowledged_by=$2,updated_at=now() WHERE id=$1 AND state='open'"+
      " RETURNING id,tenant_id,assignment_id,framework,alert_kind,severity,state,title,message,due_at",
      [id,actorId]
    ))[0];
    if(!row)throw problem(409,"ALERT_NOT_OPEN");
    await this.sql.unsafe(
      "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'regulatory.review_alert.acknowledge','regulatory_review_alert',$3,$4::jsonb)",
      [row.tenant_id||null,actorId,String(id),JSON.stringify({framework:row.framework,alert_kind:row.alert_kind,severity:row.severity,state:"acknowledged"})]
    );
    return row;
  }

  async scanUnpaidSubscriptions(limit=500){
    limit=clampInt(limit,500,1,2000);
    const alerts=await this.sql.begin(async tx=>{
      await tx.unsafe(
        "UPDATE tenant_subscriptions s SET status='past_due',last_payment_status=COALESCE(NULLIF(last_payment_status,''),'unpaid'),updated_at=now()"+
        " FROM service_plans p,tenants t WHERE p.id=s.service_plan_id AND t.id=s.tenant_id AND p.plan_key='external-sva-access'"+
        " AND t.tenant_type<>'internal' AND s.status='active' AND s.current_period_end IS NOT NULL AND s.current_period_end<=now()"
      );
      await tx.unsafe(
        "INSERT INTO subscription_recovery_states(subscription_id,tenant_id,recovery_state,first_failed_at,last_failed_at,grace_until,recovery_deadline,attempt_count,last_payment_status)"+
        " SELECT s.id,s.tenant_id,'grace',now(),now(),now()+interval '7 days',now()+interval '14 days',1,COALESCE(NULLIF(s.last_payment_status,''),'unpaid')"+
        " FROM tenant_subscriptions s JOIN service_plans p ON p.id=s.service_plan_id JOIN tenants t ON t.id=s.tenant_id"+
        " WHERE p.plan_key='external-sva-access' AND t.tenant_type<>'internal' AND t.status<>'closed' AND s.status='past_due'"+
        " AND (s.current_period_end IS NULL OR s.current_period_end<=now())"+
        " ON CONFLICT(subscription_id) DO UPDATE SET recovery_state='grace',first_failed_at=EXCLUDED.first_failed_at,last_failed_at=EXCLUDED.last_failed_at,"+
        " grace_until=EXCLUDED.grace_until,recovery_deadline=EXCLUDED.recovery_deadline,next_retry_at=NULL,attempt_count=1,last_payment_status=EXCLUDED.last_payment_status,recovered_at=NULL"+
        " WHERE subscription_recovery_states.recovery_state IN ('healthy','recovered')"
      );
      await tx.unsafe(
        "UPDATE subscription_recovery_states SET recovery_state='suspended',updated_at=now()"+
        " WHERE recovery_state IN ('grace','retrying','action_required') AND grace_until IS NOT NULL AND grace_until<=now()"
      );
      return tx.unsafe(
        "WITH due AS ("+
        " SELECT s.id AS subscription_id,s.tenant_id,t.public_id,t.display_name,t.country_code,s.current_period_end,s.status,s.last_payment_status,"+
        " r.recovery_state,r.first_failed_at,r.grace_until,r.recovery_deadline,r.next_retry_at,r.attempt_count"+
        " FROM tenant_subscriptions s JOIN service_plans p ON p.id=s.service_plan_id JOIN tenants t ON t.id=s.tenant_id"+
        " LEFT JOIN subscription_recovery_states r ON r.subscription_id=s.id AND r.tenant_id=s.tenant_id"+
        " WHERE p.plan_key='external-sva-access' AND t.tenant_type<>'internal' AND t.status<>'closed'"+
        " AND (s.status IN ('past_due','suspended') OR lower(COALESCE(s.last_payment_status,'')) IN ('failed','unpaid','declined','past_due','action_required'))"+
        " ORDER BY COALESCE(r.grace_until,s.current_period_end,now()) ASC,s.id ASC LIMIT $1"+
        "), ins AS ("+
        " INSERT INTO tenant_admin_alerts(alert_key,tenant_id,subscription_id,alert_type,severity,title,message,due_at,details)"+
        " SELECT 'subscription_unpaid:'||d.subscription_id||':'||COALESCE(EXTRACT(EPOCH FROM d.first_failed_at)::bigint::text,'legacy'),d.tenant_id,d.subscription_id,"+
        " 'subscription_unpaid',CASE WHEN d.recovery_state='suspended' OR (d.grace_until IS NOT NULL AND d.grace_until<=now()) THEN 'critical' ELSE 'warning' END,"+
        " CASE WHEN d.recovery_state='suspended' OR (d.grace_until IS NOT NULL AND d.grace_until<=now()) THEN 'Abonnement suspendu' ELSE 'Paiement à régulariser' END,"+
        " CASE WHEN d.recovery_state='suspended' OR (d.grace_until IS NOT NULL AND d.grace_until<=now()) THEN 'Période de grâce expirée : accès SVA suspendu, régularisation possible depuis le portail client.'"+
        " ELSE 'Paiement mensuel refusé : période de grâce active, relances automatiques en cours.' END,"+
        " COALESCE(d.grace_until,d.current_period_end),"+
        " jsonb_build_object('tenant_public_id',d.public_id,'tenant',d.display_name,'country_code',d.country_code,'subscription_status',d.status,'last_payment_status',d.last_payment_status,"+
        " 'recovery_state',d.recovery_state,'grace_until',d.grace_until,'recovery_deadline',d.recovery_deadline,'next_retry_at',d.next_retry_at,'attempt_count',COALESCE(d.attempt_count,0))"+
        " FROM due d ON CONFLICT(alert_key) DO UPDATE SET severity=EXCLUDED.severity,title=EXCLUDED.title,message=EXCLUDED.message,due_at=EXCLUDED.due_at,details=EXCLUDED.details,last_detected_at=now(),updated_at=now()"+
        " WHERE tenant_admin_alerts.state<>'resolved'"+
        " RETURNING id,tenant_id,subscription_id,alert_type,severity,state,title,message,due_at,details,first_detected_at,last_detected_at"+
        ") SELECT i.*,t.public_id AS tenant_public_id,t.display_name AS tenant,t.country_code FROM ins i JOIN tenants t ON t.id=i.tenant_id",
        [limit]
      );
    });
    for(const a of alerts)this.eventBus.publish("subscription.unpaid",{alert_id:Number(a.id),tenant_public_id:a.tenant_public_id,tenant:a.tenant,country_code:a.country_code,due_at:a.due_at});
    return alerts;
  }

  async listAdminAlerts(params={}){
    const limit=clampInt(params.limit,50,1,250),cursor=decodeNumericCursor(params.cursor);
    const state=params.state?String(params.state).trim().toLowerCase():"open";
    if(!["open","acknowledged","resolved","unresolved","all"].includes(state))throw problem(400,"INVALID_ALERT_STATE");
    const country=params.country?String(params.country).trim().toUpperCase():null;
    if(country&&!/^[A-Z]{2}$/.test(country))throw problem(400,"INVALID_COUNTRY_CODE");
    const rows=await this.readSql.unsafe(
      "SELECT a.id AS _cursor_id,a.id,a.alert_type,a.severity,a.state,a.title,a.message,a.due_at,a.first_detected_at,a.last_detected_at,a.acknowledged_at,a.resolved_at,"+
      " t.public_id AS tenant_public_id,t.display_name AS tenant,t.country_code,s.status AS subscription_status,s.last_payment_status,s.current_period_end"+
      " FROM tenant_admin_alerts a JOIN tenants t ON t.id=a.tenant_id LEFT JOIN tenant_subscriptions s ON s.id=a.subscription_id"+
      " WHERE ($1='all' OR ($1='unresolved' AND a.state<>'resolved') OR a.state=$1) AND ($2::text IS NULL OR t.country_code=$2) AND ($3::bigint IS NULL OR a.id<$3)"+
      " ORDER BY a.id DESC LIMIT $4",[state,country,cursor,limit+1]
    );
    const hasMore=rows.length>limit,page=hasMore?rows.slice(0,limit):rows;
    return {data:page.map(row=>{const {_cursor_id,...publicRow}=row;return publicRow;}),next_cursor:hasMore&&page.length?encodeNumericCursor(Number(page.at(-1)._cursor_id)):null};
  }

  async acknowledgeAdminAlert(id,actor={}){
    id=Number(id);if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_ALERT_ID");
    const actorId=numericActor(actor);
    const result=await this.sql.begin(async tx=>{
      const rows=await tx.unsafe(
        "UPDATE tenant_admin_alerts SET state='acknowledged',acknowledged_at=now(),acknowledged_by=$2,updated_at=now()"+
        " WHERE id=$1 AND state='open' RETURNING id,tenant_id,state,title,message,due_at",[id,actorId]
      );
      const row=rows[0];if(!row)throw problem(409,"ALERT_NOT_OPEN");
      await tx.unsafe(
        "INSERT INTO tenant_control_events(tenant_id,actor_user_id,action,previous_status,new_status,details) VALUES($1,$2,'alert.acknowledge','open','acknowledged',$3::jsonb)",
        [row.tenant_id,actorId,JSON.stringify({alert_id:id})]
      );
      await tx.unsafe(
        "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'billing.alert.acknowledge','tenant_admin_alert',$3,$4::jsonb)",
        [row.tenant_id,actorId,String(id),JSON.stringify({state:"acknowledged"})]
      );
      return row;
    });
    this.eventBus.publish("billing.alert.acknowledged",{id,result:"acknowledged"});
    return result;
  }

  async selfServiceRegister(input={},passwordHash){
    const firstName=String(input.first_name||"").trim().slice(0,80);
    const lastName=String(input.last_name||"").trim().slice(0,80);
    const email=String(input.email||"").trim().toLowerCase().slice(0,320);
    const companyName=String(input.company_name||"").trim().slice(0,200);
    const country=String(input.country_code||"").trim().toUpperCase();
    const registrationRaw=String(input.registration_number||"").trim().slice(0,64);
    const phone=String(input.phone||"").trim().slice(0,40);
    const localeInput=String(input.preferred_locale||"").trim().slice(0,35);
    const timezoneInput=String(input.timezone||"").trim().slice(0,80);
    const accountTypeInput=String(input.account_type||"").trim().toLowerCase();
    const accountType=accountTypeInput||((companyName||registrationRaw)?"business":"individual");
    const acquisitionSource=String(input.acquisition_source||"")==="public_marketing_site"?"public_marketing_site":"self_service";
    const serviceIntentInput=String(input.service_intent||"").trim().toLowerCase();
    const serviceIntent=["new_number","portability","advice"].includes(serviceIntentInput)?serviceIntentInput:"";
    const authorityConfirmed=input.authority_confirmed===true;
    if(firstName.length<1||lastName.length<1)throw problem(400,"CUSTOMER_NAME_REQUIRED");
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw problem(400,"INVALID_CUSTOMER_EMAIL");
    if(!/^[A-Z]{2}$/.test(country))throw problem(400,"INVALID_COUNTRY_CODE");
    if(String(passwordHash||"").length<20)throw problem(400,"INVALID_PASSWORD_HASH");
    if(!["individual","business"].includes(accountType))throw problem(400,"INVALID_CUSTOMER_ACCOUNT_TYPE");
    if(!authorityConfirmed)throw problem(400,"REGISTRATION_AUTHORITY_REQUIRED");
    if(localeInput&&!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(localeInput))throw problem(400,"INVALID_TENANT_LOCALE");
    if(timezoneInput&&!/^[A-Za-z0-9_+\-/]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(timezoneInput))throw problem(400,"INVALID_TENANT_TIMEZONE");
    const effectiveCompanyName=accountType==="business"?companyName:"";
    const effectiveRegistrationRaw=accountType==="business"?registrationRaw:"";
    let registrationNumber=effectiveRegistrationRaw.replace(/\s+/g,"");
    if(country==="FR"&&registrationNumber){
      registrationNumber=registrationNumber.replace(/\D/g,"");
      if(!/^\d{14}$/.test(registrationNumber))throw problem(400,"INVALID_SIRET");
    }else if(registrationNumber&&!/^[A-Za-z0-9._\-/]{2,64}$/.test(registrationNumber)){
      throw problem(400,"INVALID_REGISTRATION_NUMBER");
    }
    if(phone&&!/^[+0-9 ()\.\-]{6,40}$/.test(phone))throw problem(400,"INVALID_PHONE");
    const displayName=(firstName+" "+lastName).trim();
    const tenantName=accountType==="business"?(effectiveCompanyName||displayName):displayName;
    const slugBase=tenantName.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,48)||"client";
    const result=await this.sql.begin(async tx=>{
      await tx.unsafe("SELECT pg_advisory_xact_lock(hashtext($1))",[email]);
      const existing=(await tx.unsafe("SELECT id FROM customer_principals WHERE email_normalized=$1 LIMIT 1",[email]))[0];
      if(existing)throw problem(409,"CUSTOMER_ACCOUNT_EXISTS");
      if(registrationNumber){
        const duplicateRegistration=(await tx.unsafe(
          "SELECT t.public_id,t.display_name FROM tenant_kyc_profiles k JOIN tenants t ON t.id=k.tenant_id WHERE t.tenant_type<>'internal' AND k.registration_country=$1 AND k.registration_number=$2 LIMIT 1",
          [country,registrationNumber]
        ))[0];
        if(duplicateRegistration)throw problem(409,"CUSTOMER_REGISTRATION_EXISTS");
      }
      const market=(await tx.unsafe("SELECT id,default_locale,default_currency,timezone,data_region FROM operating_markets WHERE country_code=$1 LIMIT 1",[country]))[0]||null;
      const billingDefault=resolveBillingCurrency(country);
      if(!billingDefault)throw problem(400,"BILLING_CURRENCY_NOT_CONFIGURED");
      const locale=localeInput||market?.default_locale||"en";
      const currency=billingDefault.currency;
      const timezone=timezoneInput||market?.timezone||"UTC";
      const tenant=(await tx.unsafe(
        "INSERT INTO tenants(slug,display_name,legal_name,tenant_type,status,country_code,billing_email,preferred_locale,default_currency,timezone)"+
        " VALUES($1||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,8),$2,$3,'customer','pending',$4,$5,$6,$7,$8)"+
        " RETURNING id,public_id,display_name,status,authorization_version",
        [slugBase,tenantName,effectiveCompanyName||tenantName,country,email,locale,currency,timezone]
      ))[0];
      await tx.unsafe(
        "INSERT INTO tenant_kyc_profiles(tenant_id,entity_type,registration_country,registration_number,status,metadata)"+
        " VALUES($1,$2,$3,$4,'pending',$5::jsonb) ON CONFLICT(tenant_id) DO NOTHING",
        [tenant.id,accountType==="individual"?"individual":"company",country,registrationNumber||null,JSON.stringify({source:acquisitionSource,registration_optional:true,account_type:accountType,service_intent:serviceIntent||null})]
      );
      await tx.unsafe(
        "INSERT INTO tenant_market_profiles(tenant_id,market_id,status,preferred_locale,billing_currency,timezone,compliance_status,data_residency_region)"+
        " SELECT $1,m.id,'onboarding',$2,$3,$4,'not_started',m.data_region FROM operating_markets m WHERE m.country_code=$5"+
        " ON CONFLICT(tenant_id,market_id) DO NOTHING",
        [tenant.id,locale,currency,timezone,country]
      );
      let principal=(await tx.unsafe(
        "INSERT INTO customer_principals(email,display_name,status,preferred_locale,timezone,email_verified,metadata)"+
        " VALUES($1,$2,'active',$3,$4,false,$5::jsonb) RETURNING id,email,display_name,status,email_verified,session_version",
        [email,displayName,locale,timezone,JSON.stringify({first_name:firstName,last_name:lastName,phone:phone||null,signup_source:acquisitionSource==="public_marketing_site"?"public_marketing_site":"self_service_email",service_intent:serviceIntent||null,account_type:accountType,authority_confirmed:true})]
      ))[0];
      await tx.unsafe(
        "INSERT INTO customer_password_credentials(customer_principal_id,password_hash,status) VALUES($1::uuid,$2,'active')",
        [principal.id,String(passwordHash)]
      );
      await tx.unsafe(
        "INSERT INTO customer_tenant_memberships(tenant_id,customer_principal_id,role,status) VALUES($1,$2::uuid,'owner','active')",
        [tenant.id,principal.id]
      );
      await tx.unsafe(
        "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,NULL,'customer.self_register','tenant',$2,$3::jsonb)",
        [tenant.id,String(tenant.id),JSON.stringify({customer_principal_id:principal.id,country_code:country,account_type:accountType,acquisition_source:acquisitionSource,service_intent:serviceIntent||null,billing_currency:currency,billing_currency_source:"country_default",registration_number_supplied:Boolean(registrationNumber),authority_confirmed:true})]
      );
      await tx.unsafe(
        "INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload) VALUES($1,'customer.self_registered','tenant',$2,$3::jsonb)",
        [tenant.id,String(tenant.id),JSON.stringify({tenant_public_id:tenant.public_id,customer_principal_id:principal.id,email,country_code:country,account_type:accountType,acquisition_source:acquisitionSource,service_intent:serviceIntent||null})]
      );
      principal=(await tx.unsafe("SELECT id,email,display_name,status,email_verified,session_version FROM customer_principals WHERE id=$1::uuid",[principal.id]))[0];
      const refreshedTenant=(await tx.unsafe("SELECT id,public_id,display_name,status,authorization_version FROM tenants WHERE id=$1",[tenant.id]))[0];
      return {...principal,tenant_id:refreshedTenant.id,tenant_public_id:refreshedTenant.public_id,tenant_name:refreshedTenant.display_name,tenant_status:refreshedTenant.status,customer_role:"owner",authorization_version:refreshedTenant.authorization_version};
    });
    this.eventBus.publish("customer.self_registered",{tenant_public_id:result.tenant_public_id,email:result.email,country_code:country,acquisition_source:acquisitionSource,service_intent:serviceIntent||null});
    return result;
  }

  async customerGoogleSignIn(identity,invitationHash=null){
    if(!identity||identity.provider!=="google"||!identity.subject||!identity.email||identity.email_verified!==true)throw problem(400,"INVALID_GOOGLE_IDENTITY");
    return this.sql.begin(async tx=>{
      let invitation=null;
      if(invitationHash){
        invitation=(await tx.unsafe("SELECT i.id,i.tenant_id,i.email,i.role,i.status,i.expires_at,t.status AS tenant_status FROM customer_tenant_invitations i JOIN tenants t ON t.id=i.tenant_id WHERE i.token_hash=$1 FOR UPDATE",[String(invitationHash)]))[0];
        if(!invitation)throw problem(404,"INVITATION_NOT_FOUND");
        if(invitation.status!=="pending")throw problem(409,"INVITATION_NOT_PENDING");
        if(Date.parse(invitation.expires_at)<=Date.now())throw problem(410,"INVITATION_EXPIRED");
        if(String(invitation.email).trim().toLowerCase()!==identity.email)throw problem(403,"GOOGLE_INVITATION_EMAIL_MISMATCH");
        if(!["active","pending"].includes(invitation.tenant_status))throw problem(409,"TENANT_NOT_ACTIVE");
      }
      let principal=(await tx.unsafe("SELECT p.id,p.email,p.display_name,p.status,p.session_version FROM customer_federated_identities f JOIN customer_principals p ON p.id=f.customer_principal_id WHERE f.provider='google' AND f.provider_subject=$1 FOR UPDATE",[identity.subject]))[0]||null;
      if(!principal){
        principal=(await tx.unsafe("SELECT id,email,display_name,status,session_version FROM customer_principals WHERE email_normalized=$1 FOR UPDATE",[identity.email]))[0]||null;
        if(!principal&&!invitation){
          principal=(await tx.unsafe(
            "INSERT INTO customer_principals(email,display_name,status,email_verified) VALUES($1,$2,'pending',true) RETURNING id,email,display_name,status,session_version",
            [identity.email,identity.display_name||identity.email]
          ))[0];
        }
        if(principal&&!invitation&&!identity.authoritative_email)throw problem(409,"GOOGLE_LINK_REQUIRES_INVITATION");
        if(principal&&!["active","pending"].includes(principal.status))throw problem(409,"CUSTOMER_ACCOUNT_DISABLED");
        if(!principal){
          principal=(await tx.unsafe("INSERT INTO customer_principals(email,display_name,status,email_verified) VALUES($1,$2,'active',true) RETURNING id,email,display_name,status,session_version",[identity.email,identity.display_name||identity.email]))[0];
        }else if(invitation){
          await tx.unsafe("UPDATE customer_principals SET email_verified=true,status='active',updated_at=now() WHERE id=$1::uuid",[principal.id]);
        }else{
          await tx.unsafe("UPDATE customer_principals SET email_verified=true,updated_at=now() WHERE id=$1::uuid",[principal.id]);
        }
        const linked=await tx.unsafe("INSERT INTO customer_federated_identities(provider,provider_subject,customer_principal_id,email_at_link,email_verified,hosted_domain,picture_url,last_authenticated_at) VALUES('google',$1,$2::uuid,$3,true,$4,$5,now()) ON CONFLICT DO NOTHING RETURNING customer_principal_id",[identity.subject,principal.id,identity.email,identity.hosted_domain,identity.picture_url]);
        if(!linked.length){
          const collision=(await tx.unsafe("SELECT customer_principal_id FROM customer_federated_identities WHERE provider='google' AND provider_subject=$1",[identity.subject]))[0];
          if(!collision||String(collision.customer_principal_id)!==String(principal.id))throw problem(409,"GOOGLE_IDENTITY_ALREADY_LINKED");
        }
      }
      if(invitation){
        await tx.unsafe("UPDATE customer_principals SET status='active',email_verified=true,updated_at=now() WHERE id=$1::uuid",[principal.id]);
        await tx.unsafe("INSERT INTO customer_tenant_memberships(tenant_id,customer_principal_id,role,status) VALUES($1,$2::uuid,$3,'active') ON CONFLICT(tenant_id,customer_principal_id) DO UPDATE SET role=EXCLUDED.role,status='active',updated_at=now()",[invitation.tenant_id,principal.id,invitation.role]);
        await tx.unsafe("UPDATE customer_tenant_invitations SET status='accepted',accepted_by_customer_principal_id=$1::uuid,accepted_at=now() WHERE id=$2::uuid",[principal.id,invitation.id]);
      }
      await tx.unsafe("UPDATE customer_principals SET email_verified=true,last_authenticated_at=now(),updated_at=now() WHERE id=$1::uuid",[principal.id]);
      await tx.unsafe("UPDATE customer_federated_identities SET email_at_link=$2,email_verified=true,hosted_domain=$3,picture_url=$4,last_authenticated_at=now(),updated_at=now() WHERE provider='google' AND provider_subject=$1",[identity.subject,identity.email,identity.hosted_domain,identity.picture_url]);
      const refreshed=(await tx.unsafe("SELECT id,email,display_name,status,session_version FROM customer_principals WHERE id=$1::uuid",[principal.id]))[0];
      const memberships=await tx.unsafe("SELECT m.tenant_id,m.role,m.status,t.public_id,t.slug,t.display_name,t.status AS tenant_status,t.authorization_version FROM customer_tenant_memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.customer_principal_id=$1::uuid AND m.status='active' AND t.status IN ('active','pending') ORDER BY t.display_name,t.id",[principal.id]);
      return {...refreshed,memberships,account_pending:memberships.length===0};
    });
  }

  async customerAuthLookup(email){
    email=String(email||"").trim().toLowerCase();
    if(!email||email.length>320)return null;
    const principals=await this.sql.unsafe(
      "SELECT p.id,p.email,p.display_name,p.status,p.preferred_locale,p.timezone,p.email_verified,p.session_version,"+
      " c.password_hash,c.status AS credential_status,c.failed_attempts,c.locked_until"+
      " FROM customer_principals p LEFT JOIN customer_password_credentials c ON c.customer_principal_id=p.id"+
      " WHERE p.email_normalized=$1 LIMIT 1",[email]
    );
    const principal=principals[0];if(!principal)return null;
    const memberships=await this.sql.unsafe(
      "SELECT m.tenant_id,m.role,m.status,t.public_id,t.slug,t.display_name,t.status AS tenant_status,t.authorization_version"+
      " FROM customer_tenant_memberships m JOIN tenants t ON t.id=m.tenant_id"+
      " WHERE m.customer_principal_id=$1::uuid AND m.status='active' AND t.status IN ('active','pending')"+
      " ORDER BY t.display_name,t.id",[principal.id]
    );
    return {...principal,memberships};
  }

  async recordCustomerAuthFailure(principalId){
    if(!principalId)return;
    await this.sql.unsafe(
      "UPDATE customer_password_credentials SET failed_attempts=failed_attempts+1,last_failed_at=now(),"+
      " locked_until=CASE WHEN failed_attempts+1>=5 THEN now()+interval '15 minutes' ELSE locked_until END,updated_at=now()"+
      " WHERE customer_principal_id=$1::uuid",[String(principalId)]
    );
  }

  async recordCustomerAuthSuccess(principalId){
    if(!principalId)return;
    await this.sql.begin(async tx=>{
      await tx.unsafe(
        "UPDATE customer_password_credentials SET failed_attempts=0,locked_until=NULL,last_failed_at=NULL,updated_at=now()"+
        " WHERE customer_principal_id=$1::uuid",[String(principalId)]
      );
      await tx.unsafe(
        "UPDATE customer_principals SET last_authenticated_at=now(),updated_at=now() WHERE id=$1::uuid",[String(principalId)]
      );
    });
  }

  async updateCustomerPassword(principalId,passwordHash){
    if(!principalId||String(passwordHash||"").length<20)throw problem(400,"INVALID_PASSWORD_HASH");
    const rows=await this.sql.unsafe(
      "UPDATE customer_password_credentials SET password_hash=$2,status='active',failed_attempts=0,locked_until=NULL,last_failed_at=NULL,password_changed_at=now(),updated_at=now()"+
      " WHERE customer_principal_id=$1::uuid RETURNING customer_principal_id",
      [String(principalId),String(passwordHash)]
    );
    if(!rows[0])throw problem(404,"CUSTOMER_CREDENTIAL_NOT_FOUND");
    return {ok:true};
  }

  async customerSessionContext(actor){
    if(!actor?.sub||!actor?.tenant_id)throw problem(401,"CUSTOMER_AUTH_REQUIRED");
    const rows=await this.sql.unsafe(
      "SELECT p.id,p.email,p.display_name,p.status,p.preferred_locale,p.timezone,p.email_verified,p.session_version,"+
      " m.tenant_id,m.role AS customer_role,m.status AS membership_status,m.permission_grants,m.permission_denials,t.public_id AS tenant_public_id,t.slug,t.display_name AS tenant_name,"+
      " t.status AS tenant_status,t.authorization_version,t.default_currency,t.country_code"+
      " FROM customer_principals p JOIN customer_tenant_memberships m ON m.customer_principal_id=p.id"+
      " JOIN tenants t ON t.id=m.tenant_id WHERE p.id=$1::uuid AND m.tenant_id=$2 LIMIT 1",
      [String(actor.sub),Number(actor.tenant_id)]
    );
    const row=rows[0];
    if(!row||row.status!=="active"||row.membership_status!=="active"||!["active","pending"].includes(row.tenant_status))throw problem(401,"CUSTOMER_SESSION_REVOKED");
    if(Number(row.session_version)!==Number(actor.session_version)||Number(row.authorization_version)!==Number(actor.authorization_version))throw problem(401,"CUSTOMER_SESSION_STALE");
    if(String(row.customer_role)!==String(actor.customer_role))throw problem(401,"CUSTOMER_SESSION_STALE");
    return row;
  }

  async createCustomerPortalInvitation(publicId,input={},tokenHash){
    publicId=String(publicId||"").trim();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(publicId))throw problem(400,"INVALID_TENANT_PUBLIC_ID");
    const email=String(input.email||"").trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>320)throw problem(400,"INVALID_CUSTOMER_EMAIL");
    const role=String(input.role||"readonly").trim().toLowerCase();
    if(!["owner","admin","finance","operator","analyst","readonly"].includes(role))throw problem(400,"INVALID_CUSTOMER_ROLE");
    if(!/^[a-f0-9]{64}$/.test(String(tokenHash||"")))throw problem(400,"INVALID_INVITATION_TOKEN_HASH");
    const ttlHours=Math.max(1,Math.min(168,Number(input.expires_in_hours)||72));
    return this.sql.begin(async tx=>{
      const tenants=await tx.unsafe("SELECT id,public_id,display_name,tenant_type,status FROM tenants WHERE public_id=$1::uuid FOR UPDATE",[publicId]);
      const tenant=tenants[0];if(!tenant)throw problem(404,"TENANT_NOT_FOUND");
      if(tenant.tenant_type==="internal")throw problem(409,"INTERNAL_TENANT_PROTECTED");
      if(tenant.status==="closed")throw problem(409,"TENANT_CLOSED");
      await tx.unsafe(
        "UPDATE customer_tenant_invitations SET status='revoked' WHERE tenant_id=$1 AND email_normalized=$2 AND status='pending'",
        [tenant.id,email]
      );
      const rows=await tx.unsafe(
        "INSERT INTO customer_tenant_invitations(tenant_id,email,role,token_hash,status,expires_at)"+
        " VALUES($1,$2,$3,$4,'pending',now()+make_interval(hours=>$5))"+
        " RETURNING id,tenant_id,email,role,status,expires_at,created_at",
        [tenant.id,email,role,String(tokenHash),ttlHours]
      );
      return {...rows[0],tenant_public_id:tenant.public_id,tenant_name:tenant.display_name};
    });
  }

  async activateCustomerPortalInvitation(tokenHash,displayName,passwordHash){
    if(!/^[a-f0-9]{64}$/.test(String(tokenHash||"")))throw problem(400,"INVALID_INVITATION_TOKEN");
    displayName=String(displayName||"").trim();
    if(!displayName||displayName.length>160)throw problem(400,"INVALID_CUSTOMER_NAME");
    if(String(passwordHash||"").length<20)throw problem(400,"INVALID_PASSWORD_HASH");
    return this.sql.begin(async tx=>{
      const invitations=await tx.unsafe(
        "SELECT i.id,i.tenant_id,i.email,i.role,i.status,i.expires_at,t.public_id,t.display_name AS tenant_name,t.status AS tenant_status,t.authorization_version"+
        " FROM customer_tenant_invitations i JOIN tenants t ON t.id=i.tenant_id"+
        " WHERE i.token_hash=$1 FOR UPDATE",[String(tokenHash)]
      );
      const inv=invitations[0];if(!inv)throw problem(404,"INVITATION_NOT_FOUND");
      if(inv.status!=="pending")throw problem(409,"INVITATION_NOT_PENDING");
      if(Date.parse(inv.expires_at)<=Date.now())throw problem(410,"INVITATION_EXPIRED");
      if(inv.tenant_status!=="active"&&inv.tenant_status!=="pending")throw problem(409,"TENANT_NOT_ACTIVE");
      let principals=await tx.unsafe(
        "SELECT id,email,display_name,status,session_version FROM customer_principals WHERE email_normalized=lower(btrim($1)) FOR UPDATE",[inv.email]
      );
      if(principals[0]){
        const credential=await tx.unsafe("SELECT customer_principal_id FROM customer_password_credentials WHERE customer_principal_id=$1::uuid",[principals[0].id]);
        if(credential.length)throw problem(409,"CUSTOMER_ACCOUNT_EXISTS");
        if(principals[0].status!=="active"&&principals[0].status!=="pending")throw problem(409,"CUSTOMER_ACCOUNT_DISABLED");
        await tx.unsafe("UPDATE customer_principals SET display_name=$1,status='active',updated_at=now() WHERE id=$2::uuid",[displayName,principals[0].id]);
      }else{
        principals=await tx.unsafe(
          "INSERT INTO customer_principals(email,display_name,status,email_verified) VALUES($1,$2,'active',false)"+
          " RETURNING id,email,display_name,status,session_version",[inv.email,displayName]
        );
      }
      const principal=principals[0];
      await tx.unsafe(
        "INSERT INTO customer_password_credentials(customer_principal_id,password_hash,status) VALUES($1::uuid,$2,'active')",
        [principal.id,String(passwordHash)]
      );
      await tx.unsafe(
        "INSERT INTO customer_tenant_memberships(tenant_id,customer_principal_id,role,status) VALUES($1,$2::uuid,$3,'active')"+
        " ON CONFLICT(tenant_id,customer_principal_id) DO UPDATE SET role=EXCLUDED.role,status='active',updated_at=now()",
        [inv.tenant_id,principal.id,inv.role]
      );
      await tx.unsafe(
        "UPDATE customer_tenant_invitations SET status='accepted',accepted_by_customer_principal_id=$1::uuid,accepted_at=now() WHERE id=$2::uuid",
        [principal.id,inv.id]
      );
      const context=await tx.unsafe(
        "SELECT p.id,p.email,p.display_name,p.session_version,m.role AS customer_role,t.id AS tenant_id,t.public_id AS tenant_public_id,"+
        " t.display_name AS tenant_name,t.authorization_version FROM customer_principals p"+
        " JOIN customer_tenant_memberships m ON m.customer_principal_id=p.id"+
        " JOIN tenants t ON t.id=m.tenant_id WHERE p.id=$1::uuid AND t.id=$2",
        [principal.id,inv.tenant_id]
      );
      return context[0];
    });
  }

  async customerPortalUsers(publicId){
    publicId=String(publicId||"").trim();
    const rows=await this.readSql.unsafe(
      "SELECT p.id,p.email,p.display_name,p.status,p.email_verified,p.last_authenticated_at,m.role,m.status AS membership_status,m.joined_at"+
      " FROM tenants t JOIN customer_tenant_memberships m ON m.tenant_id=t.id JOIN customer_principals p ON p.id=m.customer_principal_id"+
      " WHERE t.public_id=$1::uuid AND t.tenant_type<>'internal' ORDER BY p.display_name,p.email",[publicId]
    );
    return rows;
  }

  async customerTeam(tenantId){
    const id=Number(tenantId);
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_ID");
    return this.withTenantReadContext(id,async tx=>{
      const [members,invitations]=await Promise.all([
        tx.unsafe(
          "SELECT p.id,p.email,p.display_name,p.email_verified,p.last_authenticated_at,m.role,m.status AS membership_status,m.joined_at,m.updated_at"+
          " FROM customer_tenant_memberships m JOIN customer_principals p ON p.id=m.customer_principal_id"+
          " WHERE m.tenant_id=$1 ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,p.display_name,p.email",[id]
        ),
        tx.unsafe(
          "SELECT id,email,role,status,expires_at,created_at FROM customer_tenant_invitations"+
          " WHERE tenant_id=$1 AND status='pending' AND expires_at>now() ORDER BY created_at DESC,id DESC",[id]
        )
      ]);
      return {members,invitations};
    });
  }

  async createCustomerTeamInvitation(tenantId,input={},tokenHash,actorPrincipalId){
    const id=Number(tenantId),email=String(input.email||"").trim().toLowerCase(),role=String(input.role||"readonly").trim().toLowerCase();
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_ID");
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>320)throw problem(400,"INVALID_CUSTOMER_EMAIL");
    if(!["owner","admin","finance","operator","analyst","readonly"].includes(role))throw problem(400,"INVALID_CUSTOMER_ROLE");
    if(!/^[a-f0-9]{64}$/.test(String(tokenHash||"")))throw problem(400,"INVALID_INVITATION_TOKEN_HASH");
    const actor=String(actorPrincipalId||"");
    if(!/^[0-9a-f-]{36}$/i.test(actor))throw problem(400,"INVALID_CUSTOMER_PRINCIPAL_ID");
    const ttlHours=Math.max(1,Math.min(168,Number(input.expires_in_hours)||72));
    return this.sql.begin(async tx=>{
      const tenant=(await tx.unsafe("SELECT id,tenant_type,status FROM tenants WHERE id=$1 FOR UPDATE",[id]))[0];
      if(!tenant)throw problem(404,"TENANT_NOT_FOUND");
      if(tenant.tenant_type==="internal")throw problem(409,"INTERNAL_TENANT_PROTECTED");
      if(tenant.status==="closed")throw problem(409,"TENANT_CLOSED");
      const existing=(await tx.unsafe(
        "SELECT m.customer_principal_id FROM customer_tenant_memberships m JOIN customer_principals p ON p.id=m.customer_principal_id"+
        " WHERE m.tenant_id=$1 AND p.email_normalized=$2 AND m.status IN ('active','suspended') LIMIT 1",[id,email]
      ))[0];
      if(existing)throw problem(409,"CUSTOMER_ALREADY_MEMBER");
      const superseded=await tx.unsafe("UPDATE customer_tenant_invitations SET status='revoked' WHERE tenant_id=$1 AND email_normalized=$2 AND status='pending' RETURNING id,email,role",[id,email]);
      for(const previous of superseded)await tx.unsafe(
        "INSERT INTO customer_tenant_access_events(tenant_id,event_type,invitation_id,actor_customer_principal_id,previous_role,new_role,previous_status,new_status,details)"+
        " VALUES($1,'invitation_revoked',$2::uuid,$3::uuid,$4,$4,'pending','revoked',$5::jsonb)",
        [id,previous.id,actor,previous.role,JSON.stringify({email:previous.email,reason:"superseded"})]
      );
      const row=(await tx.unsafe(
        "INSERT INTO customer_tenant_invitations(tenant_id,email,role,token_hash,status,expires_at,invited_by_customer_principal_id)"+
        " VALUES($1,$2,$3,$4,'pending',now()+make_interval(hours=>$5),$6::uuid)"+
        " RETURNING id,email,role,status,expires_at,created_at",
        [id,email,role,String(tokenHash),ttlHours,actor]
      ))[0];
      await tx.unsafe(
        "INSERT INTO customer_tenant_access_events(tenant_id,event_type,invitation_id,actor_customer_principal_id,new_role,new_status,details)"+
        " VALUES($1,'invitation_created',$2::uuid,$3::uuid,$4,'pending',$5::jsonb)",
        [id,row.id,actor,role,JSON.stringify({email})]
      );
      return row;
    });
  }

  async updateCustomerTeamMember(tenantId,principalId,input={},actorPrincipalId){
    const id=Number(tenantId),target=String(principalId||""),actor=String(actorPrincipalId||"");
    const role=String(input.role||"").trim().toLowerCase(),status=String(input.status||"").trim().toLowerCase();
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_ID");
    if(!/^[0-9a-f-]{36}$/i.test(target)||!/^[0-9a-f-]{36}$/i.test(actor))throw problem(400,"INVALID_CUSTOMER_PRINCIPAL_ID");
    if(!["owner","admin","finance","operator","analyst","readonly"].includes(role))throw problem(400,"INVALID_CUSTOMER_ROLE");
    if(!["active","suspended","revoked"].includes(status))throw problem(400,"INVALID_CUSTOMER_MEMBERSHIP_STATUS");
    if(target===actor)throw problem(409,"SELF_ACCESS_CHANGE_FORBIDDEN");
    return this.sql.begin(async tx=>{
      const tenant=(await tx.unsafe("SELECT id,tenant_type,status FROM tenants WHERE id=$1 FOR UPDATE",[id]))[0];
      if(!tenant)throw problem(404,"TENANT_NOT_FOUND");
      if(tenant.tenant_type==="internal")throw problem(409,"INTERNAL_TENANT_PROTECTED");
      const actorMembership=(await tx.unsafe(
        "SELECT role,status FROM customer_tenant_memberships WHERE tenant_id=$1 AND customer_principal_id=$2::uuid FOR UPDATE",[id,actor]
      ))[0];
      if(!actorMembership||actorMembership.status!=="active")throw problem(403,"CUSTOMER_PERMISSION_DENIED");
      const current=(await tx.unsafe(
        "SELECT m.customer_principal_id,p.email,p.display_name,m.role,m.status AS membership_status FROM customer_tenant_memberships m"+
        " JOIN customer_principals p ON p.id=m.customer_principal_id WHERE m.tenant_id=$1 AND m.customer_principal_id=$2::uuid FOR UPDATE",[id,target]
      ))[0];
      if(!current)throw problem(404,"CUSTOMER_TEAM_MEMBER_NOT_FOUND");
      if((current.role==="owner"||role==="owner")&&actorMembership.role!=="owner")throw problem(403,"CUSTOMER_OWNER_REQUIRED");
      if(current.role==="owner"&&current.membership_status==="active"&&(role!=="owner"||status!=="active")){
        const owners=(await tx.unsafe(
          "SELECT count(*)::int AS count FROM customer_tenant_memberships WHERE tenant_id=$1 AND role='owner' AND status='active'",[id]
        ))[0];
        if(Number(owners?.count||0)<=1)throw problem(409,"LAST_CUSTOMER_OWNER_REQUIRED");
      }
      if(current.role===role&&current.membership_status===status)return {...current,role,membership_status:status};
      const updated=(await tx.unsafe(
        "UPDATE customer_tenant_memberships SET role=$3,status=$4,updated_at=now()"+
        " WHERE tenant_id=$1 AND customer_principal_id=$2::uuid"+
        " RETURNING customer_principal_id,role,status AS membership_status,joined_at,updated_at",
        [id,target,role,status]
      ))[0];
      if(current.role!==role)await tx.unsafe(
        "INSERT INTO customer_tenant_access_events(tenant_id,event_type,target_customer_principal_id,actor_customer_principal_id,previous_role,new_role,previous_status,new_status)"+
        " VALUES($1,'member_role_changed',$2::uuid,$3::uuid,$4,$5,$6,$7)",
        [id,target,actor,current.role,role,current.membership_status,status]
      );
      if(current.membership_status!==status)await tx.unsafe(
        "INSERT INTO customer_tenant_access_events(tenant_id,event_type,target_customer_principal_id,actor_customer_principal_id,previous_role,new_role,previous_status,new_status)"+
        " VALUES($1,'member_status_changed',$2::uuid,$3::uuid,$4,$5,$6,$7)",
        [id,target,actor,current.role,role,current.membership_status,status]
      );
      const authorization=(await tx.unsafe("SELECT authorization_version FROM tenants WHERE id=$1",[id]))[0];
      return {...updated,email:current.email,display_name:current.display_name,authorization_version:Number(authorization?.authorization_version||0)};
    });
  }

  async revokeCustomerTeamInvitation(tenantId,invitationId,actorPrincipalId){
    const id=Number(tenantId),invite=String(invitationId||""),actor=String(actorPrincipalId||"");
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_ID");
    if(!/^[0-9a-f-]{36}$/i.test(invite)||!/^[0-9a-f-]{36}$/i.test(actor))throw problem(400,"INVALID_CUSTOMER_INVITATION_ID");
    return this.sql.begin(async tx=>{
      const current=(await tx.unsafe(
        "SELECT id,email,role,status FROM customer_tenant_invitations WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE",[id,invite]
      ))[0];
      if(!current)throw problem(404,"CUSTOMER_INVITATION_NOT_FOUND");
      if(current.status!=="pending")throw problem(409,"CUSTOMER_INVITATION_NOT_PENDING");
      const actorMembership=(await tx.unsafe(
        "SELECT role,status FROM customer_tenant_memberships WHERE tenant_id=$1 AND customer_principal_id=$2::uuid FOR UPDATE",[id,actor]
      ))[0];
      if(!actorMembership||actorMembership.status!=="active")throw problem(403,"CUSTOMER_PERMISSION_DENIED");
      if(current.role==="owner"&&actorMembership.role!=="owner")throw problem(403,"CUSTOMER_OWNER_REQUIRED");
      const updated=(await tx.unsafe(
        "UPDATE customer_tenant_invitations SET status='revoked' WHERE tenant_id=$1 AND id=$2::uuid RETURNING id,email,role,status,expires_at,created_at",
        [id,invite]
      ))[0];
      await tx.unsafe(
        "INSERT INTO customer_tenant_access_events(tenant_id,event_type,invitation_id,actor_customer_principal_id,previous_role,new_role,previous_status,new_status,details)"+
        " VALUES($1,'invitation_revoked',$2::uuid,$3::uuid,$4,$4,'pending','revoked',$5::jsonb)",
        [id,invite,actor,current.role,JSON.stringify({email:current.email})]
      );
      return updated;
    });
  }

  async customerBillingPreparation(tenantId){
    const id=Number(tenantId);
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_ID");
    return this.withTenantReadContext(id,async tx=>{
      const tenant=(await tx.unsafe(
        "SELECT id,public_id,display_name,legal_name,tenant_type,status,country_code,billing_email,preferred_locale,default_currency,timezone FROM tenants WHERE id=$1 LIMIT 1",
        [id]
      ))[0];
      if(!tenant)throw problem(404,"TENANT_NOT_FOUND");
      if(tenant.tenant_type==="internal")throw problem(409,"INTERNAL_TENANT_BILLING_EXEMPT");
      const billingDefault=resolveBillingCurrency(tenant.country_code);
      const billingCurrency=billingDefault?.currency||tenant.default_currency;
      const offer=(await tx.unsafe(
        "SELECT v.id AS price_version_id,p.plan_key,p.display_name AS plan_name,v.market_id,m.country_code AS market,v.currency,v.amount_minor,v.tax_behavior,"+
        " v.billing_interval,v.interval_count,v.provider,v.provider_price_reference,v.effective_from,v.effective_to FROM service_plan_price_versions v"+
        " JOIN service_plans p ON p.id=v.service_plan_id LEFT JOIN operating_markets m ON m.id=v.market_id"+
        " WHERE p.plan_key='external-sva-access' AND p.status='active' AND v.currency=$1"+
        " AND (v.market_id IS NULL OR m.country_code=$2) AND v.effective_from<=now() AND (v.effective_to IS NULL OR v.effective_to>now())"+
        " ORDER BY (v.market_id IS NOT NULL) DESC,v.effective_from DESC LIMIT 1",
        [billingCurrency,tenant.country_code]
      ))[0]||null;
      const referenceOffer=offer?offer:(await tx.unsafe(
        "SELECT v.id AS price_version_id,p.plan_key,p.display_name AS plan_name,v.currency,v.amount_minor,v.tax_behavior,v.billing_interval,v.interval_count,v.provider,v.provider_price_reference,v.effective_from,v.effective_to"+
        " FROM service_plan_price_versions v JOIN service_plans p ON p.id=v.service_plan_id"+
        " WHERE p.plan_key='external-sva-access' AND p.status='active' AND v.market_id IS NULL AND v.currency='EUR'"+
        " AND v.effective_from<=now() AND (v.effective_to IS NULL OR v.effective_to>now()) ORDER BY v.effective_from DESC LIMIT 1"
      ))[0]||null;
      const subscription=(await tx.unsafe(
        "SELECT s.id,s.status,s.billing_currency,s.current_period_start,s.current_period_end,s.cancel_at_period_end,s.last_payment_status,"+
        " s.billing_provider,s.provider_customer_reference,s.provider_subscription_reference,s.price_version_id,"+
        " r.recovery_state,r.first_failed_at,r.last_failed_at,r.grace_until,r.recovery_deadline,r.next_retry_at,r.attempt_count,r.last_invoice_reference,r.recovered_at"+
        " FROM tenant_subscriptions s JOIN service_plans p ON p.id=s.service_plan_id"+
        " LEFT JOIN subscription_recovery_states r ON r.subscription_id=s.id AND r.tenant_id=s.tenant_id"+
        " WHERE s.tenant_id=$1 AND p.plan_key='external-sva-access' ORDER BY s.created_at DESC,s.id DESC LIMIT 1",
        [id]
      ))[0]||null;
      const access=(await tx.unsafe("SELECT pgi_tenant_has_premium_call_access($1,NULL,now()) AS allowed",[id]))[0];
      const recovery=subscription?.recovery_state?{
        state:subscription.recovery_state,
        first_failed_at:subscription.first_failed_at||null,
        last_failed_at:subscription.last_failed_at||null,
        grace_until:subscription.grace_until||null,
        recovery_deadline:subscription.recovery_deadline||null,
        next_retry_at:subscription.next_retry_at||null,
        attempt_count:Number(subscription.attempt_count||0),
        last_invoice_reference:subscription.last_invoice_reference||null,
        recovered_at:subscription.recovered_at||null,
        grace_active:Boolean(subscription.grace_until&&Date.parse(subscription.grace_until)>Date.now()&&["grace","retrying","action_required"].includes(String(subscription.recovery_state))),
        action_required:String(subscription.recovery_state)==="action_required",
        service_suspended:String(subscription.recovery_state)==="suspended"||Boolean(subscription.grace_until&&Date.parse(subscription.grace_until)<=Date.now()&&["grace","retrying","action_required"].includes(String(subscription.recovery_state)))
      }:null;
      return {
        tenant:{id:tenant.public_id,name:tenant.display_name,billing_email:tenant.billing_email,country_code:tenant.country_code,locale:tenant.preferred_locale,currency:billingCurrency,timezone:tenant.timezone,status:tenant.status},
        offer,
        reference_offer:referenceOffer,
        pricing_state:offer?"local_price_ready":referenceOffer?"local_conversion_required":"unavailable",
        subscription,
        recovery,
        premium_call_access:Boolean(access?.allowed),
        billing_currency:{currency:billingCurrency,source:billingDefault?.source||"tenant_default",catalog_version:billingDefault?.catalog_version||null,accepted_currencies:billingDefault?.accepted_currencies||[billingCurrency],local_price_configured:Boolean(offer)},
        checkout_prefill:{email:tenant.billing_email||null,locale:tenant.preferred_locale,country_code:tenant.country_code,currency:billingCurrency},
        return_paths:{success:"client.html?billing=success",cancel:"client.html?billing=cancelled"}
      };
    });
  }

  async customerPortabilityRequests(tenantId){
    const id=Number(tenantId);
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_ID");
    return this.withTenantReadContext(id,async tx=>tx.unsafe(
      "SELECT id,country_code,requested_e164,display_number,service_family,current_operator_name,current_operator_reference,"+
      " account_holder_name,desired_port_date,status,ownership_status,operator_portability_reference,scheduled_at,completed_at,rejection_reason,"+
      " tariff_code,service_rate_ttc_per_min::float8,currency,tariff_verification_status,tariff_verified_at,"+
      " rio_last4,rio_validation_status,rio_validated_at,source_contract_transfer_mode,source_contract_liability_acknowledged,"+
      " automation_state,automation_last_error,automation_last_sync_at,operator_status,created_at,updated_at"+
      " FROM tenant_scoped_portability_requests_v4 ORDER BY created_at DESC,id DESC LIMIT 50"
    ));
  }

  async createCustomerPortabilityRequest(tenantId,input={}){
    const id=Number(tenantId);
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_ID");
    const country=String(input.country_code||"").trim().toUpperCase();
    if(!/^[A-Z]{2}$/.test(country))throw problem(400,"INVALID_COUNTRY_CODE");
    const e164=normalizePortabilityNumber(input.number,country);
    if(input.source_contract_liability_acknowledged!==true)throw problem(400,"PORTABILITY_SOURCE_CONTRACT_ACK_REQUIRED");
    const portabilitySecret=String(this.config.portabilitySecretKey||this.config.callerHashKey||this.config.sessionSecret||"");
    let rio=null,rioCiphertext=null,rioHash=null,rioLast4=null,rioStatus="pending";
    if(country==="FR"){
      if(!String(input.rio||"").trim())throw problem(400,"PORTABILITY_RIO_REQUIRED");
      if(portabilitySecret.length<32)throw problem(503,"PORTABILITY_SECRET_UNAVAILABLE");
      try{rio=normalizeFrenchSvaRio(input.rio,e164);}catch{throw problem(400,"INVALID_PORTABILITY_RIO");}
      rioCiphertext=encryptPortabilityCredential(rio,portabilitySecret);
      rioHash=rioFingerprint(rio,e164,portabilitySecret);
      rioLast4=rio.slice(-4);
      rioStatus="verified";
    }
    const operatorName=optionalText(input.current_operator_name,160);
    const operatorReference=optionalText(input.current_operator_reference,200);
    const holderName=optionalText(input.account_holder_name,200);
    const tariffCode=optionalText(input.tariff_code,80);
    const rate=input.service_rate_ttc_per_min==null||input.service_rate_ttc_per_min===""?null:Number(input.service_rate_ttc_per_min);
    if(rate!=null&&(!Number.isFinite(rate)||rate<0||rate>10000))throw problem(400,"INVALID_PORTABILITY_TARIFF");
    const serviceFamily=String(input.service_family||"premium_rate").trim().toLowerCase();
    const desiredDate=input.desired_port_date?dateOnlyValue(input.desired_port_date,"desired_port_date"):null;
    if(!["premium_rate","shared_cost","freephone","other"].includes(serviceFamily))throw problem(400,"INVALID_SERVICE_FAMILY");
    if(input.authorization_confirmed!==true||input.number_owner_confirmed!==true)throw problem(400,"PORTABILITY_AUTHORIZATION_REQUIRED");
    const result=await this.sql.begin(async tx=>{
      await tx.unsafe("SELECT pg_advisory_xact_lock(hashtext($1))",["portability:"+e164]);
      const tenant=(await tx.unsafe("SELECT id,status,country_code,default_currency FROM tenants WHERE id=$1 AND tenant_type<>'internal' LIMIT 1",[id]))[0];
      if(!tenant)throw problem(404,"TENANT_NOT_FOUND");
      if(tenant.status==="closed")throw problem(409,"TENANT_CLOSED");
      const market=(await tx.unsafe("SELECT id,default_currency FROM operating_markets WHERE country_code=$1 LIMIT 1",[country]))[0]||null;
      const currency=String(market?.default_currency||tenant.default_currency||"EUR").toUpperCase();
      const existingNumber=(await tx.unsafe("SELECT id,tenant_id FROM sva_numbers WHERE e164=$1 LIMIT 1",[e164]))[0]||null;
      if(existingNumber)throw problem(409,Number(existingNumber.tenant_id)===id?"NUMBER_ALREADY_MANAGED":"PORTABILITY_NUMBER_UNAVAILABLE");
      const existing=(await tx.unsafe(
        "SELECT id FROM tenant_portability_requests WHERE requested_e164=$1 AND status IN ('submitted','awaiting_documents','eligibility_check','operator_pending','scheduled') LIMIT 1",
        [e164]
      ))[0];
      if(existing)throw problem(409,"PORTABILITY_ALREADY_REQUESTED");
      const rows=await tx.unsafe(
        "INSERT INTO tenant_portability_requests(tenant_id,country_code,requested_e164,display_number,service_family,current_operator_name,current_operator_reference,account_holder_name,desired_port_date,authorization_confirmed,number_owner_confirmed,rio_ciphertext,rio_fingerprint,rio_last4,rio_validation_status,rio_validated_at,source_contract_transfer_mode,source_contract_liability_acknowledged,tariff_code,service_rate_ttc_per_min,currency,metadata)"+
        " VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::date,true,true,$10,$11,$12,$13,CASE WHEN $13=\'verified\' THEN now() ELSE NULL END,\'none\',true,$14,$15,$16,$17::jsonb)"+
        " RETURNING id,country_code,requested_e164,display_number,service_family,current_operator_name,current_operator_reference,account_holder_name,desired_port_date,status,ownership_status,tariff_code,service_rate_ttc_per_min::float8,currency,tariff_verification_status,rio_last4,rio_validation_status,rio_validated_at,source_contract_transfer_mode,source_contract_liability_acknowledged,created_at",
        [id,country,e164,String(input.number||"").trim().slice(0,40)||e164,serviceFamily,operatorName,operatorReference,holderName,desiredDate,rioCiphertext,rioHash,rioLast4,rioStatus,tariffCode,rate,currency,
         JSON.stringify({source:"customer_portal",original_number:String(input.number||"").trim().slice(0,40),source_contract_transfer_mode:"none"})]
      );
      const request=rows[0];
      await tx.unsafe(
        "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,NULL,'portability.request','tenant_portability_request',$2,$3::jsonb)",
        [id,String(request.id),JSON.stringify({requested_e164:e164,country_code:country,service_family:serviceFamily,declared_rate_ttc_per_min:rate,currency,rio_verified:rioStatus==="verified",source_contract_transfer_mode:"none"})]
      );
      await tx.unsafe(
        "INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload) VALUES($1,'portability.requested','tenant_portability_request',$2,$3::jsonb)",
        [id,String(request.id),JSON.stringify({requested_e164:e164,country_code:country,rio_verified:rioStatus==="verified",source_contract_transfer_mode:"none"})]
      );
      await tx.unsafe(
        "INSERT INTO work_queue(queue_name,tenant_id,dedupe_key,priority,payload,available_at,max_attempts)"+
        " VALUES('portability',$1,$2,20,$3::jsonb,now(),20)"+
        " ON CONFLICT(queue_name,dedupe_key) WHERE dedupe_key IS NOT NULL AND completed_at IS NULL AND failed_at IS NULL"+
        " DO UPDATE SET available_at=LEAST(work_queue.available_at,EXCLUDED.available_at)",
        [id,"portability:"+request.id+":auto",JSON.stringify({request_id:Number(request.id),action:"auto"})]
      );
      return request;
    });
    this.eventBus.publish("portability.requested",{tenant_id:id,request_id:Number(result.id),requested_e164:e164,country_code:country});
    return result;
  }

  async cancelCustomerPortabilityRequest(tenantId,requestId){
    const tenant=Number(tenantId),id=Number(requestId);
    if(!Number.isInteger(tenant)||tenant<=0||!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_PORTABILITY_REQUEST");
    const result=await this.sql.begin(async tx=>{
      const rows=await tx.unsafe(
        "UPDATE tenant_portability_requests SET status='cancelled',updated_at=now()"+
        " WHERE id=$1 AND tenant_id=$2 AND status IN ('submitted','awaiting_documents','eligibility_check','operator_pending')"+
        " RETURNING id,tenant_id,requested_e164,status,updated_at",
        [id,tenant]
      );
      const request=rows[0];if(!request)throw problem(409,"PORTABILITY_NOT_CANCELLABLE");
      await tx.unsafe(
        "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,NULL,'portability.cancel','tenant_portability_request',$2,$3::jsonb)",
        [tenant,String(id),JSON.stringify({requested_e164:request.requested_e164})]
      );
      const operatorState=(await tx.unsafe(
        "SELECT operator_portability_reference FROM tenant_portability_requests WHERE id=$1 LIMIT 1",
        [id]
      ))[0]||null;
      if(operatorState?.operator_portability_reference){
        await tx.unsafe("UPDATE tenant_portability_requests SET automation_state='cancelling',automation_last_error=NULL,automation_next_at=now() WHERE id=$1",[id]);
        await tx.unsafe(
          "INSERT INTO work_queue(queue_name,tenant_id,dedupe_key,priority,payload,available_at,max_attempts)"+
          " VALUES('portability',$1,$2,10,$3::jsonb,now(),20)"+
          " ON CONFLICT(queue_name,dedupe_key) WHERE dedupe_key IS NOT NULL AND completed_at IS NULL AND failed_at IS NULL"+
          " DO UPDATE SET available_at=LEAST(work_queue.available_at,EXCLUDED.available_at)",
          [tenant,"portability:"+id+":cancel",JSON.stringify({request_id:id,action:"cancel"})]
        );
      }else{
        await tx.unsafe("UPDATE tenant_portability_requests SET automation_state='cancelled',automation_next_at=now()+interval '1 day' WHERE id=$1",[id]);
      }
      return request;
    });
    this.eventBus.publish("portability.cancelled",{tenant_id:tenant,request_id:id,requested_e164:result.requested_e164});
    return result;
  }

  async updatePortabilityRequest(requestId,input={},actor={}){
    const id=Number(requestId);
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_PORTABILITY_REQUEST");
    const status=String(input.status||"").trim().toLowerCase();
    const ownership=String(input.ownership_status||"").trim().toLowerCase();
    const operatorRef=optionalText(input.operator_portability_reference,200);
    const rejection=optionalText(input.rejection_reason,500);
    const scheduledAt=input.scheduled_at||null;
    const targetCarrierId=input.target_carrier_id==null||input.target_carrier_id===""?null:Number(input.target_carrier_id);
    const tariffCode=optionalText(input.tariff_code,80);
    const rate=input.service_rate_ttc_per_min==null||input.service_rate_ttc_per_min===""?null:Number(input.service_rate_ttc_per_min);
    const requestedTariffStatus=String(input.tariff_verification_status||"").trim().toLowerCase()||null;
    if(!["submitted","awaiting_documents","eligibility_check","operator_pending","scheduled","rejected","cancelled"].includes(status)){
      if(status==="ported")throw problem(409,"PORTABILITY_USE_COMPLETION_ENDPOINT");
      throw problem(400,"INVALID_PORTABILITY_STATUS");
    }
    if(!["pending","verified","rejected"].includes(ownership))throw problem(400,"INVALID_OWNERSHIP_STATUS");
    if(requestedTariffStatus&&!["pending","verified","rejected"].includes(requestedTariffStatus))throw problem(400,"INVALID_TARIFF_VERIFICATION_STATUS");
    if(scheduledAt&&!Number.isFinite(Date.parse(scheduledAt)))throw problem(400,"INVALID_PORTABILITY_SCHEDULE");
    if(targetCarrierId!=null&&(!Number.isInteger(targetCarrierId)||targetCarrierId<=0))throw problem(400,"INVALID_TARGET_CARRIER");
    if(rate!=null&&(!Number.isFinite(rate)||rate<0||rate>10000))throw problem(400,"INVALID_PORTABILITY_TARIFF");
    const actorId=numericActor(actor);
    const result=await this.sql.begin(async tx=>{
      const current=(await tx.unsafe("SELECT * FROM tenant_portability_requests WHERE id=$1 FOR UPDATE",[id]))[0];
      if(!current)throw problem(404,"PORTABILITY_REQUEST_NOT_FOUND");
      if(["ported","cancelled"].includes(current.status)&&current.status!==status)throw problem(409,"PORTABILITY_REQUEST_FINAL");
      if(targetCarrierId!=null){
        const carrier=(await tx.unsafe("SELECT id FROM carriers WHERE id=$1 AND kind='sva_host' AND enabled LIMIT 1",[targetCarrierId]))[0];
        if(!carrier)throw problem(409,"PORTABILITY_TARGET_CARRIER_UNAVAILABLE");
      }
      const tariffStatus=requestedTariffStatus||current.tariff_verification_status||"pending";
      const effectiveRate=rate==null?(current.service_rate_ttc_per_min==null?null:Number(current.service_rate_ttc_per_min)):rate;
      const effectiveTariffCode=tariffCode||current.tariff_code||null;
      const effectiveCarrierId=targetCarrierId==null?(current.target_carrier_id==null?null:Number(current.target_carrier_id)):targetCarrierId;
      const effectiveOperatorRef=operatorRef||current.operator_portability_reference||null;
      if(tariffStatus==="verified"&&(effectiveRate==null||!Number.isFinite(effectiveRate)||!current.currency))throw problem(409,"PORTABILITY_TARIFF_DETAILS_REQUIRED");
      if(tariffStatus==="verified"&&!effectiveTariffCode)throw problem(409,"PORTABILITY_TARIFF_CODE_REQUIRED");
      if(["operator_pending","scheduled"].includes(status)&&ownership!=="verified")throw problem(409,"PORTABILITY_OWNERSHIP_VERIFICATION_REQUIRED");
      if(["operator_pending","scheduled"].includes(status)&&current.source_contract_liability_acknowledged!==true)throw problem(409,"PORTABILITY_SOURCE_CONTRACT_ACK_REQUIRED");
      if(["operator_pending","scheduled"].includes(status)&&current.country_code==="FR"&&current.rio_validation_status!=="verified")throw problem(409,"PORTABILITY_RIO_VERIFICATION_REQUIRED");
      if(status==="scheduled"){
        if(!scheduledAt)throw problem(409,"PORTABILITY_SCHEDULE_REQUIRED");
        if(!effectiveCarrierId)throw problem(409,"PORTABILITY_TARGET_CARRIER_REQUIRED");
        if(!effectiveOperatorRef)throw problem(409,"PORTABILITY_OPERATOR_REFERENCE_REQUIRED");
        if(tariffStatus!=="verified")throw problem(409,"PORTABILITY_TARIFF_VERIFICATION_REQUIRED");
      }
      const rows=await tx.unsafe(
        "UPDATE tenant_portability_requests SET status=$2,ownership_status=$3,operator_portability_reference=COALESCE($4,operator_portability_reference),"+
        " scheduled_at=$5::timestamptz,rejection_reason=$6,target_carrier_id=COALESCE($7,target_carrier_id),tariff_code=COALESCE($8,tariff_code),"+
        " service_rate_ttc_per_min=COALESCE($9,service_rate_ttc_per_min),tariff_verification_status=$10,"+
        " tariff_verified_at=CASE WHEN $10='verified' THEN COALESCE(tariff_verified_at,now()) ELSE NULL END,"+
        " tariff_verified_by=CASE WHEN $10='verified' THEN COALESCE(tariff_verified_by,$11) ELSE NULL END,completed_at=NULL,updated_at=now()"+
        " WHERE id=$1 RETURNING *",
        [id,status,ownership,operatorRef,scheduledAt,rejection,targetCarrierId,tariffCode,rate,tariffStatus,actorId]
      );
      await tx.unsafe(
        "INSERT INTO tenant_control_events(tenant_id,actor_user_id,action,previous_status,new_status,reason,details)"+
        " VALUES($1,$2,'portability.status',$3,$4,$5,$6::jsonb)",
        [current.tenant_id,actorId,current.status,status,rejection,JSON.stringify({request_id:id,requested_e164:current.requested_e164,ownership_status:ownership,tariff_verification_status:tariffStatus,target_carrier_id:effectiveCarrierId,operator_reference:effectiveOperatorRef})]
      );
      await tx.unsafe(
        "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'portability.status','tenant_portability_request',$3,$4::jsonb)",
        [current.tenant_id,actorId,String(id),JSON.stringify({previous_status:current.status,status,ownership_status:ownership,tariff_verification_status:tariffStatus,service_rate_ttc_per_min:effectiveRate,currency:current.currency})]
      );
      return rows[0];
    });
    this.eventBus.publish("portability.changed",{tenant_id:Number(result.tenant_id),request_id:id,status:result.status,requested_e164:result.requested_e164});
    return result;
  }

  async completePortabilityRequest(requestId,input={},actor={}){
    const id=Number(requestId);
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_PORTABILITY_REQUEST");
    const actorId=numericActor(actor);
    const confirmationReference=optionalText(input.operator_portability_reference,200);
    const result=await this.sql.begin(async tx=>{
      const current=(await tx.unsafe("SELECT * FROM tenant_portability_requests WHERE id=$1 FOR UPDATE",[id]))[0];
      if(!current)throw problem(404,"PORTABILITY_REQUEST_NOT_FOUND");
      if(current.status==="ported"){
        const existing=(await tx.unsafe("SELECT id,e164,display_number,tariff_code,service_rate_ttc_per_min::float8,currency,status FROM sva_numbers WHERE id=$1",[current.sva_number_id]))[0]||null;
        return {request:current,number:existing,already_completed:true};
      }
      if(current.status!=="scheduled")throw problem(409,"PORTABILITY_NOT_SCHEDULED");
      if(current.ownership_status!=="verified")throw problem(409,"PORTABILITY_OWNERSHIP_VERIFICATION_REQUIRED");
      if(current.source_contract_liability_acknowledged!==true)throw problem(409,"PORTABILITY_SOURCE_CONTRACT_ACK_REQUIRED");
      if(current.country_code==="FR"&&current.rio_validation_status!=="verified")throw problem(409,"PORTABILITY_RIO_VERIFICATION_REQUIRED");
      if(current.tariff_verification_status!=="verified")throw problem(409,"PORTABILITY_TARIFF_VERIFICATION_REQUIRED");
      const rate=current.service_rate_ttc_per_min==null?null:Number(current.service_rate_ttc_per_min);
      if(rate==null||!Number.isFinite(rate)||rate<0)throw problem(409,"PORTABILITY_TARIFF_DETAILS_REQUIRED");
      if(current.service_family==="premium_rate"&&rate<=0)throw problem(409,"PORTABILITY_TARIFF_DETAILS_REQUIRED");
      if(!current.tariff_code)throw problem(409,"PORTABILITY_TARIFF_CODE_REQUIRED");
      if(!current.currency)throw problem(409,"PORTABILITY_TARIFF_DETAILS_REQUIRED");
      const targetCarrierId=Number(current.target_carrier_id);
      if(!Number.isInteger(targetCarrierId)||targetCarrierId<=0)throw problem(409,"PORTABILITY_TARGET_CARRIER_REQUIRED");
      const operatorRef=confirmationReference||current.operator_portability_reference;
      if(!operatorRef)throw problem(409,"PORTABILITY_OPERATOR_REFERENCE_REQUIRED");

      const tenant=(await tx.unsafe("SELECT id,display_name,status,tenant_type FROM tenants WHERE id=$1 FOR UPDATE",[current.tenant_id]))[0];
      if(!tenant||tenant.tenant_type==="internal")throw problem(409,"PORTABILITY_TENANT_INVALID");
      if(tenant.status!=="active")throw problem(409,"PORTABILITY_TENANT_NOT_ACTIVE");
      const market=(await tx.unsafe("SELECT id,country_code,status,default_currency FROM operating_markets WHERE country_code=$1 LIMIT 1",[current.country_code]))[0];
      if(!market||market.status!=="active")throw problem(409,"PORTABILITY_MARKET_NOT_ACTIVE");
      const kyc=(await tx.unsafe("SELECT status FROM tenant_kyc_profiles WHERE tenant_id=$1 LIMIT 1",[current.tenant_id]))[0];
      if(!kyc||kyc.status!=="verified")throw problem(409,"PORTABILITY_KYC_REQUIRED");
      const access=(await tx.unsafe("SELECT pgi_tenant_has_premium_call_access($1,$2,now()) AS allowed",[current.tenant_id,market.id]))[0];
      if(!access?.allowed)throw problem(402,"SVA_SUBSCRIPTION_REQUIRED");
      const payout=(await tx.unsafe("SELECT pgi_tenant_has_payout_terms($1,$2,NULL,now()) AS allowed",[current.tenant_id,market.id]))[0];
      if(!payout?.allowed)throw problem(409,"PORTABILITY_PAYOUT_TERMS_REQUIRED");

      const carrier=(await tx.unsafe("SELECT id,name FROM carriers WHERE id=$1 AND kind='sva_host' AND enabled LIMIT 1",[targetCarrierId]))[0];
      if(!carrier)throw problem(409,"PORTABILITY_TARGET_CARRIER_UNAVAILABLE");
      const commercialTerms=(await tx.unsafe(
        "SELECT id,payout_rate_ht_per_min::float8,mobile_deduction_ht_per_min::float8,minimum_payable_seconds,billing_increment_seconds,payout_rounding,settlement_delay_days"+
        " FROM carrier_contracts WHERE carrier_id=$1 AND sva_number_id IS NULL"+
        " AND valid_from<=COALESCE($2::timestamptz,now())::date"+
        " AND (valid_to IS NULL OR valid_to>=COALESCE($2::timestamptz,now())::date)"+
        " ORDER BY valid_from DESC,id DESC LIMIT 1",
        [targetCarrierId,current.scheduled_at]
      ))[0]||null;
      if(this.config.requireCarrierContract&&!commercialTerms)throw problem(409,"PORTABILITY_CARRIER_CONTRACT_REQUIRED");
      const route=(await tx.unsafe(
        "SELECT r.active_carrier_id,r.active_connection_id,cc.state AS connection_state FROM logical_carrier_routes r"+
        " LEFT JOIN carrier_connections cc ON cc.id=r.active_connection_id WHERE r.route_key='sva-primary' FOR UPDATE OF r",
        []
      ))[0];
      if(!route||Number(route.active_carrier_id)!==targetCarrierId)throw problem(409,"PORTABILITY_TARGET_ROUTE_NOT_ACTIVE");
      if(!["ready","active","standby"].includes(String(route.connection_state||"")))throw problem(409,"PORTABILITY_TARGET_ROUTE_NOT_READY");

      await tx.unsafe("SELECT pg_advisory_xact_lock(hashtext($1))",["portability-complete:"+current.requested_e164]);
      let number=(await tx.unsafe("SELECT id,e164,tenant_id FROM sva_numbers WHERE e164=$1 FOR UPDATE",[current.requested_e164]))[0]||null;
      if(number&&Number(number.tenant_id)!==Number(current.tenant_id))throw problem(409,"PORTABILITY_NUMBER_UNAVAILABLE");
      if(!number){
        number=(await tx.unsafe(
          "INSERT INTO sva_numbers(e164,display_number,tariff_code,service_rate_ttc_per_min,status,assigned_to_label,portability_status,activated_at,tenant_id,market_id,number_type,currency)"+
          " VALUES($1,$2,$3,$4,'active',$5,'completed',now(),$6,$7,$8,$9)"+
          " RETURNING id,e164,display_number,tariff_code,service_rate_ttc_per_min::float8,currency,status,tenant_id,market_id,number_type,activated_at",
          [current.requested_e164,current.display_number||current.requested_e164,current.tariff_code,rate,tenant.display_name,current.tenant_id,market.id,current.service_family,current.currency]
        ))[0];
      }else{
        number=(await tx.unsafe(
          "UPDATE sva_numbers SET display_number=COALESCE(NULLIF($2,''),display_number),tariff_code=$3,service_rate_ttc_per_min=$4,status='active',assigned_to_label=$5,portability_status='completed',activated_at=COALESCE(activated_at,now()),tenant_id=$6,market_id=$7,number_type=$8,currency=$9 WHERE id=$1"+
          " RETURNING id,e164,display_number,tariff_code,service_rate_ttc_per_min::float8,currency,status,tenant_id,market_id,number_type,activated_at",
          [number.id,current.display_number||current.requested_e164,current.tariff_code,rate,tenant.display_name,current.tenant_id,market.id,current.service_family,current.currency]
        ))[0];
      }

      let assignment=(await tx.unsafe("SELECT id,status FROM tenant_number_assignments WHERE tenant_id=$1 AND sva_number_id=$2 AND status<>'ended' ORDER BY id DESC LIMIT 1 FOR UPDATE",[current.tenant_id,number.id]))[0]||null;
      if(!assignment){
        assignment=(await tx.unsafe(
          "INSERT INTO tenant_number_assignments(tenant_id,sva_number_id,assignment_type,status,valid_from,tariff_code,commercial_terms,regulatory_assignor_carrier_id,upstream_assignment_reference,kyc_status)"+
          " VALUES($1,$2,'customer_service','active',now(),$3,$4::jsonb,$5,$6,'verified') RETURNING id,status,valid_from",
          [current.tenant_id,number.id,current.tariff_code,JSON.stringify({source:"portability",public_tariff_locked:true,service_rate_ttc_per_min:rate,currency:current.currency,portability_request_id:id}),targetCarrierId,operatorRef]
        ))[0];
      }else if(assignment.status!=="active"){
        assignment=(await tx.unsafe(
          "UPDATE tenant_number_assignments SET status='active',valid_from=COALESCE(valid_from,now()),tariff_code=$3,regulatory_assignor_carrier_id=$4,upstream_assignment_reference=$5,kyc_status='verified' WHERE id=$1 AND tenant_id=$2 RETURNING id,status,valid_from",
          [assignment.id,current.tenant_id,current.tariff_code,targetCarrierId,operatorRef]
        ))[0];
      }

      await tx.unsafe(
        "INSERT INTO number_carrier_assignments(sva_number_id,carrier_id,valid_from,assignment_status,portability_reference,portability_status,notes)"+
        " VALUES($1,$2,now(),'active',$3,'completed',$4)",
        [number.id,targetCarrierId,operatorRef,"Customer port-in request #"+id]
      );
      await tx.unsafe(
        "INSERT INTO number_portability_events(sva_number_id,from_carrier_id,to_carrier_id,portability_reference,requested_at,scheduled_at,activated_at,completed_at,status,validation,notes)"+
        " VALUES($1,NULL,$2,$3,$4,$5,now(),now(),'completed',$6::jsonb,$7)",
        [number.id,targetCarrierId,operatorRef,current.created_at,current.scheduled_at,JSON.stringify({ownership_verified:true,rio_verified:current.country_code!=="FR"||current.rio_validation_status==="verified",source_contract_transfer_mode:"none",tariff_verified:true,tariff_code:current.tariff_code,service_rate_ttc_per_min:rate,currency:current.currency,route_key:"sva-primary",route_carrier_id:targetCarrierId}),"Atomic customer port-in completion"]
      );
      const request=(await tx.unsafe(
        "UPDATE tenant_portability_requests SET status='ported',sva_number_id=$2,operator_portability_reference=$3,completed_at=now(),updated_at=now() WHERE id=$1 RETURNING *",
        [id,number.id,operatorRef]
      ))[0];
      await tx.unsafe(
        "INSERT INTO tenant_control_events(tenant_id,assignment_id,actor_user_id,action,previous_status,new_status,reason,details)"+
        " VALUES($1,$2,$3,'portability.complete',$4,'ported','Operator cutover confirmed',$5::jsonb)",
        [current.tenant_id,assignment.id,actorId,current.status,JSON.stringify({request_id:id,e164:current.requested_e164,target_carrier_id:targetCarrierId,operator_reference:operatorRef,tariff_code:current.tariff_code,service_rate_ttc_per_min:rate,currency:current.currency})]
      );
      await tx.unsafe(
        "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'portability.complete','tenant_portability_request',$3,$4::jsonb)",
        [current.tenant_id,actorId,String(id),JSON.stringify({sva_number_id:number.id,assignment_id:assignment.id,e164:current.requested_e164,target_carrier_id:targetCarrierId,operator_reference:operatorRef,tariff_preserved:true,service_rate_ttc_per_min:rate,currency:current.currency})]
      );
      await tx.unsafe(
        "INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload) VALUES($1,'portability.completed','tenant_portability_request',$2,$3::jsonb)",
        [current.tenant_id,String(id),JSON.stringify({sva_number_id:number.id,assignment_id:assignment.id,e164:current.requested_e164,target_carrier_id:targetCarrierId})]
      );
      return {request,number,assignment,carrier:{id:carrier.id,name:carrier.name},already_completed:false};
    });
    this.eventBus.publish("portability.completed",{tenant_id:Number(result.request.tenant_id),request_id:id,sva_number_id:Number(result.number?.id),requested_e164:result.request.requested_e164});
    return result;
  }

  async customerExperiencePreferences(tenantId,principalId){
    const id=Number(tenantId),principal=String(principalId||"");
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_ID");
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(principal))throw problem(400,"INVALID_CUSTOMER_PRINCIPAL");
    return this.withTenantReadContext(id,async tx=>{
      const rows=await tx.unsafe("SELECT alert_preferences,updated_at FROM tenant_scoped_customer_experience_preferences WHERE customer_principal_id=$1::uuid LIMIT 1",[principal]);
      return rows[0]?{alerts:rows[0].alert_preferences||{},updated_at:rows[0].updated_at}:{alerts:{calls_below:{enabled:false,threshold:10},abandon_rate_above:{enabled:false,threshold:25},revenue_target:{enabled:false,threshold:100},drop_vs_average:{enabled:false,threshold:30}},updated_at:null};
    });
  }

  async saveCustomerExperiencePreferences(tenantId,principalId,input={}){
    const id=Number(tenantId),principal=String(principalId||""),src=input.alerts||{};
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_ID");
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(principal))throw problem(400,"INVALID_CUSTOMER_PRINCIPAL");
    const bounded=(v,min,max,fallback)=>{const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;};
    const alerts={
      calls_below:{enabled:src.calls_below?.enabled===true,threshold:bounded(src.calls_below?.threshold,0,1000000,10)},
      abandon_rate_above:{enabled:src.abandon_rate_above?.enabled===true,threshold:bounded(src.abandon_rate_above?.threshold,0,100,25)},
      revenue_target:{enabled:src.revenue_target?.enabled===true,threshold:bounded(src.revenue_target?.threshold,0,100000000,100)},
      drop_vs_average:{enabled:src.drop_vs_average?.enabled===true,threshold:bounded(src.drop_vs_average?.threshold,0,100,30)}
    };
    return this.withTenantContext(id,async tx=>{
      const membership=(await tx.unsafe("SELECT 1 AS ok FROM customer_tenant_memberships WHERE tenant_id=$1 AND customer_principal_id=$2::uuid AND status='active' LIMIT 1",[id,principal]))[0];
      if(!membership)throw problem(403,"CUSTOMER_MEMBERSHIP_REQUIRED");
      const rows=await tx.unsafe(
        "INSERT INTO customer_experience_preferences(tenant_id,customer_principal_id,alert_preferences,updated_at) VALUES($1,$2::uuid,$3::jsonb,now())"+
        " ON CONFLICT(tenant_id,customer_principal_id) DO UPDATE SET alert_preferences=EXCLUDED.alert_preferences,updated_at=now() RETURNING alert_preferences,updated_at",
        [id,principal,alerts]
      );
      return {alerts:rows[0].alert_preferences,updated_at:rows[0].updated_at};
    });
  }

  async createCustomerConsumptionReceipt(tenantId,customerPrincipalId,from,to){
    const id=Number(tenantId),start=Date.parse(from),end=Date.parse(to);
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||end-start>366*86400000)throw problem(400,"INVALID_CONSUMPTION_RANGE");
    if(end>Date.now()+5*60000)throw problem(400,"INVALID_CONSUMPTION_RANGE");
    const metricRanges=await this.effectiveMetricRanges(new Date(start).toISOString(),new Date(end).toISOString(),id);
    const data=await this.customerPortalOverview(id,new Date(start).toISOString(),new Date(end).toISOString(),metricRanges);
    const snapshot=consumptionSnapshot(data,new Date(start).toISOString(),new Date(end).toISOString(),metricRanges);
    const digest=consumptionSnapshotHash(snapshot);
    const rows=await this.sql.unsafe(
      "INSERT INTO tenant_consumption_receipts(tenant_id,customer_principal_id,requested_from,requested_to,tenant_timezone,metrics,metric_ranges,snapshot_sha256,source_updated_at)"+
      " VALUES($1,$2,$3::timestamptz,$4::timestamptz,$5,$6::jsonb,$7::jsonb,$8,$9::timestamptz)"+
      " RETURNING public_id,requested_from,requested_to,tenant_timezone,metrics,metric_ranges,snapshot_sha256,source_updated_at,created_at",
      [id,customerPrincipalId||null,snapshot.range.from,snapshot.range.to,snapshot.tenant_timezone,snapshot.metrics,snapshot.metric_ranges,digest,snapshot.source_updated_at]
    );
    await this.sql.unsafe(
      "INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload) VALUES($1,'customer.consumption_receipt.created','tenant_consumption_receipt',$2,$3::jsonb)",
      [id,String(rows[0].public_id),{snapshot_sha256:digest,requested_from:snapshot.range.from,requested_to:snapshot.range.to}]
    );
    return publicConsumptionReceipt(rows[0]);
  }

  async customerConsumptionReceipts(tenantId,limit=10){
    const id=Number(tenantId),safe=Math.max(1,Math.min(25,Number(limit)||10));
    return this.withTenantReadContext(id,async tx=>{
      const rows=await tx.unsafe(
        "SELECT public_id,requested_from,requested_to,tenant_timezone,metrics,metric_ranges,snapshot_sha256,source_updated_at,created_at"+
        " FROM tenant_scoped_consumption_receipts ORDER BY created_at DESC,id DESC LIMIT $1",[safe]
      );
      return rows.map(publicConsumptionReceipt);
    });
  }

  async tenantConsumptionToday(publicTenantId){
    const rows=await this.readSql.unsafe(
      "SELECT id,COALESCE(NULLIF(timezone,''),'Europe/Paris') AS timezone,"+
      " (date_trunc('day',now() AT TIME ZONE COALESCE(NULLIF(timezone,''),'Europe/Paris')) AT TIME ZONE COALESCE(NULLIF(timezone,''),'Europe/Paris')) AS from_ts,"+
      " now() AS to_ts FROM tenants WHERE public_id=$1::uuid",[String(publicTenantId||"")]
    );
    const tenant=rows[0];if(!tenant)throw problem(404,"TENANT_NOT_FOUND");
    const from=new Date(tenant.from_ts).toISOString(),to=new Date(tenant.to_ts).toISOString();
    const metricRanges=await this.effectiveMetricRanges(from,to,Number(tenant.id));
    const data=await this.customerPortalOverview(Number(tenant.id),from,to,metricRanges);
    const snapshot=consumptionSnapshot(data,from,to,metricRanges);
    return {...snapshot,snapshot_sha256:consumptionSnapshotHash(snapshot),generated_at:new Date().toISOString(),basis:"authoritative_call_facts_and_validated_tenant_distributions"};
  }

  async tenantConsumptionReceipts(publicTenantId,limit=10){
    const tenantRows=await this.readSql.unsafe("SELECT id FROM tenants WHERE public_id=$1::uuid",[String(publicTenantId||"")]);
    const tenant=tenantRows[0];if(!tenant)throw problem(404,"TENANT_NOT_FOUND");
    const safe=Math.max(1,Math.min(25,Number(limit)||10));
    const rows=await this.readSql.unsafe(
      "SELECT public_id,requested_from,requested_to,tenant_timezone,metrics,metric_ranges,snapshot_sha256,source_updated_at,created_at"+
      " FROM tenant_consumption_receipts WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2",[Number(tenant.id),safe]
    );
    return rows.map(publicConsumptionReceipt);
  }

  async reconcileTenantConsumptionReceipt(publicTenantId,receiptPublicId){
    const tenantRows=await this.readSql.unsafe("SELECT id FROM tenants WHERE public_id=$1::uuid",[String(publicTenantId||"")]);
    const tenant=tenantRows[0];if(!tenant)throw problem(404,"TENANT_NOT_FOUND");
    const rows=await this.readSql.unsafe(
      "SELECT public_id,requested_from,requested_to,tenant_timezone,metrics,metric_ranges,snapshot_sha256,source_updated_at,created_at"+
      " FROM tenant_consumption_receipts WHERE tenant_id=$1 AND public_id=$2::uuid",[Number(tenant.id),String(receiptPublicId||"")]
    );
    const row=rows[0];if(!row)throw problem(404,"CONSUMPTION_RECEIPT_NOT_FOUND");
    const from=new Date(row.requested_from).toISOString(),to=new Date(row.requested_to).toISOString();
    const data=await this.customerPortalOverview(Number(tenant.id),from,to,row.metric_ranges);
    const current=consumptionSnapshot(data,from,to,row.metric_ranges),currentHash=consumptionSnapshotHash(current);
    const differences=consumptionDiff(row.metrics,current.metrics);
    return {
      receipt:publicConsumptionReceipt(row),
      reconciliation:{
        status:currentHash===row.snapshot_sha256&&differences.length===0?"match":"difference",
        receipt_sha256:row.snapshot_sha256,current_sha256:currentHash,
        current_metrics:current.metrics,current_source_updated_at:current.source_updated_at,
        differences,checked_at:new Date().toISOString(),
        basis:"authoritative_call_facts_and_validated_tenant_distributions"
      }
    };
  }

  async customerPortalOverview(tenantId,from,to,metricRanges=null){
    const id=Number(tenantId);
    const mr=metricRanges||Object.fromEntries(["calls","minutes","revenue","payout","quality"].map(k=>[k,{from,to,baseline:null}]));
    const callsFrom=mr.calls.from,minutesFrom=mr.minutes.from,revenueFrom=mr.revenue.from,payoutFrom=mr.payout.from,qualityFrom=mr.quality.from;
    const earliestFrom=[callsFrom,minutesFrom,revenueFrom].sort((a,b)=>Date.parse(a)-Date.parse(b))[0];
    return this.withTenantReadContext(id,async tx=>{
      const tenantRows=await tx.unsafe(
        "SELECT t.id,t.public_id,t.display_name,t.legal_name,t.status,t.country_code,t.preferred_locale,t.default_currency,t.timezone,"+
        " CASE WHEN k.entity_type='individual' THEN 'individual' ELSE 'business' END AS customer_type,COALESCE(k.status,'not_started') AS kyc_status,k.registration_number FROM tenants t LEFT JOIN tenant_kyc_profiles k ON k.tenant_id=t.id WHERE t.id=$1",[id]
      );
      const tenant=tenantRows[0];if(!tenant)throw problem(404,"TENANT_NOT_FOUND");
      const financial=await tx.unsafe(
        "SELECT f.currency,"+
        " count(*) FILTER(WHERE f.started_at >= $2::timestamptz)::bigint AS calls_total,"+
        " count(*) FILTER(WHERE f.started_at >= $2::timestamptz AND f.call_status='connected')::bigint AS calls_connected,"+
        " count(*) FILTER(WHERE f.started_at >= $2::timestamptz AND f.call_status='abandoned')::bigint AS calls_abandoned,"+
        " count(*) FILTER(WHERE f.started_at >= $2::timestamptz AND f.call_status NOT IN ('connected','abandoned'))::bigint AS calls_failed,"+
        " COALESCE(sum(f.conversation_seconds) FILTER(WHERE f.started_at >= $3::timestamptz),0)::float8 AS conversation_seconds,"+
        " COALESCE(sum(f.billable_seconds) FILTER(WHERE f.started_at >= $3::timestamptz),0)::float8 AS billable_seconds,"+
        " COALESCE(sum(f.retail_service_amount_ttc) FILTER(WHERE f.started_at >= $4::timestamptz),0)::float8 AS generated_revenue_ttc,"+
        " COALESCE(sum(f.expected_payout_ht) FILTER(WHERE f.started_at >= $5::timestamptz),0)::float8 AS expected_payout_ht,"+
        " COALESCE(sum(CASE WHEN pt.id IS NULL THEN 0 ELSE GREATEST(0,f.expected_payout_ht-LEAST(f.expected_payout_ht,"+
        " f.expected_payout_ht*pt.platform_fee_bps/10000.0+pt.platform_fee_ht_per_min*(f.billable_seconds/60.0))) END)"+
        " FILTER(WHERE f.started_at >= $5::timestamptz),0)::float8 AS estimated_client_net_ht,max(f.ended_at) AS updated_at"+
        " FROM tenant_scoped_call_facts f LEFT JOIN LATERAL ("+
        " SELECT p.id,p.platform_fee_bps,p.platform_fee_ht_per_min::float8 FROM tenant_payout_terms p"+
        " WHERE p.tenant_id=$7 AND p.status='active' AND p.effective_from<=f.started_at"+
        " AND (p.effective_to IS NULL OR p.effective_to>f.started_at)"+
        " AND (p.market_id IS NULL OR p.market_id=f.market_id) AND (p.sva_number_id IS NULL OR p.sva_number_id=f.sva_number_id)"+
        " ORDER BY (p.sva_number_id IS NOT NULL) DESC,(p.market_id IS NOT NULL) DESC,p.effective_from DESC,p.id DESC LIMIT 1"+
        " ) pt ON TRUE"+
        " WHERE f.started_at >= $1::timestamptz AND f.started_at <= $6::timestamptz"+
        " GROUP BY f.currency ORDER BY f.currency",[earliestFrom,callsFrom,minutesFrom,revenueFrom,payoutFrom,to,id]
      );
      const series=await tx.unsafe(
        "SELECT started_at::date AS bucket_date,"+
        " count(*) FILTER(WHERE started_at >= $2::timestamptz)::bigint AS calls_total,"+
        " count(*) FILTER(WHERE started_at >= $2::timestamptz AND call_status='connected')::bigint AS calls_connected,"+
        " count(*) FILTER(WHERE started_at >= $2::timestamptz AND call_status='abandoned')::bigint AS calls_abandoned,"+
        " count(*) FILTER(WHERE started_at >= $2::timestamptz AND call_status NOT IN ('connected','abandoned'))::bigint AS calls_failed,"+
        " COALESCE(sum(billable_seconds) FILTER(WHERE started_at >= $3::timestamptz),0)::float8 AS billable_seconds,"+
        " COALESCE(sum(retail_service_amount_ttc) FILTER(WHERE started_at >= $4::timestamptz),0)::float8 AS generated_revenue_ttc,max(ended_at) AS updated_at"+
        " FROM tenant_scoped_call_facts WHERE started_at >= $1::timestamptz AND started_at <= $5::timestamptz"+
        " GROUP BY started_at::date ORDER BY bucket_date",[earliestFrom,callsFrom,minutesFrom,revenueFrom,to]
      );
      const voiceQuality=await tx.unsafe(
        "SELECT count(*)::bigint AS calls_total,count(*) FILTER(WHERE call_status='connected')::bigint AS calls_connected,"+
        " count(post_dial_delay_ms)::bigint AS pdd_samples,avg(post_dial_delay_ms)::float8 AS avg_pdd_ms,"+
        " count(*) FILTER(WHERE post_dial_delay_ms>8000)::bigint AS high_pdd_calls,count(mos)::bigint AS quality_samples,"+
        " count(*) FILTER(WHERE COALESCE(rtp_packet_loss_percent,0)>=5 OR COALESCE(jitter_ms,0)>5 OR COALESCE(latency_ms,0)>150)::bigint AS network_affected_calls,"+
        " count(*) FILTER(WHERE mos IS NOT NULL AND mos<3.5)::bigint AS low_mos_calls,avg(mos)::float8 AS mos,"+
        " avg(rtp_packet_loss_percent)::float8 AS packet_loss_percent,avg(jitter_ms)::float8 AS jitter_ms,avg(latency_ms)::float8 AS latency_ms,avg(rtt_ms)::float8 AS rtt_ms,"+
        " count(*) FILTER(WHERE sip_final_code BETWEEN 500 AND 599)::bigint AS sip_5xx_calls,"+
        " count(*) FILTER(WHERE hangup_party='caller')::bigint AS caller_hangups,count(*) FILTER(WHERE hangup_party='callee')::bigint AS callee_hangups,"+
        " count(*) FILTER(WHERE hangup_party='network')::bigint AS network_hangups"+
        " FROM tenant_scoped_portal_call_details WHERE started_at >= $1::timestamptz AND started_at <= $2::timestamptz",
        [qualityFrom,to]
      );
      const activityBreakdown=await tx.unsafe(
        "WITH base AS MATERIALIZED ("+
        " SELECT sva_number_id,COALESCE(display_number,e164,'Numéro') AS number_label,COALESCE(origin_carrier,'Autre') AS carrier,"+
        " call_status,COALESCE(conversation_seconds,0) AS conversation_seconds,COALESCE(billable_seconds,0) AS billable_seconds,"+
        " started_at AT TIME ZONE $3 AS local_started"+
        " FROM tenant_scoped_portal_call_details WHERE started_at >= $1::timestamptz AND started_at <= $2::timestamptz"+
        "), roll AS ("+
        " SELECT 'hour'::text AS dimension,LPAD(EXTRACT(HOUR FROM local_started)::int::text,2,'0') AS key,"+
        " LPAD(EXTRACT(HOUR FROM local_started)::int::text,2,'0')||'h' AS label,count(*)::bigint AS calls,"+
        " count(*) FILTER(WHERE call_status='connected')::bigint AS connected,COALESCE(sum(billable_seconds),0)::float8 AS billable_seconds FROM base GROUP BY 2,3"+
        " UNION ALL SELECT 'weekday',EXTRACT(ISODOW FROM local_started)::int::text,"+
        " CASE EXTRACT(ISODOW FROM local_started)::int WHEN 1 THEN 'Lun' WHEN 2 THEN 'Mar' WHEN 3 THEN 'Mer' WHEN 4 THEN 'Jeu' WHEN 5 THEN 'Ven' WHEN 6 THEN 'Sam' ELSE 'Dim' END,"+
        " count(*)::bigint,count(*) FILTER(WHERE call_status='connected')::bigint,COALESCE(sum(billable_seconds),0)::float8 FROM base GROUP BY 2,3"+
        " UNION ALL SELECT 'number',COALESCE(sva_number_id::text,number_label),number_label,count(*)::bigint,"+
        " count(*) FILTER(WHERE call_status='connected')::bigint,COALESCE(sum(billable_seconds),0)::float8 FROM base GROUP BY 2,3"+
        " UNION ALL SELECT 'duration',CASE WHEN conversation_seconds<60 THEN '1' WHEN conversation_seconds<180 THEN '2' WHEN conversation_seconds<300 THEN '3' ELSE '4' END,"+
        " CASE WHEN conversation_seconds<60 THEN '< 1 min' WHEN conversation_seconds<180 THEN '1–3 min' WHEN conversation_seconds<300 THEN '3–5 min' ELSE '5 min et +' END,"+
        " count(*)::bigint,count(*) FILTER(WHERE call_status='connected')::bigint,COALESCE(sum(billable_seconds),0)::float8 FROM base GROUP BY 2,3"+
        " UNION ALL SELECT 'carrier',carrier,carrier,count(*)::bigint,count(*) FILTER(WHERE call_status='connected')::bigint,COALESCE(sum(billable_seconds),0)::float8 FROM base GROUP BY carrier"+
        ") SELECT dimension,key,label,calls,connected,billable_seconds FROM roll ORDER BY dimension,key",
        [callsFrom,to,tenant.timezone||"Europe/Paris"]
      );
      const metricPayout=await tx.unsafe(
        "SELECT d.currency,COALESCE(sum(dc.net_payout_ht),0)::float8 AS net_payout_ht"+
        " FROM tenant_revenue_distribution_calls dc"+
        " JOIN tenant_revenue_distributions d ON d.id=dc.tenant_distribution_id AND d.tenant_id=$3"+
        " JOIN calls c ON c.id=dc.call_id AND c.tenant_id=$3"+
        " WHERE c.started_at >= $1::timestamptz AND c.started_at <= $2::timestamptz"+
        " AND d.status IN ('reconciled','payable','paid') GROUP BY d.currency ORDER BY d.currency",
        [payoutFrom,to,id]
      );
      const liveFinancial=await tx.unsafe(
        "SELECT currency,count(*)::int AS active_calls,"+
        " COALESCE(sum(LEAST(86400,GREATEST(0,EXTRACT(EPOCH FROM (now()-billable_started_at))))/60.0*service_rate_ttc_per_min),0)::float8 AS estimated_service_revenue_ttc,"+
        " COALESCE(sum(LEAST(86400,GREATEST(0,EXTRACT(EPOCH FROM (now()-billable_started_at))))/60.0*upstream_payout_rate_ht_per_min),0)::float8 AS estimated_upstream_payout_ht,"+
        " COALESCE(sum(LEAST(86400,GREATEST(0,EXTRACT(EPOCH FROM (now()-billable_started_at))))/60.0*net_client_rate_ht_per_min),0)::float8 AS estimated_client_net_ht,"+
        " COALESCE(sum(service_rate_ttc_per_min)/60.0,0)::float8 AS service_rate_ttc_per_second,"+
        " COALESCE(sum(upstream_payout_rate_ht_per_min)/60.0,0)::float8 AS upstream_rate_ht_per_second,"+
        " COALESCE(sum(net_client_rate_ht_per_min)/60.0,0)::float8 AS client_rate_ht_per_second"+
        " FROM tenant_scoped_live_call_financial_sessions WHERE status='active' AND billable_started_at>now()-interval '24 hours'"+
        " GROUP BY currency ORDER BY currency"
      );
      const numbers=await tx.unsafe(
        "SELECT n.id,a.id AS assignment_id,n.display_number,n.e164,n.tariff_code,n.currency,n.number_type,n.service_rate_ttc_per_min::float8,n.status,n.activated_at,"+
        " a.assignment_type,a.status AS assignment_status,a.kyc_status,a.valid_from,a.valid_to"+
        " FROM tenant_scoped_sva_numbers n LEFT JOIN tenant_scoped_number_assignments a ON a.sva_number_id=n.id"+
        " ORDER BY n.status,n.display_number LIMIT 100"
      );
      const settlements=await tx.unsafe(
        "SELECT id,market_id,currency,period_start,period_end,upstream_payout_ht::float8,platform_fee_ht::float8,net_payout_ht::float8,"+
        " unallocated_amount_ht::float8,held_amount_ht::float8,collection_model,status,payment_due_date,paid_at,statement_reference"+
        " FROM tenant_scoped_revenue_distributions ORDER BY period_end DESC,id DESC LIMIT 24"
      );
      const subscriptions=await tx.unsafe(
        "SELECT id,market_id,status,billing_currency,starts_at,current_period_start,current_period_end,ends_at,cancel_at_period_end,"+
        " last_payment_status,last_event_at,plan_key,plan_name,amount_minor,price_currency,billing_interval,interval_count"+
        " FROM tenant_scoped_subscriptions ORDER BY starts_at DESC,id DESC LIMIT 10"
      );
      const destinations=await tx.unsafe(
        "SELECT id,sva_number_id,label,destination_type,destination_uri,priority,status,failover_enabled,max_concurrent_calls,active_calls,last_assigned_at"+
        " FROM tenant_scoped_call_destinations ORDER BY priority,id LIMIT 100"
      );
      const portabilityRequests=await tx.unsafe(
        "SELECT id,country_code,requested_e164,display_number,service_family,current_operator_name,desired_port_date,status,ownership_status,"+
        " operator_portability_reference,scheduled_at,completed_at,rejection_reason,tariff_code,service_rate_ttc_per_min::float8,currency,tariff_verification_status,tariff_verified_at,"+
        " rio_last4,rio_validation_status,rio_validated_at,source_contract_transfer_mode,source_contract_liability_acknowledged,"+
        " automation_state,automation_last_error,automation_last_sync_at,operator_status,created_at,updated_at"+
        " FROM tenant_scoped_portability_requests_v4 ORDER BY created_at DESC,id DESC LIMIT 20"
      );
      const serviceIncidents=await tx.unsafe(
        "SELECT id,public_id,category,severity,status,source,title,description,assigned_team,first_response_due_at,target_resolution_at,first_responded_at,last_customer_update_at,last_pgi_update_at,resolved_at,created_at,updated_at"+
        " FROM tenant_scoped_service_incidents WHERE customer_visible=true ORDER BY (status IN ('resolved','closed')) ASC,updated_at DESC,id DESC LIMIT 10"
      );
      const operationalAlerts=await tx.unsafe(
        "SELECT id,incident_id,alert_type,severity,state,title,message,due_at,details,last_detected_at"+
        " FROM tenant_scoped_operational_alerts WHERE customer_visible=true AND state<>'resolved' ORDER BY last_detected_at DESC,id DESC LIMIT 20"
      );
      const recentCalls=await tx.unsafe(
        "SELECT call_id,market,currency,sva_number_id,display_number,e164,started_at,ringing_at,bridged_at,ended_at,call_status,wait_seconds,conversation_seconds,billable_seconds,"+
        " retail_service_amount_ttc::float8,sip_final_code,hangup_cause,hangup_party,codec,post_dial_delay_ms,origin_carrier,host_carrier,"+
        " rtp_packet_loss_percent::float8 AS packet_loss_percent,jitter_ms::float8,latency_ms::float8,rtt_ms::float8,mos::float8,"+
        " packets_in,packets_out,packets_lost,bytes_in,bytes_out,dtmf_errors"+
        " FROM tenant_scoped_portal_call_details WHERE started_at>=$1::timestamptz AND started_at<=$2::timestamptz"+
        " ORDER BY started_at DESC,call_id DESC LIMIT 20",[callsFrom,to]
      );
      return {tenant,financial_by_currency:financial,metric_net_payout_by_currency:metricPayout,live_financial_by_currency:liveFinancial.map(row=>numberFields(row,["active_calls","estimated_service_revenue_ttc","estimated_upstream_payout_ht","estimated_client_net_ht","service_rate_ttc_per_second","upstream_rate_ht_per_second","client_rate_ht_per_second"])),series,activity_breakdown:activityBreakdown,numbers,settlements,subscriptions,portability_requests:portabilityRequests,destinations,service_incidents:serviceIncidents,operational_alerts:operationalAlerts,recent_calls:recentCalls,voice_quality:voiceQuality[0]||null,range:{from,to},metric_ranges:mr};
    });
  }

  async customerPortalComparison(tenantId,from,to,metricRanges=null){
    const id=Number(tenantId);
    if(!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to)))throw problem(400,"INVALID_RANGE");
    const mr=metricRanges||Object.fromEntries(["calls","minutes","revenue","payout","quality"].map(k=>[k,{from,to,baseline:null}]));
    const callsFrom=mr.calls.from,minutesFrom=mr.minutes.from,revenueFrom=mr.revenue.from;
    const earliestFrom=[callsFrom,minutesFrom,revenueFrom].sort((a,b)=>Date.parse(a)-Date.parse(b))[0];
    return this.withTenantReadContext(id,async tx=>{
      const financial=await tx.unsafe(
        "SELECT currency,"+
        " count(*) FILTER(WHERE started_at >= $2::timestamptz)::bigint AS calls_total,"+
        " count(*) FILTER(WHERE started_at >= $2::timestamptz AND call_status='connected')::bigint AS calls_connected,"+
        " count(*) FILTER(WHERE started_at >= $2::timestamptz AND call_status='abandoned')::bigint AS calls_abandoned,"+
        " count(*) FILTER(WHERE started_at >= $2::timestamptz AND call_status NOT IN ('connected','abandoned'))::bigint AS calls_failed,"+
        " COALESCE(sum(conversation_seconds) FILTER(WHERE started_at >= $3::timestamptz),0)::float8 AS conversation_seconds,"+
        " COALESCE(sum(billable_seconds) FILTER(WHERE started_at >= $3::timestamptz),0)::float8 AS billable_seconds,"+
        " COALESCE(sum(retail_service_amount_ttc) FILTER(WHERE started_at >= $4::timestamptz),0)::float8 AS generated_revenue_ttc,max(ended_at) AS updated_at"+
        " FROM tenant_scoped_call_facts WHERE started_at >= $1::timestamptz AND started_at <= $5::timestamptz GROUP BY currency ORDER BY currency",
        [earliestFrom,callsFrom,minutesFrom,revenueFrom,to]
      );
      return {financial_by_currency:financial,range:{from,to},metric_ranges:mr};
    });
  }

  async customerPortalCalls(tenantId,params={}){
    const id=Number(tenantId);
    const from=String(params.from||"");
    const to=String(params.to||"");
    if(!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||Date.parse(to)<Date.parse(from))throw problem(400,"INVALID_RANGE");
    const limit=clampInt(params.limit,50,1,100);
    const cursor=params.cursor?decodeCursor(params.cursor):null;
    if(params.cursor&&!cursor)throw problem(400,"INVALID_CURSOR");

    const allowedStatuses=new Set(["connected","abandoned","failed","busy","no_answer"]);
    const status=params.status?String(params.status).trim().toLowerCase():null;
    if(status&&!allowedStatuses.has(status))throw problem(400,"INVALID_CALL_STATUS");

    const numberId=params.number_id==null||params.number_id===""?null:Number(params.number_id);
    if(numberId!=null&&(!Number.isInteger(numberId)||numberId<=0))throw problem(400,"INVALID_CALL_NUMBER_FILTER");

    function optionalNumber(value,code,max){
      if(value==null||value==="")return null;
      const parsed=Number(value);
      if(!Number.isFinite(parsed)||parsed<0||parsed>max)throw problem(400,code);
      return parsed;
    }
    const minDuration=optionalNumber(params.min_duration,"INVALID_MIN_DURATION",86400);
    const maxDuration=optionalNumber(params.max_duration,"INVALID_MAX_DURATION",86400);
    const minAmount=optionalNumber(params.min_amount,"INVALID_MIN_AMOUNT",100000);
    const maxAmount=optionalNumber(params.max_amount,"INVALID_MAX_AMOUNT",100000);
    if(minDuration!=null&&maxDuration!=null&&maxDuration<minDuration)throw problem(400,"INVALID_DURATION_RANGE");
    if(minAmount!=null&&maxAmount!=null&&maxAmount<minAmount)throw problem(400,"INVALID_AMOUNT_RANGE");

    return this.withTenantReadContext(id,async tx=>{
      const rows=await tx.unsafe(
        "SELECT call_id,market,currency,sva_number_id,display_number,e164,started_at,ringing_at,bridged_at,ended_at,call_status,wait_seconds,conversation_seconds,billable_seconds,"+
        " retail_service_amount_ttc::float8,sip_final_code,hangup_cause,hangup_party,codec,post_dial_delay_ms,origin_carrier,host_carrier,"+
        " rtp_packet_loss_percent::float8 AS packet_loss_percent,jitter_ms::float8,latency_ms::float8,rtt_ms::float8,mos::float8,"+
        " packets_in,packets_out,packets_lost,bytes_in,bytes_out,dtmf_errors"+
        " FROM tenant_scoped_portal_call_details WHERE started_at>=$1::timestamptz AND started_at<=$2::timestamptz"+
        " AND ($3::timestamptz IS NULL OR (started_at,call_id)<($3::timestamptz,$4::bigint))"+
        " AND ($5::text IS NULL OR call_status=$5)"+
        " AND ($6::bigint IS NULL OR sva_number_id=$6)"+
        " AND ($7::float8 IS NULL OR COALESCE(billable_seconds,conversation_seconds,0)>=$7)"+
        " AND ($8::float8 IS NULL OR COALESCE(billable_seconds,conversation_seconds,0)<=$8)"+
        " AND ($9::numeric IS NULL OR COALESCE(retail_service_amount_ttc,0)>=$9)"+
        " AND ($10::numeric IS NULL OR COALESCE(retail_service_amount_ttc,0)<=$10)"+
        " ORDER BY started_at DESC,call_id DESC LIMIT $11",
        [from,to,cursor?.started_at||null,cursor?.id||null,status,numberId,minDuration,maxDuration,minAmount,maxAmount,limit+1]
      );
      const more=rows.length>limit;const data=more?rows.slice(0,limit):rows;
      const last=data.at(-1);
      return {data,next_cursor:more&&last?encodeCursor({started_at:last.started_at,id:Number(last.call_id)}):null,filters:{status,number_id:numberId,min_duration:minDuration,max_duration:maxDuration,min_amount:minAmount,max_amount:maxAmount}};
    });
  }

  async customerServiceIncidents(tenantId,params={}){
    const id=Number(tenantId);
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_ID");
    const publicId=String(params.incident_id||"").trim();
    const limit=clampInt(params.limit,30,1,100);
    return this.withTenantReadContext(id,async tx=>{
      if(publicId){
        if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(publicId))throw problem(400,"INVALID_INCIDENT_ID");
        const rows=await tx.unsafe(
          "SELECT * FROM tenant_scoped_service_incidents WHERE public_id=$1::uuid AND customer_visible=true LIMIT 1",
          [publicId]
        );
        const incident=rows[0];if(!incident)throw problem(404,"SERVICE_INCIDENT_NOT_FOUND");
        const [events,notes]=await Promise.all([
          tx.unsafe(
            "SELECT id,event_type,actor_type,previous_value,new_value,message,details,occurred_at"+
            " FROM tenant_scoped_service_incident_events WHERE incident_id=$1 AND customer_visible=true ORDER BY occurred_at,id LIMIT 250",
            [incident.id]
          ),
          tx.unsafe(
            "SELECT id,author_type,body,created_at FROM tenant_scoped_service_incident_notes"+
            " WHERE incident_id=$1 AND customer_visible=true ORDER BY created_at,id LIMIT 250",
            [incident.id]
          )
        ]);
        return {incident,events,notes};
      }
      const incidents=await tx.unsafe(
        "SELECT id,public_id,category,severity,status,source,title,description,assigned_team,first_response_due_at,target_resolution_at,"+
        " first_responded_at,last_customer_update_at,last_pgi_update_at,resolved_at,closed_at,diagnostic_snapshot,created_at,updated_at"+
        " FROM tenant_scoped_service_incidents WHERE customer_visible=true ORDER BY (status IN ('resolved','closed')) ASC,updated_at DESC,id DESC LIMIT $1",
        [limit]
      );
      const alerts=await tx.unsafe(
        "SELECT id,alert_type,severity,state,title,message,due_at,details,last_detected_at"+
        " FROM tenant_scoped_operational_alerts WHERE customer_visible=true AND state<>'resolved' ORDER BY last_detected_at DESC,id DESC LIMIT 50"
      );
      return {data:incidents,alerts};
    });
  }

  async createCustomerServiceIncident(tenantId,input={},principalId){
    const id=Number(tenantId);
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_ID");
    const principal=String(principalId||"").trim();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(principal))throw problem(401,"CUSTOMER_AUTH_REQUIRED");
    const category=String(input.category||"other").trim().toLowerCase();
    const severity=String(input.severity||"normal").trim().toLowerCase();
    const title=String(input.title||"").trim();
    const description=String(input.description||"").trim();
    const svaNumberId=input.sva_number_id==null||input.sva_number_id===""?null:Number(input.sva_number_id);
    if(!["telephony","portability","billing","payout","account","routing","quality","other"].includes(category))throw problem(400,"INVALID_INCIDENT_CATEGORY");
    if(!["low","normal","high","critical"].includes(severity))throw problem(400,"INVALID_INCIDENT_SEVERITY");
    if(title.length<3||title.length>180)throw problem(400,"INVALID_INCIDENT_TITLE");
    if(description.length<3||description.length>5000)throw problem(400,"INVALID_INCIDENT_DESCRIPTION");
    if(svaNumberId!=null&&(!Number.isInteger(svaNumberId)||svaNumberId<=0))throw problem(400,"INVALID_INCIDENT_NUMBER");
    const sla=serviceIncidentSla(severity);
    const result=await this.sql.begin(async tx=>{
      const tenant=(await tx.unsafe("SELECT id,status,tenant_type FROM tenants WHERE id=$1 FOR UPDATE",[id]))[0];
      if(!tenant||tenant.tenant_type==="internal")throw problem(404,"TENANT_NOT_FOUND");
      if(tenant.status==="closed")throw problem(409,"TENANT_CLOSED");
      if(svaNumberId!=null){
        const number=(await tx.unsafe("SELECT id FROM sva_numbers WHERE id=$1 AND tenant_id=$2 LIMIT 1",[svaNumberId,id]))[0];
        if(!number)throw problem(404,"INCIDENT_NUMBER_NOT_FOUND");
      }
      const diagnostic=await tenantDiagnosticSnapshot(tx,id,svaNumberId);
      const rows=await tx.unsafe(
        "INSERT INTO tenant_service_incidents(tenant_id,sva_number_id,category,severity,status,source,title,description,created_by_customer_principal_id,"+
        " first_response_due_at,target_resolution_at,last_customer_update_at,diagnostic_snapshot)"+
        " VALUES($1,$2,$3,$4,'open','customer',$5,$6,$7::uuid,now()+make_interval(mins=>$8),now()+make_interval(mins=>$9),now(),$10::jsonb)"+
        " RETURNING id,public_id,tenant_id,sva_number_id,category,severity,status,source,title,description,assigned_team,first_response_due_at,target_resolution_at,created_at,updated_at",
        [id,svaNumberId,category,severity,title,description,principal,sla.response,sla.resolution,JSON.stringify(diagnostic)]
      );
      const incident=rows[0];
      await tx.unsafe(
        "INSERT INTO tenant_service_incident_events(incident_id,tenant_id,event_type,actor_type,actor_customer_principal_id,message,customer_visible,details)"+
        " VALUES($1,$2,'created','customer',$3::uuid,$4,true,$5::jsonb)",
        [incident.id,id,principal,"Incident signalé par le client",JSON.stringify({category,severity})]
      );
      await tx.unsafe(
        "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,NULL,'service_incident.create','tenant_service_incident',$2,$3::jsonb)",
        [id,String(incident.id),JSON.stringify({source:"customer",category,severity,public_id:incident.public_id})]
      );
      await serviceIncidentOutbox(tx,id,"service.incident.created",incident.id,incident.public_id,{source:"customer",category,severity});
      return incident;
    });
    this.eventBus.publish("service.incident.created",{tenant_id:id,incident_id:String(result.public_id),severity:result.severity,source:"customer"});
    return result;
  }

  async addCustomerServiceIncidentNote(tenantId,incidentPublicId,body,principalId){
    const id=Number(tenantId),publicId=String(incidentPublicId||"").trim(),principal=String(principalId||"").trim();
    const note=String(body||"").trim();
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_ID");
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(publicId))throw problem(400,"INVALID_INCIDENT_ID");
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(principal))throw problem(401,"CUSTOMER_AUTH_REQUIRED");
    if(!note||note.length>5000)throw problem(400,"INVALID_INCIDENT_NOTE");
    const result=await this.sql.begin(async tx=>{
      const incident=(await tx.unsafe(
        "SELECT id,status FROM tenant_service_incidents WHERE public_id=$1::uuid AND tenant_id=$2 AND customer_visible=true FOR UPDATE",
        [publicId,id]
      ))[0];
      if(!incident)throw problem(404,"SERVICE_INCIDENT_NOT_FOUND");
      if(incident.status==="closed")throw problem(409,"SERVICE_INCIDENT_CLOSED");
      const rows=await tx.unsafe(
        "INSERT INTO tenant_service_incident_notes(incident_id,tenant_id,author_type,author_customer_principal_id,body,customer_visible)"+
        " VALUES($1,$2,'customer',$3::uuid,$4,true) RETURNING id,incident_id,author_type,body,created_at",
        [incident.id,id,principal,note]
      );
      await tx.unsafe(
        "INSERT INTO tenant_service_incident_events(incident_id,tenant_id,event_type,actor_type,actor_customer_principal_id,message,customer_visible)"+
        " VALUES($1,$2,'note','customer',$3::uuid,'Nouveau message client',true)",
        [incident.id,id,principal]
      );
      await tx.unsafe(
        "UPDATE tenant_service_incidents SET last_customer_update_at=now(),status=CASE WHEN status='waiting_customer' THEN 'investigating' ELSE status END,updated_at=now() WHERE id=$1",
        [incident.id]
      );
      await serviceIncidentOutbox(tx,id,"service.incident.note",incident.id,publicId,{source:"customer",note_id:Number(rows[0].id)});
      return rows[0];
    });
    this.eventBus.publish("service.incident.customer_note",{tenant_id:id,incident_id:publicId});
    return result;
  }

  async createTenantServiceIncident(publicTenantId,input={},actor={}){
    const tenantPublicId=String(publicTenantId||"").trim();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantPublicId))throw problem(400,"INVALID_TENANT_PUBLIC_ID");
    const category=String(input.category||"other").trim().toLowerCase();
    const severity=String(input.severity||"normal").trim().toLowerCase();
    const title=String(input.title||"").trim(),description=String(input.description||"").trim();
    if(!["telephony","portability","billing","payout","account","routing","quality","other"].includes(category))throw problem(400,"INVALID_INCIDENT_CATEGORY");
    if(!["low","normal","high","critical"].includes(severity))throw problem(400,"INVALID_INCIDENT_SEVERITY");
    if(title.length<3||title.length>180||description.length<3||description.length>5000)throw problem(400,"INVALID_INCIDENT_CONTENT");
    const actorId=numericActor(actor),sla=serviceIncidentSla(severity);
    const result=await this.sql.begin(async tx=>{
      const tenant=(await tx.unsafe("SELECT id,tenant_type,status FROM tenants WHERE public_id=$1::uuid FOR UPDATE",[tenantPublicId]))[0];
      if(!tenant||tenant.tenant_type==="internal")throw problem(404,"TENANT_NOT_FOUND");
      const diagnostic=await tenantDiagnosticSnapshot(tx,Number(tenant.id),null);
      const incident=(await tx.unsafe(
        "INSERT INTO tenant_service_incidents(tenant_id,category,severity,status,source,title,description,owner_user_id,first_response_due_at,target_resolution_at,first_responded_at,last_pgi_update_at,diagnostic_snapshot)"+
        " VALUES($1,$2,$3,'investigating','admin',$4,$5,$6,now()+make_interval(mins=>$7),now()+make_interval(mins=>$8),now(),now(),$9::jsonb)"+
        " RETURNING id,public_id,tenant_id,category,severity,status,title,description,assigned_team,first_response_due_at,target_resolution_at,created_at",
        [tenant.id,category,severity,title,description,actorId,sla.response,sla.resolution,JSON.stringify(diagnostic)]
      ))[0];
      await tx.unsafe(
        "INSERT INTO tenant_service_incident_events(incident_id,tenant_id,event_type,actor_type,actor_user_id,message,customer_visible,details)"+
        " VALUES($1,$2,'created','staff',$3,'Incident ouvert par Audiotel Premium Pro',true,$4::jsonb)",
        [incident.id,tenant.id,actorId,JSON.stringify({category,severity})]
      );
      await tx.unsafe(
        "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'service_incident.create','tenant_service_incident',$3,$4::jsonb)",
        [tenant.id,actorId,String(incident.id),JSON.stringify({source:"admin",category,severity,public_id:incident.public_id})]
      );
      await serviceIncidentOutbox(tx,Number(tenant.id),"service.incident.created",incident.id,incident.public_id,{source:"admin",category,severity});
      return incident;
    });
    this.eventBus.publish("service.incident.created",{tenant_public_id:tenantPublicId,incident_id:String(result.public_id),severity:result.severity,source:"admin"});
    return result;
  }

  async serviceIncidentDetail(incidentPublicId){
    const publicId=String(incidentPublicId||"").trim();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(publicId))throw problem(400,"INVALID_INCIDENT_ID");
    const rows=await this.readSql.unsafe(
      "SELECT i.id,i.public_id,i.tenant_id,i.sva_number_id,i.source_telecom_incident_id,i.category,i.severity,i.status,i.source,i.title,i.description,"+
      " i.assigned_team,i.first_response_due_at,i.target_resolution_at,i.first_responded_at,i.last_customer_update_at,i.last_pgi_update_at,i.resolved_at,i.closed_at,"+
      " i.customer_visible,i.diagnostic_snapshot,i.created_at,i.updated_at,t.public_id AS tenant_public_id,t.display_name AS tenant,t.country_code,sn.display_number,sn.e164"+
      " FROM tenant_service_incidents i JOIN tenants t ON t.id=i.tenant_id LEFT JOIN sva_numbers sn ON sn.id=i.sva_number_id WHERE i.public_id=$1::uuid LIMIT 1",
      [publicId]
    );
    const incident=rows[0];if(!incident)throw problem(404,"SERVICE_INCIDENT_NOT_FOUND");
    const [events,notes,attachments]=await Promise.all([
      this.readSql.unsafe(
        "SELECT id,event_type,actor_type,previous_value,new_value,message,customer_visible,details,occurred_at FROM tenant_service_incident_events WHERE incident_id=$1 ORDER BY occurred_at,id LIMIT 500",
        [incident.id]
      ),
      this.readSql.unsafe(
        "SELECT id,author_type,body,customer_visible,created_at FROM tenant_service_incident_notes WHERE incident_id=$1 ORDER BY created_at,id LIMIT 500",
        [incident.id]
      ),
      this.readSql.unsafe(
        "SELECT a.id,a.object_asset_id,a.label,a.customer_visible,a.created_by_type,a.created_at,o.asset_type,o.media_type,o.size_bytes,o.status"+
        " FROM tenant_service_incident_attachments a JOIN object_assets o ON o.id=a.object_asset_id WHERE a.incident_id=$1 ORDER BY a.created_at,a.id LIMIT 100",
        [incident.id]
      )
    ]);
    return {incident,events,notes,attachments};
  }

  async updateServiceIncident(incidentPublicId,input={},actor={}){
    const publicId=String(incidentPublicId||"").trim();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(publicId))throw problem(400,"INVALID_INCIDENT_ID");
    const status=input.status==null?null:String(input.status).trim().toLowerCase();
    const severity=input.severity==null?null:String(input.severity).trim().toLowerCase();
    if(status&&!["active","open","investigating","waiting_customer","monitoring","resolved","closed"].includes(status))throw problem(400,"INVALID_INCIDENT_STATUS");
    if(severity&&!["low","normal","high","critical"].includes(severity))throw problem(400,"INVALID_INCIDENT_SEVERITY");
    if(!status&&!severity)throw problem(400,"INCIDENT_UPDATE_REQUIRED");
    const actorId=numericActor(actor);
    const result=await this.sql.begin(async tx=>{
      const current=(await tx.unsafe("SELECT * FROM tenant_service_incidents WHERE public_id=$1::uuid FOR UPDATE",[publicId]))[0];
      if(!current)throw problem(404,"SERVICE_INCIDENT_NOT_FOUND");
      const nextStatus=status||current.status,nextSeverity=severity||current.severity;
      const sla=serviceIncidentSla(nextSeverity);
      const rows=await tx.unsafe(
        "UPDATE tenant_service_incidents SET status=$2,severity=$3,owner_user_id=COALESCE(owner_user_id,$4),"+
        " first_responded_at=COALESCE(first_responded_at,now()),last_pgi_update_at=now(),"+
        " first_response_due_at=CASE WHEN $3<>severity THEN created_at+make_interval(mins=>$5) ELSE first_response_due_at END,"+
        " target_resolution_at=CASE WHEN $3<>severity THEN created_at+make_interval(mins=>$6) ELSE target_resolution_at END,"+
        " resolved_at=CASE WHEN $2='resolved' THEN COALESCE(resolved_at,now()) WHEN $2 NOT IN ('resolved','closed') THEN NULL ELSE resolved_at END,"+
        " closed_at=CASE WHEN $2='closed' THEN COALESCE(closed_at,now()) WHEN $2<>'closed' THEN NULL ELSE closed_at END,updated_at=now()"+
        " WHERE id=$1 RETURNING id,public_id,tenant_id,category,severity,status,title,assigned_team,first_response_due_at,target_resolution_at,first_responded_at,resolved_at,closed_at,updated_at",
        [current.id,nextStatus,nextSeverity,actorId,sla.response,sla.resolution]
      );
      if(nextStatus!==current.status){
        await tx.unsafe(
          "INSERT INTO tenant_service_incident_events(incident_id,tenant_id,event_type,actor_type,actor_user_id,previous_value,new_value,message,customer_visible)"+
          " VALUES($1,$2,$3,'staff',$4,$5,$6,$7,true)",
          [current.id,current.tenant_id,nextStatus==="resolved"?"resolved":nextStatus==="closed"?"closed":"status_changed",actorId,current.status,nextStatus,"État du dossier mis à jour"]
        );
      }
      if(nextSeverity!==current.severity){
        await tx.unsafe(
          "INSERT INTO tenant_service_incident_events(incident_id,tenant_id,event_type,actor_type,actor_user_id,previous_value,new_value,message,customer_visible)"+
          " VALUES($1,$2,'severity_changed','staff',$3,$4,$5,'Priorité du dossier mise à jour',true)",
          [current.id,current.tenant_id,actorId,current.severity,nextSeverity]
        );
      }
      await tx.unsafe(
        "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'service_incident.update','tenant_service_incident',$3,$4::jsonb)",
        [current.tenant_id,actorId,String(current.id),JSON.stringify({previous_status:current.status,status:nextStatus,previous_severity:current.severity,severity:nextSeverity})]
      );
      await serviceIncidentOutbox(tx,Number(current.tenant_id),"service.incident.changed",current.id,publicId,{previous_status:current.status,status:nextStatus,previous_severity:current.severity,severity:nextSeverity});
      return rows[0];
    });
    this.eventBus.publish("service.incident.changed",{tenant_id:Number(result.tenant_id),incident_id:publicId,status:result.status,severity:result.severity});
    return result;
  }

  async addServiceIncidentNote(incidentPublicId,input={},actor={}){
    const publicId=String(incidentPublicId||"").trim(),body=String(input.body||"").trim();
    const customerVisible=input.customer_visible!==false;
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(publicId))throw problem(400,"INVALID_INCIDENT_ID");
    if(!body||body.length>5000)throw problem(400,"INVALID_INCIDENT_NOTE");
    const actorId=numericActor(actor);
    const result=await this.sql.begin(async tx=>{
      const incident=(await tx.unsafe("SELECT id,tenant_id,status FROM tenant_service_incidents WHERE public_id=$1::uuid FOR UPDATE",[publicId]))[0];
      if(!incident)throw problem(404,"SERVICE_INCIDENT_NOT_FOUND");
      const row=(await tx.unsafe(
        "INSERT INTO tenant_service_incident_notes(incident_id,tenant_id,author_type,author_user_id,body,customer_visible)"+
        " VALUES($1,$2,'staff',$3,$4,$5) RETURNING id,incident_id,author_type,body,customer_visible,created_at",
        [incident.id,incident.tenant_id,actorId,body,customerVisible]
      ))[0];
      await tx.unsafe(
        "INSERT INTO tenant_service_incident_events(incident_id,tenant_id,event_type,actor_type,actor_user_id,message,customer_visible)"+
        " VALUES($1,$2,'note','staff',$3,'Nouveau message Audiotel Premium Pro',$4)",
        [incident.id,incident.tenant_id,actorId,customerVisible]
      );
      await tx.unsafe(
        "UPDATE tenant_service_incidents SET first_responded_at=COALESCE(first_responded_at,now()),last_pgi_update_at=now(),updated_at=now() WHERE id=$1",
        [incident.id]
      );
      await serviceIncidentOutbox(tx,Number(incident.tenant_id),"service.incident.note",incident.id,publicId,{source:"staff",note_id:Number(row.id),customer_visible:customerVisible});
      return row;
    });
    this.eventBus.publish("service.incident.staff_note",{incident_id:publicId});
    return result;
  }

  async customerVoiceStudio(tenantId){
    const id=Number(tenantId);if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_ID");
    return this.withTenantReadContext(id,async tx=>{
      const services=await tx.unsafe(
        "SELECT s.id,s.sva_number_id,s.name,s.status,s.timezone,s.default_locale,s.active_version_id,s.published_at,s.created_at,s.updated_at,"+
        " n.display_number,n.e164 FROM tenant_scoped_voice_services s LEFT JOIN tenant_scoped_sva_numbers n ON n.id=s.sva_number_id ORDER BY s.updated_at DESC,s.id DESC LIMIT 100"
      );
      const versions=await tx.unsafe(
        "SELECT id,service_id,version_no,state,flow,validation,checksum_sha256,source_version_id,published_at,created_at"+
        " FROM tenant_scoped_voice_service_versions ORDER BY service_id,version_no DESC LIMIT 1000"
      );
      const events=await tx.unsafe(
        "SELECT id,service_id,version_id,event_type,actor_type,details,occurred_at FROM tenant_scoped_voice_service_events ORDER BY occurred_at DESC,id DESC LIMIT 500"
      );
      return {data:services.map(s=>({...s,versions:versions.filter(v=>Number(v.service_id)===Number(s.id)),events:events.filter(e=>Number(e.service_id)===Number(s.id)).slice(0,30)}))};
    });
  }

  async createCustomerVoiceService(tenantId,input={},actorSubject=""){
    const id=Number(tenantId);if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_ID");
    const normalized=normalizeVoiceServiceInput(input),check=validateVoiceFlow(normalized.flow),checksum=voiceFlowChecksum(check.flow),actor=String(actorSubject||"").slice(0,160);
    const validation={valid:check.valid,errors:check.errors,warnings:check.warnings,node_count:check.node_count,features:check.features};
    const result=await this.withTenantContext(id,async tx=>{
      if(normalized.sva_number_id!=null){
        const n=await tx.unsafe("SELECT id FROM tenant_scoped_sva_numbers WHERE id=$1 LIMIT 1",[normalized.sva_number_id]);
        if(!n[0])throw problem(404,"SVA_NUMBER_NOT_FOUND");
      }
      const created=(await tx.unsafe(
        "INSERT INTO tenant_voice_services(tenant_id,sva_number_id,name,status,timezone,default_locale,created_by_subject)"+
        " VALUES($1,$2,$3,'draft',$4,$5,$6) RETURNING id,tenant_id,sva_number_id,name,status,timezone,default_locale,created_at,updated_at",
        [id,normalized.sva_number_id,normalized.name,normalized.timezone,normalized.default_locale,actor||null]
      ))[0];
      const version=(await tx.unsafe(
        "INSERT INTO tenant_voice_service_versions(tenant_id,service_id,version_no,state,flow,validation,checksum_sha256,created_by_subject)"+
        " VALUES($1,$2,1,'draft',$3::jsonb,$4::jsonb,$5,$6) RETURNING id,service_id,version_no,state,flow,validation,checksum_sha256,created_at",
        [id,created.id,JSON.stringify(check.flow),JSON.stringify(validation),checksum,actor||null]
      ))[0];
      await tx.unsafe("INSERT INTO tenant_voice_service_events(tenant_id,service_id,version_id,event_type,actor_type,actor_subject,details) VALUES($1,$2,$3,'created','customer',$4,$5::jsonb)",[id,created.id,version.id,actor||null,JSON.stringify({name:normalized.name,sva_number_id:normalized.sva_number_id,valid:check.valid})]);
      await tx.unsafe("INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,NULL,'voice_service.create','tenant_voice_service',$2,$3::jsonb)",[id,String(created.id),JSON.stringify({actor_subject:actor||null,name:normalized.name,sva_number_id:normalized.sva_number_id,version_no:1})]);
      return {...created,draft:version,validation};
    });
    this.eventBus.publish("voice_service.created",{tenant_id:id,service_id:Number(result.id)});return result;
  }

  async saveCustomerVoiceDraft(tenantId,serviceId,input={},actorSubject=""){
    const id=Number(tenantId),sid=Number(serviceId);if(!Number.isInteger(id)||id<=0||!Number.isInteger(sid)||sid<=0)throw problem(400,"INVALID_VOICE_SERVICE_ID");
    const normalized=normalizeVoiceServiceInput(input),check=validateVoiceFlow(normalized.flow),checksum=voiceFlowChecksum(check.flow),actor=String(actorSubject||"").slice(0,160);
    const validation={valid:check.valid,errors:check.errors,warnings:check.warnings,node_count:check.node_count,features:check.features};
    const result=await this.withTenantContext(id,async tx=>{
      const service=(await tx.unsafe("SELECT id,status FROM tenant_voice_services WHERE id=$1 AND tenant_id=$2 FOR UPDATE",[sid,id]))[0];
      if(!service)throw problem(404,"VOICE_SERVICE_NOT_FOUND");if(service.status==="archived")throw problem(409,"VOICE_SERVICE_ARCHIVED");
      if(normalized.sva_number_id!=null){
        const n=await tx.unsafe("SELECT id FROM tenant_scoped_sva_numbers WHERE id=$1 LIMIT 1",[normalized.sva_number_id]);
        if(!n[0])throw problem(404,"SVA_NUMBER_NOT_FOUND");
      }
      const next=(await tx.unsafe("SELECT COALESCE(max(version_no),0)::int+1 AS version_no FROM tenant_voice_service_versions WHERE tenant_id=$1 AND service_id=$2",[id,sid]))[0].version_no;
      const version=(await tx.unsafe(
        "INSERT INTO tenant_voice_service_versions(tenant_id,service_id,version_no,state,flow,validation,checksum_sha256,created_by_subject) VALUES($1,$2,$3,'draft',$4::jsonb,$5::jsonb,$6,$7)"+
        " RETURNING id,service_id,version_no,state,flow,validation,checksum_sha256,created_at",
        [id,sid,next,JSON.stringify(check.flow),JSON.stringify(validation),checksum,actor||null]
      ))[0];
      const updated=(await tx.unsafe("UPDATE tenant_voice_services SET sva_number_id=$1,name=$2,timezone=$3,default_locale=$4,status=CASE WHEN status='published' THEN status ELSE 'draft' END,updated_at=now() WHERE id=$5 AND tenant_id=$6 RETURNING id,sva_number_id,name,status,timezone,default_locale,active_version_id,published_at,updated_at",[normalized.sva_number_id,normalized.name,normalized.timezone,normalized.default_locale,sid,id]))[0];
      await tx.unsafe("INSERT INTO tenant_voice_service_events(tenant_id,service_id,version_id,event_type,actor_type,actor_subject,details) VALUES($1,$2,$3,'draft_saved','customer',$4,$5::jsonb)",[id,sid,version.id,actor||null,JSON.stringify({version_no:next,valid:check.valid,checksum})]);
      return {...updated,draft:version,validation};
    });
    this.eventBus.publish("voice_service.draft_saved",{tenant_id:id,service_id:sid,version_no:result.draft.version_no});return result;
  }

  async simulateCustomerVoiceService(tenantId,serviceId,input={}){
    const id=Number(tenantId),sid=Number(serviceId);if(!Number.isInteger(id)||id<=0||!Number.isInteger(sid)||sid<=0)throw problem(400,"INVALID_VOICE_SERVICE_ID");
    let flow=input.flow&&typeof input.flow==="object"?input.flow:null;
    if(!flow){
      const rows=await this.withTenantReadContext(id,tx=>tx.unsafe("SELECT flow FROM tenant_scoped_voice_service_versions WHERE service_id=$1 ORDER BY version_no DESC LIMIT 1",[sid]));
      if(!rows[0])throw problem(404,"VOICE_SERVICE_NOT_FOUND");flow=rows[0].flow;
    }
    const result=simulateVoiceFlow(flow,input.simulation||{});
    await this.withTenantContext(id,async tx=>{await tx.unsafe("INSERT INTO tenant_voice_service_events(tenant_id,service_id,event_type,actor_type,details) SELECT $1,$2,'simulated','customer',$3::jsonb WHERE EXISTS(SELECT 1 FROM tenant_voice_services WHERE id=$2 AND tenant_id=$1)",[id,sid,JSON.stringify({valid:result.valid,path_length:result.path.length,result:result.result?.action||null})]);});
    return result;
  }

  async publishCustomerVoiceService(tenantId,serviceId,actorSubject=""){
    const id=Number(tenantId),sid=Number(serviceId);if(!Number.isInteger(id)||id<=0||!Number.isInteger(sid)||sid<=0)throw problem(400,"INVALID_VOICE_SERVICE_ID");
    const actor=String(actorSubject||"").slice(0,160);
    const result=await this.withTenantContext(id,async tx=>{
      const service=(await tx.unsafe("SELECT id,status FROM tenant_voice_services WHERE id=$1 AND tenant_id=$2 FOR UPDATE",[sid,id]))[0];
      if(!service)throw problem(404,"VOICE_SERVICE_NOT_FOUND");if(service.status==="archived")throw problem(409,"VOICE_SERVICE_ARCHIVED");
      const version=(await tx.unsafe("SELECT id,version_no,flow,validation,checksum_sha256 FROM tenant_voice_service_versions WHERE tenant_id=$1 AND service_id=$2 ORDER BY version_no DESC LIMIT 1 FOR UPDATE",[id,sid]))[0];
      if(!version)throw problem(404,"VOICE_SERVICE_VERSION_NOT_FOUND");
      const check=validateVoiceFlow(version.flow);if(!check.valid)throw problem(409,"VOICE_FLOW_INVALID");
      await tx.unsafe("UPDATE tenant_voice_service_versions SET state='retired' WHERE tenant_id=$1 AND service_id=$2 AND state='published'",[id,sid]);
      const published=(await tx.unsafe("UPDATE tenant_voice_service_versions SET state='published',published_at=now(),validation=$1::jsonb WHERE id=$2 AND tenant_id=$3 RETURNING id,version_no,state,published_at,checksum_sha256",[JSON.stringify({valid:true,errors:[],warnings:check.warnings,node_count:check.node_count,features:check.features}),version.id,id]))[0];
      const updated=(await tx.unsafe("UPDATE tenant_voice_services SET active_version_id=$1,status='published',published_at=now(),updated_at=now() WHERE id=$2 AND tenant_id=$3 RETURNING id,name,status,active_version_id,published_at,updated_at",[version.id,sid,id]))[0];
      await tx.unsafe("INSERT INTO tenant_voice_service_events(tenant_id,service_id,version_id,event_type,actor_type,actor_subject,details) VALUES($1,$2,$3,'published','customer',$4,$5::jsonb)",[id,sid,version.id,actor||null,JSON.stringify({version_no:version.version_no,checksum:version.checksum_sha256,warnings:check.warnings.length})]);
      await tx.unsafe("INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload) VALUES($1,'voice_service.published','tenant_voice_service',$2,$3::jsonb)",[id,String(sid),JSON.stringify({service_id:sid,version_id:Number(version.id),version_no:Number(version.version_no),checksum:version.checksum_sha256})]);
      return {...updated,version:published,validation:{valid:true,errors:[],warnings:check.warnings,node_count:check.node_count,features:check.features}};
    });
    this.eventBus.publish("voice_service.published",{tenant_id:id,service_id:sid,version_id:Number(result.active_version_id)});return result;
  }

  async rollbackCustomerVoiceService(tenantId,serviceId,versionId,actorSubject=""){
    const id=Number(tenantId),sid=Number(serviceId),vid=Number(versionId);if(!Number.isInteger(id)||id<=0||!Number.isInteger(sid)||sid<=0||!Number.isInteger(vid)||vid<=0)throw problem(400,"INVALID_VOICE_SERVICE_VERSION_ID");
    const actor=String(actorSubject||"").slice(0,160);
    const result=await this.withTenantContext(id,async tx=>{
      const service=(await tx.unsafe("SELECT id,status,active_version_id FROM tenant_voice_services WHERE id=$1 AND tenant_id=$2 FOR UPDATE",[sid,id]))[0];
      if(!service)throw problem(404,"VOICE_SERVICE_NOT_FOUND");
      const source=(await tx.unsafe("SELECT id,version_no,flow FROM tenant_voice_service_versions WHERE id=$1 AND tenant_id=$2 AND service_id=$3",[vid,id,sid]))[0];
      if(!source)throw problem(404,"VOICE_SERVICE_VERSION_NOT_FOUND");
      const check=validateVoiceFlow(source.flow);if(!check.valid)throw problem(409,"VOICE_FLOW_INVALID");
      const next=(await tx.unsafe("SELECT COALESCE(max(version_no),0)::int+1 AS version_no FROM tenant_voice_service_versions WHERE tenant_id=$1 AND service_id=$2",[id,sid]))[0].version_no,checksum=voiceFlowChecksum(check.flow);
      await tx.unsafe("UPDATE tenant_voice_service_versions SET state='retired' WHERE tenant_id=$1 AND service_id=$2 AND state='published'",[id,sid]);
      const version=(await tx.unsafe("INSERT INTO tenant_voice_service_versions(tenant_id,service_id,version_no,state,flow,validation,checksum_sha256,source_version_id,created_by_subject,published_at) VALUES($1,$2,$3,'published',$4::jsonb,$5::jsonb,$6,$7,$8,now()) RETURNING id,version_no,state,published_at,checksum_sha256",[id,sid,next,JSON.stringify(check.flow),JSON.stringify({valid:true,errors:[],warnings:check.warnings,node_count:check.node_count,features:check.features}),checksum,vid,actor||null]))[0];
      const updated=(await tx.unsafe("UPDATE tenant_voice_services SET active_version_id=$1,status='published',published_at=now(),updated_at=now() WHERE id=$2 AND tenant_id=$3 RETURNING id,name,status,active_version_id,published_at,updated_at",[version.id,sid,id]))[0];
      await tx.unsafe("INSERT INTO tenant_voice_service_events(tenant_id,service_id,version_id,event_type,actor_type,actor_subject,details) VALUES($1,$2,$3,'rolled_back','customer',$4,$5::jsonb)",[id,sid,version.id,actor||null,JSON.stringify({source_version_id:vid,source_version_no:Number(source.version_no),new_version_no:Number(next)})]);
      await tx.unsafe("INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload) VALUES($1,'voice_service.published','tenant_voice_service',$2,$3::jsonb)",[id,String(sid),JSON.stringify({service_id:sid,version_id:Number(version.id),version_no:Number(next),rollback_from:vid,checksum})]);
      return {...updated,version};
    });
    this.eventBus.publish("voice_service.rolled_back",{tenant_id:id,service_id:sid,version_id:Number(result.active_version_id),source_version_id:vid});return result;
  }


  async listWebauthnCredentials(ownerType,ownerId){
    if(ownerType==="staff"){
      const id=Number(ownerId);if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_WEBAUTHN_OWNER");
      return this.readSql.unsafe("SELECT id,public_id::text AS public_id,credential_id,sign_count,transports,label,enabled,created_at,last_verified_at FROM webauthn_credentials WHERE owner_type='staff' AND staff_user_id=$1 ORDER BY enabled DESC,id",[id]);
    }
    const id=String(ownerId||"");if(!id)throw problem(400,"INVALID_WEBAUTHN_OWNER");
    return this.readSql.unsafe("SELECT id,public_id::text AS public_id,credential_id,sign_count,transports,label,enabled,created_at,last_verified_at FROM webauthn_credentials WHERE owner_type='customer' AND customer_principal_id=$1::uuid ORDER BY enabled DESC,id",[id]);
  }

  async registerWebauthnCredential(ownerType,ownerId,input={}){
    const transports=Array.isArray(input.transports)?input.transports.slice(0,8):[],label=String(input.label||"Passkey").slice(0,120);
    try{
      const rows=ownerType==="staff"
        ?await this.sql.unsafe("INSERT INTO webauthn_credentials(owner_type,staff_user_id,credential_id,public_key_spki,sign_count,transports,label) VALUES('staff',$1,$2,$3,$4,$5::jsonb,$6) RETURNING id,public_id::text AS public_id,credential_id,sign_count,transports,label,enabled,created_at",[Number(ownerId),input.credential_id,input.public_key_spki,Number(input.sign_count||0),JSON.stringify(transports),label])
        :await this.sql.unsafe("INSERT INTO webauthn_credentials(owner_type,customer_principal_id,credential_id,public_key_spki,sign_count,transports,label) VALUES('customer',$1::uuid,$2,$3,$4,$5::jsonb,$6) RETURNING id,public_id::text AS public_id,credential_id,sign_count,transports,label,enabled,created_at",[String(ownerId),input.credential_id,input.public_key_spki,Number(input.sign_count||0),JSON.stringify(transports),label]);
      return rows[0];
    }catch(error){if(String(error?.code)==="23505")throw problem(409,"WEBAUTHN_CREDENTIAL_EXISTS");throw error;}
  }

  async webauthnCredential(ownerType,ownerId,credentialId){
    const rows=ownerType==="staff"
      ?await this.readSql.unsafe("SELECT id,credential_id,public_key_spki,sign_count,transports,label,enabled FROM webauthn_credentials WHERE owner_type='staff' AND staff_user_id=$1 AND credential_id=$2 AND enabled=true LIMIT 1",[Number(ownerId),String(credentialId)])
      :await this.readSql.unsafe("SELECT id,credential_id,public_key_spki,sign_count,transports,label,enabled FROM webauthn_credentials WHERE owner_type='customer' AND customer_principal_id=$1::uuid AND credential_id=$2 AND enabled=true LIMIT 1",[String(ownerId),String(credentialId)]);
    return rows[0]||null;
  }

  async markWebauthnVerified(id,signCount){
    const next=Math.max(0,Number(signCount||0));
    const rows=await this.sql.unsafe("UPDATE webauthn_credentials SET sign_count=CASE WHEN $2>0 THEN $2 ELSE sign_count END,last_verified_at=now(),updated_at=now() WHERE id=$1 RETURNING id,public_id::text AS public_id,last_verified_at,sign_count",[Number(id),next]);
    if(!rows[0])throw problem(404,"WEBAUTHN_CREDENTIAL_NOT_FOUND");return rows[0];
  }

  async simulateTenantRouting(publicTenantId,input={}){
    const publicId=String(publicTenantId||"").trim();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(publicId))throw problem(400,"INVALID_TENANT_PUBLIC_ID");
    const tenant=(await this.readSql.unsafe("SELECT id FROM tenants WHERE public_id=$1::uuid AND tenant_type<>'internal' LIMIT 1",[publicId]))[0];
    if(!tenant)throw problem(404,"TENANT_NOT_FOUND");
    return this.simulateTenantRoutingById(Number(tenant.id),input);
  }

  async simulateTenantRoutingById(tenantId,input={}){
    const id=Number(tenantId);
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_ID");
    let svaId=input.sva_number_id==null||input.sva_number_id===""?null:Number(input.sva_number_id);
    const assignmentId=input.assignment_id==null||input.assignment_id===""?null:Number(input.assignment_id);
    if(assignmentId!=null){
      if(!Number.isInteger(assignmentId)||assignmentId<=0)throw problem(400,"INVALID_ASSIGNMENT_ID");
      const assignment=(await this.readSql.unsafe("SELECT sva_number_id FROM tenant_number_assignments WHERE id=$1 AND tenant_id=$2 LIMIT 1",[assignmentId,id]))[0];
      if(!assignment)throw problem(404,"ASSIGNMENT_NOT_FOUND");
      svaId=Number(assignment.sva_number_id);
    }
    if(svaId!=null&&(!Number.isInteger(svaId)||svaId<=0))throw problem(400,"INVALID_SVA_NUMBER_ID");
    if(svaId!=null){
      const number=(await this.readSql.unsafe("SELECT id FROM sva_numbers WHERE id=$1 AND tenant_id=$2 LIMIT 1",[svaId,id]))[0];
      if(!number)throw problem(404,"SVA_NUMBER_NOT_FOUND");
    }
    const rows=await this.readSql.unsafe(
      "SELECT id,sva_number_id,label,destination_type,destination_uri,priority,status,failover_enabled,max_concurrent_calls,active_calls,last_assigned_at,"+
      " (status='active' AND (max_concurrent_calls IS NULL OR active_calls<max_concurrent_calls)) AS eligible"+
      " FROM tenant_call_destinations WHERE tenant_id=$1 AND ($2::bigint IS NULL OR sva_number_id=$2 OR sva_number_id IS NULL)"+
      " ORDER BY CASE WHEN $2::bigint IS NOT NULL AND sva_number_id=$2 THEN 0 ELSE 1 END,priority ASC,active_calls ASC,last_assigned_at NULLS FIRST,id ASC LIMIT 100",
      [id,svaId]
    );
    const eligible=rows.filter(x=>x.eligible===true);
    const chosen=eligible[0]||null;
    const warnings=[];
    if(!rows.length)warnings.push("Aucune destination configurée");
    else if(!eligible.length)warnings.push("Aucune destination actuellement disponible");
    if(rows.some(x=>x.status==="active"&&x.max_concurrent_calls!=null&&Number(x.active_calls)>=Number(x.max_concurrent_calls)))warnings.push("Une ou plusieurs destinations ont atteint leur capacité");
    if(chosen&&chosen.failover_enabled!==true&&eligible.length===1)warnings.push("La destination sélectionnée ne possède pas de secours actif");
    return {
      tenant_id:id,sva_number_id:svaId,dry_run:true,safe_to_activate:Boolean(chosen),
      selected:chosen?{id:Number(chosen.id),label:chosen.label,destination_type:chosen.destination_type,destination_uri:chosen.destination_uri,priority:Number(chosen.priority),active_calls:Number(chosen.active_calls||0),max_concurrent_calls:chosen.max_concurrent_calls==null?null:Number(chosen.max_concurrent_calls)}:null,
      candidates:rows.map(x=>({id:Number(x.id),label:x.label,destination_type:x.destination_type,destination_uri:x.destination_uri,priority:Number(x.priority),status:x.status,eligible:Boolean(x.eligible),failover_enabled:Boolean(x.failover_enabled),active_calls:Number(x.active_calls||0),max_concurrent_calls:x.max_concurrent_calls==null?null:Number(x.max_concurrent_calls)})),
      warnings
    };
  }

  async scanTenantServiceIncidents(limit=250){
    const take=clampInt(limit,250,1,1000),changes=[];
    await this.sql.begin(async tx=>{
      const active=await tx.unsafe(
        "SELECT i.id,i.severity,i.title,i.carrier_id,i.market_id,i.details,c.name AS carrier"+
        " FROM telecom_incidents i LEFT JOIN carriers c ON c.id=i.carrier_id"+
        " WHERE i.state='open' AND i.carrier_role='host' ORDER BY i.last_detected_at DESC LIMIT 50"
      );
      for(const source of active){
        const tenants=await tx.unsafe(
          "SELECT DISTINCT sn.tenant_id FROM number_carrier_assignments nca JOIN sva_numbers sn ON sn.id=nca.sva_number_id"+
          " JOIN tenants t ON t.id=sn.tenant_id WHERE nca.carrier_id=$1 AND nca.assignment_status='active'"+
          " AND (nca.valid_to IS NULL OR nca.valid_to>=now()) AND sn.tenant_id IS NOT NULL AND t.tenant_type<>'internal' LIMIT $2",
          [source.carrier_id,take]
        );
        for(const t of tenants){
          const key="telecom:"+source.id+":tenant:"+t.tenant_id;
          const sev=source.severity==="critical"?"critical":"high",sla=serviceIncidentSla(sev);
          const rows=await tx.unsafe(
            "INSERT INTO tenant_service_incidents(incident_key,tenant_id,source_telecom_incident_id,category,severity,status,source,title,description,first_response_due_at,target_resolution_at,first_responded_at,last_pgi_update_at,diagnostic_snapshot)"+
            " VALUES($1,$2,$3,'telephony',$4,'investigating','system',$5,$6,now()+make_interval(mins=>$7),now()+make_interval(mins=>$8),now(),now(),$9::jsonb)"+
            " ON CONFLICT(incident_key) DO UPDATE SET severity=EXCLUDED.severity,status=CASE WHEN tenant_service_incidents.status IN ('resolved','closed') THEN 'investigating' ELSE tenant_service_incidents.status END,"+
            " last_pgi_update_at=now(),diagnostic_snapshot=EXCLUDED.diagnostic_snapshot,updated_at=now()"+
            " RETURNING id,public_id,tenant_id,(xmax=0) AS created",
            [key,t.tenant_id,source.id,sev,source.title,"Incident réseau détecté automatiquement par Audiotel Premium Pro.",sla.response,sla.resolution,JSON.stringify({carrier:source.carrier,market_id:source.market_id,source_details:source.details||{}})]
          );
          const incident=rows[0];
          if(incident.created){
            await tx.unsafe(
              "INSERT INTO tenant_service_incident_events(incident_id,tenant_id,event_type,actor_type,message,customer_visible,details)"+
              " VALUES($1,$2,'created','system','Incident réseau détecté automatiquement',true,$3::jsonb)",
              [incident.id,incident.tenant_id,JSON.stringify({source_telecom_incident_id:source.id,carrier:source.carrier})]
            );
            await serviceIncidentOutbox(tx,Number(incident.tenant_id),"service.incident.created",incident.id,incident.public_id,{source:"system",source_telecom_incident_id:Number(source.id)});
            changes.push({event:"service.incident.created",tenant_id:Number(incident.tenant_id),incident_id:String(incident.public_id),source:"system"});
          }
          await tx.unsafe(
            "INSERT INTO tenant_operational_alerts(alert_key,tenant_id,incident_id,alert_type,severity,state,title,message,customer_visible,details)"+
            " VALUES($1,$2,$3,'carrier_incident',$4,'open',$5,$6,true,$7::jsonb)"+
            " ON CONFLICT(alert_key) DO UPDATE SET severity=EXCLUDED.severity,state='open',title=EXCLUDED.title,message=EXCLUDED.message,last_detected_at=now(),resolved_at=NULL,updated_at=now()",
            ["carrier:"+source.id+":tenant:"+t.tenant_id,t.tenant_id,incident.id,source.severity==="critical"?"critical":"warning",source.title,"Audiotel Premium Pro a détecté un incident opérateur susceptible d’affecter votre service.",JSON.stringify({carrier:source.carrier,source_telecom_incident_id:source.id})]
          );
        }
      }

      const resolved=await tx.unsafe(
        "UPDATE tenant_service_incidents si SET status='resolved',resolved_at=COALESCE(si.resolved_at,now()),last_pgi_update_at=now(),updated_at=now()"+
        " FROM telecom_incidents ti WHERE si.source_telecom_incident_id=ti.id AND ti.state='resolved' AND si.status NOT IN ('resolved','closed')"+
        " RETURNING si.id,si.public_id,si.tenant_id"
      );
      for(const incident of resolved){
        await tx.unsafe(
          "INSERT INTO tenant_service_incident_events(incident_id,tenant_id,event_type,actor_type,message,customer_visible)"+
          " VALUES($1,$2,'resolved','system','Incident réseau résolu automatiquement',true)",
          [incident.id,incident.tenant_id]
        );
        await serviceIncidentOutbox(tx,Number(incident.tenant_id),"service.incident.resolved",incident.id,incident.public_id,{source:"system"});
        changes.push({event:"service.incident.resolved",tenant_id:Number(incident.tenant_id),incident_id:String(incident.public_id)});
      }
      await tx.unsafe(
        "UPDATE tenant_operational_alerts a SET state='resolved',resolved_at=now(),updated_at=now()"+
        " WHERE a.alert_type='carrier_incident' AND a.state<>'resolved' AND a.incident_id IN ("+
        " SELECT si.id FROM tenant_service_incidents si WHERE si.status IN ('resolved','closed'))"
      );

      const routingAffected=await tx.unsafe(
        "SELECT DISTINCT t.id AS tenant_id FROM tenants t"+
        " WHERE t.tenant_type<>'internal' AND t.status='active'"+
        " AND EXISTS(SELECT 1 FROM tenant_number_assignments a WHERE a.tenant_id=t.id AND a.status='active' AND (a.valid_from IS NULL OR a.valid_from<=now()) AND (a.valid_to IS NULL OR a.valid_to>=now()))"+
        " AND NOT EXISTS(SELECT 1 FROM tenant_call_destinations d WHERE d.tenant_id=t.id AND d.status='active' AND (d.max_concurrent_calls IS NULL OR d.active_calls<d.max_concurrent_calls))"+
        " AND NOT EXISTS(SELECT 1 FROM experts e WHERE e.tenant_id=t.id AND e.enabled AND e.status='available' AND e.destination_uri IS NOT NULL)"+
        " LIMIT $1",
        [take]
      );
      for(const t of routingAffected){
        const key="routing:tenant:"+t.tenant_id,sla=serviceIncidentSla("high");
        const incident=(await tx.unsafe(
          "INSERT INTO tenant_service_incidents(incident_key,tenant_id,category,severity,status,source,title,description,first_response_due_at,target_resolution_at,first_responded_at,last_pgi_update_at,diagnostic_snapshot)"+
          " VALUES($1,$2,'routing','high','investigating','system','Routage client indisponible','Audiotel Premium Pro ne détecte aucune destination, aucun service ni intervenant actuellement disponible pour les lignes actives de ce client.',now()+make_interval(mins=>$3),now()+make_interval(mins=>$4),now(),now(),$5::jsonb)"+
          " ON CONFLICT(incident_key) DO UPDATE SET status=CASE WHEN tenant_service_incidents.status IN ('resolved','closed') THEN 'investigating' ELSE tenant_service_incidents.status END,last_pgi_update_at=now(),diagnostic_snapshot=EXCLUDED.diagnostic_snapshot,updated_at=now()"+
          " RETURNING id,public_id,tenant_id,(xmax=0) AS created",
          [key,t.tenant_id,sla.response,sla.resolution,JSON.stringify({reason:"no_available_destination_or_expert"})]
        ))[0];
        if(incident.created){
          await tx.unsafe(
            "INSERT INTO tenant_service_incident_events(incident_id,tenant_id,event_type,actor_type,message,customer_visible) VALUES($1,$2,'created','system','Routage indisponible détecté automatiquement',true)",
            [incident.id,incident.tenant_id]
          );
          await serviceIncidentOutbox(tx,Number(incident.tenant_id),"service.incident.created",incident.id,incident.public_id,{source:"routing"});
          changes.push({event:"service.incident.created",tenant_id:Number(incident.tenant_id),incident_id:String(incident.public_id),source:"routing"});
        }
        await tx.unsafe(
          "INSERT INTO tenant_operational_alerts(alert_key,tenant_id,incident_id,alert_type,severity,state,title,message,customer_visible,details)"+
          " VALUES($1,$2,$3,'routing_unavailable','critical','open','Routage indisponible','Aucune destination, aucun service ni intervenant n’est actuellement disponible pour vos lignes actives.',true,$4::jsonb)"+
          " ON CONFLICT(alert_key) DO UPDATE SET incident_id=EXCLUDED.incident_id,state='open',last_detected_at=now(),resolved_at=NULL,updated_at=now()",
          ["routing:tenant:"+t.tenant_id,t.tenant_id,incident.id,JSON.stringify({auto_detected:true})]
        );
      }
      const routingRecovered=await tx.unsafe(
        "UPDATE tenant_service_incidents i SET status='resolved',resolved_at=COALESCE(resolved_at,now()),last_pgi_update_at=now(),updated_at=now()"+
        " WHERE i.incident_key='routing:tenant:'||i.tenant_id AND i.status NOT IN ('resolved','closed')"+
        " AND (EXISTS(SELECT 1 FROM tenant_call_destinations d WHERE d.tenant_id=i.tenant_id AND d.status='active' AND (d.max_concurrent_calls IS NULL OR d.active_calls<d.max_concurrent_calls))"+
        " OR EXISTS(SELECT 1 FROM experts e WHERE e.tenant_id=i.tenant_id AND e.enabled AND e.status='available' AND e.destination_uri IS NOT NULL))"+
        " RETURNING i.id,i.public_id,i.tenant_id"
      );
      for(const incident of routingRecovered){
        await tx.unsafe(
          "INSERT INTO tenant_service_incident_events(incident_id,tenant_id,event_type,actor_type,message,customer_visible) VALUES($1,$2,'resolved','system','Routage de nouveau disponible',true)",
          [incident.id,incident.tenant_id]
        );
        await serviceIncidentOutbox(tx,Number(incident.tenant_id),"service.incident.resolved",incident.id,incident.public_id,{source:"routing"});
        changes.push({event:"service.incident.resolved",tenant_id:Number(incident.tenant_id),incident_id:String(incident.public_id),source:"routing"});
      }
      await tx.unsafe(
        "UPDATE tenant_operational_alerts a SET state='resolved',resolved_at=now(),updated_at=now()"+
        " WHERE a.alert_type='routing_unavailable' AND a.state<>'resolved'"+
        " AND (EXISTS(SELECT 1 FROM tenant_call_destinations d WHERE d.tenant_id=a.tenant_id AND d.status='active' AND (d.max_concurrent_calls IS NULL OR d.active_calls<d.max_concurrent_calls))"+
        " OR EXISTS(SELECT 1 FROM experts e WHERE e.tenant_id=a.tenant_id AND e.enabled AND e.status='available' AND e.destination_uri IS NOT NULL))"
      );

      await tx.unsafe(
        "INSERT INTO tenant_operational_alerts(alert_key,tenant_id,alert_type,severity,state,title,message,customer_visible,due_at,details)"+
        " SELECT 'portability:'||p.id,p.tenant_id,'portability_attention',CASE WHEN p.automation_state='failed' THEN 'critical' ELSE 'warning' END,'open',"+
        " 'Portabilité à traiter','Une portabilité automatique nécessite une intervention Audiotel Premium Pro.',false,p.automation_next_at,"+
        " jsonb_build_object('request_id',p.id,'number',p.requested_e164,'automation_state',p.automation_state,'last_error',p.automation_last_error)"+
        " FROM tenant_portability_requests p WHERE p.status NOT IN ('ported','cancelled','rejected') AND p.automation_state IN ('action_required','failed')"+
        " ON CONFLICT(alert_key) DO UPDATE SET severity=EXCLUDED.severity,state='open',message=EXCLUDED.message,due_at=EXCLUDED.due_at,details=EXCLUDED.details,last_detected_at=now(),resolved_at=NULL,updated_at=now()"
      );
      await tx.unsafe(
        "UPDATE tenant_operational_alerts a SET state='resolved',resolved_at=now(),updated_at=now()"+
        " WHERE a.alert_type='portability_attention' AND a.state<>'resolved'"+
        " AND NOT EXISTS(SELECT 1 FROM tenant_portability_requests p WHERE ('portability:'||p.id)=a.alert_key AND p.status NOT IN ('ported','cancelled','rejected') AND p.automation_state IN ('action_required','failed'))"
      );

      const responseAlerts=await tx.unsafe(
        "INSERT INTO tenant_operational_alerts(alert_key,tenant_id,incident_id,alert_type,severity,state,title,message,customer_visible,due_at,details)"+
        " SELECT 'sla:first:'||i.id,i.tenant_id,i.id,'first_response_due',CASE WHEN i.severity='critical' THEN 'critical' ELSE 'warning' END,'open',"+
        " 'Prise en charge à effectuer','Le délai cible de première réponse du dossier approche ou est dépassé.',false,i.first_response_due_at,jsonb_build_object('incident_public_id',i.public_id)"+
        " FROM tenant_service_incidents i WHERE i.status NOT IN ('resolved','closed') AND i.first_responded_at IS NULL AND i.first_response_due_at<=now()+interval '15 minutes'"+
        " ON CONFLICT(alert_key) DO UPDATE SET state='open',last_detected_at=now(),resolved_at=NULL,updated_at=now() RETURNING id"
      );
      const resolutionAlerts=await tx.unsafe(
        "INSERT INTO tenant_operational_alerts(alert_key,tenant_id,incident_id,alert_type,severity,state,title,message,customer_visible,due_at,details)"+
        " SELECT 'sla:resolve:'||i.id,i.tenant_id,i.id,'resolution_due',CASE WHEN i.severity IN ('critical','high') THEN 'critical' ELSE 'warning' END,'open',"+
        " 'Résolution à accélérer','Le délai cible de résolution du dossier approche ou est dépassé.',false,i.target_resolution_at,jsonb_build_object('incident_public_id',i.public_id)"+
        " FROM tenant_service_incidents i WHERE i.status NOT IN ('resolved','closed') AND i.target_resolution_at<=now()+interval '30 minutes'"+
        " ON CONFLICT(alert_key) DO UPDATE SET state='open',last_detected_at=now(),resolved_at=NULL,updated_at=now() RETURNING id"
      );
      await tx.unsafe(
        "UPDATE tenant_operational_alerts a SET state='resolved',resolved_at=now(),updated_at=now()"+
        " WHERE a.alert_type='first_response_due' AND a.state<>'resolved' AND EXISTS(SELECT 1 FROM tenant_service_incidents i WHERE i.id=a.incident_id AND (i.first_responded_at IS NOT NULL OR i.status IN ('resolved','closed')))"
      );
      await tx.unsafe(
        "UPDATE tenant_operational_alerts a SET state='resolved',resolved_at=now(),updated_at=now()"+
        " WHERE a.alert_type='resolution_due' AND a.state<>'resolved' AND EXISTS(SELECT 1 FROM tenant_service_incidents i WHERE i.id=a.incident_id AND i.status IN ('resolved','closed'))"
      );
      if(responseAlerts.length||resolutionAlerts.length)changes.push({event:"service.sla.attention",response_alerts:responseAlerts.length,resolution_alerts:resolutionAlerts.length});
    });
    for(const change of changes)this.eventBus.publish(change.event,change);
    return changes;
  }

  async listServiceIncidents(params={}){
    const limit=clampInt(params.limit,50,1,250),cursor=decodeNumericCursor(params.cursor);
    const status=params.status?String(params.status).trim().toLowerCase():null;
    const severity=params.severity?String(params.severity).trim().toLowerCase():null;
    const category=params.category?String(params.category).trim().toLowerCase():null;
    const country=params.country?String(params.country).trim().toUpperCase():null;
    const q=params.q?String(params.q).trim().slice(0,160):null;
    if(status&&!["active","open","investigating","waiting_customer","monitoring","resolved","closed"].includes(status))throw problem(400,"INVALID_INCIDENT_STATUS");
    if(severity&&!["low","normal","high","critical"].includes(severity))throw problem(400,"INVALID_INCIDENT_SEVERITY");
    if(category&&!["telephony","portability","billing","payout","account","routing","quality","other"].includes(category))throw problem(400,"INVALID_INCIDENT_CATEGORY");
    if(country&&!/^[A-Z]{2}$/.test(country))throw problem(400,"INVALID_COUNTRY_CODE");
    const rows=await this.readSql.unsafe(
      "SELECT i.id AS _cursor_id,i.public_id,i.category,i.severity,i.status,i.source,i.title,i.description,i.assigned_team,"+
      " i.first_response_due_at,i.target_resolution_at,i.first_responded_at,i.last_customer_update_at,i.last_pgi_update_at,i.resolved_at,i.updated_at,"+
      " (i.first_responded_at IS NULL AND i.first_response_due_at<now()) AS first_response_overdue,"+
      " (i.status NOT IN ('resolved','closed') AND i.target_resolution_at<now()) AS resolution_overdue,"+
      " t.public_id AS tenant_public_id,t.display_name AS tenant,t.country_code,sn.display_number,sn.e164"+
      " FROM tenant_service_incidents i JOIN tenants t ON t.id=i.tenant_id LEFT JOIN sva_numbers sn ON sn.id=i.sva_number_id"+
      " WHERE t.tenant_type<>'internal'"+
      " AND ($1::text IS NULL OR ($1='active' AND i.status NOT IN ('resolved','closed')) OR i.status=$1) AND ($2::text IS NULL OR i.severity=$2)"+
      " AND ($3::text IS NULL OR i.category=$3) AND ($4::text IS NULL OR t.country_code=$4)"+
      " AND ($5::text IS NULL OR t.display_name ILIKE '%'||$5||'%' OR i.title ILIKE '%'||$5||'%' OR i.description ILIKE '%'||$5||'%' OR sn.e164 ILIKE '%'||$5||'%')"+
      " AND ($6::bigint IS NULL OR i.id<$6) ORDER BY i.id DESC LIMIT $7",
      [status,severity,category,country,q,cursor,limit+1]
    );
    const hasMore=rows.length>limit,page=hasMore?rows.slice(0,limit):rows;
    return {
      data:page.map(row=>{const {_cursor_id,...publicRow}=row;return publicRow;}),
      next_cursor:hasMore&&page.length?encodeNumericCursor(Number(page.at(-1)._cursor_id)):null
    };
  }

  async customerAdminSummary(){
    const rows=await this.readSql.unsafe(
      "SELECT"+
      " (SELECT count(*)::int FROM tenants WHERE tenant_type<>'internal') AS tenants_total,"+
      " (SELECT count(*)::int FROM tenants WHERE tenant_type<>'internal' AND status='active') AS tenants_active,"+
      " (SELECT count(*)::int FROM tenants WHERE tenant_type<>'internal' AND created_at>=now()-interval '24 hours') AS tenants_new_24h,"+
      " (SELECT count(*)::int FROM tenants WHERE tenant_type<>'internal' AND created_at>=now()-interval '7 days') AS tenants_new_7d,"+
      " (SELECT max(created_at) FROM tenants WHERE tenant_type<>'internal') AS latest_tenant_created_at,"+
      " (SELECT count(*)::int FROM tenant_kyc_profiles k JOIN tenants t ON t.id=k.tenant_id WHERE t.tenant_type<>'internal' AND k.status='pending') AS kyc_pending,"+
      " (SELECT count(*)::int FROM tenant_admin_alerts a JOIN tenants t ON t.id=a.tenant_id WHERE t.tenant_type<>'internal' AND a.alert_type='subscription_unpaid' AND a.state<>'resolved') AS subscription_unpaid_alerts,"+
      " (SELECT count(*)::int FROM tenant_subscription_access WHERE tenant_type<>'internal' AND NOT premium_call_access) AS subscription_access_blocked,"+
      " (SELECT count(*)::int FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id WHERE t.tenant_type<>'internal' AND a.status='active') AS assignments_active,"+
      " (SELECT count(*)::int FROM tenant_service_incidents i JOIN tenants t ON t.id=i.tenant_id WHERE t.tenant_type<>'internal' AND i.status NOT IN ('resolved','closed')) AS service_incidents_open,"+
      " (SELECT count(*)::int FROM tenant_service_incidents i JOIN tenants t ON t.id=i.tenant_id WHERE t.tenant_type<>'internal' AND i.status NOT IN ('resolved','closed') AND i.severity='critical') AS service_incidents_critical,"+
      " (SELECT count(*)::int FROM tenant_operational_alerts a JOIN tenants t ON t.id=a.tenant_id WHERE t.tenant_type<>'internal' AND a.state<>'resolved' AND a.alert_type IN ('first_response_due','resolution_due')) AS service_sla_attention,"+
      " (SELECT count(*)::int FROM tenant_operational_alerts a JOIN tenants t ON t.id=a.tenant_id WHERE t.tenant_type<>'internal' AND a.state<>'resolved' AND a.alert_type='routing_unavailable') AS routing_attention,"+
      " (SELECT count(*)::int FROM tenant_operational_alerts a JOIN tenants t ON t.id=a.tenant_id WHERE t.tenant_type<>'internal' AND a.state<>'resolved' AND a.alert_type='portability_attention') AS portability_attention"
    );
    return rows[0]||{tenants_total:0,tenants_active:0,kyc_pending:0,subscription_unpaid_alerts:0,subscription_access_blocked:0,assignments_active:0,service_incidents_open:0,service_incidents_critical:0,service_sla_attention:0,routing_attention:0,portability_attention:0};
  }


  async customerRelationsOverview(tenantId,options={}){
    const id=Number(tenantId),admin=options.admin===true;
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_ID");
    const tenant=(await this.readSql.unsafe("SELECT id,public_id,display_name,tenant_type,status,country_code,default_currency FROM tenants WHERE id=$1",[id]))[0];
    if(!tenant||tenant.tenant_type==="internal")throw problem(404,"TENANT_NOT_FOUND");
    const [cases,exits,exitLines,events,actions,evidence,holds]=await Promise.all([
      this.readSql.unsafe(
        "SELECT id,public_id,case_kind,status,priority,source,customer_capacity,title,description,disputed_amount::float8,disputed_currency,invoice_reference,payment_reference,disputed_period_start,disputed_period_end,requested_resolution,formal_complaint_at,mediation_eligible_at,legal_hold,ai_state,ai_confidence::float8,ai_policy_version,first_response_due_at,target_resolution_at,first_responded_at,last_customer_update_at,last_pgi_update_at,resolved_at,closed_at,resolution_code,resolution_summary,created_at,updated_at FROM tenant_relation_cases WHERE tenant_id=$1 ORDER BY (status IN ('resolved','closed','cancelled')) ASC,updated_at DESC,id DESC LIMIT 100",
        [id]
      ),
      this.readSql.unsafe(
        "SELECT id,public_id,case_id,exit_scope,reason_category,requested_effective_date,number_retention_preference,port_out_requested,target_operator_name,operator_reference,status,final_invoice_status,final_settlement_status,data_export_status,contract_obligations_acknowledged,customer_confirmed,scheduled_at,access_revocation_at,number_quarantine_until,completed_at,created_at,updated_at FROM tenant_exit_requests WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50",
        [id]
      ),
      this.readSql.unsafe(
        "SELECT l.id,l.exit_request_id,l.assignment_id,l.sva_number_id,l.e164_snapshot,l.requested_action,l.status,l.operator_reference,l.rio_status,l.rio_last4,l.rio_requested_at,l.rio_delivered_at,l.rio_delivery_channel,l.rio_delivery_reference,l.portability_eligibility_status,l.portability_eligibility_reason,l.portability_eligibility_checked_at,l.portability_service_level,l.recovery_option,l.scheduled_at,l.completed_at,l.created_at FROM tenant_exit_lines l WHERE l.tenant_id=$1 ORDER BY l.created_at,l.id LIMIT 500",
        [id]
      ),
      this.readSql.unsafe(
        "SELECT e.id,e.case_id,e.event_type,e.actor_type,e.message,e.customer_visible,e.details,e.occurred_at FROM tenant_relation_case_events e WHERE e.tenant_id=$1 AND ($2::boolean OR e.customer_visible=true) ORDER BY e.occurred_at,e.id LIMIT 500",
        [id,admin]
      ),
      admin?this.readSql.unsafe(
        "SELECT id,public_id,case_id,exit_line_id,action_type,risk_class,execution_mode,status,proposed_by,confidence::float8,explanation,payload,result,approved_at,executed_at,created_at FROM tenant_relation_actions WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 250",
        [id]
      ):Promise.resolve([]),
      admin?this.readSql.unsafe(
        "SELECT id,case_id,evidence_kind,source_table,source_id,external_reference,content_sha256,metadata,created_at FROM tenant_relation_evidence WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 250",
        [id]
      ):Promise.resolve([]),
      this.readSql.unsafe(
        "SELECT id,case_id,amount::float8,currency,scope,invoice_reference,status,reason,created_by_type,released_at,created_at FROM tenant_dispute_collection_holds WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100",
        [id]
      )
    ]);
    return {schema_version:"audiotel-customer-relations/1",tenant:{public_id:tenant.public_id,display_name:tenant.display_name,status:tenant.status,country_code:tenant.country_code,default_currency:tenant.default_currency},cases,exits,exit_lines:exitLines,events,actions,evidence,holds,agent_policy_version:RELATION_POLICY_VERSION};
  }

  async createCustomerRelationCase(tenantId,input={},principalId){
    const id=Number(tenantId),principal=String(principalId||"").trim();
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_ID");
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(principal))throw problem(401,"CUSTOMER_AUTH_REQUIRED");
    const kind=String(input.case_kind||"billing_dispute").trim().toLowerCase();
    if(!["billing_dispute","payout_dispute","service_complaint","other"].includes(kind))throw problem(400,"INVALID_RELATION_CASE_KIND");
    const priority=String(input.priority||"normal").trim().toLowerCase();
    if(!["low","normal","high","critical"].includes(priority))throw problem(400,"INVALID_RELATION_PRIORITY");
    const capacity=String(input.customer_capacity||"unknown").trim().toLowerCase();
    if(!["business","consumer","unknown"].includes(capacity))throw problem(400,"INVALID_CUSTOMER_CAPACITY");
    const title=String(input.title||"").trim(),description=String(input.description||"").trim();
    if(title.length<3||title.length>180||description.length<3||description.length>8000)throw problem(400,"INVALID_RELATION_CONTENT");
    const amount=input.disputed_amount==null||input.disputed_amount===""?null:Number(input.disputed_amount);
    if(amount!=null&&(!Number.isFinite(amount)||amount<0||amount>1e12))throw problem(400,"INVALID_DISPUTED_AMOUNT");
    const currency=amount==null?null:String(input.disputed_currency||"").trim().toUpperCase();
    if(amount!=null&&!/^[A-Z]{3}$/.test(currency))throw problem(400,"INVALID_CURRENCY");
    const invoice=String(input.invoice_reference||"").trim().slice(0,200)||null;
    const payment=String(input.payment_reference||"").trim().slice(0,200)||null;
    const requested=String(input.requested_resolution||"").trim().slice(0,2000)||null;
    const start=input.disputed_period_start?String(input.disputed_period_start):null,end=input.disputed_period_end?String(input.disputed_period_end):null;
    const deadlines=relationCaseDeadlines(kind,priority,capacity,new Date());
    const row=await this.sql.begin(async tx=>{
      const tenant=(await tx.unsafe("SELECT id,tenant_type,status FROM tenants WHERE id=$1 FOR UPDATE",[id]))[0];
      if(!tenant||tenant.tenant_type==="internal")throw problem(404,"TENANT_NOT_FOUND");
      if(tenant.status==="closed")throw problem(409,"TENANT_CLOSED");
      const created=(await tx.unsafe(
        "INSERT INTO tenant_relation_cases(tenant_id,case_kind,status,priority,source,customer_capacity,title,description,created_by_customer_principal_id,disputed_amount,disputed_currency,invoice_reference,payment_reference,disputed_period_start,disputed_period_end,requested_resolution,formal_complaint_at,mediation_eligible_at,first_response_due_at,target_resolution_at,last_customer_update_at,ai_policy_version) VALUES($1,$2,'open',$3,'customer',$4,$5,$6,$7::uuid,$8,$9,$10,$11,$12::date,$13::date,$14,now(),$15::timestamptz,$16::timestamptz,$17::timestamptz,now(),$18) RETURNING id,public_id,tenant_id,case_kind,status,priority,customer_capacity,title,description,disputed_amount::float8,disputed_currency,invoice_reference,payment_reference,formal_complaint_at,mediation_eligible_at,first_response_due_at,target_resolution_at,ai_state,created_at",
        [id,kind,priority,capacity,title,description,principal,amount,currency,invoice,payment,start,end,requested,deadlines.mediation_eligible_at,deadlines.first_response_due_at,deadlines.target_resolution_at,RELATION_POLICY_VERSION]
      ))[0];
      await tx.unsafe("INSERT INTO tenant_relation_case_events(case_id,tenant_id,event_type,actor_type,actor_customer_principal_id,message,customer_visible,details) VALUES($1,$2,'created','customer',$3::uuid,'Réclamation enregistrée',true,$4::jsonb)",[created.id,id,principal,JSON.stringify({case_kind:kind,priority})]);
      if(["billing_dispute","payout_dispute"].includes(kind)&&amount>0){
        await tx.unsafe("INSERT INTO tenant_dispute_collection_holds(case_id,tenant_id,amount,currency,scope,invoice_reference,status,reason,created_by_type) VALUES($1,$2,$3,$4,'disputed_amount_only',$5,'active','Montant signalé comme contesté, à isoler des automatismes de recouvrement jusqu’à décision.','system') ON CONFLICT (case_id) WHERE status='active' DO NOTHING",[created.id,id,amount,currency,invoice]);
        await tx.unsafe("INSERT INTO tenant_relation_case_events(case_id,tenant_id,event_type,actor_type,message,customer_visible,details) VALUES($1,$2,'hold_placed','system','Montant contesté identifié dans le dossier',true,$3::jsonb)",[created.id,id,JSON.stringify({amount,currency,scope:"disputed_amount_only"})]);
      }
      await tx.unsafe("INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,NULL,'customer_relation.create','tenant_relation_case',$2,$3::jsonb)",[id,String(created.id),JSON.stringify({public_id:created.public_id,case_kind:kind,priority,source:"customer",amount:amount||null,currency})]);
      await tx.unsafe("INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload) VALUES($1,'customer_relation.created','tenant_relation_case',$2,$3::jsonb)",[id,String(created.id),JSON.stringify({case_public_id:created.public_id,case_kind:kind,priority})]);
      return created;
    });
    this.eventBus.publish("customer_relation.created",{tenant_id:id,case_id:String(row.public_id),case_kind:kind,priority});
    return row;
  }

  async createCustomerExitRequest(tenantId,input={},principalId){
    const id=Number(tenantId),principal=String(principalId||"").trim();
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_ID");
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(principal))throw problem(401,"CUSTOMER_AUTH_REQUIRED");
    const scope=String(input.exit_scope||"all_services").trim().toLowerCase();
    if(!["all_services","selected_lines"].includes(scope))throw problem(400,"INVALID_EXIT_SCOPE");
    const reason=String(input.reason_category||"unspecified").trim().toLowerCase();
    if(!["price","service","quality","competition","business_closed","other","unspecified"].includes(reason))throw problem(400,"INVALID_EXIT_REASON");
    const pref=String(input.number_retention_preference||"undecided").trim().toLowerCase();
    if(!["port_out","release","undecided"].includes(pref))throw problem(400,"INVALID_NUMBER_RETENTION");
    const portOut=Boolean(input.port_out_requested||pref==="port_out");
    const effective=input.requested_effective_date?String(input.requested_effective_date):null;
    const targetOperator=String(input.target_operator_name||"").trim().slice(0,180)||null;
    const acknowledged=input.contract_obligations_acknowledged===true;
    const description=String(input.description||"Demande de départ du client.").trim().slice(0,8000);
    const ids=Array.isArray(input.assignment_ids)?[...new Set(input.assignment_ids.map(Number).filter(x=>Number.isInteger(x)&&x>0))].slice(0,200):[];
    if(scope==="selected_lines"&&!ids.length)throw problem(400,"EXIT_LINES_REQUIRED");
    const kind=portOut?"port_out":"contract_termination",deadlines=relationCaseDeadlines(kind,"normal","business",new Date());
    const result=await this.sql.begin(async tx=>{
      const tenant=(await tx.unsafe("SELECT id,tenant_type,status,display_name FROM tenants WHERE id=$1 FOR UPDATE",[id]))[0];
      if(!tenant||tenant.tenant_type==="internal")throw problem(404,"TENANT_NOT_FOUND");
      if(tenant.status==="closed")throw problem(409,"TENANT_CLOSED");
      const open=(await tx.unsafe("SELECT id,public_id FROM tenant_exit_requests WHERE tenant_id=$1 AND status NOT IN ('completed','cancelled') ORDER BY id DESC LIMIT 1",[id]))[0];
      if(open)throw problem(409,"EXIT_REQUEST_ALREADY_OPEN");
      const lines=scope==="all_services"
        ?await tx.unsafe("SELECT a.id AS assignment_id,a.sva_number_id,CASE WHEN sn.e164 LIKE '+%' THEN sn.e164 ELSE '+'||sn.e164 END AS e164,a.status AS assignment_status,a.valid_to FROM tenant_number_assignments a JOIN sva_numbers sn ON sn.id=a.sva_number_id WHERE a.tenant_id=$1 AND (a.status<>'ended' OR (a.valid_to IS NOT NULL AND a.valid_to>=now()-interval '40 days')) ORDER BY a.id",[id])
        :await tx.unsafe("SELECT a.id AS assignment_id,a.sva_number_id,CASE WHEN sn.e164 LIKE '+%' THEN sn.e164 ELSE '+'||sn.e164 END AS e164,a.status AS assignment_status,a.valid_to FROM tenant_number_assignments a JOIN sva_numbers sn ON sn.id=a.sva_number_id WHERE a.tenant_id=$1 AND a.id=ANY($2::bigint[]) ORDER BY a.id",[id,ids]);
      if(scope==="selected_lines"&&lines.length!==ids.length)throw problem(404,"EXIT_LINE_NOT_FOUND");
      if(portOut&&!lines.length)throw problem(409,"EXIT_NO_PORTABLE_LINES");
      const createdCase=(await tx.unsafe(
        "INSERT INTO tenant_relation_cases(tenant_id,case_kind,status,priority,source,customer_capacity,title,description,created_by_customer_principal_id,requested_resolution,first_response_due_at,target_resolution_at,last_customer_update_at,ai_policy_version) VALUES($1,$2,'open','normal','customer','business',$3,$4,$5::uuid,$6,$7::timestamptz,$8::timestamptz,now(),$9) RETURNING id,public_id,case_kind,status,title,created_at",
        [id,kind,portOut?"Départ avec portabilité sortante":"Résiliation / départ",description,principal,portOut?"Conserver les numéros sélectionnés chez le nouvel opérateur":"Clôturer les services demandés",deadlines.first_response_due_at,deadlines.target_resolution_at,RELATION_POLICY_VERSION]
      ))[0];
      const exit=(await tx.unsafe(
        "INSERT INTO tenant_exit_requests(case_id,tenant_id,exit_scope,reason_category,requested_effective_date,number_retention_preference,port_out_requested,target_operator_name,status,contract_obligations_acknowledged,customer_confirmed,data_export_status) VALUES($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,true,'requested') RETURNING id,public_id,case_id,tenant_id,exit_scope,reason_category,requested_effective_date,number_retention_preference,port_out_requested,target_operator_name,status,final_invoice_status,final_settlement_status,data_export_status,contract_obligations_acknowledged,customer_confirmed,created_at",
        [createdCase.id,id,scope,reason,effective,portOut?"port_out":pref,portOut,targetOperator,acknowledged?"preparing":"waiting_customer",acknowledged]
      ))[0];
      const action=portOut?"port_out":pref==="release"?"release":"keep_until_exit";
      const createdLines=[];
      for(const line of lines){
        const createdLine=(await tx.unsafe("INSERT INTO tenant_exit_lines(exit_request_id,tenant_id,assignment_id,sva_number_id,e164_snapshot,requested_action,portability_service_level,rio_delivery_channel) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",[exit.id,id,line.assignment_id,line.sva_number_id,line.e164,action,String(line.e164||"").startsWith("+338")?"enhanced":"standard",portOut?"provider_direct":"not_required"]))[0];
        createdLines.push({...line,exit_line_id:Number(createdLine.id)});
      }
      await tx.unsafe("INSERT INTO tenant_relation_case_events(case_id,tenant_id,event_type,actor_type,actor_customer_principal_id,message,customer_visible,details) VALUES($1,$2,'created','customer',$3::uuid,'Demande de départ enregistrée',true,$4::jsonb)",[createdCase.id,id,principal,JSON.stringify({exit_scope:scope,port_out_requested:portOut,lines:lines.length,contract_obligations_acknowledged:acknowledged})]);
      await tx.unsafe("INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,NULL,'customer_exit.create','tenant_exit_request',$2,$3::jsonb)",[id,String(exit.id),JSON.stringify({public_id:exit.public_id,case_public_id:createdCase.public_id,port_out_requested:portOut,lines:lines.length,reason_category:reason})]);
      await tx.unsafe("INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload) VALUES($1,'customer_exit.created','tenant_exit_request',$2,$3::jsonb)",[id,String(exit.id),JSON.stringify({exit_public_id:exit.public_id,case_public_id:createdCase.public_id,port_out_requested:portOut,line_count:lines.length})]);
      return {case:createdCase,exit,lines:createdLines.map(x=>({exit_line_id:x.exit_line_id,assignment_id:Number(x.assignment_id),e164:x.e164,requested_action:action}))};
    });
    this.eventBus.publish("customer_exit.created",{tenant_id:id,case_id:String(result.case.public_id),exit_id:String(result.exit.public_id),port_out_requested:portOut});
    const orchestration=[];
    for(const actionType of ["prepare_exit","generate_data_export",...(portOut?["check_portability"]:[])]){
      try{
        const action=await this.createRelationAgentAction(result.case.public_id,{action_type:actionType,confidence:1,explanation:"Orchestration automatique déclenchée par la demande explicite du client.",payload:{}},{});
        orchestration.push({action_type:actionType,status:action.status,public_id:action.public_id});
      }catch(error){
        orchestration.push({action_type:actionType,status:"blocked",code:error?.code||error?.message||"ACTION_FAILED"});
      }
    }
    if(portOut){
      for(const line of result.lines){
        try{
          const action=await this.createRelationAgentAction(result.case.public_id,{action_type:"request_outbound_rio",confidence:1,explanation:"Demande sécurisée du RIO pour le numéro sélectionné.",payload:{exit_line_id:line.exit_line_id}},{});
          orchestration.push({action_type:"request_outbound_rio",exit_line_id:line.exit_line_id,status:action.status,public_id:action.public_id});
        }catch(error){
          orchestration.push({action_type:"request_outbound_rio",exit_line_id:line.exit_line_id,status:"blocked",code:error?.code||error?.message||"ACTION_FAILED"});
        }
      }
    }
    return {...result,orchestration};
  }

  async addCustomerRelationMessage(tenantId,casePublicId,body,principalId){
    const id=Number(tenantId),publicId=String(casePublicId||"").trim(),principal=String(principalId||"").trim(),message=String(body||"").trim();
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_ID");
    if(!/^[0-9a-f-]{36}$/i.test(publicId))throw problem(400,"INVALID_RELATION_CASE_ID");
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(principal))throw problem(401,"CUSTOMER_AUTH_REQUIRED");
    if(!message||message.length>8000)throw problem(400,"INVALID_RELATION_MESSAGE");
    const row=await this.sql.begin(async tx=>{
      const relation=(await tx.unsafe("SELECT id,status FROM tenant_relation_cases WHERE public_id=$1::uuid AND tenant_id=$2 FOR UPDATE",[publicId,id]))[0];
      if(!relation)throw problem(404,"RELATION_CASE_NOT_FOUND");
      if(["closed","cancelled"].includes(relation.status))throw problem(409,"RELATION_CASE_CLOSED");
      const event=(await tx.unsafe("INSERT INTO tenant_relation_case_events(case_id,tenant_id,event_type,actor_type,actor_customer_principal_id,message,customer_visible) VALUES($1,$2,'customer_message','customer',$3::uuid,$4,true) RETURNING id,event_type,actor_type,message,customer_visible,occurred_at",[relation.id,id,principal,message]))[0];
      await tx.unsafe("UPDATE tenant_relation_cases SET status=CASE WHEN status='waiting_customer' THEN 'investigating' ELSE status END,last_customer_update_at=now(),ai_state='queued',updated_at=now() WHERE id=$1",[relation.id]);
      await tx.unsafe("INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload) VALUES($1,'customer_relation.message','tenant_relation_case',$2,$3::jsonb)",[id,String(relation.id),JSON.stringify({case_public_id:publicId,source:"customer"})]);
      return event;
    });
    this.eventBus.publish("customer_relation.message",{tenant_id:id,case_id:publicId,source:"customer"});
    return row;
  }

  async cancelCustomerRelationCase(tenantId,casePublicId,principalId){
    const id=Number(tenantId),publicId=String(casePublicId||"").trim(),principal=String(principalId||"").trim();
    if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_TENANT_ID");
    if(!/^[0-9a-f-]{36}$/i.test(publicId)||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(principal))throw problem(400,"INVALID_RELATION_CASE_ID");
    return this.sql.begin(async tx=>{
      const relation=(await tx.unsafe("SELECT id,status FROM tenant_relation_cases WHERE public_id=$1::uuid AND tenant_id=$2 FOR UPDATE",[publicId,id]))[0];
      if(!relation)throw problem(404,"RELATION_CASE_NOT_FOUND");
      if(["resolved","closed","cancelled"].includes(relation.status))return {public_id:publicId,status:relation.status};
      const exit=(await tx.unsafe("SELECT id,status FROM tenant_exit_requests WHERE case_id=$1 FOR UPDATE",[relation.id]))[0];
      if(exit&&["scheduled","finalizing","completed"].includes(exit.status))throw problem(409,"EXIT_CANCELLATION_TOO_LATE");
      const irreversible=(await tx.unsafe("SELECT 1 FROM tenant_relation_actions WHERE case_id=$1 AND status='completed' AND risk_class='irreversible' LIMIT 1",[relation.id]))[0];
      if(irreversible)throw problem(409,"RELATION_IRREVERSIBLE_ACTION_DONE");
      await tx.unsafe("UPDATE tenant_relation_cases SET status='cancelled',closed_at=now(),ai_state='done',updated_at=now() WHERE id=$1",[relation.id]);
      await tx.unsafe("UPDATE tenant_exit_requests SET status='cancelled',updated_at=now() WHERE case_id=$1 AND status NOT IN ('completed','cancelled')",[relation.id]);
      await tx.unsafe("UPDATE tenant_dispute_collection_holds SET status='released',released_at=now() WHERE case_id=$1 AND status='active'",[relation.id]);
      await tx.unsafe("INSERT INTO tenant_relation_case_events(case_id,tenant_id,event_type,actor_type,actor_customer_principal_id,message,customer_visible) VALUES($1,$2,'cancelled','customer',$3::uuid,'Dossier annulé par le client',true)",[relation.id,id,principal]);
      return {public_id:publicId,status:"cancelled"};
    });
  }

  async tenantCustomerRelations(publicTenantId){
    const publicId=String(publicTenantId||"").trim();
    if(!/^[0-9a-f-]{36}$/i.test(publicId))throw problem(400,"INVALID_TENANT_PUBLIC_ID");
    const tenant=(await this.readSql.unsafe("SELECT id,tenant_type FROM tenants WHERE public_id=$1::uuid",[publicId]))[0];
    if(!tenant||tenant.tenant_type==="internal")throw problem(404,"TENANT_NOT_FOUND");
    return this.customerRelationsOverview(Number(tenant.id),{admin:true});
  }

  async listCustomerRelationsQueue(params={}){
    const limit=clampInt(params.limit,50,1,250),kind=params.case_kind?String(params.case_kind).trim().toLowerCase():null,status=params.status?String(params.status).trim().toLowerCase():null;
    if(kind&&!["billing_dispute","payout_dispute","service_complaint","contract_termination","port_out","data_request","other"].includes(kind))throw problem(400,"INVALID_RELATION_CASE_KIND");
    const q=params.q?String(params.q).trim().slice(0,160):null;
    const rows=await this.readSql.unsafe(
      "SELECT c.public_id,c.case_kind,c.status,c.priority,c.title,c.disputed_amount::float8,c.disputed_currency,c.invoice_reference,c.customer_capacity,c.ai_state,c.first_response_due_at,c.target_resolution_at,(c.first_responded_at IS NULL AND c.first_response_due_at<now()) AS first_response_overdue,(c.status NOT IN ('resolved','closed','cancelled') AND c.target_resolution_at<now()) AS resolution_overdue,c.updated_at,t.public_id AS tenant_public_id,t.display_name AS tenant,t.country_code,e.public_id AS exit_public_id,e.status AS exit_status,e.port_out_requested,e.requested_effective_date FROM tenant_relation_cases c JOIN tenants t ON t.id=c.tenant_id LEFT JOIN tenant_exit_requests e ON e.case_id=c.id WHERE t.tenant_type<>'internal' AND ($1::text IS NULL OR c.case_kind=$1) AND ($2::text IS NULL OR ($2='active' AND c.status NOT IN ('resolved','closed','cancelled')) OR c.status=$2) AND ($3::text IS NULL OR t.display_name ILIKE '%'||$3||'%' OR c.title ILIKE '%'||$3||'%' OR COALESCE(c.invoice_reference,'') ILIKE '%'||$3||'%') ORDER BY (c.status IN ('resolved','closed','cancelled')) ASC,c.priority='critical' DESC,c.priority='high' DESC,c.target_resolution_at,c.id DESC LIMIT $4",
      [kind,status,q,limit]
    );
    return {data:rows};
  }

  async relationAgentContext(casePublicId){
    const publicId=String(casePublicId||"").trim();
    if(!/^[0-9a-f-]{36}$/i.test(publicId))throw problem(400,"INVALID_RELATION_CASE_ID");
    const c=(await this.readSql.unsafe("SELECT c.*,c.disputed_amount::float8 AS disputed_amount,t.public_id AS tenant_public_id,t.display_name AS tenant FROM tenant_relation_cases c JOIN tenants t ON t.id=c.tenant_id WHERE c.public_id=$1::uuid",[publicId]))[0];
    if(!c)throw problem(404,"RELATION_CASE_NOT_FOUND");
    const [evidence,actions,exit,events]=await Promise.all([
      this.readSql.unsafe("SELECT id,evidence_kind,source_table,source_id,external_reference,content_sha256,created_at FROM tenant_relation_evidence WHERE case_id=$1 ORDER BY created_at,id LIMIT 250",[c.id]),
      this.readSql.unsafe("SELECT id,public_id,exit_line_id,action_type,risk_class,execution_mode,status,confidence::float8,explanation,created_at,approved_at,executed_at FROM tenant_relation_actions WHERE case_id=$1 ORDER BY created_at,id LIMIT 250",[c.id]),
      this.readSql.unsafe("SELECT * FROM tenant_exit_requests WHERE case_id=$1 LIMIT 1",[c.id]).then(x=>x[0]||null),
      this.readSql.unsafe("SELECT event_type,actor_type,message,customer_visible,occurred_at FROM tenant_relation_case_events WHERE case_id=$1 ORDER BY occurred_at,id LIMIT 500",[c.id])
    ]);
    return {...safeAgentContext(c,evidence,actions,exit,events),tenant:{public_id:c.tenant_public_id,display_name:c.tenant},next_actions:relationNextActions(c,exit)};
  }

  async createRelationAgentAction(casePublicId,input={},actor={}){
    const publicId=String(casePublicId||"").trim();
    if(!/^[0-9a-f-]{36}$/i.test(publicId))throw problem(400,"INVALID_RELATION_CASE_ID");
    const policy=relationActionPolicy(input.action_type),actorId=numericActor(actor);
    const confidence=input.confidence==null?null:Number(input.confidence);
    if(confidence!=null&&(!Number.isFinite(confidence)||confidence<0||confidence>1))throw problem(400,"INVALID_AGENT_CONFIDENCE");
    const explanation=String(input.explanation||"").trim().slice(0,4000)||null,payload=sanitizeRelationPayload(input.payload||{});
    const requestedExitLineId=Number(payload.exit_line_id)||null;
    if(payload.exit_line_id!=null&&(!Number.isInteger(requestedExitLineId)||requestedExitLineId<=0))throw problem(400,"INVALID_EXIT_LINE_ID");
    const result=await this.sql.begin(async tx=>{
      const relation=(await tx.unsafe("SELECT * FROM tenant_relation_cases WHERE public_id=$1::uuid FOR UPDATE",[publicId]))[0];
      if(!relation)throw problem(404,"RELATION_CASE_NOT_FOUND");
      if(["closed","cancelled"].includes(relation.status))throw problem(409,"RELATION_CASE_CLOSED");
      if(requestedExitLineId){
        const scoped=(await tx.unsafe("SELECT l.id FROM tenant_exit_lines l JOIN tenant_exit_requests e ON e.id=l.exit_request_id WHERE l.id=$1 AND e.case_id=$2 LIMIT 1",[requestedExitLineId,relation.id]))[0];
        if(!scoped)throw problem(409,"EXIT_LINE_CASE_MISMATCH");
      }
      const initialStatus=policy.execution_mode==="automatic"?"executing":policy.execution_mode==="external_confirmation"?"queued":"proposed";
      const action=(await tx.unsafe(
        "INSERT INTO tenant_relation_actions(case_id,tenant_id,exit_line_id,action_type,risk_class,execution_mode,status,proposed_by,proposed_by_user_id,confidence,explanation,payload) VALUES($1,$2,$3,$4,$5,$6,$7,'agent',$8,$9,$10,$11::jsonb) RETURNING id,public_id,case_id,tenant_id,exit_line_id,action_type,risk_class,execution_mode,status,confidence::float8,explanation,payload,created_at",
        [relation.id,relation.tenant_id,requestedExitLineId,policy.action_type,policy.risk_class,policy.execution_mode,initialStatus,actorId,confidence,explanation,JSON.stringify(payload)]
      ))[0];
      let actionResult={};
      if(policy.execution_mode==="automatic"){
        if(policy.action_type==="place_dispute_hold"){
          if(!(Number(relation.disputed_amount)>0)&&!payload.amount)throw problem(409,"DISPUTED_AMOUNT_REQUIRED");
          const amount=payload.amount==null?Number(relation.disputed_amount):Number(payload.amount),currency=String(payload.currency||relation.disputed_currency||"").toUpperCase();
          if(!Number.isFinite(amount)||amount<=0||!/^[A-Z]{3}$/.test(currency))throw problem(400,"INVALID_DISPUTE_HOLD");
          await tx.unsafe("INSERT INTO tenant_dispute_collection_holds(case_id,tenant_id,amount,currency,scope,invoice_reference,status,reason,created_by_type) VALUES($1,$2,$3,$4,'disputed_amount_only',$5,'active',$6,'agent') ON CONFLICT (case_id) WHERE status='active' DO NOTHING",[relation.id,relation.tenant_id,amount,currency,relation.invoice_reference,explanation||"Montant contesté"]);
          actionResult={hold:"active",amount,currency};
          await tx.unsafe("INSERT INTO tenant_relation_case_events(case_id,tenant_id,event_type,actor_type,actor_user_id,message,customer_visible,details) VALUES($1,$2,'hold_placed','agent',$3,'Montant contesté isolé des automatismes internes',true,$4::jsonb)",[relation.id,relation.tenant_id,actorId,JSON.stringify(actionResult)]);
        }else if(policy.action_type==="prepare_exit"){
          const changed=await tx.unsafe("UPDATE tenant_exit_requests SET status=CASE WHEN status IN ('requested','waiting_customer') THEN 'preparing' ELSE status END,updated_at=now() WHERE case_id=$1 RETURNING public_id,status",[relation.id]);
          actionResult={exit:changed[0]||null};
          await tx.unsafe("INSERT INTO tenant_relation_case_events(case_id,tenant_id,event_type,actor_type,actor_user_id,message,customer_visible) VALUES($1,$2,'exit_prepared','agent',$3,'Préparation de sortie engagée',true)",[relation.id,relation.tenant_id,actorId]);
        }else if(policy.action_type==="generate_data_export"){
          const changed=await tx.unsafe("UPDATE tenant_exit_requests SET data_export_status=CASE WHEN data_export_status='not_requested' THEN 'requested' ELSE data_export_status END,updated_at=now() WHERE case_id=$1 RETURNING public_id,data_export_status",[relation.id]);
          actionResult={exit:changed[0]||null,export_generated:false};
        }else if(policy.action_type==="check_portability"){
          const lines=await tx.unsafe(
            "WITH checked AS ("+
            " SELECT l.id,l.e164_snapshot,l.requested_action,a.status AS assignment_status,a.valid_to,"+
            " CASE WHEN l.requested_action<>'port_out' THEN true"+
            "      WHEN a.status IN ('active','suspended','testing') THEN true"+
            "      WHEN a.status='ended' AND a.valid_to IS NOT NULL AND a.valid_to>=now()-interval '40 days' THEN true"+
            "      ELSE false END AS eligible,"+
            " CASE WHEN l.requested_action<>'port_out' THEN 'not_requested'"+
            "      WHEN a.status IN ('active','suspended','testing') THEN 'active_or_recoverable'"+
            "      WHEN a.status='ended' AND a.valid_to IS NOT NULL AND a.valid_to>=now()-interval '40 days' THEN 'within_40_day_recovery_window'"+
            "      ELSE 'number_not_portable_or_recovery_window_expired' END AS reason"+
            " FROM tenant_exit_lines l JOIN tenant_number_assignments a ON a.id=l.assignment_id"+
            " WHERE l.exit_request_id IN (SELECT id FROM tenant_exit_requests WHERE case_id=$1)"+
            ") UPDATE tenant_exit_lines l SET status=CASE WHEN c.eligible THEN 'eligibility_check' ELSE 'blocked' END,"+
            " portability_eligibility_status=CASE WHEN c.eligible THEN 'eligible' ELSE CASE WHEN c.assignment_status='ended' THEN 'expired' ELSE 'ineligible' END END,"+
            " portability_eligibility_reason=c.reason,portability_eligibility_checked_at=now(),"+
            " portability_service_level=CASE WHEN l.e164_snapshot LIKE '+338%' THEN 'enhanced' ELSE l.portability_service_level END"+
            " FROM checked c WHERE l.id=c.id RETURNING l.id,l.e164_snapshot,l.status,l.portability_eligibility_status,l.portability_eligibility_reason,l.portability_service_level",
            [relation.id]
          );
          const blocked=lines.filter(x=>x.portability_eligibility_status!=="eligible");
          if(blocked.length)await tx.unsafe("UPDATE tenant_exit_requests SET status='blocked',updated_at=now() WHERE case_id=$1",[relation.id]);
          actionResult={line_count:lines.length,eligible:blocked.length===0,blocked_count:blocked.length,lines};
        }else if(policy.action_type==="collect_evidence"){
          if(relation.invoice_reference)await tx.unsafe("INSERT INTO tenant_relation_evidence(case_id,tenant_id,evidence_kind,external_reference,metadata) SELECT $1,$2,'invoice',$3,$4::jsonb WHERE NOT EXISTS (SELECT 1 FROM tenant_relation_evidence WHERE case_id=$1 AND evidence_kind='invoice' AND external_reference=$3)",[relation.id,relation.tenant_id,relation.invoice_reference,JSON.stringify({source:"customer_reference"})]);
          const dist=await tx.unsafe("SELECT id FROM tenant_revenue_distributions WHERE tenant_id=$1 AND ($2::date IS NULL OR period_end>=$2::date) AND ($3::date IS NULL OR period_start<=$3::date) AND ($4::text IS NULL OR currency=$4) ORDER BY period_end DESC,id DESC LIMIT 100",[relation.tenant_id,relation.disputed_period_start,relation.disputed_period_end,relation.disputed_currency]);
          for(const x of dist)await tx.unsafe("INSERT INTO tenant_relation_evidence(case_id,tenant_id,evidence_kind,source_table,source_id,metadata) SELECT $1,$2,'settlement','tenant_revenue_distributions',$3,$4::jsonb WHERE NOT EXISTS (SELECT 1 FROM tenant_relation_evidence WHERE case_id=$1 AND source_table='tenant_revenue_distributions' AND source_id=$3)",[relation.id,relation.tenant_id,String(x.id),JSON.stringify({authoritative:true})]);
          actionResult={distribution_evidence:dist.length,invoice_reference_linked:Boolean(relation.invoice_reference)};
        }else if(policy.action_type==="reconcile_billing"){
          const rows=await tx.unsafe("SELECT currency,COALESCE(sum(upstream_payout_ht),0)::float8 AS upstream_payout_ht,COALESCE(sum(platform_fee_ht),0)::float8 AS platform_fee_ht,COALESCE(sum(net_payout_ht),0)::float8 AS net_payout_ht,COALESCE(sum(unallocated_amount_ht),0)::float8 AS unallocated_amount_ht,count(*)::int AS distributions FROM tenant_revenue_distributions WHERE tenant_id=$1 AND ($2::date IS NULL OR period_end>=$2::date) AND ($3::date IS NULL OR period_start<=$3::date) AND ($4::text IS NULL OR currency=$4) GROUP BY currency ORDER BY currency",[relation.tenant_id,relation.disputed_period_start,relation.disputed_period_end,relation.disputed_currency]);
          actionResult={authoritative_distribution_summary:rows,subscription_invoice_provider_connected:false};
        }else if(policy.action_type==="reconcile_final_settlement"){
          const rows=await tx.unsafe("SELECT currency,count(*)::int AS distributions,count(*) FILTER(WHERE status='paid')::int AS paid,count(*) FILTER(WHERE status NOT IN ('paid','cancelled'))::int AS open,COALESCE(sum(net_payout_ht) FILTER(WHERE status<>'cancelled'),0)::float8 AS net_payout_ht,COALESCE(sum(net_payout_ht) FILTER(WHERE status='paid'),0)::float8 AS paid_payout_ht FROM tenant_revenue_distributions WHERE tenant_id=$1 GROUP BY currency ORDER BY currency",[relation.tenant_id]);
          const open=rows.reduce((n,x)=>n+Number(x.open||0),0);
          if(open===0)await tx.unsafe("UPDATE tenant_exit_requests SET final_settlement_status='settled',updated_at=now() WHERE case_id=$1",[relation.id]);
          else await tx.unsafe("UPDATE tenant_exit_requests SET final_settlement_status='pending',updated_at=now() WHERE case_id=$1",[relation.id]);
          actionResult={currencies:rows,open_distributions:open,settled:open===0};
        }else if(policy.action_type==="respond_customer"||policy.action_type==="request_customer_info"){
          const message=String(payload.message||"").trim();
          if(!message||message.length>8000)throw problem(400,"RELATION_RESPONSE_REQUIRED");
          const label=policy.action_type==="request_customer_info"?"Information complémentaire demandée":"Réponse du service client";
          await tx.unsafe("INSERT INTO tenant_relation_case_events(case_id,tenant_id,event_type,actor_type,actor_user_id,message,customer_visible,details) VALUES($1,$2,'staff_message','agent',$3,$4,true,$5::jsonb)",[relation.id,relation.tenant_id,actorId,message,JSON.stringify({label,action_type:policy.action_type})]);
          await tx.unsafe("UPDATE tenant_relation_cases SET first_responded_at=COALESCE(first_responded_at,now()),last_pgi_update_at=now(),status=CASE WHEN $2='request_customer_info' THEN 'waiting_customer' WHEN status IN ('open','triage') THEN 'investigating' ELSE status END,updated_at=now() WHERE id=$1",[relation.id,policy.action_type]);
          actionResult={message_sent:true,customer_visible:true};
        }else if(policy.action_type==="prepare_mediation"){
          if(relation.customer_capacity!=="consumer")throw problem(409,"MEDIATION_CONSUMER_ONLY");
          const eligibleAt=relation.mediation_eligible_at?new Date(relation.mediation_eligible_at):null;
          const eligible=Boolean(eligibleAt&&eligibleAt.getTime()<=Date.now());
          actionResult={eligible,eligible_at:relation.mediation_eligible_at||null,formal_complaint_at:relation.formal_complaint_at||null,submitted:false};
          if(eligible)await tx.unsafe("INSERT INTO tenant_relation_case_events(case_id,tenant_id,event_type,actor_type,actor_user_id,message,customer_visible,details) VALUES($1,$2,'mediation_ready','agent',$3,'Le dossier remplit le délai interne de préparation à la médiation. La saisine reste à effectuer auprès du médiateur compétent.',true,$4::jsonb)",[relation.id,relation.tenant_id,actorId,JSON.stringify(actionResult)]);
        }else{
          actionResult={stored:true,note:"Action de préparation enregistrée pour l’agent."};
        }
        await tx.unsafe("UPDATE tenant_relation_actions SET status='completed',result=$2::jsonb,executed_at=now() WHERE id=$1",[action.id,JSON.stringify(actionResult)]);
      }else if(policy.execution_mode==="external_confirmation"){
        if(policy.action_type==="request_outbound_rio"){
          const targetLineId=Number(action.exit_line_id)||null;
          const portabilityLines=await tx.unsafe("SELECT id,portability_eligibility_status FROM tenant_exit_lines WHERE exit_request_id IN (SELECT id FROM tenant_exit_requests WHERE case_id=$1) AND requested_action='port_out' AND ($2::bigint IS NULL OR id=$2) FOR UPDATE",[relation.id,targetLineId]);
          if(!portabilityLines.length)throw problem(409,"PORT_OUT_LINES_REQUIRED");
          if(portabilityLines.some(x=>x.portability_eligibility_status!=="eligible"))throw problem(409,"PORT_OUT_ELIGIBILITY_REQUIRED");
          await tx.unsafe("UPDATE tenant_exit_lines SET rio_status=CASE WHEN rio_status IN ('not_requested','unavailable') THEN 'requested' ELSE rio_status END,rio_requested_at=COALESCE(rio_requested_at,now()) WHERE exit_request_id IN (SELECT id FROM tenant_exit_requests WHERE case_id=$1) AND requested_action='port_out' AND ($2::bigint IS NULL OR id=$2)",[relation.id,targetLineId]);
          await tx.unsafe("UPDATE tenant_exit_requests SET status='waiting_provider',updated_at=now() WHERE case_id=$1 AND status NOT IN ('completed','cancelled')",[relation.id]);
        }else if(policy.action_type==="submit_port_out"){
          const ex=(await tx.unsafe("SELECT id,port_out_requested,customer_confirmed FROM tenant_exit_requests WHERE case_id=$1 FOR UPDATE",[relation.id]))[0];
          if(!ex||!ex.port_out_requested)throw problem(409,"PORT_OUT_NOT_REQUESTED");
          if(!ex.customer_confirmed)throw problem(409,"EXIT_CUSTOMER_CONFIRMATION_REQUIRED");
          const targetLineId=Number(action.exit_line_id)||null;
          const portLines=await tx.unsafe("SELECT id,portability_eligibility_status,rio_status FROM tenant_exit_lines WHERE exit_request_id=$1 AND requested_action='port_out' AND ($2::bigint IS NULL OR id=$2) FOR UPDATE",[ex.id,targetLineId]);
          if(!portLines.length)throw problem(409,"PORT_OUT_LINES_REQUIRED");
          if(portLines.length>1&&!targetLineId)throw problem(409,"PORT_OUT_LINE_SCOPE_REQUIRED");
          if(portLines.some(x=>x.portability_eligibility_status!=="eligible"))throw problem(409,"PORT_OUT_ELIGIBILITY_REQUIRED");
          if(portLines.some(x=>!["delivered","not_required"].includes(x.rio_status)))throw problem(409,"PORT_OUT_RIO_DELIVERY_REQUIRED");
          await tx.unsafe("UPDATE tenant_exit_requests SET status='waiting_provider',updated_at=now() WHERE id=$1",[ex.id]);
          await tx.unsafe("UPDATE tenant_exit_lines SET status='waiting_provider' WHERE exit_request_id=$1 AND requested_action='port_out' AND ($2::bigint IS NULL OR id=$2)",[ex.id,targetLineId]);
          await tx.unsafe("INSERT INTO tenant_relation_case_events(case_id,tenant_id,event_type,actor_type,actor_user_id,message,customer_visible,details) VALUES($1,$2,'port_out_submitted','agent',$3,'Demande de portabilité sortante mise en file auprès du fournisseur.',true,$4::jsonb)",[relation.id,relation.tenant_id,actorId,JSON.stringify({exit_line_id:targetLineId})]);
        }else if(["request_port_out_report","request_port_out_cancel","request_port_out_return_back"].includes(policy.action_type)){
          const option=policy.action_type==="request_port_out_report"?"report":policy.action_type==="request_port_out_cancel"?"cancel":"return_back";
          await tx.unsafe("UPDATE tenant_exit_lines SET recovery_option=$2,status='waiting_provider' WHERE exit_request_id IN (SELECT id FROM tenant_exit_requests WHERE case_id=$1) AND requested_action='port_out'",[relation.id,option]);
          await tx.unsafe("UPDATE tenant_exit_requests SET status='waiting_provider',updated_at=now() WHERE case_id=$1 AND status NOT IN ('completed','cancelled')",[relation.id]);
        }else if(policy.action_type==="request_final_invoice"){
          await tx.unsafe("UPDATE tenant_exit_requests SET final_invoice_status='pending',updated_at=now() WHERE case_id=$1",[relation.id]);
        }
        actionResult={provider_confirmation_required:true,queued:true};
        await tx.unsafe("UPDATE tenant_relation_actions SET status='queued',result=$2::jsonb WHERE id=$1",[action.id,JSON.stringify(actionResult)]);
      }
      await tx.unsafe("UPDATE tenant_relation_cases SET ai_state=$2,ai_confidence=COALESCE($3,ai_confidence),last_pgi_update_at=now(),updated_at=now() WHERE id=$1",[relation.id,policy.execution_mode==="automatic"?"ready":"action_required",confidence]);
      await tx.unsafe("INSERT INTO tenant_relation_case_events(case_id,tenant_id,event_type,actor_type,actor_user_id,message,customer_visible,details) VALUES($1,$2,'agent_analysis','agent',$3,$4,false,$5::jsonb)",[relation.id,relation.tenant_id,actorId,explanation||("Action agent : "+policy.action_type),JSON.stringify({action_type:policy.action_type,risk_class:policy.risk_class,execution_mode:policy.execution_mode})]);
      await tx.unsafe("INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'customer_relation.agent_action','tenant_relation_case',$3,$4::jsonb)",[relation.tenant_id,actorId,String(relation.id),JSON.stringify({case_public_id:publicId,action_public_id:action.public_id,action_type:policy.action_type,risk_class:policy.risk_class,execution_mode:policy.execution_mode})]);
      await tx.unsafe("INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload) VALUES($1,'customer_relation.agent_action','tenant_relation_case',$2,$3::jsonb)",[relation.tenant_id,String(relation.id),JSON.stringify({case_public_id:publicId,action_public_id:action.public_id,action_type:policy.action_type,risk_class:policy.risk_class,execution_mode:policy.execution_mode,status:policy.execution_mode==="automatic"?"completed":initialStatus})]);
      return {...action,status:policy.execution_mode==="automatic"?"completed":initialStatus,result:actionResult};
    });
    this.eventBus.publish("customer_relation.agent_action",{case_id:publicId,action_type:policy.action_type,status:result.status});
    if(result.status==="queued"&&["request_outbound_rio","submit_port_out","request_port_out_report","request_port_out_cancel","request_port_out_return_back"].includes(policy.action_type)){
      await this.enqueueWork("portability_outbound",{action_public_id:String(result.public_id)},{tenant_id:Number(result.tenant_id),priority:250,max_attempts:50,dedupe_key:"portability_outbound:"+String(result.public_id)});
    }
    return result;
  }

  async approveRelationAction(actionPublicId,actor={}){
    const publicId=String(actionPublicId||"").trim(),actorId=numericActor(actor);
    if(!/^[0-9a-f-]{36}$/i.test(publicId))throw problem(400,"INVALID_RELATION_ACTION_ID");
    return this.sql.begin(async tx=>{
      const row=(await tx.unsafe("SELECT a.*,c.public_id AS case_public_id,c.status AS case_status FROM tenant_relation_actions a JOIN tenant_relation_cases c ON c.id=a.case_id WHERE a.public_id=$1::uuid FOR UPDATE",[publicId]))[0];
      if(!row)throw problem(404,"RELATION_ACTION_NOT_FOUND");
      if(row.execution_mode!=="approval_required")throw problem(409,"RELATION_ACTION_NOT_STAFF_APPROVABLE");
      if(row.status!=="proposed")throw problem(409,"RELATION_ACTION_NOT_PENDING");
      let result={approved:true,external_execution_required:false};
      if(row.action_type==="release_dispute_hold"){
        await tx.unsafe("UPDATE tenant_dispute_collection_holds SET status='released',released_at=now() WHERE case_id=$1 AND status='active'",[row.case_id]);
      }else if(row.action_type==="resolve_case"){
        await tx.unsafe("UPDATE tenant_relation_cases SET status='resolved',resolved_at=now(),ai_state='done',last_pgi_update_at=now(),updated_at=now() WHERE id=$1",[row.case_id]);
        await tx.unsafe("INSERT INTO tenant_relation_case_events(case_id,tenant_id,event_type,actor_type,actor_user_id,message,customer_visible) VALUES($1,$2,'resolved','staff',$3,'Dossier résolu',true)",[row.case_id,row.tenant_id,actorId]);
      }else if(row.action_type==="close_case"){
        if(row.case_status!=="resolved")throw problem(409,"RELATION_CASE_MUST_BE_RESOLVED");
        await tx.unsafe("UPDATE tenant_relation_cases SET status='closed',closed_at=now(),updated_at=now() WHERE id=$1",[row.case_id]);
        await tx.unsafe("INSERT INTO tenant_relation_case_events(case_id,tenant_id,event_type,actor_type,actor_user_id,message,customer_visible) VALUES($1,$2,'closed','staff',$3,'Dossier clôturé',true)",[row.case_id,row.tenant_id,actorId]);
      }else if(["issue_credit","issue_refund"].includes(row.action_type)){
        result={approved:true,external_execution_required:true,reason:"PAYMENT_PROVIDER_ACTION_REQUIRED"};
      }
      await tx.unsafe("UPDATE tenant_relation_actions SET status=$2,approved_by_user_id=$3,approved_at=now(),result=$4::jsonb,executed_at=CASE WHEN $2='completed' THEN now() ELSE executed_at END WHERE id=$1",[row.id,result.external_execution_required?"approved":"completed",actorId,JSON.stringify(result)]);
      await tx.unsafe("INSERT INTO tenant_relation_case_events(case_id,tenant_id,event_type,actor_type,actor_user_id,message,customer_visible,details) VALUES($1,$2,'decision_approved','staff',$3,$4,true,$5::jsonb)",[row.case_id,row.tenant_id,actorId,"Action approuvée : "+row.action_type,JSON.stringify({action_public_id:publicId,external_execution_required:result.external_execution_required})]);
      await tx.unsafe("INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'customer_relation.action_approve','tenant_relation_action',$3,$4::jsonb)",[row.tenant_id,actorId,String(row.id),JSON.stringify({public_id:publicId,action_type:row.action_type,external_execution_required:result.external_execution_required})]);
      return {public_id:publicId,status:result.external_execution_required?"approved":"completed",...result};
    });
  }

  async confirmCustomerRelationAction(tenantId,actionPublicId,principalId){
    const id=Number(tenantId),publicId=String(actionPublicId||"").trim(),principal=String(principalId||"").trim();
    if(!Number.isInteger(id)||id<=0||!/^[0-9a-f-]{36}$/i.test(publicId)||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(principal))throw problem(400,"INVALID_RELATION_ACTION");
    return this.sql.begin(async tx=>{
      const row=(await tx.unsafe("SELECT a.*,c.public_id AS case_public_id FROM tenant_relation_actions a JOIN tenant_relation_cases c ON c.id=a.case_id WHERE a.public_id=$1::uuid AND a.tenant_id=$2 FOR UPDATE",[publicId,id]))[0];
      if(!row)throw problem(404,"RELATION_ACTION_NOT_FOUND");
      if(row.execution_mode!=="customer_confirmation"||row.status!=="proposed")throw problem(409,"RELATION_ACTION_NOT_CONFIRMABLE");
      await tx.unsafe("UPDATE tenant_relation_actions SET status='approved',approved_at=now(),result=$2::jsonb WHERE id=$1",[row.id,JSON.stringify({customer_confirmed:true,external_execution_required:true})]);
      await tx.unsafe("UPDATE tenant_exit_requests SET customer_confirmed=true,status=CASE WHEN status='waiting_customer' THEN 'preparing' ELSE status END,updated_at=now() WHERE case_id=$1",[row.case_id]);
      await tx.unsafe("INSERT INTO tenant_relation_case_events(case_id,tenant_id,event_type,actor_type,actor_customer_principal_id,message,customer_visible,details) VALUES($1,$2,'decision_approved','customer',$3::uuid,'Action confirmée par le client',true,$4::jsonb)",[row.case_id,id,principal,JSON.stringify({action_public_id:publicId,action_type:row.action_type})]);
      return {public_id:publicId,status:"approved",external_execution_required:true};
    });
  }

  async completeRelationExternalAction(actionPublicId,input={},actor={}){
    const publicId=String(actionPublicId||"").trim(),actorId=numericActor(actor);
    if(!/^[0-9a-f-]{36}$/i.test(publicId))throw problem(400,"INVALID_RELATION_ACTION_ID");
    const outcome=String(input.outcome||"").trim().toLowerCase();
    if(!["success","completed","scheduled","available","delivered","failed","rejected"].includes(outcome))throw problem(400,"INVALID_EXTERNAL_OUTCOME");
    const providerReference=String(input.provider_reference||"").trim().slice(0,255)||null;
    const safe=sanitizeRelationPayload(input);
    const completed=await this.sql.begin(async tx=>{
      const row=(await tx.unsafe("SELECT a.*,c.public_id AS case_public_id,c.status AS case_status FROM tenant_relation_actions a JOIN tenant_relation_cases c ON c.id=a.case_id WHERE a.public_id=$1::uuid FOR UPDATE",[publicId]))[0];
      if(!row)throw problem(404,"RELATION_ACTION_NOT_FOUND");
      if(row.execution_mode!=="external_confirmation")throw problem(409,"RELATION_ACTION_NOT_EXTERNAL");
      if(!["queued","approved","executing"].includes(row.status))throw problem(409,"RELATION_ACTION_NOT_PENDING");
      let finalStatus=["failed","rejected"].includes(outcome)?"failed":"completed",eventType="status_changed",message="Confirmation externe enregistrée";
      if(row.action_type==="request_outbound_rio"){
        const targetLineId=Number(row.exit_line_id)||null;
        const last4=input.rio_last4==null?null:String(input.rio_last4).slice(-4);
        const deliveryChannel=String(input.delivery_channel||"provider_direct").trim().toLowerCase();
        if(!["provider_direct","secure_portal","verified_email","manual_secure","not_required"].includes(deliveryChannel))throw problem(400,"INVALID_RIO_DELIVERY_CHANNEL");
        const deliveryReference=String(input.delivery_reference||providerReference||"").trim().slice(0,255)||null;
        const state=outcome==="delivered"?"delivered":["available","success","completed"].includes(outcome)?"available":"unavailable";
        await tx.unsafe("UPDATE tenant_exit_lines SET rio_status=$2,rio_last4=COALESCE($3,rio_last4),rio_delivered_at=CASE WHEN $2='delivered' THEN now() ELSE rio_delivered_at END,rio_delivery_channel=$4,rio_delivery_reference=COALESCE($5,rio_delivery_reference) WHERE exit_request_id IN (SELECT id FROM tenant_exit_requests WHERE case_id=$1) AND requested_action='port_out' AND ($6::bigint IS NULL OR id=$6)",[row.case_id,state,last4,deliveryChannel,deliveryReference,targetLineId]);
        eventType="status_changed";message=state==="delivered"?"RIO délivré par le canal sécurisé prévu":"Statut RIO mis à jour";
      }else if(row.action_type==="submit_port_out"){
        const targetLineId=Number(row.exit_line_id)||null;
        const portLines=await tx.unsafe("SELECT id,status FROM tenant_exit_lines WHERE exit_request_id IN (SELECT id FROM tenant_exit_requests WHERE case_id=$1) AND requested_action='port_out' FOR UPDATE",[row.case_id]);
        if(portLines.length>1&&!targetLineId)throw problem(409,"PORT_OUT_LINE_SCOPE_REQUIRED");
        if(outcome==="scheduled"){
          await tx.unsafe("UPDATE tenant_exit_lines SET status='scheduled',operator_reference=COALESCE($2,operator_reference),scheduled_at=COALESCE($3::timestamptz,now()) WHERE exit_request_id IN (SELECT id FROM tenant_exit_requests WHERE case_id=$1) AND requested_action='port_out' AND ($4::bigint IS NULL OR id=$4)",[row.case_id,providerReference,input.scheduled_at||null,targetLineId]);
          const states=await tx.unsafe("SELECT status FROM tenant_exit_lines WHERE exit_request_id IN (SELECT id FROM tenant_exit_requests WHERE case_id=$1) AND requested_action='port_out'",[row.case_id]);
          const allScheduled=states.every(x=>["scheduled","completed"].includes(x.status));
          await tx.unsafe("UPDATE tenant_exit_requests SET status=CASE WHEN $2 THEN 'scheduled' ELSE 'waiting_provider' END,operator_reference=COALESCE($3,operator_reference),scheduled_at=CASE WHEN $2 THEN COALESCE($4::timestamptz,scheduled_at,now()) ELSE scheduled_at END,updated_at=now() WHERE case_id=$1",[row.case_id,allScheduled,providerReference,input.scheduled_at||null]);
          eventType="port_out_scheduled";message="Portabilité sortante planifiée par l’opérateur";
        }else if(["success","completed"].includes(outcome)){
          await tx.unsafe("UPDATE tenant_exit_lines SET status='completed',operator_reference=COALESCE($2,operator_reference),completed_at=now() WHERE exit_request_id IN (SELECT id FROM tenant_exit_requests WHERE case_id=$1) AND requested_action='port_out' AND ($3::bigint IS NULL OR id=$3)",[row.case_id,providerReference,targetLineId]);
          await tx.unsafe(
            "UPDATE tenant_number_assignments a SET status='ended',valid_to=COALESCE(valid_to,now())"+
            " FROM tenant_exit_lines l JOIN tenant_exit_requests e ON e.id=l.exit_request_id"+
            " WHERE e.case_id=$1 AND l.assignment_id=a.id AND l.requested_action='port_out' AND l.status='completed' AND ($2::bigint IS NULL OR l.id=$2)",
            [row.case_id,targetLineId]
          );
          const states=await tx.unsafe("SELECT status FROM tenant_exit_lines WHERE exit_request_id IN (SELECT id FROM tenant_exit_requests WHERE case_id=$1) AND requested_action='port_out'",[row.case_id]);
          const allCompleted=states.length>0&&states.every(x=>x.status==="completed");
          await tx.unsafe("UPDATE tenant_exit_requests SET status=CASE WHEN $2 THEN 'finalizing' ELSE 'waiting_provider' END,operator_reference=COALESCE($3,operator_reference),updated_at=now() WHERE case_id=$1",[row.case_id,allCompleted,providerReference]);
          eventType="port_out_completed";message=allCompleted?"Portabilité sortante confirmée pour tous les numéros":"Portabilité sortante confirmée pour le numéro";
        }else{
          await tx.unsafe("UPDATE tenant_exit_requests SET status='blocked',updated_at=now() WHERE case_id=$1",[row.case_id]);
          await tx.unsafe("UPDATE tenant_exit_lines SET status='blocked' WHERE exit_request_id IN (SELECT id FROM tenant_exit_requests WHERE case_id=$1) AND requested_action='port_out' AND ($2::bigint IS NULL OR id=$2)",[row.case_id,targetLineId]);
        }
      }else if(row.action_type==="request_final_invoice"){
        if(["success","completed","available","delivered"].includes(outcome)){
          await tx.unsafe("UPDATE tenant_exit_requests SET final_invoice_status='ready',updated_at=now() WHERE case_id=$1",[row.case_id]);
          if(input.final_invoice_reference)await tx.unsafe("UPDATE tenant_relation_cases SET invoice_reference=COALESCE(invoice_reference,$2),updated_at=now() WHERE id=$1",[row.case_id,String(input.final_invoice_reference).slice(0,200)]);
          eventType="final_invoice_ready";message="Compte final disponible";
        }
      }else if(row.action_type==="revoke_access"&&["success","completed"].includes(outcome)){
        const ex=(await tx.unsafe("UPDATE tenant_exit_requests SET status='completed',access_revocation_at=now(),completed_at=now(),number_quarantine_until=CASE WHEN port_out_requested THEN number_quarantine_until ELSE COALESCE(number_quarantine_until,current_date+40) END,updated_at=now() WHERE case_id=$1 RETURNING port_out_requested,number_quarantine_until",[row.case_id]))[0];
        await tx.unsafe("UPDATE tenant_relation_cases SET status='resolved',resolved_at=now(),ai_state='done',updated_at=now() WHERE id=$1",[row.case_id]);
        eventType="access_revoked";message="Clôture technique confirmée";
        safe.number_quarantine_until=ex?.number_quarantine_until||null;
      }else if(["request_port_out_report","request_port_out_cancel","request_port_out_return_back"].includes(row.action_type)){
        if(row.action_type==="request_port_out_cancel"&&["success","completed"].includes(outcome))await tx.unsafe("UPDATE tenant_exit_lines SET status='cancelled' WHERE exit_request_id IN (SELECT id FROM tenant_exit_requests WHERE case_id=$1) AND requested_action='port_out'",[row.case_id]);
        eventType="status_changed";message="Option opérateur de portabilité confirmée";
      }
      await tx.unsafe("UPDATE tenant_relation_actions SET status=$2,result=$3::jsonb,executed_at=now() WHERE id=$1",[row.id,finalStatus,JSON.stringify({...safe,provider_reference:providerReference})]);
      await tx.unsafe("INSERT INTO tenant_relation_case_events(case_id,tenant_id,event_type,actor_type,actor_user_id,message,customer_visible,details) VALUES($1,$2,$3,'system',$4,$5,true,$6::jsonb)",[row.case_id,row.tenant_id,eventType,actorId,message,JSON.stringify({action_public_id:publicId,action_type:row.action_type,outcome,provider_reference:providerReference})]);
      await tx.unsafe("INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'customer_relation.external_confirm','tenant_relation_action',$3,$4::jsonb)",[row.tenant_id,actorId,String(row.id),JSON.stringify({public_id:publicId,action_type:row.action_type,outcome,provider_reference:providerReference})]);
      return {public_id:publicId,status:finalStatus,outcome,provider_reference:providerReference,action_type:row.action_type,case_public_id:row.case_public_id,tenant_id:Number(row.tenant_id),exit_line_id:Number(row.exit_line_id)||null};
    });
    if(completed.status==="completed"&&completed.action_type==="request_outbound_rio"&&completed.outcome==="delivered"){
      const next=await this.createRelationAgentAction(completed.case_public_id,{action_type:"submit_port_out",confidence:1,explanation:"Portabilité sortante automatiquement transmise après confirmation du RIO.",payload:{exit_line_id:completed.exit_line_id}},{});
      completed.next_action={action_type:"submit_port_out",public_id:next.public_id,status:next.status,exit_line_id:completed.exit_line_id};
    }else if(completed.status==="completed"&&completed.action_type==="submit_port_out"&&["success","completed"].includes(completed.outcome)){
      const exitState=(await this.readSql.unsafe("SELECT status FROM tenant_exit_requests WHERE case_id=(SELECT id FROM tenant_relation_cases WHERE public_id=$1::uuid) LIMIT 1",[completed.case_public_id]))[0];
      if(exitState?.status==="finalizing"){
        const follow=[];
        for(const actionType of ["request_final_invoice","reconcile_final_settlement"]){
          try{
            const next=await this.createRelationAgentAction(completed.case_public_id,{action_type:actionType,confidence:1,explanation:"Finalisation automatique après confirmation du portage.",payload:{}},{});
            follow.push({action_type:actionType,public_id:next.public_id,status:next.status});
          }catch(error){follow.push({action_type:actionType,status:"blocked",code:error?.code||error?.message||"ACTION_FAILED"});}
        }
        completed.next_actions=follow;
      }
    }
    return completed;
  }


  async customerProfitability(params={}){
    const period=String(params.period||"365d").toLowerCase();
    if(!["30d","90d","365d","all"].includes(period))throw problem(400,"INVALID_PROFITABILITY_PERIOD");
    const requestedCurrency=params.currency?String(params.currency).trim().toUpperCase():null;
    if(requestedCurrency&&!/^[A-Z]{3}$/.test(requestedCurrency))throw problem(400,"INVALID_CURRENCY");
    const tenantPublicId=String(params.tenant_public_id||"").trim();
    if(tenantPublicId&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantPublicId))throw problem(400,"INVALID_TENANT_PUBLIC_ID");
    const limit=clampInt(params.limit,10,1,25);
    const days=period==="30d"?30:period==="90d"?90:period==="365d"?365:null;
    const since=days?new Date(Date.now()-days*86400000).toISOString().slice(0,10):null;
    let tenant=null;
    if(tenantPublicId){
      tenant=(await this.readSql.unsafe("SELECT id,public_id::text AS public_id,display_name,tenant_type FROM tenants WHERE public_id=$1::uuid",[tenantPublicId]))[0]||null;
      if(!tenant)throw problem(404,"TENANT_NOT_FOUND");
      if(tenant.tenant_type==="internal")throw problem(409,"INTERNAL_TENANT_PROTECTED");
    }
    const currencyRows=await this.readSql.unsafe(
      "SELECT DISTINCT d.currency FROM tenant_revenue_distributions d JOIN tenants t ON t.id=d.tenant_id"+
      " WHERE t.tenant_type<>'internal' AND ($1::date IS NULL OR d.period_end>=$1::date)"+
      " AND ($2::bigint IS NULL OR d.tenant_id=$2) ORDER BY d.currency",
      [since,tenant?Number(tenant.id):null]
    );
    const currencies=currencyRows.map(x=>String(x.currency));
    const currency=requestedCurrency||(currencies.includes("EUR")?"EUR":currencies[0]||"EUR");
    if(requestedCurrency&&currencies.length&&!currencies.includes(requestedCurrency))throw problem(404,"PROFITABILITY_CURRENCY_NOT_FOUND");
    const bucket=period==="30d"?"day":period==="90d"?"week":"month";
    const paidRatio="CASE WHEN cs.confirmed_amount_ht>0 THEN LEAST(1::numeric,GREATEST(0::numeric,cs.paid_amount_ht/cs.confirmed_amount_ht)) WHEN cs.status='paid' THEN 1::numeric ELSE 0::numeric END";
    const baseWhere=" FROM tenant_revenue_distributions d JOIN tenants t ON t.id=d.tenant_id JOIN carrier_settlements cs ON cs.id=d.upstream_settlement_id WHERE t.tenant_type<>'internal' AND d.currency=$2 AND ($1::date IS NULL OR d.period_end>=$1::date) AND ($3::bigint IS NULL OR d.tenant_id=$3)";
    const tenantId=tenant?Number(tenant.id):null;
    const [summaryRows,rankingRows,trendRows]=await Promise.all([
      this.readSql.unsafe(
        "SELECT COALESCE(sum(d.upstream_payout_ht),0)::float8 AS upstream_payout_ht,COALESCE(sum(d.platform_fee_ht),0)::float8 AS margin_booked_ht,"+
        " COALESCE(sum(d.platform_fee_ht*("+paidRatio+")),0)::float8 AS margin_collected_ht,COALESCE(sum(d.net_payout_ht),0)::float8 AS client_net_payout_ht,"+
        " COALESCE(sum(d.unallocated_amount_ht),0)::float8 AS unallocated_amount_ht,count(DISTINCT d.tenant_id)::int AS customers_with_distribution"+
        baseWhere,
        [since,currency,tenantId]
      ),
      this.readSql.unsafe(
        "SELECT t.public_id::text AS tenant_public_id,t.display_name,t.legal_name,t.country_code,"+
        " COALESCE(sum(d.upstream_payout_ht),0)::float8 AS upstream_payout_ht,COALESCE(sum(d.platform_fee_ht),0)::float8 AS margin_booked_ht,"+
        " COALESCE(sum(d.platform_fee_ht*("+paidRatio+")),0)::float8 AS margin_collected_ht,COALESCE(sum(d.net_payout_ht),0)::float8 AS client_net_payout_ht,"+
        " COALESCE(sum(d.unallocated_amount_ht),0)::float8 AS unallocated_amount_ht,count(*)::int AS distribution_count"+
        baseWhere+" GROUP BY t.id,t.public_id,t.display_name,t.legal_name,t.country_code ORDER BY margin_collected_ht DESC,margin_booked_ht DESC,t.id DESC LIMIT $4",
        [since,currency,tenantId,limit]
      ),
      this.readSql.unsafe(
        "SELECT date_trunc($4::text,d.period_end::timestamp) AS bucket,"+
        " COALESCE(sum(d.platform_fee_ht),0)::float8 AS margin_booked_ht,COALESCE(sum(d.platform_fee_ht*("+paidRatio+")),0)::float8 AS margin_collected_ht,"+
        " COALESCE(sum(d.net_payout_ht),0)::float8 AS client_net_payout_ht,COALESCE(sum(d.upstream_payout_ht),0)::float8 AS upstream_payout_ht"+
        baseWhere+" GROUP BY date_trunc($4::text,d.period_end::timestamp) ORDER BY bucket",
        [since,currency,tenantId,bucket]
      )
    ]);
    const summary=summaryRows[0]||{upstream_payout_ht:0,margin_booked_ht:0,margin_collected_ht:0,client_net_payout_ht:0,unallocated_amount_ht:0,customers_with_distribution:0};
    const top5Collected=rankingRows.slice(0,5).reduce((n,x)=>n+Number(x.margin_collected_ht||0),0);
    const concentration=Number(summary.margin_collected_ht)>0?top5Collected/Number(summary.margin_collected_ht)*100:0;
    return {
      schema_version:"audiotel-customer-profitability/1",
      period,since,currency,currencies:currencies.length?currencies:[currency],
      accounting_basis:"tenant_revenue_distributions.platform_fee_ht",
      cash_basis:"carrier paid amount / confirmed amount",
      excludes:["general_platform_overhead","unconnected_subscription_cash"],
      tenant:tenant?{public_id:tenant.public_id,display_name:tenant.display_name}:null,
      summary:{...summary,top5_margin_collected_ht:top5Collected,top5_concentration_percent:concentration},
      ranking:rankingRows,
      trend:trendRows
    };
  }

  async createTenantPayoutTerms(publicId,input={},actor={}){
    publicId=String(publicId||"").trim();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(publicId))throw problem(400,"INVALID_TENANT_PUBLIC_ID");
    const percent=input.platform_fee_percent==null||input.platform_fee_percent===""?null:Number(input.platform_fee_percent);
    const bps=input.platform_fee_bps==null||input.platform_fee_bps===""?(percent==null?null:Math.round(percent*100)):Number(input.platform_fee_bps);
    const perMinute=input.platform_fee_ht_per_min==null||input.platform_fee_ht_per_min===""?0:Number(input.platform_fee_ht_per_min);
    const delay=Number(input.payout_delay_days??0);
    const marketId=input.market_id==null||input.market_id===""?null:Number(input.market_id);
    const svaNumberId=input.sva_number_id==null||input.sva_number_id===""?null:Number(input.sva_number_id);
    const effectiveFrom=input.effective_from?new Date(input.effective_from):new Date();
    if(!Number.isInteger(bps)||bps<0||bps>10000)throw problem(400,"INVALID_PLATFORM_FEE");
    if(!Number.isFinite(perMinute)||perMinute<0||perMinute>10000)throw problem(400,"INVALID_PLATFORM_FEE");
    if(bps===0&&perMinute===0)throw problem(400,"PGI_MARGIN_REQUIRED");
    if(!Number.isInteger(delay)||delay<0||delay>365)throw problem(400,"INVALID_PAYOUT_DELAY");
    if(marketId!=null&&(!Number.isInteger(marketId)||marketId<=0))throw problem(400,"INVALID_MARKET_ID");
    if(svaNumberId!=null&&(!Number.isInteger(svaNumberId)||svaNumberId<=0))throw problem(400,"INVALID_SVA_NUMBER_ID");
    if(!Number.isFinite(effectiveFrom.getTime()))throw problem(400,"INVALID_EFFECTIVE_FROM");
    const actorId=numericActor(actor);
    const result=await this.sql.begin(async tx=>{
      const tenant=(await tx.unsafe("SELECT id,tenant_type FROM tenants WHERE public_id=$1::uuid FOR UPDATE",[publicId]))[0];
      if(!tenant)throw problem(404,"TENANT_NOT_FOUND");
      if(tenant.tenant_type==="internal")throw problem(409,"INTERNAL_TENANT_PROTECTED");
      if(marketId!=null){
        const market=(await tx.unsafe("SELECT id FROM operating_markets WHERE id=$1 LIMIT 1",[marketId]))[0];
        if(!market)throw problem(404,"MARKET_NOT_FOUND");
      }
      if(svaNumberId!=null){
        const number=(await tx.unsafe("SELECT id,tenant_id,market_id FROM sva_numbers WHERE id=$1 LIMIT 1",[svaNumberId]))[0];
        if(!number||Number(number.tenant_id)!==Number(tenant.id))throw problem(409,"PAYOUT_TERMS_NUMBER_TENANT_MISMATCH");
        if(marketId!=null&&Number(number.market_id)!==marketId)throw problem(409,"PAYOUT_TERMS_MARKET_MISMATCH");
      }
      await tx.unsafe(
        "UPDATE tenant_payout_terms SET status='ended',effective_to=$4::timestamptz WHERE tenant_id=$1"+
        " AND COALESCE(market_id,0)=COALESCE($2::bigint,0) AND COALESCE(sva_number_id,0)=COALESCE($3::bigint,0)"+
        " AND status='active' AND effective_to IS NULL",
        [tenant.id,marketId,svaNumberId,effectiveFrom.toISOString()]
      );
      const row=(await tx.unsafe(
        "INSERT INTO tenant_payout_terms(tenant_id,market_id,sva_number_id,collection_model,platform_fee_bps,platform_fee_ht_per_min,payout_delay_days,effective_from,created_by)"+
        " VALUES($1,$2,$3,'pgi_collects',$4,$5,$6,$7,$8) RETURNING id,tenant_id,market_id,sva_number_id,collection_model,platform_fee_bps,platform_fee_ht_per_min::float8,payout_delay_days,status,effective_from,effective_to,created_at",
        [tenant.id,marketId,svaNumberId,bps,perMinute,delay,effectiveFrom.toISOString(),actorId]
      ))[0];
      await tx.unsafe(
        "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'tenant.payout_terms.create','tenant_payout_terms',$3,$4::jsonb)",
        [tenant.id,actorId,String(row.id),JSON.stringify({collection_model:"pgi_collects",platform_fee_bps:bps,platform_fee_ht_per_min:perMinute,payout_delay_days:delay,market_id:marketId,sva_number_id:svaNumberId})]
      );
      await tx.unsafe(
        "INSERT INTO outbox_events(tenant_id,market_id,event_type,aggregate_type,aggregate_id,payload) VALUES($1,$2,'tenant.payout_terms.changed','tenant_payout_terms',$3,$4::jsonb)",
        [tenant.id,marketId,String(row.id),JSON.stringify({platform_fee_bps:bps,platform_fee_ht_per_min:perMinute,payout_delay_days:delay})]
      );
      const pending=await tx.unsafe(
        "SELECT DISTINCT upstream_settlement_id FROM tenant_revenue_distributions WHERE tenant_id=$1 AND status IN ('blocked_terms','blocked_compliance','reconciled','payable') ORDER BY upstream_settlement_id",
        [tenant.id]
      );
      for(const p of pending)await rebuildTenantRevenueDistributions(tx,Number(p.upstream_settlement_id),actorId);
      return row;
    });
    this.eventBus.publish("tenant.payout_terms.changed",{tenant_public_id:publicId,id:Number(result.id)});
    return result;
  }

  async tenantControlDetail(publicId){
    publicId=String(publicId||"").trim();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(publicId))throw problem(400,"INVALID_TENANT_PUBLIC_ID");
    const base=await this.readSql.unsafe(
      "SELECT t.id,t.public_id,t.slug,t.display_name,t.legal_name,t.tenant_type,t.status,t.country_code,t.billing_email,"+
      " t.preferred_locale,t.default_currency,t.timezone,t.home_region,t.capacity_tier,t.created_at,t.updated_at,"+
      " COALESCE(k.status,'not_started') AS kyc_status,k.registration_country,k.registration_number,"+
      " k.legal_representative_verified,k.bank_account_verified,k.reviewed_at,k.expires_at"+
      " FROM tenants t LEFT JOIN tenant_kyc_profiles k ON k.tenant_id=t.id WHERE t.public_id=$1::uuid",
      [publicId]
    );
    const tenant=base[0];if(!tenant)throw problem(404,"TENANT_NOT_FOUND");
    if(tenant.tenant_type==="internal")throw problem(409,"INTERNAL_TENANT_PROTECTED");
    const id=Number(tenant.id);
    const [subs,lines,portability,destinations,experts,alerts,settlements,payoutTerms,controls,audit,activity,serviceIncidents,operationalAlerts,users,invitations]=await Promise.all([
      this.readSql.unsafe(
        "SELECT s.id,s.status,s.billing_currency,s.starts_at,s.current_period_start,s.current_period_end,s.ends_at,"+
        " s.billing_provider,s.provider_customer_reference,s.provider_subscription_reference,s.cancel_at_period_end,s.last_payment_status,s.last_event_at,"+
        " p.plan_key,p.display_name AS plan_name,v.amount_minor,v.currency AS price_currency"+
        " FROM tenant_subscriptions s JOIN service_plans p ON p.id=s.service_plan_id"+
        " LEFT JOIN service_plan_price_versions v ON v.id=s.price_version_id WHERE s.tenant_id=$1 ORDER BY s.created_at DESC,s.id DESC LIMIT 10",[id]
      ),
      this.readSql.unsafe(
        "SELECT a.id,sn.display_number,sn.e164,sn.currency,sn.number_type,m.country_code AS market,a.tariff_code,a.assignment_type,a.status,a.kyc_status,"+
        " c.name AS regulatory_assignor,a.valid_from,a.valid_to,pgi_tenant_has_premium_call_access($1,m.id,now()) AS premium_call_access"+
        " FROM tenant_number_assignments a JOIN sva_numbers sn ON sn.id=a.sva_number_id LEFT JOIN operating_markets m ON m.id=sn.market_id"+
        " LEFT JOIN carriers c ON c.id=a.regulatory_assignor_carrier_id WHERE a.tenant_id=$1 ORDER BY a.created_at DESC,a.id DESC LIMIT 100",[id]
      ),
      this.readSql.unsafe(
        "SELECT p.id,p.country_code,p.requested_e164,p.display_number,p.service_family,p.current_operator_name,p.current_operator_reference,p.account_holder_name,p.desired_port_date,p.status,p.ownership_status,p.operator_portability_reference,p.scheduled_at,p.completed_at,p.rejection_reason,"+
        " p.target_carrier_id,c.name AS target_carrier,p.tariff_code,p.service_rate_ttc_per_min::float8,p.currency,p.tariff_verification_status,p.tariff_verified_at,"+
        " p.rio_last4,p.rio_validation_status,p.rio_validated_at,p.source_contract_transfer_mode,p.source_contract_liability_acknowledged,"+
        " p.automation_state,p.automation_last_error,p.automation_last_sync_at,p.operator_status,p.created_at,p.updated_at"+
        " FROM tenant_portability_requests p LEFT JOIN carriers c ON c.id=p.target_carrier_id WHERE p.tenant_id=$1 ORDER BY p.created_at DESC,p.id DESC LIMIT 50",[id]
      ),
      this.readSql.unsafe(
        "SELECT d.id,d.label,d.destination_type,d.destination_uri,d.priority,d.status,d.failover_enabled,d.max_concurrent_calls,d.active_calls,d.last_assigned_at,d.sva_number_id,sn.display_number,sn.e164"+
        " FROM tenant_call_destinations d LEFT JOIN sva_numbers sn ON sn.id=d.sva_number_id WHERE d.tenant_id=$1 ORDER BY d.priority,d.id LIMIT 100",[id]
      ),
      this.readSql.unsafe(
        "SELECT id,code,display_name,destination_uri,status,active_calls,last_assigned_at,enabled,compensation_type,compensation_rate::float8"+
        " FROM experts WHERE tenant_id=$1 ORDER BY display_name,id LIMIT 100",[id]
      ),
      this.readSql.unsafe(
        "SELECT id,alert_type,severity,state,title,message,due_at,first_detected_at,last_detected_at,acknowledged_at,resolved_at"+
        " FROM tenant_admin_alerts WHERE tenant_id=$1 ORDER BY id DESC LIMIT 50",[id]
      ),
      this.readSql.unsafe(
        "SELECT s.id,m.country_code AS market,s.currency,s.period_start,s.period_end,s.upstream_payout_ht::float8,s.platform_fee_ht::float8,s.net_payout_ht::float8,"+
        " s.unallocated_amount_ht::float8,s.held_amount_ht::float8,s.collection_model,s.status,s.payment_due_date,s.paid_at,s.statement_reference"+
        " FROM tenant_revenue_distributions s LEFT JOIN operating_markets m ON m.id=s.market_id"+
        " WHERE s.tenant_id=$1 ORDER BY s.period_end DESC,s.id DESC LIMIT 24",[id]
      ),
      this.readSql.unsafe(
        "SELECT pt.id,pt.market_id,m.country_code AS market,pt.sva_number_id,sn.display_number,pt.collection_model,pt.platform_fee_bps,"+
        " pt.platform_fee_ht_per_min::float8,pt.payout_delay_days,pt.status,pt.effective_from,pt.effective_to,pt.created_at"+
        " FROM tenant_payout_terms pt LEFT JOIN operating_markets m ON m.id=pt.market_id LEFT JOIN sva_numbers sn ON sn.id=pt.sva_number_id"+
        " WHERE pt.tenant_id=$1 ORDER BY (pt.status='active') DESC,pt.effective_from DESC,pt.id DESC LIMIT 50",[id]
      ),
      this.readSql.unsafe(
        "SELECT id,assignment_id,action,previous_status,new_status,reason,occurred_at,details FROM tenant_control_events"+
        " WHERE tenant_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 50",[id]
      ),
      this.readSql.unsafe(
        "SELECT id,action,entity_type,entity_id,occurred_at,details FROM audit_log WHERE tenant_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 50",[id]
      ),
      this.readSql.unsafe(
        "SELECT count(*)::int AS calls_30d,count(*) FILTER (WHERE call_status='connected')::int AS connected_30d,"+
        " COALESCE(sum(billable_seconds),0)::float8 AS billable_seconds_30d,COALESCE(sum(retail_service_amount_ttc),0)::float8 AS revenue_ttc_30d,"+
        " COALESCE(sum(estimated_margin_ht),0)::float8 AS margin_ht_30d,max(started_at) AS last_call_at"+
        " FROM calls WHERE tenant_id=$1 AND started_at>=now()-interval '30 days'",[id]
      ),
      this.readSql.unsafe(
        "SELECT id,public_id,category,severity,status,source,title,description,assigned_team,first_response_due_at,target_resolution_at,first_responded_at,last_customer_update_at,last_pgi_update_at,resolved_at,created_at,updated_at"+
        " FROM tenant_service_incidents WHERE tenant_id=$1 ORDER BY (status IN ('resolved','closed')) ASC,updated_at DESC,id DESC LIMIT 30",[id]
      ),
      this.readSql.unsafe(
        "SELECT id,incident_id,alert_type,severity,state,title,message,due_at,customer_visible,last_detected_at"+
        " FROM tenant_operational_alerts WHERE tenant_id=$1 AND state<>'resolved' ORDER BY last_detected_at DESC,id DESC LIMIT 50",[id]
      ),
      this.readSql.unsafe(
        "SELECT p.id,p.email,p.display_name,p.status,p.preferred_locale,p.timezone,p.email_verified,p.last_authenticated_at,p.created_at,p.updated_at,"+
        " m.role,m.status AS membership_status,p.metadata->>'first_name' AS first_name,p.metadata->>'last_name' AS last_name,p.metadata->>'phone' AS phone,p.metadata->>'signup_source' AS signup_source,p.metadata->>'service_intent' AS service_intent,p.metadata->>'account_type' AS account_type"+
        " FROM customer_tenant_memberships m JOIN customer_principals p ON p.id=m.customer_principal_id WHERE m.tenant_id=$1 ORDER BY (m.role='owner') DESC,p.created_at,p.id LIMIT 100",[id]
      ),
      this.readSql.unsafe(
        "SELECT id,email,role,status,expires_at,accepted_at,created_at FROM customer_tenant_invitations WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100",[id]
      )
    ]);
    const access=await this.readSql.unsafe("SELECT pgi_tenant_has_premium_call_access($1,NULL,now()) AS allowed",[id]);
    return {
      tenant:{...tenant,premium_call_access:Boolean(access[0]?.allowed)},
      subscriptions:subs,lines,portability,destinations,experts,alerts,settlements,payout_terms:payoutTerms,controls,audit,service_incidents:serviceIncidents,operational_alerts:operationalAlerts,users,invitations,
      activity:activity[0]||{calls_30d:0,connected_30d:0,billable_seconds_30d:0,revenue_ttc_30d:0,margin_ht_30d:0,last_call_at:null}
    };
  }

  async tenantInternalNotes(publicId){
    publicId=String(publicId||"").trim();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(publicId))throw problem(400,"INVALID_TENANT_PUBLIC_ID");
    const tenant=(await this.readSql.unsafe("SELECT id,tenant_type FROM tenants WHERE public_id=$1::uuid",[publicId]))[0];
    if(!tenant)throw problem(404,"TENANT_NOT_FOUND");
    if(tenant.tenant_type==="internal")throw problem(409,"INTERNAL_TENANT_PROTECTED");
    const rows=await this.readSql.unsafe(
      "SELECT n.id,n.body,n.created_at,u.display_name AS author_name FROM tenant_internal_notes n"+
      " LEFT JOIN app_users u ON u.id=n.author_user_id WHERE n.tenant_id=$1 AND n.archived_at IS NULL ORDER BY n.created_at DESC,n.id DESC LIMIT 100",
      [tenant.id]
    );
    return {data:rows};
  }

  async createTenantInternalNote(publicId,input={},actor={}){
    publicId=String(publicId||"").trim();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(publicId))throw problem(400,"INVALID_TENANT_PUBLIC_ID");
    const body=String(input.body||"").trim();
    if(!body||body.length>2000)throw problem(400,"INVALID_INTERNAL_NOTE");
    const actorId=numericActor(actor);
    const row=await this.sql.begin(async tx=>{
      const tenant=(await tx.unsafe("SELECT id,tenant_type FROM tenants WHERE public_id=$1::uuid FOR SHARE",[publicId]))[0];
      if(!tenant)throw problem(404,"TENANT_NOT_FOUND");
      if(tenant.tenant_type==="internal")throw problem(409,"INTERNAL_TENANT_PROTECTED");
      const note=(await tx.unsafe(
        "INSERT INTO tenant_internal_notes(tenant_id,body,author_user_id) VALUES($1,$2,$3) RETURNING id,tenant_id,body,created_at",
        [tenant.id,body,actorId]
      ))[0];
      await tx.unsafe(
        "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'tenant.internal_note.create','tenant_internal_note',$3,$4::jsonb)",
        [tenant.id,actorId,String(note.id),JSON.stringify({private:true,body_logged:false})]
      );
      return note;
    });
    this.eventBus.publish("tenant.internal_note.changed",{tenant_public_id:publicId,note_id:Number(row.id),action:"created"});
    return row;
  }

  async archiveTenantInternalNote(id,actor={}){
    id=Number(id);if(!Number.isInteger(id)||id<=0)throw problem(400,"INVALID_INTERNAL_NOTE_ID");
    const actorId=numericActor(actor);
    const result=await this.sql.begin(async tx=>{
      const note=(await tx.unsafe(
        "SELECT n.id,n.tenant_id,n.archived_at,t.public_id,t.tenant_type FROM tenant_internal_notes n JOIN tenants t ON t.id=n.tenant_id WHERE n.id=$1 FOR UPDATE OF n",
        [id]
      ))[0];
      if(!note)throw problem(404,"INTERNAL_NOTE_NOT_FOUND");
      if(note.tenant_type==="internal")throw problem(409,"INTERNAL_TENANT_PROTECTED");
      if(note.archived_at)return {id:note.id,tenant_public_id:note.public_id,archived_at:note.archived_at,changed:false};
      const updated=(await tx.unsafe(
        "UPDATE tenant_internal_notes SET archived_at=now(),archived_by=$2 WHERE id=$1 RETURNING id,archived_at",
        [id,actorId]
      ))[0];
      await tx.unsafe(
        "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'tenant.internal_note.archive','tenant_internal_note',$3,$4::jsonb)",
        [note.tenant_id,actorId,String(id),JSON.stringify({private:true,body_logged:false})]
      );
      return {...updated,tenant_public_id:note.public_id,changed:true};
    });
    if(result.changed)this.eventBus.publish("tenant.internal_note.changed",{tenant_public_id:result.tenant_public_id,note_id:id,action:"archived"});
    return result;
  }

  async tenantAdminExport(publicId,actor={}){
    const detail=await this.tenantControlDetail(publicId);
    const t=detail.tenant||{};
    const safe={
      schema_version:"audiotel-customer-admin-export/1",
      generated_at:new Date().toISOString(),
      tenant:{
        public_id:t.public_id,display_name:t.display_name,legal_name:t.legal_name,status:t.status,country_code:t.country_code,
        billing_email:t.billing_email,preferred_locale:t.preferred_locale,default_currency:t.default_currency,timezone:t.timezone,
        created_at:t.created_at,updated_at:t.updated_at,kyc_status:t.kyc_status,registration_country:t.registration_country,
        registration_number:t.registration_number,legal_representative_verified:t.legal_representative_verified,bank_account_verified:t.bank_account_verified
      },
      users:(detail.users||[]).map(u=>({
        id:u.id,email:u.email,display_name:u.display_name,status:u.status,role:u.role,membership_status:u.membership_status,
        email_verified:u.email_verified,phone:u.phone||null,preferred_locale:u.preferred_locale,timezone:u.timezone,
        signup_source:u.signup_source||null,created_at:u.created_at,last_authenticated_at:u.last_authenticated_at
      })),
      invitations:(detail.invitations||[]).map(i=>({id:i.id,email:i.email,role:i.role,status:i.status,created_at:i.created_at,expires_at:i.expires_at,accepted_at:i.accepted_at})),
      subscriptions:(detail.subscriptions||[]).map(s=>({id:s.id,status:s.status,plan_name:s.plan_name,billing_currency:s.billing_currency,current_period_start:s.current_period_start,current_period_end:s.current_period_end,last_payment_status:s.last_payment_status})),
      lines:(detail.lines||[]).map(l=>({id:l.id,display_number:l.display_number,e164:l.e164,market:l.market,status:l.status,kyc_status:l.kyc_status,regulatory_assignor:l.regulatory_assignor})),
      portability:(detail.portability||[]).map(p=>({id:p.id,country_code:p.country_code,requested_e164:p.requested_e164,status:p.status,current_operator_name:p.current_operator_name,desired_port_date:p.desired_port_date,created_at:p.created_at,completed_at:p.completed_at})),
      settlements:(detail.settlements||[]).map(s=>({id:s.id,market:s.market,currency:s.currency,period_start:s.period_start,period_end:s.period_end,net_payout_ht:s.net_payout_ht,status:s.status,payment_due_date:s.payment_due_date,paid_at:s.paid_at})),
      activity:detail.activity||{}
    };
    const actorId=numericActor(actor);
    await this.sql.unsafe(
      "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'tenant.admin_export','tenant',$3,$4::jsonb)",
      [Number(t.id),actorId,String(t.id),JSON.stringify({format:"csv",schema_version:safe.schema_version,scope:"customer_360"})]
    );
    this.eventBus.publish("tenant.admin_export",{tenant_public_id:publicId,actor_user_id:actorId});
    return safe;
  }

  async operationalPolicyEvaluation(input={}){
    const intent=String(input.intent||"").trim().toLowerCase();
    const assignmentId=input.assignment_id==null||input.assignment_id===""?null:Number(input.assignment_id);
    const tenantPublicId=optionalText(input.tenant_public_id,80);
    const portabilityId=input.portability_request_id==null||input.portability_request_id===""?null:Number(input.portability_request_id);
    const targetConnectionId=input.target_connection_id==null||input.target_connection_id===""?null:Number(input.target_connection_id);
    let context=null;
    if(Number.isInteger(assignmentId)&&assignmentId>0){
      context=(await this.readSql.unsafe(
        "SELECT t.id AS tenant_id,t.public_id::text AS tenant_public_id,t.display_name,t.status AS tenant_status,t.tenant_type,"+
        " a.id AS assignment_id,a.status AS assignment_status,a.sva_number_id,sn.market_id"+
        " FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id JOIN sva_numbers sn ON sn.id=a.sva_number_id WHERE a.id=$1",
        [assignmentId]
      ))[0]||null;
    }else if(tenantPublicId&&/^[0-9a-f-]{36}$/i.test(tenantPublicId)){
      context=(await this.readSql.unsafe(
        "SELECT t.id AS tenant_id,t.public_id::text AS tenant_public_id,t.display_name,t.status AS tenant_status,t.tenant_type,NULL::bigint AS assignment_id,NULL::text AS assignment_status,NULL::bigint AS sva_number_id,NULL::bigint AS market_id"+
        " FROM tenants t WHERE t.public_id=$1::uuid",
        [tenantPublicId]
      ))[0]||null;
    }
    if(intent!=="carrier_switch"&&!context)throw problem(404,"POLICY_CONTEXT_NOT_FOUND");
    const tenantId=context?.tenant_id||null,svaNumberId=context?.sva_number_id||null,marketId=context?.market_id||null;

    const factsRows=await this.readSql.unsafe(
      "SELECT"+
      " CASE WHEN $1::bigint IS NULL THEN NULL ELSE EXISTS(SELECT 1 FROM tenants WHERE id=$1 AND status='active') END AS tenant_active,"+
      " CASE WHEN $1::bigint IS NULL THEN NULL ELSE pgi_tenant_has_premium_call_access($1,$3,now()) END AS subscription_active,"+
      " CASE WHEN $1::bigint IS NULL THEN NULL ELSE pgi_tenant_has_payout_terms($1,$3,$2,now()) END AS payout_terms_ready,"+
      " CASE WHEN $1::bigint IS NULL THEN NULL ELSE EXISTS(SELECT 1 FROM tenant_kyc_profiles WHERE tenant_id=$1 AND status='verified') END AS kyc_verified,"+
      " CASE WHEN $2::bigint IS NULL THEN NULL ELSE pgi_sva_regulatory_ready($1,$2) END AS regulatory_ready,"+
      " CASE WHEN $2::bigint IS NULL THEN NULL ELSE pgi_arcep_2026_number_ready($1,$2) END AS arcep_2026_ready,"+
      " CASE WHEN $2::bigint IS NULL THEN NULL ELSE pgi_sva_ecosystem_ready($1,$2) END AS ecosystem_ready,"+
      " CASE WHEN $4::bigint IS NULL THEN NULL ELSE EXISTS(SELECT 1 FROM tenant_number_assignments WHERE id=$4) END AS assignment_exists,"+
      " CASE WHEN $1::bigint IS NULL THEN NULL ELSE EXISTS(SELECT 1 FROM tenant_call_destinations d WHERE d.tenant_id=$1 AND ($2::bigint IS NULL OR d.sva_number_id IS NULL OR d.sva_number_id=$2) AND d.status='active' AND d.active_calls<d.max_concurrent_calls) END AS destination_ready,"+
      " CASE WHEN $5::bigint IS NULL THEN EXISTS(SELECT 1 FROM tenant_portability_requests p WHERE p.tenant_id=$1 AND p.status IN ('scheduled','ported')) ELSE EXISTS(SELECT 1 FROM tenant_portability_requests p WHERE p.tenant_id=$1 AND p.id=$5 AND p.status IN ('scheduled','ported')) END AS portability_dossier_ready,"+
      " EXISTS(SELECT 1 FROM carrier_adapters ca JOIN carrier_connections cc ON cc.carrier_id=ca.carrier_id WHERE ca.enabled AND cc.purpose='api' AND cc.state IN ('ready','active')) AS operator_adapter_connected,"+
      " CASE WHEN $6::bigint IS NULL THEN NULL ELSE EXISTS(SELECT 1 FROM carrier_connections cc WHERE cc.id=$6 AND cc.state IN ('ready','active','standby')) END AS target_carrier_ready,"+
      " EXISTS(SELECT 1 FROM logical_carrier_routes r WHERE r.route_key='sva-primary' AND r.active_carrier_id IS NOT NULL AND r.active_connection_id IS NOT NULL) AS rollback_ready,"+
      " CASE WHEN $1::bigint IS NULL THEN NULL ELSE EXISTS(SELECT 1 FROM tenant_revenue_distributions d WHERE d.tenant_id=$1 AND d.status IN ('reconciled','payable','paid')) END AS settlement_reconciled",
      [tenantId,svaNumberId,marketId,assignmentId,portabilityId,targetConnectionId]
    );
    const facts={...(factsRows[0]||{}),payment_provider_connected:false};
    const result=evaluateOperationalPolicy(intent,facts);
    return {...result,context:context?{tenant_public_id:context.tenant_public_id,tenant:context.display_name,assignment_id:context.assignment_id,assignment_status:context.assignment_status}:null};
  }

  async digitalTwinSimulation(input={}){
    const scenario=String(input.scenario||"").trim().toLowerCase();
    const params=input.parameters&&typeof input.parameters==="object"&&!Array.isArray(input.parameters)?input.parameters:{};
    const [platform,service,route,queue,capacityRows]=await Promise.all([
      this.wholesaleOverview(),
      this.serviceOperationsHealth(),
      this.carrierRouting(),
      this.workQueueHealth(),
      this.readSql.unsafe(
        "SELECT"+
        " COALESCE(sum(max_concurrent_calls) FILTER(WHERE status='active'),0)::int AS destination_capacity,"+
        " COALESCE(sum(active_calls) FILTER(WHERE status='active'),0)::int AS current_concurrent"+
        " FROM tenant_call_destinations"
      )
    ]);
    const s=platform.summary||{},r=platform.regulatory_trust?.summary||{},scale=platform.scale||{},cap=capacityRows[0]||{};
    const baseline={
      active_assignments:Number(s.assignments_active||0),
      active_subscriptions:Number(s.external_subscriptions_active||0),
      ready_numbers:Number(r.numbers_ready||0),
      total_numbers:Number(r.numbers_total||0),
      regulatory_blocking:Number(r.review_blocking||0),
      service_incidents_critical:Number(service.service_incidents_critical||0),
      route_standby_ready:Boolean(route?.standby_carrier_id||route?.standby_carrier),
      destination_capacity:Number(cap.destination_capacity||0),
      current_concurrent:Number(cap.current_concurrent||0),
      regions_ready:Number(scale.regions_ready||0),
      regions_total:Number(scale.regions_total||0),
      dr_targets:Number(scale.dr_targets_total||0),
      read_replica_enabled:Boolean(scale.read_replica_enabled),
      queue_pending:Number(queue.pending||0),
      queue_dead_lettered:Number(queue.dead_lettered||0),
      bucket_capacity:Number(scale.bucket_capacity||4096)
    };
    return simulateDigitalTwin(scenario,baseline,params);
  }

  async performanceResilienceLab(){
    const [queue,dbRows,tableRows,drTargets,drills,runs,syntheticRows]=await Promise.all([
      this.workQueueHealth(),
      this.readSql.unsafe(
        "SELECT current_database() AS database_name,pg_database_size(current_database())::bigint AS database_bytes,"+
        " current_setting('max_connections')::int AS max_connections,"+
        " (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()) AS connections_total,"+
        " (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND state='active') AS connections_active,"+
        " (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction') AS connections_idle_in_transaction"
      ),
      this.readSql.unsafe(
        "SELECT relname,n_live_tup::bigint AS live_rows,n_dead_tup::bigint AS dead_rows,seq_scan::bigint,idx_scan::bigint,"+
        " CASE WHEN n_live_tup>0 THEN round((n_dead_tup::numeric/n_live_tup::numeric)*100,2)::float8 ELSE 0::float8 END AS dead_row_percent"+
        " FROM pg_stat_user_tables WHERE schemaname='public' ORDER BY n_live_tup DESC,relname LIMIT 20"
      ),
      this.readSql.unsafe(
        "SELECT component_key,region_key,rpo_seconds,rto_seconds,replication_mode,criticality,enabled,updated_at"+
        " FROM disaster_recovery_targets WHERE enabled ORDER BY criticality,component_key,region_key"
      ),
      this.readSql.unsafe(
        "SELECT id,drill_type,source_region,target_region,started_at,completed_at,status,observed_rpo_seconds,observed_rto_seconds,evidence_ref"+
        " FROM disaster_recovery_drills ORDER BY started_at DESC,id DESC LIMIT 20"
      ),
      this.readSql.unsafe(
        "SELECT id,run_type,scenario,target,status,started_at,completed_at,requests_total,errors_total,error_rate::float8,p50_ms::float8,p95_ms::float8,p99_ms::float8,requests_per_second::float8,virtual_users,thresholds,evidence_ref"+
        " FROM performance_lab_runs ORDER BY completed_at DESC,id DESC LIMIT 30"
      ),
      this.readSql.unsafe(
        "SELECT count(*)::int AS checks_24h,count(*) FILTER(WHERE success)::int AS successes_24h,"+
        " COALESCE(avg(latency_ms),0)::float8 AS avg_latency_ms,COALESCE(max(latency_ms),0)::float8 AS max_latency_ms,"+
        " max(checked_at) AS last_checked_at,max(checked_at) FILTER(WHERE NOT success) AS last_failure_at"+
        " FROM synthetic_probe_results WHERE checked_at>=now()-interval '24 hours'"
      )
    ]);
    const db=dbRows[0]||{},syn=syntheticRows[0]||{};
    const maxConnections=Number(db.max_connections||0),connections=Number(db.connections_total||0);
    const dbHeadroom=maxConnections>0?Math.max(0,(maxConnections-connections)/maxConnections*100):0;
    const recentLoad=runs.find(x=>["load","stress","spike","soak"].includes(x.run_type))||null;
    const recentPassedLoad=runs.find(x=>["load","stress","spike","soak"].includes(x.run_type)&&x.status==="passed")||null;
    const latestRestore=drills.find(x=>x.drill_type==="restore")||null;
    const syntheticSuccess=Number(syn.checks_24h)>0?Number(syn.successes_24h)/Number(syn.checks_24h)*100:null;
    const tableAttention=tableRows.filter(x=>Number(x.live_rows)>1000&&((Number(x.idx_scan)===0&&Number(x.seq_scan)>20)||Number(x.dead_row_percent)>20));
    const evidenceFresh=recentPassedLoad&&Date.now()-Date.parse(recentPassedLoad.completed_at)<=30*86400000;
    const restoreFresh=latestRestore?.status==="passed"&&Date.now()-Date.parse(latestRestore.completed_at)<=30*86400000;
    const blockers=[];
    if(!recentPassedLoad)blockers.push({code:"LOAD_PROOF_MISSING",label:"Aucun test de charge réussi n’est encore enregistré."});
    else if(!evidenceFresh)blockers.push({code:"LOAD_PROOF_STALE",label:"Le dernier test de charge réussi date de plus de 30 jours."});
    if(dbHeadroom<30)blockers.push({code:"DB_CONNECTION_HEADROOM_LOW",label:"La réserve de connexions PostgreSQL est inférieure à 30 %."});
    if(Number(queue.dead_lettered||0)>0)blockers.push({code:"DEAD_LETTERS_PRESENT",label:"La file contient des dead letters."});
    if(Number(queue.oldest_pending_seconds||0)>120)blockers.push({code:"QUEUE_BACKLOG_OLD",label:"Le plus ancien travail en attente dépasse 120 secondes."});
    if(!latestRestore)blockers.push({code:"RESTORE_DRILL_MISSING",label:"Aucun exercice de restauration PostgreSQL n’est enregistré."});
    else if(!restoreFresh)blockers.push({code:"RESTORE_DRILL_STALE",label:"Le dernier restore drill réussi date de plus de 30 jours."});
    const syntheticFresh=Boolean(syn.last_checked_at&&Date.now()-Date.parse(syn.last_checked_at)<=24*3600000);
    if(!syntheticFresh)blockers.push({code:"SYNTHETIC_PROOF_MISSING",label:"Aucune sonde synthétique récente n’est enregistrée sur les dernières 24 h."});
    else if(syntheticSuccess!=null&&syntheticSuccess<99)blockers.push({code:"SYNTHETIC_AVAILABILITY_LOW",label:"Le taux de succès synthétique sur 24 h est inférieur à 99 %."});
    if(tableAttention.length)blockers.push({code:"POSTGRES_TABLE_ATTENTION",label:tableAttention.length+" table(s) nécessitent une revue d’index ou de vacuum."});
    return {
      schema_version:"audiotel-performance-resilience-lab/1",
      generated_at:new Date().toISOString(),
      capacity_proof:recentPassedLoad?(evidenceFresh?"fresh":"stale"):"unproven",
      preproduction_gate:{ready:blockers.length===0,blockers},
      database:{
        name:db.database_name||null,size_bytes:Number(db.database_bytes||0),max_connections:maxConnections,
        connections_total:connections,connections_active:Number(db.connections_active||0),
        connections_idle_in_transaction:Number(db.connections_idle_in_transaction||0),
        connection_headroom_percent:Number(dbHeadroom.toFixed(1)),
        pool_max:Number(this.config.databasePoolMax||0),read_pool_max:Number(this.config.databaseReadPoolMax||0),
        tables:tableRows,attention:tableAttention
      },
      queue,
      synthetic:{
        checks_24h:Number(syn.checks_24h||0),successes_24h:Number(syn.successes_24h||0),
        success_percent:syntheticSuccess==null?null:Number(syntheticSuccess.toFixed(2)),
        avg_latency_ms:Number(syn.avg_latency_ms||0),max_latency_ms:Number(syn.max_latency_ms||0),
        last_checked_at:syn.last_checked_at||null,last_failure_at:syn.last_failure_at||null
      },
      load:{latest:recentLoad,latest_passed:recentPassedLoad,runs},
      disaster_recovery:{targets:drTargets,latest_restore:latestRestore,drills},
      rate_limits:{
        global_per_minute:Number(this.config.rateLimitPerMinute||0),
        heavy_read_per_minute:Number(this.config.heavyReadRateLimitPerMinute||0),
        write_per_minute:Number(this.config.writeRateLimitPerMinute||0)
      },
      claims:{capacity_guaranteed:false,external_connections_active:false}
    };
  }

  async recordPerformanceLabRun(input={},actor={}){
    const runType=String(input.run_type||"").trim().toLowerCase();
    if(!["load","stress","spike","soak","synthetic","chaos","restore"].includes(runType))throw problem(400,"INVALID_PERFORMANCE_RUN_TYPE");
    const scenario=String(input.scenario||"").trim().slice(0,120);
    if(scenario.length<2)throw problem(400,"INVALID_PERFORMANCE_SCENARIO");
    const status=String(input.status||"").trim().toLowerCase();
    if(!["passed","failed","aborted","informational"].includes(status))throw problem(400,"INVALID_PERFORMANCE_STATUS");
    const started=new Date(String(input.started_at||"")),completed=new Date(String(input.completed_at||""));
    if(!Number.isFinite(started.getTime())||!Number.isFinite(completed.getTime())||completed<started)throw problem(400,"INVALID_PERFORMANCE_WINDOW");
    const nonNegative=(v,name)=>{const n=Number(v??0);if(!Number.isFinite(n)||n<0)throw problem(400,name);return n;};
    const requests=Math.trunc(nonNegative(input.requests_total,"INVALID_PERFORMANCE_REQUESTS"));
    const errors=Math.trunc(nonNegative(input.errors_total,"INVALID_PERFORMANCE_ERRORS"));
    const errorRate=nonNegative(input.error_rate,"INVALID_PERFORMANCE_ERROR_RATE");
    if(errorRate>1||errors>requests&&requests>0)throw problem(400,"INVALID_PERFORMANCE_ERROR_RATE");
    const metric=name=>input[name]==null?null:nonNegative(input[name],"INVALID_PERFORMANCE_METRIC");
    let target=input.target==null?null:String(input.target).trim().slice(0,240);
    if(target){try{const u=new URL(target);target=u.origin+u.pathname;}catch{target=target.replace(/[?#].*$/,"");}}
    const thresholds=input.thresholds&&typeof input.thresholds==="object"&&!Array.isArray(input.thresholds)?input.thresholds:{};
    const details=input.details&&typeof input.details==="object"&&!Array.isArray(input.details)?input.details:{};
    if(JSON.stringify(thresholds).length>8000||JSON.stringify(details).length>16000)throw problem(400,"PERFORMANCE_DETAILS_TOO_LARGE");
    const actorId=numericActor(actor);
    const rows=await this.sql.unsafe(
      "INSERT INTO performance_lab_runs(run_type,scenario,target,status,started_at,completed_at,requests_total,errors_total,error_rate,p50_ms,p95_ms,p99_ms,requests_per_second,virtual_users,thresholds,details,evidence_ref,created_by)"+
      " VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18)"+
      " RETURNING id,run_type,scenario,target,status,started_at,completed_at,requests_total,errors_total,error_rate::float8,p50_ms::float8,p95_ms::float8,p99_ms::float8,requests_per_second::float8,virtual_users,evidence_ref,created_at",
      [runType,scenario,target,status,started.toISOString(),completed.toISOString(),requests,errors,errorRate,metric("p50_ms"),metric("p95_ms"),metric("p99_ms"),metric("requests_per_second"),input.virtual_users==null?null:Math.max(0,Math.trunc(Number(input.virtual_users)||0)),JSON.stringify(thresholds),JSON.stringify(details),input.evidence_ref?String(input.evidence_ref).slice(0,500):null,actorId]
    );
    await this.sql.unsafe(
      "INSERT INTO audit_log(user_id,action,entity_type,entity_id,details) VALUES($1,'performance_lab.run.record','performance_lab_run',$2,$3::jsonb)",
      [actorId,String(rows[0].id),JSON.stringify({run_type:runType,scenario,status,requests_total:requests,error_rate:errorRate})]
    );
    return rows[0];
  }

  async recordSyntheticProbe(input={}){
    const key=String(input.probe_key||"").trim().toLowerCase();
    if(!/^[a-z0-9_.-]{2,80}$/.test(key))throw problem(400,"INVALID_SYNTHETIC_PROBE_KEY");
    const success=input.success===true;
    const latency=Number(input.latency_ms);
    if(!Number.isFinite(latency)||latency<0||latency>600000)throw problem(400,"INVALID_SYNTHETIC_LATENCY");
    const status=input.http_status==null?null:Number(input.http_status);
    if(status!=null&&(!Number.isInteger(status)||status<100||status>599))throw problem(400,"INVALID_SYNTHETIC_HTTP_STATUS");
    const details=input.details&&typeof input.details==="object"&&!Array.isArray(input.details)?input.details:{};
    if(JSON.stringify(details).length>8000)throw problem(400,"SYNTHETIC_DETAILS_TOO_LARGE");
    const rows=await this.sql.unsafe(
      "INSERT INTO synthetic_probe_results(probe_key,success,latency_ms,http_status,release_id,error_code,details) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)"+
      " RETURNING id,probe_key,checked_at,success,latency_ms::float8,http_status,release_id,error_code",
      [key,success,latency,status,input.release_id?String(input.release_id).slice(0,80):null,input.error_code?String(input.error_code).slice(0,120):null,JSON.stringify(details)]
    );
    return rows[0];
  }

  async controlTowerOverview(){
    const [platform,service,route,queue,capacityRows,portabilityRows,shadowRows,riskRows,lastRows,changeRows]=await Promise.all([
      this.wholesaleOverview(),
      this.serviceOperationsHealth(),
      this.carrierRouting(),
      this.workQueueHealth(),
      this.readSql.unsafe("SELECT COALESCE(sum(max_concurrent_calls) FILTER(WHERE status='active'),0)::int AS capacity,COALESCE(sum(active_calls) FILTER(WHERE status='active'),0)::int AS in_use FROM tenant_call_destinations"),
      this.readSql.unsafe("SELECT count(*) FILTER(WHERE status NOT IN ('ported','rejected','cancelled'))::int AS open,count(*) FILTER(WHERE automation_state IN ('action_required','failed'))::int AS attention FROM tenant_portability_requests"),
      this.readSql.unsafe(
        "SELECT currency,COALESCE(sum(expected_payout_ht),0)::float8 AS expected_payout_ht,COALESCE(sum(confirmed_payout_ht),0)::float8 AS confirmed_payout_ht,COALESCE(sum(paid_payout_ht),0)::float8 AS paid_payout_ht,"+
        " COALESCE(sum(abs(reconciliation_variance_ht)),0)::float8 AS reconciliation_variance_ht,COALESCE(sum(calls_total) FILTER(WHERE confirmed_payout_ht>0),0)::bigint AS confirmed_calls,"+
        " COALESCE(sum(calls_total) FILTER(WHERE abs(reconciliation_variance_ht)>0.01),0)::bigint AS variance_calls"+
        " FROM metric_rollups_daily_v2 WHERE bucket_date>=current_date-29 GROUP BY currency ORDER BY currency"
      ),
      this.readSql.unsafe(
        "SELECT COALESCE(sum(calls_total),0)::float8 AS calls_7d,COALESCE(sum(calls_failed),0)::float8 AS failed_7d,COALESCE(sum(expected_payout_ht),0)::float8 AS expected_7d,"+
        " COALESCE(sum(abs(reconciliation_variance_ht)),0)::float8 AS variance_7d,COALESCE(sum(calls_total) FILTER(WHERE bucket_start>=now()-interval '1 hour'),0)::float8 AS calls_last_hour,"+
        " COALESCE(sum(calls_total),0)::float8/168.0 AS avg_hourly_7d FROM platform_rollups_hourly_sharded WHERE bucket_start>=now()-interval '7 days'"
      ),
      this.readSql.unsafe("SELECT max(ended_at) AS last_ended_at FROM calls"),
      this.readSql.unsafe(
        "SELECT cr.id,cr.public_id::text AS public_id,cr.change_type,cr.entity_type,cr.entity_id,cr.risk_level,cr.status,cr.request_reason,cr.requested_at,cr.expires_at,cr.approved_at,"+
        " requester.display_name AS requested_by_name,approver.display_name AS approved_by_name,cr.requested_by,cr.approved_by"+
        " FROM platform_change_requests cr JOIN app_users requester ON requester.id=cr.requested_by LEFT JOIN app_users approver ON approver.id=cr.approved_by"+
        " WHERE cr.status IN ('pending','approved') AND cr.expires_at>now() ORDER BY cr.requested_at DESC,cr.id DESC LIMIT 20"
      )
    ]);
    const s=platform.summary||{},reg=platform.regulatory_trust?.summary||{},scale=platform.scale||{},cap=capacityRows[0]||{},port=portabilityRows[0]||{};
    const cdrLag=lastRows[0]?.last_ended_at?Math.max(0,(Date.now()-Date.parse(lastRows[0].last_ended_at))/1000):0;
    const shadowBilling=assessShadowBilling(shadowRows);
    const risk=assessOperationalRisk({...riskRows[0],service_critical:service.service_incidents_critical,regulatory_blocking:reg.review_blocking,queue_dead_lettered:queue.dead_lettered});
    const slo=assessOperationalSlo({cdr_lag_seconds:cdrLag,queue_oldest_seconds:queue.oldest_pending_seconds,queue_dead_lettered:queue.dead_lettered,service_critical:service.service_incidents_critical,resolution_overdue:service.service_resolution_overdue,regions_total:scale.regions_total,regions_ready:scale.regions_ready});
    const pendingApprovals=changeRows.filter(x=>x.status==="pending").length;
    const ratios=[
      Number(s.tenants_total||0)>0?Number(s.tenants_active||0)/Number(s.tenants_total||1):1,
      Number(s.assignments_total||0)>0?Number(reg.numbers_ready||0)/Number(s.assignments_total||1):1,
      Number(s.assignments_total||0)>0?Number(s.subscription_access_enabled||0)/Number(s.assignments_total||1):1,
      Number(scale.regions_total||0)>0?Number(scale.regions_ready||0)/Number(scale.regions_total||1):1
    ];
    const readinessScore=Math.round(100*ratios.reduce((a,b)=>a+Math.max(0,Math.min(1,b)),0)/ratios.length);
    const priorities=[];
    const push=(severity,code,title,detail)=>priorities.push({severity,code,title,detail});
    if(Number(reg.review_blocking||0)>0)push("critical","REGULATORY_BLOCKING","Conformité bloquante",reg.review_blocking+" contrôle(s) réglementaire(s) critique(s) à traiter.");
    if(Number(service.service_incidents_critical||0)>0)push("critical","SERVICE_CRITICAL","Incidents critiques",service.service_incidents_critical+" incident(s) de service critique(s) ouvert(s).");
    if(Number(service.routing_unavailable||0)>0)push("critical","ROUTING_UNAVAILABLE","Routage indisponible",service.routing_unavailable+" alerte(s) de routage sans destination disponible.");
    if(Number(queue.dead_lettered||0)>0)push("critical","DEAD_LETTERS","Travaux en échec",queue.dead_lettered+" tâche(s) en dead-letter à examiner.");
    if(risk.level==="critical"||risk.level==="high")push(risk.level==="critical"?"critical":"warning","RISK_ENGINE","Risk Engine",risk.score+"/100 — "+risk.signals.length+" signal(s) agrégé(s).");
    if(slo.state==="critical"||slo.state==="burning")push(slo.state==="critical"?"critical":"warning","SLO_BURN","SLO opérationnels",slo.score+" % des objectifs instantanés respectés.");
    if(shadowBilling.status==="critical")push("critical","SHADOW_BILLING_VARIANCE","Écart shadow billing","Un écart de rapprochement supérieur au seuil interne est détecté.");
    if(pendingApprovals>0)push("warning","FOUR_EYES_PENDING","Validations 4 yeux",pendingApprovals+" changement(s) critique(s) attendent un second administrateur.");
    if(Number(port.attention||0)>0)push("warning","PORTABILITY_ATTENTION","Portabilités à traiter",port.attention+" dossier(s) de portabilité demandent une action.");
    if(Number(s.subscription_unpaid_alerts||0)>0)push("warning","UNPAID_SUBSCRIPTIONS","Abonnements impayés",s.subscription_unpaid_alerts+" alerte(s) d’impayé ouverte(s).");
    if(!priorities.length)push("info","NO_CRITICAL_ATTENTION","Aucune urgence critique","Les contrôles internes ne remontent aucun blocage critique.");
    const critical=priorities.filter(x=>x.severity==="critical").length,warning=priorities.filter(x=>x.severity==="warning").length;
    return {
      schema_version:"audiotel-control-tower/2",
      generated_at:new Date().toISOString(),
      status:critical?"critical":(warning?"attention":"healthy"),
      readiness_score:readinessScore,
      kpis:{
        customers_active:Number(s.tenants_active||0),customers_total:Number(s.tenants_total||0),
        assignments_active:Number(s.assignments_active||0),numbers_ready:Number(reg.numbers_ready||0),
        subscription_blocked:Number(s.subscription_access_blocked||0),regulatory_blocking:Number(reg.review_blocking||0),
        service_critical:Number(service.service_incidents_critical||0),portability_attention:Number(port.attention||0),
        queue_dead_lettered:Number(queue.dead_lettered||0),destination_capacity:Number(cap.capacity||0),concurrent_in_use:Number(cap.in_use||0),
        regions_ready:Number(scale.regions_ready||0),regions_total:Number(scale.regions_total||0),
        risk_score:risk.score,slo_score:slo.score,approvals_pending:pendingApprovals,shadow_billing_status:shadowBilling.status
      },
      priorities:priorities.slice(0,16),
      assurance:{risk,slo,shadow_billing:shadowBilling,change_requests:changeRows,dual_control_required:true},
      carrier_route:route,queue,service_operations:service,regulatory:reg,scale,
      capabilities:{
        policy_intents:["activate_number","port_in","payout_customer","carrier_switch","customer_access"],
        digital_twin_scenarios:["carrier_outage","traffic_spike","mass_portability","regulatory_expiry","billing_failure","region_failure","database_failure","worker_backlog","settlement_mismatch","hyperscale_growth"],
        external_connections_active:false,dual_control:true,shadow_billing:true,risk_engine:true,slo_snapshot:true
      }
    };
  }

  async wholesaleOverview(){
    const [summaryRows,tenants,numbers,settlements,payments,markets,currencyTotals,scaleRows,regulatorySummary,regulatoryNumbers,platformRegulatoryControls,regulatoryReviewAlerts]=await Promise.all([
      this.readSql.unsafe(
        "SELECT"+
        " (SELECT count(*)::int FROM tenants WHERE tenant_type<>'internal') AS tenants_total,"+
        " (SELECT count(*)::int FROM tenants WHERE tenant_type<>'internal' AND status='active') AS tenants_active,"+
        " (SELECT count(*)::int FROM tenant_kyc_profiles k JOIN tenants t ON t.id=k.tenant_id WHERE t.tenant_type<>'internal' AND k.status='verified') AS kyc_verified,"+
        " (SELECT count(*)::int FROM tenant_kyc_profiles k JOIN tenants t ON t.id=k.tenant_id WHERE t.tenant_type<>'internal' AND k.status='pending') AS kyc_pending,"+
        " (SELECT count(*)::int FROM operating_markets) AS markets_total,"+
        " (SELECT count(*)::int FROM operating_markets WHERE status='active') AS markets_active,"+
        " (SELECT count(*)::int FROM tenant_market_profiles p JOIN tenants t ON t.id=p.tenant_id WHERE t.tenant_type<>'internal' AND p.status='active') AS tenant_markets_active,"+
        " (SELECT count(*)::int FROM sva_numbers) AS inventory_total,"+
        " (SELECT count(*)::int FROM sva_numbers WHERE tenant_id IS NULL AND status IN ('pending','active')) AS inventory_unassigned,"+
        " (SELECT count(*)::int FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id WHERE t.tenant_type<>'internal') AS assignments_total,"+
        " (SELECT count(*)::int FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id WHERE t.tenant_type<>'internal' AND a.status='active') AS assignments_active,"+
        " (SELECT count(*)::int FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id WHERE t.tenant_type<>'internal' AND a.regulatory_assignor_carrier_id IS NOT NULL) AS assignments_with_assignor,"+
        " (SELECT count(*)::int FROM tenant_subscription_access WHERE tenant_type<>'internal' AND subscription_status='active' AND current_period_end>now()) AS external_subscriptions_active,"+
        " (SELECT count(*)::int FROM tenant_subscription_access WHERE tenant_type<>'internal' AND premium_call_access) AS subscription_access_enabled,"+
        " (SELECT count(*)::int FROM tenant_subscription_access WHERE tenant_type<>'internal' AND NOT premium_call_access) AS subscription_access_blocked,"+
        " (SELECT count(*)::int FROM tenant_admin_alerts a JOIN tenants t ON t.id=a.tenant_id WHERE t.tenant_type<>'internal' AND a.alert_type='subscription_unpaid' AND a.state<>'resolved') AS subscription_unpaid_alerts,"+
        " COALESCE((SELECT v.amount_minor::int FROM service_plan_price_versions v JOIN service_plans p ON p.id=v.service_plan_id"+
        " WHERE p.plan_key='external-sva-access' AND v.market_id IS NULL AND v.currency='EUR' AND v.effective_from<=now()"+
        " AND (v.effective_to IS NULL OR v.effective_to>now()) ORDER BY v.effective_from DESC LIMIT 1),0) AS subscription_price_minor,"+
        " 'EUR'::text AS subscription_price_currency,true AS internal_billing_exempt"
      ),
      this.readSql.unsafe(
        "SELECT t.id,t.slug,t.display_name,t.tenant_type,t.status,t.country_code,t.preferred_locale,t.default_currency,t.timezone,"+
        " COALESCE(k.status,'not_started') AS kyc_status,"+
        " count(DISTINCT a.id)::int AS number_assignments,"+
        " count(DISTINCT e.id)::int AS experts,"+
        " count(DISTINCT tmp.market_id)::int AS markets"+
        " FROM tenants t LEFT JOIN tenant_kyc_profiles k ON k.tenant_id=t.id"+
        " LEFT JOIN tenant_number_assignments a ON a.tenant_id=t.id"+
        " LEFT JOIN experts e ON e.tenant_id=t.id"+
        " LEFT JOIN tenant_market_profiles tmp ON tmp.tenant_id=t.id"+
        " WHERE t.tenant_type<>'internal'"+
        " GROUP BY t.id,k.status ORDER BY t.created_at DESC LIMIT 50"
      ),
      this.readSql.unsafe(
        "SELECT a.id,t.display_name AS tenant,sn.display_number,sn.e164,sn.currency,sn.number_type,"+
        " m.country_code AS market,a.tariff_code,a.assignment_type,a.status,a.kyc_status,"+
        " c.name AS regulatory_assignor,a.upstream_assignment_reference,a.valid_from,a.valid_to"+
        " FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id"+
        " JOIN sva_numbers sn ON sn.id=a.sva_number_id"+
        " LEFT JOIN operating_markets m ON m.id=sn.market_id"+
        " LEFT JOIN carriers c ON c.id=a.regulatory_assignor_carrier_id"+
        " WHERE t.tenant_type<>'internal' ORDER BY a.created_at DESC LIMIT 50"
      ),
      this.readSql.unsafe(
        "SELECT s.id,t.display_name AS tenant,m.country_code AS market,s.currency,s.period_start,s.period_end,s.upstream_payout_ht::float8,"+
        " s.platform_fee_ht::float8,s.net_payout_ht::float8,s.status,s.payment_due_date,s.paid_at"+
        " FROM tenant_revenue_distributions s JOIN tenants t ON t.id=s.tenant_id"+
        " LEFT JOIN operating_markets m ON m.id=s.market_id"+
        " WHERE t.tenant_type<>'internal' ORDER BY s.period_end DESC,s.id DESC LIMIT 50"
      ),
      this.readSql.unsafe(
        "SELECT p.id,p.profile_name,p.regulatory_role,p.provider_name,p.funds_flow_mode,p.status,p.valid_from,p.valid_to,"+
        " COALESCE(json_agg(json_build_object('market',m.country_code,'status',pm.status)) FILTER (WHERE m.id IS NOT NULL),'[]'::json) AS markets"+
        " FROM payment_compliance_profiles p"+
        " LEFT JOIN payment_compliance_market_profiles pm ON pm.payment_compliance_profile_id=p.id"+
        " LEFT JOIN operating_markets m ON m.id=pm.market_id"+
        " GROUP BY p.id ORDER BY p.created_at DESC LIMIT 20"
      ),
      this.readSql.unsafe(
        "SELECT m.id,m.country_code,m.display_name,m.status,m.default_currency,m.default_locale,m.timezone,m.regulator_name,m.numbering_authority,m.data_region,"+
        " count(DISTINCT tmp.tenant_id)::int AS tenants,"+
        " count(DISTINCT sn.id)::int AS numbers"+
        " FROM operating_markets m"+
        " LEFT JOIN tenant_market_profiles tmp ON tmp.market_id=m.id AND tmp.status<>'closed'"+
        " LEFT JOIN sva_numbers sn ON sn.market_id=m.id"+
        " GROUP BY m.id ORDER BY CASE WHEN m.status='active' THEN 0 ELSE 1 END,m.country_code"
      ),
      this.readSql.unsafe(
        "SELECT s.currency,"+
        " COALESCE(sum(s.upstream_payout_ht),0)::float8 AS upstream_payout,"+
        " COALESCE(sum(s.platform_fee_ht),0)::float8 AS platform_fee,"+
        " COALESCE(sum(s.net_payout_ht),0)::float8 AS net_payout"+
        " FROM tenant_revenue_distributions s JOIN tenants t ON t.id=s.tenant_id"+
        " WHERE t.tenant_type<>'internal' GROUP BY s.currency ORDER BY s.currency"
      ),
      this.readSql.unsafe(
        "SELECT"+
        " (SELECT count(*)::int FROM data_clusters) AS clusters_total,"+
        " (SELECT count(*)::int FROM data_clusters WHERE state='ready') AS clusters_ready,"+
        " (SELECT count(*)::int FROM routing_buckets WHERE state='active') AS routing_buckets_active,"+
        " (SELECT count(*)::bigint FROM tenant_data_placement WHERE state='active') AS placements_active,"+
        " (SELECT count(*)::int FROM pg_inherits WHERE inhparent='call_facts'::regclass) AS call_fact_partitions,"+
        " (SELECT count(*)::int FROM platform_regions) AS regions_total,"+
        " (SELECT count(*)::int FROM platform_regions WHERE status IN ('ready','active')) AS regions_ready,"+
        " (SELECT count(*)::int FROM disaster_recovery_targets WHERE enabled) AS dr_targets_total,"+
        " (SELECT count(*)::int FROM disaster_recovery_drills WHERE status='passed') AS dr_drills_passed"
      ),
      this.readSql.unsafe(
        "SELECT"+
        " (SELECT count(*)::int FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id WHERE t.tenant_type<>'internal') AS numbers_total,"+
        " (SELECT count(*)::int FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id WHERE t.tenant_type<>'internal' AND pgi_sva_regulatory_ready(a.tenant_id,a.sva_number_id) AND pgi_arcep_2026_number_ready(a.tenant_id,a.sva_number_id) AND pgi_sva_ecosystem_ready(a.tenant_id,a.sva_number_id)) AS numbers_ready,"+
        " (SELECT count(*)::int FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id WHERE t.tenant_type<>'internal' AND pgi_arcep_2026_number_ready(a.tenant_id,a.sva_number_id)) AS arcep_2026_ready,"+
        " (SELECT count(*)::int FROM sva_regulatory_evidence_events) AS evidence_events,"+
        " (SELECT count(*)::int FROM sva_arcep_2026_evidence_events) AS arcep_2026_evidence_events,"+
        " (SELECT count(*)::int FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id WHERE t.tenant_type<>'internal' AND pgi_sva_ecosystem_ready(a.tenant_id,a.sva_number_id)) AS sva_ecosystem_ready,"+
        " (SELECT count(*)::int FROM sva_ecosystem_evidence_events) AS sva_ecosystem_evidence_events,"+
        " (SELECT count(*)::int FROM sva_abuse_cases WHERE status NOT IN ('resolved','closed')) AS abuse_open,"+
        " (SELECT count(*)::int FROM sva_abuse_cases WHERE status NOT IN ('resolved','closed') AND severity='critical') AS abuse_critical,"+
        " (SELECT count(*)::int FROM platform_regulatory_controls WHERE status='verified' AND (valid_until IS NULL OR valid_until>now())) AS platform_controls_verified,"+
        " (SELECT count(*)::int FROM platform_regulatory_controls WHERE status IN ('failed','expired')) AS platform_controls_attention,"+
        " (SELECT count(*)::int FROM regulatory_review_alerts WHERE state<>'resolved') AS review_attention_total,"+
        " (SELECT count(*)::int FROM regulatory_review_alerts WHERE state<>'resolved' AND severity='critical') AS review_blocking,"+
        " (SELECT count(*)::int FROM regulatory_review_alerts WHERE state<>'resolved' AND severity<>'critical' AND due_at IS NOT NULL AND due_at<=now()+interval '24 hours') AS review_today,"+
        " (SELECT count(*)::int FROM regulatory_review_alerts WHERE state<>'resolved' AND severity<>'critical' AND (due_at IS NULL OR due_at>now()+interval '24 hours')) AS review_soon"
      ),
      this.readSql.unsafe(
        "SELECT a.id AS assignment_id,t.display_name AS tenant,sn.id AS sva_number_id,sn.display_number,sn.e164,m.country_code AS market,a.status AS assignment_status,"+
        " p.regulatory_role,p.service_name,p.provider_name,p.signaletic_model,p.numbering_rights_status,p.editor_identity_status,p.rsva_status,"+
        " p.tariff_transparency_status,p.mgit_status,p.complaint_process_status,p.fraud_monitoring_status,p.last_reviewed_at,p.next_review_at,"+
        " ap.exclusive_stable_assignee_status,ap.single_service_status,ap.portability_offered_status,ap.tariff_ceiling_status,ap.no_temporary_contact_use_status,ap.public_body_eligibility_status,ap.caller_id_block_status,ap.parental_control_classification_status,ap.next_review_at AS arcep_2026_next_review_at,"+
        " pgi_sva_regulatory_ready(a.tenant_id,a.sva_number_id) AS regulatory_ready,pgi_arcep_2026_number_ready(a.tenant_id,a.sva_number_id) AS arcep_2026_ready,pgi_sva_ecosystem_ready(a.tenant_id,a.sva_number_id) AS sva_ecosystem_ready,"+
        " (pgi_sva_regulatory_ready(a.tenant_id,a.sva_number_id) AND pgi_arcep_2026_number_ready(a.tenant_id,a.sva_number_id) AND pgi_sva_ecosystem_ready(a.tenant_id,a.sva_number_id)) AS activation_ready,"+
        " (SELECT e.event_hash FROM sva_regulatory_evidence_events e WHERE e.tenant_id=a.tenant_id AND e.sva_number_id=a.sva_number_id ORDER BY e.id DESC LIMIT 1) AS evidence_chain_head,"+
        " (SELECT e.event_hash FROM sva_arcep_2026_evidence_events e WHERE e.tenant_id=a.tenant_id AND e.sva_number_id=a.sva_number_id ORDER BY e.id DESC LIMIT 1) AS arcep_2026_chain_head"+
        " FROM tenant_number_assignments a JOIN tenants t ON t.id=a.tenant_id JOIN sva_numbers sn ON sn.id=a.sva_number_id"+
        " LEFT JOIN operating_markets m ON m.id=sn.market_id LEFT JOIN sva_regulatory_profiles p ON p.tenant_id=a.tenant_id AND p.sva_number_id=a.sva_number_id"+
        " LEFT JOIN sva_arcep_2026_profiles ap ON ap.tenant_id=a.tenant_id AND ap.sva_number_id=a.sva_number_id"+
        " WHERE t.tenant_type<>'internal' ORDER BY a.created_at DESC LIMIT 100"
      ),
      this.readSql.unsafe(
        "SELECT c.id,m.country_code AS market,c.control_key,c.status,c.evidence_reference,c.evidence_sha256,c.verified_at,c.valid_until,c.updated_at"+
        " FROM platform_regulatory_controls c LEFT JOIN operating_markets m ON m.id=c.market_id"+
        " ORDER BY COALESCE(m.country_code,'ZZ'),c.control_key"
      ),
      this.readSql.unsafe(
        "SELECT r.id,r.framework,r.alert_kind,r.severity,r.state,r.title,r.message,r.due_at,r.first_detected_at,r.last_detected_at,"+
        " CASE WHEN r.severity='critical' THEN 'blocking' WHEN r.due_at IS NOT NULL AND r.due_at<=now()+interval '24 hours' THEN 'today' ELSE 'soon' END AS attention_bucket,"+
        " t.display_name AS tenant,sn.display_number,sn.e164,m.country_code AS market"+
        " FROM regulatory_review_alerts r LEFT JOIN tenants t ON t.id=r.tenant_id LEFT JOIN sva_numbers sn ON sn.id=r.sva_number_id"+
        " LEFT JOIN platform_regulatory_controls pc ON pc.id=r.platform_control_id LEFT JOIN operating_markets m ON m.id=COALESCE(sn.market_id,pc.market_id)"+
        " WHERE r.state<>'resolved' ORDER BY CASE r.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,r.due_at NULLS LAST,r.id DESC LIMIT 30"
      )
    ]);
    const singleCurrency=currencyTotals.length===1?currencyTotals[0]:null;
    const summary={
      ...summaryRows[0],
      settlement_currency_count:currencyTotals.length,
      settlement_currency:singleCurrency?.currency||null,
      upstream_payout_ht:singleCurrency?.upstream_payout||0,
      platform_fee_ht:singleCurrency?.platform_fee||0,
      net_payout_ht:singleCurrency?.net_payout||0,
      payment_compliance_active:payments.some(x=>x.status==="active")
    };
    return {
      foundation_version:"1.16",
      summary,
      tenants,
      numbers,
      settlements,
      payment_profiles:payments,
      markets,
      settlement_totals_by_currency:currencyTotals,
      scale:{
        ...(scaleRows[0]||{}),
        bucket_capacity:4096,
        read_replica_enabled:this.readSql!==this.sql,
        process_role:this.config.processRole||"all"
      },
      regulatory_trust:{
        summary:regulatorySummary[0]||{numbers_total:0,numbers_ready:0,arcep_2026_ready:0,evidence_events:0,sva_ecosystem_ready:0,sva_ecosystem_evidence_events:0,arcep_2026_evidence_events:0,abuse_open:0,abuse_critical:0,platform_controls_verified:0,platform_controls_attention:0,review_attention_total:0,review_blocking:0,review_today:0,review_soon:0},
        numbers:regulatoryNumbers,
        platform_controls:platformRegulatoryControls,
        review_alerts:regulatoryReviewAlerts
      }
    };
  }

  async serviceOperationsHealth(){
    const rows=await this.readSql.unsafe(
      "SELECT"+
      " count(*) FILTER(WHERE status NOT IN ('resolved','closed'))::int AS service_incidents_open,"+
      " count(*) FILTER(WHERE status NOT IN ('resolved','closed') AND severity='critical')::int AS service_incidents_critical,"+
      " count(*) FILTER(WHERE status NOT IN ('resolved','closed') AND first_responded_at IS NULL AND first_response_due_at<now())::int AS service_first_response_overdue,"+
      " count(*) FILTER(WHERE status NOT IN ('resolved','closed') AND target_resolution_at<now())::int AS service_resolution_overdue,"+
      " (SELECT count(*)::int FROM tenant_operational_alerts WHERE state<>'resolved' AND alert_type='routing_unavailable') AS routing_unavailable,"+
      " (SELECT count(*)::int FROM tenant_operational_alerts WHERE state<>'resolved' AND alert_type='portability_attention') AS portability_attention,"+
      " (SELECT count(*)::int FROM regulatory_review_alerts WHERE state<>'resolved') AS regulatory_attention,"+
      " (SELECT count(*)::int FROM regulatory_review_alerts WHERE state<>'resolved' AND severity='critical') AS regulatory_blocking"+
      " FROM tenant_service_incidents"
    );
    return rows[0]||{service_incidents_open:0,service_incidents_critical:0,service_first_response_overdue:0,service_resolution_overdue:0,routing_unavailable:0,portability_attention:0,regulatory_attention:0,regulatory_blocking:0};
  }

  async systemSnapshot(){
    const [counts,last,route,queue,resilienceRows,serviceHealth]=await Promise.all([
      this.sql.unsafe(
        "WITH b AS (SELECT COALESCE((SELECT effective_from FROM metric_baselines WHERE scope='global' AND tenant_id IS NULL AND metric_key IN ('all','calls') ORDER BY effective_from DESC,id DESC LIMIT 1),'-infinity'::timestamptz) AS from_ts)"+
        " SELECT count(*) FILTER(WHERE calls.started_at>=b.from_ts)::int AS calls_total,(SELECT count(*)::int FROM experts WHERE enabled AND status='available') AS experts_available,"+
        " (SELECT count(*)::int FROM outbox_events WHERE published_at IS NULL) AS outbox_pending FROM calls CROSS JOIN b"
      ),
      this.sql.unsafe("SELECT ended_at FROM calls ORDER BY ended_at DESC LIMIT 1"),
      this.carrierRouting(),
      this.workQueueHealth(),
      this.readSql.unsafe(
        "SELECT"+
        " (SELECT count(*)::int FROM platform_regions) AS regions_total,"+
        " (SELECT count(*)::int FROM platform_regions WHERE status IN ('ready','active')) AS regions_ready,"+
        " (SELECT count(*)::int FROM disaster_recovery_targets WHERE enabled) AS dr_targets_total"
      ),
      this.serviceOperationsHealth()
    ]);
    return {
      mode:this.config.mode,store:"postgres",
      calls_total:counts[0].calls_total,experts_available:counts[0].experts_available,
      cdr_lag_seconds:last[0]?Math.max(0,(Date.now()-Date.parse(last[0].ended_at))/1000):0,
      outbox_pending:counts[0].outbox_pending,event_subscribers:this.eventBus.size,carrier_route:route,
      work_queue:queue,
      resilience:resilienceRows[0]||{regions_total:0,regions_ready:0,dr_targets_total:0},
      service_operations:serviceHealth
    };
  }

  async metrics(){
    const [calls,outbox,serviceHealth]=await Promise.all([
      this.sql.unsafe("SELECT count(*)::int AS calls_total,count(*) FILTER(WHERE call_status='connected')::int AS calls_connected FROM calls"),
      this.sql.unsafe("SELECT count(*)::int AS outbox_pending FROM outbox_events WHERE published_at IS NULL"),
      this.serviceOperationsHealth()
    ]);
    return {...calls[0],...outbox[0],...serviceHealth,event_subscribers:this.eventBus.size};
  }
}

async function writeExperienceRollup(tx,callId){
  await tx.unsafe(
    "INSERT INTO experience_rollups_hourly_sharded("+
    " bucket_start,market_id,rollup_shard,calls_total,calls_connected,calls_abandoned,wait_seconds_sum,"+
    " wait_connected_seconds_sum,wait_abandoned_seconds_sum,answered_le_20s,abandoned_le_10s,ivr_seconds_sum,ivr_samples,"+
    " queue_seconds_sum,queue_samples,wait_le_10s,wait_10_20s,wait_20_30s,wait_30_60s,wait_60_120s,wait_gt_120s)"+
    " SELECT date_trunc('hour',c.started_at),c.market_id,(c.tenant_bucket%64)::smallint,1,"+
    " (c.call_status='connected')::int,(c.call_status='abandoned')::int,c.wait_seconds,"+
    " CASE WHEN c.call_status='connected' THEN c.wait_seconds ELSE 0 END,"+
    " CASE WHEN c.call_status='abandoned' THEN c.wait_seconds ELSE 0 END,"+
    " (c.call_status='connected' AND c.wait_seconds<=20)::int,(c.call_status='abandoned' AND c.wait_seconds<=10)::int,"+
    " CASE WHEN c.queued_at IS NOT NULL AND c.ivr_started_at IS NOT NULL THEN GREATEST(0,EXTRACT(EPOCH FROM (c.queued_at-c.ivr_started_at)))::bigint ELSE 0 END,"+
    " (c.queued_at IS NOT NULL AND c.ivr_started_at IS NOT NULL)::int,"+
    " CASE WHEN c.queued_at IS NOT NULL THEN GREATEST(0,EXTRACT(EPOCH FROM (COALESCE(c.bridged_at,c.ended_at)-c.queued_at)))::bigint ELSE 0 END,"+
    " (c.queued_at IS NOT NULL)::int,(c.wait_seconds<=10)::int,(c.wait_seconds>10 AND c.wait_seconds<=20)::int,"+
    " (c.wait_seconds>20 AND c.wait_seconds<=30)::int,(c.wait_seconds>30 AND c.wait_seconds<=60)::int,"+
    " (c.wait_seconds>60 AND c.wait_seconds<=120)::int,(c.wait_seconds>120)::int"+
    " FROM calls c WHERE c.id=$1 AND c.market_id IS NOT NULL"+
    " ON CONFLICT(bucket_start,market_id,rollup_shard) DO UPDATE SET"+
    " calls_total=experience_rollups_hourly_sharded.calls_total+1,"+
    " calls_connected=experience_rollups_hourly_sharded.calls_connected+EXCLUDED.calls_connected,"+
    " calls_abandoned=experience_rollups_hourly_sharded.calls_abandoned+EXCLUDED.calls_abandoned,"+
    " wait_seconds_sum=experience_rollups_hourly_sharded.wait_seconds_sum+EXCLUDED.wait_seconds_sum,"+
    " wait_connected_seconds_sum=experience_rollups_hourly_sharded.wait_connected_seconds_sum+EXCLUDED.wait_connected_seconds_sum,"+
    " wait_abandoned_seconds_sum=experience_rollups_hourly_sharded.wait_abandoned_seconds_sum+EXCLUDED.wait_abandoned_seconds_sum,"+
    " answered_le_20s=experience_rollups_hourly_sharded.answered_le_20s+EXCLUDED.answered_le_20s,"+
    " abandoned_le_10s=experience_rollups_hourly_sharded.abandoned_le_10s+EXCLUDED.abandoned_le_10s,"+
    " ivr_seconds_sum=experience_rollups_hourly_sharded.ivr_seconds_sum+EXCLUDED.ivr_seconds_sum,"+
    " ivr_samples=experience_rollups_hourly_sharded.ivr_samples+EXCLUDED.ivr_samples,"+
    " queue_seconds_sum=experience_rollups_hourly_sharded.queue_seconds_sum+EXCLUDED.queue_seconds_sum,"+
    " queue_samples=experience_rollups_hourly_sharded.queue_samples+EXCLUDED.queue_samples,"+
    " wait_le_10s=experience_rollups_hourly_sharded.wait_le_10s+EXCLUDED.wait_le_10s,"+
    " wait_10_20s=experience_rollups_hourly_sharded.wait_10_20s+EXCLUDED.wait_10_20s,"+
    " wait_20_30s=experience_rollups_hourly_sharded.wait_20_30s+EXCLUDED.wait_20_30s,"+
    " wait_30_60s=experience_rollups_hourly_sharded.wait_30_60s+EXCLUDED.wait_30_60s,"+
    " wait_60_120s=experience_rollups_hourly_sharded.wait_60_120s+EXCLUDED.wait_60_120s,"+
    " wait_gt_120s=experience_rollups_hourly_sharded.wait_gt_120s+EXCLUDED.wait_gt_120s,updated_at=now()",
    [callId]
  );
}

async function writeTenantDailyRollup(tx,callId){
  await tx.unsafe(
    "INSERT INTO metric_rollups_daily_v2("+
    " tenant_bucket,bucket_date,tenant_id,market_id,currency,calls_total,calls_connected,calls_abandoned,calls_failed,"+
    " conversation_seconds,billable_seconds,payout_eligible_seconds,generated_revenue_ttc,expected_payout_ht,confirmed_payout_ht,"+
    " paid_payout_ht,expert_cost_ht,technical_cost_ht,estimated_margin_ht,reconciliation_variance_ht,source_generation)"+
    " SELECT f.tenant_bucket,f.started_at::date,f.tenant_id,f.market_id,f.currency,1,"+
    " (f.call_status='connected')::int,(f.call_status='abandoned')::int,(f.call_status NOT IN ('connected','abandoned'))::int,"+
    " f.conversation_seconds,f.billable_seconds,f.payout_eligible_seconds,f.retail_service_amount_ttc,f.expected_payout_ht,"+
    " f.confirmed_payout_ht,f.paid_payout_ht,f.expert_cost_ht,f.technical_cost_ht,f.estimated_margin_ht,f.reconciliation_variance_ht,1"+
    " FROM call_facts f WHERE f.call_id=$1 AND f.tenant_id IS NOT NULL AND f.market_id IS NOT NULL"+
    " ON CONFLICT(tenant_bucket,bucket_date,tenant_id,market_id,currency) DO UPDATE SET"+
    " calls_total=metric_rollups_daily_v2.calls_total+1,"+
    " calls_connected=metric_rollups_daily_v2.calls_connected+EXCLUDED.calls_connected,"+
    " calls_abandoned=metric_rollups_daily_v2.calls_abandoned+EXCLUDED.calls_abandoned,"+
    " calls_failed=metric_rollups_daily_v2.calls_failed+EXCLUDED.calls_failed,"+
    " conversation_seconds=metric_rollups_daily_v2.conversation_seconds+EXCLUDED.conversation_seconds,"+
    " billable_seconds=metric_rollups_daily_v2.billable_seconds+EXCLUDED.billable_seconds,"+
    " payout_eligible_seconds=metric_rollups_daily_v2.payout_eligible_seconds+EXCLUDED.payout_eligible_seconds,"+
    " generated_revenue_ttc=metric_rollups_daily_v2.generated_revenue_ttc+EXCLUDED.generated_revenue_ttc,"+
    " expected_payout_ht=metric_rollups_daily_v2.expected_payout_ht+EXCLUDED.expected_payout_ht,"+
    " confirmed_payout_ht=metric_rollups_daily_v2.confirmed_payout_ht+EXCLUDED.confirmed_payout_ht,"+
    " paid_payout_ht=metric_rollups_daily_v2.paid_payout_ht+EXCLUDED.paid_payout_ht,"+
    " expert_cost_ht=metric_rollups_daily_v2.expert_cost_ht+EXCLUDED.expert_cost_ht,"+
    " technical_cost_ht=metric_rollups_daily_v2.technical_cost_ht+EXCLUDED.technical_cost_ht,"+
    " estimated_margin_ht=metric_rollups_daily_v2.estimated_margin_ht+EXCLUDED.estimated_margin_ht,"+
    " reconciliation_variance_ht=metric_rollups_daily_v2.reconciliation_variance_ht+EXCLUDED.reconciliation_variance_ht,"+
    " source_generation=metric_rollups_daily_v2.source_generation+1,updated_at=now()",
    [callId]
  );
}

async function writeVoiceCarrierHealthRollup(tx,callId){
  await tx.unsafe(
    "INSERT INTO voice_carrier_health_hourly_sharded("+
    " bucket_start,market_id,carrier_role,carrier_id,rollup_shard,calls_total,calls_connected,calls_failed,pdd_samples,pdd_ms_sum,high_pdd_calls,"+
    " quality_samples,network_affected_calls,low_mos_calls,mos_sum,packet_loss_sum,jitter_ms_sum,latency_ms_sum,rtt_ms_sum,"+
    " sip_4xx_calls,sip_5xx_calls,caller_hangups,callee_hangups,network_hangups)"+
    " SELECT date_trunc('hour',c.started_at),c.market_id,r.carrier_role,r.carrier_id,(c.tenant_bucket%64)::smallint,1,"+
    " (c.call_status='connected')::int,(c.call_status NOT IN ('connected','abandoned'))::int,"+
    " (c.post_dial_delay_ms IS NOT NULL)::int,COALESCE(c.post_dial_delay_ms,0),(COALESCE(c.post_dial_delay_ms,0)>8000)::int,"+
    " (q.call_id IS NOT NULL)::int,"+
    " (q.call_id IS NOT NULL AND (COALESCE(q.rtp_packet_loss_percent,0)>=5 OR COALESCE(q.jitter_ms,0)>5 OR COALESCE(q.latency_ms,0)>150))::int,"+
    " (q.call_id IS NOT NULL AND q.mos IS NOT NULL AND q.mos<3.5)::int,"+
    " COALESCE(q.mos,0),COALESCE(q.rtp_packet_loss_percent,0),COALESCE(q.jitter_ms,0),COALESCE(q.latency_ms,0),COALESCE(q.rtt_ms,0),"+
    " (c.sip_final_code BETWEEN 400 AND 499)::int,(c.sip_final_code BETWEEN 500 AND 599)::int,"+
    " (c.hangup_party='caller')::int,(c.hangup_party='callee')::int,(c.hangup_party='network')::int"+
    " FROM calls c LEFT JOIN call_quality q ON q.call_id=c.id"+
    " CROSS JOIN LATERAL (VALUES ('origin'::text,c.origin_carrier_id),('host'::text,c.host_carrier_id)) AS r(carrier_role,carrier_id)"+
    " WHERE c.id=$1 AND c.market_id IS NOT NULL AND r.carrier_id IS NOT NULL"+
    " ON CONFLICT(bucket_start,market_id,carrier_role,carrier_id,rollup_shard) DO UPDATE SET"+
    " calls_total=voice_carrier_health_hourly_sharded.calls_total+1,"+
    " calls_connected=voice_carrier_health_hourly_sharded.calls_connected+EXCLUDED.calls_connected,"+
    " calls_failed=voice_carrier_health_hourly_sharded.calls_failed+EXCLUDED.calls_failed,"+
    " pdd_samples=voice_carrier_health_hourly_sharded.pdd_samples+EXCLUDED.pdd_samples,"+
    " pdd_ms_sum=voice_carrier_health_hourly_sharded.pdd_ms_sum+EXCLUDED.pdd_ms_sum,"+
    " high_pdd_calls=voice_carrier_health_hourly_sharded.high_pdd_calls+EXCLUDED.high_pdd_calls,"+
    " quality_samples=voice_carrier_health_hourly_sharded.quality_samples+EXCLUDED.quality_samples,"+
    " network_affected_calls=voice_carrier_health_hourly_sharded.network_affected_calls+EXCLUDED.network_affected_calls,"+
    " low_mos_calls=voice_carrier_health_hourly_sharded.low_mos_calls+EXCLUDED.low_mos_calls,"+
    " mos_sum=voice_carrier_health_hourly_sharded.mos_sum+EXCLUDED.mos_sum,"+
    " packet_loss_sum=voice_carrier_health_hourly_sharded.packet_loss_sum+EXCLUDED.packet_loss_sum,"+
    " jitter_ms_sum=voice_carrier_health_hourly_sharded.jitter_ms_sum+EXCLUDED.jitter_ms_sum,"+
    " latency_ms_sum=voice_carrier_health_hourly_sharded.latency_ms_sum+EXCLUDED.latency_ms_sum,"+
    " rtt_ms_sum=voice_carrier_health_hourly_sharded.rtt_ms_sum+EXCLUDED.rtt_ms_sum,"+
    " sip_4xx_calls=voice_carrier_health_hourly_sharded.sip_4xx_calls+EXCLUDED.sip_4xx_calls,"+
    " sip_5xx_calls=voice_carrier_health_hourly_sharded.sip_5xx_calls+EXCLUDED.sip_5xx_calls,"+
    " caller_hangups=voice_carrier_health_hourly_sharded.caller_hangups+EXCLUDED.caller_hangups,"+
    " callee_hangups=voice_carrier_health_hourly_sharded.callee_hangups+EXCLUDED.callee_hangups,"+
    " network_hangups=voice_carrier_health_hourly_sharded.network_hangups+EXCLUDED.network_hangups,updated_at=now()",
    [callId]
  );
}

async function writeTenantVoiceDailyRollup(tx,callId){
  await tx.unsafe(
    "INSERT INTO tenant_voice_daily_sharded("+
    " tenant_bucket,bucket_date,tenant_id,market_id,calls_total,calls_connected,pdd_samples,pdd_ms_sum,high_pdd_calls,"+
    " quality_samples,network_affected_calls,low_mos_calls,mos_sum,packet_loss_sum,jitter_ms_sum,latency_ms_sum,rtt_ms_sum,"+
    " sip_5xx_calls,caller_hangups,callee_hangups,network_hangups)"+
    " SELECT c.tenant_bucket,c.started_at::date,c.tenant_id,c.market_id,1,(c.call_status='connected')::int,"+
    " (c.post_dial_delay_ms IS NOT NULL)::int,COALESCE(c.post_dial_delay_ms,0),(COALESCE(c.post_dial_delay_ms,0)>8000)::int,"+
    " (q.call_id IS NOT NULL)::int,"+
    " (q.call_id IS NOT NULL AND (COALESCE(q.rtp_packet_loss_percent,0)>=5 OR COALESCE(q.jitter_ms,0)>5 OR COALESCE(q.latency_ms,0)>150))::int,"+
    " (q.call_id IS NOT NULL AND q.mos IS NOT NULL AND q.mos<3.5)::int,COALESCE(q.mos,0),COALESCE(q.rtp_packet_loss_percent,0),"+
    " COALESCE(q.jitter_ms,0),COALESCE(q.latency_ms,0),COALESCE(q.rtt_ms,0),(c.sip_final_code BETWEEN 500 AND 599)::int,"+
    " (c.hangup_party='caller')::int,(c.hangup_party='callee')::int,(c.hangup_party='network')::int"+
    " FROM calls c LEFT JOIN call_quality q ON q.call_id=c.id WHERE c.id=$1 AND c.tenant_id IS NOT NULL AND c.market_id IS NOT NULL"+
    " ON CONFLICT(tenant_bucket,bucket_date,tenant_id,market_id) DO UPDATE SET"+
    " calls_total=tenant_voice_daily_sharded.calls_total+1,"+
    " calls_connected=tenant_voice_daily_sharded.calls_connected+EXCLUDED.calls_connected,"+
    " pdd_samples=tenant_voice_daily_sharded.pdd_samples+EXCLUDED.pdd_samples,pdd_ms_sum=tenant_voice_daily_sharded.pdd_ms_sum+EXCLUDED.pdd_ms_sum,"+
    " high_pdd_calls=tenant_voice_daily_sharded.high_pdd_calls+EXCLUDED.high_pdd_calls,"+
    " quality_samples=tenant_voice_daily_sharded.quality_samples+EXCLUDED.quality_samples,"+
    " network_affected_calls=tenant_voice_daily_sharded.network_affected_calls+EXCLUDED.network_affected_calls,"+
    " low_mos_calls=tenant_voice_daily_sharded.low_mos_calls+EXCLUDED.low_mos_calls,"+
    " mos_sum=tenant_voice_daily_sharded.mos_sum+EXCLUDED.mos_sum,packet_loss_sum=tenant_voice_daily_sharded.packet_loss_sum+EXCLUDED.packet_loss_sum,"+
    " jitter_ms_sum=tenant_voice_daily_sharded.jitter_ms_sum+EXCLUDED.jitter_ms_sum,latency_ms_sum=tenant_voice_daily_sharded.latency_ms_sum+EXCLUDED.latency_ms_sum,"+
    " rtt_ms_sum=tenant_voice_daily_sharded.rtt_ms_sum+EXCLUDED.rtt_ms_sum,sip_5xx_calls=tenant_voice_daily_sharded.sip_5xx_calls+EXCLUDED.sip_5xx_calls,"+
    " caller_hangups=tenant_voice_daily_sharded.caller_hangups+EXCLUDED.caller_hangups,callee_hangups=tenant_voice_daily_sharded.callee_hangups+EXCLUDED.callee_hangups,"+
    " network_hangups=tenant_voice_daily_sharded.network_hangups+EXCLUDED.network_hangups,updated_at=now()",
    [callId]
  );
}

async function writeSipCodeRollup(tx,callId){
  await tx.unsafe(
    "INSERT INTO voice_sip_code_hourly_sharded(bucket_start,market_id,host_carrier_id,sip_final_code,rollup_shard,calls_total)"+
    " SELECT date_trunc('hour',started_at),market_id,host_carrier_id,sip_final_code,(tenant_bucket%64)::smallint,1"+
    " FROM calls WHERE id=$1 AND market_id IS NOT NULL AND host_carrier_id IS NOT NULL AND sip_final_code BETWEEN 100 AND 699"+
    " ON CONFLICT(bucket_start,market_id,host_carrier_id,sip_final_code,rollup_shard) DO UPDATE SET"+
    " calls_total=voice_sip_code_hourly_sharded.calls_total+1,updated_at=now()",
    [callId]
  );
}

async function writeQualityRollup(tx,callId){
  await tx.unsafe(
    "INSERT INTO quality_rollups_hourly_sharded("+
    " bucket_start,market_id,rollup_shard,quality_samples,mos_sum,packet_loss_sum,jitter_ms_sum,latency_ms_sum,dtmf_errors,affected_samples,low_mos_samples)"+
    " SELECT date_trunc('hour',c.started_at),c.market_id,(c.tenant_bucket%64)::smallint,1,"+
    " COALESCE(q.mos,0),COALESCE(q.rtp_packet_loss_percent,0),COALESCE(q.jitter_ms,0),COALESCE(q.latency_ms,0),COALESCE(q.dtmf_errors,0),"+
    " (COALESCE(q.rtp_packet_loss_percent,0)>=5 OR COALESCE(q.jitter_ms,0)>5 OR COALESCE(q.latency_ms,0)>150)::int,"+
    " (q.mos IS NOT NULL AND q.mos<3.5)::int"+
    " FROM calls c JOIN call_quality q ON q.call_id=c.id"+
    " WHERE c.id=$1 AND c.market_id IS NOT NULL"+
    " ON CONFLICT(bucket_start,market_id,rollup_shard) DO UPDATE SET"+
    " quality_samples=quality_rollups_hourly_sharded.quality_samples+1,"+
    " mos_sum=quality_rollups_hourly_sharded.mos_sum+EXCLUDED.mos_sum,"+
    " packet_loss_sum=quality_rollups_hourly_sharded.packet_loss_sum+EXCLUDED.packet_loss_sum,"+
    " jitter_ms_sum=quality_rollups_hourly_sharded.jitter_ms_sum+EXCLUDED.jitter_ms_sum,"+
    " latency_ms_sum=quality_rollups_hourly_sharded.latency_ms_sum+EXCLUDED.latency_ms_sum,"+
    " dtmf_errors=quality_rollups_hourly_sharded.dtmf_errors+EXCLUDED.dtmf_errors,"+
    " affected_samples=quality_rollups_hourly_sharded.affected_samples+EXCLUDED.affected_samples,"+
    " low_mos_samples=quality_rollups_hourly_sharded.low_mos_samples+EXCLUDED.low_mos_samples,updated_at=now()",
    [callId]
  );
}

async function writeDashboardDimensionRollups(tx,callId){
  const common=
    " INSERT INTO dashboard_dimension_rollups_daily("+
    " bucket_date,market_id,currency,dimension_type,dimension_key,dimension_label,calls_total,calls_connected,"+
    " conversation_seconds,billable_seconds,generated_revenue_ttc,expected_payout_ht,estimated_margin_ht) ";
  const conflict=
    " ON CONFLICT(bucket_date,market_id,currency,dimension_type,dimension_key) DO UPDATE SET"+
    " dimension_label=EXCLUDED.dimension_label,"+
    " calls_total=dashboard_dimension_rollups_daily.calls_total+EXCLUDED.calls_total,"+
    " calls_connected=dashboard_dimension_rollups_daily.calls_connected+EXCLUDED.calls_connected,"+
    " conversation_seconds=dashboard_dimension_rollups_daily.conversation_seconds+EXCLUDED.conversation_seconds,"+
    " billable_seconds=dashboard_dimension_rollups_daily.billable_seconds+EXCLUDED.billable_seconds,"+
    " generated_revenue_ttc=dashboard_dimension_rollups_daily.generated_revenue_ttc+EXCLUDED.generated_revenue_ttc,"+
    " expected_payout_ht=dashboard_dimension_rollups_daily.expected_payout_ht+EXCLUDED.expected_payout_ht,"+
    " estimated_margin_ht=dashboard_dimension_rollups_daily.estimated_margin_ht+EXCLUDED.estimated_margin_ht,updated_at=now()";

  await tx.unsafe(
    common+
    " SELECT f.started_at::date,f.market_id,f.currency,'expert',COALESCE(f.expert_id::text,'unassigned'),"+
    " COALESCE(e.display_name,'Non affecté'),1,(f.call_status='connected')::int,f.conversation_seconds,f.billable_seconds,"+
    " f.retail_service_amount_ttc,f.expected_payout_ht,f.estimated_margin_ht"+
    " FROM call_facts f LEFT JOIN experts e ON e.id=f.expert_id WHERE f.call_id=$1 AND f.market_id IS NOT NULL"+
    conflict,[callId]
  );
  await tx.unsafe(
    common+
    " SELECT f.started_at::date,f.market_id,f.currency,'carrier',COALESCE(f.origin_carrier_id::text,'unknown'),"+
    " COALESCE(c.name,'Inconnu'),1,(f.call_status='connected')::int,f.conversation_seconds,f.billable_seconds,"+
    " f.retail_service_amount_ttc,f.expected_payout_ht,f.estimated_margin_ht"+
    " FROM call_facts f LEFT JOIN carriers c ON c.id=f.origin_carrier_id WHERE f.call_id=$1 AND f.market_id IS NOT NULL"+
    conflict,[callId]
  );
  await tx.unsafe(
    common+
    " SELECT f.started_at::date,f.market_id,f.currency,'duration',"+
    " CASE WHEN f.call_status<>'connected' THEN 'not_connected' WHEN f.conversation_seconds<60 THEN 'lt_1m'"+
    " WHEN f.conversation_seconds<300 THEN '1_5m' WHEN f.conversation_seconds<600 THEN '5_10m'"+
    " WHEN f.conversation_seconds<1200 THEN '10_20m' WHEN f.conversation_seconds<1800 THEN '20_30m' ELSE 'gte_30m' END,"+
    " CASE WHEN f.call_status<>'connected' THEN 'Non aboutis' WHEN f.conversation_seconds<60 THEN '< 1 min'"+
    " WHEN f.conversation_seconds<300 THEN '1–5 min' WHEN f.conversation_seconds<600 THEN '5–10 min'"+
    " WHEN f.conversation_seconds<1200 THEN '10–20 min' WHEN f.conversation_seconds<1800 THEN '20–30 min' ELSE '30 min +' END,"+
    " 1,(f.call_status='connected')::int,f.conversation_seconds,f.billable_seconds,"+
    " f.retail_service_amount_ttc,f.expected_payout_ht,f.estimated_margin_ht"+
    " FROM call_facts f WHERE f.call_id=$1 AND f.market_id IS NOT NULL"+
    conflict,[callId]
  );
}

async function writeHourlyRollup(tx,callId){
  await tx.unsafe(
    "INSERT INTO platform_rollups_hourly_sharded("+
    " bucket_start,market_id,currency,rollup_shard,calls_total,calls_connected,calls_abandoned,calls_failed,"+
    " conversation_seconds,billable_seconds,payout_eligible_seconds,generated_revenue_ttc,expected_payout_ht,"+
    " confirmed_payout_ht,paid_payout_ht,expert_cost_ht,technical_cost_ht,estimated_margin_ht,reconciliation_variance_ht)"+
    " SELECT date_trunc('hour',f.started_at),f.market_id,f.currency,(f.tenant_bucket%64)::smallint,1,"+
    " (f.call_status='connected')::int,(f.call_status='abandoned')::int,"+
    " (f.call_status NOT IN ('connected','abandoned'))::int,f.conversation_seconds,f.billable_seconds,"+
    " f.payout_eligible_seconds,f.retail_service_amount_ttc,f.expected_payout_ht,f.confirmed_payout_ht,f.paid_payout_ht,"+
    " f.expert_cost_ht,f.technical_cost_ht,f.estimated_margin_ht,f.reconciliation_variance_ht"+
    " FROM call_facts f WHERE f.call_id=$1 AND f.market_id IS NOT NULL"+
    " ON CONFLICT(bucket_start,market_id,currency,rollup_shard) DO UPDATE SET"+
    " calls_total=platform_rollups_hourly_sharded.calls_total+EXCLUDED.calls_total,"+
    " calls_connected=platform_rollups_hourly_sharded.calls_connected+EXCLUDED.calls_connected,"+
    " calls_abandoned=platform_rollups_hourly_sharded.calls_abandoned+EXCLUDED.calls_abandoned,"+
    " calls_failed=platform_rollups_hourly_sharded.calls_failed+EXCLUDED.calls_failed,"+
    " conversation_seconds=platform_rollups_hourly_sharded.conversation_seconds+EXCLUDED.conversation_seconds,"+
    " billable_seconds=platform_rollups_hourly_sharded.billable_seconds+EXCLUDED.billable_seconds,"+
    " payout_eligible_seconds=platform_rollups_hourly_sharded.payout_eligible_seconds+EXCLUDED.payout_eligible_seconds,"+
    " generated_revenue_ttc=platform_rollups_hourly_sharded.generated_revenue_ttc+EXCLUDED.generated_revenue_ttc,"+
    " expected_payout_ht=platform_rollups_hourly_sharded.expected_payout_ht+EXCLUDED.expected_payout_ht,"+
    " confirmed_payout_ht=platform_rollups_hourly_sharded.confirmed_payout_ht+EXCLUDED.confirmed_payout_ht,"+
    " paid_payout_ht=platform_rollups_hourly_sharded.paid_payout_ht+EXCLUDED.paid_payout_ht,"+
    " expert_cost_ht=platform_rollups_hourly_sharded.expert_cost_ht+EXCLUDED.expert_cost_ht,"+
    " technical_cost_ht=platform_rollups_hourly_sharded.technical_cost_ht+EXCLUDED.technical_cost_ht,"+
    " estimated_margin_ht=platform_rollups_hourly_sharded.estimated_margin_ht+EXCLUDED.estimated_margin_ht,"+
    " reconciliation_variance_ht=platform_rollups_hourly_sharded.reconciliation_variance_ht+EXCLUDED.reconciliation_variance_ht,"+
    " updated_at=now()",
    [callId]
  );
}

async function refreshHourlyRollupsForCalls(tx,matchJson){
  await tx.unsafe(
    "WITH input AS ("+
    " SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(call_id bigint,tenant_bucket smallint,amount numeric)"+
    "), affected AS ("+
    " SELECT DISTINCT date_trunc('hour',f.started_at) AS bucket_start,f.market_id,f.currency,"+
    " (f.tenant_bucket%64)::smallint AS rollup_shard"+
    " FROM call_facts f JOIN input i ON i.call_id=f.call_id AND i.tenant_bucket=f.tenant_bucket"+
    " WHERE f.market_id IS NOT NULL"+
    "), aggregated AS ("+
    " SELECT a.bucket_start,a.market_id,a.currency,a.rollup_shard,"+
    " count(*)::bigint AS calls_total,"+
    " count(*) FILTER(WHERE f.call_status='connected')::bigint AS calls_connected,"+
    " count(*) FILTER(WHERE f.call_status='abandoned')::bigint AS calls_abandoned,"+
    " count(*) FILTER(WHERE f.call_status NOT IN ('connected','abandoned'))::bigint AS calls_failed,"+
    " COALESCE(sum(f.conversation_seconds),0)::bigint AS conversation_seconds,"+
    " COALESCE(sum(f.billable_seconds),0)::bigint AS billable_seconds,"+
    " COALESCE(sum(f.payout_eligible_seconds),0)::bigint AS payout_eligible_seconds,"+
    " COALESCE(sum(f.retail_service_amount_ttc),0) AS generated_revenue_ttc,"+
    " COALESCE(sum(f.expected_payout_ht),0) AS expected_payout_ht,"+
    " COALESCE(sum(f.confirmed_payout_ht),0) AS confirmed_payout_ht,"+
    " COALESCE(sum(f.paid_payout_ht),0) AS paid_payout_ht,"+
    " COALESCE(sum(f.expert_cost_ht),0) AS expert_cost_ht,"+
    " COALESCE(sum(f.technical_cost_ht),0) AS technical_cost_ht,"+
    " COALESCE(sum(f.estimated_margin_ht),0) AS estimated_margin_ht,"+
    " COALESCE(sum(f.reconciliation_variance_ht),0) AS reconciliation_variance_ht"+
    " FROM affected a JOIN call_facts f ON f.market_id=a.market_id AND f.currency=a.currency"+
    " AND (f.tenant_bucket%64)::smallint=a.rollup_shard"+
    " AND f.started_at>=a.bucket_start AND f.started_at<a.bucket_start+interval '1 hour'"+
    " GROUP BY a.bucket_start,a.market_id,a.currency,a.rollup_shard"+
    ") INSERT INTO platform_rollups_hourly_sharded("+
    " bucket_start,market_id,currency,rollup_shard,calls_total,calls_connected,calls_abandoned,calls_failed,"+
    " conversation_seconds,billable_seconds,payout_eligible_seconds,generated_revenue_ttc,expected_payout_ht,"+
    " confirmed_payout_ht,paid_payout_ht,expert_cost_ht,technical_cost_ht,estimated_margin_ht,reconciliation_variance_ht,updated_at)"+
    " SELECT bucket_start,market_id,currency,rollup_shard,calls_total,calls_connected,calls_abandoned,calls_failed,"+
    " conversation_seconds,billable_seconds,payout_eligible_seconds,generated_revenue_ttc,expected_payout_ht,"+
    " confirmed_payout_ht,paid_payout_ht,expert_cost_ht,technical_cost_ht,estimated_margin_ht,reconciliation_variance_ht,now()"+
    " FROM aggregated"+
    " ON CONFLICT(bucket_start,market_id,currency,rollup_shard) DO UPDATE SET"+
    " calls_total=EXCLUDED.calls_total,calls_connected=EXCLUDED.calls_connected,"+
    " calls_abandoned=EXCLUDED.calls_abandoned,calls_failed=EXCLUDED.calls_failed,"+
    " conversation_seconds=EXCLUDED.conversation_seconds,billable_seconds=EXCLUDED.billable_seconds,"+
    " payout_eligible_seconds=EXCLUDED.payout_eligible_seconds,generated_revenue_ttc=EXCLUDED.generated_revenue_ttc,"+
    " expected_payout_ht=EXCLUDED.expected_payout_ht,confirmed_payout_ht=EXCLUDED.confirmed_payout_ht,"+
    " paid_payout_ht=EXCLUDED.paid_payout_ht,expert_cost_ht=EXCLUDED.expert_cost_ht,"+
    " technical_cost_ht=EXCLUDED.technical_cost_ht,estimated_margin_ht=EXCLUDED.estimated_margin_ht,"+
    " reconciliation_variance_ht=EXCLUDED.reconciliation_variance_ht,updated_at=now()",
    [matchJson]
  );
}

async function ledger(tx,callId,tenantId,marketId,currency,type,amount,envelope){
  await tx.unsafe(
    "INSERT INTO financial_ledger(tenant_id,market_id,call_id,event_type,amount_ht,currency,source_reference,metadata)"+
    " VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
    [tenantId||null,marketId||null,callId,type,amount,String(currency||"EUR"),envelope.source_event_id,JSON.stringify({source:envelope.source})]
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
async function rebuildTenantRevenueDistributions(tx,settlementId,actorId){
  const rows=await tx.unsafe(
    "SELECT scm.call_id,scm.carrier_amount_ht::float8 AS upstream_amount_ht,c.tenant_id,c.market_id,c.currency,c.sva_number_id,"+
    " c.billable_seconds,c.started_at,t.tenant_type,k.status AS kyc_status,k.bank_account_verified,"+
    " cs.status AS upstream_status,cs.period_start,cs.period_end,cs.paid_at AS upstream_paid_at,cs.statement_reference,"+
    " pt.id AS payout_terms_id,pt.platform_fee_bps,pt.platform_fee_ht_per_min::float8,pt.payout_delay_days,"+
    " pc.id AS payment_compliance_profile_id"+
    " FROM settlement_call_matches scm JOIN calls c ON c.id=scm.call_id"+
    " JOIN carrier_settlements cs ON cs.id=scm.settlement_id JOIN tenants t ON t.id=c.tenant_id"+
    " LEFT JOIN tenant_kyc_profiles k ON k.tenant_id=c.tenant_id"+
    " LEFT JOIN LATERAL ("+
    "  SELECT x.id,x.platform_fee_bps,x.platform_fee_ht_per_min,x.payout_delay_days FROM tenant_payout_terms x"+
    "  WHERE x.tenant_id=c.tenant_id AND x.status='active' AND x.effective_from<=c.started_at"+
    "   AND (x.effective_to IS NULL OR x.effective_to>c.started_at)"+
    "   AND (x.market_id IS NULL OR x.market_id=c.market_id)"+
    "   AND (x.sva_number_id IS NULL OR x.sva_number_id=c.sva_number_id)"+
    "  ORDER BY (x.sva_number_id IS NOT NULL) DESC,(x.market_id IS NOT NULL) DESC,x.effective_from DESC,x.id DESC LIMIT 1"+
    " ) pt ON true"+
    " LEFT JOIN LATERAL ("+
    "  SELECT p.id FROM payment_compliance_profiles p"+
    "  JOIN payment_compliance_market_profiles pm ON pm.payment_compliance_profile_id=p.id"+
    "  WHERE p.status='active' AND p.funds_flow_mode IN ('platform_managed','psp_managed')"+
    "   AND pm.market_id=c.market_id AND pm.status='active'"+
    "   AND (p.valid_from IS NULL OR p.valid_from<=CURRENT_DATE) AND (p.valid_to IS NULL OR p.valid_to>=CURRENT_DATE)"+
    "  ORDER BY CASE p.funds_flow_mode WHEN 'platform_managed' THEN 0 ELSE 1 END,p.id LIMIT 1"+
    " ) pc ON true"+
    " WHERE scm.settlement_id=$1 AND t.tenant_type<>'internal' ORDER BY c.tenant_id,c.market_id,c.currency,scm.call_id",
    [settlementId]
  );
  const groups=new Map();
  for(const row of rows){
    const key=String(row.tenant_id)+":"+String(row.market_id||0)+":"+String(row.currency||"EUR");
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }
  const results=[];
  for(const groupRows of groups.values()){
    const first=groupRows[0],calculated=groupRows.map(row=>{
      const terms=row.payout_terms_id==null?null:{
        id:Number(row.payout_terms_id),
        platform_fee_bps:Number(row.platform_fee_bps||0),
        platform_fee_ht_per_min:Number(row.platform_fee_ht_per_min||0)
      };
      return {
        call_id:Number(row.call_id),
        payout_delay_days:Number(row.payout_delay_days||0),
        ...computeTenantCallDistribution(row.upstream_amount_ht,row.billable_seconds,terms)
      };
    });
    const totals=summarizeTenantDistribution(calculated);
    const complianceId=first.payment_compliance_profile_id==null?null:Number(first.payment_compliance_profile_id);
    const upstreamPaid=String(first.upstream_status)==="paid";
    const kycOk=String(first.kyc_status)==="verified"&&Boolean(first.bank_account_verified);
    let status="reconciled",held=totals.net_payout_ht;
    if(totals.unallocated_amount_ht>0){status="blocked_terms";held=0;}
    else if(upstreamPaid&&complianceId&&kycOk){status="payable";held=0;}
    else if(upstreamPaid){status="blocked_compliance";held=totals.net_payout_ht;}
    let due=null;
    if(upstreamPaid&&first.upstream_paid_at){
      const d=new Date(first.upstream_paid_at);
      if(Number.isFinite(d.getTime())){d.setUTCDate(d.getUTCDate()+totals.max_payout_delay_days);due=d.toISOString().slice(0,10);}
    }
    let dist=(await tx.unsafe(
      "INSERT INTO tenant_revenue_distributions(tenant_id,upstream_settlement_id,market_id,currency,period_start,period_end,collection_model,"+
      " upstream_payout_ht,platform_fee_ht,net_payout_ht,unallocated_amount_ht,held_amount_ht,payment_compliance_profile_id,status,payment_due_date,statement_reference)"+
      " VALUES($1,$2,$3,$4,$5,$6,'pgi_collects',$7,$8,$9,$10,$11,$12,$13,$14,$15)"+
      " ON CONFLICT (upstream_settlement_id,tenant_id,(COALESCE(market_id,0)),currency) DO UPDATE SET"+
      " upstream_payout_ht=EXCLUDED.upstream_payout_ht,platform_fee_ht=EXCLUDED.platform_fee_ht,net_payout_ht=EXCLUDED.net_payout_ht,"+
      " unallocated_amount_ht=EXCLUDED.unallocated_amount_ht,held_amount_ht=EXCLUDED.held_amount_ht,"+
      " payment_compliance_profile_id=EXCLUDED.payment_compliance_profile_id,status=EXCLUDED.status,payment_due_date=EXCLUDED.payment_due_date,"+
      " statement_reference=EXCLUDED.statement_reference,updated_at=now()"+
      " WHERE tenant_revenue_distributions.status<>'paid' RETURNING *",
      [first.tenant_id,settlementId,first.market_id,first.currency,first.period_start,first.period_end,
       totals.upstream_payout_ht,totals.platform_fee_ht,totals.net_payout_ht,totals.unallocated_amount_ht,held,complianceId,status,due,first.statement_reference]
    ))[0];
    if(!dist){
      dist=(await tx.unsafe(
        "SELECT * FROM tenant_revenue_distributions WHERE upstream_settlement_id=$1 AND tenant_id=$2 AND COALESCE(market_id,0)=COALESCE($3::bigint,0) AND currency=$4 LIMIT 1",
        [settlementId,first.tenant_id,first.market_id,first.currency]
      ))[0];
    }
    if(String(dist.status)!=="paid"){
      for(const item of calculated){
        await tx.unsafe(
          "INSERT INTO tenant_revenue_distribution_calls(tenant_distribution_id,call_id,payout_terms_id,upstream_amount_ht,platform_fee_ht,net_payout_ht,unallocated_amount_ht)"+
          " VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_distribution_id,call_id) DO UPDATE SET"+
          " payout_terms_id=EXCLUDED.payout_terms_id,upstream_amount_ht=EXCLUDED.upstream_amount_ht,platform_fee_ht=EXCLUDED.platform_fee_ht,"+
          " net_payout_ht=EXCLUDED.net_payout_ht,unallocated_amount_ht=EXCLUDED.unallocated_amount_ht",
          [dist.id,item.call_id,item.payout_terms_id,item.upstream_amount_ht,item.platform_fee_ht,item.net_payout_ht,item.unallocated_amount_ht]
        );
      }
      await tx.unsafe(
        "INSERT INTO audit_log(tenant_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'tenant.revenue_distribution','tenant_revenue_distribution',$3,$4::jsonb)",
        [first.tenant_id,actorId,String(dist.id),JSON.stringify({upstream_settlement_id:settlementId,status,upstream_payout_ht:totals.upstream_payout_ht,platform_fee_ht:totals.platform_fee_ht,net_payout_ht:totals.net_payout_ht,collection_model:"pgi_collects"})]
      );
      await tx.unsafe(
        "INSERT INTO outbox_events(tenant_id,market_id,event_type,aggregate_type,aggregate_id,payload) VALUES($1,$2,'tenant.revenue_distribution.updated','tenant_revenue_distribution',$3,$4::jsonb)",
        [first.tenant_id,first.market_id,String(dist.id),JSON.stringify({status,upstream_settlement_id:settlementId,platform_fee_ht:totals.platform_fee_ht,net_payout_ht:totals.net_payout_ht})]
      );
    }
    results.push(dist);
  }
  return results;
}
function roundFinanceNumber(value){
  return Math.round((Number(value)+Number.EPSILON)*1e6)/1e6;
}
function numberFields(row,keys){
  const out={...row};
  for(const key of keys)if(out[key]!=null)out[key]=Number(out[key]);
  return out;
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
function encodeNumericCursor(value){
  return Buffer.from(String(value)).toString("base64url");
}
function decodeNumericCursor(value){
  if(!value)return null;
  try{
    const n=Number(Buffer.from(String(value),"base64url").toString("utf8"));
    return Number.isInteger(n)&&n>0?n:null;
  }catch{return null;}
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
function normalizePortabilityNumber(value,countryCode){
  let raw=String(value||"").trim().replace(/[\s().-]/g,"");
  if(String(countryCode||"").toUpperCase()==="FR"&&/^0\d{9}$/.test(raw))raw="+33"+raw.slice(1);
  if(/^00\d{8,15}$/.test(raw))raw="+"+raw.slice(2);
  if(!/^\+[1-9]\d{7,14}$/.test(raw))throw problem(400,"INVALID_PORTABILITY_NUMBER");
  return raw;
}
function optionalText(value,max){
  const valueText=String(value==null?"":value).trim();
  return valueText?valueText.slice(0,max):null;
}
function staffLoginName(value){
  const name=String(value||"").trim();
  if(name.length<3||name.length>120||!/^[A-Za-z0-9._@+-]+$/.test(name))throw problem(400,"INVALID_STAFF_LOGIN");
  return name;
}
function staffRole(value){
  const role=String(value||"readonly").trim().toLowerCase();
  if(!["admin","finance","readonly"].includes(role))throw problem(400,"INVALID_STAFF_ROLE");
  return role;
}
function dateOnlyValue(value,field){
  const valueText=String(value||"").trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(valueText)||!Number.isFinite(Date.parse(valueText+"T00:00:00Z")))throw problem(400,"INVALID_"+String(field||"DATE").toUpperCase());
  return valueText;
}

async function serviceIncidentOutbox(tx,tenantId,eventType,incidentId,publicId,payload={}){
  const safe={
    incident_public_id:String(publicId||""),
    ...payload
  };
  await tx.unsafe(
    "INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload) VALUES($1,$2,'tenant_service_incident',$3,$4::jsonb)",
    [Number(tenantId),String(eventType),String(incidentId),JSON.stringify(safe)]
  );
}
function serviceIncidentSla(severity){
  const map={
    critical:{response:15,resolution:120},
    high:{response:30,resolution:240},
    normal:{response:120,resolution:1440},
    low:{response:240,resolution:2880}
  };
  return map[String(severity||"normal")]||map.normal;
}
async function tenantDiagnosticSnapshot(tx,tenantId,svaNumberId=null){
  const [activity,destinations,portability]=await Promise.all([
    tx.unsafe(
      "SELECT count(*) FILTER(WHERE started_at>=now()-interval '1 hour')::int AS calls_1h,"+
      " count(*) FILTER(WHERE started_at>=now()-interval '1 hour' AND call_status='connected')::int AS connected_1h,"+
      " max(started_at) AS last_call_at FROM calls WHERE tenant_id=$1 AND ($2::bigint IS NULL OR sva_number_id=$2)",
      [tenantId,svaNumberId]
    ),
    tx.unsafe(
      "SELECT count(*)::int AS total,count(*) FILTER(WHERE status='active')::int AS active,"+
      " count(*) FILTER(WHERE status='active' AND (max_concurrent_calls IS NULL OR active_calls<max_concurrent_calls))::int AS available"+
      " FROM tenant_call_destinations WHERE tenant_id=$1 AND ($2::bigint IS NULL OR sva_number_id=$2 OR sva_number_id IS NULL)",
      [tenantId,svaNumberId]
    ),
    tx.unsafe(
      "SELECT status,automation_state,operator_status,updated_at FROM tenant_portability_requests"+
      " WHERE tenant_id=$1 AND status NOT IN ('ported','cancelled','rejected') ORDER BY updated_at DESC LIMIT 1",
      [tenantId]
    )
  ]);
  return {
    captured_at:new Date().toISOString(),
    activity:activity[0]||{calls_1h:0,connected_1h:0,last_call_at:null},
    destinations:destinations[0]||{total:0,active:0,available:0},
    portability:portability[0]||null
  };
}
function problem(status,code,message=code){
  const e=new Error(message);e.status=status;e.code=code;return e;
}

async function appendChangeApprovalEvent(tx,changeRequestId,eventType,actorId,details={}){
  const prevRows=await tx.unsafe("SELECT event_sha256 FROM platform_change_approval_events WHERE change_request_id=$1 ORDER BY id DESC LIMIT 1",[Number(changeRequestId)]);
  const previous=prevRows[0]?.event_sha256||null;
  const createdAt=new Date().toISOString();
  const safeDetails=details&&typeof details==="object"&&!Array.isArray(details)?details:{};
  const material=JSON.stringify({change_request_id:Number(changeRequestId),event_type:String(eventType),actor_id:actorId==null?null:Number(actorId),details:safeDetails,previous_sha256:previous,created_at:createdAt});
  const hash=createHash("sha256").update(material).digest("hex");
  const rows=await tx.unsafe(
    "INSERT INTO platform_change_approval_events(change_request_id,event_type,actor_id,details,previous_sha256,event_sha256,created_at) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7::timestamptz) RETURNING id,event_sha256,created_at",
    [Number(changeRequestId),String(eventType),actorId==null?null:Number(actorId),JSON.stringify(safeDetails),previous,hash,createdAt]
  );
  return rows[0];
}
