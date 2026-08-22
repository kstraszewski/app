<script setup lang="ts">
const props = withDefaults(defineProps<{
  dark?: boolean | null
}>(), {
  dark: null,
})

const canvas = ref<HTMLCanvasElement | null>(null)
const useFallback = ref(false)

const vertexShaderSource = `
  attribute vec2 a_position;

  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`

const fragmentShaderSource = `
  precision highp float;

  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_pixel_ratio;
  uniform float u_dark;
  uniform vec3 u_orb_one;
  uniform vec3 u_orb_two;
  uniform vec4 u_pointer;

  float bayer4(vec2 position) {
    vec2 cell = mod(floor(position), 4.0);
    float x = cell.x;
    float y = cell.y;
    float value = 0.0;

    if (y < 1.0) {
      if (x < 1.0) value = 0.0;
      else if (x < 2.0) value = 8.0;
      else if (x < 3.0) value = 2.0;
      else value = 10.0;
    } else if (y < 2.0) {
      if (x < 1.0) value = 12.0;
      else if (x < 2.0) value = 4.0;
      else if (x < 3.0) value = 14.0;
      else value = 6.0;
    } else if (y < 3.0) {
      if (x < 1.0) value = 3.0;
      else if (x < 2.0) value = 11.0;
      else if (x < 3.0) value = 1.0;
      else value = 9.0;
    } else {
      if (x < 1.0) value = 15.0;
      else if (x < 2.0) value = 7.0;
      else if (x < 3.0) value = 13.0;
      else value = 5.0;
    }

    return (value + 0.5) / 16.0;
  }

  float segmentMask(vec2 point, vec2 start, vec2 end, float width) {
    vec2 fromStart = point - start;
    vec2 segment = end - start;
    float projection = clamp(
      dot(fromStart, segment) / dot(segment, segment),
      0.0,
      1.0
    );
    float distanceToSegment = length(fromStart - segment * projection);
    return 1.0 - smoothstep(width, width + 0.055, distanceToSegment);
  }

  float asciiGlyph(vec2 point, vec2 cell, float gravity) {
    float glyphShift = floor(gravity * 2.85 + 0.5);
    float glyph = mod(cell.x + cell.y * 2.0 + glyphShift, 3.0);

    if (glyph < 1.0) {
      float slash = segmentMask(point, vec2(-0.27, -0.32), vec2(0.27, 0.32), 0.045);
      float lowerDot = 1.0 - smoothstep(0.085, 0.145, length(point - vec2(-0.22, -0.25)));
      float upperDot = 1.0 - smoothstep(0.085, 0.145, length(point - vec2(0.22, 0.25)));
      return max(slash, max(lowerDot, upperDot));
    }

    if (glyph < 2.0) {
      float firstStroke = segmentMask(point, vec2(-0.27, -0.28), vec2(0.27, 0.28), 0.052);
      float secondStroke = segmentMask(point, vec2(-0.27, 0.28), vec2(0.27, -0.28), 0.052);
      return max(firstStroke, secondStroke);
    }

    float horizontal = segmentMask(point, vec2(-0.31, 0.0), vec2(0.31, 0.0), 0.052);
    float vertical = segmentMask(point, vec2(0.0, -0.31), vec2(0.0, 0.31), 0.052);
    return max(horizontal, vertical);
  }

  float gravityStrength(vec2 fragment, vec3 orb) {
    float radius = max(orb.z, 1.0);
    float distanceFromOrb = length(fragment - orb.xy) / radius;
    return 1.0 - smoothstep(1.05, 4.8, distanceFromOrb);
  }

  float meshBlob(vec2 point, vec2 center, vec2 radius) {
    vec2 local = (point - center) / radius;
    return 1.0 - smoothstep(0.0324, 1.0, dot(local, local));
  }

  vec2 gravityWarp(vec2 fragment, vec3 orb, float strength) {
    float radius = max(orb.z, 1.0);
    vec2 delta = fragment - orb.xy;
    float distanceFromOrb = max(length(delta), 0.001);
    float influence = (
      1.0 - smoothstep(radius * 1.05, radius * 4.8, distanceFromOrb)
    ) * strength;
    vec2 direction = delta / distanceFromOrb;
    vec2 tangent = vec2(-direction.y, direction.x);

    return fragment
      - direction * influence * radius * 0.34
      + tangent * influence * radius * 0.12;
  }

  float sphereShade(
    vec2 point,
    vec2 center,
    float radius,
    vec3 lightDirection
  ) {
    vec2 local = (point - center) / radius;
    float radiusSquared = dot(local, local);
    if (radiusSquared >= 1.0) return 0.0;

    float depth = sqrt(max(0.0, 1.0 - radiusSquared));
    vec3 normal = normalize(vec3(local, depth));
    float diffuse = max(dot(normal, lightDirection), 0.0);
    float silhouette = 1.0 - smoothstep(0.86, 1.0, radiusSquared);
    float reflectedLight = max(dot(normal, vec3(0.52, 0.28, 0.81)), 0.0);

    return silhouette * (0.055 + diffuse * 0.82 + reflectedLight * 0.10);
  }

  void main() {
    vec2 fragment = gl_FragCoord.xy;
    float shortestSide = min(u_resolution.x, u_resolution.y);
    vec2 point = (fragment - 0.5 * u_resolution) / shortestSide;
    float time = u_time * 0.085;
    float aspectRatio = u_resolution.x / u_resolution.y;
    float portrait = 1.0 - step(0.92, aspectRatio);
    vec2 drift = vec2(sin(time * 0.67), cos(time * 0.51)) * 0.026;

    vec2 mainCenter = mix(vec2(0.58, -0.61), vec2(0.20, -0.56), portrait) + drift;
    float mainRadius = mix(1.12, 0.91, portrait);
    vec3 mainLight = normalize(vec3(
      -0.32 + 0.08 * sin(time * 0.43),
      -0.72,
      0.63 + 0.05 * cos(time * 0.38)
    ));
    float mainSphere = sphereShade(point, mainCenter, mainRadius, mainLight);

    vec2 rearCenter = mix(vec2(-0.38, -0.89), vec2(-0.16, -0.78), portrait)
      + vec2(-drift.x * 0.45, drift.y * 0.35);
    float rearSphere = sphereShade(
      point,
      rearCenter,
      mix(1.02, 0.78, portrait),
      normalize(vec3(0.12, -0.84, 0.53))
    );

    vec2 sideCenter = mix(vec2(1.04, -0.54), vec2(0.52, -0.48), portrait)
      + vec2(drift.y * 0.45, -drift.x * 0.35);
    float sideSphere = sphereShade(
      point,
      sideCenter,
      mix(0.69, 0.58, portrait),
      normalize(vec3(-0.66, -0.44, 0.62))
    );

    vec2 cutCenter = mix(vec2(-0.16, -0.64), vec2(-0.13, -0.57), portrait)
      + drift * vec2(-0.18, 0.12);
    float cutRadius = mix(0.61, 0.49, portrait);
    float cutDistance = length((point - cutCenter) / cutRadius);
    float occlusion = 1.0 - smoothstep(0.965, 1.015, cutDistance);

    float backLayer = rearSphere * 0.48;
    float mainLayer = mainSphere * (1.0 - occlusion * 0.985);
    float sideLayer = sideSphere * 0.66;
    float ambientWave = sin(point.x * 2.8 + time * 0.34)
      * cos(point.y * 2.4 - time * 0.28);
    float ambientField = 0.165 + ambientWave * 0.012;
    float sculptedField = max(backLayer, max(mainLayer, sideLayer));
    float tonalField = max(ambientField, sculptedField * 0.52 + 0.07);
    float firstGravity = gravityStrength(fragment, u_orb_one);
    float secondGravity = gravityStrength(fragment, u_orb_two);
    float pointerGravity = gravityStrength(fragment, u_pointer.xyz) * u_pointer.w;
    float gravity = max(max(firstGravity, secondGravity), pointerGravity);
    tonalField = clamp(tonalField + gravity * 0.105, 0.15, 0.63);

    vec2 meshPoint = fragment / u_resolution;
    vec2 maskPoint = mix(meshPoint, meshPoint.yx, portrait);
    vec2 meshDrift = drift * 0.69;
    float leftLight = clamp(
      meshBlob(maskPoint, vec2(0.18, 0.68) + meshDrift, vec2(0.34, 0.25)) * 0.58
      + meshBlob(maskPoint, vec2(0.29, 0.43) - meshDrift * 0.65, vec2(0.30, 0.30)) * 0.48
      + meshBlob(maskPoint, vec2(0.05, 0.50) + vec2(meshDrift.y, -meshDrift.x), vec2(0.20, 0.30)) * 0.24,
      0.0,
      1.0
    );
    float rightShade = clamp(
      meshBlob(maskPoint, vec2(0.76, 0.68) - meshDrift * 0.72, vec2(0.28, 0.34)) * 0.78
      + meshBlob(maskPoint, vec2(0.86, 0.30) + meshDrift * 0.55, vec2(0.32, 0.30)) * 0.82
      + meshBlob(maskPoint, vec2(0.65, 0.46) + vec2(-meshDrift.y, meshDrift.x), vec2(0.22, 0.28)) * 0.48,
      0.0,
      1.0
    );
    float centerGlow = meshBlob(
      maskPoint,
      vec2(0.38, 0.60) + meshDrift * 0.42,
      vec2(0.22, 0.28)
    );
    float lowerShadow = meshBlob(
      maskPoint,
      vec2(0.70, 0.19) - meshDrift * 0.38,
      vec2(0.32, 0.22)
    );
    float horizontalShade = smoothstep(0.06, 0.94, maskPoint.x);
    float lightMeshMask = mix(0.56, 1.02, horizontalShade)
      - leftLight * 0.18
      + rightShade * 0.26
      - centerGlow * 0.10
      + lowerShadow * 0.14;
    float darkMeshMask = mix(0.42, 0.88, horizontalShade)
      - leftLight * 0.14
      + rightShade * 0.16
      - centerGlow * 0.08
      + lowerShadow * 0.10;
    float meshMask = clamp(mix(lightMeshMask, darkMeshMask, u_dark), 0.28, 1.28);
    tonalField = clamp(tonalField + (meshMask - 0.72) * 0.15, 0.035, 0.68);

    float glyphCellSize = mix(4.5, 4.0, step(760.0, u_resolution.x / u_pixel_ratio));
    vec2 warpedFragment = gravityWarp(
      gravityWarp(fragment, u_orb_one, 1.0),
      u_orb_two,
      1.0
    );
    if (u_pointer.w > 0.005) {
      warpedFragment = gravityWarp(warpedFragment, u_pointer.xyz, u_pointer.w);
    }
    vec2 glyphCoordinates = warpedFragment / (u_pixel_ratio * glyphCellSize);
    vec2 glyphCell = floor(glyphCoordinates);
    vec2 glyphPoint = fract(glyphCoordinates) - 0.5;
    float gravityGrowth = smoothstep(0.08, 0.88, gravity);
    float glyphScale = 1.12 + gravityGrowth * 0.46;
    float threshold = bayer4(glyphCell);
    float dither = step(threshold, tonalField)
      * asciiGlyph(glyphPoint / glyphScale, glyphCell, gravity);

    vec3 lightInk = vec3(0.035, 0.040, 0.038);
    vec3 darkInk = vec3(0.72, 0.735, 0.70);
    vec3 ink = mix(lightInk, darkInk, u_dark);
    float meshOpacity = mix(
      0.28,
      1.14,
      smoothstep(0.18, 1.32, meshMask)
    );
    float alpha = dither * mix(0.085, 0.17, u_dark) * meshOpacity;

    gl_FragColor = vec4(ink, alpha);
  }
`

