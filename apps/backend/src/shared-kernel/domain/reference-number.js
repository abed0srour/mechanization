"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateReferenceNumber = generateReferenceNumber;
exports.isValidReferenceNumber = isValidReferenceNumber;
/**
 * رقم مرجعي — the fallback identifier a citizen keeps when a phone is lost or
 * shared. Format: <TENANT-PREFIX>-<YY><MM>-<6 chars>, e.g. "BZR-2607-4K9QX2".
 *
 * Deliberately excludes I, O, 0 and 1 so it survives being read aloud over the
 * phone or copied by hand from an SMS by an elderly user.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateReferenceNumber(tenantPrefix, now = new Date(), randomInt = (max) => Math.floor(Math.random() * max)) {
    const prefix = tenantPrefix.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3).padEnd(3, 'X');
    const yy = String(now.getUTCFullYear()).slice(-2);
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    let suffix = '';
    for (let i = 0; i < 6; i += 1) {
        suffix += ALPHABET[randomInt(ALPHABET.length)];
    }
    return `${prefix}-${yy}${mm}-${suffix}`;
}
function isValidReferenceNumber(value) {
    return /^[A-Z]{3}-\d{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(value);
}
