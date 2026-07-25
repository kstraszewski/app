<script setup lang="ts">
import {
  CANONICAL_COMPUTED_BINDINGS,
  CANONICAL_FIELDS,
  type CanonicalComputedBindingDefinition,
  type CanonicalFieldDefinition,
  type AcroFormTarget,
  type DocumentTemplate,
  type PdfAppearance,
  type PdfBox,
  type PdfCoordinateSpace,
  type PdfPageGeometry,
  type TemplateBinding,
  type TemplateBindingSemanticContract,
  type TemplateMappingEvidence,
} from '@openexpert/multiform'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

import {
  addOverlayBinding,
  removeTemplateBinding,
  resetTemplateBindingSemanticContract,
  setTemplateBindingReviewStatus,
  setTemplateBindingSemanticContract,
  snapVisualBoxToReferenceBoxes,
  type OverlayPlacementKind,
  type VisualAlignmentGuide,
  viewportPointToVisualPoint,
} from '~/utils/multiform-template-editor'
import {
  targetBoxToVisualCropBox,
  visualCropBoxToTargetBox,
  visualCropSize,
} from '~/utils/multiform-visual-geometry'
import { apiErrorMessage } from '~/utils/api-error'

type SourceKind = 'registered' | 'generated'
type ResizeHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se'
type FieldBrowserMode = 'mapped' | 'catalog'

interface Props {
  templateText: string
  templateId: string
  sourceKind: SourceKind
  pdfUrl: string
  semanticHintsUrl?: string
  semanticHintsExpectedRevision?: number
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
  mappingEvidence?: TemplateMappingEvidence
}

interface DragState {
  field: VisualField
  handle: ResizeHandle
  pointerId: number
  startClientX: number
  startClientY: number
  startBox: PdfBox
}

interface CatalogItem {
  key: string
  canonicalKey: string
  definition: CanonicalFieldDefinition | CanonicalComputedBindingDefinition
  optionValue?: string
  optionLabel?: string
}

interface CatalogDragState {
  item: CatalogItem
  placementKind: OverlayPlacementKind
}

interface CatalogPointerDragState extends CatalogDragState {
  pointerId: number
  startClientX: number
  startClientY: number
  active: boolean
}

interface EffectiveSemanticContract {
  semanticDescription: string
  semanticRole: string
  aiMappingHints: {
    aliases: readonly string[]
    exclude: readonly string[]
  }
  source: 'catalog' | 'manual' | 'ai'
  rationale?: string
  model?: string
}

interface SemanticHintsResponse {
  schemaVersion: 1
  bindingIndex: number
  canonicalKey: string
  semanticContract: TemplateBindingSemanticContract
  generation: {
    model: string
    page: number
    box: PdfBox
    revision: number
  }
}

interface SemanticAiProposal {
  fieldKey: string
  bindingIndex: number
  contract: TemplateBindingSemanticContract
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

const CANONICAL_DEFINITIONS = CANONICAL_FIELDS as readonly CanonicalFieldDefinition[]
const BINDING_DEFINITIONS = [
  ...CANONICAL_DEFINITIONS,
  ...CANONICAL_COMPUTED_BINDINGS,
] as readonly (CanonicalFieldDefinition | CanonicalComputedBindingDefinition)[]
const DEFINITION_BY_KEY = new Map(BINDING_DEFINITIONS.map(field => [field.canonicalKey, field]))
const GROUP_LABELS: Record<CanonicalFieldDefinition['group'], string> = {
  application: 'Wniosek',
  applicants: 'Wnioskodawcy',
  loan: 'Kredyt',
  investment: 'Inwestycja',
  property: 'Nieruchomość',
}
const ALIGNMENT_SNAP_THRESHOLD_PX = 10

const canvasRef = ref<HTMLCanvasElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const fieldLayerRef = ref<HTMLElement | null>(null)
const semanticDescriptionRef = ref<HTMLTextAreaElement | null>(null)
const semanticRoleRef = ref<HTMLInputElement | null>(null)
const semanticAliasesRef = ref<HTMLTextAreaElement | null>(null)
const semanticExcludeRef = ref<HTMLTextAreaElement | null>(null)
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
const fieldBrowserMode = ref<FieldBrowserMode>('mapped')
const catalogSearch = ref('')
const catalogPlacementKind = ref<OverlayPlacementKind>('text')
const catalogDragState = shallowRef<CatalogDragState | null>(null)
const catalogPointerDragState = shallowRef<CatalogPointerDragState | null>(null)
const catalogDropActive = ref(false)
const suppressCatalogClick = ref(false)
const editEnabled = ref(true)
const showLabels = ref(true)
const visualNotice = ref('')
const visualActionError = ref('')
const dragState = shallowRef<DragState | null>(null)
const draftVisualBox = shallowRef<{ key: string, box: PdfBox } | null>(null)
const alignmentGuides = shallowRef<VisualAlignmentGuide[]>([])
const semanticGeneratingBindingIndex = ref<number | null>(null)
const semanticAiProposal = shallowRef<SemanticAiProposal | null>(null)
const semanticEditorDirty = ref(false)
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
          mappingEvidence: binding.mappingEvidence,
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
          mappingEvidence: binding.mappingEvidence,
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
    const definition = DEFINITION_BY_KEY.get(field.canonicalKey)
    const binding = activeTemplate.value?.bindings[field.bindingIndex]
    const semantic = effectiveSemanticContract(binding, definition)
    const searchable = [
      field.canonicalKey,
      field.fieldType,
      definition?.label,
      semantic?.semanticDescription,
      semantic?.semanticRole,
      ...(semantic?.aiMappingHints.aliases ?? []),
      ...(semantic?.aiMappingHints.exclude ?? []),
    ].filter(Boolean).join(' ').toLocaleLowerCase('pl-PL')
    return !query || searchable.includes(query)
  })
})
const catalogItems = computed<CatalogItem[]>(() => {
  const query = catalogSearch.value.trim().toLocaleLowerCase('pl-PL')
  const items = BINDING_DEFINITIONS.flatMap<CatalogItem>((field) => {
    if (catalogPlacementKind.value === 'text') {
      if (field.type === 'select' || field.type === 'boolean') return []
      return [{
        key: `${field.canonicalKey}:text`,
        canonicalKey: field.canonicalKey,
        definition: field,
      }]
    }
    if ('computed' in field) return []
    if (field.type === 'select') {
      return (field.options ?? []).map(option => ({
        key: `${field.canonicalKey}:${catalogPlacementKind.value}:${option.value}`,
        canonicalKey: field.canonicalKey,
        definition: field,
        optionValue: option.value,
        optionLabel: option.label,
      }))
    }
    if (field.type === 'boolean') {
      return [{
        key: `${field.canonicalKey}:${catalogPlacementKind.value}`,
        canonicalKey: field.canonicalKey,
        definition: field,
      }]
    }
    return []
  })

  if (!query) return items
  return items.filter((item) => {
    const searchable = [
      item.canonicalKey,
      item.definition.label,
      definitionQuestion(item.definition),
      definitionHelpText(item.definition),
      item.definition.semanticDescription,
      item.definition.semanticRole,
      ...item.definition.aiMappingHints.aliases,
      ...item.definition.aiMappingHints.exclude,
      item.optionLabel,
      item.optionValue,
      GROUP_LABELS[item.definition.group],
    ].filter(Boolean).join(' ').toLocaleLowerCase('pl-PL')
    return searchable.includes(query)
  })
})
const selectedField = computed(() => allFields.value.find(field => field.key === selectedFieldKey.value) ?? null)
const selectedBinding = computed<TemplateBinding | null>(() => {
  const field = selectedField.value
  return field ? activeTemplate.value?.bindings[field.bindingIndex] ?? null : null
})
const selectedDefinition = computed(() => (
  selectedField.value
    ? DEFINITION_BY_KEY.get(selectedField.value.canonicalKey) ?? null
    : null
))
const selectedSemanticContract = computed(() => (
  effectiveSemanticContract(selectedBinding.value, selectedDefinition.value)
))
const selectedSemanticGenerating = computed(() => Boolean(
  selectedField.value
  && semanticGeneratingBindingIndex.value === selectedField.value.bindingIndex,
))
const selectedSemanticProposal = computed(() => (
  selectedField.value
  && semanticAiProposal.value?.fieldKey === selectedField.value.key
    ? semanticAiProposal.value
    : null
))

const effectivePdfUrl = computed(() => localPdfUrl.value || props.pdfUrl)
const canPlaceFields = computed(() => Boolean(pdfDocument.value) && !pdfLoading.value && !pdfError.value)

