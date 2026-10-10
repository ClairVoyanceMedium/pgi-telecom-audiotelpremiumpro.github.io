import {createHash} from "node:crypto";

function failure(status,code){
  const error=new Error(code);error.code=code;error.status=status;return error;
}

function requirePostgres(store){
  if(!store?.sql?.begin||!store?.readSql?.unsafe)throw failure(503,"DIRECT_SVA_POSTGRES_REQUIRED");
}

function actorId(actor){
  const id=Number(actor?.id??actor?.user_id??actor?.sub);
  if(!Number.isSafeInteger(id)||id<1)throw failure(403,"DIRECT_SVA_VERIFIED_ACTOR_REQUIRED");
  return id;
}

export function validDirectSvaMonth(raw,now=new Date()){
  const month=raw==null||raw===""?now.toISOString().slice(0,7):String(raw);
  if(!/^(20[2-9][0-9]|21[0-9]{2})-(0[1-9]|1[0-2])$/.test(month))throw failure(400,"INVALID_DIRECT_SVA_MONTH");
  return month;
}

export function normalizeDirectSvaJournalDraft(payload={}){
  const sourceReference=String(payload.source_reference||"").trim();
  const description=String(payload.description||"").trim();
  const evidenceReference=String(payload.evidence_reference||"").trim();
  const entryDate=String(payload.entry_date||"").trim();
  const currency=String(payload.currency||"EUR").trim().toUpperCase();
  if(!/^DSVA-[0-9A-Za-z_.-]{3,190}$/.test(sourceReference))throw failure(400,"DIRECT_SVA_SOURCE_REFERENCE_INVALID");
  if(description.length<6||description.length>400)throw failure(400,"DIRECT_SVA_DESCRIPTION_INVALID");
  if(evidenceReference.length<6||evidenceReference.length>240)throw failure(400,"DIRECT_SVA_EVIDENCE_REQUIRED");
  if(currency!=="EUR")throw failure(400,"DIRECT_SVA_CURRENCY_UNSUPPORTED");
  if(!/^(20[2-9][0-9]|21[0-9]{2})-(0[1-9]|1[0-2])-([0-2][0-9]|3[0-1])$/.test(entryDate)||Number.isNaN(Date.parse(entryDate+"T00:00:00Z"))||new Date(entryDate+"T00:00:00Z").toISOString().slice(0,10)!==entryDate){
    throw failure(400,"DIRECT_SVA_ENTRY_DATE_INVALID");
  }
  if(!Array.isArray(payload.lines)||payload.lines.length<2||payload.lines.length>50)throw failure(400,"DIRECT_SVA_LINES_INVALID");
  const lines=payload.lines.map((line,index)=>{
    const accountCode=String(line?.account_code||"").trim();
    const label=String(line?.label||"").trim();
    const debit=Number(line?.debit_minor??0),credit=Number(line?.credit_minor??0);
    if(!/^[0-9]{6}$/.test(accountCode)||label.length<2||label.length>300)throw failure(400,"DIRECT_SVA_LINE_INVALID");
    if(!Number.isSafeInteger(debit)||!Number.isSafeInteger(credit)||debit<0||credit<0||debit>1000000000000||credit>1000000000000||((debit>0)===(credit>0))){
      throw failure(400,"DIRECT_SVA_AMOUNT_INVALID");
    }
    return {line_no:index+1,account_code:accountCode,label,debit_minor:debit,credit_minor:credit};
  });
  const debit=lines.reduce((sum,line)=>sum+line.debit_minor,0),credit=lines.reduce((sum,line)=>sum+line.credit_minor,0);
  if(!Number.isSafeInteger(debit)||debit<=0||debit!==credit)throw failure(400,"DIRECT_SVA_ENTRY_UNBALANCED");
  return Object.freeze({source_system:"manual_evidence",source_reference:sourceReference,
    description,evidence_reference:evidenceReference,entry_date:entryDate,currency,
    total_minor:debit,lines});
}

function pgDate(value){return value instanceof Date?value.toISOString().slice(0,10):String(value||"").slice(0,10);}

function toNumber(value){
  const n=Number(value||0);
  if(!Number.isSafeInteger(n))throw failure(503,"DIRECT_SVA_AMOUNT_OUT_OF_RANGE");
  return n;
}