const MAX_FRAME_RATE = 24
const MAX_PIXEL_RATIO = 1.5
const MAX_RENDER_PIXELS = 1_400_000
const POINTER_GRAVITY_RADIUS = 36
const POINTER_MAX_STRENGTH = 0.78
const POINTER_FOLLOW_RATE = 10
const POINTER_FADE_IN_RATE = 8
const POINTER_FADE_OUT_RATE = 5.8

let context: WebGLRenderingContext | null = null
let program: WebGLProgram | null = null
let positionBuffer: WebGLBuffer | null = null
let positionLocation = -1
let resolutionLocation: WebGLUniformLocation | null = null
let timeLocation: WebGLUniformLocation | null = null
let pixelRatioLocation: WebGLUniformLocation | null = null
let darkLocation: WebGLUniformLocation | null = null
let orbOneLocation: WebGLUniformLocation | null = null
let orbTwoLocation: WebGLUniformLocation | null = null
let pointerLocation: WebGLUniformLocation | null = null
let frameId = 0
let lastFrameAt = 0
let renderPixelRatio = 1
let resizeObserver: ResizeObserver | null = null
let motionPreference: MediaQueryList | null = null
let colorPreference: MediaQueryList | null = null
let prefersReducedMotion = false
let orbitSpheres: HTMLElement[] = []
let pointerSurface: HTMLElement | null = null
let pointerTargetX = 0
let pointerTargetY = 0
let pointerCurrentX = 0
let pointerCurrentY = 0
let pointerTargetStrength = 0
let pointerStrength = 0
let pointerInitialized = false
let lastPointerFrameTime = 0

