// Offline integration suite: actual extension + mocked official pages, no bookings.
// Set PLAYWRIGHT_MODULE to an installed playwright index.mjs, or install playwright locally.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TEAMS } from '../src/core.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'first-pitch-test-'));
const context = await chromium.launchPersistentContext(profile, { channel: process.env.PW_CHANNEL || 'chromium', headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`] });
const errors = [];
context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
let fixture = '';
await context.route(/^https?:\/\//, route => route.fulfill({ contentType: 'text/html', body: fixture || '<h1>Offline fixture</h1>' }));
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const id = new URL(worker.url()).host;
const page = await context.newPage();
const dashboard = `chrome-extension://${id}/dashboard.html`;
const state = async () => worker.evaluate(async () => (await chrome.storage.local.get('plans')).plans || []);
const until = async (fn, label) => { for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('Timeout: ' + label); };
const report = title => console.log('PASS ' + title);
function card(extra = '') { return `<article><p>2099.10.15 18:30 LG 트윈스 vs 두산 베어스</p><button onclick="document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1)">예매하기</button>${extra}</article>`; }
let caseNo = 0;
async function runFixture(html, autoClick = false, overrides = {}) {
  caseNo++;
  fixture = `<html lang="ko"><head><meta charset="utf-8"></head><body>${html}</body></html>`;
  for (const p of context.pages()) if (p !== page) await p.close();
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'TICK' }));
  const plan = { id: 'test-' + caseNo, teamId: 'lg', opponentId: 'doosan', gameAt: '2099-10-15T18:30', openAt: Date.now() - 1000, url: 'https://www.ticketlink.co.kr/test-' + caseNo, quantity: 2, section: '', watchMinutes: 1, autoClick, state: 'scheduled', logs: [], ...overrides };
  await worker.evaluate(plan => chrome.storage.local.set({ plans: [plan] }), plan);
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'TICK' }));
  await until(async () => (await state())[0]?.state !== 'opening', 'tab opened');
  return plan;
}
try {
  await page.goto(dashboard);
  await page.waitForSelector('.team'); assert.equal(await page.locator('.team').count(), 10); report('10 teams render');
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 950 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}`);
  }
  report('320/390/768/1280 layouts');
  await page.locator('[name=gameAt]').fill('2099-10-15T18:30');
  await page.locator('[name=openAt]').fill('2099-10-08T11:00');
  await page.locator('[name=opponentId]').selectOption('doosan');
  await page.getByRole('button', { name: /오픈 예약 추가/ }).click();
  await until(async () => (await state()).length === 1, 'saved plan');
  assert.equal((await state())[0].autoClick, false);
  await page.getByRole('button', { name: /오픈 예약 추가/ }).click();
  await until(async () => (await page.locator('#form-status').innerText()).includes('이미'), 'duplicate rejected');
  await page.reload(); await page.waitForSelector('.plan'); assert.equal(await page.locator('.plan').count(), 1); report('save, reload, duplicate prevention');
  await page.getByRole('button', { name: '중지', exact: true }).click();
  await until(async () => (await state())[0].state === 'stopped', 'stop');
  assert.equal(await worker.evaluate(async () => (await chrome.alarms.getAll()).some(a => a.name.startsWith('plan:'))), false); report('stop clears alarm');
  await runFixture(card());
  await until(async () => (await state())[0].state === 'available', 'notification mode');
  let tab = context.pages().find(p => p.url().startsWith('https://'));
  assert.equal(await tab.evaluate(() => document.body.dataset.clicks || '0'), '0'); report('matching game notification without click');
  await runFixture(card(), true);
  await until(async () => (await state())[0].state === 'clicked', 'click claim');
  tab = context.pages().find(p => p.url().startsWith('https://'));
  await until(async () => await tab.evaluate(() => document.body.dataset.clicks) === '1', 'clicked once');
  await Promise.all(Array.from({ length: 4 }, () => page.evaluate(() => chrome.runtime.sendMessage({ type: 'TICK' }))));
  assert.equal(context.pages().filter(p => p.url().startsWith('https://')).length, 1);
  assert.equal(await tab.evaluate(() => document.body.dataset.clicks), '1'); report('one click and one tab despite concurrent ticks');
  await runFixture('<input type="password">' + card(), true);
  await until(async () => (await state())[0].state === 'handoff', 'login handoff'); report('login pauses automation');
  await runFixture('<div role="dialog">접속 대기 중 · 대기 순번 12</div>' + card(), true);
  await until(async () => (await state())[0].state === 'handoff', 'queue handoff'); report('queue pauses automation');
  await runFixture('<input name="captcha">' + card(), true);
  await until(async () => (await state())[0].state === 'handoff', 'captcha handoff'); report('captcha pauses automation');
  await runFixture(card() + '<button>결제하기</button>', true);
  await until(async () => (await state())[0].state === 'handoff', 'payment handoff'); report('payment stops automation');
  await runFixture(card() + card(), true);
  await until(async () => (await state())[0].state === 'handoff', 'ambiguous game'); report('duplicate matching games require manual choice');
  await runFixture(card().replace('2099.10.15', '2099.10.16'), true);
  await until(async () => (await state())[0].state === 'watching', 'wrong date stays watching');
  await new Promise(r => setTimeout(r, 1700));
  assert.equal((await state())[0].state, 'watching'); report('wrong game never clicked');
  await page.getByRole('button', { name: '중지', exact: true }).click();
  await until(async () => (await state())[0].state === 'stopped', 'cancel monitor'); report('active monitor cancellation');
  await runFixture(card(), true, { openAt: Date.now() - 65000 });
  assert.equal((await state())[0].state, 'expired'); assert.equal(context.pages().filter(p => p.url().startsWith('https://')).length, 0); report('late alarms expire without opening');
  for (const team of TEAMS) {
    const opponent = TEAMS.find(t => t.id !== team.id);
    await runFixture('<article><p>2099.10.15 18:30 ' + team.name + ' vs ' + opponent.name + '</p><button>예매하기</button></article>', false, { teamId: team.id, opponentId: opponent.id, url: team.url });
    await until(async () => (await state())[0].state === 'available', 'provider ' + team.id);
  }
  report('all 10 team hosts and game labels work with offline fixtures');
  await runFixture('<h1>경기 목록 로딩 중</h1>', false);
  await until(async () => (await state())[0].state === 'watching', 'initial empty DOM');
  tab = context.pages().find(p => p.url().startsWith('https://'));
  await tab.locator('body').evaluate((body, html) => { body.innerHTML = html; }, card());
  await until(async () => (await state())[0].state === 'available', 'async DOM button');
  report('async game cards detected without refresh');
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 950 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  report('populated plans fit mobile screens');
  await page.setViewportSize({ width: 1280, height: 1050 }); await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'test-results/dashboard.png'), fullPage: true });
  assert.deepEqual(errors, []); report('no browser page errors');
} catch (error) {
  console.error(JSON.stringify(await state()));
  for (const p of context.pages()) console.error(p.url(), (await p.locator("body").innerText().catch(() => "")).slice(0, 200));
  throw error;
} finally {
  await context.close();
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir()) || !path.basename(profile).startsWith('first-pitch-test-')) throw new Error('Unexpected test profile path');
  await fs.rm(profile, { recursive: true, force: true });
}
