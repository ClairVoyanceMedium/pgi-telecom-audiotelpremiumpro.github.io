import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read=file=>fs.readFileSync(file,"utf8");
const migration=read("database/migrations/070_expert_accounting_ledger.sql");
const service=read("backend/src/accounting-expert.mjs");
const server=read("backend/server.mjs");
const cockpit=read("assets/accounting-cockpit.js");
const expert=read("assets/accounting-expert.js");
const build=read("scripts/build-static.mjs");
const pkg=JSON.parse(read("package.json"));
const vercel=JSON.parse(read("vercel.json"));

test("la couche expert-comptable possède un journal en partie double durable et verrouillé",()=>{
  for(const object of [
    "platform_accounting_settings",
    "platform_accounting_accounts",
    "platform_accounting_journals",
    "platform_accounting_periods",
    "platform_accounting_period_events",
    "platform_accounting_entries",
    "platform_accounting_lines",
    "platform_bank_transactions",
    "platform_accounting_documents"
  ])assert.ok(migration.includes(object),object);
  assert.match(migration,/pgi_accounting_entry_balanced/);
  assert.match(migration,/DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration,/ACCOUNTING_VALIDATED_ENTRY_IMMUTABLE/);
  assert.match(migration,/ACCOUNTING_VALIDATED_LINES_IMMUTABLE/);
  assert.match(migration,/ACCOUNTING_PERIOD_CLOSED/);
  assert.match(migration,/platform_accounting_entries_closed_period_trg/);
});

test("le plan de comptes sépare les comptes définitifs des comptes d attente",()=>{
  for(const account of ["401000","411000","445660","445710","467100","471110","471120","471210","471220","471230","471240","471310","512000","706000"]){
    assert.ok(migration.includes("'"+account+"'"),account);
  }
  assert.match(migration,/suspense boolean NOT NULL DEFAULT false/);
  assert.match(service,/ACCOUNTING_SUSPENSE_ACCOUNT_CANNOT_BE_VALIDATED/);
});

test("les flux opérationnels sont préparés automatiquement sans inventer la fiscalité",()=>{
  for(const source of [
    "subscription_billing_events",
    "tenant_portability_requests",
    "tenant_card_payment_requests",
    "customer_referral_rewards",
    "tenant_revenue_distributions"
  ])assert.ok(service.includes(source),source);
  for(const account of ["471110","471120","471210","471220","471230","471240","471310","467100"]){
    assert.ok(service.includes(account),account);
  }
  assert.match(service,/source_entries_are_draft:true/);
  assert.match(service,/no_tax_assumption:true/);
  assert.match(service,/vat_regime/);
  assert.match(service,/prices_include_vat/);
});

