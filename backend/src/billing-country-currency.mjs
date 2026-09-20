// Country -> preferred billing currency.
// Generated from current tender currencies and kept separate from SVA market activation.
// Reference date: 2026-09-20. Bulgaria uses EUR from 2026-01-01 (ISO 4217 amendment 180).
const groups={
  AED:"AE",AFN:"AF",ALL:"AL",AMD:"AM",AOA:"AO",ARS:"AR",AUD:"AU CC CX HM KI NF NR TV",AWG:"AW",AZN:"AZ",
  BAM:"BA",BBD:"BB",BDT:"BD",BHD:"BH",BIF:"BI",BMD:"BM",BND:"BN",BOB:"BO",BRL:"BR",BSD:"BS",BTN:"BT",BWP:"BW",BYN:"BY",BZD:"BZ",
  CAD:"CA",CDF:"CD",CHF:"CH LI",CLP:"CL",CNY:"CN",COP:"CO",CRC:"CR",CUP:"CU",CVE:"CV",CZK:"CZ",
  DJF:"DJ",DKK:"DK FO GL",DOP:"DO",DZD:"DZ",EGP:"EG",ERN:"ER",ETB:"ET",
  EUR:"AD AT AX BE BG BL CY DE EE ES FI FR GF GP GR HR IE IT LT LU LV MC ME MF MQ MT NL PM PT RE SI SK SM TF VA XK YT",
  FJD:"FJ",FKP:"FK",GBP:"GB GG GS IM JE",GEL:"GE",GHS:"GH",GIP:"GI",GMD:"GM",GNF:"GN",GTQ:"GT",GYD:"GY",
  HKD:"HK",HNL:"HN",HTG:"HT",HUF:"HU",IDR:"ID",ILS:"IL PS",INR:"IN",IQD:"IQ",IRR:"IR",ISK:"IS",
  JMD:"JM",JOD:"JO",JPY:"JP",KES:"KE",KGS:"KG",KHR:"KH",KMF:"KM",KPW:"KP",KRW:"KR",KWD:"KW",KYD:"KY",KZT:"KZ",
  LAK:"LA",LBP:"LB",LKR:"LK",LRD:"LR",LSL:"LS",LYD:"LY",MAD:"EH MA",MDL:"MD",MGA:"MG",MKD:"MK",MMK:"MM",MNT:"MN",MOP:"MO",MRU:"MR",MUR:"MU",MVR:"MV",MWK:"MW",MXN:"MX",MYR:"MY",MZN:"MZ",
  NAD:"NA",NGN:"NG",NIO:"NI",NOK:"BV NO SJ",NPR:"NP",NZD:"CK NU NZ PN TK",OMR:"OM",PEN:"PE",PGK:"PG",PHP:"PH",PKR:"PK",PLN:"PL",PYG:"PY",QAR:"QA",
  RON:"RO",RSD:"RS",RUB:"RU",RWF:"RW",SAR:"SA",SBD:"SB",SCR:"SC",SDG:"SD",SEK:"SE",SGD:"SG",SHP:"SH",SLE:"SL",SOS:"SO",SRD:"SR",SSP:"SS",STN:"ST",SYP:"SY",SZL:"SZ",
  THB:"TH",TJS:"TJ",TMT:"TM",TND:"TN",TOP:"TO",TRY:"TR",TTD:"TT",TWD:"TW",TZS:"TZ",UAH:"UA",UGX:"UG",
  USD:"AS BQ EC FM GU IO MH MP PA PR PW SV TC TL UM US VG VI ZW",
  UYU:"UY",UZS:"UZ",VES:"VE",VND:"VN",VUV:"VU",WST:"WS",
  XAF:"CF CG CM GA GQ TD",XCD:"AG AI DM GD KN LC MS VC",XCG:"CW SX",XOF:"BF BJ CI GW ML NE SN TG",XPF:"NC PF WF",
  YER:"YE",ZAR:"ZA",ZMW:"ZM"
};

const alternatives=Object.freeze({
  BT:["BTN","INR"],
  HT:["HTG","USD"],
  LS:["LSL","ZAR"],
  NA:["NAD","ZAR"],
  PA:["USD","PAB"],
  PS:["ILS","JOD"],
  ZW:["USD","ZWG"]
});

const countryToCurrency={};
for(const [currency,countries] of Object.entries(groups)){
  for(const country of countries.split(" ")){
    if(countryToCurrency[country])throw new Error("Duplicate billing country currency: "+country);
    countryToCurrency[country]=currency;
  }
}
if(Object.keys(countryToCurrency).length!==249)throw new Error("Billing country currency catalog must cover 249 country codes");

export const BILLING_CURRENCY_CATALOG_VERSION="2026-09-20";

export function resolveBillingCurrency(countryCode){
  const country=String(countryCode||"").trim().toUpperCase();
  if(!/^[A-Z]{2}$/.test(country))return null;
  const currency=countryToCurrency[country]||null;
  if(!currency)return null;
  return Object.freeze({
    country_code:country,
    currency,
    accepted_currencies:Object.freeze([...(alternatives[country]||[currency])]),
    source:"country_default",
    catalog_version:BILLING_CURRENCY_CATALOG_VERSION
  });
}

export function billingCurrencyCatalog(){
  return Object.freeze({...countryToCurrency});
}
