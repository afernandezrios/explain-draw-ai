import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import './globals.css';

/*
 * The app's two faces. Space Grotesk carries the whole interface; JetBrains
 * Mono is reserved for the Take column's viewfinder readouts -- the clock, the
 * scene counters, the project id, the worker log.
 *
 * This deliberately reverses the old "no web font" rule: the control-room
 * design leans on a distinctive face, and next/font downloads and self-hosts
 * both at the first dev run or build. The first build in a fresh environment
 * therefore needs network, the same way the render pipeline already does.
 */
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-ui',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Explain-Draw AI',
  description: 'Turn a topic into a clean, diagram-style explainer video.',
  icons: { icon: '/favicon.svg' },
};

/**
 * Exporting `viewport` replaces Next's defaults, so width and initialScale are
 * spelled out: without them a mobile browser assumes a desktop viewport and
 * zooms the page out. `colorScheme: dark` is what gives native scrollbars and
 * form controls their dark chrome without a line of CSS.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#14161B',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${jetbrainsMono.variable}`}>
      {/*
       * The ground is the control room's own tint, and the shell lays the
       * sections on it. The browser supplies the window: no frame, no
       * title-bar mimicry, no shell shadow.
       */}
      <body className="app-ground">{children}</body>
    </html>
  );
}
