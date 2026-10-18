import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSessionCookie } from './auth.ts';
import { repository } from './runtime.ts';
import { getSources, getOverview, getImportRuns, getOrganizations, getMatchingQa, getExceptions, getCommunities, listOpportunities, getOpportunity, updateSource, getAdminOpportunity, editAdminOpportunity, actOnOpportunity, getCommunity, updateCommunity } from './handlers.ts';

const origin = 'http://127.0.0.1:3100';
const globalState = globalThis as typeof globalThis & { comgroundRepository?: ReturnType<typeof repository>; comgroundFixtureEpoch?: Date };
function request(path: string, method = 'GET', body?: unknown, cookie?: string): Request {
  return new Request(`${origin}${path}`, { method, headers: { host: '127.0.0.1:3100', origin, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function reset() { globalState.comgroundRepository?.close(); delete globalState.comgroundRepository; delete globalState.comgroundFixtureEpoch; }

test('runtime seed, operator route guards and filtered public routes work without a server', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'comground-handler-'));
  const original = { db: process.env.COMGROUND_DB_PATH, skip: process.env.COMGROUND_SKIP_DEMO_SEED, token: process.env.LOCAL_REVIEW_TOKEN };
  process.env.COMGROUND_DB_PATH = join(directory, 'test.sqlite');
  process.env.LOCAL_REVIEW_TOKEN = 'local-synthetic-handler-test-token';
  delete process.env.COMGROUND_SKIP_DEMO_SEED; reset();
  try {
    for (const handler of [getSources,getOverview,getImportRuns,getOrganizations,getMatchingQa,getExceptions,getCommunities]) assert.equal((await handler(request('/api/admin/test'))).status, 401);
    const cookie = createSessionCookie(request('/api/admin/session')).split(';')[0];
    for (const handler of [getSources,getOverview,getImportRuns,getOrganizations,getMatchingQa,getExceptions,getCommunities]) assert.equal((await handler(request('/api/admin/test','GET',undefined,cookie))).status, 200);
    const publicResponse = await listOpportunities(request('/api/opportunities?mode=REMOTE&limit=1'));
    const result = await publicResponse.json(); assert.ok(result.total >= 2); assert.equal(result.data.length, 1);
    assert.equal((await listOpportunities(request('/api/opportunities?mode=FLYING'))).status, 400);
    assert.equal((await listOpportunities(request('/api/opportunities?maxFee=-1'))).status, 400);
    assert.equal((await listOpportunities(request('/api/opportunities?q=a&q=b'))).status, 400);
    const item = repository().listPublic({ q: 'garden' }).data[0];
    const selected = await getOpportunity(request(`/api/opportunities/${item.id}?occurrence=primary`), item.id);
    assert.equal(selected.status, 200); assert.equal((await selected.json()).data.occurrenceId, 'primary');
    assert.equal((await getOpportunity(request(`/api/opportunities/${item.id}?occurrence=unknown`), item.id)).status, 404);
    for (const query of ['occurrence=primary&occurrence=other', 'occurrence=bad.name', 'occurrence=', 'ownerId=demo-sam']) assert.equal((await getOpportunity(request(`/api/opportunities/${item.id}?${query}`), item.id)).status, 400);
    assert.equal((await getAdminOpportunity(request('/api/admin/opportunities/id'), item.id)).status, 401);
    const badEdit = await editAdminOpportunity(request('/api/admin/opportunities/id','PATCH',{ expectedVersion:item.version,reason:'Attempt owner injection',changes:{ ownerId:'someone' } },cookie),item.id);
    assert.equal(badEdit.status, 422);
    const edited = await editAdminOpportunity(request('/api/admin/opportunities/id','PATCH',{ expectedVersion:item.version,reason:'Synthetic edit',changes:{ title:'Synthetic edited title' } },cookie),item.id);
    assert.equal(edited.status,200); const changed = (await edited.json()).data; assert.equal(changed.status,'DRAFT');
    const withdrew = await actOnOpportunity(request('/api/admin/opportunities/id/actions','POST',{ expectedVersion:changed.version,action:'WITHDRAW',reason:'Withdraw example' },cookie),item.id);
    assert.equal(withdrew.status,200);
    const source = repository().listSources()[0];
    const paused = await updateSource(request('/api/admin/sources/id','PATCH',{ expectedVersion:source.version,paused:true,reason:'Pause example' },cookie),source.id);
    assert.equal(paused.status,200);
    assert.equal((await getCommunity(request('/api/communities/demo-neighborhood'),'demo-neighborhood')).status,200);
    const page = repository().getCommunity('demo-neighborhood',true)!;
    assert.equal((await updateCommunity(request('/api/admin/communities/demo-neighborhood','PATCH',{expectedVersion:page.version,published:false,reason:'Pause example page'},cookie),'demo-neighborhood')).status,200);
    assert.equal((await getCommunity(request('/api/communities/demo-neighborhood'),'demo-neighborhood')).status,404);
    const count = repository().listReview().length; reset();
    assert.equal(repository().listReview().length,count); assert.equal(repository().getAdmin(item.id)?.withdrawn,true);
    assert.equal(repository().getCommunity('demo-neighborhood',true)?.published,false);
    reset(); process.env.COMGROUND_DB_PATH = join(directory, 'empty.sqlite'); process.env.COMGROUND_SKIP_DEMO_SEED = '1';
    assert.equal(repository().listReview().length,0);
  } finally {
    reset();
    for (const [key,value] of [['COMGROUND_DB_PATH',original.db],['COMGROUND_SKIP_DEMO_SEED',original.skip],['LOCAL_REVIEW_TOKEN',original.token]] as const) { if(value === undefined) delete process.env[key]; else process.env[key]=value; }
    rmSync(directory,{recursive:true,force:true});
  }
});
