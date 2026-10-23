// Payment-step blocker of macroPageStep, exercised with a minimal fake DOM (no browser needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { macroPageStep } from '../src/macro-dom.js';

const page = 'https://www.ticketlink.co.kr/test';
function node(tagName, { text = '', attrs = {}, value, imgs = [], hidden = false } = {}) {
  const el = {
    tagName: tagName.toUpperCase(), innerText: text, value, disabled: false, className: '', dataset: {}, clicked: 0,
    getClientRects: () => (hidden ? [] : [1]),
    getAttribute: name => attrs[name] ?? null,
    hasAttribute: name => name in attrs,
    querySelectorAll: sel => (sel === 'img[alt]' ? imgs : []),
    click() { el.clicked++; },
  };
  return el;
}
const img = alt => node('img', { attrs: { alt } });
function render(controls, target) {
  globalThis.getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
  globalThis.location = { origin: 'https://www.ticketlink.co.kr', pathname: '/test' };
  globalThis.HTMLSelectElement = class {};
  globalThis.document = {
    body: { innerText: '' },
    querySelectorAll: sel => {
      if (sel === '#reserve') return [target];
      if (sel.includes('password')) return [];
      return controls;
    },
  };
}
const step = { kind: 'click', page, selector: '#reserve', text: '예매하기', tag: 'button' };
const run = () => macroPageStep(step, 2, true, true);

test('결제 화면이 아니면 지정한 버튼을 실행한다 (대조군)', () => {
  const target = node('button', { text: '예매하기' });
  render([target, node('a', { text: '공지사항' })], target);
  assert.equal(run().status, 'done'); assert.equal(target.clicked, 1);
});
const cases = [
  ['input[type=submit] value', node('input', { value: '결제하기', attrs: { type: 'submit' } })],
  ['input[type=button] value', node('input', { value: '카드 결제', attrs: { type: 'button' } })],
  ['input[type=image] alt', node('input', { attrs: { type: 'image', alt: '결제 진행' } })],
  ['버튼 안의 이미지 alt', node('a', { imgs: [img('결제하기')] })],
  ['단독 이미지 alt', img('간편결제')],
  ['부분 일치 문구', node('button', { text: '다음 단계: 결제수단 선택' })],
  ['비활성 결제 버튼도 정지', Object.assign(node('button', { text: '결제하기', attrs: { disabled: '' } }), { disabled: true })],
  ['영문 checkout', node('button', { text: 'Proceed to Checkout' })],
];
for (const [name, control] of cases) {
  test(`결제 컨트롤 감지 시 실행하지 않고 멈춘다: ${name}`, () => {
    const target = node('button', { text: '예매하기' });
    render([target, control], target);
    const result = run();
    assert.equal(result.status, 'blocked'); assert.match(result.message, /결제/);
    assert.equal(target.clicked, 0);
  });
}
test('보이지 않는 결제 컨트롤은 무시한다', () => {
  const target = node('button', { text: '예매하기' });
  render([target, node('button', { text: '결제하기', hidden: true })], target);
  assert.equal(run().status, 'done');
});
