
/* TVL Lens Emulator — v4 FIX (works with current index.html)
   Key fix: DO NOT create a 2D context on the WebGL canvas.
   (If you do canvas.getContext("2d") first, WebGL fails silently and nothing renders.)

   Supports:
   - Clean upload -> WebGL render
   - Reference upload -> split (CSS clip-path)
   - Sliders (numbers + ranges)
   - Export PNG / Export Split
   - Split button + "S"
   - Fullscreen button + "P"
*/

const $ = (id) => document.getElementById(id);
function safeOn(id, evt, fn){ const el = $(id); if(el) el.addEventListener(evt, fn); }

const canvas = $("canvas");                 // WebGL output
const refCanvas = $("refCanvas");           // 2D reference layer
const refCtx = refCanvas ? refCanvas.getContext("2d", { willReadFrequently:true }) : null;

let srcImg = null;
let refImg = null;
let srcW = 0, srcH = 0;

let profiles = {};
let activeName = "";
let liveParams = {};
let splitOn = false;

// v4 parameters (match gl.js v4). Keep your earlier lens params out for now.
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
  if(Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

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
  canvas.width = w; canvas.height = h;
  if(refCanvas){ refCanvas.width = w; refCanvas.height = h; }
}

function drawRef(){
  if(!refCtx || !srcImg) return;
  const img = refImg || srcImg;
  refCtx.setTransform(1,0,0,1,0,0);
  refCtx.clearRect(0,0,srcW,srcH);
  refCtx.drawImage(img, 0, 0, srcW, srcH);
}

function ensureDefaults(){
  PARAMS.forEach(d=>{
    if(liveParams[d.key] === undefined || liveParams[d.key] === null) liveParams[d.key] = 0;
    liveParams[d.key] = clamp(parseFloat(liveParams[d.key]), d.min, d.max);
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
      const v = clamp(parseFloat(e.target.value), d.min, d.max);
      liveParams[k] = v;
      panel.querySelectorAll(`[data-k="${k}"]`).forEach(el=>{ if(el!==e.target) el.value = String(v); });
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
    const v = clamp(parseFloat(liveParams[def.key] ?? 0), def.min, def.max);
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
      const o = document.createElement("option");
      o.value = ""; o.textContent = "Geen lenzen gevonden";
      sel.appendChild(o);
      activeName = "";
      return;
    }
    keys.forEach(k=>{
      const o = document.createElement("option");
      o.value = k; o.textContent = k;
      sel.appendChild(o);
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
  activeName = name;
  liveParams = structuredClone(profiles[name] || {});
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

    const es = $("emptyState");
    if(es) es.style.display = "none";

    setDimsText();
    setStatus("Clean loaded", true);

    drawRef();
    render();
  });
}

function onRefFile(file){
  loadImageFile(file, (img)=>{
    refImg = img;
    if(srcImg){
      drawRef();
      render();
    }
    setStatus("Reference loaded", true);
  });
}

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

function safeName(s){
  return (s||"lens").replace(/[^\w\-]+/g,"_").slice(0,64);
}

function exportSplit(){
  if(!srcImg) return;
  // Ensure after is up to date
  render();
  drawRef();

  const tmp = document.createElement("canvas");
  tmp.width = srcW; tmp.height = srcH;
  const tctx = tmp.getContext("2d");

  const half = Math.floor(srcW/2);

  // left: ref (or clean)
  const left = refImg || srcImg;
  tctx.drawImage(left, 0, 0, srcW, srcH);
  const leftData = tctx.getImageData(0,0,half,srcH);
  tctx.clearRect(0,0,srcW,srcH);
  tctx.putImageData(leftData, 0, 0);

  // right: WebGL canvas
  tctx.drawImage(canvas, half, 0, srcW-half, srcH, half, 0, srcW-half, srcH);

  tctx.fillStyle = "rgba(255,255,255,0.85)";
  tctx.fillRect(half-2, 0, 4, srcH);

  tctx.font = "800 22px ui-sans-serif, system-ui";
  tctx.fillStyle = "rgba(255,255,255,0.92)";
  tctx.fillText("REFERENCE", 24, 40);
  tctx.fillText("AFTER", half + 24, 40);

  exportCanvas(`TVL_LensEmulator_SPLIT_${safeName(activeName)}.png`, tmp);
}

async function copyJSON(){
  try{
    await navigator.clipboard.writeText(JSON.stringify(liveParams, null, 2));
    setStatus("JSON copied", true);
  }catch(e){
    console.warn(e);
    setStatus("Clipboard blocked", false);
  }
}

// Split / Fullscreen
function setSplit(on){
  splitOn = !!on;
  const vi = $("viewerInner");
  if(vi) vi.classList.toggle("splitOn", splitOn);
  setStatus(splitOn ? "Split ON" : "Split OFF", true);
}
function toggleSplit(){ setSplit(!splitOn); }

function getFullscreenTarget(){
  return document.querySelector(".viewerInner") || document.querySelector(".viewer") || canvas;
}
function toggleFullscreen(){
  const el = getFullscreenTarget();
  if(!el) return;
  if(!document.fullscreenElement) el.requestFullscreen?.();
  else document.exitFullscreen?.();
}

function render(){
  if(!srcImg) return;
  // keep ref updated
  drawRef();

  if(!window.TVLGL || typeof TVLGL.render !== "function"){
    setStatus("TVLGL ontbreekt — check gl.js load", false);
    return;
  }

  const ok = TVLGL.render(srcImg, liveParams, canvas);
  if(!ok){
    setStatus("WebGL render failed (check console)", false);
    return;
  }
}

// Boot
function boot(){
  buildParamsPanel();
  loadProfiles();

  safeOn("fileInput", "change", (e)=> onCleanFile(e.target.files?.[0]));
  safeOn("refInput", "change", (e)=> onRefFile(e.target.files?.[0]));

  safeOn("useCleanAsRef", "click", ()=>{
    if(!srcImg) return;
    refImg = null;
    drawRef();
    setStatus("Reference = clean", true);
  });

  safeOn("clearRef", "click", ()=>{
    refImg = null;
    if(srcImg) drawRef();
    setStatus("Reference cleared", true);
  });

  safeOn("presetSelect", "change", (e)=> loadLens(e.target.value));
  safeOn("resetParams", "click", ()=> loadLens(activeName));
  safeOn("copyParams", "click", copyJSON);

  safeOn("exportPng", "click", ()=>{
    if(!srcImg) return;
    render();
    exportCanvas(`TVL_LensEmulator_${safeName(activeName)}.png`, canvas);
  });

  safeOn("exportSplit", "click", exportSplit);
  safeOn("splitBtn", "click", toggleSplit);
  safeOn("fullscreenBtn", "click", toggleFullscreen);

  window.addEventListener("keydown", (e)=>{
    if(e.key === "s" || e.key === "S"){ e.preventDefault(); toggleSplit(); }
    if(e.key === "p" || e.key === "P"){ e.preventDefault(); toggleFullscreen(); }
  });

  setStatus("Ready", true);
}

boot();
