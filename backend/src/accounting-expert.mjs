const FEC_FIELDS=[
  "JournalCode","JournalLib","EcritureNum","EcritureDate","CompteNum","CompteLib",
  "CompAuxNum","CompAuxLib","PieceRef","PieceDate","EcritureLib","Debit","Credit",
  "EcritureLet","DateLet","ValidDate","Montantdevise","Idevise"
];

function problem(status,code,details=null){
  const error=new Error(code);
  error.status=status;
  error.code=code;
  if(details!=null)error.details=details;
  return error;
}

function actorId(actor){
  const raw=actor?.id??actor?.user_id??actor?.sub;
  const n=Number(raw);
  return Number.isInteger(n)&&n>0?n:null;
}

function normalizeYear(value){
  const n=Number(value||new Date().getUTCFullYear());
  if(!Number.isInteger(n)||n<2020||n>2200)throw problem(400,"INVALID_ACCOUNTING_YEAR");
  return n;
}

function normalizePeriod(value){
  const v=String(value||"").trim();
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(v))throw problem(400,"INVALID_ACCOUNTING_PERIOD");
  return v;
}

function minor(value){
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<0)throw problem(400,"INVALID_ACCOUNTING_AMOUNT");
  return n;
}

function accountNumber(value){
  const v=String(value||"").trim();
  if(!/^[0-9]{3,12}$/.test(v))throw problem(400,"INVALID_ACCOUNT_NUMBER");
  return v;
}

function text(value,max=240){
  return String(value??"").trim().slice(0,max);
}

function hashPayload(value){
  return JSON.stringify(value??null);
}

function closeDateForYear(settings,year){
  const month=Number(settings.fiscal_year_close_month||12);
  const day=Number(settings.fiscal_year_close_day||31);
  const d=new Date(Date.UTC(year,month-1,day));
  if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)return null;
  return d;
}

function date8(value){
  const d=new Date(value);
  if(!Number.isFinite(d.getTime()))return "";
  return d.toISOString().slice(0,10).replaceAll("-","");
}

function amountFec(minorValue){
  return (Number(minorValue||0)/100).toFixed(2);
}

function fecCell(value){
  return String(value??"").replace(/[\t\r\n]/g," ").trim();
}

async function readSettings(store){
  const rows=await store.readSql.unsafe(
    "SELECT id,legal_name,siren,fiscal_year_close_month,fiscal_year_close_day,default_currency,vat_regime,vat_rate_bps,prices_include_vat,account_map,fec_enabled,updated_at"+
    " FROM platform_accounting_settings WHERE id=1"
  );
  return rows[0]||null;
}

async function stageEntry(tx,spec){
  const existing=(await tx.unsafe(
    "SELECT id,status,source_hash FROM platform_accounting_entries WHERE source_key=$1 FOR UPDATE",
    [spec.source_key]
  ))[0];
  if(existing&&existing.status!=="draft")return {state:"locked",id:Number(existing.id)};
  if(existing&&String(existing.source_hash)===String(spec.source_hash))return {state:"unchanged",id:Number(existing.id)};
  let id;
  if(existing){
    id=Number(existing.id);
    await tx.unsafe(
      "UPDATE platform_accounting_entries SET source_type=$2,source_hash=$3,journal_code=$4,entry_date=$5::date,piece_ref=$6,piece_date=$7::date,label=$8,currency=$9,source_payload=$10::jsonb,expert_note=NULL,updated_at=now() WHERE id=$1",
      [id,spec.source_type,spec.source_hash,spec.journal_code,spec.entry_date,spec.piece_ref,spec.piece_date,spec.label,spec.currency,hashPayload(spec.source_payload)]
    );
    await tx.unsafe("DELETE FROM platform_accounting_lines WHERE entry_id=$1",[id]);
  }else{
    const inserted=(await tx.unsafe(
      "INSERT INTO platform_accounting_entries(source_type,source_key,source_hash,journal_code,entry_date,piece_ref,piece_date,label,currency,source_payload)"+
      " VALUES($1,$2,$3,$4,$5::date,$6,$7::date,$8,$9,$10::jsonb) RETURNING id",
      [spec.source_type,spec.source_key,spec.source_hash,spec.journal_code,spec.entry_date,spec.piece_ref,spec.piece_date,spec.label,spec.currency,hashPayload(spec.source_payload)]
    ))[0];
    id=Number(inserted.id);
  }
  for(let i=0;i<spec.lines.length;i++){
    const line=spec.lines[i];
    await tx.unsafe(
      "INSERT INTO platform_accounting_lines(entry_id,line_no,account_num,account_label,auxiliary_num,auxiliary_label,line_label,debit_minor,credit_minor,amount_currency_minor,currency,vat_code)"+
      " VALUES($1,$2,$3,(SELECT label FROM platform_accounting_accounts WHERE account_num=$3),$4,$5,$6,$7,$8,$9,$10,$11)",
      [id,i+1,line.account_num,line.auxiliary_num||null,line.auxiliary_label||null,line.line_label||spec.label,line.debit_minor||0,line.credit_minor||0,line.amount_currency_minor??null,spec.currency,line.vat_code||null]
    );
  }
  return {state:existing?"updated":"inserted",id};
}

