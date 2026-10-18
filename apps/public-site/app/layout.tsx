import type { Metadata } from 'next';
import { PreviewProvider } from '../components/PreviewProvider';
import { SiteHeader, SiteFooter } from '../components/SiteShell';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'CommonGround — Find a way to get involved', template: '%s — CommonGround' },
  description: 'Explore a CommonGround preview for high-school students. Compare three fictional volunteer activities, understand their requirements, and try an example shortlist.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><PreviewProvider><a className="skip-link" href="#main">Skip to content</a><SiteHeader /><main id="main" tabIndex={-1}>{children}</main><SiteFooter /></PreviewProvider></body></html>;
}
