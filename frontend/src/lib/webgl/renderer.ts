import { LINE_FS, LINE_VS, POINT_FS, POINT_VS } from './shaders'

export interface Renderer {
  /** points: [x,y,size,bright,phase,r,g,b]*n / lines: [x,y,alpha]*2n（座標は device px） */
  draw(points: number[], lines: number[], t: number): void
  dispose(): void
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer | null {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true })
  if (!gl) return null

  const compile = (type: number, src: string, label: string) => {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, src)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader)
      gl.deleteShader(shader)
      throw new Error(`WebGL failed to compile the ${label} shader: ${log ?? 'No compiler log was provided.'}`)
    }
    return shader
  }
  const mk = (vs: string, fs: string) => {
    const p = gl.createProgram()!
    const v = compile(gl.VERTEX_SHADER, vs, 'vertex')
    const f = compile(gl.FRAGMENT_SHADER, fs, 'fragment')
    gl.attachShader(p, v)
    gl.attachShader(p, f)
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`WebGL failed to link: ${gl.getProgramInfoLog(p)}`)
    }
    gl.deleteShader(v)
    gl.deleteShader(f)
    return p
  }
  const setup = (prog: WebGLProgram, spec: [string, number, number][], stride: number) => {
    const vao = gl.createVertexArray()!
    const buf = gl.createBuffer()!
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    spec.forEach(([n, size, off]) => {
      const l = gl.getAttribLocation(prog, n)
      gl.enableVertexAttribArray(l)
      gl.vertexAttribPointer(l, size, gl.FLOAT, false, stride, off)
    })
    return { vao, buf }
  }

  const pp = mk(POINT_VS, POINT_FS)
  const lp = mk(LINE_VS, LINE_FS)
  const P = setup(pp, [['p', 2, 0], ['a', 3, 8], ['c', 3, 20]], 32)
  const L = setup(lp, [['p', 2, 0], ['al', 1, 8]], 12)
  const uP = { r: gl.getUniformLocation(pp, 'r'), t: gl.getUniformLocation(pp, 't') }
  const uL = gl.getUniformLocation(lp, 'r')

  // premultiplied alpha の「over」合成。rgb が alpha を超えないので白飛びしない
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

  return {
    draw(points, lines, t) {
      const dp = devicePixelRatio || 1
      const w = Math.round(canvas.clientWidth * dp), h = Math.round(canvas.clientHeight * dp)
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
      gl.viewport(0, 0, w, h)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)

      gl.useProgram(lp)
      gl.bindVertexArray(L.vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, L.buf)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.DYNAMIC_DRAW)
      gl.uniform2f(uL, w, h)
      gl.drawArrays(gl.LINES, 0, lines.length / 3)

      gl.useProgram(pp)
      gl.bindVertexArray(P.vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, P.buf)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.DYNAMIC_DRAW)
      gl.uniform2f(uP.r, w, h)
      gl.uniform1f(uP.t, t)
      gl.drawArrays(gl.POINTS, 0, points.length / 8)
    },
    dispose() {
      // loseContext() は呼ばない：同じcanvasは再マウント時に同じ（失効済みの）contextを返すため
      gl.deleteProgram(pp)
      gl.deleteProgram(lp)
      gl.deleteBuffer(P.buf)
      gl.deleteBuffer(L.buf)
      gl.deleteVertexArray(P.vao)
      gl.deleteVertexArray(L.vao)
    },
  }
}