export async function refreshExpertAccountingLedger(store,actor={}){
  if(!store?.sql?.begin)throw problem(503,"EXPERT_ACCOUNTING_REQUIRES_POSTGRES");
  const result=await store.sql.begin(async tx=>{
    const stats={inserted:0,updated:0,unchanged:0,locked:0,skipped_non_eur:0};
    const settings=(await tx.unsafe("SELECT default_currency FROM platform_accounting_settings WHERE id=1 FOR SHARE"))[0]||{default_currency:"EUR"};
    const functionalCurrency=String(settings.default_currency||"EUR").toUpperCase();

    const subscriptions=await tx.unsafe(
      "SELECT id,provider,provider_event_id,tenant_id,event_time,payload_sha256,normalized_details,"+
      " COALESCE(normalized_details->>'provider_invoice_reference',provider_event_id) AS piece_ref,"+
      " (normalized_details->>'provider_invoice_amount_paid_minor')::bigint AS amount_minor,"+
      " upper(normalized_details->>'provider_invoice_currency') AS currency"+
      " FROM subscription_billing_events WHERE event_type='invoice.paid'"+
      " AND COALESCE(normalized_details->>'provider_invoice_amount_paid_minor','') ~ '^[0-9]+$'"+
      " AND COALESCE(normalized_details->>'provider_invoice_currency','') ~ '^[A-Za-z]{3}$'"
    );
    for(const row of subscriptions){
      if(String(row.currency)!==functionalCurrency){stats.skipped_non_eur++;continue;}
      const amount=Number(row.amount_minor||0);if(amount<=0)continue;
      const spec={
        source_type:"subscription_invoice_paid",source_key:"subscription:"+row.id,
        source_hash:String(row.payload_sha256||row.provider_event_id),journal_code:"OD",
        entry_date:new Date(row.event_time).toISOString().slice(0,10),
        piece_ref:text(row.piece_ref||row.provider_event_id,120),
        piece_date:new Date(row.event_time).toISOString().slice(0,10),
        label:"Abonnement Audiotel Premium Pro encaissé",currency:functionalCurrency,
        source_payload:{provider:row.provider,provider_event_id:row.provider_event_id,tenant_id:row.tenant_id,amount_minor:amount},
        lines:[
          {account_num:"471110",debit_minor:amount,line_label:"Encaissement Stripe à rapprocher"},
          {account_num:"471210",credit_minor:amount,line_label:"Produit abonnement à qualifier"}
        ]
      };
      const staged=await stageEntry(tx,spec);stats[staged.state]++;
    }

    const priorities=await tx.unsafe(
      "SELECT id,tenant_id,metadata->'priority_service' AS priority,"+
      " (metadata->'priority_service'->>'amount_minor')::bigint AS amount_minor,"+
      " upper(metadata->'priority_service'->>'currency') AS currency,"+
      " (metadata->'priority_service'->>'paid_at')::timestamptz AS paid_at"+
      " FROM tenant_portability_requests"+
      " WHERE COALESCE(metadata->'priority_service'->>'status','')='paid'"+
      " AND COALESCE(metadata->'priority_service'->>'amount_minor','') ~ '^[0-9]+$'"+
      " AND COALESCE(metadata->'priority_service'->>'currency','') ~ '^[A-Za-z]{3}$'"+
      " AND COALESCE(metadata->'priority_service'->>'paid_at','')<>''"
    );
    for(const row of priorities){
      if(String(row.currency)!==functionalCurrency){stats.skipped_non_eur++;continue;}
      const amount=Number(row.amount_minor||0);if(amount<=0)continue;
      const paidAt=new Date(row.paid_at).toISOString();
      const providerRef=row.priority?.checkout_session_reference||row.priority?.payment_intent_reference||("PORT-"+row.id);
      const spec={
        source_type:"priority_portability_paid",source_key:"priority-portability:"+row.id,
        source_hash:hashPayload(row.priority),journal_code:"OD",entry_date:paidAt.slice(0,10),
        piece_ref:text(providerRef,120),piece_date:paidAt.slice(0,10),
        label:"Portabilité prioritaire encaissée",currency:functionalCurrency,
        source_payload:{tenant_id:row.tenant_id,portability_request_id:row.id,amount_minor:amount,priority:row.priority},
        lines:[
          {account_num:"471110",debit_minor:amount,line_label:"Encaissement Stripe à rapprocher"},
          {account_num:"471220",credit_minor:amount,line_label:"Produit portabilité prioritaire à qualifier"}
        ]
      };
      const staged=await stageEntry(tx,spec);stats[staged.state]++;
    }

    const cardFees=await tx.unsafe(
      "SELECT id,public_id,tenant_id,provider_payment_intent_reference,provider_charge_reference,application_fee_minor,currency,paid_at,updated_at"+
      " FROM tenant_card_payment_requests WHERE status='paid' AND application_fee_minor>0 AND paid_at IS NOT NULL"
    );
    for(const row of cardFees){
      if(String(row.currency)!==functionalCurrency){stats.skipped_non_eur++;continue;}
      const amount=Number(row.application_fee_minor||0);if(amount<=0)continue;
      const paidAt=new Date(row.paid_at).toISOString();
      const spec={
        source_type:"card_payment_fee_paid",source_key:"card-fee:"+row.id,
        source_hash:hashPayload([row.public_id,row.provider_payment_intent_reference,row.provider_charge_reference,amount,row.currency,row.paid_at,row.updated_at]),
        journal_code:"OD",entry_date:paidAt.slice(0,10),
        piece_ref:text(row.provider_charge_reference||row.provider_payment_intent_reference||row.public_id,120),
        piece_date:paidAt.slice(0,10),label:"Commission paiement CB PGI encaissée",currency:functionalCurrency,
        source_payload:{tenant_id:row.tenant_id,payment_request_id:row.id,amount_minor:amount},
        lines:[
          {account_num:"471110",debit_minor:amount,line_label:"Encaissement Stripe à rapprocher"},
          {account_num:"471230",credit_minor:amount,line_label:"Commission paiement CB à qualifier"}
        ]
      };
      const staged=await stageEntry(tx,spec);stats[staged.state]++;
    }

    const referralEarned=await tx.unsafe(
      "SELECT id,public_id,tenant_id,amount_minor,currency,earned_at,status,paid_at,paid_reference,metadata"+
      " FROM customer_referral_rewards WHERE status IN ('earned','paid')"
    );
    for(const row of referralEarned){
      if(String(row.currency)!==functionalCurrency){stats.skipped_non_eur++;continue;}
      const amount=Number(row.amount_minor||0);if(amount<=0)continue;
      const earnedAt=new Date(row.earned_at).toISOString();
      const spec={
        source_type:"referral_reward_earned",source_key:"referral-earned:"+row.id,
        source_hash:hashPayload([row.public_id,amount,row.currency,row.earned_at,row.metadata]),
        journal_code:"OD",entry_date:earnedAt.slice(0,10),piece_ref:"PARR-"+text(row.public_id,40),
        piece_date:earnedAt.slice(0,10),label:"Prime de parrainage acquise",currency:functionalCurrency,
        source_payload:{tenant_id:row.tenant_id,reward_id:row.id,reward_public_id:row.public_id,amount_minor:amount},
        lines:[
          {account_num:"471310",debit_minor:amount,line_label:"Charge de parrainage à qualifier"},
          {account_num:"467100",credit_minor:amount,line_label:"Parrainage à payer"}
        ]
      };
      const staged=await stageEntry(tx,spec);stats[staged.state]++;
      if(row.status==="paid"&&row.paid_at){
        const paidAt=new Date(row.paid_at).toISOString();
        const paidSpec={
          source_type:"referral_reward_paid",source_key:"referral-paid:"+row.id,
          source_hash:hashPayload([row.public_id,amount,row.currency,row.paid_at,row.paid_reference]),
          journal_code:"OD",entry_date:paidAt.slice(0,10),piece_ref:text(row.paid_reference||("PARR-"+row.public_id),120),
          piece_date:paidAt.slice(0,10),label:"Prime de parrainage versée",currency:functionalCurrency,
          source_payload:{tenant_id:row.tenant_id,reward_id:row.id,reward_public_id:row.public_id,amount_minor:amount,paid_reference:row.paid_reference},
          lines:[
            {account_num:"467100",debit_minor:amount,line_label:"Extinction dette parrainage"},
            {account_num:"471110",credit_minor:amount,line_label:"Sortie Stripe à rapprocher"}
          ]
        };
        const paidStaged=await stageEntry(tx,paidSpec);stats[paidStaged.state]++;
      }
    }

    const svaMargins=await tx.unsafe(
      "SELECT id,tenant_id,upstream_settlement_id,currency,period_end,platform_fee_ht,statement_reference,updated_at"+
      " FROM tenant_revenue_distributions WHERE platform_fee_ht>0"
    );
    for(const row of svaMargins){
      if(String(row.currency)!==functionalCurrency){stats.skipped_non_eur++;continue;}
      const amount=Math.round(Number(row.platform_fee_ht||0)*100);if(amount<=0)continue;
      const spec={
        source_type:"sva_margin_booked",source_key:"sva-margin:"+row.id,
        source_hash:hashPayload([row.id,row.upstream_settlement_id,row.platform_fee_ht,row.currency,row.period_end,row.statement_reference,row.updated_at]),
        journal_code:"OD",entry_date:String(row.period_end).slice(0,10),
        piece_ref:text(row.statement_reference||("SVA-"+row.upstream_settlement_id+"-"+row.id),120),
        piece_date:String(row.period_end).slice(0,10),label:"Marge SVA comptabilisée",currency:functionalCurrency,
        source_payload:{tenant_id:row.tenant_id,distribution_id:row.id,upstream_settlement_id:row.upstream_settlement_id,platform_fee_ht:String(row.platform_fee_ht)},
        lines:[
          {account_num:"471120",debit_minor:amount,line_label:"Flux opérateur à rapprocher"},
          {account_num:"471240",credit_minor:amount,line_label:"Marge SVA à qualifier"}
        ]
      };
      const staged=await stageEntry(tx,spec);stats[staged.state]++;
    }
    return stats;
  });
  if(store.eventBus?.publish)store.eventBus.publish("platform.accounting.expert.refreshed",{...result,actor_id:actorId(actor)});
  return {schema_version:"audiotel-expert-accounting-refresh/1",...result,refreshed_at:new Date().toISOString()};
}

