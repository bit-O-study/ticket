import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'first-pitch-macro-'));
const context = await chromium.launchPersistentContext(profile, { channel: process.env.PW_CHANNEL || 'chromium', headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`] });
const base = 'https://www.ticketlink.co.kr';
const fixture = `<html lang="ko"><head><meta charset="utf-8"></head><body><script>window.events=[];function record(x){events.push(x)}function finish(){record('finish');const b=document.createElement('button');b.id='pay';b.textContent='결제하기';b.onclick=()=>record('payment');document.body.append(b)}</script><button id="reserve" onclick="record('reserve')">예매하기</button><button id="section" onclick="record('section')">1루 내야</button><select id="count" onchange="record('count:'+this.value)"><option value="1">1명</option><option value="2">2명</option><option value="3">3명</option></select><div id="seats">${[1,2,3,4].map(n => `<button class="seat" data-section="A" data-row="1" data-seat-number="${n}" data-seat-status="${n===3?'sold':'available'}" onclick="this.classList.add('selected');record('seat:${n}')" title="A구역 1열 ${n}번">${n}</button>`).join('')}</div><button id="finish" onclick="finish()">좌석 선택 완료</button></body></html>`;
const fixtures = new Map([['/test', fixture], ['/popup-root', '<button id="open" onclick="window.open(\'/popup\')">예매하기</button>'], ['/popup', '<iframe src="/seat-frame"></iframe>'], ['/seat-frame', '<button id="frame-next" onclick="document.body.dataset.done=\'yes\'">구역 선택</button>']]);
await context.route(/^https?:\/\//, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixtures.get(new URL(route.request().url()).pathname) || '<h1>Offline test page</h1>' }));
let worker;
try { worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout:10000}); }
catch(error) {
 const debug=await context.newPage();await debug.goto('chrome://extensions');
 const info=await debug.evaluate(()=>new Promise(resolve=>chrome.developerPrivate.getExtensionsInfo({includeDisabled:true,includeTerminated:true},resolve)));
 console.error(JSON.stringify(info.map(e=>({id:e.id,name:e.name,state:e.state,manifestErrors:e.manifestErrors,runtimeErrors:e.runtimeErrors}))));
 await context.close();throw error;
}
const extensionId = new URL(worker.url()).host;
const ui = await context.newPage(); await ui.goto(`chrome-extension://${extensionId}/macro.html`);
const request = msg => ui.evaluate(msg => chrome.runtime.sendMessage(msg), msg);
const job = () => worker.evaluate(async () => (await chrome.storage.local.get('macroJob')).macroJob);
const until = async (fn, label) => { for (let i=0;i<160;i++) { if (await fn()) return; await new Promise(r=>setTimeout(r,100)); } throw Error('Timeout: '+label); };
const report = text => console.log('PASS '+text);
const tabId = async p => (await request({ type:'MACRO_TABS',teamId:'lg' })).tabs.find(t=>t.url===p.url()).id;
const save = async steps => { const result=await request({type:'MACRO_SAVE',recipe:{teamId:'lg',quantity:2,adjacent:true,steps}});assert.equal(result.ok,true,result.error); };
const step = (url, selector, text, kind='click') => ({kind,page:base+url,selector,text,tag:'button',timeout:3});
try {
  const page = await context.newPage(); await page.goto(base+'/test'); const id=await tabId(page);
  for (const [kind,selector] of [['click','#reserve'],['click','#section'],['select','#count'],['seats','.seat'],['click','#finish']]) {
    const response=await request({type:'MACRO_PICK_START',teamId:'lg',tabId:id,kind});assert.equal(response.ok,true,response.error);
    const old=await worker.evaluate(async()=>((await chrome.storage.local.get('macroRecipes')).macroRecipes?.lg?.steps||[]).length);
    await page.locator(selector).first().click();
    await until(async()=>await worker.evaluate(async()=>((await chrome.storage.local.get('macroRecipes')).macroRecipes?.lg?.steps||[]).length)===old+1,'picked '+kind);
  }
  assert.deepEqual(await page.evaluate(()=>window.events),[]); report('click/select/seat target picking never executes the target');
  await ui.getByRole('button',{name:'열린 탭 다시 찾기'}).click(); await ui.locator('#macro-tab').selectOption(String(id));
  await ui.getByRole('button',{name:'매크로 실행 ▶'}).click();
  await until(async()=>['done','paused'].includes((await job())?.state),'five step macro');
  assert.equal((await job()).state,'done',(await job()).message);
  assert.deepEqual(await page.evaluate(()=>window.events),['reserve','section','count:2','seat:1','seat:2','finish']);
  assert.equal(await page.locator('#pay').count(),1); report('game → section → quantity → adjacent available seats → stop before payment');
  for(const width of [320,390,768,1280]) {await ui.setViewportSize({width,height:1000});assert.ok(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}report('macro editor fits 4 screen widths');
  await page.goto(base+'/test'); await page.evaluate(()=>document.body.insertAdjacentHTML('afterbegin','<input type="password">'));
  await save([step('/test','#reserve','예매하기')]); assert.equal((await request({type:'MACRO_RUN',teamId:'lg',tabId:id})).ok,true);
  await until(async()=>(await job())?.state==='paused','auth pause');assert.deepEqual(await page.evaluate(()=>window.events),[]);
  await page.locator('input').evaluate(e=>e.remove());await new Promise(r=>setTimeout(r,100));
  assert.equal((await request({type:'MACRO_RESUME'})).ok,true);
  await until(async()=>(await job())?.state==='done','auth resume');assert.deepEqual(await page.evaluate(()=>window.events),['reserve']);report('authentication pause and explicit resume');
  await page.goto(base+'/test');await save([step('/test','#missing','아직 없는 버튼')]);await request({type:'MACRO_RUN',teamId:'lg',tabId:id});
  await until(async()=>(await job())?.state==='running','wait running');await request({type:'MACRO_PAUSE'});await new Promise(r=>setTimeout(r,800));
  assert.equal((await job()).state,'paused');assert.deepEqual(await page.evaluate(()=>window.events),[]);report('stop interrupts a pending step');
  await save([step('/test','#missing','아직 없는 버튼')]);await request({type:'MACRO_RUN',teamId:'lg',tabId:id});await until(async()=>(await job())?.state==='paused','timeout');
  assert.match((await job()).message,/3초/);report('bounded waiting pauses on timeout');
  const popupRoot=await context.newPage();await popupRoot.goto(base+'/popup-root');const popupId=await tabId(popupRoot);
  await save([step('/popup-root','#open','예매하기'),step('/seat-frame','#frame-next','구역 선택')]);
  await request({type:'MACRO_RUN',teamId:'lg',tabId:popupId});await until(async()=>['done','paused'].includes((await job())?.state),'popup and frame');
  assert.equal((await job()).state,'done',(await job()).message);
  const popup=context.pages().find(p=>p.url()===base+'/popup');assert.ok(popup);
  assert.equal(await popup.frameLocator('iframe').locator('body').getAttribute('data-done'),'yes');report('booking popup and nested frame continue the same macro');
  await page.goto(base+'/test');await page.evaluate(()=>document.body.insertAdjacentHTML('afterbegin','<button>결제하기</button>'));
  await save([step('/test','#reserve','예매하기')]);await request({type:'MACRO_RUN',teamId:'lg',tabId:id});await until(async()=>(await job())?.state==='paused','payment barrier');
  assert.deepEqual(await page.evaluate(()=>window.events),[]);report('payment screen cannot be auto-submitted');
  await page.goto(base+'/test');
  assert.equal((await request({type:'MACRO_SAVE',recipe:{teamId:'lg',quantity:3,adjacent:true,steps:[step('/test','#seats > button.seat','좌석','seats')]}})).ok,true);
  await request({type:'MACRO_RUN',teamId:'lg',tabId:id});await until(async()=>(await job())?.state==='paused','not enough adjacent seats');
  assert.deepEqual(await page.evaluate(()=>window.events),[]);report('insufficient adjacent seats cause no partial selection');
  await save([step('/test','#reserve','예매하기')]);
  const startAt=new Date(Date.now()+9*3600000+4500).toISOString().slice(0,19);
  const scheduled=await request({type:'MACRO_RUN',teamId:'lg',tabId:id,startAt});assert.equal(scheduled.ok,true,scheduled.error);
  assert.equal((await job()).state,'waiting');assert.deepEqual(await page.evaluate(()=>window.events),[]);
  await until(async()=>(await job())?.state==='done','scheduled macro');assert.deepEqual(await page.evaluate(()=>window.events),['reserve']);
  report('Chrome alarm starts the macro at the requested time');
  await ui.reload();await ui.waitForSelector('#macro-steps li');assert.equal(await ui.locator('#macro-steps li').count(),1);report('saved macro survives editor reload');
  await fs.mkdir(path.join(root,'test-results'),{recursive:true});await ui.screenshot({path:path.join(root,'test-results/macro.png'),fullPage:true});
} catch(error) {console.error(JSON.stringify(await job()));throw error;}
finally {await context.close();if(path.dirname(path.resolve(profile))!==path.resolve(os.tmpdir())||!path.basename(profile).startsWith('first-pitch-macro-'))throw Error('Unexpected temp profile');await fs.rm(profile,{recursive:true,force:true});}
