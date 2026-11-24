#!/usr/bin/env node
// Assembles the entire ORE format as one document, in two forms:
//
//   /llms.txt        Markdown: authoring guide, every-field table, human spec,
//                    data dictionary, validation rules, normative JSON Schemas,
//                    one annotated example.
//   /reference.html  The same content as a static HTML page, plus every example
//                    inline. Linked from the home page so search engines index
//                    it: AI tools that can only fetch indexed pages reach the
//                    whole format from this one URL (issue 61).
//
// Regenerate after any spec change:  node spec/build-llms-txt.mjs
// (wired to `npm run llms`; CI fails if the committed outputs are stale).

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { fieldTableMarkdown } from "./field-table.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const read = (p) => readFileSync(join(root, p), "utf8").trim();

const FORMAT_VERSION = "0.1.0";

const preamble = `# ORE (Open Real Estate) — format reference for LLMs

This is the complete definition of the ORE \`.ore\` file format, version ${FORMAT_VERSION},
assembled as a single document you can read or author from. ORE is an open,
JSON-based format for commercial real estate underwriting data, for any property type.

## How to use this document

- **Reading a \`.ore\` file:** it is standard JSON. Every field name spells out its
  units (\`clearHeightFt\`, \`amountPerSF\`, \`...Percent\`) and conventions are declared
  in the file (e.g. \`baseRent.unit\`), never inferred. You can reason over a \`.ore\`
  file directly. Do NOT compute a multi-year DCF by hand — arithmetic over monthly
  cash flows is the engine's job, not yours; see "Calculation" below.
- **Authoring a \`.ore\` file:** produce one self-contained JSON object conforming to
  the schemas below. \`formatVersion\`, \`property\`, and \`rentRoll\` are required; every
  other module is optional. Validate your output against the JSON Schema and run it
  through the reference engine before trusting any computed figure.

## Core rules

1. A deal is a SINGLE self-contained \`.ore\` file. Modules are top-level keys of one
   JSON object, never separate files. Calculation assumptions travel WITH the data.
2. \`formatVersion\` must be \`${FORMAT_VERSION}\` (semver; this document defines 0.1.x).
3. Optionally include a root \`$schema\` URL so any reader resolves definitions from
   the file alone: \`"$schema": "https://oreformat.org/schema/${FORMAT_VERSION}/ore.schema.json"\`.
4. Dates are ISO 8601 (\`YYYY-MM-DD\`). Money is USD. Percentages are percent values
   (\`3.5\` = 3.5%) except ratios documented as decimals. Areas are square feet; land is acres.
5. The file carries INPUTS ONLY. Outputs (NOI, DCF, IRR) are never stored in the
   file; they are produced by a conforming engine from the inputs.
6. A field the schema does not define is an ERROR: never invent a field name.
   If you need to keep something the format has no field for, put it in a key
   starting with \`x-\` (e.g. \`"x-acme-dealCode": "D-41"\`) on the object it
   describes. Every reader ignores \`x-\` keys, so they never change a number; if
   the value should change the math, say so in \`notes\` instead.
7. Lease-up and later rollovers can use different leasing profiles. A space's
   profile prices the first lease generated for it; set \`rolloverProfile\` on that
   profile to name the profile for every expiry after that (e.g. a 24-month
   \`lease_up\` profile rolling into a 9-month \`general\` one).

## Calculation

ORE ships an open-source TypeScript reference engine that consumes a \`.ore\` file and
produces NOI, monthly/annual cash flows, direct cap and DCF value, debt schedule,
levered/unlevered IRR, and sensitivity — with a first-class \`warnings\` array naming
any simplification or estimate it applied. Conformance is defined by golden-file
tests: a conforming implementation reproduces locked expected outputs exactly. When
an LLM needs a number from a \`.ore\` file, call the engine (or the forthcoming
\`@ore-format/mcp\` server) rather than computing it yourself.

## Scope (v0.1)

US property of any type: set \`property.propertyType\` to what the property is.
NNN/NN/modified-gross/gross leases. The valuation module carries inputs for all
four approaches (DCF, direct cap, sales comparison, cost); the v0.1 engine computes
DCF and direct cap. The engine is deepest on industrial and names, in a
\`property_type_coverage\` warning, what it has not modeled for other types. Not
yet modeled: retail percentage rent, office load factors and gross-up, hotel
operations, international conventions, debt waterfalls.

## Property that is not industrial

- **Office, retail, medical office:** write leases exactly as for industrial. Omit
  physical fields that do not apply (clear height, dock doors). If the source has
  percentage rent, parking income, or a load factor, put it in the lease or
  property \`notes\`: there is no structured field yet, and you must not invent one.
- **Multifamily, student housing, self-storage, manufactured housing:** there is no
  unit mix in the format yet. Write ONE LEASE PER UNIT:
  \`baseRent.unit: "total_per_month"\` with the unit's monthly rent,
  \`reimbursement.structure: "gross"\`, \`escalation.type: "none"\`, the unit number
  in \`suite\`, and a \`spaceType\` naming the unit type (\`one_bed\`, \`two_bed\`).
  Give each unit type a leasing profile with a 12-month term; market rent is stated
  per square foot, so divide the monthly market rent by the unit size. Vacant units
  go in \`vacantSuites\`. Set \`property.physical.unitCount\`. Identify residents by
  unit ("Unit 2A resident"), NEVER by name. Put other income (parking, laundry,
  fees) in \`rentRoll.notes\` until the format has a field for it. If the source
  gives only a unit-mix summary and no unit-level rent roll, write one lease per
  unit at the average rent for its type and say so in \`rentRoll.notes\`.
- **Outside the US:** addresses must currently be US. Say so and stop; do not
  force a foreign address into US fields.

## After you write a file: check your own work

A file can validate and still be wrong. Models extracting from an offering
memorandum tend to drop the hard parts without saying so. Before you hand over a
file you authored from a source document, do all four:

1. **Reconcile against the source.** Show a table of file versus source for: suite
   or unit count, total leased SF, annual base rent, total recoveries, total
   operating expenses, and NOI. Give both numbers and the difference. For each
   mismatch, say whether you misread the source or the source disagrees with itself.
2. **Account for the commonly dropped items.** For each lease, state whether the
   source mentions: free rent, renewal or termination options, expense stops or
   base years, expense caps, a security deposit, unfunded tenant improvements or
   commissions. "Not mentioned in the source" is an acceptable answer. Silence is not.
3. **Disclose authorship.** Fill \`provenance\`: who or what generated the file,
   when, and every source document with its date.
4. **Do not invent assumptions.** If the source gives no discount rate, exit cap,
   or market rent, leave that module out and say so. Do not supply your own.

---
`;

