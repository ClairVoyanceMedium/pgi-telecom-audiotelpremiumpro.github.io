import fs from "node:fs";
import path from "node:path";

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

    const file=await resolveStaticFile(root,pathname);
    if(!file)return false;

    const stat=await fs.promises.stat(file);
    const ext=path.extname(file).toLowerCase();
    const runtimeConfig=/\/assets\/(?:config|client-config)\.js$/.test(file);
    const html=ext===".html";
    res.setHeader("Content-Type",MIME[ext]||"application/octet-stream");
    res.setHeader("Content-Length",String(stat.size));
    res.setHeader("Cache-Control",runtimeConfig||html?"no-store":"public, max-age=300");
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