export async function directSvaBusinessSnapshot(store,params={}){
  requirePostgres(store);
  const month=validDirectSvaMonth(params.month);
  const [year,mm]=month.split("-").map(Number);
  const from=new Date(Date.UTC(year,mm-1,1)).toISOString().slice(0,10);
  const to=new Date(Date.UTC(year,mm,1)).toISOString().slice(0,10);
  const historyFrom=new Date(Date.UTC(year,mm-12,1)).toISOString().slice(0,10);
  const query=store.readSql;
  const [controls,blocks,inventory,interconnections,accounting,accounts,entries,trends,periods,historyCount]=await Promise.all([
    query.unsafe("SELECT operator_mode,number_activation_enabled,payouts_enabled FROM direct_sva_operator_controls WHERE id=1"),
    query.unsafe("SELECT allocation_status,count(*)::int AS count,coalesce(sum(expected_capacity),0)::bigint AS capacity FROM direct_sva_number_blocks GROUP BY allocation_status ORDER BY allocation_status"),
    query.unsafe("SELECT number_status,count(*)::int AS count FROM direct_sva_number_inventory GROUP BY number_status ORDER BY number_status"),
    query.unsafe("SELECT contract_status,count(*)::int AS count FROM direct_sva_interconnections GROUP BY contract_status ORDER BY contract_status"),
    query.unsafe(
      "SELECT count(DISTINCT e.id)::int AS posted_entries,"+
      " coalesce(sum(CASE WHEN l.account_code='706100' THEN l.credit_minor-l.debit_minor ELSE 0 END),0)::bigint AS revenue_minor,"+
      " coalesce(sum(CASE WHEN a.account_kind='expense' THEN l.debit_minor-l.credit_minor ELSE 0 END),0)::bigint AS expenses_minor,"+
      " coalesce(sum(CASE WHEN l.account_code='411100' THEN l.debit_minor-l.credit_minor ELSE 0 END),0)::bigint AS receivables_change_minor,"+
      " coalesce(sum(CASE WHEN l.account_code='467200' THEN l.credit_minor-l.debit_minor ELSE 0 END),0)::bigint AS publisher_liabilities_change_minor,"+
      " coalesce(sum(CASE WHEN l.account_code='471290' THEN l.debit_minor-l.credit_minor ELSE 0 END),0)::bigint AS suspense_change_minor"+
      " FROM direct_sva_journal_entries e"+
      " JOIN direct_sva_journal_lines l ON l.entry_id=e.id"+
      " JOIN direct_sva_account_catalog a ON a.account_code=l.account_code"+
      " WHERE e.status='posted' AND e.entry_date>=$1::date AND e.entry_date<$2::date",[from,to]
    ),
    query.unsafe("SELECT account_code,account_label,account_kind,requires_expert_review FROM direct_sva_account_catalog WHERE active=true ORDER BY account_code"),
    query.unsafe("SELECT e.id,e.entry_date,e.currency,e.source_reference,e.description,e.status,e.evidence_reference,e.created_at,e.posted_at,"+
      " count(l.id)::int AS line_count,coalesce(sum(l.debit_minor),0)::bigint AS total_debit_minor,coalesce(sum(l.credit_minor),0)::bigint AS total_credit_minor"+
      " FROM direct_sva_journal_entries e LEFT JOIN direct_sva_journal_lines l ON l.entry_id=e.id"+
      " WHERE e.entry_date>=$1::date AND e.entry_date<$2::date GROUP BY e.id ORDER BY e.entry_date DESC,e.id DESC LIMIT 100",[from,to]),
    query.unsafe("SELECT to_char(date_trunc('month',e.entry_date),'YYYY-MM') AS month,"+
      " coalesce(sum(CASE WHEN l.account_code='706100' THEN l.credit_minor-l.debit_minor ELSE 0 END),0)::bigint AS revenue_minor,"+
      " coalesce(sum(CASE WHEN a.account_kind='expense' THEN l.debit_minor-l.credit_minor ELSE 0 END),0)::bigint AS expenses_minor"+
      " FROM direct_sva_journal_entries e JOIN direct_sva_journal_lines l ON l.entry_id=e.id"+
      " JOIN direct_sva_account_catalog a ON a.account_code=l.account_code"+
      " WHERE e.status='posted' AND e.entry_date>=$1::date AND e.entry_date<$2::date"+
      " GROUP BY date_trunc('month',e.entry_date) ORDER BY month",[historyFrom,to]),
    query.unsafe("SELECT period_key,state,closed_at FROM direct_sva_accounting_periods WHERE period_key=$1",[month]),
    query.unsafe("SELECT count(*)::int AS count FROM direct_sva_journal_entries WHERE status='draft' AND entry_date>=$1::date AND entry_date<$2::date",[from,to])
  ]);
  const stats=accounting[0]||{},revenue=toNumber(stats.revenue_minor),expenses=toNumber(stats.expenses_minor);
  const control=controls[0]||{};
  return {
    schema_version:"pgi-direct-sva-business/1",
    business_unit:"direct_sva",
    separated_from:"audiotel_platform",
    report_type:"pre_accounting_operational",
    source:"independent_direct_sva_tables",
    generated_at:new Date().toISOString(),
    month,currency:"EUR",
    activation_authorized:false,payout_authorized:false,
    operator_mode:control.operator_mode||"preparation",
    number_activation_enabled:false,automatic_payout_enabled:false,
    number_blocks:blocks.map(row=>({status:row.allocation_status,count:Number(row.count),capacity:toNumber(row.capacity)})),
    number_inventory:inventory.map(row=>({status:row.number_status,count:Number(row.count)})),
    interconnections:interconnections.map(row=>({status:row.contract_status,count:Number(row.count)})),
    accounting:{
      posted_entries:Number(stats.posted_entries||0),draft_entries:Number(historyCount[0]?.count||0),
      revenue_minor:revenue,expenses_minor:expenses,operating_result_minor:revenue-expenses,
      receivables_change_minor:toNumber(stats.receivables_change_minor),
      publisher_liabilities_change_minor:toNumber(stats.publisher_liabilities_change_minor),
      suspense_change_minor:toNumber(stats.suspense_change_minor),
      tax_treatment:"not_determined",
      legal_fec_status:"not_integrated",
      period_status:periods[0]?.state||"open",
      accounts:accounts.map(a=>({code:a.account_code,label:a.account_label,kind:a.account_kind,expert_review_required:a.requires_expert_review})),
      entries:entries.map(e=>({id:Number(e.id),date:pgDate(e.entry_date),currency:e.currency,
        source_reference:e.source_reference,description:e.description,status:e.status,evidence_reference:e.evidence_reference,
        line_count:Number(e.line_count),debit_minor:toNumber(e.total_debit_minor),credit_minor:toNumber(e.total_credit_minor),posted_at:e.posted_at})),
      trend:trends.map(t=>({month:t.month,revenue_minor:toNumber(t.revenue_minor),expenses_minor:toNumber(t.expenses_minor)}))
    },
    notes:[
      "Les donnees proviennent exclusivement du sous-journal de l'activite distributeur direct.",
      "Aucun montant Audiotel existant n'entre dans ce calcul.",
      "Montants comptables HT ou TTC non qualifies fiscalement. Ne jamais assimiler ce rapport a une liasse fiscale ou un FEC.",
      "Le statut preparation ne donne aucun droit d'attribution ou de paiement."
    ]
  };
}

