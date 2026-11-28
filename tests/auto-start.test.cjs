'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
function harness(tab=new Map()){
 const els=new Map(),local=new Map();
 const el=id=>{if(!els.has(id))els.set(id,{value:'',textContent:'',innerHTML:'',checked:false,style:{},classList:{add(){},remove(){}},appendChild(){}});return els.get(id)};
 const sessionStorage={getItem:k=>tab.get(k)??null,setItem:(k,v)=>tab.set(k,String(v)),removeItem:k=>tab.delete(k)};
 const localStorage={getItem:k=>local.get(k)??null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k)};
 const socket={readyState:1,sent:[],send(s){this.sent.push(JSON.parse(s))}};
 const ctx=vm.createContext({console,sessionStorage,localStorage,socket,document:{getElementById:el,createElement:()=>({}),addEventListener(){}},window:{confirm:()=>true},setTimeout(){},clearTimeout(){}});
 vm.runInContext(source,ctx);const run=s=>vm.runInContext(s,ctx);
 for(const [k,v] of Object.entries({autoStake:'1',autoMaxTrades:'1',autoTP:'1',autoSL:'1',autoConf:'0',autoMinProfit:'0.50',autoRecovery:'none',autoStrategy:'over_under',autoSymbol:'R_75'}))el(k).value=v;
 el('autoGuard').checked=true;
 run("S.connected=true; S.isDemo=true; S.feed='deriv'; S.ws=socket; S.accountId='VRTC1'; S.currency='USD'; S.balance=1000; S.activeMarkets=['R_75']; S.risk={dailyLoss:20,maxStakePct:5,maxLossStreak:3,timer:0}; S.accountContracts=[]; S.uncertainOrder=null; S.openContracts=[]; S.ticks.R_75=[]; subscribeLiveSymbol=()=>true; Date.now=()=>100000;");
 return {run,el,ctx,tab,socket,sessionStorage};
}
{
 const h=harness(); h.ctx.window.confirm=()=>false; h.run('armDemoAutoStart()');
 assert.equal(h.tab.size,0,'declining consent does not store a configuration');
 h.ctx.window.confirm=()=>true; h.run('armDemoAutoStart()'); assert.equal(h.tab.size,1);
 assert.equal(h.run('S.auto.running'),false,'arming does not itself buy');
 h.run("S.ticks.R_75=Array(49).fill(100.01); S.precisionKnown.R_75=2; S.tickTimes.R_75=Date.now(); maybeStartArmedDemo('R_75')");
 assert.equal(h.run('S.auto.running'),false,'wait for enough ticks');
 h.run("S.ticks.R_75.push(100.02); maybeStartArmedDemo('R_75')");
 assert.equal(h.run('S.auto.running'),true); assert.equal(h.tab.size,0,'consent consumed before session starts');
 assert.equal(h.socket.sent.length,0,'auto-start does not immediately buy');
 h.run("S.tickCounts.R_75=50; autoTick()"); assert.equal(h.socket.sent[0].proposal,1);
 assert.equal(h.socket.sent.some(x=>x.buy),false,'quote required before any buy');
 h.run('stopAutoTrader()'); assert.equal(h.run('S.auto.running'),false);
 h.run("maybeStartArmedDemo('R_75')"); assert.equal(h.run('S.auto.running'),false,'cannot restart from consumed consent');
}
for(const change of ["S.isDemo=false", "S.accountId='VRTC2'", "S.currency='EUR'", "S.uncertainOrder={accountId:'VRTC1'}", "S.accountContracts=[{accountId:'VRTC1',status:'OPEN'}]", "delete S.precisionKnown.R_75", "S.tickTimes.R_75=1", "S.ws.readyState=3"]){
 const h=harness(); h.run('armDemoAutoStart()');
 h.run(`S.ticks.R_75=Array(50).fill(100.01); S.precisionKnown.R_75=2; S.tickTimes.R_75=Date.now(); ${change}; maybeStartArmedDemo('R_75')`);
 assert.equal(h.run('S.auto.running'),false,change); assert.equal(h.socket.sent.length,0);
}
{
 const tab=new Map(),h=harness(tab); h.run('armDemoAutoStart()');
 const restored=harness(tab); restored.run("S.ticks.R_75=Array(50).fill(100.01); S.precisionKnown.R_75=2; S.tickTimes.R_75=Date.now(); maybeStartArmedDemo('R_75')");
 assert.equal(restored.run('S.auto.running'),true,'consent survives reload in same tab');
 assert.equal(tab.size,0);
}
{
 const h=harness();h.run('armDemoAutoStart()');h.sessionStorage.removeItem=()=>{throw Error('blocked')};
 h.run("S.ticks.R_75=Array(50).fill(100.01); S.precisionKnown.R_75=2; S.tickTimes.R_75=Date.now(); maybeStartArmedDemo('R_75')");
 assert.equal(h.run('S.auto.running'),false,'failed consumption cannot start');
}
{
 const h=harness();h.run('armDemoAutoStart(); S.risk.dailyLoss=0.5; S.ticks.R_75=Array(50).fill(100.01); S.precisionKnown.R_75=2; S.tickTimes.R_75=Date.now(); maybeStartArmedDemo("R_75")');
 assert.equal(h.run('S.auto.running'),false); assert.equal(h.tab.size,0,'invalid risk disarms');
}
{
 const h=harness();h.run('armDemoAutoStart(); Date.now=()=>100000+8*3600000; S.ticks.R_75=Array(50).fill(100.01); S.precisionKnown.R_75=2; S.tickTimes.R_75=Date.now(); maybeStartArmedDemo("R_75")');
 assert.equal(h.run('S.auto.running'),false,'expired authorization cannot start');
}
console.log('One-session demo auto-start checks passed');
// The production tick handler triggers auto-start after verified data is collected.
{
 const h=harness();h.run("onTick=()=>{}; S.candles.R_75=[]; armDemoAutoStart(); for(let i=0;i<50;i++) receiveDerivTick({symbol:'R_75',quote:100+i/100,pip_size:2,epoch:100+i},socket)");
 assert.equal(h.run('S.auto.running'),true);
 assert.equal(h.tab.size,0);
}
{
 const h=harness();h.run('armDemoAutoStart(); stopAutoTrader()');
 assert.equal(h.tab.size,0,'stop cancels a waiting authorization');
 h.run("S.ticks.R_75=Array(50).fill(100.01); S.precisionKnown.R_75=2; S.tickTimes.R_75=Date.now(); maybeStartArmedDemo('R_75')");
 assert.equal(h.run('S.auto.running'),false);
}
// Errors identify the actual field without storing consent or starting a trade.
for(const [id,value,pattern] of [
 ['autoMaxTrades','101',/Max Trades/], ['autoTP','',/Take Profit/], ['autoSL','',/Stop Loss/],
 ['autoStake','',/base stake/i], ['autoConf','101',/strategy score/i], ['autoMinProfit','-1',/Minimum quoted profit/],
 ['autoRecovery','kelly',/recovery mode/i], ['autoStrategy','multi_market',/supported demo strategy/i]
]){
 const h=harness();h.el(id).value=value;h.run('armDemoAutoStart()');
 assert.match(h.el('autoStartStatus').textContent,pattern,`${id} explains the error`);
 assert.equal(h.tab.size,0);assert.equal(h.socket.sent.length,0);
}
{
 const h=harness();h.el('autoQuoteSearch').checked=true;h.el('autoMinProfit').value='0';h.run('armDemoAutoStart()');
 assert.match(h.el('autoStartStatus').textContent,/greater than zero/);
 assert.equal(h.tab.size,0);
}

// Consent for the previous six-quote behavior must not silently authorize the expanded search.
{
 const h=harness(); h.run('armDemoAutoStart()');
 const key=[...h.tab.keys()][0], c=JSON.parse(h.tab.get(key)); c.version=1; c.quoteSearch=true; h.tab.set(key,JSON.stringify(c));
 h.run("S.ticks.R_75=Array(50).fill(100.01); S.precisionKnown.R_75=2; S.tickTimes.R_75=Date.now(); maybeStartArmedDemo('R_75')");
 assert.equal(h.run('S.auto.running'),false); assert.equal(h.socket.sent.length,0);
}