async function fecBlockers(store,settings,year){
  const rows=await store.readSql.unsafe(
    "SELECT"+
    " count(*) FILTER(WHERE e.status='draft')::int AS draft_entries,"+
    " count(*) FILTER(WHERE e.status IN ('validated','reversal'))::int AS validated_entries,"+
    " count(*) FILTER(WHERE e.status IN ('validated','reversal') AND a.suspense)::int AS validated_suspense_lines,"+
    " count(*) FILTER(WHERE e.status IN ('validated','reversal') AND NOT pgi_accounting_entry_balanced(e.id))::int AS unbalanced_entries"+
    " FROM platform_accounting_entries e"+
    " LEFT JOIN platform_accounting_lines l ON l.entry_id=e.id"+
    " LEFT JOIN platform_accounting_accounts a ON a.account_num=l.account_num"+
    " WHERE e.entry_date>=$1::date AND e.entry_date<$2::date",
    [year+"-01-01",(year+1)+"-01-01"]
  );
  const counts=rows[0]||{};
  const periodRows=await store.readSql.unsafe(
    "SELECT period_key,state FROM platform_accounting_periods WHERE period_key LIKE $1 ORDER BY period_key",
    [year+"-%"]
  );
  const bankRows=await store.readSql.unsafe(
    "SELECT count(*)::int AS unmatched FROM platform_bank_transactions WHERE booked_at>=$1::date AND booked_at<$2::date AND reconciliation_state='unmatched'",
    [year+"-01-01",(year+1)+"-01-01"]
  );
  const blockers=[];
  if(!settings?.legal_name)blockers.push({code:"LEGAL_NAME_MISSING",label:"Raison sociale non renseignée"});
  if(!/^\d{9}$/.test(String(settings?.siren||"")))blockers.push({code:"SIREN_MISSING",label:"SIREN à 9 chiffres non renseigné"});
  if(String(settings?.vat_regime||"unconfigured")==="unconfigured")blockers.push({code:"VAT_REGIME_UNCONFIGURED",label:"Régime de TVA à valider"});
  if(settings?.fec_enabled!==true)blockers.push({code:"FEC_NOT_ENABLED",label:"Validation FEC non activée"});
  if(Number(counts.draft_entries||0)>0)blockers.push({code:"DRAFT_ENTRIES",label:Number(counts.draft_entries)+" écriture(s) en brouillon"});
  if(Number(counts.validated_suspense_lines||0)>0)blockers.push({code:"SUSPENSE_ACCOUNTS",label:Number(counts.validated_suspense_lines)+" ligne(s) validée(s) utilisent un compte d attente"});
  if(Number(counts.unbalanced_entries||0)>0)blockers.push({code:"UNBALANCED_ENTRIES",label:Number(counts.unbalanced_entries)+" écriture(s) non équilibrée(s)"});
  if(Number(bankRows[0]?.unmatched||0)>0)blockers.push({code:"BANK_UNMATCHED",label:Number(bankRows[0].unmatched)+" mouvement(s) bancaire(s) non rapproché(s)"});
  const closeDate=closeDateForYear(settings||{},year);
  if(!closeDate)blockers.push({code:"FISCAL_CLOSE_DATE_INVALID",label:"Date de clôture fiscale invalide"});
  const expectedPeriods=[];
  for(let m=1;m<=Number(settings?.fiscal_year_close_month||12);m++)expectedPeriods.push(year+"-"+String(m).padStart(2,"0"));
  const states=new Map(periodRows.map(x=>[String(x.period_key),String(x.state)]));
  const nowYear=new Date().getUTCFullYear();
  if(year<nowYear||year===nowYear&&new Date()>=closeDate){
    const open=expectedPeriods.filter(p=>states.get(p)!=="closed");
    if(open.length)blockers.push({code:"PERIODS_NOT_CLOSED",label:open.length+" période(s) de l exercice non clôturée(s)"});
  }else{
    blockers.push({code:"FISCAL_YEAR_NOT_ENDED",label:"Exercice en cours, FEC définitif non générable avant clôture"});
  }
  if(Number(counts.validated_entries||0)===0)blockers.push({code:"NO_VALIDATED_ENTRIES",label:"Aucune écriture validée pour l exercice"});
  return {blockers,counts,periods:periodRows,unmatched_bank:Number(bankRows[0]?.unmatched||0),close_date:closeDate?.toISOString().slice(0,10)||null};
}

