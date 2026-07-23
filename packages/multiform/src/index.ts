export { CANONICAL_COLLECTIONS, CANONICAL_FIELDS } from './canonical-fields.ts'
export type { CanonicalFieldKey } from './canonical-fields.ts'
export { DEMO_TEMPLATE_IDS } from './demo-template-ids.ts'
export { MULTIFORM_MODEL_DEFINITIONS } from './model-definitions.ts'
export {
  getTemplate,
  getTemplateBySourceSha256,
  getTemplates,
  prepareBundle,
} from './registry.ts'
export {
  ERSTE_TEMPLATE,
  PEKAO_TEMPLATE,
  PKO_TEMPLATE,
  TEMPLATES,
} from './templates/index.ts'
export { validateTemplateJson } from './template-validation.ts'
export type {
  AcroFormTarget,
  AcroFormTextSnapshot,
  AcroFormWidgetPlacementOverride,
  AcroFormWidgetSnapshot,
  BindingCondition,
  BundleWarning,
  CanonicalCollectionDefinition,
  CanonicalCollectionFieldRef,
  CanonicalFieldDefinition,
  CanonicalFieldOption,
  CanonicalFieldType,
  DocumentTemplate,
  FieldCondition,
  OverlayTarget,
  LegacyOverlayTarget,
  PreciseOverlayTarget,
  PdfAppearance,
  PdfBox,
  PdfColor,
  PdfCoordinateSpace,
  PdfMarkAppearance,
  PdfPadding,
  PdfPageGeometry,
  PdfTextAppearance,
  PreparedBundle,
  TemplateBinding,
  TemplateCoverage,
  TemplateTarget,
  UnmappedTarget,
  ValueFormat,
} from './types.ts'
export type {
  TemplateJsonKind,
  TemplateValidationIssue,
  TemplateValidationResult,
  TemplateValidationSummary,
} from './template-validation.ts'
