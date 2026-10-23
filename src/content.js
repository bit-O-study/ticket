// Injected only into the tab opened for a registered plan; no background scraping.
(() => {
  if (globalThis.__firstPitchInstalled) return;
  globalThis.__firstPitchInstalled = true;
  let current = null;
  const visible = el => !!el && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
  const clean = text => text.replace(/\s+/g, ' ').trim();
  const buttons = root => [...root.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"],input[type="image"]')].filter(visible);
  const label = el => clean(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('alt') || [...el.querySelectorAll('img[alt]')].map(img => img.alt).join(' ') || '');
  // Partial match: any visible control mentioning payment hands control back to the user (fail closed).
  const payment = /결제|구매\s*확정|예약\s*확정|pay\s*now|confirm\s*purchase|checkout/i;
  const reserve = el => /^(예매|예매하기|일반예매|일반 예매|티켓 예매|Book|Book now)$/i.test(label(el));
  function barrier() {
    const elements = [...document.querySelectorAll('input[type="password"],iframe[src*="captcha" i],iframe[src*="recaptcha" i],[id*="captcha" i],input[name*="captcha" i]')];
    if (elements.some(visible)) return '로그인 또는 보안문자가 표시되었습니다. 예매 탭에서 직접 진행하세요.';
    const dialogs = [...document.querySelectorAll('[role="dialog"],dialog,[class*="waiting" i],[id*="queue" i]')].filter(visible);
    const text = clean(document.body?.innerText || '');
    if (dialogs.some(el => /대기|본인.?인증|보안.?문자|접속.?제한/.test(el.innerText)) || /대기 순번|접속 대기 중|예상 대기 시간|자동입력 방지|비정상적인 접근|접근이 제한/.test(text)) return '대기열 또는 인증 화면입니다. 순서를 유지한 채 직접 진행하세요.';
    if (buttons(document).some(el => payment.test(label(el)) || /^(선택 완료|좌석 선택 완료)$/.test(label(el))) || [...document.querySelectorAll('img[alt]')].some(img => visible(img) && payment.test(img.alt))) return '좌석 선택 또는 결제 화면입니다. 직접 확인하고 진행하세요.';
    return null;
  }
  function matchingCard(el, plan) {
    const [ymd, hm] = plan.gameAt.split('T');
    const [year, month, day] = ymd.split('-').map(Number);
    const [hour, minute] = hm.split(':').map(Number);
    // Require a full date, start time and both teams in the same small card.
    // Ambiguous calendars (month/day only, duplicate games) are never auto-clicked.
    const date = new RegExp(`(?:^|[^0-9])${year}\\s*(?:[-./]|년)\\s*0?${month}\\s*(?:[-./]|월)\\s*0?${day}(?:일|[^0-9]|$)`);
    const time = new RegExp(`(?:^|[^0-9])0?${hour}\\s*:\\s*${String(minute).padStart(2, '0')}(?:[^0-9]|$)`);
    const team = new RegExp(`(?:^|[^A-Z])${plan.team.short}(?:[^A-Z]|$)`, 'i');
    const opponent = new RegExp(`(?:^|[^A-Z])${plan.opponent.short}(?:[^A-Z]|$)`, 'i');
    let node = el;
    for (let depth = 0; node && node !== document.body && depth < 7; depth++, node = node.parentElement) {
      const text = clean(node.innerText || '');
      if (text.length > 900 || buttons(node).filter(reserve).length > 1) break;
      if (date.test(text) && time.test(text) && team.test(text) && opponent.test(text)) return node;
    }
    return null;
  }
  function candidates(plan) {
    return buttons(document).filter(el => reserve(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.classList.contains('disabled') && matchingCard(el, plan));
  }
  function stop() { if (current) { clearInterval(current.timer); current = null; } }
  async function signal(run, state, message) {
    if (current !== run) return;
    stop();
    await chrome.runtime.sendMessage({ type: 'SIGNAL', id: run.plan.id, runToken: run.plan.runToken, state, message }).catch(() => {});
  }
  async function inspect(run) {
    if (current !== run || run.busy) return;
    run.busy = true;
    try {
      if (Date.now() > run.plan.watchUntil) return await signal(run, 'handoff', '확인 시간이 끝났습니다. 경기 목록과 예매 가능 여부를 직접 확인하세요.');
      const blocked = barrier();
      if (blocked) return await signal(run, 'handoff', blocked);
      const found = candidates(run.plan);
      if (found.length > 1) return await signal(run, 'handoff', '일치하는 예매 버튼이 여러 개입니다. 경기와 예매 종류를 직접 선택하세요.');
      if (found.length === 0) return;
      if (!run.plan.autoClick) return await signal(run, 'available', '지정 경기의 예매 버튼을 찾았습니다. 잔여 좌석은 예매 화면에서 확인하세요.');
      const element = found[0];
      const permission = await chrome.runtime.sendMessage({ type: 'CLAIM_CLICK', id: run.plan.id, runToken: run.plan.runToken });
      // Recheck after async state lock: cancel/navigation/DOM changes cannot click another game.
      if (!permission.ok || current !== run || barrier() || !element.isConnected || !visible(element) || candidates(run.plan).length !== 1 || !matchingCard(element, run.plan)) { stop(); return; }
      stop();
      element.click();
    } catch { await signal(run, 'error', '화면 확인 중 오류가 발생했습니다. 예매 탭에서 직접 진행하세요.'); }
    finally { run.busy = false; }
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (typeof message?.type !== 'string') return;
    if (message.type === 'STOP') { if (current?.plan.id === message.id) stop(); respond({ ok: true }); }
    if (message.type === 'WATCH') {
      stop(); const run = { plan: message.plan, timer: null, busy: false }; current = run;
      run.timer = setInterval(() => inspect(run), 1500);
      inspect(run); respond({ ok: true });
    }
  });
})();
