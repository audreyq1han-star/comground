'use client';
import type { CatalogueRevision } from '../../../../packages/domain/app-contracts.ts';
import { Timestamp } from './AdminShared';
import { changedRevisionFields } from './catalogue-view';

function fact(value: unknown): string {
  if (value === null) return 'Unknown';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

export function CatalogueHistory({ revisions }: { revisions: CatalogueRevision[] }) {
  return <section className="op-panel">
    <h2>Compare recorded facts</h2>
    <p className="op-quiet">Each recorded import or edit retains its facts and evidence. Review decisions below refer to these versions. Earlier values that were not stored cannot be reconstructed.</p>
    {!revisions.length ? <p>No historical fact snapshots were stored for this existing record. Its next changed import or edit will retain a before-and-after comparison.</p> : [...revisions].reverse().map((revision, index) => <details className="op-details" key={revision.version} open={index === 0 && revision.before !== null}>
      <summary>Version {revision.version} · {revision.action === 'EDIT' ? 'Local edit' : 'Fixture import'} · {revision.before ? 'Compare before and after' : 'Initial recorded facts'}</summary>
      <p><Timestamp value={revision.at}/></p>
      {revision.before === null && <p>No earlier record existed for this initial import.</p>}
      {revision.before !== null && revisions[0]?.version === revision.version && revision.version > 1 && <p>History before this change was not stored. The before values are the record observed when this change was made.</p>}
      {changedRevisionFields(revision).map(field => <div key={field}>
        <h3>{field}</h3>
        <dl className="op-facts">
          {revision.before !== null && <div><dt>Before</dt><dd className="op-break" style={{whiteSpace:'pre-wrap'}}>{fact(revision.before[field])}</dd></div>}
          <div><dt>{revision.before === null ? 'Recorded value' : 'After'}</dt><dd className="op-break" style={{whiteSpace:'pre-wrap'}}>{fact(revision.after[field])}</dd></div>
        </dl>
      </div>)}
    </details>)}
  </section>;
}
