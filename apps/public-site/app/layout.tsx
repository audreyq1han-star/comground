import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CommonGround — A clear first step',
  description: 'A local prelaunch design preview for high-school students exploring volunteering and community activities. All activities are fictional.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
