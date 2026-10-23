// Service worker (background.js + macro engine) against an in-memory Chrome API mock. No network, no browser.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const listeners = { message: [], alarm: [], startup: [], installed: [], notificationClick: [] };
const store = {
  macroJob: { id: 'job-1', state: 'running', phase: 'waiting', index: 0, recipe: { teamId: 'lg', steps: [] }, tabIds: [7], logs: [] },
  macroPick: { id: 'pick-1', tabId: 9, teamId: 'lg', kind: 'click' },
};
const alarms = new Map();
const created = { tabs: [], notifications: [], tabMessages: [] };
const event = bucket => ({ addListener: fn => bucket && listeners[bucket].push(fn) });
const clone = v => (v === undefined ? undefined : structuredClone(v));
globalThis.chrome = {
  runtime: { id: 'ext', getURL: p => 'chrome-extension://ext/' + p, onMessage: event('message'), onStartup: event('startup'), onInstalled: event('installed'), openOptionsPage: async () => {} },
  storage: { local: {
    get: async keys => Object.fromEntries([keys].flat().map(k => [k, clone(store[k])])),
    set: async values => { Object.assign(store, clone(values)); },
  } },
  alarms: {
    create: async (name, info) => { alarms.set(name, info); },
    get: async name => alarms.get(name),
    clear: async name => alarms.delete(name),
    getAll: async () => [...alarms.keys()],
    onAlarm: event('alarm'),
  },
  tabs: {
    create: async ({ url }) => { created.tabs.push(url); return { id: 100 + created.tabs.length, url, status: 'loading' }; },
    get: async id => ({ id, url: 'https://www.ticketlink.co.kr/x', status: 'loading', windowId: 1 }),
    sendMessage: async (tabId, message) => { created.tabMessages.push({ tabId, message }); },
    query: async () => [], update: async () => {},
    onUpdated: event(), onRemoved: event(), onCreated: event(),
  },
  notifications: { create: async (id, opts) => { created.notifications.push({ id, ...opts }); }, clear: async () => true, onClicked: event('notificationClick') },
  action: { onClicked: event() },
  windows: { update: async () => {} },
  scripting: { executeScript: async () => [] },
  webNavigation: { getAllFrames: async () => [] },
};
const DASHBOARD = { id: 'ext', url: 'chrome-extension://ext/dashboard.html' };
const MACRO = { id: 'ext', url: 'chrome-extension://ext/macro.html' };
// Dispatch like Chrome: every listener sees the message; the one returning true answers.
function send(message, sender = DASHBOARD) {
  return new Promise(resolve => {
    let claimed = 0;
    for (const fn of listeners.message) if (fn(message, sender, resolve) === true) claimed++;
    if (!claimed) resolve('unclaimed');
  });
}
const settle = () => new Promise(r => setImmediate(r));
async function idle() { for (let i = 0; i < 20; i++) await settle(); }

await import('../src/background.js');
await idle();

