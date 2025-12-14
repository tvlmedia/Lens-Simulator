
/* app.js — FINAL MATCH with gl.js v4
   All slider keys map 1:1 to shader uniforms.
*/

const $ = (id) => document.getElementById(id);
const canvas = $("canvas");
const ctx2d = canvas.getContext("2d", { willReadFrequently: true });

let srcImg = null;
let profiles = {};
let activeName = "";
let liveParams = {};

const PARAMS = [
  { key:"globalSoft",  label:"Global softness", min:0,   max:1.5, step:0.01 },
  { key:"edgeSoftness",label:"Edge softness",   min:0,   max:1.0, step:0.01 },
  { key:"coma",        label:"Coma",            min:0,   max:1.0, step:0.01 },
  { key:"bloom",       label:"Bloom",           min:0,   max:2.0, step:0.01 },
  { key:"bloomWarmth", label:"Bloom warmth",    min:-1,  max:1.0, step:0.01 },
  { key:"halation",    label:"Halation",        min:0,   max:2.0, step:0.01 },
  { key:"veil",        label:"Veil flare",      min:0,   max:1.5, step:0.01 }
];

function clamp(v,min,max){ return Math.max(min, Math.min(max, parseFloat(v)||0)); }

function buildParams(){
  const panel = $("paramsPanel");
  panel.innerHTML = "";
  PARAMS.forEach(p=>{
    const r = document.createElement("input");
    r.type="range"; r.min=p.min; r.max=p.max; r.step=p.step;
    r.oninput = ()=>{ liveParams[p.key]=parseFloat(r.value); render(); };
    panel.appendChild(document.createTextNode(p.label));
    panel.appendChild(r);
  });
}

function loadProfiles(){
  fetch("gl_profiles.json",{cache:"no-store"}).then(r=>r.json()).then(j=>{
    profiles=j;
    const sel=$("presetSelect");
    Object.keys(j).forEach(k=>{
      const o=document.createElement("option");
      o.value=k;o.textContent=k;sel.appendChild(o);
    });
    activeName=sel.value;
    liveParams={...profiles[activeName]};
    render();
  });
}

function render(){
  if(!srcImg) return;
  if(!window.TVLGL){ ctx2d.drawImage(srcImg,0,0,canvas.width,canvas.height); return; }
  TVLGL.render(srcImg, liveParams, canvas);
}

$("fileInput").onchange=e=>{
  const img=new Image();
  img.onload=()=>{
    srcImg=img;
    canvas.width=img.width;
    canvas.height=img.height;
    render();
  };
  img.src=URL.createObjectURL(e.target.files[0]);
};

buildParams();
loadProfiles();
