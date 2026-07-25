<script setup lang="ts">
import type {
  AcroFormTarget,
  DocumentTemplate,
  PdfAppearance,
  PdfBox,
  PdfCoordinateSpace,
  PdfPageGeometry,
  TemplateBinding,
} from '@openexpert/multiform'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

import {
  targetBoxToVisualCropBox,
  visualCropBoxToTargetBox,
  visualCropSize,
} from '~/utils/multiform-visual-geometry'

type SourceKind = 'registered' | 'generated'
type ResizeHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se'

interface Props {
  templateText: string
  templateId: string
  sourceKind: SourceKind
  pdfUrl: string
}

interface VisualField {
  key: string
  bindingIndex: number
  widgetIndex?: number
  page: number
  canonicalKey: string
  targetKind: 'overlay' | 'acroform'
  fieldType: string
  reviewStatus: string
  visualBox: PdfBox
  appearance?: PdfAppearance
  overridden: boolean
}

interface DragState {
  field: VisualField
  handle: ResizeHandle
  startClientX: number
  startClientY: number
  startBox: PdfBox
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:templateText': [value: string]
}>()

const ACRO_COORDINATE_SPACE: PdfCoordinateSpace = {
  units: 'pt',
  referenceBox: 'media',
  origin: 'bottom-left',
  orientation: 'unrotated',
}

const canvasRef = ref<HTMLCanvasElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const activeTemplate = shallowRef<DocumentTemplate | null>(null)
const templateError = ref('')
const pdfDocument = shallowRef<PDFDocumentProxy | null>(null)
const pdfLoading = ref(false)
const pdfError = ref('')
const pageNumber = ref(1)
const zoom = ref(0.85)
const viewportSize = ref({ width: 0, height: 0 })
const selectedFieldKey = ref('')
const fieldSearch = ref('')
const fieldTypeFilter = ref<'all' | 'text' | 'mark'>('all')
const editEnabled = ref(false)
const showLabels = ref(true)
const visualNotice = ref('')
const dragState = shallowRef<DragState | null>(null)
const draftVisualBox = shallowRef<{ key: string, box: PdfBox } | null>(null)
const undoStack = ref<string[]>([])
const redoStack = ref<string[]>([])
const localPdfUrl = ref('')

let loadingTask: PDFDocumentLoadingTask | null = null
let renderTask: RenderTask | null = null
let renderGeneration = 0

const pages = computed(() => activeTemplate.value?.source.pages ?? [])
const currentPage = computed(() => pages.value.find(page => page.page === pageNumber.value) ?? null)
const naturalPageSize = computed(() => currentPage.value
  ? visualCropSize(currentPage.value)
  : { width: 0, height: 0 })
const scaleX = computed(() => naturalPageSize.value.width > 0
  ? viewportSize.value.width / naturalPageSize.value.width
  : zoom.value)
const scaleY = computed(() => naturalPageSize.value.height > 0
  ? viewportSize.value.height / naturalPageSize.value.height
  : zoom.value)

const allFields = computed<VisualField[]>(() => {
  const template = activeTemplate.value
  if (!template) return []
  const pageMap = new Map(template.source.pages.map(page => [page.page, page]))
  const fields: VisualField[] = []

  template.bindings.forEach((binding, bindingIndex) => {
    const target = binding.target
    if (target.kind === 'overlay' && target.rendererVersion === 2) {
      const page = pageMap.get(target.page)
      if (!page) return
      try {
        fields.push({
          key: `${bindingIndex}:overlay`,
          bindingIndex,
          page: target.page,
          canonicalKey: binding.canonicalKey,
          targetKind: 'overlay' as const,
          fieldType: target.appearance.kind === 'mark' ? target.appearance.role : 'text',
          reviewStatus: binding.reviewStatus ?? 'ready',
          visualBox: targetBoxToVisualCropBox(page, target.box, target.coordinateSpace),
          appearance: target.appearance,
          overridden: false,
        })
      }
      catch {
        return
      }
      return
    }

    if (target.kind !== 'acroform' || !target.expectedWidgets?.length) return
    target.expectedWidgets.forEach((widget) => {
      const override = target.placementOverrides?.find(item => item.widgetIndex === widget.index)
      const pageNumberForWidget = override?.page ?? widget.page
      const page = pageMap.get(pageNumberForWidget)
      if (!page) return
      const box = override?.box ?? sourceWidgetBox(widget.rect, page)
      const coordinateSpace = override?.coordinateSpace ?? ACRO_COORDINATE_SPACE
      try {
        fields.push({
          key: `${bindingIndex}:widget:${widget.index}`,
          bindingIndex,
          widgetIndex: widget.index,
          page: pageNumberForWidget,
          canonicalKey: binding.canonicalKey,
          targetKind: 'acroform' as const,
          fieldType: target.fieldType ?? target.appearance?.kind ?? 'acroform',
          reviewStatus: binding.reviewStatus ?? 'ready',
          visualBox: targetBoxToVisualCropBox(page, box, coordinateSpace),
          appearance: target.appearance,
          overridden: Boolean(override),
        })
      }
      catch {
        return
      }
    })
  })
  return fields
})

