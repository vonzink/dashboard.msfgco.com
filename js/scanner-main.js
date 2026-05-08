// ─────────────────────────────────────────────────────────────────
// GENERATED FILE — DO NOT EDIT
// Source:    ../msfg-scanner/js/main.js
// Generator: dashboard.msfgco.com/sync-scanner.sh
// Edits will be overwritten on next deploy.
// ─────────────────────────────────────────────────────────────────

// MSFG Scanner — main thread entry point.
// Responsibilities: intake validation, worker dispatch, rotate/upscale/denoise
// /auto-levels ops, crop, and export (download/copy/print). Zoom/pan lives in
// viewport.js, slider adjustments in adjust.js, third-party decoders in
// decoders.js, pure helpers in util.js.

import {
  setImgSrc,
  clearImgSrc,
  escapeHtml,
  canvasToBlob,
  downscaleBitmapToBudget,
} from './scanner-util.js';
import {
  detectFormat,
  decodePdfFirstPage,
  decodeHeic,
  decodeSvg,
} from './scanner-decoders.js';
import {
  cssFilterString,
  applySharpness,
  resetAdjustmentsState,
} from './scanner-adjust.js';
import {
  view,
  getVisibleSourceRect,
  setPanGuard,
} from './scanner-viewport.js';

const MAX_FILE_BYTES = 50 * 1024 * 1024;  // 50 MB hard cap
const MAX_MEGAPIXELS = 4_000_000;          // 4 MP processing budget

// DOM references
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const controls = document.getElementById('controls');
const preview = document.getElementById('preview');
const beforeImg = document.getElementById('before-img');
const afterImg = document.getElementById('after-img');
const afterViewport = document.getElementById('after-viewport');
const presetSelect = document.getElementById('preset-select');
const downloadBtn = document.getElementById('download-btn');
const copyBtn = document.getElementById('copy-btn');
const printBtn = document.getElementById('print-btn');
const cropBtn = document.getElementById('crop-btn');
const cropApplyBtn = document.getElementById('crop-apply-btn');
const cropCancelBtn = document.getElementById('crop-cancel-btn');
const cropOverlay = document.getElementById('crop-overlay');
const cropRect = document.getElementById('crop-rect');
const statusEl = document.getElementById('status');
const rotateLeftBtn = document.getElementById('rotate-left-btn');
const rotateRightBtn = document.getElementById('rotate-right-btn');
const upscaleBtn = document.getElementById('upscale-btn');
const denoiseBtn = document.getElementById('denoise-btn');
const autoLevelsBtn = document.getElementById('auto-levels-btn');
const resetImgBtn = document.getElementById('reset-img-btn');
const clearBtn = document.getElementById('clear-btn');
const actionsFooter = document.getElementById('actions-footer');
const reprocessBtn = document.getElementById('reprocess-btn');

// State
let worker = null;
let workerReady = false;
let currentResultBlob = null;     // what the After pane shows and exports use
let originalResultBlob = null;    // first worker output for this file (Reset Image restores this)
let originalSourceFile = null;    // decoded image File (post PDF/HEIC); used by Re-apply Preset
let currentFileName = null;
let pendingJobId = 0;

// --- Image-op helpers (Rotate, Upscale, Denoise, Auto Levels) -------------

