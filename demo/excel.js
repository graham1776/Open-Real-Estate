// Build a loaded ORE Workbook in the browser: the same result as `ore excel`,
// with no command line and no macro.
//
// The template (excel/ORE-Workbook.xlsx) is a ZIP. Only two parts change: the
// Tape sheet (the deal, one row per value) and workbook.xml (flagged to
// recalculate on open). Every other part is copied through still compressed, so
// a 6 MB workbook is rewritten in well under a second.
//
// This mirrors validator/xlsx.mjs, which does the same job in Node. The two must
// produce the same parts; the tape itself comes from the one shared module.

import { dealTape } from "../validator/tape.mjs";

const TEMPLATE_URLS = [
  "../excel/ORE-Workbook.xlsx",
  "https://raw.githubusercontent.com/graham1776/Open-Real-Estate/main/excel/ORE-Workbook.xlsx",
];

const enc = new TextEncoder(), dec = new TextDecoder();

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
const inflate = (b) => pipe(b, new DecompressionStream("deflate-raw"));
const deflate = (b) => pipe(b, new CompressionStream("deflate-raw"));

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Entries as stored: { name, method, crc, usize, raw } with raw still compressed.
function readZip(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("the workbook template is not a zip file");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("corrupt workbook template");
    const method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true);
    const csize = v.getUint32(p + 20, true), usize = v.getUint32(p + 24, true);
    const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nlen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    entries.push({ name, method, crc, usize, raw: buf.subarray(start, start + csize) });
    p += 46 + nlen + xlen + clen;
  }
  return entries;
}

function writeZip(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, e.method, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);
    lh.setUint32(14, e.crc, true); lh.setUint32(18, e.raw.length, true); lh.setUint32(22, e.usize, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true); ch.setUint16(10, e.method, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true);
    ch.setUint32(16, e.crc, true); ch.setUint32(20, e.raw.length, true); ch.setUint32(24, e.usize, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    parts.push(new Uint8Array(lh.buffer), name, e.raw);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + e.raw.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)],
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function readText(entry) {
  if (entry.method === 0) return dec.decode(entry.raw);
  if (entry.method === 8) return dec.decode(await inflate(entry.raw));
  throw new Error(`unsupported compression in the workbook template (${entry.name})`);
}
async function writeText(entry, text) {
  const data = enc.encode(text);
  entry.method = 8; entry.crc = crc32(data); entry.usize = data.length; entry.raw = await deflate(data);
}

const xmlEsc = (s) => String(s)
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function cellXml(ref, attrs, value) {
  const a = attrs.replace(/\st="[^"]*"/, "");
  if (value === null || value === undefined || value === "") return `<c r="${ref}"${a}/>`;
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"${a}><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c r="${ref}"${a} t="b"><v>${value ? 1 : 0}</v></c>`;
  return `<c r="${ref}"${a} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(value)}</t></is></c>`;
}

let templateCache = null;
async function template() {
  if (templateCache) return templateCache;
  for (const url of TEMPLATE_URLS) {
    try {
      const r = await fetch(url);
      if (r.ok) return (templateCache = new Uint8Array(await r.arrayBuffer()));
    } catch { /* try the next source */ }
  }
  throw new Error("could not load the workbook template (excel/ORE-Workbook.xlsx)");
}

/**
 * A Blob holding the ORE Workbook with this deal on its Tape sheet. Pass the
 * engine's output to fill the Check sheet's comparison column.
 */
export async function workbookFor(deal, engineOutput) {
  if (typeof CompressionStream === "undefined") throw new Error("this browser cannot write Excel files; use a current Chrome, Edge, Firefox or Safari");
  const rows = dealTape(deal, engineOutput ?? undefined);
  const entries = readZip(await template()).map((e) => ({ ...e }));
  const find = (n) => entries.find((e) => e.name === n);

  const wbEntry = find("xl/workbook.xml");
  let wb = await readText(wbEntry);
  const rels = await readText(find("xl/_rels/workbook.xml.rels"));
  const m = wb.match(/<sheet[^>]*name="Tape"[^>]*r:id="([^"]+)"/);
  if (!m) throw new Error('the workbook template has no "Tape" sheet');
  const t = rels.match(new RegExp(`<Relationship[^>]*Id="${m[1]}"[^>]*Target="([^"]+)"`))
    ?? rels.match(new RegExp(`<Relationship[^>]*Target="([^"]+)"[^>]*Id="${m[1]}"`));
  const tapeEntry = find("xl/" + t[1].replace(/^\/?xl\//, "").replace(/^\//, ""));

  let xml = await readText(tapeEntry);
  const capacity = (xml.match(/<c r="A\d+"/g) ?? []).length - 1;
  if (rows.length > capacity) throw new Error(`this deal needs ${rows.length} tape rows; the workbook holds ${capacity}`);
  const byRow = new Map(rows.map((r, i) => [i + 2, r]));
  xml = xml.replace(/<c r="([AB])(\d+)"([^>]*?)(?:\/>|><\/c>|>(?:<v><\/v>)?<\/c>)/g, (whole, col, rowStr, attrs) => {
    const row = byRow.get(Number(rowStr));
    return row ? cellXml(col + rowStr, attrs, col === "A" ? row.path : row.value) : whole;
  });
  await writeText(tapeEntry, xml);

  // recalculate everything when the file is opened
  if (/<calcPr[^>]*\/>/.test(wb)) {
    wb = wb.replace(/<calcPr([^>]*)\/>/, (x, a) => `<calcPr${a.replace(/\sfullCalcOnLoad="[^"]*"/, "")} fullCalcOnLoad="1"/>`);
  } else {
    wb = wb.replace("</workbook>", '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>');
  }
  await writeText(wbEntry, wb);
  return writeZip(entries);
}
