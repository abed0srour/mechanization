import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'تسجيل العقارات — البلديات',
  description: 'منصة تسجيل العقارات والوحدات السكنية للبلديات اللبنانية',
};

/**
 * Stated rather than left to the framework default.
 *
 * `maximumScale`/`userScalable` are deliberately *not* set: a citizen reading a
 * fee notice on a phone has every right to pinch-zoom it, and locking that is
 * the most common accessibility failure in a form like this one.
 *
 * `viewportFit: 'cover'` lets the page paint under a notch, which is what makes
 * the `env(safe-area-inset-*)` padding in globals.css meaningful — without it
 * the browser letterboxes the page and the insets always resolve to zero.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