const currentPageFields = computed(() => allFields.value.filter(field => field.page === pageNumber.value))
const filteredFields = computed(() => {
  const query = fieldSearch.value.trim().toLocaleLowerCase('pl-PL')
  return allFields.value.filter((field) => {
    const appearanceKind = field.appearance?.kind ?? (field.fieldType === 'checkbox' || field.fieldType === 'radio' ? 'mark' : 'text')
    if (fieldTypeFilter.value !== 'all' && appearanceKind !== fieldTypeFilter.value) return false
    return !query || `${field.canonicalKey} ${field.fieldType}`.toLocaleLowerCase('pl-PL').includes(query)
  })
})
const selectedField = computed(() => allFields.value.find(field => field.key === selectedFieldKey.value) ?? null)
const selectedBinding = computed<TemplateBinding | null>(() => {
  const field = selectedField.value
  return field ? activeTemplate.value?.bindings[field.bindingIndex] ?? null : null
})

const effectivePdfUrl = computed(() => localPdfUrl.value || props.pdfUrl)

watch(() => props.templateText, parseTemplateText, { immediate: true })
watch([pageNumber, zoom], () => { void renderCurrentPage() })
watch(() => [props.templateId, props.sourceKind, props.pdfUrl], () => {
  releaseLocalPdf()
  undoStack.value = []
  redoStack.value = []
  selectedFieldKey.value = ''
  visualNotice.value = ''
  void loadPdf()
})
watch(currentPage, (page) => {
  if (!page || pdfDocument.value) return
  const size = visualCropSize(page)
  viewportSize.value = { width: size.width * zoom.value, height: size.height * zoom.value }
}, { immediate: true })
watch(allFields, (fields) => {
  if (selectedFieldKey.value && fields.some(field => field.key === selectedFieldKey.value)) return
  selectedFieldKey.value = fields.find(field => field.page === pageNumber.value)?.key ?? fields[0]?.key ?? ''
})

onMounted(() => {
  void loadPdf()
})

onBeforeUnmount(() => {
  removeDragListeners()
  renderTask?.cancel()
  void loadingTask?.destroy()
  releaseLocalPdf()
})

function parseTemplateText(text: string) {
  try {
    const parsed = JSON.parse(text) as DocumentTemplate
    if (parsed?.schemaVersion !== 2 || !Array.isArray(parsed.source?.pages) || !Array.isArray(parsed.bindings)) {
      throw new Error('Widok wizualny wymaga kompletnego Template JSON V2.')
    }
    activeTemplate.value = parsed
    templateError.value = ''
    if (!parsed.source.pages.some(page => page.page === pageNumber.value)) {
      pageNumber.value = parsed.source.pages[0]?.page ?? 1
    }
  }
  catch (error) {
    activeTemplate.value = null
    templateError.value = error instanceof Error ? error.message : 'Nie udało się odczytać Template JSON.'
  }
}

function sourceWidgetBox(rect: PdfBox, page: PdfPageGeometry): PdfBox {
  return {
    x: (rect.x - page.mediaBox.x) * page.userUnit,
    y: (rect.y - page.mediaBox.y) * page.userUnit,
    width: rect.width * page.userUnit,
    height: rect.height * page.userUnit,
  }
}

function roundBox(box: PdfBox): PdfBox {
  return {
    x: Number(box.x.toFixed(2)),
    y: Number(box.y.toFixed(2)),
    width: Number(box.width.toFixed(2)),
    height: Number(box.height.toFixed(2)),
  }
}

function cloneTemplate() {
  return activeTemplate.value ? structuredClone(activeTemplate.value) : null
}

function commitTemplate(next: DocumentTemplate, message: string, addToHistory = true) {
  if (addToHistory) {
    undoStack.value.push(props.templateText)
    if (undoStack.value.length > 50) undoStack.value.shift()
    redoStack.value = []
  }
  visualNotice.value = message
  emit('update:templateText', JSON.stringify(next, null, 2))
}

function undo() {
  const previous = undoStack.value.pop()
  if (!previous) return
  redoStack.value.push(props.templateText)
  visualNotice.value = 'Cofnięto ostatnią zmianę wizualną.'
  emit('update:templateText', previous)
}

function redo() {
  const next = redoStack.value.pop()
  if (!next) return
  undoStack.value.push(props.templateText)
  visualNotice.value = 'Ponowiono zmianę wizualną.'
  emit('update:templateText', next)
}

async function loadPdf() {
  const url = effectivePdfUrl.value
  if (!url) {
    pdfDocument.value = null
    pdfError.value = 'Dołącz źródłowy PDF, aby uruchomić wizualną kalibrację tego draftu.'
    return
  }

  pdfLoading.value = true
  pdfError.value = ''
  renderTask?.cancel()
  await loadingTask?.destroy()
  pdfDocument.value = null

  try {
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    const task = pdfjs.getDocument({ url })
    loadingTask = task
    pdfDocument.value = await task.promise
    await nextTick()
    await renderCurrentPage()
  }
  catch (error) {
    pdfError.value = error instanceof Error ? error.message : 'Nie udało się otworzyć źródłowego PDF-u.'
  }
  finally {
    pdfLoading.value = false
  }
}

