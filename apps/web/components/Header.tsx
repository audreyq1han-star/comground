'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sunrise } from './Brand';
import { useStudent } from './student/StudentSession';
import { useRuntime } from './account/RuntimeContext';
export function Header() {
  const path = usePathname();
  const { session, loading } = useStudent();
  const { runtime } = useRuntime();
  const admin = path.startsWith('/admin');
  const links = admin ? [['/', 'Student app'], ['/admin', 'Operator console']] : [['/', 'Dashboard'], ['/opportunities', 'Explore'], ['/matches', 'Matches'], ['/saved', 'Saved'], ['/activity', 'Activity'], ['/alerts', 'Alerts'], ['/digest','Digest'], ['/evidence','Evidence'], ['/safety','Safety']];
  return <><div className="demo-banner">{runtime?.capabilities.demoPersonas ? <>Local demo <span aria-hidden="true">•</span> synthetic opportunities <span aria-hidden="true">•</span> rule-based matching</> : runtime ? <>High-school volunteering <span aria-hidden="true">•</span> {runtime.catalogue === 'EMPTY_PENDING_FEEDS' ? 'real feeds not connected' : 'synthetic test catalogue'} <span aria-hidden="true">•</span> optional features start off</> : 'Checking available features…'}</div><header className="site-header product-header"><div className="header-top"><Link className="brand" href="/" aria-label="CommonGround home"><Sunrise /><span>CommonGround</span></Link><div className="header-account">{!admin && runtime && <Link className="persona-link" href={runtime.capabilities.accounts ? session.authenticated ? '/account' : '/account/login' : session.authenticated ? '/profile' : '/onboarding'}>{runtime.capabilities.accounts ? loading ? 'Account' : session.authenticated ? 'My account' : 'Sign in' : loading ? 'Demo profile' : session.persona?.label ?? 'Choose persona'}<span aria-hidden="true"> ↗</span></Link>}<Link prefetch={false} href={admin ? '/opportunities' : '/admin'} className="operator-link">{admin ? 'Explore' : 'Operator'}</Link></div></div><nav aria-label={admin ? 'Application navigation' : 'Student navigation'}>{links.map(([href, label]) => <Link prefetch={admin?false:undefined} key={href} href={href} aria-current={(href === '/' ? path === '/' || path === '/dashboard' : path.startsWith(href)) ? 'page' : undefined}>{label}</Link>)}</nav></header></>;
}
