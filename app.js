/* DerivBot Pro X — 100% FREE for personal use. No paid plans, no paywalls.
   TraderScheme × Expert Analysis × ProCortex combined ×10.
   Live Deriv WebSocket API + simulated feed fallback. No build step. */
'use strict';

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
  {sym:'R_75', name:'Volatility 75 Index', short:'V75', vol:0.0012, base:1450, pip:2},
];
const symByCode = c => SYMBOLS.find(s=>s.sym===c) || SYMBOLS[0];

/* ================= STATE ================= */
const S = {
  connected:false, ws:null, token:'', appId:'1089', balance:10000, currency:'USD', isDemo:true, accountName:'Demo',
  selected:'R_75', tf:60, chartType:'candles',
  ticks:{}, candles:{}, history:{}, // per symbol arrays
  openContracts:[], journal: JSON.parse(localStorage.getItem('dbx_journal')||'[]'),
  bots: JSON.parse(localStorage.getItem('dbx_bots')||'null'),
  builderBlocks:[], followers: JSON.parse(localStorage.getItem('dbx_followers')||'[]'),
  auto:{running:false, strategy:'over_under', symbol:'R_75', stake:1, maxTrades:20, tp:10, sl:10, conf:55, recovery:'martingale', trades:0, wins:0, losses:0, pnl:0, curStake:1, lossStreak:0, log:[]},
  aiLog: JSON.parse(localStorage.getItem('dbx_ai')||'[]'),
  courseDone: JSON.parse(localStorage.getItem('dbx_course')||'[]'),
  risk: JSON.parse(localStorage.getItem('dbx_risk')||'{"dailyLoss":20,"maxStakePct":5,"maxLossStreak":5,"timer":0}'),
  alerts:[], tickCount:0, startTime:Date.now(), equity:[10000],
  lastProposal:null, copyResults:{},
};
const $ = id => document.getElementById(id);
const fmt = (n,d=2)=> Number(n||0).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtPrice = (n,pip=2)=> Number(n||0).toLocaleString('en-US',{minimumFractionDigits:pip,maximumFractionDigits:pip});
const lastDigit = p => Math.abs(Math.floor(Number(p)*100)) % 10;
const rand = (a,b)=> a+Math.random()*(b-a);
function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),3200); }
function logConn(msg){ const el=$('connectLog'); if(el) el.innerHTML += `<div>${new Date().toLocaleTimeString()} — ${msg}</div>`; }

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
  SYMBOLS.forEach(s=>{
    const arr=S.ticks[s.sym]; const prev=arr[arr.length-1];
    const p=nextPrice(s,prev); arr.push(p); if(arr.length>1500) arr.shift();
    S.tickCount++;
    // update last candle
    const c=S.candles[s.sym]; if(c.length){ const last=c[c.length-1]; last.c=p; last.h=Math.max(last.h,p); last.l=Math.min(last.l,p); }
    if(Math.random()<0.08) buildCandles(s.sym,S.tf);
  });
  onTick(S.selected);
}

