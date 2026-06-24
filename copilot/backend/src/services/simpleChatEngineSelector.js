const UNIFIED_RESPONSE_STYLES = new Set([
  'structured',
  'study_first',
  'study-first',
  'study',
  'board',
  'board_mode',
  'tumor_board',
  'oncology_board',
  'dossier'
]);

const SIMPLE_ENGINE_ALIASES = new Set(['v2', 'simple_v2', 'simple']);
const UNIFIED_ENGINE_ALIASES = new Set(['legacy', 'unified', 'clinical', 'hybrid', 'unified_clinical']);

export const hasMeaningfulValue = (value) => {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((item) => hasMeaningfulValue(item));
  if (typeof value === 'object') return Object.values(value).some((item) => hasMeaningfulValue(item));
  return true;
};

export const hasNonEmptyArray = (value) =>
  Array.isArray(value) && value.some((item) => hasMeaningfulValue(item));

const normalizeTrialStatus = (value = '') =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

export const shouldPreferUnifiedSimpleChat = (question = '', options = {}) => {
  const normalizedOptions = (options && typeof options === 'object' && !Array.isArray(options))
    ? options
    : {};
  const clinicalContext = (normalizedOptions.clinicalContext && typeof normalizedOptions.clinicalContext === 'object')
    ? normalizedOptions.clinicalContext
    : {};

  const style = String(normalizedOptions.responseStyle || '').toLowerCase().trim();
  const structuredStyle = UNIFIED_RESPONSE_STYLES.has(style);
  const hasClinicalFields = [
    normalizedOptions.population,
    normalizedOptions.intervention,
    normalizedOptions.comparator,
    normalizedOptions.comparison,
    normalizedOptions.outcomes,
    normalizedOptions.biomarker,
    normalizedOptions.lineOfTherapy,
    clinicalContext.population,
    clinicalContext.intervention,
    clinicalContext.comparator,
    clinicalContext.comparison,
    clinicalContext.outcomes,
    clinicalContext.biomarker,
    clinicalContext.lineOfTherapy
  ].some((value) => hasMeaningfulValue(value));

  const hasStudySelectors =
    hasNonEmptyArray(normalizedOptions.studyTypes) ||
    hasNonEmptyArray(normalizedOptions.endpoints) ||
    hasNonEmptyArray(clinicalContext.studyTypes) ||
    hasNonEmptyArray(clinicalContext.endpoints);

  const normalizedTrialStatuses = Array.isArray(normalizedOptions.trialStatuses)
    ? normalizedOptions.trialStatuses.map((status) => normalizeTrialStatus(status)).filter(Boolean)
    : [];
  const hasCustomTrialStatuses =
    normalizedTrialStatuses.length > 1 ||
    normalizedTrialStatuses.some((status) => status !== 'RECRUITING');
  const hasTrialFilters =
    hasNonEmptyArray(normalizedOptions.trialPhases) ||
    hasCustomTrialStatuses ||
    hasNonEmptyArray(normalizedOptions.trialRegions);

  const hasUnifiedOnlyFlags = [
    'agentic',
    'selfCheck',
    'hardFailEvidence'
  ].some((key) => normalizedOptions[key] !== undefined);

  const hasStructuredQuestionBlock = /(structured context:|population:|intervention:|comparator:|outcomes:)/i
    .test(String(question || ''));

  return structuredStyle ||
    hasClinicalFields ||
    hasStudySelectors ||
    hasTrialFilters ||
    hasUnifiedOnlyFlags ||
    hasStructuredQuestionBlock;
};

export const resolveSimpleChatEngine = (question = '', options = {}) => {
  const requestedEngine = String(options?.engine || process.env.SIMPLE_CHAT_ENGINE || '')
    .toLowerCase()
    .trim();

  if (SIMPLE_ENGINE_ALIASES.has(requestedEngine)) return 'simple_v2';
  if (UNIFIED_ENGINE_ALIASES.has(requestedEngine)) return 'unified_clinical';

  return shouldPreferUnifiedSimpleChat(question, options)
    ? 'unified_clinical'
    : 'simple_v2';
};
