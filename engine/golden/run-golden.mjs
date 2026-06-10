#!/usr/bin/env node
// Golden-output harness for the reference engine.
//   node engine/golden/run-golden.mjs            -> check examples against goldens
//   node engine/golden/run-golden.mjs --update   -> regenerate golden files
//
// Goldens lock engine behavior: any change to computed outputs must either be
// reproduced exactly or consciously re-locked with --update and a justification
// in the commit message.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { computeAll } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const examplesDir = join(root, "examples");
const update = process.argv.includes("--update");

let failures = 0;
for (const f of readdirSync(examplesDir).filter((f) => f.endsWith(".ore")).sort()) {
  const deal = JSON.parse(readFileSync(join(examplesDir, f), "utf8"));
  const actual = computeAll(deal);
  const goldenPath = join(here, basename(f, ".ore") + ".golden.json");
  if (update) {
    writeFileSync(goldenPath, JSON.stringify(actual, null, 2) + "\n");
    console.log(`WROTE ${basename(goldenPath)}`);
    continue;
  }
  if (!existsSync(goldenPath)) {
    failures++;
    console.error(`MISSING golden for ${f} (run with --update)`);
    continue;
  }
  const expected = JSON.parse(readFileSync(goldenPath, "utf8"));
  const a = JSON.stringify(actual, null, 2);
  const e = JSON.stringify(expected, null, 2);
  if (a === e) {
    console.log(`PASS  ${f}`);
  } else {
    failures++;
    console.error(`FAIL  ${f} — output differs from ${basename(goldenPath)}`);
    const al = a.split("\n"), el = e.split("\n");
    for (let i = 0; i < Math.max(al.length, el.length); i++) {
      if (al[i] !== el[i]) {
        console.error(`      first diff at line ${i + 1}:`);
        console.error(`      expected: ${el[i] ?? "<eof>"}`);
        console.error(`      actual:   ${al[i] ?? "<eof>"}`);
        break;
      }
    }
  }
}
process.exit(failures ? 1 : 0);
