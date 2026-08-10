/**
 * رقم مرجعي input formatting — `BZR-2608-5HLQBM`.
 *
 * Three groups: three letters, four digits, six characters from the reduced
 * alphabet the generator uses. The dashes are inserted as the citizen types and
 * cannot be typed by hand, so the only shape this field can hold is the shape
 * the server accepts.
 *
 * Filtering is **per position** rather than one blanket "letters and digits"
 * pass. It has to be: `0` and `1` are perfectly valid in the four-digit month
 * group and never valid in the last group, where the alphabet drops I, O, 0 and
 * 1 so a code survives being read down a phone line. A single filter would
 * either reject a real date or admit a code nobody can dictate.
 */

/** The generator's alphabet for the final group — no I, O, 0 or 1. */
const SUFFIX_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const GROUPS = [3, 4, 6] as const;
export const REFERENCE_RAW_LENGTH = GROUPS.reduce((sum, size) => sum + size, 0); // 13

/** Which characters may occupy `index` of the undashed value. */
function allows(index: number, char: string): boolean {
  if (index < 3) return char >= 'A' && char <= 'Z';
  if (index < 7) return char >= '0' && char <= '9';
  return SUFFIX_ALPHABET.includes(char);
}

/**
 * Reduces anything — typed, pasted, dictated — to the bare 13 characters.
 *
 * Characters that cannot sit at the position they arrive at are dropped rather
 * than shifting everything along: a paste of `BZR-2608-5HLQBM` and one of
 * `bzr 2608 5hlqbm` have to land identically, and a stray letter in the date
 * group must not silently push the suffix out of alignment.
 */
export function toRawReference(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  let raw = '';
  for (const char of cleaned) {
    if (raw.length >= REFERENCE_RAW_LENGTH) break;
    if (allows(raw.length, char)) raw += char;
  }
  return raw;
}

/**
 * Adds the dashes.
 *
 * A group's dash appears the moment the group is full, so the field shows
 * `BZR-` before the date is started — the separator is a cue that the group was
 * accepted, not decoration applied at the end.
 */
export function formatReference(raw: string): string {
  const first = raw.slice(0, 3);
  const second = raw.slice(3, 7);
  const third = raw.slice(7, 13);

  let out = first;
  if (raw.length >= 3) out += '-';
  out += second;
  if (raw.length >= 7) out += '-';
  out += third;
  return out;
}

/**
 * What the field should show after an edit.
 *
 * `deleting` exists for one case that is otherwise unfixable: backspacing over
 * an auto-inserted dash. Stripping and re-formatting would put the dash
 * straight back, so the key appears dead and the caret never moves. When a
 * deletion leaves the formatted value unchanged, the dash was what the citizen
 * meant to remove, so the character before it goes too.
 */
export function nextReferenceValue(input: string, previous: string): string {
  const deleting = input.length < previous.length;
  let raw = toRawReference(input);

  if (deleting && formatReference(raw) === previous) {
    raw = raw.slice(0, -1);
  }
  return formatReference(raw);
}

/** True once all thirteen characters are present. */
export function isCompleteReference(value: string): boolean {
  return toRawReference(value).length === REFERENCE_RAW_LENGTH;
}
