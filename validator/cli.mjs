#!/usr/bin/env node
// ORE validator CLI — validate / summarize / compute for .ore files.
// Wraps the published JSON Schema (/spec/schema) and the reference engine
// (/engine): the same checks the browser viewer runs, packaged for the shell.
//
//   ore validate deal.ore [more.ore | dir ...]
//   ore summarize deal.ore [more.ore ...] [--json]
//   ore compute deal.ore
//
// In-repo: node validator/cli.mjs <command> ...  (or npm run cli -- <command> ...)

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { computeAll, lint, ENGINE_VERSION } from "../engine/dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const CLI_VERSION = JSON.parse(readFileSync(join(here, "package.json"), "utf8")).version;

// ---------- shared plumbing ----------

function buildSchemaValidator() {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  const schemaDir = join(root, "spec", "schema");
  for (const f of readdirSync(schemaDir).filter((f) => f.endsWith(".schema.json"))) {
    ajv.addSchema(JSON.parse(readFileSync(join(schemaDir, f), "utf8")));
  }
  return ajv.getSchema("https://oreformat.org/schema/0.1.0/ore.schema.json");
}

// Expand args to a flat list of .ore files (directories are scanned one level).
function collectFiles(args) {
  const files = [];
  for (const a of args) {
    let st;
    try {
      st = statSync(a);
    } catch {
      fail(`No such file or directory: ${a}`);
    }
    if (st.isDirectory()) {
      const found = readdirSync(a).filter((f) => f.endsWith(".ore")).sort();
      if (found.length === 0) fail(`No .ore files in directory: ${a}`);
      files.push(...found.map((f) => join(a, f)));
    } else {
      files.push(a);
    }
  }
  return files;
}

// Parse + schema + lint. Returns { deal, schemaErrors, problems } — deal is null
// only when the file isn't JSON at all.
function checkFile(path, validateSchema) {
  let deal;
  try {
    deal = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { deal: null, schemaErrors: [], problems: [], parseError: `Not valid JSON: ${e.message}. A .ore file is standard JSON — check for trailing commas or comments.` };
  }
  const schemaErrors = validateSchema(deal) ? [] : validateSchema.errors.map((e) => `${e.instancePath || "/"} ${e.message}`);
  return { deal, schemaErrors, problems: lint(deal), parseError: null };
}

function isBlocked(r) {
  return r.parseError != null || r.schemaErrors.length > 0 || r.problems.some((p) => p.code !== "advice");
}

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(2);
}

// ---------- validate ----------

