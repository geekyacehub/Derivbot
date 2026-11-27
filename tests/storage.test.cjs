'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
function setup(entries,unavailable=false){
  const store=new Map(Object.entries(entries));
  const storage={getItem(k){if(unavailable)throw Error('blocked');return store.has(k)?store.get(k):null},setItem(k,v){if(unavailable)throw Error('blocked');store.set(k,String(v))},removeItem(k){store.delete(k)}};
  const elements=new Map();
  const get=id=>{if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',style:{},classList:{add(){},remove(){}},appendChild(){}});return elements.get(id)};
  const ctx=vm.createContext({console,localStorage:storage,document:{getElementById:get,createElement:()=>({}),addEventListener(){}},window:{confirm:()=>true},setTimeout(){},clearTimeout(){}});
  vm.runInContext(source,ctx);
  return {run:s=>vm.runInContext(s,ctx),store,get};
}
let t=setup({dbx_journal:'{bad',dbx_bots:'[oops',dbx_course:'null',dbx_uncertain_order:'{bad',dbx_account_contracts:'[]'});
assert.equal(t.run('S.journal.length'),0);
assert.equal(t.run('S.courseDone.length'),0);
assert.equal(t.run('S.uncertainOrder.trackingDamaged'),true);
t.run('renderAccountTracking()');
assert.match(t.get('accountOrderStatus').textContent,/DAMAGED/);
t.run('acknowledgeUncertainOrder()');
assert.equal(t.run('S.uncertainOrder'),null);
assert.equal(t.store.get('dbx_account_contracts'),'[]');
assert.equal(t.store.get('dbx_uncertain_order'),'null');
t=setup({dbx_account_contracts:'{"bad":true}'});
assert.equal(t.run('S.uncertainOrder.trackingDamaged'),true);
t=setup({},true);
assert.equal(t.run('S.uncertainOrder.trackingDamaged'),true);
t.run('acknowledgeUncertainOrder()');
assert.equal(t.run('S.uncertainOrder.trackingDamaged'),true);
t=setup({dbx_journal:JSON.stringify([null,{stake:1,entry:2,exit:3,profit:1}, {stake:'bad'}]),dbx_course:'[1,1,3,200]'});
assert.equal(t.run('S.journal.length'),1);
assert.equal(t.run('S.courseDone.length'),2);
t=setup({dbx_risk:'{bad'});
assert.equal(t.run('validRiskSettings(S.risk)'),false);
assert.match(t.run('checkSimulationRisk(1)'),/valid risk settings/);
console.log('Corrupt and unavailable storage recovery checks passed');
// Production policy: no synthetic orders, bot runs, or hypothetical replays;
// account quote requests remain available.
t=setup({});
t.run("S.connected=false; buyContract(); startAutoTrader(); runBacktest()");
assert.equal(t.run('S.openContracts.length'),0);
assert.equal(t.run('S.auto.running'),false);
assert.match(t.get('toast').textContent,/historical contract prices/);
assert.match(t.get('proposalBox').textContent,/Connect to Deriv/);
t.get('contractType').value='DIGITEVEN';t.get('barrier').value='5';t.get('stake').value='1';t.get('duration').value='5';
t.run("var sent=[]; S.connected=true; S.activeMarkets=['R_75']; S.accountId='VRTC123'; S.ws={readyState:1,send:s=>sent.push(JSON.parse(s))}; buyContract()");
assert.equal(t.run('sent[0].proposal'),1);
assert.equal(t.run('sent.length'),1);
console.log('Real-data-only production policy checks passed');
// Production must never infer a digit from the bundled symbol precision.
t=setup({});
t.run("onTick=()=>{}; var ws={send(){}}; S.ws=ws; activateLiveFeed(ws); handleMarketDiscovery({req_id:S.marketRequest,active_symbols:[{symbol:'R_50'}]},ws); receiveDerivTick({symbol:'R_50',quote:320.123},ws)");
assert.equal(t.run("digitStats('R_50').n"),0);
assert.equal(t.run("displayMarketPrice(320.123,'R_50')"),'320.123');
assert.equal(t.run("autoDecision('R_50','even_odd',Array(60).fill(320.123))"),null);
t.run("receiveDerivTick({symbol:'R_50',quote:320.127,pip_size:3},ws)");
assert.equal(t.run("digitStats('R_50').n"),1);
assert.equal(t.run("digitStats('R_50').digits[0]"),7);
t.run("receiveDerivTick({symbol:'R_50',quote:320.12,pip_size:2},ws)");
assert.equal(t.run("digitStats('R_50').n"),1);
assert.equal(t.run("digitStats('R_50').digits[0]"),2);
assert.equal(t.run("computeIndicators('R_75').find(x=>x[0]==='Price')[1]"),'—');
assert.equal(t.run("computeIndicators('R_75').find(x=>x[0]==='Trend')[1]"),'—');
console.log('Verified precision and missing-data checks passed');
// Plot geometry must stay finite and labels must be concise on real numeric values.
t=setup({});
t.run(`var rectangles=[],texts=[],points=[];
var chartContext={setTransform(){},clearRect(){},fillRect(...args){rectangles.push(args)},fillText(...args){texts.push(args)},beginPath(){},moveTo(...args){points.push(args)},lineTo(...args){points.push(args)},stroke(){},closePath(){},fill(){}};
var chart={width:400,height:180,getBoundingClientRect(){return {width:400}},getAttribute(){return '180'},getContext(){return chartContext}};
drawBars(chart,['0','1'],[33.333333333,66.666666666]); drawLineChart(chart,[100]);`);
assert.equal(t.run('rectangles.length'),2);
assert.equal(t.run('rectangles.every(r=>r.every(Number.isFinite))'),true);
assert.equal(t.run("texts.some(t=>t[0]==='33.3%')"),true);
assert.equal(t.run('points.every(p=>p.every(Number.isFinite))'),true);
// Deriv ticks older than the latest recorded exchange timestamp are ignored.
t=setup({});
t.run("onTick=()=>{}; var ws={readyState:1,send(){}}; S.ws=ws; activateLiveFeed(ws); handleMarketDiscovery({req_id:S.marketRequest,active_symbols:[{underlying_symbol:'R_75'}]},ws); receiveDerivTick({symbol:'R_75',quote:100.01,pip_size:2,epoch:20},ws); receiveDerivTick({symbol:'R_75',quote:100.09,pip_size:2,epoch:19},ws)");
assert.equal(t.run('S.tickCounts.R_75'),1);
assert.equal(t.run('S.ticks.R_75[0]'),100.01);
assert.equal(t.get('feedStatus').textContent,'DATA: DERIV LIVE');
t.run("S.tickTimes.R_75=Date.now()-16000; refreshFeedStatus()");
assert.equal(t.get('feedStatus').textContent,'DATA: NO RECENT SELECTED TICK');
console.log('Live chart rendering, tick ordering and freshness checks passed');
// Incomplete or contradictory account records must fail closed on restart.
const goodContract={id:'123',accountId:'VRTC1',symbol:'R_75',type:'DIGITEVEN',currency:'USD',stake:1,createdAt:1000,status:'OPEN',botSessionId:null};
const goodOrder={accountId:'VRTC1',symbol:'R_75',type:'DIGITEVEN',currency:'USD',stake:1,createdAt:1000,kind:'manual'};
t=setup({dbx_account_contracts:JSON.stringify([goodContract]),dbx_uncertain_order:JSON.stringify(goodOrder)});
assert.equal(t.run('S.accountContracts.length'),1);
assert.equal(t.run('S.uncertainOrder.accountId'),'VRTC1');
for(const invalid of [{}, {...goodContract,id:'bad'}, {...goodContract,stake:0}, {...goodContract,status:'SETTLED'}, {...goodContract,accountId:''}]){
 t=setup({dbx_account_contracts:JSON.stringify([invalid])});
 assert.equal(t.run('S.uncertainOrder.trackingDamaged'),true);
}
t=setup({dbx_account_contracts:JSON.stringify([goodContract,goodContract])});
assert.equal(t.run('S.uncertainOrder.trackingDamaged'),true);
t=setup({dbx_uncertain_order:'{}'});
assert.equal(t.run('S.uncertainOrder.trackingDamaged'),true);
console.log('Persisted account record integrity checks passed');
