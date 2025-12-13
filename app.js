/* TVL Lens Emulator — NO SLIDERS
   - Upload image
   - Choose lens profile (gl_profiles.json)
   - Render via gl.js (TVLGL)
   - Export PNG + split
*/

const $ = (id) => document.getElementById(id);
function safeOn(id, evt, fn){ const el = $(id); if(el) el.addEventListener(evt, fn); }

const canvas = $("canvas");              // id="canvas"
const ctx = canvas.getContext("2d", { willReadFrequently: true });

let srcImg = null;
let srcW = 0, srcH = 0;

let profiles = {};
let activeName = "";
let flareSeed = Math.floor(Math.random() * 1e9);

function setStatus(text, good=false){
  const pill = $("infoPill");
  if(!pill) return;
  pill.textContent = text;
  pill.style.color = good ? "var(--good)" : "";
}

function setDimsText(){
  const el = $("dimPill");
  if(!el) return;
  el.textContent = srcImg ? `${srcW}×${srcH}` : "—";
}

function resizeCanvas(w,h){
  canvas.width = w; canvas.height = h;
}

function drawBefore(){
  if(!srcImg) return;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,srcW,srcH);
  ctx.drawImage(srcImg,0,0);
}

async function loadProfiles(){
  try{
    const r = await fetch("gl_profiles.json", { cache: "no-store" });
    profiles = await r.json();
  } catch(e){
    profiles = {};
    setStatus("Kon gl_profiles.json niet laden.", false);
  }
  populateSelect();
}

function populateSelect(){
  const sel = $("presetSelect");
  if(!sel) return;
  sel.innerHTML = "";

  const keys = Object.keys(profiles || {});
  if(keys.length === 0){
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Geen lenzen gevonden";
    sel.appendChild(opt);
    activeName = "";
    return;
  }

  keys.forEach(k => {
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = k;
    sel.appendChild(opt);
  });

  activeName = keys[0];
  sel.value = activeName;
  render();
}

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
  img.onerror = () => setStatus("Kon afbeelding niet laden.", false);
  img.src = url;
}

function currentParams(){
  const p = profiles[activeName] || {};
  // flareSeed meegeven kan later als je gl.js ‘m gebruikt
  return { ...p, _seed: flareSeed };
}

function render(){
  if(!srcImg) return;

  // before toggle
  const showBefore = $("showBefore")?.checked;
  if(showBefore){
    drawBefore();
    setStatus("Before", true);
    return;
  }

  // WebGL path
  if(window.TVLGL && typeof window.TVLGL.render === "function"){
    try{
      window.TVLGL.render(srcImg, currentParams(), canvas);
      setStatus(`Lens: ${activeName}`, true);
      return;
    } catch(e){
      // fallthrough
    }
  }

  // Fallback: show original
  drawBefore();
  setStatus("WebGL niet beschikbaar → toon origineel.", false);
}

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

  // snapshot current canvas as "after"
  const after = document.createElement("canvas");
  after.width = srcW; after.height = srcH;
  after.getContext("2d").drawImage(canvas,0,0);

  // build split
  const tmp = document.createElement("canvas");
  tmp.width = srcW; tmp.height = srcH;
  const tctx = tmp.getContext("2d");

  // left = before
  tctx.drawImage(srcImg,0,0);

  // right half = after
  const half = Math.floor(srcW/2);
  tctx.drawImage(after, half, 0, srcW-half, srcH, half, 0, srcW-half, srcH);

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

function bind(){
  safeOn("fileInput","change",(e)=> onFile(e.target.files && e.target.files[0]));
  safeOn("presetSelect","change",(e)=>{ activeName = e.target.value; render(); });

  safeOn("randomizeFlare","click", ()=>{
    flareSeed = Math.floor(Math.random()*1e9);
    render();
  });

  safeOn("exportPng","click", ()=>{
    if(!srcImg) return;
    exportCanvas(`TVL_LensEmulator_${safeName(activeName)}.png`, canvas);
  });

  safeOn("exportSplit","click", ()=> exportSplit());

  // toggles rerender
  safeOn("showBefore","change", render);
  safeOn("autoFit","change", render); // zit er wel in je UI; functioneel doet ’t nu niks, maar harmless.
}

loadProfiles().then(bind);
