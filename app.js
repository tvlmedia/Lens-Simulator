/* TVL Lens Emulator — NO SLIDERS (Clean Fullscreen + Detail Overlay)
   - Upload image
   - Choose lens profile (gl_profiles.json)
   - Render via WebGL (gl.js / TVLGL)
   - Export PNG + split
   + Fullscreen button + "P"
   + Detail viewer overlay (Before/After) + "D"
*/

const $ = (id) => document.getElementById(id);
function safeOn(id, evt, fn){ const el = $(id); if(el) el.addEventListener(evt, fn); }

const canvas = $("canvas");
const ctx2d = canvas.getContext("2d", { willReadFrequently: true });

let srcImg = null;
let srcW = 0, srcH = 0;

let profiles = {};
let activeName = "";

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
function resizeCanvas(w,h){
  canvas.width = w;
  canvas.height = h;
}

// ---------- load profiles ----------
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
      render();
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

// ---------- file upload ----------
function onFile(file){
  if(!file) return;

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = "async";

  img.onload = () => {
    srcImg = img;
    srcW = img.naturalWidth || img.width;
    srcH = img.naturalHeight || img.height;

    resizeCanvas(srcW, srcH);

    const es = $("emptyState");
    if(es) es.style.display = "none";

    setDimsText();
    setStatus("Loaded", true);

    render();
    URL.revokeObjectURL(url);
  };

  img.onerror = () => setStatus("Kon afbeelding niet laden", false);
  img.src = url;
}

// ---------- rendering ----------
function drawBefore(){
  if(!srcImg) return;
  ctx2d.setTransform(1,0,0,1,0,0);
  ctx2d.clearRect(0,0,srcW,srcH);
  ctx2d.drawImage(srcImg, 0, 0);
}

function render(){
  if(!srcImg) return;

  if($("showBefore")?.checked){
    drawBefore();
    setStatus("Before", true);
    updateDetail();
    return;
  }

  const prof = (activeName && profiles[activeName]) ? profiles[activeName] : {};

  if(window.TVLGL && typeof TVLGL.render === "function"){
    const ok = TVLGL.render(srcImg, prof, canvas);
    if(ok){
      setStatus(`Lens: ${activeName || "—"}`, true);
      updateDetail();
      return;
    }
    console.warn("TVLGL.render returned false (WebGL failed).");
  } else {
    console.warn("TVLGL not found. Check that gl.js is loaded before app.js.");
  }

  drawBefore();
  setStatus("WebGL niet beschikbaar → toon originele", false);
  updateDetail();
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

  const tmp = document.createElement("canvas");
  tmp.width = srcW;
  tmp.height = srcH;
  const tctx = tmp.getContext("2d");

  // left = before
  tctx.drawImage(srcImg, 0, 0);

  // right = after (current canvas)
  const half = Math.floor(srcW/2);
  tctx.drawImage(canvas, half, 0, srcW-half, srcH, half, 0, srcW-half, srcH);

  // divider
  tctx.fillStyle = "rgba(255,255,255,0.8)";
  tctx.fillRect(half-2, 0, 4, srcH);

  // labels
  tctx.font = "700 24px ui-sans-serif, system-ui";
  tctx.fillStyle = "rgba(255,255,255,0.92)";
  tctx.fillText("BEFORE", 24, 44);
  tctx.fillText("AFTER", half + 24, 44);

  exportCanvas(`TVL_LensEmulator_SPLIT_${safeName(activeName)}.png`, tmp);
}

// =====================================================
// Fullscreen (ONE implementation)
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

function ensureFullscreenButton(){
  const actions = document.querySelector(".actions");
  if(!actions) return;
  if($("fullscreenBtn")) return;

  const btn = document.createElement("button");
  btn.id = "fullscreenBtn";
  btn.className = "btn ghost";
  btn.textContent = "Fullscreen";
  btn.addEventListener("click", toggleFullscreen);

  const exportPng = $("exportPng");
  if(exportPng && exportPng.parentElement === actions){
    actions.insertBefore(btn, exportPng);
  } else {
    actions.appendChild(btn);
  }
}

// =====================================================
// Detail Viewer Overlay (small, follows cursor) — toggle with D
// =====================================================
let detail = {
  on: false,
  zoom: 2.2,     // minder ingezoomd
  size: 320,     // grotere vierkantjes
  x: 0.5,
  y: 0.5,
  overlay: null,
  cBefore: null,
  cAfter: null,
  ctxB: null,
  ctxA: null,
};

