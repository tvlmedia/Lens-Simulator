/* TVL Lens Emulator (MVP) - app.js (REBUILD / BULLETPROOF)
   - DOMContentLoaded init (voorkomt null crashes)
   - Laadt presets/presets.json
   - Upload -> preview op canvas
   - Sliders -> realtime render
   - Export PNG + split
*/

const $ = (id) => document.getElementById(id);

let canvas, ctx;
let offA, offB, aCtx, bCtx;

let srcImg = null;
let srcW = 0, srcH = 0;

let presets = {};
let activePresetName = "";
let flareSeed = Math.floor(Math.random() * 1e9);

document.addEventListener("DOMContentLoaded", init);

function init() {
  // --- DOM checks
  canvas = $("canvas");
  if (!canvas) return hardFail("Canvas (#canvas) ontbreekt in HTML.");
  ctx = canvas.getContext("2d", { willReadFrequently: true });

  offA = document.createElement("canvas");
  offB = document.createElement("canvas");
  aCtx = offA.getContext("2d", { willReadFrequently: true });
  bCtx = offB.getContext("2d", { willReadFrequently: true });

  // Bind UI alvast (zodat upload sowieso werkt), presets komen zo
  bindUI();

  // Load presets + populate dropdown
  loadPresets()
    .then(() => {
      populatePresets();
      setStatus("Ready", true);
    })
    .catch((err) => {
      console.error(err);
      setStatus("Presets load error (check presets/presets.json).", false);
      populatePresets(); // zal "Geen presets gevonden" tonen
    });
}

/* -----------------------------
   Helpers
--------------------------------*/
function hardFail(msg) {
  console.error(msg);
  alert(msg);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function setStatus(text, good = false) {
  const pill = $("infoPill");
  if (!pill) return;
  pill.textContent = text;
  pill.style.color = good ? "var(--good)" : "";
}

function setDimsText() {
  const el = $("dimPill");
  if (!el) return;
  el.textContent = srcImg ? `${srcW}×${srcH}` : "—";
}

function uiVal(id, text) {
  const el = $("v_" + id);
  if (el) el.textContent = text;
}

function sliderValue(id) {
  const el = $(id);
  if (!el) return 0;
  return Number(el.value);
}

function strength01() {
  return sliderValue("strength") / 100; // 0..2
}

function safeName(s) {
  return (s || "preset").replace(/[^\w\-]+/g, "_").slice(0, 64);
}

function resizeAll(w, h) {
  canvas.width = w; canvas.height = h;
  offA.width = w; offA.height = h;
  offB.width = w; offB.height = h;
}

function updateUIReadouts() {
  uiVal("strength", (sliderValue("strength") / 100).toFixed(2));
  uiVal("swirl", (sliderValue("swirl") / 100).toFixed(2));
  uiVal("halation", (sliderValue("halation") / 100).toFixed(2));
  uiVal("vignette", (sliderValue("vignette") / 100).toFixed(2));
  uiVal("ca", (sliderValue("ca") / 100).toFixed(2));
  uiVal("flare", (sliderValue("flare") / 100).toFixed(2));
  uiVal("contrast", (sliderValue("contrast") / 100).toFixed(2));
  uiVal("saturation", (sliderValue("saturation") / 100).toFixed(2));
}

/* -----------------------------
   Presets
--------------------------------*/
async function loadPresets() {
  // cache-buster zodat Pages nooit oude json blijft pakken
  const url = `presets/presets.json?v=${Date.now()}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Presets fetch failed: ${r.status} ${r.statusText}`);
  presets = await r.json();
}

function populatePresets() {
  const sel = $("presetSelect");
  if (!sel) return;

  sel.innerHTML = "";
  const keys = Object.keys(presets || {});
  if (keys.length === 0) {
    const opt = document.createElement("option");
    opt.value = "—";
    opt.textContent = "Geen presets gevonden";
    sel.appendChild(opt);
    activePresetName = "";
    return;
  }

  keys.forEach((k) => {
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = k;
    sel.appendChild(opt);
  });

  activePresetName = keys[0];
  sel.value = activePresetName;
  applyPresetToUI(activePresetName);
}

function applyPresetToUI(name) {
  activePresetName = name;
  const p = presets[name] || {};

  // sliders: reset naar 100 baseline
  $("strength").value = 100;
  $("swirl").value = 100;
  $("halation").value = 100;
  $("vignette").value = 100;
  $("ca").value = 100;
  $("flare").value = 100;

  // contrast/sat volgen preset init
  $("contrast").value = Math.round((p.contrast ?? 1.0) * 100);
  $("saturation").value = Math.round((p.saturation ?? 1.0) * 100);

  updateUIReadouts();
  render();
}

