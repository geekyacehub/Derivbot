/* DerivBot Pro X — 100% FREE for personal use. No paid plans, no paywalls.
   TraderScheme × Expert Analysis × ProCortex combined ×10.
   Live Deriv WebSocket API + simulated feed fallback. No build step. */
'use strict';
// Production UI accepts Deriv data only. Simulator code remains for isolated tests.
const REAL_DATA_ONLY=true;

/* ================= SYMBOLS ================= */
const SYMBOLS = [
  {sym:'R_75', name:'Volatility 75 Index', short:'V75', vol:0.0012, base:1450, pip:2},
  {sym:'R_100', name:'Volatility 100 Index', short:'V100', vol:0.0015, base:1850, pip:2},
  {sym:'R_25', name:'Volatility 25 Index', short:'V25', vol:0.0009, base:2600, pip:2},
  {sym:'R_50', name:'Volatility 50 Index', short:'V50', vol:0.0010, base:320, pip:3},
  {sym:'R_10', name:'Volatility 10 Index', short:'V10', vol:0.0006, base:680, pip:3},
  {sym:'BOOM1000', name:'Boom 1000 Index', short:'B1000', vol:0.0018, base:12500, pip:2, spike:0.004},
  {sym:'CRASH500', name:'Crash 500 Index', short:'C500', vol:0.0018, base:9800, pip:2, spike:-0.004},
  {sym:'BOOM300N', name:'Boom 300 Index', short:'B300', vol:0.0016, base:2400, pip:2, spike:0.005},
  {sym:'CRASH300N', name:'Crash 300 Index', short:'C300', vol:0.0016, base:2200, pip:2, spike:-0.005},
  {sym:'JD100', name:'Jump 100 Index', short:'J100', vol:0.0014, base:14500, pip:2},
  {sym:'STPRNG', name:'Step Index', short:'STEP', vol:0.0008, base:5200, pip:2},
  {sym:'RDBULL', name:'Bull Market Index', short:'BULL', vol:0.0011, base:2100, pip:2},
  {sym:'RDBEAR', name:'Bear Market Index', short:'BEAR', vol:0.0011, base:1900, pip:2},
  {sym:'1HZ75V', name:'Volatility 75 (1s) Index', short:'V75-1s', vol:0.0012, base:1450, pip:2},
  {sym:'1HZ100V', name:'Volatility 100 (1s) Index', short:'V100-1s', vol:0.0015, base:1850, pip:2},
];
const symByCode = c => SYMBOLS.find(s=>s.sym===c) || SYMBOLS[0];

/* ================= STATE ================= */
function readLocalJSON(key,fallback){ try{ const value=localStorage.getItem(key); return value?JSON.parse(value):fallback; }catch(e){ return fallback; } }
// Damaged account tracking must not silently erase the duplicate-order warning.
function readAccountState(){
  try{
    const rawOrder=localStorage.getItem('dbx_uncertain_order');
    const rawContracts=localStorage.getItem('dbx_account_contracts');
    const order=rawOrder?JSON.parse(rawOrder):null;
    const contracts=rawContracts?JSON.parse(rawContracts):[];
    if ((order!==null && (typeof order!=='object' || Array.isArray(order))) || !Array.isArray(contracts) || contracts.some(c=>!c || typeof c!=='object' || Array.isArray(c))) throw Error('invalid account tracking');
    return {order,contracts};
  }catch(e){ return {order:{trackingDamaged:true},contracts:[]}; }
}
function readRisk(){
  try{ const raw=localStorage.getItem('dbx_risk'); if(raw===null) return {dailyLoss:20,maxStakePct:5,maxLossStreak:5,timer:0}; const value=JSON.parse(raw); return value && typeof value==='object' && !Array.isArray(value)?value:{}; }catch(e){ return {}; }
}
function readArray(key){ const value=readLocalJSON(key,[]); return Array.isArray(value)?value:[]; }
function readJournal(){
  return readArray('dbx_journal').filter(j=>j && typeof j==='object' && !Array.isArray(j) && ['stake','entry','exit','profit'].every(k=>typeof j[k]==='number' && Number.isFinite(j[k]))).slice(0,200);
}
const savedAccountState=readAccountState();
const S = {
  connected:false, ws:null, token:'', appId:'1089', balance:10000, currency:'USD', isDemo:true, accountName:'Demo',
  selected:'R_75', tf:60, chartType:'candles',
  ticks:{}, tickCounts:{}, tickTimes:{}, precisionKnown:{}, activeMarkets:null, marketRequest:null, tickRequests:{}, candles:{}, history:{}, feed:'simulation', feedGeneration:0, simulationState:null, // per symbol arrays
  openContracts:[], journal: readJournal(),
  bots: readLocalJSON('dbx_bots',null),
  builderBlocks:[], followers:[],
  auto:{running:false, strategy:'over_under', symbol:'R_75', stake:1, maxTrades:20, tp:10, sl:10, conf:55, recovery:'martingale', trades:0, wins:0, losses:0, pnl:0, curStake:1, lossStreak:0, log:[]},
  aiLog: readLocalJSON('dbx_ai',[]),
  courseDone: readArray('dbx_course').filter(i=>Number.isInteger(i) && i>=0 && i<30).filter((v,i,a)=>a.indexOf(v)===i),
  risk: readRisk(),
  simDaily:readLocalJSON('dbx_sim_daily',null),
  alerts:[], tickCount:0, startTime:Date.now(), equity:[10000],
  lastProposal:null, manualOrder:null, orderSeq:10000, accountId:'',
  uncertainOrder:savedAccountState.order, accountContracts:savedAccountState.contracts, copyResults:{},
};
const $ = id => document.getElementById(id);
const fmt = (n,d=2)=> Number(n||0).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtPrice = (n,pip=2)=> Number(n||0).toLocaleString('en-US',{minimumFractionDigits:pip,maximumFractionDigits:pip});
const displayMarketPrice = (n,sym)=> S.feed==='deriv' && S.precisionKnown[sym]===undefined ? String(n) : fmtPrice(n,symByCode(sym).pip);
const lastDigit = (p, sym=S.selected) => Math.abs(Math.round(Number(p) * 10 ** symByCode(sym).pip)) % 10;
const rand = (a,b)=> a+Math.random()*(b-a);
function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),3200); }
function logConn(msg){ const el=$('connectLog'); if(el){ const line=document.createElement('div'); line.textContent=`${new Date().toLocaleTimeString()} — ${msg}`; el.appendChild(line); } }

/* ================= MOCK FEED (works with zero setup) ================= */
function initMock(){
  SYMBOLS.forEach(s=>{
    if(S.ticks[s.sym]) return;
    let price = s.base;
    S.ticks[s.sym]=[]; S.candles[s.sym]=[];
    for(let i=0;i<600;i++){ price = nextPrice(s,price); S.ticks[s.sym].push(price); }
    buildCandles(s.sym, 60);
  });
}
function nextPrice(s, prev){
  let drift = rand(-1,1)*s.vol;
  if(s.spike && Math.random()<0.008) drift += s.spike*rand(2,5);
  // mean reversion to keep prices sane
  drift += (s.base - prev)/s.base * 0.002;
  return Math.max(prev*(1+drift), 0.0001);
}
function buildCandles(sym, tf){
  const ticks = S.ticks[sym]||[]; const out=[]; const per = tf===60?10: tf===300?30: tf===900?60: tf===3600?120:300;
  for(let i=0;i<ticks.length;i+=per){
    const slice=ticks.slice(i,i+per); if(!slice.length) continue;
    out.push({o:slice[0],h:Math.max(...slice),l:Math.min(...slice),c:slice[slice.length-1],t:Date.now()-(ticks.length-i)*2000});
  }
  S.candles[sym]=out;
}
function mockTick(){
  if(S.feed!=='simulation') return;
  SYMBOLS.forEach(s=>{
    const arr=S.ticks[s.sym]; const prev=arr[arr.length-1];
    const p=nextPrice(s,prev); arr.push(p); if(arr.length>1500) arr.shift();
    S.tickCount++; S.tickCounts[s.sym]=(S.tickCounts[s.sym]||0)+1;
    resolveAI(s.sym,p);
    // update last candle
    const c=S.candles[s.sym]; if(c.length){ const last=c[c.length-1]; last.c=p; last.h=Math.max(last.h,p); last.l=Math.min(last.l,p); }
    if(Math.random()<0.08) buildCandles(s.sym,S.tf);
  });
  onTick(S.selected);
}

// Keep simulated and Deriv observations in separate buffers. A missing live tick
// stays missing; never substitute synthetic data into a connected view.
function activateLiveFeed(ws){
  if(S.feed!=='deriv'){
    expirePendingPredictions('Feed changed');
    S.simulationState={ticks:S.ticks,candles:S.candles,tickCounts:S.tickCounts,tickCount:S.tickCount,balance:S.balance,currency:S.currency,equity:S.equity,precisions:SYMBOLS.map(s=>s.pip)};
    S.ticks={}; S.candles={}; S.tickCounts={}; S.tickTimes={}; S.precisionKnown={}; S.tickCount=0;
    SYMBOLS.forEach(s=>{ S.ticks[s.sym]=[]; S.candles[s.sym]=[]; });
    S.feed='deriv'; S.feedGeneration++;
  }
  updateFeedUI();
  if(REAL_DATA_ONLY){
    S.activeMarkets=null; S.tickRequests={}; S.marketRequest=++S.orderSeq;
    try{ ws.send(JSON.stringify({active_symbols:'brief',req_id:S.marketRequest})); }
    catch(e){ S.marketRequest=null; logConn('Could not request available markets; account orders are blocked until discovery succeeds.'); }
  }else SYMBOLS.forEach(s=>{ try{ws.send(JSON.stringify({ticks:s.sym,subscribe:1}));}catch(e){ logConn(`Unable to subscribe to ${s.sym}.`); } });
}
function restoreSimulationFeed(){
  if(S.feed!=='deriv') return;
  expirePendingPredictions('Feed changed');
  const saved=S.simulationState;
  S.ticks=saved.ticks; S.candles=saved.candles; S.tickCounts=saved.tickCounts;
  S.tickCount=saved.tickCount; S.balance=saved.balance; S.currency=saved.currency; S.equity=saved.equity;
  SYMBOLS.forEach((s,i)=>{s.pip=saved.precisions[i];});
  S.simulationState=null; S.feed='simulation'; S.feedGeneration++; S.activeMarkets=null; S.marketRequest=null; S.tickRequests={};
  if(REAL_DATA_ONLY) renderMarketSelectors();
  updateFeedUI();
}
// Only offer the configured instruments Deriv currently reports as active.
function renderMarketSelectors(){
  const supported=S.feed==='deriv' && Array.isArray(S.activeMarkets)?SYMBOLS.filter(s=>S.activeMarkets.includes(s.sym)):SYMBOLS;
  const options=supported.map(s=>`<option value="${s.sym}">${s.name} (${s.sym})</option>`).join('');
  for(const id of ['symbolSelect','builderSymbol','autoSymbol','btSymbol']){
    const el=$(id); if(!el) continue;
    const old=id==='symbolSelect'?S.selected:el.value;
    el.innerHTML=options;
    if(supported.some(s=>s.sym===old)) el.value=old;
    else if(supported.length) el.value=supported[0].sym;
  }
  if(supported.length && !supported.some(s=>s.sym===S.selected)) S.selected=supported[0].sym;
}
function handleMarketDiscovery(d,ws){
  if(!REAL_DATA_ONLY || ws!==S.ws || S.feed!=='deriv') return false;
  if(S.marketRequest!==null && d.req_id===S.marketRequest){
    S.marketRequest=null;
    if(d.error || !Array.isArray(d.active_symbols)){
      S.activeMarkets=[]; renderMarketSelectors();
      logConn('Unable to verify Deriv markets. Reconnect to retry; account orders are blocked.');
      if($('feedStatus')) $('feedStatus').textContent='DATA: MARKET DISCOVERY FAILED';
      return true;
    }
    const available=new Set(d.active_symbols.filter(s=>s && typeof s.symbol==='string' && s.is_trading_suspended!==1 && s.is_trading_suspended!==true).map(s=>s.symbol));
    S.activeMarkets=SYMBOLS.filter(s=>available.has(s.sym)).map(s=>s.sym);
    renderMarketSelectors();
    if(!S.activeMarkets.length){ logConn('No configured markets were reported active by Deriv.'); if($('feedStatus')) $('feedStatus').textContent='DATA: NO MATCHING MARKETS'; return true; }
    S.activeMarkets.forEach(sym=>{
      const req=++S.orderSeq; S.tickRequests[req]=sym;
      try{ws.send(JSON.stringify({ticks:sym,subscribe:1,req_id:req}));}
      catch(e){ delete S.tickRequests[req]; S.activeMarkets=S.activeMarkets.filter(s=>s!==sym); logConn(`Unable to subscribe to ${sym}.`); }
    });
    renderMarketSelectors();
    logConn(`Deriv reported ${S.activeMarkets.length} supported markets; waiting for ticks.`);
    return true;
  }
  const symbol=S.tickRequests[d.req_id];
  if(symbol && d.error){
    delete S.tickRequests[d.req_id]; S.activeMarkets=S.activeMarkets.filter(s=>s!==symbol);
    if(S.manualOrder && S.manualOrder.phase==='proposal' && S.manualOrder.symbol===symbol) failManualOrder('Market subscription failed; no purchase sent.');
    if(S.auto.running && S.auto.mode==='account' && S.auto.symbol===symbol){ autoLog(`Market ${symbol} is unavailable; stopping the bot.`, 'warn'); stopAutoTrader(); }
    S.ticks[symbol]=[]; S.candles[symbol]=[]; delete S.precisionKnown[symbol]; delete S.tickTimes[symbol];
    renderMarketSelectors(); updatePriceChip();
    logConn(`Deriv rejected the ${symbol} tick subscription. That market is unavailable in this session.`);
    return true;
  }
  return false;
}
function updateFeedUI(){
  if($('feedStatus')) $('feedStatus').textContent=S.feed==='deriv'?'DATA: DERIV LIVE (awaiting subscribed ticks)':(REAL_DATA_ONLY?'DATA: DISCONNECTED':'DATA: SIMULATED');
  if($('priceChip')) $('priceChip').textContent='Waiting for price…';
  if(REAL_DATA_ONLY && S.feed!=='deriv' && $('sessionStats')) $('sessionStats').textContent='Connect to Deriv to see your account balance.';
  if($('heroDigit')) $('heroDigit').textContent='—';
  if($('marketEmpty')) $('marketEmpty').hidden=false;
  if($('marketIndicator')){ $('marketIndicator').classList.remove('has-ticks'); $('marketIndicator').innerHTML='<i></i> Awaiting feed'; }
  ['snapshotGrid','watchlistGrid','tickerTrack','indicatorStrip','indicatorTable','lastDigits','dashSignals','signalCards','signalTable','btResults'].forEach(id=>{ if($(id)) $(id).innerHTML=''; });
  ['mainChart','heroChart','distChart','aiDistChart','btChart'].forEach(id=>{ const cv=$(id); if(cv && cv.getContext){ const ctx=cv.getContext('2d'); if(ctx) ctx.clearRect(0,0,cv.width,cv.height); } });
}
function receiveDerivTick(tick,ws){
  if(ws!==S.ws || S.feed!=='deriv' || !tick || !SYMBOLS.some(s=>s.sym===tick.symbol) || (REAL_DATA_ONLY && (!Array.isArray(S.activeMarkets) || !S.activeMarkets.includes(tick.symbol)))) return;
  const quote=Number(tick.quote); if(!Number.isFinite(quote) || quote<=0) return;
  const sym=tick.symbol, meta=SYMBOLS.find(s=>s.sym===sym);
  if(Number.isInteger(tick.pip_size) && tick.pip_size>=0 && tick.pip_size<=10){
    const previous=S.precisionKnown[sym];
    if(previous!==undefined && previous!==tick.pip_size){
      expirePendingPredictions('Deriv precision changed');
      if(S.auto.running && S.auto.mode==='account' && S.auto.symbol===sym){ autoLog('Deriv precision changed; stopping bot. Check any submitted or open contract in Deriv.','warn'); stopAutoTrader(); }
      S.ticks[sym]=[]; S.candles[sym]=[]; S.tickCounts[sym]=0;
    }
    // Do not mix observations collected before precision was verified into digit analysis.
    if(previous===undefined && S.ticks[sym].length){ S.ticks[sym]=[]; S.candles[sym]=[]; S.tickCounts[sym]=0; }
    meta.pip=tick.pip_size; S.precisionKnown[sym]=tick.pip_size;
  }
  S.ticks[sym].push(quote); if(S.ticks[sym].length>1500) S.ticks[sym].shift();
  S.tickCount++; S.tickCounts[sym]=(S.tickCounts[sym]||0)+1; S.tickTimes[sym]=Date.now();
  resolveAI(sym,quote);
  buildCandles(sym,S.tf); onTick(sym);
}

