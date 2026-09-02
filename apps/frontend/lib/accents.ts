/**
 * Accent palettes.
 *
 * Each entry maps to a `[data-accent="…"]` block in globals.css that overrides
 * `--primary` and `--ring`. The swatch colours here drive the selector's
 * preview dots only — every component reads the CSS variables, so a button can
 * never disagree with the swatch that chose it.
 *
 * `label`/`hint` are Arabic because this list is rendered directly; the ids
 * stay Latin because they are written into a DOM attribute and localStorage.
 */
export const ACCENTS = [
  {
    id: 'municipal',
    label: 'الأزرق البلدي',
    hint: 'اللون الافتراضي للمنصّة',
    swatch: ['#1a4f9c', '#2f6fd0'],
  },
] as const;

export type AccentId = (typeof ACCENTS)[number]['id'];

/** The base `:root` values — it has no `[data-accent]` block of its own. */
export const DEFAULT_ACCENT: AccentId = 'municipal';

export const ACCENT_STORAGE_KEY = 'mechanization.accent';

export function isAccent(value: unknown): value is AccentId {
  return value === 'municipal';
}

/**
 * Runs before first paint, inlined into `<head>`.
 * Cleans up any stale non-municipal data-accent attribute or storage.
 */
export const ACCENT_INIT_SCRIPT = `(function(){try{localStorage.removeItem('${ACCENT_STORAGE_KEY}');document.documentElement.removeAttribute('data-accent');}catch(e){}})();`;
