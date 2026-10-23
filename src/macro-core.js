import { allowedUrl, teamById, validQuantity, MIN_QUANTITY, MAX_QUANTITY } from './core.js';
// Keep in sync with the inline copy in macro-dom.js (that function is serialized into pages and cannot import).
export const PAYMENT = /결제|구매\s*확정|예약\s*확정|pay\s*now|confirm\s*purchase|checkout/i;
export function pageKey(raw) { const url = new URL(raw); return url.origin + url.pathname; }
export function validateRecipe(raw) {
  const team = teamById(raw?.teamId);
  if (!team || !Array.isArray(raw.steps) || raw.steps.length > 30) throw new Error('구단과 매크로 동작(최대 30개)을 확인하세요.');
  const quantity = Number(raw.quantity ?? 2);
  if (!validQuantity(quantity)) throw new Error(`인원은 ${MIN_QUANTITY}~${MAX_QUANTITY}명으로 입력하세요. 예매처 구매 한도 내에서 사용하세요.`);
  const steps = raw.steps.map(step => {
    if (!step || typeof step !== 'object' || !['click', 'select', 'seats'].includes(step.kind) || !allowedUrl(step.page, team)) throw new Error('지원하지 않는 동작 또는 예매처입니다.');
    if (typeof step.selector !== 'string' || !step.selector || step.selector.length > 2000) throw new Error('화면 대상을 다시 지정하세요.');
    const timeout = Number(step.timeout ?? 30);
    if (!Number.isInteger(timeout) || timeout < 3 || timeout > 120) throw new Error('동작 대기 시간은 3~120초입니다.');
    const text = String(step.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    // A click target without a label cannot be checked against payment wording or re-identified safely.
    if (step.kind === 'click' && !text) throw new Error('글자가 없는 버튼은 클릭 동작으로 저장하지 않습니다. 글자가 있는 버튼을 지정하세요.');
    if (PAYMENT.test(text)) throw new Error('결제·구매 확정 버튼은 매크로에 넣지 않습니다.');
    return { kind: step.kind, page: pageKey(step.page), selector: step.selector, text, tag: String(step.tag || '').slice(0, 20), value: String(step.value || '').slice(0, 100), timeout };
  });
  const c = raw.cancellation || {};
  const interval = Number(c.interval ?? 10), minutes = Number(c.minutes ?? 30), mode = c.mode ?? 'select';
  if (!Number.isInteger(interval) || interval < 5 || interval > 120) throw Error('확인 간격은 5~120초입니다.');
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) throw Error('대기 시간은 1~120분입니다.');
  if (!['select', 'notify'].includes(mode)) throw Error('발견 시 동작을 확인하세요.');
  let refresh = null;
  if (c.refresh) {
    if (c.refresh.kind !== 'click') throw Error('갱신은 클릭 버튼만 지정하세요.');
    refresh = validateRecipe({ teamId: team.id, steps: [c.refresh] }).steps[0];
  }
  return { teamId: team.id, quantity, adjacent: raw.adjacent !== false, steps, cancellation: { enabled: c.enabled === true, interval, minutes, mode, refresh } };
}