watch(() => props.templateText, (text, previous) => {
  parseTemplateText(text)
  if (previous !== undefined && text !== previous) {
    semanticAiProposal.value = null
    semanticEditorDirty.value = false
  }
}, { immediate: true })
watch(selectedFieldKey, () => {
  semanticAiProposal.value = null
  semanticEditorDirty.value = false
})
watch([pageNumber, zoom], () => {
  cancelDrag()
  void renderCurrentPage()
})
watch(() => [props.templateId, props.sourceKind, props.pdfUrl], () => {
  cancelDrag()
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
  cancelDrag()
  removeCatalogPointerListeners()
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
  visualActionError.value = ''
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

function catalogItemMeta(item: CatalogItem) {
  return item.optionLabel
    ? `${GROUP_LABELS[item.definition.group]} · ${item.optionLabel}`
    : `${GROUP_LABELS[item.definition.group]} · ${item.definition.type}`
}

function defaultVisualBox(
  item: CatalogItem,
  placementKind: OverlayPlacementKind,
  center: { x: number, y: number },
) {
  const page = currentPage.value
  if (!page) return null
  const pageSize = visualCropSize(page)
  const isMarker = placementKind !== 'text'
  const width = isMarker ? 17 : Math.min(180, pageSize.width)
  const height = isMarker ? 17 : item.definition.type === 'textarea' ? 48 : 17
  return clampVisualBox({
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
  }, pageSize)
}

function addCatalogItem(
  item: CatalogItem,
  placementKind: OverlayPlacementKind,
  center: { x: number, y: number },
) {
  if (!canPlaceFields.value) {
    visualNotice.value = ''
    visualActionError.value = 'Poczekaj na poprawne załadowanie źródłowego PDF-u przed dodaniem pola.'
    return
  }
  const template = activeTemplate.value
  const visualBox = defaultVisualBox(item, placementKind, center)
  if (!template || !visualBox) return

  try {
    const result = addOverlayBinding(template, {
      canonicalKey: item.canonicalKey,
      page: pageNumber.value,
      visualBox,
      placementKind,
      conditionEquals: item.optionValue,
    })
    commitTemplate(
      result.template,
      `Dodano ${item.canonicalKey}${item.optionLabel ? ` — ${item.optionLabel}` : ''}. Ustaw pozycję i zatwierdź mapowanie.`,
    )
    selectedFieldKey.value = `${result.bindingIndex}:overlay`
    editEnabled.value = true
  }
  catch (error) {
    visualNotice.value = ''
    visualActionError.value = error instanceof Error ? error.message : 'Nie udało się dodać pola do PDF-u.'
  }
}

function addCatalogItemAtPageCenter(item: CatalogItem) {
  const page = currentPage.value
  if (!page) return
  const pageSize = visualCropSize(page)
  addCatalogItem(item, catalogPlacementKind.value, {
    x: pageSize.width / 2,
    y: pageSize.height / 2,
  })
}

function handleCatalogItemClick(item: CatalogItem) {
  if (suppressCatalogClick.value) {
    suppressCatalogClick.value = false
    return
  }
  addCatalogItemAtPageCenter(item)
}

function beginCatalogPointerDrag(event: PointerEvent, item: CatalogItem) {
  if (!canPlaceFields.value || event.button !== 0) return
  catalogPointerDragState.value = {
    item,
    placementKind: catalogPlacementKind.value,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    active: false,
  }
  window.addEventListener('pointermove', handleCatalogPointerMove)
  window.addEventListener('pointerup', finishCatalogPointerDrag, { once: true })
  window.addEventListener('pointercancel', cancelCatalogPointerDrag, { once: true })
}

function pointInsideElement(clientX: number, clientY: number, element: HTMLElement) {
  const bounds = element.getBoundingClientRect()
  return (
    clientX >= bounds.left
    && clientX <= bounds.right
    && clientY >= bounds.top
    && clientY <= bounds.bottom
  )
}

function handleCatalogPointerMove(event: PointerEvent) {
  const drag = catalogPointerDragState.value
  if (!drag || event.pointerId !== drag.pointerId) return
  if (!drag.active) {
    const distance = Math.hypot(
      event.clientX - drag.startClientX,
      event.clientY - drag.startClientY,
    )
    if (distance < 6) return
    drag.active = true
    catalogDragState.value = {
      item: drag.item,
      placementKind: drag.placementKind,
    }
    suppressCatalogClick.value = true
    editEnabled.value = true
  }

  event.preventDefault()
  const layer = fieldLayerRef.value
  catalogDropActive.value = Boolean(
    layer && pointInsideElement(event.clientX, event.clientY, layer),
  )
}

function finishCatalogPointerDrag(event: PointerEvent) {
  const drag = catalogPointerDragState.value
  const layer = fieldLayerRef.value
  if (
    drag?.active
    && event.pointerId === drag.pointerId
    && layer
    && pointInsideElement(event.clientX, event.clientY, layer)
  ) {
    const bounds = layer.getBoundingClientRect()
    try {
      addCatalogItem(
        drag.item,
        drag.placementKind,
        viewportPointToVisualPoint({
          clientX: event.clientX,
          clientY: event.clientY,
          viewportLeft: bounds.left,
          viewportTop: bounds.top,
          scaleX: scaleX.value,
          scaleY: scaleY.value,
        }),
      )
    }
    catch (error) {
      visualNotice.value = ''
      visualActionError.value = error instanceof Error
        ? error.message
        : 'Nie udało się ustalić pozycji pola.'
    }
  }
  finishCatalogDrag()
  window.setTimeout(() => {
    suppressCatalogClick.value = false
  }, 0)
}

function cancelCatalogPointerDrag() {
  finishCatalogDrag()
  suppressCatalogClick.value = false
}

function beginCatalogDrag(event: DragEvent, item: CatalogItem) {
  if (!canPlaceFields.value) {
    event.preventDefault()
    return
  }
  catalogDragState.value = {
    item,
    placementKind: catalogPlacementKind.value,
  }
  editEnabled.value = true
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('text/plain', item.canonicalKey)
  }
}

function finishCatalogDrag() {
  catalogDragState.value = null
  catalogPointerDragState.value = null
  catalogDropActive.value = false
  removeCatalogPointerListeners()
}

function removeCatalogPointerListeners() {
  window.removeEventListener('pointermove', handleCatalogPointerMove)
  window.removeEventListener('pointerup', finishCatalogPointerDrag)
  window.removeEventListener('pointercancel', cancelCatalogPointerDrag)
}

function handleCatalogDragOver(event: DragEvent) {
  if (!catalogDragState.value) return
  event.preventDefault()
  catalogDropActive.value = true
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function handleCatalogDragLeave(event: DragEvent) {
  const layer = event.currentTarget as HTMLElement
  const relatedTarget = event.relatedTarget
  if (relatedTarget instanceof Node && layer.contains(relatedTarget)) return
  catalogDropActive.value = false
}

function handleCatalogDrop(event: DragEvent) {
  const drag = catalogDragState.value
  if (!drag) return
  event.preventDefault()
  const layer = event.currentTarget as HTMLElement
  const bounds = layer.getBoundingClientRect()
  try {
    addCatalogItem(
      drag.item,
      drag.placementKind,
      viewportPointToVisualPoint({
        clientX: event.clientX,
        clientY: event.clientY,
        viewportLeft: bounds.left,
        viewportTop: bounds.top,
        scaleX: scaleX.value,
        scaleY: scaleY.value,
      }),
    )
  }
  catch (error) {
    visualNotice.value = ''
    visualActionError.value = error instanceof Error ? error.message : 'Nie udało się ustalić pozycji pola.'
  }
  finally {
    finishCatalogDrag()
  }
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

function alignmentGuideStyle(guide: VisualAlignmentGuide) {
  return guide.axis === 'x'
    ? { left: `${guide.position * scaleX.value}px` }
    : { top: `${guide.position * scaleY.value}px` }
}

function boxMatchesGuide(box: PdfBox, guide: VisualAlignmentGuide) {
  const start = guide.axis === 'x' ? box.x : box.y
  const size = guide.axis === 'x' ? box.width : box.height
  return [start, start + size / 2, start + size]
    .some(position => Math.abs(position - guide.position) < 0.01)
}

function beginDrag(event: PointerEvent, field: VisualField, handle: ResizeHandle) {
  chooseField(field)
  if (!editEnabled.value || !canPlaceFields.value || event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  cancelDrag()
  dragState.value = {
    field,
    handle,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startBox: { ...fieldBox(field) },
  }
  alignmentGuides.value = []
  window.addEventListener('pointermove', handleDragMove)
  window.addEventListener('pointerup', finishDrag)
  window.addEventListener('pointercancel', cancelDrag)
}

function handleDragMove(event: PointerEvent) {
  const drag = dragState.value
  const page = currentPage.value
  if (!drag || !page || event.pointerId !== drag.pointerId) return
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

  const pageSize = visualCropSize(page)
  let nextBox = clampVisualBox(next, pageSize)
  alignmentGuides.value = []
  if (drag.handle === 'move' && event.shiftKey) {
    const snapped = snapVisualBoxToReferenceBoxes({
      box: nextBox,
      referenceBoxes: currentPageFields.value
        .filter(field => field.key !== drag.field.key)
        .map(field => field.visualBox),
      thresholdX: ALIGNMENT_SNAP_THRESHOLD_PX / Math.max(scaleX.value, 0.0001),
      thresholdY: ALIGNMENT_SNAP_THRESHOLD_PX / Math.max(scaleY.value, 0.0001),
    })
    nextBox = clampVisualBox(snapped.box, pageSize)
    alignmentGuides.value = snapped.guides.filter(guide => boxMatchesGuide(nextBox, guide))
  }

  draftVisualBox.value = {
    key: drag.field.key,
    box: nextBox,
  }
}

function finishDrag(event?: PointerEvent) {
  const drag = dragState.value
  if (event && drag && event.pointerId !== drag.pointerId) return
  const draft = draftVisualBox.value
  removeDragListeners()
  dragState.value = null
  draftVisualBox.value = null
  alignmentGuides.value = []
  if (drag && draft?.key === drag.field.key) {
    commitVisualBox(drag.field, draft.box)
  }
}

function cancelDrag(event?: PointerEvent) {
  const drag = dragState.value
  if (event && drag && event.pointerId !== drag.pointerId) return
  removeDragListeners()
  dragState.value = null
  draftVisualBox.value = null
  alignmentGuides.value = []
}

function removeDragListeners() {
  window.removeEventListener('pointermove', handleDragMove)
  window.removeEventListener('pointerup', finishDrag)
  window.removeEventListener('pointercancel', cancelDrag)
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

  const invalidated = setTemplateBindingReviewStatus(next, field.bindingIndex, 'needsReview')
  commitTemplate(invalidated, `Zmieniono położenie pola ${field.canonicalKey}. Mapowanie wymaga ponownej weryfikacji.`)
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

  const invalidated = setTemplateBindingReviewStatus(next, field.bindingIndex, 'needsReview')
  commitTemplate(invalidated, `Zmieniono wygląd pola ${field.canonicalKey}. Mapowanie wymaga ponownej weryfikacji.`)
}

function updateReviewStatus(event: Event) {
  const field = selectedField.value
  const template = activeTemplate.value
  const reviewStatus = (event.currentTarget as HTMLSelectElement).value
  if (
    !field
    || !template
    || !canPlaceFields.value
    || !['ready', 'needsReview'].includes(reviewStatus)
  ) return

  try {
    const next = setTemplateBindingReviewStatus(
      template,
      field.bindingIndex,
      reviewStatus as 'ready' | 'needsReview',
    )
    commitTemplate(
      next,
      reviewStatus === 'ready'
        ? `Zatwierdzono mapowanie ${field.canonicalKey}. Pokrycie: ${next.coverage.mappedTargetCount}/${next.coverage.inScopeTargetCount}; kompletność wymaga osobnego audytu targetów.`
        : `Oznaczono mapowanie ${field.canonicalKey} jako wymagające weryfikacji.`,
    )
  }
  catch (error) {
    visualNotice.value = ''
    visualActionError.value = error instanceof Error ? error.message : 'Nie udało się zmienić statusu mapowania.'
  }
}

function resetSelectedAcroPlacement() {
  const field = selectedField.value
  const next = cloneTemplate()
  const binding = field ? next?.bindings[field.bindingIndex] : null
  if (!field || field.widgetIndex === undefined || !next || !binding || binding.target.kind !== 'acroform') return
  binding.target.placementOverrides = binding.target.placementOverrides?.filter(item => item.widgetIndex !== field.widgetIndex)
  if (!binding.target.placementOverrides?.length) delete binding.target.placementOverrides
  const invalidated = setTemplateBindingReviewStatus(next, field.bindingIndex, 'needsReview')
  commitTemplate(invalidated, `Przywrócono źródłową pozycję widgetu ${field.canonicalKey}. Mapowanie wymaga ponownej weryfikacji.`)
}

function removeSelectedMapping() {
  const field = selectedField.value
  const template = activeTemplate.value
  if (!field || !template) return
  try {
    const next = removeTemplateBinding(template, field.bindingIndex)
    commitTemplate(next, `Usunięto mapowanie ${field.canonicalKey}. W razie pomyłki użyj „Cofnij”.`)
    selectedFieldKey.value = ''
  }
  catch (error) {
    visualNotice.value = ''
    visualActionError.value = error instanceof Error ? error.message : 'Nie udało się usunąć mapowania.'
  }
}

function handleFieldKeydown(event: KeyboardEvent, field: VisualField) {
  if (
    !editEnabled.value
    || !canPlaceFields.value
    || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
  ) return
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

function effectiveSemanticContract(
  binding: TemplateBinding | null | undefined,
  definition: CanonicalFieldDefinition | CanonicalComputedBindingDefinition | null | undefined,
): EffectiveSemanticContract | null {
  if (binding?.semanticContract) {
    return {
      ...binding.semanticContract,
      aiMappingHints: {
        aliases: [...binding.semanticContract.aiMappingHints.aliases],
        exclude: [...binding.semanticContract.aiMappingHints.exclude],
      },
    }
  }
  if (!definition) return null
  return {
    semanticDescription: definition.semanticDescription,
    semanticRole: definition.semanticRole,
    aiMappingHints: {
      aliases: [...definition.aiMappingHints.aliases],
      exclude: [...definition.aiMappingHints.exclude],
    },
    source: 'catalog',
  }
}

function semanticSourceLabel(contract: EffectiveSemanticContract | null) {
  if (contract?.source === 'ai') return 'Wygenerowane przez AI'
  if (contract?.source === 'manual') return 'Nadpisane ręcznie'
  return 'Katalog centralny'
}

function semanticHintsText(values: readonly string[]) {
  return values.join('\n')
}

function parseSemanticHints(value: string) {
  return value
    .split(/\r?\n|;/u)
    .map(item => item.replace(/^[•·\-]\s*/u, '').trim())
    .filter(Boolean)
}

function semanticContractForManualEdit(
  current: EffectiveSemanticContract,
): TemplateBindingSemanticContract {
  return {
    semanticDescription: current.semanticDescription,
    semanticRole: current.semanticRole,
    aiMappingHints: {
      aliases: [...current.aiMappingHints.aliases],
      exclude: [...current.aiMappingHints.exclude],
    },
    source: 'manual',
  }
}

function markSemanticEditorDirty() {
  semanticEditorDirty.value = true
  visualActionError.value = ''
}

function applySelectedSemanticEditor() {
  const field = selectedField.value
  const current = selectedSemanticContract.value
  const template = activeTemplate.value
  const descriptionInput = semanticDescriptionRef.value
  const roleInput = semanticRoleRef.value
  const aliasesInput = semanticAliasesRef.value
  const excludeInput = semanticExcludeRef.value
  if (
    !field
    || !current
    || !template
    || !descriptionInput
    || !roleInput
    || !aliasesInput
    || !excludeInput
  ) {
    return
  }

  const contract = semanticContractForManualEdit(current)
  contract.semanticDescription = descriptionInput.value
  contract.semanticRole = roleInput.value
  contract.aiMappingHints.aliases = parseSemanticHints(aliasesInput.value)
  contract.aiMappingHints.exclude = parseSemanticHints(excludeInput.value)

  try {
    commitTemplate(
      setTemplateBindingSemanticContract(template, field.bindingIndex, contract),
      `Zmieniono wskazówki semantyczne pola ${field.canonicalKey}. Mapowanie wymaga ponownej weryfikacji.`,
    )
    semanticEditorDirty.value = false
  }
  catch (error) {
    visualNotice.value = ''
    visualActionError.value = error instanceof Error
      ? error.message
      : 'Nie udało się zmienić kontraktu semantycznego.'
  }
}

function resetSelectedSemanticContract() {
  const field = selectedField.value
  const template = activeTemplate.value
  if (!field || !template) return
  try {
    commitTemplate(
      resetTemplateBindingSemanticContract(template, field.bindingIndex),
      `Przywrócono centralny kontrakt pola ${field.canonicalKey}. Mapowanie wymaga ponownej weryfikacji.`,
    )
    semanticEditorDirty.value = false
  }
  catch (error) {
    visualNotice.value = ''
    visualActionError.value = error instanceof Error
      ? error.message
      : 'Nie udało się przywrócić centralnego kontraktu.'
  }
}

function blobBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Nie udało się zakodować podglądu strony.'))
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      const separator = dataUrl.indexOf(',')
      if (separator < 0) reject(new Error('Nie udało się zakodować podglądu strony.'))
      else resolve(dataUrl.slice(separator + 1))
    }
    reader.readAsDataURL(blob)
  })
}

function canvasJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Przeglądarka nie utworzyła podglądu strony.'))
    }, 'image/jpeg', quality)
  })
}

