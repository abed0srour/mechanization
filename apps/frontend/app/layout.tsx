import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'تسجيل العقارات — البلديات',
  description: 'منصة تسجيل العقارات والوحدات السكنية للبلديات اللبنانية',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
