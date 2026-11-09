#!/usr/bin/env node
// Cross-field lint conformance.
//   node engine/golden/run-lint.mjs
//
// Each engine/golden/invalid/*.ore file has a sibling .lint.json:
//   { "schemaValid": true|false, "issues": [{ "code", "severity", "path" }, ...] }
// lint() must produce exactly those issues, in order. Messages are not compared.
// schemaValid says whether JSON Schema accepts the file. Reference and id
// failures stay schema-valid; option-field failures are rejected by schema too.
// Every example deal must lint with no error-severity issues.
//
// The rule ids are specified in spec/validation.md. A Python port can run the
// same fixtures without this harness.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { lint } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const invalidDir = join(here, "invalid");
const examplesDir = join(root, "examples");

function buildSchemaValidator() {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  const schemaDir = join(root, "spec", "schema");
  for (const f of readdirSync(schemaDir).filter((f) => f.endsWith(".schema.json"))) {
    ajv.addSchema(JSON.parse(readFileSync(join(schemaDir, f), "utf8")));
  }
  return ajv.getSchema("https://oreformat.org/schema/0.1.0/ore.schema.json");
}

function project(issues) {
  return issues.map((p) => ({ code: p.code, severity: p.severity, path: p.path ?? null }));
}

const validateSchema = buildSchemaValidator();
let failures = 0;

for (const f of readdirSync(invalidDir).filter((f) => f.endsWith(".ore")).sort()) {
  const deal = JSON.parse(readFileSync(join(invalidDir, f), "utf8"));
  const expectPath = join(invalidDir, basename(f, ".ore") + ".lint.json");
  const expected = JSON.parse(readFileSync(expectPath, "utf8"));
  const actual = lint(deal);
  const got = project(actual);
  const want = expected.issues;
  const schemaOk = validateSchema(deal) === true;
  const issuesMatch = JSON.stringify(got) === JSON.stringify(want);
  const schemaMatch = schemaOk === expected.schemaValid;
  const messagesOk = actual.every((p) => typeof p.message === "string" && p.message.length > 0);
  if (issuesMatch && schemaMatch && messagesOk) {
    console.log(`PASS  ${f}`);
    continue;
  }
  failures++;
  console.error(`FAIL  ${f}`);
  if (!issuesMatch) {
    console.error(`      lint:   ${JSON.stringify(got)}`);
    console.error(`      expect: ${JSON.stringify(want)}`);
  }
  if (!schemaMatch) console.error(`      schemaValid: got ${schemaOk}, expect ${expected.schemaValid}`);
  if (!messagesOk) console.error("      a lint issue is missing its message");
}

for (const f of readdirSync(examplesDir).filter((f) => f.endsWith(".ore")).sort()) {
  const deal = JSON.parse(readFileSync(join(examplesDir, f), "utf8"));
  const errors = lint(deal).filter((p) => p.severity === "error");
  if (errors.length === 0) {
    console.log(`PASS  example ${f}`);
  } else {
    failures++;
    console.error(`FAIL  example ${f}`);
    for (const p of errors) console.error(`      ${p.code}: ${p.path ?? ""} ${p.message}`);
  }
}

process.exit(failures ? 1 : 0);
