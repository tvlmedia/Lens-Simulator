
/* TVL Lens Emulator — v4 Optical
   Supports:
   - globalSoft
   - halation
   - existing params
*/

const $ = (id) => document.getElementById(id);
function safeOn(id, evt, fn){ const el = $(id); if(el) el.addEventListener(evt, fn); }

const canvas = $("canvas");
const ctx2d = canvas.getContext("2d", { willReadFrequently: true });

let srcImg = null, srcW = 0, srcH = 0;
let profiles = {};
let activeName = "";
let liveParams = {};

// ---------------- PARAMS ----------------
const PARAMS = [
  { key:"globalSoft",   label:"Global softness", min:0,   max:0.6, step:0.01 },
  { key:"edgeSoftness", label:"Edge softness",   min:0,   max:2.0, step:0.01 },
  { key:"coma",         label:"Coma",            min:0,   max:2.0, step:0.01 },
  { key:"bloom",        label:"Bloom",           min:0,   max:2.0, step:0.01 },
  { key:"bloomWarmth",  label:"Bloom warmth",    min:-0.5,max:0.5, step:0.01 },
  { key:"halation",     label:"Halation",        min:0,   max:0.6, step:0.01 },
  { key:"veil",         label:"Veil",            min:0,   max:0.6, step:0.01 }
];

function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

// ---------------- UI ----------------
function buildParams(){
  const p = $("paramsPanel");
  p.innerHTML = "";
  PARAMS.forEach(def=>{
    const row = document.createElement("div");
    row.className = "paramRow";
    const lab = document.createElement("label");
    lab.textContent = def.label;

    const r = document.createElement("input");
    r.type = "range";
    r.min = def.min; r.max = def.max; r.step = def.step;
    r.dataset.k = def.key;

    const n = document.createElement("input");
    n.type = "number";
    n.min = def.min; n.max = def.max; n.step = def.step;
    n.dataset.k = def.key;

    const on = (e)=>{
      const k = e.target.dataset.k;
      const d = PARAMS.find(x=>x.key===k);
      const v = clamp(parseFloat(e.target.value), d.min, d.max);
      liveParams[k] = v;
      p.querySelectorAll(`[data-k="${k}"]`).forEach(el=>el.value=v);
      render();
    };

    r.addEventListener("input", on);
    n.addEventListener("input", on);

    row.appendChild(lab);
    row.appendChild(r);
    row.appendChild(n);
    p.appendChild(row);
  });
}

function syncUI(){
  const p = $("paramsPanel");
  PARAMS.forEach(def=>{
    const v = clamp(liveParams[def.key] ?? 0, def.min, def.max);
    p.querySelectorAll(`[data-k="${def.key}"]`).forEach(el=>el.value=v);
  });
}

// ---------------- LENS ----------------
function loadProfiles(){
  fetch("gl_profiles.json",{cache:"no-store"})
    .then(r=>r.json())
    .then(j=>{
      profiles = j;
      const sel = $("presetSelect");
      sel.innerHTML="";
      Object.keys(j).forEach(k=>{
        const o=document.createElement("option");
        o.value=k; o.textContent=k;
        sel.appendChild(o);
      });
      activeName = Object.keys(j)[0];
      sel.value = activeName;
      loadLens(activeName);
    });
}

function loadLens(name){
  activeName = name;
  liveParams = structuredClone(profiles[name]);
  syncUI();
  render();
}

// ---------------- IMAGE ----------------
function loadImage(file){
  const img = new Image();
  img.onload = ()=>{
    srcImg = img;
    srcW = img.naturalWidth;
    srcH = img.naturalHeight;
    canvas.width = srcW;
    canvas.height = srcH;
    render();
  };
  img.src = URL.createObjectURL(file);
}

// ---------------- RENDER ----------------
function render(){
  if(!srcImg) return;
  if(window.TVLGL) TVLGL.render(srcImg, liveParams, canvas);
}

// ---------------- BOOT ----------------
function boot(){
  buildParams();
  loadProfiles();
  safeOn("fileInput","change",e=>loadImage(e.target.files[0]));
  safeOn("presetSelect","change",e=>loadLens(e.target.value));
}

boot();