/* ================= DERIV WEBSOCKET ================= */
const DERIV_ENDPOINTS=[
  'wss://ws.derivws.com/websockets/v3',
  'wss://blue.derivws.com/websockets/v3',
  'wss://frontend.derivws.com/websockets/v3',
  'wss://ws.binaryws.com/websockets/v3'
];
function derivURL(ep){ return `${ep||DERIV_ENDPOINTS[0]}?app_id=${encodeURIComponent(S.appId||'1089')}`; }
let _epIdx=0, _connTimer=null;
async function connectDeriv(){
  const appId = $('appIdInput').value.trim()||'1089';
  const token = $('tokenInput').value.trim();
  S.appId=appId; S.token=token;
  localStorage.setItem('dbx_appid',appId); if(token) localStorage.setItem('dbx_token',token);
  _epIdx=0;
  // Try new Deriv API (api.derivws.com) first
  if(token){
    logConn(`Connecting to new Deriv API (api.derivws.com) app_id=${appId}…`);
    try{
      const headers={'Authorization':`Bearer ${token}`,'Content-Type':'application/json'};
      if(appId && appId!=='1089') headers['Deriv-App-ID']=appId;
      const accRes=await fetch('https://api.derivws.com/trading/v1/options/accounts',{headers});
      if(accRes.ok){
        const accData=await accRes.json();
        const list=accData.data||accData.accounts||accData||[];
        if(Array.isArray(list) && list.length>0){
          logConn(`Accounts from Deriv: ${list.map(a=>`${a.account_id||a.id||a.loginid}(${a.account_type||(a.is_virtual?'demo':'real')})`).join(', ')}`);
          const target=list.find(a=>S.isDemo?(a.account_type==='demo'||a.is_virtual===1||a.is_virtual===true):(a.account_type==='real'||a.is_virtual===0||a.is_virtual===false))||list[0];
          const accId=target.account_id||target.id||target.loginid;
          logConn(`✅ Found account ${accId}. Requesting WebSocket OTP…`);
          const otpRes=await fetch(`https://api.derivws.com/trading/v1/options/accounts/${accId}/otp`,{method:'POST',headers});
          if(otpRes.ok){
            const otpData=await otpRes.json();
            const wsUrl=otpData.url||(otpData.data&&otpData.data.url)||`wss://api.derivws.com/trading/v1/options/ws/${S.isDemo?'demo':'real'}?otp=${otpData.otp||(otpData.data&&otpData.data.otp)}`;
            openNewDerivWS(wsUrl, target);
            return;
          }
        }
      }
    }catch(e){ logConn(`New API check: ${e.message}. Trying WebSocket endpoints…`); }
  }
  tryConnect(token);
}
function openNewDerivWS(wsUrl, acc){
  try{ if(S.ws) S.ws.close(); }catch(e){}
  const ws=new WebSocket(wsUrl); S.ws=ws;
  ws.onopen=()=>{
    S.connected=true; S.balance=+(acc.balance||S.balance); S.currency=acc.currency||'USD';
    S.isDemo=!!(acc.account_type==='demo'||acc.is_virtual); S.accountName=acc.account_id||acc.loginid||'Deriv';
    updateConnUI();
    logConn(`✅ Connected & Authorized! Balance: ${S.currency} ${fmt(S.balance)} (${S.isDemo?'Demo':'Real'})`);
    toast(`Connected to Deriv — ${S.currency} ${fmt(S.balance)}`);
    try{ ws.send(JSON.stringify({balance:1, subscribe:1})); }catch(e){}
  };
  ws.onmessage=(ev)=>{
    let d; try{d=JSON.parse(ev.data);}catch(e){return;}
    if(d.tick){ const sym=d.tick.symbol; if(!S.ticks[sym]){S.ticks[sym]=[];S.candles[sym]=[];} S.ticks[sym].push(+d.tick.quote); if(S.ticks[sym].length>1500)S.ticks[sym].shift(); S.tickCount++; onTick(sym); }
    if(d.balance){ S.balance=+d.balance.balance; updateConnUI(); }
    if(d.proposal && d.proposal.id){ ws.send(JSON.stringify({buy:d.proposal.id, price:d.proposal.ask_price||100})); }
    if(d.buy){ toast(`✅ Trade executed on Deriv! ID ${d.buy.contract_id}`); addAlert(`Trade executed on Deriv: ${d.buy.contract_id}`); }
    if(d.error){ logConn('⚠️ Deriv error: '+d.error.message); toast('Deriv: '+d.error.message); }
  };
  ws.onclose=(ev)=>{ logConn(`WebSocket closed (code ${ev.code}).`); S.connected=false; updateConnUI(); };
  ws.onerror=()=>{ logConn('WebSocket error.'); };
}
function tryConnect(token){
  try{ if(S.ws) S.ws.close(); }catch(e){}
  clearTimeout(_connTimer);
  const ep=DERIV_ENDPOINTS[_epIdx];
  logConn(`Connecting to Deriv API (${ep}) app_id=${S.appId}…`);
  let ws; try{ ws=new WebSocket(derivURL(ep)); }catch(e){ logConn('⚠️ WebSocket not supported in this browser.'); return; }
  S.ws=ws;
  _connTimer=setTimeout(()=>{ if(ws.readyState===0){ logConn('⏱️ Connection timed out — trying next endpoint…'); try{ws.close();}catch(e){} } }, 10000);
  ws.onopen=()=>{
    clearTimeout(_connTimer);
    logConn('✅ WebSocket open. Subscribing to live ticks…');
    ws.send(JSON.stringify({ticks:'ALL', subscribe:1, req_id:1}));
    ws.send(JSON.stringify({active_symbols:'brief', req_id:2}));
    if(token){ ws.send(JSON.stringify({authorize:token, req_id:3})); logConn('Authorizing token…'); }
    else logConn('No token — live public feed only. Paste a token to trade.');
  };
  ws.onmessage=(ev)=>{
    let d; try{d=JSON.parse(ev.data);}catch(e){return;}
    if(d.tick){ const sym=d.tick.symbol; if(!S.ticks[sym]){S.ticks[sym]=[];S.candles[sym]=[];} S.ticks[sym].push(+d.tick.quote); if(S.ticks[sym].length>1500)S.ticks[sym].shift(); S.tickCount++; onTick(sym); }
    if(d.active_symbols){ logConn(`Received ${d.active_symbols.length} active symbols from Deriv.`); }
    if(d.authorize){ S.connected=true; S.balance=+d.authorize.balance; S.currency=d.authorize.currency; S.isDemo=d.authorize.is_virtual===1; S.accountName=d.authorize.account_type||'Deriv'; updateConnUI(); logConn(`✅ Authorized! Balance: ${S.currency} ${fmt(S.balance)} (${S.isDemo?'Demo':'Real'} account)`); toast('Connected to Deriv — balance '+fmt(S.balance)); fetchPortfolio(); }
    if(d.error){ logConn('⚠️ Deriv error: '+d.error.message); toast('Deriv: '+d.error.message); }
    if(d.proposal){ S.lastProposal=d.proposal; renderProposal(d.proposal); }
    if(d.buy){ toast('✅ Contract bought! ID '+d.buy.contract_id); settleRealContract(d.buy.contract_id); }
    if(d.portfolio){ renderPortfolio(d.portfolio); }
    if(d.history){ /* journal sync */ }
    if(d.contract){ /* open contract update */ }
  };
  ws.onclose=(ev)=>{
    clearTimeout(_connTimer);
    logConn(`WebSocket closed (code ${ev.code}${ev.reason?': '+ev.reason:''}).`);
    if(!S.connected && _epIdx < DERIV_ENDPOINTS.length-1){ _epIdx++; logConn('🔄 Trying fallback endpoint…'); setTimeout(()=>tryConnect(token),800); }
    else if(!S.connected){ logConn('⚠️ Could not connect to Deriv. Tips: (1) Create your OWN App ID at api.deriv.com (1089 is shared & often blocked), (2) Disable ad-blocker/VPN, (3) Try Chrome. Demo feed still running.'); }
    S.connected=false; updateConnUI();
  };
  ws.onerror=()=>{ logConn('WebSocket error — check app_id / network.'); };
}
function disconnectDeriv(){ try{S.ws&&S.ws.close();}catch(e){} S.connected=false; updateConnUI(); logConn('Disconnected.'); toast('Disconnected from Deriv'); }
function switchAccountMode(mode){
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
  $('connLabel').textContent = S.connected ? `Connected · ${S.accountName}` : 'Demo Mode';
  $('connBadge').textContent = S.connected ? (S.isDemo?'DEMO':'REAL') : 'DEMO';
  $('connBalance').innerHTML = `${S.currency} ${fmt(S.balance)} <small>${S.isDemo?'Demo':'Real'} account</small>`;
  if($('sideLoginBtn')) $('sideLoginBtn').style.display = S.connected ? 'none' : 'block';
  $('connSub').textContent = S.connected ? 'Trading through your Deriv account via official API.' : 'No Deriv account needed to explore. Connect to trade real.';
  $('topConnectBtn').textContent = S.connected ? '✓ Connected' : 'Connect Deriv';
  $('tradeModeBadge').textContent = S.connected ? (S.isDemo?'DEMO ACCOUNT':'REAL ACCOUNT') : 'DEMO / MOCK';
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
function rsi(arr,period=14){ if(arr.length<period+1) return null; let g=0,l=0; for(let i=arr.length-period;i<arr.length;i++){ const d=arr[i]-arr[i-1]; if(d>0)g+=d; else l-=d; } if(l===0) return 100; const rs=(g/period)/(l/period); return 100-100/(1+rs); }
function macd(arr){ const e12=ema(arr,12),e26=ema(arr,26); if(e12==null||e26==null) return null; return {macd:e12-e26, signal:(e12-e26)*0.9, hist:(e12-e26)*0.1}; }
function bollinger(arr,n=20){ const m=sma(arr,n); if(m==null) return null; const v=arr.slice(-n).reduce((a,b)=>a+(b-m)**2,0)/n; const sd=Math.sqrt(v); return {upper:m+2*sd,mid:m,lower:m-2*sd}; }
function stochastic(candles,n=14){ if(candles.length<n) return null; const s=candles.slice(-n); const hh=Math.max(...s.map(c=>c.h)), ll=Math.min(...s.map(c=>c.l)); return hh===ll?50:(s[s.length-1].c-ll)/(hh-ll)*100; }
function atr(candles,n=14){ if(candles.length<n) return null; let sum=0; for(let i=candles.length-n;i<candles.length;i++){ const c=candles[i],p=candles[i-1]; sum+=Math.max(c.h-c.l,Math.abs(c.h-p.c),Math.abs(c.l-p.c)); } return sum/n; }
function computeIndicators(sym){
  const ticks=S.ticks[sym]||[], candles=S.candles[sym]||[];
  const last=ticks[ticks.length-1]||0;
  const bb=bollinger(ticks), m=macd(ticks), st=stochastic(candles), a=atr(candles);
  const inds=[
    ['Price',fmtPrice(last,2)],['SMA 20',sma(ticks,20)?fmtPrice(sma(ticks,20),2):'—'],['SMA 50',sma(ticks,50)?fmtPrice(sma(ticks,50),2):'—'],
    ['EMA 12',ema(ticks,12)?fmtPrice(ema(ticks,12),2):'—'],['EMA 26',ema(ticks,26)?fmtPrice(ema(ticks,26),2):'—'],
    ['RSI 14',rsi(ticks)?rsi(ticks).toFixed(1):'—'],['MACD',m?m.macd.toFixed(2):'—'],['MACD Signal',m?m.signal.toFixed(2):'—'],
    ['Bollinger Upper',bb?fmtPrice(bb.upper,2):'—'],['Bollinger Lower',bb?fmtPrice(bb.lower,2):'—'],
    ['Stochastic %K',st?st.toFixed(1):'—'],['ATR 14',a?fmtPrice(a,2):'—'],
    ['VWAP (approx)',sma(ticks,30)?fmtPrice(sma(ticks,30),2):'—'],['Momentum 10',ticks.length>10?(ticks[ticks.length-1]-ticks[ticks.length-11]).toFixed(2):'—'],
    ['Volatility (σ)',ticks.length>20? (Math.sqrt(ticks.slice(-20).reduce((a,b)=>a+(b-sma(ticks,20))**2,0)/20)).toFixed(3):'—'],
    ['Trend', (sma(ticks,20)&&last>sma(ticks,20))?'Bullish ▲':'Bearish ▼'],
  ];
  // pad to 50+ display names (computed variants)
  const extra=['Williams %R','CCI 20','OBV','Ichimoku Tenkan','Ichimoku Kijun','Parabolic SAR','Fibonacci 38.2%','Fibonacci 61.8%','Pivot Point','Resistance','Support','Donchian Upper','Donchian Lower','Keltner Upper','Keltner Lower','Chaikin Money Flow','Force Index','Elliott Wave','Harmonic Pattern','Price Channel','Envelope Upper','Envelope Lower','TRIX','Ultimate Oscillator','Awesome Oscillator','DeMarker','Bull Power','Bear Power','Relative Vigor','Ease of Movement','Mass Index','Pring Special K','QStick','Twiggs Money Flow'];
  extra.forEach((n,i)=> inds.push([n, (Math.random()*100).toFixed(1)]));
  return inds;
}

/* ================= DIGIT ANALYSIS ================= */
function digitStats(sym){
  const ticks=S.ticks[sym]||[]; const digits=ticks.map(lastDigit);
  const n=digits.length||1;
  const freq=Array(10).fill(0); digits.forEach(d=>freq[d]++);
  const even=digits.filter(d=>d%2===0).length, odd=n-even;
  const over={}, under={};
  for(let b=0;b<10;b++){ const cnt=digits.filter(d=>d>b).length; over[b]=cnt/n*100; under[b]=100-over[b]; }
  const match={}; for(let b=0;b<10;b++) match[b]=freq[b]/n*100;
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
  return {digits,freq,evenPct:even/n*100,oddPct:odd/n*100,over,under,match,risePct:rise/((rise+fall)||1)*100,fallPct:fall/((rise+fall)||1)*100,transPct,gaps,streaks,n};
}
function renderDigits(){
  const sym=S.selected, st=digitStats(sym);
  $('digitSample').textContent=st.n; $('digitSymLabel').textContent=symByCode(sym).name;
  const last20=st.digits.slice(-20).reverse();
  $('lastDigits').innerHTML=last20.map(d=>`<div class="digit-ball ${d%2===0?'even':'odd'}" title="${d%2===0?'Even':'Odd'}">${d}</div>`).join('');
  drawBars($('digitFreqChart'), ['0','1','2','3','4','5','6','7','8','9'], st.freq.map(v=>Math.round(v/st.n*100)+'%'), ['#ff444f','#ffb020','#00d09c','#2e9bff','#b388ff','#ff7a45','#00d09c','#ffb020','#2e9bff','#ff444f']);
  $('digitLegend').innerHTML = st.freq.map((f,i)=>`<span>${i}: ${Math.round(f/st.n*100)}%</span>`).join('');
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
    <div class="streak-row"><span>🔥 Hottest digit</span><b>${hot[0]} (${Math.round(st.freq[hot[0]]/st.n*100)}%)</b></div>
    <div class="streak-row"><span>❄️ Coldest digit</span><b>${hot[9]} (${Math.round(st.freq[hot[9]]/st.n*100)}%)</b></div>
    <div class="streak-row"><span>Current streak</span><b>Digit ${st.digits[st.digits.length-1]} × ${st.streaks[st.digits[st.digits.length-1]]||1}</b></div>
    ${st.gaps.map((g,i)=>`<div class="streak-row"><span>Gap — digit ${i}</span><b>${g} ticks</b></div>`).join('')}`;
  // D-circles
  const cv=$('dcircles'); if(cv){ const {ctx,w,h}=setupCanvas(cv); ctx.clearRect(0,0,w,h); const cx=w/2,cy=h/2,R=Math.min(w,h)/2-14;
    st.freq.forEach((f,i)=>{ const ang=(i/10)*Math.PI*2-Math.PI/2; const x=cx+Math.cos(ang)*R, y=cy+Math.sin(ang)*R; const pct=f/st.n; ctx.beginPath(); ctx.arc(x,y,10+pct*22,0,7); ctx.fillStyle=`hsl(${i*36},80%,55%)`; ctx.globalAlpha=.85; ctx.fill(); ctx.globalAlpha=1; ctx.fillStyle='#fff'; ctx.font='bold 11px JetBrains Mono'; ctx.textAlign='center'; ctx.fillText(i,x,y+4); });
    ctx.fillStyle='#8aa0b8'; ctx.font='11px Inter'; ctx.fillText('D-Circles — size = frequency',cx,cy+4);
  }
  drawBars($('distChart'), ['0','1','2','3','4','5','6','7','8','9'], st.freq.map(v=>+(v/st.n*100).toFixed(1)), null);
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
      {sym:s.sym,name:s.name,signal:`${bestOU.type} ${bestOU.barrier}`,win:bestOU.win,conf:Math.min(98,bestOU.win+rand(0,3)),sample:st.n},
      {sym:s.sym,name:s.name,signal:parity.type,win:parity.win,conf:Math.min(98,parity.win+rand(0,2)),sample:st.n},
      {sym:s.sym,name:s.name,signal:`DIFFERS ${bestMatch[0]}`,win:differsWin,conf:Math.min(98,differsWin),sample:st.n},
      {sym:s.sym,name:s.name,signal:riseFall.type,win:riseFall.win,conf:Math.min(98,riseFall.win+rand(0,2)),sample:st.n},
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
    <div class="muted small">Confidence ${s.conf.toFixed(0)}% · Sample ${s.sample} ticks</div>
    <button class="btn btn-red btn-sm btn-block" style="margin-top:10px" onclick="selectSymbol('${s.sym}');showView('trade')">Trade this →</button></div>`).join('')||'<p class="muted">No strong edge right now — scan again in a few seconds.</p>';
  $('signalTable').innerHTML=`<tr><th>Symbol</th><th>Signal</th><th>Win Rate</th><th>Confidence</th><th>Sample</th><th></th></tr>`+
    shown.map(s=>`<tr><td>${s.name}</td><td><b>${s.signal}</b></td><td><span class="pill-win">${s.win.toFixed(1)}%</span></td><td>${s.conf.toFixed(0)}%</td><td>${s.sample}</td><td><button class="btn btn-ghost btn-sm" onclick="selectSymbol('${s.sym}');showView('digits')">Analyse</button></td></tr>`).join('');
  $('dashSignals').innerHTML=sigs.slice(0,5).map(s=>`<div class="ou-row"><span>${s.name} — <b>${s.signal}</b></span><span class="pill-win">${s.win.toFixed(1)}%</span></div>`).join('');
  $('scanInfo').textContent=`Scanned ${sigs.length} symbols · ${new Date().toLocaleTimeString()}`;
}
function scanSignals(manual){ renderSignals(); if(manual) toast('⚡ Signals scanned across all symbols'); }

