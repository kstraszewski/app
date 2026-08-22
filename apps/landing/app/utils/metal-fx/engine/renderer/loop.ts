/**
 * Shared animation loop and per-instance compositing.
 *
 * Upstream metal-fx uses one global preset for its singleton renderer. The
 * Vue port keeps one WebGL context/program/RAF, but batches visible instances
 * by `preset:theme`. One tiny shader pass is rendered per active group and
 * immediately copied to that group's 2D canvases.
 */
import { hexToRgb } from '../color'
import { FRAME_INTERVAL_MS, GLOW_SKIP_FRAMES } from '../perfConfig'
import {
  PRESETS,
  type PresetMode,
  type PresetName,
  type PresetTheme,
} from '../presets'
import {
  SHARED,
  CANONICAL_PILL_W,
  CANONICAL_PILL_H,
  CIRCLE_SHADER_SCALE,
  PILL_SHADER_SCALE,
  ensureSharedRenderer,
  setContextRestoredCallback,
  teardownSharedRenderer,
  type MetalFxInstance,
  type RenderKey,
} from './core'
import { captureGlowPixels } from './sampling'

let defaultPresetName: PresetName = 'chromatic'
let defaultPresetTheme: PresetTheme = 'dark'

export function createRenderKey(
  presetName: PresetName,
  presetTheme: PresetTheme,
): RenderKey {
  return `${presetName}:${presetTheme}`
}

setContextRestoredCallback(() => {
  if (!SHARED) return
  for (const instance of SHARED.instances) {
    instance.everCopied = false
    instance.glowDirty = Boolean(
      glowCallback && SHARED.glowQueue.includes(instance),
    )
  }
  if (SHARED.instances.size > 0 && SHARED.pausedAtMs === null) startSharedLoop()
})

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!SHARED || SHARED.pausedAtMs !== null || SHARED.contextLost) return
    if (document.hidden) stopSharedLoop()
    else if (SHARED.instances.size > 0) startSharedLoop()
  })
}

export interface CreateInstanceOptions {
  hostCanvas: HTMLCanvasElement
  cssWidth: number
  cssHeight: number
  cornerRadius: number
  kind: 'pill' | 'circle'
  shaderScale?: number
  ringCssPx?: number
  opacityMul?: number
  paused?: boolean
  scale?: number
  presetName?: PresetName
  presetTheme?: PresetTheme
  onAfterFrame?: () => void
  onFirstCopy?: () => void
}

export function createInstance(options: CreateInstanceOptions): MetalFxInstance {
  // Resolve the destination context first. If it is unavailable we have not
  // created the shared WebGL renderer yet, so an early failure cannot leak it.
  const context = options.hostCanvas.getContext('2d', { alpha: true })
  if (!context) throw new Error('metal-fx: canvas 2D context unavailable')

  const renderer = ensureSharedRenderer()
  const scale = options.scale ?? 1
  const presetName = options.presetName ?? defaultPresetName
  const presetTheme = options.presetTheme ?? defaultPresetTheme
  const instance: MetalFxInstance = {
    canvas: options.hostCanvas,
    ctx: context,
    cssWidth: options.cssWidth,
    cssHeight: options.cssHeight,
    cornerRadius: options.cornerRadius,
    kind: options.kind,
    ringCssPx: options.ringCssPx
      ?? (options.kind === 'circle' ? 2 : 1) * scale,
    shaderScale: options.shaderScale
      ?? (options.kind === 'circle' ? CIRCLE_SHADER_SCALE : PILL_SHADER_SCALE) * scale,
    opacityMul: options.opacityMul ?? 1,
    presetName,
    presetTheme,
    renderKey: createRenderKey(presetName, presetTheme),
    visible: true,
    paused: options.paused ?? false,
    everCopied: false,
    glowDirty: false,
    dpr: 1,
    scale,
    onAfterFrame: options.onAfterFrame,
    onFirstCopy: options.onFirstCopy,
  }

  resizeInstanceCanvas(instance)
  renderer.instances.add(instance)
  if (renderer.rafId === 0 && renderer.pausedAtMs === null) startSharedLoop()
  return instance
}

