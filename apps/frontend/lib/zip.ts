/**
 * A minimal ZIP writer, store method only.
 *
 * Written rather than pulled in because the whole requirement is "put these
 * CSV files in one archive". `jszip` is 100 KB to every visitor of the portal
 * — including the citizens who never open settings — to buy DEFLATE, streaming,
 * encryption and reading, none of which a backup bundle needs: CSV compresses
 * well but a municipality's whole register is a few megabytes uncompressed, and
 * the archive is written once and opened immediately.
 *
 * The output is a conformant `.zip`: local headers, a central directory and an
 * end-of-central-directory record, which is what Windows Explorer, macOS
 * Archive Utility, `unzip` and Excel's importer all read. It is not a `.tar`
 * renamed, and it is not one CSV pretending to be an archive.
 *
 * Limits, stated so nobody discovers them: no compression (`store`), no ZIP64,
 * so this tops out at 4 GB total and 65,535 entries. A tenant backup is four
 * orders of magnitude under both.
 */

/** Standard CRC-32 (IEEE 802.3), built once on first use. */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A date as MS-DOS packs it: two 16-bit fields, seconds in 2-second steps and
 * years counted from 1980. Every ZIP carries this regardless of era.
 */
function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f);
  const packedDate =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: packedDate };
}

export interface ZipEntry {
  /** Path inside the archive. Forward slashes make folders. */
  name: string;
  content: string;
}

/**
 * Bundles UTF-8 text entries into one archive.
 *
 * Entry names are written with the UTF-8 flag (bit 11) set, which is what lets
 * an Arabic filename survive the round trip through Explorer rather than
 * arriving as mojibake.
 */
export function createZip(entries: ZipEntry[], now: Date = new Date()): Blob {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(now);

  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    // Copied into a fresh array: `encode` returns Uint8Array<ArrayBufferLike>,
    // which TS 5.7+ will not accept as a BlobPart (it could be shared memory).
    const dataBytes = new Uint8Array(encoder.encode(entry.content));
    const crc = crc32(dataBytes);

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true); // local file header signature
    localView.setUint16(4, 20, true); // version needed
    localView.setUint16(6, 0x0800, true); // flags: UTF-8 names
    localView.setUint16(8, 0, true); // method: store
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, dataBytes.length, true); // compressed size
    localView.setUint32(22, dataBytes.length, true); // uncompressed size
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true); // extra field length
    local.set(nameBytes, 30);

    parts.push(local, dataBytes);

    const directory = new Uint8Array(46 + nameBytes.length);
    const directoryView = new DataView(directory.buffer);
    directoryView.setUint32(0, 0x02014b50, true); // central directory signature
    directoryView.setUint16(4, 20, true); // version made by
    directoryView.setUint16(6, 20, true); // version needed
    directoryView.setUint16(8, 0x0800, true);
    directoryView.setUint16(10, 0, true);
    directoryView.setUint16(12, time, true);
    directoryView.setUint16(14, date, true);
    directoryView.setUint32(16, crc, true);
    directoryView.setUint32(20, dataBytes.length, true);
    directoryView.setUint32(24, dataBytes.length, true);
    directoryView.setUint16(28, nameBytes.length, true);
    directoryView.setUint16(30, 0, true); // extra
    directoryView.setUint16(32, 0, true); // comment
    directoryView.setUint16(34, 0, true); // disk number
    directoryView.setUint16(36, 0, true); // internal attributes
    directoryView.setUint32(38, 0, true); // external attributes
    directoryView.setUint32(42, offset, true); // offset of local header
    directory.set(nameBytes, 46);
    central.push(directory);

    offset += local.length + dataBytes.length;
  }

  const centralSize = central.reduce((total, block) => total + block.length, 0);

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); // end of central directory signature
  endView.setUint16(4, 0, true); // this disk
  endView.setUint16(6, 0, true); // disk with central directory
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true); // comment length

  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

/**
 * One CSV, RFC 4180 quoting.
 *
 * The BOM is not decoration: Excel on Windows reads a UTF-8 CSV as the system
 * codepage without it, which turns every Arabic name in a municipal register
 * into question marks — and a backup nobody can read in the tool they will
 * actually open it with has not backed anything up.
 */
