'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Brand } from './Brand';
import { usePreview } from './PreviewProvider';

const links = [
  { href: '/explore', label: 'Explore' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/for-families', label: 'For families' },
];

export function SiteHeader() {
  const pathname = usePathname().replace(/\/$/, '') || '/';
  const { shortlist } = usePreview();
  return <header className="site-header">
    <Link href="/" className="brand-link" aria-label="CommonGround home"><Brand /></Link>
    <nav className="site-nav" aria-label="Main navigation">
      {links.map(link => <Link key={link.href} href={link.href} aria-current={pathname === link.href || pathname.startsWith(`${link.href}/`) ? 'page' : undefined}>{link.label}</Link>)}
    </nav>
    <Link href="/shortlist" className="shortlist-link" aria-current={pathname === '/shortlist' ? 'page' : undefined}>Example shortlist{shortlist.length > 0 && <span className="shortlist-count">{shortlist.length}</span>}</Link>
  </header>;
}

export function SiteFooter() {
  return <footer className="site-footer">
    <div className="footer-top"><Link href="/" className="brand-link" aria-label="CommonGround home"><Brand /></Link><nav aria-label="Footer navigation">{links.map(link => <Link key={link.href} href={link.href}>{link.label}</Link>)}<Link href="/shortlist">Example shortlist</Link></nav></div>
    <div className="footer-bottom"><p>A preview for high-school students.<br />Fictional activities. No applications or account signup.</p><span>© 2026 CommonGround</span></div>
  </footer>;
}