// Decode currentResultBlob → canvas. Helper for the ops below.
async function decodeCurrentToCanvas() {
  if (!currentResultBlob) return null;
  const bmp = await createImageBitmap(currentResultBlob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}

// Replace the current After image with a new blob. Before stays as the
// original source. natW/natH update via the afterImg load handler.
async function replaceResult(blob, statusText) {
  currentResultBlob = blob;
  setImgSrc(afterImg, blob);
  setActionsEnabled(true);
  setStatus(statusText || 'Image updated.', 'is-success');
}

// Rotate 90° in the given direction (+1 = CW, -1 = CCW).
async function rotate(dir) {
  const src = await decodeCurrentToCanvas();
  if (!src) return;
  const out = document.createElement('canvas');
  out.width = src.height;
  out.height = src.width;
  const ctx = out.getContext('2d');
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(dir * Math.PI / 2);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  const blob = await canvasToBlob(out);
  await replaceResult(blob, `Rotated to ${out.width}×${out.height}`);
}
rotateLeftBtn.addEventListener('click', () => rotate(-1));
rotateRightBtn.addEventListener('click', () => rotate(1));

// 2× upscale using two-pass bilinear (good enough for document photos;
// browser's built-in resampling handles quality well).
async function upscale() {
  const src = await decodeCurrentToCanvas();
  if (!src) return;
  if (src.width * src.height * 4 > 64_000_000) {  // would produce > 64 MP
    setStatus('Image already too large to upscale safely.', 'is-error');
    return;
  }
  const out = document.createElement('canvas');
  out.width = src.width * 2;
  out.height = src.height * 2;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, out.width, out.height);
  const blob = await canvasToBlob(out);
  await replaceResult(blob, `Upscaled to ${out.width}×${out.height}`);
}
upscaleBtn.addEventListener('click', upscale);

// Denoise: light 3x3 box blur averaged with the original (preserves edges
// better than a straight blur).
async function denoise() {
  const src = await decodeCurrentToCanvas();
  if (!src) return;
  const w = src.width, h = src.height;
  const ctx = src.getContext('2d');
  const img = ctx.getImageData(0, 0, w, h);
  const s = img.data;
  const out = new Uint8ClampedArray(s.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        out[i] = s[i]; out[i+1] = s[i+1]; out[i+2] = s[i+2]; out[i+3] = s[i+3];
        continue;
      }
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            sum += s[i + c + dx * 4 + dy * w * 4];
          }
        }
        const avg = sum / 9;
        // 50/50 blend of original and blur — keeps edges while killing noise.
        out[i + c] = (s[i + c] + avg) * 0.5;
      }
      out[i + 3] = s[i + 3];
    }
  }
  const result = new ImageData(out, w, h);
  const c2 = document.createElement('canvas');
  c2.width = w; c2.height = h;
  c2.getContext('2d').putImageData(result, 0, 0);
  const blob = await canvasToBlob(c2);
  await replaceResult(blob, 'Denoised.');
}
denoiseBtn.addEventListener('click', denoise);

// Auto Levels: stretch each RGB channel so its min→0 and max→255. Great for
// washed-out or low-contrast scans.
async function autoLevels() {
  const src = await decodeCurrentToCanvas();
  if (!src) return;
  const w = src.width, h = src.height;
  const ctx = src.getContext('2d');
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] < rMin) rMin = d[i]; if (d[i] > rMax) rMax = d[i];
    if (d[i+1] < gMin) gMin = d[i+1]; if (d[i+1] > gMax) gMax = d[i+1];
    if (d[i+2] < bMin) bMin = d[i+2]; if (d[i+2] > bMax) bMax = d[i+2];
  }
  const rRange = Math.max(1, rMax - rMin);
  const gRange = Math.max(1, gMax - gMin);
  const bRange = Math.max(1, bMax - bMin);
  for (let i = 0; i < d.length; i += 4) {
    d[i]   = ((d[i]   - rMin) / rRange) * 255;
    d[i+1] = ((d[i+1] - gMin) / gRange) * 255;
    d[i+2] = ((d[i+2] - bMin) / bRange) * 255;
  }
  ctx.putImageData(img, 0, 0);
  const blob = await canvasToBlob(src);
  await replaceResult(blob, 'Auto levels applied.');
}
autoLevelsBtn.addEventListener('click', autoLevels);

// Reset Image: restore currentResultBlob from originalResultBlob (pre-crop,
// pre-rotate, pre-upscale, etc.). Doesn't touch slider adjustments.
resetImgBtn.addEventListener('click', async () => {
  if (!originalResultBlob) return;
  await replaceResult(originalResultBlob, 'Reverted to original result.');
});

