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
JSON-based format for US-industrial commercial real estate underwriting data.

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

US industrial (single- and multi-tenant); NNN/NN/modified-gross leases. The
valuation module carries inputs for all four approaches (DCF, direct cap, sales
comparison, cost); the v0.1 engine computes DCF and direct cap. Out of scope:
retail percentage rent, office reimbursement pools, hotel, multifamily unit-level,
international conventions, debt waterfalls.

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
