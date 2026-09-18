/* probe_run.js —— 用 CDP 真实时钟驱动探针（虚拟时间预算会冻死 MediaRecorder）
 * 用法：node probe_run.js "http://127.0.0.1:8145/index.html?probe=1"
 * 依赖：Node 22+ 原生 WebSocket，Chrome 路径可用 CHROME 环境变量覆盖。
 */
'use strict';
const { spawn } = require('child_process');
const http = require('http');

const CHROME = process.env.CHROME || 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const PAGE_URL = process.argv[2] || 'http://127.0.0.1:8145/index.html?probe=1';
const DEBUG_PORT = parseInt(process.env.DEBUG_PORT || '9223', 10);
const MAX_WAIT_MS = parseInt(process.env.MAX_WAIT_MS || '120000', 10);

function getJSON(path){
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: DEBUG_PORT, path }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch(e){ reject(e); } });
    }).on('error', reject);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--window-size=1600,1000',
    '--remote-debugging-port=' + DEBUG_PORT,
    '--user-data-dir=' + require('os').tmpdir() + '/ov-probe-profile-' + Date.now(),
    PAGE_URL
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', () => {});

  // 等 DevTools 端口就绪
  let targets = null;
  for (let i = 0; i < 50 && !targets; i++){
    await sleep(300);
    try { targets = await getJSON('/json/list'); } catch(e){}
  }
  if (!targets){ console.error('DEVTOOLS-NOT-READY'); chrome.kill(); process.exit(2); }
  const page = targets.find(t => t.type === 'page' && t.url.includes('index.html'));
  if (!page || !page.webSocketDebuggerUrl){ console.error('PAGE-TARGET-NOT-FOUND'); chrome.kill(); process.exit(2); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let msgId = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)){ pending.get(m.id)(m); pending.delete(m.id); }
  };
  function send(method, params){
    return new Promise(resolve => {
      const id = ++msgId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async function evaluate(expr){
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r.result && r.result.result ? r.result.result.value : undefined;
  }

  await send('Page.enable');
  await send('Runtime.enable');

  // 轮询等待探针完成
  const t0 = Date.now();
  let done = false;
  while (Date.now() - t0 < MAX_WAIT_MS){
    await sleep(1000);
    try {
      done = await evaluate("document.body.getAttribute('data-probe-done')==='1'");
      if (done) break;
    } catch(e){}
  }

  const results = await evaluate('window.__probeResults || []');
  const failAttr = await evaluate("document.body.getAttribute('data-probe-fail')");
  if (!done) console.log('PROBE-TIMEOUT（' + MAX_WAIT_MS + 'ms 内未完成）');
  for (const r of (results || [])){
    console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.note ? ' —— ' + r.note : ''));
  }
  const failCount = results ? results.filter(r => !r.pass).length : -1;
  console.log('SUMMARY: ' + (results ? results.length : 0) + ' tests, ' + failCount + ' failed' + (done ? '' : ' (TIMEOUT)'));
  try { ws.close(); } catch(e){}
  chrome.kill();
  process.exit(failCount > 0 || !done ? 1 : 0);
})().catch(e => { console.error('RUNNER-ERROR', e); process.exit(2); });
