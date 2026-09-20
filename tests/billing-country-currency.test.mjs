import test from "node:test";
import assert from "node:assert/strict";
import {billingCurrencyCatalog,resolveBillingCurrency,BILLING_CURRENCY_CATALOG_VERSION} from "../backend/src/billing-country-currency.mjs";

test("country billing currency catalog covers the international signup selector",()=>{
  const catalog=billingCurrencyCatalog();
  assert.equal(Object.keys(catalog).length,249);
  assert.equal(BILLING_CURRENCY_CATALOG_VERSION,"2026-09-20");
});

test("major customer countries resolve to their local billing currency",()=>{
  const expected={FR:"EUR",BE:"EUR",LU:"EUR",ES:"EUR",IT:"EUR",PT:"EUR",DE:"EUR",GB:"GBP",US:"USD",CA:"CAD",CH:"CHF",BR:"BRL",SE:"SEK",NO:"NOK",DK:"DKK",PL:"PLN",JP:"JPY",AU:"AUD",MA:"MAD",TN:"TND",DZ:"DZD"};
  for(const [country,currency] of Object.entries(expected))assert.equal(resolveBillingCurrency(country)?.currency,currency,country);
});

test("2026 ISO 4217 changes and multi-currency territories stay explicit",()=>{
  assert.equal(resolveBillingCurrency("BG")?.currency,"EUR");
  assert.equal(resolveBillingCurrency("CW")?.currency,"XCG");
  assert.equal(resolveBillingCurrency("SX")?.currency,"XCG");
  assert.equal(resolveBillingCurrency("XK")?.currency,"EUR");
  assert.deepEqual(resolveBillingCurrency("PA")?.accepted_currencies,["USD","PAB"]);
  assert.deepEqual(resolveBillingCurrency("ZW")?.accepted_currencies,["USD","ZWG"]);
  assert.equal(resolveBillingCurrency("??"),null);
});
