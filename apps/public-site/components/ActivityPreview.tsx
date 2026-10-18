'use client';

import { useRef, useState } from 'react';
import { CommunityScene } from './CommunityScene';
import { ShimmerButton } from './magicui/shimmer-button';
import { activities, compareExampleAge, type ActivityId, type ExampleAge } from './preview-model';

export function ActivityPreview() {
  const [active, setActive] = useState<ActivityId>('garden');
  const [age, setAge] = useState<ExampleAge>('16–17');
  const [narrow, setNarrow] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const selected = activities.find(activity => activity.id === active)!;
  const effectiveAge = age === '13–15' && narrow ? '14–15' : age;
  const result = compareExampleAge(effectiveAge, selected.minimumAge, selected.guardian);
  return <div className="preview-workspace">
    <div className="preview-controls">
      <p className="eyebrow">01 / Your fictional starting point</p>
      <label className="control-label" htmlFor="example-age">Choose an example age range</label>
      <select id="example-age" value={age} onChange={event => { setAge(event.target.value as ExampleAge); setNarrow(false); }}>
        <option value="13–15">Ages 13–15</option><option value="16–17">Ages 16–17</option><option value="18+">Age 18+ and in high school</option>
      </select>
      {age === '13–15' && <label className="narrow-choice"><input type="checkbox" checked={narrow} onChange={event => setNarrow(event.target.checked)} /> Use a narrower 14–15 example</label>}
      <p className="small-note">Fictional choices only. No birth date or personal details needed.</p>
      <p className="control-label activity-label" id="activity-label">Pick something you’re curious about</p>
      <div className="activity-choices" role="group" aria-labelledby="activity-label">
        {activities.map((activity, index) => <button key={activity.id} type="button" aria-pressed={active === activity.id} onClick={() => setActive(activity.id)}><span className="activity-index">0{index + 1}</span><span><strong>{activity.category}</strong><small>{activity.location} · Ages {activity.minimumAge}+</small></span><span aria-hidden="true">↗</span></button>)}
      </div>
    </div>
    <article className="activity-example" aria-labelledby="example-title">
      <div className="example-image"><CommunityScene scene={selected.id} /><span className="image-caption">Fictional example / 0{activities.indexOf(selected) + 1}</span></div>
      <div className="example-content"><p className="eyebrow">02 / Look at the details</p><h3 id="example-title">{selected.title}</h3><p>{selected.description}</p>
        <dl className="example-facts"><div><dt>Age</dt><dd>{selected.minimumAge}+</dd></div><div><dt>Time</dt><dd>{selected.duration}</dd></div><div><dt>Cost</dt><dd>No fee</dd></div></dl>
        <div className={`example-result ${result.kind}`} role="status" aria-live="polite" aria-atomic="true"><span aria-hidden="true">{result.kind === 'fits' ? '↗' : '↳'}</span><div><strong>{result.title}</strong><p>{result.explanation}</p></div></div>
        <ShimmerButton ref={opener} onClick={() => dialog.current?.showModal()}>See example details <span aria-hidden="true">↗</span></ShimmerButton>
      </div>
    </article>
    <dialog ref={dialog} className="example-dialog" aria-labelledby="detail-title" onClose={() => opener.current?.focus()} onClick={event => { if (event.target === dialog.current) dialog.current.close(); }}>
      <div className="dialog-inner"><div className="dialog-top"><p className="eyebrow">Fictional example · No booking available</p><button className="close-dialog" aria-label="Close example details" onClick={() => dialog.current?.close()}>×</button></div>
        <h2 id="detail-title">{selected.title}</h2><p>{selected.reason}</p>
        <ol className="detail-stages"><li><strong>Facts</strong><p>Ages {selected.minimumAge}+ · {selected.location} · {selected.duration} · No fee.</p><p>{selected.guardian ? 'A guardian is required.' : 'No prior training or guardian requirement is specified in this fictional example.'}</p></li><li><strong>Check before joining</strong><p>{selected.check}</p><p>{result.explanation}</p></li><li><strong>Next step</strong><p>In a real listing, you would confirm the details with the organizer. These examples cannot be booked. Ask your school separately about credit or service hours.</p></li></ol>
        <button className="plain-button" onClick={() => dialog.current?.close()}>Back to the examples <span aria-hidden="true">↗</span></button>
      </div>
    </dialog>
  </div>;
}
