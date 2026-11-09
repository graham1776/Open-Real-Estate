#!/usr/bin/env node
// Assembles /llms.txt — the entire ORE format as a single LLM-ingestible
// document: an authoring guide, the human spec, the full data dictionary, the
// normative JSON Schemas, and one annotated example. Regenerate after any spec
// change:  node spec/build-llms-txt.mjs   (wired to `npm run llms`).

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  \`baseRent.unit: "totalPerMonth"\` with the unit's monthly rent,
  \`reimbursement.structure: "Gross"\`, \`escalation.type: "none"\`, the unit number
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

const sections = [];
sections.push(preamble);

sections.push("# Human specification\n\n" + read("spec/README.md"));
sections.push("# Data dictionary\n\n" + read("spec/data-dictionary.md"));

// Normative schemas, ordered with the root first.
const schemaDir = "spec/schema";
const schemaFiles = readdirSync(join(root, schemaDir)).filter((f) => f.endsWith(".schema.json"));
schemaFiles.sort((a, b) => (a === "ore.schema.json" ? -1 : b === "ore.schema.json" ? 1 : a.localeCompare(b)));
const schemaBlocks = schemaFiles
  .map((f) => `### ${f}\n\n\`\`\`json\n${read(join(schemaDir, f))}\n\`\`\``)
  .join("\n\n");
sections.push("# Normative JSON Schemas (draft 2020-12)\n\nThese are authoritative; prose above is explanatory.\n\n" + schemaBlocks);

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
