// ─────────────────────────────────────────────────────────────────
// GENERATED FILE — DO NOT EDIT
// Source:    ../msfg-scanner/js/util.js
// Generator: dashboard.msfgco.com/sync-scanner.sh
// Edits will be overwritten on next deploy.
// ─────────────────────────────────────────────────────────────────

// MSFG Scanner — pure utilities.
// No module state, no DOM access — just functions that take inputs and
// return outputs. Shared across main.js and any future module splits.

// --- Blob-URL helpers ------------------------------------------------------
// Set <img>.src to a new blob URL, revoking the prior one so we don't leak
// memory when rotating/upscaling/denoising through multiple results.

export function setImgSrc(img, blob) {
  const prev = img.getAttribute('src');
  img.src = URL.createObjectURL(blob);
  if (prev && prev.startsWith('blob:')) {
    // Defer one tick so the browser latches onto the new src first.
    queueMicrotask(() => URL.revokeObjectURL(prev));
  }
}

export function clearImgSrc(img) {
  const prev = img.getAttribute('src');
  img.removeAttribute('src');
  if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
}

// HTML-escape untrusted strings before interpolating into markup (print window).
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Canvas → Blob. Single wrapper around the callback-style canvas.toBlob.
// Default: PNG (lossless). For JPEG pass 'image/jpeg' + a 0-1 quality.
// Throws on encoder failure with a descriptive message for the caller.
export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error(`${type} encode failed`));
    }, type, quality);
  });
}

// Downscale an ImageBitmap so its pixel count fits within maxMP. Returns the
// original bitmap if it's already within budget, otherwise returns a new
// bitmap (and closes the original). Keeps aspect ratio.
export async function downscaleBitmapToBudget(bitmap, maxMP) {
  const mp = bitmap.width * bitmap.height;
  if (mp <= maxMP) return bitmap;
  const scale = Math.sqrt(maxMP / mp);
  const next = await createImageBitmap(bitmap, {
    resizeWidth: Math.round(bitmap.width * scale),
    resizeHeight: Math.round(bitmap.height * scale),
    resizeQuality: 'high',
  });
  bitmap.close();
  return next;
}

// Build a 3×3 unsharp-mask-style kernel for a given amount (0–100).
// Used by both the live SVG preview filter and the export-time canvas
// convolution so they stay numerically in sync.
//   identity (amount=0): center=1, edge=0
//   amount>0:            center=1+4a, edge=-a, where a = amount/100
export function buildSharpenKernel(amount) {
  const a = Math.max(0, Math.min(100, Number(amount) || 0)) / 100;
  if (a <= 0) {
    return { amount: 0, center: 1, edge: 0, svgMatrix: '0 0 0 0 1 0 0 0 0' };
  }
  const center = 1 + 4 * a;
  const edge = -a;
  return {
    amount: a,
    center,
    edge,
    svgMatrix: `0 ${edge} 0 ${edge} ${center} ${edge} 0 ${edge} 0`,
  };
}
