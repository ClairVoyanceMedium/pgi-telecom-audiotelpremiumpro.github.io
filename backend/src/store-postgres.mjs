
import {createHash} from "node:crypto";
import {sanitizeCdrPayload,deriveCallerHash} from "./cdr-privacy.mjs";
import {computeExpertCost} from "./expert-finance.mjs";
import {normalizeSettlementPayload} from "./settlement-finance.mjs";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const core=require("../../assets/core.js");

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
    const presence=await this.readSql.unsafe(
      "SELECT count(*) FILTER (WHERE status='available' AND enabled)::int AS active_experts,"+
      " COALESCE(sum(active_calls),0)::int AS live_calls FROM experts"
    );
    const r=numberFields(rows[0],[
      "calls_total","calls_connected","calls_abandoned","calls_failed","currency_count"
    ]);
    const p=numberFields(presence[0],["active_experts","live_calls"]);
    return {
      ...r,
      mixed_currency:r.currency_count>1,
      asr_percent:r.calls_total?r.calls_connected/r.calls_total*100:0,
      active_experts:p.active_experts,
      live_calls:p.live_calls,
      queue_depth:0
    };
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

  async listCalls(params={}){
    const limit=clampInt(params.limit,100,1,250);
    const cursor=decodeCursor(params.cursor);
    const values=[
      params.from||null,params.to||null,params.expert_id?Number(params.expert_id):null,
      params.origin_carrier||null,params.status||null,params.market||null,
      cursor?.started_at||null,cursor?.id||null,limit+1
    ];
    const rows=await this.sql.unsafe(
      "SELECT c.id,c.external_call_id,c.started_at,c.ivr_started_at,c.queued_at,c.bridged_at,c.ended_at,"+
      " ca.caller_masked,oc.name AS origin_carrier,hc.name AS host_carrier,sn.display_number AS sva_number,"+
      " c.currency,m.country_code AS market,e.id AS expert_id,e.display_name AS expert_name,c.wait_seconds,c.conversation_seconds,c.total_seconds,"+
      " c.billable_seconds,c.payout_eligible_seconds,c.call_status,c.sip_final_code,c.hangup_cause,c.codec,"+
      " c.service_rate_ttc_per_min::float8,c.carrier_rate_ht_per_min::float8,c.retail_service_amount_ttc::float8,"+
      " c.expected_payout_ht::float8,COALESCE(c.confirmed_payout_ht,0)::float8 AS confirmed_payout_ht,"+
      " c.paid_payout_ht::float8,c.expert_cost_ht::float8,c.technical_cost_ht::float8,c.estimated_margin_ht::float8,"+
      " c.reconciliation_variance_ht::float8,c.reconciliation_status,q.rtp_packet_loss_percent::float8 AS packet_loss_percent,"+
      " q.jitter_ms::float8,q.latency_ms::float8,q.mos::float8"+
      " FROM call_facts f JOIN calls c ON c.id=f.call_id AND c.tenant_bucket=f.tenant_bucket"+
      " LEFT JOIN callers ca ON ca.id=c.caller_id LEFT JOIN carriers oc ON oc.id=c.origin_carrier_id"+
      " LEFT JOIN carriers hc ON hc.id=c.host_carrier_id LEFT JOIN sva_numbers sn ON sn.id=c.sva_number_id"+
      " LEFT JOIN operating_markets m ON m.id=c.market_id"+
      " LEFT JOIN experts e ON e.id=c.expert_id LEFT JOIN call_quality q ON q.call_id=c.id"+
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
        packet_loss_percent:x.packet_loss_percent,jitter_ms:x.jitter_ms,latency_ms:x.latency_ms,mos:x.mos
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
        Math.max(0,(confirmed||0)-expertCost-technicalCost),recon?recon.status:"pending",recon?recon.varianceHt:0,
        sva.tenant_id||null,sva.market_id||null,String(sva.currency||"EUR")
      ];
      const callRows=await tx.unsafe(
        "INSERT INTO calls(external_call_id,cdr_source,caller_id,sva_number_id,expert_id,origin_carrier_id,host_carrier_id,"+
        " started_at,ivr_started_at,queued_at,bridged_at,ended_at,wait_seconds,conversation_seconds,total_seconds,billable_seconds,"+
        " payout_eligible_seconds,call_status,sip_final_code,hangup_cause,codec,service_rate_ttc_per_min,carrier_rate_ht_per_min,"+
        " mobile_deduction_ht_per_min,retail_service_amount_ttc,expected_payout_ht,confirmed_payout_ht,paid_payout_ht,"+
        " expert_cost_ht,technical_cost_ht,estimated_margin_ht,reconciliation_status,reconciliation_variance_ht,tenant_id,market_id,currency)"+
        " VALUES($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz,$10::timestamptz,$11::timestamptz,$12::timestamptz,"+
        " $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36)"+
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

      await writeHourlyRollup(tx,call.id);
      await writeDashboardDimensionRollups(tx,call.id);
      await writeExperienceRollup(tx,call.id);

      if(p.quality){
        await tx.unsafe(
          "INSERT INTO call_quality(call_id,rtp_packet_loss_percent,jitter_ms,latency_ms,mos,dtmf_errors) VALUES($1,$2,$3,$4,$5,$6)",
          [call.id,nullableNumber(p.quality.packet_loss_percent),nullableNumber(p.quality.jitter_ms),nullableNumber(p.quality.latency_ms),nullableNumber(p.quality.mos),Number(p.quality.dtmf_errors||0)]
        );
        await writeQualityRollup(tx,call.id);
      }
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

      return {...updated[0],changed:true};
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
    await this.sql.unsafe(
      "INSERT INTO audit_log(user_id,action,entity_type,entity_id,details) VALUES($1,'carrier_switch.plan','carrier_switch',$2,$3::jsonb)",
      [numericActor(actor),String(rows[0].id),JSON.stringify({route_key:rows[0].route_key,to_carrier_id:Number(connection.carrier_id),connection_id:Number(connection.id),rollback_window_minutes:rollbackMinutes})]
    );
    return rows[0];
  }

  async activateCarrierSwitch(id,actor={}){
    const result=await this.sql.begin(async tx=>{
      const switchRows=await tx.unsafe("SELECT * FROM carrier_switches WHERE id=$1 FOR UPDATE",[Number(id)]);
      const sw=switchRows[0];
      if(!sw)throw problem(404,"SWITCH_NOT_FOUND");
      if(!["ready","planned"].includes(sw.status))throw problem(409,"SWITCH_NOT_READY");
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
      await tx.unsafe(
        "INSERT INTO audit_log(user_id,action,entity_type,entity_id,details) VALUES($1,'carrier_switch.activate','carrier_switch',$2,$3::jsonb)",
        [numericActor(actor),String(sw.id),JSON.stringify({generation:gens[0].generation})]
      );
      return {switch:updated[0],route:await routeWith(tx,sw.route_key)};
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
        "SELECT v.id,p.plan_key,p.display_name,v.market_id,m.country_code AS market,v.currency,v.amount_minor,"+
        " v.billing_interval,v.interval_count,v.effective_from,v.effective_to,v.provider,v.provider_price_reference"+
        " FROM service_plan_price_versions v JOIN service_plans p ON p.id=v.service_plan_id"+
        " LEFT JOIN operating_markets m ON m.id=v.market_id"+
        " WHERE p.plan_key='external-sva-access' AND v.effective_from<=now()"+
        " AND (v.effective_to IS NULL OR v.effective_to>now())"+
        " ORDER BY (v.market_id IS NULL) DESC,v.effective_from DESC LIMIT 1"
      ),
      this.readSql.unsafe(
        "SELECT v.id,v.currency,v.amount_minor,v.billing_interval,v.interval_count,v.effective_from,v.effective_to,"+
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
        "SELECT v.id,p.plan_key,v.market_id,m.country_code AS market,v.currency,v.amount_minor,v.billing_interval,v.interval_count,"+
        " v.effective_from,v.effective_to FROM service_plan_price_versions v JOIN service_plans p ON p.id=v.service_plan_id"+
        " LEFT JOIN operating_markets m ON m.id=v.market_id WHERE v.id=$1",
        [id]
      );
      await tx.unsafe(
        "INSERT INTO audit_log(user_id,action,entity_type,entity_id,details) VALUES($1,'subscription.price.publish','service_plan_price',$2,$3::jsonb)",
        [actorId,String(id),JSON.stringify({plan_key:"external-sva-access",currency,amount_minor:amountMinor,market_id:marketId,effective_from:effectiveFrom})]
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
    const priceVersionId=Number(payload.price_version_id);
    const marketId=payload.market_id==null||payload.market_id===""?null:Number(payload.market_id);
    const lastPaymentStatus=payload.last_payment_status==null?null:String(payload.last_payment_status).trim().toLowerCase();
    if(!/^[a-z0-9_.-]{2,40}$/.test(provider))throw problem(400,"INVALID_BILLING_PROVIDER");
    if(!eventId||eventId.length>200)throw problem(400,"INVALID_BILLING_EVENT_ID");
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantPublicId))throw problem(400,"INVALID_BILLING_TENANT");
    if(!providerSubscription||providerSubscription.length>200)throw problem(400,"INVALID_BILLING_SUBSCRIPTION_REFERENCE");
    if(!["active","past_due","suspended","cancelled","ended"].includes(status))throw problem(400,"INVALID_SUBSCRIPTION_STATUS");
    if(!Number.isInteger(priceVersionId)||priceVersionId<=0)throw problem(400,"INVALID_PRICE_VERSION");
    if(!Number.isFinite(Date.parse(eventTime)))throw problem(400,"INVALID_BILLING_EVENT_TIME");
    if(status==="active"&&(!periodEnd||!Number.isFinite(Date.parse(periodEnd))||Date.parse(periodEnd)<=Date.parse(eventTime)))throw problem(400,"ACTIVE_SUBSCRIPTION_PERIOD_REQUIRED");
    const normalized={
      provider,provider_event_id:eventId,tenant_public_id:tenantPublicId,provider_customer_reference:providerCustomer,
      provider_subscription_reference:providerSubscription,event_type:eventType,status,event_time:eventTime,
      price_version_id:priceVersionId,market_id:marketId,current_period_start:periodStart,current_period_end:periodEnd,
      cancel_at_period_end:!!payload.cancel_at_period_end,last_payment_status:lastPaymentStatus
    };
    const hash=createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
    const result=await this.sql.begin(async tx=>{
      await tx.unsafe("SELECT pg_advisory_xact_lock(hashtext($1))",[provider+":"+eventId]);
      const seen=await tx.unsafe("SELECT id,subscription_id FROM subscription_billing_events WHERE provider=$1 AND provider_event_id=$2",[provider,eventId]);
      if(seen.length)return {duplicate:true,subscription_id:seen[0].subscription_id};
      const tenantRows=await tx.unsafe("SELECT id,tenant_type,status FROM tenants WHERE public_id=$1::uuid LIMIT 1",[tenantPublicId]);
      const tenant=tenantRows[0];
      if(!tenant)throw problem(404,"BILLING_TENANT_NOT_FOUND");
      if(tenant.tenant_type==="internal")throw problem(409,"INTERNAL_TENANT_BILLING_EXEMPT");
      const priceRows=await tx.unsafe(
        "SELECT v.id,v.service_plan_id,v.currency,v.market_id FROM service_plan_price_versions v"+
        " JOIN service_plans p ON p.id=v.service_plan_id WHERE v.id=$1 AND p.plan_key='external-sva-access' LIMIT 1",
        [priceVersionId]
      );
      const price=priceRows[0];
      if(!price)throw problem(404,"SUBSCRIPTION_PRICE_NOT_FOUND");
      if(marketId!=null&&price.market_id!=null&&Number(price.market_id)!==marketId)throw problem(409,"SUBSCRIPTION_PRICE_MARKET_MISMATCH");
      let subscriptions=await tx.unsafe(
        "SELECT id,last_event_at FROM tenant_subscriptions WHERE billing_provider=$1 AND provider_subscription_reference=$2 LIMIT 1 FOR UPDATE",
        [provider,providerSubscription]
      );
      let subscriptionId;
      const startsAt=periodStart||eventTime;
      const endsAt=["cancelled","ended"].includes(status)?(payload.ends_at||eventTime):null;
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
        "INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload) VALUES($1,'subscription.changed','tenant_subscription',$2,$3::jsonb)",
        [tenant.id,String(subscriptionId),JSON.stringify({status,provider,event_type:eventType})]
      );
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
      const locale=localeInput||market?.default_locale||"en";
      const currency=currencyInput||market?.default_currency||"EUR";
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
    const rows=await this.readSql.unsafe(
      "WITH page AS ("+
      " SELECT t.id,t.public_id,t.slug,t.display_name,t.legal_name,t.tenant_type,t.status,t.country_code,"+
      " t.preferred_locale,t.default_currency,t.timezone,t.home_region,t.capacity_tier,t.created_at"+
      " FROM tenants t WHERE t.tenant_type<>'internal'"+
      " AND ($1::text IS NULL OR t.slug_search LIKE $1||'%' OR t.display_name_search LIKE $1||'%' OR t.legal_name_search LIKE $1||'%' OR lower(t.country_code)=$1)"+
      " AND ($2::text IS NULL OR t.status=$2) AND ($3::text IS NULL OR t.country_code=$3)"+
      " AND ($4::text IS NULL OR ($4='active' AND pgi_tenant_has_premium_call_access(t.id,NULL,now()))"+
      " OR ($4='unpaid' AND NOT EXISTS (SELECT 1 FROM tenant_subscriptions s JOIN service_plans p ON p.id=s.service_plan_id WHERE s.tenant_id=t.id AND p.plan_key='external-sva-access' AND s.status='active' AND s.current_period_end>now()))"+
      " OR ($4='blocked' AND t.status='suspended'))"+
      " AND ($5::text IS NULL OR EXISTS (SELECT 1 FROM tenant_number_assignments ta JOIN sva_numbers sn ON sn.id=ta.sva_number_id WHERE ta.tenant_id=t.id AND sn.e164 LIKE $5||'%'))"+
      " AND ($6::text IS NULL OR ($6='not_started' AND NOT EXISTS (SELECT 1 FROM tenant_kyc_profiles kf WHERE kf.tenant_id=t.id)) OR EXISTS (SELECT 1 FROM tenant_kyc_profiles kf WHERE kf.tenant_id=t.id AND kf.status=$6))"+
      " AND ($7::bigint IS NULL OR t.id<$7) ORDER BY t.id DESC LIMIT $8"+
      ") SELECT page.id AS _cursor_id,page.public_id,page.slug,page.display_name,page.legal_name,page.tenant_type,page.status,page.country_code,"+
      " page.preferred_locale,page.default_currency,page.timezone,page.home_region,page.capacity_tier,COALESCE(k.status,'not_started') AS kyc_status,page.created_at,"+
      " COALESCE(a.assignment_count,0)::int AS number_assignments,COALESCE(a.active_assignments,0)::int AS active_assignments,"+
      " s.status AS subscription_status,s.current_period_end,s.last_payment_status,s.cancel_at_period_end,s.billing_provider,"+
      " COALESCE(pgi_tenant_has_premium_call_access(page.id,NULL,now()),false) AS premium_call_access"+
      " FROM page LEFT JOIN tenant_kyc_profiles k ON k.tenant_id=page.id"+
      " LEFT JOIN LATERAL (SELECT count(*) AS assignment_count,count(*) FILTER (WHERE status='active') AS active_assignments FROM tenant_number_assignments a WHERE a.tenant_id=page.id) a ON true"+
      " LEFT JOIN LATERAL (SELECT x.status,x.current_period_end,x.last_payment_status,x.cancel_at_period_end,x.billing_provider FROM tenant_subscriptions x JOIN service_plans sp ON sp.id=x.service_plan_id WHERE x.tenant_id=page.id AND sp.plan_key='external-sva-access' ORDER BY x.created_at DESC,x.id DESC LIMIT 1) s ON true"+
      " ORDER BY page.id DESC",
      [q||null,status,country,billing,number||null,kyc,cursor,limit+1]
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
        "SELECT a.id,a.tenant_id,a.status,t.public_id,t.display_name,t.tenant_type,sn.e164,sn.display_number FROM tenant_number_assignments a"+
        " JOIN tenants t ON t.id=a.tenant_id JOIN sva_numbers sn ON sn.id=a.sva_number_id WHERE a.id=$1 FOR UPDATE",[id]
      );
      const row=rows[0];if(!row)throw problem(404,"ASSIGNMENT_NOT_FOUND");
      if(row.tenant_type==="internal")throw problem(409,"INTERNAL_ASSIGNMENT_PROTECTED");
      const previous=row.status;
      if(previous===status)return {...row,status,previous_status:previous,changed:false};
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

  async scanUnpaidSubscriptions(limit=500){
    limit=clampInt(limit,500,1,2000);
    const alerts=await this.sql.begin(async tx=>{
      await tx.unsafe(
        "UPDATE tenant_subscriptions s SET status='past_due',last_payment_status=COALESCE(NULLIF(last_payment_status,''),'unpaid'),updated_at=now()"+
        " FROM service_plans p,tenants t WHERE p.id=s.service_plan_id AND t.id=s.tenant_id AND p.plan_key='external-sva-access'"+
        " AND t.tenant_type<>'internal' AND s.status='active' AND s.current_period_end IS NOT NULL AND s.current_period_end<=now()"
      );
      return tx.unsafe(
        "WITH due AS ("+
        " SELECT s.id AS subscription_id,s.tenant_id,t.public_id,t.display_name,t.country_code,s.current_period_end,s.status,s.last_payment_status"+
        " FROM tenant_subscriptions s JOIN service_plans p ON p.id=s.service_plan_id JOIN tenants t ON t.id=s.tenant_id"+
        " WHERE p.plan_key='external-sva-access' AND t.tenant_type<>'internal' AND t.status<>'closed'"+
        " AND (s.status IN ('past_due','suspended') OR (s.current_period_end IS NOT NULL AND s.current_period_end<=now())"+
        " OR lower(COALESCE(s.last_payment_status,'')) IN ('failed','unpaid','declined','past_due'))"+
        " ORDER BY COALESCE(s.current_period_end,now()) ASC,s.id ASC LIMIT $1"+
        "), ins AS ("+
        " INSERT INTO tenant_admin_alerts(alert_key,tenant_id,subscription_id,alert_type,severity,title,message,due_at,details)"+
        " SELECT 'subscription_unpaid:'||d.subscription_id||':'||COALESCE(EXTRACT(EPOCH FROM d.current_period_end)::bigint::text,d.status),d.tenant_id,d.subscription_id,"+
        " 'subscription_unpaid','critical','Abonnement impayé','Abonnement mensuel non réglé : accès SVA bloqué.',d.current_period_end,"+
        " jsonb_build_object('tenant_public_id',d.public_id,'tenant',d.display_name,'country_code',d.country_code,'subscription_status',d.status,'last_payment_status',d.last_payment_status)"+
        " FROM due d ON CONFLICT(alert_key) DO NOTHING"+
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
    const [subs,lines,experts,alerts,settlements,controls,audit,activity]=await Promise.all([
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
        "SELECT id,code,display_name,destination_uri,status,active_calls,last_assigned_at,enabled,compensation_type,compensation_rate::float8"+
        " FROM experts WHERE tenant_id=$1 ORDER BY display_name,id LIMIT 100",[id]
      ),
      this.readSql.unsafe(
        "SELECT id,alert_type,severity,state,title,message,due_at,first_detected_at,last_detected_at,acknowledged_at,resolved_at"+
        " FROM tenant_admin_alerts WHERE tenant_id=$1 ORDER BY id DESC LIMIT 50",[id]
      ),
      this.readSql.unsafe(
        "SELECT s.id,m.country_code AS market,s.currency,s.period_start,s.period_end,s.upstream_payout_ht::float8,s.platform_fee_ht::float8,s.net_payout_ht::float8,"+
        " s.status,s.payment_due_date,s.paid_at FROM tenant_settlements s LEFT JOIN operating_markets m ON m.id=s.market_id"+
        " WHERE s.tenant_id=$1 ORDER BY s.period_end DESC,s.id DESC LIMIT 24",[id]
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
      )
    ]);
    const access=await this.readSql.unsafe("SELECT pgi_tenant_has_premium_call_access($1,NULL,now()) AS allowed",[id]);
    return {
      tenant:{...tenant,premium_call_access:Boolean(access[0]?.allowed)},
      subscriptions:subs,lines,experts,alerts,settlements,controls,audit,
      activity:activity[0]||{calls_30d:0,connected_30d:0,billable_seconds_30d:0,revenue_ttc_30d:0,margin_ht_30d:0,last_call_at:null}
    };
  }

  async wholesaleOverview(){
    const [summaryRows,tenants,numbers,settlements,payments,markets,currencyTotals,scaleRows]=await Promise.all([
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
        " FROM tenant_settlements s JOIN tenants t ON t.id=s.tenant_id"+
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
        " FROM tenant_settlements s JOIN tenants t ON t.id=s.tenant_id"+
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
      }
    };
  }

  async systemSnapshot(){
    const [counts,last,route,queue,resilienceRows]=await Promise.all([
      this.sql.unsafe(
        "SELECT count(*)::int AS calls_total,(SELECT count(*)::int FROM experts WHERE enabled AND status='available') AS experts_available,"+
        " (SELECT count(*)::int FROM outbox_events WHERE published_at IS NULL) AS outbox_pending FROM calls"
      ),
      this.sql.unsafe("SELECT ended_at FROM calls ORDER BY ended_at DESC LIMIT 1"),
      this.carrierRouting(),
      this.workQueueHealth(),
      this.readSql.unsafe(
        "SELECT"+
        " (SELECT count(*)::int FROM platform_regions) AS regions_total,"+
        " (SELECT count(*)::int FROM platform_regions WHERE status IN ('ready','active')) AS regions_ready,"+
        " (SELECT count(*)::int FROM disaster_recovery_targets WHERE enabled) AS dr_targets_total"
      )
    ]);
    return {
      mode:this.config.mode,store:"postgres",
      calls_total:counts[0].calls_total,experts_available:counts[0].experts_available,
      cdr_lag_seconds:last[0]?Math.max(0,(Date.now()-Date.parse(last[0].ended_at))/1000):0,
      outbox_pending:counts[0].outbox_pending,event_subscribers:this.eventBus.size,carrier_route:route,
      work_queue:queue,
      resilience:resilienceRows[0]||{regions_total:0,regions_ready:0,dr_targets_total:0}
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
function problem(status,code,message=code){
  const e=new Error(message);e.status=status;e.code=code;return e;
}
