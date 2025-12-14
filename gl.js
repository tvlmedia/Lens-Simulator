/* gl.js — TVL Lens Emulator (Physics-ish WebGL pipeline)
   Drop-in replacement for your existing TVLGL.render(img, params, outCanvas)

   Goals:
   - Field-dependent anisotropic PSF (9-tap) instead of 1-sample smear
   - Highlight-driven glare: tight bloom + wide veiling glare (half-res, separable blur)
   - Work in approx. linear light (sRGB <-> linear) for more believable roll-off
   - Keep your existing param keys:
       fieldCurvature, edgeSoftness, coma, comaAnamorph, bloom, bloomWarmth,
       ca, vignette, asymX, asymY, veil
*/

(function () {
  const TVLGL = {};
  window.TVLGL = TVLGL;

  TVLGL._gl = null;

  // ---------- public ----------
  TVLGL.available = () => {
    if (!TVLGL._gl) initGL();
    return !!TVLGL._gl;
  };

  TVLGL.ensure = (w, h) => {
    if (!TVLGL._gl) initGL();
    if (!TVLGL._gl) return false;
    return resize(w, h);
  };

  TVLGL.render = (img, params, outCanvas) => {
    if (!TVLGL._gl) initGL();
    if (!TVLGL._gl) return false;

    const gl = TVLGL._gl;

    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!resize(w, h)) return false;

    // Upload
    gl.bindTexture(gl.TEXTURE_2D, TVLGL._texSrc);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

    // Draw pipeline
    if (!draw(params || {})) return false;

    // Copy final framebuffer to output 2D canvas
    const ctx = outCanvas.getContext("2d", { willReadFrequently: true });
    outCanvas.width = w;
    outCanvas.height = h;

    gl.bindFramebuffer(gl.FRAMEBUFFER, TVLGL._fbFinal);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, TVLGL._readBuf);

    const imgData = ctx.createImageData(w, h);
    const buf = TVLGL._readBuf;
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * 4;
      const dst = y * w * 4;
      imgData.data.set(buf.subarray(src, src + w * 4), dst);
    }
    ctx.putImageData(imgData, 0, 0);

    return true;
  };

  // ---------- internals ----------
  function initGL() {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl", { preserveDrawingBuffer: true, antialias: false });
    if (!gl) return;

    TVLGL._gl = gl;

    // Fullscreen quad
    TVLGL._vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, TVLGL._vb);
    // aPos(xy), aUv(xy)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1, 0, 0,
         1, -1, 1, 0,
        -1,  1, 0, 1,
        -1,  1, 0, 1,
         1, -1, 1, 0,
         1,  1, 1, 1
      ]),
      gl.STATIC_DRAW
    );

    // Shaders
    const VERT = `
      attribute vec2 aPos;
      attribute vec2 aUv;
      varying vec2 vUv;
      void main(){
        vUv = aUv;
        gl_Position = vec4(aPos, 0.0, 1.0);
      }
    `;

    const FRAG_LENS = `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D uTex;
      uniform vec2 uRes;

      uniform float uField;   // fieldCurvature
      uniform float uEdge;    // edgeSoftness
      uniform float uComa;    // coma
      uniform float uAstig;   // comaAnamorph (repurposed as astig/tangential)
      uniform float uCA;      // ca
      uniform float uVign;    // vignette
      uniform vec2  uAsym;    // asymX/Y

      float luma(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }

      vec3 toLin(vec3 c){ return pow(max(c, 0.0), vec3(2.2)); }
      vec3 toSrgb(vec3 c){ return pow(max(c, 0.0), vec3(1.0/2.2)); }

      // Sample with lateral CA outward/inward along the field direction.
      vec3 sampleCA(vec2 uv, vec2 caDir, float caAmt){
        vec3 c = texture2D(uTex, uv).rgb;
        if(caAmt <= 0.00001) return toLin(c);

        vec2 off = caDir * caAmt;
        float r = texture2D(uTex, uv + off).r;
        float g = c.g;
        float b = texture2D(uTex, uv - off).b;
        return toLin(vec3(r,g,b));
      }

      void main(){
        vec2 px = 1.0 / uRes;

        // Center + asymmetry shift (subtle decentering)
        vec2 uv = vUv + uAsym * px * 8.0;

        // Field coordinates
        vec2 cc = uv - 0.5;
        float r = length(cc);
        vec2 dir = (r > 0.0001) ? (cc / r) : vec2(0.0, 1.0);
        vec2 tan = vec2(-dir.y, dir.x);

        // Edge mask (0 center -> 1 edge)
        float edge = smoothstep(0.08, 0.95, r);

        // Build a field-dependent PSF:
        // - base grows to the edge (uEdge)
        // - additional "focus falloff" (uField) biased to outer field
        float focusFall = uField * edge * edge;
        float base = (uEdge * 0.9 + focusFall * 0.65);

        // Directional stretch: coma pushes radial; astig pushes tangential
        float coma = uComa * edge * edge;
        float astg = uAstig * edge;

        // Convert to pixel offsets
        // Keep these conservative to avoid "filter-y" look.
        vec2 oR = dir * px * (base * 1.8 + coma * 10.0);
        vec2 oT = tan * px * (base * 1.5 + astg * 7.0);

        // Lateral CA offset
        float caAmt = uCA * edge * 0.0035;

        // 9-tap anisotropic kernel (approx PSF)
        // weights sum ~1
        vec3 c0 = sampleCA(uv, dir, caAmt) * 0.26;

        vec3 c1 = sampleCA(uv + oR, dir, caAmt) * 0.16;
        vec3 c2 = sampleCA(uv - oR, dir, caAmt) * 0.16;

        vec3 c3 = sampleCA(uv + oT, dir, caAmt) * 0.12;
        vec3 c4 = sampleCA(uv - oT, dir, caAmt) * 0.12;

        vec3 c5 = sampleCA(uv + oR + oT, dir, caAmt) * 0.09;
        vec3 c6 = sampleCA(uv + oR - oT, dir, caAmt) * 0.09;
        vec3 c7 = sampleCA(uv - oR + oT, dir, caAmt) * 0.09;
        vec3 c8 = sampleCA(uv - oR - oT, dir, caAmt) * 0.09;

        vec3 col = c0 + c1 + c2 + c3 + c4 + c5 + c6 + c7 + c8;

        // Gentle microcontrast “collapse” towards edge (real lenses lose MTF off-axis)
        // This avoids the "flat haze" look while still making edges feel organic.
        float mtfLoss = edge * (0.10 + 0.35 * uEdge);
        float y = luma(col);
        col = mix(col, vec3(y), mtfLoss * 0.25);

        // Vignetting in linear light
        float vig = smoothstep(0.20, 0.95, r);
        col *= (1.0 - uVign * 0.65 * vig);

        gl_FragColor = vec4(toSrgb(col), 1.0);
      }
    `;

    // Extract + downsample to half-res (also adds warmth bias into glare)
    const FRAG_EXTRACT = `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D uTex;
      uniform vec2 uRes;
      uniform float uBloom;
      uniform float uWarm;

      vec3 toLin(vec3 c){ return pow(max(c, 0.0), vec3(2.2)); }
      vec3 toSrgb(vec3 c){ return pow(max(c, 0.0), vec3(1.0/2.2)); }

      float luma(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }

      void main(){
        // Half-res FBO: vUv maps to full-res texture coords.
        vec2 px = 1.0 / uRes;

        // 2x2 box downsample
        vec3 a = texture2D(uTex, vUv + vec2(-0.5, -0.5) * px).rgb;
        vec3 b = texture2D(uTex, vUv + vec2( 0.5, -0.5) * px).rgb;
        vec3 c = texture2D(uTex, vUv + vec2(-0.5,  0.5) * px).rgb;
        vec3 d = texture2D(uTex, vUv + vec2( 0.5,  0.5) * px).rgb;

        vec3 col = (a + b + c + d) * 0.25;
        vec3 lin = toLin(col);

        float y = luma(lin);

        // Two-stage mask: tight highlights for bloom; we keep it in one texture
        // and later generate a wide veil by extra blur passes.
        float m = smoothstep(0.75, 1.10, y) * uBloom;

        vec3 g = lin * m;

        // Warm bias (more red than blue, subtle)
        g.r *= 1.0 + 0.55 * uWarm;
        g.g *= 1.0 + 0.15 * uWarm;
        g.b *= 1.0 - 0.10 * uWarm;

        gl_FragColor = vec4(toSrgb(g), 1.0);
      }
    `;

    // Separable blur (half-res)
    const FRAG_BLUR = `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D uTex;
      uniform vec2 uTexRes;
      uniform vec2 uDir;     // (1,0) or (0,1)
      uniform float uStep;   // step multiplier

      vec3 toLin(vec3 c){ return pow(max(c, 0.0), vec3(2.2)); }
      vec3 toSrgb(vec3 c){ return pow(max(c, 0.0), vec3(1.0/2.2)); }

      void main(){
        vec2 px = (uDir / uTexRes) * uStep;

        // 9-tap gaussian-ish
        vec3 s0 = toLin(texture2D(uTex, vUv).rgb) * 0.227027;
        vec3 s1 = toLin(texture2D(uTex, vUv + px * 1.384615).rgb) * 0.316216;
        vec3 s2 = toLin(texture2D(uTex, vUv - px * 1.384615).rgb) * 0.316216;
        vec3 s3 = toLin(texture2D(uTex, vUv + px * 3.230769).rgb) * 0.070270;
        vec3 s4 = toLin(texture2D(uTex, vUv - px * 3.230769).rgb) * 0.070270;

        vec3 col = s0 + s1 + s2 + s3 + s4;
        gl_FragColor = vec4(toSrgb(col), 1.0);
      }
    `;

    // Composite lens + tight bloom + wide veil
    const FRAG_COMP = `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D uBase;     // full-res lens result
      uniform sampler2D uBloomT;   // half-res tight bloom
      uniform sampler2D uBloomW;   // half-res wide veil
      uniform float uBloom;
      uniform float uVeil;

      vec3 toLin(vec3 c){ return pow(max(c, 0.0), vec3(2.2)); }
      vec3 toSrgb(vec3 c){ return pow(max(c, 0.0), vec3(1.0/2.2)); }

      void main(){
        vec3 base = toLin(texture2D(uBase, vUv).rgb);
        vec3 bt = toLin(texture2D(uBloomT, vUv).rgb);
        vec3 bw = toLin(texture2D(uBloomW, vUv).rgb);

        // Tight bloom sits closer to highlights
        base += bt * (0.85 * uBloom);

        // Wide veil is subtle, broad wash
        base += bw * (0.55 * uVeil);

        gl_FragColor = vec4(toSrgb(base), 1.0);
      }
    `;

    // Compile programs
    TVLGL._progLens = buildProgram(gl, VERT, FRAG_LENS);
    TVLGL._progExtract = buildProgram(gl, VERT, FRAG_EXTRACT);
    TVLGL._progBlur = buildProgram(gl, VERT, FRAG_BLUR);
    TVLGL._progComp = buildProgram(gl, VERT, FRAG_COMP);

    // Textures + FBOs
    TVLGL._texSrc = makeTex(gl);
    TVLGL._texLens = makeTex(gl);

    TVLGL._texBloom0 = makeTex(gl); // extract
    TVLGL._texBloom1 = makeTex(gl); // temp
    TVLGL._texBloomT = makeTex(gl); // tight final
    TVLGL._texBloomW = makeTex(gl); // wide final

    TVLGL._fbLens = gl.createFramebuffer();
    TVLGL._fbBloom0 = gl.createFramebuffer();
    TVLGL._fbBloom1 = gl.createFramebuffer();
    TVLGL._fbBloomT = gl.createFramebuffer();
    TVLGL._fbBloomW = gl.createFramebuffer();
    TVLGL._fbFinal = gl.createFramebuffer();

    // Readback buffer is allocated on resize()
  }

  function makeTex(gl){
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  }

  function attach(gl, fb, tex){
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    if(!ok) console.warn("TVLGL: FBO incomplete");
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function resize(w, h){
    const gl = TVLGL._gl;
    if (!gl) return false;
    if (TVLGL._w === w && TVLGL._h === h) return true;

    TVLGL._w = w; TVLGL._h = h;

    // Full res
    gl.bindTexture(gl.TEXTURE_2D, TVLGL._texSrc);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    gl.bindTexture(gl.TEXTURE_2D, TVLGL._texLens);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    attach(gl, TVLGL._fbLens, TVLGL._texLens);
    attach(gl, TVLGL._fbFinal, TVLGL._texLens); // overwritten in draw()

    // Half res buffers for glare
    const hw = Math.max(1, Math.floor(w / 2));
    const hh = Math.max(1, Math.floor(h / 2));
    TVLGL._hw = hw; TVLGL._hh = hh;

    for (const tex of [TVLGL._texBloom0, TVLGL._texBloom1, TVLGL._texBloomT, TVLGL._texBloomW]){
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, hw, hh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }

    attach(gl, TVLGL._fbBloom0, TVLGL._texBloom0);
    attach(gl, TVLGL._fbBloom1, TVLGL._texBloom1);
    attach(gl, TVLGL._fbBloomT, TVLGL._texBloomT);
    attach(gl, TVLGL._fbBloomW, TVLGL._texBloomW);

    TVLGL._readBuf = new Uint8Array(w * h * 4);

    return true;
  }

  function buildProgram(gl, vsSrc, fsSrc){
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSrc);
    gl.compileShader(vs);
    if(!gl.getShaderParameter(vs, gl.COMPILE_STATUS)){
      console.error("TVLGL: VS compile error", gl.getShaderInfoLog(vs));
      return null;
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSrc);
    gl.compileShader(fs);
    if(!gl.getShaderParameter(fs, gl.COMPILE_STATUS)){
      console.error("TVLGL: FS compile error", gl.getShaderInfoLog(fs));
      return null;
    }

    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p, gl.LINK_STATUS)){
      console.error("TVLGL: Program link error", gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  function bindQuad(gl, prog){
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, TVLGL._vb);

    const aPos = gl.getAttribLocation(prog, "aPos");
    const aUv  = gl.getAttribLocation(prog, "aUv");
    gl.enableVertexAttribArray(aPos);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(aUv,  2, gl.FLOAT, false, 16, 8);
  }

  function draw(params){
    const gl = TVLGL._gl;
    const w = TVLGL._w, h = TVLGL._h;
    const hw = TVLGL._hw, hh = TVLGL._hh;

    // Pull params with sane defaults
    const p = {
      fieldCurvature: clamp01(params.fieldCurvature ?? 0.1),
      edgeSoftness:   clamp01(params.edgeSoftness   ?? 0.1),
      coma:           clamp01(params.coma           ?? 0.1),
      comaAnamorph:   clamp01(params.comaAnamorph   ?? 0.0),
      bloom:          clamp01(params.bloom          ?? 0.1),
      bloomWarmth:    clamp01(params.bloomWarmth    ?? 0.0),
      ca:             clamp01(params.ca             ?? 0.0),
      vignette:       clamp01(params.vignette       ?? 0.0),
      asymX:          clamp11(params.asymX          ?? 0.0),
      asymY:          clamp11(params.asymY          ?? 0.0),
      veil:           clamp01(params.veil           ?? 0.0),
    };

    // ---- PASS 1: Lens PSF ----
    gl.viewport(0, 0, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, TVLGL._fbLens);
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    bindQuad(gl, TVLGL._progLens);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, TVLGL._texSrc);
    gl.uniform1i(gl.getUniformLocation(TVLGL._progLens, "uTex"), 0);
    gl.uniform2f(gl.getUniformLocation(TVLGL._progLens, "uRes"), w, h);

    gl.uniform1f(gl.getUniformLocation(TVLGL._progLens, "uField"), p.fieldCurvature);
    gl.uniform1f(gl.getUniformLocation(TVLGL._progLens, "uEdge"),  p.edgeSoftness);
    gl.uniform1f(gl.getUniformLocation(TVLGL._progLens, "uComa"),  p.coma);
    gl.uniform1f(gl.getUniformLocation(TVLGL._progLens, "uAstig"), p.comaAnamorph);
    gl.uniform1f(gl.getUniformLocation(TVLGL._progLens, "uCA"),    p.ca);
    gl.uniform1f(gl.getUniformLocation(TVLGL._progLens, "uVign"),  p.vignette);
    gl.uniform2f(gl.getUniformLocation(TVLGL._progLens, "uAsym"),  p.asymX, p.asymY);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // ---- PASS 2: Extract highlights + downsample (half res) ----
    gl.viewport(0, 0, hw, hh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, TVLGL._fbBloom0);
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    bindQuad(gl, TVLGL._progExtract);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, TVLGL._texLens);
    gl.uniform1i(gl.getUniformLocation(TVLGL._progExtract, "uTex"), 0);
    gl.uniform2f(gl.getUniformLocation(TVLGL._progExtract, "uRes"), w, h);
    gl.uniform1f(gl.getUniformLocation(TVLGL._progExtract, "uBloom"), p.bloom);
    gl.uniform1f(gl.getUniformLocation(TVLGL._progExtract, "uWarm"),  p.bloomWarmth);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // ---- PASS 3: Tight blur (H then V) -> texBloomT ----
    // H
    gl.bindFramebuffer(gl.FRAMEBUFFER, TVLGL._fbBloom1);
    blurPass(TVLGL._texBloom0, TVLGL._progBlur, hw, hh, 1.0, 0.0, 1.0);

    // V
    gl.bindFramebuffer(gl.FRAMEBUFFER, TVLGL._fbBloomT);
    blurPass(TVLGL._texBloom1, TVLGL._progBlur, hw, hh, 0.0, 1.0, 1.0);

    // ---- PASS 4: Wide blur (H then V) from tight -> texBloomW ----
    // H wide
    gl.bindFramebuffer(gl.FRAMEBUFFER, TVLGL._fbBloom1);
    blurPass(TVLGL._texBloomT, TVLGL._progBlur, hw, hh, 1.0, 0.0, 4.0);

    // V wide
    gl.bindFramebuffer(gl.FRAMEBUFFER, TVLGL._fbBloomW);
    blurPass(TVLGL._texBloom1, TVLGL._progBlur, hw, hh, 0.0, 1.0, 4.0);

    // ---- PASS 5: Composite (full res) -> _fbFinal (we reuse fbFinal but attach texLens isn't enough)
    // We'll render into texLens itself? No feedback issues because we sample texLens (already rendered) and write into texLens would feedback.
    // So we need a dedicated final texture.
    ensureFinalTex();

    gl.viewport(0, 0, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, TVLGL._fbFinal);
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    bindQuad(gl, TVLGL._progComp);

    // base
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, TVLGL._texLens);
    gl.uniform1i(gl.getUniformLocation(TVLGL._progComp, "uBase"), 0);

    // bloom tight
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, TVLGL._texBloomT);
    gl.uniform1i(gl.getUniformLocation(TVLGL._progComp, "uBloomT"), 1);

    // bloom wide
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, TVLGL._texBloomW);
    gl.uniform1i(gl.getUniformLocation(TVLGL._progComp, "uBloomW"), 2);

    gl.uniform1f(gl.getUniformLocation(TVLGL._progComp, "uBloom"), p.bloom);
    gl.uniform1f(gl.getUniformLocation(TVLGL._progComp, "uVeil"),  p.veil);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return true;

    // --- helpers ---
    function blurPass(texIn, prog, tw, th, dx, dy, step){
      gl.viewport(0, 0, tw, th);
      bindQuad(gl, prog);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texIn);
      gl.uniform1i(gl.getUniformLocation(prog, "uTex"), 0);
      gl.uniform2f(gl.getUniformLocation(prog, "uTexRes"), tw, th);
      gl.uniform2f(gl.getUniformLocation(prog, "uDir"), dx, dy);
      gl.uniform1f(gl.getUniformLocation(prog, "uStep"), step);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function ensureFinalTex(){
      if (TVLGL._texFinal && TVLGL._fw === w && TVLGL._fh === h) return;

      // Allocate final texture at full-res
      const tex = TVLGL._texFinal || makeTex(gl);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

      TVLGL._texFinal = tex;
      TVLGL._fw = w; TVLGL._fh = h;

      attach(gl, TVLGL._fbFinal, tex);
    }
  }

  function clamp01(x){ return Math.max(0, Math.min(1, x)); }
  function clamp11(x){ return Math.max(-1, Math.min(1, x)); }

})();
