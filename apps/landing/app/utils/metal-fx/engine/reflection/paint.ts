/** Proximity reflection — public API and per-frame paint loop. */
import { GL_DPR_CAP, REFLECTION_MAX_DEVICE_PIXELS } from '../perfConfig';
import type { MetalFxInstance } from '../renderer/core';
import {
  ATTACH_RANGE_PX,
  BASE_ALPHA,
  BOOST_ALPHA,
  BORDER_HILITE_ALPHA,
  BORDER_HILITE_PX,
  FILL_CIRCLE_ATTENUATION,
  FILL_EXTRA_ALPHA,
  FILL_OPACITY_MUL,
  GLOBAL_ATTENUATION,
  GRAD_FAR,
  GRAD_MID,
  GRAD_NEAR,
  OVERLAP_MIN_PX,
  INTENSITY_MULT,
  MAX_ALPHA_STACK,
  RANGE_PX,
  REF_DRAW_CSS_W,
  REFLECTION_BLOCKED_TAGS,
  STROKE_CSS_PX,
  STROKE_EXTRA_ALPHA,
  type ReflectionTarget,
} from './constants';
import {
  type BoxRect,
  type DrawDst,
  drawBorderHighlight,
  isHorizontalNeighbour,
  isVerticalNeighbour,
  maskedFillPasses,
  maskedStrokePasses,
  shortestRectDistance,
} from './geometry';
import { attachObservers, detachObservers, readCornerRadius, readHairlineSpec } from './observers';

export type { ReflectionTarget } from './constants';

const targets: Set<ReflectionTarget> = new Set();

function styleReflectionLayer(target: ReflectionTarget): void {
  const theme = target.anchor.presetTheme;
  if (target.wrap.dataset.theme === theme) return;

  target.wrap.dataset.theme = theme;
  // Light uses a low-alpha source-over tint: it remains visible on white
  // without the dirty surface shift produced by multiply blending.
  target.canvas.style.opacity = theme === 'light'
    ? 'var(--oe-metal-reflection-fill-light)'
    : 'var(--oe-metal-reflection-fill-dark)';
  target.canvas.style.filter = theme === 'light'
    ? 'blur(var(--oe-metal-reflection-blur)) saturate(1.45) brightness(1.08)'
    : 'blur(var(--oe-metal-reflection-blur)) saturate(1.2) brightness(1.58)';
  target.canvas.style.mixBlendMode = 'normal';
  target.strokeCanvas.style.opacity = theme === 'light'
    ? 'var(--oe-metal-reflection-stroke-light)'
    : 'var(--oe-metal-reflection-stroke-dark)';
  target.strokeCanvas.style.filter = theme === 'light'
    ? 'saturate(1.6) brightness(1.08)'
    : 'saturate(1.35) brightness(1.75)';
  target.strokeCanvas.style.mixBlendMode = 'normal';
}

export function addReflectionTarget(
  el: HTMLElement,
  anchor: MetalFxInstance,
  anchorEl: HTMLElement,
  requestPaint: () => void = () => {},
): ReflectionTarget | null {
  if (typeof document === 'undefined') return null;
  if (REFLECTION_BLOCKED_TAGS.has(el.tagName) || el.isContentEditable) {
    if (import.meta.dev) {
      console.warn(`metal-fx: ${el.tagName.toLowerCase()} cannot be a reflection target; wrap the control in a visible, non-interactive surface.`);
    }
    return null;
  }
  for (const existing of targets) {
    if (existing.el !== el) continue;

    // Reflection targets have one explicit owner. A second accent may not
    // adopt the same host and must never remove the first accent's layer.
    if (existing.anchor !== anchor && import.meta.dev) {
      console.warn('metal-fx: a reflection target already belongs to another OeMetalAccent.');
    }
    return existing.anchor === anchor ? existing : null;
  }

  const wrap = document.createElement('div');
  wrap.setAttribute('data-metal-fx-reflection', '');
  wrap.setAttribute('aria-hidden', 'true');
  Object.assign(wrap.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    borderRadius: 'inherit',
    overflow: 'hidden',
    zIndex: '0',
    isolation: 'isolate',
  });

  const canvas = document.createElement('canvas');
  canvas.className = 'metal-fx-reflection-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    display: 'block',
    pointerEvents: 'none',
  });
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return null;

  const strokeCanvas = document.createElement('canvas');
  strokeCanvas.className = 'metal-fx-reflection-stroke-canvas';
  strokeCanvas.setAttribute('aria-hidden', 'true');
  Object.assign(strokeCanvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    display: 'block',
    pointerEvents: 'none',
  });
  const strokeCtx = strokeCanvas.getContext('2d', { alpha: true });
  if (!strokeCtx) return null;

  wrap.appendChild(canvas);
  wrap.appendChild(strokeCanvas);

  const cs = getComputedStyle(el);
  const previousInlinePosition = el.style.position;
  const previousInlineIsolation = el.style.isolation;
  let appliedPositionRelative = false;
  if (cs.position === 'static') {
    el.style.position = 'relative';
    appliedPositionRelative = true;
  }
  let appliedIsolation = false;
  if (cs.isolation !== 'isolate') {
    el.style.isolation = 'isolate';
    appliedIsolation = true;
  }
  el.setAttribute('data-metal-fx-reflect-host', '');
  el.insertBefore(wrap, el.firstChild);

  const initialSpec = readHairlineSpec(el);
  const target: ReflectionTarget = {
    el,
    anchor,
    anchorEl,
    wrap,
    canvas,
    ctx,
    strokeCanvas,
    strokeCtx,
    cornerRadius: readCornerRadius(el),
    hairlineWidth: initialSpec.width,
    hairlineOuterCssPx: initialSpec.outerCssPx,
    appliedPositionRelative,
    appliedIsolation,
    previousInlinePosition,
    previousInlineIsolation,
    resizeObserver: null,
    mutationObserver: null,
    requestPaint,
  };
  styleReflectionLayer(target);
  attachObservers(target);
  targets.add(target);
  return target;
}