function resolvesToDark() {
  return props.dark ?? colorPreference?.matches ?? false
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Unable to create WebGL shader')

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Unable to compile WebGL shader'
    gl.deleteShader(shader)
    throw new Error(message)
  }

  return shader
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource)
  const nextProgram = gl.createProgram()

  if (!nextProgram) {
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
    throw new Error('Unable to create WebGL program')
  }

  gl.attachShader(nextProgram, vertexShader)
  gl.attachShader(nextProgram, fragmentShader)
  gl.linkProgram(nextProgram)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)

  if (!gl.getProgramParameter(nextProgram, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(nextProgram) || 'Unable to link WebGL program'
    gl.deleteProgram(nextProgram)
    throw new Error(message)
  }

  return nextProgram
}

function resizeCanvas() {
  const element = canvas.value
  if (!element || !context) return

  const cssWidth = Math.max(1, element.clientWidth)
  const cssHeight = Math.max(1, element.clientHeight)
  const availablePixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
  const pixelBudgetRatio = Math.sqrt(MAX_RENDER_PIXELS / (cssWidth * cssHeight))
  renderPixelRatio = Math.max(0.65, Math.min(availablePixelRatio, pixelBudgetRatio))

  const width = Math.max(1, Math.round(cssWidth * renderPixelRatio))
  const height = Math.max(1, Math.round(cssHeight * renderPixelRatio))

  if (element.width !== width || element.height !== height) {
    element.width = width
    element.height = height
    context.viewport(0, 0, width, height)
  }

  drawFrame(prefersReducedMotion ? 7.5 : performance.now() / 1000)
}

