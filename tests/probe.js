/* probe.js —— 咪咪剪辑自动化探针
 * 访问 http://127.0.0.1:<port>/index.html?probe=1 时自动运行。
 * 用真实 DOM 事件模拟点击/拖拽，并用 canvas 像素断言验证合成结果。
 * 结果写入 body[data-probe-done] / body[data-probe-fail] 供 dump-dom 检查。
 */
(function(){
'use strict';
if (!location.search.includes('probe=1')) return;

const OV = window.__ov;
const results = [];
let failCount = 0;

window.addEventListener('error', e => log('全局异常 ' + (e.message || ''), false, ''));
window.addEventListener('unhandledrejection', e => log('未捕获 Promise 拒绝', false, String(e.reason)));

function panel(){
  let p = document.getElementById('probePanel');
  if (!p){
    p = document.createElement('div');
    p.id = 'probePanel';
    p.className = 'probe-panel';
    p.innerHTML = '<b>咪咪剪辑探针</b>';
    document.body.appendChild(p);
  }
  return p;
}
function log(name, pass, note){
  results.push({ name, pass, note: note || '' });
  if (!pass) failCount++;
  const row = document.createElement('div');
  row.className = pass ? 'probe-pass' : 'probe-fail';
  row.textContent = (pass ? '✓ ' : '✗ ') + name + (note ? ' —— ' + note : '');
  panel().appendChild(row);
  document.body.setAttribute('data-probe-fail', String(failCount));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout, step){
  const t0 = Date.now();
  while (Date.now() - t0 < (timeout || 5000)){
    try { if (fn()) return true; } catch(e){}
    await sleep(step || 100);
  }
  return false;
}
function rectCenter(el, fx, fy){
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width * (fx === undefined ? .5 : fx), y: r.top + r.height * (fy === undefined ? .5 : fy) };
}
function fireMouse(el, type, x, y){
  el.dispatchEvent(new MouseEvent(type, {
    bubbles: true, cancelable: true, view: window,
    clientX: x, clientY: y, button: 0
  }));
}
function dragPath(fromEl, fx1, fy1, toEl, fx2, fy2, steps){
  const a = rectCenter(fromEl, fx1, fy1);
  const b = toEl ? rectCenter(toEl, fx2, fy2) : { x: a.x + fx2, y: a.y + fy2 };
  fireMouse(fromEl, 'mousedown', a.x, a.y);
  for (let i = 1; i <= (steps || 6); i++){
    const x = a.x + (b.x - a.x) * i / (steps || 6);
    const y = a.y + (b.y - a.y) * i / (steps || 6);
    fireMouse(window, 'mousemove', x, y);
  }
  fireMouse(window, 'mouseup', b.x, b.y);
}
/* 像素断言（canvas 同源不污染） */
function px(x, y){
  const d = OV.ctx.getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2]];
}
function regionAvg(x, y, w, h){
  const d = OV.ctx.getImageData(x, y, w, h).data;
  let r = 0, g = 0, b = 0, n = w * h;
  for (let i = 0; i < n; i++){ r += d[i*4]; g += d[i*4+1]; b += d[i*4+2]; }
  return [r / n, g / n, b / n];
}
const isBlack = c => c[0] < 12 && c[1] < 12 && c[2] < 12;
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 0.15 : tol);

/* 测试素材：红上蓝下的 PNG */
function makeImageFile(){
  const c = document.createElement('canvas');
  c.width = 320; c.height = 180;
  const g = c.getContext('2d');
  g.fillStyle = '#DC1E28'; g.fillRect(0, 0, 320, 90);
  g.fillStyle = '#1857C3'; g.fillRect(0, 90, 320, 90);
  return new Promise(res => c.toBlob(b => res(new File([b], '测试图.png', { type: 'image/png' })), 'image/png'));
}
/* 测试素材：0.7s 红色闪烁 WebM 视频（MediaRecorder 程序生成） */
function makeVideoFile(){
  return new Promise((resolve, reject) => {
    try {
      const c = document.createElement('canvas');
      c.width = 320; c.height = 180;
      const g = c.getContext('2d');
      const stream = c.captureStream(15);
      const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      const chunks = [];
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => resolve(new File([new Blob(chunks, { type: 'video/webm' })], '测试视频.webm', { type: 'video/webm' }));
      rec.onerror = e => reject(new Error('recorder error'));
      rec.start(100);
      let i = 0;
      const draw = () => {
        g.fillStyle = (i++ % 2) ? '#C01018' : '#F03040';
        g.fillRect(0, 0, 320, 180);
        g.fillStyle = '#fff';
        g.fillRect(40 + (i % 8) * 30, 80, 30, 20);
      };
      const iv = setInterval(draw, 90);
      draw();
      setTimeout(() => { clearInterval(iv); rec.state !== 'inactive' && rec.stop(); }, 750);
      setTimeout(() => { reject(new Error('video gen timeout')); }, 6000);
    } catch(e){ reject(e); }
  });
}
/* 测试素材：0.5s 440Hz 正弦 WAV */
function makeAudioFile(){
  const sr = 22050, n = Math.floor(sr * 0.5);
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE');
  ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  ws(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++){
    dv.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 440 * i / sr) * 12000), true);
  }
  return new File([buf], '测试音.wav', { type: 'audio/wav' });
}

