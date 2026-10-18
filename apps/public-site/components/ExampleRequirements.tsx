'use client';

import { useId } from 'react';
import { usePreview } from './PreviewProvider';
import { compareExampleAge, type ExampleActivity, type ExampleAge } from './preview-model';

export function SampleAgeControl() {
  const { age, setAge } = usePreview();
  const id = useId();
  return <div className="sample-control">
    <label className="control-label" htmlFor={id}>Try a sample age range</label>
    <p className="small-note" id={`${id}-help`}>Choose a fictional range to see the age check. This is not a question about your age.</p>
    <select id={id} aria-describedby={`${id}-help`} value={age === '14–15' ? '13–15' : age} onChange={event => setAge(event.target.value as ExampleAge)}>
      <option value="13–15">Ages 13–15</option><option value="16–17">Ages 16–17</option><option value="18+">Age 18+ and in high school</option>
    </select>
    {(age === '13–15' || age === '14–15') && <button type="button" className="narrow-choice plain-button" aria-pressed={age === '14–15'} onClick={() => setAge(age === '14–15' ? '13–15' : '14–15')}>{age === '14–15' ? 'Using the narrower 14–15 example' : 'Try the narrower 14–15 example'}</button>}
  </div>;
}

export function RequirementResult({ activity, compact = false }: { activity: ExampleActivity; compact?: boolean }) {
  const { age } = usePreview();
  const result = compareExampleAge(age, activity.minimumAge, activity.guardian);
  return <div className={`requirement-result ${result.kind}${compact ? ' compact' : ''}`} role={compact ? undefined : 'status'} aria-live={compact ? undefined : 'polite'} aria-atomic={compact ? undefined : true}>
    <p className="requirement-sample">With the {age} sample</p>
    <strong>{result.title}</strong>
    {!compact && <p>{result.explanation}</p>}
    {result.kind === 'outside' && activity.guardian && <p>A guardian is also required in this example.</p>}
  </div>;
}

export function ExampleFacts({ activity, detailed = false }: { activity: ExampleActivity; detailed?: boolean }) {
  return <dl className={detailed ? 'detail-facts' : 'example-facts'}>
    <div><dt>Age requirement</dt><dd>{activity.minimumAge}+</dd></div>
    <div><dt>Time commitment</dt><dd>{activity.duration}</dd></div>
    <div><dt>Format</dt><dd>{activity.location}</dd></div>
    {detailed && <><div><dt>Cost</dt><dd>No fee in this example</dd></div><div><dt>Guardian requirement</dt><dd>{activity.guardian ? 'Guardian required in this example' : 'Not specified in this example'}</dd></div><div><dt>Date</dt><dd>No date is scheduled</dd></div><div><dt>Training</dt><dd>Not specified in this example</dd></div></>}
  </dl>;
}