/* -----------------------------
   UI binding
--------------------------------*/
function bindUI() {
  const fileInput = $("fileInput");
  if (!fileInput) return hardFail("fileInput ontbreekt (#fileInput).");

  fileInput.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) onFile(f);
  });

  const presetSelect = $("presetSelect");
  if (presetSelect) {
    presetSelect.addEventListener("change", (e) => {
      applyPresetToUI(e.target.value);
    });
  }

  const rerenderIds = [
    "strength","swirl","halation","vignette","ca","flare",
    "contrast","saturation","showBefore"
  ];
  rerenderIds.forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", () => { updateUIReadouts(); render(); });
    el.addEventListener("change", () => { updateUIReadouts(); render(); });
  });

  const rnd = $("randomizeFlare");
  if (rnd) {
    rnd.addEventListener("click", () => {
      flareSeed = Math.floor(Math.random() * 1e9);
      render();
    });
  }

  const exp = $("exportPng");
  if (exp) {
    exp.addEventListener("click", () => {
      if (!srcImg) return;
      exportCanvas(`TVL_LensEmulator_${safeName(activePresetName)}.png`, canvas);
    });
  }

  const split = $("exportSplit");
  if (split) {
    split.addEventListener("click", () => exportSplit());
  }

  updateUIReadouts();
}

/* -----------------------------
   File load
--------------------------------*/
function onFile(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    srcImg = img;
    srcW = img.naturalWidth;
    srcH = img.naturalHeight;

    resizeAll(srcW, srcH);
    setDimsText();

    const es = $("emptyState");
    if (es) es.style.display = "none";

    setStatus("Loaded", true);
    render();
    URL.revokeObjectURL(url);
  };
  img.onerror = (e) => {
    console.error("Image load error", e);
    setStatus("Kon afbeelding niet laden.", false);
  };
  img.src = url;
}

/* -----------------------------
   Render pipeline
--------------------------------*/
function render() {
  if (!srcImg) return;

  const showBefore = $("showBefore")?.checked;

  // draw before directly
  if (showBefore) {
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,srcW,srcH);
    ctx.drawImage(srcImg, 0, 0);
    setStatus("Before", true);
    return;
  }

  const preset = (activePresetName && presets[activePresetName]) ? presets[activePresetName] : {};
  const strength = clamp(strength01(), 0, 2);

  // multipliers
  const mulVignette = sliderValue("vignette") / 100;
  const mulHalation = sliderValue("halation") / 100;
  const mulCA = sliderValue("ca") / 100;
  const mulFlare = sliderValue("flare") / 100;
  const mulSwirl = sliderValue("swirl") / 100;

  // absolute grade sliders (start from preset)
  const contrast = sliderValue("contrast") / 100;     // absolute
  const saturation = sliderValue("saturation") / 100; // absolute
  const warmth = (preset.warmth ?? 0) * strength;

  // 1) draw source -> offA
  aCtx.setTransform(1,0,0,1,0,0);
  aCtx.clearRect(0,0,srcW,srcH);
  aCtx.drawImage(srcImg, 0, 0);

  // 2) basic grade
  let imgData = aCtx.getImageData(0,0,srcW,srcH);
  imgData = applyBasicGrade(imgData, contrast, saturation, warmth);
  // 3) vignette
  const vignAmt = (preset.vignette ?? 0) * mulVignette * strength;
  if (vignAmt > 0.001) imgData = applyVignette(imgData, vignAmt);
  aCtx.putImageData(imgData, 0, 0);

  // 4) halation (highlight glow)
  const halAmt = (preset.halation ?? 0) * mulHalation * strength;
  if (halAmt > 0.001) {
    let hd = aCtx.getImageData(0,0,srcW,srcH);
    hd = applyHalation(hd, halAmt);
    aCtx.putImageData(hd, 0, 0);
  }

  // 5) swirl warp -> offB
  const swAmt = (preset.swirl ?? 0) * mulSwirl * strength;
  if (swAmt > 0.001) {
    swirlWarp(aCtx, bCtx, srcW, srcH, swAmt);
  } else {
    bCtx.setTransform(1,0,0,1,0,0);
    bCtx.clearRect(0,0,srcW,srcH);
    bCtx.drawImage(offA, 0, 0);
  }

  // 6) CA -> offA
  const caAmt = (preset.ca ?? 0) * mulCA * strength;
  if (caAmt > 0.001) {
    applyCA(bCtx, aCtx, srcW, srcH, caAmt);
  } else {
    aCtx.setTransform(1,0,0,1,0,0);
    aCtx.clearRect(0,0,srcW,srcH);
    aCtx.drawImage(offB, 0, 0);
  }

  // 7) flare
  const flAmt = (preset.flare ?? 0) * mulFlare * strength;
  if (flAmt > 0.001) {
    drawProceduralFlare(aCtx, srcW, srcH, clamp(flAmt, 0, 1), flareSeed);
  }

  // 8) draw to main
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,srcW,srcH);
  ctx.drawImage(offA, 0, 0);

  setStatus(activePresetName ? `Preset: ${activePresetName}` : "No preset", true);
}