/* ================= DERIV WEBSOCKET ================= */
const DERIV_ENDPOINTS=[
  'wss://ws.derivws.com/websockets/v3',
  'wss://blue.derivws.com/websockets/v3',
  'wss://frontend.derivws.com/websockets/v3',
  'wss://ws.binaryws.com/websockets/v3'
];
function isVerifiedDemoAccount(account){
  if(!account) return false;
  const v=account.is_virtual, type=account.account_type;
  if(type && type!=='demo') return false;
  if(v!==undefined && v!==null && v!==1 && v!==true) return false;
  return v===1 || v===true || (type==='demo' && (v===undefined || v===null));
}
function isTrustedDerivSocketURL(value){
  try{ const url=new URL(value); return url.protocol==='wss:' && !url.username && !url.password && !url.port && (url.hostname==='derivws.com' || url.hostname.endsWith('.derivws.com')); }catch(e){ return false; }
}
function derivURL(ep){ return `${ep||DERIV_ENDPOINTS[0]}?app_id=${encodeURIComponent(S.appId||'1089')}`; }
// Optional reconnect survives reload in this tab, not an explicit disconnect.
// Session storage is readable by scripts/extensions with access to this origin.
const SESSION_TOKEN_KEY='dbx_tab_connection';
function clearTabConnection(){ try{sessionStorage.removeItem(SESSION_TOKEN_KEY); return true;}catch(e){return false;} }
function saveTabConnection(){
  if(!$('rememberTab') || !$('rememberTab').checked){ clearTabConnection(); return; }
  if(!S.connected || !S.token) return;
  try{ sessionStorage.setItem(SESSION_TOKEN_KEY,JSON.stringify({token:S.token,isDemo:S.isDemo})); }
  catch(e){ $('rememberTab').checked=false; toast('Tab storage is unavailable; reconnect after refresh.'); }
}
function restoreTabConnection(){
  try{
    const raw=sessionStorage.getItem(SESSION_TOKEN_KEY); if(!raw) return;
    const saved=JSON.parse(raw);
    if(!saved || typeof saved.token!=='string' || !saved.token || typeof saved.isDemo!=='boolean'){ clearTabConnection(); return; }
    if(S.token){ clearTabConnection(); return; } // OAuth callback takes precedence.
    S.token=saved.token; S.isDemo=saved.isDemo;
    if($('rememberTab')) $('rememberTab').checked=true;
    return true;
  }catch(e){ clearTabConnection(); }
}
function updateTabReconnect(){
  if(!$('rememberTab').checked){
    if(!clearTabConnection()){ $('rememberTab').checked=true; return toast('Could not clear tab storage. Close this tab or clear site data.'); }
    return;
  }
  if(S.connected) saveTabConnection();
}
let _epIdx=0, _connTimer=null, _connectionGeneration=0;
async function connectDeriv(){
  if(S.openContracts.length) return toast('Wait for simulated contracts to settle before connecting.');
  if(S.ws) disconnectDeriv({preserveToken:true});
  if(S.auto.running) stopAutoTrader();
  const generation=++_connectionGeneration;
  const appId = $('appIdInput').value.trim()||'1089';
  const token = $('tokenInput').value.trim()||S.token;
  if(S.token && token!==S.token) clearTabConnection();
  S.appId=appId; S.token=token; $('tokenInput').value='';
  try{localStorage.setItem('dbx_appid',appId); localStorage.removeItem('dbx_token');}catch(e){}
  _epIdx=0;
  // Try new Deriv API (api.derivws.com) first
  if(token){
    logConn('Connecting to Deriv API…');
    try{
      const headers={'Authorization':`Bearer ${token}`,'Content-Type':'application/json'};
      if(appId && appId!=='1089') headers['Deriv-App-ID']=appId;
      const accRes=await fetch('https://api.derivws.com/trading/v1/options/accounts',{headers});
      if(generation!==_connectionGeneration) return;
      if(accRes.ok){
        const accData=await accRes.json();
        if(generation!==_connectionGeneration) return;
        const list=accData.data||accData.accounts||accData||[];
        if(Array.isArray(list) && list.length>0){
          logConn(`Accounts from Deriv: ${list.map(a=>`${a.account_id||a.id||a.loginid}(${a.account_type||(a.is_virtual?'demo':'real')})`).join(', ')}`);
          const target=list.find(a=>S.isDemo?isVerifiedDemoAccount(a):((a.account_type==='real'||a.is_virtual===0||a.is_virtual===false) && a.account_type!=='demo' && a.is_virtual!==1 && a.is_virtual!==true));
          if(!target){ logConn('No account matching the selected Demo/Real mode was returned.'); toast('No account matches the selected mode.'); return; }
          const accId=target.account_id||target.id||target.loginid;
          if(!accId){ logConn('Selected account has no usable ID.'); return; }
          logConn(`✅ Found account ${accId}. Requesting WebSocket OTP…`);
          const otpRes=await fetch(`https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(accId)}/otp`,{method:'POST',headers});
          if(generation!==_connectionGeneration) return;
          if(otpRes.ok){
            const otpData=await otpRes.json();
            if(generation!==_connectionGeneration) return;
            const wsUrl=otpData.url||(otpData.data&&otpData.data.url)||`wss://api.derivws.com/trading/v1/options/ws/${S.isDemo?'demo':'real'}?otp=${otpData.otp||(otpData.data&&otpData.data.otp)}`;
            if(!isTrustedDerivSocketURL(wsUrl)) throw new Error('Deriv returned an untrusted WebSocket URL');
            openNewDerivWS(wsUrl, target);
            return;
          }
        }
      }
    }catch(e){ logConn('New API check failed. Trying WebSocket endpoints…'); }
  }
  if(generation===_connectionGeneration) tryConnect(token);
}
function openNewDerivWS(wsUrl, acc){
  if(!isTrustedDerivSocketURL(wsUrl)) throw new Error('Untrusted Deriv WebSocket URL');
  try{ if(S.ws) S.ws.close(); }catch(e){}
  const ws=new WebSocket(wsUrl); S.ws=ws;
  ws.onopen=()=>{
    if(S.ws!==ws) return;
    activateLiveFeed(ws);
    S.connected=true; S.balance=acc.balance==null?NaN:Number(acc.balance); S.currency=acc.currency||'USD';
    S.isDemo=isVerifiedDemoAccount(acc); S.accountId=String(acc.account_id||acc.loginid||acc.id||''); S.accountName=S.accountId||'Deriv';
    updateConnUI(); resumeAccountTracking(ws); saveTabConnection();
    logConn(`✅ Connected & Authorized! Balance: ${S.currency} ${fmt(S.balance)} (${S.isDemo?'Demo':'Real'})`);
    toast(`Connected to Deriv — ${S.currency} ${fmt(S.balance)}`);
    try{ ws.send(JSON.stringify({balance:1, subscribe:1})); ws.send(JSON.stringify({profit_table:1, description:1, limit:25})); }catch(e){}
  };
  ws.onmessage=(ev)=>{
    if(S.ws!==ws) return;
    let d; try{d=JSON.parse(ev.data);}catch(e){return;}
    const marketHandled=handleMarketDiscovery(d,ws);
    if(d.tick) receiveDerivTick(d.tick,ws);
    if(d.balance){ const newBal=Number(d.balance.balance); if(Number.isFinite(newBal)){ S.balance=newBal; updateConnUI(); } }
    handleManualOrderMessage(d, ws);
    handleAccountContractMessage(d,ws);
    // Account settlement is not yet reconciled into simulator statistics.
    if(d.error && !marketHandled){ logConn('⚠️ Deriv error: '+d.error.message); toast('Deriv: '+d.error.message); }
  };
  ws.onclose=(ev)=>{ if(S.ws!==ws) return; if(S.auto.running && S.auto.mode==='account') stopAutoTrader(); failManualOrder('Connection closed; check your Deriv account before placing another order.'); logConn(`WebSocket closed (code ${ev.code}).`); S.connected=false; S.accountId=''; S.ws=null; restoreSimulationFeed(); updateConnUI(); renderAccountTracking(); };
  ws.onerror=()=>{ logConn('WebSocket error.'); };
}
function tryConnect(token){
  try{ if(S.ws) S.ws.close(); }catch(e){}
  clearTimeout(_connTimer);
  const ep=DERIV_ENDPOINTS[_epIdx];
  logConn('Connecting to Deriv WebSocket API…');
  let authorized=false;
  let ws; try{ ws=new WebSocket(derivURL(ep)); }catch(e){ logConn('⚠️ WebSocket not supported in this browser.'); return; }
  S.ws=ws;
  _connTimer=setTimeout(()=>{ if(ws.readyState===0){ logConn('⏱️ Connection timed out — trying next endpoint…'); try{ws.close();}catch(e){} } }, 10000);
  ws.onopen=()=>{
    clearTimeout(_connTimer);
    if(S.ws!==ws) return;
    logConn('✅ WebSocket open.');
    ws.send(JSON.stringify({active_symbols:'brief', req_id:2}));
    if(token){ ws.send(JSON.stringify({authorize:token, req_id:3})); logConn('Authorizing token…'); }
    else logConn('No token — simulated feed remains active. Paste a token to connect.');
  };
  ws.onmessage=(ev)=>{
    if(S.ws!==ws) return;
    let d; try{d=JSON.parse(ev.data);}catch(e){return;}
    const marketHandled=handleMarketDiscovery(d,ws);
    if(d.tick) receiveDerivTick(d.tick,ws);
    if(d.active_symbols){ logConn(`Received ${d.active_symbols.length} active symbols from Deriv.`); }
    if(d.authorize && d.req_id===3 && !authorized){ authorized=true; activateLiveFeed(ws); S.connected=true; S.balance=+d.authorize.balance; S.currency=d.authorize.currency; S.isDemo=isVerifiedDemoAccount(d.authorize); S.accountId=String(d.authorize.loginid||''); S.accountName=S.accountId||'Deriv'; updateConnUI(); resumeAccountTracking(ws); saveTabConnection(); try{ws.send(JSON.stringify({balance:1,subscribe:1}));}catch(e){} logConn(`✅ Authorized! Balance: ${S.currency} ${fmt(S.balance)} (${S.isDemo?'Demo':'Real'} account)`); toast('Connected to Deriv — balance '+fmt(S.balance)); fetchPortfolio(); }
    if(d.error && !marketHandled){ logConn('⚠️ Deriv error: '+d.error.message); toast('Deriv: '+d.error.message); }
    if(d.balance){ const newBal=Number(d.balance.balance); if(Number.isFinite(newBal)){ S.balance=newBal; updateConnUI(); } }
    handleManualOrderMessage(d, ws);
    handleAccountContractMessage(d,ws);
    if(d.portfolio){ renderPortfolio(d.portfolio); }
    if(d.history){ /* journal sync */ }
    if(d.contract){ /* open contract update */ }
  };
  ws.onclose=(ev)=>{
    if(S.ws!==ws) return;
    if(S.auto.running && S.auto.mode==='account') stopAutoTrader();
    failManualOrder('Connection closed; check your Deriv account before placing another order.');
    clearTimeout(_connTimer);
    logConn(`WebSocket closed (code ${ev.code}${ev.reason?': '+ev.reason:''}).`);
    if(!S.connected && _epIdx < DERIV_ENDPOINTS.length-1){ _epIdx++; logConn('🔄 Trying fallback endpoint…'); const generation=_connectionGeneration; setTimeout(()=>{ if(generation===_connectionGeneration) tryConnect(token); },800); }
    else if(!S.connected){ logConn('⚠️ Could not connect to Deriv. Tips: (1) Create your OWN App ID at api.deriv.com (1089 is shared & often blocked), (2) Disable ad-blocker/VPN, (3) Try Chrome. Demo feed still running.'); }
    S.connected=false; S.accountId=''; S.ws=null; restoreSimulationFeed(); updateConnUI(); renderAccountTracking();
  };
  ws.onerror=()=>{ logConn('WebSocket error — check app_id / network.'); };
}
function disconnectDeriv(options={}){ let storageCleared=true; ++_connectionGeneration; clearTimeout(_connTimer); if(S.auto.running) stopAutoTrader(); const ws=S.ws; S.ws=null; try{ws&&ws.close();}catch(e){} failManualOrder('Disconnected; verify any pending order in Deriv.'); S.connected=false; S.accountId=''; if(!options.preserveToken){ storageCleared=clearTabConnection(); if($('rememberTab')) $('rememberTab').checked=false; S.token=''; if($('tokenInput')) $('tokenInput').value=''; if($('gateTokenInput')) $('gateTokenInput').value=''; try{localStorage.removeItem('dbx_token');}catch(e){} } restoreSimulationFeed(); updateConnUI(); renderAccountTracking(); logConn('Disconnected.'); toast(storageCleared?'Disconnected from Deriv':'Disconnected; could not clear tab storage. Close the tab or clear site data.'); }
function switchAccountMode(mode){
  if(S.connected || S.ws) disconnectDeriv({preserveToken:true});
  if(S.isDemo!==(mode==='demo')) clearTabConnection();
  S.isDemo=(mode==='demo');
  localStorage.setItem('dbx_isdemo', S.isDemo?'1':'0');
  if($('btnDemoAcc')) $('btnDemoAcc').className='btn '+(S.isDemo?'btn-outline':'btn-ghost')+' btn-sm';
  if($('btnRealAcc')) $('btnRealAcc').className='btn '+(!S.isDemo?'btn-red':'btn-ghost')+' btn-sm';
  if(S.token){
    connectDeriv();
  }else if(mode==='real'){
    showView('connect');
    toast('Paste your Deriv API token to connect your Real account');
  }else{
    updateConnUI();
  }
}
function fetchPortfolio(){ if(S.ws&&S.connected) S.ws.send(JSON.stringify({portfolio:1, subscribe:1})); }
function updateConnUI(){
  $('connDot').className='dot'+(S.connected?' live':'');
  $('connLabel').textContent = S.connected ? `Connected · ${S.accountName}` : (REAL_DATA_ONLY?'Disconnected':'Demo Mode');
  $('connBadge').textContent = S.connected ? (S.isDemo?'DEMO':'REAL') : (REAL_DATA_ONLY?'OFFLINE':'DEMO');
  $('connBalance').textContent = REAL_DATA_ONLY && !S.connected?'Account balance unavailable':`${S.currency} ${Number.isFinite(S.balance)?fmt(S.balance):'—'} · ${S.connected ? (S.isDemo?'Demo':'Real') : 'Simulated'} account`;
  if($('sideLoginBtn')) $('sideLoginBtn').style.display = S.connected ? 'none' : 'block';
  $('connSub').textContent = S.connected ? 'Trading through your Deriv account via official API.' : 'Connect a Deriv account to receive market data and trade.';
  $('topConnectBtn').textContent = S.connected ? '✓ Connected' : 'Connect Deriv';
  $('tradeModeBadge').textContent = S.connected ? (S.isDemo?'DEMO ACCOUNT':'REAL ACCOUNT') : (REAL_DATA_ONLY?'DISCONNECTED':'DEMO / MOCK');
  if($('buyBtn')) $('buyBtn').textContent=S.connected?'REQUEST DERIV QUOTE':(REAL_DATA_ONLY?'CONNECT TO REQUEST QUOTE':'BUY SIMULATED CONTRACT');
  if($('proposalBox') && $('contractType') && $('stake') && $('duration') && $('barrier')) updateProposal();
}
function settleRealContract(id){ /* Deriv will send contract updates; journal via history */ }

/* ================= CHART HELPERS ================= */
function setupCanvas(cv){ const r=cv.getBoundingClientRect(); const dpr=window.devicePixelRatio||1; cv.width=(r.width||600)*dpr; cv.height=(+cv.getAttribute('height')||200)*dpr; const ctx=cv.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0); return {ctx,w:r.width||600,h:+cv.getAttribute('height')||200}; }
function drawLineChart(cv, data, color='#00d09c'){
  if(!cv||!data.length) return; const {ctx,w,h}=setupCanvas(cv);
  const min=Math.min(...data), max=Math.max(...data), pad=(max-min)*0.1||1;
  ctx.clearRect(0,0,w,h); ctx.strokeStyle='#16233a'; ctx.lineWidth=1;
  for(let i=1;i<4;i++){ ctx.beginPath(); ctx.moveTo(0,h*i/4); ctx.lineTo(w,h*i/4); ctx.stroke(); }
  ctx.beginPath(); data.forEach((v,i)=>{ const x=i/(data.length-1)*w, y=h-((v-min+pad)/(max-min+2*pad))*h; i?ctx.lineTo(x,y):ctx.moveTo(x,y); });
  ctx.strokeStyle=color; ctx.lineWidth=2; ctx.stroke();
  ctx.lineTo(w,h); ctx.lineTo(0,h); ctx.closePath(); ctx.fillStyle=color+'22'; ctx.fill();
}
function drawCandles(cv, candles, type='candles'){
  if(!cv||!candles.length) return; const {ctx,w,h}=setupCanvas(cv);
  const slice=candles.slice(-80);
  const min=Math.min(...slice.map(c=>c.l)), max=Math.max(...slice.map(c=>c.h)), pad=(max-min)*0.08||1;
  const Y=v=> h-((v-min+pad)/(max-min+2*pad))*h;
  ctx.clearRect(0,0,w,h); ctx.strokeStyle='#16233a';
  for(let i=1;i<5;i++){ ctx.beginPath(); ctx.moveTo(0,h*i/5); ctx.lineTo(w,h*i/5); ctx.stroke(); }
  if(type==='line'||type==='area'){
    ctx.beginPath(); slice.forEach((c,i)=>{ const x=i/(slice.length-1)*w; i?ctx.lineTo(x,Y(c.c)):ctx.moveTo(x,Y(c.c)); });
    ctx.strokeStyle='#2e9bff'; ctx.lineWidth=2; ctx.stroke();
    if(type==='area'){ ctx.lineTo(w,h); ctx.lineTo(0,h); ctx.closePath(); ctx.fillStyle='rgba(46,155,255,.15)'; ctx.fill(); }
    return;
  }
  const bw=w/slice.length;
  slice.forEach((c,i)=>{
    const x=i*bw+bw*0.2, up=c.c>=c.o, col=up?'#00d09c':'#ff444f';
    ctx.strokeStyle=col; ctx.beginPath(); ctx.moveTo(x+bw*0.3,Y(c.h)); ctx.lineTo(x+bw*0.3,Y(c.l)); ctx.stroke();
    ctx.fillStyle=col; const y1=Y(Math.max(c.o,c.c)), y2=Y(Math.min(c.o,c.c)); ctx.fillRect(x,y1,bw*0.6,Math.max(y2-y1,1));
  });
}
function drawBars(cv, labels, values, colors){
  if(!cv) return; const {ctx,w,h}=setupCanvas(cv); ctx.clearRect(0,0,w,h);
  const max=Math.max(...values,1), bw=w/values.length;
  values.forEach((v,i)=>{ const bh=(v/max)*(h-24); ctx.fillStyle=colors?colors[i]:'#2e9bff'; ctx.fillRect(i*bw+4,h-18-bh,bw-8,bh); ctx.fillStyle='#8aa0b8'; ctx.font='11px JetBrains Mono'; ctx.textAlign='center'; ctx.fillText(labels[i],i*bw+bw/2,h-4); ctx.fillStyle='#e8eef7'; ctx.fillText(v,i*bw+bw/2,h-22-bh); });
}
function drawSpark(cv, data){
  if(!cv||data.length<2) return; const {ctx,w,h}=setupCanvas(cv); ctx.clearRect(0,0,w,h);
  const min=Math.min(...data),max=Math.max(...data); ctx.beginPath();
  data.forEach((v,i)=>{ const x=i/(data.length-1)*w, y=h-((v-min)/((max-min)||1))*h; i?ctx.lineTo(x,y):ctx.moveTo(x,y); });
  ctx.strokeStyle=data[data.length-1]>=data[0]?'#00d09c':'#ff444f'; ctx.lineWidth=1.5; ctx.stroke();
}

/* ================= INDICATORS (50+ computed) ================= */
function sma(arr,n){ if(arr.length<n) return null; return arr.slice(-n).reduce((a,b)=>a+b,0)/n; }
function ema(arr,n){ if(arr.length<n) return null; const k=2/(n+1); let e=arr[0]; for(let i=1;i<arr.length;i++) e=arr[i]*k+e*(1-k); return e; }
function rsi(arr,period=14){ if(arr.length<period+1) return null; let g=0,l=0; for(let i=arr.length-period;i<arr.length;i++){ const d=arr[i]-arr[i-1]; if(d>0)g+=d; else l-=d; } if(l===0) return g===0?50:100; const rs=(g/period)/(l/period); return 100-100/(1+rs); }
function macd(arr){
  if(arr.length<34) return null;
  const values=[]; let e12=arr[0],e26=arr[0];
  for(let i=1;i<arr.length;i++){
    e12+=(arr[i]-e12)*(2/13); e26+=(arr[i]-e26)*(2/27);
    if(i>=25) values.push(e12-e26);
  }
  if(values.length<9) return null;
  let signal=values.slice(0,9).reduce((a,b)=>a+b,0)/9;
  for(let i=9;i<values.length;i++) signal+=(values[i]-signal)*(2/10);
  const line=values[values.length-1]; return {macd:line,signal,hist:line-signal};
}
function bollinger(arr,n=20){ const m=sma(arr,n); if(m==null) return null; const v=arr.slice(-n).reduce((a,b)=>a+(b-m)**2,0)/n; const sd=Math.sqrt(v); return {upper:m+2*sd,mid:m,lower:m-2*sd}; }
function stochastic(candles,n=14){ if(candles.length<n) return null; const s=candles.slice(-n); const hh=Math.max(...s.map(c=>c.h)), ll=Math.min(...s.map(c=>c.l)); return hh===ll?50:(s[s.length-1].c-ll)/(hh-ll)*100; }
function atr(candles,n=14){ if(candles.length<=n) return null; let sum=0; for(let i=candles.length-n;i<candles.length;i++){ const c=candles[i],p=candles[i-1]; sum+=Math.max(c.h-c.l,Math.abs(c.h-p.c),Math.abs(c.l-p.c)); } return sum/n; }
function computeIndicators(sym){
  const ticks=S.ticks[sym]||[], candles=S.candles[sym]||[];
  const last=ticks[ticks.length-1];
  const bb=bollinger(ticks), m=macd(ticks), st=stochastic(candles), a=atr(candles);
  const inds=[
    ['Price',last==null?'—':(S.feed==='deriv' && S.precisionKnown[sym]===undefined?String(last):fmtPrice(last,symByCode(sym).pip))],['SMA 20',sma(ticks,20)?fmtPrice(sma(ticks,20),2):'—'],['SMA 50',sma(ticks,50)?fmtPrice(sma(ticks,50),2):'—'],
    ['EMA 12',ema(ticks,12)?fmtPrice(ema(ticks,12),2):'—'],['EMA 26',ema(ticks,26)?fmtPrice(ema(ticks,26),2):'—'],
    ['RSI 14',rsi(ticks)!=null?rsi(ticks).toFixed(1):'—'],['MACD',m?m.macd.toFixed(2):'—'],['MACD Signal',m?m.signal.toFixed(2):'—'],
    ['Bollinger Upper',bb?fmtPrice(bb.upper,2):'—'],['Bollinger Lower',bb?fmtPrice(bb.lower,2):'—'],
    ['Stochastic %K',st!=null?st.toFixed(1):'—'],['ATR 14',a!=null?fmtPrice(a,2):'—'],
    ['SMA 30',sma(ticks,30)?fmtPrice(sma(ticks,30),2):'—'],['Momentum 10',ticks.length>10?(ticks[ticks.length-1]-ticks[ticks.length-11]).toFixed(2):'—'],
    ['Volatility (σ)',ticks.length>20? (Math.sqrt(ticks.slice(-20).reduce((a,b)=>a+(b-sma(ticks,20))**2,0)/20)).toFixed(3):'—'],
    ['Trend', sma(ticks,20)==null?'—':last>sma(ticks,20)?'Above SMA 20':last<sma(ticks,20)?'Below SMA 20':'At SMA 20'],
  ];
  /* Unimplemented indicators are intentionally not displayed.
  const extra=['Williams %R','CCI 20','OBV','Ichimoku Tenkan','Ichimoku Kijun','Parabolic SAR','Fibonacci 38.2%','Fibonacci 61.8%','Pivot Point','Resistance','Support','Donchian Upper','Donchian Lower','Keltner Upper','Keltner Lower','Chaikin Money Flow','Force Index','Elliott Wave','Harmonic Pattern','Price Channel','Envelope Upper','Envelope Lower','TRIX','Ultimate Oscillator','Awesome Oscillator','DeMarker','Bull Power','Bear Power','Relative Vigor','Ease of Movement','Mass Index','Pring Special K','QStick','Twiggs Money Flow'];
  extra.forEach((n,i)=> inds.push([n, (Math.random()*100).toFixed(1)])); */
  return inds;
}

