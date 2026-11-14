// A zip file with no compression ("stored"), as the model page exports MODFLOW 6 files,
// and readers for zip files: unzip for stored entries only, and readZip, which also
// inflates deflated ones (method 8), as macOS Compress, Windows "Send to compressed
// folder", Info-ZIP zip and Python's zipfile write them. The layout follows PKWARE's
// APPNOTE.TXT (the .ZIP File Format Specification, version 6.3.10): a local header before
// each file, then the central directory and its end record. Names are written in UTF-8
// (general purpose flag bit 11). There is no Zip64, so the limits are 65 535 files and
// 4 GiB. Nothing here needs a browser: DecompressionStream('deflate-raw'), which inflates
// raw DEFLATE data (RFC 1951) as zip stores it, is in every current browser, in Web
// Workers and in Node 18 and later.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** The CRC-32 of the bytes, as zip uses it: register started at all ones and complemented at the end (APPNOTE 4.4.7), reflected polynomial 0xEDB88320. */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const toBytes = (data) => (typeof data === 'string' ? new TextEncoder().encode(data) : data);

// MS-DOS date and time, local time, to the nearest two seconds; zip has nothing earlier than 1980.
function dosTime(d) {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * files: [{ name, data }], data a string (written as UTF-8) or a Uint8Array.
 * Returns the zip file as a Uint8Array. date: the time stamp for every entry.
 */
export function zip(files, { date = new Date() } = {}) {
  if (files.length > 0xffff) throw new Error('A zip file without Zip64 holds at most 65 535 files.');
  const { time, date: day } = dosTime(date);
  const enc = new TextEncoder();
  const entries = files.map((f) => {
    if (!f.name || /^\/|\\|(^|\/)\.\.(\/|$)/.test(f.name)) throw new Error(`"${f.name}" is not a file name a zip file can hold.`);
    const name = enc.encode(f.name), data = toBytes(f.data);
    return { name, data, crc: crc32(data) };
  });
  const localSize = entries.reduce((s, e) => s + 30 + e.name.length + e.data.length, 0);
  const centralSize = entries.reduce((s, e) => s + 46 + e.name.length, 0);
  if (localSize + centralSize > 0xffffffff) throw new Error('A zip file without Zip64 holds at most 4 GiB.');
  const out = new Uint8Array(localSize + centralSize + 22);
  const v = new DataView(out.buffer);
  let at = 0;
  const offsets = [];
  for (const e of entries) {
    offsets.push(at);
    v.setUint32(at, 0x04034b50, true);
    v.setUint16(at + 4, 20, true);          // version needed: 2.0
    v.setUint16(at + 6, 0x0800, true);      // flags: names in UTF-8
    v.setUint16(at + 8, 0, true);           // method: stored
    v.setUint16(at + 10, time, true);
    v.setUint16(at + 12, day, true);
    v.setUint32(at + 14, e.crc, true);
    v.setUint32(at + 18, e.data.length, true);
    v.setUint32(at + 22, e.data.length, true);
    v.setUint16(at + 26, e.name.length, true);
    v.setUint16(at + 28, 0, true);          // no extra field
    out.set(e.name, at + 30);
    out.set(e.data, at + 30 + e.name.length);
    at += 30 + e.name.length + e.data.length;
  }
  const central = at;
  entries.forEach((e, i) => {
    v.setUint32(at, 0x02014b50, true);
    v.setUint16(at + 4, 20, true);          // made by: 2.0, MS-DOS attributes
    v.setUint16(at + 6, 20, true);
    v.setUint16(at + 8, 0x0800, true);
    v.setUint16(at + 10, 0, true);
    v.setUint16(at + 12, time, true);
    v.setUint16(at + 14, day, true);
    v.setUint32(at + 16, e.crc, true);
    v.setUint32(at + 20, e.data.length, true);
    v.setUint32(at + 24, e.data.length, true);
    v.setUint16(at + 28, e.name.length, true);
    // Extra field, comment, disk number, internal and external attributes: all zero.
    v.setUint32(at + 42, offsets[i], true);
    out.set(e.name, at + 46);
    at += 46 + e.name.length;
  });
  v.setUint32(at, 0x06054b50, true);
  v.setUint16(at + 8, entries.length, true);
  v.setUint16(at + 10, entries.length, true);
  v.setUint32(at + 12, at - central, true);
  v.setUint32(at + 16, central, true);
  return out;
}

// The entries of a zip file from its central directory: { name, method, crc, size (as
// stored), length (unpacked), start (of the stored data) }. Folders are left out.
function entries(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  // The end record is the last thing in the file, after a comment of up to 65 535 bytes.
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('It is not a zip file: it has no zip directory at its end.');
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const dec = new TextDecoder();
  const out = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || v.getUint32(at, true) !== 0x02014b50) throw new Error('The zip directory is damaged.');
    const flags = v.getUint16(at + 8, true), method = v.getUint16(at + 10, true), crc = v.getUint32(at + 16, true);
    // The sizes and CRC are taken from the central directory, which holds them even when the
    // local header leaves them to a data descriptor (flag bit 3, APPNOTE 4.3.9).
    const size = v.getUint32(at + 20, true), length = v.getUint32(at + 24, true), nameLen = v.getUint16(at + 28, true);
    const extraLen = v.getUint16(at + 30, true), commentLen = v.getUint16(at + 32, true), local = v.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new Error(`${name} is encrypted, and this page cannot read it.`);
    if (local + 30 > bytes.length || v.getUint32(local, true) !== 0x04034b50) throw new Error(`The zip entry for ${name} is damaged.`);
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    if (start + size > bytes.length) throw new Error(`The zip entry for ${name} is damaged (it runs past the end of the file).`);
    out.push({ name, method, crc, size, length, start });
  }
  return out;
}