/* -----------------------------
   Image ops
--------------------------------*/
function rgbWarmth(r, g, b, warmth) {
  const wr = r + 40 * warmth;
  const wb = b - 40 * warmth;
  const wg = g + 8 * warmth;
  return [wr, wg, wb];
}

function applyBasicGrade(imgData, contrast, saturation, warmth) {
  const d = imgData.data;
  const c = contrast;
  const sat = saturation;

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];

    [r, g, b] = rgbWarmth(r, g, b, warmth);

    // contrast around 128
    r = (r - 128) * c + 128;
    g = (g - 128) * c + 128;
    b = (b - 128) * c + 128;

    // saturation via luma
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = l + (r - l) * sat;
    g = l + (g - l) * sat;
    b = l + (b - l) * sat;

    d[i]     = clamp(r, 0, 255);
    d[i + 1] = clamp(g, 0, 255);
    d[i + 2] = clamp(b, 0, 255);
  }
  return imgData;
}

function applyVignette(imgData, amount) {
  const d = imgData.data;
  const w = imgData.width, h = imgData.height;
  const cx = w / 2, cy = h / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy);
  const a = amount;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      const r = Math.sqrt(dx * dx + dy * dy) / maxR;
      let v = 1 - a * (r * r);
      v = clamp(v, 0, 1);
      const idx = (y * w + x) * 4;
      d[idx] *= v;
      d[idx + 1] *= v;
      d[idx + 2] *= v;
    }
  }
  return imgData;
}

function buildHighlightMask(srcData, threshold) {
  const w = srcData.width, h = srcData.height;
  const out = new Uint8ClampedArray(w * h);
  const d = srcData.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    out[p] = l > threshold ? clamp((l - threshold) * 2, 0, 255) : 0;
  }
  return out;
}

function boxBlurMask(mask, w, h, radius) {
  const r = Math.max(1, radius | 0);
  const tmp = new Uint16Array(w * h);
  const out = new Uint8ClampedArray(w * h);

  // horizontal
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) {
      const xx = clamp(x, 0, w - 1);
      sum += mask[y * w + xx];
    }
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum;
      const x0 = x - r;
      const x1 = x + r + 1;
      if (x0 >= 0) sum -= mask[y * w + x0];
      if (x1 < w) sum += mask[y * w + x1];
    }
  }

  // vertical
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) {
      const yy = clamp(y, 0, h - 1);
      sum += tmp[yy * w + x];
    }
    for (let y = 0; y < h; y++) {
      const val = sum / ((2 * r + 1) * (2 * r + 1));
      out[y * w + x] = clamp(val, 0, 255);
      const y0 = y - r;
      const y1 = y + r + 1;
      if (y0 >= 0) sum -= tmp[y0 * w + x];
      if (y1 < h) sum += tmp[y1 * w + x];
    }
  }
  return out;
}

function applyHalation(baseImgData, amount) {
  const w = baseImgData.width, h = baseImgData.height;
  const threshold = 220;
  const mask = buildHighlightMask(baseImgData, threshold);
  const blurred = boxBlurMask(mask, w, h, Math.max(2, Math.round(10 * amount)));

  const d = baseImgData.data;
  for (let p = 0; p < w * h; p++) {
    const m = (blurred[p] / 255) * amount;
    if (m <= 0.001) continue;
    const i = p * 4;
    d[i]     = clamp(d[i]     + 80 * m, 0, 255);
    d[i + 1] = clamp(d[i + 1] + 45 * m, 0, 255);
    d[i + 2] = clamp(d[i + 2] + 30 * m, 0, 255);
  }
  return baseImgData;
}

function applyCA(ctxSrc, ctxDst, w, h, amount) {
  const img = ctxSrc.getImageData(0, 0, w, h);
  const d = img.data;
  const out = ctxDst.createImageData(w, h);
  const o = out.data;

  const cx = w / 2, cy = h / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy);

  function sample(ix, iy, ch) {
    ix = clamp(ix, 0, w - 1) | 0;
    iy = clamp(iy, 0, h - 1) | 0;
    return d[(iy * w + ix) * 4 + ch];
  }

  const shiftMax = 2.5 * amount;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      const r = Math.sqrt(dx * dx + dy * dy) / maxR;
      const s = shiftMax * r;

      const denom = (Math.abs(dx) + Math.abs(dy) + 1e-6);
      const ox = (dx / denom) * s;
      const oy = (dy / denom) * s;

      const rr = sample(x + ox, y + oy, 0);
      const gg = sample(x,      y,      1);
      const bb = sample(x - ox, y - oy, 2);
      const aa = sample(x,      y,      3);

      const i = (y * w + x) * 4;
      o[i] = rr; o[i + 1] = gg; o[i + 2] = bb; o[i + 3] = aa;
    }
  }
  ctxDst.putImageData(out, 0, 0);
}