/* ================= DIGIT ANALYSIS ================= */
function digitStats(sym, ticks=S.ticks[sym]||[]){
  if(REAL_DATA_ONLY && (S.feed!=='deriv' || S.precisionKnown[sym]===undefined)) ticks=[];
  const digits=ticks.map(p=>lastDigit(p,sym));
  const n=digits.length; const divisor=n||1;
  const freq=Array(10).fill(0); digits.forEach(d=>freq[d]++);
  const even=digits.filter(d=>d%2===0).length, odd=n-even;
  const over={}, under={};
  for(let b=0;b<10;b++){ const cnt=digits.filter(d=>d>b).length; over[b]=cnt/divisor*100; under[b]=digits.filter(d=>d<b).length/divisor*100; }
  const match={}; for(let b=0;b<10;b++) match[b]=freq[b]/divisor*100;
  // rise/fall
  let rise=0,fall=0; for(let i=1;i<ticks.length;i++){ if(ticks[i]>ticks[i-1])rise++; else if(ticks[i]<ticks[i-1])fall++; }
  // transitions
  const trans=Array.from({length:10},()=>Array(10).fill(0));
  for(let i=1;i<digits.length;i++) trans[digits[i-1]][digits[i]]++;
  const transPct=trans.map(row=>{ const s=row.reduce((a,b)=>a+b,0)||1; return row.map(v=>v/s*100); });
  // streaks & gaps
  const streaks={}; let cur=digits[digits.length-1], cnt=1;
  for(let i=digits.length-2;i>=0;i--){ if(digits[i]===cur) cnt++; else break; }
  streaks[cur]=cnt;
  const gaps=Array(10).fill(0); const lastSeen=Array(10).fill(-1);
  digits.forEach((d,i)=>{ lastSeen[d]=i; });
  for(let d=0;d<10;d++) gaps[d]= lastSeen[d]===-1? n : n-1-lastSeen[d];
  return {digits,freq,evenPct:even/divisor*100,oddPct:odd/divisor*100,over,under,match,risePct:rise/((rise+fall)||1)*100,fallPct:fall/((rise+fall)||1)*100,transPct,gaps,streaks,n};
}
function renderDigits(){
  const sym=S.selected, st=digitStats(sym);
  $('digitSample').textContent=st.n; $('digitSymLabel').textContent=symByCode(sym).name;
  if(!st.n){ ['lastDigits','digitLegend','overUnderTable','parityPanel','transitionMatrix','streakPanel'].forEach(id=>{ $(id).textContent='Waiting for ticks and verified Deriv precision.'; }); ['digitFreqChart','distChart','dcircles'].forEach(id=>{ const cv=$(id); if(cv && cv.getContext){const c=cv.getContext('2d'); if(c) c.clearRect(0,0,cv.width,cv.height);} }); return; }
  const last20=st.digits.slice(-20).reverse();
  $('lastDigits').innerHTML=last20.map(d=>`<div class="digit-ball ${d%2===0?'even':'odd'}" title="${d%2===0?'Even':'Odd'}">${d}</div>`).join('');
  drawBars($('digitFreqChart'), ['0','1','2','3','4','5','6','7','8','9'], st.freq.map(v=>Math.round(v/(st.n||1)*100)+'%'), ['#ff444f','#ffb020','#00d09c','#2e9bff','#b388ff','#ff7a45','#00d09c','#ffb020','#2e9bff','#ff444f']);
  $('digitLegend').innerHTML = st.freq.map((f,i)=>`<span>${i}: ${Math.round(f/(st.n||1)*100)}%</span>`).join('');
  $('overUnderTable').innerHTML = [0,1,2,3,4,5,6,7,8,9].map(b=>`<div class="ou-row"><span>Barrier <b>${b}</b></span><span>OVER <b class="up">${st.over[b].toFixed(1)}%</b></span><div class="bar"><i style="width:${st.over[b]}%"></i></div><span>UNDER <b>${st.under[b].toFixed(1)}%</b></span></div>`).join('');
  $('parityPanel').innerHTML = `
    <div class="big-stat"><span>Even</span><b class="up">${st.evenPct.toFixed(1)}%</b></div>
    <div class="big-stat"><span>Odd</span><b style="color:var(--amber)">${st.oddPct.toFixed(1)}%</b></div>
    <div class="big-stat"><span>Rise (price ↑)</span><b class="up">${st.risePct.toFixed(1)}%</b></div>
    <div class="big-stat"><span>Fall (price ↓)</span><b class="down">${st.fallPct.toFixed(1)}%</b></div>
    <div class="big-stat"><span>Best Matches digit</span><b>${st.match? Object.entries(st.match).sort((a,b)=>b[1]-a[1])[0][0] : '—'} (${Math.max(...Object.values(st.match||{0:0})).toFixed(1)}%)</b></div>
    <div class="big-stat"><span>Best Differs digit</span><b>${Object.entries(st.match).sort((a,b)=>a[1]-b[1])[0][0]} (${(100-Object.entries(st.match).sort((a,b)=>a[1]-b[1])[0][1]).toFixed(1)}%)</b></div>`;
  // transition matrix
  let html='<table class="matrix"><tr><th>→</th>'+Array.from({length:10},(_,i)=>`<th>${i}</th>`).join('')+'</tr>';
  st.transPct.forEach((row,i)=>{ html+=`<tr><th>${i}</th>`+row.map(v=>{ const bg=v>15?'rgba(0,208,156,.35)':v>11?'rgba(255,176,32,.25)':'transparent'; return `<td style="background:${bg}">${v.toFixed(0)}</td>`; }).join('')+'</tr>'; });
  $('transitionMatrix').innerHTML=html+'</table>';
  const hot=[...st.freq.keys()].sort((a,b)=>st.freq[b]-st.freq[a]);
  $('streakPanel').innerHTML = `
    <div class="streak-row"><span>🔥 Hottest digit</span><b>${hot[0]} (${Math.round(st.freq[hot[0]]/(st.n||1)*100)}%)</b></div>
    <div class="streak-row"><span>❄️ Coldest digit</span><b>${hot[9]} (${Math.round(st.freq[hot[9]]/(st.n||1)*100)}%)</b></div>
    <div class="streak-row"><span>Current streak</span><b>Digit ${st.digits[st.digits.length-1]} × ${st.streaks[st.digits[st.digits.length-1]]||1}</b></div>
    ${st.gaps.map((g,i)=>`<div class="streak-row"><span>Gap — digit ${i}</span><b>${g} ticks</b></div>`).join('')}`;
  // D-circles
  const cv=$('dcircles'); if(cv){ const {ctx,w,h}=setupCanvas(cv); ctx.clearRect(0,0,w,h); const cx=w/2,cy=h/2,R=Math.min(w,h)/2-14;
    st.freq.forEach((f,i)=>{ const ang=(i/10)*Math.PI*2-Math.PI/2; const x=cx+Math.cos(ang)*R, y=cy+Math.sin(ang)*R; const pct=f/(st.n||1); ctx.beginPath(); ctx.arc(x,y,10+pct*22,0,7); ctx.fillStyle=`hsl(${i*36},80%,55%)`; ctx.globalAlpha=.85; ctx.fill(); ctx.globalAlpha=1; ctx.fillStyle='#fff'; ctx.font='bold 11px JetBrains Mono'; ctx.textAlign='center'; ctx.fillText(i,x,y+4); });
    ctx.fillStyle='#8aa0b8'; ctx.font='11px Inter'; ctx.fillText('D-Circles — size = frequency',cx,cy+4);
  }
  drawBars($('distChart'), ['0','1','2','3','4','5','6','7','8','9'], st.freq.map(v=>+(v/(st.n||1)*100).toFixed(1)), null);
}

/* ================= SIGNALS ================= */
function computeSignals(){
  const out=[];
  SYMBOLS.forEach(s=>{
    const st=digitStats(s.sym); if(st.n<50) return;
    // best over/under
    let bestOU={type:'OVER',barrier:5,win:50};
    for(let b=0;b<10;b++){ if(st.over[b]>bestOU.win) bestOU={type:'OVER',barrier:b,win:st.over[b]}; if(st.under[b]>bestOU.win) bestOU={type:'UNDER',barrier:b,win:st.under[b]}; }
    const parity = st.evenPct>st.oddPct? {type:'EVEN',win:st.evenPct}:{type:'ODD',win:st.oddPct};
    const bestMatch = Object.entries(st.match).sort((a,b)=>b[1]-a[1])[0];
    const differsWin = 100 - (+bestMatch[1]);
    const riseFall = st.risePct>st.fallPct? {type:'RISE',win:st.risePct}:{type:'FALL',win:st.fallPct};
    const candidates=[
      {sym:s.sym,name:s.name,signal:`${bestOU.type} ${bestOU.barrier}`,win:bestOU.win,conf:bestOU.win,sample:st.n},
      {sym:s.sym,name:s.name,signal:parity.type,win:parity.win,conf:parity.win,sample:st.n},
      {sym:s.sym,name:s.name,signal:`DIFFERS ${bestMatch[0]}`,win:differsWin,conf:Math.min(98,differsWin),sample:st.n},
      {sym:s.sym,name:s.name,signal:riseFall.type,win:riseFall.win,conf:riseFall.win,sample:st.n},
    ];
    candidates.sort((a,b)=>b.win-a.win); out.push(candidates[0]);
  });
  return out.sort((a,b)=>b.win-a.win);
}
function renderSignals(){
  const sigs=computeSignals(); const only=$('onlyEdge')?.checked;
  const shown=only? sigs.filter(s=>s.win>55):sigs;
  $('signalPill').textContent=shown.length;
  $('signalCards').innerHTML=shown.slice(0,8).map(s=>`
    <div class="signal-card"><div class="head"><div><b>${s.name}</b><div class="muted small mono">${s.sym}</div></div><div class="conf" style="color:${s.win>55?'var(--green)':'var(--amber)'}">${s.win.toFixed(1)}%</div></div>
    <div style="font-size:20px;font-weight:800">⚡ ${s.signal}</div><div class="edge-bar"><i style="width:${s.win}%"></i></div>
    <div class="muted small">Observed frequency · Sample ${s.sample} ticks</div>
    <button class="btn btn-red btn-sm btn-block" style="margin-top:10px" onclick="selectSymbol('${s.sym}');showView('trade')">Trade this →</button></div>`).join('')||'<p class="muted">Not enough observed ticks for these calculations.</p>';
  $('signalTable').innerHTML=`<tr><th>Symbol</th><th>Signal</th><th>Observed frequency</th><th>Score</th><th>Sample</th><th></th></tr>`+
    shown.map(s=>`<tr><td>${s.name}</td><td><b>${s.signal}</b></td><td><span class="pill-win">${s.win.toFixed(1)}%</span></td><td>${s.conf.toFixed(0)}%</td><td>${s.sample}</td><td><button class="btn btn-ghost btn-sm" onclick="selectSymbol('${s.sym}');showView('digits')">Analyse</button></td></tr>`).join('');
  $('dashSignals').innerHTML=sigs.slice(0,5).map(s=>`<div class="ou-row"><span>${s.name} — <b>${s.signal}</b></span><span class="pill-win">${s.win.toFixed(1)}%</span></div>`).join('')||'<p class="muted small">Waiting for enough live ticks.</p>';
  $('scanInfo').textContent=`Scanned ${sigs.length} symbols · ${new Date().toLocaleTimeString()}`;
}
function scanSignals(manual){ renderSignals(); if(manual) toast('⚡ Signals scanned across all symbols'); }

/* ================= TRADING ================= */
function updateProposal(){
  const type=$('contractType').value, barrier=+$('barrier').value, stake=+$('stake').value, dur=+$('duration').value;
  if(REAL_DATA_ONLY && !S.connected){ $('proposalBox').textContent='Connect to Deriv to request an actual quote.'; return {type,barrier,stake,dur}; }
  if(S.connected){
    $('proposalBox').textContent=`${type} on ${S.selected} · Barrier: ${barrier} · Stake: ${S.currency} ${fmt(stake)} · Duration: ${dur} ticks. Request a quote to see Deriv's actual price and payout; no order is placed without confirmation.`;
    return {type,barrier,stake,dur};
  }
  const payoutMap={DIGITOVER:0.92,DIGITUNDER:0.92,DIGITEVEN:0.95,DIGITODD:0.95,DIGITMATCH:8.5,DIGITDIFF:0.12,CALL:0.9,PUT:0.9};
  const profit=stake*(payoutMap[type]||0.9);
  $('proposalBox').innerHTML=`<b>${htmlEscape(type)}</b> on <b>${htmlEscape(S.selected)}</b><br>Barrier: ${barrier} · Stake: $${fmt(stake)} · Duration: ${dur} ticks<br>Illustrative simulation only — not a Deriv quote: <b class="up">$${fmt(stake+profit)}</b> payout · Est. profit: <b class="up">$${fmt(profit)}</b>`;
  return {type,barrier,stake,dur,profit};
}
function renderProposal(p,order){ $('proposalBox').textContent=`Deriv quote for ${order.type} on ${order.symbol} · Barrier: ${order.barrier} · Duration: ${order.dur} ticks · Ask: ${order.currency} ${fmt(p.ask_price)} · Payout: ${order.currency} ${fmt(p.payout)} · Quote ID: ${p.id}. A quote may expire; request another to trade.`; }
function buyContract(){
  const p=updateProposal();
  if(REAL_DATA_ONLY && !S.connected) return toast('Connect to Deriv to request an account quote.');
  if(!Number.isFinite(p.stake) || p.stake<=0 || !Number.isInteger(p.dur) || p.dur<1 || !Number.isInteger(p.barrier) || p.barrier<0 || p.barrier>9) return toast('Enter a positive stake, whole-number duration and barrier from 0 to 9.');
  if(S.connected){
    if(REAL_DATA_ONLY && (!Array.isArray(S.activeMarkets) || !S.activeMarkets.includes(S.selected))) return toast('Wait for an available Deriv market before requesting a quote.');
    if(S.auto.running && S.auto.mode==='account') return toast('Stop the account bot before placing a manual order.');
    if(!S.ws || S.ws.readyState!==1) return toast('Connection unavailable; no order was sent.');
    if(S.manualOrder || S.uncertainOrder) return toast('Review the pending or uncertain order before trading again.');
    if(!S.accountId) return toast('Account identity unavailable; no order was sent.');
    if(!Number.isFinite(S.balance) || p.stake>S.balance) return toast('Stake exceeds the available account balance.');
    const cap=Number(S.risk.maxStakePct);
    if(!Number.isFinite(cap) || cap<=0 || cap>100 || p.stake>S.balance*cap/100) return toast('Stake exceeds your configured maximum stake percentage.');
    const req=++S.orderSeq;
    S.manualOrder={phase:'proposal', req, symbol:S.selected, accountId:S.accountId, currency:S.currency, ...p};
    try { S.ws.send(JSON.stringify({proposal:1, amount:p.stake, basis:'stake', contract_type:p.type, currency:S.currency, duration:p.dur, duration_unit:'t', symbol:S.selected, ...(['DIGITOVER','DIGITUNDER','DIGITMATCH','DIGITDIFF'].includes(p.type)?{barrier:String(p.barrier)}:{}), req_id:req})); }
    catch(e){ failManualOrder('Could not request a proposal.'); return; }
    setTimeout(()=>{ if(S.manualOrder && S.manualOrder.phase==='proposal' && S.manualOrder.req===req) failManualOrder('Quote request timed out; no purchase sent.'); },15000);
    renderAccountTracking(); toast('Requesting an account quote — no purchase yet.'); return;
  }
  if(!Object.hasOwn(SIM_PROFIT_RATES,p.type)) return toast('This contract type is not supported in the simulator.');
  const riskError=checkSimulationRisk(p.stake); if(riskError) return toast(riskError);
  // mock buy
  const id='MOCK-'+Math.floor(rand(100000,999999));
  const c={id,type:p.type,symbol:S.selected,stake:p.stake,barrier:p.barrier,dur:p.dur,entryTick:S.tickCounts[S.selected]||0,entryPrice:S.ticks[S.selected][S.ticks[S.selected].length-1],status:'OPEN'};
  S.openContracts.push(c); renderOpenContracts(); toast(`✅ Bought ${p.type} (mock) — settles in ${p.dur} ticks`);
  addAlert(`Bought ${p.type} on ${S.selected} for $${p.stake}`);
}

// Account records are separate from the simulation journal. The write-ahead marker
// is persisted before a buy so a refresh cannot silently permit a duplicate order.
function saveAccountData(key,value){
  try{ localStorage.setItem(key,JSON.stringify(value)); return true; }
  catch(e){ return false; }
}
function renderAccountTracking(){
  const status=$('accountOrderStatus');
  if(status){
    const uncertain=!!S.uncertainOrder;
    status.textContent=uncertain?(S.uncertainOrder.trackingDamaged?'ACCOUNT TRACKING UNAVAILABLE OR DAMAGED — verify account history and open contracts in Deriv before acknowledging.':'BUY STATUS UNKNOWN — verify account history in Deriv before acknowledging.'):(S.manualOrder?'Account order in progress.':'No uncertain account order.');
  }
  if($('ackOrderBtn')) $('ackOrderBtn').style.display=S.uncertainOrder?'':'none';
  const list=$('accountContracts'); if(!list) return;
  const records=Array.isArray(S.accountContracts)?S.accountContracts:[];
  const current=records.filter(c=>c.accountId===S.accountId).slice(0,20);
  // Build nodes with textContent: contract data may originate outside the app.
  list.textContent='';
  if(!S.connected || !S.accountId){ list.textContent='Connect an account to see locally tracked contracts. Check Deriv for the authoritative history.'; return; }
  if(!current.length){ list.textContent='No locally tracked contracts for this account. Check Deriv for the complete history.'; return; }
  current.forEach(c=>{
    const row=document.createElement('div'); row.className='contract';
    const amount=Number.isFinite(c.profit)?` · P/L ${c.currency} ${fmt(c.profit)}`:'';
    row.textContent=`${c.type} ${c.symbol} · ID ${c.id} · ${c.status}${amount}`;
    list.appendChild(row);
  });
}
function acknowledgeUncertainOrder(){
  if(!S.uncertainOrder) return;
  if(!window.confirm(S.uncertainOrder.trackingDamaged?'Local account tracking could not be read. Check account history and open contracts in Deriv. Clearing discards damaged local tracking; continue only after checking?':'Have you checked the correct Deriv account history and verified whether this order was placed? Only clear this warning after checking.')) return;
  if(S.uncertainOrder.trackingDamaged && !saveAccountData('dbx_account_contracts',[])) return toast('Could not reset damaged tracking; trading remains blocked.');
  if(!saveAccountData('dbx_uncertain_order',null)) return toast('Could not save the acknowledgement; trading remains blocked.');
  S.uncertainOrder=null; S.manualOrder=null; renderAccountTracking();
  toast('Warning cleared. Continue to monitor your Deriv account.');
}
function failManualOrder(message,definitive=false){
  if(!S.manualOrder) return;
  const isBot=S.manualOrder.kind==='auto';
  if(S.manualOrder.phase==='buy' && !definitive){
    // The persisted marker stays in place; do not automatically retry.
    S.manualOrder=null;
    message+=' Buy status is unknown. Check Deriv account history before trading again.';
  } else {
    S.manualOrder=null;
    if(definitive && S.uncertainOrder){
      if(saveAccountData('dbx_uncertain_order',null)) S.uncertainOrder=null;
    }
  }
  if(isBot && S.auto.running && S.auto.mode==='account') stopAutoTrader();
  renderAccountTracking(); logConn(message); toast(message);
}
function safeContractId(id){ return /^\d+$/.test(String(id)) && Number.isSafeInteger(Number(id)) && Number(id)>0; }
function subscribeAccountContract(ws,id){
  if(!safeContractId(id)){ logConn('Invalid contract ID; check Deriv for settlement.'); return; }
  try{ ws.send(JSON.stringify({proposal_open_contract:1,contract_id:Number(id),subscribe:1})); }
  catch(e){ logConn('Could not subscribe to contract updates. Check Deriv for contract '+id+'.'); }
}
function resumeAccountTracking(ws){
  if(Array.isArray(S.accountContracts) && S.accountId){
    S.accountContracts.filter(c=>c.accountId===S.accountId && c.status==='OPEN' && safeContractId(c.id)).forEach(c=>subscribeAccountContract(ws,c.id));
  }
  renderAccountTracking();
}
function handleAccountContractMessage(d,ws){
  if(ws!==S.ws || !d.proposal_open_contract || !Array.isArray(S.accountContracts)) return;
  const poc=d.proposal_open_contract, id=String(poc.contract_id||'');
  const record=S.accountContracts.find(c=>c.accountId===S.accountId && String(c.id)===id);
  if(!record || record.status!=='OPEN') return;
  if(poc.is_sold!==1 && poc.is_sold!==true) return;
  const profit=Number(poc.profit);
  if(poc.profit==null || !Number.isFinite(profit)){ logConn('Settlement for '+id+' has no valid profit; check Deriv.'); return; }
  const updated={...record,status:'SETTLED',profit};
  const records=S.accountContracts.map(c=>c===record?updated:c);
  if(!saveAccountData('dbx_account_contracts',records)){ logConn('Could not save settlement; check Deriv for contract '+id+'.'); return; }
  S.accountContracts=records; renderAccountTracking();
  if(record.botSessionId && record.botSessionId===S.auto.sessionId && record.accountId===S.auto.accountId){
    if(profit===0){ S.auto.totalPayout=(S.auto.totalPayout||0)+record.stake; S.auto.curStake=S.auto.stake; autoLog('Account contract settled at break-even; verify in Deriv.'); renderAutoStats(); }
    else onAutoSettle({type:record.type,stake:record.stake,profit,win:profit>0});
  }
  toast('Account contract '+id+' settled; check Deriv for details.');
  const sub=d.subscription && d.subscription.id;
  if(sub){ try{ws.send(JSON.stringify({forget:sub}));}catch(e){} }
}
function handleManualOrderMessage(d, ws){
  const order=S.manualOrder;
  if(!order || ws!==S.ws) return;
  if(d.error && d.req_id===order.req){ failManualOrder('Deriv order error: '+d.error.message,true); return; }
  if(order.phase==='proposal' && d.req_id===order.req && d.proposal){
    const quote=d.proposal, ask=Number(quote.ask_price), payout=Number(quote.payout);
    if(!quote.id || !Number.isFinite(ask) || ask<=0 || ask>order.stake || !Number.isFinite(payout) || payout<=0) return failManualOrder('Invalid or higher-than-requested quote; no purchase sent.');
    if(order.kind!=='auto') renderProposal(quote,order);
    if(order.kind==='auto'){
      checkAutoTimer();
      if(!S.auto.running || S.auto.mode!=='account' || S.auto.sessionId!==order.botSessionId || !S.isDemo || Date.now()-order.createdAt>10000) return failManualOrder('Bot stopped, quote expired, or account changed; no purchase sent.');
      const guard=checkAccountBotRisk(ask);
      if(guard) return failManualOrder(guard);
    }else{
      const confirmed=window.confirm(`ACCOUNT TRADE (${S.isDemo?'DEMO':'REAL'})\n${order.type} on ${order.symbol}\nBarrier: ${order.barrier}; duration: ${order.dur} ticks\nCost: ${S.currency} ${ask.toFixed(2)}; payout: ${S.currency} ${payout.toFixed(2)}\nYou may lose the full stake. Buy this contract?`);
      if(!confirmed){ S.manualOrder=null; renderAccountTracking(); toast('Account order cancelled.'); return; }
    }
    if(!S.connected || S.ws!==ws || ws.readyState!==1 || order.accountId!==S.accountId) return failManualOrder('Connection or account changed; no purchase sent.');
    const marker={accountId:order.accountId,symbol:order.symbol,type:order.type,stake:ask,currency:order.currency,createdAt:Date.now(),kind:order.kind||'manual',botSessionId:order.botSessionId||null};
    if(!saveAccountData('dbx_uncertain_order',marker)) return failManualOrder('Unable to save order safety marker; no purchase sent.');
    S.uncertainOrder=marker; order.ask=ask; order.phase='buy'; order.req=++S.orderSeq; renderAccountTracking();
    try { ws.send(JSON.stringify({buy:quote.id, price:ask, req_id:order.req})); }
    catch(e){ return failManualOrder('Buy could not be confirmed.'); }
    const request=order.req;
    setTimeout(()=>{ if(S.manualOrder && S.manualOrder.phase==='buy' && S.manualOrder.req===request) failManualOrder('No buy response received.'); },15000);
  } else if(order.phase==='buy' && d.req_id===order.req && d.buy){
    const id=String(d.buy.contract_id||'');
    if(!safeContractId(id)) return failManualOrder('Buy response did not include a safely representable contract ID.');
    const records=Array.isArray(S.accountContracts)?S.accountContracts:[];
    const contract={id,accountId:order.accountId,symbol:order.symbol,type:order.type,stake:order.ask,currency:order.currency,status:'OPEN',createdAt:Date.now(),botSessionId:order.kind==='auto'?order.botSessionId:null};
    const all=[contract,...records.filter(c=>!(c.accountId===contract.accountId && String(c.id)===id))];
    const updated=[...all.filter(c=>c.status==='OPEN'),...all.filter(c=>c.status!=='OPEN').slice(0,200)];
    if(!saveAccountData('dbx_account_contracts',updated)) return failManualOrder('Purchase confirmed but local tracking could not be saved.');
    S.accountContracts=updated;
    if(!saveAccountData('dbx_uncertain_order',null)) return failManualOrder('Purchase confirmed but the safety marker could not be cleared.');
    S.uncertainOrder=null; S.manualOrder=null; renderAccountTracking();
    if(order.kind==='auto' && S.auto.sessionId===order.botSessionId){ S.auto.trades++; S.auto.totalStake=(S.auto.totalStake||0)+order.ask; autoLog(`Demo account BUY ${order.type} ${order.symbol} ${order.currency} ${fmt(order.ask)} · contract ${id}`,'info'); renderAutoStats(); }
    subscribeAccountContract(ws,id);
    toast('Account contract purchased: '+id+'.'); logConn('Account contract purchased: '+id+'. Check Deriv for the authoritative status.');
  }
}

