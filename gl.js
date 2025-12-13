
/* TVLGL — Lens Shader (updated edge softness)
   - True edge softness via blur kernel
   - Coma kept separate as directional smear
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
    uniform float uComa;
    uniform float uField;

    varying vec2 vUV;

    vec3 blur5(sampler2D tex, vec2 uv, vec2 px, float r){
      vec3 c = texture2D(tex, uv).rgb;
      c += texture2D(tex, uv + vec2( px.x, 0.0) * r).rgb;
      c += texture2D(tex, uv + vec2(-px.x, 0.0) * r).rgb;
      c += texture2D(tex, uv + vec2(0.0,  px.y) * r).rgb;
      c += texture2D(tex, uv + vec2(0.0, -px.y) * r).rgb;
      return c / 5.0;
    }

    void main(){
      vec2 px = 1.0 / uRes;
      vec2 uv = vUV;

      vec2 c = uv - 0.5;
      float r = length(c);
      float edge = smoothstep(0.3, 1.0, r);

      vec3 col = texture2D(uTex, uv).rgb;

      // TRUE edge softness
      float soft = edge * clamp(uEdge, 0.0, 2.0);
      vec3 blurred = blur5(uTex, uv, px, soft * 6.0);
      col = mix(col, blurred, clamp(soft, 0.0, 1.0));

      // Coma (directional smear)
      float comaMix = edge * clamp(uComa, 0.0, 2.0);
      vec2 dir = normalize(c + 1e-5);
      vec3 smeared = texture2D(uTex, uv + dir * px * comaMix * 18.0).rgb;
      col = mix(col, smeared, clamp(comaMix * 0.65, 0.0, 1.0));

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
    loc.uComa = gl.getUniformLocation(prog, "uComa");
    loc.uField = gl.getUniformLocation(prog, "uField");

    return true;
  }

  function render(img, p, canvas){
    if(!gl && !init(canvas)) return false;

    gl.viewport(0,0,canvas.width,canvas.height);
    gl.useProgram(prog);

    gl.uniform2f(loc.uRes, canvas.width, canvas.height);
    gl.uniform1f(loc.uEdge, p.edgeSoftness || 0.0);
    gl.uniform1f(loc.uComa, p.coma || 0.0);
    gl.uniform1f(loc.uField, p.fieldCurvature || 0.0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.uniform1i(loc.uTex, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return true;
  }

  return { render };
})();
