import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TEAMS, HOST_PERMISSIONS, MAX_QUANTITY, allowedUrl, parseKst, validatePlan, dueAction, planKey, buildBackup, readBackup, reminderDue, toKstInput, displayKst, sanitizeUrl, planInput, teamName } from '../src/core.js';
import { validateRecipe } from '../src/macro-core.js';
const now = Date.parse('2026-10-06T00:00:00Z');
const input = { teamId: 'lg', opponentId: 'doosan', gameAt: '2026-10-15T18:30', openAt: '2026-10-08T11:00:00', quantity: '2', watchMinutes: '5' };
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
test('10개 구단과 예매처 기본 주소가 유효하다', () => {
  assert.equal(TEAMS.length, 10); assert.equal(new Set(TEAMS.map(t => t.id)).size, 10);
  for (const team of TEAMS) assert.equal(allowedUrl(team.url, team), true, team.id);
});
test('allowedUrl과 manifest host_permissions가 정확히 같고 tabs 권한이 없다', () => {
  assert.deepEqual([...manifest.host_permissions].sort(), [...HOST_PERMISSIONS].sort());
  assert.equal(manifest.permissions.includes('tabs'), false);
  assert.equal(manifest.host_permissions.some(p => p.includes('*.interpark.com')), false);
  const nol = TEAMS.find(t => t.id === 'doosan');
  assert.ok(allowedUrl('https://nol.yanolja.com/ticket/x', nol));
  assert.ok(allowedUrl('https://poticket.interpark.com/Book/x', nol));
  for (const url of ['https://sub.nol.yanolja.com/', 'https://www.interpark.com/', 'https://evil.interpark.com/', 'https://yanolja.com/']) assert.equal(allowedUrl(url, nol), false, url);
  assert.ok(allowedUrl('https://ticketlink.co.kr/', TEAMS[0]));
});
test('package.json과 manifest 버전이 같다', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, manifest.version);
  assert.match(pkg.devDependencies.playwright, /^\d+\.\d+\.\d+$/);
});
test('한국 시간을 PC 시간대와 관계없이 해석한다', () => {
  assert.equal(parseKst('2026-10-08T11:00:00'), Date.parse('2026-10-08T02:00:00Z'));
  assert.equal(parseKst('2026-10-08T11:00'), Date.parse('2026-10-08T02:00:00Z'));
  assert.ok(Number.isNaN(parseKst(undefined))); assert.ok(Number.isNaN(parseKst(12)));
});
test('한국 시간 표시에 연도가 포함된다', () => {
  const text = displayKst(Date.parse('2026-12-31T15:30:00Z'));
  assert.match(text, /2027/); assert.match(text, /00:30:00/);
});
test('존재하지 않는 날짜와 시간은 거절한다', () => {
  for (const value of ['2026-02-30T11:00', '2026-10-08T24:00', '2026-10-08T11:61', '2026-10-08T11:00Z', '2026-13-01T00:00', 'not a date']) assert.ok(Number.isNaN(parseKst(value)), value);
});
test('공식 예매처 HTTPS만 허용하고 위장 호스트를 거절한다', () => {
  const team = TEAMS[0];
  for (const url of ['http://www.ticketlink.co.kr/', 'https://ticketlink.co.kr.attacker.test/', 'https://attacker-ticketlink.co.kr/', 'javascript:alert(1)', 'https://user:pass@ticketlink.co.kr/', 'https://ticketlink.co.kr:8443/', 'https://127.0.0.1/', 'https://ticket.ssg.com/']) assert.equal(allowedUrl(url, team), false, url);
  assert.ok(allowedUrl('https://www.ticketlink.co.kr/sports/baseball', team));
});
test('입력을 정규화하고 기본값은 알림만 사용한다', () => {
  const plan = validatePlan(input, now); assert.equal(plan.quantity, 2); assert.equal(plan.autoClick, false); assert.equal(plan.watchMinutes, 5); assert.equal(plan.url, TEAMS[0].url); assert.equal(plan.reminderMinutes, 5);
  assert.equal(validatePlan({ ...input, autoClick: 'true' }, now).autoClick, false);
});
test('validatePlan은 null·비객체 입력을 명확히 거절한다', () => {
  for (const value of [null, undefined, 'x', 3]) assert.throws(() => validatePlan(value, now), /형식/);
});
test('구단·상대·수량·확인 시간을 검증한다', () => {
  for (const overrides of [{ teamId: 'other' }, { opponentId: 'lg' }, { quantity: 0 }, { quantity: MAX_QUANTITY + 1 }, { quantity: 1.5 }, { watchMinutes: 0 }, { watchMinutes: 99 }]) assert.throws(() => validatePlan({ ...input, ...overrides }, now));
});
test('대시보드와 매크로가 같은 인원 상한을 쓴다', () => {
  assert.ok(validatePlan({ ...input, quantity: MAX_QUANTITY }, now));
  assert.ok(validateRecipe({ teamId: 'lg', quantity: MAX_QUANTITY, steps: [] }));
  assert.throws(() => validatePlan({ ...input, quantity: MAX_QUANTITY + 1 }, now));
  assert.throws(() => validateRecipe({ teamId: 'lg', quantity: MAX_QUANTITY + 1, steps: [] }));
});
test('과거 오픈과 경기 이후 오픈을 거절한다', () => {
  for (const overrides of [{ openAt: '2026-10-06T08:59' }, { gameAt: '2026-10-05T18:30' }, { openAt: '2026-10-16T11:00' }]) assert.throws(() => validatePlan({ ...input, ...overrides }, now));
});
test('예약은 한 번만 실행하고 1분 넘게 늦으면 만료한다', () => {
  const plan = { state: 'scheduled', openAt: now };
  assert.equal(dueAction(plan, now - 1), 'wait'); assert.equal(dueAction(plan, now), 'open'); assert.equal(dueAction(plan, now + 60000), 'open'); assert.equal(dueAction(plan, now + 60001), 'expire');
  for (const state of ['opening', 'watching', 'clicked', 'stopped', 'expired', 'available']) assert.equal(dueAction({ ...plan, state }, now), 'wait');
});
test('같은 경기의 초 표기 차이는 중복으로 식별한다', () => {
  assert.equal(planKey({ teamId: 'lg', gameAt: '2026-10-15T18:30' }), planKey({ teamId: 'lg', gameAt: '2026-10-15T18:30:00' }));
  assert.notEqual(planKey({ teamId: 'lg', gameAt: '2026-10-15T18:30' }), planKey({ teamId: 'kt', gameAt: '2026-10-15T18:30' }));
});
test('준비 알림은 예정된 시간부터 오픈 전까지 한 번만 대상이 된다', () => {
  const plan = { state: 'scheduled', openAt: now + 600000, reminderMinutes: 5, scheduledAt: now };
  assert.equal(reminderDue(plan, now + 299999), false); assert.equal(reminderDue(plan, now + 300000), true);
  assert.equal(reminderDue(plan, now + 600000), false); assert.equal(reminderDue({ ...plan, reminderSentAt: now }, now + 300000), false);
  assert.equal(reminderDue({ ...plan, state: 'stopped' }, now + 300000), false); assert.equal(reminderDue({ ...plan, reminderMinutes: 0 }, now + 300000), false);
});
test('이미 지난 준비 알림은 늦게 보내지 않는다', () => {
  // Scheduled 2 minutes before opening with a 5-minute reminder: the reminder time had already passed.
  const late = { state: 'scheduled', openAt: now + 120000, reminderMinutes: 5, scheduledAt: now };
  for (const t of [now, now + 1000, now + 119000]) assert.equal(reminderDue(late, t), false);
  // Browser was asleep: more than a minute after the reminder time is skipped too.
  const asleep = { state: 'scheduled', openAt: now + 600000, reminderMinutes: 5, scheduledAt: now };
  assert.equal(reminderDue(asleep, now + 300000 + 60000), true);
  assert.equal(reminderDue(asleep, now + 300000 + 60001), false);
});
test('저장·백업 주소에서 세션·개인 정보 쿼리를 제거한다', () => {
  const raw = 'https://www.ticketlink.co.kr/reserve/plan?productId=123&scheduleNo=9&accessToken=abc&JSESSIONID=x&member_id=me&code=oauth#state=s&id_token=t';
  const clean = sanitizeUrl(raw);
  assert.equal(clean, 'https://www.ticketlink.co.kr/reserve/plan?productId=123&scheduleNo=9');
  assert.equal(sanitizeUrl('https://tickets.interpark.com/goods/1?GoodsCode=26001234'), 'https://tickets.interpark.com/goods/1?GoodsCode=26001234');
  assert.equal(sanitizeUrl('https://nol.yanolja.com/ticket#/sports/bears'), 'https://nol.yanolja.com/ticket#/sports/bears');
  const plan = validatePlan({ ...input, url: raw }, now);
  assert.equal(plan.url, clean);
  const legacy = { ...plan, url: raw };
  assert.equal(planInput(legacy).url, clean);
  assert.equal(JSON.stringify(buildBackup([legacy], now)).includes('abc'), false);
});
test('백업에는 런타임 상태가 없고 복원 시 자동 클릭이 꺼진다', () => {
  const plan = { ...validatePlan({ ...input, autoClick: true }, now), id: 'secret-id', runToken: 'token', tabId: 42, state: 'clicked', logs: [{ message: 'private' }] };
  const backup = buildBackup([plan], now); const text = JSON.stringify(backup);
  for (const value of ['secret-id', 'token', 'tabId', 'clicked', 'private']) assert.equal(text.includes(value), false);
  const result = readBackup(backup, [], now); assert.equal(result.imported.length, 1); assert.equal(result.imported[0].autoClick, false);
  assert.equal(result.imported[0].openAt, plan.openAt); assert.equal(toKstInput(plan.openAt), input.openAt);
});
test('백업 내보내기는 지난 경기를 제외하고 예정 예약이 100건을 넘으면 안내한다', () => {
  const upcoming = validatePlan(input, now);
  const past = { ...upcoming, gameAt: '2026-10-01T18:30' };
  assert.equal(buildBackup([upcoming, past], now).plans.length, 1);
  // 150 finished games + 1 upcoming: export still works.
  assert.equal(buildBackup([...Array(150).fill(past), upcoming], now).plans.length, 1);
  assert.throws(() => buildBackup(Array(101).fill(upcoming), now), /101건/);
});
test('백업의 중복·지난 경기만 제외하고 기존 예약은 바꾸지 않는다', () => {
  const plan = validatePlan(input, now); const backup = buildBackup([plan, plan], now);
  assert.equal(readBackup(backup, [], now).skipped, 1); assert.equal(readBackup(backup, [plan], now).skipped, 2);
  const later = Date.parse('2026-10-16T00:00:00Z'); assert.equal(readBackup(backup, [], later).imported.length, 0);
});
test('백업의 잘못된 형식·100건 초과·외부 주소는 전체 거절한다', () => {
  const good = buildBackup([validatePlan(input, now)], now);
  for (const data of [null, { ...good, version: 2 }, { ...good, format: 'other' }, { ...good, plans: [input, { ...input, url: 'https://evil.test/' }] }]) assert.throws(() => readBackup(data, [], now));
  assert.throws(() => readBackup({ ...good, plans: Array(101).fill(input) }, [], now), /101건/);
});
test('오픈이 지난 예약은 명시적인 재개에서만 허용한다', () => {
  const raw = { ...input, openAt: '2026-10-06T08:00' };
  assert.throws(() => validatePlan(raw, now)); assert.ok(validatePlan(raw, now, { allowPastOpen: true }));
  assert.throws(() => validatePlan({ ...raw, gameAt: '2026-10-05T18:30' }, now, { allowPastOpen: true }));
});
test('지원하지 않는 준비 알림과 지나치게 긴 URL을 거절한다', () => {
  assert.throws(() => validatePlan({ ...input, reminderMinutes: 7 }, now));
  assert.throws(() => validatePlan({ ...input, url: 'https://www.ticketlink.co.kr/' + 'a'.repeat(2048) }, now), /너무 깁니다/);
});
test('알 수 없는 구단 ID는 대체 이름으로 표시한다', () => {
  assert.equal(teamName('lg'), 'LG 트윈스');
  assert.match(teamName('removed-team'), /알 수 없는 구단/);
  assert.match(teamName(undefined), /알 수 없는 구단/);
});
