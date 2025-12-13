/* gl.js — TVL Lens Emulator (WebGL “Lens Profile” pipeline)
   Works on GitHub Pages (pure client-side WebGL1).
   Purpose: transform clean lenses (DZO Arles) → character lenses (IronGlass MKII).
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
    TVLGL.ensure(w, h);

    upload(img);
    draw(params || {});

    const ctx = outCanvas.getContext("2d");
    if (!ctx) return;

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
      warm: p.bloomWarmth ?? 0.22
    };

    gl.viewport(0, 0, w, h);
    quad(gl, TVLGL._prog);

    gl.bindFramebuffer(gl.FRAMEBUFFER, TVLGL._fbA);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, TVLGL._texSrc);
    uni(gl, "uTex", 0);
    uni(gl, "uRes", w, h);
    uni(gl, "uField", cfg.field);
    uni(gl, "uEdge", cfg.edge);
    uni(gl, "uComa", cfg.coma);
    uni(gl, "uCA", cfg.ca);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    quad(gl, TVLGL._progBloom);
    gl.bindFramebuffer(gl.FRAMEBUFFER, TVLGL._fbBloom);
    gl.bindTexture(gl.TEXTURE_2D, TVLGL._texA);
    uni(gl, "uBloom", cfg.bloom);
    uni(gl, "uWarm", cfg.warm);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    quad(gl, TVLGL._progComp);
    gl.bindFramebuffer(gl.FRAMEBUFFER, TVLGL._fbFinal);
    gl.bindTexture(gl.TEXTURE_2D, TVLGL._texA);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, TVLGL._texBloom);
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
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    return p;
  }

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
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

  function uni(gl, name, ...v) {
    const loc = gl.getUniformLocation(gl.getParameter(gl.CURRENT_PROGRAM), name);
    if (!loc) return;
    if (v.length === 1) gl.uniform1f(loc, v[0]);
    else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
    else gl.uniform1i(loc, v[0]);
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
      vec2 dir = normalize(d+0.0001);
      vec2 px = 1.0/uRes;

      float edge = smoothstep(0.25,0.9,r);
      float blur = edge * (uField*0.4 + uEdge*0.6);

      vec2 ca = dir * uCA * edge * 0.002;

      vec3 col = vec3(
        texture2D(uTex, vUv+ca).r,
        texture2D(uTex, vUv).g,
        texture2D(uTex, vUv-ca).b
      );

      vec2 smear = dir * px * uComa * edge * 6.0;
      col = mix(col, texture2D(uTex, vUv+smear).rgb, blur);

      gl_FragColor = vec4(col,1.);
    }
  `;

  const FRAG_BLOOM = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uTex;
    uniform float uBloom;
    uniform float uWarm;

    void main(){
      vec3 c = texture2D(uTex,vUv).rgb;
      float y = dot(c,vec3(.21,.72,.07));
      float m = smoothstep(.8,1.,y)*uBloom;
      vec3 b = c*m;
      b.r*=1.+.6*uWarm;
      b.g*=1.+.2*uWarm;
      gl_FragColor = vec4(b,1.);
    }
  `;

  const FRAG_COMP = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uTex;
    uniform sampler2D uBloomTex;
    void main(){
      vec3 a = texture2D(uTex,vUv).rgb;
      vec3 b = texture2D(uBloomTex,vUv).rgb;
      gl_FragColor = vec4(1.-(1.-a)*(1.-b),1.);
    }
  `;
})();
