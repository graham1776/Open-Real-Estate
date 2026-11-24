// Extension-policy conformance helper (spec/README.md, "Extensions").
//
// withExtensions(deal) returns a deep copy of a file with an `x-` key added to
// every object the schema closes, which is every object except the keyed map
// marketAssumptions.leasingProfiles (its keys are profile names, never
// extensions; its values are profiles and get one). The harnesses require the
// copy to validate, lint the same, and compute the same outputs as the
// original: an extension never changes a number.

const KEYED_MAPS = new Set(["marketAssumptions.leasingProfiles"]);
const EXT = { "x-conformance-probe": { ignored: true, note: "Readers must ignore x- keys.", n: 1, list: [1, "a"] } };

export function withExtensions(deal) {
  const walk = (node, path) => {
    if (Array.isArray(node)) return node.map((v) => walk(v, path));
    if (node === null || typeof node !== "object") return node;
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = walk(v, path ? `${path}.${k}` : k);
    return KEYED_MAPS.has(path) ? out : { ...out, ...structuredClone(EXT) };
  };
  return walk(deal, "");
}
