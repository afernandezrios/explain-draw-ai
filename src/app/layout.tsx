import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Explain-Draw AI',
  description: 'Turn a topic into a clean, diagram-style explainer video.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      {/*
       * The pane's tint is the document ground, and the client shell fills the
       * viewport from there. The browser supplies the window: no frame, no
       * title-bar mimicry, no shell shadow.
       */}
      <body className="app-ground">{children}</body>
    </html>
  );
}
