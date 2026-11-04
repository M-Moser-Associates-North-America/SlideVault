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
    // Browser extensions (screen recorders such as Scribe) add attributes to <html> before React
    // loads; this only stops that harmless mismatch warning, for <html>'s own attributes.
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
