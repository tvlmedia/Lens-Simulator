/* TVL Lens Emulator — NO SLIDERS (with Fullscreen + Detail Viewer)
   - Upload image
   - Choose lens profile (gl_profiles.json)
   - Render via WebGL (gl.js / TVLGL)
   - Export PNG + split
   + Fullscreen button + "P" shortcut
   + Detail viewer overlay (before/after 3x) + "D" shortcut
*/

const $ = (id) => document.getElementById(id);
function safeOn(id, evt, fn){ const el = $(id); if(el) el.addEventListener(evt, fn); }

const canvas = $("canvas"); // <canvas id="canvas">
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
  ctx2d.setTransform(1,0,0,1,0,0);
  ctx2d.clearRect(0,0,srcW,srcH);
  ctx2d.drawImage(srcImg, 0, 0);
}

function render(){
  if(!srcImg) return;

  if($("showBefore")?.checked){
    drawBefore();
    setStatus("Before", true);
    updateDetail(); // keep detail overlay in sync
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
// Fullscreen
// =====================================================
function getFullscreenTarget(){
  // prefer viewerInner, otherwise viewer, otherwise canvas
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

// Inject fullscreen button in header actions (no HTML edit needed)
function ensureFullscreenButton(){
  const actions = document.querySelector(".actions");
  if(!actions) return;

  if($("fullscreenBtn")) return;

  const btn = document.createElement("button");
  btn.id = "fullscreenBtn";
  btn.className = "btn ghost";
  btn.textContent = "Fullscreen";
  btn.addEventListener("click", toggleFullscreen);

  // place it before Export buttons if possible
  const exportPng = $("exportPng");
  if(exportPng && exportPng.parentElement === actions){
    actions.insertBefore(btn, exportPng);
  } else {
    actions.appendChild(btn);
  }
}

// =====================================================
// Detail Viewer (Before/After 3x) — toggle with D
// =====================================================
let detail = {
  on: false,
  zoom: 3,
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

  // overlay container
    const ov = document.createElement("div");
  ov.id = "detailOverlay";
  ov.style.position = "fixed";
  ov.style.left = "0px";
  ov.style.top  = "0px";
  ov.style.display = "none";
  ov.style.pointerEvents = "none";
  ov.style.zIndex = "9999";

  // help text
  const help = document.createElement("div");
  help.style.position = "fixed";
  help.style.top = "16px";
  help.style.left = "16px";
  help.style.color = "rgba(255,255,255,0.75)";
  help.style.font = "700 12px ui-sans-serif, system-ui";
  help.style.letterSpacing = "0.2px";
  help.textContent = "DETAIL VIEW — move mouse. D = close, ESC = close";
  ov.appendChild(help);

  function makeBox(label){
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "10px";
    wrap.style.alignItems = "center";

    const lab = document.createElement("div");
    lab.textContent = label;
    lab.style.color = "rgba(255,255,255,0.85)";
    lab.style.font = "800 12px ui-sans-serif, system-ui";
    lab.style.textTransform = "uppercase";
    lab.style.letterSpacing = "0.6px";

    const c = document.createElement("canvas");
    c.width = 360;
    c.height = 360;
    c.style.width = "360px";
    c.style.height = "360px";
    c.style.background = "#000";
    c.style.border = "1px solid rgba(255,255,255,0.12)";
    c.style.borderRadius = "14px";

    wrap.appendChild(lab);
    wrap.appendChild(c);
    return { wrap, c };
  }

  const left = makeBox("Before");
  const right = makeBox("After");

  ov.appendChild(left.wrap);
  ov.appendChild(right.wrap);

  // click outside to close (optional)
  ov.addEventListener("click", (e)=>{
    if(e.target === ov) toggleDetail(false);
  });

  document.body.appendChild(ov);

  detail.overlay = ov;
  detail.cBefore = left.c;
  detail.cAfter = right.c;
  detail.ctxB = left.c.getContext("2d");
  detail.ctxA = right.c.getContext("2d");
}

function toggleDetail(force){
  ensureDetailOverlay();
  detail.on = (typeof force === "boolean") ? force : !detail.on;
  detail.overlay.style.display = detail.on ? "flex" : "none";
  if(detail.on) updateDetail();
}

// Map mouse to normalized image coords (handles letterboxing if canvas is "contain")
function canvasPointToImageUV(clientX, clientY){
  const rect = canvas.getBoundingClientRect();

  // canvas internal aspect
  const imgAspect = srcW / srcH;
  const rectAspect = rect.width / rect.height;

  let drawW, drawH, offX, offY;

  if(rectAspect > imgAspect){
    // bars left/right
    drawH = rect.height;
    drawW = drawH * imgAspect;
    offX = (rect.width - drawW) / 2;
    offY = 0;
  } else {
    // bars top/bottom
    drawW = rect.width;
    drawH = drawW / imgAspect;
    offX = 0;
    offY = (rect.height - drawH) / 2;
  }

  const x = clientX - rect.left - offX;
  const y = clientY - rect.top - offY;

  let u = x / drawW;
  let v = y / drawH;

  // clamp into [0,1]
  u = Math.max(0, Math.min(1, u));
  v = Math.max(0, Math.min(1, v));

  return { u, v };
}

function drawDetailCrops(){
  if(!detail.on || !srcImg || !detail.ctxB || !detail.ctxA) return;

  const zb = detail.zoom;
  const outW = detail.cBefore.width;
  const outH = detail.cBefore.height;

  const cropW = Math.round(outW / zb);
  const cropH = Math.round(outH / zb);

  const cx = Math.round(detail.x * srcW);
  const cy = Math.round(detail.y * srcH);

  const sx = Math.max(0, Math.min(srcW - cropW, cx - Math.floor(cropW/2)));
  const sy = Math.max(0, Math.min(srcH - cropH, cy - Math.floor(cropH/2)));

  // BEFORE: from srcImg
  detail.ctxB.imageSmoothingEnabled = true;
  detail.ctxB.clearRect(0,0,outW,outH);
  detail.ctxB.drawImage(srcImg, sx, sy, cropW, cropH, 0, 0, outW, outH);

  // AFTER: from rendered canvas
  detail.ctxA.imageSmoothingEnabled = true;
  detail.ctxA.clearRect(0,0,outW,outH);
  detail.ctxA.drawImage(canvas, sx, sy, cropW, cropH, 0, 0, outW, outH);

  // crosshair
  const ch = (ctx)=>{
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.65)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(outW/2, 0);
    ctx.lineTo(outW/2, outH);
    ctx.moveTo(0, outH/2);
    ctx.lineTo(outW, outH/2);
    ctx.stroke();
    ctx.restore();
  };
  ch(detail.ctxB);
  ch(detail.ctxA);
}

function updateDetail(){
  if(!detail.on) return;
  drawDetailCrops();
}

// listen mouse on viewer for updating focus
function bindDetailTracking(){
  const target = document.querySelector(".viewerInner") || canvas;
  if(!target) return;

  const onMove = (clientX, clientY)=>{
    if(!srcImg) return;
    const { u, v } = canvasPointToImageUV(clientX, clientY);
    detail.x = u;
    detail.y = v;
    updateDetail();
  };

  target.addEventListener("mousemove", (e)=>{
    if(!detail.on) return;
    onMove(e.clientX, e.clientY);
  });

  target.addEventListener("touchmove", (e)=>{
    if(!detail.on) return;
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

 

  // Shortcuts:
  // P = fullscreen
  // D = detail viewer
  // ESC = close detail (and also exit fullscreen is handled by browser)
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
const fullscreenTarget = document.querySelector(".viewerInner");

function toggleFullscreen(){
  if(!document.fullscreenElement){
    fullscreenTarget.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
}

// knop
safeOn("fullscreenBtn","click", toggleFullscreen);

// shortcut
document.addEventListener("keydown", (e)=>{
  if(e.key.toLowerCase() === "p") toggleFullscreen();
});
