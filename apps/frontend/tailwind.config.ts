import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Mirrors the Albazourieh platform's Tailwind theme so components copied
 * between the two render identically. Everything resolves through the CSS
 * variables in app/globals.css, which is also what lets a municipality override
 * its own primary colour at runtime from TenantConfig without a rebuild.
 */
const config: Config = {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: { '2xl': '1280px' },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // The third rung of the surface ramp — dialogs, sheets and select menus,
        // which sit above a card and previously had no token of their own to say
        // so. They all painted `bg-background`, which worked only for as long as
        // `--card` and `--background` were the same colour.
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        // Promoted from flat colours to pairs. `bg-warning/10` and `text-warning`
        // still resolve exactly as before — this only adds the `-foreground` half,
        // so a solid `bg-warning` finally has a legible text colour to pair with
        // instead of the hardcoded `text-white` the badge used to reach for.
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        // Arabic-first: the webfonts are the sans stack rather than a separate
        // family, so every `font-sans` component inherits them.
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
      },
      // 48px: the minimum comfortable target for the audience this serves.
      spacing: { touch: '3rem' },
    },
  },
  // The reference platform's animation plugin. The Radix components carry
  // `data-[state=open]:animate-in` / `fade-in-0` / `zoom-in-95` classes that are
  // inert without it — the dialog and select would pop rather than transition.
  plugins: [animate],
};

export default config;
