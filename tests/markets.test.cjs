'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
function harness(){
  const elements=new Map(), sockets=[];
  function el(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',checked:false,style:{},children:[],classList:{add(){},remove(){},toggle(){}},appendChild(node){this.children.push(node)}});return elements.get(id);}
  const store=new Map(); const localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
  class WS{constructor(){this.readyState=0;this.sent=[];sockets.push(this)}send(s){this.sent.push(JSON.parse(s))}open(){this.readyState=1;this.onopen()}message(d){this.onmessage({data:JSON.stringify(d)})}close(){this.readyState=3;this.onclose?.({code:1000,reason:''})}}
  const ctx=vm.createContext({console,URL,WebSocket:WS,localStorage,document:{getElementById:el,createElement:()=>({}),addEventListener(){}},window:{confirm:()=>true},setTimeout(){},clearTimeout(){}});
  vm.runInContext(source,ctx); const run=s=>vm.runInContext(s,ctx);
  run("onTick=()=>{}; SYMBOLS.forEach(s=>{S.ticks[s.sym]=[];S.candles[s.sym]=[]})");
  for(const [id,v] of Object.entries({contractType:'DIGITEVEN',barrier:'5',stake:'1',duration:'5'}))el(id).value=v;
  return {ctx,run,el,sockets};
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
// Current Deriv API schema returns underlying_symbol rather than symbol.
{
 const h=harness(); h.run("openNewDerivWS('wss://api.derivws.com/ws?otp=demo',{account_id:'VRTC1',account_type:'demo',currency:'USD',balance:1000})");
 const ws=h.sockets[0]; ws.open(); const req=ws.sent.find(x=>x.active_symbols).req_id;
 ws.message({req_id:req,active_symbols:[{underlying_symbol:'R_75',underlying_symbol_name:'Volatility 75 Index',is_trading_suspended:0},{underlying_symbol:'frxEURUSD',is_trading_suspended:0},{underlying_symbol:'R_50',is_trading_suspended:1},{underlying_symbol:'<script>',is_trading_suspended:0}]});
 assert.equal(h.run("S.activeMarkets.includes('R_75')"),true);
 assert.equal(h.run("S.activeMarkets.includes('frxEURUSD')"),true);
 assert.equal(h.run("S.activeMarkets.includes('R_50')"),false);
 assert.equal(h.run("S.activeMarkets.includes('<script>')"),false);
 assert.ok(ws.sent.some(x=>x.ticks==='R_75'));
 h.run("subscribeLiveSymbol('frxEURUSD')");
 assert.ok(ws.sent.some(x=>x.ticks==='frxEURUSD'));
}
// Recheck manual account guards after the user confirms the quote.
for(const change of [
  'S.balance=0.5',
  'S.risk.maxStakePct=0.05',
  "S.activeMarkets=[]",
  "S.currency='EUR'",
  'Date.now=()=>100000',
  "S.manualOrder={phase:'proposal',req:777,symbol:'R_50'}",
]){
 const h=harness();h.run("openNewDerivWS('wss://api.derivws.com/ws?otp=demo',{account_id:'VRTC1',account_type:'demo',currency:'USD',balance:1000})");
 const ws=h.sockets[0];ws.open();const req=ws.sent.find(x=>x.active_symbols).req_id;
 ws.message({req_id:req,active_symbols:[{underlying_symbol:'R_75'}]});
 h.run('Date.now=()=>1000; buyContract()');const quote=ws.sent.find(x=>x.proposal);
 h.ctx.window.confirm=()=>{h.run(change);return true;};
 ws.message({req_id:quote.req_id,proposal:{id:'p',ask_price:1,payout:1.9}});
 assert.equal(ws.sent.some(x=>x.buy),false,`no buy after ${change}`);
 assert.equal(h.run('S.uncertainOrder'),null);
 if(change.includes('S.manualOrder=')) assert.equal(h.run('S.manualOrder.req'),777,'must not clear a different order');
}
// Open positions come from a request-correlated Deriv portfolio snapshot.
for(const kind of ['new','legacy']){
 const h=harness();
 if(kind==='new')h.run("openNewDerivWS('wss://api.derivws.com/ws?otp=demo',{account_id:'VRTC1',account_type:'demo',currency:'USD',balance:1000})");
 else h.run("tryConnect('token')");
 const ws=h.sockets[0];ws.open();
 if(kind==='legacy')ws.message({req_id:3,authorize:{loginid:'VRTC1',is_virtual:1,currency:'USD',balance:1000}});
 const req=ws.sent.find(x=>x.portfolio===1);
 assert.ok(req,`${kind}: portfolio snapshot requested`);
 assert.equal(req.subscribe,undefined,'portfolio is a snapshot, not a fabricated live subscription');
 ws.message({req_id:req.req_id+1,portfolio:{contracts:[{contract_id:55}]}});
 assert.equal(h.run('S.accountPortfolio'),null,'unrelated responses ignored');
 ws.message({req_id:req.req_id,portfolio:{contracts:[{contract_id:55,underlying_symbol:'R_75',contract_type:'DIGITEVEN',buy_price:1,currency:'USD',longcode:'<img src=x onerror=alert(1)>'}]}});
 assert.equal(h.run('S.accountPortfolio.contracts.length'),1);
 assert.equal(h.el('openCount').textContent,'1 open');
 assert.equal(h.el('openContracts').children.at(-1).textContent.includes('<img'),true,'external descriptions are text nodes, not HTML');
 assert.equal(h.run('S.accountContracts.length'),0,'portfolio data must not fabricate local tracking');
 h.run("S.uncertainOrder={accountId:'VRTC1'}; fetchPortfolio()");
 const second=ws.sent.filter(x=>x.portfolio===1).at(-1);
 ws.message({req_id:second.req_id,portfolio:{contracts:[]}});
 assert.ok(h.run('S.uncertainOrder'),'empty portfolio must not resolve an uncertain buy');
 assert.equal(h.el('openContracts').textContent,'No open positions in the last Deriv snapshot.');
 h.run('fetchPortfolio(); invalidatePortfolio()');
 const stale=ws.sent.filter(x=>x.portfolio===1).at(-1);
 ws.message({req_id:stale.req_id,portfolio:{contracts:[{contract_id:88}]}});
 assert.equal(h.run('S.accountPortfolio'),null,'a snapshot invalidated by an order must not return');
 h.run('fetchPortfolio()'); const malformed=ws.sent.filter(x=>x.portfolio===1).at(-1);
 ws.message({req_id:malformed.req_id,portfolio:{contracts:null}});
 assert.equal(h.run('S.accountPortfolio'),null);
 assert.equal(h.run('S.portfolioStatus'),'unavailable');
}
console.log('Live market discovery and unavailable-symbol handling checks passed');
// A demo bot must not buy if tick freshness or precision expires while waiting for a quote.
for(const change of ["S.tickTimes.R_75=Date.now()-11000", "delete S.precisionKnown.R_75"]){
 const h=harness(); h.run("openNewDerivWS('wss://api.derivws.com/ws?otp=demo',{account_id:'VRTC1',account_type:'demo',currency:'USD',balance:1000})");
 const ws=h.sockets[0]; ws.open();const req=ws.sent.find(x=>x.active_symbols).req_id;
 ws.message({req_id:req,active_symbols:[{underlying_symbol:'R_75'}]});
 for(const [id,value] of Object.entries({autoStake:'1',autoMaxTrades:'3',autoTP:'10',autoSL:'10',autoConf:'0',autoMinProfit:'0',autoRecovery:'none',autoStrategy:'even_odd',autoSymbol:'R_75'}))h.el(id).value=value;
 h.run("S.ticks.R_75=Array.from({length:100},(_,i)=>100+i%10/100); S.tickCounts.R_75=100; S.tickTimes.R_75=Date.now(); S.precisionKnown.R_75=2; startAutoTrader(); autoTick()");
 const quote=ws.sent.find(x=>x.proposal); assert.ok(quote);
 h.run(change); ws.message({req_id:quote.req_id,proposal:{id:'stale-bot',ask_price:1,payout:1.9}});
 assert.equal(ws.sent.some(x=>x.buy),false,change); assert.equal(h.run('S.auto.running'),false);
}
{
 const h=harness(); h.run("S.bots=defaultBots(); runBot('kelly')");
 assert.notEqual(h.el('autoRecovery').value,'none','simulator-only preset must not silently turn into fixed staking');
}
console.log('Demo quote freshness and preset mode checks passed');
// Read-only account statement requests are correlated and never change order state.
for(const kind of ['new','legacy']){
 const h=harness();
 if(kind==='new') h.run("openNewDerivWS('wss://api.derivws.com/ws?otp=demo',{account_id:'VRTC1',account_type:'demo',currency:'USD',balance:1000})");
 else h.run("tryConnect('token')");
 const ws=h.sockets[0];ws.open(); if(kind==='legacy')ws.message({req_id:3,authorize:{loginid:'VRTC1',is_virtual:1,currency:'USD',balance:1000}});
 h.run("S.uncertainOrder={accountId:'VRTC1'}; S.accountContracts=[{id:'123',accountId:'VRTC1',status:'OPEN'}]; fetchStatement()");
 const req=ws.sent.filter(x=>x.statement===1).at(-1);
 assert.deepEqual({limit:req.limit,offset:req.offset},{limit:100,offset:0});
 ws.message({req_id:req.req_id+1,statement:{transactions:[]}});
 assert.equal(h.run('S.statementStatus'),'loading');
 ws.message({req_id:req.req_id,statement:{transactions:[{action_type:'<img>',amount:-1,contract_id:123,transaction_time:1700000000},{action_type:'sell',amount:1.9,contract_id:123,transaction_time:1700000001}]}});
 assert.equal(h.run('S.accountStatement.transactions.length'),2);
 assert.match(h.el('accountStatement').children.at(-2).textContent,/<img>.*locally tracked OPEN/);
 assert.equal(h.run('S.accountContracts[0].status'),'OPEN','statement does not infer settlement');
 assert.ok(h.run('S.uncertainOrder'),'statement does not clear ambiguity');
 h.run('fetchStatement(); invalidatePortfolio()'); const stale=ws.sent.filter(x=>x.statement===1).at(-1);
 ws.message({req_id:stale.req_id,statement:{transactions:[]}});
 assert.equal(h.run('S.accountStatement'),null,'invalidated snapshot cannot return');
 h.run('fetchStatement()'); const invalid=ws.sent.filter(x=>x.statement===1).at(-1);
 ws.message({req_id:invalid.req_id,statement:{transactions:null}});
 assert.equal(h.run('S.statementStatus'),'unavailable');
 h.run('fetchStatement()'); const old=ws.sent.filter(x=>x.statement===1).at(-1); h.run('disconnectDeriv()');
 ws.message({req_id:old.req_id,statement:{transactions:[]}});
 assert.equal(h.run('S.accountStatement'),null,'disconnect clears statement');
}
console.log('Read-only account statement checks passed');
// History pagination keeps the same cutoff, isolates requests and cannot clear warnings.
{
 const h=harness(); h.run("openNewDerivWS('wss://api.derivws.com/ws?otp=demo',{account_id:'VRTC1',account_type:'demo',currency:'USD',balance:1000})");
 const ws=h.sockets[0]; ws.open(); h.run('fetchStatement()');
 const first=ws.sent.filter(x=>x.statement===1).at(-1); assert.equal(first.offset,0); assert.ok(Number.isSafeInteger(first.date_to));
 ws.message({req_id:first.req_id,statement:{transactions:Array.from({length:100},(_,i)=>({action_type:'buy',transaction_time:1700000000,amount:-1,contract_id:i+1}))}});
 h.run('pageStatement(1)'); const next=ws.sent.filter(x=>x.statement===1).at(-1);
 assert.equal(next.offset,100); assert.equal(next.date_to,first.date_to);
 ws.message({req_id:next.req_id,statement:{transactions:[{action_type:'sell',amount:2,contract_id:2}]}});
 const n=ws.sent.length; h.run('pageStatement(1)'); assert.equal(ws.sent.length,n,'short page does not suggest more');
 h.run('pageStatement(-1)'); const previous=ws.sent.filter(x=>x.statement===1).at(-1); assert.equal(previous.offset,0); assert.equal(previous.date_to,first.date_to);
}
console.log('Statement pagination checks passed');