function quickTrade(type){ $('contractType').value=type; showView('trade'); updateProposal(); }

// Educational fixed payout assumptions, NOT Deriv quotes or expected returns.
const SIM_PROFIT_RATES={DIGITOVER:0.92,DIGITUNDER:0.92,DIGITEVEN:0.95,DIGITODD:0.95,DIGITMATCH:8.5,DIGITDIFF:0.12,CALL:0.9,PUT:0.9};
function simulateSettlement(c, exit){
  const d=lastDigit(exit,c.symbol);
  const outcomes={DIGITOVER:()=>d>c.barrier,DIGITUNDER:()=>d<c.barrier,DIGITEVEN:()=>d%2===0,DIGITODD:()=>d%2===1,DIGITMATCH:()=>d===c.barrier,DIGITDIFF:()=>d!==c.barrier,CALL:()=>exit>c.entryPrice,PUT:()=>exit<c.entryPrice};
  if(!outcomes[c.type] || !Number.isFinite(exit) || !Number.isFinite(c.stake)) return null;
  const win=outcomes[c.type]();
  return {win,profit:win?c.stake*SIM_PROFIT_RATES[c.type]:-c.stake};
}
// Simulator-only half-Kelly using the decision score as an assumed probability.
// Fixed SIM_PROFIT_RATES are illustrative and ignore real prices and fees.
function simulatedKellyStake(balance,cap,score,type){
  const rate=Object.hasOwn(SIM_PROFIT_RATES,type)?SIM_PROFIT_RATES[type]:null;
  if(!Number.isFinite(balance) || balance<=0 || !Number.isFinite(cap) || cap<=0 || !Number.isFinite(score) || score<0 || score>100 || !Number.isFinite(rate) || rate<=0) return null;
  const p=score/100, fullKelly=(p*rate-(1-p))/rate;
  return Math.min(cap,balance*Math.max(0,fullKelly)/2);
}
// Sizing policies are deterministic simulations, not loss-recovery guarantees.
function nextSimStake(stake,base,recovery,win,state={},profit=0){
  if(recovery==='fibonacci'){
    state.fibIndex=Math.max(0,(state.fibIndex||0)+(win?-2:1));
    if(state.fibIndex>30) return Infinity; // stop rather than grow without bound
    let a=1,b=1;
    for(let i=0;i<state.fibIndex;i++) [a,b]=[b,a+b];
    return base*a;
  }
  if(recovery==='paroli'){
    state.winStreak=win?(state.winStreak||0)+1:0;
    if(state.winStreak>=3){ state.winStreak=0; return base; }
    return win?stake*2:base;
  }
  if(recovery==='oscar'){
    state.cyclePnl=(state.cyclePnl||0)+profit;
    if(state.cyclePnl>=base-1e-9){ state.cyclePnl=0; return base; }
    // Cap the stake to the remaining target in stake units, not guaranteed payout.
    return Math.min(win?stake+base:stake,base-state.cyclePnl);
  }
  if(win) return base;
  if(recovery==='martingale') return stake*2;
  if(recovery==='dalembert') return stake+base;
  if(recovery==='ai') return stake*1.5;
  return base;
}

function settleMock(){
  S.openContracts.slice().forEach(c=>{
    if((S.tickCounts[c.symbol]||0) - c.entryTick >= c.dur){
      const ticks=S.ticks[c.symbol]; const exit=ticks[ticks.length-1]; const d=lastDigit(exit,c.symbol);
      const result=simulateSettlement(c,exit);
      if(!result) return;
      const {win,profit}=result;
      S.balance+=profit; S.equity.push(S.balance); recordSimulationResult(profit);
      const entry={id:c.id,type:c.type,symbol:c.symbol,stake:c.stake,barrier:c.barrier,entry:c.entryPrice,exit,digit:d,win,profit,time:new Date().toLocaleTimeString(),source:c.auto?'Simulated bot':'Simulated manual'};
      S.journal.unshift(entry); saveJournal();
      S.openContracts=S.openContracts.filter(x=>x.id!==c.id);
      addAlert(`${win?'✅ WIN':'❌ LOSS'} ${c.type} ${c.symbol} — ${profit>=0?'+':''}$${fmt(profit)}`);
      if(c.auto) onAutoSettle(entry);
      renderOpenContracts(); renderJournal(); updateConnUI();
    }
  });
}
function renderOpenContracts(){
  if(REAL_DATA_ONLY){ $('openCount').textContent=''; $('openContracts').textContent='Local account contracts appear in Account contract tracking below. Check Deriv for the complete list.'; renderPortfolio(); return; }
  $('openCount').textContent=S.openContracts.length+' open';
  $('openContracts').innerHTML=S.openContracts.length? S.openContracts.map(c=>`<div class="contract"><div class="row"><b>${c.type}</b><span>${c.symbol}</span><span class="pill-win">OPEN</span></div><div class="row"><span>Stake</span><b>$${fmt(c.stake)}</b></div><div class="row"><span>Barrier</span><b>${c.barrier}</b></div><div class="row"><span>Entry</span><b>${fmtPrice(c.entryPrice)}</b></div></div>`).join('') : '<p class="muted">No open contracts. Place a trade to see it here.</p>';
  renderPortfolio();
}
function renderPortfolio(){
  if(REAL_DATA_ONLY && !S.connected){ $('portfolioBox').textContent='Connect to Deriv to view account balance. Check Deriv for your portfolio.'; return; }
  if(S.connected){ $('portfolioBox').textContent=`Account balance: ${S.currency} ${Number.isFinite(S.balance)?fmt(S.balance):'unavailable'}. Check Deriv for open contracts and account P/L.`; return; }
  const openStake=S.openContracts.reduce((a,c)=>a+c.stake,0);
  $('portfolioBox').innerHTML=`<div class="big-stat"><span>Balance</span><b>$${fmt(S.balance)}</b></div><div class="big-stat"><span>Open stake</span><b>$${fmt(openStake)}</b></div><div class="big-stat"><span>Session P/L</span><b style="color:${S.balance-10000>=0?'var(--green)':'var(--red)'}">${S.balance-10000>=0?'+':''}$${fmt(S.balance-10000)}</b></div>`;
}

