import Link from 'next/link';

export default function NotFound() {
  return <div className="page-wrap recovery-page"><p className="eyebrow">Page not found</p><h1>We couldn’t find that example.</h1><p className="page-lead">This preview includes three fictional activities. Choose one from Explore to continue.</p><Link href="/explore" className="primary-link">Explore examples <span aria-hidden="true">↗</span></Link></div>;
}