test("le moteur produit balance, grand livre, TVA, banque et clôtures",()=>{
  assert.match(service,/trial_balance/);
  assert.match(service,/general_ledger/);
  assert.match(service,/vat_summary/);
  assert.match(service,/bank_reconciliation/);
  assert.match(service,/bank_transactions/);
  assert.match(service,/platform_accounting_period_events/);
  assert.match(service,/ACCOUNTING_PERIOD_NOT_CLOSABLE/);
  assert.match(service,/ACCOUNTING_PERIOD_REOPEN_REASON_REQUIRED/);
  assert.match(service,/fiscalBounds/);
  assert.match(service,/fiscalYearForDate/);
  assert.match(service,/createHash\("sha256"\)/);
  assert.doesNotMatch(service,/md5\(/);
});

test("la validation est équilibrée, immuable et numérotée par exercice",()=>{
  assert.match(service,/ACCOUNTING_ENTRY_NOT_BALANCED/);
  assert.match(service,/platform_accounting_sequences/);
  assert.match(service,/ACCOUNTING_ENTRY_ALREADY_VALIDATED/);
  assert.match(service,/status='validated'/);
  assert.match(service,/reverseExpertAccountingEntry/);
  assert.match(service,/reverses_entry_id/);
});

test("le rapprochement bancaire exige une écriture 512 de même montant et même sens",()=>{
  assert.match(service,/account_num LIKE '512%'/);
  assert.match(service,/BANK_ENTRY_AMOUNT_OR_ACCOUNT_MISMATCH/);
  assert.match(service,/reconciliation_state='matched'/);
  assert.match(service,/external_key/);
  assert.match(service,/ON CONFLICT\(external_key\) DO NOTHING/);
});

test("le FEC reprend exactement les 18 champs réglementaires dans l ordre",()=>{
  const fields=[
    "JournalCode","JournalLib","EcritureNum","EcritureDate","CompteNum","CompteLib",
    "CompAuxNum","CompAuxLib","PieceRef","PieceDate","EcritureLib","Debit","Credit",
    "EcritureLet","DateLet","ValidDate","Montantdevise","Idevise"
  ];
  let previous=-1;
  for(const field of fields){
    const at=service.indexOf('"'+field+'"');
    assert.ok(at>previous,field);
    previous=at;
  }
  assert.match(service,/FEC_FIELDS\.join\("\\t"\)/);
  assert.match(service,/String\(settings\.siren\)\+"FEC"\+date8\(closeDate\)\+"\.txt"/);
  assert.match(service,/ORDER BY e\.validated_at,e\.entry_number,l\.line_no/);
  assert.match(service,/ACCOUNTING_FEC_ENTRY_SEQUENCE_INVALID/);
  assert.match(service,/ACCOUNTING_FEC_ROW_INVALID/);
  assert.match(service,/ACCOUNTING_FEC_FOREIGN_CURRENCY_INVALID/);
  assert.match(service,/createHash\("sha256"\)\.update\(content,"utf8"\)\.digest\("hex"\)/);
  assert.match(service,/sha256_source:"fec-content"/);
  assert.match(service,/field_count:FEC_FIELDS\.length/);
  for(const blocker of [
    "LEGAL_NAME_MISSING","SIREN_MISSING","VAT_REGIME_UNCONFIGURED","FEC_NOT_ENABLED",
    "DRAFT_ENTRIES","SUSPENSE_ACCOUNTS","UNBALANCED_ENTRIES","BANK_UNMATCHED",
    "PERIODS_NOT_CLOSED","NO_VALIDATED_ENTRIES"
  ])assert.ok(service.includes(blocker),blocker);
});

test("la préparation comptable s exécute automatiquement sans intervention humaine",()=>{
  assert.match(server,/\/api\/v1\/internal\/accounting\/refresh/);
  assert.match(server,/authorizeCron\(req,config\)/);
  assert.match(server,/accounting_expert\.auto_refresh/);
  const cron=vercel.crons.find(x=>x.path==="/api/v1/internal/accounting/refresh");
  assert.ok(cron);
  assert.equal(cron.schedule,"17 * * * *");
});

test("les routes expert-comptable sont privées, protégées et idempotentes",()=>{
  for(const route of [
    "/api/v1/platform/accounting/expert",
    "/api/v1/platform/accounting/expert/refresh",
    "/api/v1/platform/accounting/expert/settings",
    "/api/v1/platform/accounting/expert/entries",
    "/api/v1/platform/accounting/expert/periods/:id",
    "/api/v1/platform/accounting/expert/bank/import",
    "/api/v1/platform/accounting/expert/bank/:id/match",
    "/api/v1/platform/accounting/expert/fec"
  ])assert.ok(server.includes(route),route);
  assert.match(server,/platform\.accounting_expert\.refresh/);
  assert.match(server,/platform\.accounting_expert\.entry_validate/);
  assert.match(server,/platform\.accounting_expert\.entry_reverse/);
  assert.match(server,/platform\.accounting_expert\.bank_import/);
  assert.match(server,/platform\.accounting_expert\.bank_match/);
  assert.match(server,/requireCsrf\(req,actor,config\)/);
});

test("le cockpit expose un vrai dossier de révision pour l expert-comptable",()=>{
  assert.match(cockpit,/import\("\.\/accounting-expert\.js"\)/);
  assert.match(cockpit,/data-accounting-expert-root/);
  for(const label of [
    "Dossier expert-comptable",
    "Balance CSV",
    "Grand livre CSV",
    "Dossier JSON",
    "Exporter FEC",
    "Paramètres fiscaux et identité",
    "Écritures sources à qualifier",
    "Écriture manuelle simple",
    "Journal validé et contrepassations",
    "Clôtures mensuelles",
    "Rapprochement bancaire",
    "Importer CSV bancaire"
  ])assert.ok(expert.includes(label),label);
  assert.match(expert,/data-accx-journal/);
  assert.match(expert,/data-accx-debit/);
  assert.match(expert,/data-accx-credit/);
  assert.match(expert,/startsWith\("512"\)/);
  assert.match(expert,/confirm\("Valider définitivement/);
});

test("les nouveaux modules sont livrés et contrôlés par les vérifications",()=>{
  assert.ok(build.includes('"assets/accounting-expert.js"'));
  assert.match(pkg.scripts["check:js"],/assets\/accounting-expert\.js/);
  assert.match(pkg.scripts["check:backend"],/backend\/src\/accounting-expert\.mjs/);
  assert.match(pkg.scripts["verify:vercel"],/expert-accounting\.test\.mjs/);
});

test("les nouveaux fichiers respectent la convention sans tiret cadratin",()=>{
  for(const source of [migration,service,server,cockpit,expert])assert.equal(source.includes(String.fromCodePoint(0x2014)),false);
});
