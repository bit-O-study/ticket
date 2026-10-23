import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRecipe, pageKey } from '../src/macro-core.js';
const step = { kind: 'click', page: 'https://www.ticketlink.co.kr/sports/137/59?session=private', selector: '#reserve', text: '예매하기', tag: 'button', timeout: 30 };
const recipe = { teamId: 'lg', quantity: 2, adjacent: true, steps: [step] };
test('매크로 저장은 쿼리·세션 값을 제외한다', () => {
  const result = validateRecipe(recipe); assert.equal(result.steps[0].page, 'https://www.ticketlink.co.kr/sports/137/59'); assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(pageKey('https://ticket.ssg.com/path?token=x#hash'), 'https://ticket.ssg.com/path');
});
test('허용된 예매처와 명시적인 DOM 동작만 실행한다', () => {
  for (const override of [{ kind: 'eval' }, { page: 'https://evil.test/' }, { selector: '' }, { timeout: 0 }, { timeout: 121 }]) assert.throws(() => validateRecipe({ ...recipe, steps: [{ ...step, ...override }] }));
});
test('결제 버튼과 과도한 인원·동작은 거절한다', () => {
  for (const text of ['결제하기', '구매 확정', 'Pay now', '예약 확정']) assert.throws(() => validateRecipe({ ...recipe, steps: [{ ...step, text }] }));
  for (const quantity of [0, 7, 1.5]) assert.throws(() => validateRecipe({ ...recipe, quantity }));
  assert.throws(() => validateRecipe({ ...recipe, steps: Array(31).fill(step) }));
});
test('인원 선택과 빈 좌석 선택은 구조화된 설정으로만 저장한다', () => {
  const result = validateRecipe({ ...recipe, steps: [{ ...step, kind: 'select', value: '{{quantity}}' }, { ...step, kind: 'seats', text: '1루 구역', extra: 'ignored' }] });
  assert.equal(result.steps[0].value, '{{quantity}}'); assert.equal(result.steps[1].extra, undefined);
});
test('글자가 없는 클릭 대상은 저장하지 않는다', () => {
  for (const text of ['', '   ', undefined]) assert.throws(() => validateRecipe({ ...recipe, steps: [{ ...step, text }] }), /글자가 없는/);
  assert.throws(() => validateRecipe({ ...recipe, cancellation: { refresh: { ...step, text: '' } } }), /글자가 없는/);
  // select/seats steps carry their own structured target and are unaffected.
  assert.ok(validateRecipe({ ...recipe, steps: [{ ...step, kind: 'select', text: '' }] }));
});
test('결제 문구는 부분 일치로도 거절한다', () => {
  for (const text of ['카드 결제 진행', '결제수단 선택 후 다음', 'Proceed to checkout']) assert.throws(() => validateRecipe({ ...recipe, steps: [{ ...step, text }] }));
});
