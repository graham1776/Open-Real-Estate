// Write a deal's data tape into a copy of the ORE Excel workbook.
//
// Dependency-free: a minimal ZIP reader/writer over node:zlib, and a targeted
// edit of the Tape sheet's XML (columns A:B, from row 2). Everything else in the
// workbook is carried over byte for byte; the workbook is flagged to fully
// recalculate when opened, so Excel computes every formula on first open.

import { inflateRawSync, deflateRawSync } from "node:zlib";

// ---------------------------------------------------------------- zip

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

/** Read a ZIP archive into [{ name, data }] in archive order. */
export function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file (no end-of-central-directory record)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt zip central directory");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(local + 26), lxlen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lnlen + lxlen;
    const raw = buf.subarray(start, start + csize);
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : null;
    if (!data) throw new Error(`unsupported zip compression method ${method} for ${name}`);
    entries.push({ name, data });
    p += 46 + nlen + xlen + clen;
  }
  return entries;
}

/** Write [{ name, data }] as a deflated ZIP archive. */
export function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const comp = deflateRawSync(data, { level: 6 });
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); // 1980-01-01 00:00
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, comp);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ------------------------------------------------------------- workbook

const esc = (s) =>
  String(s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function cellXml(ref, attrs, value) {
  const a = attrs.replace(/\st="[^"]*"/, "");
  if (value === null || value === undefined || value === "") return `<c r="${ref}"${a}/>`;
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"${a}><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c r="${ref}"${a} t="b"><v>${value ? 1 : 0}</v></c>`;
  return `<c r="${ref}"${a} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

/** Path of the sheet XML part for a sheet name, resolved through workbook.xml and its rels. */
function sheetPart(entries, sheetName) {
  const get = (n) => entries.find((e) => e.name === n)?.data.toString("utf8");
  const wb = get("xl/workbook.xml");
  const rels = get("xl/_rels/workbook.xml.rels");
  const m = wb.match(new RegExp(`<sheet[^>]*name="${sheetName}"[^>]*r:id="([^"]+)"`));
  if (!m) throw new Error(`workbook has no "${sheetName}" sheet`);
  const t = rels.match(new RegExp(`<Relationship[^>]*Id="${m[1]}"[^>]*Target="([^"]+)"`))
    ?? rels.match(new RegExp(`<Relationship[^>]*Target="([^"]+)"[^>]*Id="${m[1]}"`));
  const target = t[1].replace(/^\/?xl\//, "");
  return "xl/" + target.replace(/^\//, "");
}

/**
 * Return a new workbook (Buffer) with `rows` ([{path, value}]) written to the
 * Tape sheet from row 2. Throws if the tape is longer than the template's Tape.
 */
export function workbookWithTape(templateBuf, rows) {
  const entries = unzip(templateBuf);
  const part = sheetPart(entries, "Tape");
  const entry = entries.find((e) => e.name === part);
  let xml = entry.data.toString("utf8");
  const capacity = (xml.match(/<c r="A\d+"/g) ?? []).length - 1;
  if (rows.length > capacity) throw new Error(`tape has ${rows.length} rows; the workbook's Tape holds ${capacity}`);
  const byRow = new Map(rows.map((r, i) => [i + 2, r]));
  xml = xml.replace(/<c r="([AB])(\d+)"([^>]*?)(?:\/>|><\/c>|>(?:<v><\/v>)?<\/c>)/g, (whole, col, rowStr, attrs) => {
    const row = byRow.get(Number(rowStr));
    if (!row) return whole;
    return cellXml(col + rowStr, attrs, col === "A" ? row.path : row.value);
  });
  entry.data = Buffer.from(xml, "utf8");
  // make sure Excel recalculates everything on open
  const wbEntry = entries.find((e) => e.name === "xl/workbook.xml");
  let wb = wbEntry.data.toString("utf8");
  if (/<calcPr[^>]*\/>/.test(wb)) {
    wb = wb.replace(/<calcPr([^>]*)\/>/, (m, a) => `<calcPr${a.replace(/\sfullCalcOnLoad="[^"]*"/, "")} fullCalcOnLoad="1"/>`);
  } else {
    wb = wb.replace("</workbook>", '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>');
  }
  wbEntry.data = Buffer.from(wb, "utf8");
  return zip(entries);
}