// Clear: fully unload the current image and return to the dropzone state.
function clearAll() {
  if (cropState.active) exitCropMode();
  currentResultBlob = null;
  originalResultBlob = null;
  originalSourceFile = null;
  currentFileName = null;
  pendingJobId++;  // invalidate any in-flight worker job
  clearImgSrc(beforeImg);
  clearImgSrc(afterImg);
  view.ready = false;
  view.scale = 1; view.tx = 0; view.ty = 0;
  preview.hidden = true;
  controls.hidden = true;
  actionsFooter.hidden = true;
  setActionsEnabled(false);
  resetAdjustmentsState();
  setStatus('Ready. Drop a file to get started.');
}
clearBtn.addEventListener('click', clearAll);

// Re-apply the currently selected preset to the original decoded source.
reprocessBtn.addEventListener('click', async () => {
  if (!originalSourceFile) return;
  await reprocessWithPreset(presetSelect.value);
});

// Auto-reprocess when the preset dropdown changes, so users don't need to
// click Apply. No-op until a file is loaded.
presetSelect.addEventListener('change', async () => {
  if (!originalSourceFile) return;
  await reprocessWithPreset(presetSelect.value);
});

async function reprocessWithPreset(presetName) {
  if (!originalSourceFile || !workerReady) return;
  setStatus('Re-enhancing…', 'is-working');
  let bitmap;
  try {
    bitmap = await createImageBitmap(originalSourceFile);
  } catch (err) {
    setStatus(`Couldn't decode image: ${err.message}`, 'is-error');
    return;
  }
  const workBitmap = await downscaleBitmapToBudget(bitmap, MAX_MEGAPIXELS);
  const jobId = ++pendingJobId;
  setActionsEnabled(false);
  currentResultBlob = null;
  clearImgSrc(afterImg);
  worker.postMessage(
    { type: 'process', id: jobId, bitmap: workBitmap, options: { preset: presetName } },
    [workBitmap],
  );
}

// --- Status helpers --------------------------------------------------------

function setStatus(text, variant = '') {
  statusEl.textContent = text;
  statusEl.classList.remove('is-working', 'is-error', 'is-success');
  if (variant) statusEl.classList.add(variant);
}

// --- Worker setup ----------------------------------------------------------

function initWorker() {
  worker = new Worker('js/scanner-worker.js');
  worker.addEventListener('message', onWorkerMessage);
  worker.addEventListener('error', (e) => {
    console.error('Worker error:', e);
    setStatus(`Scanner worker crashed: ${e.message}`, 'is-error');
    dropzone.classList.add('is-disabled');
  });
  worker.postMessage({ type: 'init' });
}

function onWorkerMessage(e) {
  const msg = e.data;
  switch (msg.type) {
    case 'ready':
      workerReady = true;
      setStatus('Ready. Drop a file to get started.');
      dropzone.classList.remove('is-disabled');
      break;

    case 'progress':
      setStatus(`Processing: ${msg.stage}…`, 'is-working');
      break;

    case 'result':
      if (msg.id !== pendingJobId) return;
      currentResultBlob = msg.blob;
      originalResultBlob = msg.blob;  // anchor for "Reset Image"
      setImgSrc(afterImg, msg.blob);
      setActionsEnabled(true);
      setStatus(`Done in ${msg.elapsedMs} ms (${msg.width}×${msg.height})`, 'is-success');
      break;

    case 'error':
      if (msg.id !== pendingJobId) return;
      console.error('Worker error:', msg);
      setStatus(`Error: ${msg.message}`, 'is-error');
      break;

    default:
      console.warn('Unknown worker message:', msg);
  }
}

// --- File intake -----------------------------------------------------------

