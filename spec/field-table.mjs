// Every field in the ORE schema as one flat table, generated from spec/schema.
// Used by build-llms-txt.mjs for llms.txt and reference.html: a reader who
// sees nothing else still gets every path, its type, whether it is required,
// its allowed values and its definition.
//
//   import { fieldRows, fieldTableMarkdown } from "./field-table.mjs";

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(here, "schema");

function loadSchemas() {
  const byFile = {};
  for (const f of readdirSync(schemaDir).filter((f) => f.endsWith(".schema.json"))) {
    byFile[f] = JSON.parse(readFileSync(join(schemaDir, f), "utf8"));
  }
  return byFile;
}

// Resolve a $ref relative to the file it appears in. Returns [schema, file].
function resolve(ref, file, byFile) {
  const [target, pointer = ""] = ref.split("#");
  const f = target || file;
  let node = byFile[f];
  for (const seg of pointer.split("/").slice(1)) node = node[seg];
  return [node, f];
}

// Follow $refs, keeping the referring node's own description when it has one.
function deref(node, file, byFile) {
  let n = node, f = file, desc = node.description;
  while (n && n.$ref) {
    [n, f] = resolve(n.$ref, f, byFile);
    desc = desc ?? n.description;
  }
  return [{ ...n, description: desc ?? n?.description }, f];
}

const code = (v) => "`" + (typeof v === "string" ? v : JSON.stringify(v)) + "`";

function typeOf(node, file, byFile) {
  if (node.const !== undefined) return "const";
  if (node.oneOf && node.oneOf.every((b) => b.type)) {
    return node.oneOf.map((b) => (b.type === "array" ? "array" : b.type)).join(" or ");
  }
  let t = node.type ?? (node.properties ? "object" : "");
  if (t === "string" && node.format) t = node.format;
  if (t === "object" && node.additionalProperties && typeof node.additionalProperties === "object" && !node.properties) t = "map";
  return t;
}

// "Exactly one of `a`, `b`" for oneOf branches that only toggle required fields.
function exclusivity(node) {
  if (!Array.isArray(node.oneOf) || !node.oneOf.every((b) => Array.isArray(b.required) && !b.type)) return "";
  if (/exactly one|provide this or|not both/i.test(node.description ?? "")) return ""; // already said
  const names = node.oneOf.map((b) => b.required.map(code).join(" + "));
  return ` Exactly one of ${names.join(", ")}.`;
}

export function fieldRows() {
  const byFile = loadSchemas();
  const rows = [];
  const conditionalByPath = {};
  const walk = (raw, file, path, required) => {
    const [node, f] = deref(raw, file, byFile);
    const type = typeOf(node, f, byFile);
    const allowed = node.const !== undefined ? code(node.const)
      : Array.isArray(node.enum) ? node.enum.map(code).join(", ") : (conditionalByPath[path] ?? "");
    // enums that apply only under a condition: allOf [{ if: { properties: { X: { const } } }, then: { properties: { Y: { enum } } } }]
    const conditional = {};
    for (const branch of node.allOf ?? []) {
      const cond = Object.entries(branch.if?.properties ?? {}).find(([, v]) => v.const !== undefined);
      if (!cond) continue;
      for (const [k, v] of Object.entries(branch.then?.properties ?? {})) {
        if (Array.isArray(v.enum)) (conditional[k] ??= []).push(`when ${code(cond[0])} is ${code(cond[1].const)}: ${v.enum.map(code).join(", ")}`);
      }
    }
    for (const [k, list] of Object.entries(conditional)) conditionalByPath[path ? `${path}.${k}` : k] = list.join("; ");
    if (path) {
      rows.push({
        path,
        type,
        required,
        allowed,
        default: node.default !== undefined ? code(node.default) : "",
        description: ((node.description ?? "") + exclusivity(node)).trim(),
      });
    }
    // descend
    if (node.properties) {
      const req = new Set(node.required ?? []);
      for (const [k, child] of Object.entries(node.properties)) {
        if (k === "$schema" && !path) { walk(child, f, k, false); continue; }
        walk(child, f, path ? `${path}.${k}` : k, req.has(k));
      }
    }
    if (node.type === "object" && node.additionalProperties && typeof node.additionalProperties === "object") {
      walk(node.additionalProperties, f, `${path}.<key>`, false);
    }
    if (node.items) walk(node.items, f, `${path}[]`, false);
    if (node.oneOf) {
      for (const b of node.oneOf) if (b.type === "array" && b.items) walk(b.items, f, `${path}[]`, false);
    }
  };
  walk({ $ref: "ore.schema.json" }, "ore.schema.json", "", true);
  return rows;
}

const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n+/g, " ");

export function fieldTableMarkdown() {
  const rows = fieldRows();
  const head = "| Path | Type | Req. | Allowed values | Default | Definition |\n|---|---|---|---|---|---|";
  const body = rows.map((r) =>
    `| ${code(r.path)} | ${cell(r.type)} | ${r.required ? "yes" : ""} | ${cell(r.allowed)} | ${cell(r.default)} | ${cell(r.description)} |`,
  );
  return `${head}\n${body.join("\n")}`;
}
