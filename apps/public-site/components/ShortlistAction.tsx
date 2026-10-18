'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePreview } from './PreviewProvider';
import { ShimmerButton } from './magicui/shimmer-button';
import type { ExampleActivity } from './preview-model';

export function ShortlistAction({ activity }: { activity: ExampleActivity }) {
  const { shortlist, add } = usePreview();
  const [message, setMessage] = useState('');
  const added = shortlist.includes(activity.id);
  return <section className="shortlist-action" aria-labelledby="shortlist-action-title">
    <h2 id="shortlist-action-title">Worth comparing?</h2>
    <p>Add this fictional activity to your example shortlist. It stays while you move between these pages and clears when you reload.</p>
    <ShimmerButton type="button" className={added ? 'is-added' : ''} aria-disabled={added} onClick={() => { if (!added) { add(activity.id); setMessage(`${activity.title} added. No application has been sent.`); } }}>{added ? 'Added to example shortlist' : 'Add to example shortlist'}<span aria-hidden="true">{added ? '✓' : '+'}</span></ShimmerButton>
    <p className="action-status" role="status" aria-live="polite" aria-atomic="true">{message}</p>
    {added && <Link href="/shortlist" className="text-link">View example shortlist <span aria-hidden="true">↗</span></Link>}
    <p className="small-note">This is a comparison tool. These activities cannot be booked.</p>
  </section>;
}
