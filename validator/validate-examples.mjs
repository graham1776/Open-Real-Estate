#!/usr/bin/env node
// Validates every .ore file in /examples against the schemas in /spec/schema.
// Stopgap until the @ore-format/cli validator lands; also the seed of its core.
// Usage: npm install && npm run validate (from the repo root)

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaDir = join(root, "spec", "schema");
const examplesDir = join(root, "examples");

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
for (const f of readdirSync(schemaDir).filter((f) => f.endsWith(".schema.json"))) {
  ajv.addSchema(JSON.parse(readFileSync(join(schemaDir, f), "utf8")));
}
const validate = ajv.getSchema("https://oreformat.org/schema/0.1.0/ore.schema.json");

let failures = 0;
for (const f of readdirSync(examplesDir).filter((f) => f.endsWith(".ore")).sort()) {
  const deal = JSON.parse(readFileSync(join(examplesDir, f), "utf8"));
  if (validate(deal)) {
    console.log(`PASS  ${f}`);
  } else {
    failures++;
    console.error(`FAIL  ${f}`);
    for (const err of validate.errors) {
      console.error(`      ${err.instancePath || "/"} ${err.message}`);
    }
  }
}
process.exit(failures === 0 ? 0 : 1);