export async function expertAccountingSnapshot(store,params={}){
  if(!store?.readSql?.unsafe)throw problem(503,"EXPERT_ACCOUNTING_REQUIRES_POSTGRES");
  const year=normalizeYear(params.year);
  const settings=await readSettings(store);
  const [entries,trial,vat,periods,bank,documents]=await Promise.all([
    store.readSql.unsafe(
      "SELECT e.id,e.public_id,e.source_type,e.source_key,e.journal_code,e.entry_number,e.entry_date,e.piece_ref,e.piece_date,e.label,e.currency,e.status,e.expert_note,e.validated_at,e.created_at,"+
      " COALESCE(sum(l.debit_minor),0)::bigint AS debit_minor,COALESCE(sum(l.credit_minor),0)::bigint AS credit_minor,"+
      " bool_or(COALESCE(a.suspense,false)) AS uses_suspense"+
      " FROM platform_accounting_entries e LEFT JOIN platform_accounting_lines l ON l.entry_id=e.id LEFT JOIN platform_accounting_accounts a ON a.account_num=l.account_num"+
      " WHERE e.entry_date>=$1::date AND e.entry_date<$2::date GROUP BY e.id ORDER BY e.entry_date DESC,e.id DESC LIMIT 250",
      [year+"-01-01",(year+1)+"-01-01"]
    ),
    store.readSql.unsafe(
      "SELECT l.account_num,max(l.account_label) AS account_label,sum(l.debit_minor)::bigint AS debit_minor,sum(l.credit_minor)::bigint AS credit_minor,"+
      " (sum(l.debit_minor)-sum(l.credit_minor))::bigint AS balance_minor,bool_or(a.suspense) AS suspense"+
      " FROM platform_accounting_lines l JOIN platform_accounting_entries e ON e.id=l.entry_id JOIN platform_accounting_accounts a ON a.account_num=l.account_num"+
      " WHERE e.status IN ('validated','reversal') AND e.entry_date>=$1::date AND e.entry_date<$2::date"+
      " GROUP BY l.account_num ORDER BY l.account_num",
      [year+"-01-01",(year+1)+"-01-01"]
    ),
    store.readSql.unsafe(
      "SELECT COALESCE(l.vat_code,'UNCLASSIFIED') AS vat_code,sum(l.credit_minor-l.debit_minor)::bigint AS net_minor,count(*)::int AS line_count"+
      " FROM platform_accounting_lines l JOIN platform_accounting_entries e ON e.id=l.entry_id"+
      " WHERE e.status IN ('validated','reversal') AND l.account_num LIKE '445%' AND e.entry_date>=$1::date AND e.entry_date<$2::date"+
      " GROUP BY COALESCE(l.vat_code,'UNCLASSIFIED') ORDER BY 1",
      [year+"-01-01",(year+1)+"-01-01"]
    ),
    store.readSql.unsafe("SELECT period_key,state,review_started_at,closed_at,close_hash FROM platform_accounting_periods WHERE period_key LIKE $1 ORDER BY period_key",[year+"-%"]),
    store.readSql.unsafe(
      "SELECT reconciliation_state,count(*)::int AS count,COALESCE(sum(abs(amount_minor)),0)::bigint AS amount_minor"+
      " FROM platform_bank_transactions WHERE booked_at>=$1::date AND booked_at<$2::date GROUP BY reconciliation_state ORDER BY reconciliation_state",
      [year+"-01-01",(year+1)+"-01-01"]
    ),
    store.readSql.unsafe(
      "SELECT count(*)::int AS document_count,count(*) FILTER(WHERE sha256 IS NOT NULL)::int AS hashed_count FROM platform_accounting_documents"
    )
  ]);
  const fec=await fecBlockers(store,settings,year);
  return {
    schema_version:"audiotel-expert-accounting/1",generated_at:new Date().toISOString(),year,
    settings,entries,trial_balance:trial,vat_summary:vat,periods,bank_reconciliation:bank,
    documents:documents[0]||{document_count:0,hashed_count:0},
    fec_readiness:{ready:fec.blockers.length===0,blockers:fec.blockers,close_date:fec.close_date,counts:fec.counts,unmatched_bank:fec.unmatched_bank},
    accounting_policy:{
      pcg_reference:"ANC 2014-03, version 2026",
      fec_reference:"LPF article A47 A-1",
      fec_fields:FEC_FIELDS,
      source_entries_are_draft:true,
      no_tax_assumption:true,
      validated_entries_immutable:true
    }
  };
}

