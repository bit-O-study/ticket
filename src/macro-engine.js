import { allowedUrl, teamById, parseKst } from './core.js';
import { validateRecipe } from './macro-core.js';
import { macroPageStep } from './macro-dom.js';
const get = async key => (await chrome.storage.local.get(key))[key];
const put = (key, value) => chrome.storage.local.set({ [key]: value });
let chain = Promise.resolve(), executor = null;
const serial = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };
const ui = sender => sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('macro.html');
const running = job => job && ['running', 'waiting'].includes(job.state);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function update(id, change) {
  return serial(async () => {
    const job = await get('macroJob'); if (job?.id !== id) return null;
    const next = change(job); if (!next) return null; await put('macroJob', next); return next;
  });
}
function note(job, message) { job.message = message; job.logs = [...(job.logs || []), { at: Date.now(), message }].slice(-50); return job; }
async function pause(id, message, uncertain = false) {
  return update(id, job => { if (!running(job)) return null; job.state = 'paused'; job.uncertain = uncertain; return note(job, message); });
}
async function frames(job) {
  const out = [];
  for (const tabId of job.tabIds) {
    let list = [];
    try { list = await chrome.webNavigation.getAllFrames({ tabId }) || []; } catch { /* closed */ }
    for (const frame of list) if (allowedUrl(frame.url, teamById(job.recipe.teamId))) out.push({ tabId, frameId: frame.frameId });
  }
  return out;
}
async function inFrame(frame, step, job, execute) {
  const result = await chrome.scripting.executeScript({ target: { tabId: frame.tabId, frameIds: [frame.frameId] }, func: macroPageStep, args: [step, job.recipe.quantity, job.recipe.adjacent, execute] });
  return result[0]?.result || { status: 'waiting' };
}
async function waitRunning(id, ms, deadline) {
  const until = Math.min(Date.now() + ms, deadline);
  while (Date.now() < until) {
    const job = await get('macroJob'); if (job?.id !== id || job.state !== 'running') return false;
    await sleep(Math.min(500, until - Date.now()));
  }
  const job = await get('macroJob');
  return job?.id === id && job.state === 'running';
}
async function notifySeats(id, message) {
  try { await chrome.notifications.create('seats:' + id, { type: 'basic', iconUrl: chrome.runtime.getURL('icon.png'), title: '첫 공 · 빈 좌석 발견', message }); } catch { /* OS notifications may be disabled */ }
}
async function drive(id) {
  if (executor) return;
  executor = id;
  try {
    while (true) {
      let job = await get('macroJob');
      if (job?.id !== id || job.state !== 'running') return;
      if (job.index >= job.recipe.steps.length) { await update(id, j => { if (j.state !== 'running') return null; j.state = 'done'; return note(j, '설정한 매크로 동작을 마쳤습니다. 예매 결과와 결제는 직접 확인하세요.'); }); return; }
      const step = job.recipe.steps[job.index];
      const watch = step.kind === 'seats' && job.recipe.cancellation?.enabled ? job.recipe.cancellation : null;
      const deadline = Date.now() + (watch ? watch.minutes * 60 : step.timeout) * 1000;
      let firstCheck = true;
      if (watch) await update(id, j => { if (j.state !== 'running') return null; return note(j, '취소표 대기: ' + watch.interval + '초 간격, 최대 ' + watch.minutes + '분'); });
      let done = false;
      while (Date.now() < deadline) {
        job = await get('macroJob'); if (job?.id !== id || job.state !== 'running') return;
        if (watch?.refresh && !firstCheck) {
          const targets = [];
          for (const frame of await frames(job)) {
            try {
              const result = await inFrame(frame, watch.refresh, job, false);
              if (result.status === 'blocked') { await pause(id, result.message); return; }
              if (result.status === 'ready') targets.push(frame);
            } catch { /* loading */ }
          }
          if (targets.length !== 1) { await pause(id, '좌석 갱신 버튼을 하나로 확인하지 못했습니다. 화면을 확인하세요.'); return; }
          const claim = await update(id, j => { if (j.state !== 'running') return null; j.phase = 'executing'; return j; });
          if (!claim) return;
          const latest = await get('macroJob'); if (latest?.id !== id || latest.state !== 'running') return;
          try {
            const result = await inFrame(targets[0], watch.refresh, job, true);
            if (result.status !== 'done') { await pause(id, result.message || '갱신하지 못했습니다.'); return; }
          } catch { await pause(id, '갱신 후 화면이 바뀌었습니다. 실행 결과를 확인하세요.', true); return; }
          await update(id, j => { if (j.state !== 'running') return null; j.phase = 'waiting'; return j; });
          if (!await waitRunning(id, 1000, deadline)) return;
        }
        if (Date.now() >= deadline) break;
        firstCheck = false;
        const candidates = [];
        for (const frame of await frames(job)) {
          try {
            const result = await inFrame(frame, step, job, false);
            if (result.status === 'blocked') { await pause(id, result.message); return; }
            if (result.status === 'ready') candidates.push(frame);
          } catch { /* frame is loading; wait without refreshing */ }
        }
        if (candidates.length > 1) { await pause(id, '같은 대상이 여러 탭/프레임에 있습니다. 불필요한 예매 창을 닫고 재개하세요.'); return; }
        if (candidates.length === 1) {
          if (watch?.mode === 'notify') {
            const stopped = await pause(id, '빈 좌석 발견! 직접 선택한 뒤 단계를 넘기세요.');
            if (stopped) await notifySeats(id, '조건에 맞는 빈 좌석을 발견했습니다. 예매 탭을 확인하세요.');
            return;
          }
          const claim = await update(id, j => { if (j.state !== 'running' || j.index !== job.index) return null; j.phase = 'executing'; return note(j, `${j.index + 1}단계 실행: ${step.text || step.kind}`); });
          if (!claim) return;
          const latest = await get('macroJob'); if (latest?.id !== id || latest.state !== 'running') return;
          let result;
          try { result = await inFrame(candidates[0], step, job, true); }
          catch { await pause(id, '페이지가 바뀌어 실행 결과를 확인하지 못했습니다. 해당 동작이 실행됐는지 확인 후 단계를 넘기세요.', true); return; }
          if (result.status === 'done') {
            await update(id, j => { if (j.state !== 'running' || j.index !== job.index) return null; j.index++; j.phase = 'waiting'; j.uncertain = false; return note(j, result.message || `${j.index}단계 완료`); });
            if (watch) await notifySeats(id, '빈 좌석 선택을 요청했습니다. 실제 선택 결과와 결제는 직접 확인하세요.');
            done = true; await sleep(500); break;
          }
          if (result.status === 'blocked') { await pause(id, result.message, step.kind === 'seats'); return; }
          await update(id, j => { if (j.state !== 'running') return null; j.phase = 'waiting'; return j; });
        }
        if (!await waitRunning(id, watch ? watch.interval * 1000 : 600, deadline)) return;
      }
      if (!done) { await pause(id, watch ? '취소표 대기 시간이 끝났습니다. 재개하면 새 대기를 시작합니다.' : `${job.index + 1}단계 대상을 ${step.timeout}초 동안 찾지 못했습니다. 화면을 확인하고 재개하세요.`); return; }
    }
  } catch (error) { await pause(id, '실행 중 오류가 발생했습니다. 화면을 확인하고 재개하세요: ' + error.message, (await get('macroJob'))?.phase === 'executing'); } finally { executor = null; }
}
async function startWaiting(id) {
  const job = await update(id, j => { if (j.state !== 'waiting') return null; if (Date.now() - j.startAt > 60000) { j.state = 'paused'; return note(j, '예약 시각보다 1분 이상 늦었습니다. 화면을 확인하고 재개하세요.'); } j.state = 'running'; return note(j, '예약한 시각에 매크로를 시작합니다.'); });
  if (job?.state === 'running') void drive(id);
}
async function stopPick() {
  const pick = await get('macroPick');
  if (pick) await chrome.tabs.sendMessage(pick.tabId, { type: 'MACRO_PICK_STOP' }).catch(() => {});
  await put('macroPick', null);
}
async function handle(message, sender) {
  if (message.type === 'MACRO_PICKED' || message.type === 'MACRO_PICK_CANCEL') {
    return serial(async () => {
      const pick = await get('macroPick');
      if (!pick || pick.id !== message.id || sender.tab?.id !== pick.tabId || !allowedUrl(sender.url, teamById(pick.teamId))) return { ok: false };
      if (message.type === 'MACRO_PICK_CANCEL') { await stopPick(); return { ok: true }; }
      const recipes = await get('macroRecipes') || {};
      const recipe = recipes[pick.teamId] || { teamId: pick.teamId, quantity: 2, adjacent: true, steps: [] };
      const step = { ...message.step, kind: pick.kind, page: sender.url };
      const valid = validateRecipe(pick.kind === 'refresh' ? { ...recipe, cancellation: { ...recipe.cancellation, refresh: { ...step, kind: 'click' } } } : { ...recipe, steps: [...recipe.steps, step] });
      recipes[pick.teamId] = valid; await put('macroRecipes', recipes); await stopPick();
      return { ok: true };
    });
  }
  if (!ui(sender)) return { ok: false, error: '매크로 화면에서 실행하세요.' };
  if (message.type === 'MACRO_TABS') {
    const team = teamById(message.teamId);
    const tabs = (await chrome.tabs.query({})).filter(t => allowedUrl(t.url, team));
    return { ok: true, tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url })) };
  }
  if (message.type === 'MACRO_OPEN') {
    const team = teamById(message.teamId); if (!team) throw Error('구단을 선택하세요.');
    const tab = await chrome.tabs.create({ url: team.url, active: true }); return { ok: true, tabId: tab.id };
  }
  if (message.type === 'MACRO_SAVE') return serial(async () => {
    const valid = validateRecipe(message.recipe), recipes = await get('macroRecipes') || {};
    recipes[valid.teamId] = valid; await put('macroRecipes', recipes); return { ok: true };
  });
  if (message.type === 'MACRO_PICK_START') return serial(async () => {
    const team = teamById(message.teamId), tab = await chrome.tabs.get(Number(message.tabId));
    if (!allowedUrl(tab.url, team) || !['click', 'select', 'seats', 'refresh'].includes(message.kind)) throw Error('해당 구단의 예매 탭과 동작을 선택하세요.');
    const job = await get('macroJob'); if (running(job)) throw Error('매크로를 중지한 뒤 대상을 지정하세요.');
    await stopPick();
    const pick = { id: crypto.randomUUID(), tabId: tab.id, teamId: team.id, kind: message.kind };
    await put('macroPick', pick);
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['src/macro-picker.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'MACRO_PICK', id: pick.id, kind: pick.kind });
    await chrome.windows.update(tab.windowId, { focused: true }); await chrome.tabs.update(tab.id, { active: true });
    return { ok: true };
  });
  if (message.type === 'MACRO_RUN') {
    const result = await serial(async () => {
      if (running(await get('macroJob')) || executor) throw Error('진행 중인 매크로를 먼저 중지하세요.');
      const recipe = validateRecipe((await get('macroRecipes') || {})[message.teamId]);
      if (recipe.cancellation.enabled && !recipe.steps.some(s => s.kind === 'seats')) throw Error('빈 좌석 구역을 먼저 지정하세요.');
      if (!recipe.steps.length) throw Error('실행할 동작을 먼저 지정하세요.');
      const tab = await chrome.tabs.get(Number(message.tabId));
      if (!allowedUrl(tab.url, teamById(recipe.teamId))) throw Error('해당 구단의 예매 탭을 선택하세요.');
      let startAt = null;
      if (message.startAt) { startAt = parseKst(message.startAt); if (!Number.isFinite(startAt) || startAt <= Date.now()) throw Error('미래의 실행 시각(한국 시간)을 입력하세요.'); }
      const job = { id: crypto.randomUUID(), recipe, index: 0, phase: 'waiting', state: startAt ? 'waiting' : 'running', startAt, tabIds: [tab.id], rootTabId: tab.id, logs: [] };
      note(job, startAt ? '매크로 실행 시각을 기다립니다. 브라우저를 켜 두세요.' : '매크로를 실행합니다.'); await stopPick(); await put('macroJob', job);
      if (startAt) await chrome.alarms.create('macro:' + job.id, { when: startAt });
      return { ok: true, job };
    });
    if (result.job.state === 'running') void drive(result.job.id);
    return { ok: true };
  }
  if (message.type === 'MACRO_PAUSE') {
    const job = await get('macroJob'); if (job) { await chrome.alarms.clear('macro:' + job.id); await pause(job.id, '사용자가 매크로를 중지했습니다.', job.phase === 'executing'); } return { ok: true };
  }
  if (message.type === 'MACRO_RESUME' || message.type === 'MACRO_SKIP') {
    const job = await get('macroJob');
    if (!job || job.state !== 'paused' || executor) throw Error('동작이 멈춘 뒤 재개하세요.');
    if (message.type === 'MACRO_RESUME' && (job.uncertain || job.phase === 'executing')) throw Error('실행 여부가 불확실합니다. 예매 화면을 확인하고 현재 단계 넘기기를 선택하세요.');
    const resumed = await update(job.id, j => { if (j.state !== 'paused') return null; if (message.type === 'MACRO_SKIP') j.index++; j.state = 'running'; j.phase = 'waiting'; j.uncertain = false; return note(j, message.type === 'MACRO_SKIP' ? '직접 처리한 단계를 넘기고 재개합니다.' : '멈춘 단계부터 다시 확인합니다.'); });
    if (resumed) void drive(job.id); return { ok: true };
  }
  throw Error('지원하지 않는 매크로 요청입니다.');
}
// A job stored as 'running' while no executor exists in this worker is a phantom: the service worker (or browser)
// restarted mid-run. Never resume it silently; mark it paused so the user checks the page first.
async function normalizeAfterRestart() {
  return serial(async () => {
    const job = await get('macroJob');
    if (job?.state === 'running' && executor !== job.id) {
      job.state = 'paused'; job.uncertain = job.phase === 'executing';
      note(job, '확장 프로그램이 다시 시작되어 매크로를 일시 중지했습니다. 현재 화면을 확인하고 재개하세요.');
      await put('macroJob', job);
    } else if (job?.state === 'waiting') await chrome.alarms.create('macro:' + job.id, { when: Math.max(Date.now() + 100, job.startAt) });
  });
}
// Browser start / extension update: also end any pick mode left in a page, which would otherwise swallow real clicks.
async function recover() {
  await normalizeAfterRestart();
  await serial(async () => {
    const pick = await get('macroPick');
    if (pick?.tabId) {
      try { await chrome.tabs.sendMessage(pick.tabId, { type: 'MACRO_PICK_STOP' }); } catch { /* tab closed or script gone */ }
    }
    await put('macroPick', null);
  });
}
export function registerMacroEngine() {
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (typeof message?.type !== 'string' || !message.type.startsWith('MACRO_')) return;
    handle(message, sender).then(respond, e => respond({ ok: false, error: e.message })); return true;
  });
  chrome.tabs.onCreated.addListener(tab => { if (!tab.openerTabId) return; serial(async () => { const job = await get('macroJob'); if (running(job) && job.tabIds.includes(tab.openerTabId)) { job.tabIds = [...new Set([...job.tabIds, tab.id])]; await put('macroJob', job); } }).catch(console.error); });
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name.startsWith('macro:')) void startWaiting(alarm.name.slice(6)); });
  chrome.runtime.onStartup.addListener(() => recover().catch(console.error));
  chrome.runtime.onInstalled.addListener(() => recover().catch(console.error));
  // Runs on every service-worker load. Pick mode is kept here so a pick that woke the worker is not lost.
  return normalizeAfterRestart().catch(console.error);
}
