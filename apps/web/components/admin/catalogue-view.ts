import type { AdminCatalogueRecord, CatalogueRevision } from '../../../../packages/domain/app-contracts.ts';
import type { FixtureRecord } from '../../../../packages/domain/contracts.ts';

export function utcDateTimeInput(value: string): string {
  return new Date(value).toISOString().slice(0, 16);
}

/** Review lifecycle and current availability are independent operator filters. */
export function matchesCatalogueStatus(item: AdminCatalogueRecord, filter: string): boolean {
  if (filter === 'ALL') return true;
  return ['DRAFT', 'PUBLISHED', 'REJECTED'].includes(filter) ? item.status === filter : item.effectiveStatus === filter;
}

export function changedRevisionFields(revision: CatalogueRevision): (keyof FixtureRecord)[] {
  return (Object.keys(revision.after) as (keyof FixtureRecord)[]).filter(field =>
    revision.before === null || JSON.stringify(revision.before[field]) !== JSON.stringify(revision.after[field]));
}