export function removeReflectionTarget(
  el: HTMLElement,
  anchor?: MetalFxInstance,
): boolean {
  for (const target of targets) {
    if (target.el === el) {
      if (anchor && target.anchor !== anchor) return false;
      detachObservers(target);
      target.canvas.width = 0;
      target.canvas.height = 0;
      target.strokeCanvas.width = 0;
      target.strokeCanvas.height = 0;
      if (target.wrap.parentNode === target.el) {
        target.el.removeChild(target.wrap);
      }
      target.el.removeAttribute('data-metal-fx-reflect-host');
      if (target.appliedPositionRelative && target.el.style.position === 'relative') {
        target.el.style.position = target.previousInlinePosition;
      }
      if (target.appliedIsolation && target.el.style.isolation === 'isolate') {
        target.el.style.isolation = target.previousInlineIsolation;
      }
      targets.delete(target);
      return true;
    }
  }
  return false;
}

export function paintReflections(): void {
  if (targets.size === 0) return;
  const preferredDpr = Math.min(
    GL_DPR_CAP,
    typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
  );

  const anchorRects = new Map<HTMLElement, DOMRect>();

  for (const t of [...targets]) {
    if (!t.el.isConnected || !t.anchorEl.isConnected) {
      removeReflectionTarget(t.el, t.anchor);
      continue;
    }

    styleReflectionLayer(t);
    const tRect = t.el.getBoundingClientRect();
    let aRect = anchorRects.get(t.anchorEl);
    if (!aRect) {
      aRect = t.anchorEl.getBoundingClientRect();
      anchorRects.set(t.anchorEl, aRect);
    }
    if (tRect.width < 1 || tRect.height < 1) continue;
    if (aRect.width < 1 || aRect.height < 1) continue;

    if (
      !isHorizontalNeighbour(aRect, tRect, OVERLAP_MIN_PX, ATTACH_RANGE_PX) &&
      !isVerticalNeighbour(aRect, tRect, OVERLAP_MIN_PX, ATTACH_RANGE_PX)
    ) {
      if (t.canvas.width !== 1) { t.canvas.width = 1; t.canvas.height = 1; }
      if (t.strokeCanvas.width !== 1) { t.strokeCanvas.width = 1; t.strokeCanvas.height = 1; }
      continue;
    }

    const anchorCanvas = t.anchor.canvas;
    const sw = anchorCanvas.width | 0;
    const sh = anchorCanvas.height | 0;
    if (sw < 4 || sh < 4) continue;

    const acx = (aRect.left + aRect.right) * 0.5;
    const acy = (aRect.top + aRect.bottom) * 0.5;
    const tcx = (tRect.left + tRect.right) * 0.5;
    const tcy = (tRect.top + tRect.bottom) * 0.5;
    const dx = acx - tcx;
    const dy = acy - tcy;

    const edgeGapH = Math.max(aRect.left - tRect.right, tRect.left - aRect.right, 0);
    const edgeGapV = Math.max(aRect.top - tRect.bottom, tRect.top - aRect.bottom, 0);
    const isHorizontalLayout = edgeGapH >= edgeGapV;

    const dist = shortestRectDistance(aRect, tRect);
    let proximity = 1 - Math.min(1, dist / RANGE_PX);
    proximity = proximity * proximity * (3 - 2 * proximity);
    const intensity = BASE_ALPHA + (BOOST_ALPHA - BASE_ALPHA) * proximity;

    const reflectionAlpha = Math.min(
      MAX_ALPHA_STACK,
      intensity * INTENSITY_MULT * GLOBAL_ATTENUATION
    );

    const overscanCssPx = t.hairlineOuterCssPx;
    t.wrap.style.inset = `${-overscanCssPx}px`;
    t.wrap.style.borderRadius = `${Math.max(0, t.cornerRadius)}px`;

    const targetCssWidth = Math.max(1, tRect.width + overscanCssPx * 2);
    const targetCssHeight = Math.max(1, tRect.height + overscanCssPx * 2);
    const budgetDpr = Math.sqrt(
      REFLECTION_MAX_DEVICE_PIXELS / (targetCssWidth * targetCssHeight),
    );
    const dpr = Math.min(preferredDpr, budgetDpr);

    // Effective scale of the host element. Anything drawn on the reflection
    // canvas (strokes, border-highlight) is in DEVICE pixels, so it doesn't
    // automatically grow when the host is rendered at non-1× layout (CSS
    // zoom: 2, etc.). Multiply absolute-pixel constants by the anchor's
    // scale so the reflection scales together with the metal effect itself.
    const sScale = t.anchor.scale ?? 1;
    const hairlineCssPx = Math.max(STROKE_CSS_PX * sScale, t.hairlineWidth);
    const strokeBandPx = Math.max(1, Math.round(hairlineCssPx * dpr));
    const borderHighlightPx = Math.max(
      1,
      Math.round(Math.max(BORDER_HILITE_PX * sScale, t.hairlineWidth) * dpr)
    );

    const tw = Math.max(1, Math.round((tRect.width + overscanCssPx * 2) * dpr));
    const th = Math.max(1, Math.round((tRect.height + overscanCssPx * 2) * dpr));
    if (t.canvas.width !== tw) t.canvas.width = tw;
    if (t.canvas.height !== th) t.canvas.height = th;
    if (t.strokeCanvas.width !== tw) t.strokeCanvas.width = tw;
    if (t.strokeCanvas.height !== th) t.strokeCanvas.height = th;

    const ctx = t.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, tw, th);
    const strokeCtx = t.strokeCtx;
    strokeCtx.setTransform(1, 0, 0, 1, 0, 0);
    strokeCtx.clearRect(0, 0, tw, th);

    const bandDevPx = Math.min(RANGE_PX * dpr, Math.max(tw, th));
    let g0x: number, g0y: number, g1x: number, g1y: number;
    if (isHorizontalLayout) {
      g0x = dx > 0 ? tw : 0; g1x = dx > 0 ? tw - bandDevPx : bandDevPx;
      g0y = th * 0.5; g1y = th * 0.5;
    } else {
      g0y = dy > 0 ? th : 0; g1y = dy > 0 ? th - bandDevPx : bandDevPx;
      g0x = tw * 0.5; g1x = tw * 0.5;
    }
    const grad = ctx.createLinearGradient(g0x, g0y, g1x, g1y);
    grad.addColorStop(0, `rgba(0,0,0,${GRAD_NEAR})`);
    grad.addColorStop(0.5, `rgba(0,0,0,${GRAD_MID})`);
    grad.addColorStop(1, `rgba(0,0,0,${GRAD_FAR})`);

    const anchorCssW = sw / Math.max(0.1, t.anchor.dpr);
    const refWdpr = Math.max(1, Math.round(REF_DRAW_CSS_W * Math.max(0.1, anchorCssW / 140) * dpr));

    let drawX: number, drawY: number, drawW: number, drawH: number;
    let flipX = false, flipY = false;
    if (isHorizontalLayout) {
      const overlapTop = Math.max(aRect.top, tRect.top);
      const overlapBot = Math.min(aRect.bottom, tRect.bottom);
      flipX = true;
      drawX = dx > 0 ? tw - refWdpr : 0;
      drawY = Math.round((overlapTop - tRect.top + overscanCssPx) * dpr);
      drawW = refWdpr;
      drawH = Math.max(1, Math.round((overlapBot - overlapTop) * dpr));
    } else {
      const overlapLeft = Math.max(aRect.left, tRect.left);
      const overlapRight = Math.min(aRect.right, tRect.right);
      flipY = true;
      drawX = Math.round((overlapLeft - tRect.left + overscanCssPx) * dpr);
      drawY = dy > 0 ? th - refWdpr : 0;
      drawW = Math.max(1, Math.round((overlapRight - overlapLeft) * dpr));
      drawH = refWdpr;
    }
    const drawDst: DrawDst = { x: drawX, y: drawY, w: drawW, h: drawH, flipX, flipY };

    const strokeBox: BoxRect = { x: 0, y: 0, w: tw, h: th, r: Math.max(0, t.cornerRadius * dpr) };

    const fillReflectionAlpha = Math.min(
      MAX_ALPHA_STACK,
      reflectionAlpha * FILL_EXTRA_ALPHA * FILL_OPACITY_MUL * FILL_CIRCLE_ATTENUATION
    );
    maskedFillPasses(ctx, anchorCanvas, sw, sh, tw, th, fillReflectionAlpha, grad, drawDst, strokeBox, dpr);

    maskedStrokePasses(
      strokeCtx, anchorCanvas, sw, sh, tw, th,
      strokeBox, reflectionAlpha, strokeBandPx, grad, STROKE_EXTRA_ALPHA, drawDst
    );

    drawBorderHighlight(
      strokeCtx, strokeBox, borderHighlightPx,
      g0x, g0y, g1x, g1y,
      Math.min(0.85, BORDER_HILITE_ALPHA * reflectionAlpha)
    );

    ctx.globalCompositeOperation = 'source-over';
    strokeCtx.globalCompositeOperation = 'source-over';
  }
}
