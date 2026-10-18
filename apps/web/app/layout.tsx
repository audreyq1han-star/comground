import type { Metadata } from 'next';
import { Header } from '../components/Header';
import './globals.css';
import { StudentProvider } from '../components/student/StudentSession';
import { RuntimeProvider, SiteFooter } from '../components/account/RuntimeContext';
import { connection } from 'next/server';

export const metadata: Metadata = { title: { default: 'CommonGround', template: '%s · CommonGround' }, description: 'Explore opportunities and control your preferences, privacy and saved activity.', robots: { index: false, follow: false } };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection();
  return <html lang="en"><body><RuntimeProvider><StudentProvider><a className="skip-link" href="#main">Skip to content</a><Header /><main id="main">{children}</main><SiteFooter/></StudentProvider></RuntimeProvider></body></html>;
}