async function selectedPageImage(field: VisualField) {
  const pdf = pdfDocument.value
  const pageGeometry = pages.value.find(page => page.page === field.page)
  if (!pdf || !pageGeometry) throw new Error('Źródłowy PDF nie jest gotowy do analizy.')

  const naturalSize = visualCropSize(pageGeometry)
  const renderScale = Math.min(
    2.2,
    1_600 / Math.max(naturalSize.width, 1),
    2_300 / Math.max(naturalSize.height, 1),
  )
  const page = await pdf.getPage(field.page)
  const viewport = page.getViewport({ scale: renderScale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(viewport.width))
  canvas.height = Math.max(1, Math.ceil(viewport.height))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Przeglądarka nie udostępniła kontekstu Canvas 2D.')

  const task = page.render({ canvas, canvasContext: context, viewport })
  await task.promise

  const ratioX = canvas.width / naturalSize.width
  const ratioY = canvas.height / naturalSize.height
  const highlighted = {
    x: field.visualBox.x * ratioX,
    y: field.visualBox.y * ratioY,
    width: field.visualBox.width * ratioX,
    height: field.visualBox.height * ratioY,
  }
  const strokeWidth = Math.max(5, Math.min(canvas.width, canvas.height) / 240)
  context.save()
  context.fillStyle = 'rgba(236, 72, 153, 0.16)'
  context.strokeStyle = '#ec4899'
  context.lineWidth = strokeWidth
  context.fillRect(highlighted.x, highlighted.y, highlighted.width, highlighted.height)
  context.strokeRect(highlighted.x, highlighted.y, highlighted.width, highlighted.height)

  const label = 'WYBRANE POLE'
  const fontSize = Math.max(16, Math.round(strokeWidth * 3))
  context.font = `700 ${fontSize}px system-ui, sans-serif`
  const labelWidth = context.measureText(label).width + fontSize
  const labelHeight = fontSize * 1.55
  const labelX = Math.min(
    Math.max(0, highlighted.x),
    Math.max(0, canvas.width - labelWidth),
  )
  const labelY = highlighted.y >= labelHeight + strokeWidth
    ? highlighted.y - labelHeight - strokeWidth
    : Math.min(canvas.height - labelHeight, highlighted.y + highlighted.height + strokeWidth)
  context.fillStyle = '#ec4899'
  context.fillRect(labelX, labelY, labelWidth, labelHeight)
  context.fillStyle = '#fff'
  context.fillText(label, labelX + fontSize / 2, labelY + fontSize * 1.12)
  context.restore()

  let blob = await canvasJpeg(canvas, 0.88)
  if (blob.size > 3 * 1024 * 1024) blob = await canvasJpeg(canvas, 0.68)
  if (blob.size > 3 * 1024 * 1024) {
    throw new Error('Podgląd strony jest zbyt duży do analizy AI.')
  }
  return {
    mediaType: 'image/jpeg' as const,
    base64: await blobBase64(blob),
  }
}

async function generateSelectedSemanticHints() {
  const field = selectedField.value
  const template = activeTemplate.value
  if (
    !field
    || !template
    || !props.semanticHintsUrl
    || semanticGeneratingBindingIndex.value !== null
  ) {
    return
  }

  const submittedText = props.templateText
  const submittedFieldKey = field.key
  const submittedRevision = props.semanticHintsExpectedRevision ?? 0
  semanticAiProposal.value = null
  semanticGeneratingBindingIndex.value = field.bindingIndex
  visualActionError.value = ''
  visualNotice.value = 'Agent AI analizuje stronę i różowo zaznaczone pole…'
  try {
    const image = await selectedPageImage(field)
    const response = await $fetch<SemanticHintsResponse>(props.semanticHintsUrl, {
      method: 'POST',
      body: {
        expectedRevision: submittedRevision,
        template,
        bindingIndex: field.bindingIndex,
        ...(field.widgetIndex !== undefined ? { widgetIndex: field.widgetIndex } : {}),
        selection: {
          page: field.page,
          box: roundBox(field.visualBox),
        },
        image,
      },
    })
    if (
      props.templateText !== submittedText
      || (props.semanticHintsExpectedRevision ?? 0) !== submittedRevision
      || selectedFieldKey.value !== submittedFieldKey
      || response.bindingIndex !== field.bindingIndex
      || response.canonicalKey !== field.canonicalKey
      || response.generation.revision !== submittedRevision
    ) {
      visualNotice.value = ''
      visualActionError.value = 'Pole zmieniło się podczas analizy. Wynik AI został pominięty — uruchom generowanie ponownie.'
      return
    }
    semanticAiProposal.value = {
      fieldKey: submittedFieldKey,
      bindingIndex: field.bindingIndex,
      contract: response.semanticContract,
    }
    visualNotice.value = 'Agent AI przygotował propozycję. Sprawdź ją i zastosuj w inspektorze.'
  }
  catch (error) {
    visualNotice.value = ''
    visualActionError.value = apiErrorMessage(error)
  }
  finally {
    if (semanticGeneratingBindingIndex.value === field.bindingIndex) {
      semanticGeneratingBindingIndex.value = null
    }
  }
}

function applySelectedSemanticProposal() {
  const proposal = selectedSemanticProposal.value
  const template = activeTemplate.value
  const field = selectedField.value
  if (!proposal || !template || !field || proposal.bindingIndex !== field.bindingIndex) return
  try {
    commitTemplate(
      setTemplateBindingSemanticContract(template, field.bindingIndex, proposal.contract),
      `Zastosowano wskazówki AI dla ${field.canonicalKey}. Mapowanie wymaga ponownej weryfikacji.`,
    )
    semanticEditorDirty.value = false
    semanticAiProposal.value = null
  }
  catch (error) {
    visualNotice.value = ''
    visualActionError.value = error instanceof Error
      ? error.message
      : 'Nie udało się zastosować propozycji AI.'
  }
}

function displayLabel(canonicalKey: string) {
  const definition = DEFINITION_BY_KEY.get(canonicalKey)
  if (definition?.collection) return definition.collection.label
  if (definition) return definition.label
  const parts = canonicalKey.split('.')
  return parts.slice(-2).join('.')
}

function collectionBadge(
  definition: CanonicalFieldDefinition | CanonicalComputedBindingDefinition | null | undefined,
) {
  return definition?.collection
    ? `Wnioskodawca ${definition.collection.displayIndex}`
    : ''
}

function definitionQuestion(
  definition: CanonicalFieldDefinition | CanonicalComputedBindingDefinition,
) {
  return 'form' in definition ? definition.form.question : definition.label
}

function definitionHelpText(
  definition: CanonicalFieldDefinition | CanonicalComputedBindingDefinition,
) {
  return 'form' in definition ? definition.form.helpText : undefined
}

function evidenceOriginLabel(evidence: TemplateMappingEvidence) {
  if (evidence.origin === 'ai') return 'Propozycja Agenta AI'
  if (evidence.origin === 'manual') return 'Mapowanie ręczne'
  return 'Mapowanie historyczne'
}

function confidenceLabel(confidence: number | undefined) {
  return confidence === undefined ? '' : `${Math.round(confidence * 100)}%`
}

function fieldKindLabel(field: VisualField) {
  if (field.appearance?.kind === 'mark') return field.appearance.role === 'radio' ? 'Radio' : 'Checkbox'
  return field.targetKind === 'acroform' ? 'AcroForm' : 'Tekst'
}
</script>

<template>
  <div class="visual-editor">
    <header class="visual-toolbar">
      <div class="studio-identity">
        <span class="studio-identity__icon" aria-hidden="true">
          <UIcon name="i-lucide-file-text" />
        </span>
        <span class="studio-identity__copy">
          <strong>Studio mapowania</strong>
          <small>{{ activeTemplate?.source.fileName || 'Szablon PDF' }}</small>
        </span>
      </div>

      <div v-if="$slots['studio-actions']" class="visual-toolbar__page-actions">
        <slot name="studio-actions" />
      </div>

      <div class="visual-toolbar__group">
        <button
          type="button"
          class="tool-button tool-button--mode"
          :class="{ 'tool-button--active': editEnabled }"
          :disabled="!canPlaceFields"
          :title="canPlaceFields ? 'Przytrzymaj Shift podczas przeciągania, aby wyrównać pole' : 'Najpierw załaduj źródłowy PDF'"
          @click="editEnabled = !editEnabled"
        >
          <UIcon name="i-lucide-move" aria-hidden="true" />
          {{ editEnabled ? 'Przeciąganie' : 'Tryb podglądu' }}
        </button>
        <span class="toolbar-divider" aria-hidden="true" />
        <button
          type="button"
          class="tool-button tool-button--icon"
          :disabled="!undoStack.length"
          title="Cofnij"
          aria-label="Cofnij ostatnią zmianę wizualną"
          @click="undo"
        >
          <UIcon name="i-lucide-undo-2" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="tool-button tool-button--icon"
          :disabled="!redoStack.length"
          title="Ponów"
          aria-label="Ponów ostatnią zmianę wizualną"
          @click="redo"
        >
          <UIcon name="i-lucide-redo-2" aria-hidden="true" />
        </button>
      </div>

      <div class="visual-toolbar__group">
        <label class="toolbar-check">
          <input v-model="showLabels" type="checkbox">
          <UIcon name="i-lucide-tags" aria-hidden="true" />
          Etykiety
        </label>
        <label class="zoom-control">
          <UIcon name="i-lucide-search" aria-hidden="true" />
          <span class="sr-only">Powiększenie podglądu</span>
          <select v-model.number="zoom">
            <option :value="0.65">65%</option>
            <option :value="0.85">85%</option>
            <option :value="1">100%</option>
            <option :value="1.25">125%</option>
            <option :value="1.5">150%</option>
          </select>
        </label>
      </div>
    </header>

    <div v-if="!activeTemplate && templateError" class="studio-global-message" role="alert">
      <UIcon name="i-lucide-triangle-alert" aria-hidden="true" />
      <span>{{ templateError }}</span>
    </div>

    <div v-if="activeTemplate" class="visual-layout">
      <aside class="field-browser" aria-label="Pola szablonu">
        <div class="pane-heading">
          <span class="pane-heading__title">
            <UIcon name="i-lucide-layers-3" aria-hidden="true" />
            <span>{{ fieldBrowserMode === 'mapped' ? 'Pola dokumentu' : 'Katalog pól' }}</span>
          </span>
          <strong>{{ fieldBrowserMode === 'mapped' ? allFields.length : catalogItems.length }}</strong>
        </div>
        <div class="browser-tabs" role="tablist" aria-label="Tryb listy pól">
          <button
            type="button"
            role="tab"
            :aria-selected="fieldBrowserMode === 'mapped'"
            :class="{ active: fieldBrowserMode === 'mapped' }"
            @click="fieldBrowserMode = 'mapped'"
          >
            <UIcon name="i-lucide-list-checks" aria-hidden="true" />
            Na dokumencie
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="fieldBrowserMode === 'catalog'"
            :class="{ active: fieldBrowserMode === 'catalog' }"
            @click="fieldBrowserMode = 'catalog'"
          >
            <UIcon name="i-lucide-plus" aria-hidden="true" />
            Dodaj pole
          </button>
        </div>

        <template v-if="fieldBrowserMode === 'mapped'">
          <label class="field-search">
            <span class="sr-only">Szukaj mapowania</span>
            <UIcon name="i-lucide-search" aria-hidden="true" />
            <input v-model="fieldSearch" type="search" placeholder="Szukaj pola lub znaczenia">
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
              <span>
                <span v-if="collectionBadge(DEFINITION_BY_KEY.get(field.canonicalKey))" class="collection-badge">
                  {{ collectionBadge(DEFINITION_BY_KEY.get(field.canonicalKey)) }}
                </span>
                <strong>{{ displayLabel(field.canonicalKey) }}</strong>
                <small>{{ field.canonicalKey }} · {{ fieldKindLabel(field) }}</small>
              </span>
              <span v-if="field.mappingEvidence?.origin === 'ai'" class="mapping-ai-badge">
                AI {{ confidenceLabel(field.mappingEvidence.confidence) }}
              </span>
              <span
                class="review-state"
                :class="{ 'review-state--pending': field.reviewStatus === 'needsReview' }"
                :title="field.reviewStatus === 'needsReview' ? 'Wymaga weryfikacji' : 'Zweryfikowane'"
              >
                <UIcon
                  :name="field.reviewStatus === 'needsReview' ? 'i-lucide-circle-alert' : 'i-lucide-circle-check'"
                  aria-hidden="true"
                />
              </span>
              <span class="field-page">s. {{ field.page }}</span>
              <span v-if="field.overridden" class="override-dot" title="Pozycja zmieniona ręcznie">M</span>
            </button>
            <p v-if="!filteredFields.length" class="empty-pane">Brak pól pasujących do filtra.</p>
          </div>
        </template>

        <template v-else>
          <p v-if="canPlaceFields" class="catalog-hint">
            Przeciągnij pozycję na PDF. Kliknięcie doda ją na środku bieżącej strony.
          </p>
          <p v-else class="catalog-hint catalog-hint--warning">
            Dodawanie jest dostępne po poprawnym załadowaniu źródłowego PDF-u.
          </p>
          <div class="field-filters catalog-kind" aria-label="Typ nowego pola">
            <button type="button" :class="{ active: catalogPlacementKind === 'text' }" @click="catalogPlacementKind = 'text'">Tekst</button>
            <button type="button" :class="{ active: catalogPlacementKind === 'checkbox' }" @click="catalogPlacementKind = 'checkbox'">Checkbox</button>
            <button type="button" :class="{ active: catalogPlacementKind === 'radio' }" @click="catalogPlacementKind = 'radio'">Radio</button>
          </div>
          <label class="field-search">
            <span class="sr-only">Szukaj w katalogu pól</span>
            <UIcon name="i-lucide-search" aria-hidden="true" />
            <input v-model="catalogSearch" type="search" placeholder="Szukaj pola lub opcji">
          </label>
          <div class="field-list catalog-list" data-testid="pdf-field-catalog">
            <button
              v-for="item in catalogItems"
              :key="item.key"
              type="button"
              class="field-list-item catalog-item"
              :disabled="!canPlaceFields"
              :draggable="canPlaceFields"
              :aria-label="`Dodaj ${item.definition.label}${item.optionLabel ? `: ${item.optionLabel}` : ''}`"
              @click="handleCatalogItemClick(item)"
              @pointerdown="beginCatalogPointerDrag($event, item)"
              @dragstart="beginCatalogDrag($event, item)"
              @dragend="finishCatalogDrag"
            >
              <span>
                <span v-if="collectionBadge(item.definition)" class="collection-badge">
                  {{ collectionBadge(item.definition) }}
                </span>
                <strong>{{ item.definition.collection?.label ?? item.definition.label }}</strong>
                <small class="catalog-key">{{ item.canonicalKey }}</small>
                <small>{{ catalogItemMeta(item) }}</small>
                <small class="catalog-semantic">{{ item.definition.semanticDescription }}</small>
              </span>
              <UIcon class="drag-handle" name="i-lucide-grip-vertical" aria-hidden="true" />
            </button>
            <p v-if="!catalogItems.length" class="empty-pane">
              Dla tego typu nie ma pasujących pól. Markery są dostępne dla opcji wyboru i pól logicznych.
            </p>
          </div>
        </template>
      </aside>

      <section class="pdf-pane" aria-label="Podgląd PDF z polami">
        <div v-if="pdfError" class="pdf-message">
          <span class="pdf-message__icon" aria-hidden="true">
            <UIcon name="i-lucide-file-warning" />
          </span>
          <strong>Brak podglądu PDF</strong>
          <p>{{ pdfError }}</p>
          <button type="button" class="attach-button" @click="fileInputRef?.click()">
            <UIcon name="i-lucide-upload" aria-hidden="true" />
            Dołącz źródłowy PDF
          </button>
        </div>
        <div v-else class="stage-scroll" :class="{ 'stage-scroll--editing': editEnabled }">
          <div
            class="page-stage"
            :style="{ width: `${viewportSize.width}px`, height: `${viewportSize.height}px` }"
            @pointerdown.self="selectedFieldKey = ''"
          >
            <canvas ref="canvasRef" class="pdf-canvas" />
            <div
              ref="fieldLayerRef"
              class="field-layer"
              :class="{ 'field-layer--drop-active': catalogDropActive }"
              aria-label="Warstwa pól PDF"
              data-testid="pdf-page-stage"
              @dragover="handleCatalogDragOver"
              @dragleave="handleCatalogDragLeave"
              @drop="handleCatalogDrop"
            >
              <span
                v-for="(guide, index) in alignmentGuides"
                :key="`${guide.axis}:${guide.position}:${index}`"
                class="alignment-guide"
                :class="`alignment-guide--${guide.axis}`"
                :style="alignmentGuideStyle(guide)"
                :data-alignment-axis="guide.axis"
                data-testid="alignment-guide"
                aria-hidden="true"
              />
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
                  'field-box--editing': editEnabled && canPlaceFields,
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

        <div
          v-if="visualActionError"
          class="canvas-toast canvas-toast--error"
          role="alert"
        >
          <UIcon name="i-lucide-circle-alert" aria-hidden="true" />
          <span>{{ visualActionError }}</span>
          <button type="button" aria-label="Zamknij komunikat" @click="visualActionError = ''">
            <UIcon name="i-lucide-x" aria-hidden="true" />
          </button>
        </div>
        <div
          v-else-if="visualNotice"
          class="canvas-toast"
          role="status"
        >
          <UIcon name="i-lucide-info" aria-hidden="true" />
          <span>{{ visualNotice }}</span>
          <button type="button" aria-label="Zamknij komunikat" @click="visualNotice = ''">
            <UIcon name="i-lucide-x" aria-hidden="true" />
          </button>
        </div>
        <input ref="fileInputRef" class="sr-only" type="file" accept="application/pdf,.pdf" @change="attachPdf">
      </section>

      <aside class="property-pane" aria-label="Właściwości pola">
        <div class="pane-heading">
          <span class="pane-heading__title">
            <UIcon name="i-lucide-panel-right" aria-hidden="true" />
            <span>Inspektor</span>
          </span>
          <strong v-if="selectedField">{{ selectedField.targetKind === 'acroform' ? 'Acro' : 'V2' }}</strong>
        </div>

        <div v-if="selectedField && selectedBinding" class="property-scroll">
          <div class="property-title">
            <span v-if="collectionBadge(selectedDefinition)" class="collection-badge">
              {{ collectionBadge(selectedDefinition) }}
            </span>
            <strong>{{ selectedField.canonicalKey }}</strong>
            <span class="property-title__meta">
              {{ fieldKindLabel(selectedField) }}
              <span aria-hidden="true">·</span>
              <span :class="{ 'property-title__pending': selectedField.reviewStatus === 'needsReview' }">
                {{ selectedField.reviewStatus === 'needsReview' ? 'Wymaga weryfikacji' : 'Zweryfikowane' }}
              </span>
            </span>
          </div>

          <section
            v-if="selectedDefinition && selectedSemanticContract"
            class="semantic-contract"
            data-testid="pdf-field-semantic-contract"
          >
            <div class="semantic-contract__heading">
              <span class="property-section-label">Znaczenie pola</span>
              <span
                class="semantic-source-badge"
                :class="`semantic-source-badge--${selectedSemanticContract.source}`"
              >
                {{ semanticSourceLabel(selectedSemanticContract) }}
              </span>
            </div>
            <strong>{{ definitionQuestion(selectedDefinition) }}</strong>
            <p v-if="definitionHelpText(selectedDefinition)" class="semantic-help">
              {{ definitionHelpText(selectedDefinition) }}
            </p>

            <div class="semantic-editor">
              <label>Opis semantyczny
                <textarea
                  ref="semanticDescriptionRef"
                  rows="4"
                  maxlength="2000"
                  :disabled="!editEnabled"
                  :value="selectedSemanticContract.semanticDescription"
                  @input="markSemanticEditorDirty"
                />
              </label>
              <label>Rola techniczna
                <input
                  ref="semanticRoleRef"
                  type="text"
                  maxlength="160"
                  pattern="[A-Za-z0-9]+([._-][A-Za-z0-9]+)*"
                  spellcheck="false"
                  :disabled="!editEnabled"
                  :value="selectedSemanticContract.semanticRole"
                  @input="markSemanticEditorDirty"
                >
              </label>
              <details open>
                <summary>Wskazówki dla Agenta AI</summary>
                <div class="semantic-hints-grid">
                  <label>Aliasy · jeden na linię
                    <textarea
                      ref="semanticAliasesRef"
                      rows="4"
                      maxlength="5000"
                      :disabled="!editEnabled"
                      :value="semanticHintsText(selectedSemanticContract.aiMappingHints.aliases)"
                      @input="markSemanticEditorDirty"
                    />
                  </label>
                  <label>Wyklucz · jeden na linię
                    <textarea
                      ref="semanticExcludeRef"
                      rows="4"
                      maxlength="5000"
                      :disabled="!editEnabled"
                      :value="semanticHintsText(selectedSemanticContract.aiMappingHints.exclude)"
                      @input="markSemanticEditorDirty"
                    />
                  </label>
                </div>
              </details>
            </div>

            <button
              type="button"
              class="semantic-apply"
              :disabled="!editEnabled || !semanticEditorDirty"
              @click="applySelectedSemanticEditor"
            >
              <UIcon name="i-lucide-check" aria-hidden="true" />
              {{ semanticEditorDirty ? 'Zastosuj zmiany' : 'Zmiany zastosowane' }}
            </button>

            <p v-if="selectedSemanticContract.rationale" class="semantic-rationale">
              {{ selectedSemanticContract.rationale }}
            </p>

            <div class="semantic-actions">
              <button
                type="button"
                class="semantic-generate"
                :disabled="!editEnabled || !canPlaceFields || !props.semanticHintsUrl || semanticGeneratingBindingIndex !== null || semanticEditorDirty"
                title="Wyślij stronę z różowo zaznaczonym polem do Agenta AI"
                @click="generateSelectedSemanticHints"
              >
                <UIcon
                  :name="selectedSemanticGenerating ? 'i-lucide-loader-circle' : 'i-lucide-sparkles'"
                  :class="{ 'semantic-spinner': selectedSemanticGenerating }"
                  aria-hidden="true"
                />
                {{ selectedSemanticGenerating ? 'Analizuję stronę…' : 'Wygeneruj z zaznaczenia' }}
              </button>
              <button
                v-if="selectedBinding.semanticContract"
                type="button"
                class="semantic-reset"
                :disabled="!editEnabled || semanticGeneratingBindingIndex !== null"
                @click="resetSelectedSemanticContract"
              >
                <UIcon name="i-lucide-rotate-ccw" aria-hidden="true" />
                Przywróć katalog
              </button>
            </div>

            <article
              v-if="selectedSemanticProposal"
              class="semantic-ai-proposal"
              data-testid="pdf-field-semantic-ai-proposal"
            >
              <header>
                <span><UIcon name="i-lucide-sparkles" aria-hidden="true" /> Propozycja AI</span>
                <small>{{ selectedSemanticProposal.contract.model }}</small>
              </header>
              <p>{{ selectedSemanticProposal.contract.semanticDescription }}</p>
              <dl>
                <div>
                  <dt>Aliasy</dt>
                  <dd>{{ selectedSemanticProposal.contract.aiMappingHints.aliases.join(' · ') || 'Brak' }}</dd>
                </div>
                <div>
                  <dt>Wyklucz</dt>
                  <dd>{{ selectedSemanticProposal.contract.aiMappingHints.exclude.join(' · ') || 'Brak' }}</dd>
                </div>
              </dl>
              <p v-if="selectedSemanticProposal.contract.rationale" class="semantic-ai-proposal__rationale">
                {{ selectedSemanticProposal.contract.rationale }}
              </p>
              <footer>
                <button type="button" class="semantic-proposal-apply" @click="applySelectedSemanticProposal">
                  <UIcon name="i-lucide-check" aria-hidden="true" />
                  Zastosuj
                </button>
                <button type="button" class="semantic-proposal-dismiss" @click="semanticAiProposal = null">
                  Odrzuć
                </button>
              </footer>
            </article>
          </section>

          <section
            v-if="selectedBinding.mappingEvidence"
            class="mapping-evidence"
            data-testid="pdf-field-mapping-evidence"
          >
            <div class="mapping-evidence__heading">
              <span>{{ evidenceOriginLabel(selectedBinding.mappingEvidence) }}</span>
              <strong v-if="selectedBinding.mappingEvidence.confidence !== undefined">
                {{ confidenceLabel(selectedBinding.mappingEvidence.confidence) }}
              </strong>
            </div>
            <p>{{ selectedBinding.mappingEvidence.rationale }}</p>
            <ul v-if="selectedBinding.mappingEvidence.anchors?.length">
              <li v-for="anchor in selectedBinding.mappingEvidence.anchors" :key="anchor.reference">
                <span>s. {{ anchor.page }}</span>
                <q>{{ anchor.text }}</q>
              </li>
            </ul>
          </section>
          <section v-else class="mapping-evidence mapping-evidence--legacy">
            <div class="mapping-evidence__heading">
              <span>Mapowanie historyczne</span>
            </div>
            <p>{{ selectedBinding.notes || 'Brak ustrukturyzowanego dowodu dopasowania. Zatwierdź semantykę i położenie ręcznie.' }}</p>
          </section>

          <fieldset :disabled="!editEnabled || !canPlaceFields">
            <legend>Weryfikacja mapowania</legend>
            <label>Status
              <select :value="selectedField.reviewStatus" @change="updateReviewStatus">
                <option value="needsReview">Wymaga weryfikacji</option>
                <option value="ready">Zweryfikowane</option>
              </select>
            </label>
            <p class="property-hint">
              Nowe pole zwiększy pokrycie dopiero po sprawdzeniu pozycji i oznaczeniu go jako zweryfikowane.
            </p>
          </fieldset>

          <fieldset :disabled="!editEnabled || !canPlaceFields">
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

          <fieldset v-if="selectedField.appearance?.kind === 'text'" :disabled="!editEnabled || !canPlaceFields">
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

          <fieldset v-else-if="selectedField.appearance?.kind === 'mark'" :disabled="!editEnabled || !canPlaceFields">
            <legend>Checkbox / radio</legend>
            <label>Znak
              <select :value="selectedField.appearance.glyph" @change="updateAppearance('glyph', $event)">
                <option value="x">X</option><option value="check">Check</option><option value="dot">Kropka</option><option value="fill">Wypełnienie</option>
              </select>
            </label>
            <p class="property-hint">Inset {{ selectedField.appearance.insetPt }} pt · stroke {{ selectedField.appearance.strokeWidthPt }} pt</p>
          </fieldset>

          <button v-if="selectedField.targetKind === 'acroform' && selectedField.overridden" type="button" class="reset-placement" :disabled="!editEnabled || !canPlaceFields" @click="resetSelectedAcroPlacement">
            <UIcon name="i-lucide-rotate-ccw" aria-hidden="true" />
            Przywróć pozycję z PDF-u
          </button>
          <button type="button" class="remove-mapping" :disabled="!editEnabled" @click="removeSelectedMapping">
            <UIcon name="i-lucide-trash-2" aria-hidden="true" />
            Usuń mapowanie
          </button>
          <p class="keyboard-tip">Przeciągnij + Shift: wyrównaj do pól · Strzałki: 0,5 pt · Shift + strzałka: 5 pt</p>
        </div>
        <div v-else class="empty-pane empty-pane--properties">
          <span class="empty-pane__icon" aria-hidden="true">
            <UIcon name="i-lucide-mouse-pointer-2" />
          </span>
          <strong>Wybierz pole</strong>
          <p>Kliknij prostokąt na PDF-ie albo pozycję na liście.</p>
        </div>
      </aside>
    </div>

    <footer v-if="activeTemplate" class="studio-statusbar" aria-label="Stan edytora">
      <div class="status-group status-group--mapping">
        <span class="status-item">
          <UIcon name="i-lucide-layers-3" aria-hidden="true" />
          <strong>{{ allFields.length }}</strong>
          mapowań
        </span>
        <span class="status-divider" aria-hidden="true" />
        <span
          class="status-item"
          :class="{ 'status-item--warning': allFields.some(field => field.reviewStatus === 'needsReview') }"
        >
          <UIcon
            :name="allFields.some(field => field.reviewStatus === 'needsReview') ? 'i-lucide-circle-alert' : 'i-lucide-circle-check'"
            aria-hidden="true"
          />
          <strong>{{ allFields.filter(field => field.reviewStatus === 'needsReview').length }}</strong>
          do weryfikacji
        </span>
      </div>

      <div class="status-group status-group--page">
        <button
          type="button"
          class="page-button"
          :disabled="pageNumber <= 1"
          title="Poprzednia strona"
          aria-label="Poprzednia strona"
          @click="pageNumber--"
        >
          <UIcon name="i-lucide-chevron-left" aria-hidden="true" />
        </button>
        <label>
          <span>Strona</span>
          <select v-model.number="pageNumber" aria-label="Numer strony">
            <option v-for="page in pages" :key="page.page" :value="page.page">{{ page.page }}</option>
          </select>
          <span>z {{ pages.length }}</span>
        </label>
        <button
          type="button"
          class="page-button"
          :disabled="pageNumber >= pages.length"
          title="Następna strona"
          aria-label="Następna strona"
          @click="pageNumber++"
        >
          <UIcon name="i-lucide-chevron-right" aria-hidden="true" />
        </button>
        <span class="status-divider" aria-hidden="true" />
        <span class="status-item">{{ currentPageFields.length }} pól na stronie</span>
      </div>

      <div class="status-group status-group--selection">
        <span v-if="alignmentGuides.length" class="selection-state selection-state--snap">
          <UIcon name="i-lucide-align-center" aria-hidden="true" />
          Shift · wyrównano
        </span>
        <template v-else-if="selectedField">
          <span
            class="selection-state"
            :class="{ 'selection-state--warning': selectedField.reviewStatus === 'needsReview' }"
          >
            <UIcon
              :name="selectedField.reviewStatus === 'needsReview' ? 'i-lucide-circle-alert' : 'i-lucide-circle-check'"
              aria-hidden="true"
            />
            {{ selectedField.reviewStatus === 'needsReview' ? 'Mapowanie do weryfikacji' : 'Mapowanie zweryfikowane' }}
          </span>
        </template>
        <span v-else class="selection-state selection-state--muted">
          <UIcon name="i-lucide-mouse-pointer-2" aria-hidden="true" />
          Nie wybrano pola
        </span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.visual-editor {
  --studio-left-panel: 280px;
  --studio-right-panel: 340px;
  position: relative;
  min-width: 0;
  min-height: 720px;
  height: clamp(720px, calc(100dvh - 148px), 1080px);
  display: grid;
  grid-template-rows: 56px minmax(0, 1fr) 42px;
  overflow-x: auto;
  overflow-y: hidden;
  color: var(--ui-text);
  background: var(--ui-bg);
  border: 1px solid var(--ui-border);
  border-radius: 0;
  isolation: isolate;
}

.visual-toolbar,
.visual-layout,
.studio-statusbar {
  min-width: 1100px;
}

.visual-toolbar {
  z-index: 4;
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto auto minmax(180px, 1fr);
  align-items: center;
  gap: 16px;
  padding: 8px 12px;
  background: var(--ui-bg);
  border-bottom: 1px solid var(--ui-border);
}

.studio-identity,
.visual-toolbar__group,
.toolbar-check,
.zoom-control {
  display: flex;
  align-items: center;
}

.studio-identity {
  min-width: 0;
  gap: 10px;
}

.studio-identity__icon,
.pdf-message__icon,
.empty-pane__icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  color: var(--ui-text-toned);
  background: var(--ui-bg-muted);
  border: 1px solid var(--ui-border);
}