export async function updateExpertAccountingSettings(store,input={},actor={}){
  if(!store?.sql?.unsafe)throw problem(503,"EXPERT_ACCOUNTING_REQUIRES_POSTGRES");
  const legalName=text(input.legal_name,200)||null;
  const siren=String(input.siren||"").replace(/\s/g,"");
  if(siren&&!/^\d{9}$/.test(siren))throw problem(400,"INVALID_SIREN");
  const month=Number(input.fiscal_year_close_month??12),day=Number(input.fiscal_year_close_day??31);
  if(!Number.isInteger(month)||month<1||month>12||!Number.isInteger(day)||day<1||day>31)throw problem(400,"INVALID_FISCAL_CLOSE_DATE");
  const regime=String(input.vat_regime||"unconfigured");
  if(!["unconfigured","normal","simplified","franchise","exempt"].includes(regime))throw problem(400,"INVALID_VAT_REGIME");
  const rate=input.vat_rate_bps==null||input.vat_rate_bps===""?null:Number(input.vat_rate_bps);
  if(rate!=null&&(!Number.isInteger(rate)||rate<0||rate>10000))throw problem(400,"INVALID_VAT_RATE");
  const prices=input.prices_include_vat==null?null:input.prices_include_vat===true;
  const map=input.account_map&&typeof input.account_map==="object"&&!Array.isArray(input.account_map)?input.account_map:{};
  for(const value of Object.values(map))if(value!=null&&value!=="")accountNumber(value);
  const fecEnabled=input.fec_enabled===true;
  if(fecEnabled&&(!legalName||!siren||regime==="unconfigured"))throw problem(409,"ACCOUNTING_FEC_PREREQUISITES_MISSING");
  const row=(await store.sql.unsafe(
    "UPDATE platform_accounting_settings SET legal_name=$1,siren=$2,fiscal_year_close_month=$3,fiscal_year_close_day=$4,vat_regime=$5,vat_rate_bps=$6,prices_include_vat=$7,account_map=$8::jsonb,fec_enabled=$9,updated_at=now(),updated_by=$10 WHERE id=1"+
    " RETURNING id,legal_name,siren,fiscal_year_close_month,fiscal_year_close_day,default_currency,vat_regime,vat_rate_bps,prices_include_vat,account_map,fec_enabled,updated_at",
    [legalName,siren||null,month,day,regime,rate,prices,JSON.stringify(map),fecEnabled,actorId(actor)]
  ))[0];
  if(store.eventBus?.publish)store.eventBus.publish("platform.accounting.expert.settings_changed",{actor_id:actorId(actor)});
  return row;
}

