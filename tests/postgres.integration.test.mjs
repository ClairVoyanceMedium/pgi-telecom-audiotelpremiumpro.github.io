import test from "node:test";
import assert from "node:assert/strict";
import {EventBus} from "../backend/src/event-bus.mjs";
import {PostgresStore} from "../backend/src/store-postgres.mjs";

const url=process.env.PGI_TEST_DATABASE_URL;
const run=Boolean(url);

function config(){
  return {
    mode:"production",databaseUrl:url,databasePoolMax:4,databaseSsl:"disable",
    callerHashKey:"k".repeat(32),requireCarrierContract:true,
    serviceRateTtcPerMin:.8,payoutRateHtPerMin:.46,expertCostHtPerMin:.18,
    reconciliationToleranceHt:.01
  };
}

test("PostgresStore performs real ingest summary and routing", {skip:!run}, async()=>{
  const bus=new EventBus();
  const store=await PostgresStore.connect(config(),bus);
  try{
    await store.sql.unsafe("TRUNCATE TABLE tenant_consumption_receipts,tenant_relation_actions,tenant_exit_lines,tenant_exit_requests,tenant_dispute_collection_holds,tenant_relation_evidence,tenant_relation_case_events,tenant_relation_cases,tenant_internal_notes,sva_ecosystem_evidence_events,sva_ecosystem_control_states,sva_tariff_change_plans,sva_service_compliance_profiles,platform_change_approval_events,platform_change_requests,settlement_call_matches,carrier_settlements,call_quality,financial_ledger,outbox_events,raw_cdr_events,calls,tenant_call_destinations,callers,expert_presence_events,metric_baselines,carrier_switches,number_carrier_assignments,carrier_connections,carrier_adapters,carrier_contracts,number_portability_events,sva_numbers,carriers,audit_log,api_idempotency_keys RESTART IDENTITY CASCADE");
    await store.sql.unsafe("UPDATE app_users SET expert_id=NULL; DELETE FROM experts");
    await store.sql.unsafe("INSERT INTO carriers(name,kind) VALUES('Host A','sva_host'),('Host B','sva_host')");
    await store.sql.unsafe("INSERT INTO logical_carrier_routes(route_key,description) VALUES('sva-primary','Integration test route')");
    await store.sql.unsafe("INSERT INTO sva_numbers(e164,display_number,tariff_code,service_rate_ttc_per_min,status,tenant_id,market_id,currency) SELECT '33890000000','0890 00 00 00','D080',0.8,'active',t.id,m.id,'EUR' FROM tenants t CROSS JOIN operating_markets m WHERE t.slug='pgi-internal' AND m.country_code='FR'");
    await store.sql.unsafe("INSERT INTO carrier_contracts(carrier_id,sva_number_id,valid_from,payout_rate_ht_per_min,mobile_deduction_ht_per_min,minimum_payable_seconds,billing_increment_seconds,payout_rounding) SELECT c.id,s.id,'2026-01-01',0.55,0.05,60,30,'floor' FROM carriers c CROSS JOIN sva_numbers s WHERE c.name='Host A' AND s.e164='33890000000'");
    await store.sql.unsafe("INSERT INTO experts(code,display_name,destination_uri,status,compensation_type,compensation_rate,tenant_id) SELECT 'E1','Expert 1','loopback/9101','available','per_minute',0.18,id FROM tenants WHERE slug='pgi-internal'");
    await store.sql.unsafe("INSERT INTO carrier_connections(carrier_id,connection_name,purpose,state,transport,endpoint_host,endpoint_port,auth_mode) SELECT id,'primary','sip_inbound','ready','udp','192.0.2.10',5060,'ip_acl' FROM carriers WHERE name='Host A'");
    await store.sql.unsafe("INSERT INTO carrier_connections(carrier_id,connection_name,purpose,state,transport,endpoint_host,endpoint_port,auth_mode) SELECT id,'standby','sip_inbound','standby','udp','192.0.2.11',5060,'ip_acl' FROM carriers WHERE name='Host B'");
    await store.sql.unsafe("SELECT activate_logical_carrier_route('sva-primary',(SELECT id FROM carriers WHERE name='Host A'),(SELECT id FROM carrier_connections WHERE connection_name='primary'))");

    await store.sql.unsafe("INSERT INTO tenants(slug,display_name,legal_name,tenant_type,status,country_code,billing_email) VALUES('integration-external','External Test','External Test','customer','active','FR','billing@example.test')");
    await store.sql.unsafe("INSERT INTO tenant_market_profiles(tenant_id,market_id,status,preferred_locale,billing_currency,timezone,compliance_status,data_residency_region) SELECT t.id,m.id,'active','fr-FR','EUR','Europe/Paris','verified','eu' FROM tenants t CROSS JOIN operating_markets m WHERE t.slug='integration-external' AND m.country_code='FR'");
    await store.sql.unsafe("INSERT INTO sva_numbers(e164,display_number,tariff_code,service_rate_ttc_per_min,status,tenant_id,market_id,currency) SELECT '33890000001','0890 00 00 01','D080',0.8,'active',t.id,m.id,'EUR' FROM tenants t CROSS JOIN operating_markets m WHERE t.slug='integration-external' AND m.country_code='FR'");
    await store.sql.unsafe("INSERT INTO experts(code,display_name,destination_uri,status,compensation_type,compensation_rate,tenant_id) SELECT 'EXT1','External Expert','loopback/9201','available','per_minute',0.18,id FROM tenants WHERE slug='integration-external'");

    const internalAccess=await store.sql.unsafe("SELECT pgi_tenant_has_premium_call_access(t.id,m.id,now()) AS allowed FROM tenants t CROSS JOIN operating_markets m WHERE t.slug='pgi-internal' AND m.country_code='FR'");
    assert.equal(internalAccess[0].allowed,true);

    const billingBefore=await store.subscriptionBillingOverview();
    assert.equal(Number(billingBefore.current_price.amount_minor),300);
    assert.equal(billingBefore.current_price.currency,"EUR");
    assert.equal(billingBefore.internal_usage_exempt,true);
    assert.equal(billingBefore.summary.access_blocked,1);

    const usTenant=await store.createTenant({display_name:"US Currency Test",legal_name:"US Currency Test",tenant_type:"customer",country_code:"US",billing_email:"usd@example.test"},{sub:"admin"});
    const usStored=(await store.sql.unsafe("SELECT id,default_currency FROM tenants WHERE public_id=$1::uuid",[usTenant.public_id]))[0];
    assert.equal(usStored.default_currency,"USD");
    const usBilling=await store.customerBillingPreparation(usStored.id);
    assert.equal(usBilling.billing_currency.currency,"USD");
    assert.equal(usBilling.checkout_prefill.currency,"USD");
    assert.equal(usBilling.offer,null);
    assert.equal(usBilling.pricing_state,"local_conversion_required");
    assert.equal(usBilling.reference_offer.currency,"EUR");

    await assert.rejects(
      ()=>store.selectExpert({svaNumber:"33890000001"}),
      error=>error.status===402&&error.code==="SVA_SUBSCRIPTION_REQUIRED"
    );
    await assert.rejects(
      ()=>store.sql.unsafe("INSERT INTO tenant_number_assignments(tenant_id,sva_number_id,assignment_type,status,valid_from) SELECT t.id,s.id,'customer_service','active',now() FROM tenants t CROSS JOIN sva_numbers s WHERE t.slug='integration-external' AND s.e164='33890000001'"),
      /active paid subscription required/
    );

    const externalIdentity=await store.sql.unsafe("SELECT public_id::text AS public_id FROM tenants WHERE slug='integration-external'");
    const priceId=Number(billingBefore.current_price.id);
    const now=new Date();
    const periodEnd=new Date(now.getTime()+31*86400000);
    const billingEvent={
      provider:"testpay",provider_event_id:"sub-paid-1",tenant_public_id:externalIdentity[0].public_id,
      provider_customer_reference:"cus-test-1",provider_subscription_reference:"sub-test-1",
      event_type:"subscription.paid",status:"active",event_time:now.toISOString(),
      current_period_start:now.toISOString(),current_period_end:periodEnd.toISOString(),
      price_version_id:priceId,last_payment_status:"paid"
    };
    const applied=await store.applySubscriptionBillingEvent(billingEvent);
    assert.equal(applied.duplicate,false);
    assert.equal(applied.status,"active");
    const duplicateBilling=await store.applySubscriptionBillingEvent(billingEvent);
    assert.equal(duplicateBilling.duplicate,true);

    await assert.rejects(
      ()=>store.applySubscriptionBillingEvent({...billingEvent,status:"past_due",last_payment_status:"failed"}),
      error=>error.status===409&&error.code==="BILLING_EVENT_ID_COLLISION"
    );
    await store.sql.unsafe("INSERT INTO tenants(slug,display_name,legal_name,tenant_type,status,country_code,billing_email) VALUES('integration-external-2','External Test 2','External Test 2','customer','active','FR','billing2@example.test')");
    const externalIdentity2=await store.sql.unsafe("SELECT public_id::text AS public_id FROM tenants WHERE slug='integration-external-2'");
    await assert.rejects(
      ()=>store.applySubscriptionBillingEvent({...billingEvent,provider_event_id:"sub-wrong-tenant-1",tenant_public_id:externalIdentity2[0].public_id}),
      error=>error.status===409&&error.code==="BILLING_SUBSCRIPTION_TENANT_MISMATCH"
    );
    const billingPrep=await store.customerBillingPreparation((await store.sql.unsafe("SELECT id FROM tenants WHERE slug='integration-external'"))[0].id);
    assert.equal(Number(billingPrep.offer.amount_minor),300);
    assert.equal(billingPrep.offer.tax_behavior,"inclusive");
    assert.equal(billingPrep.reference_offer.tax_behavior,"inclusive");
    assert.equal(billingPrep.checkout_prefill.email,"billing@example.test");
    assert.equal(billingPrep.return_paths.success,"client.html?billing=success");

    await assert.rejects(
      ()=>store.sql.unsafe("INSERT INTO tenant_number_assignments(tenant_id,sva_number_id,assignment_type,status,valid_from) SELECT t.id,s.id,'customer_service','active',now() FROM tenants t CROSS JOIN sva_numbers s WHERE t.slug='integration-external' AND s.e164='33890000001'"),
      /active external SVA assignment requires PGI payout terms/
    );

    const payoutTerms=await store.createTenantPayoutTerms(externalIdentity[0].public_id,{platform_fee_percent:20,payout_delay_days:7},{sub:"admin"});
    assert.equal(Number(payoutTerms.platform_fee_bps),2000);
    assert.equal(payoutTerms.collection_model,"pgi_collects");

    await assert.rejects(
      ()=>store.sql.unsafe("INSERT INTO tenant_number_assignments(tenant_id,sva_number_id,assignment_type,status,valid_from,regulatory_assignor_carrier_id,upstream_assignment_reference) SELECT t.id,s.id,'customer_service','active',now(),c.id,'integration-upstream-001' FROM tenants t CROSS JOIN sva_numbers s CROSS JOIN carriers c WHERE t.slug='integration-external' AND s.e164='33890000001' AND c.name='Host A'"),
      /verified regulatory trust profile required/
    );

    await store.sql.unsafe("INSERT INTO tenant_kyc_profiles(tenant_id,entity_type,registration_country,registration_number,legal_representative_verified,bank_account_verified,status,reviewed_at) SELECT id,'company','FR','12345678901234',true,true,'verified',now() FROM tenants WHERE slug='integration-external' ON CONFLICT(tenant_id) DO UPDATE SET legal_representative_verified=true,bank_account_verified=true,status='verified',reviewed_at=now()");
    await store.sql.unsafe("INSERT INTO sva_regulatory_profiles(tenant_id,sva_number_id,service_name,service_description,provider_name,provider_website,provider_address,complaint_contact,signaletic_model,next_review_at) SELECT t.id,s.id,'Service intégration','Service SVA de test de conformité','External Test','https://example.test','1 rue de Test, 75001 Paris','complaints@example.test','majorated',now()+interval '1 year' FROM tenants t CROSS JOIN sva_numbers s WHERE t.slug='integration-external' AND s.e164='33890000001' ON CONFLICT(tenant_id,sva_number_id) DO UPDATE SET service_name=EXCLUDED.service_name,service_description=EXCLUDED.service_description,provider_name=EXCLUDED.provider_name,provider_website=EXCLUDED.provider_website,provider_address=EXCLUDED.provider_address,complaint_contact=EXCLUDED.complaint_contact,signaletic_model=EXCLUDED.signaletic_model,next_review_at=EXCLUDED.next_review_at");
    for(const control of ["numbering_rights","editor_identity","rsva","tariff_transparency","mgit","complaint_process","fraud_monitoring"]){
      await store.sql.unsafe("INSERT INTO sva_regulatory_evidence_events(tenant_id,sva_number_id,control_key,status,source,evidence_reference,actor_subject) SELECT t.id,s.id,$1,'verified','internal',$2,'integration-test' FROM tenants t CROSS JOIN sva_numbers s WHERE t.slug='integration-external' AND s.e164='33890000001'",[control,"integration:"+control]);
    }
    const regulatoryReady=await store.sql.unsafe("SELECT pgi_sva_regulatory_ready(t.id,s.id) AS ready FROM tenants t CROSS JOIN sva_numbers s WHERE t.slug='integration-external' AND s.e164='33890000001'");
    assert.equal(regulatoryReady[0].ready,true);
    const regulatoryLedger=await store.sql.unsafe("SELECT control_key,previous_hash,event_hash FROM sva_regulatory_evidence_events WHERE tenant_id=(SELECT id FROM tenants WHERE slug='integration-external') ORDER BY id");
    assert.equal(regulatoryLedger.length,7);
    assert.equal(regulatoryLedger[0].previous_hash,null);
    assert.match(regulatoryLedger[0].event_hash,/^[0-9a-f]{64}$/);
    assert.match(regulatoryLedger[1].previous_hash,/^[0-9a-f]{64}$/);

    await store.sql.unsafe("INSERT INTO tenant_number_assignments(tenant_id,sva_number_id,assignment_type,status,valid_from,regulatory_assignor_carrier_id,upstream_assignment_reference) SELECT t.id,s.id,'customer_service','testing',now(),c.id,'integration-upstream-001' FROM tenants t CROSS JOIN sva_numbers s CROSS JOIN carriers c WHERE t.slug='integration-external' AND s.e164='33890000001' AND c.name='Host A'");
    const extAssignmentForRoute=await store.sql.unsafe("SELECT id FROM tenant_number_assignments WHERE tenant_id=(SELECT id FROM tenants WHERE slug='integration-external') AND sva_number_id=(SELECT id FROM sva_numbers WHERE e164='33890000001') LIMIT 1");

    await assert.rejects(
      ()=>store.sql.unsafe("UPDATE tenant_number_assignments SET status='active' WHERE id=$1",[Number(extAssignmentForRoute[0].id)]),
      /verified ARCEP 2026 number-plan guardrails required/
    );
    for(const control of ["exclusive_stable_assignee","single_service","portability_offered","tariff_ceiling","no_temporary_contact_use","public_body_eligibility","caller_id_block","parental_control_classification"]){
      const evidence=await store.recordSvaRegulatoryEvidence(Number(extAssignmentForRoute[0].id),{control_key:control,status:"verified",source:"internal",evidence_reference:"integration:arcep2026:"+control},{sub:"admin"});
      assert.equal(evidence.framework,"arcep_2026");
    }
    const arcepReady=await store.sql.unsafe("SELECT pgi_arcep_2026_number_ready(t.id,s.id) AS ready FROM tenants t CROSS JOIN sva_numbers s WHERE t.slug='integration-external' AND s.e164='33890000001'");
    assert.equal(arcepReady[0].ready,true);

    await assert.rejects(
      ()=>store.sql.unsafe("UPDATE tenant_number_assignments SET status='active' WHERE id=$1",[Number(extAssignmentForRoute[0].id)]),
      /verified SVA ecosystem readiness required/
    );

    const svaProfile=await store.upsertSvaServiceComplianceProfile(Number(extAssignmentForRoute[0].id),{
      service_category:"advice",audience:"consumer",billing_mode:"per_minute",
      max_billable_duration_seconds:1800,monthly_user_cap_ttc:300,
      mgit_required:true,mgit_duration_seconds:15,mgit_tariff_first:true,
      mgit_optout_instruction:true,mgit_no_background_music:true,mgit_beep_before_billing:true,
      privacy_notice_url:"https://example.test/privacy",consumer_contact:"consumer@example.test",
      mediation_reference:"integration:mediation",next_review_at:new Date(Date.now()+365*86400000).toISOString()
    },{sub:"admin"});
    assert.equal(svaProfile.af2m_reference_version,"2026-09-01");
    assert.equal(svaProfile.ecosystem_ready,false);

    const ecosystemControls=await store.sql.unsafe("SELECT control_key FROM sva_ecosystem_control_catalog ORDER BY control_key");
    assert.equal(ecosystemControls.length,21);
    for(const row of ecosystemControls){
      const evidence=await store.recordSvaEcosystemEvidence(Number(extAssignmentForRoute[0].id),{
        control_key:row.control_key,status:"verified",source:"internal",evidence_reference:"integration:sva:"+row.control_key,
        valid_until:new Date(Date.now()+365*86400000).toISOString()
      },{sub:"admin"});
      assert.match(evidence.event.event_hash,/^[0-9a-f]{64}$/);
    }
    const ecosystemReady=await store.sql.unsafe("SELECT pgi_sva_ecosystem_ready(t.id,s.id) AS ready FROM tenants t CROSS JOIN sva_numbers s WHERE t.slug='integration-external' AND s.e164='33890000001'");
    assert.equal(ecosystemReady[0].ready,true);

    const svaCenter=await store.svaComplianceOverview();
    assert.equal(svaCenter.schema_version,"audiotel-sva-compliance/1");
    assert.equal(svaCenter.external_connections_active,false);
    assert.equal(svaCenter.certification_claimed,false);
    assert.ok(svaCenter.frameworks.some(x=>x.framework_key==="af2m_sva_2026"));
    assert.ok(svaCenter.framework_status.some(x=>x.framework_key==="af2m_sva_2026"&&Number(x.ready_total)===Number(x.required_total)));

    const tariffDate=new Date();
    tariffDate.setUTCDate(1);tariffDate.setUTCMonth(tariffDate.getUTCMonth()+2);
    const tariffEffective=tariffDate.toISOString().slice(0,10);
    const tariffPlan=await store.planSvaTariffChange(Number(extAssignmentForRoute[0].id),{
      proposed_tariff_code:"D090",proposed_service_rate_ttc_per_min:0.9,effective_on:tariffEffective,notes:"integration"
    },{sub:"admin"});
    assert.equal(tariffPlan.status,"planned");
    assert.equal(new Date(tariffPlan.effective_on).toISOString().slice(0,10),tariffEffective);

    await store.sql.unsafe("UPDATE tenant_number_assignments SET status='active' WHERE id=$1",[Number(extAssignmentForRoute[0].id)]);

    const accessPolicy=await store.operationalPolicyEvaluation({intent:"customer_access",tenant_public_id:externalIdentity[0].public_id});
    assert.equal(accessPolicy.decision,"ALLOWED");
    assert.equal(accessPolicy.dry_run,true);
    assert.equal(accessPolicy.mutates_state,false);
    const labBefore=await store.performanceResilienceLab();
    assert.equal(labBefore.schema_version,"audiotel-performance-resilience-lab/1");
    assert.equal(labBefore.capacity_proof,"unproven");
    assert.equal(labBefore.preproduction_gate.ready,false);
    assert.ok(labBefore.preproduction_gate.blockers.some(x=>x.code==="LOAD_PROOF_MISSING"));

    const perfStarted=new Date(Date.now()-60000).toISOString(),perfCompleted=new Date().toISOString();
    const perfRun=await store.recordPerformanceLabRun({
      run_type:"load",scenario:"integration-safe-read",target:"https://example.test/api/v1/health?secret=hidden",
      status:"passed",started_at:perfStarted,completed_at:perfCompleted,requests_total:1000,errors_total:0,error_rate:0,
      p50_ms:40,p95_ms:120,p99_ms:180,requests_per_second:50,virtual_users:20,
      thresholds:{p95_ms:500,error_rate:.01},details:{safe:true}
    },{sub:"admin"});
    assert.equal(perfRun.status,"passed");
    assert.equal(perfRun.target,"https://example.test/api/v1/health");
    await store.recordSyntheticProbe({probe_key:"api.health",success:true,latency_ms:32,http_status:200,release_id:"integration"});
    await store.sql.unsafe(
      "INSERT INTO disaster_recovery_drills(drill_type,source_region,target_region,started_at,completed_at,status,observed_rpo_seconds,observed_rto_seconds,evidence_ref) VALUES('restore','eu-primary','eu-primary',now()-interval '2 minutes',now(),'passed',30,90,'integration:restore')"
    );
    const labAfter=await store.performanceResilienceLab();
    assert.equal(labAfter.capacity_proof,"fresh");
    assert.equal(labAfter.load.latest_passed.id,perfRun.id);
    assert.equal(labAfter.synthetic.success_percent,100);
    assert.ok(Number(labAfter.database.connection_headroom_percent)>=0);
    assert.equal(labAfter.disaster_recovery.latest_restore.status,"passed");

    const tower=await store.controlTowerOverview();
    assert.equal(tower.schema_version,"audiotel-control-tower/2");
    assert.equal(tower.assurance.dual_control_required,true);
    assert.equal(tower.assurance.risk.privacy,"aggregate_only");
    assert.ok(Number.isInteger(tower.kpis.risk_score));
    assert.ok(Number.isInteger(tower.kpis.slo_score));
    assert.ok(Number.isInteger(tower.readiness_score));
    assert.ok(["healthy","attention","critical"].includes(tower.status));
    const twin=await store.digitalTwinSimulation({scenario:"traffic_spike",parameters:{multiplier:3}});
    assert.equal(twin.schema_version,"audiotel-digital-twin/2");
    assert.equal(twin.dry_run,true);
    assert.equal(twin.mutates_state,false);

    const evidencePack=await store.regulatoryEvidencePack(Number(extAssignmentForRoute[0].id),{sub:"admin"});
    assert.equal(evidencePack.assignment.regulatory_ready,true);
    assert.equal(evidencePack.assignment.arcep_2026_ready,true);
    assert.equal(evidencePack.assignment.sva_ecosystem_ready,true);
    assert.equal(evidencePack.assignment.activation_ready,true);
    assert.equal(evidencePack.evidence_ledger.length,7);
    assert.equal(evidencePack.arcep_2026_evidence_ledger.length,8);
    assert.equal(evidencePack.sva_ecosystem_evidence_ledger.length,21);
    assert.equal(evidencePack.sva_tariff_change_plans.length,1);
    assert.equal(evidencePack.integrity.evidence_links_valid,true);
    assert.equal(evidencePack.integrity.arcep_2026_links_valid,true);
    assert.equal(evidencePack.integrity.ecosystem_links_valid,true);
    assert.match(evidencePack.integrity.pack_sha256,/^[0-9a-f]{64}$/);
    assert.match(evidencePack.integrity.evidence_chain_head,/^[0-9a-f]{64}$/);
    assert.match(evidencePack.integrity.arcep_2026_chain_head,/^[0-9a-f]{64}$/);
    assert.match(evidencePack.integrity.ecosystem_chain_head,/^[0-9a-f]{64}$/);
    assert.equal(evidencePack.privacy.raw_rio_included,false);
    const packRegister=await store.sql.unsafe("SELECT public_id::text AS public_id,pack_sha256,evidence_links_valid,evidence_events,arcep_2026_chain_head,arcep_2026_links_valid,arcep_2026_evidence_events,ecosystem_chain_head,ecosystem_links_valid,ecosystem_evidence_events FROM sva_regulatory_evidence_pack_exports WHERE assignment_id=$1 ORDER BY id DESC LIMIT 1",[Number(extAssignmentForRoute[0].id)]);
    assert.equal(packRegister[0].public_id,evidencePack.integrity.export_id);
    assert.equal(packRegister[0].pack_sha256,evidencePack.integrity.pack_sha256);
    assert.equal(packRegister[0].evidence_links_valid,true);
    assert.equal(packRegister[0].arcep_2026_links_valid,true);
    assert.equal(packRegister[0].ecosystem_links_valid,true);
    assert.match(packRegister[0].arcep_2026_chain_head,/^[0-9a-f]{64}$/);
    assert.match(packRegister[0].ecosystem_chain_head,/^[0-9a-f]{64}$/);
    assert.equal(Number(packRegister[0].evidence_events),36);
    assert.equal(Number(packRegister[0].arcep_2026_evidence_events),8);
    assert.equal(Number(packRegister[0].ecosystem_evidence_events),21);
    const packAudit=await store.sql.unsafe("SELECT details->>'export_public_id' AS export_public_id FROM audit_log WHERE action='regulatory.evidence_pack.export' AND entity_id=$1 ORDER BY id DESC LIMIT 1",[String(extAssignmentForRoute[0].id)]);
    assert.equal(packAudit[0].export_public_id,evidencePack.integrity.export_id);
    const dueSoon=new Date(Date.now()+12*3600000).toISOString();
    const dueEvidence=await store.recordSvaRegulatoryEvidence(Number(extAssignmentForRoute[0].id),{control_key:"single_service",status:"verified",source:"internal",evidence_reference:"integration:review-due",next_review_at:dueSoon},{sub:"admin"});
    assert.equal(dueEvidence.framework,"arcep_2026");
    assert.ok(Math.abs(Date.parse(dueEvidence.profile.next_review_at)-Date.parse(dueSoon))<1000);
    const regulatoryAlerts=await store.scanRegulatoryReviews();
    const dueAlert=regulatoryAlerts.find(x=>x.framework==="arcep_2026"&&x.alert_kind==="review_due_today");
    assert.ok(dueAlert);
    assert.equal(dueAlert.state,"open");
    const listedAlerts=await store.listRegulatoryReviewAlerts({state:"unresolved",limit:20});
    assert.ok(listedAlerts.data.some(x=>Number(x.id)===Number(dueAlert.id)&&x.attention_bucket==="today"));
    const acknowledgedReview=await store.acknowledgeRegulatoryReviewAlert(dueAlert.id,{sub:"admin"});
    assert.equal(acknowledgedReview.state,"acknowledged");
    const nextReview=new Date(Date.now()+90*86400000).toISOString();
    await store.recordSvaRegulatoryEvidence(Number(extAssignmentForRoute[0].id),{control_key:"single_service",status:"verified",source:"internal",evidence_reference:"integration:review-extended",next_review_at:nextReview},{sub:"admin"});
    await store.scanRegulatoryReviews();
    const unresolvedAfterReview=await store.listRegulatoryReviewAlerts({state:"unresolved",limit:50});
    assert.equal(unresolvedAfterReview.data.some(x=>x.framework==="arcep_2026"&&Number(x.assignment_id)===Number(extAssignmentForRoute[0].id)),false);

    const createdDestination=await store.createCallDestination(externalIdentity[0].public_id,{assignment_id:Number(extAssignmentForRoute[0].id),label:"Standard principal",destination_type:"pstn",destination_uri:"tel:+33123456789",priority:10,max_concurrent_calls:25},{sub:"admin"});
    assert.equal(createdDestination.status,"testing");
    await store.setCallDestinationStatus(createdDestination.id,"active",{sub:"admin"},"integration");
    const customerRoute=await store.selectCallDestination({svaNumber:"33890000001"});
    assert.equal(customerRoute.route_kind,"destination");assert.equal(customerRoute.destination_uri,"tel:+33123456789");
    await store.releaseCallDestination(customerRoute.call_destination_id);
    const externalExpert=await store.selectExpert({svaNumber:"33890000001"});
    assert.equal(externalExpert.display_name,"External Expert");
    await store.releaseExpert(externalExpert.id);

    const routingPreview=await store.simulateTenantRouting(externalIdentity[0].public_id,{});
    assert.equal(routingPreview.dry_run,true);
    assert.equal(routingPreview.safe_to_activate,true);
    assert.equal(routingPreview.selected.label,"Standard principal");

    const serviceIncident=await store.createTenantServiceIncident(externalIdentity[0].public_id,{
      category:"routing",severity:"high",title:"Contrôle routage intégration",description:"Validation du centre de service PGI."
    },{sub:"admin"});
    assert.equal(serviceIncident.status,"investigating");
    await store.addServiceIncidentNote(serviceIncident.public_id,{body:"Message PGI visible par le client.",customer_visible:true},{sub:"admin"});
    const incidentDetail=await store.serviceIncidentDetail(serviceIncident.public_id);
    assert.equal(incidentDetail.incident.title,"Contrôle routage intégration");
    assert.equal(incidentDetail.notes.length,1);
    assert.equal(incidentDetail.notes[0].body,"Message PGI visible par le client.");
    assert.ok(incidentDetail.events.length>=2);
    const serviceQueue=await store.listServiceIncidents({status:"active",severity:"high",q:"External Test",limit:10});
    assert.ok(serviceQueue.data.some(x=>x.public_id===serviceIncident.public_id));
    const serviceHealth=await store.serviceOperationsHealth();
    assert.ok(Number(serviceHealth.service_incidents_open)>=1);
    const serviceOutbox=await store.sql.unsafe(
      "SELECT event_type,payload FROM outbox_events WHERE aggregate_type='tenant_service_incident' AND aggregate_id=$1::text ORDER BY id",
      [serviceIncident.id]
    );
    assert.ok(serviceOutbox.some(x=>x.event_type==="service.incident.created"));
    assert.ok(serviceOutbox.some(x=>x.event_type==="service.incident.note"));
    assert.equal(serviceOutbox.some(x=>JSON.stringify(x.payload).includes("Message PGI visible")),false);

    const externalTenant2=await store.sql.unsafe("SELECT id FROM tenants WHERE slug='integration-external-2' LIMIT 1");
    await assert.rejects(
      ()=>store.sql.unsafe(
        "INSERT INTO tenant_service_incident_notes(incident_id,tenant_id,author_type,body) VALUES($1,$2,'staff','cross tenant must fail')",
        [serviceIncident.id,externalTenant2[0].id]
      ),
      /foreign key|tenant_service_incident_notes_tenant_fk/i
    );

    await store.setCallDestinationStatus(createdDestination.id,"disabled",{sub:"admin"},"integration-routing-outage");
    await store.sql.unsafe("UPDATE experts SET status='offline' WHERE code='EXT1'");
    await store.scanTenantServiceIncidents();
    let routingAlerts=await store.sql.unsafe(
      "SELECT state FROM tenant_operational_alerts WHERE tenant_id=(SELECT id FROM tenants WHERE slug='integration-external') AND alert_type='routing_unavailable'"
    );
    assert.equal(routingAlerts[0].state,"open");
    const outageHealth=await store.serviceOperationsHealth();
    assert.ok(Number(outageHealth.routing_unavailable)>=1);

    await store.setCallDestinationStatus(createdDestination.id,"active",{sub:"admin"},"integration-routing-recovery");
    await store.sql.unsafe("UPDATE experts SET status='available' WHERE code='EXT1'");
    await store.scanTenantServiceIncidents();
    routingAlerts=await store.sql.unsafe(
      "SELECT state FROM tenant_operational_alerts WHERE tenant_id=(SELECT id FROM tenants WHERE slug='integration-external') AND alert_type='routing_unavailable'"
    );
    assert.equal(routingAlerts[0].state,"resolved");

    const newPrice=await store.createSubscriptionPrice({amount_minor:350,currency:"EUR",effective_from:new Date(now.getTime()+60000).toISOString()},{sub:"admin"});
    assert.equal(Number(newPrice.amount_minor),350);
    const externalAccessAfterPriceChange=await store.sql.unsafe("SELECT pgi_tenant_has_premium_call_access(t.id,NULL,now()) AS allowed FROM tenants t WHERE t.slug='integration-external'");
    assert.equal(externalAccessAfterPriceChange[0].allowed,true);

    const directoryActive=await store.listTenants({q:"external",country:"FR",billing:"active",limit:10});
    assert.equal(directoryActive.data.length,1);
    assert.equal(directoryActive.data[0].display_name,"External Test");
    assert.equal(directoryActive.data[0].premium_call_access,true);
    assert.equal(directoryActive.data[0].active_assignments,1);

    const directoryByNumber=await store.listTenants({number:"33890000001",limit:10});
    assert.equal(directoryByNumber.data.length,1);
    assert.equal(directoryByNumber.data[0].display_name,"External Test");

    const controlDetail=await store.tenantControlDetail(externalIdentity[0].public_id);
    assert.equal(controlDetail.tenant.display_name,"External Test");
    assert.equal(controlDetail.tenant.premium_call_access,true);
    assert.equal(controlDetail.subscriptions[0].status,"active");
    assert.equal(controlDetail.lines.length,1);
    assert.equal(controlDetail.destinations.length,1);
    assert.equal(controlDetail.destinations[0].label,"Standard principal");
    assert.equal(controlDetail.experts.length,1);
    assert.ok(Object.hasOwn(controlDetail,"activity"));
    assert.ok(Array.isArray(controlDetail.audit));
    assert.ok(Array.isArray(controlDetail.controls));

    const externalTenantRow=(await store.sql.unsafe("SELECT id FROM tenants WHERE slug='integration-external' LIMIT 1"))[0];
    const relationPrincipal=(await store.sql.unsafe(
      "INSERT INTO customer_principals(email,display_name,status,email_verified) VALUES('relations-integration@example.test','Relations Integration','active',true) RETURNING id::text AS id"
    ))[0];
    await store.sql.unsafe(
      "INSERT INTO customer_tenant_memberships(tenant_id,customer_principal_id,role,status) VALUES($1,$2::uuid,'owner','active')",
      [Number(externalTenantRow.id),relationPrincipal.id]
    );
    const experienceDefaults=await store.customerExperiencePreferences(Number(externalTenantRow.id),relationPrincipal.id);
    assert.equal(experienceDefaults.alerts.calls_below.enabled,false);
    const experienceSaved=await store.saveCustomerExperiencePreferences(Number(externalTenantRow.id),relationPrincipal.id,{alerts:{
      calls_below:{enabled:true,threshold:12},
      abandon_rate_above:{enabled:true,threshold:22},
      revenue_target:{enabled:true,threshold:250},
      drop_vs_average:{enabled:true,threshold:35}
    }});
    assert.equal(experienceSaved.alerts.calls_below.threshold,12);
    assert.equal((await store.customerExperiencePreferences(Number(externalTenantRow.id),relationPrincipal.id)).alerts.revenue_target.threshold,250);
    const dispute=await store.createCustomerRelationCase(Number(externalTenantRow.id),{
      case_kind:"billing_dispute",priority:"high",customer_capacity:"business",
      title:"Contest facture intégration",description:"Le client conteste une partie déterminée du montant.",
      disputed_amount:12.34,disputed_currency:"EUR",invoice_reference:"INV-INTEGRATION-001",
      requested_resolution:"Vérifier le calcul et expliquer la différence."
    },relationPrincipal.id);
    assert.equal(dispute.case_kind,"billing_dispute");
    const relationView=await store.customerRelationsOverview(Number(externalTenantRow.id));
    assert.equal(relationView.cases.length,1);
    assert.equal(relationView.holds.length,1);
    assert.equal(Number(relationView.holds[0].amount),12.34);
    const evidenceAction=await store.createRelationAgentAction(dispute.public_id,{
      action_type:"collect_evidence",confidence:.99,explanation:"Rassembler les références autoritatives.",payload:{rio:"must-not-persist",safe:"ok"}
    },{sub:"admin"});
    assert.equal(evidenceAction.status,"completed");
    const storedAgentPayload=await store.sql.unsafe("SELECT payload::text AS payload_json FROM tenant_relation_actions WHERE public_id=$1::uuid",[evidenceAction.public_id]);
    const storedPayload=JSON.parse(storedAgentPayload[0].payload_json);
    assert.equal(storedPayload.rio,undefined);
    assert.equal(storedAgentPayload[0].payload_json.includes("must-not-persist"),false);
    const refundProposal=await store.createRelationAgentAction(dispute.public_id,{
      action_type:"issue_refund",confidence:.9,explanation:"Remboursement proposé après analyse.",payload:{amount:12.34,currency:"EUR"}
    },{sub:"admin"});
    assert.equal(refundProposal.status,"proposed");
    const approvedRefund=await store.approveRelationAction(refundProposal.public_id,{sub:"admin"});
    assert.equal(approvedRefund.status,"approved");
    assert.equal(approvedRefund.external_execution_required,true);

    const exit=await store.createCustomerExitRequest(Number(externalTenantRow.id),{
      exit_scope:"selected_lines",reason_category:"competition",requested_effective_date:"2026-10-15",
      number_retention_preference:"port_out",port_out_requested:true,target_operator_name:"Nouvel opérateur",
      contract_obligations_acknowledged:true,assignment_ids:[Number(extAssignmentForRoute[0].id)]
    },relationPrincipal.id);
    assert.equal(exit.exit.port_out_requested,true);
    const exitOverview=await store.customerRelationsOverview(Number(externalTenantRow.id),{admin:true});
    assert.equal(exitOverview.exits.length,1);
    assert.equal(exitOverview.exit_lines.length,1);
    assert.equal(exitOverview.exit_lines[0].requested_action,"port_out");
    assert.ok(exit.orchestration.some(x=>x.action_type==="check_portability"&&x.status==="completed"));
    const rioAction=exit.orchestration.find(x=>x.action_type==="request_outbound_rio");
    assert.ok(rioAction);
    assert.equal(rioAction.status,"queued");
    const rioActionScope=await store.sql.unsafe("SELECT exit_line_id FROM tenant_relation_actions WHERE public_id=$1::uuid",[rioAction.public_id]);
    assert.equal(Number(rioActionScope[0].exit_line_id),Number(exit.lines[0].exit_line_id));
    const rioConfirm=await store.completeRelationExternalAction(rioAction.public_id,{
      outcome:"delivered",provider_reference:"rio-ref-1",rio_last4:"1234",delivery_channel:"provider_direct",delivery_reference:"provider-secure-delivery-1"
    },{sub:"admin"});
    assert.equal(rioConfirm.status,"completed");
    assert.equal(rioConfirm.next_action.action_type,"submit_port_out");
    assert.equal(rioConfirm.next_action.status,"queued");
    assert.equal(Number(rioConfirm.next_action.exit_line_id),Number(exit.lines[0].exit_line_id));
    const outboundWork=await store.sql.unsafe("SELECT queue_name,dedupe_key FROM work_queue WHERE queue_name='portability_outbound' AND dedupe_key=$1 ORDER BY id DESC LIMIT 1",["portability_outbound:"+rioConfirm.next_action.public_id]);
    assert.equal(outboundWork.length,1);
    assert.equal(outboundWork[0].dedupe_key,"portability_outbound:"+rioConfirm.next_action.public_id);
    const postRio=await store.customerRelationsOverview(Number(externalTenantRow.id),{admin:true});
    assert.equal(postRio.exit_lines[0].portability_eligibility_status,"eligible");
    assert.equal(postRio.exit_lines[0].portability_service_level,"enhanced");
    assert.equal(postRio.exit_lines[0].rio_status,"delivered");
    assert.equal(postRio.exit_lines[0].rio_last4,"1234");
    const agentContext=await store.relationAgentContext(exit.case.public_id);
    assert.equal(agentContext.guardrails.no_port_out_completion_without_operator_confirmation,true);
    assert.equal(JSON.stringify(agentContext).includes("1234"),false);

    let extAssignments=await store.listTenantAssignments({tenant_public_id:externalIdentity[0].public_id,limit:10});
    assert.equal(extAssignments.data.length,1);
    const assignmentId=Number(extAssignments.data[0].id);
    const suspendedLine=await store.setTenantAssignmentStatus(assignmentId,"suspended",{sub:"admin"},"integration");
    assert.equal(suspendedLine.status,"suspended");
    await assert.rejects(
      ()=>store.selectExpert({svaNumber:"33890000001"}),
      error=>error.status===423&&error.code==="SVA_ASSIGNMENT_INACTIVE"
    );
    const activeLine=await store.setTenantAssignmentStatus(assignmentId,"active",{sub:"admin"},"integration");
    assert.equal(activeLine.status,"active");

    const suspendedTenant=await store.setTenantStatus(externalIdentity[0].public_id,"suspended",{sub:"admin"},"integration");
    assert.equal(suspendedTenant.status,"suspended");
    assert.equal(suspendedTenant.suspended_assignments,1);
    let extAccess=await store.sql.unsafe("SELECT pgi_tenant_has_premium_call_access(t.id,NULL,now()) AS allowed FROM tenants t WHERE t.slug='integration-external'");
    assert.equal(extAccess[0].allowed,false);

    const reactivatedTenant=await store.setTenantStatus(externalIdentity[0].public_id,"active",{sub:"admin"},"integration");
    assert.equal(reactivatedTenant.status,"active");
    extAssignments=await store.listTenantAssignments({tenant_public_id:externalIdentity[0].public_id,limit:10});
    assert.equal(extAssignments.data[0].status,"suspended");
    await store.setTenantAssignmentStatus(assignmentId,"active",{sub:"admin"},"integration");

    const pastDueTime=new Date(now.getTime()+1000);
    const pastDueEvent={...billingEvent,provider_event_id:"sub-past-due-1",event_type:"invoice.payment_failed",status:"past_due",event_time:pastDueTime.toISOString(),last_payment_status:"failed"};
    const pastDueApplied=await store.applySubscriptionBillingEvent(pastDueEvent);
    assert.equal(pastDueApplied.status,"past_due");
    const unpaidAlerts=await store.scanUnpaidSubscriptions();
    assert.equal(unpaidAlerts.length,1);
    assert.equal(unpaidAlerts[0].alert_type,"subscription_unpaid");
    extAccess=await store.sql.unsafe("SELECT pgi_tenant_has_premium_call_access(t.id,NULL,now()) AS allowed FROM tenants t WHERE t.slug='integration-external'");
    assert.equal(extAccess[0].allowed,false);
    const unpaidDirectory=await store.listTenants({country:"FR",billing:"unpaid",limit:10});
    assert.ok(unpaidDirectory.data.some(x=>x.display_name==="External Test"));
    const openAlerts=await store.listAdminAlerts({state:"open",country:"FR",limit:10});
    assert.equal(openAlerts.data.length,1);
    const acknowledged=await store.acknowledgeAdminAlert(openAlerts.data[0].id,{sub:"admin"});
    assert.equal(acknowledged.state,"acknowledged");

    const renewedTime=new Date(now.getTime()+2000),renewedEnd=new Date(now.getTime()+62*86400000);
    const renewedEvent={...billingEvent,provider_event_id:"sub-renewed-1",event_type:"invoice.paid",status:"active",event_time:renewedTime.toISOString(),current_period_start:renewedTime.toISOString(),current_period_end:renewedEnd.toISOString(),last_payment_status:"paid"};
    const renewed=await store.applySubscriptionBillingEvent(renewedEvent);
    assert.equal(renewed.status,"active");
    const remainingOpenAlerts=await store.listAdminAlerts({state:"open",limit:10});
    assert.equal(remainingOpenAlerts.data.length,0);
    extAccess=await store.sql.unsafe("SELECT pgi_tenant_has_premium_call_access(t.id,NULL,now()) AS allowed FROM tenants t WHERE t.slug='integration-external'");
    assert.equal(extAccess[0].allowed,true);

    const internalExpertRows=await store.sql.unsafe("SELECT id FROM experts WHERE code='E1' LIMIT 1");
    assert.equal(internalExpertRows.length,1);
    const internalExpertId=Number(internalExpertRows[0].id);

    const envelope={
      source:"integration",
      source_event_id:"evt-1",
      payload:{
        external_call_id:"call-1",
        started_at:"2026-09-18T12:00:00Z",
        ivr_started_at:"2026-09-18T12:00:02Z",
        queued_at:"2026-09-18T12:00:05Z",
        ringing_at:"2026-09-18T12:00:03Z",
        bridged_at:"2026-09-18T12:00:10Z",
        post_dial_delay_ms:3000,
        ended_at:"2026-09-18T12:10:10Z",
        wait_seconds:10,
        conversation_seconds:600,
        total_seconds:610,
        call_status:"connected",
        caller_masked:"0612345678",
        caller_id_number:"0612345678",
        secret_field:"must-not-persist",
        origin_carrier:"Orange",
        origin_type:"mobile",
        sva_number:"33890000000",
        expert_id:internalExpertId,
        sip_final_code:200,
        hangup_party:"caller",
        quality:{mos:4.2,packet_loss_percent:0.1,jitter_ms:4,latency_ms:30,rtt_ms:60,packets_in:1000,packets_out:980,packets_lost:1,bytes_in:160000,bytes_out:156800,dtmf_errors:0}
      }
    };
    const first=await store.ingestCdr(envelope);
    assert.equal(first.duplicate,false);
    const second=await store.ingestCdr(envelope);
    assert.equal(second.duplicate,true);

    const summary=await store.summary("2026-09-18T00:00:00Z","2026-09-19T00:00:00Z");
    assert.equal(summary.calls_total,1);
    assert.ok(summary.expected_payout_ht>0);

    const analytics=await store.dashboardAnalytics("2026-09-18T00:00:00Z","2026-09-19T00:00:00Z","FR");
    assert.equal(analytics.series.length,1);
    assert.equal(analytics.series[0].payout_eligible_seconds,600);
    assert.equal(analytics.series[0].confirmed_payout,0);
    assert.equal(analytics.quality_series.length,1);
    assert.equal(analytics.quality_series[0].samples,1);
    assert.equal(analytics.quality_series[0].mos,4.2);
    assert.equal(analytics.quality.affected_samples,0);
    assert.equal(analytics.experience.samples,1);
    assert.equal(analytics.experience.avg_wait_seconds,10);
    assert.equal(analytics.experience.answered_le_20s_percent,100);
    assert.equal(analytics.experience.avg_ivr_seconds,3);
    assert.equal(analytics.experience.avg_queue_seconds,5);
    assert.equal(analytics.experience_series.length,1);
    assert.equal(analytics.experts.length,1);
    assert.ok(Object.hasOwn(analytics.experts[0],"margin"));
    assert.ok(Number.isFinite(Number(analytics.experts[0].margin)));
    assert.equal(analytics.carriers.length,1);
    assert.ok(Object.hasOwn(analytics.carriers[0],"margin"));

    const voice=await store.voiceIntelligence("2026-09-18T00:00:00Z","2026-09-19T00:00:00Z","FR");
    assert.equal(voice.summary.calls_total,1);
    assert.equal(voice.summary.avg_pdd_ms,3000);
    assert.equal(voice.summary.mos,4.2);
    assert.equal(voice.summary.rtt_ms,60);
    assert.equal(voice.summary.caller_hangups,1);
    assert.ok(voice.sip_codes.some(x=>x.sip_final_code===200&&x.calls_total===1));
    assert.ok(voice.carriers.some(x=>x.carrier_role==="host"&&x.carrier==="Host A"));

    const tenantDaily=await store.sql.unsafe("SELECT calls_total,quality_samples FROM tenant_voice_daily_sharded WHERE bucket_date='2026-09-18'::date");
    assert.ok(tenantDaily.some(x=>Number(x.calls_total)===1&&Number(x.quality_samples)===1));

    const calls=await store.listCalls({limit:10});
    assert.equal(calls.data.length,1);
    assert.equal(calls.data[0].origin_carrier,"Orange");
    assert.equal(calls.data[0].caller_masked,"•• •• •• 56 78");
    assert.equal(calls.data[0].service_rate_ttc_per_min,0.8);
    assert.equal(calls.data[0].carrier_rate_ht_per_min,0.55);
    assert.equal(calls.data[0].expected_payout_ht,5);
    assert.equal(calls.data[0].retail_service_amount_ttc,8);
    assert.equal(calls.data[0].expert_cost_ht,1.8);
    assert.equal(calls.data[0].post_dial_delay_ms,3000);
    assert.equal(calls.data[0].hangup_party,"caller");
    assert.equal(calls.data[0].quality.rtt_ms,60);
    assert.equal(Number(calls.data[0].quality.packets_lost),1);

    const rawPayload=await store.sql.unsafe(
      "SELECT payload ? 'caller_masked' AS has_caller_masked,"+
      " payload ? 'caller_hash' AS has_caller_hash,"+
      " payload ? 'caller_id_number' AS has_caller_id_number,"+
      " payload ? 'secret_field' AS has_secret_field"+
      " FROM raw_cdr_events WHERE source_event_id='evt-1'"
    );
    assert.equal(rawPayload.length,1);
    assert.equal(rawPayload[0].has_caller_masked,false);
    assert.equal(rawPayload[0].has_caller_hash,false);
    assert.equal(rawPayload[0].has_caller_id_number,false);
    assert.equal(rawPayload[0].has_secret_field,false);

    const expert=await store.selectExpert({svaNumber:"33890000000"});
    assert.equal(expert.display_name,"Expert 1");

    const route=await store.carrierRouting();
    assert.equal(route.active_carrier,"Host A");

    const carrierAdmin=await store.carrierAdminOverview();
    assert.equal(carrierAdmin.route.active_carrier,"Host A");
    assert.ok(carrierAdmin.targets.some(x=>x.carrier_name==="Host B"&&x.state==="standby"));
    const target=carrierAdmin.targets.find(x=>x.carrier_name==="Host B");
    await store.sql.unsafe(
      "INSERT INTO app_users(email,display_name,role,enabled) VALUES('four-eyes-requester@example.test','Four Eyes Requester','admin',true),('four-eyes-approver@example.test','Four Eyes Approver','admin',true) ON CONFLICT(email) DO UPDATE SET display_name=EXCLUDED.display_name,role='admin',enabled=true"
    );
    const staff=await store.sql.unsafe("SELECT id,email FROM app_users WHERE email IN ('four-eyes-requester@example.test','four-eyes-approver@example.test') ORDER BY email");
    const approver=staff.find(x=>x.email==="four-eyes-approver@example.test"),requester=staff.find(x=>x.email==="four-eyes-requester@example.test");
    assert.ok(requester&&approver);

    const plannedSwitch=await store.planCarrierSwitch({route_key:"sva-primary",to_carrier_id:Number(target.carrier_id),connection_id:Number(target.connection_id),rollback_window_minutes:60,notes:"integration"},{sub:String(requester.id)});
    assert.equal(plannedSwitch.status,"ready");
    assert.equal(plannedSwitch.change_request_status,"pending");
    const carrierAdminAfterPlan=await store.carrierAdminOverview();
    assert.ok(carrierAdminAfterPlan.recent_switches.some(x=>Number(x.id)===Number(plannedSwitch.id)));

    await assert.rejects(
      ()=>store.activateCarrierSwitch(plannedSwitch.id,{sub:String(requester.id)}),
      error=>error.code==="DUAL_CONTROL_APPROVAL_REQUIRED"
    );
    await assert.rejects(
      ()=>store.approvePlatformChangeRequest(plannedSwitch.change_request_id,{sub:String(requester.id)},{reason:"self approval"}),
      error=>error.code==="FOUR_EYES_SECOND_APPROVER_REQUIRED"
    );
    const approvedChange=await store.approvePlatformChangeRequest(plannedSwitch.change_request_id,{sub:String(approver.id)},{reason:"Independent integration approval"});
    assert.equal(approvedChange.status,"approved");

    const activatedSwitch=await store.activateCarrierSwitch(plannedSwitch.id,{sub:String(requester.id)});
    assert.equal(activatedSwitch.route.active_carrier,"Host B");
    const approvalEvents=await store.sql.unsafe("SELECT event_type,event_sha256,previous_sha256 FROM platform_change_approval_events WHERE change_request_id=$1 ORDER BY id",[Number(plannedSwitch.change_request_id)]);
    assert.deepEqual(approvalEvents.map(x=>x.event_type),["requested","approved","executed"]);
    assert.ok(approvalEvents.every(x=>/^[a-f0-9]{64}$/.test(x.event_sha256)));
    assert.equal(approvalEvents[0].previous_sha256,null);
    assert.equal(approvalEvents[1].previous_sha256,approvalEvents[0].event_sha256);
    assert.equal(approvalEvents[2].previous_sha256,approvalEvents[1].event_sha256);

    const rolledBackSwitch=await store.rollbackCarrierSwitch(plannedSwitch.id,{sub:String(requester.id)});
    assert.equal(rolledBackSwitch.route.active_carrier,"Host A");
    const switchAudit=await store.sql.unsafe("SELECT action FROM audit_log WHERE entity_type='carrier_switch' AND entity_id=$1 ORDER BY id",[String(plannedSwitch.id)]);
    assert.deepEqual(switchAudit.map(x=>x.action),["carrier_switch.plan","carrier_switch.activate","carrier_switch.rollback"]);

    const onboarded=await store.createTenant({
      display_name:"International Onboarding Test",legal_name:"International Onboarding Test Ltd",
      tenant_type:"customer",country_code:"FR",billing_email:"accounts@example.test",
      preferred_locale:"",default_currency:"",timezone:""
    },{sub:"admin"});
    assert.equal(onboarded.status,"pending");
    assert.equal(onboarded.country_code,"FR");
    assert.equal(onboarded.preferred_locale,"fr-FR");
    assert.equal(onboarded.default_currency,"EUR");
    assert.equal(onboarded.timezone,"Europe/Paris");
    const onboardKyc=await store.sql.unsafe("SELECT status,registration_country FROM tenant_kyc_profiles WHERE tenant_id=(SELECT id FROM tenants WHERE public_id=$1::uuid)",[onboarded.public_id]);
    assert.equal(onboardKyc[0].status,"pending");
    assert.equal(onboardKyc[0].registration_country,"FR");
    const pendingKycDirectory=await store.listTenants({q:"international",kyc:"pending",limit:10});
    assert.equal(pendingKycDirectory.data.length,1);
    assert.equal(pendingKycDirectory.data[0].public_id,onboarded.public_id);
    const onboardPlacement=await store.sql.unsafe("SELECT state,cluster_key FROM tenant_data_placement WHERE tenant_id=(SELECT id FROM tenants WHERE public_id=$1::uuid)",[onboarded.public_id]);
    assert.equal(onboardPlacement[0].state,"active");
    const onboardMarket=await store.sql.unsafe("SELECT status,compliance_status FROM tenant_market_profiles WHERE tenant_id=(SELECT id FROM tenants WHERE public_id=$1::uuid)",[onboarded.public_id]);
    assert.equal(onboardMarket[0].status,"onboarding");
    assert.equal(onboardMarket[0].compliance_status,"not_started");
    const onboardAccess=await store.sql.unsafe("SELECT pgi_tenant_has_premium_call_access((SELECT id FROM tenants WHERE public_id=$1::uuid),NULL,now()) AS allowed",[onboarded.public_id]);
    assert.equal(onboardAccess[0].allowed,false);

    const internalTenant=(await store.sql.unsafe("SELECT id,public_id::text AS public_id FROM tenants WHERE slug='pgi-internal'"))[0];
    const requestedFrom="2026-09-18T00:00:00Z",requestedTo="2026-09-19T00:00:00Z";
    let tenantRanges=await store.effectiveMetricRanges(requestedFrom,requestedTo,Number(internalTenant.id));
    const portalBeforeReset=await store.customerPortalOverview(Number(internalTenant.id),requestedFrom,requestedTo,tenantRanges);
    assert.equal(Number(portalBeforeReset.financial_by_currency[0].calls_total),1);
    for(const dimension of ["hour","weekday","number","duration"]){
      assert.ok(portalBeforeReset.activity_breakdown.some(x=>x.dimension===dimension&&Number(x.calls)>=1),dimension+" activity breakdown");
    }
    assert.equal(Number(portalBeforeReset.financial_by_currency[0].generated_revenue_ttc),8);
    assert.equal(portalBeforeReset.recent_calls.length,1);

    const consumptionReceipt=await store.createCustomerConsumptionReceipt(Number(internalTenant.id),null,requestedFrom,requestedTo);
    assert.equal(Number(consumptionReceipt.metrics.calls_total),1);
    assert.equal(Number(consumptionReceipt.metrics.generated_revenue_ttc),8);
    assert.match(consumptionReceipt.snapshot_sha256,/^[a-f0-9]{64}$/);
    assert.match(consumptionReceipt.reference,/^CR-[A-F0-9]{8}$/);
    const tenantReceipts=await store.customerConsumptionReceipts(Number(internalTenant.id),10);
    assert.equal(tenantReceipts.length,1);
    assert.equal(tenantReceipts[0].public_id,consumptionReceipt.public_id);
    const receiptCheck=await store.reconcileTenantConsumptionReceipt(internalTenant.public_id,consumptionReceipt.public_id);
    assert.equal(receiptCheck.reconciliation.status,"match");
    assert.deepEqual(receiptCheck.reconciliation.differences,[]);
    assert.equal(receiptCheck.reconciliation.receipt_sha256,receiptCheck.reconciliation.current_sha256);
    await assert.rejects(
      ()=>store.sql.unsafe("UPDATE tenant_consumption_receipts SET tenant_timezone='UTC' WHERE public_id=$1::uuid",[consumptionReceipt.public_id]),
      /tenant consumption receipts are immutable/
    );
    await assert.rejects(
      ()=>store.sql.unsafe("DELETE FROM tenant_consumption_receipts WHERE public_id=$1::uuid",[consumptionReceipt.public_id]),
      /tenant consumption receipts are immutable/
    );

    const globalCallReset=await store.createBaseline({scope:"global",metric_key:"calls",reason:"integration cockpit calls reset"},{});
    const globalRanges=await store.effectiveMetricRanges(requestedFrom,requestedTo);
    assert.equal(globalRanges.calls.baseline,new Date(globalCallReset.effective_from).toISOString());
    assert.equal(globalRanges.calls.empty,true);
    assert.equal(globalRanges.revenue.baseline,null);

    tenantRanges=await store.effectiveMetricRanges(requestedFrom,requestedTo,Number(internalTenant.id));
    assert.equal(tenantRanges.calls.baseline,null);
    const portalAfterCockpitReset=await store.customerPortalOverview(Number(internalTenant.id),requestedFrom,requestedTo,tenantRanges);
    assert.equal(Number(portalAfterCockpitReset.financial_by_currency[0].calls_total),1);
    assert.equal(portalAfterCockpitReset.recent_calls.length,1);

    const tenantRevenueReset=await store.createBaseline({scope:"global",tenant_id:Number(internalTenant.id),metric_key:"revenue",reason:"integration tenant revenue reset"},{});
    tenantRanges=await store.effectiveMetricRanges(requestedFrom,requestedTo,Number(internalTenant.id));
    assert.equal(tenantRanges.revenue.baseline,new Date(tenantRevenueReset.effective_from).toISOString());
    assert.equal(tenantRanges.calls.baseline,null);
    const portalAfterRevenueReset=await store.customerPortalOverview(Number(internalTenant.id),requestedFrom,requestedTo,tenantRanges);
    assert.equal(Number(portalAfterRevenueReset.financial_by_currency[0].calls_total),1);
    assert.equal(Number(portalAfterRevenueReset.financial_by_currency[0].billable_seconds),600);
    assert.equal(Number(portalAfterRevenueReset.financial_by_currency[0].generated_revenue_ttc),0);
    assert.equal(portalAfterRevenueReset.recent_calls.length,1);

    const tenantCallsReset=await store.createBaseline({scope:"global",tenant_id:Number(internalTenant.id),metric_key:"calls",reason:"integration tenant calls reset"},{});
    tenantRanges=await store.effectiveMetricRanges(requestedFrom,requestedTo,Number(internalTenant.id));
    assert.equal(tenantRanges.calls.baseline,new Date(tenantCallsReset.effective_from).toISOString());
    const portalAfterCallsReset=await store.customerPortalOverview(Number(internalTenant.id),requestedFrom,requestedTo,tenantRanges);
    assert.equal(Number(portalAfterCallsReset.financial_by_currency[0].calls_total),0);
    assert.equal(Number(portalAfterCallsReset.financial_by_currency[0].billable_seconds),600);
    assert.equal(portalAfterCallsReset.recent_calls.length,0);

    const visibleSystemAfterReset=await store.systemSnapshot();
    assert.equal(Number(visibleSystemAfterReset.calls_total),0);

    const privateNoteBody="Note interne intégration confidentielle";
    const privateNote=await store.createTenantInternalNote(externalIdentity[0].public_id,{body:privateNoteBody},{sub:"admin"});
    assert.equal(privateNote.body,privateNoteBody);
    const privateNotes=await store.tenantInternalNotes(externalIdentity[0].public_id);
    assert.equal(privateNotes.data.length,1);
    assert.equal(privateNotes.data[0].body,privateNoteBody);
    const privateAudit=await store.sql.unsafe("SELECT action,details FROM audit_log WHERE entity_type='tenant_internal_note' AND entity_id=$1 ORDER BY id DESC LIMIT 1",[String(privateNote.id)]);
    assert.equal(privateAudit[0].action,"tenant.internal_note.create");
    assert.equal(JSON.stringify(privateAudit[0].details).includes(privateNoteBody),false);
    const archivedPrivateNote=await store.archiveTenantInternalNote(privateNote.id,{sub:"admin"});
    assert.equal(archivedPrivateNote.changed,true);
    assert.equal((await store.tenantInternalNotes(externalIdentity[0].public_id)).data.length,0);

    const metrics=await store.metrics();
    assert.equal(metrics.calls_total,1);
    const rawCalls=await store.sql.unsafe("SELECT count(*)::int AS count FROM calls");
    assert.equal(rawCalls[0].count,1);
    const migrations=await store.sql.unsafe("SELECT version,checksum FROM schema_migrations ORDER BY version");
    assert.equal(migrations.length,55);
    assert.equal(new Set(migrations.map(x=>x.version)).size,migrations.length);
    assert.equal(migrations[0].version,"001_baseline");
    assert.equal(migrations.at(-1).version,"055_live_call_financial_realtime");
    for(const migration of migrations)assert.match(migration.checksum,/^[a-f0-9]{64}$/);
  }finally{
    await store.close();
  }
});


test("PostgreSQL relay propagates realtime events across independent processes", {skip:!run}, async()=>{
  const busA=new EventBus();
  const busB=new EventBus();
  const storeA=await PostgresStore.connect(config(),busA);
  const storeB=await PostgresStore.connect(config(),busB);
  const received=[];

  try{
    await busA.attachPostgres(storeA.sql);
    await busB.attachPostgres(storeB.sql);
    busB.subscribe(event=>received.push(event));

    const sent=busA.publish("call.ingested",{id:987});
    const deadline=Date.now()+2000;
    while(received.length===0&&Date.now()<deadline){
      await new Promise(resolve=>setTimeout(resolve,20));
    }

    assert.equal(received.length,1);
    assert.equal(received[0].id,sent.id);
    assert.equal(received[0].type,"call.ingested");
    assert.deepEqual(received[0].payload,{id:987});
    assert.equal(busA.relayStatus.received,0);
    assert.equal(busB.relayStatus.received,1);
  }finally{
    await busA.close();
    await busB.close();
    await storeA.close();
    await storeB.close();
  }
});