function drawFrame(time: number) {
  const gl = context
  const element = canvas.value
  if (!gl || !program || !positionBuffer || !element) return

  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)

  if (positionLocation < 0) return

  gl.enableVertexAttribArray(positionLocation)
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)
  gl.uniform2f(resolutionLocation, element.width, element.height)
  gl.uniform1f(timeLocation, time)
  gl.uniform1f(pixelRatioLocation, renderPixelRatio)
  gl.uniform1f(darkLocation, resolvesToDark() ? 1 : 0)
  updateOrbitUniforms(gl, element)
  updatePointerUniform(gl, element, time)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
}

function updatePointerUniform(
  gl: WebGLRenderingContext,
  element: HTMLCanvasElement,
  time: number,
) {
  const bounds = element.getBoundingClientRect()
  const isInside = pointerInitialized
    && pointerTargetX >= bounds.left
    && pointerTargetX <= bounds.right
    && pointerTargetY >= bounds.top
    && pointerTargetY <= bounds.bottom
    && !prefersReducedMotion

  pointerTargetStrength = isInside ? POINTER_MAX_STRENGTH : 0

  const elapsed = time - lastPointerFrameTime
  const deltaTime = elapsed > 0 && elapsed <= 0.1
    ? elapsed
    : 1 / MAX_FRAME_RATE
  lastPointerFrameTime = time

  const followAmount = 1 - Math.exp(-POINTER_FOLLOW_RATE * deltaTime)
  pointerCurrentX += (pointerTargetX - pointerCurrentX) * followAmount
  pointerCurrentY += (pointerTargetY - pointerCurrentY) * followAmount

  const fadeRate = pointerTargetStrength > pointerStrength
    ? POINTER_FADE_IN_RATE
    : POINTER_FADE_OUT_RATE
  const fadeAmount = 1 - Math.exp(-fadeRate * deltaTime)
  pointerStrength += (pointerTargetStrength - pointerStrength) * fadeAmount

  const scaleX = element.width / Math.max(bounds.width, 1)
  const scaleY = element.height / Math.max(bounds.height, 1)
  const centerX = (pointerCurrentX - bounds.left) * scaleX
  const centerY = (bounds.bottom - pointerCurrentY) * scaleY
  const radius = POINTER_GRAVITY_RADIUS * Math.min(scaleX, scaleY)

  gl.uniform4f(pointerLocation, centerX, centerY, Math.max(radius, 1), pointerStrength)
}

