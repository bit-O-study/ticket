import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRecipe } from '../src/macro-core.js';
import { registerMacroEngine } from '../src/macro-engine.js';
const url = 'https://www.ticketlink.co.kr/test';
const seat = { kind:'seats', page:url, selector:'.seat', timeout:3 };
const refresh = { kind:'click', page:url, selector:'#refresh', text:'좌석 새로고침', timeout:3 };
const base = { teamId:'lg', quantity:2, steps:[seat], cancellation:{enabled:true, interval:5, minutes:1} };
test('취소표 설정 범위, 갱신 버튼과 기존 설정 호환', () => {
  assert.equal(validateRecipe({teamId:'lg',steps:[]}).cancellation.enabled,false);
  for (const value of [{interval:0},{interval:121},{minutes:0},{minutes:121},{mode:'buy'},{refresh:{...refresh,text:'결제'}}]) assert.throws(()=>validateRecipe({...base,cancellation:{...base.cancellation,...value}}));
  const recipe=validateRecipe({...base,cancellation:{...base.cancellation,refresh:{...refresh,page:url+'?secret=x'}}});
  assert.equal(recipe.cancellation.refresh.page,url);
});
let listener, store={}, available=false, clicks=0, refreshes=0, notices=0, probes=0, releaseOnRefresh=false;
const event={addListener(){}};
globalThis.chrome={
 runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:f=>listener=f},onStartup:event,onInstalled:event},
 storage:{local:{get:async key=>({[key]:structuredClone(store[key])}),set:async values=>{Object.assign(store,structuredClone(values));}}},
 tabs:{get:async()=>({id:1,url}),sendMessage:async()=>{},onCreated:event},
 webNavigation:{getAllFrames:async()=>[{frameId:0,url}]},
 scripting:{executeScript:async({args})=>{const [step,,,execute]=args; if(step.kind==='click'){if(execute){refreshes++;if(releaseOnRefresh)available=true;}return [{result:{status:execute?'done':'ready'}}];} probes++; if(!available)return [{result:{status:'waiting'}}]; if(execute)clicks++;return [{result:{status:execute?'done':'ready'}}];}},
 notifications:{create:async()=>{notices++;}}, alarms:{clear:async()=>{},create:async()=>{},onAlarm:event}
};
registerMacroEngine();
const send=message=>new Promise(resolve=>listener(message,{id:'test',url:'chrome-extension://test/macro.html'},resolve));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate){const deadline=Date.now()+9000;while(!predicate()){if(Date.now()>deadline)throw Error('Timed out');await delay(20);}}
async function start(c={}){await delay(600);store={macroRecipes:{lg:validateRecipe({...base,cancellation:{...base.cancellation,...c}})}};available=false;clicks=refreshes=notices=probes=0;releaseOnRefresh=false;assert.equal((await send({type:'MACRO_RUN',teamId:'lg',tabId:1})).ok,true);}
test('취소표 실행: 반환 좌석 선택, 알림만, 중지, 시간 만료',async t=>{
 await t.test('갱신 뒤 반환된 좌석을 한 번 선택',async()=>{await start({refresh});releaseOnRefresh=true;await until(()=>store.macroJob.state==='done');assert.equal(refreshes,1);assert.equal(clicks,1);assert.equal(notices,1);});
 await t.test('알림 모드는 좌석을 클릭하지 않음',async()=>{await start({mode:'notify'});available=true;await until(()=>store.macroJob.state==='paused');assert.equal(clicks,0);assert.equal(notices,1);});
 await t.test('대기 중 중지는 이후 갱신과 클릭을 차단',async()=>{await start({refresh});await until(()=>probes>0);await send({type:'MACRO_PAUSE'});available=true;await delay(700);assert.equal(store.macroJob.state,'paused');assert.equal(refreshes,0);assert.equal(clicks,0);});
 await t.test('최대 대기 시간 이후 중지 (가짜 시계)',async st=>{await start();await until(()=>probes>0);st.mock.timers.enable({apis:['Date'],now:Date.now()});st.mock.timers.tick(61000);await until(()=>store.macroJob.state==='paused');assert.match(store.macroJob.message,/대기 시간이/);assert.equal(clicks,0);});
});
