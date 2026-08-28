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