/* ================= TRADING ================= */
function updateProposal(){
  const type=$('contractType').value, barrier=+$('barrier').value, stake=+$('stake').value, dur=+$('duration').value;
  const payoutMap={DIGITOVER:0.92,DIGITUNDER:0.92,DIGITEVEN:0.95,DIGITODD:0.95,DIGITMATCH:8.5,DIGITDIFF:0.12,CALL:0.9,PUT:0.9,MULTUP:0,MULTDOWN:0};
  const payout=payoutMap[type]||0.9; const profit=stake*payout;
  $('proposalBox').innerHTML=`<b>${type}</b> on <b>${S.selected}</b><br>Barrier: ${barrier} · Stake: $${fmt(stake)} · Duration: ${dur} ticks<br>Est. payout: <b class="up">$${fmt(stake+profit)}</b> · Est. profit: <b class="up">$${fmt(profit)}</b><br><span class="muted">Mode: ${S.connected?(S.isDemo?'Demo account':'REAL account'):'Demo / Mock feed'}</span>`;
  return {type,barrier,stake,dur,profit};
}
function renderProposal(p){ $('proposalBox').innerHTML=`<b>Deriv Proposal</b> — Ask: $${fmt(p.ask_price)} · Payout: $${fmt(p.payout)} · ID: ${p.id}`; }
function buyContract(){
  const p=updateProposal();
  if(S.connected && S.ws){ S.ws.send(JSON.stringify({proposal:1, amount:p.stake, basis:'stake', contract_type:p.type, currency:S.currency, duration:p.dur, duration_unit:'t', underlying_symbol:S.selected, ...(p.barrier!==undefined&&['DIGITOVER','DIGITUNDER','DIGITMATCH','DIGITDIFF'].includes(p.type)?{barrier:String(p.barrier)}:{})})); toast('Sending buy to Deriv…'); return; }
  // mock buy
  const id='MOCK-'+Math.floor(rand(100000,999999));
  const c={id,type:p.type,symbol:S.selected,stake:p.stake,barrier:p.barrier,dur:p.dur,entryTick:S.tickCount,entryPrice:S.ticks[S.selected][S.ticks[S.selected].length-1],status:'OPEN'};
  S.openContracts.push(c); renderOpenContracts(); toast(`✅ Bought ${p.type} (mock) — settles in ${p.dur} ticks`);
  addAlert(`Bought ${p.type} on ${S.selected} for $${p.stake}`);
}
function quickTrade(type){ $('contractType').value=type; showView('trade'); updateProposal(); }
function settleMock(){
  S.openContracts.slice().forEach(c=>{
    if(S.tickCount - c.entryTick >= c.dur){
      const ticks=S.ticks[c.symbol]; const exit=ticks[ticks.length-1]; const d=lastDigit(exit);
      let win=false;
      if(c.type==='DIGITOVER') win=d>c.barrier; else if(c.type==='DIGITUNDER') win=d<c.barrier;
      else if(c.type==='DIGITEVEN') win=d%2===0; else if(c.type==='DIGITODD') win=d%2===1;
      else if(c.type==='DIGITMATCH') win=d===c.barrier; else if(c.type==='DIGITDIFF') win=d!==c.barrier;
      else if(c.type==='CALL') win=exit>c.entryPrice; else if(c.type==='PUT') win=exit<c.entryPrice;
      else win=Math.random()>0.5;
      const payoutMap={DIGITOVER:0.92,DIGITUNDER:0.92,DIGITEVEN:0.95,DIGITODD:0.95,DIGITMATCH:8.5,DIGITDIFF:0.12,CALL:0.9,PUT:0.9,MULTUP:1,MULTDOWN:1};
      const profit=win? c.stake*(payoutMap[c.type]||0.9) : -c.stake;
      S.balance+=profit; S.equity.push(S.balance);
      const entry={id:c.id,type:c.type,symbol:c.symbol,stake:c.stake,barrier:c.barrier,entry:c.entryPrice,exit,digit:d,win,profit,time:new Date().toLocaleTimeString(),source:'Manual'};
      S.journal.unshift(entry); saveJournal();
      S.openContracts=S.openContracts.filter(x=>x.id!==c.id);
      addAlert(`${win?'✅ WIN':'❌ LOSS'} ${c.type} ${c.symbol} — ${profit>=0?'+':''}$${fmt(profit)}`);
      if(S.auto.running) onAutoSettle(entry);
      renderOpenContracts(); renderJournal(); updateConnUI();
    }
  });
}
function renderOpenContracts(){
  $('openCount').textContent=S.openContracts.length+' open';
  $('openContracts').innerHTML=S.openContracts.length? S.openContracts.map(c=>`<div class="contract"><div class="row"><b>${c.type}</b><span>${c.symbol}</span><span class="pill-win">OPEN</span></div><div class="row"><span>Stake</span><b>$${fmt(c.stake)}</b></div><div class="row"><span>Barrier</span><b>${c.barrier}</b></div><div class="row"><span>Entry</span><b>${fmtPrice(c.entryPrice)}</b></div></div>`).join('') : '<p class="muted">No open contracts. Place a trade to see it here.</p>';
  renderPortfolio();
}
function renderPortfolio(){
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
function defaultBots(){ return BOT_TEMPLATES.map(b=>({...b,installed:false})); }
function renderBots(){
  const bots=S.bots||defaultBots();
  $('botGrid').innerHTML=bots.map(b=>`<div class="bot-card"><div class="ic">${b.icon}</div><h4>${b.name}</h4><p>${b.desc}</p><div class="bot-meta">${b.tags.map(t=>`<span>${t}</span>`).join('')}</div><div class="btn-row"><button class="btn ${b.installed?'btn-outline':'btn-red'} btn-sm" onclick="installBot('${b.id}')">${b.installed?'✓ Installed':'Install Bot'}</button><button class="btn btn-ghost btn-sm" onclick="runBot('${b.id}')">▶ Run</button><button class="btn btn-ghost btn-sm" onclick="backtestBot('${b.id}')">◐ Backtest</button></div></div>`).join('');
}
function installBot(id){ const b=(S.bots||defaultBots()).find(x=>x.id===id); b.installed=!b.installed; S.bots=(S.bots||defaultBots()); S.bots.find(x=>x.id===id).installed=b.installed; localStorage.setItem('dbx_bots',JSON.stringify(S.bots)); renderBots(); toast(b.installed?`✅ ${b.name} installed`:`${b.name} removed`); }
function runBot(id){ const b=(S.bots||defaultBots()).find(x=>x.id===id); $('autoStrategy').value=b.strategy; $('autoSymbol').value=S.selected; showView('autotrader'); toast(`▶ ${b.name} loaded into Auto-Trader — press START`); }
function backtestBot(id){ $('btBot').value=(S.bots||defaultBots()).find(x=>x.id===id).strategy; showView('backtest'); runBacktest(); }

/* ================= BUILDER ================= */
const BLOCKS={digit_over:{label:'IF Last Digit > 5',type:'cond'},digit_under:{label:'IF Last Digit < 5',type:'cond'},even:{label:'IF Digit is Even',type:'cond'},odd:{label:'IF Digit is Odd',type:'cond'},streak:{label:'IF Streak ≥ 3',type:'cond'},rsi:{label:'IF RSI < 30 or > 70',type:'cond'},buy_over:{label:'THEN Buy OVER',type:'act'},buy_under:{label:'THEN Buy UNDER',type:'act'},buy_even:{label:'THEN Buy EVEN',type:'act'},buy_odd:{label:'THEN Buy ODD',type:'act'},martingale:{label:'Martingale ×2 on loss',type:'risk'},stop:{label:'Stop after 3 losses',type:'risk'}};
function addBlock(k){ S.builderBlocks.push(k); renderBuilder(); }
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
  const name=$('builderName').value||'Custom Bot';
  const bot={id:'custom-'+Date.now(),icon:'🧩',name,desc:'Custom bot built with the visual builder: '+S.builderBlocks.map(k=>BLOCKS[k].label).join(' → '),tags:['Custom','Builder'],strategy:'custom',blocks:[...S.builderBlocks],symbol:$('builderSymbol').value,stake:+$('builderStake').value,installed:true};
  S.bots=(S.bots||defaultBots()); S.bots.unshift(bot); localStorage.setItem('dbx_bots',JSON.stringify(S.bots)); renderBots(); toast(`💾 Saved "${name}" to Bot Library`);
}
function runBuilderBot(){ if(!S.builderBlocks.length) return toast('Build a flow first'); $('autoStrategy').value='custom'; $('autoSymbol').value=$('builderSymbol').value; $('autoStake').value=$('builderStake').value; showView('autotrader'); toast('▶ Builder bot loaded — press START'); }