const REPO = "https://github.com/graham1776/Open-Real-Estate";
const SITE = "https://graham1776.github.io/Open-Real-Estate";

const fieldsSection =
  "# Every field\n\n" +
  "Generated from the JSON Schemas: every path a file can carry. `[]` is an array item; " +
  "`<key>` is a key you choose (a leasing profile name). **Req.** means required whenever its " +
  "parent object is present. A field not in this table is an error, except keys starting " +
  "with `x-` (see \"Unknown fields and extensions\" in the spec below). The JSON Schemas at " +
  "the end are authoritative.\n\n" +
  fieldTableMarkdown();

// Relative links in a repo document, rewritten to absolute GitHub URLs so they
// still work when the text is read anywhere else.
function absolutize(md, docPath) {
  const dir = posix.dirname(docPath);
  return md.replace(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g, (_, link) => {
    const target = posix.normalize(posix.join(dir, link));
    return `](${REPO}/blob/main/${target})`;
  });
}
const doc = (p) => absolutize(read(p), p);

const sections = [];
sections.push(preamble);
sections.push(fieldsSection);
sections.push("# Human specification\n\n" + doc("spec/README.md"));
sections.push("# Data dictionary\n\n" + doc("spec/data-dictionary.md"));
sections.push("# Validation rules\n\n" + doc("spec/validation.md"));

// Normative schemas, ordered with the root first.
const schemaDir = "spec/schema";
const schemaFiles = readdirSync(join(root, schemaDir)).filter((f) => f.endsWith(".schema.json"));
schemaFiles.sort((a, b) => (a === "ore.schema.json" ? -1 : b === "ore.schema.json" ? 1 : a.localeCompare(b)));
const schemaBlocks = schemaFiles
  .map((f) => `### ${f}\n\n\`\`\`json\n${read(join(schemaDir, f))}\n\`\`\``)
  .join("\n\n");
const schemaSection = "# Normative JSON Schemas (draft 2020-12)\n\nThese are authoritative; prose above is explanatory.\n\n" + schemaBlocks;
sections.push(schemaSection);

// One fully populated example.
sections.push(
  "# Annotated example\n\n" +
  "A complete, valid `.ore` file populating every module (synthetic data). This is " +
  "the single-tenant NNN example from the repository; study it as a template.\n\n" +
  "```json\n" + read("examples/single-tenant-nnn.ore") + "\n```"
);

const out = sections.join("\n\n---\n\n") + "\n";
writeFileSync(join(root, "llms.txt"), out);
const kb = Math.round(Buffer.byteLength(out) / 1024);
console.log(`Wrote llms.txt (${kb} KB, ${out.split("\n").length} lines).`);