export async function validateExpertAccountingEntry(store,id,input={},actor={}){
  const entryId=Number(id);
  if(!Number.isInteger(entryId)||entryId<=0)throw problem(400,"INVALID_ACCOUNTING_ENTRY_ID");
  const lines=Array.isArray(input.lines)?input.lines:[];
  if(lines.length<2||lines.length>40)throw problem(400,"INVALID_ACCOUNTING_LINES");
  const normalized=lines.map((line,index)=>({
    line_no:index+1,
    account_num:accountNumber(line.account_num),
    auxiliary_num:text(line.auxiliary_num,80)||null,
    auxiliary_label:text(line.auxiliary_label,160)||null,
    line_label:text(line.line_label,240)||null,
    debit_minor:minor(line.debit_minor||0),
    credit_minor:minor(line.credit_minor||0),
    vat_code:text(line.vat_code,40)||null
  }));
  for(const line of normalized)if((line.debit_minor>0)===(line.credit_minor>0))throw problem(400,"INVALID_ACCOUNTING_LINE_SIDE");
  const debit=normalized.reduce((s,x)=>s+x.debit_minor,0),credit=normalized.reduce((s,x)=>s+x.credit_minor,0);
  if(debit<=0||debit!==credit)throw problem(400,"ACCOUNTING_ENTRY_NOT_BALANCED",{debit_minor:debit,credit_minor:credit});
  const journal=text(input.journal_code||"OD",8).toUpperCase();
  const note=text(input.expert_note,1000)||null;
  return store.sql.begin(async tx=>{
    const entry=(await tx.unsafe("SELECT * FROM platform_accounting_entries WHERE id=$1 FOR UPDATE",[entryId]))[0];
    if(!entry)throw problem(404,"ACCOUNTING_ENTRY_NOT_FOUND");
    if(entry.status!=="draft")throw problem(409,"ACCOUNTING_ENTRY_ALREADY_VALIDATED");
    const period=String(entry.entry_date).slice(0,7);
    const periodState=(await tx.unsafe("SELECT state FROM platform_accounting_periods WHERE period_key=$1 FOR SHARE",[period]))[0];
    if(periodState?.state==="closed")throw problem(409,"ACCOUNTING_PERIOD_CLOSED");
    const journalRow=(await tx.unsafe("SELECT journal_code FROM platform_accounting_journals WHERE journal_code=$1 AND active=true",[journal]))[0];
    if(!journalRow)throw problem(400,"INVALID_ACCOUNTING_JOURNAL");
    const accounts=await tx.unsafe(
      "SELECT account_num,label,suspense,active FROM platform_accounting_accounts WHERE account_num=ANY($1::text[])",
      [[...new Set(normalized.map(x=>x.account_num))]]
    );
    const byAccount=new Map(accounts.map(x=>[String(x.account_num),x]));
    for(const line of normalized){
      const account=byAccount.get(line.account_num);
      if(!account||account.active!==true)throw problem(400,"ACCOUNTING_ACCOUNT_NOT_ACTIVE",{account_num:line.account_num});
      if(account.suspense===true)throw problem(409,"ACCOUNTING_SUSPENSE_ACCOUNT_CANNOT_BE_VALIDATED",{account_num:line.account_num});
    }
    await tx.unsafe("DELETE FROM platform_accounting_lines WHERE entry_id=$1",[entryId]);
    for(const line of normalized){
      const account=byAccount.get(line.account_num);
      await tx.unsafe(
        "INSERT INTO platform_accounting_lines(entry_id,line_no,account_num,account_label,auxiliary_num,auxiliary_label,line_label,debit_minor,credit_minor,currency,vat_code)"+
        " VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [entryId,line.line_no,line.account_num,account.label,line.auxiliary_num,line.auxiliary_label,line.line_label||entry.label,line.debit_minor,line.credit_minor,entry.currency,line.vat_code]
      );
    }
    const year=new Date(entry.entry_date).getUTCFullYear();
    const seq=(await tx.unsafe(
      "INSERT INTO platform_accounting_sequences(fiscal_year,next_number) VALUES($1,2)"+
      " ON CONFLICT(fiscal_year) DO UPDATE SET next_number=platform_accounting_sequences.next_number+1"+
      " RETURNING next_number-1 AS assigned",
      [year]
    ))[0];
    const entryNumber=String(year)+String(seq.assigned).padStart(10,"0");
    const updated=(await tx.unsafe(
      "UPDATE platform_accounting_entries SET journal_code=$2,entry_number=$3,status='validated',expert_note=$4,validated_at=now(),validated_by=$5,updated_at=now() WHERE id=$1"+
      " RETURNING id,public_id,journal_code,entry_number,entry_date,piece_ref,label,currency,status,validated_at",
      [entryId,journal,entryNumber,note,actorId(actor)]
    ))[0];
    return updated;
  });
}