export function destroyInstance(instance: MetalFxInstance) {
  if (!SHARED) return
  SHARED.instances.delete(instance)
  const queueIndex = SHARED.glowQueue.indexOf(instance)
  if (queueIndex !== -1) SHARED.glowQueue.splice(queueIndex, 1)
  if (SHARED.instances.size === 0) {
    stopSharedLoop()
    teardownSharedRenderer()
  }
}

export function registerGlowInstance(instance: MetalFxInstance) {
  if (!SHARED) return
  if (!SHARED.glowQueue.includes(instance)) SHARED.glowQueue.push(instance)
  instance.glowDirty = glowCallback !== null
  if (
    instance.glowDirty
    && instance.visible
    && SHARED.rafId === 0
    && SHARED.pausedAtMs === null
    && !SHARED.contextLost
  ) {
    startSharedLoop()
  }
}

export function unregisterGlowInstance(instance: MetalFxInstance) {
  instance.glowDirty = false
  if (!SHARED) return
  const index = SHARED.glowQueue.indexOf(instance)
  if (index !== -1) SHARED.glowQueue.splice(index, 1)
}

type InstancePatch = Partial<Pick<
  MetalFxInstance,
  | 'cssWidth'
  | 'cssHeight'
  | 'cornerRadius'
  | 'kind'
  | 'shaderScale'
  | 'ringCssPx'
  | 'opacityMul'
  | 'paused'
  | 'scale'
  | 'presetName'
  | 'presetTheme'
>>

export function updateInstance(
  instance: MetalFxInstance,
  patch: InstancePatch,
) {
  let resize = false
  let repaint = false

  if (patch.cssWidth !== undefined && patch.cssWidth !== instance.cssWidth) {
    instance.cssWidth = patch.cssWidth
    resize = true
  }
  if (patch.cssHeight !== undefined && patch.cssHeight !== instance.cssHeight) {
    instance.cssHeight = patch.cssHeight
    resize = true
  }
  if (
    patch.cornerRadius !== undefined
    && patch.cornerRadius !== instance.cornerRadius
  ) {
    instance.cornerRadius = patch.cornerRadius
    repaint = true
  }
  if (patch.scale !== undefined && patch.scale !== instance.scale) {
    instance.scale = patch.scale
    repaint = true
  }
  if (patch.kind !== undefined && patch.kind !== instance.kind) {
    instance.kind = patch.kind
    if (patch.shaderScale === undefined) {
      instance.shaderScale = (
        patch.kind === 'circle' ? CIRCLE_SHADER_SCALE : PILL_SHADER_SCALE
      ) * instance.scale
    }
    if (patch.ringCssPx === undefined) {
      instance.ringCssPx = (
        patch.kind === 'circle' ? 2 : 1
      ) * instance.scale
    }
    repaint = true
  }
  if (
    patch.shaderScale !== undefined
    && patch.shaderScale !== instance.shaderScale
  ) {
    instance.shaderScale = patch.shaderScale
    repaint = true
  }
  if (
    patch.ringCssPx !== undefined
    && patch.ringCssPx !== instance.ringCssPx
  ) {
    instance.ringCssPx = patch.ringCssPx
    repaint = true
  }
  if (
    patch.opacityMul !== undefined
    && patch.opacityMul !== instance.opacityMul
  ) {
    instance.opacityMul = patch.opacityMul
    repaint = true
  }

  let renderKeyChanged = false
  if (
    patch.presetName !== undefined
    && patch.presetName !== instance.presetName
  ) {
    instance.presetName = patch.presetName
    renderKeyChanged = true
  }
  if (
    patch.presetTheme !== undefined
    && patch.presetTheme !== instance.presetTheme
  ) {
    instance.presetTheme = patch.presetTheme
    renderKeyChanged = true
  }
  if (renderKeyChanged) {
    instance.renderKey = createRenderKey(
      instance.presetName,
      instance.presetTheme,
    )
    repaint = true
  }

  if (patch.paused !== undefined && patch.paused !== instance.paused) {
    instance.paused = patch.paused
    if (!patch.paused) repaint = true
  }

  if (resize) {
    resizeInstanceCanvas(instance)
    repaint = true
  }

  if (repaint) {
    instance.everCopied = false
    instance.glowDirty = Boolean(
      glowCallback && SHARED?.glowQueue.includes(instance),
    )
  }
  if (
    (repaint || patch.paused === false)
    && instance.visible
    && SHARED
    && SHARED.rafId === 0
    && SHARED.pausedAtMs === null
    && !SHARED.contextLost
  ) {
    startSharedLoop()
  }
}