async function handleFile(file) {
  if (!workerReady) {
    setStatus('Scanner still loading, please wait…', 'is-working');
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    setStatus(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB, max 50 MB).`, 'is-error');
    return;
  }

  const format = await detectFormat(file);
  if (!format) {
    setStatus('Unsupported file type. Use JPG, PNG, PDF, HEIC, or SVG.', 'is-error');
    return;
  }

  // Cancel any in-progress crop from a prior file.
  if (cropState.active) exitCropMode();

  currentFileName = file.name.replace(/\.[^.]+$/, '');

  // Convert PDF/HEIC to an image File first, then proceed through the
  // standard JPEG/PNG pipeline.
  let imageFile = file;
  try {
    if (format === 'pdf') {
      setStatus('Rendering PDF page 1…', 'is-working');
      imageFile = await decodePdfFirstPage(file);
    } else if (format === 'heic') {
      setStatus('Converting HEIC…', 'is-working');
      imageFile = await decodeHeic(file);
    } else if (format === 'svg') {
      setStatus('Rasterizing SVG…', 'is-working');
      imageFile = await decodeSvg(file);
    }
  } catch (err) {
    setStatus(`Couldn't decode ${format.toUpperCase()}: ${err.message}`, 'is-error');
    return;
  }

  setStatus('Decoding…', 'is-working');
  let bitmap;
  try {
    bitmap = await createImageBitmap(imageFile);
  } catch (err) {
    setStatus(`Couldn't decode image: ${err.message}`, 'is-error');
    return;
  }

  // Stash the decoded source so "Apply preset" can re-run the worker.
  originalSourceFile = imageFile;

  // Show source preview
  setImgSrc(beforeImg, imageFile);
  preview.hidden = false;
  controls.hidden = false;
  actionsFooter.hidden = false;

  // Reset adjustments for each new file.
  resetAdjustmentsState();

  // Downscale if over megapixel budget
  const workBitmap = await downscaleBitmapToBudget(bitmap, MAX_MEGAPIXELS);

  const jobId = ++pendingJobId;
  setActionsEnabled(false);
  currentResultBlob = null;
  clearImgSrc(afterImg);

  const options = { preset: presetSelect.value };

  setStatus('Enhancing…', 'is-working');
  worker.postMessage(
    { type: 'process', id: jobId, bitmap: workBitmap, options },
    [workBitmap],
  );
}

// --- Dropzone + file input wiring ------------------------------------------

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) handleFile(file);
  fileInput.value = '';
});

['dragenter', 'dragover'].forEach((type) => {
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.add('is-dragover');
  });
});

['dragleave', 'drop'].forEach((type) => {
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-dragover');
  });
});

dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files?.[0];
  if (file) handleFile(file);
});

// --- Crop mode ------------------------------------------------------------

const cropState = {
  active: false,
  dragging: false,
  pointerId: null,
  // Drag start + current, in After-viewport CSS pixels.
  startX: 0, startY: 0,
  curX: 0, curY: 0,
};

// Block viewport panning on the After viewport while crop is active —
// crop owns that viewport's pointer events.
setPanGuard((vp) => cropState.active && vp === afterViewport);

function enterCropMode() {
  if (!currentResultBlob || cropState.active) return;
  cropState.active = true;
  cropOverlay.hidden = false;
  cropRect.classList.remove('is-active');
  afterViewport.classList.add('is-cropping');
  cropBtn.hidden = true;
  cropApplyBtn.hidden = false;
  cropCancelBtn.hidden = false;
  cropApplyBtn.disabled = true;
  setStatus('Drag on the After preview to select a crop region.', 'is-working');
}

function exitCropMode() {
  cropState.active = false;
  cropState.dragging = false;
  cropState.pointerId = null;
  cropOverlay.hidden = true;
  cropRect.classList.remove('is-active');
  afterViewport.classList.remove('is-cropping');
  cropBtn.hidden = false;
  cropApplyBtn.hidden = true;
  cropCancelBtn.hidden = true;
}