export function toCsv(rows: Array<Record<string, unknown>>, columns?: string[]): string {
  const headers = columns ?? [...new Set(rows.flatMap((row) => Object.keys(row)))];
  if (headers.length === 0) return '﻿';

  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text =
      typeof value === 'object' ? JSON.stringify(value) : String(value as string | number | boolean);
    // A leading =, +, - or @ is executed as a formula by Excel and Sheets when
    // the file is opened. Prefixing with a quote keeps a name like "-Ali" text.
    const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
  };

  const lines = [
    headers.map(escape).join(','),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(',')),
  ];
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Hands a blob to the browser as a download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next tick: revoking synchronously races the download in
  // Safari, which has not necessarily read the blob by the time click returns.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ─────────────────────────────  Reading  ─────────────────────────────

/** One file recovered from an archive. */
export interface ZipReadEntry {
  name: string;
  text: string;
}

/** Offsets from the end where the end-of-central-directory record may start. */
const EOCD_SIGNATURE = 0x06054b50;
const MAX_EOCD_SCAN = 22 + 0xffff;

/**
 * Reads a ZIP back into its text entries.
 *
 * The counterpart to `createZip`, and deliberately more tolerant than it: this
 * one has to accept archives it did not write. It reads the central directory
 * rather than walking local headers, because the directory is the authoritative
 * index — a stream of local headers can include entries the archive later
 * deleted, and their presence is exactly the sort of thing a restore must not
 * act on.
 *
 * Handles both stored and deflated entries. `createZip` only ever stores, but
 * an archive that has been through a "compress folder" round trip in Explorer
 * comes back deflated, and refusing those would reject files a municipality
 * quite reasonably believes are their backup.
 *
 * Throws on anything it cannot make sense of. A caller validating a backup
 * needs "this is not a readable archive" to be loud, not an empty list that
 * looks like an archive with nothing in it.
 */
export async function readZip(blob: Blob): Promise<ZipReadEntry[]> {
  const buffer = await blob.arrayBuffer();
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Scanned backwards: the record is last, but a trailing comment of arbitrary
  // length may sit after it, so its offset cannot simply be assumed.
  let eocd = -1;
  const scanFloor = Math.max(0, bytes.length - MAX_EOCD_SCAN);
  for (let index = bytes.length - 22; index >= scanFloor; index -= 1) {
    if (view.getUint32(index, true) === EOCD_SIGNATURE) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error('NOT_A_ZIP');

  const entryCount = view.getUint16(eocd + 10, true);
  const directoryOffset = view.getUint32(eocd + 16, true);

  const decoder = new TextDecoder('utf-8');
  const entries: ZipReadEntry[] = [];
  let cursor = directoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('BAD_DIRECTORY');

    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

    // The local header repeats the name and carries its *own* extra-field
    // length, which is routinely different from the directory's. Reading the
    // directory's would land the data pointer a few bytes off.
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);

    // Directories are entries too, and have no content worth decoding.
    if (!name.endsWith('/')) {
      let text: string;
      if (method === 0) {
        text = decoder.decode(raw);
      } else if (method === 8) {
        // `deflate-raw`: a ZIP member carries a bare deflate stream with no
        // zlib header, so `deflate` would fail on the first byte.
        const stream = new Blob([raw]).stream().pipeThrough(
          new DecompressionStream('deflate-raw'),
        );
        text = decoder.decode(await new Response(stream).arrayBuffer());
      } else {
        throw new Error('UNSUPPORTED_COMPRESSION');
      }
      // The BOM `toCsv` writes for Excel is not part of the data.
      entries.push({ name, text: text.replace(/^﻿/, '') });
    }

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/**
 * How many data rows a CSV holds.
 *
 * Counts line breaks outside quoted fields rather than splitting on `\n`: a
 * municipal register is full of addresses and notes containing newlines inside
 * quotes, and splitting naively reports a row count several times the truth —
 * which, on a screen whose job is to tell an administrator what is in their
 * backup, is worse than reporting nothing.
 */
export function countCsvRows(csv: string): number {
  let rows = 0;
  let inQuotes = false;
  let sawContent = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (char === '"') {
      // A doubled quote inside a quoted field is an escaped quote, not a close.
      if (inQuotes && csv[index + 1] === '"') index += 1;
      else inQuotes = !inQuotes;
      sawContent = true;
    } else if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && csv[index + 1] === '\n') index += 1;
      if (sawContent) rows += 1;
      sawContent = false;
    } else {
      sawContent = true;
    }
  }
  if (sawContent) rows += 1;

  // The header line is not a row of data.
  return Math.max(rows - 1, 0);
}