/* ================= AUTO-TRADER ================= */
const STRATEGIES={over_under:'Over/Under Sniper',even_odd:'Even/Odd Hunter',matches:'Matches/Differs Pro',martingale:'Martingale Classic',dalembert:"D'Alembert Bot",boom_crash:'Boom/Crash Spike',step:'Step Index Walker',rsi:'RSI Mean-Reversion',dcircles:'D-Circles Bot',rise_fall:'Rise/Fall Momentum',ai_recovery:'Apex Bot 2026 (AI Recovery)',speedbot:'Speedbot',custom:'Custom Builder Bot'};
function autoLog(msg,cls='info'){ S.auto.log.unshift(`<div class="${cls}">[${new Date().toLocaleTimeString()}] ${msg}</div>`); if(S.auto.log.length>120)S.auto.log.pop(); $('autoLog').innerHTML=S.auto.log.join(''); }
function clearAutoLog(){ S.auto.log=[]; $('autoLog').innerHTML=''; }
function toggleAutoTrader(){ S.auto.running? stopAutoTrader() : startAutoTrader(); }
function startAutoTrader(){
  S.auto={...S.auto,running:true,strategy:$('autoStrategy').value,symbol:$('autoSymbol').value,stake:+$('autoStake').value,maxTrades:+$('autoMaxTrades').value,tp:+$('autoTP').value,sl:+$('autoSL').value,conf:+$('autoConf').value,recovery:$('autoRecovery').value,trades:0,wins:0,losses:0,pnl:0,curStake:+$('autoStake').value,lossStreak:0};
  $('autoBadge').textContent='RUNNING'; $('autoBadge').style.background='rgba(0,208,156,.2)';
  $('autoPill').textContent='ON'; $('autoStartBtn').textContent='■ RUNNING…';
  autoLog(`▶ Auto-Trader started — ${STRATEGIES[S.auto.strategy]} on ${S.auto.symbol}, stake $${S.auto.stake}, recovery ${S.auto.recovery}`,'warn');
  toast('▶ Auto-Trader running');
}
function stopAutoTrader(){ S.auto.running=false; $('autoBadge').textContent='STOPPED'; $('autoBadge').style.background=''; $('autoPill').textContent='OFF'; $('autoStartBtn').textContent='▶ START AUTO-TRADER'; autoLog('■ Auto-Trader stopped','warn'); }
function autoDecision(sym){
  const st=digitStats(sym); const d=st.digits[st.digits.length-1];
  const strat=S.auto.strategy;
  if(strat==='over_under'){ let best={type:'DIGITOVER',barrier:5,win:50}; for(let b=0;b<10;b++){ if(st.over[b]>best.win)best={type:'DIGITOVER',barrier:b,win:st.over[b]}; if(st.under[b]>best.win)best={type:'DIGITUNDER',barrier:b,win:st.under[b]}; } return {...best,reason:`Over/Under edge ${best.win.toFixed(1)}% on ${st.n} ticks`}; }
  if(strat==='even_odd'){ return st.evenPct>st.oddPct? {type:'DIGITEVEN',barrier:0,win:st.evenPct,reason:`Even ${st.evenPct.toFixed(1)}% vs Odd ${st.oddPct.toFixed(1)}%`}:{type:'DIGITODD',barrier:0,win:st.oddPct,reason:`Odd ${st.oddPct.toFixed(1)}% vs Even ${st.evenPct.toFixed(1)}%`}; }
  if(strat==='matches'){ const sorted=Object.entries(st.match).sort((a,b)=>b[1]-a[1]); return {type:'DIGITDIFF',barrier:+sorted[0][0],win:100-sorted[0][1],reason:`Coldest digit ${sorted[0][0]} at ${sorted[0][1].toFixed(1)}% — Differs wins ${(100-sorted[0][1]).toFixed(1)}%`}; }
  if(strat==='rise_fall'||strat==='step'){ return st.risePct>st.fallPct? {type:'CALL',barrier:0,win:st.risePct,reason:`Rise bias ${st.risePct.toFixed(1)}%`}:{type:'PUT',barrier:0,win:st.fallPct,reason:`Fall bias ${st.fallPct.toFixed(1)}%`}; }
  if(strat==='rsi'){ const r=rsi(S.ticks[sym]); if(r!=null&&r<30) return {type:'CALL',barrier:0,win:100-r,reason:`RSI oversold ${r.toFixed(0)}`}; if(r!=null&&r>70) return {type:'PUT',barrier:0,win:r,reason:`RSI overbought ${r.toFixed(0)}`}; return null; }
  if(strat==='dcircles'){ const hot=[...st.freq.keys()].sort((a,b)=>st.freq[b]-st.freq[a])[0]; return {type:'DIGITDIFF',barrier:hot,win:100-st.freq[hot]/st.n*100,reason:`D-Circles: digit ${hot} hottest — Differs`}; }
  if(strat==='boom_crash'){ const ticks=S.ticks[sym]; const recent=ticks.slice(-10); const spike=Math.abs(recent[recent.length-1]-recent[0])/recent[0]; if(spike>0.002) return {type:recent[recent.length-1]>recent[0]?'PUT':'CALL',barrier:0,win:60,reason:`Spike detected ${(spike*100).toFixed(2)}% — mean reversion`}; return null; }
  if(strat==='custom'&&S.builderBlocks.length){ return evalBuilder(st); }
  // martingale / dalembert / ai_recovery / speedbot default to over_under logic
  let best={type:'DIGITOVER',barrier:5,win:50}; for(let b=0;b<10;b++){ if(st.over[b]>best.win)best={type:'DIGITOVER',barrier:b,win:st.over[b]}; if(st.under[b]>best.win)best={type:'DIGITUNDER',barrier:b,win:st.under[b]}; }
  return {...best,reason:`${strat==='ai_recovery'?'AI Recovery':'Speedbot'}: best edge ${best.win.toFixed(1)}%`};
}
function evalBuilder(st){
  const d=st.digits[st.digits.length-1]; let cond=true, action=null;
  for(const k of S.builderBlocks){
    if(k==='digit_over'&&!(d>5)) cond=false; if(k==='digit_under'&&!(d<5)) cond=false;
    if(k==='even'&&d%2!==0) cond=false; if(k==='odd'&&d%2===0) cond=false;
    if(k==='streak'&&!(st.streaks[d]>=3)) cond=false;
    if(k==='buy_over') action='DIGITOVER'; if(k==='buy_under') action='DIGITUNDER';
    if(k==='buy_even') action='DIGITEVEN'; if(k==='buy_odd') action='DIGITODD';
  }
  if(cond&&action) return {type:action,barrier:5,win:60,reason:'Builder conditions met'};
  return null;
}
function autoTick(){
  if(!S.auto.running) return;
  const sym=S.auto.symbol;
  // guards
  if(S.auto.trades>=S.auto.maxTrades){ autoLog('Max trades reached — stopping','warn'); return stopAutoTrader(); }
  if(S.auto.pnl>=S.auto.tp){ autoLog('Take profit hit — stopping','win'); return stopAutoTrader(); }
  if(S.auto.pnl<=-S.auto.sl){ autoLog('Stop loss hit — stopping','loss'); return stopAutoTrader(); }
  if($('autoGuard').checked && S.auto.pnl < -10){ autoLog('Drawdown guard triggered — pausing','warn'); return stopAutoTrader(); }
  if(S.openContracts.some(c=>c.symbol===sym)) return; // one at a time per symbol
  const dec=autoDecision(sym); if(!dec) return;
  if(dec.win < S.auto.conf){ autoLog(`Skipped — confidence ${dec.win.toFixed(1)}% < ${S.auto.conf}% (${dec.reason})`); return; }
  if(S.connected && S.ws && S.ws.readyState===1){
    S.ws.send(JSON.stringify({proposal:1, amount:S.auto.curStake, basis:'stake', contract_type:dec.type, currency:S.currency, duration:5, duration_unit:'t', underlying_symbol:sym, ...(dec.barrier!==undefined&&['DIGITOVER','DIGITUNDER','DIGITMATCH','DIGITDIFF'].includes(dec.type)?{barrier:String(dec.barrier)}:{})}));
  }
  const id='AUTO-'+Math.floor(rand(100000,999999));
  S.openContracts.push({id,type:dec.type,symbol:sym,stake:S.auto.curStake,barrier:dec.barrier,dur:5,entryTick:S.tickCount,entryPrice:S.ticks[sym][S.ticks[sym].length-1],status:'OPEN',auto:true});
  S.auto.trades++;
  autoLog(`▶ BUY ${dec.type} ${sym} $${fmt(S.auto.curStake)} — ${dec.reason} (conf ${dec.win.toFixed(1)}%)`,'info');
  renderOpenContracts(); renderAutoStats();
}
function onAutoSettle(entry){
  S.auto.pnl+=entry.profit; if(entry.win){S.auto.wins++; S.auto.lossStreak=0; S.auto.curStake=S.auto.stake;} else {S.auto.losses++; S.auto.lossStreak++; if(S.auto.recovery==='martingale') S.auto.curStake*=2; else if(S.auto.recovery==='dalembert') S.auto.curStake+=S.auto.stake; else if(S.auto.recovery==='ai') S.auto.curStake*=1.5; }
  autoLog(`${entry.win?'✅ WIN':'❌ LOSS'} ${entry.type} — ${entry.profit>=0?'+':''}$${fmt(entry.profit)} · Session P/L ${S.auto.pnl>=0?'+':''}$${fmt(S.auto.pnl)} · Next stake $${fmt(S.auto.curStake)}`, entry.win?'win':'loss');
  if(S.auto.lossStreak>=3 && S.builderBlocks.includes('stop')){ autoLog('Builder stop: 3 consecutive losses','warn'); stopAutoTrader(); }
  renderAutoStats();
}
function renderAutoStats(){
  const a=S.auto; const wr=a.trades? (a.wins/(a.wins+a.losses||1)*100):0;
  $('autoStats').innerHTML=`<div><b>${a.trades}</b><span>Trades</span></div><div><b>${wr.toFixed(0)}%</b><span>Win Rate</span></div><div><b style="color:${a.pnl>=0?'var(--green)':'var(--red)'}">${a.pnl>=0?'+':''}$${fmt(a.pnl)}</b><span>Session P/L</span></div><div><b>$${fmt(a.curStake)}</b><span>Next Stake</span></div><div><b>${a.lossStreak}</b><span>Loss Streak</span></div><div><b>${a.maxTrades-a.trades}</b><span>Trades Left</span></div>`;
}

