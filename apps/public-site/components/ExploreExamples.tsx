'use client';

import Link from 'next/link';
import { CommunityScene } from './CommunityScene';
import { usePreview } from './PreviewProvider';
import { ExampleFacts, RequirementResult, SampleAgeControl } from './ExampleRequirements';
import { filterActivities, type ActivityCategory, type ActivityFormat } from './preview-model';

const categories: ActivityCategory[] = ['All activities', 'Environment', 'Community', 'Education'];
const formats: ActivityFormat[] = ['Any format', 'In person', 'Remote'];

export function ExploreExamples() {
  const { category, setCategory, format, setFormat, shortlist, age } = usePreview();
  const visible = filterActivities(category, format);
  return <div className="listing-layout">
    <aside className="filter-panel" aria-label="Example choices">
      <fieldset className="filter-group"><legend>Type of activity</legend><div className="filter-options">{categories.map(value => <button type="button" key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{value}</button>)}</div></fieldset>
      <fieldset className="filter-group"><legend>How to take part</legend><div className="filter-options">{formats.map(value => <button type="button" key={value} aria-pressed={format === value} onClick={() => setFormat(value)}>{value}</button>)}</div></fieldset>
      <SampleAgeControl />
      {shortlist.length > 0 && <Link href="/shortlist" className="text-link">View example shortlist ({shortlist.length}) <span aria-hidden="true">↗</span></Link>}
    </aside>
    <section className="example-results" aria-labelledby="results-title">
      <div className="results-heading"><h2 id="results-title" tabIndex={-1}>Activities to explore</h2><p role="status" aria-live="polite" aria-atomic="true">Showing {visible.length} fictional {visible.length === 1 ? 'example' : 'examples'}<span className="sr-only">. Requirements shown for the {age} sample.</span></p></div>
      {visible.length ? <div className="example-list">{visible.map(activity => <article key={activity.id} className="example-row">
        <div className="example-thumb"><CommunityScene scene={activity.id} decorative crop="wide" /></div>
        <div className="example-content"><p className="eyebrow">Fictional example · {activity.category}</p><h2><Link href={`/explore/${activity.id}`}>{activity.title}</Link></h2><p>{activity.description}</p><ExampleFacts activity={activity} /><RequirementResult activity={activity} compact /><Link href={`/explore/${activity.id}`} className="text-link" aria-label={`See example: ${activity.title}`}>See example <span aria-hidden="true">↗</span></Link></div>
      </article>)}</div> : <div className="empty-state"><h3>No examples with those choices.</h3><p>This preview has three activities. Try a different type or format to see another one.</p><button type="button" className="primary-link" onClick={() => { setCategory('All activities'); setFormat('Any format'); document.getElementById('results-title')?.focus(); }}>Show all examples <span aria-hidden="true">↗</span></button></div>}
    </section>
  </div>;
}
