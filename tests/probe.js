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
function fireMouse(el, type, x, y, opts){
  const init = {
    bubbles: true, cancelable: true, view: window,
    clientX: x, clientY: y, button: 0
  };
  if (opts) Object.assign(init, opts);
  el.dispatchEvent(new MouseEvent(type, init));
}
function dragPath(fromEl, fx1, fy1, toEl, fx2, fy2, steps, opts){
  const a = rectCenter(fromEl, fx1, fy1);
  const b = toEl ? rectCenter(toEl, fx2, fy2) : { x: a.x + fx2, y: a.y + fy2 };
  fireMouse(fromEl, 'mousedown', a.x, a.y, opts);
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
  await until(() => document.getElementById('btnExportWebm'), 5000);   // v1.2.0：先弹格式选择
  document.getElementById('btnExportWebm').click();
  const done = await until(() => document.getElementById('toast') &&
      document.getElementById('toast').textContent.includes('导出完成'), 30000, 250);
  log('T13 导出 WebM 冒烟测试', done, done ? '' : '30s 内未收到导出完成回调');

  /* ===== v1.1.0 新增 ===== */

  /* T14 波纹删除：A(0-2) + B(2-4)，波纹删 A → B 左移到 0 */
  for (const c of [...OV.state.tracks.video]) OV.removeClip('video', c.id);
  const imgAsset = OV.state.assets.find(a => a.type === 'image');
  const cA = OV.addClipFromAsset(imgAsset.id, 0); cA.dur = 2; cA.fadeIn = 0; cA.fadeOut = 0;
  const cB = OV.addClipFromAsset(imgAsset.id, 2); cB.dur = 2; cB.fadeIn = 0; cB.fadeOut = 0;
  OV.recalcDuration();
  OV.selectClip('video', cA.id);
  OV.deleteSelected(true);
  await sleep(200);
  log('T14 波纹删除缝合空隙', !OV.state.tracks.video.some(c => c.id === cA.id) &&
      near(cB.start, 0, .01), 'B.start=' + cB.start);

  /* T15 多选删除：Shift+点击真实事件选中 B 和 C，一起删
   * 注意：selectClip 会触发 renderClips 重建 DOM，每次点击前必须重新查询元素 */
  const cC = OV.addClipFromAsset(imgAsset.id, 2); cC.dur = 2; cC.fadeIn = 0; cC.fadeOut = 0;
  OV.recalcDuration();
  const elB = document.querySelectorAll('#lane-video .clip')[0];
  fireMouse(elB, 'mousedown', rectCenter(elB).x, rectCenter(elB).y);
  fireMouse(window, 'mouseup', rectCenter(elB).x, rectCenter(elB).y);
  await sleep(80);
  const elC2 = document.querySelectorAll('#lane-video .clip')[1];   // 重新查询（DOM 已重建）
  fireMouse(elC2, 'mousedown', rectCenter(elC2).x, rectCenter(elC2).y, { shiftKey: true });
  fireMouse(window, 'mouseup', rectCenter(elC2).x, rectCenter(elC2).y);
  await sleep(80);
  const multiOk = OV.allSelected().length === 2;
  const dbgMulti = 'B=' + cB.id + ' C=' + cC.id + ' sel=' + (OV.getSel() ? OV.getSel().id : 'null') +
    ' multi=[' + OV.state.multi.join(',') + ']';
  OV.deleteSelected(false);
  await sleep(150);
  log('T15 多选（Shift+点击）并批量删除', multiOk && OV.state.tracks.video.length === 0,
      dbgMulti + ' | left=' + OV.state.tracks.video.length);

  /* T16 Ctrl+D 复制片段 */
  const cD = OV.addClipFromAsset(imgAsset.id, 0); cD.dur = 2; cD.fadeIn = 0; cD.fadeOut = 0;
  OV.recalcDuration();
  OV.selectClip('video', cD.id);
  const cntBefore = OV.state.tracks.video.length;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }));
  await sleep(200);
  const dups = OV.state.tracks.video.filter(c => c !== cD && near(c.dur, 2) && c.start >= cD.start + cD.dur - 0.01);
  log('T16 Ctrl+D 复制片段', OV.state.tracks.video.length === cntBefore + 1 && dups.length >= 1,
      'count ' + cntBefore + '→' + OV.state.tracks.video.length + ' copy.start=' + (dups[0] ? dups[0].start : '?'));

  /* T17 轨道锁定 / 隐藏 */
  OV.toggleTrack('video', 'lock');
  const lockBtn = document.querySelector('.th-btn[data-t="video"][data-act="lock"]');
  const lockUi = !!lockBtn && lockBtn.classList.contains('on');
  OV.selectClip('video', cD.id);
  const beforeLockDel = OV.state.tracks.video.length;
  OV.deleteSelected(false);
  const lockProtect = OV.state.tracks.video.length === beforeLockDel;
  OV.toggleTrack('video', 'lock');
  OV.toggleTrack('video', 'hidden');
  OV.snapTo(0.5);
  await sleep(300);
  const hiddenBlack = isBlack(px(640, 360));
  OV.toggleTrack('video', 'hidden');
  OV.drawFrame();
  const manualRgb = px(640, 360);
  await sleep(200);
  const backRgb = px(640, 360);
  const shownBack = !isBlack(backRgb);
  const clipDbg = OV.state.tracks.video.map(c => c.start + '-' + (c.start + c.dur)).join(',');
  log('T17 锁定轨道防误删', lockUi && lockProtect, 'ui=' + lockUi + ' protect=' + lockProtect);
  log('T17b 隐藏轨道后画面跳过（黑屏）且恢复', hiddenBlack && shownBack,
      'hidden=' + hiddenBlack + ' restored=' + shownBack + ' manual=' + manualRgb.join(',') +
      ' clips=[' + clipDbg + '] hidden=' + OV.state.trackCfg.video.hidden);

  /* T18 自动保存 + 恢复（IndexedDB 含媒体文件） */
  OV.selectClip('video', OV.state.tracks.video[0].id);
  await OV.performAutosave();
  const payload = await OV.loadAutosave();
  const savedOk = payload && payload.tracks && payload.tracks.video.length >= 1 && payload.assets.length >= 1;
  // 清空时间轴（保留素材），再从存档恢复
  const videoCountBefore = payload ? payload.tracks.video.length : 0;
  for (const c of [...OV.state.tracks.video]) OV.removeClip('video', c.id);
  for (const c of [...OV.state.tracks.text]) OV.removeClip('text', c.id);
  for (const c of [...OV.state.tracks.audio]) OV.removeClip('audio', c.id);
  const emptied = OV.state.tracks.video.length === 0;
  let restored = false;
  if (savedOk) restored = await OV.restoreAutosave(payload);
  await sleep(300);
  const restoredOk = restored && OV.state.tracks.video.length === videoCountBefore &&
      OV.state.assets.every(a => !!a.url);
  OV.snapTo(0.5);
  const drewRgb = px(640, 360);
  const drewAfterRestore = !isBlack(drewRgb);
  log('T18 自动保存快照（含媒体）', !!savedOk, savedOk ? 'assets=' + payload.assets.length : '无存档');
  log('T18b 清空后从存档恢复', restoredOk && drewAfterRestore,
      'restored=' + restoredOk + ' rgb=' + drewRgb.join(',') + ' time=' + OV.state.time);

  /* ===== v1.2.0 新增 ===== */

  /* T19 导出模式检测（WebCodecs 可用性） */
  const mode = await OV.pickExportMode();
  log('T19 导出模式检测', mode === 'mp4' || mode === 'webm', 'mode=' + mode);

  /* T20 MP4 帧精确导出端到端：导出 → ftyp 头 → 浏览器回代解析（时长/分辨率/画面） */
  for (const c of [...OV.state.tracks.video]) OV.removeClip('video', c.id);
  const mClip = OV.addClipFromAsset(imgAsset.id, 0); mClip.dur = 0.5;
  mClip.fadeIn = 0; mClip.fadeOut = 0;
  OV.recalcDuration();
  if (mode === 'mp4'){
    let res = null, expErr = '';
    try { res = await OV.exportMp4Blob(() => {}); } catch(e){ expErr = e.message || String(e); }
    if (!res){ log('T20 MP4 导出（ftyp 头 + 体积）', false, '导出异常: ' + expErr); }
    else {
    const head = new Uint8Array(await res.blob.slice(0, 12).arrayBuffer());
    const ftypOk = head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70; // 'ftyp'
    log('T20 MP4 导出（ftyp 头 + 体积）', res.blob.size > 2048 && ftypOk, 'size=' + res.blob.size);
    const mp4Url = URL.createObjectURL(res.blob);
    const mp4v = document.createElement('video');
    mp4v.muted = true;
    mp4v.src = mp4Url;
    const metaOk = await until(() => mp4v.readyState >= 1 && mp4v.videoWidth === 1280, 8000);
    const durOk = metaOk && Math.abs(mp4v.duration - 1.0) < 0.15;
    let pixOk = false;
    if (metaOk){
      await new Promise(res2 => {
        mp4v.addEventListener('seeked', res2, { once: true });
        mp4v.currentTime = 0.25;
        setTimeout(res2, 3000);
      });
      await sleep(150);
      const tc = document.createElement('canvas');
      tc.width = 1280; tc.height = 720;
      const tg = tc.getContext('2d');
      tg.drawImage(mp4v, 0, 0);
      const d = tg.getImageData(640, 180, 1, 1).data;
      pixOk = d[0] > 150 && d[1] < 90 && d[2] < 90;   // 图片上半红色
    }
    log('T20b 浏览器解析 MP4（时长/分辨率/画面像素）', metaOk && durOk && pixOk,
        'dur=' + mp4v.duration + ' w=' + mp4v.videoWidth + ' pix=' + pixOk);

    /* T20c 含 AAC 音轨的 MP4（OfflineAudioContext 混音 + AudioEncoder） */
    const audioAsset = OV.state.assets.find(a => a.type === 'audio');
    if (audioAsset){
      OV.addClipFromAsset(audioAsset.id, 0);
      OV.recalcDuration();
      let res2 = null, err2 = '';
      try { res2 = await OV.exportMp4Blob(() => {}); } catch(e){ err2 = e.message || String(e); }
      let parseOk = false, dur2 = 0;
      if (res2){
        const u2 = URL.createObjectURL(res2.blob);
        const v2 = document.createElement('video');
        v2.muted = true;
        v2.src = u2;
        const ok2 = await until(() => v2.readyState >= 1 && v2.videoWidth === 1280, 8000);
        dur2 = v2.duration;
        parseOk = ok2 && Math.abs(dur2 - 1.0) < 0.15;
      }
      log('T20c 含 AAC 音轨的 MP4 导出与解析', !!res2 && parseOk,
          'size=' + (res2 ? res2.blob.size : 0) + ' dur=' + dur2 + (err2 ? ' err=' + err2 : ''));
    }
    }
  } else {
    log('T20 MP4 导出（ftyp 头 + 体积）', true, '环境不支持 WebCodecs，WebM 兜底生效（跳过）');
    log('T20b 浏览器解析 MP4（时长/分辨率/画面像素）', true, '跳过');
  }

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
