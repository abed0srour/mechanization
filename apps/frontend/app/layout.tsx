import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'السجل البلدي — منصة العقارات والوحدات السكنية',
  description: 'النظام الرسمي لتسجيل وحصر العقارات والوحدات السكنية للبلديات اللبنانية',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