function handlePointerMove(event: PointerEvent) {
  if (event.pointerType === 'touch' || prefersReducedMotion) {
    pointerInitialized = false
    pointerTargetStrength = 0
    return
  }

  pointerTargetX = event.clientX
  pointerTargetY = event.clientY

  if (!pointerInitialized) {
    pointerCurrentX = pointerTargetX
    pointerCurrentY = pointerTargetY
    pointerInitialized = true
  }
}

function handlePointerLeave() {
  pointerInitialized = false
  pointerTargetStrength = 0
}

function handlePointerBlur() {
  pointerInitialized = false
  pointerTargetStrength = 0
}

function resetPointerGravity() {
  pointerInitialized = false
  pointerTargetStrength = 0
  pointerStrength = 0
  lastPointerFrameTime = 0
}

function updateOrbitUniforms(gl: WebGLRenderingContext, element: HTMLCanvasElement) {
  if (orbitSpheres.length < 2 || orbitSpheres.some(sphere => !sphere.isConnected)) {
    const hero = element.closest('.hero')
    orbitSpheres = hero
      ? Array.from(hero.querySelectorAll<HTMLElement>('.phone__orbit-sphere')).slice(0, 2)
      : []
  }

  const canvasBounds = element.getBoundingClientRect()
  const scaleX = element.width / Math.max(canvasBounds.width, 1)
  const scaleY = element.height / Math.max(canvasBounds.height, 1)
  const locations = [orbOneLocation, orbTwoLocation]

  locations.forEach((location, index) => {
    const sphere = orbitSpheres[index]
    if (!sphere) {
      gl.uniform3f(location, -10_000, -10_000, 1)
      return
    }

    const bounds = sphere.getBoundingClientRect()
    const centerX = ((bounds.left + bounds.right) * 0.5 - canvasBounds.left) * scaleX
    const centerY = (canvasBounds.bottom - (bounds.top + bounds.bottom) * 0.5) * scaleY
    const radius = Math.max(bounds.width * scaleX, bounds.height * scaleY) * 0.5
    gl.uniform3f(location, centerX, centerY, Math.max(radius, 1))
  })
}

function renderLoop(timestamp: number) {
  frameId = requestAnimationFrame(renderLoop)

  const minimumFrameDuration = 1000 / MAX_FRAME_RATE
  if (timestamp - lastFrameAt < minimumFrameDuration) return

  lastFrameAt = timestamp
  drawFrame(timestamp / 1000)
}

function stopAnimation() {
  cancelAnimationFrame(frameId)
  frameId = 0
}

function startAnimation() {
  stopAnimation()
  if (prefersReducedMotion || document.hidden || useFallback.value) return

  lastFrameAt = 0
  frameId = requestAnimationFrame(renderLoop)
}

function handleMotionChange() {
  prefersReducedMotion = motionPreference?.matches ?? false

  if (prefersReducedMotion) {
    resetPointerGravity()
    stopAnimation()
    drawFrame(7.5)
  } else {
    startAnimation()
  }
}

function handleColorChange() {
  if (props.dark === null && (prefersReducedMotion || document.hidden)) {
    drawFrame(7.5)
  }
}

function handleVisibilityChange() {
  if (document.hidden) {
    resetPointerGravity()
    stopAnimation()
  } else if (prefersReducedMotion) drawFrame(7.5)
  else startAnimation()
}

function handleContextLost(event: Event) {
  event.preventDefault()
  stopAnimation()
  useFallback.value = true
}

function handleContextRestored() {
  initializeRenderer()
}

watch(() => props.dark, () => {
  if (!context) return
  drawFrame(prefersReducedMotion ? 7.5 : performance.now() / 1000)
})

