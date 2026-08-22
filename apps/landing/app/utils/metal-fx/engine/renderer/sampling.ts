/**
 * Pixel readback and luminance/colour sampling from the shared GL canvas.
 *
 * The Vue port can render several preset/theme groups through one WebGL
 * program. Each group therefore owns a separate throttled readback cache.
 * Glow sampling never falls back to whichever shader group happened to render
 * last — that would tint one component with another component's preset.
 */
import { GLOW_READBACK_INTERVAL_MS } from '../perfConfig'
import {
  SHARED,
  CANONICAL_PILL_W,
  CANONICAL_PILL_H,
  type GlowFrame,
  type MetalFxInstance,
  type RenderKey,
  type ShaderRGB,
} from './core'

export function captureGlowPixels(renderKey: RenderKey): GlowFrame | null {
  if (!SHARED || SHARED.uploadedRenderKey !== renderKey) return null

  const now = performance.now()
  const { gl, glCanvas } = SHARED
  const width = glCanvas.width
  const height = glCanvas.height
  const current = SHARED.glowFrames.get(renderKey)

  if (
    current
    && current.width === width
    && current.height === height
    && now - current.lastReadbackMs < GLOW_READBACK_INTERVAL_MS
  ) {
    return current
  }

  const frame: GlowFrame = current
    && current.width === width
    && current.height === height
    ? current
    : {
        pixels: new Uint8Array(width * height * 4),
        width,
        height,
        lastReadbackMs: 0,
      }

  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, frame.pixels)
  frame.lastReadbackMs = now
  SHARED.glowFrames.set(renderKey, frame)
  return frame
}

/**
 * Compatibility helper for consumers of the upstream renderer. It captures
 * only the currently uploaded group and is never called implicitly by the
 * sample functions.
 */
export function ensureGlowPixels(renderKey = SHARED?.uploadedRenderKey ?? null) {
  return renderKey ? captureGlowPixels(renderKey) : null
}

const mappedPoint = { x: 0, y: 0 }

function mapToGlowBuffer(
  instance: MetalFxInstance,
  cssPxX: number,
  cssPxY: number,
  frame: GlowFrame,
) {
  const dpr = instance.dpr
  const destinationWidth = instance.cssWidth * dpr
  const destinationHeight = instance.cssHeight * dpr
  const baselineWidth = CANONICAL_PILL_W * dpr
  const baselineHeight = CANONICAL_PILL_H * dpr

  let sourceWidth = (
    destinationWidth * (frame.width / baselineWidth)
  ) / instance.shaderScale
  let sourceHeight = (
    destinationHeight * (frame.height / baselineHeight)
  ) / instance.shaderScale
  sourceWidth = Math.min(sourceWidth, frame.width)
  sourceHeight = Math.min(sourceHeight, frame.height)

  const sourceX = (frame.width - sourceWidth) / 2
  const sourceY = (frame.height - sourceHeight) / 2
  const glX = sourceX + (cssPxX / instance.cssWidth) * sourceWidth
  const glY = sourceY + (cssPxY / instance.cssHeight) * sourceHeight

  mappedPoint.x = Math.round(glX)
  mappedPoint.y = Math.round(frame.height - 1 - glY)
  return mappedPoint
}

const sampledRegion = { r: 0, g: 0, b: 0, luminance: 0, count: 0 }

function sampleRegion(
  frame: GlowFrame,
  centerX: number,
  centerY: number,
  radius: number,
) {
  const sampleRadius = Math.max(1, radius | 0)
  const startX = Math.max(0, centerX - sampleRadius)
  const endX = Math.min(frame.width, centerX + sampleRadius + 1)
  const startY = Math.max(0, centerY - sampleRadius)
  const endY = Math.min(frame.height, centerY + sampleRadius + 1)

  sampledRegion.r = 0
  sampledRegion.g = 0
  sampledRegion.b = 0
  sampledRegion.luminance = 0
  sampledRegion.count = 0

  for (let y = startY; y < endY; y++) {
    const row = y * frame.width
    for (let x = startX; x < endX; x++) {
      const index = (row + x) * 4
      const red = frame.pixels[index] ?? 0
      const green = frame.pixels[index + 1] ?? 0
      const blue = frame.pixels[index + 2] ?? 0
      sampledRegion.r += red
      sampledRegion.g += green
      sampledRegion.b += blue
      sampledRegion.luminance += (
        0.2126 * red + 0.7152 * green + 0.0722 * blue
      ) / 255
      sampledRegion.count++
    }
  }

  return sampledRegion
}

function getFrame(instance: MetalFxInstance) {
  return SHARED?.glowFrames.get(instance.renderKey) ?? null
}

const sampledColor: ShaderRGB = { r: 255, g: 255, b: 255 }

export function sampleShaderLumAt(
  instance: MetalFxInstance,
  cssPxX: number,
  cssPxY: number,
  radius: number,
) {
  const frame = getFrame(instance)
  if (!frame) return 0
  const point = mapToGlowBuffer(instance, cssPxX, cssPxY, frame)
  const sample = sampleRegion(frame, point.x, point.y, radius)
  return sample.count > 0 ? sample.luminance / sample.count : 0
}

export function sampleShaderRGBAt(
  instance: MetalFxInstance,
  cssPxX: number,
  cssPxY: number,
  radius: number,
): ShaderRGB {
  const frame = getFrame(instance)
  if (!frame) {
    sampledColor.r = 255
    sampledColor.g = 255
    sampledColor.b = 255
    return sampledColor
  }

  const point = mapToGlowBuffer(instance, cssPxX, cssPxY, frame)
  const sample = sampleRegion(frame, point.x, point.y, radius)
  if (sample.count === 0) {
    sampledColor.r = 255
    sampledColor.g = 255
    sampledColor.b = 255
    return sampledColor
  }

  sampledColor.r = sample.r / sample.count
  sampledColor.g = sample.g / sample.count
  sampledColor.b = sample.b / sample.count
  return sampledColor
}

export function sampleShaderRGBChromatic(
  instance: MetalFxInstance,
  cssPxX: number,
  cssPxY: number,
  radius: number,
): ShaderRGB {
  const frame = getFrame(instance)
  if (!frame) {
    sampledColor.r = 255
    sampledColor.g = 255
    sampledColor.b = 255
    return sampledColor
  }

  const point = mapToGlowBuffer(instance, cssPxX, cssPxY, frame)
  const sampleRadius = Math.max(1, radius | 0)
  const startX = Math.max(0, point.x - sampleRadius)
  const endX = Math.min(frame.width, point.x + sampleRadius + 1)
  const startY = Math.max(0, point.y - sampleRadius)
  const endY = Math.min(frame.height, point.y + sampleRadius + 1)
  let bestScore = -1

  sampledColor.r = 255
  sampledColor.g = 255
  sampledColor.b = 255

  for (let y = startY; y < endY; y++) {
    const row = y * frame.width
    for (let x = startX; x < endX; x++) {
      const index = (row + x) * 4
      const red = frame.pixels[index] ?? 0
      const green = frame.pixels[index + 1] ?? 0
      const blue = frame.pixels[index + 2] ?? 0
      const maximum = Math.max(red, green, blue)
      const minimum = Math.min(red, green, blue)
      const saturation = maximum > 0 ? (maximum - minimum) / maximum : 0
      const score = saturation * (0.35 + 0.65 * (maximum / 255))
      if (score > bestScore) {
        bestScore = score
        sampledColor.r = red
        sampledColor.g = green
        sampledColor.b = blue
      }
    }
  }

  return sampledColor
}