// Complete bounded management export of the direct SVA subledger.
// Unlike the cockpit preview (100 latest entries), this includes every line for the month.
// It is NOT a legal FEC, nor evidence of collected money.
export async function directSvaAccountingExport(store,params={}){
 requirePostgres(store);
 const month=validDirectSvaMonth(params.month);
 const [year,mm]=month.split("-").map(Number);
 const from=new Date(Date.UTC(year,mm-1,1)).toISOString().slice(0,10);
 const to=new Date(Date.UTC(year,mm,1)).toISOString().slice(0,10);
 const maxRows=20000;
 const rows=await store.readSql.unsafe(
  "SELECT e.id AS journal_entry_id,e.entry_date,e.source_reference,e.description,e.status,e.evidence_reference,"+
  " e.source_system,e.source_digest,l.line_no,l.account_code,l.label AS line_label,l.debit_minor,l.credit_minor"+
  " FROM direct_sva_journal_entries e JOIN direct_sva_journal_lines l ON l.entry_id=e.id"+
  " WHERE e.business_unit='direct_sva' AND e.entry_date>=$1::date AND e.entry_date<$2::date"+
  " ORDER BY e.entry_date,e.id,l.line_no LIMIT $3",[from,to,maxRows+1]
 );
 if(rows.length>maxRows)throw failure(413,"DIRECT_SVA_EXPORT_TOO_LARGE_SPLIT_PERIOD");
 const normal=rows.map(row=>({
  journal_entry_id:toNumber(row.journal_entry_id),
  entry_date:pgDate(row.entry_date),
  source_reference:String(row.source_reference),
  source_system:String(row.source_system),
  source_digest:String(row.source_digest),
  description:String(row.description),
  status:String(row.status),
  evidence_reference:String(row.evidence_reference),
  line_no:Number(row.line_no),
  account_code:String(row.account_code),
  line_label:String(row.line_label),
  debit_minor:toNumber(row.debit_minor),
  credit_minor:toNumber(row.credit_minor)
 }));
 const grouped=new Map();
 for(const row of normal){
  const current=grouped.get(row.journal_entry_id)||{debit:0,credit:0};
  current.debit+=row.debit_minor;current.credit+=row.credit_minor;
  if(!Number.isSafeInteger(current.debit)||!Number.isSafeInteger(current.credit))throw failure(503,"DIRECT_SVA_EXPORT_AMOUNT_OVERFLOW");
  grouped.set(row.journal_entry_id,current);
 }
 for(const total of grouped.values()){
  if(total.debit<=0||total.debit!==total.credit)throw failure(409,"DIRECT_SVA_EXPORT_CONTAINS_UNBALANCED_ENTRIES");
 }
 return Object.freeze({
  schema_version:"pgi-direct-sva-accounting-export/1",
  business_unit:"direct_sva",
  document_type:"management_subledger_not_legal_fec",
  month,currency:"EUR",
  exported_lines:normal.length,exported_entries:grouped.size,
  complete_for_period:true,
  source:"direct_sva_journal_entries_and_lines_only",
  rows:normal
 });
}

