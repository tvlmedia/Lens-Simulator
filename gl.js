
/* TVLGL v4 — Optical Lens Shader
   Adds:
   - Global softness (MTF drop)
   - Real bloom (threshold + blur)
   - Halation (warm channel bleed)
   - Non-linear veil flare
   Keeps:
   - Edge softness
   - Coma / anamorph
*/

const TVLGL = (() => {
  let gl, prog, tex;
  let loc = {};

  const vert = `
    attribute vec2 aPos;
    varying vec2 vUV;
    void main(){
      vUV = (aPos + 1.0) * 0.5;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }
  `;

  const frag = `
    precision highp float;
    uniform sampler2D uTex;
    uniform vec2 uRes;

    uniform float uEdge;
    uniform float uGlobalSoft;
    uniform float uComa;
    uniform float uBloom;
    uniform float uBloomWarm;
    uniform float uHalation;
    uniform float uVeil;

    varying vec2 vUV;

    vec3 blur5(vec2 uv, float r){
      vec2 px = 1.0 / uRes;
      vec3 c = texture2D(uTex, uv).rgb;
      c += texture2D(uTex, uv + vec2( px.x, 0.0) * r).rgb;
      c += texture2D(uTex, uv + vec2(-px.x, 0.0) * r).rgb;
      c += texture2D(uTex, uv + vec2(0.0,  px.y) * r).rgb;
      c += texture2D(uTex, uv + vec2(0.0, -px.y) * r).rgb;
      return c / 5.0;
    }

    float luma(vec3 c){
      return dot(c, vec3(0.2126,0.7152,0.0722));
    }

    void main(){
      vec2 uv = vUV;
      vec2 c = uv - 0.5;
      float r = length(c);
      float edge = smoothstep(0.35, 1.0, r);

      vec3 col = texture2D(uTex, uv).rgb;
      float y = luma(col);

      // --- Global softness (MTF drop)
      vec3 gblur = blur5(uv, uGlobalSoft * 3.0);
      col = mix(col, gblur, clamp(uGlobalSoft, 0.0, 0.6));

      // --- Edge softness
      vec3 eblur = blur5(uv, uEdge * 6.0);
      col = mix(col, eblur, edge * clamp(uEdge, 0.0, 1.0));

      // --- Coma (directional smear)
      vec2 dir = normalize(c + 1e-5);
      vec3 smear = texture2D(uTex, uv + dir * (1.0/uRes) * uComa * 18.0).rgb;
      col = mix(col, smear, edge * clamp(uComa, 0.0, 1.0));

      // --- Bloom (highlight glow)
      float bh = smoothstep(0.65, 1.0, y);
      vec3 bblur = blur5(uv, 8.0) * bh;
      vec3 bwarm = bblur * vec3(1.0 + uBloomWarm, 1.0, 1.0 - uBloomWarm*0.5);
      col += bwarm * uBloom;

      // --- Halation (warm edge bleed)
      float hh = smoothstep(0.7, 1.0, y) * edge;
      vec3 hblur = blur5(uv, 10.0) * hh;
      hblur *= vec3(1.12, 1.05, 0.92);
      col += hblur * uHalation;

      // --- Veil flare (non-linear lift)
      float v = smoothstep(0.2, 0.9, y) * uVeil;
      col = mix(col, col + vec3(v), 0.6);

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function compile(type, src){
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
      console.error(gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  function init(canvas){
    gl = canvas.getContext("webgl");
    if(!gl) return false;

    const vs = compile(gl.VERTEX_SHADER, vert);
    const fs = compile(gl.FRAGMENT_SHADER, frag);
    prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1,-1,  1,-1, -1,1,
      -1,1,   1,-1,  1,1
    ]), gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    loc.uTex = gl.getUniformLocation(prog, "uTex");
    loc.uRes = gl.getUniformLocation(prog, "uRes");
    loc.uEdge = gl.getUniformLocation(prog, "uEdge");
    loc.uGlobalSoft = gl.getUniformLocation(prog, "uGlobalSoft");
    loc.uComa = gl.getUniformLocation(prog, "uComa");
    loc.uBloom = gl.getUniformLocation(prog, "uBloom");
    loc.uBloomWarm = gl.getUniformLocation(prog, "uBloomWarm");
    loc.uHalation = gl.getUniformLocation(prog, "uHalation");
    loc.uVeil = gl.getUniformLocation(prog, "uVeil");

    return true;
  }

  function render(img, p, canvas){
    if(!gl && !init(canvas)) return false;

    gl.viewport(0,0,canvas.width,canvas.height);
    gl.useProgram(prog);

    gl.uniform2f(loc.uRes, canvas.width, canvas.height);
    gl.uniform1f(loc.uEdge, p.edgeSoftness || 0.0);
    gl.uniform1f(loc.uGlobalSoft, p.globalSoft || 0.0);
    gl.uniform1f(loc.uComa, p.coma || 0.0);
    gl.uniform1f(loc.uBloom, p.bloom || 0.0);
    gl.uniform1f(loc.uBloomWarm, p.bloomWarmth || 0.0);
    gl.uniform1f(loc.uHalation, p.halation || 0.0);
    gl.uniform1f(loc.uVeil, p.veil || 0.0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.uniform1i(loc.uTex, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return true;
  }

  return { render };
})();