export function setInstanceVisible(instance: MetalFxInstance, visible: boolean) {
  instance.visible = visible
  if (
    visible
    && SHARED
    && SHARED.rafId === 0
    && SHARED.pausedAtMs === null
    && !SHARED.contextLost
  ) {
    startSharedLoop()
  }
}

/**
 * Compatibility API from upstream. In the Vue port this sets defaults for
 * instances created without an explicit preset; it never rewrites other
 * live instances.
 */
export function setSharedPreset(name: PresetName, theme: PresetTheme) {
  defaultPresetName = name
  defaultPresetTheme = theme
}

export function pauseShared() {
  if (!SHARED || SHARED.pausedAtMs !== null) return
  SHARED.pausedAtMs = performance.now()
  stopSharedLoop()
}

export function resumeShared() {
  if (!SHARED || SHARED.pausedAtMs === null) return
  SHARED.pausedMs += performance.now() - SHARED.pausedAtMs
  SHARED.pausedAtMs = null
  if (SHARED.instances.size > 0) startSharedLoop()
}

export function getSharedFrameCount() {
  return SHARED?.frameCount ?? 0
}

export type GlowCallback = (instance: MetalFxInstance, nowMs: number) => void
let glowCallback: GlowCallback | null = null

export function setGlowCallback(callback: GlowCallback | null) {
  glowCallback = callback
  if (!SHARED) return

  let shouldStart = false
  for (const instance of SHARED.glowQueue) {
    instance.glowDirty = callback !== null
    shouldStart ||= instance.glowDirty && instance.visible
  }
  if (
    shouldStart
    && SHARED.rafId === 0
    && SHARED.pausedAtMs === null
    && !SHARED.contextLost
  ) {
    startSharedLoop()
  }
}

function resizeInstanceCanvas(instance: MetalFxInstance) {
  instance.dpr = Math.min(
    2,
    typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
  )
  const width = Math.max(1, Math.round(instance.cssWidth * instance.dpr))
  const height = Math.max(1, Math.round(instance.cssHeight * instance.dpr))
  if (instance.canvas.width !== width) instance.canvas.width = width
  if (instance.canvas.height !== height) instance.canvas.height = height
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  if (typeof context.roundRect === 'function') {
    context.roundRect(x, y, width, height, radius)
    return
  }

  const safeRadius = Math.min(
    Math.max(0, radius),
    Math.max(0, width / 2),
    Math.max(0, height / 2),
  )
  context.moveTo(x + safeRadius, y)
  context.lineTo(x + width - safeRadius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius)
  context.lineTo(x + width, y + height - safeRadius)
  context.quadraticCurveTo(
    x + width,
    y + height,
    x + width - safeRadius,
    y + height,
  )
  context.lineTo(x + safeRadius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius)
  context.lineTo(x, y + safeRadius)
  context.quadraticCurveTo(x, y, x + safeRadius, y)
}

