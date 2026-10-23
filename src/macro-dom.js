// Self-contained function serialized by chrome.scripting into a specific frame.
export function macroPageStep(step, quantity, adjacent, execute = false) {
  const visible = el => el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const text = el => (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || '').replace(/\s+/g, ' ').trim();
  const enabled = el => visible(el) && !el.disabled && !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true' && !/disabled|reserved|unavailable|sold|selected/i.test(el.className?.baseVal ?? el.className ?? '') && el.getAttribute('aria-selected') !== 'true';
  // Partial match on purpose: '결제하기', '결제 진행', '카드결제' all stop the macro.
  const payment = /결제|구매\s*확정|예약\s*확정|pay\s*now|confirm\s*purchase|checkout/i;
  // Every label a payment control can carry: text, aria/title, <input> value/alt, and <img alt> inside it.
  const labels = el => [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('alt'), el.tagName === 'INPUT' ? el.value : null, el.innerText, ...[...(el.querySelectorAll ? el.querySelectorAll('img[alt]') : [])].map(img => img.getAttribute('alt'))].filter(Boolean).join(' ').replace(/\s+/g, ' ');
  const controls = [...document.querySelectorAll('button,a,[role="button"],input[type="submit"],input[type="button"],input[type="image"],img[alt]')].filter(visible);
  if ([...document.querySelectorAll('input[type="password"],input[autocomplete^="cc-"],input[name*="captcha" i],[id*="captcha" i],iframe[src*="captcha" i]')].some(visible)) return { status: 'blocked', message: '로그인·보안문자·결제 정보를 직접 처리한 뒤 재개하세요.' };
  if (/대기 순번|접속 대기 중|예상 대기 시간|자동입력 방지|접근이 제한/.test(document.body?.innerText || '')) return { status: 'blocked', message: '대기열 또는 인증 화면입니다. 직접 처리한 뒤 재개하세요.' };
  // Fail closed: any visible payment control (enabled or not) stops the run.
  if (controls.some(el => payment.test(labels(el)))) return { status: 'blocked', message: '결제 직전입니다. 매크로를 멈췄습니다. 내용을 직접 확인하세요.' };
  if (location.origin + location.pathname !== step.page) return { status: 'waiting' };
  let nodes;
  try { nodes = [...document.querySelectorAll(step.selector)].filter(visible); } catch { return { status: 'blocked', message: '화면 대상이 유효하지 않습니다. 다시 지정하세요.' }; }
  if (step.kind === 'seats') {
    const seats = nodes.filter(enabled).map(el => {
      const status = el.dataset.seatStatus || el.dataset.status;
      if (status && !/^(available|free|open|empty)$/i.test(status)) return null;
      const label = text(el);
      const match = label.match(/([\w가-힣]+)\s*열\s*[-,:]?\s*(\d+)\s*번?/);
      const row = el.dataset.row || el.dataset.seatRow || match?.[1];
      const number = Number(el.dataset.seatNumber || el.dataset.seatNo || el.dataset.number || match?.[2]);
      const section = el.dataset.section || label.match(/([\w가-힣]+)\s*구역/)?.[1] || '';
      const block = el.dataset.block || '';
      if (!row || !Number.isInteger(number) || number < 1) return null;
      return { el, row, number, section, block };
    }).filter(Boolean);
    let chosen = [];
    const groups = new Map();
    for (const seat of seats) { const key = `${seat.section}/${seat.block}/${seat.row}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(seat); }
    if (adjacent) {
      for (const group of groups.values()) {
        group.sort((a, b) => a.number - b.number);
        for (let i = 0; i <= group.length - quantity; i++) {
          const part = group.slice(i, i + quantity);
          if (part.every((seat, j) => seat.number === part[0].number + j)) { chosen = part; break; }
        }
        if (chosen.length) break;
      }
    } else chosen = seats.slice(0, quantity);
    if (chosen.length !== quantity) return { status: 'waiting', message: '조건에 맞는 좌석이 아직 없습니다.' };
    if (!execute) return { status: 'ready', seats: chosen.map(s => `${s.section} ${s.row}열 ${s.number}번`) };
    for (const seat of chosen) {
      if (!seat.el.isConnected || !enabled(seat.el)) return { status: 'blocked', message: '좌석 상태가 바뀌었습니다. 일부 선택 여부를 직접 확인하세요.' };
      seat.el.click();
    }
    return { status: 'done', message: `${quantity}개 좌석 클릭 요청. 실제 선택 결과는 예매 화면에서 확인하세요.` };
  }
  nodes = nodes.filter(el => (!step.tag || el.tagName.toLowerCase() === step.tag) && (step.kind === 'select' || !step.text || text(el) === step.text));
  if (!nodes.length || !enabled(nodes[0])) return { status: 'waiting' };
  if (nodes.length > 1) return { status: 'blocked', message: '동일한 대상이 여러 개입니다. 매크로 대상을 다시 지정하세요.' };
  const target = nodes[0];
  if (payment.test(labels(target)) ||/payment|checkout/i.test(target.getAttribute('href') || '')) return { status: 'blocked', message: '결제 단계는 직접 진행하세요.' };
  if (step.kind === 'select') {
    if (!(target instanceof HTMLSelectElement)) return { status: 'blocked', message: '인원 선택 목록을 다시 지정하세요.' };
    const value = step.value === '{{quantity}}' ? String(quantity) : step.value;
    const options = [...target.options].filter(o => !o.disabled && (o.value === value || (step.value === '{{quantity}}' && new RegExp(`^${quantity}\\s*(명|매)?$`).test(o.textContent.trim()))));
    if (options.length !== 1) return { status: 'waiting', message: '선택할 인원/항목이 아직 없습니다.' };
    if (execute) { target.value = options[0].value; target.dispatchEvent(new Event('input', { bubbles: true })); target.dispatchEvent(new Event('change', { bubbles: true })); }
  } else if (execute) target.click();
  return { status: execute ? 'done' : 'ready' };
}