.studio-identity__icon {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  font-size: 16px;
}

.studio-identity__copy {
  min-width: 0;
  display: grid;
  gap: 1px;
}

.studio-identity__copy strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 650;
  line-height: 1.25;
}

.studio-identity__copy small {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.visual-toolbar__group {
  gap: 6px;
}

.visual-toolbar__page-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.visual-toolbar__group:last-child {
  justify-self: end;
}

.tool-button,
.page-button,
.attach-button,
.canvas-toast button,
.reset-placement,
.remove-mapping {
  color: var(--ui-text-toned);
  background: var(--ui-bg);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  font: inherit;
  cursor: pointer;
}

.tool-button {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 8px 11px;
  font-size: 12px;
  font-weight: 550;
}

.tool-button--icon {
  width: 38px;
  padding: 0;
  font-size: 16px;
}

.tool-button--mode {
  min-width: 136px;
}

.tool-button:hover:not(:disabled),
.page-button:hover:not(:disabled),
.attach-button:hover,
.canvas-toast button:hover {
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-elevated);
  border-color: var(--ui-border-accented);
}

.tool-button--active {
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 10%, var(--ui-bg));
  border-color: color-mix(in srgb, var(--ui-primary) 42%, var(--ui-border));
}

.tool-button:disabled,
.page-button:disabled {
  opacity: .38;
  cursor: default;
}