export async function setAccountingPeriodState(store,period,input={},actor={}){
  const key=normalizePeriod(period),state=String(input.state||"").trim();
  if(!["open","review","closed"].includes(state))throw problem(400,"INVALID_ACCOUNTING_PERIOD_STATE");
  if(state==="closed"){
    const checks=(await store.readSql.unsafe(
      "SELECT"+
      " count(*) FILTER(WHERE status='draft')::int AS drafts,"+
      " count(*) FILTER(WHERE status IN ('validated','reversal') AND NOT pgi_accounting_entry_balanced(id))::int AS unbalanced"+
      " FROM platform_accounting_entries WHERE entry_date>=($1||'-01')::date AND entry_date<(($1||'-01')::date+interval '1 month')",
      [key]
    ))[0]||{};
    const suspense=(await store.readSql.unsafe(
      "SELECT count(*)::int AS count FROM platform_accounting_lines l JOIN platform_accounting_entries e ON e.id=l.entry_id JOIN platform_accounting_accounts a ON a.account_num=l.account_num"+
      " WHERE e.entry_date>=($1||'-01')::date AND e.entry_date<(($1||'-01')::date+interval '1 month') AND e.status IN ('validated','reversal') AND a.suspense",
      [key]
    ))[0]?.count||0;
    const bank=(await store.readSql.unsafe(
      "SELECT count(*)::int AS count FROM platform_bank_transactions WHERE booked_at>=($1||'-01')::date AND booked_at<(($1||'-01')::date+interval '1 month') AND reconciliation_state='unmatched'",
      [key]
    ))[0]?.count||0;
    if(Number(checks.drafts)>0||Number(checks.unbalanced)>0||Number(suspense)>0||Number(bank)>0){
      throw problem(409,"ACCOUNTING_PERIOD_NOT_CLOSABLE",{drafts:Number(checks.drafts||0),unbalanced:Number(checks.unbalanced||0),suspense:Number(suspense||0),unmatched_bank:Number(bank||0)});
    }
  }
  const hashRows=state==="closed"?await store.readSql.unsafe(
    "SELECT md5(COALESCE(string_agg(e.id::text||':'||COALESCE(e.entry_number,'')||':'||e.source_hash||':'||l.account_num||':'||l.debit_minor||':'||l.credit_minor,'|' ORDER BY e.entry_date,e.id,l.line_no),'')) AS hash"+
    " FROM platform_accounting_entries e JOIN platform_accounting_lines l ON l.entry_id=e.id"+
    " WHERE e.entry_date>=($1||'-01')::date AND e.entry_date<(($1||'-01')::date+interval '1 month')",
    [key]
  ):null;
  const closeHash=state==="closed"?String(hashRows?.[0]?.hash||""):null;
  const row=(await store.sql.unsafe(
    "INSERT INTO platform_accounting_periods(period_key,state,review_started_at,closed_at,closed_by,close_hash)"+
    " VALUES($1,$2,CASE WHEN $2='review' THEN now() ELSE NULL END,CASE WHEN $2='closed' THEN now() ELSE NULL END,CASE WHEN $2='closed' THEN $3 ELSE NULL END,$4)"+
    " ON CONFLICT(period_key) DO UPDATE SET state=EXCLUDED.state,review_started_at=CASE WHEN EXCLUDED.state='review' THEN COALESCE(platform_accounting_periods.review_started_at,now()) WHEN EXCLUDED.state='open' THEN NULL ELSE platform_accounting_periods.review_started_at END,"+
    " closed_at=CASE WHEN EXCLUDED.state='closed' THEN now() WHEN EXCLUDED.state='open' THEN NULL ELSE platform_accounting_periods.closed_at END,"+
    " closed_by=CASE WHEN EXCLUDED.state='closed' THEN EXCLUDED.closed_by WHEN EXCLUDED.state='open' THEN NULL ELSE platform_accounting_periods.closed_by END,"+
    " close_hash=CASE WHEN EXCLUDED.state='closed' THEN EXCLUDED.close_hash WHEN EXCLUDED.state='open' THEN NULL ELSE platform_accounting_periods.close_hash END"+
    " RETURNING period_key,state,review_started_at,closed_at,close_hash",
    [key,state,actorId(actor),closeHash]
  ))[0];
  return row;
}