function updateCropRectDom() {
  const x = Math.min(cropState.startX, cropState.curX);
  const y = Math.min(cropState.startY, cropState.curY);
  const w = Math.abs(cropState.curX - cropState.startX);
  const h = Math.abs(cropState.curY - cropState.startY);
  cropRect.style.left = x + 'px';
  cropRect.style.top = y + 'px';
  cropRect.style.width = w + 'px';
  cropRect.style.height = h + 'px';
  cropApplyBtn.disabled = w < 5 || h < 5;
}

cropOverlay.addEventListener('pointerdown', (e) => {
  if (!cropState.active || e.button !== 0) return;
  const rect = afterViewport.getBoundingClientRect();
  cropState.startX = e.clientX - rect.left;
  cropState.startY = e.clientY - rect.top;
  cropState.curX = cropState.startX;
  cropState.curY = cropState.startY;
  cropState.dragging = true;
  cropState.pointerId = e.pointerId;
  cropOverlay.setPointerCapture(e.pointerId);
  cropRect.classList.add('is-active');
  updateCropRectDom();
});

cropOverlay.addEventListener('pointermove', (e) => {
  if (!cropState.dragging || e.pointerId !== cropState.pointerId) return;
  const rect = afterViewport.getBoundingClientRect();
  cropState.curX = Math.max(0, Math.min(rect.width,  e.clientX - rect.left));
  cropState.curY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
  updateCropRectDom();
});

