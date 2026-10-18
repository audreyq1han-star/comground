'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) { return <header className="student-page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action}</header>; }
export function LoadState({ loading, error, refreshing = false, refreshError = '', retry, children }: { loading: boolean; error: string; refreshing?: boolean; refreshError?: string; retry: () => void; children: ReactNode }) {
  if (loading) return <div role="status" aria-busy="true"><p className="loading-label">Loading the latest local data…</p><div className="skeleton" /></div>;
  if (error) return <div className="notice error" role="alert"><h2>We couldn’t finish that request.</h2><p>{error}</p><button className="button secondary" onClick={retry}>Try again</button></div>;
  return <>{refreshing && <p className="loading-label" role="status">Refreshing the latest local data…</p>}{refreshError && <div className="notice error" role="alert"><p>{refreshError} The previous data is still shown; unsaved choices are kept.</p><button className="button secondary" onClick={retry}>Try again</button></div>}{children}</>;
}
export function EmptyPanel({ title, text, href, label }: { title: string; text: string; href?: string; label?: string }) { return <div className="empty-state compact"><span className="empty-symbol" aria-hidden="true">↗</span><h2>{title}</h2><p>{text}</p>{href && <Link href={href} className="button secondary">{label}</Link>}</div>; }
export const activityLabels = { OPENED: 'Demo destination preview', APPLIED: 'Applied · self-reported', ATTENDED: 'Attended · self-reported', NOT_ATTENDED: 'Did not attend · self-reported', WITHDRAWN: 'Withdrawn · self-reported' };
