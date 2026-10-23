import { registerMacroEngine } from './macro-engine.js';
import { ACTIVE, EDITABLE, RESTARTABLE, allowedUrl, dueAction, teamById, teamName, validatePlan, planInput, planKey, readBackup, buildBackup, reminderAt, reminderDue, parseKst, sanitizeUrl } from './core.js';

// The macro engine owns every message whose type starts with MACRO_; this file must keep passing them through.
registerMacroEngine();

// All state transitions are serialized, including alarm/message races.
let queue = Promise.resolve();
const serial = fn => { const result = queue.then(fn); queue = result.catch(() => {}); return result; };
const read = async () => (await chrome.storage.local.get('plans')).plans || [];
const write = plans => chrome.storage.local.set({ plans });
const SWEEP = 'sweep';
function log(plan, message) {
  plan.message = message;
  plan.logs = [...(plan.logs || []), { at: Date.now(), message }].slice(-20);
}
async function notify(plan, message) {
  try { await chrome.notifications.create('plan:' + plan.id, { type: 'basic', iconUrl: chrome.runtime.getURL('icon.png'), title: `${teamName(plan.teamId)} · 예매 도우미`, message }); } catch { /* OS notifications may be disabled */ }
}
async function stopMonitor(plan) {
  if (plan.tabId) await chrome.tabs.sendMessage(plan.tabId, { type: 'STOP', id: plan.id }).catch(() => {});
}
async function clearAlarms(id) {
  await chrome.alarms.clear('plan:' + id);
  await chrome.alarms.clear('remind:' + id);
}
async function schedule(plan) {
  await clearAlarms(plan.id);
  await chrome.alarms.create('plan:' + plan.id, { when: Math.max(Date.now() + 100, plan.openAt) });
  // A reminder whose time has already passed is skipped, not sent late.
  const minutes = plan.reminderMinutes ?? 5;
  if (minutes && !plan.reminderSentAt && reminderAt(plan) > Date.now()) await chrome.alarms.create('remind:' + plan.id, { when: reminderAt(plan) });
}
function assertRoom(plans, input, excludeId) {
  const active = plans.filter(p => p.id !== excludeId && ACTIVE.has(p.state));
  if (active.length >= 10) throw new Error('진행 중인 예약은 최대 10개입니다.');
  if (active.some(p => planKey(p) === planKey(input))) throw new Error('같은 홈 구단·경기가 이미 예약되어 있습니다.');
}
async function begin(plan, plans, reuse = false) {
  plan.state = 'opening'; plan.startedAt = Date.now(); plan.runToken = crypto.randomUUID();
  log(plan, reuse ? '같은 예매 탭에서 화면 확인을 다시 시작합니다. 자동 클릭은 꺼졌습니다.' : '예매 오픈 시간입니다. 예매 페이지를 엽니다.');
  // Persist before opening: duplicate alarms may not open a second tab.
  await write(plans);
  try {
    let tab;
    if (reuse && plan.tabId) {
      try { tab = await chrome.tabs.get(plan.tabId); if (!allowedUrl(tab.url, teamById(plan.teamId))) tab = null; } catch { /* closed */ }
    }
    if (!tab) tab = await chrome.tabs.create({ url: plan.url, active: true });
    plan.tabId = tab.id; await write(plans);
    try { await attach(plan, plans); } catch { plan.state = 'opening'; }
  } catch {
    plan.state = 'error'; log(plan, '페이지를 열지 못했습니다. 예매처 연결과 확장 프로그램 권한을 확인하세요.'); await notify(plan, plan.message);
  }
  await write(plans);
}
async function attach(plan, plans) {
  if (plan.state !== 'opening') return;
  const tab = await chrome.tabs.get(plan.tabId);
  if (tab.status !== 'complete') return;
  if (!allowedUrl(tab.url, teamById(plan.teamId))) {
    plan.state = 'handoff'; log(plan, '로그인 또는 다른 페이지로 이동했습니다. 열린 탭에서 직접 진행하세요.'); await write(plans); await notify(plan, plan.message); return;
  }
  await chrome.scripting.executeScript({ target: { tabId: plan.tabId }, files: ['src/content.js'] });
  plan.state = 'watching';
  plan.watchUntil = Date.now() + plan.watchMinutes * 60000;
  log(plan, '현재 화면에서 지정 경기의 예매 버튼을 확인하고 있습니다.');
  await write(plans);
  await chrome.tabs.sendMessage(plan.tabId, { type: 'WATCH', plan: { ...plan, team: teamById(plan.teamId), opponent: teamById(plan.opponentId) } });
}
async function sweep() {
  const plans = await read();
  let changed = false;
  for (const plan of plans) {
    if (reminderDue(plan)) {
      plan.reminderSentAt = Date.now(); changed = true;
      log(plan, '예매 오픈이 가까워졌습니다. 예매처에서 로그인과 경기 정보를 미리 확인하세요.');
      await write(plans); await notify(plan, plan.message);
      await chrome.alarms.clear('remind:' + plan.id);
    }
    const action = dueAction(plan, Date.now());
    if (action === 'expire') {
      changed = true;
      plan.state = 'expired'; log(plan, '오픈 시간이 1분 이상 지났습니다. 직접 예매처를 열어 확인하세요.'); await notify(plan, plan.message);
    } else if (action === 'open') {
      changed = true;
      await begin(plan, plans);
    } else if (plan.state === 'opening' && Date.now() - plan.startedAt > 60000) {
      changed = true;
      plan.state = 'handoff'; log(plan, '페이지 로딩이 오래 걸립니다. 열린 예매 탭을 직접 확인하세요.'); await notify(plan, plan.message);
    } else if (plan.state === 'opening' && plan.tabId) {
      // Chrome may briefly report complete for an intermediate error/redirect page.
      // Retry injection into the same tab; never reload or open another tab.
      try { await attach(plan, plans); } catch { plan.state = 'opening'; changed = true; }
    } else if (plan.state === 'watching' && Date.now() > plan.watchUntil) {
      changed = true;
      plan.state = 'handoff'; log(plan, '확인 시간이 끝났습니다. 경기 목록과 좌석을 직접 확인하세요.'); await stopMonitor(plan); await notify(plan, plan.message);
    }
  }
  if (changed) await write(plans);
}
function ownDashboard(sender) {
  return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('dashboard.html');
}
async function handle(message, sender) {
  if (message.type === 'SIGNAL' || message.type === 'CLAIM_CLICK') {
    const plans = await read();
    const plan = plans.find(p => p.id === message.id);
    if (!plan || plan.state !== 'watching' || !plan.runToken || message.runToken !== plan.runToken || sender.tab?.id !== plan.tabId || sender.frameId !== 0 || !allowedUrl(sender.url, teamById(plan.teamId))) return { ok: false };
    if (Date.now() > plan.watchUntil) { await sweep(); return { ok: false }; }
    if (message.type === 'CLAIM_CLICK') {
      if (!plan.autoClick) return { ok: false };
      plan.state = 'clicked'; log(plan, '일치한 경기의 예매 버튼 클릭을 요청했습니다. 열린 탭에서 결과를 확인하세요.');
    } else {
      if (!['available', 'handoff', 'error'].includes(message.state)) return { ok: false };
      plan.state = message.state; log(plan, String(message.message).slice(0, 240));
    }
    await write(plans); await clearAlarms(plan.id); await notify(plan, plan.message);
    return { ok: true };
  }
  if (!ownDashboard(sender)) return { ok: false, error: '대시보드에서 실행해 주세요.' };
  const plans = await read();
  if (message.type === 'EXPORT') return { ok: true, backup: buildBackup(plans) };
  if (message.type === 'IMPORT') {
    const result = readBackup(message.backup, plans);
    for (const input of result.imported) {
      const plan = { ...input, id: crypto.randomUUID(), state: 'stopped', createdAt: Date.now(), logs: [] };
      log(plan, '백업에서 복원했습니다. 자동 클릭은 꺼져 있습니다. 내용을 확인하고 다시 시작하세요.'); plans.push(plan);
    }
    await write(plans);
    return { ok: true, imported: result.imported.length, skipped: result.skipped };
  }
  if (message.type === 'STOP_ALL') {
    for (const plan of plans.filter(p => ACTIVE.has(p.state))) {
      await stopMonitor(plan); await clearAlarms(plan.id); plan.state = 'stopped'; delete plan.runToken; log(plan, '전체 중지로 자동 확인을 멈췄습니다.');
    }
    await write(plans); return { ok: true };
  }
  if (message.type === 'ADD') {
    const input = validatePlan(message.input);
    assertRoom(plans, input);
    const plan = { ...input, id: crypto.randomUUID(), state: 'scheduled', createdAt: Date.now(), scheduledAt: Date.now(), logs: [] };
    log(plan, '오픈 예약을 등록했습니다. PC와 브라우저를 켜 두세요.');
    plans.push(plan); await write(plans);
    await schedule(plan);
    return { ok: true, id: plan.id };
  }
  if (message.type === 'TICK') { await sweep(); return { ok: true }; }
  if (message.type === 'PREPARE') {
    const team = teamById(message.teamId);
    if (!allowedUrl(message.url, team)) throw new Error('선택한 구단의 공식 예매처 주소를 사용해 주세요.');
    await chrome.tabs.create({ url: message.url, active: true }); return { ok: true };
  }
  const plan = plans.find(p => p.id === message.id);
  if (!plan) throw new Error('예약을 찾을 수 없습니다.');
  if (message.type === 'UPDATE') {
    if (!EDITABLE.has(plan.state)) throw new Error('실행 중이거나 클릭을 요청한 예약입니다. 중지하거나 복제해 주세요.');
    const input = validatePlan(message.input);
    assertRoom(plans, input, plan.id);
    await stopMonitor(plan); await clearAlarms(plan.id);
    const updated = { ...input, id: plan.id, createdAt: plan.createdAt, scheduledAt: Date.now(), state: 'scheduled', logs: plan.logs || [] };
    log(updated, '예약을 수정했습니다. 변경한 오픈 시간으로 다시 예약했습니다.');
    plans[plans.indexOf(plan)] = updated;
    await write(plans); await schedule(updated); return { ok: true };
  }
  if (message.type === 'RESTART') {
    if (!RESTARTABLE.has(plan.state)) throw new Error('이 상태의 예약은 다시 시작할 수 없습니다.');
    if (!(parseKst(plan.gameAt) > Date.now())) throw new Error('경기 시간이 지났습니다. 복제해 새 경기로 예약해 주세요.');
    const input = validatePlan(planInput(plan), Date.now(), { allowPastOpen: true });
    assertRoom(plans, input, plan.id);
    await stopMonitor(plan); await clearAlarms(plan.id);
    plan.autoClick = false; plan.url = input.url; delete plan.runToken;
    if (plan.openAt > Date.now()) {
      plan.state = 'scheduled'; plan.scheduledAt = Date.now(); delete plan.reminderSentAt; log(plan, '오픈 예약을 다시 시작했습니다. 자동 클릭은 꺼졌습니다.');
      await write(plans); await schedule(plan);
    } else await begin(plan, plans, true);
    return { ok: true };
  }
  if (message.type === 'STOP' || message.type === 'DELETE') {
    await clearAlarms(plan.id);
    await stopMonitor(plan);
    delete plan.runToken;
    plan.state = 'stopped'; log(plan, '사용자가 자동 확인을 중지했습니다.');
    await write(message.type === 'DELETE' ? plans.filter(p => p.id !== plan.id) : plans);
    return { ok: true };
  }
  if (message.type === 'FOCUS') {
    let tab;
    try { if (plan.tabId) tab = await chrome.tabs.get(plan.tabId); } catch { /* tab closed */ }
    if (tab) { await chrome.windows.update(tab.windowId, { focused: true }); await chrome.tabs.update(tab.id, { active: true }); }
    else await chrome.tabs.create({ url: plan.url, active: true });
    return { ok: true };
  }
  throw new Error('지원하지 않는 요청입니다.');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (typeof message?.type !== 'string' || message.type.startsWith('MACRO_')) return;
  serial(() => handle(message, sender)).then(respond, error => respond({ ok: false, error: error.message }));
  return true;
});
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('macro.html') }));
chrome.alarms.onAlarm.addListener(alarm => { if (!alarm.name.startsWith('macro:')) serial(sweep).catch(console.error); });
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== 'complete') return;
  serial(async () => {
    const plans = await read();
    for (const plan of plans.filter(p => p.tabId === tabId && p.state === 'opening')) {
      try { await attach(plan, plans); } catch { plan.state = 'opening'; await write(plans); }
    }
  }).catch(console.error);
});
chrome.tabs.onRemoved.addListener(tabId => serial(async () => {
  const plans = await read();
  const affected = plans.filter(p => p.tabId === tabId && ACTIVE.has(p.state));
  for (const plan of affected) {
    plan.state = 'stopped'; delete plan.runToken; log(plan, '예매 탭이 닫혀 자동 확인을 중지했습니다.'); await clearAlarms(plan.id);
  }
  if (affected.length) await write(plans);
}).catch(console.error));
// plan:* notifications belong to the open-reservation dashboard, seats:* to the macro screen.
export const notificationPage = id => String(id).startsWith('seats:') ? 'macro.html' : 'dashboard.html';
chrome.notifications.onClicked.addListener(id => {
  chrome.tabs.create({ url: chrome.runtime.getURL(notificationPage(id)), active: true }).catch(console.error);
  Promise.resolve(chrome.notifications.clear(id)).catch(() => {});
});
async function ensureSweepAlarm() {
  if (!await chrome.alarms.get(SWEEP)) await chrome.alarms.create(SWEEP, { periodInMinutes: 0.5 });
}
async function restore() {
  await ensureSweepAlarm();
  const plans = await read();
  for (const plan of plans) {
    if (plan.url) plan.url = sanitizeUrl(plan.url);
    if (plan.state === 'scheduled') await schedule(plan);
    if (['opening', 'watching'].includes(plan.state)) { plan.state = 'handoff'; delete plan.runToken; log(plan, '브라우저가 다시 시작되었습니다. 직접 진행하거나 화면 확인을 다시 시작하세요.'); await clearAlarms(plan.id); }
  }
  await write(plans); await sweep();
}
chrome.runtime.onInstalled.addListener(() => serial(restore).catch(console.error));
chrome.runtime.onStartup.addListener(() => serial(restore).catch(console.error));
// The service worker can be restarted at any time; the periodic sweep must survive that.
serial(ensureSweepAlarm).catch(console.error);