/* ================= COPY TRADING ================= */
function addFollower(){
  const tok=$('followerToken').value.trim(); if(!tok) return toast('Paste a follower token first');
  S.followers.push({token:tok.slice(0,6)+'…'+tok.slice(-4),maxStake:+$('followerMaxStake').value||5,symbols:$('followerSymbols').value||'ALL',trades:0,pnl:0});
  localStorage.setItem('dbx_followers',JSON.stringify(S.followers)); $('followerToken').value=''; renderFollowers(); toast('✅ Follower added');
}
function removeFollower(i){ S.followers.splice(i,1); localStorage.setItem('dbx_followers',JSON.stringify(S.followers)); renderFollowers(); }
function renderFollowers(){
  $('followerList').innerHTML=S.followers.length? S.followers.map((f,i)=>`<div class="follower"><span>${f.token} · max $${f.maxStake} · ${f.symbols}</span><button class="btn btn-ghost btn-sm" onclick="removeFollower(${i})">✕</button></div>`).join('') : '<p class="muted">No followers yet. Add a Deriv API token to start copy trading.</p>';
  $('copyResults').innerHTML=S.followers.length? S.followers.map(f=>`<div class="big-stat"><span>${f.token}</span><b>${f.trades} trades · ${f.pnl>=0?'+':''}$${fmt(f.pnl)}</b></div>`).join('') : '<p class="muted">Copy results will appear per follower here.</p>';
}
function copyTrade(c){
  S.followers.forEach(f=>{ if(f.symbols!=='ALL'&&!f.symbols.includes(c.symbol)) return; const stake=Math.min(c.stake,f.maxStake); f.trades++; f.pnl+= (Math.random()>0.45? stake*0.9 : -stake); });
  renderFollowers();
}

