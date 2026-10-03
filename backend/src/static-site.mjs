import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";

const PRIVATE_CSP="default-src 'self'; script-src 'self' https://accounts.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://lh3.googleusercontent.com; connect-src 'self' https://accounts.google.com https://www.googleapis.com; frame-src https://accounts.google.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests";
const COCKPIT_CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests";
const VALIDATOR_CACHE=new Map();

const PUBLIC_CSP="default-src 'self'; script-src 'self' 'unsafe-inline' https://*.hs-scripts.com https://*.hs-analytics.net https://*.hubspot.com https://*.usemessages.com https://js-eu1.hs-banner.com https://js-eu1.hscollectedforms.net https://www.googletagmanager.com; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.hubspot.com https://forms-eu1.hsforms.com https://www.google-analytics.com; connect-src 'self' https://*.hubspot.com https://*.hubapi.com https://*.hsforms.com https://forms-eu1.hscollectedforms.net https://www.google-analytics.com https://region1.google-analytics.com https://www.googletagmanager.com; frame-src https://*.hubspot.com; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests";

const MIME=Object.freeze({
  ".html":"text/html; charset=utf-8",
  ".css":"text/css; charset=utf-8",
  ".js":"text/javascript; charset=utf-8",
  ".json":"application/json; charset=utf-8",
  ".xml":"application/xml; charset=utf-8",
  ".webmanifest":"application/manifest+json; charset=utf-8",
  ".png":"image/png",
  ".webp":"image/webp",
  ".svg":"image/svg+xml",
  ".ico":"image/x-icon",
  ".txt":"text/plain; charset=utf-8"
});

export function createStaticSiteHandler(rootDir){
  const root=String(rootDir||"").trim()?path.resolve(String(rootDir)):null;
  return async function serveStaticSite(req,res,pathname){
    if(!root)return false;
    const method=String(req?.method||"GET").toUpperCase();
    if(method!=="GET"&&method!=="HEAD")return false;
    if(pathname==="/metrics"||String(pathname||"").startsWith("/api/"))return false;

    if(["/favicon.ico","/favicon.png"].includes(String(pathname||""))){
      res.writeHead(308,{"Location":"/assets/audiotel-brand-icon-v33.png","Cache-Control":"public, max-age=86400"});
      res.end();
      return true;
    }
    if(["/site","/site/","/site/index.html","/index.html"].includes(String(pathname||""))){
      res.writeHead(308,{"Location":"/","Cache-Control":"no-store"});
      res.end();
      return true;
    }
    if(["/admin","/admin/","/admin.html"].includes(String(pathname||""))){
      res.writeHead(308,{"Location":"/cockpit","Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow, noarchive"});
      res.end();
      return true;
    }
    if(String(pathname||"")==="/cockpit/"){
      res.writeHead(308,{"Location":"/cockpit","Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow, noarchive"});
      res.end();
      return true;
    }

    const legalSlugs=new Set([
      "mentions-legales",
      "conditions-utilisation",
      "conditions-abonnement",
      "confidentialite",
      "accord-traitement-donnees",
      "cookies-traceurs",
      "resilier-contrat",
      "retractation"
    ]);
    const rawPath=String(pathname||"");
    const legalMatch=rawPath.match(/^\/([^/]+?)(?:\.html)?\/?$/);
    if(legalMatch&&legalSlugs.has(legalMatch[1])&&rawPath!=="/"+legalMatch[1]+"/"){
      res.writeHead(308,{"Location":"/"+legalMatch[1]+"/","Cache-Control":"no-store"});
      res.end();
      return true;
    }

    const requestedPath=String(pathname||"")==="/cockpit"?"/cockpit.html":pathname;
    const file=await resolveStaticFile(root,requestedPath);
    if(!file)return false;

    const stat=await fs.promises.stat(file);
    const ext=path.extname(file).toLowerCase();
    const runtimeConfig=/\/assets\/(?:config|client-config)\.js$/.test(file);
    const html=ext===".html";
    const requestPath=String(pathname||"");
    const clientUi=requestPath==="/client.html";
    const cockpitUi=["/cockpit","/cockpit/","/cockpit.html"].includes(requestPath);
    const privateUi=clientUi||cockpitUi;
    const versionedAsset=!runtimeConfig&&!html&&/\.(?:css|js|png|webp|svg|ico)$/i.test(requestPath)&&/[?&]v=[A-Za-z0-9._-]{1,32}(?:&|$)/.test(String(req?.url||""));
    res.setHeader("Content-Type",MIME[ext]||"application/octet-stream");
    if(runtimeConfig||privateUi)res.setHeader("Cache-Control","no-store");
    else if(html)res.setHeader("Cache-Control","public, max-age=0, s-maxage=300, stale-while-revalidate=60");
    else if(versionedAsset)res.setHeader("Cache-Control","public, max-age=31536000, immutable");
    else res.setHeader("Cache-Control","public, max-age=300, stale-while-revalidate=60");
    if(clientUi)res.setHeader("Content-Security-Policy",PRIVATE_CSP);
    else if(cockpitUi)res.setHeader("Content-Security-Policy",COCKPIT_CSP);
    else if(html)res.setHeader("Content-Security-Policy",PUBLIC_CSP);
    if(privateUi)res.setHeader("X-Robots-Tag","noindex, nofollow, noarchive");

    if(!runtimeConfig&&!privateUi){
      const {etag,lastModified}=await publicValidators(file,stat);
      res.setHeader("ETag",etag);
      res.setHeader("Last-Modified",lastModified);
      if(isNotModified(req,etag,stat.mtimeMs)){
        res.writeHead(304);
        res.end();
        return true;
      }
    }

    res.setHeader("Content-Length",String(stat.size));
    if(method==="HEAD"){res.writeHead(200);res.end();return true;}
    res.writeHead(200);
    await new Promise((resolve,reject)=>{
      const stream=fs.createReadStream(file);
      stream.on("error",reject);
      res.on("close",resolve);
      stream.on("end",resolve);
      stream.pipe(res);
    });
    return true;
  };
}