function ensureDetailOverlay(){
  if(detail.overlay) return;

  const ov = document.createElement("div");
  ov.id = "detailOverlay";
  ov.style.position = "fixed";
  ov.style.left = "0px";
  ov.style.top  = "0px";
  ov.style.display = "none";
  ov.style.pointerEvents = "none";
  ov.style.zIndex = "9999";
  ov.style.gap = "12px";
  ov.style.alignItems = "flex-start";

  function makeBox(label){
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "8px";

    const lab = document.createElement("div");
    lab.textContent = label;
    lab.style.color = "rgba(255,255,255,0.85)";
    lab.style.font = "800 11px ui-sans-serif, system-ui";
    lab.style.textTransform = "uppercase";
    lab.style.letterSpacing = "0.6px";
    lab.style.textShadow = "0 2px 14px rgba(0,0,0,0.65)";

    const c = document.createElement("canvas");
    c.width = detail.size;
    c.height = detail.size;
    c.style.width = detail.size + "px";
    c.style.height = detail.size + "px";
    c.style.background = "#000";
    c.style.border = "1px solid rgba(255,255,255,0.15)";
    c.style.borderRadius = "14px";
    c.style.boxShadow = "0 12px 40px rgba(0,0,0,.45)";

    wrap.appendChild(lab);
    wrap.appendChild(c);
    return { wrap, c };
  }

  const left = makeBox("Before");
  const right = makeBox("After");

  ov.appendChild(left.wrap);
  ov.appendChild(right.wrap);

  document.body.appendChild(ov);

  detail.overlay = ov;
  detail.cBefore = left.c;
  detail.cAfter  = right.c;
  detail.ctxB = left.c.getContext("2d");
  detail.ctxA = right.c.getContext("2d");
}

function toggleDetail(force){
  ensureDetailOverlay();
  detail.on = (typeof force === "boolean") ? force : !detail.on;
  detail.overlay.style.display = detail.on ? "flex" : "none";
  if(detail.on) updateDetail();
}

// Map mouse to normalized image coords (handles contain letterboxing)
function canvasPointToImageUV(clientX, clientY){
  const rect = canvas.getBoundingClientRect();
  const imgAspect = srcW / srcH;
  const rectAspect = rect.width / rect.height;

  let drawW, drawH, offX, offY;

  if(rectAspect > imgAspect){
    drawH = rect.height;
    drawW = drawH * imgAspect;
    offX = (rect.width - drawW) / 2;
    offY = 0;
  } else {
    drawW = rect.width;
    drawH = drawW / imgAspect;
    offX = 0;
    offY = (rect.height - drawH) / 2;
  }

  const x = clientX - rect.left - offX;
  const y = clientY - rect.top - offY;

  let u = x / drawW;
  let v = y / drawH;

  u = Math.max(0, Math.min(1, u));
  v = Math.max(0, Math.min(1, v));

  return { u, v };
}

function drawDetailCrops(){
  if(!detail.on || !srcImg || !detail.ctxB || !detail.ctxA) return;

  const outW = detail.cBefore.width;
  const outH = detail.cBefore.height;

  const cropW = Math.round(outW / detail.zoom);
  const cropH = Math.round(outH / detail.zoom);

  const cx = Math.round(detail.x * srcW);
  const cy = Math.round(detail.y * srcH);

  const sx = Math.max(0, Math.min(srcW - cropW, cx - Math.floor(cropW/2)));
  const sy = Math.max(0, Math.min(srcH - cropH, cy - Math.floor(cropH/2)));

  // BEFORE
  detail.ctxB.imageSmoothingEnabled = true;
  detail.ctxB.clearRect(0,0,outW,outH);
  detail.ctxB.drawImage(srcImg, sx, sy, cropW, cropH, 0, 0, outW, outH);

  // AFTER (from current rendered canvas)
  detail.ctxA.imageSmoothingEnabled = true;
  detail.ctxA.clearRect(0,0,outW,outH);
  detail.ctxA.drawImage(canvas, sx, sy, cropW, cropH, 0, 0, outW, outH);
}

function updateDetail(){
  if(!detail.on) return;
  drawDetailCrops();
}

function bindDetailTracking(){
  const target = document.querySelector(".viewerInner") || canvas;
  if(!target) return;

  const onMove = (clientX, clientY)=>{
    if(!srcImg || !detail.on) return;

    // position overlay near cursor
    if(detail.overlay){
      detail.overlay.style.left = (clientX + 18) + "px";
      detail.overlay.style.top  = (clientY + 18) + "px";
    }

    const { u, v } = canvasPointToImageUV(clientX, clientY);
    detail.x = u;
    detail.y = v;
    updateDetail();
  };

  target.addEventListener("mousemove", (e)=> onMove(e.clientX, e.clientY));
  target.addEventListener("touchmove", (e)=>{
    const t = e.touches && e.touches[0];
    if(!t) return;
    onMove(t.clientX, t.clientY);
  }, { passive: true });
}

// =====================================================
// Bind
// =====================================================
function bind(){
  ensureFullscreenButton();
  ensureDetailOverlay();
  bindDetailTracking();

  safeOn("fileInput","change",(e)=> onFile(e.target.files && e.target.files[0]));
  safeOn("presetSelect","change",(e)=> { activeName = e.target.value; render(); });
  safeOn("showBefore","change", render);

  safeOn("randomizeFlare","click", ()=>{
    if(window.TVLGL && typeof TVLGL.randomizeFlare === "function") TVLGL.randomizeFlare();
    render();
  });

  safeOn("exportPng","click", ()=>{
    if(!srcImg) return;
    exportCanvas(`TVL_LensEmulator_${safeName(activeName)}.png`, canvas);
  });

  safeOn("exportSplit","click", exportSplit);

  // Shortcuts (ONE listener)
  window.addEventListener("keydown", (e)=>{
    const k = (e.key || "").toLowerCase();

    if(k === "p"){
      e.preventDefault();
      toggleFullscreen();
    }

    if(k === "d"){
      e.preventDefault();
      toggleDetail();
    }

    if(k === "escape"){
      if(detail.on) toggleDetail(false);
    }
  });
}

loadProfiles().then(bind);