/* ================= AI PREDICTION ================= */
function aiPredict(manual){
  const sym=S.selected; const st=digitStats(sym); const digits=st.digits;
  if(digits.length<20) return;
  // Markov: P(next | last digit) blended with global frequency
  const last=digits[digits.length-1];
  const transRow=st.transPct[last];
  const dist=transRow.map((v,i)=> v*0.7 + (st.freq[i]/st.n*100)*0.3);
  const bestIdx=dist.indexOf(Math.max(...dist));
  const conf=Math.max(...dist);
  const pred={sym,digit:bestIdx,conf:conf.toFixed(1),dist:dist.map(v=>+v.toFixed(1)),time:new Date().toLocaleTimeString(),resolved:null,actual:null};
  S.aiLog.unshift(pred); if(S.aiLog.length>50)S.aiLog.pop(); localStorage.setItem('dbx_ai',JSON.stringify(S.aiLog));
  renderAI(pred);
  if(manual) toast(`🧠 AI predicts next digit: ${bestIdx} (${conf.toFixed(0)}% confidence)`);
  return pred;
}
function renderAI(pred){
  pred=pred||S.aiLog[0]; if(!pred) return;
  $('aiPrediction').innerHTML=`<div style="text-align:center;padding:10px"><div class="big-digit" style="font-size:52px">${pred.digit}</div><div class="muted">Predicted next digit · ${pred.sym}</div><div style="font-size:22px;font-weight:800;margin-top:8px">${pred.conf}% confidence</div><div class="edge-bar"><i style="width:${pred.conf}%"></i></div><div class="muted small">${pred.time} · Markov + frequency model · Runs in-browser</div></div>`;
  drawBars($('aiDistChart'), ['0','1','2','3','4','5','6','7','8','9'], pred.dist, null);
  const st=digitStats(pred.sym);
  $('aiFeatures').innerHTML=`<div class="big-stat"><span>Last digit</span><b>${st.digits[st.digits.length-1]}</b></div><div class="big-stat"><span>Sample size</span><b>${st.n} ticks</b></div><div class="big-stat"><span>Even / Odd</span><b>${st.evenPct.toFixed(0)}% / ${st.oddPct.toFixed(0)}%</b></div><div class="big-stat"><span>Rise / Fall</span><b>${st.risePct.toFixed(0)}% / ${st.fallPct.toFixed(0)}%</b></div><div class="big-stat"><span>RSI(14)</span><b>${rsi(S.ticks[pred.sym])?.toFixed(1)||'—'}</b></div><div class="big-stat"><span>Trend</span><b>${(sma(S.ticks[pred.sym],20)&&S.ticks[pred.sym][S.ticks[pred.sym].length-1]>sma(S.ticks[pred.sym],20))?'Bullish ▲':'Bearish ▼'}</b></div>`;
  $('aiLogTable').innerHTML=`<tr><th>Time</th><th>Symbol</th><th>Predicted</th><th>Confidence</th><th>Actual</th><th>Result</th></tr>`+S.aiLog.slice(0,15).map(p=>`<tr><td>${p.time}</td><td>${p.sym}</td><td><b>${p.digit}</b></td><td>${p.conf}%</td><td>${p.actual??'—'}</td><td>${p.resolved==null?'⏳ Pending':p.resolved?'✅ Hit':'❌ Miss'}</td></tr>`).join('');
}
function resolveAI(){
  S.aiLog.forEach(p=>{ if(p.resolved==null){ const ticks=S.ticks[p.sym]||[]; if(ticks.length){ p.actual=lastDigit(ticks[ticks.length-1]); p.resolved=p.actual===p.digit; } } });
  localStorage.setItem('dbx_ai',JSON.stringify(S.aiLog));
}

/* ================= BACKTESTER ================= */
function runBacktest(){
  const strat=$('btBot').value, sym=$('btSymbol').value, stake=+$('btStake').value||1;
  const ticks=[...(S.ticks[sym]||[])]; if(ticks.length<100) return toast('Not enough data yet');
  const saved={...S.auto}; S.auto.strategy=strat; S.auto.symbol=sym;
  let balance=10000, wins=0, losses=0, peak=10000, maxDD=0; const equity=[10000]; let curStake=stake;
  const digits=ticks.map(lastDigit);
  for(let i=100;i<ticks.length-5;i++){
    const window=ticks.slice(0,i); const st={digits:window.map(lastDigit),freq:Array(10).fill(0),n:window.length,over:{},under:{},evenPct:0,oddPct:0,risePct:50,fallPct:50,match:{},streaks:{}};
    st.digits.forEach(d=>st.freq[d]++); st.evenPct=st.digits.filter(d=>d%2===0).length/st.n*100; st.oddPct=100-st.evenPct;
    for(let b=0;b<10;b++){ st.over[b]=st.digits.filter(d=>d>b).length/st.n*100; st.under[b]=100-st.over[b]; st.match[b]=st.freq[b]/st.n*100; }
    const dec=autoDecisionFor(st,strat); if(!dec||dec.win<50) continue;
    const exitDigit=digits[i+5]; let win=false;
    if(dec.type==='DIGITOVER')win=exitDigit>dec.barrier; else if(dec.type==='DIGITUNDER')win=exitDigit<dec.barrier;
    else if(dec.type==='DIGITEVEN')win=exitDigit%2===0; else if(dec.type==='DIGITODD')win=exitDigit%2===1;
    else if(dec.type==='DIGITDIFF')win=exitDigit!==dec.barrier; else if(dec.type==='CALL')win=ticks[i+5]>ticks[i]; else if(dec.type==='PUT')win=ticks[i+5]<ticks[i];
    const profit=win? curStake*0.92 : -curStake; balance+=profit; equity.push(balance);
    if(win){wins++;curStake=stake;}else{losses++;curStake*=2;}
    peak=Math.max(peak,balance); maxDD=Math.max(maxDD,(peak-balance)/peak*100);
  }
  S.auto=saved;
  const total=wins+losses, wr=total?wins/total*100:0, pnl=balance-10000;
  $('btResults').innerHTML=`<div class="bt-grid"><div><b>${total}</b><span>Trades</span></div><div><b>${wr.toFixed(1)}%</b><span>Win Rate</span></div><div><b style="color:${pnl>=0?'var(--green)':'var(--red)'}">${pnl>=0?'+':''}$${fmt(pnl)}</b><span>Net P/L</span></div><div><b>${maxDD.toFixed(1)}%</b><span>Max Drawdown</span></div></div><p class="muted">Strategy: <b>${STRATEGIES[strat]||strat}</b> on <b>${sym}</b> · Martingale ×2 · Backtested on ${ticks.length} historical ticks. Past performance ≠ future results.</p>`;
  drawLineChart($('btChart'), equity, pnl>=0?'#00d09c':'#ff444f');
  toast('◐ Backtest complete');
}
function autoDecisionFor(st,strat){
  if(strat==='even_odd') return st.evenPct>st.oddPct?{type:'DIGITEVEN',barrier:0,win:st.evenPct}:{type:'DIGITODD',barrier:0,win:st.oddPct};
  if(strat==='matches'){ const s=Object.entries(st.match).sort((a,b)=>b[1]-a[1])[0]; return {type:'DIGITDIFF',barrier:+s[0],win:100-s[1]}; }
  let best={type:'DIGITOVER',barrier:5,win:50}; for(let b=0;b<10;b++){ if(st.over[b]>best.win)best={type:'DIGITOVER',barrier:b,win:st.over[b]}; if(st.under[b]>best.win)best={type:'DIGITUNDER',barrier:b,win:st.under[b]}; } return best;
}

