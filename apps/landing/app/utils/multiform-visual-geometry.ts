import type { PdfBox, PdfCoordinateSpace, PdfPageGeometry } from '@openexpert/multiform'

interface Point {
  x: number
  y: number
}

export interface VisualCropSize {
  width: number
  height: number
}

const RIGHT_ANGLES = new Set([0, 90, 180, 270])

function cleanNumber(value: number) {
  const cleaned = Number(value.toFixed(9))
  return Object.is(cleaned, -0) ? 0 : cleaned
}

function cleanBox(box: PdfBox): PdfBox {
  return {
    x: cleanNumber(box.x),
    y: cleanNumber(box.y),
    width: cleanNumber(box.width),
    height: cleanNumber(box.height),
  }
}

function assertFiniteBox(box: PdfBox, label: string) {
  if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) {
    throw new Error(`${label} musi zawierać skończone współrzędne.`)
  }
  if (!(box.width > 0) || !(box.height > 0)) {
    throw new Error(`${label} musi mieć dodatnią szerokość i wysokość.`)
  }
}

function assertPageGeometry(page: PdfPageGeometry) {
  assertFiniteBox(page.mediaBox, 'MediaBox')
  assertFiniteBox(page.cropBox, 'CropBox')
  if (!RIGHT_ANGLES.has(page.rotation)) {
    throw new Error(`Nieobsługiwany obrót strony PDF: ${page.rotation}°.`)
  }
  if (!Number.isFinite(page.userUnit) || !(page.userUnit > 0)) {
    throw new Error('UserUnit strony PDF musi być dodatnią, skończoną liczbą.')
  }
}

function assertCoordinateSpace(coordinateSpace: PdfCoordinateSpace) {
  if (coordinateSpace.units !== 'pt') {
    throw new Error(`Nieobsługiwana jednostka współrzędnych: ${coordinateSpace.units}.`)
  }
  if (coordinateSpace.referenceBox !== 'crop' && coordinateSpace.referenceBox !== 'media') {
    throw new Error(`Nieobsługiwany referenceBox: ${coordinateSpace.referenceBox}.`)
  }
  if (coordinateSpace.origin !== 'top-left' && coordinateSpace.origin !== 'bottom-left') {
    throw new Error(`Nieobsługiwany origin: ${coordinateSpace.origin}.`)
  }
  if (coordinateSpace.orientation !== 'visual' && coordinateSpace.orientation !== 'unrotated') {
    throw new Error(`Nieobsługiwana orientation: ${coordinateSpace.orientation}.`)
  }
}

function getReferenceBox(page: PdfPageGeometry, coordinateSpace: PdfCoordinateSpace) {
  return coordinateSpace.referenceBox === 'crop' ? page.cropBox : page.mediaBox
}

function visualSizeForBox(
  box: PdfBox,
  userUnit: number,
  rotation: PdfPageGeometry['rotation'],
): VisualCropSize {
  const width = box.width * userUnit
  const height = box.height * userUnit
  return rotation === 90 || rotation === 270
    ? { width: height, height: width }
    : { width, height }
}

function boxCornersFromBottomLeft(box: PdfBox): Point[] {
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x, y: box.y + box.height },
    { x: box.x + box.width, y: box.y + box.height },
  ]
}