export async function importAccountingBankTransactions(store,input={},actor={}){
  const rows=Array.isArray(input.transactions)?input.transactions:[];
  if(!rows.length||rows.length>2000)throw problem(400,"INVALID_BANK_TRANSACTION_BATCH");
  let inserted=0,duplicates=0;
  await store.sql.begin(async tx=>{
    for(const item of rows){
      const externalKey=text(item.external_key,180);
      const bookedAt=text(item.booked_at,10);
      const currency=text(item.currency||"EUR",3).toUpperCase();
      const amount=Number(item.amount_minor);
      const label=text(item.label,500);
      if(!externalKey||!/^\d{4}-\d{2}-\d{2}$/.test(bookedAt)||!/^[A-Z]{3}$/.test(currency)||!Number.isSafeInteger(amount)||!label)throw problem(400,"INVALID_BANK_TRANSACTION");
      const result=await tx.unsafe(
        "INSERT INTO platform_bank_transactions(external_key,booked_at,value_at,amount_minor,currency,label,counterparty,source,raw_payload)"+
        " VALUES($1,$2::date,$3::date,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(external_key) DO NOTHING RETURNING id",
        [externalKey,bookedAt,item.value_at||null,amount,currency,label,text(item.counterparty,240)||null,text(item.source||"import",40),JSON.stringify(item.raw_payload||{})]
      );
      if(result.length)inserted++;else duplicates++;
    }
  });
  if(store.eventBus?.publish)store.eventBus.publish("platform.accounting.bank_imported",{inserted,duplicates,actor_id:actorId(actor)});
  return {inserted,duplicates,total:rows.length};
}

export async function expertAccountingFec(store,params={}){
  const year=normalizeYear(params.year);
  const settings=await readSettings(store);
  const readiness=await fecBlockers(store,settings,year);
  if(readiness.blockers.length)throw problem(409,"ACCOUNTING_FEC_NOT_READY",{year,blockers:readiness.blockers});
  const rows=await store.readSql.unsafe(
    "SELECT j.journal_code,j.label AS journal_label,e.entry_number,e.entry_date,l.account_num,l.account_label,l.auxiliary_num,l.auxiliary_label,e.piece_ref,e.piece_date,"+
    " COALESCE(l.line_label,e.label) AS entry_label,l.debit_minor,l.credit_minor,l.lettering,l.lettering_date,e.validated_at,l.amount_currency_minor,l.currency"+
    " FROM platform_accounting_entries e JOIN platform_accounting_journals j ON j.journal_code=e.journal_code JOIN platform_accounting_lines l ON l.entry_id=e.id"+
    " WHERE e.status IN ('validated','reversal') AND e.entry_date>=$1::date AND e.entry_date<$2::date"+
    " ORDER BY e.entry_number,l.line_no",
    [year+"-01-01",(year+1)+"-01-01"]
  );
  const body=[FEC_FIELDS.join("\t")];
  const defaultCurrency=String(settings.default_currency||"EUR");
  for(const row of rows){
    const foreign=String(row.currency)!==defaultCurrency;
    body.push([
      row.journal_code,row.journal_label,row.entry_number,date8(row.entry_date),row.account_num,row.account_label,
      row.auxiliary_num||"",row.auxiliary_label||"",row.piece_ref,date8(row.piece_date),row.entry_label,
      amountFec(row.debit_minor),amountFec(row.credit_minor),row.lettering||"",date8(row.lettering_date),date8(row.validated_at),
      foreign&&row.amount_currency_minor!=null?amountFec(row.amount_currency_minor):"",foreign?row.currency:""
    ].map(fecCell).join("\t"));
  }
  const closeDate=closeDateForYear(settings,year);
  const filename=String(settings.siren)+"FEC"+date8(closeDate)+".txt";
  return {schema_version:"audiotel-fec-export/1",year,filename,content:body.join("\r\n")+"\r\n",row_count:rows.length,field_count:FEC_FIELDS.length,sha256_source:"server-generated-from-immutable-validated-ledger"};
}
