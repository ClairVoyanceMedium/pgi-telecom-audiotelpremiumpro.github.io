import puppeteer from "puppeteer-core";

const target="https://audiotel-premium-pro.com/";
const chrome=process.env.CHROME_BIN;
if(!chrome)throw new Error("CHROME_BIN missing");

const browser=await puppeteer.launch({
  executablePath:chrome,
  headless:true,
  args:["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage"]
});
const page=await browser.newPage();
await page.setViewport({width:390,height:844,deviceScaleFactor:1});
const requests=[];
const consoleErrors=[];
const pageErrors=[];

page.on("request",req=>{
  const url=req.url();
  if(/google-analytics\.com|googletagmanager\.com|hubspot|hs-scripts|hs-analytics/i.test(url))requests.push(url);
});
page.on("console",msg=>{if(msg.type()==="error")consoleErrors.push(msg.text())});
page.on("pageerror",err=>pageErrors.push(String(err)));

await page.evaluateOnNewDocument(()=>{
  window.__pgiAuditVitals={lcp:0,lcp_element:null,lcp_url:null,cls:0,inp:0};
  try{
    new PerformanceObserver(list=>{
      for(const e of list.getEntries()){
        if((e.startTime||0)>=window.__pgiAuditVitals.lcp){
          window.__pgiAuditVitals.lcp=e.startTime||0;
          const el=e.element;
          window.__pgiAuditVitals.lcp_element=el?{
            tag:String(el.tagName||"").toLowerCase(),
            id:el.id||"",
            className:typeof el.className==="string"?el.className:"",
            text:String(el.textContent||"").trim().replace(/\s+/g," ").slice(0,180)
          }:null;
          window.__pgiAuditVitals.lcp_url=e.url||null;
        }
      }
    }).observe({type:"largest-contentful-paint",buffered:true});
  }catch(_e){}
  try{
    new PerformanceObserver(list=>{
      for(const e of list.getEntries())if(!e.hadRecentInput)window.__pgiAuditVitals.cls+=(e.value||0);
    }).observe({type:"layout-shift",buffered:true});
  }catch(_e){}
  try{
    new PerformanceObserver(list=>{
      for(const e of list.getEntries())window.__pgiAuditVitals.inp=Math.max(window.__pgiAuditVitals.inp,e.duration||0);
    }).observe({type:"event",buffered:true,durationThreshold:16});
  }catch(_e){}
});

await page.goto(target,{waitUntil:"networkidle2",timeout:60000});
try{
  await page.waitForSelector("[data-consent-accept]",{visible:true,timeout:8000});
  await page.click("[data-consent-accept]");
}catch(_e){}
await new Promise(r=>setTimeout(r,5000));

const browserData=await page.evaluate(()=>{
  const nav=performance.getEntriesByType("navigation")[0];
  return {
    title:document.title,
    url:location.href,
    ttfb_ms:nav?Math.round(nav.responseStart):null,
    dom_content_loaded_ms:nav?Math.round(nav.domContentLoadedEventEnd):null,
    load_ms:nav?Math.round(nav.loadEventEnd):null,
    vitals:window.__pgiAuditVitals||null,
    consent:localStorage.getItem("pgi_tracking_consent_v1")
  };
});

const parsed=requests.map(raw=>{
  try{
    const u=new URL(raw);
    return {
      host:u.hostname,
      path:u.pathname,
      tid:u.searchParams.get("tid")||u.searchParams.get("measurement_id")||"",
      event:u.searchParams.get("en")||"",
      raw
    };
  }catch{return {raw}}
});
const gaCollect=parsed.filter(x=>/google-analytics\.com$/i.test(x.host||"")&&/collect/.test(x.path||""));
const pageViews=gaCollect.filter(x=>x.event==="page_view"&&x.tid==="G-SZY50J75N7");
const gtagLoads=parsed.filter(x=>/googletagmanager\.com$/i.test(x.host||"")&&/gtag\/js/.test(x.path||""));
const gtmLoads=parsed.filter(x=>/googletagmanager\.com$/i.test(x.host||"")&&/gtm\.js/.test(x.path||""));

console.log("PGI_BROWSER_AUDIT="+JSON.stringify({
  ...browserData,
  ga_collect_requests:gaCollect.length,
  ga_page_view_requests:pageViews.length,
  ga_page_view_verdict:pageViews.length===1?"single":pageViews.length===0?"missing":"duplicate",
  gtag_loads:gtagLoads.length,
  gtm_loads:gtmLoads.length,
  console_errors:consoleErrors,
  page_errors:pageErrors,
  ga_requests:gaCollect.map(x=>({host:x.host,path:x.path,tid:x.tid,event:x.event}))
},null,2));

await browser.close();