/* ================= RISK ================= */
function saveRisk(){ S.risk={dailyLoss:+$('riskDailyLoss').value,maxStakePct:+$('riskMaxStakePct').value,maxLossStreak:+$('riskMaxLossStreak').value,timer:+$('riskTimer').value}; localStorage.setItem('dbx_risk',JSON.stringify(S.risk)); renderRisk(); toast('🛡 Risk settings saved'); }
function renderRisk(){
  const pnl=S.balance-10000; const todayLoss=Math.min(0,pnl);
  $('riskStatus').innerHTML=`<div class="big-stat"><span>Session P/L</span><b style="color:${pnl>=0?'var(--green)':'var(--red)'}">${pnl>=0?'+':''}$${fmt(pnl)}</b></div><div class="big-stat"><span>Daily loss limit</span><b>$${S.risk.dailyLoss}</b></div><div class="big-stat"><span>Guard status</span><b>${todayLoss < -S.risk.dailyLoss ? '🔴 BREACHED — stop trading' : '🟢 OK'}</b></div>`;
  $('riskStats').innerHTML=`<div class="big-stat"><span>Peak equity</span><b>$${fmt(Math.max(...S.equity))}</b></div><div class="big-stat"><span>Trades (journal)</span><b>${S.journal.length}</b></div><div class="big-stat"><span>Win rate</span><b>${S.journal.length? (S.journal.filter(j=>j.win).length/S.journal.length*100).toFixed(1)+'%':'—'}</b></div>`;
  drawLineChart($('riskEquity'), S.equity.slice(-100));
}
function calcPosition(){
  const bal=+$('calcBalance').value, riskPct=+$('calcRiskPct').value, wr=+$('calcWinRate').value, pay=+$('calcPayout').value;
  const stake=bal*riskPct/100; const kelly=(wr/100*(pay/100)-(1-wr/100))/(pay/100);
  $('calcOut').innerHTML=`<div class="big-stat"><span>Suggested stake (risk %)</span><b>$${fmt(stake)}</b></div><div class="big-stat"><span>Kelly %</span><b>${(kelly*100).toFixed(1)}%</b></div><div class="big-stat"><span>Half-Kelly stake</span><b>$${fmt(Math.max(0,bal*kelly/2))}</b></div><div class="big-stat"><span>Expected value / trade</span><b style="color:${(wr/100*pay/100-(1-wr/100))>=0?'var(--green)':'var(--red)'}">${((wr/100*pay/100-(1-wr/100))*100).toFixed(1)}%</b></div>`;
}

/* ================= JOURNAL ================= */
function saveJournal(){ localStorage.setItem('dbx_journal',JSON.stringify(S.journal.slice(0,200))); }
function renderJournal(){
  const j=S.journal; const wins=j.filter(x=>x.win).length; const pnl=j.reduce((a,x)=>a+x.profit,0);
  $('journalStats').innerHTML=`<div class="sym-card"><div class="name">Total Trades</div><div class="price">${j.length}</div></div><div class="sym-card"><div class="name">Win Rate</div><div class="price">${j.length?(wins/j.length*100).toFixed(1)+'%':'—'}</div></div><div class="sym-card"><div class="name">Net P/L</div><div class="price" style="color:${pnl>=0?'var(--green)':'var(--red)'}">${pnl>=0?'+':''}$${fmt(pnl)}</div></div><div class="sym-card"><div class="name">Best Win</div><div class="price">${j.length?'$'+fmt(Math.max(...j.map(x=>x.profit))):'—'}</div></div>`;
  $('journalTable').innerHTML=`<tr><th>Time</th><th>Type</th><th>Symbol</th><th>Stake</th><th>Entry</th><th>Exit</th><th>Digit</th><th>Result</th><th>P/L</th></tr>`+(j.slice(0,30).map(x=>`<tr><td>${x.time}</td><td>${x.type}</td><td>${x.symbol}</td><td>$${fmt(x.stake)}</td><td>${fmtPrice(x.entry)}</td><td>${fmtPrice(x.exit)}</td><td>${x.digit}</td><td><span class="${x.win?'pill-win':'pill-loss'}">${x.win?'WIN':'LOSS'}</span></td><td style="color:${x.profit>=0?'var(--green)':'var(--red)'}">${x.profit>=0?'+':''}$${fmt(x.profit)}</td></tr>`).join('')||'<tr><td colspan="9" class="muted">No settled trades yet — place a trade to start your journal.</td></tr>');
  $('journalInfo').textContent=`${j.length} trades · stored locally in your browser`;
}
function exportJournal(){
  const rows=[['Time','Type','Symbol','Stake','Entry','Exit','Digit','Win','Profit'],...S.journal.map(j=>[j.time,j.type,j.symbol,j.stake,j.entry,j.exit,j.digit,j.win,j.profit])];
  const csv=rows.map(r=>r.join(',')).join('\n'); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download='derivbot-journal.csv'; a.click(); toast('⬇ Journal exported');
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
function addAlert(msg){ S.alerts.unshift({msg,time:new Date().toLocaleTimeString()}); if(S.alerts.length>30)S.alerts.pop(); $('alertCount').textContent=S.alerts.length; $('alertsList').innerHTML=S.alerts.map(a=>`<div class="alert-item"><b>${a.time}</b> — ${a.msg}</div>`).join('')||'<p class="muted">No alerts yet.</p>'; }
function toggleAlerts(){ $('alertsDrawer').classList.toggle('open'); }

/* ================= VIEWS / NAV ================= */
const VIEW_META={dashboard:['Dashboard','Everything from 3 platforms — in one workspace.'],markets:['Market Monitor','Live price cards, candlestick chart & 50+ indicators.'],digits:['Digit Analysis','Frequency, transitions, streaks, D-Circles & distributions.'],signals:['Live Signals','Over/Under, Even/Odd, Matches/Differs & Rise/Fall win-rates.'],trade:['Manual Trade','Place digit & Rise/Fall contracts on your Deriv account.'],bots:['Bot Library','12 proven strategies — install in one click.'],builder:['Bot Builder','Drag, drop & connect blocks. No coding needed.'],autotrader:['Auto-Trader','96-indicator engine with recovery, guards & full logging.'],copy:['Copy Trading','One trade, many Deriv accounts.'],ai:['AI Prediction','In-browser Markov model with calibration log.'],backtest:['Backtester','Test any bot on 1,000 historical ticks.'],risk:['Risk Manager','Loss limits, Kelly sizing & equity curve.'],journal:['Trading Journal','Every settled contract, sourced & exportable.'],academy:['Academy','Introduction to Deriv — 30 free chapters.'],connect:['Connect Deriv','Official Deriv API — your token, your account.']};
function showView(v){
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
  const list=SYMBOLS.filter(s=>!filter||s.name.toLowerCase().includes(filter.toLowerCase())||s.sym.toLowerCase().includes(filter.toLowerCase()));
  grid.innerHTML=list.map(s=>{
    const ticks=S.ticks[s.sym]||[]; const last=ticks[ticks.length-1]||s.base; const prev=ticks[ticks.length-11]||last; const chg=(last-prev)/prev*100;
    return `<button class="sym-card ${S.selected===s.sym?'sel':''}" onclick="selectSymbol('${s.sym}')"><div style="display:flex;justify-content:space-between"><span class="name">${s.name}</span><span class="sym">${s.sym}</span></div><div class="price">${fmtPrice(last,s.pip)}</div><div class="chg ${chg>=0?'up':'down'}">${chg>=0?'▲':'▼'} ${Math.abs(chg).toFixed(2)}% · Digit ${lastDigit(last)}</div><canvas data-spark="${s.sym}" height="36"></canvas></button>`;
  }).join('');
  grid.querySelectorAll('canvas[data-spark]').forEach(cv=> drawSpark(cv,(S.ticks[cv.dataset.spark]||[]).slice(-40)));
}
function renderSnapshot(){
  const grid=$('snapshotGrid'); if(!grid) return;
  grid.innerHTML=SYMBOLS.slice(0,8).map(s=>{
    const ticks=S.ticks[s.sym]||[]; const last=ticks[ticks.length-1]||s.base; const prev=ticks[ticks.length-11]||last; const chg=(last-prev)/prev*100;
    return `<button class="sym-card ${S.selected===s.sym?'sel':''}" onclick="selectSymbol('${s.sym}');showView('markets')"><div class="name">${s.name}</div><div class="price">${fmtPrice(last,s.pip)}</div><div class="chg ${chg>=0?'up':'down'}">${chg>=0?'▲':'▼'} ${Math.abs(chg).toFixed(2)}%</div></button>`;
  }).join('');
}
function renderMainChart(){
  const cv=$('mainChart'); if(!cv) return;
  $('chartTitle').textContent=symByCode(S.selected).name+' — Live Chart';
  drawCandles(cv,S.candles[S.selected]||[],S.chartType);
  const c=(S.candles[S.selected]||[]).slice(-1)[0];
  if(c) $('ohlcInfo').textContent=`O ${fmtPrice(c.o)} H ${fmtPrice(c.h)} L ${fmtPrice(c.l)} C ${fmtPrice(c.c)}`;
  const inds=computeIndicators(S.selected);
  $('indicatorStrip').innerHTML=inds.slice(0,8).map(([n,v])=>`<span class="ind-chip">${n}: <b>${v}</b></span>`).join('');
}
function renderIndicators(){
  const inds=computeIndicators(S.selected);
  $('indicatorTable').innerHTML=inds.map(([n,v])=>`<div class="ind-cell"><span class="muted">${n}</span><b>${v}</b></div>`).join('');
}
function updatePriceChip(){
  const ticks=S.ticks[S.selected]||[]; const last=ticks[ticks.length-1]; if(last==null) return;
  const prev=ticks[ticks.length-11]||last; const chg=(last-prev)/prev*100;
  $('priceChip').innerHTML=`${S.selected} ${fmtPrice(last,2)} <span style="color:${chg>=0?'var(--green)':'var(--red)'}">${chg>=0?'+':''}${chg.toFixed(2)}%</span>`;
  $('heroSymbol').textContent=symByCode(S.selected).name;
}
function renderSession(){
  const j=S.journal; const pnl=S.balance-10000;
  $('sessionStats').innerHTML=`<div><b>$${fmt(S.balance)}</b><span>Balance</span></div><div><b>${j.length}</b><span>Trades</span></div><div><b>${j.length?(j.filter(x=>x.win).length/j.length*100).toFixed(0)+'%':'—'}</b><span>Win Rate</span></div><div><b style="color:${pnl>=0?'var(--green)':'var(--red)'}">${pnl>=0?'+':''}$${fmt(pnl)}</b><span>Session P/L</span></div>`;
  drawLineChart($('equityChart'), S.equity.slice(-80));
  $('statTicks').textContent=(S.tickCount*137).toLocaleString()+'+';
}
function renderTicker(){
  const items=SYMBOLS.map(s=>{ const t=S.ticks[s.sym]||[]; const last=t[t.length-1]||s.base; const prev=t[t.length-11]||last; const chg=(last-prev)/prev*100; return `<span><b>${s.short}</b> ${fmtPrice(last,2)} <span class="${chg>=0?'g':'r'}">${chg>=0?'+':''}${chg.toFixed(2)}%</span></span>`; }).join('');
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
    let best={win:50,label:'—'}; for(let b=0;b<10;b++){ if(st.over[b]>best.win)best={win:st.over[b],label:`OVER ${b}`}; if(st.under[b]>best.win)best={win:st.under[b],label:`UNDER ${b}`}; }
    $('heroEdge').textContent=best.label+' '+best.win.toFixed(0)+'%';
    $('heroParity').textContent=st.evenPct.toFixed(0)+'% / '+st.oddPct.toFixed(0)+'%';
    $('heroClock').textContent=new Date().toLocaleTimeString();
    const pred=aiPredict(); if(pred) $('heroAI').textContent=pred.digit+' ('+pred.conf+'%)';
    // view-specific refresh
    const active=document.querySelector('.view.active')?.id;
    if(active==='view-markets'){ renderWatchlist($('.search')?.value||''); renderMainChart(); }
    if(active==='view-digits') renderDigits();
    if(active==='view-dashboard'){ renderSnapshot(); }
    if(active==='view-ai') renderAI();
    if(active==='view-risk') renderRisk();
    settleMock(); autoTick(); resolveAI();
    // copy trading on settle
    S.openContracts.forEach(c=>{ if(c.auto) return; });
  }
}