// ---- reference.html: the same content, every example inline, schemas last.
const exampleFiles = readdirSync(join(root, "examples")).filter((f) => f.endsWith(".ore")).sort();
const examplesSection =
  "# Examples\n\n" +
  "Every example deal in the repository, inline. All data is synthetic. Each validates " +
  "against the schemas below and has locked engine outputs. " +
  `Open any of them in the [viewer](${SITE}/demo/) to see the computed deal.\n\n` +
  absolutize(read("examples/README.md").replace(/^# .*\n/, ""), "examples/README.md") + "\n\n" +
  exampleFiles.map((f) => `## ${f}\n\n\`\`\`json\n${read(join("examples", f))}\n\`\`\``).join("\n\n");

const htmlSections = [
  ["guide", preamble.replace(/\n---\n*$/, "")],
  ["fields", fieldsSection],
  ["spec", sections[2]],
  ["dictionary", sections[3]],
  ["validation", sections[4]],
  ["examples", examplesSection],
  ["schemas", schemaSection],
];
const toc = [
  ["guide", "How to read and write a .ore file"],
  ["fields", "Every field"],
  ["spec", "Specification"],
  ["dictionary", "Data dictionary"],
  ["validation", "Validation rules"],
  ["examples", "Examples"],
  ["schemas", "JSON Schemas"],
];
const escapeHtml = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const body = htmlSections
  .map(([id, md]) => `<section id="${id}">\n${marked.parse(md, { gfm: true })}</section>`)
  .join("\n<hr>\n");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ORE format reference</title>
<meta name="description" content="The complete ORE (Open Real Estate) file format on one page: how to read and write a .ore file, every field with its type and allowed values, the specification, data dictionary, validation rules, every example deal, and the JSON Schemas.">
<link rel="canonical" href="${SITE}/reference.html">
<link rel="alternate" type="text/plain" href="${SITE}/llms.txt" title="Same content as plain text">
<style>
  :root { --ink: #1a2433; --muted: #5b6b80; --line: #dfe5ec; --bg: #f6f8fa; --card: #ffffff; --accent: #0b5fff; --code-bg: #eef2f6; }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #e3e9f1; --muted: #9aa8ba; --line: #2b3646; --bg: #11161d; --card: #171e27; --accent: #7cb0ff; --code-bg: #1d2633; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.55 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: var(--ink); background: var(--bg); }
  header, main { max-width: 1100px; margin: 0 auto; padding: 0 16px; }
  header { padding-top: 28px; }
  header p { color: var(--muted); margin: 6px 0; }
  nav.toc { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px 16px; margin: 16px 0 8px; }
  nav.toc { display: flex; flex-wrap: wrap; gap: 4px 16px; }
  nav.toc a { white-space: nowrap; }
  a { color: var(--accent); }
  h1 { font-size: 28px; line-height: 1.2; margin: 28px 0 10px; }
  h2 { font-size: 21px; margin: 26px 0 8px; }
  h3 { font-size: 17px; margin: 20px 0 6px; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 36px 0; }
  code { font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--code-bg); padding: 1px 4px; border-radius: 4px; overflow-wrap: anywhere; }
  pre { background: var(--code-bg); padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
  pre code { padding: 0; background: none; overflow-wrap: normal; }
  table { border-collapse: collapse; display: block; overflow-x: auto; font-size: 14px; margin: 12px 0; }
  th, td { border: 1px solid var(--line); padding: 5px 8px; vertical-align: top; text-align: left; }
  th { background: var(--card); }
  #fields { overflow-x: auto; }
  #fields table { display: table; width: 100%; min-width: 860px; table-layout: fixed; }
  #fields th:nth-child(1) { width: 25%; } #fields th:nth-child(2) { width: 8%; } #fields th:nth-child(3) { width: 5%; }
  #fields th:nth-child(4) { width: 20%; } #fields th:nth-child(5) { width: 7%; } #fields th:nth-child(6) { width: 35%; }
</style>
</head>
<body>
<header>
  <h1 style="margin-top:0">ORE format reference</h1>
  <p>The complete ORE (Open Real Estate) file format, version ${FORMAT_VERSION}, on one page. A <code>.ore</code> file is a JSON document; this page is everything needed to read one, write one, and check it, with no other file or tool. Generated from the repository by <code>npm run llms</code>; the same content is at <a href="llms.txt">llms.txt</a>.</p>
  <p><a href="./">ORE home</a> · <a href="demo/">Viewer</a> · <a href="${REPO}">GitHub</a></p>
  <nav class="toc">${toc.map(([id, t]) => `<a href="#${id}">${escapeHtml(t)}</a>`).join("")}</nav>
</header>
<main>
${body}
</main>
</body>
</html>
`;
writeFileSync(join(root, "reference.html"), html);
console.log(`Wrote reference.html (${Math.round(Buffer.byteLength(html) / 1024)} KB).`);
