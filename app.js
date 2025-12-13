/* app.js — TVL Lens Emulator (WORKING with your current index.html + gl.js)
   - Output canvas is 2D (gl.js internally uses its own WebGL canvas and copies pixels into this one)
   - Clean upload shows immediately
   - Reference upload for split compare
   - Split is TRUE split overlay (CSS clip-path you already have)
   - Sliders with number input
   Shortcuts: S split, P fullscreen
*/

const $ = (id) => document.getElementById(id);
const canvas = $("canvas");                  // 2D output canvas (IMPORTANT for current gl.js)
const ctx2d = canvas.getContext("2d", { willReadFrequently: true });

const refCanvas = $("refCanvas");            // 2D reference layer for split
const refCtx = refCanvas ? refCanvas.getContext("2d", { willReadFrequently: true }) : null;

let srcImg = null;
let refImg = null;
let srcW = 0, srcH = 0;

let profiles = {};
let activeName = "";
let liveParams = {};
let splitOn = false;

// Keep this in sync with your gl.js "params" usage.
// (These are the v4 keys you've been using in UI.)
const PARAMS = [
  { key:"globalSoft",   label:"Global softness", min:0,    max:0.6, step:0.01 },
  { key:"edgeSoftness", label:"Edge softness",   min:0,    max:2.0, step:0.01 },
  { key:"coma",         label:"Coma",            min:0,    max:2.0, step:0.01 },
  { key:"bloom",        label:"Bloom",           min:0,    max:2.0, step:0.01 },
  { key:"bloomWarmth",  label:"Bloom warmth",    min:-0.5, max:0.5, step:0.01 },
  { key:"halation",     label:"Halation",        min:0,    max:0.6, step:0.01 },
  { key:"veil",         label:"Veil",            min:0,    max:0.6, step:0.01 }
];

function clamp(v, min, max){
  v = parseFloat(v);
  if(Number.isNaN(v)) v = min;
  return Math.max(min, Math.min(max, v));
}

function setStatus(text, good=false){
  const pill = $("infoPill");
  if(!pill) return;
  pill.textContent = text;
  pill.style.color = good ? "var(--good)" : "";
}

function setDims(){
  const el = $("dimPill");
  if(el) el.textContent = srcImg ? `${srcW}×${srcH}` : "—";
}

function resizeCanvases(w, h){
  canvas.width = w; canvas.height = h;
  if(refCanvas){ refCanvas.width = w; refCanvas.height = h; }
}

function hideEmpty(){
  const es = $("emptyState");
  if(es) es.style.display = "none";
}

function showEmpty(){
  const es = $("emptyState");
  if(es) es.style.display = "";
}

function drawBefore(){
  if(!srcImg) return;
  ctx2d.setTransform(1,0,0,1,0,0);
  ctx2d.clearRect(0,0,srcW,srcH);
  ctx2d.drawImage(srcImg, 0, 0, srcW, srcH);
}

function drawReferenceLayer(){
  if(!refCtx || !srcImg) return;
  const img = refImg || srcImg;
  refCtx.setTransform(1,0,0,1,0,0);
  refCtx.clearRect(0,0,srcW,srcH);
  refCtx.drawImage(img, 0, 0, srcW, srcH);
}

function ensureDefaults(){
  PARAMS.forEach(d=>{
    if(liveParams[d.key] === undefined || liveParams[d.key] === null) liveParams[d.key] = 0;
    liveParams[d.key] = clamp(liveParams[d.key], d.min, d.max);
  });
}

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
    range.dataset.k = def.key;

    const num = document.createElement("input");
    num.type = "number";
    num.min = String(def.min);
    num.max = String(def.max);
    num.step = String(def.step);
    num.dataset.k = def.key;

    const on = (e)=>{
      const k = e.target.dataset.k;
      const d = PARAMS.find(x=>x.key===k);
      if(!d) return;

      const v = clamp(e.target.value, d.min, d.max);
      liveParams[k] = v;

      panel.querySelectorAll(`[data-k="${k}"]`).forEach(el=>{
        if(el !== e.target) el.value = String(v);
      });

      render();
    };

    range.addEventListener("input", on);
    num.addEventListener("input", on);

    row.appendChild(lab);
    row.appendChild(range);
    row.appendChild(num);
    panel.appendChild(row);
  });
}

function syncUI(){
  const panel = $("paramsPanel");
  if(!panel) return;
  PARAMS.forEach(def=>{
    const v = clamp(liveParams[def.key] ?? 0, def.min, def.max);
    panel.querySelectorAll(`[data-k="${def.key}"]`).forEach(el=> el.value = String(v));
  });
}

