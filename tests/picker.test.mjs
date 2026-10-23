// Pick mode must always end, even when messaging the extension fails; otherwise it swallows real user clicks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/macro-picker.js', import.meta.url), 'utf8');
function load({ sendThrows = false } = {}) {
  const handlers = {}, sent = [];
  let onMessage;
  const element = (tagName, text = '', parent = null) => {
    const el = { tagName: tagName.toUpperCase(), innerText: text, id: '', value: undefined, dataset: {}, classList: [], style: {}, textContent: '', parentElement: parent, children: [],
      getAttribute: () => null, closest(sel) { return sel.includes('button') && el.tagName === 'BUTTON' ? el : null; }, remove() { el.removed = true; } };
    if (parent) parent.children.push(el);
    return el;
  };
  const body = element('body');
  const document = { body, documentElement: { append() {} }, createElement: tag => element(tag), querySelectorAll: () => [] };
  const window = { addEventListener: (type, fn) => { handlers[type] = fn; } };
  const chrome = { runtime: {
    sendMessage(message) { if (sendThrows) throw new Error('Extension context invalidated.'); sent.push(message); return Promise.resolve({ ok: true }); },
    onMessage: { addListener: fn => { onMessage = fn; } },
  } };
  const context = { window, document, chrome, location: { origin: 'https://www.ticketlink.co.kr', pathname: '/test' }, CSS: { escape: s => s }, Date, globalThis: null };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  const event = target => { const e = { target, key: 'Escape', prevented: false, preventDefault() { e.prevented = true; }, stopImmediatePropagation() {} }; return e; };
  const startPick = kind => onMessage({ type: kind ? 'MACRO_PICK' : undefined, id: 'p1', kind }, null, () => {});
  const realClick = () => { const e = event(body); handlers.click(e); return e.prevented; };
  return { handlers, sent, body, element, event, startPick, realClick, onMessage };
}

test('대상을 지정하면 메시지를 보내기 전에 지정 모드를 끝낸다', () => {
  const p = load();
  p.startPick('click');
  const button = p.element('button', '예매하기', p.body);
  p.handlers.pointerdown(p.event(button));
  assert.equal(p.sent[0].type, 'MACRO_PICKED'); assert.equal(p.sent[0].step.text, '예매하기');
});
test('메시지 전송이 실패해도(확장 재시작) 지정 모드가 남지 않는다', () => {
  const p = load({ sendThrows: true });
  p.startPick('click');
  const button = p.element('button', '예매하기', p.body);
  assert.doesNotThrow(() => p.handlers.pointerdown(p.event(button)));
  // Later real clicks (after the 1.5 s suppression window) are no longer swallowed.
  const original = Date.now; Date.now = () => original() + 2000;
  try { assert.equal(p.realClick(), false); } finally { Date.now = original; }
});
test('Esc 취소 중 전송이 실패해도 지정 모드가 끝난다', () => {
  const p = load({ sendThrows: true });
  p.startPick('click');
  assert.equal(p.realClick(), true); // while picking, clicks are swallowed by design
  assert.doesNotThrow(() => p.handlers.keydown(p.event(p.body)));
  assert.equal(p.realClick(), false);
});
test('처리 중 예외가 나도 지정 모드가 끝난다', () => {
  const p = load();
  p.startPick('click');
  const broken = p.element('button', '예매하기', null); // no parent: selector() walk ends early
  broken.getAttribute = () => { throw new Error('boom'); };
  assert.throws(() => p.handlers.pointerdown(p.event(broken)));
  const original = Date.now; Date.now = () => original() + 2000;
  try { assert.equal(p.realClick(), false); } finally { Date.now = original; }
});
test('글자 없는 버튼은 지정하지 않고 다른 대상을 고르게 한다', () => {
  const p = load();
  p.startPick('click');
  const icon = p.element('button', '', p.body);
  p.handlers.pointerdown(p.event(icon));
  assert.equal(p.sent.length, 0);
  assert.equal(p.realClick(), true); // still picking: user chooses another target or presses Esc
});
test('MACRO_PICK_STOP 메시지로 지정 모드를 끝낸다', () => {
  const p = load();
  p.startPick('click');
  p.onMessage({ type: 'MACRO_PICK_STOP' }, null, () => {});
  const original = Date.now; Date.now = () => original() + 2000;
  try { assert.equal(p.realClick(), false); } finally { Date.now = original; }
});
test('type이 문자열이 아닌 메시지는 무시한다', () => {
  const p = load();
  for (const message of [null, undefined, {}, { type: 5 }]) assert.doesNotThrow(() => p.onMessage(message, null, () => {}));
});