async function run(){
  panel();
  /* T1 初始化 */
  const inited = await until(() => document.body.getAttribute('data-init-ok') === '1', 6000);
  log('T1 页面初始化', inited);
  if (!inited) return finish();
  await sleep(300);

  /* T2 导入图片 */
  const imgFile = await makeImageFile();
  await OV.importFiles([imgFile]);
  log('T2 导入图片素材', OV.state.assets.length === 1 && OV.state.assets[0].type === 'image' && OV.state.assets[0].width === 320,
      'assets=' + OV.state.assets.length);

  /* T3 点击「＋」添加到时间轴 */
  const addBtn = document.querySelector('.asset-card .add-btn');
  addBtn.click();
  await sleep(250);
  const vClips0 = OV.state.tracks.video;
  log('T3 添加图片片段到视频轨', vClips0.length === 1 && near(vClips0[0].dur, 4) && near(vClips0[0].start, 0),
      'clips=' + vClips0.length);
  await sleep(250);
  const c0 = regionAvg(600, 300, 40, 40);
  log('T3b 预览画布合成出图片（非黑屏）', !isBlack(c0), 'rgb=' + c0.map(v => Math.round(v)).join(','));

  /* T4 选中 + 播放头分割 */
  const clipEl = document.querySelector('#lane-video .clip');
  const cp = rectCenter(clipEl);
  fireMouse(clipEl, 'mousedown', cp.x, cp.y);
  fireMouse(window, 'mouseup', cp.x, cp.y);
  await sleep(80);
  OV.snapTo(2.0);
  document.getElementById('btnSplit').click();
  await sleep(200);
  const vClips1 = OV.state.tracks.video;
  log('T4 播放头分割为两段', vClips1.length === 2 && near(vClips1[0].dur, 2) && near(vClips1[1].start, 2) && near(vClips1[1].dur, 2),
      'l.dur=' + vClips1[0].dur + ' r.start=' + vClips1[1].start);

  /* T5 拖右边缘裁剪（-30px = -0.5s）—— 事件必须派发到手柄元素本身 */
  const firstEl = document.querySelector('#lane-video .clip');
  const rHandle = firstEl.querySelector('.handle.r');
  dragPath(rHandle, .4, .5, null, -30, 0);
  await sleep(200);
  log('T5 拖边缘裁剪片段', near(vClips1[0].dur, 1.5, .12), 'dur=' + vClips1[0].dur);

  /* T6 拖拽移动片段（+48px = +0.8s，应吸附/钳制不重叠）—— 用当前 DOM 重新查询 */
  const secondEl = document.querySelectorAll('#lane-video .clip')[1];
  const startBefore = vClips1[1].start;
  dragPath(secondEl, .5, .5, null, 48, 0);
  await sleep(200);
  log('T6 拖拽移动片段', vClips1[1].start > startBefore + 0.5, 'start ' + startBefore + ' → ' + vClips1[1].start);
  log('T6b 移动后不与前一片段重叠', vClips1[1].start >= vClips1[0].start + vClips1[0].dur - 0.01);

  /* T7 黑白滤镜（红色区变灰：R≈G≈B）—— 重新查询当前 DOM 选中片段 */
  const curFirst = document.querySelector('#lane-video .clip');
  fireMouse(curFirst, 'mousedown', rectCenter(curFirst).x, rectCenter(curFirst).y);
  fireMouse(window, 'mouseup', rectCenter(curFirst).x, rectCenter(curFirst).y);
  OV.snapTo(0.5);
  await sleep(200);
  const bwBtn = document.querySelector('.f-preset[data-preset="bw"]');
  if (!bwBtn){ log('T7 黑白滤镜生效（像素变灰）', false, '找不到滤镜按钮（属性面板未渲染）'); }
  else {
    bwBtn.click();
    await sleep(300);
    const gray = regionAvg(600, 200, 30, 30);
    const grayOk = Math.abs(gray[0] - gray[1]) < 14 && Math.abs(gray[1] - gray[2]) < 14 && gray[0] > 25;
    const presetVal = OV.getSel() ? OV.getSel().filter.preset : '?';
    log('T7 黑白滤镜生效（像素变灰）', grayOk && presetVal === 'bw',
        'rgb=' + gray.map(v => Math.round(v)).join(',') + ' preset=' + presetVal);
  }

  /* T8 文字片段 + 渲染 */
  document.getElementById('btnAddText').click();
  await sleep(200);
  const tClip = OV.state.tracks.text[0];
  log('T8 添加文字片段', !!tClip && OV.state.tracks.text.length === 1);
  const ta = document.getElementById('pText');
  ta.value = '测试字幕';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(250);
  const txtArea = regionAvg(560, 520, 160, 60);
  const hasWhite = (() => {
    const d = OV.ctx.getImageData(500, 500, 280, 100).data;
    for (let i = 0; i < d.length; i += 4){
      if (d[i] > 235 && d[i+1] > 235 && d[i+2] > 235) return true;
    }
    return false;
  })();
  log('T8b 文字渲染到画布（出现白色像素）', hasWhite, 'avg=' + txtArea.map(v => Math.round(v)).join(','));

  /* T9 撤销 / 重做（Ctrl+Z / Ctrl+Y） */
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  await sleep(150);
  const undone = OV.state.tracks.text.length === 0;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
  await sleep(150);
  const redone = OV.state.tracks.text.length === 1;
  log('T9 撤销+重做', undone && redone, 'undo=' + undone + ' redo=' + redone);

  /* T11 导入程序生成的 WebM 视频 */
  let vidAsset = null, vNew = null;
  try {
    const vidFile = await makeVideoFile();
    await OV.importFiles([vidFile]);
    vidAsset = OV.state.assets.find(a => a.type === 'video');
    const durOk = vidAsset && vidAsset.duration > 0.3 && isFinite(vidAsset.duration);
    log('T11 导入 WebM 视频（含 Infinity 时长修复）', !!vidAsset && durOk,
        vidAsset ? 'duration=' + vidAsset.duration : '未找到视频素材');
    if (vidAsset && durOk) vNew = OV.addClipFromAsset(vidAsset.id);
  } catch(e){ log('T11 导入 WebM 视频（含 Infinity 时长修复）', false, e.message); }
  log('T11b 视频片段加入时间轴', !!vNew && OV.state.tracks.video.length === 3,
      'videoClips=' + OV.state.tracks.video.length);
  if (vNew){
    OV.snapTo(vNew.start + Math.min(0.3, vNew.dur / 2));
    const drew = await until(() => !isBlack(px(640, 360)), 8000);
    log('T11c 视频帧绘制到画布', drew);
  }

  /* T10 变速（用刚导入的视频片段测，图片片段不支持变速） */
  const vClip = OV.state.tracks.video.find(c => c.type === 'video');
  if (vClip){
    const durBefore = vClip.dur;
    OV.setClipSpeed(vClip, 2);
    log('T10 视频变速 2x', near(vClip.speed, 2) && near(vClip.dur, durBefore / 2, .12), 'dur ' + durBefore + '→' + vClip.dur);
  } else {
    log('T10 视频变速 2x', false, '没有视频片段可测');
  }

  /* T12 导入 WAV 音频并加入音频轨 */
  const wavFile = makeAudioFile();
  await OV.importFiles([wavFile]);
  const aAsset = OV.state.assets.find(a => a.type === 'audio');
  log('T12 导入音频素材', !!aAsset && near(aAsset.duration, 0.5, .1), aAsset ? 'duration=' + aAsset.duration : '无');
  const aClip = aAsset ? OV.addClipFromAsset(aAsset.id) : null;
  log('T12b 音频片段进入音频轨', !!aClip && OV.state.tracks.audio.length === 1);

  /* T13 导出冒烟测试（清空时间轴 → 1.2s 短片 → 实时录制） */
  for (const t of ['video', 'text', 'audio']){
    for (const c of [...OV.state.tracks[t]]) OV.removeClip(t, c.id);
  }
  await sleep(150);
  const exClip = OV.addClipFromAsset(OV.state.assets.find(a => a.type === 'image').id);
  exClip.dur = 1.2;
  exClip.fadeIn = 0; exClip.fadeOut = 0;
  OV.recalcDuration();
  document.getElementById('btnExport').click();
  const done = await until(() => document.getElementById('toast') &&
      document.getElementById('toast').textContent.includes('导出完成'), 30000, 250);
  log('T13 导出 WebM 冒烟测试', done, done ? '' : '30s 内未收到导出完成回调');

  finish();
}
function finish(){
  document.body.setAttribute('data-probe-done', '1');
  document.body.setAttribute('data-probe-fail', String(failCount));
  window.__probeResults = results;
  window.__probeFail = failCount;
  const p = panel();
  const sum = document.createElement('div');
  sum.id = 'probe-summary';
  sum.textContent = 'SUMMARY: ' + results.length + ' tests, ' + failCount + ' failed';
  p.appendChild(sum);
}

if (document.readyState === 'complete') setTimeout(run, 200);
else window.addEventListener('load', () => setTimeout(run, 200));
})();