.toolbar-divider {
  width: 1px;
  height: 22px;
  margin: 0 2px;
  background: var(--ui-border);
}

.toolbar-check,
.zoom-control {
  min-height: 38px;
  gap: 7px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.toolbar-check {
  padding: 0 10px;
  cursor: pointer;
}

.toolbar-check input {
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--ui-primary);
}

.toolbar-check .icon,
.zoom-control .icon {
  font-size: 15px;
}

.zoom-control select,
.studio-statusbar select {
  min-height: 34px;
  padding: 5px 9px;
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-muted);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  font: inherit;
  font-size: 11px;
}

.studio-global-message {
  min-width: 1100px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px;
  color: var(--ui-error);
  background: color-mix(in srgb, var(--ui-error) 7%, var(--ui-bg));
  font-size: 12px;
}

.visual-layout {
  min-height: 0;
  display: grid;
  grid-template-columns: var(--studio-left-panel) minmax(480px, 1fr) var(--studio-right-panel);
  overflow: hidden;
}

.field-browser,
.property-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--ui-bg);
}

.field-browser {
  border-right: 1px solid var(--ui-border);
}

.property-pane {
  border-left: 1px solid var(--ui-border);
}

.pane-heading {
  min-height: 48px;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--ui-border);
}

.pane-heading__title {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 650;
}

