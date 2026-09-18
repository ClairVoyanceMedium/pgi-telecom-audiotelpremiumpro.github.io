import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const forbiddenNames = [/^\.env(\.|$)/i, /id_rsa/i, /id_ed25519/i, /\.p12$/i, /\.pfx$/i, /\.key$/i, /\.pem$/i];
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9_]{30,}/,
  /sk_live_[A-Za-z0-9]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{20,}/
];

const skip = new Set([".git", "node_modules"]);
const textExt = new Set([".html",".css",".js",".mjs",".json",".md",".yml",".yaml",".sql",".xml",".txt"]);

function walk(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    if (skip.has(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (forbiddenNames.some(r => r.test(entry.name))) {
      console.error("Fichier sensible interdit:", path.relative(root,p));
      process.exit(1);
    }
    if (entry.isDirectory()) walk(p);
    else if (textExt.has(path.extname(entry.name).toLowerCase())) {
      const content = fs.readFileSync(p, "utf8");
      for (const pattern of secretPatterns) {
        if (pattern.test(content)) {
          console.error("Secret potentiel détecté dans:", path.relative(root,p));
          process.exit(1);
        }
      }
    }
  }
}

walk(root);
console.log("Secret scan: OK");
