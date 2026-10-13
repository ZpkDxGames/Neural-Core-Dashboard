import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { checkConfig, makeHandler, validBearer } from './core-server.mjs';

const token = 'ab'.repeat(48);
const env = { NCORE_BIND: '127.0.0.1', NCORE_PORT: '4765',
  PGHOST: '/var/run/postgresql', PGPORT: '5432', PGUSER: 'neuralcore_api', PGDATABASE: 'neuralcore' };

test('disallows Internet binding, TCP PostgreSQL and incorrect identity', () => {
  assert.equal(checkConfig(env, token).bind, '127.0.0.1');
  for (const bind of ['0.0.0.0', '::', '192.168.1.1']) {
    assert.throws(() => checkConfig({ ...env, NCORE_BIND: bind }, token));
  }
  assert.throws(() => checkConfig({ ...env, PGHOST: '127.0.0.1' }, token));
  assert.throws(() => checkConfig({ ...env, PGUSER: 'postgres' }, token));
  assert.throws(() => checkConfig({ ...env, NCORE_PORT: '8787' }, 'short'));
  assert.throws(() => checkConfig({ ...env, PGDATABASE: 'minecraft' }, token));
});

test('auth compares exact bearer tokens and rejects malformed secrets', () => {
  assert.ok(validBearer('Bearer ' + token, token));
  for (const bad of ['', 'Basic ' + token, 'Bearer ' + token.slice(1), 'Bearer ' + 'cd'.repeat(48), 'bearer ' + token]) {
    assert.equal(validBearer(bad, token), false);
  }
});

test('local HTTP canary has no storage or unauthenticated DB endpoints', async (t) => {
  let calls = 0;
  const server = createServer(makeHandler({ token, probe: async () => { calls++; } }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const origin = 'http://127.0.0.1:' + server.address().port;
  const health = await fetch(origin + '/healthz');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).phase, 'local-only-canary');
  const anon = await fetch(origin + '/readyz');
  assert.equal(anon.status, 401);
  assert.equal(calls, 0);
  const unknown = await fetch(origin + '/v1/ingest', { method: 'POST' });
  assert.equal(unknown.status, 404);
  const authed = await fetch(origin + '/readyz', { headers: { authorization: 'Bearer ' + token } });
  assert.equal(authed.status, 200);
  assert.equal(calls, 1);
  const unexpected = await fetch(origin + '/healthz', { method: 'POST' });
  assert.equal(unexpected.status, 405);
  assert.equal(unexpected.headers.get('cache-control'), 'no-store');
});

test('database readiness failure is a generic 503 and does not leak exception text', async (t) => {
  const server = createServer(makeHandler({ token, probe: async () => { throw Error('database secret'); } }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const response = await fetch('http://127.0.0.1:' + server.address().port + '/readyz', {
    headers: { authorization: 'Bearer ' + token }
  });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /database secret/i);
});
