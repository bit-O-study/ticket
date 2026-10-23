import { TEAMS, teamName, MIN_QUANTITY, MAX_QUANTITY } from './core.js';
const $ = s => document.querySelector(s);
const el = (tag, text, cls) => { const node = document.createElement(tag); if (text) node.textContent = text; if (cls) node.className = cls; return node; };
let recipes = {}, teamId = TEAMS[0].id;
const empty = () => ({ teamId, quantity: 2, adjacent: true, steps: [] });
const current = () => recipes[teamId] || empty();
const request = async message => { const r = await chrome.runtime.sendMessage(message); if (!r?.ok) throw Error(r?.error || '처리하지 못했습니다.'); return r; };
function status(text, error = false) { $('#macro-status').textContent = text; $('#macro-status').dataset.error = String(error); }
async function action(fn) { try { await fn(); } catch (e) { status(e.message, true); } }
async function save(recipe) { await request({ type: 'MACRO_SAVE', recipe }); }
async function refreshTabs(wantId) {
  const selected = String(wantId || $('#macro-tab').value);
  const { tabs } = await request({ type: 'MACRO_TABS', teamId });
  const options = tabs.map(tab => { const option = el('option', tab.title || tab.url); option.value = String(tab.id); return option; });
  if (!options.length) { const option = el('option', '예매처를 먼저 열어 주세요'); option.value = ''; options.push(option); }
  $('#macro-tab').replaceChildren(...options);
  if (tabs.some(tab => String(tab.id) === selected)) $('#macro-tab').value = selected;
}
function paintRecipe() {
  const recipe = current(); $('#macro-quantity').value = recipe.quantity; $('#adjacent').checked = recipe.adjacent;
  const c = recipe.cancellation || {};
  $('#cancel-enabled').checked = !!c.enabled; $('#cancel-interval').value = c.interval ?? 10; $('#cancel-minutes').value = c.minutes ?? 30; $('#cancel-mode').value = c.mode ?? 'select';
  $('#cancel-refresh').textContent = c.refresh ? '갱신 버튼: ' + (c.refresh.text || c.refresh.selector) : '갱신 버튼 미지정 · 화면 변경 감지';
  $('#step-count').textContent = `${recipe.steps.length}개 동작`; $('#macro-steps').replaceChildren();
  if (!recipe.steps.length) $('#macro-steps').append(el('p', '예매 탭에서 자동으로 처리할 대상을 지정하세요.', 'note'));
  recipe.steps.forEach((step, index) => {
    const li = el('li'); li.append(el('b', `${{ click: '클릭', select: '인원 선택', seats: '빈 좌석 선택' }[step.kind]} · ${step.text || step.tag}`));
    li.append(el('small', step.page));
    const fields = el('div', '', 'step-fields');
    const timeoutLabel = el('label', '대상 대기 · 초'); const timeout = el('input'); timeout.type = 'number'; timeout.min = '3'; timeout.max = '120'; timeout.value = step.timeout;
    timeout.addEventListener('change', () => action(async () => { const updated = structuredClone(current()); updated.steps[index].timeout = Number(timeout.value); await save(updated); })); timeoutLabel.append(timeout); fields.append(timeoutLabel);
    if (step.kind === 'select') {
      const valueLabel = el('label', '선택할 값 · {{quantity}} = 인원'); const value = el('input'); value.value = step.value;
      value.addEventListener('change', () => action(async () => { const updated = structuredClone(current()); updated.steps[index].value = value.value; await save(updated); })); valueLabel.append(value); fields.append(valueLabel);
    }
    li.append(fields); const buttons = el('div', '', 'step-actions');
    for (const [title, delta] of [['위로', -1], ['아래로', 1], ['삭제', 0]]) {
      const button = el('button', title); button.type = 'button'; button.disabled = (delta === -1 && index === 0) || (delta === 1 && index === recipe.steps.length - 1);
      button.addEventListener('click', () => action(async () => { const updated = structuredClone(current()); if (!delta) updated.steps.splice(index, 1); else [updated.steps[index], updated.steps[index + delta]] = [updated.steps[index + delta], updated.steps[index]]; await save(updated); })); buttons.append(button);
    }
    li.append(buttons); $('#macro-steps').append(li);
  });
}
function paintJob(job) {
  $('#macro-job').replaceChildren();
  $('#macro-pause').disabled = !job || !['running', 'waiting'].includes(job.state);
  $('#macro-resume').disabled = !job || job.state !== 'paused' || !!job.uncertain;
  $('#macro-skip').disabled = !job || job.state !== 'paused';
  $('#macro-run').disabled = !!job && ['running', 'waiting'].includes(job.state);
  if (!job) { $('#macro-job').append(el('span', '아직 실행한 매크로가 없습니다.')); return; }
  $('#macro-job').append(el('strong', `${teamName(job.recipe?.teamId)} · ${{ waiting: '시각 대기', running: '실행 중', paused: '일시 중지', done: '동작 완료' }[job.state]} · ${Math.min(job.index + 1, job.recipe.steps.length)}/${job.recipe.steps.length} 단계`), el('p', job.message));
  const log = el('ol'); for (const item of (job.logs || []).slice(-8)) log.append(el('li', item.message)); $('#macro-job').append(log);
}
$('#macro-quantity').min = String(MIN_QUANTITY); $('#macro-quantity').max = String(MAX_QUANTITY);
for (const team of TEAMS) { const option = el('option', team.name); option.value = team.id; $('#macro-team').append(option); }
$('#macro-team').addEventListener('change', () => action(async () => { teamId = $('#macro-team').value; paintRecipe(); await refreshTabs(); }));
$('#macro-open').addEventListener('click', () => action(async () => { const result = await request({ type: 'MACRO_OPEN', teamId }); await refreshTabs(result.tabId); status('예매처에서 로그인하고 대상 화면으로 이동한 뒤 돌아와 동작을 지정하세요.'); }));
$('#refresh-tabs').addEventListener('click', () => action(() => refreshTabs()));
for (const button of document.querySelectorAll('[data-pick]')) button.addEventListener('click', () => action(async () => { await request({ type: 'MACRO_PICK_START', teamId, tabId: Number($('#macro-tab').value), kind: button.dataset.pick }); status('예매 화면의 대상을 클릭하세요. Esc로 취소할 수 있습니다.'); }));
for (const id of ['macro-quantity', 'adjacent']) $('#' + id).addEventListener('change', () => action(() => save({ ...current(), quantity: Number($('#macro-quantity').value), adjacent: $('#adjacent').checked })));
$('#macro-run').addEventListener('click', () => action(async () => { await request({ type: 'MACRO_RUN', teamId, tabId: Number($('#macro-tab').value), startAt: $('#macro-start-at').value }); status('매크로가 시작됐습니다. 예매 화면에서 진행을 확인하세요.'); }));
$('#macro-pause').addEventListener('click', () => action(() => request({ type: 'MACRO_PAUSE' })));
$('#macro-resume').addEventListener('click', () => action(() => request({ type: 'MACRO_RESUME' })));
$('#macro-skip').addEventListener('click', () => action(() => request({ type: 'MACRO_SKIP' })));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.macroRecipes) { recipes = changes.macroRecipes.newValue || {}; paintRecipe(); status('동작을 저장했습니다. 다음 대상을 지정하거나 매크로를 실행하세요.'); }
  if (changes.macroJob) paintJob(changes.macroJob.newValue);
});
const stored = await chrome.storage.local.get(['macroRecipes', 'macroJob']); recipes = stored.macroRecipes || {}; paintRecipe(); paintJob(stored.macroJob); await action(() => refreshTabs());

for (const id of ['cancel-enabled', 'cancel-interval', 'cancel-minutes', 'cancel-mode']) $('#' + id).addEventListener('change', () => action(() => save({ ...current(), cancellation: { ...current().cancellation, enabled: $('#cancel-enabled').checked, interval: Number($('#cancel-interval').value), minutes: Number($('#cancel-minutes').value), mode: $('#cancel-mode').value } })));
$('#cancel-clear').addEventListener('click', () => action(() => save({ ...current(), cancellation: { ...current().cancellation, refresh: null } })));