/* ================= BOTS ================= */
const BOT_TEMPLATES=[
  {id:'apex',icon:'🏆',name:'Apex Bot 2026',desc:'Adaptive AI recovery bot. Switches strategy with market regime, recovers drawdowns, protects capital.',tags:['AI Recovery','Adaptive','Pro'],strategy:'ai_recovery'},
  {id:'speed',icon:'🚀',name:'Speedbot',desc:'Ultra-fast execution engine. Reacts to every tick the instant a signal fires — built for Volatility 75.',tags:['Speed','V75','Fast'],strategy:'speedbot'},
  {id:'over',icon:'📈',name:'Over/Under Sniper',desc:'Buys only when Over/Under win-rate exceeds your threshold on 500+ ticks. High-precision digit entries.',tags:['Digits','Over/Under'],strategy:'over_under'},
  {id:'evenodd',icon:'⚖️',name:'Even/Odd Hunter',desc:'Tracks parity streaks and gaps. Enters when Even/Odd bias is statistically extreme.',tags:['Digits','Parity'],strategy:'even_odd'},
  {id:'match',icon:'🎯',name:'Matches/Differs Pro',desc:'Differs on the coldest digit, Matches on the hottest — with gap-based timing.',tags:['Digits','Matches'],strategy:'matches'},
  {id:'mart',icon:'🔁',name:'Martingale Classic',desc:'Classic ×2 recovery after every loss. Configurable max steps and stop-loss.',tags:['Martingale','Recovery'],strategy:'martingale'},
  {id:'dal',icon:'➕',name:'D\'Alembert Bot',desc:'Gentle +1 stake recovery. Lower risk than Martingale, steadier equity curve.',tags:['D\'Alembert','Safe'],strategy:'dalembert'},
  {id:'boom',icon:'💥',name:'Boom/Crash Spike',desc:'Waits for spike patterns on Boom/Crash, then rides the mean-reversion.',tags:['Boom','Crash','Spike'],strategy:'boom_crash'},
  {id:'step',icon:'👣',name:'Step Index Walker',desc:'Step Index moves in fixed steps — bot exploits the step rhythm with Rise/Fall bias.',tags:['Step','Rise/Fall'],strategy:'step'},
  {id:'rsi',icon:'📊',name:'RSI Mean-Reversion',desc:'Buys oversold, sells overbought using RSI(14) + Bollinger Bands on live candles.',tags:['RSI','Bollinger','Mean-Reversion'],strategy:'rsi'},
  {id:'dcircles',icon:'⭕',name:'D-Circles Bot',desc:'Trades the D-Circles distribution — enters on the digit with the strongest statistical case.',tags:['D-Circles','Distribution'],strategy:'dcircles'},
  {id:'risefall',icon:'↗',name:'Rise/Fall Momentum',desc:'Follows tick-to-tick momentum bias across all synthetic indices.',tags:['Momentum','Rise/Fall'],strategy:'rise_fall'},
  {id:'fib',icon:'🌀',name:'Fibonacci Recovery',desc:'Uses the 1-1-2-3-5-8 Fibonacci sequence for controlled, mathematical drawdown recovery.',tags:['Fibonacci','Recovery'],strategy:'martingale'},
  {id:'oscar',icon:'🎩',name:'Oscar\'s Grind',desc:'Increases stake by +1 unit only after wins in a losing cycle — targets +1 unit profit per cycle.',tags:['Low Risk','Grind'],strategy:'dalembert'},
  {id:'antimart',icon:'⚡',name:'Anti-Martingale (Paroli)',desc:'Doubles stake on winning streaks to ride hot runs while keeping losses at base stake.',tags:['Streak','Paroli'],strategy:'speedbot'},
  {id:'kelly',icon:'📐',name:'Kelly Criterion Bot',desc:'Dynamically sizes each stake using the Kelly formula based on live win-rate edge.',tags:['Math','Sizing'],strategy:'ai_recovery'},
  {id:'macd',icon:'📉',name:'MACD Crossover Bot',desc:'Enters Rise/Fall on MACD(12,26,9) signal-line crossovers confirmed by histogram momentum.',tags:['MACD','Trend'],strategy:'rise_fall'},
  {id:'bb_squeeze',icon:'🎯',name:'Bollinger Squeeze',desc:'Detects low-volatility Bollinger Band squeezes and trades the explosive breakout tick.',tags:['Bollinger','Breakout'],strategy:'rsi'},
  {id:'diff90',icon:'🛡️',name:'Differs 90% Safe',desc:'Targets ~90% win-rate Digit Differs on the coldest digit with strict streak-gap filtering.',tags:['Digits','High Win%'],strategy:'matches'},
  {id:'over1',icon:'🔥',name:'Over 1 / Under 8 Sniper',desc:'High-probability Over 1 or Under 8 entries when digits 0-1 or 8-9 are statistically cold.',tags:['Digits','Sniper'],strategy:'over_under'},
  {id:'ai_ens',icon:'🧠',name:'AI Ensemble Pro',desc:'Combines digit frequency, Markov transition matrix, and RSI momentum into one consensus vote.',tags:['AI','Ensemble'],strategy:'ai_recovery'},
  {id:'v100_turbo',icon:'🏎️',name:'V100 Turbo Scalper',desc:'High-frequency 1-tick scalper tuned for Volatility 100 (1s) micro-trends.',tags:['V100','Scalp'],strategy:'speedbot'},
  {id:'streak_rev',icon:'🔄',name:'Streak Reversal Bot',desc:'Fades extreme 4+ consecutive Even/Odd or Rise/Fall streaks using mean-reversion.',tags:['Reversal','Mean'],strategy:'even_odd'},
  {id:'scanner_bot',icon:'📡',name:'Multi-Market Scanner',desc:'Scans all 10 synthetic indices simultaneously and trades only the highest-edge symbol.',tags:['Scanner','All Markets'],strategy:'ai_recovery'},
];
// Existing saved built-ins are refreshed from these definitions; custom bots remain local.
const BOT_OVERRIDES={
  apex:{desc:'Uses the over/under frequency scan; recovery is selected separately.',tags:['Frequency','Recovery optional']},
  speed:{desc:'Uses the same over/under frequency scan as the simulator, not high-frequency execution.',tags:['Frequency','Simulator']},
  over:{desc:'Selects the largest observed over/under frequency from the local tick buffer.',tags:['Digits','Observed frequency']},
  evenodd:{desc:'Selects the more frequent parity in the local tick buffer.',tags:['Digits','Parity']},
  match:{desc:'Selects a Differs contract on the least frequent digit in the local tick buffer.',tags:['Digits','Differs']},
  mart:{desc:'Uses the over/under frequency scan with Martingale ×2 selected as the recovery mode.',recovery:'martingale',tags:['Frequency','Martingale']},
  dal:{desc:'Uses the over/under frequency scan with D’Alembert selected as the recovery mode.',recovery:'dalembert',tags:['Frequency','D’Alembert']},
  step:{desc:'Uses observed rise/fall frequency on the selected symbol.',tags:['Rise/Fall','Frequency']},
  rsi:{desc:'Uses RSI(14) extremes to select simulated Rise/Fall contracts.',tags:['RSI','Mean reversion']},
  fib:{strategy:'over_under',recovery:'fibonacci',desc:'Frequency scan with Fibonacci sizing: advance one step after a loss and move back two after a win.',tags:['Fibonacci','Sizing']},
  oscar:{strategy:'over_under',recovery:'oscar',desc:'Frequency scan with Oscar-style sizing: increase after wins during a cycle, capped by the remaining one-unit target.',tags:['Oscar','Sizing']},
  antimart:{strategy:'over_under',recovery:'paroli',desc:'Frequency scan with Paroli sizing: double after wins, reset on loss or after three wins.',tags:['Paroli','Sizing']},
  kelly:{strategy:'over_under',recovery:'kelly',name:'Half-Kelly Simulator',desc:'Frequency scan with half-Kelly sizing capped at the base stake. Uses an uncalibrated historical score and illustrative payout, not Deriv prices.',tags:['Half Kelly','Simulator only']},
  scanner_bot:{strategy:'multi_market',desc:'Simulates a scan of all supported mock markets, choosing the highest observed Over 1 or Under 8 frequency. This score is not an edge or forecast.',tags:['Multi-market','Simulation']},
  ai_ens:{name:'Digit Transition Ensemble',strategy:'digit_ensemble',desc:'Blends observed digit parity and last-digit transitions, with an RSI extreme filter. A model score is not a forecast.',tags:['Digits','Transitions','RSI filter']},
  v100_turbo:{name:'One-Tick Momentum',strategy:'one_tick_momentum',symbol:'1HZ100V',desc:'Simulates a one-tick Rise/Fall contract based on recent tick direction; the app does not provide high-frequency execution.',tags:['One tick','Momentum','Simulation']},
  macd:{strategy:'macd_cross',desc:'Simulates Rise/Fall on a MACD(12,26,9) signal-line crossover.',tags:['MACD','Crossover']},
  bb_squeeze:{strategy:'bb_squeeze',desc:'Simulates a breakout beyond the previous Bollinger bands after a relative squeeze.',tags:['Bollinger','Breakout']},
  diff90:{strategy:'diff_cold',name:'Cold Digit Differs',desc:'Simulates Differs on the least frequent digit when its gap is at least three ticks. No win rate is guaranteed.',tags:['Digits','Gap']},
  over1:{strategy:'over1_under8',desc:'Compares observed frequencies for Over 1 and Under 8.',tags:['Digits','Frequency']},
  streak_rev:{strategy:'parity_reversal',desc:'Simulates the opposite parity after a streak of at least four even or odd digits.',tags:['Parity','Reversal']},
};
function defaultBots(){ return BOT_TEMPLATES.map(b=>({...b,...BOT_OVERRIDES[b.id],installed:false})); }
function normalizeBots(saved){
  const savedList=Array.isArray(saved)?saved:[];
  const templates=defaultBots().map(b=>({...b,installed:!!savedList.find(old=>old && old.id===b.id && old.installed)}));
  const seen=new Set();
  const custom=savedList.filter(b=>b && typeof b.id==='string' && /^custom-\d+$/.test(b.id) && b.strategy==='custom' && !seen.has(b.id) && seen.add(b.id)).slice(0,200).map(b=>({id:b.id,strategy:'custom',icon:'🧩',name:String(b.name||'Custom Bot').slice(0,80),desc:'Saved custom flow',tags:['Custom','Builder'],installed:!!b.installed,symbol:SYMBOLS.some(s=>s.sym===b.symbol)?b.symbol:'R_75',stake:Number.isFinite(b.stake)&&b.stake>0&&b.stake<=1000000?b.stake:1,blocks:Array.isArray(b.blocks)?b.blocks.filter(k=>typeof k==='string' && Object.hasOwn(BLOCKS,k)).slice(0,50):[]}));
  return [...custom,...templates];
}
function htmlEscape(value){ return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function renderBots(){
  const bots=S.bots||defaultBots();
  $('botGrid').innerHTML=bots.map(b=>`<div class="bot-card"><div class="ic">${htmlEscape(b.icon)}</div><h4>${htmlEscape(b.name)}</h4><p>${htmlEscape(b.unavailable?'Not implemented yet; this card cannot run an unrelated fallback strategy.':b.desc)}</p><div class="bot-meta">${(b.tags||[]).map(t=>`<span>${htmlEscape(t)}</span>`).join('')}</div><div class="btn-row">${b.unavailable?'<span class="muted">Not implemented</span>':`<button class="btn ${b.installed?'btn-outline':'btn-red'} btn-sm" onclick="installBot('${b.id}')">${b.installed?'✓ Installed':'Install Bot'}</button><button class="btn btn-ghost btn-sm" onclick="runBot('${b.id}')">▶ Run</button>${REAL_DATA_ONLY?'':`<button class="btn btn-ghost btn-sm" onclick="backtestBot('${b.id}')">◐ Backtest</button>`}`}</div></div>`).join('');
}
function installBot(id){ S.bots=S.bots||defaultBots(); const b=S.bots.find(x=>x.id===id); if(!b||b.unavailable) return; b.installed=!b.installed; localStorage.setItem('dbx_bots',JSON.stringify(S.bots)); renderBots(); toast(b.installed?`✅ ${b.name} installed`:`${b.name} removed`); }
function loadBot(id){
  const b=(S.bots||defaultBots()).find(x=>x.id===id); if(!b || b.unavailable) return null;
  if(b.strategy==='custom'){ S.builderBlocks=Array.isArray(b.blocks)?b.blocks.filter(k=>Object.hasOwn(BLOCKS,k)):[]; renderBuilder(); }
  $('autoRecovery').value=b.recovery||'none';
  return b;
}
function runBot(id){ const b=loadBot(id); if(!b) return toast('This bot is not implemented.'); $('autoStrategy').value=b.strategy; $('autoSymbol').value=b.symbol||S.selected; if(b.stake>0) $('autoStake').value=b.stake; showView('autotrader'); toast(`▶ ${b.name} loaded into Auto-Trader — press START`); }
function backtestBot(id){ const b=loadBot(id); if(!b) return toast('This bot is not implemented.'); $('btBot').value=b.strategy; $('btSymbol').value=b.symbol||S.selected; if(b.stake>0) $('btStake').value=b.stake; showView('backtest'); runBacktest(); }

/* ================= BUILDER ================= */
const BLOCKS={digit_over:{label:'IF Last Digit > 5',type:'cond'},digit_under:{label:'IF Last Digit < 5',type:'cond'},even:{label:'IF Digit is Even',type:'cond'},odd:{label:'IF Digit is Odd',type:'cond'},streak:{label:'IF Streak ≥ 3',type:'cond'},rsi:{label:'IF RSI < 30 or > 70',type:'cond'},buy_over:{label:'THEN Buy OVER',type:'act'},buy_under:{label:'THEN Buy UNDER',type:'act'},buy_even:{label:'THEN Buy EVEN',type:'act'},buy_odd:{label:'THEN Buy ODD',type:'act'},martingale:{label:'Martingale ×2 on loss',type:'risk'},stop:{label:'Stop after 3 losses',type:'risk'}};
function addBlock(k){ if(!Object.hasOwn(BLOCKS,k)) return; S.builderBlocks.push(k); renderBuilder(); }
function removeBlock(i){ S.builderBlocks.splice(i,1); renderBuilder(); }
function clearBuilder(){ S.builderBlocks=[]; renderBuilder(); }
function renderBuilder(){
  $('builderCount').textContent=S.builderBlocks.length+' blocks';
  $('builderFlow').innerHTML=S.builderBlocks.length? S.builderBlocks.map((k,i)=>`<div class="flow-item"><span>${i+1}. ${BLOCKS[k].label}</span><button onclick="removeBlock(${i})">✕</button></div>`).join('') : '<p class="muted">Your flow is empty — click blocks on the left to build a strategy.</p>';
  const name=$('builderName')?.value||'My Bot';
  $('builderCode').textContent = S.builderBlocks.length? `// ${name}\nON EVERY TICK:\n${S.builderBlocks.map(k=>'  '+BLOCKS[k].label).join('\n')}\n\n// Risk: stake = base × recovery\n// Symbol: ${$('builderSymbol')?.value||S.selected} · Base stake: $${$('builderStake')?.value||1}` : '// Add blocks to generate your strategy…';
}
function saveBuilderBot(){
  if(!S.builderBlocks.length) return toast('Add at least one block first');
  const name=($('builderName').value.trim()||'Custom Bot').slice(0,80);
  const bot={id:'custom-'+Date.now(),icon:'🧩',name,desc:'Custom bot built with the visual builder: '+S.builderBlocks.map(k=>BLOCKS[k].label).join(' → '),tags:['Custom','Builder'],strategy:'custom',blocks:[...S.builderBlocks],symbol:$('builderSymbol').value,stake:+$('builderStake').value,installed:true};
  S.bots=(S.bots||defaultBots()); S.bots.unshift(bot); localStorage.setItem('dbx_bots',JSON.stringify(S.bots)); renderBots(); toast(`💾 Saved "${name}" to Bot Library`);
}
function runBuilderBot(){ if(!S.builderBlocks.length) return toast('Build a flow first'); $('autoStrategy').value='custom'; $('autoSymbol').value=$('builderSymbol').value; $('autoStake').value=$('builderStake').value; showView('autotrader'); toast('▶ Builder bot loaded — press START'); }

/* ================= AUTO-TRADER ================= */
const STRATEGIES={multi_market:'Multi-Market Frequency Scanner',digit_ensemble:'Digit Transition Ensemble',one_tick_momentum:'One-Tick Momentum',macd_cross:'MACD Crossover',bb_squeeze:'Bollinger Squeeze',diff_cold:'Cold Digit Differs',over1_under8:'Over 1 / Under 8',parity_reversal:'Parity Streak Reversal',titan_ai:'Titan AI Multi-Market Pro',over_under:'Over/Under Sniper',even_odd:'Even/Odd Hunter',matches:'Matches/Differs Pro',martingale:'Martingale Classic',dalembert:"D'Alembert Bot",boom_crash:'Boom/Crash Spike',step:'Step Index Walker',rsi:'RSI Mean-Reversion',dcircles:'D-Circles Bot',rise_fall:'Rise/Fall Momentum',ai_recovery:'Apex Bot 2026 (AI Recovery)',speedbot:'Speedbot',custom:'Custom Builder Bot'};
function autoLog(msg,cls='info'){ const style=['info','win','loss','warn'].includes(cls)?cls:'info'; S.auto.log.unshift(`<div class="${style}">[${new Date().toLocaleTimeString()}] ${htmlEscape(msg)}</div>`); if(S.auto.log.length>120)S.auto.log.pop(); $('autoLog').innerHTML=S.auto.log.join(''); }
function clearAutoLog(){ S.auto.log=[]; $('autoLog').innerHTML=''; }
function toggleAutoTrader(){ S.auto.running? stopAutoTrader() : startAutoTrader(); }
function startAutoTrader(){
  if(REAL_DATA_ONLY && !S.connected) return toast('Connect a Deriv demo account to use the bot.');
  if(S.openContracts.some(c=>c.auto)) return toast('Wait for the previous simulated bot contract to settle.');
  if(!Number.isFinite(+$('autoStake').value) || +$('autoStake').value<=0 || !Number.isInteger(+$('autoMaxTrades').value) || +$('autoMaxTrades').value<1 || !Number.isFinite(+$('autoTP').value) || +$('autoTP').value<=0 || !Number.isFinite(+$('autoSL').value) || +$('autoSL').value<=0 || !Number.isFinite(+$('autoConf').value) || +$('autoConf').value<0 || +$('autoConf').value>100) return toast('Check the stake, trade limit, take profit, stop loss and confidence (0–100).');
  const chosenRecovery=($('autoStrategy').value==='custom' && S.builderBlocks.includes('martingale'))?'martingale':$('autoRecovery').value;
  if(!validRiskSettings(S.risk)) return toast('Save valid risk settings before starting.');
  const accountMode=S.connected;
  if(accountMode){
    if(!S.isDemo) return toast('Real-account bot execution is not available. Switch to a Deriv demo account.');
    if(REAL_DATA_ONLY && (!Array.isArray(S.activeMarkets) || !S.activeMarkets.includes($('autoSymbol').value))) return toast('Wait for an available Deriv market before starting the bot.');
    if(S.feed!=='deriv' || !S.ws || S.ws.readyState!==1 || !S.accountId || !Number.isFinite(S.balance) || S.balance<=0) return toast('Connect and authorize a demo account with a valid balance.');
    if(S.manualOrder || S.uncertainOrder || (Array.isArray(S.accountContracts) && S.accountContracts.some(c=>c.accountId===S.accountId && c.status==='OPEN'))) return toast('Resolve pending or locally tracked open account contracts before starting.');
    if($('autoStrategy').value==='multi_market' || chosenRecovery==='kelly') return toast('Multi-market and Kelly modes are simulator-only.');
    if(+$('autoStake').value>S.balance*S.risk.maxStakePct/100 || +$('autoStake').value>S.balance || +$('autoStake').value>+$('autoSL').value || +$('autoStake').value>S.risk.dailyLoss) return toast('Base stake exceeds an account balance, stake or session loss limit.');
    const accountAtConfirm=S.accountId, wsAtConfirm=S.ws;
    const confirmed=window.confirm(`START AUTOMATED DERIV DEMO TRADING?\nAccount: ${S.accountId} (${S.currency})\nStrategy: ${STRATEGIES[$('autoStrategy').value]} on ${$('autoSymbol').value}\nInitial stake: ${$('autoStake').value}; max trades: ${$('autoMaxTrades').value}; session stop loss: ${$('autoSL').value}.\n\nOrders will be placed automatically. Limits only track this browser session and cannot guarantee protection; other account activity is not included. This experimental flow has not been tested against Deriv. Continue?`);
    if(!confirmed) return;
    if(!S.connected || !S.isDemo || S.accountId!==accountAtConfirm || S.ws!==wsAtConfirm || wsAtConfirm.readyState!==1 || S.manualOrder || S.uncertainOrder) return toast('Account or connection changed; bot was not started.');
  }else if(chosenRecovery!=='kelly'){
    const riskError=checkSimulationRisk(+$('autoStake').value); if(riskError) return toast(riskError);
  }
  S.auto={...S.auto,running:true,mode:accountMode?'account':'simulation',accountId:accountMode?S.accountId:'',sessionId:`${Date.now()}-${Math.random().toString(36).slice(2)}`,lastDecisionTick:-1,startedAt:Date.now(),startBalance:S.balance,strategy:$('autoStrategy').value,symbol:$('autoSymbol').value,stake:+$('autoStake').value,blocks:[...S.builderBlocks],maxTrades:+$('autoMaxTrades').value,tp:+$('autoTP').value,sl:+$('autoSL').value,conf:+$('autoConf').value,recovery:chosenRecovery,trades:0,wins:0,losses:0,pnl:0,totalStake:0,totalPayout:0,recoveryState:{},curStake:+$('autoStake').value,lossStreak:0};
  $('autoBadge').textContent=accountMode?'DEMO ACCOUNT RUNNING':'SIMULATOR RUNNING'; $('autoBadge').style.background='rgba(0,208,156,.2)';
  $('autoPill').textContent='ON'; $('autoStartBtn').textContent='■ RUNNING…';
  autoLog(`▶ ${accountMode?'DERIV DEMO':'SIMULATOR'} Auto-Trader started — ${STRATEGIES[S.auto.strategy]} on ${S.auto.symbol}, stake ${S.auto.stake}, recovery ${S.auto.recovery}`,'warn');
  toast(accountMode?'▶ Deriv demo Auto-Trader running':'▶ Simulated Auto-Trader running');
}
function checkAutoTimer(){
  if(S.auto.running && S.risk.timer>0 && Date.now()-S.auto.startedAt>=S.risk.timer*60000){ autoLog('Session timer reached — stopping after any open contract settles','warn'); stopAutoTrader(); }
}
function stopAutoTrader(){ S.auto.running=false; if(S.manualOrder && S.manualOrder.kind==='auto' && S.manualOrder.phase==='proposal'){ S.manualOrder=null; renderAccountTracking(); } const outstanding=(S.manualOrder && S.manualOrder.kind==='auto' && S.manualOrder.phase==='buy') || (Array.isArray(S.accountContracts) && S.accountContracts.some(c=>c.botSessionId && c.botSessionId===S.auto.sessionId && c.status==='OPEN')); $('autoBadge').textContent='STOPPED'; $('autoBadge').style.background=''; $('autoPill').textContent='OFF'; $('autoStartBtn').textContent='▶ START AUTO-TRADER'; autoLog(outstanding?'■ Bot stopped. A submitted or open account contract may still settle.':'■ Auto-Trader stopped','warn'); }
function autoDecision(sym, strat=S.auto.strategy, ticks=S.ticks[sym]||[], blocks=S.builderBlocks){
  const st=digitStats(sym,ticks);
  if(ticks.length<50 || (REAL_DATA_ONLY && S.feed==='deriv' && S.precisionKnown[sym]===undefined)) return null;
  if(strat==='titan_ai'){
    // Use observed frequencies on the selected symbol, not an invented 70% fallback.
    if(st.n<50) return null;
    let best=null;
    for(let b=1;b<=8;b++){
      for(const candidate of [{type:'DIGITOVER',barrier:b,win:st.over[b]},{type:'DIGITUNDER',barrier:b,win:st.under[b]}]){
        if(!best || candidate.win>best.win) best=candidate;
      }
    }
    return {...best, reason:`Titan frequency scan on ${sym} (${st.n} ticks; not a forecast)`};
  }
  if(strat==='over_under'){ let best={type:'DIGITOVER',barrier:5,win:50}; for(let b=0;b<10;b++){ if(st.over[b]>best.win)best={type:'DIGITOVER',barrier:b,win:st.over[b]}; if(st.under[b]>best.win)best={type:'DIGITUNDER',barrier:b,win:st.under[b]}; } return {...best,reason:`Over/Under edge ${best.win.toFixed(1)}% on ${st.n} ticks`}; }
  if(strat==='even_odd'){ return st.evenPct>st.oddPct? {type:'DIGITEVEN',barrier:0,win:st.evenPct,reason:`Even ${st.evenPct.toFixed(1)}% vs Odd ${st.oddPct.toFixed(1)}%`}:{type:'DIGITODD',barrier:0,win:st.oddPct,reason:`Odd ${st.oddPct.toFixed(1)}% vs Even ${st.evenPct.toFixed(1)}%`}; }
  if(strat==='matches'){ const sorted=Object.entries(st.match).sort((a,b)=>a[1]-b[1]); return {type:'DIGITDIFF',barrier:+sorted[0][0],win:100-sorted[0][1],reason:`Coldest digit ${sorted[0][0]} at ${sorted[0][1].toFixed(1)}% — observed non-match ${(100-sorted[0][1]).toFixed(1)}%`}; }
  if(strat==='rise_fall'||strat==='step'){ return st.risePct>st.fallPct? {type:'CALL',barrier:0,win:st.risePct,reason:`Rise bias ${st.risePct.toFixed(1)}%`}:{type:'PUT',barrier:0,win:st.fallPct,reason:`Fall bias ${st.fallPct.toFixed(1)}%`}; }
  if(strat==='rsi'){ const r=rsi(ticks); if(r!=null&&r<30) return {type:'CALL',barrier:0,win:100-r,reason:`RSI oversold ${r.toFixed(0)}`}; if(r!=null&&r>70) return {type:'PUT',barrier:0,win:r,reason:`RSI overbought ${r.toFixed(0)}`}; return null; }
  if(strat==='dcircles'){ const hot=[...st.freq.keys()].sort((a,b)=>st.freq[b]-st.freq[a])[0]; return {type:'DIGITDIFF',barrier:hot,win:100-st.freq[hot]/st.n*100,reason:`D-Circles: digit ${hot} hottest — Differs`}; }
  if(strat==='boom_crash'){ const recent=ticks.slice(-10); const spike=Math.abs(recent[recent.length-1]-recent[0])/recent[0]; if(spike>0.002) return {type:recent[recent.length-1]>recent[0]?'PUT':'CALL',barrier:0,win:60,reason:`Spike detected ${(spike*100).toFixed(2)}% — mean reversion`}; return null; }
  if(strat==='digit_ensemble'){
    const last=st.digits[st.digits.length-1];
    let occurrences=0, evenAfter=0;
    for(let i=0;i<st.digits.length-1;i++){
      if(st.digits[i]===last){ occurrences++; if(st.digits[i+1]%2===0) evenAfter++; }
    }
    const momentum=rsi(ticks);
    if(occurrences<5 || momentum==null || momentum<30 || momentum>70) return null;
    const evenScore=0.7*(evenAfter/occurrences*100)+0.3*st.evenPct;
    return evenScore>=50
      ? {type:'DIGITEVEN',barrier:0,win:evenScore,reason:`Ensemble: ${occurrences} transitions after ${last}; RSI filter passed`}
      : {type:'DIGITODD',barrier:0,win:100-evenScore,reason:`Ensemble: ${occurrences} transitions after ${last}; RSI filter passed`};
  }
  if(strat==='one_tick_momentum'){
    const recent=ticks.slice(-11); let up=0,down=0;
    for(let i=1;i<recent.length;i++){ if(recent[i]>recent[i-1]) up++; else if(recent[i]<recent[i-1]) down++; }
    if(up===down) return null;
    const rising=up>down, score=100*Math.max(up,down)/(up+down);
    return {type:rising?'CALL':'PUT',barrier:0,win:score,duration:1,reason:`One-tick momentum: ${up} rises and ${down} falls in the last 10 moves`};
  }
  if(strat==='macd_cross'){
    const prev=macd(ticks.slice(0,-1)), cur=macd(ticks);
    if(!prev || !cur) return null;
    if(prev.hist<=0 && cur.hist>0) return {type:'CALL',barrier:0,win:st.risePct,reason:'MACD crossed above signal; score is observed rise frequency'};
    if(prev.hist>=0 && cur.hist<0) return {type:'PUT',barrier:0,win:st.fallPct,reason:'MACD crossed below signal; score is observed fall frequency'};
    return null;
  }
  if(strat==='bb_squeeze'){
    const prior=ticks.slice(0,-1), band=bollinger(prior), reference=bollinger(prior.slice(0,-20));
    if(!band || !reference || reference.upper<=reference.lower || band.upper-band.lower>(reference.upper-reference.lower)*0.8) return null;
    const last=ticks[ticks.length-1];
    if(last>band.upper) return {type:'CALL',barrier:0,win:st.risePct,reason:'Price broke above previous bands after a relative squeeze'};
    if(last<band.lower) return {type:'PUT',barrier:0,win:st.fallPct,reason:'Price broke below previous bands after a relative squeeze'};
    return null;
  }
  if(strat==='diff_cold'){
    const cold=st.freq.indexOf(Math.min(...st.freq));
    if(st.gaps[cold]<3) return null;
    return {type:'DIGITDIFF',barrier:cold,win:100-st.match[cold],reason:`Digit ${cold} appeared in ${st.match[cold].toFixed(1)}% of observations; gap ${st.gaps[cold]}`};
  }
  if(strat==='over1_under8'){
    return st.over[1]>=st.under[8]?{type:'DIGITOVER',barrier:1,win:st.over[1],reason:'Over 1 observed frequency'}:{type:'DIGITUNDER',barrier:8,win:st.under[8],reason:'Under 8 observed frequency'};
  }
  if(strat==='parity_reversal'){
    const digits=st.digits, parity=digits[digits.length-1]%2;
    let streak=0; for(let i=digits.length-1;i>=0 && digits[i]%2===parity;i--) streak++;
    if(streak<4) return null;
    return parity===0?{type:'DIGITODD',barrier:0,win:st.oddPct,reason:`${streak} even digits in a row; testing reversal`}:{type:'DIGITEVEN',barrier:0,win:st.evenPct,reason:`${streak} odd digits in a row; testing reversal`};
  }
  if(strat==='custom'){ return blocks.length ? evalBuilder(st,blocks,ticks) : null; }
  // These named presets intentionally share the frequency scan.
  if(!['martingale','dalembert','ai_recovery','speedbot'].includes(strat)) return null;
  let best={type:'DIGITOVER',barrier:5,win:50}; for(let b=0;b<10;b++){ if(st.over[b]>best.win)best={type:'DIGITOVER',barrier:b,win:st.over[b]}; if(st.under[b]>best.win)best={type:'DIGITUNDER',barrier:b,win:st.under[b]}; }
  return {...best,reason:`${strat==='ai_recovery'?'AI Recovery':'Speedbot'}: best edge ${best.win.toFixed(1)}%`};
}
// The score is a historical frequency, not expected value or a profit forecast.
// Replay passes a cutoff so the scanner cannot examine later observations.
function scanMarkets(markets,cutoff=null){
  let best=null;
  for(const market of SYMBOLS){
    const series=markets[market.sym];
    if(!Array.isArray(series)) continue;
    const available=cutoff==null?series:series.slice(0,cutoff+1);
    if(available.length<100) continue;
    const decision=autoDecision(market.sym,'over1_under8',available);
    if(decision && Number.isFinite(decision.win) && (!best || decision.win>best.win)) best={...decision,symbol:market.sym,reason:`Multi-market frequency scan: ${market.sym} ${decision.reason}; not a forecast`};
  }
  return best;
}
function alignedSimulationMarkets(markets,counts){
  const first=markets[SYMBOLS[0].sym];
  if(!Array.isArray(first) || first.length<101) return false;
  const count=counts[SYMBOLS[0].sym]||0;
  return SYMBOLS.every(m=>Array.isArray(markets[m.sym]) && markets[m.sym].length===first.length && (counts[m.sym]||0)===count);
}
function evalBuilder(st, blocks=S.builderBlocks, ticks=S.ticks[S.selected]||[]){
  const d=st.digits[st.digits.length-1]; let cond=true, action=null;
  for(const k of blocks){
    if(k==='digit_over'&&!(d>5)) cond=false; if(k==='digit_under'&&!(d<5)) cond=false;
    if(k==='even'&&d%2!==0) cond=false; if(k==='odd'&&d%2===0) cond=false;
    if(k==='streak'&&!(st.streaks[d]>=3)) cond=false;
    if(k==='rsi'){ const value=rsi(ticks); if(value==null || (value>=30 && value<=70)) cond=false; }
    if(k==='buy_over') action='DIGITOVER'; if(k==='buy_under') action='DIGITUNDER';
    if(k==='buy_even') action='DIGITEVEN'; if(k==='buy_odd') action='DIGITODD';
  }
  if(cond&&action){ const scores={DIGITOVER:st.over[5],DIGITUNDER:st.under[5],DIGITEVEN:st.evenPct,DIGITODD:st.oddPct}; return {type:action,barrier:5,win:scores[action],reason:'Builder conditions met; score is observed frequency'}; }
  return null;
}
function checkAccountBotRisk(stake){
  if(!S.connected || !S.isDemo || S.feed!=='deriv' || !S.ws || S.ws.readyState!==1 || S.accountId!==S.auto.accountId) return 'Demo account connection changed.';
  if(S.auto.trades>=S.auto.maxTrades || S.auto.pnl>=S.auto.tp || S.auto.pnl<=-S.auto.sl || S.auto.lossStreak>=S.risk.maxLossStreak || ($('autoGuard').checked && S.auto.pnl<=-S.auto.startBalance*0.1)) return 'Bot session limit reached.';
  if(!validRiskSettings(S.risk) || !Number.isFinite(stake) || stake<=0 || !Number.isFinite(S.balance) || stake>S.balance || stake>S.balance*S.risk.maxStakePct/100+1e-9) return 'Account stake exceeds the configured balance or percentage limit.';
  if(stake>S.auto.sl+S.auto.pnl+1e-9 || stake>S.risk.dailyLoss+Math.min(0,S.auto.pnl)+1e-9) return 'Next stake exceeds this bot session’s loss budget.';
  return null;
}
function requestDemoBotOrder(dec,sym){
  if(S.manualOrder || S.uncertainOrder || !S.auto.running) return;
  const req=++S.orderSeq, ws=S.ws, stake=S.auto.curStake, dur=dec.duration||5;
  S.manualOrder={kind:'auto',phase:'proposal',req,symbol:sym,accountId:S.accountId,currency:S.currency,type:dec.type,barrier:dec.barrier,stake,dur,botSessionId:S.auto.sessionId,createdAt:Date.now()};
  try{ ws.send(JSON.stringify({proposal:1,amount:stake,basis:'stake',contract_type:dec.type,currency:S.currency,duration:dur,duration_unit:'t',symbol:sym,...(['DIGITOVER','DIGITUNDER','DIGITMATCH','DIGITDIFF'].includes(dec.type)?{barrier:String(dec.barrier)}:{}),req_id:req})); }
  catch(e){ failManualOrder('Could not request demo bot quote.'); return; }
  setTimeout(()=>{ if(S.manualOrder && S.manualOrder.kind==='auto' && S.manualOrder.phase==='proposal' && S.manualOrder.req===req) failManualOrder('Demo bot quote timed out; no purchase sent.'); },15000);
  renderAccountTracking(); autoLog(`Demo quote requested: ${dec.type} ${sym} ${S.currency} ${fmt(stake)}.`, 'info');
}
function autoTick(){
  if(!S.auto.running) return;
  checkAutoTimer(); if(!S.auto.running) return;
  const accountMode=S.auto.mode==='account';
  if(accountMode && (!S.connected || !S.isDemo || S.accountId!==S.auto.accountId)){ autoLog('Demo account disconnected; stopping.','warn'); stopAutoTrader(); return; }
  if(!accountMode && S.connected){ stopAutoTrader(); return; }
  const configuredSym=S.auto.symbol;
  if(S.auto.strategy==='multi_market' && (S.feed!=='simulation' || !alignedSimulationMarkets(S.ticks,S.tickCounts))){ autoLog('Multi-market scanner requires aligned simulated ticks.','warn'); return stopAutoTrader(); }
  // Wait for settlement before evaluating session limits or placing another trade.
  if(S.openContracts.some(c=>c.auto)) return;
  if(accountMode && (S.manualOrder || S.uncertainOrder || (Array.isArray(S.accountContracts) && S.accountContracts.some(c=>c.accountId===S.accountId && c.status==='OPEN')))) return;
  // guards
  if(S.auto.trades>=S.auto.maxTrades){ autoLog('Max trades reached — stopping','warn'); return stopAutoTrader(); }
  if(S.auto.pnl>=S.auto.tp){ playBeep(1046,0.15); autoLog('Take profit hit — stopping','win'); return stopAutoTrader(); }
  if(S.auto.lossStreak>=S.risk.maxLossStreak){ autoLog('Maximum consecutive losses reached — stopping','warn'); return stopAutoTrader(); }
  if(S.auto.pnl<=-S.auto.sl){ playBeep(330,0.25); autoLog('Stop loss hit — stopping','loss'); return stopAutoTrader(); }
  if($('autoGuard').checked && S.auto.pnl <= -S.auto.startBalance*0.1){ autoLog('Drawdown guard triggered — pausing','warn'); return stopAutoTrader(); }
  if(accountMode){
    const count=S.tickCounts[configuredSym]||0;
    if(REAL_DATA_ONLY && S.precisionKnown[configuredSym]===undefined) return;
    if(!S.tickTimes[configuredSym] || Date.now()-S.tickTimes[configuredSym]>10000 || count===S.auto.lastDecisionTick) return;
    S.auto.lastDecisionTick=count;
  }
  const dec=S.auto.strategy==='multi_market'?scanMarkets(S.ticks):autoDecision(configuredSym,S.auto.strategy,S.ticks[configuredSym]||[],S.auto.blocks||[]); if(!dec) return;
  const sym=dec.symbol||configuredSym;
  if(S.openContracts.some(c=>c.symbol===sym)) return; // one at a time per symbol
  if(dec.win < S.auto.conf){ autoLog(`Skipped — strategy score ${dec.win.toFixed(1)}% < ${S.auto.conf}% (${dec.reason})`); return; }
  if(S.auto.recovery==='kelly'){
    const stake=simulatedKellyStake(S.balance,S.auto.stake,dec.win,dec.type);
    if(stake===null || stake<=0){ autoLog('Skipped — no positive simulated half-Kelly stake under these assumptions.'); return; }
    S.auto.curStake=stake;
  }
  const riskError=accountMode?checkAccountBotRisk(S.auto.curStake):checkSimulationRisk(S.auto.curStake);
  if(riskError){ autoLog(riskError,'warn'); return stopAutoTrader(); }
  if(S.auto.curStake>S.auto.sl+S.auto.pnl+1e-9){ autoLog('Next stake exceeds the remaining simulated stop-loss budget','warn'); return stopAutoTrader(); }
  if(accountMode){ requestDemoBotOrder(dec,sym); return; }
  const id='AUTO-'+Math.floor(rand(100000,999999));
  S.openContracts.push({id,type:dec.type,symbol:sym,stake:S.auto.curStake,barrier:dec.barrier,dur:dec.duration||5,entryTick:S.tickCounts[sym]||0,entryPrice:S.ticks[sym][S.ticks[sym].length-1],status:'OPEN',auto:true});
  S.auto.trades++; S.auto.totalStake=(S.auto.totalStake||0)+S.auto.curStake;
  autoLog(`▶ BUY ${dec.type} ${sym} $${fmt(S.auto.curStake)} · ${dec.duration||5} ticks — ${dec.reason} (score ${dec.win.toFixed(1)}%)`,'info');
  renderOpenContracts(); renderAutoStats();
}
function onAutoSettle(entry){
  S.auto.pnl+=entry.profit; S.auto.totalPayout=(S.auto.totalPayout||0)+(entry.win?entry.stake+entry.profit:0); if(entry.win){S.auto.wins++; S.auto.lossStreak=0;} else {S.auto.losses++; S.auto.lossStreak++;} S.auto.curStake=nextSimStake(entry.stake,S.auto.stake,S.auto.recovery,entry.win,S.auto.recoveryState||(S.auto.recoveryState={}),entry.profit);
  const currency=S.auto.mode==='account'?S.currency:'USD';
  autoLog(`${entry.win?'✅ WIN':'❌ LOSS'} ${entry.type} — ${entry.profit>=0?'+':''}${currency} ${fmt(entry.profit)} · Session P/L ${S.auto.pnl>=0?'+':''}${currency} ${fmt(S.auto.pnl)} · ${S.auto.recovery==='kelly'?'Next stake recalculated from next score':`Next stake ${currency} ${fmt(S.auto.curStake)}`}`, entry.win?'win':'loss');
  if(S.auto.strategy==='custom' && S.auto.lossStreak>=3 && (S.auto.blocks||[]).includes('stop')){ autoLog('Builder stop: 3 consecutive losses','warn'); stopAutoTrader(); }
  renderAutoStats();
}
function resetAutoStats(){
  if(S.auto.running || S.uncertainOrder || S.openContracts.some(c=>c.auto) || (S.manualOrder && S.manualOrder.kind==='auto') || (Array.isArray(S.accountContracts) && S.accountContracts.some(c=>c.botSessionId && c.botSessionId===S.auto.sessionId && c.status==='OPEN'))) return toast('Stop the bot and wait for settlement before resetting.');
  S.auto={...S.auto,trades:0,wins:0,losses:0,pnl:0,totalStake:0,totalPayout:0,recoveryState:{},lossStreak:0,startBalance:S.balance,curStake:S.auto.stake||0.35};
  if($('autoLog')) $('autoLog').innerHTML='';
  renderAutoStats();
  toast('Auto-Trader stats reset');
}
function renderAutoStats(){
  const a=S.auto;
  const totalStake=a.totalStake||0;
  const totalPayout=a.totalPayout||0, currency=a.mode==='account'?htmlEscape(S.currency):'USD';
  $('autoStats').innerHTML=`<div><b>${currency} ${fmt(totalStake)}</b><span>Total stake</span></div><div><b>${currency} ${fmt(totalPayout)}</b><span>Total payout</span></div><div><b>${a.trades}</b><span>No. of runs</span></div><div><b style="color:var(--red)">${a.losses}</b><span>Contracts lost</span></div><div><b style="color:var(--green)">${a.wins}</b><span>Contracts won</span></div><div><b style="color:${a.pnl>=0?'var(--green)':'var(--red)'}">${a.pnl>=0?'+':''}${currency} ${fmt(a.pnl)}</b><span>Total profit/loss</span></div>`;
}

/* ================= COPY TRADING ================= */
function renderFollowers(){ if($('followerList')) $('followerList').textContent='Copy trading is not implemented. Do not share follower tokens with the app.'; }

/* ================= AI PREDICTION ================= */
const AI_MODEL_VERSION=2;
function saveAILog(){ try{localStorage.setItem('dbx_ai',JSON.stringify(S.aiLog));}catch(e){ /* evaluation continues in memory */ } }
function expirePendingPredictions(reason){
  if(!Array.isArray(S.aiLog)){ S.aiLog=[]; return; }
  let changed=false;
  S.aiLog.forEach(p=>{ if(p && p.resolved==null && !p.expired){ p.expired=reason; changed=true; } });
  if(changed) saveAILog();
}
function clearPredictionLog(){
  if(!window.confirm('Clear the locally stored prediction log and evaluation metrics?')) return;
  S.aiLog=[]; saveAILog(); renderAI(); toast('Prediction log cleared.');
}
function predictDistribution(sym,ticks){
  if(ticks.length<20) return null;
  const st=digitStats(sym,ticks), last=st.digits[st.digits.length-1];
  let transitions=0;
  for(let i=0;i<st.digits.length-1;i++) if(st.digits[i]===last) transitions++;
  // If the latest digit has no observed outgoing transitions, use frequencies alone.
  const weight=transitions?0.7:0;
  const dist=st.transPct[last].map((v,i)=>v*weight+(st.freq[i]/st.n*100)*(1-weight));
  const digit=dist.indexOf(Math.max(...dist));
  return {digit,conf:dist[digit],dist,transitions,sample:st.n};
}
function aiPredict(manual){
  const sym=S.selected, ticks=S.ticks[sym]||[], currentTick=S.tickCounts[sym]||0;
  if(REAL_DATA_ONLY && (S.feed!=='deriv' || S.precisionKnown[sym]===undefined)){ if(manual) toast('Waiting for Deriv tick precision.'); return null; }
  if(!Array.isArray(S.aiLog)) S.aiLog=[];
  const existing=S.aiLog.find(p=>p && p.modelVersion===AI_MODEL_VERSION && p.feedGeneration===S.feedGeneration && p.sym===sym && p.createdTick===currentTick && p.resolved==null && !p.expired);
  if(existing){ if(manual){renderAI(existing); toast('Prediction already recorded for this tick.');} return existing; }
  const model=predictDistribution(sym,ticks);
  if(!model){ if(manual) toast('At least 20 ticks are required for a prediction.'); return null; }
  const pred={sym,digit:model.digit,conf:model.conf,dist:model.dist,transitions:model.transitions,sample:model.sample,time:new Date().toLocaleTimeString(),source:S.feed,modelVersion:AI_MODEL_VERSION,createdTick:currentTick,feedGeneration:S.feedGeneration,resolved:null,actual:null};
  S.aiLog.unshift(pred); if(S.aiLog.length>200) S.aiLog.length=200; saveAILog();
  renderAI(pred);
  if(manual) toast(`Model selected digit ${model.digit}; the score is not a guarantee.`);
  return pred;
}
// Called once per accepted symbol tick, before rendering or making a new prediction.
function resolveAI(sym,quote){
  if(!Array.isArray(S.aiLog) || !Number.isFinite(quote)) return;
  let changed=false;
  const count=S.tickCounts[sym]||0;
  S.aiLog.forEach(p=>{
    if(!p || p.resolved!=null || p.expired || p.modelVersion!==AI_MODEL_VERSION || p.feedGeneration!==S.feedGeneration || p.sym!==sym || !Number.isInteger(p.createdTick)) return;
    if(count===p.createdTick+1){ p.actual=lastDigit(quote,sym); p.resolved=p.actual===p.digit; changed=true; }
    else if(count>p.createdTick+1){ p.expired='Next tick missed'; changed=true; }
  });
  if(changed) saveAILog();
}
function aiCalibration(log,sym,source){
  const valid=(Array.isArray(log)?log:[]).filter(p=>{
    if(!p || p.modelVersion!==AI_MODEL_VERSION || p.sym!==sym || p.source!==source || (p.resolved!==true && p.resolved!==false) || !Number.isInteger(p.actual) || p.actual<0 || p.actual>9 || !Number.isInteger(p.digit) || p.digit<0 || p.digit>9 || p.resolved!==(p.actual===p.digit) || !Array.isArray(p.dist) || p.dist.length!==10) return false;
    if(!p.dist.every(v=>typeof v==='number' && Number.isFinite(v) && v>=0 && v<=100)) return false;
    return Math.abs(p.dist.reduce((a,b)=>a+b,0)-100)<0.01;
  });
  if(!valid.length) return {count:0,hits:0,hitRate:null,avgScore:null,brier:null};
  const hits=valid.filter(p=>p.resolved).length;
  const avgScore=valid.reduce((sum,p)=>sum+Math.max(...p.dist),0)/valid.length;
  const brier=valid.reduce((sum,p)=>sum+p.dist.reduce((v,prob,i)=>v+(prob/100-(i===p.actual?1:0))**2,0),0)/valid.length;
  return {count:valid.length,hits,hitRate:hits/valid.length*100,avgScore,brier};
}
function renderAI(pred){
  if(!Array.isArray(S.aiLog)) S.aiLog=[];
  pred=pred||S.aiLog.find(p=>p && p.modelVersion===AI_MODEL_VERSION && p.sym===S.selected && p.source===S.feed);
  const metrics=aiCalibration(S.aiLog,S.selected,S.feed);
  if($('aiCalibration')) $('aiCalibration').innerHTML=`<div class="big-stat"><span>Resolved predictions</span><b>${metrics.count}</b></div><div class="big-stat"><span>Hit rate</span><b>${metrics.count?metrics.hitRate.toFixed(1)+'%':'—'}</b></div><div class="big-stat"><span>Average top score</span><b>${metrics.count?metrics.avgScore.toFixed(1)+'%':'—'}</b></div><div class="big-stat"><span>Multiclass Brier score</span><b>${metrics.count?metrics.brier.toFixed(3):'—'}</b></div><p class="muted small">${S.feed==='deriv'?'Deriv':'Simulated'} ticks for ${htmlEscape(S.selected)} only; latest 200 log entries. Lower Brier is better; a uniform digit model scores 0.900 on each observation. Small samples are unreliable.</p>`;
  const validPred=pred && Number.isInteger(pred.digit) && pred.digit>=0 && pred.digit<=9 && Array.isArray(pred.dist) && pred.dist.length===10 && pred.dist.every(v=>Number.isFinite(v) && v>=0 && v<=100);
  if(validPred){
    const score=Math.max(...pred.dist);
    $('aiPrediction').innerHTML=`<div style="text-align:center;padding:10px"><div class="big-digit" style="font-size:52px">${pred.digit}</div><div class="muted">Selected digit · ${htmlEscape(pred.sym)}</div><div style="font-size:22px;font-weight:800;margin-top:8px">${score.toFixed(1)}% model score</div><div class="edge-bar"><i style="width:${score}%"></i></div><div class="muted small">${htmlEscape(pred.time)} · ${htmlEscape(pred.source)} · ${Number(pred.transitions)||0} matching transitions · Not a guarantee</div></div>`;
    drawBars($('aiDistChart'), ['0','1','2','3','4','5','6','7','8','9'], pred.dist, null);
    const st=digitStats(S.selected), ticks=S.ticks[S.selected]||[], r=rsi(ticks);
    $('aiFeatures').innerHTML=`<div class="big-stat"><span>Last digit</span><b>${st.digits.at(-1)??'—'}</b></div><div class="big-stat"><span>Sample size</span><b>${st.n} ticks</b></div><div class="big-stat"><span>Even / Odd</span><b>${st.evenPct.toFixed(0)}% / ${st.oddPct.toFixed(0)}%</b></div><div class="big-stat"><span>Rise / Fall</span><b>${st.risePct.toFixed(0)}% / ${st.fallPct.toFixed(0)}%</b></div><div class="big-stat"><span>RSI(14)</span><b>${r==null?'—':r.toFixed(1)}</b></div>`;
  } else {
    $('aiPrediction').textContent='Waiting for at least 20 ticks on this symbol and feed.';
    $('aiFeatures').textContent='No model data available.';
    const cv=$('aiDistChart'); if(cv && cv.getContext){ const ctx=cv.getContext('2d'); if(ctx) ctx.clearRect(0,0,cv.width,cv.height); }
  }
  const rows=S.aiLog.filter(p=>p && p.sym===S.selected && p.source===S.feed).slice(0,15);
  $('aiLogTable').innerHTML=`<tr><th>Time</th><th>Symbol</th><th>Predicted</th><th>Model score</th><th>Actual</th><th>Result</th></tr>`+rows.map(p=>`<tr><td>${htmlEscape(p.time)}</td><td>${htmlEscape(p.sym)}</td><td><b>${htmlEscape(p.digit)}</b></td><td>${Number.isFinite(Number(p.conf))?Number(p.conf).toFixed(1)+'%':'—'}</td><td>${htmlEscape(p.actual??'—')}</td><td>${p.expired?'Expired':p.resolved==null?'⏳ Pending':p.resolved?'✅ Hit':'❌ Miss'}</td></tr>`).join('');
}

/* ================= BACKTESTER ================= */
// Decisions use only ticks available at entry; one contract at a time.
function simulateBacktest({ticks,sym,strategy,stake,confidence=55,recovery='none',maxTrades=20,tp=10,sl=10,blocks=[],maxStakePct=100,maxLossStreak=Infinity,markets=null}){
  let balance=10000, wins=0, losses=0, lossStreak=0, peak=balance, maxDD=0, curStake=stake;
  const equity=[balance], trades=[], recoveryState={};
  let stopReason='End of available ticks';
  if(strategy==='multi_market' && (!markets || !SYMBOLS.every(m=>Array.isArray(markets[m.sym]) && markets[m.sym].length===ticks.length))){
    return {trades,wins,losses,pnl:0,maxDD,equity,stopReason:'Aligned simulation markets required'};
  }
  for(let i=99;i+1<ticks.length;){
    if(trades.length>=maxTrades){ stopReason='Trade limit'; break; }
    if(balance-10000>=tp){ stopReason='Take profit'; break; }
    if(balance-10000<=-sl){ stopReason='Stop loss'; break; }
    if(lossStreak>=maxLossStreak || (strategy==='custom' && blocks.includes('stop') && lossStreak>=3)){ stopReason='Consecutive loss limit'; break; }
    const dec=strategy==='multi_market'?scanMarkets(markets,i):autoDecision(sym,strategy,ticks.slice(0,i+1),blocks);
    if(!dec || dec.win<confidence){ i++; continue; }
    if(recovery==='kelly'){
      const sized=simulatedKellyStake(balance,stake,dec.win,dec.type);
      if(sized===null || sized<=0){ i++; continue; }
      curStake=sized;
    }
    if(!Number.isFinite(curStake) || curStake<=0 || curStake>balance || curStake>balance*maxStakePct/100+1e-9 || curStake>sl+balance-10000+1e-9){ stopReason='Next stake exceeds a sizing or stop-loss limit'; break; }
    const duration=dec.duration||5;
    if(!Number.isInteger(duration) || duration<1 || duration>10){ stopReason='Invalid strategy duration'; break; }
    if(i+duration>=ticks.length){ stopReason='Not enough ticks to settle the next contract'; break; }
    const tradeSym=dec.symbol||sym, tradeTicks=strategy==='multi_market'?markets[tradeSym]:ticks;
    const contract={type:dec.type,barrier:dec.barrier,symbol:tradeSym,stake:curStake,entryPrice:tradeTicks[i],duration};
    const outcome=simulateSettlement(contract,tradeTicks[i+duration]);
    if(!outcome){ i++; continue; }
    balance+=outcome.profit;
    trades.push({entryIndex:i,exitIndex:i+duration,...contract,...outcome});
    if(outcome.win){ wins++; lossStreak=0; } else { losses++; lossStreak++; }
    curStake=nextSimStake(curStake,stake,recovery,outcome.win,recoveryState,outcome.profit);
    peak=Math.max(peak,balance); maxDD=Math.max(maxDD,(peak-balance)/peak*100); equity.push(balance);
    i+=duration;
  }
  return {trades,wins,losses,pnl:balance-10000,maxDD,equity,stopReason};
}
// Two independent chronological replays: each half has its own warm-up, balance
// and risk limits. This does not tune parameters or establish statistical significance.
function replayHoldout(options){
  const split=Math.floor(options.ticks.length/2);
  if(split<101 || options.ticks.length-split<101) return null;
  const part=(start,end)=>{
    const markets=options.markets?Object.fromEntries(Object.entries(options.markets).map(([key,values])=>[key,values.slice(start,end)])):null;
    return simulateBacktest({...options,ticks:options.ticks.slice(start,end),markets});
  };
  return {split,first:part(0,split),second:part(split,options.ticks.length)};
}
function replaySummary(result){
  const n=result.trades.length;
  return `${n} trades · ${n?(result.wins/n*100).toFixed(1)+'%':'—'} wins · P/L ${result.pnl>=0?'+':''}$${fmt(result.pnl)} · max drawdown ${result.maxDD.toFixed(2)}% · ${result.stopReason}`;
}
function runBacktest(){
  if(REAL_DATA_ONLY) return toast('Backtesting is unavailable: verified historical contract prices are required.');
  const strategy=$('btBot').value, sym=$('btSymbol').value, stake=+$('btStake').value;
  const ticks=[...(S.ticks[sym]||[])];
  if(strategy==='multi_market' && (S.feed!=='simulation' || !alignedSimulationMarkets(S.ticks,S.tickCounts))) return toast('Multi-market replay needs aligned simulated tick buffers.');
  if(ticks.length<101) return toast('At least 101 ticks are required.');
  if(!Number.isFinite(stake)||stake<=0) return toast('Enter a positive backtest stake.');
  const confidence=+$('autoConf').value, maxTrades=+$('autoMaxTrades').value, tp=+$('autoTP').value, sl=+$('autoSL').value;
  if(!Number.isFinite(confidence)||confidence<0||confidence>100||!Number.isInteger(maxTrades)||maxTrades<1||!Number.isFinite(tp)||tp<=0||!Number.isFinite(sl)||sl<=0) return toast('Check Auto-Trader confidence, trade limit, take profit and stop loss settings.');
  if(!validRiskSettings(S.risk)) return toast('Save valid risk settings before replaying.');
  const recovery=strategy==='custom' && S.builderBlocks.includes('martingale')?'martingale':$('autoRecovery').value;
  const options={ticks,sym,strategy,stake,confidence,recovery,maxTrades,tp,sl,blocks:[...S.builderBlocks],maxStakePct:S.risk.maxStakePct,maxLossStreak:S.risk.maxLossStreak,markets:strategy==='multi_market'?Object.fromEntries(SYMBOLS.map(m=>[m.sym,[...S.ticks[m.sym]]])):null};
  const result=simulateBacktest(options);
  const total=result.trades.length, wr=total?result.wins/total*100:0, pnl=result.pnl;
  $('btResults').innerHTML=`<div class="bt-grid"><div><b>${total}</b><span>Trades</span></div><div><b>${wr.toFixed(1)}%</b><span>Win Rate</span></div><div><b style="color:${pnl>=0?'var(--green)':'var(--red)'}">${pnl>=0?'+':''}$${fmt(pnl)}</b><span>Net P/L</span></div><div><b>${result.maxDD.toFixed(1)}%</b><span>Max Drawdown</span></div></div><p class="muted">${STRATEGIES[strategy]||'Unknown strategy'} on ${strategy==='multi_market'?'all simulated markets':sym} · ${ticks.length} ${S.feed==='deriv'?'Deriv live':'simulated'} ticks · strategy-specific tick durations · Auto-Trader confidence, TP/SL, trade limit, ${recovery} recovery, maximum stake % and loss-streak limit. Daily and timer limits are not replayed. Fixed illustrative payouts are not Deriv quotes and ignore barrier-specific pricing. Live history is only collected while connected; results are not evidence of profitability.</p>`;
  const rows=result.trades.slice(0,30).map((t,i)=>`<tr><td>${i+1}</td><td>${t.entryIndex} → ${t.exitIndex}</td><td>${htmlEscape(t.symbol)} · ${htmlEscape(t.type)}${['DIGITOVER','DIGITUNDER','DIGITMATCH','DIGITDIFF'].includes(t.type)?' '+t.barrier:''}</td><td>$${fmt(t.stake)}</td><td>${t.win?'Win':'Loss'}</td><td>${t.profit>=0?'+':''}$${fmt(t.profit)}</td></tr>`).join('');
  $('btResults').innerHTML+=`<p class="muted small">Replay stopped: ${htmlEscape(result.stopReason)}. Showing ${Math.min(total,30)} of ${total} trades.</p><div class="table-wrap"><table class="table"><tr><th>#</th><th>Tick indices</th><th>Symbol / Contract</th><th>Stake</th><th>Outcome</th><th>P/L</th></tr>${rows||'<tr><td colspan="6">No trades matched the selected settings.</td></tr>'}</table></div>`;
  if($('btHoldout') && $('btHoldout').checked){
    const comparison=replayHoldout(options);
    $('btResults').innerHTML+=comparison?`<div class="card"><h4>Chronological split comparison</h4><p>First half (ticks 0–${comparison.split-1}): ${htmlEscape(replaySummary(comparison.first))}</p><p>Second half (ticks ${comparison.split}–${ticks.length-1}): ${htmlEscape(replaySummary(comparison.second))}</p><p class="muted small">Each half starts with a fresh $10,000 balance and needs 100 warm-up ticks; the second half does not use earlier ticks. Same settings, no parameter tuning. Results may be sparse and are not evidence of an edge.</p></div>`:'<p class="muted">Split comparison needs at least 202 ticks (101 per half).</p>';
  }
  drawLineChart($('btChart'),result.equity,pnl>=0?'#00d09c':'#ff444f');
  toast('◐ Backtest complete');
}

/* ================= RISK ================= */
function validRiskSettings(r){
  return !!r && Number.isFinite(r.dailyLoss) && r.dailyLoss>0 && Number.isFinite(r.maxStakePct) && r.maxStakePct>0 && r.maxStakePct<=100 && Number.isInteger(r.maxLossStreak) && r.maxLossStreak>0 && Number.isFinite(r.timer) && r.timer>=0;
}
function localDay(now=new Date()){
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}
function currentSimulationDay(){
  const day=localDay();
  if(!S.simDaily || S.simDaily.day!==day || !Number.isFinite(S.simDaily.pnl)) S.simDaily={day,pnl:0};
  return S.simDaily;
}
function recordSimulationResult(profit){
  if(!Number.isFinite(profit)) return;
  const day=currentSimulationDay(); day.pnl+=profit;
  try{ localStorage.setItem('dbx_sim_daily',JSON.stringify(day)); }catch(e){ /* This browser session still enforces the in-memory limit. */ }
}
// Reserve the entire open stake as potential loss. Applies only to local simulation.
function checkSimulationRisk(stake){
  if(!validRiskSettings(S.risk)) return 'Save valid risk settings before trading.';
  if(!Number.isFinite(stake) || stake<=0) return 'Enter a positive simulated stake.';
  const exposure=S.openContracts.reduce((sum,c)=>sum+(Number.isFinite(c.stake)?c.stake:0),0);
  if(!Number.isFinite(S.balance) || stake+exposure>S.balance+1e-9) return 'Insufficient simulated balance after open stakes.';
  if(stake>S.balance*S.risk.maxStakePct/100+1e-9) return 'Stake exceeds the simulated maximum stake percentage.';
  const remaining=S.risk.dailyLoss+Math.min(0,currentSimulationDay().pnl)-exposure;
  if(stake>remaining+1e-9) return 'Stake and open exposure exceed the remaining simulated daily loss budget.';
  return null;
}
function saveRisk(){
  const risk={dailyLoss:+$('riskDailyLoss').value,maxStakePct:+$('riskMaxStakePct').value,maxLossStreak:+$('riskMaxLossStreak').value,timer:+$('riskTimer').value};
  if(!validRiskSettings(risk)) return toast('Use a positive daily loss and streak limit, stake percentage from 0 to 100, and non-negative timer.');
  try{localStorage.setItem('dbx_risk',JSON.stringify(risk));}catch(e){return toast('Could not save risk settings.');}
  S.risk=risk; renderRisk(); toast('🛡 Risk settings saved');
}
function renderRisk(){
  if(REAL_DATA_ONLY && !S.connected){ $('riskStatus').textContent='Connect to Deriv to use account trading. Limits are local and not account-wide.'; $('riskStats').textContent='No account statistics available.'; return; }
  if(S.connected){ $('riskStatus').textContent='Manual account orders check only maximum stake %. Demo bot orders also check session limits and a timer. Account-wide daily loss and activity on other devices are not tracked.'; $('riskStats').textContent='Simulator statistics are unavailable while connected.'; return; }
  const day=currentSimulationDay();
  const exposure=S.openContracts.reduce((sum,c)=>sum+(Number.isFinite(c.stake)?c.stake:0),0);
  const remaining=Math.max(0,S.risk.dailyLoss+Math.min(0,day.pnl)-exposure);
  $('riskStatus').innerHTML=`<div class="big-stat"><span>Simulated daily P/L (${day.day})</span><b>${day.pnl>=0?'+':''}$${fmt(day.pnl)}</b></div><div class="big-stat"><span>Open stake at risk</span><b>$${fmt(exposure)}</b></div><div class="big-stat"><span>Remaining daily loss budget</span><b>$${fmt(remaining)}</b></div>`;
  $('riskStats').innerHTML=`<div class="big-stat"><span>Peak simulated equity</span><b>$${fmt(Math.max(...S.equity))}</b></div><div class="big-stat"><span>Trades (simulation journal)</span><b>${S.journal.length}</b></div><div class="big-stat"><span>Win rate</span><b>${S.journal.length? (S.journal.filter(j=>j.win).length/S.journal.length*100).toFixed(1)+'%':'—'}</b></div>`;
  drawLineChart($('riskEquity'), S.equity.slice(-100));
}
function calcPosition(){
  const bal=+$('calcBalance').value, riskPct=+$('calcRiskPct').value, wr=+$('calcWinRate').value, pay=+$('calcPayout').value;
  if(!Number.isFinite(bal)||bal<=0||!Number.isFinite(riskPct)||riskPct<0||riskPct>100||!Number.isFinite(wr)||wr<0||wr>100||!Number.isFinite(pay)||pay<=0){ $('calcOut').textContent='Invalid inputs; no calculation available.'; return toast('Enter a positive balance and payout, and percentages between 0 and 100.'); }
  const stake=bal*riskPct/100; const kelly=(wr/100*(pay/100)-(1-wr/100))/(pay/100);
  $('calcOut').innerHTML=`<div class="big-stat"><span>Suggested stake (risk %)</span><b>$${fmt(stake)}</b></div><div class="big-stat"><span>Kelly %</span><b>${(kelly*100).toFixed(1)}%</b></div><div class="big-stat"><span>Half-Kelly stake</span><b>$${fmt(Math.max(0,bal*kelly/2))}</b></div><div class="big-stat"><span>Expected value / trade</span><b style="color:${(wr/100*pay/100-(1-wr/100))>=0?'var(--green)':'var(--red)'}">${((wr/100*pay/100-(1-wr/100))*100).toFixed(1)}%</b></div><p class="muted small">Illustration only; assumptions are not verified probabilities or Deriv quotes.</p>`;
}

/* ================= JOURNAL ================= */
function saveJournal(){ localStorage.setItem('dbx_journal',JSON.stringify(S.journal.slice(0,200))); }
function renderJournal(){
  const j=S.journal; const wins=j.filter(x=>x.win).length; const pnl=j.reduce((a,x)=>a+x.profit,0);
  $('journalStats').innerHTML=`<div class="sym-card"><div class="name">Total Trades</div><div class="price">${j.length}</div></div><div class="sym-card"><div class="name">Win Rate</div><div class="price">${j.length?(wins/j.length*100).toFixed(1)+'%':'—'}</div></div><div class="sym-card"><div class="name">Net P/L</div><div class="price" style="color:${pnl>=0?'var(--green)':'var(--red)'}">${pnl>=0?'+':''}$${fmt(pnl)}</div></div><div class="sym-card"><div class="name">Best Win</div><div class="price">${j.length?'$'+fmt(Math.max(...j.map(x=>x.profit))):'—'}</div></div>`;
  $('journalTable').innerHTML=`<tr><th>Time</th><th>Type</th><th>Symbol</th><th>Stake</th><th>Entry</th><th>Exit</th><th>Digit</th><th>Result</th><th>P/L</th></tr>`+(j.slice(0,30).map(x=>`<tr><td>${htmlEscape(x.time)}</td><td>${htmlEscape(x.type)}</td><td>${htmlEscape(x.symbol)}</td><td>$${fmt(x.stake)}</td><td>${fmtPrice(x.entry)}</td><td>${fmtPrice(x.exit)}</td><td>${htmlEscape(x.digit)}</td><td><span class="${x.win?'pill-win':'pill-loss'}">${x.win?'WIN':'LOSS'}</span></td><td style="color:${x.profit>=0?'var(--green)':'var(--red)'}">${x.profit>=0?'+':''}$${fmt(x.profit)}</td></tr>`).join('')||'<tr><td colspan="9" class="muted">No settled trades yet — place a trade to start your journal.</td></tr>');
  $('journalInfo').textContent=`${j.length} trades · stored locally in your browser`;
}
// Quote every cell and neutralize spreadsheet formulas from untrusted stored values.
function csvCell(value){
  let text=String(value??'');
  if (typeof value !== 'number' && /^[\s\x00-\x1f]*[=+\-@]/.test(text)) text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
function exportJournal(){
  const rows=[['Time','Type','Symbol','Stake','Entry','Exit','Digit','Win','Profit'],...S.journal.map(j=>[j.time,j.type,j.symbol,j.stake,j.entry,j.exit,j.digit,j.win,j.profit])];
  const csv=rows.map(r=>r.map(csvCell).join(',')).join('\r\n'); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download='derivbot-journal.csv'; a.click(); toast('⬇ Journal exported');
}
function clearJournal(){ S.journal=[]; saveJournal(); renderJournal(); }

/* ================= ACADEMY ================= */
const COURSES=['What is Deriv?','Basic Financial Market Concepts','Types of Accounts on Deriv','Overview of Deriv Platforms','Understanding Synthetic Indices','Volatility Indices Explained','Boom & Crash Indices','Step Index & Range Break','Jump Indices','Forex, Crypto & Commodities','Binary Options Fundamentals','Digit Trading: Over/Under','Digit Trading: Even/Odd','Digit Trading: Matches/Differs','Rise/Fall & Multipliers','Reading Tick Charts','Candlesticks & Timeframes','Technical Indicators Masterclass','Support, Resistance & Trends','Risk Management Essentials','Money Management & Kelly Criterion','Martingale & Recovery Systems','D\'Alembert & Flat Staking','Building Your First Bot','Bot Builder Deep-Dive','Backtesting Strategies','Copy Trading Setup','Trading Psychology','Demo-to-Live Transition','Advanced: AI & Probability Edges'];
function renderCourses(){
  $('courseList').innerHTML=COURSES.map((c,i)=>{ const done=S.courseDone.includes(i); return `<div class="course-item ${i===0?'open':''}"><button class="course-head" onclick="this.parentElement.classList.toggle('open')"><span class="num">CH ${String(i+1).padStart(2,'0')}</span> ${c} <span class="done">${done?'✓ Done':''}</span></button><div class="course-body"><p>Chapter ${i+1}: ${c}. This lesson covers the core concepts, practical examples on live Deriv synthetic indices, and a short quiz at the end. Mark it complete when you finish.</p><button class="btn ${done?'btn-outline':'btn-green'} btn-sm" style="margin-top:10px" onclick="toggleCourse(${i})">${done?'↩ Mark incomplete':'✓ Mark complete'}</button></div></div>`; }).join('');
  const pct=Math.round(S.courseDone.length/COURSES.length*100); $('coursePct').textContent=pct+'%'; $('courseBar').style.width=pct+'%'; $('courseCount').textContent=`${S.courseDone.length} / ${COURSES.length} chapters`;
}
function toggleCourse(i){ const idx=S.courseDone.indexOf(i); idx>=0? S.courseDone.splice(idx,1):S.courseDone.push(i); localStorage.setItem('dbx_course',JSON.stringify(S.courseDone)); renderCourses(); }

/* ================= ALERTS ================= */
function addAlert(msg){ S.alerts.unshift({msg,time:new Date().toLocaleTimeString()}); if(S.alerts.length>30)S.alerts.pop(); $('alertCount').textContent=S.alerts.length; $('alertsList').innerHTML=S.alerts.map(a=>`<div class="alert-item"><b>${htmlEscape(a.time)}</b> — ${htmlEscape(a.msg)}</div>`).join('')||'<p class="muted">No alerts yet.</p>'; }
function toggleAlerts(){ $('alertsDrawer').classList.toggle('open'); }

/* ================= VIEWS / NAV ================= */
const VIEW_META={dashboard:['Overview','Your trading workspace'],markets:['Market Monitor','Deriv ticks and tick-grouped charts; not time-based candles.'],digits:['Digit Analysis','Frequency, transitions, streaks, D-Circles & distributions.'],signals:['Observed Frequencies','Past tick frequencies, not future win rates.'],trade:['Manual Trade','Place digit & Rise/Fall contracts on your Deriv account.'],bots:['Bot Library','Experimental strategies and simulation presets.'],builder:['Bot Builder','Drag, drop & connect blocks. No coding needed.'],autotrader:['Auto-Trader','Experimental automation with session guards and logging.'],copy:['Copy Trading','Not implemented.'],ai:['AI Prediction','In-browser Markov model with calibration log.'],backtest:['Backtester','Replay supported strategies on available tick history.'],risk:['Risk Manager','Loss limits, Kelly sizing & equity curve.'],journal:['Trading Journal','Locally stored simulated settlements, exportable as CSV.'],academy:['Academy','Introduction to Deriv — 30 free chapters.'],connect:['Connect Deriv','Official Deriv API — your token, your account.']};
function showView(v){
  if(REAL_DATA_ONLY && ['backtest','journal','academy','copy'].includes(v)) return toast('This feature is unavailable until it uses verified data.');
  document.querySelectorAll('.view').forEach(el=>el.classList.remove('active'));
  $('view-'+v)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.view===v));
  $('viewTitle').textContent=VIEW_META[v]?.[0]||v; $('viewSub').textContent=VIEW_META[v]?.[1]||'';
  document.querySelector('.sidebar').classList.remove('open');
  // refresh view
  if(v==='dashboard'){ renderSnapshot(); renderSignals(); renderSession(); }
  if(v==='markets'){ renderWatchlist(); renderMainChart(); renderIndicators(); }
  if(v==='digits') renderDigits();
  if(v==='signals') renderSignals();
  if(v==='trade'){ updateProposal(); renderOpenContracts(); }
  if(v==='bots') renderBots();
  if(v==='builder') renderBuilder();
  if(v==='autotrader') renderAutoStats();
  if(v==='copy') renderFollowers();
  if(v==='ai') renderAI();
  if(v==='journal') renderJournal();
  if(v==='risk') renderRisk();
  if(v==='academy') renderCourses();
  window.scrollTo({top:0,behavior:'smooth'});
}
function selectSymbol(sym){ S.selected=sym; $('symbolSelect').value=sym; renderMainChart(); renderDigits(); updateProposal(); updatePriceChip(); }
function changeTF(tf){ S.tf=+tf; buildCandles(S.selected,S.tf); renderMainChart(); }
function changeChartType(t){ S.chartType=t; renderMainChart(); }

