import test from 'node:test';
import assert from 'node:assert/strict';
import { communitySlug, plainDistributionCopy, distributionActor, distributionPagination } from './distribution-validation.ts';

test('public community slugs and copy reject path tricks, markup, contact data and invalid paging', () => {
  assert.equal(communitySlug('demo-school-club'), 'demo-school-club');
  for (const slug of ['../admin', 'a/b', 'admin', 'Name', 'two--hyphens', '-leading', 'trailing-']) assert.throws(() => communitySlug(slug), { code: 'INVALID_SLUG' });
  for (const copy of ['<script>alert(1)</script>', 'Visit https://example.invalid', 'Contact person@example.invalid', 'hidden\u0000text']) assert.throws(() => plainDistributionCopy(copy, 500), { code: 'INVALID_INPUT' });
  assert.equal(plainDistributionCopy(' Fictional volunteering club ', 80), 'Fictional volunteering club');
  assert.throws(() => distributionActor('supplied-admin'), { code: 'INVALID_ACTOR' });
  assert.throws(() => distributionPagination(0, 51), { code: 'INVALID_QUERY' });
});
