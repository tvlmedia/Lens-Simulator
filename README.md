# TVL Lens Emulator (MVP)

Static GitHub Pages tool: upload een 'clean' image → kies lens preset → export PNG.

## Features
- Presets (Helios/Jena/Cooke-ish)
- Sliders: Strength, Swirl, Halation, Vignette, CA, Flare, Contrast, Saturation
- Toggle: show before
- Export: PNG + split (before/after)

## Run lokaal
Open `index.html` via een lokale server (aanrader), bv:
- VS Code: Live Server
- of `python -m http.server`

## Deploy
Push naar GitHub → Settings → Pages → deploy from branch.

## Notes
Dit is een client-side MVP. Echte “lens exactness” vereist lensdata/paired training. 
