/* TVL Lens Emulator — Sliders + TRUE Split (Reference/After)
   - Upload clean/source image (used for emulation)
   - Upload reference image (target look) for split-mode comparison
   - Live tweak via sliders (range + number)
   - Split is NOT a dual viewer: it's a full-size split overlay
   - Render via WebGL (gl.js / TVLGL)
   - Export PNG + Export Split
   Shortcuts:
     S = split
     D = detail viewer
     P = fullscreen
*/

const $ = (id) => document.getElementById(id);
function safeOn(id, evt, fn){ const el = $(id); if(el) el.addEventListener(evt, fn); }

const canvas = $("canvas");                 // AFTER (WebGL canvas)
const ctx2d = canvas.getContext("2d", { willReadFrequently: true });

const refCanvas = $("refCanvas");           // REFERENCE layer (2D canvas)
const refCtx = refCanvas ? refCanvas.getContext("2d", { willReadFrequently: true }) : null;

let srcImg = null;      // clean/source
let refImg = null;      // reference/target (optional)
let srcW = 0, srcH = 0;

let profiles = {};
let activeName = "";
let liveParams = {};     // mutable copy of active profile
let splitOn = false;

// ---------- param definitions ----------
const PARAMS = [
  { key:"fieldCurvature", label:"Field curvature", min:-3,   max:3.0, step:0.01 },
  { key:"edgeSoftness",   label:"Edge softness",   min:0,   max:5.0, step:0.01 },
  { key:"coma",           label:"Coma",            min:-3,   max:3.0, step:0.01 },
  { key:"comaAnamorph",   label:"Coma anamorph",   min:-3,   max:3.0, step:0.01 },
  { key:"bloom",          label:"Bloom",           min:-3,   max:3.0, step:0.01 },
  { key:"bloomWarmth",    label:"Bloom warmth",    min:-3,  max:3.0, step:0.01 },
  { key:"ca",             label:"CA",              min:-3,   max:3.0, step:0.01 },
  { key:"vignette",       label:"Vignette",        min:0,   max:3.0, step:0.01 },
  { key:"asymX",          label:"Asym X",          min:-3,  max:3.0, step:0.01 },
  { key:"asymY",          label:"Asym Y",          min:-3,  max:3.0, step:0.01 },
  { key:"veil",           label:"Veil",            min:0,   max:3.0, step:0.01 },
];

// ---------- UI helpers ----------
function setStatus(text, good=false){
  const pill = $("infoPill");
  if(!pill) return;
  pill.textContent = text;
  pill.style.color = good ? "var(--good)" : "";
}

function setDimsText(){
  const el = $("dimPill");
  if(el) el.textContent = srcImg ? `${srcW}×${srcH}` : "—";
}

function resizeCanvases(w,h){
  canvas.width = w;  canvas.height = h;
  if(refCanvas){
    refCanvas.width = w; refCanvas.height = h;
  }
}

