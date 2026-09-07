// Run with: node --test scripts/test-record-display.mjs
// Execute the real TypeScript modules with an isolated in-memory Firestore adapter.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

async function loadModule(entry, dependencies = {}) {
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'isolated-firebase', setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path }) => path in dependencies ? { path, external: true } : undefined);
      builder.onResolve({ filter: /^(firebase\/firestore|.*\/lib\/firebase)$/ }, ({ path }) => ({
        path: path === 'firebase/firestore' ? path : 'test:firebase-app', external: true,
      }));
    } }],
  });
  const module = { exports: {} };
  vm.runInNewContext(result.outputFiles[0].text, {
    module, exports: module.exports, console, process: { env: {} },
    require: (name) => {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  return module.exports;
}

const { formatWeight } = await loadModule('src/utils/weight.ts');
const competition = await loadModule('src/utils/competition.ts');
const { getLB } = await loadModule('src/utils.ts');

test('weight precision follows explicit settings and Auto without altering ranking', () => {
  for (const [value, two, three] of [[12.115, '12.12', '12.115'], [1.9, '1.90', '1.900'], [1.55, '1.55', '1.550']]) {
    assert.equal(formatWeight(value, 2), two);
    assert.equal(formatWeight(value, 3), three);
    assert.equal(formatWeight(value, undefined), String(value));
  }
  assert.equal(formatWeight(1.55, 0), '2');
  assert.equal(formatWeight(1.55, 1), '1.6');
  assert.equal(formatWeight(0, 3), '0.000');
  assert.equal(formatWeight(NaN, 3), '—');
  const records = { 1: { weight: 12.114, pondId: 1 }, 2: { weight: 12.113, pondId: 1 } };
  assert.equal(formatWeight(records[1].weight, 2), formatWeight(records[2].weight, 2));
  assert.deepEqual(Array.from(getLB(records), e => e.peg), [1, 2]);
  assert.equal(records[1].weight, 12.114);
});

test('role callable enforces permissions and persists profile, claims and audit together', async () => {
  const records = new Map([
    ['users/admin', { role: 'ADMIN' }], ['users/staff', { role: 'STAFF' }],
    ['users/client', { role: 'CLIENT', name: 'Test' }], ['users/other-admin', { role: 'ADMIN' }],
  ]);
  const claims = new Map([['client', { feature: true, role: 'CLIENT' }]]);
  let failTransaction = false;
  const ref = path => ({ path, get: async () => ({ exists: records.has(path), data: () => records.get(path) }) });
  const adminDb = {
    collection: name => ({ doc: id => ref(`${name}/${id || 'audit'}`) }),
    runTransaction: async callback => {
      if (failTransaction) throw new Error('Test transaction failure');
      const writes = [];
      await callback({ get: reference => reference.get(), set: (reference, data) => writes.push([reference.path, data]) });
      for (const [path, data] of writes) records.set(path, { ...records.get(path), ...data });
    },
  };
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const pass = callback => callback;
  const express = () => ({ use() {}, post() {}, get() {} }); express.json = () => {};
  const api = await loadModule('functions/src/index.js', {
    express, cors: () => {},
    'firebase-functions': {
      https: { onCall: pass, onRequest: pass, HttpsError },
      firestore: { document: () => ({ onWrite: pass, onCreate: pass, onUpdate: pass }) },
      pubsub: { schedule: () => ({ timeZone: () => ({ onRun: pass }) }) },
    },
    './auth-utils.js': { adminDb, adminAuth: {
      getUser: async uid => ({ customClaims: claims.get(uid) || {} }),
      setCustomUserClaims: async (uid, next) => claims.set(uid, next),
    } },
    './email-service.js': {}, './seo.js': {},
  });
  const caller = uid => ({ auth: { uid, token: {} } });
  await assert.rejects(api.updateUserRole({ uid: 'client', role: 'STAFF' }, {}), { code: 'unauthenticated' });
  await assert.rejects(api.updateUserRole({ uid: 'client', role: 'STAFF' }, caller('staff')), { code: 'permission-denied' });
  await assert.rejects(api.updateUserRole({ uid: 'admin', role: 'CLIENT' }, caller('admin')), { code: 'failed-precondition' });
  await assert.rejects(api.updateUserRole({ uid: 'other-admin', role: 'CLIENT' }, caller('admin')), { code: 'failed-precondition' });
  for (const role of ['STAFF', 'CLIENT', 'ADMIN']) {
    const result = await api.updateUserRole({ uid: 'client', role }, caller('admin'));
    assert.equal(result.role, role);
    assert.equal(records.get('users/client').role, role);
    assert.equal(claims.get('client').role, role);
    assert.equal(claims.get('client').feature, true);
    assert.equal(records.get('auditLog/audit').action, 'user.role_change');
  }
  records.set('users/client', { role: 'CLIENT' }); claims.set('client', { role: 'CLIENT' });
  failTransaction = true;
  await assert.rejects(api.updateUserRole({ uid: 'client', role: 'STAFF' }, caller('admin')), /Test transaction failure/);
  assert.equal(claims.get('client').role, 'CLIENT');
  assert.equal(records.get('users/client').role, 'CLIENT');
});

test('competition status honors opening/closing/end boundaries and the supplied clock', () => {
  const event = {
    bookingOpenAt: '2030-09-01T08:00:00+08:00', bookingCloseAt: '2030-09-03T20:00:00+08:00',
    startDate: '2030-09-04T08:00:00+08:00', endDate: '2030-09-04T20:00:00+08:00',
  };
  const open = Date.parse(event.bookingOpenAt), close = Date.parse(event.bookingCloseAt), end = Date.parse(event.endDate);
  for (const [now, status] of [[open - 1, 'coming-soon'], [open, 'active'], [close + 1, 'active'], [end - 1, 'active'], [end, 'tamat']]) {
    assert.equal(competition.getCompetitionCmsStatus(event, now), status);
  }
  assert.equal(competition.isBookingOpen(event, open - 1), false);
  assert.equal(competition.isBookingOpen(event, open), true);
  assert.equal(competition.isBookingOpen(event, close + 1), false);
  assert.equal(competition.getCompetitionCmsStatus({ ...event, bookingOpenAt: undefined }, open - 1), 'active');
  assert.equal(competition.getCompetitionCmsStatus({ ...event, startDate: '2030-08-01', bookingOpenAt: event.bookingOpenAt }, open - 1), 'coming-soon');
  assert.match(competition.bookingWindowLabel(event, open - 1), /\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  assert.equal(competition.getCompetitionCmsStatusMeta(event, open).label, 'Aktif');
});

test('competition list sorts newest first, keeping ties stable and invalid dates last', () => {
  const events = [{ id: 'old', startDate: '2026-01-01' }, { id: 'invalid', startDate: '' }, { id: 'new', startDate: '2026-09-01' }, { id: 'tie', startDate: '2026-09-01' }];
  assert.deepEqual(Array.from(competition.sortCompetitionsLatestFirst(events), e => e.id), ['new', 'tie', 'old', 'invalid']);
  assert.equal(events[0].id, 'old');
});

function firestoreDouble() {
  const records = new Map(), listeners = new Map();
  const deleted = Symbol('delete');
  let now = '2026-09-01T00:00:00.000Z';
  const snapshot = (path) => ({ id: path.split('/').at(-1), exists: () => records.has(path), data: () => records.get(path) });
  const sdk = {
    Timestamp: class Timestamp {},
    collection: (_db, path) => ({ path }),
    doc: (_db, collection, id) => ({ path: `${collection}/${id}` }),
    deleteField: () => deleted,
    serverTimestamp: () => now,
    getDoc: async (ref) => snapshot(ref.path),
    onSnapshot: (ref, listener) => {
      const active = listeners.get(ref.path) || new Set();
      listeners.set(ref.path, active); active.add(listener); listener(snapshot(ref.path));
      return () => active.delete(listener);
    },
    setDoc: async (ref, data, opts) => {
      const next = { ...(opts?.merge ? records.get(ref.path) : {}), ...data };
      for (const key of Object.keys(next)) if (next[key] === deleted) delete next[key];
      records.set(ref.path, next);
      for (const listener of listeners.get(ref.path) || []) listener(snapshot(ref.path));
    },
    addDoc: async (ref, data) => {
      const id = `record-${records.size}`;
      await sdk.setDoc({ path: `${ref.path}/${id}` }, data); return { id };
    },
    where: (field, op, value) => ({ field, op, value }),
    orderBy: () => ({}), limit: () => ({}), startAfter: () => ({}),
    query: (ref, ...clauses) => ({ ...ref, clauses }),
    getDocs: async (q) => {
      const docs = [...records.keys()].filter(path => path.startsWith(q.path + '/'))
        .map(snapshot).filter(doc => (q.clauses || []).every(c => !c.field || doc.data()[c.field] === c.value));
      return { docs, empty: docs.length === 0 };
    },
  };
  return { sdk, records, advance: () => { now = '2026-09-02T00:00:00.000Z'; } };
}

test('real save/read paths preserve weight precision and creation time on updates', async () => {
  const fake = firestoreDouble();
  const api = await loadModule('src/lib/firestore.ts', { 'firebase/firestore': fake.sdk, 'test:firebase-app': { db: {}, auth: {} } });
  const entry = { competitionId: 'event', bookingId: 'booking', anglerName: 'Test', pondId: 1, pondName: 'Pond', seatNum: 1, weight: 12.115 };
  const id = await api.saveScoreEntry(entry);
  assert.equal((await api.getScoresForCompetition('event'))[0].weight, 12.115);
  fake.advance();
  assert.equal(await api.saveScoreEntry({ ...entry, weight: 12.116 }), id);
  const live = await api.getScoresForCompetition('event');
  const history = await api.getScoreEntriesPage();
  for (const record of [live[0], history.items[0]]) {
    assert.equal(record.weight, 12.116);
    assert.equal(record.capturedAt, '2026-09-01T00:00:00.000Z');
  }
  const stored = fake.records.get(`eventResults/${id}`);
  delete stored.createdAt;
  assert.equal((await api.getScoresForCompetition('event'))[0].capturedAt, '2026-09-02T00:00:00.000Z');
});

test('two live settings subscribers update existing displays; Auto removes the override', async () => {
  const fake = firestoreDouble();
  const api = await loadModule('src/lib/firestore.ts', { 'firebase/firestore': fake.sdk, 'test:firebase-app': { db: {}, auth: {} } });
  let cms, publicPage;
  const stopCms = api.subscribeSettings(settings => { cms = formatWeight(1.9, settings.ocrDecimalPlaces); });
  const stopPublic = api.subscribeSettings(settings => { publicPage = formatWeight(1.9, settings.ocrDecimalPlaces); });
  for (const [precision, expected] of [[2, '1.90'], [3, '1.900'], [2, '1.90'], [undefined, '1.9']]) {
    await api.updateSettings({ ocrDecimalPlaces: precision });
    assert.equal(cms, expected); assert.equal(publicPage, expected);
  }
  assert.equal('ocrDecimalPlaces' in fake.records.get('settings/global'), false);
  await api.updateSettings({ ocrDecimalPlaces: 3 });
  await api.updateSettings({ phone: '123' });
  assert.equal((await api.getSettings()).ocrDecimalPlaces, 3);
  stopCms(); stopPublic();
});