export async function createDirectSvaDraft(store,payload,actor){
  requirePostgres(store);
  const createdBy=actorId(actor),draft=normalizeDirectSvaJournalDraft(payload);
  return store.sql.begin(async tx=>{
    const codes=[...new Set(draft.lines.map(x=>x.account_code))];
    const found=await tx.unsafe("SELECT account_code FROM direct_sva_account_catalog WHERE active=true AND account_code=ANY($1::text[])",[codes]);
    if(found.length!==codes.length)throw failure(400,"DIRECT_SVA_UNKNOWN_ACCOUNT");
    const period=await tx.unsafe("SELECT state FROM direct_sva_accounting_periods WHERE period_key=$1",[draft.entry_date.slice(0,7)]);
    if(period[0]?.state==="closed")throw failure(409,"DIRECT_SVA_PERIOD_CLOSED");
    const sourceDigest=createHash("sha256").update(JSON.stringify(draft)).digest("hex");
    const [entry]=await tx.unsafe(
      "INSERT INTO direct_sva_journal_entries(source_system,source_reference,entry_date,currency,description,evidence_reference,source_digest,created_by)"+
      " VALUES($1,$2,$3::date,$4,$5,$6,$7,$8) RETURNING id,status",
      [draft.source_system,draft.source_reference,draft.entry_date,draft.currency,draft.description,draft.evidence_reference,sourceDigest,createdBy]
    );
    for(const line of draft.lines){
      await tx.unsafe("INSERT INTO direct_sva_journal_lines(entry_id,line_no,account_code,label,debit_minor,credit_minor)"+
        " VALUES($1,$2,$3,$4,$5,$6)",[entry.id,line.line_no,line.account_code,line.label,line.debit_minor,line.credit_minor]);
    }
    await tx.unsafe("INSERT INTO direct_sva_journal_audit(journal_entry_id,event,actor_user_id,evidence_reference)"+
      " VALUES($1,'draft_created',$2,$3)",[entry.id,createdBy,draft.evidence_reference]);
    return {id:Number(entry.id),business_unit:"direct_sva",status:"draft",total_minor:draft.total_minor,
      activation_authorized:false,payout_authorized:false};
  });
}

export async function approveDirectSvaDraft(store,entryId,actor,payload={}){
  requirePostgres(store);
  const approvedBy=actorId(actor),id=Number(entryId);
  const approvalEvidence=String(payload.approval_evidence||"").trim();
  if(!Number.isSafeInteger(id)||id<1)throw failure(400,"DIRECT_SVA_ENTRY_ID_INVALID");
  if(approvalEvidence.length<6||approvalEvidence.length>240)throw failure(400,"DIRECT_SVA_APPROVAL_EVIDENCE_REQUIRED");
  return store.sql.begin(async tx=>{
    const [entry]=await tx.unsafe("SELECT id,status,created_by,entry_date FROM direct_sva_journal_entries WHERE id=$1 FOR UPDATE",[id]);
    if(!entry)throw failure(404,"DIRECT_SVA_ENTRY_NOT_FOUND");
    if(entry.status!=="draft")throw failure(409,"DIRECT_SVA_ALREADY_POSTED");
    if(Number(entry.created_by)===approvedBy)throw failure(403,"DIRECT_SVA_TWO_PERSON_APPROVAL_REQUIRED");
    const [posted]=await tx.unsafe("UPDATE direct_sva_journal_entries SET status='posted',approved_by=$1,posted_at=now() WHERE id=$2 RETURNING id,status,posted_at",[approvedBy,id]);
    await tx.unsafe("INSERT INTO direct_sva_journal_audit(journal_entry_id,event,actor_user_id,evidence_reference) VALUES($1,'posted',$2,$3)",[id,approvedBy,approvalEvidence]);
    return {id:Number(posted.id),business_unit:"direct_sva",status:"posted",posted_at:posted.posted_at,
      activation_authorized:false,payout_authorized:false};
  });
}