.pane-heading__title > .icon {
  flex: 0 0 auto;
  color: var(--ui-text-muted);
  font-size: 15px;
}

.pane-heading strong {
  min-width: 25px;
  padding: 3px 7px;
  color: var(--ui-text-toned);
  text-align: center;
  background: var(--ui-bg-muted);
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  font-family: var(--font-mono);
  font-size: 10px;
}

.browser-tabs {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 10px 10px 0;
}

.browser-tabs button {
  min-height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 8px;
  color: var(--ui-text-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--ui-radius);
  font: inherit;
  font-size: 11px;
  font-weight: 550;
  cursor: pointer;
}

.browser-tabs button:hover {
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-muted);
}

.browser-tabs button.active {
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-elevated);
  border-color: var(--ui-border);
}

.field-search {
  position: relative;
  display: block;
  flex: 0 0 auto;
  padding: 10px;
}

.field-search > .icon {
  position: absolute;
  left: 21px;
  top: 50%;
  z-index: 1;
  color: var(--ui-text-dimmed);
  font-size: 14px;
  transform: translateY(-50%);
  pointer-events: none;
}

.field-search input {
  width: 100%;
  height: 38px;
  padding: 8px 10px 8px 34px;
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-muted);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  outline: 0;
  font: inherit;
  font-size: 11px;
}

