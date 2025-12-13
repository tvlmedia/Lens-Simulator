/* TVL Lens Emulator — NO SLIDERS
   - Upload image
   - Choose lens profile (gl_profiles.json)
   - Render via WebGL (gl.js / TVLGL)
   - Export PNG + split
*/

const $ = (id) => document.getElementById(id);
function safeOn(id, evt, fn){ const el = $(id); if(el) el.addEventListener(evt, fn); }

const canvas = $("canvas"); // id="canvas"
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
  return fetch("gl_profiles.json")
    .then(r => r.json())
    .then(j => {
      profiles = j || {};
      populateSelect();
      setStatus("Profiles loaded", true);
    })
    .catch((e) => {
      console.error(e);
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

  img.onload = () => {
    srcImg = img;
    srcW = img.naturalWidth;
    srcH = img.naturalHeight;

    resizeCanvas(srcW, srcH);

    const es = $("emptyState");
    if(es) es.style.display = "none";

    setDimsText();
    setStatus("Loaded", true);

    render();
    URL.revokeObjectURL(url);
  };

  img.onerror = () => {
    setStatus("Kon afbeelding niet laden", false);
  };

  img.src = url;
}

// ---------- rendering ----------
function drawBefore(){
  ctx2d.setTransform(1,0,0,1,0,0);
  ctx2d.clearRect(0,0,srcW,srcH);
  ctx2d.drawImage(srcImg, 0, 0);
  setStatus("Before", true);
}

function render(){
  if(!srcImg) return;

  if($("showBefore")?.checked){
    drawBefore();
    return;
  }

  const prof = profiles[activeName] || {};

  // WebGL render -> writes into the SAME canvas
  if(window.TVLGL && TVLGL.render){
    const ok = TVLGL.render(srcImg, prof, canvas);
    if(ok){
      setStatus(`Lens: ${activeName}`, true);
      return;
    }
  }

  // fallback: show original if WebGL failed
  drawBefore();
  setStatus("WebGL niet beschikbaar → toon originele", false);
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

// ---------- bind ----------
function bind(){
  safeOn("fileInput","change",(e)=> onFile(e.target.files && e.target.files[0]));
  safeOn("presetSelect","change",(e)=> { activeName = e.target.value; render(); });
  safeOn("showBefore","change", render);

  // Button exists in UI; we just re-render (flare randomness zit nog niet in gl.js)
  safeOn("randomizeFlare","click", render);

  safeOn("exportPng","click", ()=>{
    if(!srcImg) return;
    exportCanvas(`TVL_LensEmulator_${safeName(activeName)}.png`, canvas);
  });

  safeOn("exportSplit","click", exportSplit);
}

loadProfiles().then(bind);
