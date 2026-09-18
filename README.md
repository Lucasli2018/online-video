# 咪咪剪辑 online-video

零依赖单文件在线视频剪辑器。双击 `index.html` 即用，纯本地处理，无后端、无 CDN、无构建。

**线上**：Cloudflare Pages（部署由领主手动执行，咪咪只 commit + push）

## 功能（v1.1.0）

- **基础剪辑**：视频/图片/音频导入，时间轴拖拽排序、边缘裁剪、播放头分割、删除、吸附
- **体验补强（v1.1.0 新增）**：
  - IndexedDB 自动保存（含媒体文件本体），刷新/崩溃后一键恢复，防抖 1.5s + 页面卸载前兜底
  - 波纹删除（Shift+Del，删除后自动缝合空隙）、Shift+点击多选、轨道锁定/隐藏、Ctrl+D 复制片段
  - 视频片段胶片条缩略图（均匀抽 6 帧）、音频波形（decodeAudioData 400 峰值桶）
- **滤镜与调色**：8 种滤镜预设 + 亮度/对比度/饱和度，片段淡入淡出
- **文字与字幕**：任意时段叠加文字，字体/颜色/描边底/画布上直接拖拽定位
- **音频与变速**：独立音频轨、每片段音量/静音、视频 0.5x~4x 变速
- **导出**：Canvas 实时合成 + MediaRecorder 录制，导出 WebM（含音频）
- **其他**：撤销/重做（Ctrl+Z / Ctrl+Y）、时间轴缩放（Ctrl+滚轮）、工程保存/载入（.ovproj，媒体按文件名重新关联）

## 技术

- 1280×720 Canvas 逐帧合成（`ctx.filter` 滤镜、cover 适配、文字绘制）
- 每个片段独立媒体元素（video/audio），支持同素材多片段独立 seek/变速/音量
- 导出：`canvas.captureStream(30)` + AudioContext `MediaStreamDestination` 混音 → MediaRecorder
- 自动保存：IndexedDB 两个 store（media 存 File Blob / state 存时间轴快照），只写未存过的媒体避免重复 IO
- 珊瑚橙主题，与 online-tools / online-ps 同一视觉体系

## 快捷键

| 键 | 功能 |
|---|---|
| 空格 | 播放 / 暂停 |
| S | 播放头处分割选中片段 |
| T | 添加文字片段 |
| Del / Shift+Del | 删除 / 波纹删除选中片段 |
| Ctrl+D | 复制选中片段 |
| Ctrl+Z / Ctrl+Y | 撤销 / 重做 |
| ← / →（+Shift） | 后退 / 前进 0.1s（1s） |
| Home / End | 跳到开头 / 结尾 |

## 开发 / 测试

```bash
cd tests
PORT=8145 node probe_server.js   # 起本地服务（file:// 会污染 canvas，必须走 HTTP）
# 另开终端，CDP 真实时钟跑探针（虚拟时间预算会冻死 MediaRecorder，勿用）：
node probe_run.js "http://127.0.0.1:8145/index.html?probe=1"
```

`tests/probe.js` 模拟真实点击/拖拽事件 + 像素断言；`tests/probe_run.js` 用 CDP + Node 原生 WebSocket 驱动。覆盖：导入、加轨、分割、裁剪、移动、滤镜、文字、撤销、视频导入、导出冒烟、波纹删除、多选、锁轨隐藏、复制、自动保存与恢复。