function punchInnerHole(instance: MetalFxInstance) {
  const { ctx, dpr, canvas } = instance
  const stroke = instance.ringCssPx * dpr
  const width = Math.max(0, canvas.width - 2 * stroke)
  const height = Math.max(0, canvas.height - 2 * stroke)
  const innerRadius = Math.max(
    0,
    (instance.cornerRadius - instance.ringCssPx) * dpr,
  )

  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = '#000'
  ctx.beginPath()
  roundedRect(ctx, stroke, stroke, width, height, innerRadius)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function copyShaderToInstance(instance: MetalFxInstance) {
  if (!SHARED) return
  const source: CanvasImageSource = SHARED.frameBitmap ?? SHARED.glCanvas
  const destinationWidth = instance.canvas.width
  const destinationHeight = instance.canvas.height
  if (destinationWidth < 1 || destinationHeight < 1) return

  const canvasWidth = SHARED.glCanvas.width
  const canvasHeight = SHARED.glCanvas.height
  const baselineWidth = CANONICAL_PILL_W * instance.dpr
  const baselineHeight = CANONICAL_PILL_H * instance.dpr
  let sourceWidth = (
    destinationWidth * (canvasWidth / baselineWidth)
  ) / instance.shaderScale
  let sourceHeight = (
    destinationHeight * (canvasHeight / baselineHeight)
  ) / instance.shaderScale
  sourceWidth = Math.min(sourceWidth, canvasWidth)
  sourceHeight = Math.min(sourceHeight, canvasHeight)
  const sourceX = Math.max(0, (canvasWidth - sourceWidth) / 2)
  const sourceY = Math.max(0, (canvasHeight - sourceHeight) / 2)

  instance.ctx.clearRect(0, 0, destinationWidth, destinationHeight)
  instance.ctx.globalAlpha = Math.min(1, Math.max(0, instance.opacityMul))
  instance.ctx.drawImage(
    source,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    destinationWidth,
    destinationHeight,
  )
  instance.ctx.globalAlpha = 1
  punchInnerHole(instance)

  if (instance.onFirstCopy) {
    const callback = instance.onFirstCopy
    instance.onFirstCopy = undefined
    callback()
  }
  instance.onAfterFrame?.()
}

function uploadPresetUniforms(
  preset: PresetMode,
  renderKey: RenderKey,
) {
  if (!SHARED) return
  const { gl, uniforms, glCanvas } = SHARED
  if (uniforms.u_resolution) {
    gl.uniform2f(uniforms.u_resolution, glCanvas.width, glCanvas.height)
  }

  for (let index = 0; index < 7; index++) {
    const colorLocation = uniforms[`u_color${index + 1}`]
    const color = preset.colors[index]
    if (colorLocation && color) {
      const [red, green, blue] = hexToRgb(color)
      gl.uniform3f(colorLocation, red, green, blue)
    }

    const alphaLocation = uniforms[`u_alpha${index + 1}`]
    const alpha = preset.alphas[index]
    if (alphaLocation && alpha !== undefined) gl.uniform1f(alphaLocation, alpha)
  }

  if (uniforms.u_intensity) gl.uniform1f(uniforms.u_intensity, preset.intensity)
  if (uniforms.u_scale) gl.uniform1f(uniforms.u_scale, preset.scale)
  if (uniforms.u_direction) {
    gl.uniform1f(uniforms.u_direction, (preset.direction * Math.PI) / 180)
  }
  if (uniforms.u_softness) gl.uniform1f(uniforms.u_softness, preset.softness)
  if (uniforms.u_distortion) {
    gl.uniform1f(uniforms.u_distortion, preset.distortion)
  }
  if (uniforms.u_complexity) {
    gl.uniform1f(uniforms.u_complexity, preset.complexity)
  }
  if (uniforms.u_shape) gl.uniform1f(uniforms.u_shape, preset.shape)
  if (uniforms.u_vignette) gl.uniform1f(uniforms.u_vignette, preset.vignette)
  if (uniforms.u_vigOpacity) {
    gl.uniform1f(uniforms.u_vigOpacity, preset.vigOpacity)
  }
  if (uniforms.u_blur) gl.uniform1f(uniforms.u_blur, preset.blur)
  if (uniforms.u_shaderOpacity) {
    gl.uniform1f(uniforms.u_shaderOpacity, preset.shaderOpacity)
  }
  SHARED.uploadedRenderKey = renderKey
}

function renderSharedFrame(
  now: number,
  renderKey: RenderKey,
  preset: PresetMode,
) {
  if (!SHARED) return
  const { gl, uniforms, glCanvas } = SHARED
  const time = (
    (now - SHARED.startMs - SHARED.pausedMs) / 1000
  ) * preset.speed

  gl.viewport(0, 0, glCanvas.width, glCanvas.height)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)

  if (SHARED.uploadedRenderKey !== renderKey) {
    uploadPresetUniforms(preset, renderKey)
  }
  if (uniforms.u_time) gl.uniform1f(uniforms.u_time, time)
  gl.drawArrays(gl.TRIANGLES, 0, 6)
  SHARED.frameCount++
}

