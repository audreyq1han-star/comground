'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { activities, type ActivityId } from './preview-model';
import { usePreview } from './PreviewProvider';
import { ExampleFacts, RequirementResult } from './ExampleRequirements';
import { CommunityScene } from './CommunityScene';

export function ExampleShortlist() {
  const { shortlist, remove } = usePreview();
  const [message, setMessage] = useState('');
  const focusAfterRemoval = useRef(false);
  const region = useRef<HTMLDivElement>(null);
  const selected = shortlist.flatMap(id => activities.filter(activity => activity.id === id));
  useEffect(() => {
    if (focusAfterRemoval.current) {
      focusAfterRemoval.current = false;
      region.current?.querySelector<HTMLElement>('[data-remove], .empty-state a')?.focus();
    }
  }, [shortlist]);
  function removeExample(id: ActivityId, title: string) {
    focusAfterRemoval.current = true;
    remove(id);
    setMessage(`${title} removed from the example shortlist.`);
  }
  return <div ref={region}>
    <p className="action-status" role="status" aria-live="polite" aria-atomic="true">{message}</p>
    {selected.length ? <><div className="shortlist-list">{selected.map(activity => <article key={activity.id} className="shortlist-row">
      <div className="shortlist-image"><CommunityScene scene={activity.id} decorative crop="wide" /></div>
      <div className="shortlist-content"><p className="eyebrow">Fictional example · {activity.category}</p><h2><Link href={`/explore/${activity.id}`}>{activity.title}</Link></h2><ExampleFacts activity={activity} /><p className="small-note"><strong>Guardian requirement:</strong> {activity.guardian ? 'Guardian required in this example' : 'Not specified in this example'}</p><RequirementResult activity={activity} compact /><div className="row-actions"><Link href={`/explore/${activity.id}`} className="text-link">Read details <span aria-hidden="true">↗</span></Link><button type="button" data-remove className="plain-button" aria-label={`Remove ${activity.title} from example shortlist`} onClick={() => removeExample(activity.id, activity.title)}>Remove</button></div></div>
    </article>)}</div><section className="next-step"><div><p className="eyebrow">A question is a useful next step</p><h2>Before an interest becomes a plan.</h2><p>Think through dates, travel, supervision, and any school requirements before taking part in a real activity.</p></div><div className="next-step-actions"><Link href="/how-it-works#checklist" className="primary-link">Review the checklist <span aria-hidden="true">↗</span></Link><Link href="/explore" className="text-link">Explore more examples <span aria-hidden="true">↗</span></Link></div></section></> : <div className="empty-state shortlist-empty"><div className="empty-illustration"><CommunityScene scene="reading" decorative crop="wide" /></div><div><p className="eyebrow">A little room for ideas</p><h2>Start with one possibility.</h2><p>Open an activity that interests you and add it here. You can compare the details before choosing what to ask next.</p><Link href="/explore" className="primary-link">Explore examples <span aria-hidden="true">↗</span></Link></div></div>}
  </div>;
}
