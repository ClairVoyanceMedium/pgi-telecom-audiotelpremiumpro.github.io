export const RELATION_POLICY_VERSION="customer-relations/1";

const POLICIES=Object.freeze({
  collect_evidence:{risk_class:"low",execution_mode:"automatic"},
  reconcile_billing:{risk_class:"low",execution_mode:"automatic"},
  draft_response:{risk_class:"low",execution_mode:"automatic"},
  request_customer_info:{risk_class:"low",execution_mode:"automatic"},
  place_dispute_hold:{risk_class:"medium",execution_mode:"automatic"},
  release_dispute_hold:{risk_class:"medium",execution_mode:"approval_required"},
  propose_credit:{risk_class:"medium",execution_mode:"automatic"},
  issue_credit:{risk_class:"high",execution_mode:"approval_required"},
  propose_refund:{risk_class:"medium",execution_mode:"automatic"},
  issue_refund:{risk_class:"high",execution_mode:"approval_required"},
  prepare_exit:{risk_class:"low",execution_mode:"automatic"},
  check_portability:{risk_class:"low",execution_mode:"automatic"},
  submit_port_out:{risk_class:"high",execution_mode:"external_confirmation"},
  schedule_exit:{risk_class:"high",execution_mode:"customer_confirmation"},
  generate_data_export:{risk_class:"low",execution_mode:"automatic"},
  cancel_subscription:{risk_class:"high",execution_mode:"customer_confirmation"},
  release_number:{risk_class:"irreversible",execution_mode:"customer_confirmation"},
  revoke_access:{risk_class:"irreversible",execution_mode:"external_confirmation"},
  resolve_case:{risk_class:"medium",execution_mode:"approval_required"},
  close_case:{risk_class:"medium",execution_mode:"approval_required"}
});

export function relationActionPolicy(actionType){
  const key=String(actionType||"").trim().toLowerCase();
  const policy=POLICIES[key];
  if(!policy){const e=new Error("INVALID_RELATION_ACTION");e.status=400;e.code="INVALID_RELATION_ACTION";throw e;}
  return {action_type:key,...policy,policy_version:RELATION_POLICY_VERSION};
}

export function relationCaseDeadlines(kind,priority,capacity,from=new Date()){
  const p=String(priority||"normal").toLowerCase();
  const responseHours={low:48,normal:24,high:8,critical:2}[p]||24;
  const resolutionDays={low:20,normal:10,high:5,critical:2}[p]||10;
  const start=from instanceof Date?from:new Date(from);
  const first=new Date(start.getTime()+responseHours*3600000);
  const target=new Date(start.getTime()+resolutionDays*86400000);
  const mediation=String(capacity||"unknown")==="consumer"?new Date(start.setMonth(start.getMonth()+2)):null;
  return {first_response_due_at:first.toISOString(),target_resolution_at:target.toISOString(),mediation_eligible_at:mediation?mediation.toISOString():null};
}

export function relationNextActions(c={},exitRequest=null){
  const kind=String(c.case_kind||"other");
  const actions=[];
  if(["billing_dispute","payout_dispute"].includes(kind)){
    actions.push("collect_evidence","reconcile_billing");
    if(Number(c.disputed_amount)>0)actions.push("place_dispute_hold");
    actions.push("draft_response");
  }else if(["contract_termination","port_out"].includes(kind)){
    actions.push("prepare_exit","generate_data_export");
    if(kind==="port_out"||exitRequest?.port_out_requested)actions.push("check_portability");
    actions.push("draft_response");
  }else{
    actions.push("collect_evidence","draft_response");
  }
  return [...new Set(actions)].map(relationActionPolicy);
}

export function safeAgentContext(c={},evidence=[],actions=[],exitRequest=null){
  return {
    policy_version:RELATION_POLICY_VERSION,
    case:{
      public_id:c.public_id||null,case_kind:c.case_kind||null,status:c.status||null,priority:c.priority||null,
      customer_capacity:c.customer_capacity||"unknown",title:c.title||"",description:c.description||"",
      disputed_amount:c.disputed_amount==null?null:Number(c.disputed_amount),disputed_currency:c.disputed_currency||null,
      invoice_reference:c.invoice_reference||null,payment_reference:c.payment_reference||null,
      disputed_period_start:c.disputed_period_start||null,disputed_period_end:c.disputed_period_end||null,
      requested_resolution:c.requested_resolution||null,formal_complaint_at:c.formal_complaint_at||null,
      mediation_eligible_at:c.mediation_eligible_at||null,first_response_due_at:c.first_response_due_at||null,
      target_resolution_at:c.target_resolution_at||null
    },
    evidence:(evidence||[]).map(x=>({id:x.id,evidence_kind:x.evidence_kind,source_table:x.source_table,source_id:x.source_id,external_reference:x.external_reference,content_sha256:x.content_sha256,created_at:x.created_at})),
    actions:(actions||[]).map(x=>({public_id:x.public_id,action_type:x.action_type,risk_class:x.risk_class,execution_mode:x.execution_mode,status:x.status,confidence:x.confidence,explanation:x.explanation,created_at:x.created_at})),
    exit_request:exitRequest?{
      public_id:exitRequest.public_id,status:exitRequest.status,exit_scope:exitRequest.exit_scope,
      number_retention_preference:exitRequest.number_retention_preference,port_out_requested:Boolean(exitRequest.port_out_requested),
      requested_effective_date:exitRequest.requested_effective_date,final_invoice_status:exitRequest.final_invoice_status,
      final_settlement_status:exitRequest.final_settlement_status,data_export_status:exitRequest.data_export_status
    }:null,
    guardrails:{
      authoritative_facts_only:true,
      no_money_movement_without_approval:true,
      no_permanent_number_release_without_customer_confirmation:true,
      no_port_out_completion_without_operator_confirmation:true,
      no_access_revocation_before_safe_exit:true,
      do_not_use_rio_request_for_retention_marketing:true,
      raw_rio_or_credentials_forbidden:true,
      card_data_forbidden:true
    }
  };
}