/* ================= RENDER: MARKET ================= */
function renderWatchlist(filter=''){
  const grid=$('watchlistGrid'); if(!grid) return;
  const visible=REAL_DATA_ONLY && S.feed==='deriv' && Array.isArray(S.activeMarkets)?SYMBOLS.filter(s=>S.activeMarkets.includes(s.sym)):SYMBOLS;
  const list=visible.filter(s=>!filter||s.name.toLowerCase().includes(filter.toLowerCase())||s.sym.toLowerCase().includes(filter.toLowerCase()));
  grid.innerHTML=list.map(s=>{
    const ticks=S.ticks[s.sym]||[]; const last=ticks[ticks.length-1]; if(last==null) return `<div class="sym-card"><div class="name">${s.name}</div><div class="muted">Waiting for tick</div></div>`; const prev=ticks[ticks.length-11]||last; const chg=(last-prev)/prev*100;
    return `<button class="sym-card ${S.selected===s.sym?'sel':''}" onclick="selectSymbol('${s.sym}')"><div style="display:flex;justify-content:space-between"><span class="name">${s.name}</span><span class="sym">${s.sym}</span></div><div class="price">${displayMarketPrice(last,s.sym)}</div><div class="chg ${chg>=0?'up':'down'}">${chg>=0?'▲':'▼'} ${Math.abs(chg).toFixed(2)}% · Digit ${REAL_DATA_ONLY && S.feed==='deriv' && S.precisionKnown[s.sym]===undefined?'unavailable':lastDigit(last,s.sym)}</div><canvas data-spark="${s.sym}" height="36"></canvas></button>`;
  }).join('');
  grid.querySelectorAll('canvas[data-spark]').forEach(cv=> drawSpark(cv,(S.ticks[cv.dataset.spark]||[]).slice(-40)));
}
function renderSnapshot(){
  const grid=$('snapshotGrid'); if(!grid) return;
  const visible=REAL_DATA_ONLY && S.feed==='deriv' && Array.isArray(S.activeMarkets)?SYMBOLS.filter(s=>S.activeMarkets.includes(s.sym)):SYMBOLS;
  grid.innerHTML=visible.slice(0,8).map(s=>{
    const ticks=S.ticks[s.sym]||[]; const last=ticks[ticks.length-1]; if(last==null) return `<div class="sym-card"><div class="name">${s.name}</div><div class="muted">Waiting for tick</div></div>`; const prev=ticks[ticks.length-11]||last; const chg=(last-prev)/prev*100;
    return `<button class="sym-card ${S.selected===s.sym?'sel':''}" onclick="selectSymbol('${s.sym}');showView('markets')"><div class="name">${s.name}</div><div class="price">${displayMarketPrice(last,s.sym)}</div><div class="chg ${chg>=0?'up':'down'}">${chg>=0?'▲':'▼'} ${Math.abs(chg).toFixed(2)}%</div></button>`;
  }).join('');
}
function renderMainChart(){
  const cv=$('mainChart'); if(!cv) return;
  $('chartTitle').textContent=symByCode(S.selected).name+' — Tick-grouped chart ('+(S.feed==='deriv'?'Deriv':'simulated')+')';
  drawCandles(cv,S.candles[S.selected]||[],S.chartType);
  const c=(S.candles[S.selected]||[]).slice(-1)[0];
  if(!c) $('ohlcInfo').textContent='Waiting for ticks';
  if(c) $('ohlcInfo').textContent=`O ${fmtPrice(c.o)} H ${fmtPrice(c.h)} L ${fmtPrice(c.l)} C ${fmtPrice(c.c)}`;
  const inds=computeIndicators(S.selected);
  $('indicatorStrip').innerHTML=inds.slice(0,8).map(([n,v])=>`<span class="ind-chip">${n}: <b>${v}</b></span>`).join('');
}
function renderIndicators(){
  const inds=computeIndicators(S.selected);
  $('indicatorTable').innerHTML=inds.map(([n,v])=>`<div class="ind-cell"><span class="muted">${n}</span><b>${v}</b></div>`).join('');
}
function updatePriceChip(){
  const ticks=S.ticks[S.selected]||[]; const last=ticks[ticks.length-1]; if($('marketEmpty')) $('marketEmpty').hidden=last!=null; if($('marketIndicator')){ $('marketIndicator').classList.toggle('has-ticks',last!=null); $('marketIndicator').innerHTML=last!=null?'<i></i> Tick received':'<i></i> Awaiting feed'; } if(last==null){ $('priceChip').textContent='Waiting for price…'; return; }
  const prev=ticks[ticks.length-11]||last; const chg=(last-prev)/prev*100;
  $('priceChip').innerHTML=`${S.selected} ${S.feed==='deriv' && S.precisionKnown[S.selected]===undefined?htmlEscape(String(last)):fmtPrice(last,symByCode(S.selected).pip)} <span style="color:${chg>=0?'var(--green)':'var(--red)'}">${chg>=0?'+':''}${chg.toFixed(2)}%</span>`;
  $('heroSymbol').textContent=symByCode(S.selected).name;
}
function renderSession(){
  const j=S.journal; const pnl=S.balance-10000;
  if(REAL_DATA_ONLY && !S.connected){ $('sessionStats').textContent='Connect to Deriv to see your account balance.'; $('statTicks').textContent='0'; return; }
  if(S.connected){ $('sessionStats').innerHTML=`<div><b>${htmlEscape(S.currency)} ${Number.isFinite(S.balance)?fmt(S.balance):'—'}</b><span>Account balance</span></div><div><b>—</b><span>Account P/L not tracked</span></div>`; $('statTicks').textContent=S.tickCount.toLocaleString(); return; }
  $('sessionStats').innerHTML=`<div><b>$${fmt(S.balance)}</b><span>Balance</span></div><div><b>${j.length}</b><span>Trades</span></div><div><b>${j.length?(j.filter(x=>x.win).length/j.length*100).toFixed(0)+'%':'—'}</b><span>Win Rate</span></div><div><b style="color:${pnl>=0?'var(--green)':'var(--red)'}">${pnl>=0?'+':''}$${fmt(pnl)}</b><span>Session P/L</span></div>`;
  drawLineChart($('equityChart'), S.equity.slice(-80));
  $('statTicks').textContent=S.tickCount.toLocaleString();
}
function renderTicker(){
  const items=SYMBOLS.map(s=>{ const t=S.ticks[s.sym]||[]; const last=t[t.length-1]; if(last==null) return `<span><b>${s.short}</b> waiting for tick</span>`; const prev=t[t.length-11]||last; const chg=(last-prev)/prev*100; return `<span><b>${s.short}</b> ${displayMarketPrice(last,s.sym)} <span class="${chg>=0?'g':'r'}">${chg>=0?'+':''}${chg.toFixed(2)}%</span></span>`; }).join('');
  $('tickerTrack').innerHTML=items+items;
}

