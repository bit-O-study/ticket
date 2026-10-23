import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { macroPageStep } from '../src/macro-dom.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
const context = await browser.newContext();
await context.route(/^https?:\/\//, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<html><body></body></html>' }));
const page = await context.newPage();
const url = 'https://www.ticketlink.co.kr/test';
const step = { kind: 'seats', page: url, selector: '.seat', text: '좌석', tag: 'button' };
async function setup(seats) {
  await page.goto(url);
  await page.setContent('<div id="seats">' + seats.map(s => `<button class="seat" data-row="${s.row || 1}" data-section="A" data-seat-number="${s.n}" data-seat-status="${s.s || 'available'}" ${s.disabled ? 'disabled' : ''} onclick="this.dataset.clicked=\'yes\'">${s.n}</button>`).join('') + '</div>');
  await page.addScriptTag({ content: macroPageStep.toString() });
}
const run = (quantity, adjacent=true) => page.evaluate(({step,quantity,adjacent}) => macroPageStep(step,quantity,adjacent,true), {step,quantity,adjacent});
try {
  await setup([{n:1},{n:2},{n:3,s:'sold'},{n:4}]);assert.equal((await run(3)).status,'waiting');assert.equal(await page.locator('[data-clicked]').count(),0);console.log('PASS insufficient adjacent seats are never partially clicked');
  await setup([{n:1,disabled:true},{n:2},{n:3,s:'sold'},{n:4}]);assert.equal((await run(2)).status,'waiting');assert.equal(await page.locator('[data-clicked]').count(),0);console.log('PASS disabled/sold seats are excluded');
  await setup([{n:1},{n:2},{n:3,s:'sold'},{n:4}]);assert.equal((await run(2)).status,'done');assert.deepEqual(await page.locator('[data-clicked]').evaluateAll(es=>es.map(e=>e.dataset.seatNumber)),['1','2']);console.log('PASS adjacent pair is selected');
  await setup([{n:1,row:'A'},{n:2,row:'B'}]);assert.equal((await run(2)).status,'waiting');assert.equal(await page.locator('[data-clicked]').count(),0);console.log('PASS different rows are not treated as adjacent');
  await setup([{n:1},{n:3}]);assert.equal((await run(2,false)).status,'done');assert.equal(await page.locator('[data-clicked]').count(),2);console.log('PASS non-adjacent mode is explicit');
  await setup([{n:1,s:'sold'},{n:2,s:'sold'}]);assert.equal((await run(2)).status,'waiting');
  await page.locator('.seat').evaluateAll(es=>es.forEach(e=>e.dataset.seatStatus='available'));
  assert.equal((await run(2)).status,'done');assert.equal(await page.locator('[data-clicked]').count(),2);console.log('PASS returned seats become selectable after availability changes');
  await setup([{n:1,s:'sold',disabled:true},{n:2,s:'sold'}]);
  await page.evaluate(()=>{
    document.querySelector('.seat').classList.add('sold');
    window.chrome={runtime:{sendMessage:async m=>{window.picked=m;},onMessage:{addListener:f=>window.pickListener=f}}};
  });
  await page.addScriptTag({content:await readFile(new URL('../src/macro-picker.js',import.meta.url),'utf8')});
  await page.evaluate(()=>window.pickListener({type:'MACRO_PICK',id:'test',kind:'seats'},null,()=>{}));
  const box=await page.locator('.seat').first().boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
  const picked=await page.evaluate(()=>window.picked);assert.equal(picked.type,'MACRO_PICKED');assert.equal(picked.step.selector.includes('.sold'),false);assert.equal(await page.locator('[data-clicked]').count(),0);console.log('PASS sold disabled seat can be picked without clicking or binding sold state');
} finally { await browser.close(); }
