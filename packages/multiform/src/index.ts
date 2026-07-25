export {
  APPLICANT_INDEXES,
  CANONICAL_COLLECTIONS,
  CANONICAL_COMPUTED_BINDINGS,
  CANONICAL_FIELDS,
  MAX_APPLICANTS,
} from './canonical-fields.ts'
export type {
  CanonicalBindingKey,
  CanonicalComputedBindingKey,
  CanonicalFieldKey,
} from './canonical-fields.ts'
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
export {
  templateApplicantCapacity,
  templateApplicantCapacityIssues,
} from './template-capacity.ts'
export type { TemplateApplicantCapacityIssue } from './template-capacity.ts'
export type {
  AcroFormTarget,
  AcroFormTextSnapshot,
  AcroFormWidgetPlacementOverride,
  AcroFormWidgetSnapshot,
  BindingCondition,
  BundleWarning,
  CanonicalFieldAiMappingHints,
  CanonicalCollectionDefinition,
  CanonicalCollectionFieldRef,
  CanonicalComputedBindingDefinition,
  CanonicalFieldDefinition,
  CanonicalFieldFormDefinition,
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
  TemplateBindingSemanticContract,
  TemplateCoverage,
  TemplateMappingEvidence,
  TemplateMappingEvidenceAnchor,
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