function boundingBox(points: readonly Point[]): PdfBox {
  const xs = points.map(point => point.x)
  const ys = points.map(point => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

/**
 * Converts an unrotated PDF user-space point into a bottom-left visual point
 * relative to `referenceBox`. Returned coordinates are physical points.
 */
function rawPointToVisualBottomLeft(
  point: Point,
  referenceBox: PdfBox,
  rotation: PdfPageGeometry['rotation'],
  userUnit: number,
): Point {
  if (rotation === 0) {
    return {
      x: (point.x - referenceBox.x) * userUnit,
      y: (point.y - referenceBox.y) * userUnit,
    }
  }
  if (rotation === 90) {
    return {
      x: (point.y - referenceBox.y) * userUnit,
      y: (referenceBox.x + referenceBox.width - point.x) * userUnit,
    }
  }
  if (rotation === 180) {
    return {
      x: (referenceBox.x + referenceBox.width - point.x) * userUnit,
      y: (referenceBox.y + referenceBox.height - point.y) * userUnit,
    }
  }
  return {
    x: (referenceBox.y + referenceBox.height - point.y) * userUnit,
    y: (point.x - referenceBox.x) * userUnit,
  }
}

/** Inverse of `rawPointToVisualBottomLeft`. */
function visualBottomLeftPointToRaw(
  point: Point,
  referenceBox: PdfBox,
  rotation: PdfPageGeometry['rotation'],
  userUnit: number,
): Point {
  if (rotation === 0) {
    return {
      x: referenceBox.x + point.x / userUnit,
      y: referenceBox.y + point.y / userUnit,
    }
  }
  if (rotation === 90) {
    return {
      x: referenceBox.x + referenceBox.width - point.y / userUnit,
      y: referenceBox.y + point.x / userUnit,
    }
  }
  if (rotation === 180) {
    return {
      x: referenceBox.x + referenceBox.width - point.x / userUnit,
      y: referenceBox.y + referenceBox.height - point.y / userUnit,
    }
  }
  return {
    x: referenceBox.x + point.y / userUnit,
    y: referenceBox.y + referenceBox.height - point.x / userUnit,
  }
}

function targetBottomLeftBox(
  box: PdfBox,
  coordinateSpace: PdfCoordinateSpace,
  referenceSize: VisualCropSize,
): PdfBox {
  if (coordinateSpace.origin === 'bottom-left') return box
  return {
    ...box,
    y: referenceSize.height - box.y - box.height,
  }
}

function boxWithTargetOrigin(
  bottomLeftBox: PdfBox,
  coordinateSpace: PdfCoordinateSpace,
  referenceSize: VisualCropSize,
): PdfBox {
  if (coordinateSpace.origin === 'bottom-left') return bottomLeftBox
  return {
    ...bottomLeftBox,
    y: referenceSize.height - bottomLeftBox.y - bottomLeftBox.height,
  }
}

/**
 * Physical size of the rendered CropBox after applying the page `/Rotate`.
 * This is the natural coordinate extent for a page preview before UI zoom.
 */
export function visualCropSize(page: PdfPageGeometry): VisualCropSize {
  assertPageGeometry(page)
  const size = visualSizeForBox(page.cropBox, page.userUnit, page.rotation)
  return {
    width: cleanNumber(size.width),
    height: cleanNumber(size.height),
  }
}

/**
 * Converts a Template JSON V2 target box to a top-left rectangle relative to
 * the rendered CropBox. All returned values are physical PDF points.
 */
export function targetBoxToVisualCropBox(
  page: PdfPageGeometry,
  box: PdfBox,
  coordinateSpace: PdfCoordinateSpace,
): PdfBox {
  assertPageGeometry(page)
  assertFiniteBox(box, 'Prostokąt targetu')
  assertCoordinateSpace(coordinateSpace)

  const referenceBox = getReferenceBox(page, coordinateSpace)
  const targetRotation = coordinateSpace.orientation === 'visual' ? page.rotation : 0
  const referenceSize = visualSizeForBox(referenceBox, page.userUnit, targetRotation)
  const bottomLeftBox = targetBottomLeftBox(box, coordinateSpace, referenceSize)
  const rawCorners = boxCornersFromBottomLeft(bottomLeftBox).map(point => (
    visualBottomLeftPointToRaw(point, referenceBox, targetRotation, page.userUnit)
  ))
  const cropVisualBox = boundingBox(rawCorners.map(point => (
    rawPointToVisualBottomLeft(point, page.cropBox, page.rotation, page.userUnit)
  )))
  const cropSize = visualCropSize(page)

  return cleanBox({
    ...cropVisualBox,
    y: cropSize.height - cropVisualBox.y - cropVisualBox.height,
  })
}

/**
 * Converts a top-left rectangle from the rendered CropBox preview back into
 * the exact coordinate space used by a Template JSON V2 target.
 */
export function visualCropBoxToTargetBox(
  page: PdfPageGeometry,
  visualBox: PdfBox,
  coordinateSpace: PdfCoordinateSpace,
): PdfBox {
  assertPageGeometry(page)
  assertFiniteBox(visualBox, 'Prostokąt podglądu')
  assertCoordinateSpace(coordinateSpace)

  const cropSize = visualCropSize(page)
  const cropBottomLeftBox = {
    ...visualBox,
    y: cropSize.height - visualBox.y - visualBox.height,
  }
  const rawCorners = boxCornersFromBottomLeft(cropBottomLeftBox).map(point => (
    visualBottomLeftPointToRaw(point, page.cropBox, page.rotation, page.userUnit)
  ))

  const referenceBox = getReferenceBox(page, coordinateSpace)
  const targetRotation = coordinateSpace.orientation === 'visual' ? page.rotation : 0
  const targetBottomLeft = boundingBox(rawCorners.map(point => (
    rawPointToVisualBottomLeft(point, referenceBox, targetRotation, page.userUnit)
  )))
  const referenceSize = visualSizeForBox(referenceBox, page.userUnit, targetRotation)

  return cleanBox(boxWithTargetOrigin(targetBottomLeft, coordinateSpace, referenceSize))
}