function swirlWarp(ctxSrc, ctxDst, w, h, amount) {
  const src = ctxSrc.getImageData(0, 0, w, h);
  const d = src.data;
  const out = ctxDst.createImageData(w, h);
  const o = out.data;

  const cx = w / 2, cy = h / 2;
  const maxR = Math.min(cx, cy);

  function sample(ix, iy, ch) {
    ix = clamp(ix, 0, w - 1) | 0;
    iy = clamp(iy, 0, h - 1) | 0;
    return d[(iy * w + ix) * 4 + ch];
  }

  const k = 1.35 * amount;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      const rn = r / maxR;
      const ang = k * rn * rn * 0.9;

      const cos = Math.cos(ang), sin = Math.sin(ang);
      const sx = cx + dx * cos - dy * sin;
      const sy = cy + dx * sin + dy * cos;

      const i = (y * w + x) * 4;
      o[i]     = sample(sx, sy, 0);
      o[i + 1] = sample(sx, sy, 1);
      o[i + 2] = sample(sx, sy, 2);
      o[i + 3] = sample(sx, sy, 3);
    }
  }
  ctxDst.putImageData(out, 0, 0);
}

function mulberry32(a) {
  return function () {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawProceduralFlare(ctx, w, h, intensity, seed) {
  const rng = mulberry32(seed);
  const dir = rng() * Math.PI * 2;
  const cx = w / 2, cy = h / 2;
  const lx = cx + Math.cos(dir) * w * 0.35;
  const ly = cy + Math.sin(dir) * h * 0.35;

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = clamp(intensity, 0, 1);

  // veiling glare
  const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, Math.min(w, h) * 0.65);
  g.addColorStop(0, "rgba(255,230,200,0.22)");
  g.addColorStop(0.25, "rgba(255,190,140,0.10)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // ghosts along axis
  const ax = cx - (lx - cx);
  const ay = cy - (ly - cy);

  const ghosts = 4 + Math.floor(rng() * 4);
  for (let i = 0; i < ghosts; i++) {
    const t = (i + 1) / (ghosts + 1);
    const gx = lx + (ax - lx) * t;
    const gy = ly + (ay - ly) * t;
    const rad = (0.02 + rng() * 0.06) * Math.min(w, h);
    const gg = ctx.createRadialGradient(gx, gy, 0, gx, gy, rad);
    gg.addColorStop(0, `rgba(180,220,255,${0.18 + rng() * 0.12})`);
    gg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.arc(gx, gy, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  // streak-ish
  ctx.globalAlpha = clamp(intensity * 0.55, 0, 1);
  ctx.translate(cx, cy);
  ctx.rotate(dir + Math.PI / 2);
  ctx.fillStyle = "rgba(255,240,220,0.18)";
  ctx.fillRect(-w * 0.6, -2, w * 1.2, 4);

  ctx.restore();
}

/* -----------------------------
   Export
--------------------------------*/
function exportCanvas(filename, canvasEl) {
  canvasEl.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, "image/png");
}

function exportSplit() {
  if (!srcImg) return;

  const tmp = document.createElement("canvas");
  tmp.width = srcW;
  tmp.height = srcH;
  const tctx = tmp.getContext("2d");

  // left before
  tctx.drawImage(srcImg, 0, 0);

  // right after = snapshot of current canvas
  const snap = document.createElement("canvas");
  snap.width = srcW; snap.height = srcH;
  snap.getContext("2d").drawImage(canvas, 0, 0);

  const half = Math.floor(srcW / 2);
  tctx.drawImage(snap, half, 0, srcW - half, srcH, half, 0, srcW - half, srcH);

  // divider
  tctx.fillStyle = "rgba(255,255,255,0.8)";
  tctx.fillRect(half - 2, 0, 4, srcH);

  // labels
  tctx.font = "700 24px ui-sans-serif, system-ui";
  tctx.fillStyle = "rgba(255,255,255,0.92)";
  tctx.fillText("BEFORE", 24, 44);
  tctx.fillText("AFTER", half + 24, 44);

  exportCanvas(`TVL_LensEmulator_SPLIT_${safeName(activePresetName)}.png`, tmp);
}