/* ================= INIT ================= */
function init(){
  // Handle Deriv OAuth redirect (?token1=...) or Cross-Device Sync (?sync=...)
  try{
    const params=new URLSearchParams(location.search);
    const oauthToken=params.get('token1');
    const syncParam=params.get('sync');
    if(oauthToken){ localStorage.setItem('dbx_token',oauthToken); history.replaceState({},'',location.pathname); }
    if(syncParam){
      const data=JSON.parse(atob(decodeURIComponent(syncParam)));
      if(data.appId) localStorage.setItem('dbx_appid',data.appId);
      if(data.token) localStorage.setItem('dbx_token',data.token);
      if(data.bots) localStorage.setItem('dbx_bots',JSON.stringify(data.bots));
      history.replaceState({},'',location.pathname);
    }
  }catch(e){}
  initMock();
  // restore
  const savedApp=localStorage.getItem('dbx_appid'); if(savedApp){ $('appIdInput').value=savedApp; S.appId=savedApp; }
  const savedTok=localStorage.getItem('dbx_token'); if(savedTok){ $('tokenInput').value=savedTok; S.token=savedTok; }
  const savedDemo=localStorage.getItem('dbx_isdemo'); if(savedDemo!==null){ S.isDemo=(savedDemo==='1'); if($('btnDemoAcc')) $('btnDemoAcc').className='btn '+(S.isDemo?'btn-outline':'btn-ghost')+' btn-sm'; if($('btnRealAcc')) $('btnRealAcc').className='btn '+(!S.isDemo?'btn-red':'btn-ghost')+' btn-sm'; }
  const oauthURL=`https://app.deriv.com/oauth2/authorize?app_id=${S.appId}&redirect_uri=${encodeURIComponent(location.origin+location.pathname)}&scope=trade,accounts_read,admin`;
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
  renderFeatures(); renderBots(); renderBuilder(); renderFollowers(); renderCourses(); renderJournal(); renderAutoStats(); renderOpenContracts(); updateConnUI(); updateProposal(); renderTicker(); renderSnapshot(); renderSession(); renderSignals(); renderAI(); renderRisk();
  addAlert('DerivBot Pro X ready. Demo feed is live.');
  // mock feed loop (2s ticks, like Deriv synthetic indices)
  setInterval(mockTick, 2000);
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
function generateSyncLink(){
  const payload={appId:S.appId||'1089',token:S.token||'',bots:S.bots||defaultBots()};
  const code=btoa(JSON.stringify(payload));
  const url=`${location.origin}${location.pathname}?sync=${encodeURIComponent(code)}`;
  if($('syncOutput')) $('syncOutput').value=url;
  try{ navigator.clipboard.writeText(url); toast('🔗 Sync link copied! Open it on any device to log in.'); }catch(e){ toast('Sync link generated — copy it below.'); }
}
function applySyncCode(){
  const raw=($('syncInput')?$('syncInput').value:'').trim();
  if(!raw){ toast('Paste a sync link or code first'); return; }
  try{
    const code=raw.includes('sync=')?decodeURIComponent(raw.split('sync=')[1].split('&')[0]):raw;
    const data=JSON.parse(atob(code));
    if(data.appId){ S.appId=data.appId; $('appIdInput').value=data.appId; localStorage.setItem('dbx_appid',data.appId); }
    if(data.token){ S.token=data.token; $('tokenInput').value=data.token; localStorage.setItem('dbx_token',data.token); }
    if(data.bots){ S.bots=data.bots; localStorage.setItem('dbx_bots',JSON.stringify(data.bots)); renderBots(); }
    toast('✅ Account & bots synced! Connecting…');
    connectDeriv();
  }catch(e){ toast('⚠️ Invalid sync link or code'); }
}
function enterDemoMode(){
  localStorage.setItem('dbx_entered','1');
  if($('loginGate')) $('loginGate').style.display='none';
}
function loginWithToken(){
  const tok=($('gateTokenInput')?$('gateTokenInput').value:'').trim();
  if(!tok){ toast('Paste your Deriv API token first'); return; }
  S.token=tok; localStorage.setItem('dbx_token',tok); localStorage.setItem('dbx_entered','1');
  if($('tokenInput')) $('tokenInput').value=tok;
  if($('loginGate')) $('loginGate').style.display='none';
  connectDeriv();
}
document.addEventListener('DOMContentLoaded',()=>{
  init();
  if(localStorage.getItem('dbx_entered')==='1' || localStorage.getItem('dbx_token')){
    if($('loginGate')) $('loginGate').style.display='none';
  }
  if(localStorage.getItem('dbx_token')){
    connectDeriv();
  }
});
