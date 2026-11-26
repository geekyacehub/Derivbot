'use strict';
// Public, read-only connectivity smoke test. Never send tokens or account orders.
const appId=process.env.DERIV_APP_ID || '1089';
const symbol=process.env.DERIV_SYMBOL || 'R_75';
if (!/^\d+$/.test(appId) || !/^[A-Za-z0-9_]+$/.test(symbol)) {
  console.error('DERIV_APP_ID must be numeric and DERIV_SYMBOL alphanumeric/underscore.');
  process.exit(2);
}
const url=`wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`;
let ws, done=false, timer;
function finish(ok,message){
  if(done) return;
  done=true; clearTimeout(timer);
  if(ws) ws.close();
  (ok?console.log:console.error)(message);
  process.exitCode=ok?0:1;
}
timer=setTimeout(()=>finish(false,'Timed out waiting for Deriv public ticks.'),15000);
try {
  ws=new WebSocket(url);
  ws.addEventListener('open',()=>ws.send(JSON.stringify({ticks:symbol,subscribe:1,req_id:101})));
  ws.addEventListener('message',event=>{
    let data; try { data=JSON.parse(event.data); } catch { return finish(false,'Invalid JSON received from Deriv.'); }
    if(data.req_id!==101) return;
    if(data.error) return finish(false,`Deriv rejected the public tick request: ${data.error.code||'error'}: ${data.error.message||''}`);
    const tick=data.tick;
    if(!tick) return;
    if(tick.symbol!==symbol || !Number.isFinite(Number(tick.quote)) || Number(tick.quote)<=0 || !Number.isFinite(Number(tick.epoch))) return finish(false,'Tick response had an unexpected symbol, quote, or timestamp.');
    const precision=Number.isInteger(tick.pip_size) && tick.pip_size>=0 && tick.pip_size<=10 ? String(tick.pip_size) : 'not provided';
    return finish(true,`Public Deriv tick received: ${symbol}, quote ${tick.quote}, epoch ${tick.epoch}, precision ${precision}. No login or orders were sent.`);
  });
  ws.addEventListener('error',()=>finish(false,'Unable to connect to the Deriv public WebSocket.'));
  ws.addEventListener('close',()=>{ if(!done) finish(false,'Deriv WebSocket closed before a tick was received.'); });
} catch(e) { finish(false,`WebSocket setup failed: ${e.message}`); }
