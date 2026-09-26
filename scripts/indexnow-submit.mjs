import fs from "node:fs";
import path from "node:path";

const HOST="audiotel-premium-pro.com";
const KEY_FILE="fa0a7deb5d60bdf1260c8174ad8c71db.txt";
const root=process.cwd();
const sitemapPath=path.resolve(root,process.argv[2]||"sitemap.xml");
const keyPath=path.resolve(root,KEY_FILE);

if(!fs.existsSync(sitemapPath))throw new Error("Missing sitemap: "+sitemapPath);
if(!fs.existsSync(keyPath))throw new Error("Missing IndexNow key file: "+keyPath);

const key=fs.readFileSync(keyPath,"utf8").trim();
if(!/^[A-Za-z0-9_-]{8,128}$/.test(key))throw new Error("Invalid IndexNow key format");

const xml=fs.readFileSync(sitemapPath,"utf8");
const urls=[...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(x=>x[1].trim());
if(!urls.length)throw new Error("No URLs found in sitemap");
if(urls.some(url=>!url.startsWith("https://"+HOST+"/")))throw new Error("Sitemap contains a non-canonical host");

const payload={
  host:HOST,
  key,
  keyLocation:"https://"+HOST+"/"+KEY_FILE,
  urlList:[...new Set(urls)]
};

const response=await fetch("https://api.indexnow.org/indexnow",{
  method:"POST",
  headers:{"content-type":"application/json; charset=utf-8"},
  body:JSON.stringify(payload)
});

const body=await response.text();
if(![200,202].includes(response.status)){
  throw new Error("IndexNow rejected submission: HTTP "+response.status+(body?" — "+body.slice(0,500):""));
}

console.log("IndexNow notified:",payload.urlList.length,"canonical URLs; status",response.status);