/* ================= FEATURES & REVIEWS ================= */
const FEATURES=[
  ['🤖','Free Bot Library','Dozens of proven strategies, ready to load in one click. No coding required.','TRADERSCHEME','bots'],
  ['🧠','Smart AI Recovery','Adaptive logic that responds to live conditions to protect your position.','TRADERSCHEME ×10','autotrader'],
  ['◉','Digit Analysis','Digit patterns, tick analysis & live signals to time your entries.','EXPERT + PROCORTEX','digits'],
  ['🚀','Speedbot','Ultra-fast execution that reacts the instant a signal fires.','TRADERSCHEME','autotrader'],
  ['📊','Pro Charts · 50+ Indicators','Full technical analysis suite right in your workspace.','PROCORTEX ×10','markets'],
  ['🧩','Bot Builder','Visual drag-and-drop builder for shipping your own strategies fast.','TRADERSCHEME','builder'],
  ['⚡','Live Win-Rate Signals','Over/Under, Even/Odd, Matches/Differs & Rise/Fall — computed live.','EXPERT ANALYSIS','signals'],
  ['🔀','Transition Matrix','See what follows what — full digit transition probabilities.','PROCORTEX','digits'],
  ['⧉','Copy Trading','One trade, many Deriv accounts, per-token limits.','ALL THREE','copy'],
  ['📓','Trading Journal','Every settled contract logged with entry, exit & outcome.','PROCORTEX','journal'],
  ['◐','Backtester','Test any bot on 1,000 historical ticks before going live.','×10 NEW','backtest'],
  ['🛡','Risk Manager','Daily loss limits, Kelly sizing, drawdown guards & equity curve.','×10 NEW','risk'],
];
const REVIEWS=[
  ['J','James Ochieng','Verified Trader','This platform completely changed how I trade. Everything in one place.','#ff444f'],
  ['A','Amina Hassan','Verified Trader','The Smart AI recovery bot is absolutely insane. It pulled me out of a losing streak twice this week.','#2e9bff'],
  ['D','David Mwangi','Verified Trader','Copy Trader is a game changer. I copy the top performer and just let it run.','#00d09c'],
  ['F','Fatima Al-Rashid','Verified Trader','The analysis tools are on another level. D-Circles gives me exact entry points.','#ffb020'],
  ['P','Peter Kamau','Verified Trader','Speedbot catches signals faster than I can manually click. Transformed my V75 strategy.','#b388ff'],
  ['G','Grace Njeri','Verified Trader','Complete beginner — the free course + bot builder had me running my first bot in 2 hours.','#ff7a45'],
  ['E','Emmanuel Owusu','Verified Trader','Apex Bot 2026 adapts, recovers and profits. Best bot I have ever used on Deriv.','#00d09c'],
  ['M','Mercy Wanjiku','Verified Trader','Live charts with full indicators make me feel like a professional.','#2e9bff'],
];
function renderFeatures(){
  if(REAL_DATA_ONLY){ $('featureGrid').textContent='Connect to Deriv for live ticks and account quotes. Calculated indicators and model outputs are estimates, not guarantees.'; $('reviewsGrid').textContent=''; return; }
  $('featureGrid').innerHTML=FEATURES.map(([ic,t,d,tag,v])=>`<div class="feature" onclick="showView('${v}')"><div class="tag">${tag}</div><div class="ic">${ic}</div><b>${t}</b><p>${d}</p></div>`).join('');
  $('reviewsGrid').innerHTML=REVIEWS.map(([a,n,r,q,c])=>`<div class="review"><div class="who"><div class="avatar" style="background:${c}">${a}</div><div><b>${n}</b><small>${r} ✓</small></div><span class="stars" style="margin-left:auto">★★★★★</span></div><p>“${q}”</p></div>`).join('');
}

