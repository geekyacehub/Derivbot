'use strict';
// Mock-transport integration tests exercise the actual socket event handlers.
// They do not connect to Deriv and cannot establish API compatibility.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app.js', 'utf8').replace('const REAL_DATA_ONLY=true;', 'const REAL_DATA_ONLY=false;');
function harness(store=new Map()){
  const elements=new Map(), sockets=[];
  function el(id){
    if(!elements.has(id)) elements.set(id,{value:'',textContent:'',innerHTML:'',checked:false,style:{},classList:{add(){},remove(){}},appendChild(){}});
    return elements.get(id);
  }
  const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
  class FakeWebSocket {
    constructor(url){this.url=url;this.readyState=0;this.sent=[];sockets.push(this);}
    send(msg){if(this.readyState!==1) throw Error('closed');this.sent.push(JSON.parse(msg));}
    open(){this.readyState=1;this.onopen?.();}
    message(msg){this.onmessage?.({data:JSON.stringify(msg)});}
    close(){this.readyState=3;this.onclose?.({code:1000,reason:''});}
  }
  const ctx=vm.createContext({console,URL,WebSocket:FakeWebSocket,localStorage,document:{getElementById:el,createElement(){return el('created')},addEventListener(){}},window:{confirm:()=>true},setTimeout(){return 1},clearTimeout(){}});
  vm.runInContext(source,ctx);
  const run=code=>vm.runInContext(code,ctx);
  // Rendering is not under test; keep the real transport and order handlers.
  run('onTick=()=>{}; initMock()');
  const controls={autoStake:'1',autoMaxTrades:'3',autoTP:'10',autoSL:'10',autoConf:'0',autoRecovery:'none',autoStrategy:'even_odd',autoSymbol:'R_75'};
  for(const [id,value] of Object.entries(controls)) el(id).value=value;
  return {ctx,run,el,sockets,store};
}
function authenticateLegacy(h,isVirtual=1){
  h.run("tryConnect('demo-token')");
  const ws=h.sockets.at(-1); ws.open();
  assert.ok(ws.sent.some(r=>r.authorize==='demo-token' && r.req_id===3));
  ws.message({req_id:3,authorize:{loginid:isVirtual?'VRTC123':'CR123',is_virtual:isVirtual,balance:10000,currency:'USD'}});
  return ws;
}
function feed(ws){for(let i=0;i<100;i++) ws.message({tick:{symbol:'R_75',quote:100+(i%10)/100,pip_size:2}});}
{
  const h=harness(), ws=authenticateLegacy(h);
  assert.equal(h.run('S.connected'),true);
  assert.equal(h.run('S.feed'),'deriv');
  assert.equal(ws.sent.filter(r=>r.ticks).length,h.run('SYMBOLS.length'));
  ws.message({req_id:3,authorize:{loginid:'VRTC123',is_virtual:1,balance:10000,currency:'USD'}});
  assert.equal(ws.sent.filter(r=>r.ticks).length,h.run('SYMBOLS.length'),'duplicate authorization must not resubscribe');
  feed(ws);
  h.run('startAutoTrader(); autoTick()');
  const proposal=ws.sent.at(-1);
  assert.equal(proposal.proposal,1);
  ws.message({req_id:proposal.req_id,proposal:{id:'proposal-a',ask_price:1,payout:1.95}});
  const buy=ws.sent.at(-1); assert.equal(buy.buy,'proposal-a');
  ws.message({req_id:buy.req_id,buy:{contract_id:456}});
  assert.equal(h.run('S.auto.trades'),1);
  assert.equal(ws.sent.at(-1).proposal_open_contract,1);
  ws.message({proposal_open_contract:{contract_id:456,is_sold:1,profit:.95},subscription:{id:'subscription-a'}});
  assert.equal(h.run('S.auto.wins'),1);
  assert.equal(h.run('S.accountContracts[0].status'),'SETTLED');
  assert.equal(ws.sent.at(-1).forget,'subscription-a');
  ws.close();
  assert.equal(h.run('S.auto.running'),false);
  assert.equal(h.run('S.feed'),'simulation');
  const sentAfterClose=ws.sent.length;
  ws.message({req_id:3,authorize:{loginid:'VRTC123',is_virtual:1,balance:10000,currency:'USD'}});
  assert.equal(ws.sent.length,sentAfterClose,'closed sockets must not be able to reauthorize');
  assert.equal(h.run('S.connected'),false);
}
{
  const h=harness(), ws=authenticateLegacy(h); feed(ws);
  h.run('startAutoTrader(); autoTick()'); const proposal=ws.sent.at(-1);
  ws.message({req_id:proposal.req_id,proposal:{id:'proposal-b',ask_price:1,payout:1.95}});
  assert.equal(ws.sent.at(-1).buy,'proposal-b');
  ws.close();
  assert.equal(h.run('S.auto.running'),false);
  assert.ok(h.run('S.uncertainOrder'));
  const reloaded=harness(h.store);
  assert.ok(reloaded.run('S.uncertainOrder'),'unknown purchase must survive reload');
  const newWs=authenticateLegacy(reloaded); feed(newWs);
  reloaded.run('startAutoTrader()');
  assert.equal(reloaded.run('S.auto.running'),false,'unknown order must block a restarted bot');
}
{
  const h=harness();
  h.run("openNewDerivWS('wss://api.derivws.com/trading/v1/options/ws/demo?otp=test',{account_id:'VRTC999',account_type:'demo',balance:5000,currency:'USD'})");
  const ws=h.sockets.at(-1);ws.open();
  assert.equal(h.run('S.connected'),true);
  assert.equal(h.run('S.isDemo'),true);
  feed(ws);h.run('startAutoTrader(); autoTick()');
  const proposal=ws.sent.at(-1);
  ws.message({req_id:proposal.req_id,error:{message:'Rejected'}});
  assert.equal(h.run('S.auto.running'),false,'proposal errors must stop the bot');
  assert.equal(h.run('S.uncertainOrder'),null);
}
{
  const h=harness(), ws=authenticateLegacy(h,0);feed(ws);
  h.run('startAutoTrader()');
  assert.equal(h.run('S.auto.running'),false,'real accounts must not start automated bot orders');
  assert.equal(h.run("isTrustedDerivSocketURL('wss://api.derivws.com/path?otp=x')"),true);
  assert.equal(h.run("isTrustedDerivSocketURL('wss://derivws.com.evil.example/path')"),false);
  assert.equal(h.run("isTrustedDerivSocketURL('ws://api.derivws.com/path')"),false);
  assert.equal(h.run("isTrustedDerivSocketURL('wss://user:pass@api.derivws.com/path')"),false);
  assert.throws(()=>h.run("openNewDerivWS('wss://evil.example/path',{account_type:'demo'})"),/Untrusted/);
  assert.equal(ws.readyState,1,'rejecting an untrusted URL must not close the current socket');
}
console.log('Mock WebSocket integration checks passed');
// REST responses can arrive after disconnect. They must not initiate an OTP or socket.
(async()=>{
  const h=harness(); h.el('appIdInput').value='1089'; h.el('tokenInput').value='demo-token';
  let resolveAccountJSON, fetchCalls=0, jsonStarted;
  const jsonStartedPromise=new Promise(resolve=>{jsonStarted=resolve});
  h.ctx.fetch=async()=>{fetchCalls++;return {ok:true,json:()=>{jsonStarted();return new Promise(resolve=>{resolveAccountJSON=resolve})}}};
  const connecting=h.run('connectDeriv()');
  await jsonStartedPromise;
  h.run('disconnectDeriv()');
  resolveAccountJSON({data:[{account_id:'VRTC111',account_type:'demo',is_virtual:1}]});
  await connecting;
  assert.equal(fetchCalls,1,'a cancelled account lookup must not request an OTP');
  assert.equal(h.sockets.length,0);
  const h2=harness();h2.el('appIdInput').value='1089';h2.el('tokenInput').value='demo-token';
  let otpCalls=0;
  h2.ctx.fetch=async url=>{if(url.includes('/otp')) otpCalls++;return {ok:true,json:async()=>({data:[{account_id:'CR1',account_type:'demo',is_virtual:0}]})}};
  await h2.run('connectDeriv()');
  assert.equal(otpCalls,0,'conflicting account metadata must not select an account');
  assert.equal(h2.sockets.length,0);
  const h3=harness();h3.el('appIdInput').value='1089';h3.el('tokenInput').value='demo-token';
  let resolveOtp, otpJSONStarted;
  const otpStarted=new Promise(resolve=>{otpJSONStarted=resolve});
  h3.ctx.fetch=async url=>url.includes('/otp')
    ? {ok:true,json:()=>{otpJSONStarted();return new Promise(resolve=>{resolveOtp=resolve})}}
    : {ok:true,json:async()=>({data:[{account_id:'VRTC222',account_type:'demo',is_virtual:1}]})};
  const pending=h3.run('connectDeriv()');
  await otpStarted;
  h3.run('disconnectDeriv()');
  resolveOtp({url:'wss://api.derivws.com/trading/v1/options/ws/demo?otp=test'});
  await pending;
  assert.equal(h3.sockets.length,0,'cancelled OTP responses must not open a socket');
  const h4=harness();h4.el('appIdInput').value='1089';h4.el('tokenInput').value='demo-token';
  let release, calls=0;
  h4.ctx.fetch=()=>{calls++;return new Promise(resolve=>{release=resolve})};
  const first=h4.run('connectDeriv()');
  await h4.run('connectDeriv()');
  assert.equal(calls,1,'overlapping attempts must be rejected');
  assert.equal(h4.el('connectBtn').disabled,true);
  h4.run('disconnectDeriv()');
  assert.equal(h4.el('connectBtn').disabled,false);
  release({ok:false,status:503});await first;
  assert.equal(h4.sockets.length,0,'cancelled connection must not open fallback');
  console.log('Async connection cancellation checks passed');
})().catch(err=>{console.error(err);process.exitCode=1});