function checked(e, data) {
  if (data.length !== e.length || crc32(data) !== e.crc) throw new Error(`${e.name} in the zip file is damaged (its check sum does not match).`);
  return { name: e.name, data };
}

/**
 * The files in a zip file whose entries are stored without compression, as zip() writes
 * them: [{ name, data: Uint8Array }]. Folders are left out. A compressed entry is
 * refused with its name; readZip reads those.
 */
export function unzip(bytes) {
  return entries(bytes).map((e) => {
    if (e.method !== 0) throw new Error(`${e.name} is compressed in the zip file, and unzip reads only stored entries: use readZip.`);
    return checked(e, bytes.slice(e.start, e.start + e.size));
  });
}

// Raw DEFLATE (RFC 1951) inflated by the platform's DecompressionStream.
async function inflateRaw(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * The files in a zip file, stored or deflated (methods 0 and 8, the two that APPNOTE
 * 4.4.5 lists for general use and that common zip writers use): a promise of
 * [{ name, data: Uint8Array }], folders left out. Each file's size and CRC-32 are checked.
 * Any other method is refused with the file's name.
 */
export async function readZip(bytes) {
  const out = [];
  for (const e of entries(bytes)) {
    const raw = bytes.slice(e.start, e.start + e.size);
    if (e.method === 0) out.push(checked(e, raw));
    else if (e.method === 8) {
      let data;
      try {
        data = await inflateRaw(raw);
      } catch {
        throw new Error(`${e.name} in the zip file is damaged (it does not inflate).`);
      }
      out.push(checked(e, data));
    } else throw new Error(`${e.name} is compressed with method ${e.method} in the zip file, which this page cannot read; zip it again with the usual compression (deflate), or with none.`);
  }
  return out;
}

/**
 * The MODFLOW 6 files in a zip file's entries ([{ name, data }], from readZip), as
 * { path: text } with paths taken from the folder that holds mfsim.nam, as MODFLOW 6 reads
 * them. So a zip of a folder reads as well as a zip of the files. The __MACOSX folder that
 * macOS adds (resource forks, not model files) is left out. Returns null when no entry is
 * mfsim.nam; two mfsim.nam files are refused.
 */
export function mf6Texts(entries) {
  const files = entries.filter((f) => !/^__MACOSX\//.test(f.name));
  const sims = files.filter((f) => /(^|\/)mfsim\.nam$/i.test(f.name));
  if (!sims.length) return null;
  if (sims.length > 1) throw new Error(`The zip file holds ${sims.length} simulations (${sims.map((f) => f.name).join(', ')}); give one at a time.`);
  const base = sims[0].name.slice(0, sims[0].name.length - 'mfsim.nam'.length);
  const dec = new TextDecoder();
  const texts = {};
  for (const f of files) if (f.name.startsWith(base)) texts[f.name.slice(base.length)] = dec.decode(f.data);
  texts['mfsim.nam'] = texts[sims[0].name.slice(base.length)];
  return texts;
}