.field-search input:focus {
  border-color: color-mix(in srgb, var(--ui-primary) 60%, var(--ui-border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-primary) 12%, transparent);
}

.field-filters {
  display: flex;
  flex: 0 0 auto;
  gap: 5px;
  padding: 0 10px 10px;
}

.field-filters button {
  min-height: 30px;
  padding: 5px 9px;
  color: var(--ui-text-muted);
  background: transparent;
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  font: inherit;
  font-size: 10px;
  cursor: pointer;
}

.field-filters button:hover {
  color: var(--ui-text-highlighted);
  border-color: var(--ui-border-accented);
}

.field-filters button.active {
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 8%, var(--ui-bg));
  border-color: color-mix(in srgb, var(--ui-primary) 34%, var(--ui-border));
}

.field-list {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 0 8px 12px;
}

.catalog-hint {
  flex: 0 0 auto;
  padding: 10px 12px 0;
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.catalog-hint--warning {
  color: var(--ui-warning);
}

.catalog-kind {
  padding-top: 10px;
  padding-bottom: 0;
}

.field-list-item {
  position: relative;
  width: 100%;
  min-height: 54px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 10px;
  margin-bottom: 4px;
  color: var(--ui-text-highlighted);
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--ui-radius);
  font: inherit;
  cursor: pointer;
}

.field-list-item:hover {
  background: var(--ui-bg-muted);
  border-color: var(--ui-border);
}

.field-list-item--selected {
  background: color-mix(in srgb, var(--ui-primary) 8%, var(--ui-bg));
  border-color: color-mix(in srgb, var(--ui-primary) 38%, var(--ui-border));
  box-shadow: inset 2px 0 0 var(--ui-primary);
}

.field-list-item > span:first-child {
  min-width: 0;
  display: grid;
  gap: 3px;
  flex: 1;
}

.field-list-item strong {
  overflow: hidden;
  font-size: 11px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field-list-item small {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 10px;
  line-height: 1.35;
  text-overflow: ellipsis;
}

.collection-badge,
.mapping-ai-badge {
  width: max-content;
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 650;
  line-height: 1.35;
  white-space: nowrap;
}

.collection-badge {
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 9%, var(--ui-bg));
  border: 1px solid color-mix(in srgb, var(--ui-primary) 25%, transparent);
}

.mapping-ai-badge {
  flex: 0 0 auto;
  color: #7c3aed;
  background: rgb(124 58 237 / 10%);
  border: 1px solid rgb(124 58 237 / 24%);
}

.catalog-key {
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
}

.catalog-semantic {
  display: -webkit-box;
  overflow: hidden;
  line-height: 1.4;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.field-page {
  flex: 0 0 auto;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  white-space: nowrap;
}

.review-state,
.override-dot {
  width: 20px;
  height: 20px;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
}

.review-state {
  color: var(--ui-success);
  background: color-mix(in srgb, var(--ui-success) 10%, var(--ui-bg));
  font-size: 13px;
}

.review-state--pending {
  color: var(--ui-warning);
  background: color-mix(in srgb, var(--ui-warning) 12%, var(--ui-bg));
}

.override-dot {
  color: var(--ui-text-inverted);
  background: var(--ui-warning);
  font-family: var(--font-mono);
  font-size: 10px;
}

.catalog-item {
  min-height: 72px;
  border-color: var(--ui-border);
  cursor: grab;
}

.catalog-item:active {
  cursor: grabbing;
}

.catalog-item:disabled {
  opacity: .48;
  cursor: not-allowed;
}

.drag-handle {
  flex: 0 0 auto;
  color: var(--ui-text-dimmed);
  font-size: 17px;
}

.pdf-pane {
  position: relative;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #dce2ea;
}

.stage-scroll {
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 32px;
}

.stage-scroll--editing {
  cursor: crosshair;
}

.page-stage {
  position: relative;
  margin: 0 auto;
  background: #fff;
  box-shadow: 0 16px 45px rgb(15 23 42 / 22%);
}

.pdf-canvas {
  position: absolute;
  inset: 0;
  display: block;
  background: #fff;
}

.field-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.alignment-guide {
  position: absolute;
  z-index: 4;
  background: #ec4899;
  box-shadow: 0 0 0 1px rgb(255 255 255 / 78%);
  pointer-events: none;
}

.alignment-guide--x {
  top: 0;
  bottom: 0;
  width: 1px;
  transform: translateX(-.5px);
}

.alignment-guide--y {
  left: 0;
  right: 0;
  height: 1px;
  transform: translateY(-.5px);
}

.field-layer--drop-active {
  outline: 3px solid var(--ui-primary);
  outline-offset: -3px;
  background: color-mix(in srgb, var(--ui-primary) 8%, transparent);
}

.field-layer--drop-active::after {
  position: absolute;
  inset: 12px;
  z-index: 5;
  display: grid;
  place-items: center;
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-bg) 84%, transparent);
  border: 2px dashed var(--ui-primary);
  border-radius: 8px;
  content: 'Upuść, aby dodać pole';
  font-size: 12px;
  font-weight: 650;
  pointer-events: none;
}

.field-box {
  position: absolute;
  display: block;
  padding: 0;
  color: #075985;
  background: rgb(14 165 233 / 11%);
  border: 1px solid rgb(2 132 199 / 72%);
  border-radius: 2px;
  outline: 0;
  cursor: pointer;
  touch-action: none;
}

.field-box:hover {
  background: rgb(14 165 233 / 20%);
}

.field-box--acro {
  color: #5b21b6;
  background: rgb(139 92 246 / 10%);
  border-color: rgb(124 58 237 / 68%);
}

.field-box--mark {
  min-width: 8px;
  min-height: 8px;
  color: #9a3412;
  background: rgb(249 115 22 / 15%);
  border-color: rgb(234 88 12 / 76%);
}

.field-box--override {
  border-style: dashed;
}

.field-box--selected {
  z-index: 2;
  background: rgb(37 99 235 / 20%);
  border: 2px solid #2563eb;
  box-shadow: 0 0 0 2px rgb(255 255 255 / 80%), 0 0 0 4px rgb(37 99 235 / 55%);
}

.field-box--selected.field-box--editing {
  cursor: move;
}

.field-box:focus-visible {
  box-shadow: 0 0 0 3px #fff, 0 0 0 5px var(--ui-primary);
}

.field-box__label {
  position: absolute;
  left: -1px;
  top: -22px;
  max-width: 210px;
  overflow: hidden;
  padding: 3px 6px;
  color: #fff;
  background: #075985;
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}

.field-box--acro .field-box__label {
  background: #5b21b6;
}

.resize-handle {
  position: absolute;
  width: 11px;
  height: 11px;
  background: #fff;
  border: 2px solid #2563eb;
  border-radius: 50%;
}

.resize-handle--nw { left: -7px; top: -7px; cursor: nwse-resize; }
.resize-handle--ne { right: -7px; top: -7px; cursor: nesw-resize; }
.resize-handle--sw { left: -7px; bottom: -7px; cursor: nesw-resize; }
.resize-handle--se { right: -7px; bottom: -7px; cursor: nwse-resize; }

.canvas-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  gap: 9px;
  color: #334155;
  background: rgb(255 255 255 / 80%);
  font-size: 12px;
}

.canvas-loading span {
  width: 20px;
  height: 20px;
  justify-self: center;
  border: 2px solid #cbd5e1;
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: visual-spin .7s linear infinite;
}

.canvas-toast {
  position: absolute;
  left: 50%;
  bottom: 16px;
  z-index: 8;
  max-width: min(620px, calc(100% - 32px));
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  padding: 9px 9px 9px 12px;
  color: var(--ui-text-toned);
  background: color-mix(in srgb, var(--ui-warning) 7%, var(--ui-bg-elevated));
  border: 1px solid color-mix(in srgb, var(--ui-warning) 28%, var(--ui-border));
  border-radius: 10px;
  box-shadow: 0 10px 30px rgb(15 23 42 / 22%);
  font-size: 11px;
  line-height: 1.4;
  transform: translateX(-50%);
}

.canvas-toast > .icon {
  color: var(--ui-warning);
  font-size: 16px;
}

.canvas-toast button {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--ui-text-muted);
  background: transparent;
  border-color: transparent;
}

.canvas-toast--error {
  background: color-mix(in srgb, var(--ui-error) 7%, var(--ui-bg-elevated));
  border-color: color-mix(in srgb, var(--ui-error) 30%, var(--ui-border));
}

.canvas-toast--error > .icon {
  color: var(--ui-error);
}

.pdf-message {
  width: min(440px, calc(100% - 40px));
  align-self: center;
  padding: 30px;
  margin: auto;
  color: #334155;
  text-align: center;
  background: rgb(255 255 255 / 84%);
  border: 1px solid #cbd5e1;
  border-radius: 12px;
  box-shadow: 0 14px 35px rgb(15 23 42 / 12%);
}

.pdf-message__icon {
  width: 42px;
  height: 42px;
  margin: 0 auto 12px;
  color: #64748b;
  background: #f8fafc;
  border-color: #cbd5e1;
  border-radius: 10px;
  font-size: 20px;
}

.pdf-message strong {
  display: block;
  font-size: 14px;
}

.pdf-message p {
  margin: 8px 0 16px;
  font-size: 12px;
  line-height: 1.5;
}

.attach-button {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 12px;
  color: #334155;
  background: #fff;
  border-color: #cbd5e1;
  font-size: 12px;
}

.property-scroll {
  min-height: 0;
  flex: 1;
  overflow: auto;
}

.property-title {
  display: grid;
  gap: 6px;
  padding: 14px;
  border-bottom: 1px solid var(--ui-border);
}

.property-title > strong {
  overflow-wrap: anywhere;
  color: var(--ui-text-highlighted);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.45;
}

