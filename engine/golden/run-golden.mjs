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
import { computeAll, computePortfolio } from "../dist/index.js";

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
// portfolio golden: all examples combined, sorted by filename
{
  const files = readdirSync(examplesDir).filter((f) => f.endsWith(".ore")).sort();
  const entries = files.map((f) => ({
    label: basename(f, ".ore"),
    deal: JSON.parse(readFileSync(join(examplesDir, f), "utf8")),
  }));
  const actual = computePortfolio(entries);
  const goldenPath = join(here, "portfolio.golden.json");
  if (update) {
    writeFileSync(goldenPath, JSON.stringify(actual, null, 2) + "\n");
    console.log("WROTE portfolio.golden.json");
  } else if (!existsSync(goldenPath)) {
    failures++;
    console.error("MISSING portfolio golden (run with --update)");
  } else if (JSON.stringify(actual, null, 2) === JSON.stringify(JSON.parse(readFileSync(goldenPath, "utf8")), null, 2)) {
    console.log("PASS  portfolio (all examples combined)");
  } else {
    failures++;
    console.error("FAIL  portfolio — output differs from portfolio.golden.json");
  }
}

process.exit(failures ? 1 : 0);
