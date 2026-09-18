import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync("index.html","utf8");
const app = fs.readFileSync("assets/app.js","utf8");
const css = fs.readFileSync("assets/styles.css","utf8");

test("le nom officiel est présent", () => {
  assert.match(index, /PGI Telecom • Audiotel Premium Pro/);
});

test("les périodes métier principales sont présentes", () => {
  for (const label of ["Aujourd’hui","7 jours","Semaine","Mois","Année"]) assert.ok(index.includes(label));
});

test("les métriques financières critiques sont présentes", () => {
  for (const label of ["CA généré","Reversement attendu","Reversement encaissé","Marge estimée"]) assert.ok(index.includes(label));
});

test("la remise à zéro est non destructive conceptuellement", () => {
  assert.match(index, /ne supprime jamais les CDR/i);
  assert.match(app, /baseline/i);
});

test("le thème PGI contient les couleurs fonctionnelles", () => {
  for (const token of ["--cyan","--green","--amber","--red","--purple"]) assert.ok(css.includes(token));
});


test("le cockpit premium avancé est présent", () => {
  for (const id of [
    "ops-score","traffic-heatmap","call-funnel","quality-mos",
    "overview-expert-ranking","network-donut","finance-waterfall",
    "expert-best","noc-voice-grade","mobile-menu-dialog"
  ]) assert.ok(index.includes('id="'+id+'"'), "missing #"+id);
});

test("les états pré-connexion ne prétendent pas que SIP est actif", () => {
  assert.match(index, /SIP non connecté/i);
  assert.match(index, /NON CONNECTÉ/);
});

test("la navigation mobile donne accès aux opérateurs et au système", () => {
  assert.match(index, /data-view="carriers"/);
  assert.match(index, /data-view="system"/);
});
