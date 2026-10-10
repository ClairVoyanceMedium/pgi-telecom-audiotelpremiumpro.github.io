import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const excludedDirectories = new Set([".git","node_modules",".vercel",".next",".cache","coverage","vendor"]);
const sourceExtensions = new Set([".html",".htm",".js",".mjs",".cjs",".jsx",".ts",".tsx",".css",".scss",".json",".webmanifest",".xml",".svg",".md",".txt",".sql",".sh",".yml",".yaml",".toml",".env",".graphql"]);
const specialFiles = new Set(["Dockerfile","Dockerfile.vercel",".gitignore","Procfile","Makefile",".env.example"]);
const forbiddenCharacter = String.fromCodePoint(0x2014);
const forbiddenHtmlEntity = /&(?:mdash|#0*8212|#x0*2014);/i;

function scan(directory,violations) {
  for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
    const fullPath = path.join(directory,entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) scan(fullPath,violations);
      continue;
    }
    if (!entry.isFile() || !(sourceExtensions.has(path.extname(entry.name).toLowerCase()) || specialFiles.has(entry.name))) continue;
    const source = fs.readFileSync(fullPath,"utf8");
    const relativePath = path.relative(process.cwd(),fullPath);
    const matchIndex = source.indexOf(forbiddenCharacter);
    if (matchIndex >= 0) {
      const line = source.slice(0,matchIndex).split("\n").length;
      violations.push(relativePath + ":" + line + " contains the forbidden character");
    }
    if (/\.(?:html?|xml|svg)$/i.test(entry.name) && forbiddenHtmlEntity.test(source)) {
      violations.push(relativePath + " contains an encoded HTML em dash");
    }
  }
}

test("no em dash in tracked source surfaces, SEO markup, templates and generated text files",()=>{
  const violations=[];
  scan(process.cwd(),violations);
  assert.deepEqual(violations,[],"Replace forbidden punctuation with a hyphen, comma, colon, or period.");
});