const endCropDrag = (e) => {
  if (e.pointerId !== cropState.pointerId) return;
  try { cropOverlay.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  cropState.dragging = false;
  cropState.pointerId = null;
};
cropOverlay.addEventListener('pointerup', endCropDrag);
cropOverlay.addEventListener('pointercancel', endCropDrag);

cropBtn.addEventListener('click', enterCropMode);
cropCancelBtn.addEventListener('click', () => {
  exitCropMode();
  setStatus('Crop cancelled.');
});

// Apply: replace currentResultBlob with a new PNG blob containing only the
// selected region. The viewport is re-fit to the new image.
cropApplyBtn.addEventListener('click', async () => {
  if (!cropState.active) return;
  try {
    setStatus('Applying crop…', 'is-working');
    const croppedCanvas = await renderCropCanvas();
    if (!croppedCanvas) { setStatus('Crop region empty.', 'is-error'); return; }
    const blob = await new Promise((resolve, reject) => {
      croppedCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png');
    });
    currentResultBlob = blob;
    // Replace After only — Before stays as the original source.
    setImgSrc(afterImg, blob);
    exitCropMode();
    setStatus(`Cropped to ${croppedCanvas.width}×${croppedCanvas.height}`, 'is-success');
  } catch (err) {
    console.error('Crop failed:', err);
    setStatus(`Crop failed: ${err.message}`, 'is-error');
  }
});

// Map the selected viewport rectangle → source-image coords (UNCLAMPED, so
// whitespace around the image becomes white padding in the output). Then
// draw the intersected image region onto a white canvas at the correct
// offset. Adjustments are baked in.
async function renderCropCanvas() {
  if (!currentResultBlob) return null;
  const x1 = Math.min(cropState.startX, cropState.curX);
  const y1 = Math.min(cropState.startY, cropState.curY);
  const x2 = Math.max(cropState.startX, cropState.curX);
  const y2 = Math.max(cropState.startY, cropState.curY);
  if (x2 - x1 < 2 || y2 - y1 < 2) return null;

  // Selected rectangle in source-image coordinate space (may extend outside 0..natW/H).
  const sx1 = (x1 - view.tx) / view.scale;
  const sy1 = (y1 - view.ty) / view.scale;
  const sx2 = (x2 - view.tx) / view.scale;
  const sy2 = (y2 - view.ty) / view.scale;
  const selW = sx2 - sx1;
  const selH = sy2 - sy1;
  if (selW < 1 || selH < 1) return null;

  const bmp = await createImageBitmap(currentResultBlob);
  const resW = bmp.width;
  const resH = bmp.height;
  const kx = resW / view.natW;
  const ky = resH / view.natH;

  // Output canvas size in result-blob pixels (selection at full fidelity).
  const outW = Math.max(1, Math.round(selW * kx));
  const outH = Math.max(1, Math.round(selH * ky));

  // Clamp to the valid portion of the source/result for actual drawing.
  const clampX1 = Math.max(0, sx1);
  const clampY1 = Math.max(0, sy1);
  const clampX2 = Math.min(view.natW, sx2);
  const clampY2 = Math.min(view.natH, sy2);

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  // Fill whitespace (area outside the image) with white.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);

  if (clampX2 > clampX1 && clampY2 > clampY1) {
    // Source (in result pixels)
    const rx = Math.round(clampX1 * kx);
    const ry = Math.round(clampY1 * ky);
    const rw = Math.max(1, Math.round((clampX2 - clampX1) * kx));
    const rh = Math.max(1, Math.round((clampY2 - clampY1) * ky));
    // Destination (where within outW×outH the visible image lands)
    const dx = Math.round((clampX1 - sx1) * kx);
    const dy = Math.round((clampY1 - sy1) * ky);
    const dw = Math.round((clampX2 - clampX1) * kx);
    const dh = Math.round((clampY2 - clampY1) * ky);
    ctx.filter = cssFilterString();
    ctx.drawImage(bmp, rx, ry, rw, rh, dx, dy, dw, dh);
    ctx.filter = 'none';
  }
  bmp.close();
  applySharpness(canvas);
  return canvas;
}

// --- Output actions (Download / Print) ------------------------------------

function setActionsEnabled(enabled) {
  downloadBtn.disabled = !enabled;
  copyBtn.disabled = !enabled;
  printBtn.disabled = !enabled;
  cropBtn.disabled = !enabled;
  rotateLeftBtn.disabled = !enabled;
  rotateRightBtn.disabled = !enabled;
  upscaleBtn.disabled = !enabled;
  denoiseBtn.disabled = !enabled;
  autoLevelsBtn.disabled = !enabled;
  resetImgBtn.disabled = !enabled || !originalResultBlob;
}

function baseFilename() {
  return currentFileName || 'scan';
}

function defaultFilename(ext = 'png') {
  return `${baseFilename()}_cleaned.${ext}`;
}

// Render the current After view to a canvas at the result's native pixel
// density, baking adjustments in. Exports either a crop (if zoomed in) or
// the full image.
async function renderExportCanvas() {
  if (!currentResultBlob) return null;
  const bmp = await createImageBitmap(currentResultBlob);
  const resW = bmp.width;
  const resH = bmp.height;

  const rect = getVisibleSourceRect();
  let rx = 0, ry = 0, rw = resW, rh = resH;
  if (rect) {
    const kx = resW / view.natW;
    const ky = resH / view.natH;
    rx = Math.max(0, Math.round(rect.x * kx));
    ry = Math.max(0, Math.round(rect.y * ky));
    rw = Math.max(1, Math.min(resW - rx, Math.round(rect.w * kx)));
    rh = Math.max(1, Math.min(resH - ry, Math.round(rect.h * ky)));
  }

  const canvas = document.createElement('canvas');
  canvas.width = rw;
  canvas.height = rh;
  const ctx = canvas.getContext('2d');
  ctx.filter = cssFilterString();
  ctx.drawImage(bmp, rx, ry, rw, rh, 0, 0, rw, rh);
  ctx.filter = 'none';
  bmp.close();
  applySharpness(canvas);
  return canvas;
}

downloadBtn.addEventListener('click', async () => {
  if (!currentResultBlob) return;
  try {
    setStatus('Exporting…', 'is-working');
    const canvas = await renderExportCanvas();
    if (!canvas) { setStatus('Nothing visible to export.', 'is-error'); return; }
    const blob = await canvasToBlob(canvas);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = defaultFilename('png');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`Downloaded ${a.download} (${canvas.width}×${canvas.height})`, 'is-success');
  } catch (err) {
    console.error('Download failed:', err);
    setStatus(`Download failed: ${err.message}`, 'is-error');
  }
});

