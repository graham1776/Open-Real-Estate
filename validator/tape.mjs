// ORE data tape: a lossless, two-column (path, value) flattening of a .ore file.
//
// The tape is the one shape every spreadsheet route agrees on. The Excel
// workbook reads it, the VBA importer writes it, `ore tape` prints it, and
// `ore excel` embeds it. Rules (also in excel/README.md):
//
//   - One row per leaf value, in document order.
//   - Path segments: object keys joined by ".", array positions as "[i]"
//     (zero-based). Example: rentRoll.leases[0].baseRent.schedule[1].amount
//   - Values keep their JSON type: number, string, boolean. null is an empty
//     cell. An empty array or object is written as the text "[]" or "{}" so
//     the tape round-trips.
//   - Optional engine outputs ride along under the "$engine." prefix
//     (e.g. $engine.noi.year1NOI), so a workbook can check its own math
//     against the reference engine side by side.

export function flatten(value, prefix = "", rows = []) {
  if (Array.isArray(value)) {
    if (value.length === 0) rows.push({ path: prefix, value: "[]" });
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, rows));
  } else if (value !== null && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0 && prefix) rows.push({ path: prefix, value: "{}" });
    for (const k of keys) flatten(value[k], prefix ? `${prefix}.${k}` : k, rows);
  } else {
    rows.push({ path: prefix, value: value ?? null });
  }
  return rows;
}

/** Tape rows for a deal, optionally followed by reference-engine outputs. */
export function dealTape(deal, engineOutput) {
  const rows = flatten(deal);
  if (engineOutput) flatten(engineOutput, "$engine", rows);
  return rows;
}

/** Tab-separated text (header + rows). Tabs and line breaks inside strings become spaces. */
export function tapeToTSV(rows) {
  const clean = (v) => (v == null ? "" : String(v).replace(/[\t\r\n]+/g, " "));
  return ["path\tvalue", ...rows.map((r) => `${r.path}\t${clean(r.value)}`)].join("\n") + "\n";
}
