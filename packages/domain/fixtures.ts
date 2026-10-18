import type { FixtureOption, FixtureRecord } from './contracts.ts';

/** Pure local examples: no source is contacted and no real opportunity is implied. */
export function fixtureList(now = new Date()): FixtureOption[] {
  if (!Number.isFinite(now.getTime())) throw new RangeError('Fixture clock must be a valid date.');
  // Day anchoring keeps repeated operator imports idempotent despite request times.
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const at = (hours: number) => new Date(day + hours * 3_600_000).toISOString();
  const base: FixtureRecord = {
    isSynthetic: true,
    source: {
      id: 'synthetic-community-feed', name: 'Synthetic community fixture', url: 'https://example.invalid/fixture-feed',
      method: 'FIXTURE', permission: 'APPROVED',
      permissionEvidence: 'Synthetic permission example for this local fixture only. No real permission or partnership is claimed.',
    },
    organization: { id: 'synthetic-garden-org', name: 'Example Community Garden (synthetic)', url: 'https://example.invalid/garden' },
    externalId: 'synthetic-garden-001', title: 'Community garden morning — synthetic example',
    summary: 'An illustrative two-hour gardening session. This synthetic fixture is for local testing and cannot be booked.',
    category: 'Environment', interests: ['environment', 'outdoors'], minAge: 16, maxAge: null,
    startsAt: at(178), endsAt: at(180), timezone: 'UTC', mode: 'IN_PERSON', area: 'Example neighborhood',
    fee: 0, requiresTraining: false, requiresGuardian: false, schoolCreditApproved: false,
    signupUrl: 'https://example.invalid/garden/signup', sourceUpdatedAt: at(-2), fetchedAt: at(0), confirmedAt: at(0),
    validUntil: at(72), isCancelled: false,
    evidence: [
      { field: 'minAge', excerpt: 'Synthetic source statement: participants must be at least 16.', sourceUrl: 'https://example.invalid/garden' },
      { field: 'requirements', excerpt: 'Synthetic source statement: free; no prior training or guardian required. School-credit approval has not been granted.', sourceUrl: 'https://example.invalid/garden' },
    ],
  };
  const option = (fixtureId: string, label: string, changes: Partial<FixtureRecord> = {}): FixtureOption => ({
    fixtureId, label: `Synthetic example · ${label}`, record: { ...structuredClone(base), ...changes },
  });
  const learningSource: FixtureRecord['source'] = {
    ...base.source, id: 'synthetic-learning-feed', name: 'Synthetic learning fixture', url: 'https://example.invalid/learning-feed',
  };
  const evidence = (path: string, excerpt: string): FixtureRecord['evidence'] => [
    { field: 'participation', excerpt: `Synthetic source statement: ${excerpt} School-credit approval has not been granted.`, sourceUrl: `https://example.invalid/${path}` },
  ];
  return [
    option('garden', 'Complete garden opportunity'),
    option('remote', 'Complete remote reading opportunity', {
      externalId: 'synthetic-reading-001', organization: { id: 'synthetic-reading-org', name: 'Example Reading Group (synthetic)', url: 'https://example.invalid/reading' },
      title: 'Remote reading preparation — synthetic example', summary: 'An illustrative remote reading-material preparation session. This is synthetic and cannot be booked.',
      category: 'Education', interests: ['education', 'reading'], mode: 'REMOTE', area: 'Online',
      startsAt: at(202), endsAt: at(204), signupUrl: 'https://example.invalid/reading/signup',
      evidence: [
        { field: 'minAge', excerpt: 'Synthetic reading-source statement: participants must be at least 16.', sourceUrl: 'https://example.invalid/reading' },
        { field: 'requirements', excerpt: 'Synthetic reading-source statement: free remote preparation; no training or guardian required. School-credit approval has not been granted.', sourceUrl: 'https://example.invalid/reading' },
      ],
    }),
    option('missing-age', 'Missing minimum age; publication blocked', {
      externalId: 'synthetic-missing-age-001', title: 'Unconfirmed age requirement — synthetic example', minAge: null,
      evidence: [{ field: 'minAge', excerpt: 'Synthetic source does not state a minimum age.', sourceUrl: 'https://example.invalid/garden' }],
    }),
    option('expired', 'Expired occurrence; publication blocked', {
      externalId: 'synthetic-expired-001', title: 'Past gardening session — synthetic example',
      startsAt: at(-48), endsAt: at(-46), validUntil: at(-24), confirmedAt: at(-96), fetchedAt: at(-96), sourceUpdatedAt: at(-98),
    }),
    option('cancelled', 'Cancelled occurrence; publication blocked', {
      externalId: 'synthetic-cancelled-001', title: 'Cancelled session — synthetic example', isCancelled: true,
    }),
    option('no-permission', 'Unapproved source; publication blocked', {
      externalId: 'synthetic-unapproved-001', title: 'Pending source permission — synthetic example',
      source: { ...base.source, id: 'synthetic-pending-feed', permission: 'PENDING', permissionEvidence: '' },
    }),
    option('garden-changed', 'Garden minimum age changes to 18; fresh review required', {
      minAge: 18, sourceUpdatedAt: at(-1),
      evidence: [
        { field: 'minAge', excerpt: 'Changed synthetic source statement: participants must be at least 18.', sourceUrl: 'https://example.invalid/garden' },
        structuredClone(base.evidence[1]),
      ],
    }),
    option('pantry', 'Food pantry packing; ages 14+ with a guardian', {
      externalId: 'synthetic-pantry-001', organization: { id: 'synthetic-pantry-org', name: 'Example Food Pantry (synthetic)', url: 'https://example.invalid/pantry' },
      title: 'Food pantry packing — synthetic example', summary: 'An illustrative packing session with a guardian requirement. No real pantry, placement or booking is represented.',
      category: 'Community', interests: ['community', 'food'], minAge: 14, requiresGuardian: true,
      startsAt: at(58), endsAt: at(61), signupUrl: 'https://example.invalid/pantry/signup',
      evidence: evidence('pantry', 'Ages 14 and older; guardian required; free; no prior training required.'),
    }),
    option('river-cleanup', 'Riverside cleanup; safety training required', {
      externalId: 'synthetic-river-001', organization: { id: 'synthetic-river-org', name: 'Example River Group (synthetic)', url: 'https://example.invalid/river' },
      title: 'Riverside cleanup — synthetic example', summary: 'An illustrative cleanup requiring completed safety training. The listed area is a fictional coarse area, not a real location.',
      category: 'Environment', interests: ['environment', 'outdoors'], area: 'Example riverside', requiresTraining: true,
      startsAt: at(105), endsAt: at(108), signupUrl: 'https://example.invalid/river/signup',
      evidence: evidence('river', 'Ages 16 and older; safety training required; no guardian requirement; free.'),
    }),
    option('animal-care', 'Animal care preparation; ages 18+, training and a fee', {
      externalId: 'synthetic-animal-001', organization: { id: 'synthetic-animal-org', name: 'Example Animal Project (synthetic)', url: 'https://example.invalid/animals' },
      title: 'Animal care preparation — synthetic example', summary: 'An illustrative adult-only preparation session. Its fee and training requirements demonstrate eligibility filtering; no real animal-care placement is offered.',
      category: 'Animals', interests: ['animals', 'community'], minAge: 18, requiresTraining: true, fee: 5,
      startsAt: at(154), endsAt: at(156), signupUrl: 'https://example.invalid/animals/signup',
      evidence: evidence('animals', 'Ages 18 and older; training required; no guardian requirement; fee 5 demo units.'),
    }),
    option('youth-arts', 'Youth arts setup; ages 14–17 with a guardian and a fee', {
      source: { ...learningSource }, externalId: 'synthetic-arts-001', organization: { id: 'synthetic-arts-org', name: 'Example Arts Workshop (synthetic)', url: 'https://example.invalid/arts' },
      title: 'Youth arts workshop setup — synthetic example', summary: 'An illustrative workshop setup opportunity limited to ages 14–17. This is synthetic, with no real workshop enrollment or school approval.',
      category: 'Arts', interests: ['arts', 'creativity'], minAge: 14, maxAge: 17, requiresGuardian: true, fee: 10,
      startsAt: at(134), endsAt: at(136), signupUrl: 'https://example.invalid/arts/signup',
      evidence: evidence('arts', 'Ages 14–17 inclusive; guardian required; no prior training; fee 10 demo units.'),
    }),
    option('remote-tech', 'Remote learning-resource check; training required', {
      source: { ...learningSource }, externalId: 'synthetic-tech-001', organization: { id: 'synthetic-tech-org', name: 'Example Digital Learning Group (synthetic)', url: 'https://example.invalid/technology' },
      title: 'Remote learning-resource check — synthetic example', summary: 'An illustrative remote task for students who have completed the stated preparation. It is a local test example, not an actual placement.',
      category: 'Technology', interests: ['technology', 'education'], mode: 'REMOTE', area: 'Online', requiresTraining: true,
      startsAt: at(88), endsAt: at(90), signupUrl: 'https://example.invalid/technology/signup',
      evidence: evidence('technology', 'Ages 16 and older; remote attendance; training required; no guardian requirement; free.'),
    }),
    option('past-reading', 'Historical remote reading example; ended three days ago', {
      source: { ...learningSource }, externalId: 'synthetic-past-reading-001', organization: { id: 'synthetic-reading-org', name: 'Example Reading Group (synthetic)', url: 'https://example.invalid/reading' },
      title: 'Past reading preparation — synthetic example', summary: 'A historical synthetic session for testing self-reported activity. It is not a record of a real application, placement or attendance.',
      category: 'Education', interests: ['education', 'reading'], mode: 'REMOTE', area: 'Online',
      startsAt: at(-62), endsAt: at(-60), sourceUpdatedAt: at(-144), fetchedAt: at(-120), confirmedAt: at(-120), validUntil: at(-48),
      signupUrl: 'https://example.invalid/reading/past-signup',
      evidence: evidence('reading', 'Ages 16 and older; remote attendance; free; no training or guardian required. This historical example ended three days ago.'),
    }),
    option('garden-series', 'Three weekly garden dates; manual import example', {
      externalId: 'synthetic-garden-series-001', title: 'Weekly garden mornings — synthetic example',
      summary: 'Three explicit synthetic dates for one opportunity. Pick a date that fits; each date can be cancelled or expire independently. No real place or booking is offered.',
      startsAt: at(58), endsAt: at(60), validUntil: at(72),
      occurrences: [
        { id: 'primary', startsAt: at(58), endsAt: at(60), timezone: 'UTC', validUntil: at(72), isCancelled: false },
        { id: 'week-2', startsAt: at(226), endsAt: at(228), timezone: 'UTC', validUntil: at(240), isCancelled: false },
        { id: 'week-3', startsAt: at(394), endsAt: at(396), timezone: 'UTC', validUntil: at(408), isCancelled: false },
      ],
      evidence: evidence('garden', 'Ages 16 and older; three explicit weekly dates; free; no training or guardian required. Dates and their freshness windows are illustrative.'),
    }),
  ];
}