copyBtn.addEventListener('click', async () => {
  if (!currentResultBlob) return;
  if (!navigator.clipboard || !window.ClipboardItem) {
    setStatus('Clipboard image copy not supported in this browser.', 'is-error');
    return;
  }
  try {
    setStatus('Copying to clipboard…', 'is-working');
    const canvas = await renderExportCanvas();
    if (!canvas) { setStatus('Nothing visible to copy.', 'is-error'); return; }
    const blob = await canvasToBlob(canvas);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    setStatus(`Copied to clipboard (${canvas.width}×${canvas.height}) — paste into email or document.`, 'is-success');
  } catch (err) {
    console.error('Copy failed:', err);
    setStatus(`Copy failed: ${err.message}`, 'is-error');
  }
});

// Build the print-window HTML. The filename is user-supplied (from the dropped
// file), so escape it before interpolating. The image src is an in-process
// blob: URL, which is safe to interpolate as-is.
function buildPrintHtml(imageUrl, filename) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Print — ${escapeHtml(filename)}</title>
  <style>
    @page { size: letter; margin: 0.5in; }
    html, body { margin: 0; padding: 0; background: white; }
    .page {
      width: 7.5in;
      height: 10in;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      page-break-after: avoid;
      page-break-inside: avoid;
      break-after: avoid-page;
      break-inside: avoid-page;
    }
    .page img {
      max-width: 7.5in;
      max-height: 10in;
      width: auto;
      height: auto;
      object-fit: contain;
      display: block;
      page-break-inside: avoid;
      break-inside: avoid-page;
    }
    @media screen {
      body { padding: 16px; background: #eee; }
      .page { background: white; box-shadow: 0 2px 8px rgba(0,0,0,.15); margin: 0 auto; }
    }
  </style>
</head>
<body>
  <div class="page"><img src="${imageUrl}" /></div>
</body>
</html>`;
}

printBtn.addEventListener('click', async () => {
  if (!currentResultBlob) return;
  try {
    setStatus('Preparing print…', 'is-working');
    const canvas = await renderExportCanvas();
    if (!canvas) { setStatus('Nothing visible to print.', 'is-error'); return; }
    const blob = await canvasToBlob(canvas);
    const url = URL.createObjectURL(blob);

    // Use an off-screen iframe with srcdoc. This avoids popup blockers and
    // document.write (deprecated), and keeps everything same-origin so we
    // can drive print() from the parent frame.
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText =
      'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    iframe.srcdoc = buildPrintHtml(url, defaultFilename());

    const cleanup = () => {
      URL.revokeObjectURL(url);
      try { iframe.remove(); } catch (_) { /* ignore */ }
    };

    iframe.addEventListener('load', () => {
      const cw = iframe.contentWindow;
      // Wait for the <img> inside to load before printing, else Chrome may
      // print a blank page.
      const img = cw.document.querySelector('.page img');
      const triggerPrint = () => {
        try { cw.focus(); cw.print(); } catch (err) {
          console.error('Print dispatch failed:', err);
          setStatus(`Print failed: ${err.message}`, 'is-error');
          cleanup();
          return;
        }
        // Best-effort cleanup. afterprint fires in most browsers; fall back
        // to a timer in case it doesn't (e.g. user cancels in Safari).
        cw.addEventListener('afterprint', cleanup, { once: true });
        setTimeout(cleanup, 60_000);
      };
      if (img && img.complete) triggerPrint();
      else if (img) img.addEventListener('load', triggerPrint, { once: true });
      else triggerPrint();
    }, { once: true });

    document.body.appendChild(iframe);
    setStatus(`Printed (${canvas.width}×${canvas.height})`, 'is-success');
  } catch (err) {
    console.error('Print failed:', err);
    setStatus(`Print failed: ${err.message}`, 'is-error');
  }
});

// --- Init ------------------------------------------------------------------

dropzone.classList.add('is-disabled');
initWorker();
