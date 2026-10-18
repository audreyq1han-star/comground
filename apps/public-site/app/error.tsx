'use client';

import Link from 'next/link';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="page-wrap recovery-page"><p className="eyebrow">Something went wrong</p><h1>This page didn’t open.</h1><p className="page-lead">Try again, or return to the examples.</p><div className="hero-actions"><button type="button" className="primary-link" onClick={reset}>Try again</button><Link href="/explore" className="text-link">Explore examples <span aria-hidden="true">↗</span></Link></div></div>;
}
