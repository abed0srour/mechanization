import type { Config } from 'tailwindcss';

/**
 * Palette and scale are driven by CSS variables declared in app/globals.css so
 * a municipality can override its own colours at runtime from TenantConfig
 * without a rebuild.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: 'var(--paper)',
        card: 'var(--card)',
        ink: 'var(--ink)',
        muted: 'var(--ink-muted)',
        cedar: 'var(--cedar)',
        'cedar-soft': 'var(--cedar-soft)',
        seal: 'var(--seal)',
        gold: 'var(--gold)',
        rule: 'var(--rule)',
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Floor is 1.125rem: this interface is used by elderly citizens on phones.
        base: ['1.125rem', { lineHeight: '1.75rem' }],
        lg: ['1.25rem', { lineHeight: '1.9rem' }],
        xl: ['1.5rem', { lineHeight: '2.1rem' }],
        '2xl': ['1.875rem', { lineHeight: '2.4rem' }],
        '3xl': ['2.35rem', { lineHeight: '2.8rem' }],
      },
      spacing: { touch: '3rem' },
      borderRadius: { card: '0.25rem' },
    },
  },
  plugins: [],
};

export default config;