function cmdValidate(paths) {
  const validateSchema = buildSchemaValidator();
  let failures = 0;
  for (const path of collectFiles(paths)) {
    const r = checkFile(path, validateSchema);
    const name = basename(path);
    if (isBlocked(r)) {
      failures++;
      console.error(`FAIL  ${name}`);
      if (r.parseError) console.error(`      ${r.parseError}`);
      for (const e of r.schemaErrors) console.error(`      schema: ${e}`);
      for (const p of r.problems.filter((p) => p.code !== "advice")) console.error(`      ${p.code}: ${p.message}`);
    } else {
      console.log(`PASS  ${name}`);
    }
    for (const p of (r.problems ?? []).filter((p) => p.code === "advice")) {
      console.log(`      advice: ${p.message}`);
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

// ---------- summarize ----------

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money = (v) => (v == null ? "—" : usd0.format(v));
const num = (v) => (v == null ? "—" : nf0.format(v));
const pct = (v, d = 1) => (v == null ? "—" : `${v.toFixed(d)}%`);
const rentPSF = (v) => (v == null ? "—" : `$${v.toFixed(2)}/SF/mo`);

function summarizeOne(path, out) {
  const p = out.property, o = out.occupancy, r = out.rent, lm = out.leaseMetrics;
  const lines = [];
  lines.push(`${basename(path)} — ${p.name}, ${p.cityState}`);
  const phys = [`${num(p.buildingSF)} SF`];
  if (p.yearBuilt != null) phys.push(`built ${p.yearBuilt}`);
  if (p.clearHeightFt != null) phys.push(`${p.clearHeightFt} ft clear`);
  lines.push(`  Building       ${phys.join(" · ")}`);
  lines.push(`  Occupancy      ${pct(o.occupancyPercent)} (${num(o.occupiedSF)} SF occupied, ${num(o.vacantSF)} SF vacant)`);
  if (lm.waltYearsByRent != null) {
    lines.push(`  WALT           ${lm.waltYearsByRent.toFixed(1)} yrs by rent · roll next 12 mo: ${pct(lm.rollNext12ByRentPercent)} of rent`);
  }
  const vsMkt = r.inPlaceVsMarketPercent == null ? "" : ` (${r.inPlaceVsMarketPercent >= 0 ? "+" : ""}${r.inPlaceVsMarketPercent.toFixed(1)}% vs market)`;
  lines.push(`  In-place rent  ${rentPSF(r.inPlaceWARentPerSFPerMonth)} · market ${rentPSF(r.marketRentPerSFPerMonth)}${vsMkt}`);
  lines.push(`  Year 1 NOI     ${money(out.noi.year1NOI)}${out.noi.stabilizedAtMarketNOI != null ? ` · stabilized at market ${money(out.noi.stabilizedAtMarketNOI)}` : ""}`);
  if (out.directCap) {
    lines.push(`  Direct cap     ${money(out.directCap.indicatedValue)} (${money(out.directCap.perSF)}/SF @ ${pct(out.directCap.capRatePercent, 2)}, ${out.directCap.basis})`);
  }
  if (out.dcf) {
    lines.push(`  DCF            ${money(out.dcf.indicatedValue)} (${money(out.dcf.perSF)}/SF @ ${pct(out.dcf.discountRatePercent, 2)} discount, ${Math.round(out.dcf.holdMonths / 12)}-yr hold)`);
  }
  if (out.concluded.value != null) {
    lines.push(`  Concluded      ${money(out.concluded.value)} (${out.concluded.source})`);
  }
  const rets = [];
  if (out.returns.unlevered?.irrPercent != null) rets.push(`${pct(out.returns.unlevered.irrPercent)} unlevered IRR`);
  if (out.returns.levered?.irrPercent != null) rets.push(`${pct(out.returns.levered.irrPercent)} levered IRR`);
  if (rets.length) lines.push(`  Returns        ${rets.join(" · ")}`);
  lines.push(`  Warnings       ${out.warnings.length}${out.warnings.length ? " (see `compute` output for detail)" : ""}`);
  return lines.join("\n");
}

function cmdSummarize(paths, asJson) {
  const validateSchema = buildSchemaValidator();
  const results = [];
  for (const path of collectFiles(paths)) {
    const r = checkFile(path, validateSchema);
    if (isBlocked(r)) {
      console.error(`error: ${basename(path)} fails validation — run \`validate\` for detail.`);
      process.exit(1);
    }
    results.push({ path, out: computeAll(r.deal) });
  }
  if (asJson) {
    const strip = ({ path, out }) => ({
      file: basename(path),
      property: out.property,
      occupancy: out.occupancy,
      leaseMetrics: out.leaseMetrics,
      rent: out.rent,
      noi: out.noi,
      directCap: out.directCap,
      dcf: out.dcf,
      returns: out.returns,
      concluded: out.concluded,
      warningCount: out.warnings.length,
    });
    const payload = results.map(strip);
    console.log(JSON.stringify(payload.length === 1 ? payload[0] : payload, null, 2));
  } else {
    console.log(results.map(({ path, out }) => summarizeOne(path, out)).join("\n\n"));
  }
}

// ---------- compute ----------

function cmdCompute(paths) {
  if (paths.length !== 1) fail("compute takes exactly one .ore file.");
  const validateSchema = buildSchemaValidator();
  const r = checkFile(paths[0], validateSchema);
  if (isBlocked(r)) {
    console.error(`error: ${basename(paths[0])} fails validation — run \`validate\` for detail.`);
    process.exit(1);
  }
  console.log(JSON.stringify(computeAll(r.deal), null, 2));
}

// ---------- entry ----------

const USAGE = `ORE validator CLI v${CLI_VERSION} (engine v${ENGINE_VERSION})

Usage:
  ore validate <file.ore | dir> [...]   Check files against the JSON Schema and
                                        structural rules. Exit 0 = all pass.
  ore summarize <file.ore> [...] [--json]
                                        Key metrics per deal: occupancy, WALT,
                                        rents, NOI, value, returns.
  ore compute <file.ore>                Full reference-engine output as JSON
                                        (pipe to jq).
  ore --version                         Print version.

A .ore file is standard JSON; the schema lives in /spec/schema and the engine
methodology is open source in /engine.`;

const argv = process.argv.slice(2);
if (argv.includes("--version") || argv.includes("-v")) {
  console.log(`@ore-format/cli ${CLI_VERSION} (engine ${ENGINE_VERSION})`);
  process.exit(0);
}
const [command, ...rest] = argv;
const asJson = rest.includes("--json");
const paths = rest.filter((a) => !a.startsWith("--"));

if (!command || command === "help" || command === "--help" || command === "-h") {
  console.log(USAGE);
  process.exit(command ? 0 : 2);
}
if (!["validate", "summarize", "compute"].includes(command)) {
  fail(`Unknown command: ${command}. Run \`ore help\` for usage.`);
}
if (paths.length === 0) fail(`${command} needs at least one .ore file. Run \`ore help\` for usage.`);

switch (command) {
  case "validate":
    cmdValidate(paths);
    break;
  case "summarize":
    cmdSummarize(paths, asJson);
    break;
  case "compute":
    cmdCompute(paths);
    break;
}