async function resolveStaticFile(root,pathname){
  let decoded;
  try{decoded=decodeURIComponent(String(pathname||"/"));}
  catch{return null;}
  if(!decoded.startsWith("/")||decoded.includes("\0"))return null;
  if(decoded==="/")decoded="/index.html";
  if(decoded.endsWith("/"))decoded+="index.html";

  const segments=decoded.split("/");
  if(segments.some(x=>x===".."||x==="."))return null;
  const candidate=path.resolve(root,"."+decoded);
  if(candidate!==root&&!candidate.startsWith(root+path.sep))return null;
  try{
    const stat=await fs.promises.stat(candidate);
    if(!stat.isFile())return null;
    return candidate;
  }catch{return null;}
}


async function publicValidators(file,stat){
  const key=file+":"+stat.size+":"+Math.trunc(stat.mtimeMs);
  const cached=VALIDATOR_CACHE.get(key);
  if(cached)return cached;
  const digest=createHash("sha256").update(await fs.promises.readFile(file)).digest("hex");
  const value={etag:'"sha256-'+digest+'"',lastModified:stat.mtime.toUTCString()};
  VALIDATOR_CACHE.set(key,value);
  return value;
}

function isNotModified(req,etag,mtimeMs){
  const noneMatch=String(req?.headers?.["if-none-match"]||"").trim();
  if(noneMatch){
    if(noneMatch==="*")return true;
    return noneMatch.split(",").map(x=>x.trim().replace(/^W\//,"")).includes(etag);
  }
  const modifiedSince=String(req?.headers?.["if-modified-since"]||"").trim();
  if(!modifiedSince)return false;
  const timestamp=Date.parse(modifiedSince);
  if(!Number.isFinite(timestamp))return false;
  return Math.floor(Number(mtimeMs)/1000)*1000<=timestamp;
}