function initializeRenderer() {
  const element = canvas.value
  if (!element) return

  try {
    const gl = element.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      powerPreference: 'low-power',
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      stencil: false,
    })

    if (!gl) throw new Error('WebGL is unavailable')

    context = gl
    program = createProgram(gl)
    positionBuffer = gl.createBuffer()
    if (!positionBuffer) throw new Error('Unable to create WebGL buffer')

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    )
    gl.clearColor(0, 0, 0, 0)

    resolutionLocation = gl.getUniformLocation(program, 'u_resolution')
    timeLocation = gl.getUniformLocation(program, 'u_time')
    pixelRatioLocation = gl.getUniformLocation(program, 'u_pixel_ratio')
    darkLocation = gl.getUniformLocation(program, 'u_dark')
    orbOneLocation = gl.getUniformLocation(program, 'u_orb_one')
    orbTwoLocation = gl.getUniformLocation(program, 'u_orb_two')
    pointerLocation = gl.getUniformLocation(program, 'u_pointer')
    positionLocation = gl.getAttribLocation(program, 'a_position')
    if (positionLocation < 0) throw new Error('Unable to resolve WebGL position attribute')
    useFallback.value = false

    resizeCanvas()
    startAnimation()
  } catch {
    context = null
    program = null
    positionBuffer = null
    useFallback.value = true
  }
}

onMounted(() => {
  const element = canvas.value
  if (!element) return

  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  colorPreference = window.matchMedia('(prefers-color-scheme: dark)')
  prefersReducedMotion = motionPreference.matches
  pointerSurface = element.closest<HTMLElement>('.hero')

  motionPreference.addEventListener('change', handleMotionChange)
  colorPreference.addEventListener('change', handleColorChange)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('blur', handlePointerBlur)
  pointerSurface?.addEventListener('pointermove', handlePointerMove, { passive: true })
  pointerSurface?.addEventListener('pointerleave', handlePointerLeave)
  pointerSurface?.addEventListener('pointercancel', handlePointerLeave)
  element.addEventListener('webglcontextlost', handleContextLost)
  element.addEventListener('webglcontextrestored', handleContextRestored)

  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(resizeCanvas)
    resizeObserver.observe(element)
  } else {
    window.addEventListener('resize', resizeCanvas)
  }

  initializeRenderer()
})

onBeforeUnmount(() => {
  stopAnimation()
  resizeObserver?.disconnect()
  if (!resizeObserver) window.removeEventListener('resize', resizeCanvas)
  motionPreference?.removeEventListener('change', handleMotionChange)
  colorPreference?.removeEventListener('change', handleColorChange)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.removeEventListener('blur', handlePointerBlur)
  pointerSurface?.removeEventListener('pointermove', handlePointerMove)
  pointerSurface?.removeEventListener('pointerleave', handlePointerLeave)
  pointerSurface?.removeEventListener('pointercancel', handlePointerLeave)
  canvas.value?.removeEventListener('webglcontextlost', handleContextLost)
  canvas.value?.removeEventListener('webglcontextrestored', handleContextRestored)

  if (context) {
    if (positionBuffer) context.deleteBuffer(positionBuffer)
    if (program) context.deleteProgram(program)
  }

  context = null
  program = null
  positionBuffer = null
  positionLocation = -1
  pointerLocation = null
  pointerSurface = null
})
</script>

<template>
  <div
    class="dither-background"
    :class="{
      'dither-background--dark': props.dark === true,
      'dither-background--light': props.dark === false,
    }"
    aria-hidden="true"
  >
    <div class="dither-background__fallback" />
    <canvas ref="canvas" :class="{ 'dither-background__canvas--hidden': useFallback }" />
  </div>
</template>

<style scoped>
.dither-background {
  position: absolute;
  z-index: 0;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.dither-background canvas,
.dither-background__fallback {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.dither-background canvas {
  z-index: 1;
  display: block;
}

.dither-background__canvas--hidden { opacity: 0; }

.dither-background__fallback {
  z-index: 0;
  color: var(--fg-primary);
  background-image: radial-gradient(circle, currentColor 0 0.7px, transparent 0.85px);
  background-size: 4px 4px;
  opacity: 0.055;
  -webkit-mask-image:
    radial-gradient(ellipse 72% 60% at 84% 22%, #000 0, transparent 72%),
    radial-gradient(ellipse 48% 56% at 14% 82%, #000 0, transparent 78%);
  mask-image:
    radial-gradient(ellipse 72% 60% at 84% 22%, #000 0, transparent 72%),
    radial-gradient(ellipse 48% 56% at 14% 82%, #000 0, transparent 78%);
}

.dither-background--dark .dither-background__fallback { opacity: 0.12; }

@media (prefers-color-scheme: dark) {
  .dither-background:not(.dither-background--light) .dither-background__fallback {
    opacity: 0.12;
  }
}

@media print, (forced-colors: active) {
  .dither-background { display: none; }
}
</style>