async function loadProfiles(){
  try{
    const r = await fetch("gl_profiles.json", { cache:"no-store" });
    if(!r.ok) throw new Error("HTTP " + r.status);
    profiles = await r.json();

    const sel = $("presetSelect");
    sel.innerHTML = "";

    const keys = Object.keys(profiles || {});
    if(!keys.length){
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Geen lenzen gevonden";
      sel.appendChild(opt);
      activeName = "";
      setStatus("Geen profielen", false);
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
    loadLens(activeName);
    setStatus("Profiles loaded", true);
  }catch(e){
    console.error(e);
    setStatus("Kon gl_profiles.json niet laden", false);
  }
}

function loadLens(name){
  activeName = name || "";
  liveParams = structuredClone(profiles[activeName] || {});
  ensureDefaults();
  syncUI();
  render();
}

function loadImageFile(file, cb){
  if(!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = "async";
  img.onload = () => { cb(img); setTimeout(()=>URL.revokeObjectURL(url), 1000); };
  img.onerror = () => { setStatus("Kon afbeelding niet laden", false); URL.revokeObjectURL(url); };
  img.src = url;
}

function onCleanFile(file){
  loadImageFile(file, (img)=>{
    srcImg = img;
    srcW = img.naturalWidth || img.width;
    srcH = img.naturalHeight || img.height;

    resizeCanvases(srcW, srcH);
    hideEmpty();
    setDims();
    setStatus("Clean loaded", true);

    // keep reference in sync
    drawReferenceLayer();
    render();
  });
}

function onRefFile(file){
  loadImageFile(file, (img)=>{
    refImg = img;
    drawReferenceLayer();
    setStatus("Reference loaded", true);
  });
}

function setSplit(on){
  splitOn = !!on;
  $("viewerInner")?.classList.toggle("splitOn", splitOn);
  setStatus(splitOn ? "Split ON" : "Split OFF", true);
}

function toggleSplit(){ setSplit(!splitOn); }

function toggleFullscreen(){
  const el = $("viewerInner") || document.querySelector(".viewerInner") || document.querySelector(".viewer") || canvas;
  if(!document.fullscreenElement) el.requestFullscreen?.();
  else document.exitFullscreen?.();
}

function safeName(s){ return (s||"lens").replace(/[^\w\-]+/g,"_").slice(0,64); }

function exportCanvas(filename, canvasEl){
  canvasEl.toBlob((blob)=>{
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

function exportSplit(){
  if(!srcImg) return;

  // force a fresh render
  render();
  drawReferenceLayer();

  const tmp = document.createElement("canvas");
  tmp.width = srcW; tmp.height = srcH;
  const tctx = tmp.getContext("2d");

  const half = Math.floor(srcW/2);

  // left = reference layer (ref or clean)
  tctx.drawImage(refCanvas, 0, 0, srcW, srcH);
  const leftData = tctx.getImageData(0,0,half,srcH);
  tctx.clearRect(0,0,srcW,srcH);
  tctx.putImageData(leftData, 0, 0);

  // right = AFTER (output canvas)
  tctx.drawImage(canvas, half, 0, srcW-half, srcH, half, 0, srcW-half, srcH);

  // divider
  tctx.fillStyle = "rgba(255,255,255,0.85)";
  tctx.fillRect(half-2, 0, 4, srcH);

  exportCanvas(`TVL_LensEmulator_SPLIT_${safeName(activeName)}.png`, tmp);
}

function render(){
  if(!srcImg){
    showEmpty();
    return;
  }

  // keep reference ready (for split + export)
  drawReferenceLayer();

  // if "before" checked and NOT in split: show clean
  if(($("showBefore")?.checked) && !splitOn){
    drawBefore();
    setStatus("Before", true);
    return;
  }

  if(!window.TVLGL || typeof TVLGL.render !== "function"){
    // fallback: show clean so you ALWAYS see something
    drawBefore();
    setStatus("TVLGL ontbreekt → toon clean", false);
    return;
  }

  const ok = TVLGL.render(srcImg, liveParams || {}, canvas);
  if(!ok){
    // fallback: show clean so you ALWAYS see something
    drawBefore();
    setStatus("Render failed → toon clean (check console)", false);
    return;
  }

  setStatus(`Lens: ${activeName || "—"} (live)`, true);
}

function randomizeFlare(){
  if(window.TVLGL?.randomizeFlare) TVLGL.randomizeFlare();
  // optional: also shove asym params if you still use them later
  render();
}

async function copyJSON(){
  try{
    await navigator.clipboard.writeText(JSON.stringify(liveParams, null, 2));
    setStatus("JSON copied", true);
  }catch(e){
    setStatus("Clipboard blocked", false);
  }
}

function boot(){
  buildParamsPanel();
  loadProfiles();
  setStatus("Ready", true);

  $("fileInput")?.addEventListener("change", (e)=> onCleanFile(e.target.files?.[0]));
  $("refInput")?.addEventListener("change", (e)=> onRefFile(e.target.files?.[0]));

  $("presetSelect")?.addEventListener("change", (e)=> loadLens(e.target.value));
  $("resetParams")?.addEventListener("click", ()=> loadLens(activeName));
  $("copyParams")?.addEventListener("click", copyJSON);
  $("randomizeFlare")?.addEventListener("click", randomizeFlare);

  $("exportPng")?.addEventListener("click", ()=>{
    if(!srcImg) return;
    render();
    exportCanvas(`TVL_LensEmulator_${safeName(activeName)}.png`, canvas);
  });

  $("exportSplit")?.addEventListener("click", exportSplit);

  $("splitBtn")?.addEventListener("click", toggleSplit);
  $("fullscreenBtn")?.addEventListener("click", toggleFullscreen);

  $("useCleanAsRef")?.addEventListener("click", ()=>{
    if(!srcImg) return;
    refImg = null;
    drawReferenceLayer();
    setStatus("Reference = clean", true);
  });

  $("clearRef")?.addEventListener("click", ()=>{
    refImg = null;
    drawReferenceLayer();
    setStatus("Reference cleared", true);
  });

  $("showBefore")?.addEventListener("change", render);

  window.addEventListener("keydown", (e)=>{
    if(e.key === "s" || e.key === "S"){ e.preventDefault(); toggleSplit(); }
    if(e.key === "p" || e.key === "P"){ e.preventDefault(); toggleFullscreen(); }
  });
}

boot();
