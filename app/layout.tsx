import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Neural Core | Personal Knowledge Network',
  description: 'An independent, private, local-first knowledge network for AI conversations.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