test('서비스 워커 로드 시 sweep 알람이 없으면 다시 만든다', () => {
  assert.deepEqual(alarms.get('sweep'), { periodInMinutes: 0.5 });
});
test('워커 재시작 후 실행 중이던 매크로는 일시 중지로 바뀐다 (지정 모드는 유지)', () => {
  assert.equal(store.macroJob.state, 'paused');
  assert.match(store.macroJob.message, /다시 시작/);
  assert.equal(store.macroPick?.id, 'pick-1');
});
test('브라우저 시작 시 남은 지정 모드에 MACRO_PICK_STOP을 보내고 지운다', async () => {
  for (const fn of listeners.startup) fn();
  await idle();
  assert.ok(created.tabMessages.some(m => m.tabId === 9 && m.message.type === 'MACRO_PICK_STOP'));
  assert.equal(store.macroPick, null);
});
test('type이 문자열이 아닌 메시지는 아무 리스너도 처리하지 않는다', async () => {
  for (const message of [null, undefined, {}, { type: 7 }, { type: ['ADD'] }]) assert.equal(await send(message), 'unclaimed');
});
test('MACRO_ 메시지는 매크로 엔진으로 전달된다', async () => {
  assert.deepEqual(await send({ type: 'MACRO_PAUSE' }, MACRO), { ok: true });
  // Background handler would answer '대시보드에서…'; the macro engine answers instead.
  assert.match((await send({ type: 'MACRO_TABS', teamId: 'lg' }, DASHBOARD)).error, /매크로 화면/);
  assert.match((await send({ type: 'TICK' }, MACRO)).error, /대시보드/);
});
test('알림 클릭은 알림 종류에 맞는 화면을 연다', async () => {
  created.tabs.length = 0;
  for (const fn of listeners.notificationClick) fn('plan:abc');
  for (const fn of listeners.notificationClick) fn('seats:job-1');
  await idle();
  assert.deepEqual(created.tabs, ['chrome-extension://ext/dashboard.html', 'chrome-extension://ext/macro.html']);
});

