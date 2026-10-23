import { TEAMS, ACTIVE, STATES, EDITABLE, RESTARTABLE, MIN_QUANTITY, MAX_QUANTITY, displayKst, teamById, teamName, planInput, parseKst } from './core.js';
const $ = selector => document.querySelector(selector);
const form = $('#plan-form');
// UI refresh only: the clock/countdown repaint locally every second; the background sweep is asked every 15 s
// (Chrome alarms remain the primary trigger). Nothing here contacts a ticket site.
const CLOCK_MS = 1000, TICK_MS = 15000;
let selected = TEAMS[0].id;
let plans = [];
let editingId = null;
const cards = new Map(); // plan id -> { card, signature }
const request = async message => { const response = await chrome.runtime.sendMessage(message); if (!response?.ok) throw new Error(response?.error || '요청을 처리하지 못했습니다.'); return response; };
function status(text, error = false) { $('#form-status').textContent = text; $('#form-status').dataset.error = String(error); }
function element(tag, text, cls) { const el = document.createElement(tag); if (text) el.textContent = text; if (cls) el.className = cls; return el; }
form.elements.quantity.min = String(MIN_QUANTITY); form.elements.quantity.max = String(MAX_QUANTITY);
function selectTeam(id) {
  const team = teamById(id) || TEAMS[0];
  selected = team.id;
  for (const button of $('#teams').children) button.setAttribute('aria-pressed', String(button.dataset.id === team.id));
  $('#provider').textContent = team.provider;
  form.elements.url.value = team.url;
  const previous = form.elements.opponentId.value;
  form.elements.opponentId.replaceChildren(...TEAMS.filter(t => t.id !== team.id).map(t => { const option = element('option', t.name); option.value = t.id; return option; }));
  if (previous !== team.id && previous) form.elements.opponentId.value = previous;
  chrome.storage.local.set({ selectedTeam: team.id });
}
for (const team of TEAMS) {
  const button = element('button', '', 'team'); button.type = 'button'; button.dataset.id = team.id; button.setAttribute('aria-pressed', 'false');
  const badge = element('span', team.short, 'badge'); badge.style.backgroundColor = team.color; badge.setAttribute('aria-hidden', 'true');
  const body = element('span'); body.append(element('b', team.name), element('small', team.provider)); button.append(badge, body);
  button.addEventListener('click', () => selectTeam(team.id)); $('#teams').append(button);
}
function countdown(plan) {
  const left = Math.max(0, Math.ceil((plan.openAt - Date.now()) / 1000));
  const days = Math.floor(left / 86400), hours = Math.floor(left / 3600) % 24, min = Math.floor(left / 60) % 60, sec = left % 60;
  return `${days ? days + '일 ' : ''}${[hours, min, sec].map(n => String(n).padStart(2, '0')).join(':')}`;
}
function resetEdit() {
  editingId = null; $('#edit-banner').hidden = true; $('#save-plan').textContent = '오픈 예약 추가 ＋';
}
function fillPlan(plan, editing) {
  if (!teamById(plan.teamId)) { status('알 수 없는 구단의 예약은 수정·복제할 수 없습니다. 삭제 후 새로 등록하세요.', true); return; }
  selectTeam(plan.teamId);
  const values = planInput(plan);
  for (const [name, value] of Object.entries(values)) {
    const field = form.elements.namedItem(name);
    if (!field) continue;
    if (field.type === 'checkbox') field.checked = editing && value;
    else field.value = value ?? '';
  }
  editingId = editing ? plan.id : null;
  $('#edit-banner').hidden = !editing;
  $('#save-plan').textContent = editing ? '수정한 예약 저장' : '오픈 예약 추가 ＋';
  if (!editing) { form.elements.gameAt.value = ''; form.elements.openAt.value = ''; }
  status(editing ? '날짜와 오픈 시간을 확인한 뒤 저장하세요. 저장 전까지 기존 예약이 유지됩니다.' : '설정을 복사했습니다. 새 경기 날짜와 오픈 시간을 입력하세요.');
  form.scrollIntoView({ behavior: 'smooth', block: 'start' }); form.elements.gameAt.focus({ preventScroll: true });
}
$('#cancel-edit').addEventListener('click', () => { resetEdit(); form.reset(); selectTeam(selected); status('수정을 취소했습니다. 기존 예약은 유지됩니다.'); });
const gameFuture = plan => parseKst(plan.gameAt) > Date.now();
const openFuture = plan => plan.openAt > Date.now();
// Everything that changes what a card shows; time-dependent buttons are included so they flip when time passes.
const signature = plan => JSON.stringify([plan, gameFuture(plan), openFuture(plan)]);
function buildCard(plan) {
  const card = element('article', '', 'plan'); card.dataset.state = plan.state; card.dataset.id = plan.id;
  card.append(element('span', STATES[plan.state] || plan.state, 'tag'), element('h3', `${teamName(plan.teamId)} vs ${teamName(plan.opponentId)}`), element('p', `${String(plan.gameAt || '').replace('T', ' ')} 경기 · ${plan.quantity}명${plan.section ? ' · ' + plan.section : ''}`));
  const time = element('p', plan.state === 'scheduled' ? countdown(plan) : displayKst(plan.openAt), 'time'); if (plan.state === 'scheduled') time.dataset.countdown = plan.id;
  card.append(time, element('p', `예매 오픈 ${displayKst(plan.openAt)} (한국 시간)`), element('p', plan.message));
  const actions = element('div', '', 'plan-actions');
  const controls = [['FOCUS', '예매 탭 열기'], ...(EDITABLE.has(plan.state) ? [['EDIT', '수정']] : []), ['CLONE', '복제'], ...(ACTIVE.has(plan.state) ? [['STOP', '중지']] : []), ...(RESTARTABLE.has(plan.state) && gameFuture(plan) ? [['RESTART', openFuture(plan) ? '예약 다시 시작' : '화면 확인 재개']] : []), ['DELETE', '삭제']];
  for (const [type, title] of controls) {
    const button = element('button', title, type === 'DELETE' ? 'danger' : ''); button.type = 'button'; button.dataset.action = type;
    button.addEventListener('click', async () => {
      if (type === 'EDIT' || type === 'CLONE') { fillPlan(plan, type === 'EDIT'); return; }
      if (type === 'DELETE' && !confirm('이 예약과 실행 기록을 삭제할까요?')) return;
      button.disabled = true; try {
        await request({ type, id: plan.id });
        if (type === 'DELETE' && editingId === plan.id) resetEdit();
        if (type === 'RESTART') status('다시 시작했습니다. 자동 클릭은 꺼져 있습니다.');
      } catch (e) { status(e.message, true); } finally { button.disabled = false; }
    }); actions.append(button);
  }
  card.append(actions);
  const details = element('details', '', 'logs'); details.append(element('summary', '실행 기록')); const list = element('ol');
  for (const item of plan.logs || []) list.append(element('li', `${displayKst(item.at)} · ${item.message}`)); details.append(list); card.append(details);
  return card;
}
// Per-card update: unchanged cards are reused as-is; changed cards are rebuilt but keep their log panel open.
function paint() {
  $('#count').textContent = `${plans.filter(p => ACTIVE.has(p.state)).length}건 진행 중`;
  const sorted = [...plans].sort((a, b) => Number(ACTIVE.has(b.state)) - Number(ACTIVE.has(a.state)) || a.openAt - b.openAt);
  const nodes = [], seen = new Set();
  for (const plan of sorted) {
    seen.add(plan.id);
    const sig = signature(plan), old = cards.get(plan.id);
    if (old?.signature === sig) { nodes.push(old.card); continue; }
    const card = buildCard(plan);
    if (old?.card.querySelector('details')?.open) card.querySelector('details').open = true;
    cards.set(plan.id, { card, signature: sig }); nodes.push(card);
  }
  for (const id of [...cards.keys()]) if (!seen.has(id)) cards.delete(id);
  if (!nodes.length) { const empty = element('div', '', 'empty'); empty.append(element('b', '아직 등록한 예약이 없어요'), element('span', '구단과 경기 시간을 선택해 첫 예약을 추가하세요.')); nodes.push(empty); }
  const container = $('#plans');
  const current = [...container.children];
  if (current.length !== nodes.length || current.some((node, i) => node !== nodes[i])) container.replaceChildren(...nodes);
}
form.addEventListener('submit', async event => {
  event.preventDefault(); const button = form.querySelector('[type=submit]'); button.disabled = true;
  try {
    const input = Object.fromEntries(new FormData(form)); input.teamId = selected; input.autoClick = form.elements.autoClick.checked;
    const wasEditing = !!editingId;
    await request({ type: wasEditing ? 'UPDATE' : 'ADD', id: editingId, input });
    resetEdit(); status(wasEditing ? '예약을 수정했습니다. 새 오픈 시간으로 예약했습니다.' : '예약했습니다. 브라우저와 PC를 켜 두세요.');
  }
  catch (error) { status(error.message, true); } finally { button.disabled = false; }
});
$('#prepare').addEventListener('click', async () => { try { await request({ type: 'PREPARE', teamId: selected, url: form.elements.url.value }); } catch (e) { status(e.message, true); } });
function backupStatus(text, error = false) { $('#backup-status').textContent = text; $('#backup-status').dataset.error = String(error); }
$('#export').addEventListener('click', async () => {
  try {
    const { backup } = await request({ type: 'EXPORT' });
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const link = element('a'); link.href = url; link.download = `first-pitch-${new Date().toISOString().slice(0, 10)}.json`; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    backupStatus(`예정된 예약 ${backup.plans.length}건을 백업했습니다. 지난 경기, 로그인 정보, 실행 이력과 주소의 세션 값은 포함하지 않습니다.`);
  } catch (e) { backupStatus(e.message, true); }
});
$('#import').addEventListener('click', () => $('#backup-file').click());
$('#backup-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw new Error('백업 파일은 1MB 이하여야 합니다.');
    const backup = JSON.parse(await file.text());
    if (!confirm('백업을 중지된 예약으로 복원할까요? 기존 예약은 유지하며 중복·지난 경기는 제외합니다.')) return;
    const result = await request({ type: 'IMPORT', backup });
    backupStatus(`${result.imported}건 복원 · ${result.skipped}건 제외(중복·지난 경기). 내용을 확인한 뒤 예약을 다시 시작하세요.`);
  } catch (e) { backupStatus(e instanceof SyntaxError ? '올바른 JSON 백업 파일이 아닙니다.' : e.message, true); }
  finally { event.target.value = ''; }
});
$('#stop-all').addEventListener('click', async () => {
  try { await request({ type: 'STOP_ALL' }); backupStatus('진행 중인 예약을 모두 중지했습니다. 열린 예매 탭은 유지됩니다.'); }
  catch (e) { backupStatus(e.message, true); }
});
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.plans) { plans = changes.plans.newValue || []; paint(); } });
const saved = await chrome.storage.local.get(['selectedTeam', 'plans']);
selectTeam(saved.selectedTeam); plans = saved.plans || []; paint();
function clock() {
  $('#clock').textContent = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(Date.now());
  for (const el of document.querySelectorAll('[data-countdown]')) { const plan = plans.find(p => p.id === el.dataset.countdown); if (plan) el.textContent = countdown(plan); }
  paint(); // cheap: only cards whose content or time-dependent buttons changed are rebuilt
}
let ticking = false;
async function tick() {
  if (ticking || !plans.some(p => ACTIVE.has(p.state))) return;
  ticking = true; try { await request({ type: 'TICK' }); } catch (e) { status(e.message, true); } finally { ticking = false; }
}
clock(); tick(); setInterval(clock, CLOCK_MS); setInterval(tick, TICK_MS);
