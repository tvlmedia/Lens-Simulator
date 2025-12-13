/* gl.js — TVL Lens Emulator (WebGL “Lens Profile” pipeline)
   Fixes:
   - uniform location 0 bug (was: if(!loc) return;)
   - correct sampler uniforms (uniform1i)
   - set uTex/uBloomTex properly for bloom + composite passes
   - basic shader/program compile error logging
*/

(function () {
  const TVLGL = {};
  window.TVLGL = TVLGL;

  TVLGL.available = () => !!TVLGL._gl;

  TVLGL.ensure = (w, h) => {
    if (!TVLGL._gl) initGL();
    if (!TVLGL._gl) return false;
    if (TVLGL._w === w && TVLGL._h === h) return true;
    resize(w, h);
    return true;
  };

  TVLGL.render = (img, params, outCanvas) => {
    if (!TVLGL._gl) initGL();
    if (!TVLGL._gl) return false;

    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!TVLGL.ensure(w, h)) return false;

    upload(img);
    draw(params || {});

    const ctx = outCanvas.getContext("2d");
    if (!ctx) return false;

    const gl = TVLGL._gl;
    const buf = TVLGL._readBuf;

    gl.bindFramebuffer(gl.FRAMEBUFFER, TVLGL._fbFinal);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);

    const imgData = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * 4;
      const dst = y * w * 4;
      imgData.data.set(buf.subarray(src, src + w * 4), dst);
    }
    ctx.putImageData(imgData, 0, 0);
    return true;
  };

  /* ---------- internals ---------- */

  function initGL() {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl", { preserveDrawingBuffer: true });
    if (!gl) return;

    TVLGL._gl = gl;
    TVLGL._canvas = c;

    TVLGL._quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, TVLGL._quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1, 0, 0,
         1, -1, 1, 0,
        -1,  1, 0, 1,
         1,  1, 1, 1,
      ]),
      gl.STATIC_DRAW
    );

    TVLGL._prog = program(gl, VERT, FRAG_LENS);
    TVLGL._progBloom = program(gl, VERT, FRAG_BLOOM);
    TVLGL._progComp = program(gl, VERT, FRAG_COMP);

    TVLGL._texSrc = tex(gl);
    TVLGL._texA = tex(gl);
    TVLGL._texBloom = tex(gl);

    TVLGL._fbA = gl.createFramebuffer();
    TVLGL._fbBloom = gl.createFramebuffer();
    TVLGL._fbFinal = gl.createFramebuffer();

    gl.disable(gl.DEPTH_TEST);
  }

  function resize(w, h) {
    const gl = TVLGL._gl;
    TVLGL._canvas.width = w;
    TVLGL._canvas.height = h;
    TVLGL._w = w;
    TVLGL._h = h;
    TVLGL._readBuf = new Uint8Array(w * h * 4);

    alloc(gl, TVLGL._texSrc, w, h);
    alloc(gl, TVLGL._texA, w, h);
    alloc(gl, TVLGL._texBloom, w, h);

    attach(gl, TVLGL._fbA, TVLGL._texA);
    attach(gl, TVLGL._fbBloom, TVLGL._texBloom);
    // final also uses texA as output target (same size)
    attach(gl, TVLGL._fbFinal, TVLGL._texA);
  }

  function upload(img) {
    const gl = TVLGL._gl;
    gl.bindTexture(gl.TEXTURE_2D, TVLGL._texSrc);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  }

  function draw(p) {
    const gl = TVLGL._gl;
    const w = TVLGL._w;
    const h = TVLGL._h;

    const cfg = {
      field: p.fieldCurvature ?? 0.55,
      edge: p.edgeSoftness ?? 0.65,
      coma: p.coma ?? 0.45,
      ca: p.ca ?? 0.18,
      bloom: p.bloom ?? 0.35,
      warm: p.bloomWarmth ?? 0.22,
    };

    gl.viewport(0, 0, w, h);

    // PASS 1: lens warp/CA/coma -> texA (fbA)
    quad(gl, TVLGL._prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, TVLGL._fbA);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, TVLGL._texSrc);
    uniS(gl, TVLGL._prog, "uTex", 0);
    uni2(gl, TVLGL._prog, "uRes", w, h);
    uni1(gl, TVLGL._prog, "uField", cfg.field);
    uni1(gl, TVLGL._prog, "uEdge", cfg.edge);
    uni1(gl, TVLGL._prog, "uComa", cfg.coma);
    uni1(gl, TVLGL._prog, "uCA", cfg.ca);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // PASS 2: bloom extract -> texBloom (fbBloom)
    quad(gl, TVLGL._progBloom);
    gl.bindFramebuffer(gl.FRAMEBUFFER, TVLGL._fbBloom);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, TVLGL._texA);
    uniS(gl, TVLGL._progBloom, "uTex", 0);
    uni1(gl, TVLGL._progBloom, "uBloom", cfg.bloom);
    uni1(gl, TVLGL._progBloom, "uWarm", cfg.warm);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // PASS 3: composite -> texA (fbFinal)
    quad(gl, TVLGL._progComp);
    gl.bindFramebuffer(gl.FRAMEBUFFER, TVLGL._fbFinal);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, TVLGL._texA);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, TVLGL._texBloom);

    uniS(gl, TVLGL._progComp, "uTex", 0);
    uniS(gl, TVLGL._progComp, "uBloomTex", 1);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /* ---------- helpers ---------- */

  function tex(gl) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  function alloc(gl, t, w, h) {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  function attach(gl, fb, t) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  }

  function program(gl, vs, fs) {
    const p = gl.createProgram();
    const sv = compile(gl, gl.VERTEX_SHADER, vs);
    const sf = compile(gl, gl.FRAGMENT_SHADER, fs);
    if (!sv || !sf) return null;

    gl.attachShader(p, sv);
    gl.attachShader(p, sf);
    gl.linkProgram(p);

    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error("TVLGL program link error:", gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error("TVLGL shader compile error:", gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  function quad(gl, prog) {
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, TVLGL._quad);
    const aPos = gl.getAttribLocation(prog, "aPos");
    const aUv = gl.getAttribLocation(prog, "aUv");
    gl.enableVertexAttribArray(aPos);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);
  }

  // uniform helpers (IMPORTANT: loc can be 0!)
  function uniLoc(gl, prog, name) {
    const loc = gl.getUniformLocation(prog, name);
    return loc; // can be null OR 0/other
  }
  function uni1(gl, prog, name, v) {
    const loc = uniLoc(gl, prog, name);
    if (loc === null) return;
    gl.uniform1f(loc, v);
  }
  function uni2(gl, prog, name, a, b) {
    const loc = uniLoc(gl, prog, name);
    if (loc === null) return;
    gl.uniform2f(loc, a, b);
  }
  function uniS(gl, prog, name, unit) {
    const loc = uniLoc(gl, prog, name);
    if (loc === null) return;
    gl.uniform1i(loc, unit);
  }

  const VERT = `
    attribute vec2 aPos;
    attribute vec2 aUv;
    varying vec2 vUv;
    void main(){ vUv = aUv; gl_Position = vec4(aPos,0.,1.); }
  `;

  const FRAG_LENS = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uTex;
    uniform vec2 uRes;
    uniform float uField;
    uniform float uEdge;
    uniform float uComa;
    uniform float uCA;

    void main(){
      vec2 c = vec2(0.5);
      vec2 d = vUv - c;
      float r = length(d);
      vec2 dir = normalize(d + 0.00001);
      vec2 px = 1.0 / uRes;

      float edge = smoothstep(0.25, 0.92, r);

      // chromatic aberration
      vec2 ca = dir * uCA * edge * 0.0022;

      vec3 col = vec3(
        texture2D(uTex, vUv + ca).r,
        texture2D(uTex, vUv).g,
        texture2D(uTex, vUv - ca).b
      );

      // coma smear (very mild, directional)
      float blur = edge * (uField * 0.35 + uEdge * 0.65);
      vec2 smear = dir * px * uComa * edge * 7.0;
      vec3 smeared = texture2D(uTex, vUv + smear).rgb;

      col = mix(col, smeared, blur);

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const FRAG_BLOOM = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uTex;
    uniform float uBloom;
    uniform float uWarm;

    void main(){
      vec3 c = texture2D(uTex, vUv).rgb;
      float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float m = smoothstep(0.80, 1.00, y) * uBloom;
      vec3 b = c * m;

      // warm tint
      b.r *= 1.0 + 0.6 * uWarm;
      b.g *= 1.0 + 0.2 * uWarm;

      gl_FragColor = vec4(b, 1.0);
    }
  `;

  const FRAG_COMP = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uTex;
    uniform sampler2D uBloomTex;

    void main(){
      vec3 a = texture2D(uTex, vUv).rgb;
      vec3 b = texture2D(uBloomTex, vUv).rgb;
      // screen blend
      vec3 outc = 1.0 - (1.0 - a) * (1.0 - b);
      gl_FragColor = vec4(outc, 1.0);
    }
  `;
})();