const input = (gameAt, openAt, extra = {}) => ({ teamId: 'lg', opponentId: 'doosan', gameAt, openAt, quantity: 2, watchMinutes: 5, reminderMinutes: 5, ...extra });
test('준비 알림: 제때 한 번 보내고, 이미 지난 알림 시각은 건너뛴다 (가짜 시계)', async t => {
  const start = Date.parse('2030-05-01T00:00:00Z'); // 09:00 KST
  t.mock.timers.enable({ apis: ['Date'], now: start });
  store.plans = []; created.notifications.length = 0;
  // Opens 10:00 KST, reminder 09:55 KST.
  const a = await send({ type: 'ADD', input: input('2030-05-02T18:30', '2030-05-01T10:00:00') });
  assert.equal(a.ok, true, a.error);
  assert.equal(alarms.get('remind:' + a.id).when, Date.parse('2030-05-01T00:55:00Z'));
  // Opens 2 minutes from now with a 5-minute reminder: no reminder alarm at all.
  const b = await send({ type: 'ADD', input: input('2030-05-03T18:30', '2030-05-01T09:02:00') });
  assert.equal(b.ok, true, b.error);
  assert.equal(alarms.has('remind:' + b.id), false);
  t.mock.timers.tick(60000); // 09:01, plan b's reminder window but scheduled too late
  await send({ type: 'TICK' });
  assert.equal(created.notifications.filter(n => n.id === 'plan:' + b.id).length, 0);
  t.mock.timers.tick(54 * 60000); // 09:55
  await send({ type: 'TICK' });
  await send({ type: 'TICK' });
  const plan = store.plans.find(p => p.id === a.id);
  assert.equal(plan.state, 'scheduled'); assert.ok(plan.reminderSentAt);
  assert.equal(created.notifications.filter(n => n.id === 'plan:' + a.id).length, 1);
  await send({ type: 'STOP_ALL' });
});
test('STOP_ALL은 진행 중인 예약을 모두 멈추고 알람을 지운다', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2030-06-01T00:00:00Z') });
  store.plans = [];
  const ids = [];
  for (const day of ['10', '11']) ids.push((await send({ type: 'ADD', input: input(`2030-06-${day}T18:30`, `2030-06-0${day[1] === '0' ? 5 : 6}T11:00`) })).id);
  assert.ok(ids.every(id => alarms.has('plan:' + id)));
  assert.equal((await send({ type: 'STOP_ALL' })).ok, true);
  assert.ok(store.plans.every(p => p.state === 'stopped'));
  assert.ok(ids.every(id => !alarms.has('plan:' + id) && !alarms.has('remind:' + id)));
});
test('같은 경기(초 표기만 다름)는 중복 예약으로 거절한다', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2030-06-01T00:00:00Z') });
  store.plans = [];
  assert.equal((await send({ type: 'ADD', input: input('2030-06-10T18:30', '2030-06-05T11:00') })).ok, true);
  assert.match((await send({ type: 'ADD', input: input('2030-06-10T18:30:00', '2030-06-05T12:00') })).error, /이미 예약/);
});
test('runToken이 다른 화면 신호는 거절한다', async () => {
  const sender = { tab: { id: 55 }, frameId: 0, url: 'https://www.ticketlink.co.kr/x' };
  store.plans = [{ id: 'w1', teamId: 'lg', opponentId: 'doosan', state: 'watching', tabId: 55, runToken: 'current', watchUntil: Date.now() + 60000, autoClick: true, logs: [] }];
  assert.equal((await send({ type: 'CLAIM_CLICK', id: 'w1', runToken: 'stale' }, sender)).ok, false);
  assert.equal((await send({ type: 'CLAIM_CLICK', id: 'w1' }, sender)).ok, false);
  assert.equal(store.plans[0].state, 'watching');
  assert.equal((await send({ type: 'CLAIM_CLICK', id: 'w1', runToken: 'current' }, sender)).ok, true);
  assert.equal(store.plans[0].state, 'clicked');
});
test('수정·재시작·백업 흐름 (지난 경기 제외, 세션 쿼리 제거, 자동 클릭 꺼짐)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2030-06-01T00:00:00Z') });
  store.plans = [];
  const { id } = await send({ type: 'ADD', input: input('2030-06-10T18:30', '2030-06-05T11:00', { autoClick: true, url: 'https://www.ticketlink.co.kr/p?productId=1&sessionKey=s3cret' }) });
  assert.equal(store.plans[0].url, 'https://www.ticketlink.co.kr/p?productId=1');
  assert.equal((await send({ type: 'UPDATE', id, input: input('2030-06-10T18:30', '2030-06-06T11:00', { autoClick: true }) })).ok, true);
  assert.equal(store.plans[0].openAt, Date.parse('2030-06-06T02:00:00Z'));
  await send({ type: 'STOP', id });
  assert.equal((await send({ type: 'RESTART', id })).ok, true);
  assert.equal(store.plans[0].state, 'scheduled'); assert.equal(store.plans[0].autoClick, false);
  store.plans.push({ ...store.plans[0], id: 'old', gameAt: '2030-05-01T18:30', state: 'expired' });
  const { backup } = await send({ type: 'EXPORT' });
  assert.equal(backup.plans.length, 1);
  store.plans = [];
  const restored = await send({ type: 'IMPORT', backup });
  assert.deepEqual([restored.imported, restored.skipped], [1, 0]);
  assert.equal(store.plans[0].state, 'stopped'); assert.equal(store.plans[0].autoClick, false);
  assert.equal((await send({ type: 'IMPORT', backup: { ...backup, plans: Array(101).fill(backup.plans[0]) } })).ok, false);
});
test('알 수 없는 구단 ID가 있어도 알림 생성이 실패하지 않는다', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2030-06-01T00:00:00Z') });
  created.notifications.length = 0;
  store.plans = [{ id: 'ghost', teamId: 'gone', opponentId: 'lg', gameAt: '2030-06-10T18:30', state: 'scheduled', openAt: Date.now() - 120000, logs: [] }];
  await send({ type: 'TICK' });
  assert.equal(store.plans[0].state, 'expired');
  assert.match(created.notifications.at(-1).title, /알 수 없는 구단/);
});
test('브라우저 재시작 복구는 저장된 주소의 세션 값을 지운다', async () => {
  store.plans = [{ id: 'legacy', teamId: 'lg', opponentId: 'doosan', gameAt: '2099-01-01T18:30', state: 'stopped', openAt: Date.parse('2098-12-25T02:00:00Z'), url: 'https://www.ticketlink.co.kr/p?id=1&access_token=abc', logs: [] }];
  for (const fn of listeners.installed) fn();
  await idle();
  assert.equal(store.plans[0].url, 'https://www.ticketlink.co.kr/p?id=1');
});