async function renderCurrentPage() {
  const generation = ++renderGeneration
  const previousRenderTask = renderTask
  renderTask = null
  if (previousRenderTask) {
    previousRenderTask.cancel()
    try {
      await previousRenderTask.promise
    }
    catch {
      // Cancellation is expected when the document, page or zoom changes.
    }
  }
  if (generation !== renderGeneration) return

  const pdf = pdfDocument.value
  const canvas = canvasRef.value
  if (!pdf || !canvas || pageNumber.value < 1 || pageNumber.value > pdf.numPages) return

  try {
    const page = await pdf.getPage(pageNumber.value)
    const viewport = page.getViewport({ scale: zoom.value })
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Przeglądarka nie udostępniła kontekstu Canvas 2D.')

    canvas.width = Math.max(1, Math.floor(viewport.width * dpr))
    canvas.height = Math.max(1, Math.floor(viewport.height * dpr))
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`
    viewportSize.value = { width: viewport.width, height: viewport.height }

    const nextRenderTask = page.render({
      canvas,
      canvasContext: context,
      viewport,
      transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
    })
    renderTask = nextRenderTask
    await nextRenderTask.promise
  }
  catch (error) {
    if (error instanceof Error && /cancel/i.test(error.name)) return
    pdfError.value = error instanceof Error ? error.message : 'Nie udało się wyrenderować strony PDF.'
  }
  finally {
    if (generation === renderGeneration) renderTask = null
  }
}

async function attachPdf(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !activeTemplate.value) return

  pdfLoading.value = true
  pdfError.value = ''
  try {
    const bytes = await file.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
    if (sha256 !== activeTemplate.value.source.sha256) {
      throw new Error('Wybrany PDF ma inny SHA-256 niż źródło zapisane w Template JSON.')
    }
    releaseLocalPdf()
    localPdfUrl.value = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    await loadPdf()
    visualNotice.value = 'Źródłowy PDF został zweryfikowany i dołączony do tej sesji.'
  }
  catch (error) {
    pdfError.value = error instanceof Error ? error.message : 'Nie udało się zweryfikować PDF-u.'
  }
  finally {
    pdfLoading.value = false
  }
}

function releaseLocalPdf() {
  if (!localPdfUrl.value) return
  URL.revokeObjectURL(localPdfUrl.value)
  localPdfUrl.value = ''
}

function chooseField(field: VisualField) {
  selectedFieldKey.value = field.key
  if (pageNumber.value !== field.page) pageNumber.value = field.page
}

function fieldBox(field: VisualField) {
  return draftVisualBox.value?.key === field.key ? draftVisualBox.value.box : field.visualBox
}

function fieldStyle(field: VisualField) {
  const box = fieldBox(field)
  return {
    left: `${box.x * scaleX.value}px`,
    top: `${box.y * scaleY.value}px`,
    width: `${Math.max(4, box.width * scaleX.value)}px`,
    height: `${Math.max(4, box.height * scaleY.value)}px`,
  }
}

function beginDrag(event: PointerEvent, field: VisualField, handle: ResizeHandle) {
  chooseField(field)
  if (!editEnabled.value) return
  event.preventDefault()
  event.stopPropagation()
  dragState.value = {
    field,
    handle,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startBox: { ...fieldBox(field) },
  }
  window.addEventListener('pointermove', handleDragMove)
  window.addEventListener('pointerup', finishDrag, { once: true })
}

function handleDragMove(event: PointerEvent) {
  const drag = dragState.value
  const page = currentPage.value
  if (!drag || !page) return
  const dx = (event.clientX - drag.startClientX) / Math.max(scaleX.value, 0.0001)
  const dy = (event.clientY - drag.startClientY) / Math.max(scaleY.value, 0.0001)
  const start = drag.startBox
  let next = { ...start }

  if (drag.handle === 'move') {
    next.x += dx
    next.y += dy
  }
  else {
    if (drag.handle.includes('w')) {
      next.x += dx
      next.width -= dx
    }
    if (drag.handle.includes('e')) next.width += dx
    if (drag.handle.includes('n')) {
      next.y += dy
      next.height -= dy
    }
    if (drag.handle.includes('s')) next.height += dy
  }

  draftVisualBox.value = {
    key: drag.field.key,
    box: clampVisualBox(next, visualCropSize(page)),
  }
}

function finishDrag() {
  const drag = dragState.value
  const draft = draftVisualBox.value
  removeDragListeners()
  dragState.value = null
  draftVisualBox.value = null
  if (drag && draft?.key === drag.field.key) {
    commitVisualBox(drag.field, draft.box)
  }
}

function removeDragListeners() {
  window.removeEventListener('pointermove', handleDragMove)
  window.removeEventListener('pointerup', finishDrag)
}

function clampVisualBox(box: PdfBox, pageSize: { width: number, height: number }): PdfBox {
  const minimum = 2
  const width = Math.min(Math.max(minimum, box.width), pageSize.width)
  const height = Math.min(Math.max(minimum, box.height), pageSize.height)
  return {
    x: Math.min(Math.max(0, box.x), Math.max(0, pageSize.width - width)),
    y: Math.min(Math.max(0, box.y), Math.max(0, pageSize.height - height)),
    width,
    height,
  }
}

function commitVisualBox(field: VisualField, visualBox: PdfBox, destinationPage = field.page) {
  const next = cloneTemplate()
  const page = next?.source.pages.find(item => item.page === destinationPage)
  const binding = next?.bindings[field.bindingIndex]
  if (!next || !page || !binding) return
  const target = binding.target

  if (target.kind === 'overlay' && target.rendererVersion === 2) {
    target.page = destinationPage
    target.box = roundBox(visualCropBoxToTargetBox(page, visualBox, target.coordinateSpace))
  }
  else if (target.kind === 'acroform' && field.widgetIndex !== undefined) {
    const existing = target.placementOverrides?.find(item => item.widgetIndex === field.widgetIndex)
    const coordinateSpace = existing?.coordinateSpace ?? ACRO_COORDINATE_SPACE
    const override = {
      widgetIndex: field.widgetIndex,
      page: destinationPage,
      box: roundBox(visualCropBoxToTargetBox(page, visualBox, coordinateSpace)),
      coordinateSpace,
    }
    target.placementOverrides = [
      ...(target.placementOverrides ?? []).filter(item => item.widgetIndex !== field.widgetIndex),
      override,
    ].sort((a, b) => a.widgetIndex - b.widgetIndex)
  }
  else return

  commitTemplate(next, `Zmieniono położenie pola ${field.canonicalKey}.`)
}

function updateSelectedBoxPart(part: keyof PdfBox, event: Event) {
  const field = selectedField.value
  const page = currentPage.value
  if (!field || !page) return
  const number = Number((event.currentTarget as HTMLInputElement).value)
  if (!Number.isFinite(number)) return
  const next = clampVisualBox({ ...field.visualBox, [part]: number }, visualCropSize(page))
  commitVisualBox(field, next)
}

function updateSelectedPage(event: Event) {
  const field = selectedField.value
  const nextPageNumber = Number((event.currentTarget as HTMLSelectElement).value)
  const page = pages.value.find(item => item.page === nextPageNumber)
  if (!field || !page) return
  const clamped = clampVisualBox(field.visualBox, visualCropSize(page))
  commitVisualBox(field, clamped, nextPageNumber)
  pageNumber.value = nextPageNumber
}

function updateAppearance(property: string, event: Event) {
  const field = selectedField.value
  const next = cloneTemplate()
  const binding = field ? next?.bindings[field.bindingIndex] : null
  if (!field || !next || !binding || !('appearance' in binding.target) || !binding.target.appearance) return
  const appearance = binding.target.appearance
  const element = event.currentTarget as HTMLInputElement | HTMLSelectElement

  if (appearance.kind === 'text') {
    if (property === 'horizontalAlign' && ['left', 'center', 'right'].includes(element.value)) {
      appearance.horizontalAlign = element.value as 'left' | 'center' | 'right'
    }
    else if (property === 'verticalAlign' && ['top', 'middle', 'bottom'].includes(element.value)) {
      appearance.verticalAlign = element.value as 'top' | 'middle' | 'bottom'
    }
    else if (property === 'fontSizePt' || property === 'letterSpacingPt' || property === 'lineHeightPt') {
      const value = Number(element.value)
      if (!Number.isFinite(value) || property !== 'letterSpacingPt' && value <= 0) return
      appearance[property] = Number(value.toFixed(2))
    }
  }
  else if (property === 'glyph' && ['x', 'check', 'dot', 'fill'].includes(element.value)) {
    appearance.glyph = element.value as 'x' | 'check' | 'dot' | 'fill'
  }

  commitTemplate(next, `Zmieniono wygląd pola ${field.canonicalKey}.`)
}

function resetSelectedAcroPlacement() {
  const field = selectedField.value
  const next = cloneTemplate()
  const binding = field ? next?.bindings[field.bindingIndex] : null
  if (!field || field.widgetIndex === undefined || !next || !binding || binding.target.kind !== 'acroform') return
  binding.target.placementOverrides = binding.target.placementOverrides?.filter(item => item.widgetIndex !== field.widgetIndex)
  if (!binding.target.placementOverrides?.length) delete binding.target.placementOverrides
  commitTemplate(next, `Przywrócono źródłową pozycję widgetu ${field.canonicalKey}.`)
}

function handleFieldKeydown(event: KeyboardEvent, field: VisualField) {
  if (!editEnabled.value || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  const step = event.shiftKey ? 5 : 0.5
  const delta = {
    x: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
    y: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0,
  }
  const page = pages.value.find(item => item.page === field.page)
  if (!page) return
  commitVisualBox(field, clampVisualBox({
    ...field.visualBox,
    x: field.visualBox.x + delta.x,
    y: field.visualBox.y + delta.y,
  }, visualCropSize(page)))
}

function displayLabel(canonicalKey: string) {
  const parts = canonicalKey.split('.')
  return parts.slice(-2).join('.')
}

function fieldKindLabel(field: VisualField) {
  if (field.appearance?.kind === 'mark') return field.appearance.role === 'radio' ? 'Radio' : 'Checkbox'
  return field.targetKind === 'acroform' ? 'AcroForm' : 'Tekst'
}
</script>

<template>
  <div class="visual-editor">
    <div class="visual-toolbar">
      <div class="visual-toolbar__group">
        <button type="button" class="tool-button" :class="{ 'tool-button--active': editEnabled }" @click="editEnabled = !editEnabled">
          {{ editEnabled ? 'Edycja pozycji włączona' : 'Edytuj pozycje' }}
        </button>
        <button type="button" class="tool-button" :disabled="!undoStack.length" @click="undo">Cofnij</button>
        <button type="button" class="tool-button" :disabled="!redoStack.length" @click="redo">Ponów</button>
      </div>
      <div class="visual-toolbar__group">
        <label class="toolbar-check"><input v-model="showLabels" type="checkbox"> Etykiety</label>
        <label class="zoom-control">Zoom
          <select v-model.number="zoom">
            <option :value="0.65">65%</option>
            <option :value="0.85">85%</option>
            <option :value="1">100%</option>
            <option :value="1.25">125%</option>
            <option :value="1.5">150%</option>
          </select>
        </label>
      </div>
    </div>

    <p v-if="templateError" class="visual-error" role="alert">{{ templateError }}</p>
    <p v-else-if="visualNotice" class="visual-notice" role="status">{{ visualNotice }}</p>

    <div v-if="activeTemplate" class="visual-layout">
      <aside class="field-browser" aria-label="Pola szablonu">
        <div class="pane-heading">
          <span>Pola</span>
          <strong>{{ allFields.length }}</strong>
        </div>
        <label class="field-search">
          <span class="sr-only">Szukaj pola</span>
          <input v-model="fieldSearch" type="search" placeholder="Szukaj canonical key">
        </label>
        <div class="field-filters" aria-label="Filtr typu pola">
          <button type="button" :class="{ active: fieldTypeFilter === 'all' }" @click="fieldTypeFilter = 'all'">Wszystkie</button>
          <button type="button" :class="{ active: fieldTypeFilter === 'text' }" @click="fieldTypeFilter = 'text'">Tekst</button>
          <button type="button" :class="{ active: fieldTypeFilter === 'mark' }" @click="fieldTypeFilter = 'mark'">Markery</button>
        </div>
        <div class="field-list">
          <button
            v-for="field in filteredFields"
            :key="field.key"
            type="button"
            class="field-list-item"
            :class="{ 'field-list-item--selected': field.key === selectedFieldKey }"
            @click="chooseField(field)"
          >
            <span><strong>{{ displayLabel(field.canonicalKey) }}</strong><small>{{ fieldKindLabel(field) }}</small></span>
            <span class="field-page">s. {{ field.page }}</span>
            <span v-if="field.overridden" class="override-dot" title="Pozycja zmieniona ręcznie">M</span>
          </button>
          <p v-if="!filteredFields.length" class="empty-pane">Brak pól pasujących do filtra.</p>
        </div>
      </aside>

      <section class="pdf-pane" aria-label="Podgląd PDF z polami">
        <header class="pdf-pane__header">
          <button type="button" class="page-button" :disabled="pageNumber <= 1" @click="pageNumber--">←</button>
          <label>Strona
            <select v-model.number="pageNumber">
              <option v-for="page in pages" :key="page.page" :value="page.page">{{ page.page }}</option>
            </select>
            <span>/ {{ pages.length }}</span>
          </label>
          <button type="button" class="page-button" :disabled="pageNumber >= pages.length" @click="pageNumber++">→</button>
          <span class="page-field-count">{{ currentPageFields.length }} pól</span>
        </header>

        <div v-if="pdfError" class="pdf-message">
          <strong>Brak podglądu PDF</strong>
          <p>{{ pdfError }}</p>
          <button type="button" class="attach-button" @click="fileInputRef?.click()">Dołącz źródłowy PDF</button>
        </div>
        <div v-else class="stage-scroll" :class="{ 'stage-scroll--editing': editEnabled }">
          <div
            class="page-stage"
            :style="{ width: `${viewportSize.width}px`, height: `${viewportSize.height}px` }"
            @pointerdown.self="selectedFieldKey = ''"
          >
            <canvas ref="canvasRef" class="pdf-canvas" />
            <div class="field-layer" aria-label="Warstwa pól PDF">
              <button
                v-for="field in currentPageFields"
                :key="field.key"
                type="button"
                class="field-box"
                :class="{
                  'field-box--selected': field.key === selectedFieldKey,
                  'field-box--mark': field.appearance?.kind === 'mark',
                  'field-box--acro': field.targetKind === 'acroform',
                  'field-box--override': field.overridden,
                }"
                :style="fieldStyle(field)"
                :aria-label="`Pole ${field.canonicalKey}, strona ${field.page}`"
                :data-field-key="field.canonicalKey"
                @pointerdown="beginDrag($event, field, 'move')"
                @keydown="handleFieldKeydown($event, field)"
              >
                <span v-if="showLabels" class="field-box__label">{{ displayLabel(field.canonicalKey) }}</span>
                <template v-if="field.key === selectedFieldKey && editEnabled">
                  <span v-for="handle in (['nw', 'ne', 'sw', 'se'] as const)" :key="handle" class="resize-handle" :class="`resize-handle--${handle}`" @pointerdown="beginDrag($event, field, handle)" />
                </template>
              </button>
            </div>
            <div v-if="pdfLoading" class="canvas-loading"><span /> Renderuję PDF…</div>
          </div>
        </div>
        <input ref="fileInputRef" class="sr-only" type="file" accept="application/pdf,.pdf" @change="attachPdf">
      </section>

      <aside class="property-pane" aria-label="Właściwości pola">
        <template v-if="selectedField && selectedBinding">
          <div class="pane-heading">
            <span>Właściwości</span>
            <strong>{{ selectedField.targetKind === 'acroform' ? 'Acro' : 'V2' }}</strong>
          </div>
          <div class="property-title">
            <strong>{{ selectedField.canonicalKey }}</strong>
            <span>{{ fieldKindLabel(selectedField) }} · {{ selectedField.reviewStatus }}</span>
          </div>

          <fieldset :disabled="!editEnabled">
            <legend>Pozycja wizualna · pt</legend>
            <label>Strona
              <select :value="selectedField.page" @change="updateSelectedPage">
                <option v-for="page in pages" :key="page.page" :value="page.page">{{ page.page }}</option>
              </select>
            </label>
            <div class="number-grid">
              <label>X<input type="number" step="0.5" :value="roundBox(selectedField.visualBox).x" @change="updateSelectedBoxPart('x', $event)"></label>
              <label>Y<input type="number" step="0.5" :value="roundBox(selectedField.visualBox).y" @change="updateSelectedBoxPart('y', $event)"></label>
              <label>Szer.<input type="number" min="2" step="0.5" :value="roundBox(selectedField.visualBox).width" @change="updateSelectedBoxPart('width', $event)"></label>
              <label>Wys.<input type="number" min="2" step="0.5" :value="roundBox(selectedField.visualBox).height" @change="updateSelectedBoxPart('height', $event)"></label>
            </div>
          </fieldset>

          <fieldset v-if="selectedField.appearance?.kind === 'text'" :disabled="!editEnabled">
            <legend>Tekst</legend>
            <div class="number-grid">
              <label>Font pt<input type="number" min="1" step="0.25" :value="selectedField.appearance.fontSizePt" @change="updateAppearance('fontSizePt', $event)"></label>
              <label>Tracking<input type="number" step="0.1" :value="selectedField.appearance.letterSpacingPt" @change="updateAppearance('letterSpacingPt', $event)"></label>
              <label>Line height<input type="number" min="1" step="0.25" :value="selectedField.appearance.lineHeightPt" @change="updateAppearance('lineHeightPt', $event)"></label>
            </div>
            <label>Wyrównanie
              <select :value="selectedField.appearance.horizontalAlign" @change="updateAppearance('horizontalAlign', $event)">
                <option value="left">Do lewej</option><option value="center">Środek</option><option value="right">Do prawej</option>
              </select>
            </label>
            <label>W pionie
              <select :value="selectedField.appearance.verticalAlign" @change="updateAppearance('verticalAlign', $event)">
                <option value="top">Góra</option><option value="middle">Środek</option><option value="bottom">Dół</option>
              </select>
            </label>
            <p class="property-hint">{{ selectedField.appearance.distribution.kind === 'comb' ? `${selectedField.appearance.distribution.cells} komórek comb` : `${selectedField.appearance.wrap} · ${selectedField.appearance.overflow}` }}</p>
          </fieldset>

          <fieldset v-else-if="selectedField.appearance?.kind === 'mark'" :disabled="!editEnabled">
            <legend>Checkbox / radio</legend>
            <label>Znak
              <select :value="selectedField.appearance.glyph" @change="updateAppearance('glyph', $event)">
                <option value="x">X</option><option value="check">Check</option><option value="dot">Kropka</option><option value="fill">Wypełnienie</option>
              </select>
            </label>
            <p class="property-hint">Inset {{ selectedField.appearance.insetPt }} pt · stroke {{ selectedField.appearance.strokeWidthPt }} pt</p>
          </fieldset>

          <button v-if="selectedField.targetKind === 'acroform' && selectedField.overridden" type="button" class="reset-placement" :disabled="!editEnabled" @click="resetSelectedAcroPlacement">
            Przywróć pozycję z PDF-u
          </button>
          <p class="keyboard-tip">Strzałki: 0,5 pt · Shift + strzałka: 5 pt</p>
        </template>
        <div v-else class="empty-pane empty-pane--properties">
          <strong>Wybierz pole</strong>
          <p>Kliknij prostokąt na PDF-ie albo pozycję na liście.</p>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.visual-editor { min-height: 640px; background: var(--ui-bg-muted); }
.visual-toolbar { min-height: 45px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 10px; background: var(--ui-bg); border-bottom: 1px solid var(--ui-border); }
.visual-toolbar__group { display: flex; align-items: center; gap: 6px; }
.tool-button,
.page-button,
.attach-button { min-height: 30px; padding: 6px 9px; color: var(--ui-text-toned); background: var(--ui-bg); border: 1px solid var(--ui-border); border-radius: var(--ui-radius); font: inherit; font-size: 10px; cursor: pointer; }
.tool-button:hover:not(:disabled), .page-button:hover:not(:disabled), .attach-button:hover { color: var(--ui-text-highlighted); border-color: var(--ui-border-accented); }
.tool-button--active { color: var(--ui-text-inverted); background: var(--ui-primary); border-color: var(--ui-primary); }
.tool-button:disabled, .page-button:disabled { opacity: .45; cursor: default; }
.toolbar-check,
.zoom-control { display: inline-flex; align-items: center; gap: 6px; color: var(--ui-text-muted); font-family: var(--font-mono); font-size: 9px; }
.zoom-control select,
.pdf-pane__header select { min-height: 29px; color: var(--ui-text-highlighted); background: var(--ui-bg); border: 1px solid var(--ui-border); border-radius: var(--ui-radius); font: inherit; font-size: 10px; }
.visual-error,
.visual-notice { padding: 9px 12px; margin: 0; border-bottom: 1px solid; font-size: 10px; }
.visual-error { color: var(--ui-error); background: color-mix(in srgb, var(--ui-error) 10%, var(--ui-bg)); border-color: color-mix(in srgb, var(--ui-error) 25%, transparent); }
.visual-notice { color: var(--ui-success); background: color-mix(in srgb, var(--ui-success) 10%, var(--ui-bg)); border-color: color-mix(in srgb, var(--ui-success) 25%, transparent); }

.visual-layout { min-width: 880px; display: grid; grid-template-columns: 190px minmax(390px, 1fr) 225px; min-height: 650px; }
.field-browser,
.property-pane { min-width: 0; background: var(--ui-bg); }
.field-browser { border-right: 1px solid var(--ui-border); }
.property-pane { border-left: 1px solid var(--ui-border); }
.pane-heading { min-height: 43px; display: flex; align-items: center; justify-content: space-between; padding: 9px 11px; border-bottom: 1px solid var(--ui-border); }
.pane-heading span { color: var(--ui-text-muted); font-family: var(--font-mono); font-size: 9px; letter-spacing: .08em; text-transform: uppercase; }
.pane-heading strong { padding: 3px 6px; color: var(--ui-primary); background: color-mix(in srgb, var(--ui-primary) 8%, var(--ui-bg)); border-radius: 999px; font-family: var(--font-mono); font-size: 8px; }
.field-search { display: block; padding: 9px; }
.field-search input { width: 100%; height: 34px; padding: 7px 9px; color: var(--ui-text-highlighted); background: var(--ui-bg-muted); border: 1px solid var(--ui-border); border-radius: var(--ui-radius); font: inherit; font-size: 10px; }
.field-filters { display: flex; gap: 4px; padding: 0 9px 9px; }
.field-filters button { padding: 4px 6px; color: var(--ui-text-muted); background: transparent; border: 1px solid var(--ui-border); border-radius: 999px; font: inherit; font-size: 8px; cursor: pointer; }
.field-filters button.active { color: var(--ui-primary); background: color-mix(in srgb, var(--ui-primary) 8%, var(--ui-bg)); border-color: color-mix(in srgb, var(--ui-primary) 35%, transparent); }
.field-list { max-height: 565px; overflow: auto; padding: 0 7px 10px; }
.field-list-item { position: relative; width: 100%; display: flex; align-items: center; gap: 6px; padding: 8px; margin-bottom: 4px; color: var(--ui-text-highlighted); text-align: left; background: transparent; border: 1px solid transparent; border-radius: var(--ui-radius); font: inherit; cursor: pointer; }
.field-list-item:hover { background: var(--ui-bg-muted); border-color: var(--ui-border); }
.field-list-item--selected { background: color-mix(in srgb, var(--ui-primary) 8%, var(--ui-bg)); border-color: color-mix(in srgb, var(--ui-primary) 35%, transparent); }
.field-list-item > span:first-child { min-width: 0; display: grid; gap: 2px; flex: 1; }
.field-list-item strong { overflow: hidden; font-family: var(--font-mono); font-size: 9px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.field-list-item small { color: var(--ui-text-muted); font-size: 8px; }
.field-page { color: var(--ui-text-muted); font-family: var(--font-mono); font-size: 8px; white-space: nowrap; }
.override-dot { width: 17px; height: 17px; display: grid; place-items: center; color: #fff; background: var(--ui-warning); border-radius: 50%; font-family: var(--font-mono); font-size: 7px; }

.pdf-pane { min-width: 0; display: flex; flex-direction: column; background: #dce2ea; }
.pdf-pane__header { min-height: 43px; display: flex; align-items: center; justify-content: center; gap: 7px; color: var(--ui-text-toned); background: var(--ui-bg); border-bottom: 1px solid var(--ui-border); font-size: 9px; }
.pdf-pane__header label { display: inline-flex; align-items: center; gap: 5px; }
.page-button { width: 30px; padding: 5px; }
.page-field-count { margin-left: 7px; padding-left: 9px; color: var(--ui-text-muted); border-left: 1px solid var(--ui-border); font-family: var(--font-mono); }
.stage-scroll { min-height: 607px; flex: 1; overflow: auto; padding: 24px; }
.stage-scroll--editing { cursor: crosshair; }
.page-stage { position: relative; margin: 0 auto; background: #fff; box-shadow: 0 10px 28px rgb(15 23 42 / 18%); }
.pdf-canvas { position: absolute; inset: 0; display: block; background: #fff; }
.field-layer { position: absolute; inset: 0; overflow: hidden; }
.field-box { position: absolute; display: block; padding: 0; color: #075985; background: rgb(14 165 233 / 11%); border: 1px solid rgb(2 132 199 / 72%); border-radius: 2px; outline: 0; cursor: pointer; touch-action: none; }
.field-box:hover { background: rgb(14 165 233 / 20%); }
.field-box--acro { color: #5b21b6; background: rgb(139 92 246 / 10%); border-color: rgb(124 58 237 / 68%); }
.field-box--mark { min-width: 8px; min-height: 8px; color: #9a3412; background: rgb(249 115 22 / 15%); border-color: rgb(234 88 12 / 76%); }
.field-box--override { border-style: dashed; }
.field-box--selected { z-index: 2; background: rgb(37 99 235 / 20%); border: 2px solid #2563eb; box-shadow: 0 0 0 2px rgb(255 255 255 / 80%), 0 0 0 4px rgb(37 99 235 / 55%); cursor: move; }
.field-box:focus-visible { box-shadow: 0 0 0 3px #fff, 0 0 0 5px var(--ui-primary); }
.field-box__label { position: absolute; left: -1px; top: -18px; max-width: 180px; overflow: hidden; padding: 2px 4px; color: #fff; background: #075985; border-radius: 2px; font-family: var(--font-mono); font-size: 7px; line-height: 12px; text-overflow: ellipsis; white-space: nowrap; pointer-events: none; }
.field-box--acro .field-box__label { background: #5b21b6; }
.resize-handle { position: absolute; width: 10px; height: 10px; background: #fff; border: 2px solid #2563eb; border-radius: 50%; }
.resize-handle--nw { left: -6px; top: -6px; cursor: nwse-resize; }
.resize-handle--ne { right: -6px; top: -6px; cursor: nesw-resize; }
.resize-handle--sw { left: -6px; bottom: -6px; cursor: nesw-resize; }
.resize-handle--se { right: -6px; bottom: -6px; cursor: nwse-resize; }
.canvas-loading { position: absolute; inset: 0; display: grid; place-content: center; gap: 8px; color: #334155; background: rgb(255 255 255 / 78%); font-size: 10px; }
.canvas-loading span { width: 18px; height: 18px; justify-self: center; border: 2px solid #cbd5e1; border-top-color: #2563eb; border-radius: 50%; animation: visual-spin .7s linear infinite; }
.pdf-message { max-width: 420px; align-self: center; padding: 28px; margin: 70px 20px; color: #334155; text-align: center; background: rgb(255 255 255 / 75%); border: 1px solid #cbd5e1; border-radius: var(--ui-radius); }
.pdf-message strong { display: block; font-size: 13px; }
.pdf-message p { margin: 7px 0 14px; font-size: 10px; line-height: 1.5; }

.property-title { display: grid; gap: 4px; padding: 11px; border-bottom: 1px solid var(--ui-border); }
.property-title strong { overflow-wrap: anywhere; font-family: var(--font-mono); font-size: 9px; line-height: 1.45; }
.property-title span { color: var(--ui-text-muted); font-size: 8px; }
.property-pane fieldset { display: grid; gap: 8px; padding: 11px; margin: 0; border: 0; border-bottom: 1px solid var(--ui-border); }
.property-pane fieldset:disabled { opacity: .58; }
.property-pane legend { float: left; width: 100%; padding: 0 0 8px; color: var(--ui-text-muted); font-family: var(--font-mono); font-size: 8px; letter-spacing: .07em; text-transform: uppercase; }
.property-pane label { display: grid; gap: 4px; color: var(--ui-text-muted); font-size: 8px; }
.property-pane input,
.property-pane select { width: 100%; min-height: 31px; padding: 6px 7px; color: var(--ui-text-highlighted); background: var(--ui-bg-muted); border: 1px solid var(--ui-border); border-radius: var(--ui-radius); font: inherit; font-size: 9px; }
.number-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.property-hint,
.keyboard-tip { margin: 0; color: var(--ui-text-muted); font-size: 8px; line-height: 1.5; }
.reset-placement { width: calc(100% - 22px); padding: 8px; margin: 11px; color: var(--ui-warning); background: color-mix(in srgb, var(--ui-warning) 10%, var(--ui-bg)); border: 1px solid color-mix(in srgb, var(--ui-warning) 30%, transparent); border-radius: var(--ui-radius); font: inherit; font-size: 9px; cursor: pointer; }
.reset-placement:disabled { opacity: .5; cursor: default; }
.keyboard-tip { padding: 0 11px 11px; }
.empty-pane { padding: 16px 10px; margin: 0; color: var(--ui-text-muted); font-size: 9px; line-height: 1.5; }
.empty-pane--properties { padding: 24px 14px; text-align: center; }
.empty-pane--properties strong { display: block; margin-bottom: 5px; color: var(--ui-text-highlighted); font-size: 11px; }
.empty-pane--properties p { margin: 0; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; padding: 0; margin: -1px; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@keyframes visual-spin { to { transform: rotate(360deg); } }

@media (max-width: 1000px) {
  .visual-layout { min-width: 760px; grid-template-columns: 170px minmax(350px, 1fr) 205px; }
}

@media (prefers-reduced-motion: reduce) {
  .canvas-loading span { animation-duration: 1.8s; }
}
</style>