function clamp(v, min, max){
  if(Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

// ---------- profiles ----------
function loadProfiles(){
  return fetch("gl_profiles.json", { cache: "no-store" })
    .then(r => {
      if(!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(j => {
      profiles = j || {};
      populateSelect();
      setStatus("Profiles loaded", true);
      loadLens(activeName);
    })
    .catch((e) => {
      console.error("loadProfiles error:", e);
      profiles = {};
      populateSelect();
      setStatus("Kon gl_profiles.json niet laden", false);
    });
}

function populateSelect(){
  const sel = $("presetSelect");
  if(!sel) return;
  sel.innerHTML = "";

  const keys = Object.keys(profiles);
  if(keys.length === 0){
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Geen lenzen gevonden";
    sel.appendChild(opt);
    activeName = "";
    return;
  }

  keys.forEach(k=>{
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = k;
    sel.appendChild(opt);
  });

  activeName = keys[0];
  sel.value = activeName;
}

function loadLens(name){
  activeName = name || "";
  const prof = (activeName && profiles[activeName]) ? profiles[activeName] : {};
  liveParams = structuredClone(prof || {});
  ensureParamsDefaults();
  updateParamsUIFromLive();
  render();
}

function ensureParamsDefaults(){
  PARAMS.forEach(d=>{
    if(liveParams[d.key] === undefined || liveParams[d.key] === null){
      liveParams[d.key] = (d.min + d.max) * 0.5;
    }
  });
}

// ---------- param UI ----------
function buildParamsPanel(){
  const panel = $("paramsPanel");
  if(!panel) return;
  panel.innerHTML = "";

  PARAMS.forEach(def=>{
    const row = document.createElement("div");
    row.className = "paramRow";

    const lab = document.createElement("label");
    lab.textContent = def.label;

    const range = document.createElement("input");
    range.type = "range";
    range.min = String(def.min);
    range.max = String(def.max);
    range.step = String(def.step);
    range.dataset.param = def.key;

    const num = document.createElement("input");
    num.type = "number";
    num.min = String(def.min);
    num.max = String(def.max);
    num.step = String(def.step);
    num.dataset.param = def.key;

    const onInput = (e)=>{
      const key = e.target.dataset.param;
      const d = PARAMS.find(x=>x.key===key);
      if(!d) return;

      const raw = parseFloat(e.target.value);
      const v = clamp(raw, d.min, d.max);

      liveParams[key] = v;

      panel.querySelectorAll(`[data-param="${key}"]`).forEach(el=>{
        if(el !== e.target) el.value = String(v);
      });

      render();
    };

    range.addEventListener("input", onInput);
    num.addEventListener("input", onInput);

    row.appendChild(lab);
    row.appendChild(range);
    row.appendChild(num);
    panel.appendChild(row);
  });

  updateParamsUIFromLive();
}

function updateParamsUIFromLive(){
  const panel = $("paramsPanel");
  if(!panel) return;
  PARAMS.forEach(def=>{
    const v = clamp(parseFloat(liveParams[def.key]), def.min, def.max);
    panel.querySelectorAll(`[data-param="${def.key}"]`).forEach(el=>{
      el.value = String(v);
    });
  });
}

// ---------- file uploads ----------
function loadImageFile(file, cb){
  if(!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = "async";
  img.onload = () => { cb(img); URL.revokeObjectURL(url); };
  img.onerror = () => { setStatus("Kon afbeelding niet laden", false); URL.revokeObjectURL(url); };
  img.src = url;
}

function onCleanFile(file){
  loadImageFile(file, (img)=>{
    srcImg = img;
    srcW = img.naturalWidth || img.width;
    srcH = img.naturalHeight || img.height;

    resizeCanvases(srcW, srcH);

    const es = $("emptyState");
    if(es) es.style.display = "none";

    setDimsText();
    setStatus("Clean loaded", true);

    // if no reference uploaded, keep reference = clean in split
    redrawReferenceLayer();
    render();
  });
}

function onRefFile(file){
  loadImageFile(file, (img)=>{
    refImg = img;
    setStatus("Reference loaded", true);
    redrawReferenceLayer();
    if(splitOn) render(); // keep after fresh too
  });
}

function clearReference(){
  refImg = null;
  redrawReferenceLayer();
  setStatus("Reference cleared", true);
}

// ---------- drawing ----------
function drawImageToCtx(ctx, img){
  if(!ctx || !img || !srcW || !srcH) return;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,srcW,srcH);

  // NOTE: if reference size differs, this stretches to match. (Usually reference should be same frame/size)
  ctx.drawImage(img, 0, 0, srcW, srcH);
}

function redrawReferenceLayer(){
  if(!refCtx || !srcImg) return;
  const img = refImg || srcImg;
  drawImageToCtx(refCtx, img);
}

function drawBeforeSingle(){
  if(!srcImg) return;
  ctx2d.setTransform(1,0,0,1,0,0);
  ctx2d.clearRect(0,0,srcW,srcH);
  ctx2d.drawImage(srcImg, 0, 0);
}

function drawAfter(){
  if(!srcImg) return false;

  if(window.TVLGL && typeof TVLGL.render === "function"){
    const ok = TVLGL.render(srcImg, liveParams || {}, canvas);
    if(ok){
      setStatus(`Lens: ${activeName || "—"} (live)`, true);
      return true;
    }
    console.warn("TVLGL.render returned false (WebGL failed).");
  } else {
    console.warn("TVLGL not found. Check that gl.js is loaded before app.js.");
  }

  drawBeforeSingle();
  setStatus("WebGL niet beschikbaar → toon originele", false);
  return false;
}

function render(){
  if(!srcImg) return;

  // keep reference layer up to date (for split)
  redrawReferenceLayer();

  // single view "before"
  if(!splitOn && $("showBefore")?.checked){
    drawBeforeSingle();
    setStatus("Before", true);
    return;
  }

  drawAfter();
}

// ---------- exports ----------
function exportCanvas(filename, canvasEl){
  canvasEl.toBlob((blob) => {
    if(!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  }, "image/png");
}

function safeName(s){
  return (s||"lens").replace(/[^\w\-]+/g,"_").slice(0,64);
}

function exportSplit(){
  if(!srcImg) return;

  // Ensure AFTER is up to date before exporting
  drawAfter();
  redrawReferenceLayer();

  const tmp = document.createElement("canvas");
  tmp.width = srcW;
  tmp.height = srcH;
  const tctx = tmp.getContext("2d");

  const half = Math.floor(srcW/2);

  // LEFT = reference (or clean if none)
  const leftImg = refImg || srcImg;
  tctx.drawImage(leftImg, 0, 0, srcW, srcH); // fills whole
  // but we only keep left half (cheaper: draw and clip)
  const leftData = tctx.getImageData(0,0,half,srcH);

  // Clear and rebuild explicitly (prevents any weird alpha)
  tctx.clearRect(0,0,srcW,srcH);
  tctx.putImageData(leftData, 0, 0);

  // RIGHT = after canvas (copy only right half)
  tctx.drawImage(canvas, half, 0, srcW-half, srcH, half, 0, srcW-half, srcH);

  // divider
  tctx.fillStyle = "rgba(255,255,255,0.85)";
  tctx.fillRect(half-2, 0, 4, srcH);

  // labels
  tctx.font = "800 22px ui-sans-serif, system-ui";
  tctx.fillStyle = "rgba(255,255,255,0.92)";
  tctx.fillText("REFERENCE", 24, 40);
  tctx.fillText("AFTER", half + 24, 40);

  exportCanvas(`TVL_LensEmulator_SPLIT_${safeName(activeName)}.png`, tmp);
}

// =====================================================
// Fullscreen
// =====================================================
function getFullscreenTarget(){
  return document.querySelector(".viewerInner") || document.querySelector(".viewer") || canvas;
}

function toggleFullscreen(){
  const el = getFullscreenTarget();
  if(!el) return;

  if(!document.fullscreenElement){
    el.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
}

// =====================================================
// Split toggle (TRUE split overlay)
// =====================================================
function setSplit(on){
  splitOn = !!on;
  const vi = $("viewerInner");
  if(vi) vi.classList.toggle("splitOn", splitOn);

  if(splitOn){
    const cb = $("showBefore");
    if(cb) cb.checked = false;
    setStatus("Split ON (Reference/After)", true);
  } else {
    setStatus("Split OFF", true);
  }

  // render keeps AFTER; CSS handles split crop
  render();
}

function toggleSplit(){ setSplit(!splitOn); }

// =====================================================
// Random flare / asym helpers (optional)
// =====================================================
function randomizeFlare(){
  if(!liveParams) return;
  // flare direction lives in asymX/asymY in your shader setup
  liveParams.asymX = (Math.random()*2 - 1) * 0.35;
  liveParams.asymY = (Math.random()*2 - 1) * 0.35;
  updateParamsUIFromLive();
  render();
}

// =====================================================
// Copy JSON
// =====================================================
async function copyJSON(){
  try{
    const txt = JSON.stringify(liveParams, null, 2);
    await navigator.clipboard.writeText(txt);
    setStatus("JSON copied", true);
  }catch(e){
    console.warn(e);
    setStatus("Clipboard blocked", false);
  }
}

// =====================================================
// Boot
// =====================================================
function boot(){
  buildParamsPanel();
  loadProfiles();

  safeOn("fileInput", "change", (e)=> onCleanFile(e.target.files?.[0]));
  safeOn("refInput",  "change", (e)=> onRefFile(e.target.files?.[0]));

  safeOn("useCleanAsRef", "click", ()=>{
    if(!srcImg) return;
    refImg = null; // means "use clean"
    redrawReferenceLayer();
    setStatus("Reference = clean", true);
  });

  safeOn("clearRef", "click", ()=>{
    clearReference();
  });

  safeOn("presetSelect", "change", (e)=> loadLens(e.target.value));
  safeOn("resetParams", "click", ()=> loadLens(activeName));
  safeOn("copyParams", "click", copyJSON);
  safeOn("randomizeFlare", "click", randomizeFlare);

  safeOn("exportPng", "click", ()=>{
    if(!srcImg) return;
    // Ensure current state is after (unless user forced before view)
    if($("showBefore")?.checked && !splitOn) drawBeforeSingle();
    else drawAfter();
    exportCanvas(`TVL_LensEmulator_${safeName(activeName)}.png`, canvas);
  });

  safeOn("exportSplit", "click", exportSplit);

  safeOn("fullscreenBtn", "click", toggleFullscreen);
  safeOn("splitBtn", "click", toggleSplit);

  // keyboard shortcuts
  window.addEventListener("keydown", (e)=>{
    if(e.key === "p" || e.key === "P"){ e.preventDefault(); toggleFullscreen(); }
    if(e.key === "s" || e.key === "S"){ e.preventDefault(); toggleSplit(); }
    // D left for your existing detail viewer implementation in gl.js/app.js (not included here)
  });

  // auto-fit viewer (CSS contain) already, but keep checkbox for future
  safeOn("autoFit", "change", ()=>{ /* reserved */ });

  setStatus("Ready", true);
}

boot();
