import assert from 'node:assert/strict';
import test from 'node:test';
import { activities, compareExampleAge, filterActivities } from './components/preview-model.ts';

test('the whole example age range must meet the minimum, with explicit narrowing only', () => {
  assert.equal(compareExampleAge('13–15', 14, true).kind, 'outside');
  assert.equal(compareExampleAge('14–15', 14, true).kind, 'check');
  assert.equal(compareExampleAge('14–15', 16, false).kind, 'outside');
  assert.equal(compareExampleAge('16–17', 16, false).kind, 'fits');
});
test('age 18+ in high school works without waiving a guardian requirement', () => {
  assert.equal(compareExampleAge('18+', 16, false).kind, 'fits');
  const pantry = activities.find(activity => activity.id === 'pantry')!;
  assert.equal(compareExampleAge('18+', pantry.minimumAge, pantry.guardian).kind, 'check');
});
test('activity and format filters combine, including empty results and reset', () => {
  assert.deepEqual(filterActivities('Environment', 'Remote'), []);
  assert.deepEqual(filterActivities('All activities', 'Remote').map(activity => activity.id), ['reading']);
  assert.deepEqual(filterActivities('Community', 'In person').map(activity => activity.id), ['pantry']);
  assert.equal(filterActivities('All activities', 'Any format').length, 3);
});
