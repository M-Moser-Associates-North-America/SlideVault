import type { Metadata } from 'next';
import '../docs/design-tokens.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'SlideVault',
  description: 'Find trusted slides and assemble editable PowerPoint content.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