/* ================= TICK LOOP ================= */
let lastRender=0;
function onTick(sym){
  // hero + chip (cheap)
  if(sym===S.selected){ updatePriceChip(); }
  const now=Date.now();
  if(now-lastRender>1200){
    lastRender=now;
    renderTicker(); renderSession();
    // hero panel
    const ticks=S.ticks[S.selected]||[]; const st=digitStats(S.selected);
    drawLineChart($('heroChart'), ticks.slice(-60));
    $('heroDigit').textContent=st.digits[st.digits.length-1]??'—';
    let best={win:-1,label:'—'}; for(let b=0;b<10;b++){ if(st.over[b]>best.win)best={win:st.over[b],label:`OVER ${b}`}; if(st.under[b]>best.win)best={win:st.under[b],label:`UNDER ${b}`}; }
    $('heroEdge').textContent=st.n?best.label+' '+best.win.toFixed(0)+'%':'—';
    $('heroParity').textContent=st.n?st.evenPct.toFixed(0)+'% / '+st.oddPct.toFixed(0)+'%':'—';
    $('heroClock').textContent=new Date().toLocaleTimeString();
    if(sym===S.selected){ const pred=aiPredict(); if(pred) $('heroAI').textContent=pred.digit+' ('+Number(pred.conf).toFixed(1)+'%)'; }
    // view-specific refresh
    const active=document.querySelector('.view.active')?.id;
    if(active==='view-markets'){ renderWatchlist($('.search')?.value||''); renderMainChart(); }
    if(active==='view-digits') renderDigits();
    if(active==='view-dashboard'){ renderSnapshot(); }
    if(active==='view-ai') renderAI();
    if(active==='view-risk') renderRisk();
    settleMock(); autoTick();
    // copy trading on settle
    S.openContracts.forEach(c=>{ if(c.auto) return; });
  }
}

/* ================= INIT ================= */
// Tokens are kept in memory, not localStorage. Old token-bearing URLs are stripped
// immediately on initialization; an OAuth callback may still reach server/proxy logs.
function prepareCredentialSession(){
  try{ localStorage.removeItem('dbx_token'); localStorage.removeItem('dbx_followers'); }catch(e){}
  try{
    const params=new URLSearchParams(location.search), oauthToken=params.get('token1'), hadSync=params.has('sync');
    const sensitive=[];
    for(const key of params.keys()) if(/^(token\d+|acct\d+|cur\d+|sync|access_token)$/i.test(key)) sensitive.push(key);
    sensitive.forEach(key=>params.delete(key));
    const unsafeHash=/(?:access_token|token\d+)\s*=/i.test(location.hash||'');
    if(sensitive.length || unsafeHash){
      const remaining=params.toString();
      history.replaceState({},'',location.pathname+(remaining?'?'+remaining:'')+(unsafeHash?'':location.hash||''));
    }
    if(oauthToken) S.token=oauthToken;
    if(hadSync) toast('Old sync links can expose credentials. Revoke any token shared this way.');
  }catch(e){ toast('Could not process the login redirect; check your URL for exposed credentials.'); }
}
function init(){
  prepareCredentialSession();
  expirePendingPredictions('Page reloaded');
  if(REAL_DATA_ONLY){ SYMBOLS.forEach(s=>{S.ticks[s.sym]=[]; S.candles[s.sym]=[];}); updateFeedUI(); } else initMock();
  // restore
  const savedApp=localStorage.getItem('dbx_appid'); if(savedApp){ $('appIdInput').value=savedApp; S.appId=savedApp; }
  const savedDemo=localStorage.getItem('dbx_isdemo'); if(savedDemo!==null) S.isDemo=(savedDemo==='1');
  restoreTabConnection();
  if($('btnDemoAcc')) $('btnDemoAcc').className='btn '+(S.isDemo?'btn-outline':'btn-ghost')+' btn-sm'; if($('btnRealAcc')) $('btnRealAcc').className='btn '+(!S.isDemo?'btn-red':'btn-ghost')+' btn-sm';
  const oauthURL=`https://app.deriv.com/oauth2/authorize?app_id=${S.appId}&redirect_uri=${encodeURIComponent(location.origin+location.pathname)}&scope=trade,accounts_read`;
  if($('oauthLink')) $('oauthLink').href=oauthURL;
  if($('gateOAuthBtn')) $('gateOAuthBtn').href=oauthURL;
  if($('sideLoginBtn')) $('sideLoginBtn').href=oauthURL;
  if($('topConnectBtn')) $('topConnectBtn').href=oauthURL;
  // selects
  const opts=SYMBOLS.map(s=>`<option value="${s.sym}">${s.name} (${s.sym})</option>`).join('');
  $('symbolSelect').innerHTML=opts; $('symbolSelect').value=S.selected;
  $('builderSymbol').innerHTML=opts; $('autoSymbol').innerHTML=opts; $('btSymbol').innerHTML=opts;
  $('autoStrategy').innerHTML=Object.entries(STRATEGIES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');
  $('btBot').innerHTML=Object.entries(STRATEGIES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');
  // risk defaults
  $('riskDailyLoss').value=S.risk.dailyLoss; $('riskMaxStakePct').value=S.risk.maxStakePct; $('riskMaxLossStreak').value=S.risk.maxLossStreak; $('riskTimer').value=S.risk.timer;
  S.bots=normalizeBots(S.bots);
  renderAccountTracking(); renderFeatures(); renderBots(); renderBuilder(); renderFollowers(); renderCourses(); renderJournal(); renderAutoStats(); renderOpenContracts(); updateConnUI(); updateProposal(); renderTicker(); renderSnapshot(); renderSession(); renderSignals(); renderAI(); renderRisk();
  addAlert('Connect to Deriv for market data and account trading.');
  // mock feed loop (2s ticks, like Deriv synthetic indices)
  if(!REAL_DATA_ONLY) setInterval(mockTick, 2000);
  setInterval(checkAutoTimer, 1000);
  setInterval(()=>{ if(S.ws&&S.ws.readyState===1){ try{S.ws.send(JSON.stringify({ping:1}));}catch(e){} } }, 25000);
  window.addEventListener('resize',()=>{ renderMainChart(); });
  // Keyboard shortcuts (1-9 switch views)
  const shortcutViews=['dashboard','markets','digits','signals','trade','bots','autotrader','ai','connect'];
  document.addEventListener('keydown',(e)=>{
    if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    const n=parseInt(e.key,10);
    if(n>=1 && n<=shortcutViews.length) showView(shortcutViews[n-1]);
  });
}
function playBeep(freq=880,dur=0.08){
  try{ const ctx=new (window.AudioContext||window.webkitAudioContext)(); const o=ctx.createOscillator(),g=ctx.createGain(); o.frequency.value=freq; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(0.05,ctx.currentTime); o.start(); o.stop(ctx.currentTime+dur); }catch(e){}
}
// Share only bot configurations, never account tokens, follower data or orders.
function exportBotSettings(){
  const source=normalizeBots(S.bots||[]);
  const bots=source.map(b=>b.strategy==='custom'?{id:b.id,strategy:'custom',name:b.name,installed:b.installed,symbol:b.symbol,stake:b.stake,blocks:b.blocks}:{id:b.id,installed:b.installed});
  $('botConfigText').value=JSON.stringify({version:1,bots},null,2);
  toast('Bot settings exported below. Review before sharing.');
}
function importBotSettings(){
  const raw=$('botConfigText').value;
  if(!raw || raw.length>200000) return toast('Paste bot settings JSON under 200 KB.');
  let data; try{data=JSON.parse(raw);}catch(e){return toast('Invalid JSON.');}
  if(!data || data.version!==1 || !Array.isArray(data.bots) || data.bots.length>250) return toast('Unsupported bot settings format.');
  if(S.auto.running) return toast('Stop the bot before importing settings.');
  if(!window.confirm('Replace local bot settings with this file? Existing custom bots will be replaced.')) return;
  const bots=normalizeBots(data.bots);
  try{localStorage.setItem('dbx_bots',JSON.stringify(bots));}catch(e){return toast('Could not save imported settings.');}
  S.bots=bots; renderBots(); toast('Bot settings imported. Account credentials were not imported.');
}
function enterDemoMode(){
  localStorage.setItem('dbx_entered','1');
  if($('loginGate')) $('loginGate').style.display='none';
}
function loginWithToken(){
  const tok=($('gateTokenInput')?$('gateTokenInput').value:'').trim();
  if(!tok){ toast('Paste your Deriv API token first'); return; }
  S.token=tok; $('gateTokenInput').value=''; localStorage.setItem('dbx_entered','1');
  if($('loginGate')) $('loginGate').style.display='none';
  connectDeriv();
}
document.addEventListener('DOMContentLoaded',()=>{
  init();
  if(localStorage.getItem('dbx_entered')==='1' || S.token){
    if($('loginGate')) $('loginGate').style.display='none';
  }
  if(S.token){ connectDeriv(); }
});