function nextGlowCandidate() {
  if (
    !SHARED
    || !glowCallback
    || SHARED.glowQueue.length === 0
  ) {
    return null
  }

  const queue = SHARED.glowQueue

  // A new/rebuilt glow or changed render key is sampled before the normal
  // throttle. `glowDirty` is deliberately independent from `everCopied`: one
  // shared shader pass may copy several paused canvases, but only one glow is
  // read back per frame. The remaining dirty instances keep the loop alive.
  for (let attempt = 0; attempt < queue.length; attempt++) {
    const index = (SHARED.glowIdx + attempt) % queue.length
    const candidate = queue[index]
    if (candidate?.visible && candidate.glowDirty) {
      SHARED.glowIdx = (index + 1) % queue.length
      return candidate
    }
  }

  if (++SHARED.glowSkip % GLOW_SKIP_FRAMES !== 0) return null

  for (let attempt = 0; attempt < queue.length; attempt++) {
    if (SHARED.glowIdx >= queue.length) SHARED.glowIdx = 0
    const candidate = queue[SHARED.glowIdx]
    SHARED.glowIdx++
    if (candidate?.visible && !candidate.paused) return candidate
  }
  return null
}

let lastFrameMs = 0

function tick(now: number) {
  if (!SHARED) return
  if (SHARED.contextLost) {
    SHARED.rafId = 0
    return
  }

  const groups = new Map<RenderKey, MetalFxInstance[]>()
  for (const instance of SHARED.instances) {
    if (
      !instance.visible
      || (instance.paused && instance.everCopied && !instance.glowDirty)
    ) continue
    const group = groups.get(instance.renderKey)
    if (group) group.push(instance)
    else groups.set(instance.renderKey, [instance])
  }

  if (groups.size === 0) {
    SHARED.rafId = 0
    return
  }

  SHARED.rafId = requestAnimationFrame(tick)
  if (now - lastFrameMs < FRAME_INTERVAL_MS) return
  lastFrameMs = now

  const glowCandidate = nextGlowCandidate()
  const orderedGroups = Array.from(groups.entries())
  if (glowCandidate) {
    const candidateIndex = orderedGroups.findIndex(
      ([renderKey]) => renderKey === glowCandidate.renderKey,
    )
    if (candidateIndex >= 0 && candidateIndex !== orderedGroups.length - 1) {
      const [candidateGroup] = orderedGroups.splice(candidateIndex, 1)
      if (candidateGroup) orderedGroups.push(candidateGroup)
    }
  }

  for (const [renderKey, instances] of orderedGroups) {
    const representative = instances[0]
    if (!representative) continue
    const preset = PRESETS[representative.presetName].modes[
      representative.presetTheme
    ]
    renderSharedFrame(now, renderKey, preset)

    if (glowCandidate?.renderKey === renderKey) {
      captureGlowPixels(renderKey)
    }

    if (SHARED.useOffscreen) {
      SHARED.frameBitmap?.close()
      SHARED.frameBitmap = (
        SHARED.glCanvas as OffscreenCanvas
      ).transferToImageBitmap()
    }

    for (const instance of instances) {
      copyShaderToInstance(instance)
      instance.everCopied = true
    }

    if (SHARED.useOffscreen) {
      SHARED.frameBitmap?.close()
      SHARED.frameBitmap = null
    }
  }

  if (glowCandidate && glowCallback) {
    glowCallback(glowCandidate, now)
    glowCandidate.glowDirty = false
  }
}

function startSharedLoop() {
  if (!SHARED || SHARED.rafId !== 0) return
  SHARED.rafId = requestAnimationFrame(tick)
}

function stopSharedLoop() {
  if (!SHARED) return
  if (SHARED.rafId !== 0) cancelAnimationFrame(SHARED.rafId)
  SHARED.rafId = 0
}