.property-title__meta {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.property-title__pending {
  color: var(--ui-warning);
}

.property-title .collection-badge {
  color: var(--ui-primary);
  font-family: var(--font-sans);
}

.semantic-contract,
.mapping-evidence {
  display: grid;
  gap: 8px;
  padding: 14px;
  border-bottom: 1px solid var(--ui-border);
}

.property-section-label,
.mapping-evidence__heading span {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: .07em;
  text-transform: uppercase;
}

.semantic-contract__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.semantic-source-badge {
  max-width: 154px;
  overflow: hidden;
  padding: 3px 7px;
  color: var(--ui-text-muted);
  background: var(--ui-bg-muted);
  border: 1px solid var(--ui-border);
  border-radius: 5px;
  font-family: var(--font-mono);
  font-size: 9px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.semantic-source-badge--manual {
  color: var(--ui-warning);
  background: color-mix(in srgb, var(--ui-warning) 7%, var(--ui-bg));
  border-color: color-mix(in srgb, var(--ui-warning) 28%, var(--ui-border));
}

.semantic-source-badge--ai {
  color: #a855f7;
  background: color-mix(in srgb, #a855f7 7%, var(--ui-bg));
  border-color: color-mix(in srgb, #a855f7 30%, var(--ui-border));
}

.semantic-contract > strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
  line-height: 1.45;
}

.semantic-contract > p,
.mapping-evidence > p {
  margin: 0;
  color: var(--ui-text-toned);
  font-size: 11px;
  line-height: 1.55;
}

.semantic-contract > .semantic-help {
  color: var(--ui-text-muted);
}

.semantic-editor {
  display: grid;
  gap: 10px;
  padding-top: 4px;
}

.semantic-contract details {
  padding: 9px 10px;
  color: var(--ui-text-muted);
  background: color-mix(in srgb, var(--ui-bg-muted) 68%, transparent);
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  font-size: 11px;
}

.semantic-contract summary {
  color: var(--ui-text-toned);
  cursor: pointer;
  font-weight: 600;
}

.semantic-hints-grid {
  display: grid;
  gap: 10px;
  padding-top: 8px;
}

.semantic-rationale {
  padding: 9px 10px;
  background: color-mix(in srgb, #a855f7 5%, var(--ui-bg));
  border-left: 2px solid color-mix(in srgb, #a855f7 55%, var(--ui-border));
  font-style: italic;
}

.semantic-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.semantic-generate,
.semantic-apply,
.semantic-reset,
.semantic-proposal-apply,
.semantic-proposal-dismiss {
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 7px 10px;
  color: var(--ui-text-toned);
  background: var(--ui-bg);
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  font: inherit;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
}

.semantic-apply {
  width: 100%;
  color: #fff;
  background: var(--ui-primary);
  border-color: var(--ui-primary);
}

.semantic-apply:hover:not(:disabled) {
  filter: brightness(1.08);
}

.semantic-generate {
  flex: 1 1 160px;
  color: #a855f7;
  background: color-mix(in srgb, #a855f7 7%, var(--ui-bg));
  border-color: color-mix(in srgb, #a855f7 32%, var(--ui-border));
}

.semantic-reset {
  flex: 0 1 auto;
}

.semantic-generate:hover:not(:disabled),
.semantic-reset:hover:not(:disabled),
.semantic-proposal-dismiss:hover:not(:disabled) {
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-elevated);
  border-color: var(--ui-border-accented);
}

.semantic-generate:disabled,
.semantic-apply:disabled,
.semantic-reset:disabled,
.semantic-proposal-apply:disabled,
.semantic-proposal-dismiss:disabled {
  opacity: .42;
  cursor: default;
}

.semantic-spinner {
  animation: visual-spin .7s linear infinite;
}

.semantic-ai-proposal {
  display: grid;
  gap: 10px;
  padding: 11px;
  background: color-mix(in srgb, #a855f7 6%, var(--ui-bg));
  border: 1px solid color-mix(in srgb, #a855f7 28%, var(--ui-border));
  border-radius: 7px;
}

.semantic-ai-proposal header,
.semantic-ai-proposal footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.semantic-ai-proposal header > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #a855f7;
  font-size: 11px;
  font-weight: 700;
}

.semantic-ai-proposal header small {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 8px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.semantic-ai-proposal > p,
.semantic-ai-proposal dd {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--ui-text-toned);
  font-size: 10px;
  line-height: 1.5;
}

.semantic-ai-proposal dl {
  display: grid;
  gap: 8px;
  margin: 0;
}

.semantic-ai-proposal dl > div {
  display: grid;
  gap: 3px;
}

.semantic-ai-proposal dt {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: .05em;
  text-transform: uppercase;
}

.semantic-ai-proposal .semantic-ai-proposal__rationale {
  color: var(--ui-text-muted);
  font-style: italic;
}

.semantic-ai-proposal footer {
  justify-content: flex-start;
}

.semantic-proposal-apply {
  color: #fff;
  background: var(--ui-primary);
  border-color: var(--ui-primary);
}

.semantic-proposal-apply:hover:not(:disabled) {
  filter: brightness(1.08);
}

.mapping-evidence {
  background: color-mix(in srgb, #7c3aed 4%, var(--ui-bg));
}

.mapping-evidence--legacy {
  background: var(--ui-bg-muted);
}

.mapping-evidence__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.mapping-evidence__heading strong {
  color: #7c3aed;
  font-family: var(--font-mono);
  font-size: 11px;
}

.mapping-evidence ul {
  display: grid;
  gap: 6px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.mapping-evidence li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 7px;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.mapping-evidence li span {
  color: var(--ui-primary);
  font-family: var(--font-mono);
  white-space: nowrap;
}

.mapping-evidence q {
  overflow-wrap: anywhere;
}

.property-pane fieldset {
  display: grid;
  gap: 10px;
  padding: 14px;
  margin: 0;
  border: 0;
  border-bottom: 1px solid var(--ui-border);
}

.property-pane fieldset:disabled {
  opacity: .55;
}

.property-pane legend {
  float: left;
  width: 100%;
  padding: 0 0 9px;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: .07em;
  text-transform: uppercase;
}

.property-pane label {
  display: grid;
  gap: 5px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.property-pane input,
.property-pane select,
.property-pane textarea {
  width: 100%;
  min-height: 38px;
  padding: 8px 9px;
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-muted);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  outline: 0;
  font: inherit;
  font-size: 11px;
}

.property-pane textarea {
  min-height: 72px;
  line-height: 1.45;
  resize: vertical;
}

.property-pane input:focus,
.property-pane select:focus,
.property-pane textarea:focus {
  border-color: color-mix(in srgb, var(--ui-primary) 60%, var(--ui-border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-primary) 12%, transparent);
}

.number-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.property-hint,
.keyboard-tip {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.5;
}

.reset-placement,
.remove-mapping {
  width: calc(100% - 28px);
  min-height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 8px 10px;
  margin: 14px;
  font-size: 11px;
}

.reset-placement {
  color: var(--ui-warning);
  background: color-mix(in srgb, var(--ui-warning) 9%, var(--ui-bg));
  border-color: color-mix(in srgb, var(--ui-warning) 28%, transparent);
}

.remove-mapping {
  color: var(--ui-error);
  background: color-mix(in srgb, var(--ui-error) 7%, var(--ui-bg));
  border-color: color-mix(in srgb, var(--ui-error) 25%, transparent);
}

.reset-placement:disabled,
.remove-mapping:disabled {
  opacity: .5;
  cursor: default;
}

.reset-placement + .remove-mapping {
  margin-top: 0;
}

.keyboard-tip {
  padding: 0 14px 14px;
}

.empty-pane {
  padding: 18px 12px;
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.5;
}

.empty-pane--properties {
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 42px 24px;
  text-align: center;
}

.empty-pane__icon {
  width: 40px;
  height: 40px;
  margin-bottom: 4px;
  border-radius: 10px;
  font-size: 18px;
}

.empty-pane--properties strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.empty-pane--properties p {
  max-width: 240px;
  margin: 0;
}

.studio-statusbar {
  z-index: 5;
  display: grid;
  grid-template-columns: var(--studio-left-panel) minmax(480px, 1fr) var(--studio-right-panel);
  align-items: center;
  color: var(--ui-text-muted);
  background: var(--ui-bg);
  border-top: 1px solid var(--ui-border);
  font-size: 11px;
}

.status-group {
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
}

.status-group--mapping {
  border-right: 1px solid var(--ui-border);
}

.status-group--page {
  justify-content: center;
}

.status-group--selection {
  justify-content: flex-end;
  border-left: 1px solid var(--ui-border);
}

.status-item,
.selection-state {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.status-item > .icon,
.selection-state > .icon {
  flex: 0 0 auto;
  font-size: 14px;
}

.status-item strong {
  color: var(--ui-text-highlighted);
  font-weight: 650;
}

.status-item--warning,
.selection-state--warning {
  color: var(--ui-warning);
}

.selection-state {
  overflow: hidden;
  color: var(--ui-success);
  text-overflow: ellipsis;
}

.selection-state--snap {
  color: #ec4899;
  font-weight: 650;
}

.selection-state--muted {
  color: var(--ui-text-muted);
}

.status-divider {
  width: 1px;
  height: 16px;
  flex: 0 0 auto;
  background: var(--ui-border);
}

.status-group--page label {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.status-group--page select {
  min-width: 52px;
  height: 30px;
  min-height: 30px;
  padding: 3px 7px;
  text-align: center;
}

.page-button {
  width: 30px;
  height: 30px;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  font-size: 15px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  padding: 0;
  margin: -1px;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

button:focus-visible,
select:focus-visible,
input:focus-visible,
textarea:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}

@keyframes visual-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 1199px) {
  .visual-editor {
    --studio-left-panel: 232px;
    --studio-right-panel: 288px;
  }

  .visual-toolbar,
  .visual-layout,
  .studio-statusbar {
    min-width: 1024px;
  }

  .visual-layout,
  .studio-statusbar {
    grid-template-columns: var(--studio-left-panel) minmax(480px, 1fr) var(--studio-right-panel);
  }

  .studio-identity__copy small {
    max-width: 170px;
  }

  .status-group {
    padding-inline: 10px;
  }
}

@media (max-width: 899px) {
  .visual-editor {
    min-width: 0;
    height: 760px;
  }

  .visual-toolbar,
  .visual-layout,
  .studio-statusbar {
    min-width: 1024px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .canvas-loading span {
    animation-duration: 1.8s;
  }
}
</style>
