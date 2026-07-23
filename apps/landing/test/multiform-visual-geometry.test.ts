import assert from 'node:assert/strict'
import test from 'node:test'

import type { PdfBox, PdfCoordinateSpace, PdfPageGeometry } from '@openexpert/multiform'

import {
  targetBoxToVisualCropBox,
  visualCropBoxToTargetBox,
  visualCropSize,
} from '../app/utils/multiform-visual-geometry.ts'

const basePage: Omit<PdfPageGeometry, 'rotation'> = {
  page: 1,
  mediaBox: { x: -10, y: -20, width: 300, height: 220 },
  cropBox: { x: 20, y: 10, width: 200, height: 120 },
  userUnit: 2,
}

const rotations = [0, 90, 180, 270] as const

function page(rotation: PdfPageGeometry['rotation']): PdfPageGeometry {
  return { ...basePage, rotation }
}

function space(
  overrides: Partial<PdfCoordinateSpace> = {},
): PdfCoordinateSpace {
  return {
    units: 'pt',
    referenceBox: 'crop',
    origin: 'top-left',
    orientation: 'visual',
    ...overrides,
  }
}

function assertBox(actual: PdfBox, expected: PdfBox) {
  const epsilon = 1e-8
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    assert.ok(
      Math.abs(actual[key] - expected[key]) <= epsilon,
      `${key}: expected ${expected[key]}, received ${actual[key]}`,
    )
  }
}

test('visualCropSize applies UserUnit and swaps dimensions for quarter turns', () => {
  assert.deepEqual(visualCropSize(page(0)), { width: 400, height: 240 })
  assert.deepEqual(visualCropSize(page(90)), { width: 240, height: 400 })
  assert.deepEqual(visualCropSize(page(180)), { width: 400, height: 240 })
  assert.deepEqual(visualCropSize(page(270)), { width: 240, height: 400 })
})

test('visual CropBox top-left target coordinates are preview coordinates for every rotation', () => {
  const box = { x: 24, y: 38, width: 80, height: 26 }
  for (const rotation of rotations) {
    const geometry = page(rotation)
    assertBox(targetBoxToVisualCropBox(geometry, box, space()), box)
    assertBox(visualCropBoxToTargetBox(geometry, box, space()), box)
  }
})

test('bottom-left target origin is converted to preview top-left', () => {
  const target = { x: 24, y: 38, width: 80, height: 26 }
  for (const rotation of rotations) {
    const geometry = page(rotation)
    const size = visualCropSize(geometry)
    const expected = {
      ...target,
      y: size.height - target.y - target.height,
    }
    const coordinateSpace = space({ origin: 'bottom-left' })
    assertBox(targetBoxToVisualCropBox(geometry, target, coordinateSpace), expected)
    assertBox(visualCropBoxToTargetBox(geometry, expected, coordinateSpace), target)
  }
})

test('unrotated MediaBox targets map correctly into the rotated rendered CropBox', () => {
  const target = { x: 80, y: 60, width: 40, height: 20 }
  const coordinateSpace = space({
    referenceBox: 'media',
    origin: 'bottom-left',
    orientation: 'unrotated',
  })
  const expectedByRotation: Record<PdfPageGeometry['rotation'], PdfBox> = {
    0: { x: 20, y: 220, width: 40, height: 20 },
    90: { x: 0, y: 20, width: 20, height: 40 },
    180: { x: 340, y: 0, width: 40, height: 20 },
    270: { x: 220, y: 340, width: 20, height: 40 },
  }

  for (const rotation of rotations) {
    const geometry = page(rotation)
    const visual = targetBoxToVisualCropBox(geometry, target, coordinateSpace)
    assertBox(visual, expectedByRotation[rotation])
    assertBox(visualCropBoxToTargetBox(geometry, visual, coordinateSpace), target)
  }
})

test('visual MediaBox targets account for the rotated CropBox offset', () => {
  const cropLocalBox = { x: 10, y: 15, width: 20, height: 25 }
  const coordinateSpace = space({ referenceBox: 'media' })
  const cropOffsetByRotation: Record<PdfPageGeometry['rotation'], { x: number, y: number }> = {
    0: { x: 60, y: 140 },
    90: { x: 60, y: 60 },
    180: { x: 140, y: 60 },
    270: { x: 140, y: 140 },
  }

  for (const rotation of rotations) {
    const geometry = page(rotation)
    const offset = cropOffsetByRotation[rotation]
    const mediaTarget = {
      ...cropLocalBox,
      x: cropLocalBox.x + offset.x,
      y: cropLocalBox.y + offset.y,
    }
    assertBox(targetBoxToVisualCropBox(geometry, mediaTarget, coordinateSpace), cropLocalBox)
    assertBox(visualCropBoxToTargetBox(geometry, cropLocalBox, coordinateSpace), mediaTarget)
  }
})

test('every coordinate-space combination round-trips an edited preview box', () => {
  const previewBox = { x: -12.25, y: 31.5, width: 73.75, height: 18.25 }
  for (const rotation of rotations) {
    for (const referenceBox of ['crop', 'media'] as const) {
      for (const origin of ['top-left', 'bottom-left'] as const) {
        for (const orientation of ['visual', 'unrotated'] as const) {
          const coordinateSpace = space({ referenceBox, origin, orientation })
          const target = visualCropBoxToTargetBox(page(rotation), previewBox, coordinateSpace)
          const roundTrip = targetBoxToVisualCropBox(page(rotation), target, coordinateSpace)
          assertBox(roundTrip, previewBox)
        }
      }
    }
  }
})

test('invalid page and box geometry fails with controlled errors', () => {
  assert.throws(
    () => visualCropSize({ ...page(0), userUnit: 0 }),
    /UserUnit/,
  )
  assert.throws(
    () => targetBoxToVisualCropBox(page(0), { x: 0, y: 0, width: 0, height: 10 }, space()),
    /szerokość/,
  )
  assert.throws(
    () => visualCropSize({ ...page(0), rotation: 45 as 0 }),
    /obrót/,
  )
})
