import type { Metadata, Viewport } from 'next';

import { csrfToken } from '@/lib/security/guard';

import './globals.css';

export const metadata: Metadata = {
  title: 'DevAtlas',
  description: 'A local-first workspace for organizing and inspecting your Git repositories.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const dynamic = 'force-dynamic';

/**
 * The CSRF token is embedded in the document so client code can echo it back in
 * a header. A cross-site page cannot read this document, so it cannot obtain
 * the token — which is what makes the double-submit check meaningful on a
 * loopback server.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="devatlas-csrf" content={csrfToken()} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
