'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
function harness(){
  const elements=new Map(), sockets=[];
  function el(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',checked:false,style:{},classList:{add(){},remove(){},toggle(){}},appendChild(){}});return elements.get(id);}
  const store=new Map(); const localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
  class WS{constructor(){this.readyState=0;this.sent=[];sockets.push(this)}send(s){this.sent.push(JSON.parse(s))}open(){this.readyState=1;this.onopen()}message(d){this.onmessage({data:JSON.stringify(d)})}close(){this.readyState=3;this.onclose?.({code:1000,reason:''})}}
  const ctx=vm.createContext({console,URL,WebSocket:WS,localStorage,document:{getElementById:el,createElement:()=>({}),addEventListener(){}},window:{confirm:()=>true},setTimeout(){},clearTimeout(){}});
  vm.runInContext(source,ctx); const run=s=>vm.runInContext(s,ctx);
  run("onTick=()=>{}; SYMBOLS.forEach(s=>{S.ticks[s.sym]=[];S.candles[s.sym]=[]})");
  for(const [id,v] of Object.entries({contractType:'DIGITEVEN',barrier:'5',stake:'1',duration:'5'}))el(id).value=v;
  return {run,el,sockets};
}
for(const kind of ['new','legacy']){
  const h=harness();
  if(kind==='new') h.run("openNewDerivWS('wss://api.derivws.com/ws?otp=demo',{account_id:'VRTC1',account_type:'demo',currency:'USD',balance:1000})");
  else h.run("tryConnect('token')");
  const ws=h.sockets[0];ws.open();
  if(kind==='legacy')ws.message({req_id:3,authorize:{loginid:'VRTC1',is_virtual:1,currency:'USD',balance:1000}});
  const discovery=ws.sent.filter(x=>x.active_symbols && x.req_id!==2).at(-1);
  assert.ok(discovery,`${kind}: discovery must be requested`);
  assert.equal(ws.sent.filter(x=>x.ticks).length,0);
  h.run('buyContract()'); assert.equal(ws.sent.filter(x=>x.proposal).length,0,'block unverified market');
  ws.message({req_id:discovery.req_id,active_symbols:[{symbol:'R_50'},{symbol:'R_75'},{symbol:'CRASH500',is_trading_suspended:1},{symbol:'NOT_CONFIGURED'},{symbol:'__proto__'},{symbol:'<img>'}]});
  assert.deepEqual(ws.sent.filter(x=>x.ticks).map(x=>x.ticks),['R_75','R_50']);
  assert.equal(h.run('S.activeMarkets.length'),3);
  assert.equal(h.run("S.activeMarkets.includes('__proto__')"),false);
  assert.equal(h.run("S.activeMarkets.includes('<img>')"),false);
  assert.equal(ws.sent.filter(x=>x.ticks==='NOT_CONFIGURED').length,0,'new markets must be lazy subscribed');
  h.run("subscribeLiveSymbol('NOT_CONFIGURED'); subscribeLiveSymbol('NOT_CONFIGURED')");
  assert.equal(ws.sent.filter(x=>x.ticks==='NOT_CONFIGURED').length,1,'on-demand subscription must not duplicate');
  assert.equal(h.el('autoSymbol').value,'R_75');
  ws.message({req_id:discovery.req_id,active_symbols:[{symbol:'R_10'}]});
  assert.equal(ws.sent.filter(x=>x.ticks).length,3,'ignore duplicate discovery');
  const r75=ws.sent.find(x=>x.ticks==='R_75');
  h.run('buyContract()');const quote=ws.sent.find(x=>x.proposal);assert.ok(quote);
  ws.message({req_id:r75.req_id,error:{message:'Invalid symbol'}});
  assert.equal(h.run("S.activeMarkets.includes('R_75')"),false);
  assert.equal(h.run('S.manualOrder'),null,'failed subscription cancels pending quote');
  assert.equal(h.run('S.selected'),'R_50');
  ws.message({req_id:quote.req_id,proposal:{id:'stale',ask_price:1,payout:1.9}});
  assert.equal(ws.sent.filter(x=>x.buy).length,0,'stale quote cannot cause buy');
}
{
 const h=harness();h.run("openNewDerivWS('wss://api.derivws.com/ws?otp=demo',{account_id:'VRTC1',account_type:'demo',currency:'USD',balance:1000})");const ws=h.sockets[0];ws.open();const req=ws.sent.find(x=>x.active_symbols).req_id;
 ws.message({req_id:req,error:{message:'unavailable'}});assert.equal(h.run('S.activeMarkets.length'),0);h.run('buyContract()');assert.equal(ws.sent.filter(x=>x.proposal).length,0);
}
console.log('Live market discovery and unavailable-symbol handling checks passed');
