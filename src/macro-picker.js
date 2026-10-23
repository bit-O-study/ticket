(() => {
  if (globalThis.__firstPitchPicker) return;
  globalThis.__firstPitchPicker = true;
  let pick = null, banner = null, suppressClickUntil = 0;
  const clean = el => (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.value || el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
  const payment = /결제|구매\s*확정|예약\s*확정|pay\s*now|confirm\s*purchase|checkout/i;
  // Never let a failed message (e.g. extension reloaded -> context invalidated) leave pick mode on.
  const send = message => { try { const sent = chrome.runtime.sendMessage(message); if (sent?.catch) sent.catch(() => {}); } catch { /* extension context gone */ } };
  function selector(el) {
    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
    const parts = []; let node = el;
    while (node && node !== document.body && node.parentElement) {
      if (node.id) { parts.unshift('#' + CSS.escape(node.id)); break; }
      const tag = node.tagName.toLowerCase();
      const siblings = [...node.parentElement.children].filter(e => e.tagName === node.tagName);
      parts.unshift(tag + (siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(node) + 1})` : ''));
      node = node.parentElement;
    }
    return parts.join(' > ');
  }
  function stop() { pick = null; banner?.remove(); banner = null; }
  const say = text => { if (banner) banner.textContent = text; };
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !pick) return;
    const id = pick.id; stop(); send({ type: 'MACRO_PICK_CANCEL', id });
  }, true);
  window.addEventListener('click', event => {
    if (pick || Date.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('pointerdown', event => {
    if (!pick || event.target === banner) return;
    event.preventDefault(); event.stopImmediatePropagation();
    suppressClickUntil = Date.now() + 1500;
    const config = pick;
    let keep = false; // true only when the user is asked to choose another target
    try {
      const target = config.kind === 'select' ? event.target.closest('select') : event.target.closest('button,a,[role="button"],select,[onclick],[data-seat-number],[data-seat-no],[title]') || event.target;
      if (!target || ['INPUT', 'TEXTAREA', 'BODY', 'HTML', 'CANVAS', 'IFRAME'].includes(target.tagName)) { keep = true; say('이 대상은 지원하지 않습니다. 버튼·선택 목록·텍스트 정보가 있는 좌석을 선택하세요. Esc: 취소'); return; }
      const text = clean(target);
      if (payment.test(text)) { keep = true; say('결제 버튼은 자동화하지 않습니다. 다른 동작을 선택하거나 Esc를 누르세요.'); return; }
      if ((config.kind === 'click' || config.kind === 'refresh') && !text) { keep = true; say('글자가 없는 버튼은 지정할 수 없습니다. 글자가 보이는 버튼을 선택하거나 Esc를 누르세요.'); return; }
      let css = selector(target);
      if (config.kind === 'seats') {
        if (!(target.dataset.row || target.dataset.seatRow || /[\w가-힣]+\s*열/.test(text)) || !(target.dataset.seatNumber || target.dataset.seatNo || target.dataset.number || /열\s*[-,:]?\s*\d+/.test(text))) { keep = true; say('이 좌석에는 열·번호 정보가 없습니다. Canvas/이미지 좌석은 현재 자동 연석 선택을 지원하지 않습니다.'); return; }
        const classes = [...target.classList].filter(c => !/selected|active|hover|focus|reserved|unavailable|sold|disabled|available|free|open/i.test(c));
        let group = target.tagName.toLowerCase() + classes.map(c => '.' + CSS.escape(c)).join('');
        if (target.dataset.seatNumber) group += '[data-seat-number]';
        else if (target.dataset.seatNo) group += '[data-seat-no]';
        else group += '[title]';
        // Limit the search to the sample's seat container, not every area on the page.
        css = selector(target.parentElement) + ' > ' + group;
      }
      const step = { kind: config.kind, selector: css, text: config.kind === 'seats' ? '선택한 좌석 구역' : text.slice(0, 200), tag: target.tagName.toLowerCase(), page: location.origin + location.pathname, value: config.kind === 'select' ? '{{quantity}}' : '', timeout: 30 };
      // Leave pick mode before messaging so a failed send can never keep swallowing real clicks.
      stop();
      send({ type: 'MACRO_PICKED', id: config.id, step });
    } finally {
      if (!keep) stop();
    }
  }, true);
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (typeof message?.type !== 'string') return;
    if (message.type === 'MACRO_PICK_STOP') { stop(); respond({ ok: true }); }
    if (message.type === 'MACRO_PICK') {
      stop(); pick = message;
      banner = document.createElement('div'); banner.textContent = `${message.kind === 'seats' ? '원하는 구역의 좌석 하나 (매진 좌석도 가능)' : message.kind === 'select' ? '인원을 선택하는 드롭다운' : '자동으로 누를 버튼'}를 클릭하세요. 실제 클릭은 실행되지 않습니다. Esc: 취소`;
      Object.assign(banner.style, { pointerEvents: 'none', position: 'fixed', bottom: '8px', left: '8px', right: '8px', zIndex: '2147483647', padding: '16px', color: '#fff', background: '#235b42', borderRadius: '8px', font: '14px sans-serif', boxShadow: '0 3px 15px #0004' });
      document.documentElement.append(banner); respond({ ok: true });
    }
  });
})();
