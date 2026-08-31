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
  {
    id: 'emerald',
    label: 'الأخضر الزيتوني',
    hint: 'هادئ ومناسب للقراءة الطويلة',
    swatch: ['#166a45', '#22a06b'],
  },
  {
    id: 'rose',
    label: 'الأحمر الوردي',
    hint: 'لون دافئ وواضح',
    swatch: ['#b31843', '#e23e6b'],
  },
  {
    id: 'violet',
    label: 'البنفسجي',
    hint: 'تباين عالٍ في الوضع الداكن',
    swatch: ['#5b32bd', '#8b5cf6'],
  },
  {
    id: 'sunset',
    label: 'البرتقالي',
    hint: 'مستوحى من غروب الساحل',
    swatch: ['#c2510c', '#f97316'],
  },
] as const;

export type AccentId = (typeof ACCENTS)[number]['id'];

/** The base `:root` values — it has no `[data-accent]` block of its own. */
export const DEFAULT_ACCENT: AccentId = 'municipal';

export const ACCENT_STORAGE_KEY = 'mechanization.accent';

export function isAccent(value: unknown): value is AccentId {
  return ACCENTS.some((accent) => accent.id === value);
  return value === 'municipal';
}

/**
 * Runs before first paint, inlined into `<head>`.
 *
 * Without it the page renders in the default accent and snaps to the stored one
 * when React mounts — the same flash `next-themes` avoids for light/dark, and
 * for the same reason it has to be a blocking inline script rather than an
 * effect. Dependency-free and wrapped in try/catch because it executes before
 * anything else on the page, and a thrown error here would take the document
 * with it.
 *
 * It cannot share `next-themes`' script: that one owns the `dark` class from
 * its own key, this one owns `data-accent` from another. They touch different
 * attributes, so running both is safe.
 * Cleans up any stale non-municipal data-accent attribute or storage.
 */
export const ACCENT_INIT_SCRIPT = `(function(){try{var a=localStorage.getItem('${ACCENT_STORAGE_KEY}');var v=${JSON.stringify(
  ACCENTS.map((accent) => accent.id),
)};if(a&&v.indexOf(a)!==-1&&a!=='${DEFAULT_ACCENT}')document.documentElement.setAttribute('data-accent',a);}catch(e){}})();`;
export const ACCENT_INIT_SCRIPT = `(function(){try{localStorage.removeItem('${ACCENT_STORAGE_KEY}');document.documentElement.removeAttribute('data-accent');}catch(e){}})();`;
