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
    await store.sql.unsafe("TRUNCATE TABLE settlement_call_matches,carrier_settlements,call_quality,financial_ledger,outbox_events,raw_cdr_events,calls,tenant_call_destinations,callers,expert_presence_events,metric_baselines,carrier_switches,number_carrier_assignments,carrier_connections,carrier_adapters,carrier_contracts,number_portability_events,sva_numbers,carriers,audit_log,api_idempotency_keys RESTART IDENTITY CASCADE");
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
    assert.equal(Number(billingBefore.current_price.amount_minor),200);
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
    assert.equal(Number(billingPrep.offer.amount_minor),200);
    assert.equal(billingPrep.checkout_prefill.email,"billing@example.test");
    assert.equal(billingPrep.return_paths.success,"client.html?billing=success");

    await assert.rejects(
      ()=>store.sql.unsafe("INSERT INTO tenant_number_assignments(tenant_id,sva_number_id,assignment_type,status,valid_from) SELECT t.id,s.id,'customer_service','active',now() FROM tenants t CROSS JOIN sva_numbers s WHERE t.slug='integration-external' AND s.e164='33890000001'"),
      /active external SVA assignment requires PGI payout terms/
    );

    const payoutTerms=await store.createTenantPayoutTerms(externalIdentity[0].public_id,{platform_fee_percent:20,payout_delay_days:7},{sub:"admin"});
    assert.equal(Number(payoutTerms.platform_fee_bps),2000);
    assert.equal(payoutTerms.collection_model,"pgi_collects");

    await store.sql.unsafe("INSERT INTO tenant_number_assignments(tenant_id,sva_number_id,assignment_type,status,valid_from) SELECT t.id,s.id,'customer_service','active',now() FROM tenants t CROSS JOIN sva_numbers s WHERE t.slug='integration-external' AND s.e164='33890000001'");
    const extAssignmentForRoute=await store.sql.unsafe("SELECT id FROM tenant_number_assignments WHERE tenant_id=(SELECT id FROM tenants WHERE slug='integration-external') AND sva_number_id=(SELECT id FROM sva_numbers WHERE e164='33890000001') LIMIT 1");
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
    const plannedSwitch=await store.planCarrierSwitch({route_key:"sva-primary",to_carrier_id:Number(target.carrier_id),connection_id:Number(target.connection_id),rollback_window_minutes:60,notes:"integration"},{sub:"admin"});
    assert.equal(plannedSwitch.status,"ready");
    const carrierAdminAfterPlan=await store.carrierAdminOverview();
    assert.ok(carrierAdminAfterPlan.recent_switches.some(x=>Number(x.id)===Number(plannedSwitch.id)));

    const activatedSwitch=await store.activateCarrierSwitch(plannedSwitch.id,{sub:"admin"});
    assert.equal(activatedSwitch.route.active_carrier,"Host B");
    const rolledBackSwitch=await store.rollbackCarrierSwitch(plannedSwitch.id,{sub:"admin"});
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

    const metrics=await store.metrics();
    assert.equal(metrics.calls_total,1);
    const migrations=await store.sql.unsafe("SELECT version,checksum FROM schema_migrations ORDER BY version");
    assert.equal(migrations.length,34);
    assert.equal(new Set(migrations.map(x=>x.version)).size,migrations.length);
    assert.equal(migrations[0].version,"001_baseline");
    assert.equal(migrations.at(-1).version,"034_service_incident_tenant_integrity");
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
