import OpenAI from '../lib/bedrockOpenAICompat.js';
import { createFastModelRouter } from '../lib/fastModelRouter.js';
import { createGroqClient } from '../lib/groqClient.js';
import { logger } from '../utils/logger.js';
import config from '../config/config.js';
import ResponseQualityChecker from './responseQualityChecker.js';
import EvidenceSelectionService from './evidenceSelectionService.js';
import ClinicalIntentAgent from './simple-chat/ClinicalIntentAgent.js';
import EndpointClaimAgent from './simple-chat/EndpointClaimAgent.js';
import TrialFamilyAgent from './simple-chat/TrialFamilyAgent.js';
import EndpointJudgeAgent from './simple-chat/EndpointJudgeAgent.js';
import PublicationExtractionAgent from './simple-chat/PublicationExtractionAgent.js';
import ClinicalQuestionClassifier from './simple-chat/ClinicalQuestionClassifier.js';
import GradeAssessmentAgent from './simple-chat/GradeAssessmentAgent.js';

class SimpleChatService {
  constructor() {
    this.openai = null;
    this.architectureVersion = 'flexible-evidence-v2';
    this.qualityChecker = new ResponseQualityChecker();
    this.maxEvidenceArticles = 10;
    this.maxConversationTurns = 8;
    this.maxSearchQueries = 6;
    this.maxCompanionSearches = 3;
    // Only block tokens that are clearly LLM placeholder artifacts, not legitimate clinical language
    this.forbiddenMissingTokens = [
      'available in source text',
      'available source',
      'missing information'
    ];
    this.evidenceSelectionService = new EvidenceSelectionService({
      buildSearchQueries: (originalQuestion, standaloneQuestion, options) =>
        this.buildSearchQueries(originalQuestion, standaloneQuestion, options),
      buildSearchQueriesSync: (originalQuestion, standaloneQuestion, options) =>
        this.buildSearchQueriesSync(originalQuestion, standaloneQuestion, options),
      searchPubMed: (query, maxResults) => this.searchPubMed(query, maxResults),
      mergeArticles: (primary, secondary) => this.mergeArticles(primary, secondary),
      applyRecencyFilterToQuery: (query, recency) => this.applyRecencyFilterToQuery(query, recency),
      buildFallbackSearchQueries: (question, standaloneQuestion, options) =>
        this.buildFallbackSearchQueries(question, standaloneQuestion, options),
      rankArticlesWithDiagnostics: (articles, question, options) =>
        this.rankArticlesWithDiagnostics(articles, question, options),
      rankArticlesByRelevance: (articles, question, options) =>
        this.rankArticlesByRelevance(articles, question, options),
      filterFocusedContextArticles: (articles, question, options) =>
        this.filterFocusedContextArticles(articles, question, options),
      enrichContextArticles: (articles, question) => this.enrichContextArticles(articles, question),
      extractEvidenceSummaries: (articles) => this.extractEvidenceSummaries(articles),
      filterForPlaceboComparator: (articles, evidenceSummaries) =>
        this.filterForPlaceboComparator(articles, evidenceSummaries),
      computeQuickReviewStats: (articles) => this.computeQuickReviewStats(articles)
    });
    this.clinicalIntentAgent = new ClinicalIntentAgent({
      normalizePreferenceKey: value => this.normalizePreferenceKey(value),
      textMentionsEndpointKey: (text, key) => this.textMentionsEndpointKey(text, key),
      getEndpointLabel: (key, language) => this.getEndpointLabel(key, language),
      joinListWithAnd: (values, language) => this.joinListWithAnd(values, language)
    });
    this.endpointClaimAgent = new EndpointClaimAgent({
      sanitizeEvidenceField: value => this.sanitizeEvidenceField(value),
      getEndpointLabel: (key, language) => this.getEndpointLabel(key, language),
      inferComparatorLabel: (article, summary) => this.inferComparatorLabel(article, summary),
      hasDirectComparativeSignals: (article, summary) => this.hasDirectComparativeSignals(article, summary),
      inferEvidenceStrength: (article, summary) => this.inferEvidenceStrength(article, summary)
    });
    this.trialFamilyAgent = new TrialFamilyAgent({
      normalizeSearchText: text => this.normalizeSearchText(text),
      sanitizeEvidenceField: value => this.sanitizeEvidenceField(value),
      extractTrialName: (title, abstract) => this.extractTrialName(title, abstract),
      detectClinicalFocus: (question, options) => this.detectClinicalFocus(question, options),
      getRequestedEndpointKeys: (question, options) => this.clinicalIntentAgent.getRequestedEndpointKeys(question, options),
      getStudyEndpointKeys: (article, summary) => this.endpointClaimAgent.getStudyEndpointKeys(article, summary),
      getEvidenceStrengthWeight: label => this.getEvidenceStrengthWeight(label),
      hasOverallSurvivalSignal: (article, summary) => this.hasOverallSurvivalSignal(article, summary),
      hasLateEndpointSignal: (article, summary) => this.hasLateEndpointSignal(article, summary),
      isQualityOfLifeFocusedPublication: (article, summary) => this.isQualityOfLifeFocusedPublication(article, summary),
      isExploratoryAnalysisPublication: (article, summary) => this.isExploratoryAnalysisPublication(article, summary),
      isBiomarkerFocusedPublication: (article, summary) => this.isBiomarkerFocusedPublication(article, summary),
      sortEvidenceForSynthesis: (articles, evidenceSummaries, question, options) =>
        this.sortEvidenceForSynthesis(articles, evidenceSummaries, question, options),
      endpointClaimAgent: this.endpointClaimAgent,
      maxEvidenceArticles: this.maxEvidenceArticles
    });
    this.endpointJudgeAgent = new EndpointJudgeAgent({
      getRequestedEndpointKeys: (question, options) => this.clinicalIntentAgent.getRequestedEndpointKeys(question, options),
      describeRequestedEndpoints: (question, options, language) =>
        this.clinicalIntentAgent.describeRequestedEndpoints(question, options, language),
      joinListWithAnd: (values, language) => this.joinListWithAnd(values, language),
      getEndpointLabel: (key, language) => this.getEndpointLabel(key, language),
      inferComparatorLabel: (article, summary) => this.inferComparatorLabel(article, summary),
      getPreferredEvidenceLabel: (article, summary) => this.getPreferredEvidenceLabel(article, summary),
      hasDirectComparativeSignals: (article, summary) => this.hasDirectComparativeSignals(article, summary),
      endpointClaimAgent: this.endpointClaimAgent
    });
    this.publicationExtractionAgent = new PublicationExtractionAgent();
    this.questionClassifier = new ClinicalQuestionClassifier();
    this.initializeOpenAI();
  }

  getArchitectureMetadata() {
    return {
      service: 'simpleChatService',
      architectureVersion: this.architectureVersion,
      agents: {
        clinicalIntent: Boolean(this.clinicalIntentAgent),
        endpointClaim: Boolean(this.endpointClaimAgent),
        trialFamily: Boolean(this.trialFamilyAgent),
        endpointJudge: Boolean(this.endpointJudgeAgent),
        publicationExtraction: Boolean(this.publicationExtractionAgent),
        questionClassifier: Boolean(this.questionClassifier)
      }
    };
  }

  /**
   * If the user (or UI) requests a placebo comparator, only keep studies whose extracted
   * comparator field explicitly indicates placebo. This avoids mixing non-placebo trials
   * into a placebo-controlled comparative table.
   */
  filterForPlaceboComparator(articles = [], evidenceSummaries = []) {
    if (!Array.isArray(articles) || articles.length === 0) return { articles, evidenceSummaries };
    const summaries = Array.isArray(evidenceSummaries) ? evidenceSummaries : [];
    const byIndex = new Map(summaries.filter(s => Number.isFinite(s?.index)).map(s => [s.index, s]));

    const placeboLike = (value = '') => {
      const t = String(value || '').toLowerCase();
      return /\bplacebo\b/.test(t) || /\bmatching placebo\b/.test(t);
    };

    const kept = [];
    const keptSummaries = [];
    for (let i = 0; i < articles.length; i++) {
      const index = i + 1;
      const s = byIndex.get(index);
      const comparator = this.inferComparatorLabel(articles[i], s);
      if (placeboLike(comparator)) {
        kept.push(articles[i]);
        if (s) {
          keptSummaries.push({
            ...s,
            index: kept.length
          });
        }
      }
    }

    // If filtering removes everything, keep original to avoid empty responses,
    // but downstream will surface the limitation explicitly.
    if (kept.length === 0) {
      return { articles, evidenceSummaries };
    }
    return { articles: kept, evidenceSummaries: keptSummaries };
  }

  initializeOpenAI() {
    // Primary model: Claude via Bedrock — maximum clinical quality for final answers.
    this.openai = new OpenAI({
      region: config.bedrock?.region,
      model: config.bedrock?.model,
      embeddingModel: config.bedrock?.embeddingModel
    });
    // Fast model: Groq (Llama 3.3 70B) for auxiliary tasks — question rewrite,
    // term extraction, claim repair. ~500-800 tok/s vs ~80 tok/s on Bedrock.
    // Falls back to Bedrock automatically if Groq is unavailable.
    this.fastModel = createFastModelRouter(this.openai);
    // GRADE certainty agent — runs after evidence assembly and before synthesis,
    // so its rating can be injected into the synthesis prompt (see runGradeAssessment).
    this.gradeAgent = new GradeAssessmentAgent({ openai: this.openai, logger });
    logger.info(
      `Primary model: Bedrock/${config.bedrock?.model} | Fast model: Groq/${config.groq?.model || 'llama-3.3-70b-versatile'}`
    );
  }

  /**
   * Run the GRADE certainty assessment over the assembled evidence.
   *
   * Called from both processQuestion and processQuestionStream AFTER evidence
   * assembly and BEFORE the synthesis prompt is built, so that the resulting
   * certainty rating is an input to the answer rather than a post-hoc annotation.
   * The returned contextSummary is injected via options.gradeContext, which
   * buildGenerateResponsePrompts appends to the user message.
   *
   * Returns null when disabled, when there is no evidence, or on timeout —
   * callers must treat a null assessment as "no rating available".
   */
  async runGradeAssessment(question, articles = [], evidenceSummaries = [], options = {}) {
    if (!config.external?.enableGradeAssessment) return null;
    if (!this.gradeAgent) return null;
    if (!articles.length && !evidenceSummaries.length) return null;

    const timeoutMs = Number(config.external?.gradeAssessmentTimeoutMs) || 12000;
    const started = Date.now();

    try {
      const assessment = await Promise.race([
        this.gradeAgent.assess(question, articles, evidenceSummaries, {
          population: options.population || '',
          intervention: options.intervention || '',
          comparator: options.comparator || ''
        }),
        new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))
      ]);

      if (!assessment) {
        logger.warn(`[GRADE] Assessment timed out after ${timeoutMs}ms — proceeding without a certainty rating`);
        return null;
      }
      if (!assessment.certainty_of_evidence) {
        logger.info(`[GRADE] No certainty produced: ${assessment.reason || 'unknown reason'}`);
        return null;
      }

      assessment.available = true;
      logger.info(`[GRADE] ${assessment.certainty_of_evidence} certainty in ${Date.now() - started}ms (pre-synthesis)`);
      return assessment;
    } catch (err) {
      logger.warn(`[GRADE] Assessment failed: ${err.message}`);
      return null;
    }
  }

  normalizeClinicalTypos(text = '') {
    return String(text || '')
      .replace(/\bneo[\s-]?adjuvant\b/gi, 'neoadjuvant')
      .replace(/\bneadjuvant\b/gi, 'neoadjuvant')
      .replace(/\btripple\b/gi, 'triple')
      .replace(/\btripple[-\s]?negative\b/gi, 'triple negative');
  }
  sanitizePubMedQuery(query = '') {
    const normalized = this.normalizeClinicalTypos(query)
      .replace(/[â€œâ€“”]/g, '"')
      .replace(/[â€˜â€™‘’]/g, "'")
      .replace(/'/g, ' ')
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')')
      .trim()
      .replace(/\s+/g, ' ');

    const quoteCount = (normalized.match(/"/g) || []).length;
    return (quoteCount % 2 === 0 ? normalized : normalized.replace(/"/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
  }

  stripDiacritics(text = '') {
    return String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  normalizeSearchText(text = '') {
    return this.stripDiacritics(String(text || '').toLowerCase())
      .replace(/[_/\\]+/g, ' ')
      .replace(/-/g, ' ')
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  translateOncologyToken(token = '') {
    const dictionary = {
      cancro: 'cancer',
      cancer: 'cancer',
      metastatico: 'metastatic',
      metastatica: 'metastatic',
      metastase: 'metastasis',
      metastases: 'metastasis',
      mama: 'breast',
      pulmao: 'lung',
      prostatica: 'prostate',
      prostata: 'prostate',
      ovario: 'ovarian',
      utero: 'uterine',
      colo: 'cervical',
      carboplatina: 'carboplatin',
      cisplatina: 'cisplatin',
      doxorrubicina: 'doxorubicin',
      ciclofosfamida: 'cyclophosphamide',
      docetaxel: 'docetaxel',
      paclitaxel: 'paclitaxel',
      trastuzumab: 'trastuzumab',
      pembrolizumab: 'pembrolizumab',
      nivolumab: 'nivolumab',
      quimioterapia: 'chemotherapy',
      imunoterapia: 'immunotherapy',
      tratamento: 'treatment',
      adjuvante: 'adjuvant',
      neoadjuvante: 'neoadjuvant',
      evidencia: 'evidence',
      ensaio: 'trial',
      ensaios: 'trials',
      randomizado: 'randomized',
      // Portuguese oncology acronyms
      cmm: 'metastatic breast cancer',
      cmp: 'metastatic prostate cancer',
      cprc: 'castration-resistant prostate cancer',
      cpcnpc: 'non-small cell lung cancer',
      cpcpc: 'small cell lung cancer',
      ccrcc: 'clear cell renal cell carcinoma',
      chn: 'head neck squamous cell carcinoma',
      cco: 'colorectal cancer',
      adc: 'antibody-drug conjugate'
    };

    return dictionary[token] || token;
  }

  /**
   * Remove country names, health-policy, and regulatory terms that poison PubMed queries.
   * Shared across all query builders so no search variant leaks non-clinical terms.
   */
  stripNonClinicalTerms(text = '') {
    const NON_CLINICAL = new Set([
      'portugal', 'portuguese', 'spain', 'spanish', 'france', 'french', 'germany', 'german',
      'italy', 'italian', 'europe', 'european', 'uk', 'united kingdom', 'usa', 'american',
      'brazil', 'brazilian', 'china', 'chinese', 'japan', 'japanese', 'india', 'indian',
      'reimbursement', 'reimbursed', 'funding', 'coverage', 'access', 'cost', 'price', 'pricing',
      'approval', 'approved', 'infarmed', 'ema', 'fda', 'nhs', 'sns', 'formulary',
      'comparticipação', 'comparticipacao', 'autorização', 'autorizacao', 'aue',
      'market', 'marketed', 'available', 'availability', 'prescription', 'policy', 'regulation'
    ]);

    return text
      .split(/\s+/)
      .filter(token => !NON_CLINICAL.has(token.toLowerCase().replace(/[^a-záàâãéèêíìîóòôõúùûç]/gi, '')))
      .join(' ')
      .trim();
  }

  buildKeywordFocusedQuery(question = '', options = {}) {
    const source = [
      question,
      options.population,
      options.intervention,
      options.comparator,
      options.outcomes,
      options.biomarker,
      options.lineOfTherapy
    ]
      .filter(Boolean)
      .join(' ');

    const normalized = this.normalizeSearchText(source);
    if (!normalized) return '';

    const stopWords = new Set([
      'the', 'and', 'for', 'with', 'from', 'this', 'that', 'what', 'which', 'when', 'where',
      'how', 'better', 'best', 'evidence', 'data', 'study', 'studies', 'trial', 'trials',
      'versus', 'compare', 'compared', 'comparison', 'between', 'among', 'using', 'plus',
      'regimen', 'regimens', 'based', 'therapy',
      // Country and health-policy terms (not useful for PubMed clinical queries)
      'portugal', 'portuguese', 'spain', 'france', 'germany', 'italy', 'europe', 'european',
      'reimbursement', 'reimbursed', 'funding', 'coverage', 'access', 'cost', 'price', 'pricing',
      'approval', 'approved', 'infarmed', 'ema', 'fda', 'nhs', 'sns', 'formulary',
      'comparticipação', 'comparticipacao', 'autorização', 'autorizacao',
      // Portuguese
      'que', 'qual', 'quais', 'como', 'melhor', 'dados', 'estudo', 'estudos', 'ensaio',
      'ensaios', 'versus', 'comparar', 'comparado', 'entre', 'com', 'sem', 'para', 'uma',
      'do', 'da', 'dos', 'das', 'de', 'e', 'em', 'no', 'na', 'nos', 'nas', 'por', 'ao'
    ]);

    const cleanedTokens = normalized
      .split(' ')
      .map(token => this.translateOncologyToken(token))
      .filter(token => token.length >= 3 && !stopWords.has(token));

    const unique = [...new Set(cleanedTokens)];
    if (unique.length === 0) {
      return this.sanitizePubMedQuery(question);
    }

    return unique.slice(0, 10).join(' ');
  }

  normalizePreferenceKey(value = '') {
    return this.normalizeSearchText(String(value || ''))
      .replace(/\s+/g, '_')
      .trim();
  }

  quotePubMedTerm(term = '') {
    const cleaned = String(term || '')
      .replace(/[â€œâ€“”]/g, '"')
      .replace(/[â€˜â€™‘’]/g, ' ')
      .replace(/"/g, '')
      .replace(/[()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) return '';
    if (/\[[^\]]+\]$/.test(cleaned)) return cleaned;
    return /\s/.test(cleaned) ? `"${cleaned}"` : cleaned;
  }

  looksLikePubMedFieldedTerm(term = '') {
    return /\[[^\]]+\]$/.test(String(term || '').trim());
  }

  shouldAddMeshVariant(term = '') {
    const cleaned = String(term || '').trim();
    if (!cleaned) return false;
    if (this.looksLikePubMedFieldedTerm(cleaned)) return false;
    if (/^[A-Z0-9-]{2,}$/.test(cleaned)) return false;
    return true;
  }

  buildFieldedPubMedTerm(term = '', field = 'Title/Abstract') {
    const cleaned = String(term || '')
      .replace(/[â€œâ€“”]/g, '"')
      .replace(/[â€˜â€™‘’]/g, ' ')
      .replace(/"/g, '')
      .replace(/[()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) return '';
    if (this.looksLikePubMedFieldedTerm(cleaned)) return cleaned;

    const quoted = /\s/.test(cleaned) || /-/.test(cleaned) ? `"${cleaned}"` : cleaned;
    return `${quoted}[${field}]`;
  }

  buildPubMedTermVariants(term = '', { includeMesh = true, includeTitleAbstract = true } = {}) {
    const cleaned = String(term || '').trim();
    if (!cleaned) return [];
    if (this.looksLikePubMedFieldedTerm(cleaned)) return [cleaned];

    const variants = [];
    if (includeMesh && this.shouldAddMeshVariant(cleaned)) {
      variants.push(this.buildFieldedPubMedTerm(cleaned, 'MeSH Terms'));
    }
    if (includeTitleAbstract) {
      variants.push(this.buildFieldedPubMedTerm(cleaned, 'Title/Abstract'));
    }
    return [...new Set(variants.filter(Boolean))];
  }

  buildOrQueryClause(terms = [], { includeMesh = true, includeTitleAbstract = true } = {}) {
    const uniqueTerms = [...new Set(
      (Array.isArray(terms) ? terms : [])
        .map(term => String(term || '').trim())
        .filter(Boolean)
    )];

    if (uniqueTerms.length === 0) return '';

    const rendered = uniqueTerms
      .flatMap(term => this.buildPubMedTermVariants(term, { includeMesh, includeTitleAbstract }))
      .filter(Boolean);

    if (rendered.length === 0) return '';
    return rendered.length === 1 ? rendered[0] : `(${rendered.join(' OR ')})`;
  }

  getMappedSearchTermDefinitions(text = '') {
    const normalized = this.normalizeSearchText(text);
    if (!normalized) return [];

    const definitions = [
      {
        regex: /\btnbc\b|triple negative(?: breast cancer)?/,
        titleAbstractTerms: ['triple negative breast cancer', 'TNBC'],
        meshTerms: ['Triple Negative Breast Neoplasms']
      },
      {
        regex: /\bher2\b|\berbb2\b/,
        titleAbstractTerms: ['HER2', 'ERBB2'],
        meshTerms: ['Receptor, ErbB-2']
      },
      {
        regex: /\bhr positive\b|\ber positive\b|hormone receptor positive/,
        titleAbstractTerms: ['hormone receptor positive', 'ER positive'],
        meshTerms: ['Receptors, Estrogen']
      },
      {
        regex: /\bnsclc\b|non small cell lung/,
        titleAbstractTerms: ['non-small cell lung cancer', 'NSCLC'],
        meshTerms: ['Carcinoma, Non-Small-Cell Lung']
      },
      {
        regex: /\bsclc\b|small cell lung/,
        titleAbstractTerms: ['small cell lung cancer', 'SCLC'],
        meshTerms: ['Carcinoma, Small Cell']
      },
      {
        regex: /\bcrc\b|colorectal cancer|colon cancer|rectal cancer/,
        titleAbstractTerms: ['colorectal cancer', 'colon cancer', 'rectal cancer'],
        meshTerms: ['Colorectal Neoplasms']
      },
      {
        regex: /\brcc\b|renal cell carcinoma|kidney cancer/,
        titleAbstractTerms: ['renal cell carcinoma', 'kidney cancer', 'RCC'],
        meshTerms: ['Carcinoma, Renal Cell']
      },
      {
        regex: /\bmetastatic\b|\badvanced\b|\bunresectable\b|\bstage iv\b/,
        titleAbstractTerms: ['metastatic', 'advanced', 'unresectable'],
        meshTerms: ['Neoplasm Metastasis']
      },
      {
        regex: /\bearly stage\b|\blocali[sz]ed\b|\bresectable\b/,
        titleAbstractTerms: ['early-stage', 'localized', 'resectable'],
        meshTerms: []
      },
      {
        regex: /\bneoadjuvant\b|\bnac\b|\bpreoperative\b/,
        titleAbstractTerms: ['neoadjuvant', 'preoperative'],
        meshTerms: ['Neoadjuvant Therapy']
      },
      {
        regex: /\badjuvant\b|\bpostoperative\b/,
        titleAbstractTerms: ['adjuvant', 'postoperative'],
        meshTerms: []
      },
      {
        regex: /\bimmunotherapy\b|checkpoint|pembrolizumab|nivolumab|atezolizumab|durvalumab/,
        titleAbstractTerms: ['immunotherapy', 'immune checkpoint inhibitor', 'pembrolizumab', 'nivolumab', 'atezolizumab', 'durvalumab'],
        meshTerms: ['Immunotherapy', 'Immune Checkpoint Inhibitors']
      },
      {
        regex: /\bpd l1\b|\bpdl1\b/,
        titleAbstractTerms: ['PD-L1', 'programmed death ligand 1'],
        meshTerms: ['B7-H1 Antigen']
      },
      {
        regex: /\bpd 1\b|\bpd1\b/,
        titleAbstractTerms: ['PD-1', 'programmed death 1'],
        meshTerms: ['Programmed Cell Death 1 Receptor']
      },
      {
        regex: /\bmsi\b|microsatellite instability/,
        titleAbstractTerms: ['microsatellite instability', 'MSI-H'],
        meshTerms: ['Microsatellite Instability']
      },
      {
        regex: /\bbrca\b/,
        titleAbstractTerms: ['BRCA mutation', 'BRCA1', 'BRCA2'],
        meshTerms: ['BRCA1 Protein', 'BRCA2 Protein']
      },
      {
        regex: /\boverall survival\b|\bos\b/,
        titleAbstractTerms: ['overall survival'],
        meshTerms: []
      },
      {
        regex: /\bprogression free survival\b|\bpfs\b/,
        titleAbstractTerms: ['progression-free survival'],
        meshTerms: []
      },
      {
        regex: /\bdisease free survival\b|\bdfs\b/,
        titleAbstractTerms: ['disease-free survival'],
        meshTerms: []
      },
      {
        regex: /\bevent free survival\b|\befs\b/,
        titleAbstractTerms: ['event-free survival'],
        meshTerms: []
      },
      {
        regex: /\bpathologic(?:al)? complete response\b|\bpcr\b/,
        titleAbstractTerms: ['pathologic complete response'],
        meshTerms: []
      },
      {
        regex: /\bobjective response rate\b|\borr\b/,
        titleAbstractTerms: ['objective response rate'],
        meshTerms: []
      },
      {
        regex: /\bsafety\b|\btoxicity\b|adverse events?/,
        titleAbstractTerms: ['safety', 'toxicity', 'adverse events'],
        meshTerms: ['Drug-Related Side Effects and Adverse Reactions']
      }
    ];

    return definitions
      .filter(definition => definition.regex.test(normalized));
  }

  buildSearchClauseFromText(value = '', { fallbackPhrase = true, fallbackTokenLimit = 4 } = {}) {
    const rawValue = String(value || '').trim();
    if (!rawValue) return '';

    const mappedDefinitions = this.getMappedSearchTermDefinitions(rawValue);
    const clauses = mappedDefinitions
      .map(definition => {
        const meshClause = this.buildOrQueryClause(definition.meshTerms || [], {
          includeMesh: true,
          includeTitleAbstract: false
        });
        const titleAbstractClause = this.buildOrQueryClause(definition.titleAbstractTerms || [], {
          includeMesh: false,
          includeTitleAbstract: true
        });
        const combined = [meshClause, titleAbstractClause].filter(Boolean);
        if (combined.length === 0) return '';
        return combined.length === 1 ? combined[0] : `(${combined.join(' OR ')})`;
      })
      .filter(Boolean);

    const coveredTokens = new Set(mappedDefinitions.flatMap(definition =>
      [...(definition.titleAbstractTerms || []), ...(definition.meshTerms || [])]
        .flatMap(term => this.normalizeSearchText(term).split(' ').filter(Boolean))
    ));

    const fallbackTokens = this.buildKeywordFocusedQuery(rawValue)
      .split(' ')
      .filter(Boolean)
      .filter(token => !coveredTokens.has(this.normalizeSearchText(token)));

    const tokenClause = fallbackTokens.length > 0
      ? fallbackTokens
        .slice(0, fallbackTokenLimit)
        .map(token => this.buildOrQueryClause([token], {
          includeMesh: true,
          includeTitleAbstract: true
        }))
        .filter(Boolean)
        .join(' AND ')
      : '';

    if (clauses.length === 0 && fallbackPhrase && /\s/.test(rawValue)) {
      clauses.push(this.buildOrQueryClause([rawValue], {
        includeMesh: true,
        includeTitleAbstract: true
      }));
    }

    if (tokenClause) {
      clauses.push(tokenClause);
    }

    return [...new Set(clauses.filter(Boolean))].join(' AND ');
  }

  mapStudyTypePreferenceToSearchTerms(value = '') {
    const key = this.normalizePreferenceKey(value);
    const mapping = {
      randomized: ['randomized', 'randomised', 'randomized controlled trial'],
      randomized_controlled_trial: ['randomized controlled trial', 'randomized', 'randomised'],
      rct: ['randomized controlled trial', 'randomized', 'randomised'],
      systematic_review: ['systematic review', 'meta-analysis'],
      meta_analysis: ['meta-analysis', 'systematic review'],
      observational: ['observational', 'cohort', 'registry', 'real-world'],
      comparative_study: ['comparative study', 'head-to-head'],
      clinical_trial: ['clinical trial', 'trial'],
      guideline: ['guideline', 'practice guideline'],
      real_world: ['real-world', 'registry', 'cohort'],
      phase_1: ['phase I', 'phase 1'],
      phase_i: ['phase I', 'phase 1'],
      phase_2: ['phase II', 'phase 2'],
      phase_ii: ['phase II', 'phase 2'],
      phase_3: ['phase III', 'phase 3'],
      phase_iii: ['phase III', 'phase 3']
    };

    return mapping[key] || [];
  }

  mapEndpointPreferenceToSearchTerms(value = '') {
    const key = this.normalizePreferenceKey(value);
    const mapping = {
      pcr: ['pathologic complete response'],
      efs: ['event-free survival'],
      dfs: ['disease-free survival'],
      pfs: ['progression-free survival'],
      os: ['overall survival'],
      orr: ['objective response rate'],
      safety: ['safety', 'toxicity', 'adverse events'],
      toxicity: ['toxicity', 'adverse events', 'safety'],
      grade34ae: ['grade 3 adverse events', 'grade 4 adverse events'],
      grade_3_4_ae: ['grade 3 adverse events', 'grade 4 adverse events']
    };

    return mapping[key] || [];
  }

  mapTrialPhasePreferenceToSearchTerms(value = '') {
    const key = this.normalizePreferenceKey(value);
    const mapping = {
      phase_1: ['phase I', 'phase 1'],
      phase_i: ['phase I', 'phase 1'],
      phase_2: ['phase II', 'phase 2'],
      phase_ii: ['phase II', 'phase 2'],
      phase_3: ['phase III', 'phase 3'],
      phase_iii: ['phase III', 'phase 3']
    };

    return mapping[key] || [];
  }

  buildPreferenceQueryClause(values = [], mapper = () => []) {
    if (!Array.isArray(values) || values.length === 0) return '';

    const terms = [...new Set(values.flatMap(value => mapper.call(this, value)).filter(Boolean))];
    return this.buildOrQueryClause(terms, {
      includeMesh: false,
      includeTitleAbstract: true
    });
  }

  buildConceptSearchQuery(question = '', options = {}) {
    const source = [
      question,
      options.population,
      options.intervention,
      options.comparator,
      options.outcomes,
      options.biomarker,
      options.lineOfTherapy
    ]
      .filter(Boolean)
      .join(' ');

    return this.buildSearchClauseFromText(this.stripNonClinicalTerms(source), {
      fallbackPhrase: false,
      fallbackTokenLimit: 5
    });
  }

  buildFallbackSearchQueries(question = '', standaloneQuestion = '', options = {}) {
    const queries = [];
    const pushUnique = (queryText) => {
      const normalized = this.sanitizePubMedQuery(queryText);
      if (!normalized) return;
      if (!queries.some(existing => existing.toLowerCase() === normalized.toLowerCase())) {
        queries.push(normalized);
      }
    };

    pushUnique(this.buildStructuredSearchQuery(question, options));
    pushUnique(this.buildConceptSearchQuery(question, options));
    pushUnique(this.buildKeywordFocusedQuery(question, options));
    if (standaloneQuestion && standaloneQuestion !== question) {
      pushUnique(this.buildStructuredSearchQuery(standaloneQuestion, options));
      pushUnique(this.buildConceptSearchQuery(standaloneQuestion, options));
      pushUnique(this.buildKeywordFocusedQuery(standaloneQuestion, options));
    }

    // Use cleaned keyword query as raw fallback (strips policy/country terms)
    const cleanedFallback = this.buildKeywordFocusedQuery(question, options);
    if (cleanedFallback) {
      pushUnique(cleanedFallback);
    }

    return queries.slice(0, this.maxSearchQueries);
  }

  applyRecencyFilterToQuery(query = '', recency = 'any') {
    const normalized = this.sanitizePubMedQuery(query);
    if (!normalized) return '';

    const recencyMap = {
      last_3_years: 3,
      last_5_years: 5,
      last_10_years: 10
    };
    const yearsWindow = recencyMap[String(recency || '').toLowerCase()];
    if (!yearsWindow) return normalized;

    if (/\[pdat\]|\[date - publication\]/i.test(normalized)) {
      return normalized;
    }

    const currentYear = new Date().getFullYear();
    const startYear = currentYear - yearsWindow;
    return `(${normalized}) AND (${startYear}:3000[pdat])`;
  }

  detectClinicalFocus(question = '', options = {}) {
    const source = [
      question,
      options.population,
      options.intervention,
      options.comparator,
      options.outcomes,
      options.biomarker
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return {
      wantsTNBC: /\btnbc\b|triple[-\s]?negative/.test(source),
      wantsNeoadjuvant: /\bneoadjuvant\b|\bnac\b|\bpreoperative\b/.test(source),
      wantsAdjuvant: /\badjuvant\b|\bpostoperative\b/.test(source) && !/\bneoadjuvant\b/.test(source),
      wantsMetastatic: /\bmetastatic\b|\badvanced\b|\bunresectable\b|\bstage iv\b|\bm1\b/.test(source),
      wantsEarlyStage: /\bearly[-\s]?stage\b|\bearly breast cancer\b|\bresectable\b|\blocali[sz]ed\b/.test(source),
      wantsHER2Positive: /\bher2[-\s]?(positive|\+)|\bher2\+\b/.test(source),
      wantsHER2Negative: /\bher2[-\s]?negative\b|\bher2-\b/.test(source),
      wantsHRPositive: /\bhr[-\s]?\+|\bhormone receptor[-\s]?positive\b|\ber[-\s]?\+/.test(source),
      wantsPlaceboComparator: /\bplacebo\b/.test(source),
      wantsImmunotherapy: /\bimmunotherapy\b|\bcheckpoint\b|\bpd-1\b|\bpd-l1\b|\bpembrolizumab\b|\bnivolumab\b|\batezolizumab\b|\bdurvalumab\b/.test(source),
      wantsBiomarker: /\bbiomarker\b|\bpredictive marker\b|\bpredictive markers\b|\bpd-l1\b|\bki[-\s]?67\b|\btumou?r[-\s]infiltrating lymphocytes\b|\btils?\b|\bgene signature\b|\bmolecular\b|\bctdna\b|\bcirculating tumor dna\b|\bon-treatment biops(?:y|ies)\b|\bresidual cancer burden\b/.test(source),
      wantsTreatmentComparison: Boolean(options.intervention || options.comparator) || /\bcompare\b|\bcomparison\b|\bversus\b|\bvs\b|\bhead[-\s]?to[-\s]?head\b/.test(source),
      wantsQualityOfLife: /\bquality[-\s]?of[-\s]?life\b|\bhealth[-\s]?related quality[-\s]?of[-\s]?life\b|\bhrqol\b|\bpatient[-\s]?reported outcomes?\b|\bpros?\b|\bqol\b/.test(source),
      // Expanded cancer-type detection
      wantsNSCLC: /\bnsclc\b|\bnon[-\s]?small[-\s]?cell[-\s]?lung\b/.test(source),
      wantsSCLC: /\bsclc\b|\bsmall[-\s]?cell[-\s]?lung\b/.test(source),
      wantsLungCancer: /\blung cancer\b|\blung adenocarcinoma\b|\bnsclc\b|\bsclc\b/.test(source),
      wantsCRC: /\bcrc\b|\bcolorectal\b|\bcolon cancer\b|\brectal cancer\b/.test(source),
      wantsRCC: /\brcc\b|\brenal[-\s]?cell\b|\bkidney cancer\b/.test(source),
      wantsHCC: /\bhcc\b|\bhepatocellular\b|\bliver cancer\b/.test(source),
      wantsMelanoma: /\bmelanoma\b|\bcutaneous melanoma\b|\buveal melanoma\b/.test(source),
      wantsGBM: /\bgbm\b|\bglioblastoma\b|\bglioma\b/.test(source),
      wantsPancreatic: /\bpancreatic\b|\bpdac\b|\bpancreas\b/.test(source),
      wantsOvarian: /\bovarian\b|\bepithelial ovarian\b|\bfallopian\b/.test(source),
      wantsProstate: /\bprostate\b|\bcrpc\b|\bmcrpc\b|\bcastration[-\s]?resistant\b/.test(source),
      wantsBladder: /\bbladder\b|\burothelial\b|\buc\b/.test(source),
      wantsGastric: /\bgastric\b|\bstomach\b|\bgastroesophageal\b|\bgej\b/.test(source),
      wantsBreast: /\bbreast\b|\bbrca\b|\btnbc\b|\bher2\b|\bhr\+/.test(source),
      wantsLymphoma: /\blymphoma\b|\bdlbcl\b|\bfollicular\b|\bhodgkin\b|\bnhl\b/.test(source),
      wantsMyeloma: /\bmyeloma\b|\bmm\b|\bmultiple myeloma\b/.test(source),
      wantsLeukemia: /\bleukemia\b|\baml\b|\ball\b|\bcll\b|\bcml\b/.test(source),
      wantsHeadNeck: /\bhead and neck\b|\bhnscc\b|\bnasopharyngeal\b|\bsquamous cell carcinoma of the head\b/.test(source),
      wantsMesothelioma: /\bmesothelioma\b|\bpleural\b/.test(source),
      wantsThyroid: /\bthyroid\b|\bdifferentiated thyroid\b|\banaplastic thyroid\b/.test(source),
      wantsSarcoma: /\bsarcoma\b|\bsoft tissue sarcoma\b|\bosteosarcoma\b|\bewing\b|\bgist\b/.test(source),
      // Expanded biomarker detection
      wantsEGFR: /\begfr\b|\begfr[-\s]?(mutant|mutation|\+|positive|del19|exon|l858r|t790m|c797s)/.test(source),
      wantsALK: /\balk\b|\balk[-\s]?(positive|rearrange|fusion|\+|translocation)/.test(source),
      wantsROS1: /\bros1\b|\bros[-\s]?1/.test(source),
      wantsKRAS: /\bkras\b|\bkras[-\s]?g12c\b/.test(source),
      wantsBRAF: /\bbraf\b|\bbraf[-\s]?v600/.test(source),
      wantsMSI: /\bmsi[-\s]?h\b|\bmmr[-\s]?d\b|\bmicrosatellite[-\s]?instability\b|\bmmr[-\s]?deficien/.test(source),
      wantsPDL1: /\bpd[-\s]?l1\b|\btps\b|\bcps\b/.test(source),
      wantsNTRK: /\bntrk\b|\bneurotrophic\b|\blarotrectinib\b|\bentrectinib\b/.test(source),
      wantsRET: /\bret\b|\bret[-\s]?(fusion|mutation|rearrange|alteration)/.test(source),
      wantsMET: /\bmet\b|\bmet[-\s]?(exon|amplif|skip|ex14)/.test(source),
      wantsFGFR: /\bfgfr\b|\bfgfr[-\s]?[1234]/.test(source),
      wantsTMB: /\btmb\b|\btumou?r[-\s]?mutational[-\s]?burden\b/.test(source),
      wantsBRCA: /\bbrca\b|\bbrca[-\s]?[12]\b|\bhrd\b|\bhomologous[-\s]?recombination\b/.test(source),
      // Drug-specific detection
      detectedDrugs: this.extractDrugMentions(source)
    };
  }

  extractDrugMentions(text = '') {
    const drugFamilies = {
      'pembrolizumab': /\bpembrolizumab\b|\bkeytruda\b|\bmk[-\s]?3475\b/,
      'nivolumab': /\bnivolumab\b|\bopdivo\b/,
      'atezolizumab': /\batezolizumab\b|\btecentriq\b/,
      'durvalumab': /\bdurvalumab\b|\bimfinzi\b/,
      'avelumab': /\bavelumab\b|\bbavencio\b/,
      'cemiplimab': /\bcemiplimab\b|\blibtayo\b/,
      'tremelimumab': /\btremelimumab\b/,
      'ipilimumab': /\bipilimumab\b|\byervoy\b/,
      'trastuzumab': /\btrastuzumab\b|\bherceptin\b/,
      'pertuzumab': /\bpertuzumab\b|\bperjeta\b/,
      'trastuzumab-deruxtecan': /\btrastuzumab[-\s]?deruxtecan\b|\bt[-\s]?dxd\b|\benhertu\b|\bds[-\s]?8201\b/,
      'sacituzumab-govitecan': /\bsacituzumab\b|\btrodelvy\b/,
      'enfortumab-vedotin': /\benfortumab\b|\bpadcev\b/,
      'osimertinib': /\bosimertinib\b|\btagrisso\b/,
      'sotorasib': /\bsotorasib\b|\blumakras\b/,
      'adagrasib': /\badagrasib\b|\bkrazati\b/,
      'olaparib': /\bolaparib\b|\blynparza\b/,
      'niraparib': /\bniraparib\b|\bzejula\b/,
      'rucaparib': /\brucaparib\b|\brubraca\b/,
      'talazoparib': /\btalazoparib\b|\btalzenna\b/,
      'palbociclib': /\bpalbociclib\b|\bibrance\b/,
      'ribociclib': /\bribociclib\b|\bkisqali\b/,
      'abemaciclib': /\babemaciclib\b|\bverzenio\b/,
      'enzalutamide': /\benzalutamide\b|\bxtandi\b/,
      'abiraterone': /\babiraterone\b|\bzytiga\b/,
      'bevacizumab': /\bbevacizumab\b|\bavastin\b/,
      'lenvatinib': /\blenvatinib\b|\blenvima\b/,
      'cabozantinib': /\bcabozantinib\b|\bcabometyx\b|\bcometriq\b/,
      'sunitinib': /\bsunitinib\b|\bsutent\b/,
      'sorafenib': /\bsorafenib\b|\bnexavar\b/,
      'axitinib': /\baxitinib\b|\binlyta\b/,
      'regorafenib': /\bregorafenib\b|\bstivarga\b/,
      'vemurafenib': /\bvemurafenib\b|\bzelboraf\b/,
      'dabrafenib': /\bdabrafenib\b|\btafinlar\b/,
      'trametinib': /\btrametinib\b|\bmekinist\b/,
      'encorafenib': /\bencorafenib\b|\bbraftovi\b/,
      'binimetinib': /\bbinimetinib\b|\bmektovi\b/,
      'lorlatinib': /\blorlatinib\b|\blorbrena\b/,
      'alectinib': /\balectinib\b|\balecensa\b/,
      'crizotinib': /\bcrizotinib\b|\bxalkori\b/,
      'brigatinib': /\bbrigatinib\b|\balunbrig\b/,
      'ceritinib': /\bceritinib\b|\bzykadia\b/,
      'selpercatinib': /\bselpercatinib\b|\bretevmo\b/,
      'pralsetinib': /\bpralsetinib\b|\bgavreto\b/,
      'larotrectinib': /\blarotrectinib\b|\bvitrakvi\b/,
      'entrectinib': /\bentrectinib\b|\brozlytrek\b/,
      'tucatinib': /\btucatinib\b|\btukysa\b/,
      'neratinib': /\bneratinib\b|\bnerlynx\b/,
      'erdafitinib': /\berdafitinib\b|\bbalversa\b/,
      'capmatinib': /\bcapmatinib\b|\btabrecta\b/,
      'tepotinib': /\btepotinib\b|\btepmetko\b/,
      'ibrutinib': /\bibrutinib\b|\bimbruvica\b/,
      'acalabrutinib': /\bacalabrutinib\b|\bcalquence\b/,
      'zanubrutinib': /\bzanubrutinib\b|\bbrukinsa\b/,
      'venetoclax': /\bvenetoclax\b|\bvenclexta\b/,
      'ivosidenib': /\bivosidenib\b|\btibsovo\b/,
      'enasidenib': /\benasidenib\b|\bidhifa\b/,
      'polatuzumab': /\bpolatuzumab\b|\bpolivy\b/,
      'elacestrant': /\belacestrant\b|\borserdu\b/,
      'fulvestrant': /\bfulvestrant\b|\bfaslodex\b/,
      'tamoxifen': /\btamoxifen\b|\bnolvadex\b/,
      'letrozole': /\bletrozole\b|\bfemara\b/,
      'anastrozole': /\banastrozole\b|\barimidex\b/,
      'exemestane': /\bexemestane\b|\baromasin\b/
    };
    const found = [];
    for (const [drug, pattern] of Object.entries(drugFamilies)) {
      if (pattern.test(text)) found.push(drug);
    }
    return found;
  }

  getNormalizedPublicationTypes(article = {}) {
    return (Array.isArray(article?.publicationTypes) ? article.publicationTypes : [])
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean);
  }

  classifyEvidenceTier(article = {}) {
    const publicationTypes = this.getNormalizedPublicationTypes(article);
    const text = `${article?.studyDesign || ''} ${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();

    const hasType = (...needles) => needles.some(needle =>
      publicationTypes.some(type => type.includes(String(needle).toLowerCase()))
    );

    if (hasType('practice guideline', 'guideline')) {
      return { label: 'guideline', weight: 0.5, include: true };
    }
    if (hasType('systematic review', 'meta-analysis') || /systematic review|meta-analysis|meta analysis/.test(text)) {
      return { label: 'systematic-review', weight: 0.65, include: true };
    }
    if (hasType('randomized controlled trial') || /phase iii|phase 3/.test(text)) {
      return { label: 'phase-iii-rct', weight: 0.75, include: true };
    }
    if (hasType('clinical trial') || /randomized|phase ii|phase 2|prospective/.test(text)) {
      return { label: 'clinical-trial', weight: 0.45, include: true };
    }
    if (hasType('case reports', 'comment', 'editorial', 'letter', 'news', 'published erratum')) {
      return { label: 'excluded-publication-type', weight: -1, include: false };
    }
    if (hasType('observational study', 'comparative study') || /retrospective|cohort|real-world|registry/.test(text)) {
      return { label: 'observational', weight: 0.18, include: true };
    }

    return { label: 'journal-article', weight: 0.05, include: true };
  }

  getArticleFocusProfile(article = {}) {
    const text = `${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();
    const titleText = `${article?.title || ''}`.toLowerCase();
    const hrPositivePattern = /\bhr[-\s]?\+|\bhormone receptor[-\s]?positive\b|\ber[-\s]?\+|\bestrogen receptor[-\s]?positive\b/;
    const her2PositivePattern = /\bher2[-\s]?(positive|\+)|\bher2\+\b/;
    const her2NegativePattern = /\bher2[-\s]?negative\b|\bher2-\b/;
    const nonTNBCSubtypePattern = /\bhr[-\s]?\+\b|\ber[-\s]?\+\b|\ber\s*\+\s*\/\s*her2\s*-\b|\bhormone receptor[-\s]?positive\b|\bestrogen receptor[-\s]?positive\b|\bluminal\b/;
    const tnbcPattern = /\btnbc\b|triple[-\s]?negative/;

    return {
      mentionsTNBC: tnbcPattern.test(text),
      mentionsHER2Positive: her2PositivePattern.test(text),
      mentionsHER2Negative: her2NegativePattern.test(text),
      mentionsHRPositive: hrPositivePattern.test(text),
      mentionsNonTNBCSubtype: nonTNBCSubtypePattern.test(text),
      titleMentionsTNBC: tnbcPattern.test(titleText),
      titleMentionsHER2Positive: her2PositivePattern.test(titleText),
      titleMentionsHER2Negative: her2NegativePattern.test(titleText),
      titleMentionsHRPositive: hrPositivePattern.test(titleText),
      titleMentionsNonTNBCSubtype: nonTNBCSubtypePattern.test(titleText),
      mentionsMetastatic: /\bmetastatic\b|\badvanced\b|\bunresectable\b|\bstage iv\b|\bm1\b/.test(text),
      mentionsNeoadjuvant: /\bneoadjuvant\b|\bnac\b|\bpreoperative\b/.test(text),
      mentionsAdjuvant: /\badjuvant\b|\bpostoperative\b/.test(text),
      mentionsEarlyStage: /\bearly[-\s]?stage\b|\bearly breast cancer\b|\bresectable\b|\blocali[sz]ed\b/.test(text),
      mentionsImmunotherapy: /\bimmunotherapy\b|\bcheckpoint\b|\bpd-1\b|\bpd-l1\b|\bpembrolizumab\b|\bnivolumab\b|\batezolizumab\b|\bdurvalumab\b/.test(text),
      mentionsBiomarkerFocus: /\bbiomarker\b|\bpredictive marker\b|\bpredictive markers\b|\bki[-\s]?67\b|\bpd[-\s]?l1\b|\btumou?r[-\s]infiltrating lymphocytes\b|\btils?\b|\bgene signature\b|\bimmune microenvironment\b|\bctdna\b|\bcirculating tumor dna\b|\bon-treatment biops(?:y|ies)\b|\bpredict response\b|\bresidual cancer burden\b/.test(text),
      mentionsHighRisk: /\bhigh[-\s]?risk\b/.test(text),
      mentionsLocallyAdvanced: /\blocally advanced\b/.test(text),
      mentionsQualityOfLife: /\bquality[-\s]?of[-\s]?life\b|\bhealth[-\s]?related quality[-\s]?of[-\s]?life\b|\bhrqol\b|\bpatient[-\s]?reported outcomes?\b|\bqol\b|\bquestionnaire\b|\bfact-b\b|\beortc\b/.test(text),
      titleMentionsTrial: /\btrial\b|\bstudy\b/.test(titleText),
      // Cancer-type detection for hard-filtering
      mentionsCRC: /\bcrc\b|\bcolorectal\b|\bcolon cancer\b|\brectal cancer\b/.test(text),
      mentionsNSCLC: /\bnsclc\b|\bnon[-\s]?small[-\s]?cell[-\s]?lung\b|\blung adenocarcinoma\b|\blung squamous\b/.test(text),
      mentionsSCLC: /\bsclc\b|\bsmall[-\s]?cell[-\s]?lung\b/.test(text),
      mentionsLungCancer: /\blung cancer\b|\blung adenocarcinoma\b|\bnsclc\b|\bsclc\b/.test(text),
      mentionsRCC: /\brcc\b|\brenal[-\s]?cell\b|\bkidney cancer\b/.test(text),
      mentionsHCC: /\bhcc\b|\bhepatocellular\b|\bliver cancer\b/.test(text),
      mentionsMelanoma: /\bmelanoma\b/.test(text),
      mentionsPancreatic: /\bpancreatic\b|\bpdac\b/.test(text),
      mentionsOvarian: /\bovarian\b|\bfallopian\b/.test(text),
      mentionsProstate: /\bprostate\b|\bcrpc\b|\bmcrpc\b|\bcastration[-\s]?resistant\b/.test(text),
      mentionsBladder: /\bbladder\b|\burothelial\b/.test(text),
      mentionsGastric: /\bgastric\b|\bstomach\b|\bgastroesophageal\b/.test(text),
      mentionsBreast: /\bbreast\b/.test(text),
      mentionsLymphoma: /\blymphoma\b|\bdlbcl\b|\bfollicular\b|\bhodgkin\b/.test(text),
      mentionsEndometrial: /\bendometri\w+\b|\buterine\b|\bendometrium\b/.test(text),
      mentionsHeadNeck: /\bhead and neck\b|\bhnscc\b|\bnasopharyngeal\b/.test(text),
      mentionsMesothelioma: /\bmesothelioma\b/.test(text),
      mentionsGBM: /\bgbm\b|\bglioblastoma\b|\bglioma\b/.test(text),
      detectedDrugs: this.extractDrugMentions(text)
    };
  }

  isQualityOfLifeFocusedPublication(article = {}, summary = null) {
    const text = `${summary?.study_design || ''} ${summary?.outcomes || ''} ${summary?.key_findings || ''} ${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();
    if (!text.trim()) return false;

    return /\bquality[-\s]?of[-\s]?life\b|\bhealth[-\s]?related quality[-\s]?of[-\s]?life\b|\bhrqol\b|\bpatient[-\s]?reported outcomes?\b|\bqol\b|\bquestionnaire\b|\bfact-b\b|\beortc\b|\beq-5d\b/.test(text);
  }

  isExploratoryAnalysisPublication(article = {}, summary = null) {
    const text = `${summary?.study_design || ''} ${article?.studyDesign || ''} ${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();
    if (!text.trim()) return false;

    return /\bexploratory analysis\b|\bpost hoc\b|\bsecondary analysis\b|\bsubgroup analysis\b|\bcorrelative\b|\btranslational\b|\bresidual cancer burden\b/.test(text);
  }

  hasArticleTrialSignals(article = {}) {
    const trialName = this.sanitizeEvidenceField(article?.trialName || '');
    const text = `${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();
    const designText = `${article?.studyDesign || ''}`.toLowerCase();
    if (!text.trim() && !trialName && !designText.trim()) return false;

    if (trialName && this.looksLikeTrialIdentifier(trialName)) {
      return true;
    }

    if (/\btrial\b|\bstudy\b|\brandomi[sz]ed\b|\bversus\b|\bvs\b|\bplacebo\b|\bdouble-blind\b|\bcontrol(?:led)?\b|\bcompared with\b|\bcompared to\b|\barm\b/.test(text)) {
      return true;
    }

    const hasSpecificRegimenCue = /\b(pembrolizumab|nivolumab|ipilimumab|camrelizumab|olaparib|denosumab|zoledronic acid|trastuzumab|atezolizumab|durvalumab|paclitaxel|carboplatin|cisplatin|docetaxel|chemotherapy)\b/.test(text);
    const hasDesignCue = /\brandomi[sz]ed\b|\bphase\s*(?:i|ii|iii|1|2|3)\b|\bcontrolled\b/.test(designText);
    return hasDesignCue && hasSpecificRegimenCue;
  }

  isNarrativeReviewPublication(article = {}, summary = null) {
    const text = `${summary?.analysis_type || ''} ${summary?.study_design || ''} ${article?.studyDesign || ''} ${article?.title || ''}`.toLowerCase();
    if (!text.trim()) return false;
    if (/systematic review|meta-analysis|meta analysis|network meta-analysis/.test(text)) return false;

    return /\breview\b|\boverview\b|\bupdate\b|\brecent trials?\b|\bstate of the art\b|\bcurrent status\b|\bperspective\b|\bexpert opinion\b/.test(text);
  }

  isGenericTopicPublication(article = {}, summary = null) {
    const title = `${article?.title || ''}`.trim().toLowerCase();
    if (!title) return false;
    if (this.isNarrativeReviewPublication(article, summary)) return true;

    const hasComparatorCueInTitle = /\bversus\b|\bvs\b|\bcompared with\b|\bplacebo\b|\bdouble-blind\b|\brandomi[sz]ed\b/.test(title);
    const genericClassCue = /\bimmune checkpoint inhibitors?\b|\bbone-modifying agents?\b|\bbisphosphonate therapy\b|\bbisphosphonates?\b|\bimmunotherapy\b|\btargeted therapy\b|\bneoadjuvant treatment\b|\badjuvant treatment\b/.test(title);
    const broadTopicPattern = /^[a-z0-9 ,()'\/-]+(?: in | for |: )[a-z0-9 ,()'\/-]+\.?$/i.test(title);
    const specificDrugCue = /\b(pembrolizumab|nivolumab|ipilimumab|camrelizumab|olaparib|denosumab|zoledronic acid|trastuzumab|atezolizumab|durvalumab|paclitaxel|carboplatin|cisplatin|docetaxel)\b/.test(title);
    const explicitTrialCue = this.looksLikeTrialIdentifier(article?.trialName || '');

    if (explicitTrialCue || hasComparatorCueInTitle || specificDrugCue) {
      return false;
    }

    return broadTopicPattern && genericClassCue;
  }

  isBiomarkerFocusedPublication(article = {}, summary = null) {
    const analysisType = this.getNormalizedAnalysisType(summary);
    if (analysisType === 'biomarker') return true;

    const title = `${article?.title || ''}`.toLowerCase();
    const text = `${summary?.study_design || ''} ${summary?.population || ''} ${summary?.outcomes || ''} ${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();
    if (!text.trim()) return false;

    const biomarkerSignals = /\bbiomarker\b|\bpredictive marker\b|\bpredictive markers\b|\bmarker of response\b|\bki[-\s]?67\b|\bpd[-\s]?l1\b|\btumou?r[-\s]infiltrating lymphocytes\b|\btils?\b|\bgene signature\b|\bimmune microenvironment\b|\bmolecular signature\b|\bctdna\b|\bcirculating tumor dna\b|\bon-treatment biops(?:y|ies)\b|\bpredict(?:ing|ive)? response\b|\bcorrelative\b|\btranslational\b|\bresidual cancer burden\b/;
    const treatmentSignals = /\brandomi[sz]ed\b|\bphase\s*(?:i|ii|iii|1|2|3)\b|\bplacebo\b|\bversus\b|\bvs\b|\bcontrol arm\b|\bchemotherapy\b|\bpembrolizumab\b|\bcamrelizumab\b|\btrial\b/;

    return biomarkerSignals.test(title) || (biomarkerSignals.test(text) && !treatmentSignals.test(title));
  }

  hasDirectComparativeSignals(article = {}, summary = null) {
    const text = `${summary?.analysis_type || ''} ${summary?.study_design || ''} ${article?.studyDesign || ''} ${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();
    if (!text.trim()) return false;
    if (/systematic review|meta-analysis|meta analysis|network meta-analysis/.test(text)) {
      return false;
    }
    if (this.isNarrativeReviewPublication(article, summary) || this.isGenericTopicPublication(article, summary)) {
      return false;
    }

    const comparator = this.inferComparatorLabel(article, summary).toLowerCase();
    if (comparator && !/\bsingle-arm\b|\bno control\b/.test(comparator)) {
      const articleText = `${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();
      const directCue = /\bplacebo-controlled\b|\bplacebo controlled\b|\bdouble-blind\b|\bversus\b|\bvs\b|\bcompared with\b|\bcompared to\b|\bcontrol arm\b|\bactive comparator\b|\brandomi[sz]ed controlled trial\b|\bcontrolled trial\b/.test(articleText) ||
        /\brandomi[sz]ed\b[\s\S]{0,80}\b(placebo|control|comparator|versus|vs\b|arm|standard of care|standard treatment|chemotherapy alone|standard chemotherapy)\b/.test(articleText);
      if (directCue || this.hasArticleTrialSignals(article)) {
        return true;
      }
    }

    return (
      (
        /\bplacebo-controlled\b|\bplacebo controlled\b|\bdouble-blind\b|\bversus\b|\bvs\b|\bcompared with\b|\bcompared to\b|\bcontrol arm\b|\bactive comparator\b|\brandomi[sz]ed controlled trial\b|\bcontrolled trial\b/.test(text) ||
        /\brandomi[sz]ed\b[\s\S]{0,80}\b(placebo|control|comparator|versus|vs\b|arm|standard of care|standard treatment|chemotherapy alone|standard chemotherapy)\b/.test(text)
      ) &&
      !/\bsingle-arm\b|\buncontrolled\b|\bwithout a control arm\b/.test(text)
    );
  }

  hasLateEndpointSignal(article = {}, summary = null) {
    const metrics = article?.endpointMetrics || {};
    if (metrics.os || metrics.efs || metrics.dfs || metrics.pfs) return true;

    const text = `${summary?.outcomes || ''} ${summary?.key_findings || ''} ${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();
    return /\boverall survival\b|\bevent[- ]free survival\b|\bdisease[- ]free survival\b|\bprogression[- ]free survival\b/.test(text);
  }

  hasOverallSurvivalSignal(article = {}, summary = null) {
    const metrics = article?.endpointMetrics || {};
    if (metrics.os) return true;

    const text = `${summary?.outcomes || ''} ${summary?.key_findings || ''} ${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();
    return /\boverall survival\b/.test(text);
  }

  isNonActionablePublication(article = {}) {
    const publicationTypes = this.getNormalizedPublicationTypes(article);
    const text = `${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();

    if (publicationTypes.some(type =>
      /comment|editorial|letter|news|published erratum|biography|interview|congress|case reports/.test(type)
    )) {
      return true;
    }

    return /\bcommentary\b|\beditorial\b|\bletter to the editor\b/.test(text);
  }

  hasStrongClinicalMismatch(article = {}, focus = {}) {
    const profile = this.getArticleFocusProfile(article);

    if (focus.wantsTNBC) {
      if (profile.titleMentionsNonTNBCSubtype && !profile.titleMentionsTNBC) return true;
      if ((profile.mentionsHRPositive || profile.mentionsHER2Positive || profile.mentionsNonTNBCSubtype) && !profile.mentionsTNBC) return true;
      if (!profile.mentionsTNBC) return true;
    }
    if (focus.wantsHER2Positive && !profile.mentionsHER2Positive) return true;
    if (focus.wantsHER2Negative && profile.mentionsHER2Positive && !profile.mentionsHER2Negative) return true;
    if (focus.wantsHRPositive && !profile.mentionsHRPositive) return true;
    if (focus.wantsTreatmentComparison && !focus.wantsBiomarker && this.isBiomarkerFocusedPublication(article) && !this.hasDirectComparativeSignals(article) && !this.isExploratoryAnalysisPublication(article)) {
      return true;
    }

    if (focus.wantsMetastatic) {
      if (!profile.mentionsMetastatic && (profile.mentionsNeoadjuvant || profile.mentionsAdjuvant || profile.mentionsEarlyStage)) {
        return true;
      }
    }

    if (focus.wantsNeoadjuvant && !profile.mentionsNeoadjuvant) return true;
    if (focus.wantsAdjuvant && !profile.mentionsAdjuvant && profile.mentionsNeoadjuvant) return true;
    if (focus.wantsEarlyStage && profile.mentionsMetastatic && !profile.mentionsEarlyStage) return true;
    if (focus.wantsImmunotherapy && !profile.mentionsImmunotherapy) return true;

    // ── Cancer-type hard-rejection ──────────────────────────────────────────
    // If the user asks about a specific cancer type and the article is clearly
    // about a DIFFERENT cancer type, hard-reject it. This prevents e.g.
    // endometrial cancer articles from appearing in colorectal cancer queries.
    const cancerTypeHardChecks = [
      { wantsFlag: 'wantsCRC', mentionsFlag: 'mentionsCRC', label: 'CRC' },
      { wantsFlag: 'wantsNSCLC', mentionsFlag: 'mentionsNSCLC', label: 'NSCLC' },
      { wantsFlag: 'wantsSCLC', mentionsFlag: 'mentionsSCLC', label: 'SCLC' },
      { wantsFlag: 'wantsRCC', mentionsFlag: 'mentionsRCC', label: 'RCC' },
      { wantsFlag: 'wantsHCC', mentionsFlag: 'mentionsHCC', label: 'HCC' },
      { wantsFlag: 'wantsMelanoma', mentionsFlag: 'mentionsMelanoma', label: 'Melanoma' },
      { wantsFlag: 'wantsPancreatic', mentionsFlag: 'mentionsPancreatic', label: 'Pancreatic' },
      { wantsFlag: 'wantsOvarian', mentionsFlag: 'mentionsOvarian', label: 'Ovarian' },
      { wantsFlag: 'wantsProstate', mentionsFlag: 'mentionsProstate', label: 'Prostate' },
      { wantsFlag: 'wantsBladder', mentionsFlag: 'mentionsBladder', label: 'Bladder' },
      { wantsFlag: 'wantsGastric', mentionsFlag: 'mentionsGastric', label: 'Gastric' },
      { wantsFlag: 'wantsBreast', mentionsFlag: 'mentionsBreast', label: 'Breast' },
      { wantsFlag: 'wantsLymphoma', mentionsFlag: 'mentionsLymphoma', label: 'Lymphoma' },
      { wantsFlag: 'wantsHeadNeck', mentionsFlag: 'mentionsHeadNeck', label: 'Head&Neck' },
      { wantsFlag: 'wantsMesothelioma', mentionsFlag: 'mentionsMesothelioma', label: 'Mesothelioma' },
      { wantsFlag: 'wantsGBM', mentionsFlag: 'mentionsGBM', label: 'GBM' }
    ];

    // Identify which cancer type the user wants
    const wantedCancer = cancerTypeHardChecks.find(c => focus[c.wantsFlag]);
    if (wantedCancer) {
      // Check if the article mentions a DIFFERENT specific cancer type but NOT the wanted one
      const articleMentionsWanted = profile[wantedCancer.mentionsFlag];
      if (!articleMentionsWanted) {
        // Article doesn't mention the wanted cancer — check if it mentions another specific one
        const mentionsOtherCancer = cancerTypeHardChecks.some(c =>
          c.wantsFlag !== wantedCancer.wantsFlag && profile[c.mentionsFlag]
        );
        // Also check for endometrial (common cross-contamination for MSI-H queries)
        const mentionsEndometrial = profile.mentionsEndometrial;
        if (mentionsOtherCancer || mentionsEndometrial) return true;
      }
    }

    // ── Drug hard-rejection ─────────────────────────────────────────────────
    // If the user asks about a specific drug and the article discusses a
    // different drug from the same class but NOT the queried drug, hard-reject.
    const questionDrugs = focus.detectedDrugs || [];
    if (questionDrugs.length > 0 && profile.detectedDrugs && profile.detectedDrugs.length > 0) {
      const drugOverlap = questionDrugs.some(d => profile.detectedDrugs.includes(d));
      if (!drugOverlap) return true;
    }

    return false;
  }

  articleMatchesClinicalFocus(article = {}, focus = {}) {
    if (this.isNonActionablePublication(article)) return false;
    if (this.isProtocolLikeStudy(article)) return false;
    if (this.isLowActionabilityReview(article)) return false;
    if (this.hasStrongClinicalMismatch(article, focus)) return false;
    return true;
  }

  hasDirectOutcomeSignals(article = {}) {
    const metrics = article?.endpointMetrics || {};
    const hasMetrics = ['pcr', 'efs', 'dfs', 'pfs', 'os', 'orr', 'grade34ae']
      .some(key => Boolean(metrics[key]));
    if (hasMetrics) return true;

    const text = `${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();
    return /pcr|pathologic(?:al)? complete response|event[- ]free survival|efs|overall survival|os|disease[- ]free survival|dfs|progression[- ]free survival|pfs|objective response rate|orr|hazard ratio|grade\s*3|grade\s*4|adverse event/i.test(text);
  }

  isProtocolLikeStudy(article = {}) {
    const text = `${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();
    if (!text) return false;

    const protocolSignals = /study protocol|protocol|trial design|will be randomized|will receive|primary objective|secondary objective|follow-up continues|ongoing trial|to evaluate/i.test(text);
    const hasResultSignals = this.hasDirectOutcomeSignals(article) ||
      /results|significant(?:ly)?|improved|benefit|hazard ratio|95%\s*ci|events?\s+occurred/i.test(text);

    return protocolSignals && !hasResultSignals;
  }

  filterFocusedContextArticles(articles = [], question = '', options = {}) {
    if (!Array.isArray(articles) || articles.length === 0) return [];

    const focus = this.detectClinicalFocus(question, options);
    const filtered = articles.filter(article => this.articleMatchesClinicalFocus(article, focus));
    if (filtered.length > 0) return filtered;

    const withoutNoise = articles.filter(article =>
      !this.isNonActionablePublication(article) &&
      !this.isProtocolLikeStudy(article) &&
      !this.isLowActionabilityReview(article)
    );
    if (withoutNoise.length > 0) return withoutNoise;

    const withoutProtocols = articles.filter(article => !this.isProtocolLikeStudy(article));
    return withoutProtocols.length > 0 ? withoutProtocols : articles;
  }

  isLowActionabilityReview(article = {}) {
    const text = `${article?.studyDesign || ''} ${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();
    if (!text) return false;
    const isReviewLike = /\breview\b/.test(text);
    const isHighTierSynthesis = /systematic review|meta-analysis|meta analysis/.test(text);
    return (isReviewLike && !isHighTierSynthesis && !this.hasDirectOutcomeSignals(article)) || this.isGenericTopicPublication(article);
  }

  inferEvidenceStrength(article = {}, summary = null) {
    const reported = String(summary?.evidence_strength || '').trim().toLowerCase();
    if (['high', 'moderate', 'low'].includes(reported)) {
      return reported;
    }

    const text = `${article?.studyDesign || ''} ${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();
    if (/systematic review|meta-analysis|meta analysis|phase iii|phase 3/.test(text)) return 'high';
    if (/randomized|phase ii|phase 2|prospective/.test(text)) return 'moderate';
    return 'low';
  }

  getEvidenceStrengthWeight(label = '') {
    return {
      high: 3,
      moderate: 2,
      low: 1
    }[String(label || '').trim().toLowerCase()] || 0;
  }

  isPlaceholderField(value = '') {
    const normalized = String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!normalized) return true;

    return /^(?:n\/a|na|nr|none|unknown|not available|not applicable|available source|available in source text|not available in source text)$/i.test(normalized) ||
      /^(?:no explicit comparator|sem comparador explicito)$/i.test(normalized);
  }

  sanitizeEvidenceField(value = '') {
    const normalized = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return '';
    if (this.isPlaceholderField(normalized)) return '';
    return normalized;
  }

  getNormalizedAnalysisType(summary = null) {
    return this.sanitizeEvidenceField(summary?.analysis_type || '').toLowerCase();
  }

  inferComparatorLabel(article = {}, summary = null) {
    const reported = this.sanitizeEvidenceField(summary?.comparator || '');
    if (reported) return reported;

    const text = `${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();
    if (!text.trim()) return '';

    if (/\bwithout placebo\b|\bno placebo\b|\bnon-placebo\b|\bnot placebo\b/.test(text)) {
      return '';
    }
    if (/\bplacebo\b|\bmatching placebo\b|\bplacebo-controlled\b|\bplacebo controlled\b/.test(text)) {
      return 'placebo';
    }
    if (/\bsingle[-\s]?arm\b|\buncontrolled\b|\bwithout a control arm\b/.test(text)) {
      return 'single-arm/no control';
    }
    if (/\bchemotherapy alone\b|\bchemo(?:therapy)? alone\b|\bstandard chemotherapy\b|\bstandard neoadjuvant chemotherapy\b/.test(text)) {
      return 'chemotherapy alone';
    }
    if (/\bstandard of care\b|\bcontrol arm\b|\bactive comparator\b|\bstandard treatment\b/.test(text)) {
      return 'active control';
    }

    return '';
  }

  inferInterventionLabel(article = {}, summary = null) {
    const reported = this.sanitizeEvidenceField(summary?.intervention || '');
    if (reported && !this.looksLikeTrialIdentifier(reported) && !this.looksLikeNonTherapeuticDescriptor(reported)) return reported;

    const trialName = this.sanitizeEvidenceField(article?.trialName || '');
    if (trialName && !this.looksLikeTrialIdentifier(trialName)) return trialName;

    const title = this.sanitizeEvidenceField(article?.title || '');
    if (!title) return '';

    const leadingMatch = title.match(/^(.+?)\s+(?:in|for)\s+(?:patients?\b|early[-\s]?stage\b|high[-\s]?risk\b|locally advanced\b|triple[-\s]?negative\b|breast cancer\b)/i);
    if (leadingMatch) {
      const candidate = this.sanitizeEvidenceField(leadingMatch[1] || '');
      if (
        candidate &&
        !/\bvs\b|\bversus\b/i.test(candidate) &&
        !this.looksLikeTrialIdentifier(candidate) &&
        !this.looksLikeNonTherapeuticDescriptor(candidate) &&
        candidate.length <= 90 &&
        /\b(pembrolizumab|camrelizumab|atezolizumab|nivolumab|durvalumab|olaparib|trastuzumab|chemotherapy|paclitaxel|docetaxel|carboplatin|cisplatin|peri-operative|neoadjuvant|adjuvant|regimen|combination|plus)\b/i.test(candidate)
      ) {
        return candidate;
      }
    }

    const vsMatch = title.match(/^(.+?)\s+vs\s+.+?(?:\s+(?:in|for)\b|:|$)/i);
    if (vsMatch) {
      const candidate = this.sanitizeEvidenceField(vsMatch[1] || '');
      if (candidate && !this.looksLikeTrialIdentifier(candidate) && !this.looksLikeNonTherapeuticDescriptor(candidate)) {
        if (/combination with chemotherapy/i.test(title) && !/\bchemotherapy\b/i.test(candidate)) {
          return `${candidate} plus chemotherapy`;
        }
        return candidate;
      }
    }

    const withMatch = title.match(/\bwith\s+(.+?)(?:\s+(?:in|for)\b|:|$)/i);
    if (withMatch) {
      const candidate = this.sanitizeEvidenceField(withMatch[1] || '');
      if (candidate && !this.looksLikeTrialIdentifier(candidate) && !this.looksLikeNonTherapeuticDescriptor(candidate) && candidate.length <= 90) {
        return candidate;
      }
    }

    const shortened = title
      .replace(/\s+(in|for)\s+patients?.*$/i, '')
      .replace(/\s+as\s+(neoadjuvant|adjuvant).*/i, '')
      .trim();
    if (shortened.length <= 90 && !this.looksLikeNonTherapeuticDescriptor(shortened) && !this.looksLikeTrialIdentifier(shortened)) {
      return shortened;
    }
    return '';
  }

  looksLikeTrialIdentifier(value = '') {
    const normalized = this.sanitizeEvidenceField(value);
    if (!normalized) return false;

    if (/\b(pembrolizumab|camrelizumab|olaparib|nivolumab|atezolizumab|durvalumab|trastuzumab|chemotherapy|paclitaxel|docetaxel|carboplatin|cisplatin|regimen|combination|plus)\b/i.test(normalized)) {
      return false;
    }

    return /^(?:keynote-\d+|impassion\d+|gepar\w+|camrelief|partner|neo\w+|[A-Z]{2,}[A-Z0-9-]*\d*)$/i.test(normalized);
  }

  looksLikeNonTherapeuticDescriptor(value = '') {
    const normalized = this.sanitizeEvidenceField(value).toLowerCase();
    if (!normalized) return false;

    return /\bbiops(?:y|ies)\b|\bpredict(?:ing|ive)? response\b|\bbiomarker\b|\bmarker\b|\bctdna\b|\bcirculating tumor dna\b|\bcorrelative\b|\btranslational\b|\bresidual cancer burden\b|\bquality[-\s]?of[-\s]?life\b|\bpatient[-\s]?reported\b|\bquestionnaire\b|\boverall survival\b|\bevent[-\s]?free survival\b|\bdisease[-\s]?free survival\b|\bprogression[-\s]?free survival\b|\bpathologic(?:al)? complete response\b|\bobjective response rate\b/.test(normalized);
  }

  isPlaceboComparatorRequested(question = '', options = {}) {
    if (options.requirePlaceboComparator === true) return true;
    const focus = this.detectClinicalFocus(question, options);
    return focus.wantsPlaceboComparator === true;
  }

  /**
   * Detects when regulatory/reimbursement data contradicts assumptions in the
   * user's question. For example, if the user asks about "2L+ pembrolizumab"
   * but INFARMED data shows it is approved in 1L, the system should flag the
   * discrepancy so the LLM can proactively correct the premise.
   *
   * Returns a string block to inject into the user message, or '' if no
   * discrepancy is detected.
   */
  detectPremiseChallenges(question = '', options = {}) {
    const challenges = [];

    // ── Line-of-therapy discrepancy ─────────────────────────────────────
    const linePatterns = [
      { pattern: /\b(?:after\s*(?:first[- ]?line|1l)\s*(?:failure|progression))\b/i, assumed: '2L+' },
      { pattern: /\b(?:second[- ]?line|2nd[- ]?line|2l|segunda[- ]?linha)\b/i, assumed: '2L' },
      { pattern: /\b(?:third[- ]?line|3rd[- ]?line|3l|terceira[- ]?linha)\b/i, assumed: '3L' },
      { pattern: /\b(?:first[- ]?line|1st[- ]?line|1l|primeira[- ]?linha)\b/i, assumed: '1L' }
    ];

    let assumedLine = '';
    for (const { pattern, assumed } of linePatterns) {
      if (pattern.test(question)) {
        assumedLine = assumed;
        break;
      }
    }

    if (assumedLine) {
      // Check INFARMED context for a different approved line
      const reimbCtx = options.reimbursementContext || '';
      if (reimbCtx) {
        // Look for the ⚠ NOTE pattern injected by _buildContextSummary
        const noteMatch = reimbCtx.match(/⚠ NOTE: This indication is approved for ([^,]+), not/);
        if (noteMatch) {
          const actualLine = noteMatch[1].trim();
          challenges.push(
            `PREMISE CHALLENGE — LINE OF THERAPY: The question assumes ${assumedLine} treatment, ` +
            `but verified INFARMED data shows this drug is approved/reimbursed in ${actualLine} for this indication. ` +
            `You MUST proactively correct this in your answer: state the ACTUAL approved line of therapy ` +
            `(${actualLine}) and note that the drug is available earlier than the question assumes. ` +
            `Do not simply answer within the question's framing if the regulatory data contradicts it.`
          );
        }
      }

      // Check EMA context for a different approved line
      const emaCtx = options.emaContext || '';
      if (emaCtx && !challenges.length) {
        // Look for line-of-therapy in EMA indications that differ from assumed
        const emaLinePattern = /\((\dL\+?|adjuvant|neoadjuvant|maintenance|any line)\)/gi;
        const emaLines = new Set();
        for (const m of emaCtx.matchAll(emaLinePattern)) {
          emaLines.add(m[1].toUpperCase());
        }
        if (emaLines.size > 0 && !emaLines.has(assumedLine.toUpperCase())) {
          const actualLines = [...emaLines].join(', ');
          challenges.push(
            `PREMISE CHALLENGE — LINE OF THERAPY: The question assumes ${assumedLine} treatment, ` +
            `but EMA authorisation data shows this drug is approved for ${actualLines}. ` +
            `If the regulatory-approved line differs from the question's assumption, state the actual approved line.`
          );
        }
      }
    }

    // ── Drug not approved/reimbursed at all ──────────────────────────────
    const reimbCtx = options.reimbursementContext || options.unifiedRegulatoryContext || '';
    if (reimbCtx.includes('No INFARMED reimbursement data found') || !reimbCtx || reimbCtx.length < 50) {
      const emaCtx = options.emaContext || '';
      if (emaCtx && !emaCtx.includes('No EMA marketing authorisation data found')) {
        challenges.push(
          `PREMISE NOTE — NO VERIFIED INFARMED DATA: This drug may have EMA authorisation but no verified INFARMED reimbursement data was found. ` +
          `You MUST NOT claim the drug is available via AUE, PAP, or any specific Portuguese access pathway — these terms have precise regulatory meanings. ` +
          `AUE (Autorização de Utilização Especial) is ONLY for drugs WITHOUT EMA marketing authorisation. ` +
          `PAP (Programa de Acesso Precoce) is for EMA-approved drugs pending full reimbursement evaluation. ` +
          `Instead, state that Portuguese availability and reimbursement should be confirmed with INFARMED or the hospital pharmacy.`
        );
      } else if (!emaCtx || emaCtx.includes('No EMA marketing authorisation data found')) {
        challenges.push(
          `PREMISE NOTE — NO VERIFIED REGULATORY DATA: No verified INFARMED or EMA data was found for this drug/indication. ` +
          `Do NOT invent or guess Portuguese reimbursement pathways (AUE, PAP, etc.). ` +
          `State that approval and reimbursement status should be confirmed with EMA/INFARMED/hospital pharmacy.`
        );
      }
    }

    if (challenges.length === 0) return '';

    return '\n\n=== PREMISE CHALLENGES (verified regulatory data contradicts question assumptions) ===\n' +
      challenges.join('\n') +
      '\n=== END PREMISE CHALLENGES ===\n';
  }

  getComparatorDirectnessLabel(article = {}, summary = null, question = '', options = {}, language = 'en') {
    const placeboRequested = this.isPlaceboComparatorRequested(question, options);
    if (!placeboRequested) return '';

    const comparator = this.inferComparatorLabel(article, summary).toLowerCase();
    const isPt = language === 'pt' || language === 'bilingual';
    if (!comparator) {
      return isPt ? 'indireto/incerto' : 'indirect/unclear';
    }
    if (/\bplacebo\b/.test(comparator)) {
      return isPt ? 'direto' : 'direct';
    }
    return isPt ? 'indireto' : 'indirect';
  }

  classifyStudyRole(article = {}, summary = null, question = '', options = {}, language = 'en') {
    const isPt = language === 'pt' || language === 'bilingual';
    const placeboRequested = this.isPlaceboComparatorRequested(question, options);
    const focus = this.detectClinicalFocus(question, options);
    const matchesRequestedEndpoints = this.studyMatchesRequestedEndpoints(article, summary, question, options);
    const analysisType = this.getNormalizedAnalysisType(summary);
    const comparator = this.inferComparatorLabel(article, summary);
    const comparatorLower = comparator.toLowerCase();
    const isExploratory = this.isExploratoryAnalysisPublication(article, summary);
    const isBiomarkerFocused = this.isBiomarkerFocusedPublication(article, summary);
    const isQualityOfLifeFocused = this.isQualityOfLifeFocusedPublication(article, summary);
    const isNarrativeReview = this.isNarrativeReviewPublication(article, summary);
    const isGenericTopic = this.isGenericTopicPublication(article, summary);
    const hasDirectComparison = this.hasDirectComparativeSignals(article, summary);
    const hasOutcomes = this.hasDirectOutcomeSignals(article);
    const text = `${summary?.study_design || ''} ${article?.studyDesign || ''} ${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();
    const isSynthesis = /systematic review|meta-analysis|meta analysis|network meta-analysis/.test(text);
    const matchesRequestedComparator = placeboRequested
      ? /\bplacebo\b/.test(comparatorLower)
      : hasDirectComparison;

    if (isSynthesis && isBiomarkerFocused) {
      return {
        role: 'background-biomarker',
        priority: 1.1,
        label: isPt ? 'síntese de biomarcadores de apoio' : 'supportive biomarker synthesis',
        isPrimary: false,
        isDirectComparative: false
      };
    }

    if (isSynthesis) {
      return {
        role: 'supportive-synthesis',
        priority: placeboRequested ? 2.3 : 2.6,
        label: isPt ? 'síntese indireta de apoio' : 'supportive indirect synthesis',
        isPrimary: false,
        isDirectComparative: false
      };
    }

    if (isNarrativeReview) {
      return {
        role: 'supportive-synthesis',
        priority: 2.2,
        label: isPt ? 'revisão narrativa de apoio' : 'supportive narrative review',
        isPrimary: false,
        isDirectComparative: false
      };
    }

    if (isGenericTopic) {
      return {
        role: hasOutcomes ? 'supportive-secondary' : 'background',
        priority: hasOutcomes ? 2.1 : 0.8,
        label: isPt ? 'publicação contextual genérica' : 'generic contextual publication',
        isPrimary: false,
        isDirectComparative: false
      };
    }

    if ((analysisType === 'biomarker' || isBiomarkerFocused) && !focus.wantsBiomarker) {
      return {
        role: 'background-biomarker',
        priority: 1.0,
        label: isPt ? 'evidência de biomarcadores de fundo' : 'background biomarker evidence',
        isPrimary: false,
        isDirectComparative: false
      };
    }

    if (isBiomarkerFocused && !hasDirectComparison) {
      return {
        role: 'background-biomarker',
        priority: 1.0,
        label: isPt ? 'evidência de biomarcadores de fundo' : 'background biomarker evidence',
        isPrimary: false,
        isDirectComparative: false
      };
    }

    if (isQualityOfLifeFocused && !focus.wantsQualityOfLife) {
      return {
        role: 'supportive-secondary',
        priority: 3.15,
        label: isPt ? 'análise de desfecho secundário de apoio' : 'supportive secondary-endpoint analysis',
        isPrimary: false,
        isDirectComparative: false
      };
    }

    if (analysisType === 'qol' && !focus.wantsQualityOfLife) {
      return {
        role: 'supportive-secondary',
        priority: 3.15,
        label: isPt ? 'análise de qualidade de vida de apoio' : 'supportive quality-of-life analysis',
        isPrimary: false,
        isDirectComparative: false
      };
    }

    if (analysisType === 'secondary_endpoint') {
      return {
        role: 'supportive-secondary',
        priority: matchesRequestedEndpoints ? 3.25 : 2.75,
        label: isPt ? 'análise de desfecho secundário de apoio' : 'supportive secondary-endpoint analysis',
        isPrimary: false,
        isDirectComparative: false
      };
    }

    if (!matchesRequestedEndpoints && hasDirectComparison) {
      return {
        role: 'supportive-secondary',
        priority: 2.75,
        label: isPt ? 'evidência comparativa fora do desfecho-alvo' : 'comparative evidence outside the target endpoint',
        isPrimary: false,
        isDirectComparative: false
      };
    }

    if (hasDirectComparison && !isExploratory && matchesRequestedComparator) {
      return {
        role: 'direct-comparative-primary',
        priority: placeboRequested ? 5.3 : 4.8,
        label: placeboRequested
          ? (isPt ? 'evidência primária direta com placebo' : 'primary direct placebo-controlled evidence')
          : (isPt ? 'evidência comparativa primária direta' : 'primary direct comparative evidence'),
        isPrimary: true,
        isDirectComparative: true
      };
    }

    if (hasDirectComparison && !isExploratory) {
      return {
        role: 'supportive-primary',
        priority: 3.7,
        label: isPt ? 'evidência comparativa indireta de apoio' : 'supportive indirect comparative evidence',
        isPrimary: true,
        isDirectComparative: false
      };
    }

    if (isExploratory) {
      return {
        role: 'supportive-exploratory',
        priority: hasDirectComparison ? 3.5 : 3.0,
        label: isPt ? 'análise exploratória de apoio' : 'supportive exploratory analysis',
        isPrimary: true,
        isDirectComparative: false
      };
    }

    if (hasOutcomes) {
      return {
        role: 'supportive-primary',
        priority: 2.9,
        label: isPt ? 'evidência clínica de apoio' : 'supportive clinical evidence',
        isPrimary: true,
        isDirectComparative: false
      };
    }

    return {
      role: 'background',
      priority: 0.7,
      label: isPt ? 'evidência de fundo' : 'background evidence',
      isPrimary: false,
      isDirectComparative: false
    };
  }

  sortEvidenceForSynthesis(articles = [], evidenceSummaries = [], question = '', options = {}) {
    if (!Array.isArray(articles) || articles.length === 0) {
      return { articles: [], evidenceSummaries: [], orderedItems: [] };
    }

    const language = options.responseLanguage || 'en';
    const summaryByIndex = new Map((Array.isArray(evidenceSummaries) ? evidenceSummaries : [])
      .filter(item => Number.isFinite(item?.index))
      .map(item => [item.index, item]));

    const orderedItems = articles.map((article, idx) => {
      const summary = summaryByIndex.get(idx + 1) || null;
      const classification = this.classifyStudyRole(article, summary, question, options, language);
      const evidenceStrength = this.inferEvidenceStrength(article, summary);
      const year = Number.parseInt(article?.year, 10) || 0;

      return {
        originalIndex: idx + 1,
        article,
        summary,
        classification,
        evidenceStrength,
        year
      };
    }).sort((a, b) => {
      if (b.classification.priority !== a.classification.priority) {
        return b.classification.priority - a.classification.priority;
      }

      const strengthDelta = this.getEvidenceStrengthWeight(b.evidenceStrength) - this.getEvidenceStrengthWeight(a.evidenceStrength);
      if (strengthDelta !== 0) {
        return strengthDelta;
      }

      const osDelta = Number(this.hasOverallSurvivalSignal(b.article, b.summary)) - Number(this.hasOverallSurvivalSignal(a.article, a.summary));
      if (osDelta !== 0) {
        return osDelta;
      }

      const lateEndpointDelta = Number(this.hasLateEndpointSignal(b.article, b.summary)) - Number(this.hasLateEndpointSignal(a.article, a.summary));
      if (lateEndpointDelta !== 0) {
        return lateEndpointDelta;
      }

      const directOutcomeDelta = Number(this.hasDirectOutcomeSignals(b.article)) - Number(this.hasDirectOutcomeSignals(a.article));
      if (directOutcomeDelta !== 0) {
        return directOutcomeDelta;
      }

      if (b.year !== a.year) {
        return b.year - a.year;
      }

      return a.originalIndex - b.originalIndex;
    }).map((item, idx) => ({
      ...item,
      index: idx + 1
    }));

    return {
      articles: orderedItems.map(item => item.article),
      evidenceSummaries: orderedItems
        .filter(item => item.summary)
        .map(item => ({
          ...item.summary,
          index: item.index
        })),
      orderedItems
    };
  }

  buildTrialDedupKey(article = {}) {
    return this.trialFamilyAgent.buildTrialDedupKey(article);
  }

  collectRelatedPmids(article = {}) {
    return this.trialFamilyAgent.collectRelatedPmids(article);
  }

  getEndpointMetricKeys(endpointKey = '') {
    return this.trialFamilyAgent.getEndpointMetricKeys(endpointKey);
  }

  articleHasEndpointMetric(article = {}, endpointKey = '') {
    return this.trialFamilyAgent.articleHasEndpointMetric(article, endpointKey);
  }

  scoreTrialPublicationCandidate(item = {}, question = '', options = {}) {
    return this.trialFamilyAgent.scoreTrialPublicationCandidate(item, question, options);
  }

  scoreEndpointPublicationCandidate(item = {}, endpointKey = '', question = '', options = {}) {
    return this.trialFamilyAgent.scoreEndpointPublicationCandidate(item, endpointKey, question, options);
  }

  mergeEndpointMetricValues(targetMetrics = {}, sourceMetrics = {}, endpointKey = '') {
    return this.trialFamilyAgent.mergeEndpointMetricValues(targetMetrics, sourceMetrics, endpointKey);
  }

  aggregateTrialGroup(items = [], question = '', options = {}) {
    return this.trialFamilyAgent.aggregateTrialGroup(items, question, options);
  }

  aggregateTrialEvidence(articles = [], evidenceSummaries = [], question = '', options = {}) {
    return this.trialFamilyAgent.aggregateTrialEvidence(articles, evidenceSummaries, question, options);
  }

  deduplicateTrialEvidenceItems(orderedItems = [], question = '', options = {}) {
    return this.trialFamilyAgent.deduplicateTrialEvidenceItems(orderedItems, question, options);
  }

  trimEvidenceForDetailedAnswer(articles = [], evidenceSummaries = [], question = '', options = {}) {
    return this.trialFamilyAgent.trimEvidenceForDetailedAnswer(articles, evidenceSummaries, question, options);
  }

  inferPopulationFromEvidence(question = '', options = {}, isPt = false, articles = [], evidenceSummaries = []) {
    const summaryByIndex = new Map((Array.isArray(evidenceSummaries) ? evidenceSummaries : [])
      .filter(item => Number.isFinite(item?.index))
      .map(item => [item.index, item]));

    const evidenceText = (Array.isArray(articles) ? articles : []).map((article, idx) => {
      const summary = summaryByIndex.get(idx + 1) || {};
      return [
        article?.title,
        article?.abstract,
        summary?.population,
        summary?.outcomes
      ].filter(Boolean).join(' ');
    }).join(' ');

    const source = `${question || ''} ${options.population || ''} ${evidenceText}`.toLowerCase();
    const hasTNBC = /triple[-\s]?negative|\btnbc\b/.test(source);
    const hasBreastCancer = /breast cancer|cancro da mama/.test(source);
    const hasEarlyStage = /\bearly[-\s]?stage\b|\bearly breast cancer\b|\bresectable\b/.test(source);
    const hasLocallyAdvanced = /\blocally advanced\b/.test(source);
    const hasHighRisk = /\bhigh[-\s]?risk\b/.test(source);
    const hasMetastatic = /\bmetastatic\b|\badvanced\b|\bunresectable\b|\bstage iv\b|\bm1\b/.test(source);

    if (hasTNBC && hasEarlyStage && hasLocallyAdvanced) {
      return isPt
        ? 'Doentes com TNBC em estádio inicial ou localmente avançado; vários estudos focaram doença inicial de alto risco.'
        : 'Patients with early-stage or locally advanced TNBC; several studies focused on high-risk early-stage disease.';
    }

    if (hasTNBC && hasEarlyStage && hasHighRisk) {
      return isPt
        ? 'Doentes com TNBC inicial de alto risco.'
        : 'Patients with high-risk early-stage TNBC.';
    }

    if (hasTNBC && hasEarlyStage) {
      return isPt
        ? 'Doentes com TNBC em estádio inicial.'
        : 'Patients with early-stage TNBC.';
    }

    if (hasTNBC && hasLocallyAdvanced) {
      return isPt
        ? 'Doentes com TNBC localmente avançado.'
        : 'Patients with locally advanced TNBC.';
    }

    if (hasTNBC && hasMetastatic) {
      return isPt
        ? 'Doentes com TNBC metastático/avançado.'
        : 'Patients with metastatic or advanced TNBC.';
    }

    if (hasTNBC) {
      return isPt
        ? 'Doentes com cancro da mama triplo negativo (TNBC).'
        : 'Patients with triple-negative breast cancer (TNBC).';
    }

    if (hasBreastCancer && hasEarlyStage) {
      return isPt
        ? 'Doentes com cancro da mama em estádio inicial.'
        : 'Patients with early-stage breast cancer.';
    }

    if (hasBreastCancer) {
      return isPt ? 'Doentes com cancro da mama.' : 'Patients with breast cancer.';
    }

    return isPt ? 'População alinhada com a pergunta clínica.' : 'Population aligned with the clinical question.';
  }

  joinListWithAnd(values = [], language = 'en') {
    const items = [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
    if (items.length === 0) return '';
    if (items.length === 1) return items[0];
    if (items.length === 2) {
      return language === 'pt' || language === 'bilingual'
        ? `${items[0]} e ${items[1]}`
        : `${items[0]} and ${items[1]}`;
    }

    const last = items.pop();
    return language === 'pt' || language === 'bilingual'
      ? `${items.join(', ')} e ${last}`
      : `${items.join(', ')}, and ${last}`;
  }

  getEndpointLabel(key = '', language = 'en') {
    const isPt = language === 'pt' || language === 'bilingual';
    const map = {
      os: 'OS',
      efs: 'EFS/DFS/PFS',
      pcr: 'pCR',
      orr: 'ORR',
      grade34ae: isPt ? 'EA G3-4' : 'G3-4 AEs'
    };
    return map[String(key || '').toLowerCase()] || '';
  }

  textMentionsEndpointKey(text = '', key = '') {
    const source = String(text || '').toLowerCase();
    const patterns = {
      os: /\boverall survival\b|\bos\b/,
      efs: /\bevent[- ]free survival\b|\befs\b|\bdisease[- ]free survival\b|\bdfs\b|\bprogression[- ]free survival\b|\bpfs\b/,
      pcr: /\bpathologic(?:al)? complete response\b|\bpcr\b/,
      orr: /\bobjective response rate\b|\borr\b/,
      grade34ae: /\bsafety\b|\btoxicity\b|\bgrade\s*3(?:\s*\/\s*4|[-–]4)?\b|g3[-–]?4/
    };
    return patterns[String(key || '').toLowerCase()]?.test(source) || false;
  }

  getRequestedEndpointKeys(question = '', options = {}) {
    return this.clinicalIntentAgent.getRequestedEndpointKeys(question, options);
  }

  getStudyEndpointKeys(article = {}, summary = null) {
    return this.endpointClaimAgent.getStudyEndpointKeys(article, summary);
  }

  studyMatchesRequestedEndpoints(article = {}, summary = null, question = '', options = {}) {
    return this.endpointClaimAgent.studyMatchesRequestedEndpoints(
      article,
      summary,
      this.getRequestedEndpointKeys(question, options)
    );
  }

  getStudyEndpointLabels(article = {}, summary = null, language = 'en', filterKeys = []) {
    return this.endpointClaimAgent.getStudyEndpointLabels(article, summary, language, filterKeys);
  }

  getPreferredEvidenceLabel(article = {}, summary = null) {
    const intervention = this.inferInterventionLabel(article, summary);
    if (intervention && intervention.length <= 110) return intervention;

    const trialName = this.sanitizeEvidenceField(article?.trialName || '');
    if (trialName) return trialName;

    const title = this.sanitizeEvidenceField(article?.title || '');
    if (!title) return 'the leading regimen';

    const shortened = title
      .replace(/\s+in\s+patients?.*$/i, '')
      .replace(/\s+for\s+patients?.*$/i, '')
      .replace(/\s+as\s+(neoadjuvant|adjuvant).*/i, '')
      .trim();

    return shortened.length <= 110 ? shortened : title.slice(0, 107).trimEnd() + '...';
  }

  inferStudyBenefitDirection(article = {}, summary = null) {
    return this.endpointClaimAgent.inferDirectionFromText(
      `${summary?.effect_direction || ''} ${summary?.key_findings || ''} ${article?.title || ''} ${article?.abstract || ''}`
    );
  }

  hasStrongPracticeAnchoredEvidence(question = '', articles = [], evidenceSummaries = [], options = {}) {
    const aggregated = this.aggregateTrialEvidence(articles, evidenceSummaries, question, options);
    const ordered = this.sortEvidenceForSynthesis(aggregated.articles, aggregated.evidenceSummaries, question, options);
    return ordered.orderedItems.some(item =>
      item.classification.role === 'direct-comparative-primary' &&
      this.getEvidenceStrengthWeight(item.evidenceStrength) >= 2 &&
      (this.hasOverallSurvivalSignal(item.article, item.summary) || this.hasLateEndpointSignal(item.article, item.summary))
    );
  }

  buildDetailedTakeaway(orderedItems = [], question = '', options = {}, language = 'en') {
    return this.endpointJudgeAgent.buildDetailedTakeaway(orderedItems, question, options, language);
  }

  assessEvidenceSummaryState(orderedItems = [], question = '', options = {}) {
    const directPrimary = (Array.isArray(orderedItems) ? orderedItems : [])
      .filter(item => item?.classification?.role === 'direct-comparative-primary');
    const requestedEndpointKeys = this.getRequestedEndpointKeys(question, options);

    const summarizeItem = (item = {}) => {
      const relevantClaims = this.endpointJudgeAgent.getRelevantClaims(item.article, item.summary, question, options);
      const fallbackClaims = this.endpointClaimAgent.buildEndpointClaims(item.article, item.summary, { requestedEndpointKeys });
      const sourceClaims = (relevantClaims.length > 0 ? relevantClaims : fallbackClaims)
        .filter(claim => ['positive', 'neutral', 'negative'].includes(claim?.direction));
      const targetClaims = requestedEndpointKeys.length > 0
        ? sourceClaims.filter(claim => requestedEndpointKeys.includes(claim.endpointKey))
        : sourceClaims;
      const claims = targetClaims.length > 0 ? targetClaims : sourceClaims;

      return {
        strengthWeight: this.getEvidenceStrengthWeight(item?.evidenceStrength),
        hasPositive: claims.some(claim => claim.direction === 'positive'),
        hasNegative: claims.some(claim => claim.direction === 'negative'),
        hasNeutral: claims.some(claim => claim.direction === 'neutral'),
        hasDirectionalClaim: claims.length > 0,
        hasReportedRequestedClaim: claims.some(claim => claim.maturity === 'reported' || Boolean(claim.metricValue)),
        hasLateEndpoint: this.hasLateEndpointSignal(item?.article, item?.summary)
      };
    };

    const directStates = directPrimary.map(summarizeItem);
    const positiveCount = directStates.filter(item => item.hasPositive).length;
    const negativeCount = directStates.filter(item => item.hasNegative).length;
    const neutralOrUnclearCount = directStates.filter(item => item.hasNeutral || !item.hasDirectionalClaim).length;
    const answeredRequestedCount = directStates.filter(item => item.hasReportedRequestedClaim).length;
    const supportiveCount = Math.max((Array.isArray(orderedItems) ? orderedItems.length : 0) - directPrimary.length, 0);

    let insufficient = false;
    let reason = 'limited';

    if (directPrimary.length === 0) {
      insufficient = true;
      reason = 'no_direct';
    } else if (requestedEndpointKeys.length > 0 && answeredRequestedCount === 0) {
      insufficient = true;
      reason = 'endpoint_gap';
    } else if (positiveCount === 0 && negativeCount === 0 && neutralOrUnclearCount === directPrimary.length) {
      insufficient = true;
      reason = 'non_directional';
    } else if (directPrimary.length === 1) {
      const [mainState] = directStates;
      if (mainState && mainState.strengthWeight < 3 && (!mainState.hasLateEndpoint || !mainState.hasReportedRequestedClaim)) {
        insufficient = true;
        reason = 'single_weak_direct';
      }
    } else if (directPrimary.length <= 2 && positiveCount === 0 && supportiveCount > 0) {
      insufficient = true;
      reason = 'small_mixed_base';
    }

    return {
      insufficient,
      reason,
      directPrimaryCount: directPrimary.length,
      positiveCount,
      negativeCount,
      neutralOrUnclearCount,
      supportiveCount,
      answeredRequestedCount
    };
  }

  buildResponseReferences(articles = []) {
    return (Array.isArray(articles) ? articles : []).map((article, index) => ({
      index: index + 1,
      title: article.title,
      authors: article.authors,
      journal: article.journal,
      year: article.year,
      pmid: article.pmid,
      doi: article.doi,
      url: article.url,
      abstract: article.abstract,
      trialName: article.trialName,
      studyDesign: article.studyDesign,
      endpointMetrics: article.endpointMetrics,
      endpointClaims: article.endpointClaims,
      relatedPmids: article.relatedPmids,
      endpointSources: article.endpointSources,
      trialPublicationCount: article.trialPublicationCount,
      trialYearRange: article.trialYearRange
    }));
  }

  buildEvidenceSuitabilityAssessment(question = '', articles = [], evidenceSummaries = [], quickStats = {}, options = {}) {
    const prepared = this.sortEvidenceForSynthesis(
      Array.isArray(articles) ? articles : [],
      Array.isArray(evidenceSummaries) ? evidenceSummaries : [],
      question,
      options
    );
    const orderedItems = prepared.orderedItems || [];
    const summaryState = this.assessEvidenceSummaryState(orderedItems, question, options);
    const directPrimary = orderedItems.filter(item => item?.classification?.role === 'direct-comparative-primary');
    const supportiveOnlyCount = orderedItems.filter(item =>
      ['supportive-primary', 'supportive-secondary', 'supportive-exploratory', 'supportive-synthesis'].includes(item?.classification?.role)
    ).length;
    const contextualCount = orderedItems.filter(item =>
      item?.classification?.role?.startsWith('background') ||
      item?.classification?.role === 'supportive-synthesis' ||
      this.isGenericTopicPublication(item?.article, item?.summary) ||
      this.isNarrativeReviewPublication(item?.article, item?.summary)
    ).length;
    const endpointSignalCount = (Array.isArray(articles) ? articles : []).filter(article =>
      ['pcr', 'efs', 'dfs', 'pfs', 'os', 'orr', 'grade34ae'].some(key => Boolean(article?.endpointMetrics?.[key]))
    ).length;
    const topDirectStrength = Math.max(
      0,
      ...directPrimary.map(item => this.getEvidenceStrengthWeight(item?.evidenceStrength))
    );

    const reasons = [];
    if (orderedItems.length === 0) reasons.push('No usable studies remained after evidence filtering.');
    if (summaryState.reason === 'no_direct') reasons.push('No directly relevant comparative study was identified for the question.');
    if (summaryState.reason === 'endpoint_gap') reasons.push('The retrieved studies did not directly answer the requested endpoint.');
    if (summaryState.reason === 'non_directional') reasons.push('The central studies did not provide a clear directional effect.');
    if (summaryState.reason === 'single_weak_direct') reasons.push('Only one weak or immature directly relevant study remained.');
    if (summaryState.reason === 'small_mixed_base') reasons.push('The comparative base was small and mixed, with contextual papers diluting interpretation.');
    if (contextualCount >= Math.max(2, Math.ceil(orderedItems.length / 2))) {
      reasons.push('The selected evidence was dominated by reviews, generic topic papers, or contextual publications.');
    }
    if (endpointSignalCount === 0 && orderedItems.length > 0) {
      reasons.push('The selected set contained little or no explicit endpoint reporting.');
    }

    let status = 'adequate';
    const isSupportiveCare = options.questionType === 'supportive_care';

    if (isSupportiveCare) {
      // Supportive care questions are guideline-driven: reviews, guidelines, and
      // consensus papers are GOOD evidence here, not noise. We only abstain if
      // we truly found zero articles. The "no direct comparative" criterion
      // that works for treatment efficacy questions does not apply.
      if (orderedItems.length === 0) {
        status = 'insufficient';
      } else if (orderedItems.length <= 2) {
        status = 'borderline';
        reasons.push('Few studies retrieved for this supportive care question — answer relies primarily on guideline knowledge.');
      } else {
        status = 'adequate';
      }
      // For supportive care, reviews and guidelines dominating the evidence set
      // is expected and desirable — remove the warning about contextual publications
      const contextDominatedIndex = reasons.indexOf('The selected evidence was dominated by reviews, generic topic papers, or contextual publications.');
      if (contextDominatedIndex !== -1) reasons.splice(contextDominatedIndex, 1);
    } else {
      // Treatment efficacy: original logic
      const hardInsufficient = orderedItems.length === 0 ||
        summaryState.reason === 'no_direct' ||
        summaryState.reason === 'endpoint_gap' ||
        (summaryState.insufficient && directPrimary.length === 0);
      if (hardInsufficient) {
        status = 'insufficient';
      } else if (
        summaryState.insufficient ||
        directPrimary.length === 1 ||
        supportiveOnlyCount >= directPrimary.length ||
        topDirectStrength < 3 ||
        (Number.isFinite(quickStats?.readinessScore) && quickStats.readinessScore < 60)
      ) {
        status = 'borderline';
      }
    }

    const labels = {
      adequate: 'Adequate for presentation',
      borderline: isSupportiveCare
        ? 'Limited literature — answer primarily guideline-based'
        : 'Limited direct evidence — interpret with caution',
      insufficient: isSupportiveCare
        ? 'No relevant supportive care literature found — answer based on general guideline knowledge'
        : 'No direct comparative evidence — answer based on indirect/contextual literature'
    };
    const summaryMessages = {
      adequate: isSupportiveCare
        ? 'Guideline-level evidence and/or relevant publications were found for this supportive care question.'
        : 'The retrieved evidence appears usable for a direct clinical summary.',
      borderline: isSupportiveCare
        ? 'Limited specific literature was found. The answer draws on clinical practice guidelines and general supportive care principles.'
        : 'Direct comparative evidence is limited. The answer draws on the best available studies but should be interpreted cautiously.',
      insufficient: isSupportiveCare
        ? 'No specific supportive care literature was found. The answer is based on general clinical practice guideline knowledge.'
        : 'No direct comparative study was found. The answer is based on indirect, contextual, or supportive publications and should be read accordingly.'
    };

    // For supportive care, never abstain — guidelines provide sufficient basis for a response
    const shouldAbstain = isSupportiveCare ? false : orderedItems.length === 0;

    return {
      status,
      state: status,
      label: labels[status],
      score: Number.isFinite(quickStats?.readinessScore) ? quickStats.readinessScore : 0,
      abstain: shouldAbstain,
      message: summaryMessages[status],
      reasons,
      questionType: isSupportiveCare ? 'supportive_care' : 'treatment_efficacy',
      counts: {
        selected: orderedItems.length,
        directPrimary: directPrimary.length,
        supportiveOnly: supportiveOnlyCount,
        contextual: contextualCount,
        endpointSignals: endpointSignalCount
      },
      summaryState,
      orderedItems
    };
  }

  buildInsufficientEvidenceContextSummary(orderedItems = [], responseLanguage = 'en') {
    const isPt = responseLanguage === 'pt' || responseLanguage === 'bilingual';
    const items = Array.isArray(orderedItems) ? orderedItems : [];
    if (items.length === 0) return '';

    const profiles = items.map(item => this.getArticleFocusProfile(item?.article));
    const hasMetastatic = profiles.some(profile => profile?.mentionsMetastatic);
    const hasEarlyStage = profiles.some(profile =>
      profile?.mentionsEarlyStage || profile?.mentionsAdjuvant || profile?.mentionsNeoadjuvant
    );
    const contextualCount = items.filter(item =>
      item?.classification?.role?.startsWith('background') ||
      item?.classification?.role === 'supportive-synthesis' ||
      this.isNarrativeReviewPublication(item?.article, item?.summary) ||
      this.isGenericTopicPublication(item?.article, item?.summary)
    ).length;
    const mostlyContextual = contextualCount >= Math.max(2, Math.ceil(items.length / 2));
    const mixedSettings = hasMetastatic && hasEarlyStage;

    if (mixedSettings && mostlyContextual) {
      return isPt
        ? 'O conjunto recuperado mistura cenários clínicos diferentes e publicações sobretudo contextuais, o que impede uma comparação clinicamente coerente.'
        : 'The retrieved set mixes different clinical settings and is dominated by contextual publications, which makes the comparison clinically incoherent.';
    }

    if (mixedSettings) {
      return isPt
        ? 'O conjunto recuperado mistura cenários clínicos diferentes, incluindo doença inicial e metastática/avançada.'
        : 'The retrieved set mixes different clinical settings, including early-stage and metastatic/advanced disease.';
    }

    if (mostlyContextual) {
      return isPt
        ? 'Grande parte do conjunto recuperado consiste em revisões amplas ou publicações contextuais, e não em ensaios comparativos diretamente aplicáveis.'
        : 'Much of the retrieved set consists of broad reviews or contextual publications rather than directly applicable comparative trials.';
    }

    return '';
  }

  buildInsufficientEvidenceAnswer(question = '', articles = [], evidenceSummaries = [], suitability = {}, options = {}) {
    const responseLanguage = options.responseLanguage || 'en';
    const isPt = responseLanguage === 'pt' || responseLanguage === 'bilingual';
    const requestedEndpointText = this.clinicalIntentAgent.describeRequestedEndpoints(question, options, responseLanguage);
    const reasonText = Array.isArray(suitability?.reasons)
      ? suitability.reasons.slice(0, 2).join(' ')
      : '';
    const fallbackReasonText = reasonText || (isPt
      ? 'Os estudos recuperados são demasiado indiretos, genéricos ou heterogéneos para sustentar uma conclusão clínica clara.'
      : 'The retrieved studies are too indirect, generic, or heterogeneous to support a clear clinical conclusion.');
    const contextSummary = this.buildInsufficientEvidenceContextSummary(suitability?.orderedItems, responseLanguage);
    const suggestRephrase = suitability?.summaryState?.reason === 'no_direct' || suitability?.summaryState?.reason === 'endpoint_gap';
    const reformulationTip = suggestRephrase
      ? (isPt
          ? 'Se quiser, reformule a pergunta com população, cenário terapêutico, comparador e desfecho explícitos.'
          : 'If useful, rephrase the question with an explicit population, treatment setting, comparator, and endpoint.')
      : '';

    return [
      isPt
        ? `Os artigos recuperados não permitem uma resposta comparativa confiável${requestedEndpointText ? ` em ${requestedEndpointText}` : ''}.`
        : `The retrieved papers do not support a reliable comparative answer${requestedEndpointText ? ` in ${requestedEndpointText}` : ''}.`,
      fallbackReasonText,
      contextSummary,
      reformulationTip
    ].filter(Boolean).join('\n\n');
  }

  buildEvidenceWarnings(suitability = {}, responseLanguage = 'en') {
    const isPt = responseLanguage === 'pt' || responseLanguage === 'bilingual';
    if (!suitability || typeof suitability !== 'object') return [];

    if (suitability.status === 'insufficient') {
      return [{
        level: 'warning',
        code: 'insufficient_evidence',
        message: isPt
          ? 'Os estudos recuperados não respondem diretamente à pergunta com qualidade suficiente.'
          : 'The retrieved studies do not answer the question directly with enough quality.'
      }];
    }

    if (suitability.status === 'borderline') {
      return [{
        level: 'caution',
        code: 'borderline_evidence',
        message: isPt
          ? 'A base de evidência é utilizável, mas limitada; a interpretação deve ser cautelosa.'
          : 'The evidence base is usable but limited; interpretation should remain cautious.'
      }];
    }

    return [];
  }

  summarizeUniqueStudyFields(values = [], { maxItems = 3, language = 'en' } = {}) {
    const unique = [...new Set((Array.isArray(values) ? values : [])
      .map(value => this.sanitizeEvidenceField(value))
      .filter(Boolean))];
    if (unique.length === 0) return '';
    if (unique.length === 1) return unique[0];
    const limited = unique.slice(0, maxItems);
    const joiner = language === 'pt' || language === 'bilingual' ? ' ; ' : '; ';
    const suffix = unique.length > maxItems ? (language === 'pt' || language === 'bilingual' ? '; entre outros' : '; among others') : '';
    return `${limited.join(joiner)}${suffix}`;
  }

  toMarkdownCell(value, fallback = '—', maxLength = 80) {
    const normalized = this.sanitizeEvidenceField(value)
      .replace(/\|/g, '\\|');
    if (!normalized) return fallback;
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
  }

  getEndpointTableCell(article = {}, summary = null, endpointKey = '', language = 'en') {
    const metricValue = this.endpointClaimAgent.getEndpointMetricValue(article, endpointKey);
    if (metricValue) return metricValue;

    const claim = this.endpointClaimAgent.buildEndpointClaims(article, summary)
      .find(item => item.endpointKey === endpointKey);
    if (!claim) return '';
    if (claim.metricValue) return claim.metricValue;

    const isPt = language === 'pt' || language === 'bilingual';
    const directionLabel = {
      positive: isPt ? 'benefício' : 'benefit',
      neutral: isPt ? 'sem vantagem clara' : 'no clear advantage',
      negative: isPt ? 'desfavorável' : 'unfavorable',
      unknown: isPt ? 'reportado' : 'reported',
      unclear: isPt ? 'reportado' : 'reported'
    }[claim.direction] || (isPt ? 'reportado' : 'reported');

    if (claim.supportLevel === 'indirect') {
      return isPt ? `indireto: ${directionLabel}` : `indirect: ${directionLabel}`;
    }
    if (claim.supportLevel === 'supportive') {
      return isPt ? `apoio: ${directionLabel}` : `supportive: ${directionLabel}`;
    }

    return directionLabel;
  }

  buildComparativeStudyTable(articles = [], evidenceSummaries = [], language = 'en', options = {}) {
    if (!Array.isArray(articles) || articles.length === 0) return '';
    const summaryByIndex = new Map((Array.isArray(evidenceSummaries) ? evidenceSummaries : [])
      .filter(item => Number.isFinite(item?.index))
      .map(item => [item.index, item]));

    const isPt = language === 'pt' || language === 'bilingual';
    const headers = isPt
      ? ['Estudo', 'Desenho', 'População', 'Intervenção vs Comparador', 'pCR', 'EFS/DFS/PFS', 'OS', 'ORR', 'EA G3-4', 'Força']
      : ['Study', 'Design', 'Population', 'Intervention vs Comparator', 'pCR', 'EFS/DFS/PFS', 'OS', 'ORR', 'G3-4 AEs', 'Strength'];

    const rows = articles.map((article, idx) => {
      const index = idx + 1;
      const summary = summaryByIndex.get(index) || null;
      const metrics = article?.endpointMetrics || {};
      const design = this.sanitizeEvidenceField(summary?.study_design || article?.studyDesign || '');
      const population = this.sanitizeEvidenceField(summary?.population || '');
      const intervention = this.inferInterventionLabel(article, summary);
      const comparator = this.inferComparatorLabel(article, summary);
      const directness = this.getComparatorDirectnessLabel(article, summary, options.question || '', options, language);
      const comparatorWithDirectness = comparator
        ? `${comparator}${directness ? ` (${directness})` : ''}`
        : (directness ? directness : '');
      const interventionVsComparator = [intervention, comparatorWithDirectness].filter(Boolean).join(' vs ');
      const pcrCell = this.getEndpointTableCell(article, summary, 'pcr', language);
      const efsBlock = this.getEndpointTableCell(article, summary, 'efs', language);
      const osCell = this.getEndpointTableCell(article, summary, 'os', language);
      const orrCell = this.getEndpointTableCell(article, summary, 'orr', language);
      const grade34aeCell = this.getEndpointTableCell(article, summary, 'grade34ae', language);
      const strength = this.inferEvidenceStrength(article, summary);

      return `| [${index}] ${this.toMarkdownCell(article?.trialName || article?.title || (isPt ? 'Estudo' : 'Study'), '—', 42)} | ${this.toMarkdownCell(design)} | ${this.toMarkdownCell(population)} | ${this.toMarkdownCell(interventionVsComparator)} | ${this.toMarkdownCell(pcrCell)} | ${this.toMarkdownCell(efsBlock)} | ${this.toMarkdownCell(osCell)} | ${this.toMarkdownCell(orrCell)} | ${this.toMarkdownCell(grade34aeCell)} | ${this.toMarkdownCell(strength)} |`;
    });

    return [
      `| ${headers.join(' | ')} |`,
      `| ${headers.map(() => '---').join(' | ')} |`,
      ...rows
    ].join('\n');
  }

  ensureComparativeTableInAnswer(answer = '', tableMarkdown = '', language = 'en') {
    const text = String(answer || '').trim();
    const table = String(tableMarkdown || '').trim();
    if (!text || !table) return text;

    const hasTableInComparative = /##\s*(Comparative Findings|Achados Comparativos)[\s\S]*?\n\|.+\|/i.test(text);
    if (hasTableInComparative) return text;

    const sectionPattern = /(##\s*(Comparative Findings|Achados Comparativos)\s*\n)([\s\S]*?)(?=\n##\s|$)/i;
    if (sectionPattern.test(text)) {
      return text.replace(sectionPattern, (full, heading, _title, body) => {
        const bodyTrim = String(body || '').trim();
        return `${heading}${table}\n\n${bodyTrim}`.trimEnd();
      });
    }

    const heading = (language === 'pt' || language === 'bilingual') ? '## Achados Comparativos' : '## Comparative Findings';
    return `${text}\n\n${heading}\n${table}`.trim();
  }

  buildStudyContextSentence(article = {}, summary = null, language = 'en') {
    const isPt = language === 'pt' || language === 'bilingual';
    const design = this.sanitizeEvidenceField(summary?.study_design || article?.studyDesign || '');
    const population = this.sanitizeEvidenceField(summary?.population || '');
    const rawIntervention = this.inferInterventionLabel(article, summary);
    const intervention = rawIntervention ? `**${rawIntervention}**` : '';
    const comparator = this.inferComparatorLabel(article, summary);
    const designPhrase = design ? design.toLowerCase() : (isPt ? 'estudo clínico' : 'clinical study');

    if (intervention && comparator && population) {
      return isPt
        ? `Este ${designPhrase} avaliou ${intervention} versus ${comparator} em ${population}.`
        : `This ${designPhrase} evaluated ${intervention} versus ${comparator} in ${population}.`;
    }
    if (intervention && comparator) {
      return isPt
        ? `Este ${designPhrase} comparou ${intervention} com ${comparator}.`
        : `This ${designPhrase} compared ${intervention} with ${comparator}.`;
    }
    if (intervention && population) {
      return isPt
        ? `Este ${designPhrase} avaliou ${intervention} em ${population}.`
        : `This ${designPhrase} evaluated ${intervention} in ${population}.`;
    }
    if (population) {
      return isPt
        ? `Este ${designPhrase} incluiu ${population}.`
        : `This ${designPhrase} included ${population}.`;
    }

    return '';
  }

  buildStudyMetricsSentence(article = {}, question = '', options = {}, language = 'en') {
    const isPt = language === 'pt' || language === 'bilingual';
    const metrics = article?.endpointMetrics || {};
    const requestedEndpointKeys = this.getRequestedEndpointKeys(question, options);
    const metricEntries = [
      { key: 'os', label: 'OS', value: metrics.os },
      { key: 'efs', label: 'EFS', value: metrics.efs },
      { key: 'efs', label: 'DFS', value: metrics.dfs },
      { key: 'efs', label: 'PFS', value: metrics.pfs },
      { key: 'pcr', label: 'pCR', value: metrics.pcr },
      { key: 'orr', label: 'ORR', value: metrics.orr },
      { key: 'grade34ae', label: isPt ? 'EA G3-4' : 'G3-4 AEs', value: metrics.grade34ae }
    ].filter(item => Boolean(item.value));

    if (metricEntries.length === 0) return '';

    const prioritized = metricEntries.sort((a, b) => {
      const aRequested = requestedEndpointKeys.includes(a.key) ? 1 : 0;
      const bRequested = requestedEndpointKeys.includes(b.key) ? 1 : 0;
      if (bRequested !== aRequested) return bRequested - aRequested;
      return 0;
    });

    const rendered = prioritized
      .map(item => `**${item.label} ${item.value}**`)
      .slice(0, requestedEndpointKeys.length > 0 ? 4 : 5);

    return isPt
      ? `Os endpoints reportados incluíram ${rendered.join('; ')}.`
      : `Reported endpoints included ${rendered.join('; ')}.`;
  }

  buildStudyInterpretationSentence(item = {}, question = '', options = {}, language = 'en') {
    const isPt = language === 'pt' || language === 'bilingual';
    const requestedEndpointText = this.clinicalIntentAgent.describeRequestedEndpoints(question, options, language);
    const classificationRole = item?.classification?.role || '';
    const requestedClaims = this.endpointJudgeAgent.getRelevantClaims(item?.article, item?.summary, question, options);
    const requestedOutcomeGap = this.getRequestedEndpointKeys(question, options).length > 0 && requestedClaims.length === 0;
    const relatedSameTrialSource = this.endpointJudgeAgent.hasRelatedSameTrialRequestedSource(
      item?.article,
      item?.summary,
      question,
      options
    );

    if (classificationRole === 'direct-comparative-primary') {
      if (relatedSameTrialSource) {
        return isPt
          ? 'Como evidência comparativa primária direta, este ensaio deve ancorar a interpretação; para o desfecho pedido, porém, o sinal vem de seguimento endpoint-específico em publicação relacionada do mesmo ensaio.'
          : 'As direct primary comparative evidence, this trial should anchor interpretation; for the requested outcome, however, the signal comes from endpoint-specific follow-up in a related same-trial publication.';
      }
      return isPt
        ? 'Como evidência comparativa primária direta, este estudo deve ancorar a interpretação acima de análises indiretas ou exploratórias.'
        : 'As direct primary comparative evidence, this study should anchor the interpretation ahead of indirect or exploratory analyses.';
    }
    if (classificationRole === 'supportive-synthesis') {
      return isPt
        ? 'Esta síntese é indireta e deve ser lida como apoio contextual, não como prova cabeça-a-cabeça.'
        : 'This synthesis is indirect and should be read as contextual support rather than head-to-head proof.';
    }
    if (classificationRole === 'supportive-exploratory') {
      return isPt
        ? 'Trata-se de uma análise exploratória e, por isso, acrescenta contexto mas não estabelece sozinha uma conclusão comparativa definitiva.'
        : 'This is an exploratory analysis, so it adds context but does not by itself establish a definitive comparative conclusion.';
    }
    if (classificationRole.startsWith('background')) {
      return isPt
        ? 'Este estudo fornece sobretudo contexto biológico/metodológico, e não prova comparativa central para a decisão clínica.'
        : 'This study contributes mainly biological or methodological context rather than core comparative evidence for clinical decisions.';
    }
    if (requestedOutcomeGap) {
      return requestedEndpointText
        ? (isPt
            ? `Contribui com contexto, mas não responde diretamente ao desfecho pedido (${requestedEndpointText}).`
            : `It adds context, but it does not directly answer the requested outcome (${requestedEndpointText}).`)
        : (isPt
            ? 'Contribui com contexto, mas não responde diretamente ao desfecho-alvo.'
            : 'It adds context, but it does not directly answer the target outcome.');
    }
    if (classificationRole === 'supportive-secondary' || classificationRole === 'supportive-primary') {
      return isPt
        ? 'Esta evidência é útil para consistência e contexto, mas não tem o mesmo peso de um ensaio comparativo primário dominante.'
        : 'This evidence is useful for consistency and context, but it does not carry the same weight as a dominant primary comparative trial.';
    }

    return '';
  }

  buildComparativeNarrativeSummary(orderedItems = [], question = '', options = {}, language = 'en') {
    const isPt = language === 'pt' || language === 'bilingual';
    if (!Array.isArray(orderedItems) || orderedItems.length === 0) return '';

    const requestedEndpointText = this.clinicalIntentAgent.describeRequestedEndpoints(question, options, language);
    const directPrimary = orderedItems.filter(item => item.classification.role === 'direct-comparative-primary');
    const supportiveSecondary = orderedItems.filter(item =>
      ['supportive-primary', 'supportive-secondary', 'supportive-exploratory', 'supportive-synthesis'].includes(item.classification.role)
    );

    if (directPrimary.length > 0) {
      const refs = directPrimary.slice(0, 3).map(item => `[${item.index}]`).join(' ');
      const supportRefs = supportiveSecondary.slice(0, 3).map(item => `[${item.index}]`).join(' ');
      const firstSentence = isPt
        ? `No conjunto, a interpretação clínica é guiada sobretudo pelos estudos comparativos diretos ${refs}, enquanto as restantes publicações ajudam a qualificar consistência, maturidade e generalização do efeito.`
        : `Overall, the clinical interpretation is driven mainly by the direct comparative studies ${refs}, while the remaining publications help qualify consistency, maturity, and generalizability of the effect.`;
      const secondSentence = requestedEndpointText
        ? (isPt
            ? `Para ${requestedEndpointText}, nem todos os regimes dispõem de dados diretos igualmente maduros, o que exige separar claramente evidência ancoradora de evidência apenas contextual${supportRefs ? ` ${supportRefs}` : ''}.`
            : `For ${requestedEndpointText}, not all regimens are supported by equally mature direct data, so anchor evidence and contextual evidence need to be separated explicitly${supportRefs ? ` ${supportRefs}` : ''}.`)
        : (isPt
            ? `Isto é particularmente importante quando análises exploratórias ou sínteses indiretas apontam na mesma direção, mas não substituem o ensaio comparativo central${supportRefs ? ` ${supportRefs}` : ''}.`
            : `This is particularly important when exploratory analyses or indirect syntheses point in the same direction but do not replace the central comparative trial${supportRefs ? ` ${supportRefs}` : ''}.`);
      return `${firstSentence} ${secondSentence}`.trim();
    }

    const refs = supportiveSecondary.slice(0, 4).map(item => `[${item.index}]`).join(' ');
    return isPt
      ? `A literatura disponível é mais fragmentada e indireta neste conjunto ${refs}; por isso, a leitura deve privilegiar convergência de sinal e reconhecer que a base comparativa principal continua incompleta.`
      : `The available literature is more fragmented and indirect in this set ${refs}; interpretation should therefore emphasize signal convergence while recognizing that the main comparative foundation remains incomplete.`;
  }

  buildDetailedSafetyNarrative({
    safetyLine = '',
    limitationsLine = '',
    placeboRequested = false,
    directPlaceboCount = 0,
    orderedItems = [],
    language = 'en'
  } = {}) {
    const isPt = language === 'pt' || language === 'bilingual';
    const sentences = [String(safetyLine || '').trim()];
    if (placeboRequested) {
      sentences.push(isPt
        ? `A estrutura comparativa também variou ao longo da base de evidência, com controlo placebo direto em ${directPlaceboCount}/${Math.max(Array.isArray(orderedItems) ? orderedItems.length : 0, 1)} estudos selecionados; isso limita comparações transversais de segurança entre regimes.`
        : `Comparator structure also varied across the evidence base, with direct placebo control in ${directPlaceboCount}/${Math.max(Array.isArray(orderedItems) ? orderedItems.length : 0, 1)} selected studies; this limits cross-trial safety comparisons between regimens.`);
    } else {
      sentences.push(isPt
        ? 'Mesmo quando sinais de segurança foram reportados, a heterogeneidade de desenho e reporte reduz a confiança em comparações transversais entre estudos.'
        : 'Even when safety signals were reported, heterogeneity in design and reporting reduces confidence in cross-trial safety comparisons.');
    }
    if (limitationsLine) {
      sentences.push(limitationsLine);
    }
    return sentences.filter(Boolean).join(' ');
  }

  extractSectionBody(text = '', headingPattern = '') {
    const source = String(text || '');
    if (!source || !headingPattern) return '';
    const regex = new RegExp(`##\\s*(?:${headingPattern})\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
    const match = source.match(regex);
    return match ? String(match[1] || '').trim() : '';
  }

  hasRequiredDetailedSections(text = '') {
    const source = String(text || '');
    if (!source) return false;

    const patterns = [
      /##\s*(Clinical Question|Pergunta Cl[ií]nica)/i,
      /##\s*(Evidence Identified|Evid[eê]ncia Encontrada)/i,
      /##\s*(Comparative Findings|Achados Comparativos)/i,
      /##\s*(Safety and Limitations|Seguran[çc]a e Limita[çc][õo]es)/i,
      /##\s*(Practical Takeaway|Implica[çc][ãa]o Pr[aá]tica)/i
    ];

    return patterns.every(pattern => pattern.test(source));
  }

  splitParagraphs(text = '') {
    return String(text || '')
      .split(/\n\s*\n+/)
      .map(item => item.trim())
      .filter(Boolean);
  }

  deriveClinicalQuestionContext(question = '', options = {}, isPt = false, articles = [], evidenceSummaries = []) {
    const source = `${question || ''} ${options.population || ''} ${options.intervention || ''} ${options.comparator || ''} ${options.outcomes || ''}`.toLowerCase();
    const summaryByIndex = new Map((Array.isArray(evidenceSummaries) ? evidenceSummaries : [])
      .filter(item => Number.isFinite(item?.index))
      .map(item => [item.index, item]));
    const interventionCandidates = (Array.isArray(articles) ? articles : [])
      .map((article, idx) => this.inferInterventionLabel(article, summaryByIndex.get(idx + 1)))
      .filter(Boolean);
    const comparatorCandidates = (Array.isArray(articles) ? articles : [])
      .map((article, idx) => this.inferComparatorLabel(article, summaryByIndex.get(idx + 1)))
      .filter(Boolean);
    const endpointLabels = [];
    if ((articles || []).some(article => article?.endpointMetrics?.pcr)) endpointLabels.push('pCR');
    if ((articles || []).some(article => article?.endpointMetrics?.efs || article?.endpointMetrics?.dfs || article?.endpointMetrics?.pfs)) endpointLabels.push('EFS/DFS/PFS');
    if ((articles || []).some(article => article?.endpointMetrics?.os)) endpointLabels.push('OS');
    if ((articles || []).some(article => article?.endpointMetrics?.orr)) endpointLabels.push('ORR');
    if ((articles || []).some(article => article?.endpointMetrics?.grade34ae)) {
      endpointLabels.push(isPt ? 'EA G3-4' : 'G3-4 AEs');
    }
    const placeboRequested = this.isPlaceboComparatorRequested(question, options);
    const placeboCount = comparatorCandidates.filter(value => /\bplacebo\b/i.test(value)).length;

    const population = this.sanitizeEvidenceField(options.population) ||
      this.inferPopulationFromEvidence(question, options, isPt, articles, evidenceSummaries);

    const intervention = this.sanitizeEvidenceField(options.intervention) ||
      this.summarizeUniqueStudyFields(interventionCandidates, { language: isPt ? 'pt' : 'en' }) ||
      (/neoadjuvant|neoadjuvante/.test(source)
        ? (isPt
            ? 'Quimioterapia neoadjuvante, isolada ou combinada com imunoterapia/terapias alvo conforme o estudo.'
            : 'Neoadjuvant chemotherapy, alone or combined with immunotherapy/targeted therapy depending on the study.')
        : (isPt ? 'As intervenções variaram entre os estudos incluídos.' : 'Interventions varied across included studies.'));

    const comparator = this.sanitizeEvidenceField(options.comparator) ||
      (placeboRequested
        ? (placeboCount > 0
            ? (isPt
                ? `Placebo como comparador direto em ${placeboCount}/${articles.length || comparatorCandidates.length || 1} estudos; os restantes foram indiretos ou sem controlo claro.`
                : `Placebo was the direct comparator in ${placeboCount}/${articles.length || comparatorCandidates.length || 1} studies; the remainder were indirect or lacked a clear control.`)
            : (isPt
                ? 'Foi pedido comparador placebo, mas os estudos incluídos não mostraram placebo de forma consistente.'
                : 'A placebo comparator was requested, but included studies did not consistently show placebo control.'))
        : this.summarizeUniqueStudyFields(comparatorCandidates, { language: isPt ? 'pt' : 'en' }) ||
          (isPt ? 'Comparador definido por cada estudo incluído.' : 'Comparator defined by each included study.'));

    const outcomes = this.sanitizeEvidenceField(options.outcomes) ||
      (endpointLabels.length > 0
        ? `${endpointLabels.join(', ')}${(articles || []).some(article => !article?.endpointMetrics?.os)
          ? (isPt ? '; maturidade de OS limitada/inconsistente.' : '; OS maturity limited/inconsistently reported.')
          : '.'}`
        : (isPt
            ? 'pCR, EFS/DFS/PFS, OS, ORR e segurança, quando reportados.'
            : 'pCR, EFS/DFS/PFS, OS, ORR, and safety when reported.'));

    return { population, intervention, comparator, outcomes };
  }

  buildDeterministicDetailedAnswer(question = '', articles = [], evidenceSummaries = [], quickStats = {}, options = {}) {
    const responseLanguage = options.responseLanguage || 'en';
    const isPt = responseLanguage === 'pt' || responseLanguage === 'bilingual';
    const prepared = this.trimEvidenceForDetailedAnswer(
      (Array.isArray(articles) ? articles : []).slice(0, this.maxEvidenceArticles),
      Array.isArray(evidenceSummaries) ? evidenceSummaries : [],
      question,
      {
        ...options,
        responseLanguage
      }
    );
    const studies = prepared.articles;
    const summaries = prepared.evidenceSummaries;
    const orderedItems = prepared.orderedItems;
    const pico = this.deriveClinicalQuestionContext(question, options, isPt, studies, summaries);
    const placeboRequested = this.isPlaceboComparatorRequested(question, options);
    const years = studies
      .map(article => Number.parseInt(article?.year, 10))
      .filter(year => Number.isFinite(year));
    const yearRange = years.length > 0 ? `${Math.min(...years)}-${Math.max(...years)}` : '';
    const quickYearRange = this.sanitizeEvidenceField(quickStats?.yearRange || yearRange);

    const directPrimary = orderedItems.filter(item => item.classification.role === 'direct-comparative-primary');
    const supportivePrimary = orderedItems.filter(item => item.classification.role === 'supportive-primary');
    const supportiveSecondaryItems = orderedItems.filter(item => item.classification.role === 'supportive-secondary');
    const exploratoryItems = orderedItems.filter(item => item.classification.role === 'supportive-exploratory');
    const supportiveSynthesis = orderedItems.filter(item => item.classification.role === 'supportive-synthesis');
    const backgroundItems = orderedItems.filter(item => item.classification.role.startsWith('background'));
    const primaryPool = directPrimary.length > 0
      ? directPrimary
      : orderedItems.filter(item => item.classification.isPrimary);
    const safetyPool = primaryPool.length > 0
      ? primaryPool
      : orderedItems.filter(item => !item.classification.role.startsWith('background'));
    const directPlaceboCount = orderedItems.filter(item =>
      /\bplacebo\b/i.test(this.inferComparatorLabel(item.article, item.summary))
    ).length;
    const summaryState = this.assessEvidenceSummaryState(orderedItems, question, options);
    const requestedEndpointKeys = this.getRequestedEndpointKeys(question, options);

    if (orderedItems.length === 0) {
      const contextBits = [
        pico.intervention && `${isPt ? 'intervenção' : 'intervention'}: ${pico.intervention}`,
        pico.population && `${isPt ? 'população' : 'population'}: ${pico.population}`,
        pico.comparator && `${isPt ? 'comparador' : 'comparator'}: ${pico.comparator}`,
        pico.outcomes && `${isPt ? 'desfechos' : 'outcomes'}: ${pico.outcomes}`
      ].filter(Boolean);
      return isPt
        ? `A evidência recuperada para esta pergunta foi limitada. Não encontrei estudos comparativos utilizáveis o suficiente para resumir uma resposta confiável${contextBits.length > 0 ? ` (${contextBits.join('; ')})` : ''}.`
        : `The retrieved evidence for this question was limited. I could not identify enough usable comparative studies to give a reliable summary${contextBits.length > 0 ? ` (${contextBits.join('; ')})` : ''}.`;
    }

    const topicalItems = (directPrimary.length > 0 ? directPrimary : primaryPool).slice(0, 2);
    const contextualItems = [...supportivePrimary, ...supportiveSecondaryItems, ...exploratoryItems, ...supportiveSynthesis, ...backgroundItems]
      .filter(item => !topicalItems.some(selected => selected.index === item.index))
      .slice(0, 2);

    const finalizeSentence = (text = '') => {
      const trimmed = String(text || '').replace(/\s+/g, ' ').replace(/[.;\s]+$/g, '').trim();
      if (!trimmed) return '';
      return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
    };
    const requestedEndpointLabel = this.joinListWithAnd(
      requestedEndpointKeys.map(key => this.getEndpointLabel(key, responseLanguage)),
      responseLanguage
    );
    const classifyStudySignal = (item = {}) => {
      const relevantClaims = this.endpointJudgeAgent.getRelevantClaims(item.article, item.summary, question, options);
      const fallbackClaims = this.endpointClaimAgent.buildEndpointClaims(item.article, item.summary);
      const sourceClaims = (relevantClaims.length > 0 ? relevantClaims : fallbackClaims)
        .filter(claim => ['positive', 'neutral', 'negative'].includes(claim?.direction));
      if (sourceClaims.length === 0) return 'unclear';
      const hasPositive = sourceClaims.some(claim => claim.direction === 'positive');
      const hasNeutral = sourceClaims.some(claim => claim.direction === 'neutral');
      const hasNegative = sourceClaims.some(claim => claim.direction === 'negative');
      if (hasPositive && !hasNeutral && !hasNegative) return 'positive';
      if (hasNeutral && !hasPositive && !hasNegative) return 'neutral';
      if (hasNegative && !hasPositive && !hasNeutral) return 'negative';
      return 'mixed';
    };
    const overallSignal = (() => {
      const states = (topicalItems.length > 0 ? topicalItems : orderedItems)
        .map(item => classifyStudySignal(item))
        .filter(state => state !== 'unclear');
      if (states.length === 0) return 'limited';
      if (states.every(state => state === 'positive')) return 'positive';
      if (states.every(state => state === 'neutral')) return 'neutral';
      if (states.every(state => state === 'negative')) return 'negative';
      return 'mixed';
    })();
    const signalLead = {
      pt: {
        positive: '**sugere benefício**',
        neutral: '**não mostra vantagem clara**',
        negative: '**sugere um sinal desfavorável**',
        mixed: '**é mista**',
        limited: '**é limitada**'
      },
      en: {
        positive: '**suggests benefit**',
        neutral: '**does not show a clear advantage**',
        negative: '**suggests an unfavorable signal**',
        mixed: '**is mixed**',
        limited: '**is limited**'
      }
    };
    const signalText = isPt ? signalLead.pt[overallSignal] : signalLead.en[overallSignal];
    const topicContext = this.sanitizeEvidenceField(options.intervention) || '';
    const leadRefs = (directPrimary.length > 0 ? directPrimary : orderedItems)
      .slice(0, 2)
      .map(item => `[${item.index}]`)
      .join(' ');
    const introParagraph = summaryState.insufficient
      ? (isPt
          ? `Para esta pergunta, a evidência disponível${topicContext ? ` sobre ${topicContext}` : ''} é demasiado limitada, indireta ou heterogénea para sustentar uma conclusão clara${leadRefs ? ` ${leadRefs}` : ''}.`
          : `For this question, the available evidence${topicContext ? ` on ${topicContext}` : ''} is too limited, indirect, or heterogeneous to support a clear conclusion${leadRefs ? ` ${leadRefs}` : ''}.`)
      : (directPrimary.length > 0
          ? (isPt
              ? `Para esta pergunta, a evidência${topicContext ? ` sobre ${topicContext}` : ''} ${signalText}. Os estudos comparativos mais úteis são ${directPrimary.slice(0, 2).map(item => `[${item.index}]`).join(' ')}.`
              : `For this question, the evidence${topicContext ? ` on ${topicContext}` : ''} ${signalText}. The most useful comparative studies are ${directPrimary.slice(0, 2).map(item => `[${item.index}]`).join(' ')}.`)
          : (isPt
              ? `Para esta pergunta, a evidência${topicContext ? ` sobre ${topicContext}` : ''} ${signalText} e é maioritariamente indireta ou de apoio.`
              : `For this question, the evidence${topicContext ? ` on ${topicContext}` : ''} ${signalText} and is mostly indirect or supportive.`));

    const buildStudyNarrative = (item = {}, { lead = false } = {}) => {
      const rawTrialName = this.sanitizeEvidenceField(item?.article?.trialName || item?.article?.title || (isPt ? 'Estudo' : 'Study'));
      const trialName = `**${rawTrialName}**`;
      const ref = `[${item.index}]`;
      const contextSentence = finalizeSentence(this.buildStudyContextSentence(item.article, item.summary, responseLanguage));
      const findingSentence = finalizeSentence(this.endpointJudgeAgent.buildStudyFindingText(
        item.article,
        item.summary,
        question,
        options,
        responseLanguage
      ));
      const metricsSentence = finalizeSentence(this.buildStudyMetricsSentence(item.article, question, options, responseLanguage));
      const requestedClaims = this.endpointJudgeAgent.getRelevantClaims(item.article, item.summary, question, options);
      const requestedOutcomeGap = requestedEndpointKeys.length > 0 && requestedClaims.length === 0;
      const roleSentence = requestedOutcomeGap
        ? (isPt
            ? `Não responde diretamente ao desfecho pedido${requestedEndpointLabel ? ` (${requestedEndpointLabel})` : ''}.`
            : `It does not directly answer the requested outcome${requestedEndpointLabel ? ` (${requestedEndpointLabel})` : ''}.`)
        : (item.classification.role === 'supportive-synthesis'
            ? (isPt ? 'É evidência indireta e mais útil como contexto do que como comparação direta.' : 'It is indirect evidence and is more useful for context than as a direct comparison.')
            : item.classification.role === 'supportive-exploratory'
              ? (isPt ? 'É uma análise exploratória e deve ser lida como contextual.' : 'It is an exploratory analysis and should be read as contextual.')
              : (['supportive-primary', 'supportive-secondary'].includes(item.classification.role)
                  ? (isPt ? 'Ajuda com consistência e contexto, mas não resolve sozinha a comparação principal.' : 'It helps with consistency and context, but it does not settle the main comparison on its own.')
                  : ''));
      const limitationText = this.sanitizeEvidenceField(item?.summary?.limitations || '');
      const limitationSentence = limitationText && /immature|imatura|heterogen|inconsisten|single-arm|phase ii|phase 2|exploratory|post hoc/i.test(limitationText)
        ? finalizeSentence(limitationText)
        : '';
      const leadSentence = lead
        ? (directPrimary.length > 0
            ? (isPt ? `O estudo mais diretamente relevante é ${trialName} ${ref}.` : `The most directly relevant study is ${trialName} ${ref}.`)
            : (isPt ? `O principal sinal recuperado vem de ${trialName} ${ref}.` : `The main retrieved signal comes from ${trialName} ${ref}.`))
        : (item.classification.role === 'direct-comparative-primary'
            ? (isPt ? `${trialName} ${ref} acrescenta evidência comparativa adicional.` : `${trialName} ${ref} adds additional comparative evidence.`)
            : (isPt ? `${trialName} ${ref} acrescenta contexto.` : `${trialName} ${ref} adds context.`));

      return [
        finalizeSentence(leadSentence),
        contextSentence,
        findingSentence,
        metricsSentence,
        roleSentence,
        limitationSentence
      ].filter(Boolean).join(' ');
    };

    const studyParagraph = topicalItems
      .map((item, index) => buildStudyNarrative(item, { lead: index === 0 }))
      .filter(Boolean)
      .join(' ');

    const contextualLabels = contextualItems
      .map(item => `${this.sanitizeEvidenceField(item.article?.trialName || item.article?.title || (isPt ? 'Estudo' : 'Study'))} [${item.index}]`)
      .filter(Boolean);
    const contextualParagraph = contextualLabels.length > 0
      ? (summaryState.insufficient
          ? (isPt
              ? `As restantes publicações, como ${this.joinListWithAnd(contextualLabels, responseLanguage)}, acrescentam sobretudo contexto ou sinal indireto, sem resolver a comparação principal.`
              : `The remaining papers, such as ${this.joinListWithAnd(contextualLabels, responseLanguage)}, mostly add context or indirect signal rather than resolving the main comparison.`)
          : (isPt
              ? `Outras publicações do conjunto, como ${this.joinListWithAnd(contextualLabels, responseLanguage)}, ajudam sobretudo com contexto, consistência ou perguntas relacionadas, mais do que com a comparação central.`
              : `Other papers in the set, such as ${this.joinListWithAnd(contextualLabels, responseLanguage)}, are mainly helpful for context, consistency, or related questions rather than the core comparison.`))
      : '';

    const safetySignals = safetyPool
      .map(item => ({ index: item.index, grade34ae: item.article?.endpointMetrics?.grade34ae || '' }))
      .filter(item => Boolean(item.grade34ae));
    const comparatorMissingCount = primaryPool.filter(item => !this.inferComparatorLabel(item.article, item.summary)).length;
    const phase2LikeCount = primaryPool.filter(item => {
      const designText = `${item.summary?.study_design || ''} ${item.article?.studyDesign || ''}`.toLowerCase();
      return /phase ii|phase 2|retrospective|single-arm|single arm|open-label/.test(designText);
    }).length;
    const requestedEndpointLimitation = this.endpointJudgeAgent.buildRequestedEndpointLimitations(
      primaryPool,
      question,
      options,
      responseLanguage
    );

    const safetyRefs = [...new Set(safetyPool.slice(0, 3).map(item => `[${item.index}]`))].join(' ');
    const safetyLine = safetySignals.length > 0
      ? (isPt
          ? `Dados explícitos de EA G3-4 apareceram em ${safetySignals.length}/${Math.max(safetyPool.length, 1)} estudos centrais (${safetySignals.map(item => `[${item.index}]`).join(' ')}).`
          : `Explicit grade 3-4 AE data were reported in ${safetySignals.length}/${Math.max(safetyPool.length, 1)} central studies (${safetySignals.map(item => `[${item.index}]`).join(' ')}).`)
      : (isPt
          ? `A segurança foi reportada de forma heterogénea, e dados de EA G3-4 não foram consistentes nos estudos principais${safetyRefs ? ` ${safetyRefs}` : ''}.`
          : `Safety reporting was heterogeneous, and grade 3-4 AE data were not consistently reported across the main studies${safetyRefs ? ` ${safetyRefs}` : ''}.`);

    const limitationParts = [];
    if (phase2LikeCount > 0) {
      limitationParts.push(isPt
        ? `${phase2LikeCount}/${Math.max(primaryPool.length, 1)} estudos com desenho de menor robustez (ex.: fase II/retrospectivo/single-arm)`
        : `${phase2LikeCount}/${Math.max(primaryPool.length, 1)} studies had lower-robustness design features (e.g., phase II/retrospective/single-arm)`);
    }
    if (requestedEndpointLimitation) {
      limitationParts.push(requestedEndpointLimitation);
    }
    if (comparatorMissingCount > 0) {
      limitationParts.push(isPt
        ? `comparador explícito ausente em ${comparatorMissingCount}/${Math.max(primaryPool.length, 1)} estudos clinicamente centrais`
        : `explicit comparators were missing in ${comparatorMissingCount}/${Math.max(primaryPool.length, 1)} clinically central studies`);
    }
    if (directPrimary.length === 0 && orderedItems.length > 0) {
      limitationParts.push(isPt
        ? 'a maioria das publicações foi indireta ou de apoio'
        : 'most retrieved publications were indirect or supportive');
    }
    if (orderedItems.length <= 2 && quickYearRange) {
      limitationParts.push(isPt
        ? `a base recuperada foi pequena (${orderedItems.length} estudo(s), ${quickYearRange})`
        : `the retrieved set was small (${orderedItems.length} study/studies, ${quickYearRange})`);
    }
    const limitationsLine = limitationParts.length > 0
      ? `${isPt ? 'As principais limitações foram' : 'The main limitations were'} ${limitationParts.join('; ')}.`
      : (isPt ? 'Persistem limitações metodológicas relevantes na base recuperada.' : 'Relevant methodological limitations remain in the retrieved evidence base.');

    const directnessLine = placeboRequested
      ? (isPt
          ? `Para o comparador placebo, apenas ${directPlaceboCount}/${orderedItems.length} estudo(s) fizeram essa comparação de forma direta.`
          : `For the placebo comparison, only ${directPlaceboCount}/${orderedItems.length} study/studies addressed it directly.`)
      : '';
    const takeaway = this.buildDetailedTakeaway(
      orderedItems,
      question,
      {
        ...options,
        _summaryState: summaryState
      },
      responseLanguage
    );
    const safetyNarrative = this.buildDetailedSafetyNarrative({
      safetyLine,
      limitationsLine,
      placeboRequested,
      directPlaceboCount,
      orderedItems,
      language: responseLanguage
    });

    return [
      introParagraph,
      studyParagraph,
      [contextualParagraph, directnessLine].filter(Boolean).join(' '),
      safetyNarrative,
      takeaway
    ].filter(Boolean).join('\n\n');
  }

  enforceDetailedAnswerQuality(answer = '', question = '', articles = [], evidenceSummaries = [], quickStats = {}, options = {}) {
    const cleaned = this.cleanMissingPlaceholders(answer);
    const lower = cleaned.toLowerCase();
    const paragraphs = this.splitParagraphs(cleaned);
    const prepared = this.sortEvidenceForSynthesis(articles, evidenceSummaries, question, options);
    const summaryState = this.assessEvidenceSummaryState(prepared.orderedItems || [], question, options);
    const limitedOrMixedEvidence = summaryState.insufficient ||
      ['non_directional', 'single_weak_direct', 'small_mixed_base'].includes(summaryState.reason);

    const qualityScore = Number(options.qualityScore);
    const lowQuality = Number.isFinite(qualityScore) && qualityScore < 0.78;
    const hasForbiddenToken = this.forbiddenMissingTokens.some(token => lower.includes(token));
    const hasLegacyStructuredHeadings = this.hasRequiredDetailedSections(cleaned);
    const hasMarkdownHeading = /^\s*#{1,6}\s+/m.test(cleaned);
    const isH2H = /\bvs\.?\b|versus|\bcompare\b|\bcomparison\b|\bhead.to.head\b|\bdifference between\b/i.test(question);
    const hasComparativeTable = !isH2H && /\n\|.+\|\n\|\s*---/i.test(cleaned);
    const hasMarkdownBullets = /^\s*(?:[-*]|\d+\.)\s+/m.test(cleaned);
    const safetyBody = paragraphs.find(paragraph =>
      /\b(safety|adverse|toxicit|grade 3-4|grade 3\/4|grade 3-4 ae|grade 3\/4 ae|limitation|heterogen|immature|inconsisten|seguran|evento adverso|toxicidade|limita)\b/i.test(paragraph)
    ) || '';
    const takeawayBody = paragraphs.at(-1) || '';
    const insufficientNarrative = limitedOrMixedEvidence
      ? paragraphs.length < 2 || cleaned.length < 120
      : paragraphs.length < 3 || cleaned.length < 180;
    const weakSafety = !limitedOrMixedEvidence && (
      !safetyBody ||
      safetyBody.length < 55 ||
      /(?:were in the source texts|further research is needed to understand the safety|did not provide specific numbers|no specific numbers provided)/i.test(safetyBody)
    );
    const weakTakeaway = !limitedOrMixedEvidence && (!takeawayBody || takeawayBody.length < 35);
    const genericTakeaway = /early efficacy signal|signal of activity|practice translation still depends|decisions should be integrated with guidelines and individual context|late-endpoint maturity remains limited/i.test(takeawayBody);
    const requestedEndpointKeys = this.getRequestedEndpointKeys(question, options);
    const takeawayDriftsFromRequestedOutcomes = requestedEndpointKeys.length > 0 &&
      ['os', 'efs', 'pcr', 'orr', 'grade34ae']
        .filter(key => !requestedEndpointKeys.includes(key))
        .some(key => this.textMentionsEndpointKey(takeawayBody, key));
    const strongPracticeAnchoredEvidence = this.hasStrongPracticeAnchoredEvidence(question, articles, evidenceSummaries, options);
    const missingCitationsInCriticalSections = !limitedOrMixedEvidence &&
      Array.isArray(articles) && articles.length > 0 &&
      (!/\[\d+\]/.test(safetyBody) || !/\[\d+\]/.test(takeawayBody));
    const hasBrokenFragments = /(?:specific|detailed)\s+(?:findings|results)[^.\n]{0,120}\sare\s*(?:\[[0-9,\s]+\])?\.?(?=\s|$)/i.test(cleaned) ||
      /the specific safety profiles and limitations of the studies were in the source texts/i.test(cleaned);
    const qualityTriggered = lowQuality && (
      (!limitedOrMixedEvidence && weakSafety) ||
      (!limitedOrMixedEvidence && weakTakeaway) ||
      (!limitedOrMixedEvidence && missingCitationsInCriticalSections) ||
      hasBrokenFragments ||
      (!limitedOrMixedEvidence && genericTakeaway && strongPracticeAnchoredEvidence) ||
      (!limitedOrMixedEvidence && takeawayDriftsFromRequestedOutcomes)
    );

    // Only rebuild for truly broken answers — good prose should pass through
    const needsRebuild = hasForbiddenToken ||
      hasLegacyStructuredHeadings ||
      hasComparativeTable ||
      hasBrokenFragments ||
      cleaned.length < 80;

    if (!needsRebuild) {
      return cleaned;
    }

    const rebuilt = this.buildDeterministicDetailedAnswer(
      question,
      articles,
      evidenceSummaries,
      quickStats,
      options
    );
    return rebuilt || cleaned;
  }

  splitIntoSentences(text = '') {
    return String(text || '')
      .replace(/\n+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map(item => item.trim())
      .filter(Boolean);
  }

  extractCitedIndices(text = '') {
    const matches = [...String(text || '').matchAll(/\[(\d+)\]/g)];
    return [...new Set(matches
      .map(match => Number.parseInt(match[1], 10))
      .filter(value => Number.isFinite(value) && value > 0))];
  }

  validateNumericClaims(answer = '', articles = [], evidenceSummaries = []) {
    const numericPattern = /(?:\b\d+(?:\.\d+)?\s*%|\b(?:hazard ratio|hr|rr|or)\s*(?:=|:)?\s*\d+(?:\.\d+)?|\bN\s*(?:=|:)?\s*\d+\b|\b\d+(?:\.\d+)?\s*(?:months?|years?)\b)/gi;
    const sentences = this.splitIntoSentences(answer);
    const unsupportedClaims = [];
    const uncitedClaims = [];
    let checkedClaims = 0;

    for (const sentence of sentences) {
      const claims = sentence.match(numericPattern) || [];
      if (claims.length === 0) continue;

      const cited = this.extractCitedIndices(sentence);
      for (const claim of claims) {
        checkedClaims += 1;
        if (cited.length === 0) {
          uncitedClaims.push({ claim, sentence });
          continue;
        }

        let supported = false;
        for (const refIndex of cited) {
          const article = articles[refIndex - 1];
          const summary = (Array.isArray(evidenceSummaries) ? evidenceSummaries : []).find(item => item?.index === refIndex) || null;
          if (this.numericClaimSupportedByEvidence(claim, article, summary)) {
            supported = true;
            break;
          }
        }

        if (!supported) {
          unsupportedClaims.push({ claim, sentence, cited });
        }
      }
    }

    return {
      checkedClaims,
      unsupportedClaims,
      uncitedClaims
    };
  }

  numericClaimSupportedByEvidence(claim = '', article = null, summary = null) {
    if (!article) return false;
    const claimText = String(claim || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!claimText) return false;

    const metrics = article?.endpointMetrics || {};
    const sourceText = [
      article?.title,
      article?.abstract,
      article?.journal,
      article?.year,
      article?.studyDesign,
      article?.trialName,
      summary?.key_findings,
      summary?.outcomes,
      summary?.population,
      summary?.intervention,
      summary?.comparator,
      ...Object.values(metrics || {})
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .replace(/\s+/g, ' ');

    const normalizeNumericToken = (value = '') => String(value || '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[;,]/g, '.')
      .trim();

    const claimToken = normalizeNumericToken(claimText);
    const sourceToken = normalizeNumericToken(sourceText);

    if (claimText.includes('%')) {
      return sourceToken.includes(claimToken);
    }

    if (/\b(hr|hazard ratio|rr|or)\b/.test(claimText)) {
      const value = claimText.match(/(\d+(?:\.\d+)?)/)?.[1];
      if (!value) return false;
      const ratioPattern = new RegExp(`(?:hazardratio|hr|rr|or)(?:=|:)?${normalizeNumericToken(value)}`);
      return ratioPattern.test(sourceToken) || sourceToken.includes(normalizeNumericToken(value));
    }

    if (/\bn\s*(=|:)?\s*\d+/.test(claimText)) {
      const nValue = claimText.match(/(\d{2,6})/)?.[1];
      if (!nValue) return false;
      return (
        String(metrics?.sampleSize || '') === nValue ||
        new RegExp(`\\bn\\s*(=|:)?\\s*${nValue}\\b`).test(sourceText) ||
        new RegExp(`\\b${nValue}\\s+(patients|participants|subjects)\\b`).test(sourceText)
      );
    }

    if (/\b\d+(?:\.\d+)?\s*(months?|years?)\b/.test(claimText)) {
      const value = claimText.match(/(\d+(?:\.\d+)?\s*(?:months?|years?))/)?.[1];
      if (!value) return false;
      return sourceText.includes(value);
    }

    return sourceToken.includes(claimToken);
  }

  buildSupportedFactsLines(articles = [], evidenceSummaries = []) {
    const summaryByIndex = new Map((Array.isArray(evidenceSummaries) ? evidenceSummaries : [])
      .filter(item => Number.isFinite(item?.index))
      .map(item => [item.index, item]));

    return (Array.isArray(articles) ? articles : []).map((article, idx) => {
      const index = idx + 1;
      const summary = summaryByIndex.get(index) || {};
      const m = article?.endpointMetrics || {};
      const metrics = [
        m.sampleSize && `N ${m.sampleSize}`,
        m.pcr && `pCR ${m.pcr}`,
        m.efs && `EFS ${m.efs}`,
        m.dfs && `DFS ${m.dfs}`,
        m.pfs && `PFS ${m.pfs}`,
        m.os && `OS ${m.os}`,
        m.orr && `ORR ${m.orr}`,
        m.grade34ae && `G3-4 AEs ${m.grade34ae}`
      ].filter(Boolean).join(' | ');
      return `[${index}] PMID ${article?.pmid || 'n/a'} | ${article?.title || 'Study'} | ${metrics || 'no explicit endpoint metrics'} | Findings: ${summary?.key_findings || 'available in source text'}`;
    }).join('\n');
  }

  async repairUnsupportedNumericClaims(answer = '', question = '', articles = [], evidenceSummaries = [], claimAudit = {}, options = {}) {
    const draft = String(answer || '').trim();
    if (!draft) return draft;
    if (!this.openai) return this.cleanMissingPlaceholders(draft);

    const unsupported = Array.isArray(claimAudit?.unsupportedClaims) ? claimAudit.unsupportedClaims : [];
    const uncited = Array.isArray(claimAudit?.uncitedClaims) ? claimAudit.uncitedClaims : [];
    if (unsupported.length === 0 && uncited.length === 0) {
      return this.cleanMissingPlaceholders(draft);
    }

    const language = options.responseLanguage || 'en';
    const languageInstruction = {
      pt: 'Write in European Portuguese (Portugal, pt-PT). Use Portuguese spelling and vocabulary, NOT Brazilian Portuguese.',
      en: 'Write in English.',
      auto: 'Write in the SAME language as the user question. If Portuguese, use European Portuguese (pt-PT — NOT Brazilian).'
    }[language] || 'Write in the same language as the user question.';
    const supportedFacts = this.buildSupportedFactsLines(articles, evidenceSummaries);
    const issueLines = [
      ...unsupported.slice(0, 20).map(item => `- Unsupported claim: "${item.claim}" in sentence "${item.sentence}" cited as [${(item.cited || []).join(',')}]`),
      ...uncited.slice(0, 20).map(item => `- Uncited numeric claim: "${item.claim}" in sentence "${item.sentence}"`)
    ].join('\n');

    try {
      const prompt = `You are correcting unsupported numeric claims in a clinical synthesis.
${languageInstruction}

Task:
- Keep the same overall prose flow.
- Do not introduce section headings, markdown tables, bullets, or numbered lists.
- Remove or rewrite numeric claims that are unsupported.
- Use ONLY numeric facts present in "Supported facts by citation".
- If a number cannot be supported, rewrite that point qualitatively.
- Keep citations [n] for major claims.
- Do not output unfinished clauses.

Question:
${question}

Supported facts by citation:
${supportedFacts}

Claims to fix:
${issueLines || '- none'}

Draft answer:
${draft}

Return only the corrected answer.`;

      // Large prompt (draft + supportedFacts) — route directly to Bedrock to avoid Groq rate limits
      const response = await this.openai.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1800,
        temperature: 0.1
      });
      const revised = response.choices[0]?.message?.content?.trim() || draft;
      return this.cleanMissingPlaceholders(revised);
    } catch (error) {
      logger.warn(`Unsupported-claim repair failed: ${error.message}`);
      return this.cleanMissingPlaceholders(draft);
    }
  }

  // ---- PubMed cache (30-min TTL, avoids repeat API calls for same query) ----

  _pubmedCache = new Map();
  _PUBMED_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
  _PUBMED_CACHE_MAX = 100; // max entries to prevent memory bloat

  _getPubmedCacheKey(query, maxResults) {
    return `${String(query || '').trim().toLowerCase()}::${maxResults}`;
  }

  _cleanPubmedCache() {
    if (this._pubmedCache.size <= this._PUBMED_CACHE_MAX) return;
    const now = Date.now();
    for (const [key, entry] of this._pubmedCache) {
      if (now - entry.ts > this._PUBMED_CACHE_TTL) this._pubmedCache.delete(key);
    }
    // If still too large, evict oldest
    if (this._pubmedCache.size > this._PUBMED_CACHE_MAX) {
      const entries = [...this._pubmedCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
      for (let i = 0; i < entries.length - this._PUBMED_CACHE_MAX; i++) {
        this._pubmedCache.delete(entries[i][0]);
      }
    }
  }

  /**
   * Search PubMed for articles (with 30-min in-memory cache)
   */
  async searchPubMed(query, maxResults = 10) {
    try {
      const baseUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
      const apiKey = process.env.NCBI_API_KEY || '';
      const normalizedQuery = this.sanitizePubMedQuery(query);

      if (!normalizedQuery) return [];

      // Check cache
      const cacheKey = this._getPubmedCacheKey(normalizedQuery, maxResults);
      const cached = this._pubmedCache.get(cacheKey);
      if (cached && (Date.now() - cached.ts < this._PUBMED_CACHE_TTL)) {
        logger.info(`[PubMed] Cache hit for "${normalizedQuery.substring(0, 60)}..." (${cached.articles.length} articles)`);
        return cached.articles;
      }

      // Search for article IDs
      const searchUrl = `${baseUrl}esearch.fcgi?db=pubmed&term=${encodeURIComponent(normalizedQuery)}&retmax=${maxResults}&sort=relevance&retmode=xml&api_key=${apiKey}`;
      const searchResponse = await fetch(searchUrl);
      const searchXml = await searchResponse.text();

      // Parse article IDs
      const articleIds = this.parsePubMedSearchResults(searchXml);

      if (articleIds.length === 0) {
        this._pubmedCache.set(cacheKey, { articles: [], ts: Date.now() });
        return [];
      }

      // Fetch article details
      const fetchUrl = `${baseUrl}efetch.fcgi?db=pubmed&id=${articleIds.join(',')}&retmode=xml&api_key=${apiKey}`;
      const fetchResponse = await fetch(fetchUrl);
      const fetchXml = await fetchResponse.text();

      // Parse article details
      const articles = this.parsePubMedArticles(fetchXml);

      // Store in cache
      this._pubmedCache.set(cacheKey, { articles, ts: Date.now() });
      this._cleanPubmedCache();

      return articles;
    } catch (error) {
      logger.error(`PubMed search failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Expand a query with oncology-specific terms for better recall
   */
  async expandQuery(query) {
    try {
      const cleanedQuery = this.stripNonClinicalTerms(query);
      const prompt = `You are expanding a PubMed search query.
Original query: "${cleanedQuery}"

Return one PubMed-friendly keyword query with strong recall and no narrative text.
Rules:
- Output only the query string (no explanation).
- Do not wrap the full query in quotes.
- Keep it under 18 terms.
- Focus on oncology and evidence-based medicine.
- Prefer disease + treatment + key context terms.
- Avoid adding unrelated terms.
- NEVER include country names, reimbursement, cost, policy, or regulatory terms — these are not PubMed-searchable.`;

      const response = await this.fastModel.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 80,
        temperature: 0.2
      });

      const expanded = this.sanitizePubMedQuery(response.choices[0]?.message?.content || '');
      if (!expanded || expanded.toLowerCase() === query.toLowerCase()) {
        return null;
      }
      return expanded;
    } catch (error) {
      logger.warn(`Query expansion failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Merge PubMed articles by PMID
   */
  mergeArticles(primary = [], secondary = []) {
    const merged = [];
    const seen = new Set();

    for (const article of [...primary, ...secondary]) {
      if (!article?.pmid) continue;
      if (seen.has(article.pmid)) continue;
      seen.add(article.pmid);
      merged.push(article);
    }

    return merged;
  }

  /**
   * Normalize conversation history for safe prompt usage
   */
  normalizeConversationHistory(history = []) {
    if (!Array.isArray(history)) return [];

    return history
      .filter(item => item && typeof item.content === 'string')
      .map(item => {
        const role = item.role === 'assistant' ? 'assistant' : 'user';
        const content = item.content.trim().replace(/\s+/g, ' ').slice(0, 1400);
        return { role, content };
      })
      .filter(item => item.content.length > 0)
      .slice(-this.maxConversationTurns);
  }

  /**
   * Lightweight language detection for response shaping
   */
  detectQuestionLanguage(question = '') {
    const text = String(question || '').toLowerCase();

    const ptSignals = [
      'que ', 'qual ', 'quais ', 'como ', 'onde ', 'quando ',
      'tratamento', 'doente', 'cancro', 'evidência', 'ensaio',
      'sobrevivência', 'resultado', 'existe', 'eficácia',
      'comparação', 'efeitos', 'quimioterapia', 'doença',
      'pode ', 'tem ', 'são ', 'está ', 'foi ', 'para '
    ];
    const enSignals = [
      'what ', 'which ', 'how ', 'where ', 'when ',
      'treatment', 'patient', 'cancer', 'evidence', 'trial',
      'survival', 'outcome', 'efficacy', 'comparison',
      'therapy', 'disease', 'are ', 'is ', 'was ', 'the ',
      'does ', 'can ', 'should '
    ];
    const esSignals = [
      'qué ', 'cuál ', 'cuáles ', 'cómo ', 'dónde ', 'cuándo ',
      'tratamiento', 'paciente', 'cáncer', 'evidencia', 'ensayo',
      'supervivencia', 'resultado', 'existe', 'eficacia',
      'comparación', 'efectos', 'quimioterapia', 'enfermedad',
      'puede ', 'tiene ', 'son ', 'está ', 'fue ', 'para '
    ];
    const frSignals = [
      'quel ', 'quelle ', 'quels ', 'comment ', 'où ', 'quand ',
      'traitement', 'patient', 'cancer', 'évidence', 'essai',
      'survie', 'résultat', 'existe', 'efficacité',
      'comparaison', 'effets', 'chimiothérapie', 'maladie',
      'peut ', 'sont ', 'est ', 'les ', 'des ', 'pour '
    ];

    const scores = { pt: 0, en: 0, es: 0, fr: 0 };

    for (const term of ptSignals) { if (text.includes(term)) scores.pt++; }
    for (const term of enSignals) { if (text.includes(term)) scores.en++; }
    for (const term of esSignals) { if (text.includes(term)) scores.es++; }
    for (const term of frSignals) { if (text.includes(term)) scores.fr++; }

    // Portuguese-specific diacritics boost
    if (/[ãõçêâô]/.test(text)) scores.pt += 2;
    // Spanish-specific patterns
    if (/[ñ¿¡]/.test(text)) scores.es += 2;
    // French-specific patterns
    if (/[éèêëàùûüïîôœæç]/.test(text) && !/[ãõ]/.test(text)) scores.fr++;
    // General Latin diacritics (slight pt boost if no other language dominates)
    if (/[\u00C0-\u017F]/.test(text)) scores.pt++;

    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    return best[1] > 0 ? best[0] : 'en';
  }

  /**
   * Resolve response language from explicit preference or detected language
   */
  resolveResponseLanguage(question, options = {}) {
    const preferred = String(options.language || 'auto').toLowerCase();
    if (preferred === 'pt' || preferred === 'en' || preferred === 'bilingual') {
      return preferred;
    }
    // "auto" — detect from the question so the directive is explicit
    return this.detectQuestionLanguage(question);
  }

  isPortugueseResponse(language = 'en', question = '') {
    if (language === 'pt' || language === 'bilingual') return true;
    if (language === 'auto' && question) return this.detectQuestionLanguage(question) === 'pt';
    return false;
  }

  /**
   * Heuristic to detect follow-up questions that benefit from rewriting
   */
  shouldRewriteQuestion(question, history = []) {
    // Skip rewrite entirely if no conversation history and question has enough English clinical terms
    // The clinicalTermExtractor can handle Portuguese → English mapping locally without an LLM call
    const text = String(question || '').trim().toLowerCase();
    const isNonEnglish = /[àáâãéêíóôõúçñ]/.test(text) || /\b(cancro|quimioterapia|neoadjuvante|adjuvante|doentes|evidência|tratamento|ensaio|sobrevivência)\b/i.test(text);
    const hasHistory = Array.isArray(history) && history.length > 0;

    if (isNonEnglish && !hasHistory) {
      // For standalone Portuguese questions, try fast local extraction first
      // The extracted English terms will be used by evidenceSelectionService
      // Only rewrite via LLM if the question is complex (long, multiple clauses)
      if (text.length < 120 && !/\b(compar|versus|vs\.?|diferença|melhor|pior)\b/i.test(text)) {
        logger.info('[Rewrite] Skipping LLM rewrite for simple Portuguese question — using local term extraction');
        return false;
      }
      return true;
    }

    if (isNonEnglish) return true; // non-English with history always needs rewrite

    if (!hasHistory) return false;

    if (text.length < 8) return true;

    const followUpPatterns = [
      /^e\s+/,
      /^and\s+/,
      /\b(what about|vs\b|versus|compared|compared with)\b/,
      /\b(e quanto|em relaÃ§Ã£o|nesse caso|isso|disso|desses|dessa)\b/,
      /\b(it|they|those|this|that)\b/
    ];

    return followUpPatterns.some(pattern => pattern.test(text));
  }

  /**
   * Get concise prior assistant response to avoid repetition in follow-ups
   */
  getLastAssistantResponse(history = []) {
    if (!Array.isArray(history)) return null;
    const lastAssistant = [...history].reverse().find(item => item.role === 'assistant');
    if (!lastAssistant?.content) return null;
    return lastAssistant.content.slice(0, 1200);
  }

  /**
   * Build plain-text transcript for follow-up question rewriting
   */
  buildConversationTranscript(history = []) {
    return history
      .map((item, index) => `${index + 1}. ${item.role.toUpperCase()}: ${item.content}`)
      .join('\n');
  }

  /**
   * Rewrite follow-up question into a standalone clinical question
   */
  async rewriteStandaloneQuestion(question, conversationHistory = [], options = {}) {
    const normalizedHistory = this.normalizeConversationHistory(conversationHistory);
    if (!this.openai || !this.shouldRewriteQuestion(question, normalizedHistory)) {
      return question;
    }

    const contextHints = [
      options.population && `Population: ${options.population}`,
      options.intervention && `Intervention: ${options.intervention}`,
      options.comparator && `Comparator: ${options.comparator}`,
      options.outcomes && `Outcomes: ${options.outcomes}`,
      options.biomarker && `Biomarker: ${options.biomarker}`,
      options.lineOfTherapy && `Line of therapy: ${options.lineOfTherapy}`
    ].filter(Boolean).join('\n');

    const transcript = this.buildConversationTranscript(normalizedHistory);
    const prompt = `Rewrite the question into a standalone English oncology question suitable for PubMed search.

Rules:
- If the question is in a non-English language, TRANSLATE it to English.
- Preserve clinical intent and constraints (cancer type, drug, biomarker, line of therapy, stage).
- Use standard oncology English terminology (e.g., "triple-negative breast cancer" not "cancro da mama triplo negativo").
- Keep it concise and specific for PubMed search.
- Do not add new facts.
- Return only the rewritten question text in English.

Conversation:
${transcript || 'No prior context'}

${contextHints ? `Structured context:\n${contextHints}\n` : ''}
Question: ${question}`;

    try {
      const response = await this.fastModel.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 120,
        temperature: 0.1
      });

      const rewritten = response.choices[0]?.message?.content?.trim();
      if (!rewritten || rewritten.length < 8) {
        return question;
      }

      return rewritten;
    } catch (error) {
      logger.warn(`Follow-up rewrite failed: ${error.message}`);
      return question;
    }
  }

  /**
   * Build a clinically structured search variant from options
   */
  buildStructuredSearchQuery(question, options = {}) {
    const clauses = [
      this.buildSearchClauseFromText(options.population),
      this.buildSearchClauseFromText(options.intervention, {
        fallbackPhrase: false,
        fallbackTokenLimit: 4
      }),
      this.buildSearchClauseFromText(options.comparator, {
        fallbackPhrase: false,
        fallbackTokenLimit: 4
      }),
      this.buildSearchClauseFromText(options.outcomes, {
        fallbackPhrase: false,
        fallbackTokenLimit: 3
      }),
      this.buildSearchClauseFromText(options.biomarker, {
        fallbackPhrase: false,
        fallbackTokenLimit: 3
      }),
      this.buildSearchClauseFromText(options.lineOfTherapy, {
        fallbackPhrase: false,
        fallbackTokenLimit: 3
      }),
      this.buildPreferenceQueryClause(options.studyTypes, this.mapStudyTypePreferenceToSearchTerms),
      this.buildPreferenceQueryClause(options.endpoints, this.mapEndpointPreferenceToSearchTerms),
      this.buildPreferenceQueryClause(options.trialPhases, this.mapTrialPhasePreferenceToSearchTerms)
    ].filter(Boolean);

    if (clauses.length === 0) {
      return this.buildSearchClauseFromText(question, {
        fallbackPhrase: false,
        fallbackTokenLimit: 5
      });
    }

    return clauses.join(' AND ');
  }

  /**
   * Build a small set of complementary search queries
   */
  /**
   * Build a PubMed query optimized for supportive care / toxicity management questions.
   * Adds publication type filters for guidelines, systematic reviews, and consensus statements.
   */
  buildSupportiveCareSearchQuery(question = '', options = {}) {
    const baseQuery = this.buildKeywordFocusedQuery(question, options);
    if (!baseQuery) return '';

    // Add guideline/review publication type filter to prioritize practice-changing evidence
    const guidelineFilter = '(Practice Guideline[pt] OR Guideline[pt] OR Consensus Development Conference[pt] OR Systematic Review[pt] OR Meta-Analysis[pt] OR Review[pt])';
    return `(${baseQuery}) AND ${guidelineFilter}`;
  }

  /**
   * Build a broader supportive care query without the guideline filter,
   * but with supportive care MeSH terms appended.
   */
  buildSupportiveCareBroadQuery(question = '', options = {}) {
    const baseQuery = this.buildKeywordFocusedQuery(question, options);
    if (!baseQuery) return '';

    // Append supportive care MeSH concepts to improve recall
    const supportiveTerms = '(prophylaxis OR prevention OR management OR guideline OR recommendation OR consensus OR "supportive care" OR "clinical practice")';
    return `(${baseQuery}) AND ${supportiveTerms}`;
  }

  /**
   * Build search queries synchronously (no LLM calls).
   * Used by the parallel pipeline so PubMed searches can start immediately.
   */
  buildSearchQueriesSync(originalQuestion, standaloneQuestion, options = {}) {
    const queries = [];
    const pushUnique = (queryText) => {
      const normalized = this.sanitizePubMedQuery(queryText);
      if (!normalized) return;
      if (!queries.some(existing => existing.toLowerCase() === normalized.toLowerCase())) {
        queries.push(normalized);
      }
    };

    const isSupportiveCare = options.questionType === 'supportive_care';

    if (isSupportiveCare) {
      pushUnique(this.buildSupportiveCareSearchQuery(standaloneQuestion || originalQuestion, options));
      pushUnique(this.buildSupportiveCareBroadQuery(standaloneQuestion || originalQuestion, options));
      pushUnique(this.buildKeywordFocusedQuery(standaloneQuestion || originalQuestion, options));
      pushUnique(this.buildConceptSearchQuery(standaloneQuestion || originalQuestion, options));
    } else {
      pushUnique(this.buildStructuredSearchQuery(standaloneQuestion || originalQuestion, options));
      pushUnique(this.buildConceptSearchQuery(standaloneQuestion || originalQuestion, options));
      pushUnique(this.buildKeywordFocusedQuery(standaloneQuestion || originalQuestion, options));
    }
    pushUnique(this.buildKeywordFocusedQuery(originalQuestion, options));

    // Local query expansion using MeSH-style synonyms (replaces LLM expandQuery)
    if (queries.length < this.maxSearchQueries) {
      const expanded = this.expandQueryLocal(standaloneQuestion || originalQuestion);
      pushUnique(expanded);
    }

    // For comparison questions (X vs Y), add per-entity queries so individual
    // drug trials are retrieved even without a head-to-head study.
    const perEntityQueries = this.buildPerEntityComparisonQueries(originalQuestion, standaloneQuestion, options);
    for (const q of perEntityQueries) {
      pushUnique(q);
    }

    return queries.slice(0, this.maxSearchQueries + perEntityQueries.length);
  }

  /**
   * Local oncology synonym expansion — replaces the LLM expandQuery call.
   * Adds MeSH terms and common oncology synonyms to improve PubMed recall.
   */
  expandQueryLocal(query) {
    const text = String(query || '').toLowerCase();
    const expansions = [];

    // Cancer type synonyms (common name → MeSH/formal)
    const synonymMap = [
      [/\bbreast cancer\b/, 'breast neoplasm'],
      [/\blung cancer\b/, 'lung neoplasm pulmonary'],
      [/\bnsclc\b/, 'non-small cell lung cancer'],
      [/\bsclc\b/, 'small cell lung cancer'],
      [/\bcolorectal cancer\b/, 'colorectal neoplasm CRC'],
      [/\bcolon cancer\b/, 'colonic neoplasm colorectal'],
      [/\bpancreatic cancer\b/, 'pancreatic neoplasm'],
      [/\bgastric cancer\b/, 'stomach neoplasm gastric'],
      [/\bstomach cancer\b/, 'gastric neoplasm'],
      [/\bprostate cancer\b/, 'prostatic neoplasm'],
      [/\bovarian cancer\b/, 'ovarian neoplasm'],
      [/\brenal\b.*\bcancer\b/, 'kidney neoplasm renal cell carcinoma'],
      [/\bmelanoma\b/, 'melanoma cutaneous'],
      [/\bglioblastoma\b/, 'glioblastoma GBM'],
      [/\bhepatocellular\b/, 'hepatocellular carcinoma HCC liver'],
      [/\bhcc\b/, 'hepatocellular carcinoma liver'],
      [/\baml\b/, 'acute myeloid leukemia'],
      [/\bcll\b/, 'chronic lymphocytic leukemia'],
      [/\bdlbcl\b/, 'diffuse large B-cell lymphoma'],
      [/\bhead and neck\b/, 'head neck squamous cell carcinoma HNSCC'],
      [/\burothelial\b/, 'urothelial carcinoma bladder'],
      [/\bbladder cancer\b/, 'urothelial carcinoma bladder neoplasm'],
      [/\btriple.negative\b/, 'triple negative breast cancer TNBC'],
      [/\bher2.low\b|her2low/, 'HER2-low breast cancer'],
      [/\bher2\b/, 'HER2 ERBB2'],
      [/\bmsih?\b|microsatellite instability/, 'MSI-H microsatellite instability dMMR'],
      [/\banal cancer\b/, 'anal canal carcinoma squamous'],
      [/\besophag/, 'esophageal oesophageal'],
      [/\bcervical cancer\b/, 'cervical neoplasm uterine cervix'],
      [/\bendometrial\b/, 'endometrial uterine corpus'],
      [/\bmesothelioma\b/, 'mesothelioma pleural'],
      [/\bneuroblastoma\b/, 'neuroblastoma pediatric'],
      [/\bsarcoma\b/, 'sarcoma soft tissue bone'],
      [/\bmyeloma\b/, 'multiple myeloma plasma cell'],
    ];

    // Treatment synonyms
    const treatmentSynonyms = [
      [/\bimmunotherapy\b/, 'immune checkpoint inhibitor PD-1 PD-L1'],
      [/\bchemo\b/, 'chemotherapy'],
      [/\btargeted therapy\b/, 'molecular targeted therapy'],
      [/\bradiation\b/, 'radiotherapy'],
      [/\bneoadjuvant\b/, 'neoadjuvant preoperative'],
      [/\badjuvant\b/, 'adjuvant postoperative'],
      [/\bfirst.line\b/, 'first-line frontline'],
      [/\bsecond.line\b/, 'second-line'],
      [/\bpembrolizumab\b/, 'pembrolizumab KEYNOTE'],
      [/\bnivolumab\b/, 'nivolumab CheckMate'],
      [/\batezolizumab\b/, 'atezolizumab IMpower'],
      [/\bdurvalumab\b/, 'durvalumab PACIFIC'],
      [/\bipilimumab\b/, 'ipilimumab CTLA-4'],
      [/\btrastuzumab\b/, 'trastuzumab anti-HER2'],
      [/\bbevacizumab\b/, 'bevacizumab anti-VEGF'],
      [/\bosimertinib\b/, 'osimertinib FLAURA EGFR'],
    ];

    // Endpoint synonyms
    const endpointSynonyms = [
      [/\boverall survival\b|\bos\b/, 'overall survival mortality'],
      [/\bpfs\b/, 'progression-free survival PFS'],
      [/\borr\b/, 'objective response rate ORR'],
      [/\bpcr\b/, 'pathologic complete response pCR'],
      [/\bdfs\b/, 'disease-free survival DFS'],
      [/\befs\b/, 'event-free survival EFS'],
    ];

    for (const [pattern, expansion] of [...synonymMap, ...treatmentSynonyms, ...endpointSynonyms]) {
      if (pattern.test(text)) {
        const newTerms = expansion.split(' ').filter(t => !text.includes(t.toLowerCase()));
        expansions.push(...newTerms);
      }
    }

    if (expansions.length === 0) return null;

    // Build expanded query: original + unique expansion terms (max 18 terms total)
    const cleanQuery = this.stripNonClinicalTerms(query);
    const combined = `${cleanQuery} ${[...new Set(expansions)].slice(0, 8).join(' ')}`;
    return combined.split(/\s+/).slice(0, 18).join(' ');
  }

  /**
   * Detect whether a question is comparing two specific agents without a head-to-head trial.
   * Returns { entity1, entity2, populationHint } or null.
   *
   * Priority order:
   *  1. Explicit PICO fields (options.intervention + options.comparator)
   *  2. Pattern match in question text: "X vs Y", "comparar X vs Y em P"
   */
  detectComparisonEntities(question = '', options = {}) {
    if (options.intervention && options.comparator) {
      return {
        entity1: String(options.intervention).trim(),
        entity2: String(options.comparator).trim(),
        populationHint: String(options.population || options.biomarker || '').trim()
      };
    }

    // Match: [comparar] <entity1> [vs|versus] <entity2> [em|in|no|na|para <population>]
    const vsPattern = /(?:^|\s)(?:comparar\s+)?(.+?)\s+(?:vs\.?\s*|versus\s+)(.+?)(?:\s+(?:em\s+|in\s+|no\s+|na\s+|para\s+)(.+))?$/i;
    const match = question.trim().match(vsPattern);
    if (match) {
      const entity1 = match[1].trim().replace(/^comparar\s+/i, '').trim();
      const entity2 = match[2].trim();
      const populationHint = (match[3] || options.population || options.biomarker || '').trim();
      // Only treat as comparison if both entities look like drug/treatment names (not just a single common word)
      if (entity1.length >= 3 && entity2.length >= 3) {
        return { entity1, entity2, populationHint };
      }
    }

    return null;
  }

  // ── Drug-to-class mapping for fallback PubMed searches ──────────────────
  // When a specific drug returns few results, we can broaden to the drug class.
  static DRUG_CLASS_MAP = {
    // ADCs (Antibody-Drug Conjugates)
    'trastuzumab deruxtecan': { class: 'antibody-drug conjugate', aliases: ['T-DXd', 'DS-8201', 'enhertu'], mesh: 'Antibody-Drug Conjugates' },
    'trastuzumab emtansine': { class: 'antibody-drug conjugate', aliases: ['T-DM1', 'ado-trastuzumab emtansine', 'kadcyla'], mesh: 'Antibody-Drug Conjugates' },
    'sacituzumab govitecan': { class: 'antibody-drug conjugate', aliases: ['SG', 'trodelvy', 'IMMU-132'], mesh: 'Antibody-Drug Conjugates' },
    'enfortumab vedotin': { class: 'antibody-drug conjugate', aliases: ['EV', 'padcev'], mesh: 'Antibody-Drug Conjugates' },
    'tisotumab vedotin': { class: 'antibody-drug conjugate', aliases: ['tivdak'], mesh: 'Antibody-Drug Conjugates' },
    'mirvetuximab soravtansine': { class: 'antibody-drug conjugate', aliases: ['elahere'], mesh: 'Antibody-Drug Conjugates' },
    'datopotamab deruxtecan': { class: 'antibody-drug conjugate', aliases: ['Dato-DXd', 'DS-1062'], mesh: 'Antibody-Drug Conjugates' },
    // Checkpoint inhibitors (PD-1/PD-L1)
    'pembrolizumab': { class: 'immune checkpoint inhibitor', aliases: ['keytruda', 'MK-3475'], mesh: 'Immune Checkpoint Inhibitors' },
    'nivolumab': { class: 'immune checkpoint inhibitor', aliases: ['opdivo', 'BMS-936558'], mesh: 'Immune Checkpoint Inhibitors' },
    'atezolizumab': { class: 'immune checkpoint inhibitor', aliases: ['tecentriq', 'MPDL3280A'], mesh: 'Immune Checkpoint Inhibitors' },
    'durvalumab': { class: 'immune checkpoint inhibitor', aliases: ['imfinzi', 'MEDI4736'], mesh: 'Immune Checkpoint Inhibitors' },
    'avelumab': { class: 'immune checkpoint inhibitor', aliases: ['bavencio'], mesh: 'Immune Checkpoint Inhibitors' },
    'cemiplimab': { class: 'immune checkpoint inhibitor', aliases: ['libtayo'], mesh: 'Immune Checkpoint Inhibitors' },
    'dostarlimab': { class: 'immune checkpoint inhibitor', aliases: ['jemperli'], mesh: 'Immune Checkpoint Inhibitors' },
    'ipilimumab': { class: 'CTLA-4 inhibitor', aliases: ['yervoy', 'MDX-010'], mesh: 'CTLA-4 Antigen' },
    'tremelimumab': { class: 'CTLA-4 inhibitor', aliases: ['imjudo'], mesh: 'CTLA-4 Antigen' },
    // CDK4/6 inhibitors
    'palbociclib': { class: 'CDK4/6 inhibitor', aliases: ['ibrance', 'PD-0332991'], mesh: 'Cyclin-Dependent Kinase Inhibitor' },
    'ribociclib': { class: 'CDK4/6 inhibitor', aliases: ['kisqali', 'LEE011'], mesh: 'Cyclin-Dependent Kinase Inhibitor' },
    'abemaciclib': { class: 'CDK4/6 inhibitor', aliases: ['verzenios', 'verzenio', 'LY2835219'], mesh: 'Cyclin-Dependent Kinase Inhibitor' },
    // PARP inhibitors
    'olaparib': { class: 'PARP inhibitor', aliases: ['lynparza', 'AZD2281'], mesh: 'Poly(ADP-ribose) Polymerase Inhibitors' },
    'niraparib': { class: 'PARP inhibitor', aliases: ['zejula', 'MK-4827'], mesh: 'Poly(ADP-ribose) Polymerase Inhibitors' },
    'rucaparib': { class: 'PARP inhibitor', aliases: ['rubraca', 'AG-014699'], mesh: 'Poly(ADP-ribose) Polymerase Inhibitors' },
    'talazoparib': { class: 'PARP inhibitor', aliases: ['talzenna', 'BMN 673'], mesh: 'Poly(ADP-ribose) Polymerase Inhibitors' },
    // TKIs
    'osimertinib': { class: 'EGFR TKI', aliases: ['tagrisso', 'AZD9291'], mesh: 'ErbB Receptors' },
    'sotorasib': { class: 'KRAS G12C inhibitor', aliases: ['lumakras', 'AMG 510'], mesh: 'Proto-Oncogene Proteins p21(ras)' },
    'adagrasib': { class: 'KRAS G12C inhibitor', aliases: ['krazati', 'MRTX849'], mesh: 'Proto-Oncogene Proteins p21(ras)' },
    'lorlatinib': { class: 'ALK inhibitor', aliases: ['lorviqua', 'PF-06463922'], mesh: 'Anaplastic Lymphoma Kinase' },
    'alectinib': { class: 'ALK inhibitor', aliases: ['alecensa', 'CH5424802'], mesh: 'Anaplastic Lymphoma Kinase' },
    'crizotinib': { class: 'ALK inhibitor', aliases: ['xalkori', 'PF-02341066'], mesh: 'Anaplastic Lymphoma Kinase' },
    'selpercatinib': { class: 'RET inhibitor', aliases: ['retevmo', 'LOXO-292'], mesh: 'Proto-Oncogene Proteins c-ret' },
    'pralsetinib': { class: 'RET inhibitor', aliases: ['gavreto', 'BLU-667'], mesh: 'Proto-Oncogene Proteins c-ret' },
    'larotrectinib': { class: 'NTRK inhibitor', aliases: ['vitrakvi', 'LOXO-101'], mesh: 'Receptor, trkA' },
    'entrectinib': { class: 'NTRK inhibitor', aliases: ['rozlytrek', 'RXDX-101'], mesh: 'Receptor, trkA' },
    'lenvatinib': { class: 'multi-kinase inhibitor', aliases: ['lenvima', 'E7080'], mesh: 'Protein Kinase Inhibitors' },
    'cabozantinib': { class: 'multi-kinase inhibitor', aliases: ['cabometyx', 'cometriq', 'XL184'], mesh: 'Protein Kinase Inhibitors' },
    'regorafenib': { class: 'multi-kinase inhibitor', aliases: ['stivarga', 'BAY 73-4506'], mesh: 'Protein Kinase Inhibitors' },
    // Anti-HER2
    'trastuzumab': { class: 'anti-HER2 monoclonal antibody', aliases: ['herceptin'], mesh: 'Trastuzumab' },
    'pertuzumab': { class: 'anti-HER2 monoclonal antibody', aliases: ['perjeta'], mesh: 'Pertuzumab' },
    'tucatinib': { class: 'HER2 TKI', aliases: ['tukysa', 'ONT-380'], mesh: 'ErbB Receptors' },
    'neratinib': { class: 'HER2 TKI', aliases: ['nerlynx'], mesh: 'ErbB Receptors' },
    'margetuximab': { class: 'anti-HER2 monoclonal antibody', aliases: ['margenza'], mesh: 'Trastuzumab' },
    // Anti-VEGF
    'bevacizumab': { class: 'anti-VEGF monoclonal antibody', aliases: ['avastin'], mesh: 'Bevacizumab' },
    'ramucirumab': { class: 'anti-VEGF monoclonal antibody', aliases: ['cyramza'], mesh: 'Vascular Endothelial Growth Factors' },
    // Hormonal
    'enzalutamide': { class: 'androgen receptor inhibitor', aliases: ['xtandi', 'MDV3100'], mesh: 'Receptors, Androgen' },
    'abiraterone': { class: 'CYP17 inhibitor', aliases: ['zytiga', 'CB-7598'], mesh: 'Steroid 17-alpha-Hydroxylase' },
    'apalutamide': { class: 'androgen receptor inhibitor', aliases: ['erleada', 'ARN-509'], mesh: 'Receptors, Androgen' },
    'darolutamide': { class: 'androgen receptor inhibitor', aliases: ['nubeqa', 'ODM-201'], mesh: 'Receptors, Androgen' },
    // BCL-2
    'venetoclax': { class: 'BCL-2 inhibitor', aliases: ['venclexta', 'ABT-199'], mesh: 'Proto-Oncogene Proteins c-bcl-2' },
    // BTK
    'ibrutinib': { class: 'BTK inhibitor', aliases: ['imbruvica', 'PCI-32765'], mesh: 'Agammaglobulinaemia Tyrosine Kinase' },
    'acalabrutinib': { class: 'BTK inhibitor', aliases: ['calquence', 'ACP-196'], mesh: 'Agammaglobulinaemia Tyrosine Kinase' },
    'zanubrutinib': { class: 'BTK inhibitor', aliases: ['brukinsa', 'BGB-3111'], mesh: 'Agammaglobulinaemia Tyrosine Kinase' },
    // PI3K
    'alpelisib': { class: 'PI3K inhibitor', aliases: ['piqray', 'BYL719'], mesh: 'Phosphatidylinositol 3-Kinases' },
    'idelalisib': { class: 'PI3K inhibitor', aliases: ['zydelig', 'GS-1101'], mesh: 'Phosphatidylinositol 3-Kinases' },
    // mTOR
    'everolimus': { class: 'mTOR inhibitor', aliases: ['afinitor', 'RAD001'], mesh: 'TOR Serine-Threonine Kinases' },
    'temsirolimus': { class: 'mTOR inhibitor', aliases: ['torisel', 'CCI-779'], mesh: 'TOR Serine-Threonine Kinases' },
    // BiTE / bispecific
    'blinatumomab': { class: 'bispecific T-cell engager', aliases: ['blincyto', 'MT103'], mesh: 'Antibodies, Bispecific' },
    'teclistamab': { class: 'bispecific antibody', aliases: ['tecvayli'], mesh: 'Antibodies, Bispecific' },
    // CAR-T (as treatment references)
    'axicabtagene ciloleucel': { class: 'CAR-T cell therapy', aliases: ['yescarta', 'axi-cel', 'KTE-C19'], mesh: 'Receptors, Chimeric Antigen' },
    'tisagenlecleucel': { class: 'CAR-T cell therapy', aliases: ['kymriah', 'CTL019'], mesh: 'Receptors, Chimeric Antigen' },
    'lisocabtagene maraleucel': { class: 'CAR-T cell therapy', aliases: ['breyanzi', 'liso-cel', 'JCAR017'], mesh: 'Receptors, Chimeric Antigen' },
  };

  /**
   * Look up a drug entity in the class map. Accepts drug name, alias, or trade name.
   * Returns { class, aliases, mesh } or null.
   */
  lookupDrugClass(entity = '') {
    const normalized = entity.toLowerCase().trim();
    // Direct match
    if (SimpleChatService.DRUG_CLASS_MAP[normalized]) {
      return { drug: normalized, ...SimpleChatService.DRUG_CLASS_MAP[normalized] };
    }
    // Alias/trade-name match
    for (const [drug, info] of Object.entries(SimpleChatService.DRUG_CLASS_MAP)) {
      if (info.aliases.some(a => a.toLowerCase() === normalized)) {
        return { drug, ...info };
      }
    }
    // Partial match (e.g., "trastuzumab deruxtecan" in "trastuzumab deruxtecan (T-DXd)")
    for (const [drug, info] of Object.entries(SimpleChatService.DRUG_CLASS_MAP)) {
      if (normalized.includes(drug) || drug.includes(normalized)) {
        return { drug, ...info };
      }
    }
    return null;
  }

  /**
   * For comparison questions, build SEPARATE query sets for each entity.
   * Returns { entity1Queries, entity2Queries, sharedQueries, comparison } or null.
   */
  buildComparisonSearchStrategy(question = '', standaloneQuestion = '', options = {}) {
    const questionToAnalyse = standaloneQuestion || question;
    const comparison = this.detectComparisonEntities(questionToAnalyse, options)
      || this.detectComparisonEntities(question, options);
    if (!comparison) return null;

    const { entity1, entity2, populationHint } = comparison;
    const pop = populationHint || options.population || '';
    const biomarker = options.biomarker || '';
    const line = options.lineOfTherapy || '';

    const popOpts = { population: pop, biomarker, lineOfTherapy: line };

    // Per-entity queries: keyword + structured + class fallback
    const buildEntityQueries = (entity) => {
      const queries = [];
      const pushUnique = (q) => {
        const norm = this.sanitizePubMedQuery(q);
        if (norm && norm.length > 3 && !queries.some(e => e.toLowerCase() === norm.toLowerCase())) {
          queries.push(norm);
        }
      };

      // 1. Keyword-focused query with population
      pushUnique(this.buildKeywordFocusedQuery(entity, popOpts));

      // 2. Structured query with entity as intervention
      pushUnique(this.buildStructuredSearchQuery(entity, { ...popOpts, intervention: entity }));

      // 3. Drug aliases (e.g., "T-DXd" or "enhertu" or "DS-8201")
      const drugInfo = this.lookupDrugClass(entity);
      if (drugInfo) {
        for (const alias of drugInfo.aliases.slice(0, 2)) {
          pushUnique(this.buildKeywordFocusedQuery(alias, popOpts));
        }
      }

      // 4. Concept query
      pushUnique(this.buildConceptSearchQuery(entity, popOpts));

      return queries.slice(0, 4); // max 4 queries per entity
    };

    const entity1Queries = buildEntityQueries(entity1);
    const entity2Queries = buildEntityQueries(entity2);

    // Shared queries: head-to-head (if it exists) + class-level
    const sharedQueries = [];
    const pushShared = (q) => {
      const norm = this.sanitizePubMedQuery(q);
      if (norm && norm.length > 3 && !sharedQueries.some(e => e.toLowerCase() === norm.toLowerCase())) {
        sharedQueries.push(norm);
      }
    };

    // Head-to-head direct comparison query
    pushShared(this.buildKeywordFocusedQuery(`${entity1} ${entity2}`, popOpts));

    // Class-level fallback if both drugs share a class
    const class1 = this.lookupDrugClass(entity1);
    const class2 = this.lookupDrugClass(entity2);
    if (class1 && class2 && class1.class === class2.class) {
      pushShared(this.buildKeywordFocusedQuery(class1.class, popOpts));
      if (class1.mesh) {
        pushShared(`${class1.mesh}[MeSH Terms] AND ${pop ? this.buildKeywordFocusedQuery(pop, {}) : ''}`);
      }
    }

    logger.info(`[ComparisonStrategy] ${entity1} (${entity1Queries.length}q) vs ${entity2} (${entity2Queries.length}q) + ${sharedQueries.length} shared`);

    return { entity1Queries, entity2Queries, sharedQueries, comparison };
  }

  /**
   * For comparison questions without head-to-head trials, build one PubMed query
   * per entity (drug/treatment) so each drug's individual trials are retrieved.
   * Returns an array of additional queries to add to the search pool.
   */
  buildPerEntityComparisonQueries(question = '', standaloneQuestion = '', options = {}) {
    // Try standalone first (English rewrite), fall back to original question
    const questionToAnalyse = standaloneQuestion || question;
    const comparison = this.detectComparisonEntities(questionToAnalyse, options)
      || this.detectComparisonEntities(question, options);
    if (!comparison) return [];

    const { entity1, entity2, populationHint } = comparison;
    const popOpts = {
      population: populationHint || options.population || '',
      biomarker: options.biomarker || '',
      lineOfTherapy: options.lineOfTherapy || ''
    };
    const queries = [];

    // Build one focused query per entity, adding population context via options
    const q1 = this.buildKeywordFocusedQuery(entity1, popOpts);
    const q2 = this.buildKeywordFocusedQuery(entity2, popOpts);

    if (q1 && q1.length > 3) queries.push(q1);
    if (q2 && q2.length > 3) queries.push(q2);

    return queries;
  }

  async buildSearchQueries(originalQuestion, standaloneQuestion, options = {}) {
    // Now fully sync — delegates to buildSearchQueriesSync
    return this.buildSearchQueriesSync(originalQuestion, standaloneQuestion, options);
  }

  /**
   * Tokenize text for lightweight lexical relevance scoring
   */
  tokenize(text = '') {
    const stopWords = new Set([
      'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'have', 'has',
      'dos', 'das', 'com', 'para', 'como', 'uma', 'que', 'por', 'sobre', 'entre', 'sem', 'nos', 'nas'
    ]);

    return [...new Set(
      String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\u00C0-\u017F\s]/g, ' ')
        .split(/\s+/)
        .filter(token => token.length > 2 && !stopWords.has(token))
    )];
  }

  articleMatchesStudyTypePreference(article = {}, preference = '') {
    const key = this.normalizePreferenceKey(preference);
    const text = `${article?.studyDesign || ''} ${(article?.publicationTypes || []).join(' ')} ${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();

    const patterns = {
      randomized: /\brandomi[sz]ed\b|\brandomized controlled trial\b/,
      randomized_controlled_trial: /\brandomized controlled trial\b|\brandomi[sz]ed\b/,
      rct: /\brandomized controlled trial\b|\brandomi[sz]ed\b/,
      systematic_review: /\bsystematic review\b|\bmeta-analysis\b|\bmeta analysis\b/,
      meta_analysis: /\bmeta-analysis\b|\bmeta analysis\b/,
      observational: /\bobservational\b|\bcohort\b|\bregistry\b|\breal-world\b/,
      comparative_study: /\bcomparative study\b|\bhead-to-head\b/,
      clinical_trial: /\bclinical trial\b|\btrial\b/,
      guideline: /\bguideline\b|\bpractice guideline\b/,
      real_world: /\breal-world\b|\bregistry\b|\bcohort\b/,
      phase_1: /\bphase i\b|\bphase 1\b/,
      phase_i: /\bphase i\b|\bphase 1\b/,
      phase_2: /\bphase ii\b|\bphase 2\b/,
      phase_ii: /\bphase ii\b|\bphase 2\b/,
      phase_3: /\bphase iii\b|\bphase 3\b/,
      phase_iii: /\bphase iii\b|\bphase 3\b/
    };

    return patterns[key]?.test(text) || false;
  }

  articleMatchesEndpointPreference(article = {}, preference = '') {
    const key = this.normalizePreferenceKey(preference);
    const metrics = article?.endpointMetrics || {};
    const text = `${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();

    const metricKeyMap = {
      pcr: 'pcr',
      efs: 'efs',
      dfs: 'dfs',
      pfs: 'pfs',
      os: 'os',
      orr: 'orr',
      grade34ae: 'grade34ae',
      grade_3_4_ae: 'grade34ae'
    };

    const metricKey = metricKeyMap[key];
    if (metricKey && metrics?.[metricKey]) {
      return true;
    }

    const patterns = {
      pcr: /\bpathologic(?:al)? complete response\b|\bpcr\b/,
      efs: /\bevent[- ]free survival\b|\befs\b/,
      dfs: /\bdisease[- ]free survival\b|\bdfs\b/,
      pfs: /\bprogression[- ]free survival\b|\bpfs\b/,
      os: /\boverall survival\b|\bos\b/,
      orr: /\bobjective response rate\b|\borr\b/,
      safety: /\bsafety\b|\btoxicity\b|adverse events?/,
      toxicity: /\btoxicity\b|adverse events?|\bsafety\b/,
      grade34ae: /\bgrade\s*3(?:\s*\/\s*4|[-–]4)?\b|g3[-–]?4/,
      grade_3_4_ae: /\bgrade\s*3(?:\s*\/\s*4|[-–]4)?\b|g3[-–]?4/
    };

    return patterns[key]?.test(text) || false;
  }

  articleMatchesTrialPhasePreference(article = {}, preference = '') {
    const key = this.normalizePreferenceKey(preference);
    const text = `${article?.studyDesign || ''} ${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();

    const patterns = {
      phase_1: /\bphase i\b|\bphase 1\b/,
      phase_i: /\bphase i\b|\bphase 1\b/,
      phase_2: /\bphase ii\b|\bphase 2\b/,
      phase_ii: /\bphase ii\b|\bphase 2\b/,
      phase_3: /\bphase iii\b|\bphase 3\b/,
      phase_iii: /\bphase iii\b|\bphase 3\b/
    };

    return patterns[key]?.test(text) || false;
  }

  /**
   * Journal prestige scoring — top-tier oncology and general medicine journals
   */
  getJournalPrestigeBoost(article = {}) {
    const journal = `${article?.journal || ''}`.toLowerCase().replace(/[.\s]+/g, ' ').trim();
    if (!journal) return { boost: 0, tier: null };

    const tier1 = [
      'new england journal of medicine', 'n engl j med', 'nejm',
      'lancet', 'the lancet',
      'lancet oncology', 'lancet oncol',
      'journal of clinical oncology', 'j clin oncol', 'jco',
      'annals of oncology', 'ann oncol',
      'nature medicine', 'nat med',
      'nature', 'science', 'cell',
      'jama', 'jama oncology', 'jama oncol',
      'bmj'
    ];

    const tier2 = [
      'journal of thoracic oncology', 'j thorac oncol',
      'clinical cancer research', 'clin cancer res',
      'cancer discovery', 'cancer discov',
      'cancer cell',
      'european journal of cancer', 'eur j cancer',
      'blood',
      'journal of the national cancer institute', 'j natl cancer inst', 'jnci',
      'breast cancer research and treatment', 'breast cancer res treat',
      'cancer research', 'cancer res',
      'annals of surgical oncology', 'ann surg oncol',
      'gynecologic oncology', 'gynecol oncol',
      'leukemia',
      'journal of hematology & oncology', 'j hematol oncol',
      'european urology', 'eur urol',
      'gastroenterology',
      'hepatology',
      'gut'
    ];

    if (tier1.some(name => journal.includes(name))) return { boost: 0.4, tier: 'tier-1-journal' };
    if (tier2.some(name => journal.includes(name))) return { boost: 0.2, tier: 'tier-2-journal' };
    return { boost: 0, tier: null };
  }

  /**
   * Landmark oncology trial name recognition
   */
  getLandmarkTrialBoost(article = {}) {
    const text = `${article?.trialName || ''} ${article?.title || ''} ${article?.abstract || ''}`.toUpperCase();
    if (!text.trim()) return { boost: 0, trialName: null };

    const landmarkTrials = [
      'KEYNOTE-522', 'KEYNOTE-355', 'KEYNOTE-564', 'KEYNOTE-789', 'KEYNOTE-671', 'KEYNOTE-091', 'KEYNOTE-158', 'KEYNOTE-426', 'KEYNOTE-189', 'KEYNOTE-407',
      'CHECKMATE-816', 'CHECKMATE-274', 'CHECKMATE-9LA', 'CHECKMATE-649', 'CHECKMATE-577', 'CHECKMATE-214', 'CHECKMATE-078', 'CHECKMATE-227',
      'IMPOWER110', 'IMPOWER150', 'IMPOWER130', 'IMPOWER010',
      'IMPASSION130', 'IMPASSION031',
      'DESTINY-BREAST04', 'DESTINY-BREAST03', 'DESTINY-BREAST02', 'DESTINY-LUNG01', 'DESTINY-LUNG02', 'DESTINY-GASTRIC01',
      'OLYMPIC', 'OLYMPIA', 'OLYMPIAD',
      'MONARCH-E', 'MONARCH-3', 'MONARCHE',
      'NATALEE', 'PALOMA-2', 'PALOMA-3', 'PALOMA-4',
      'MONALEESA-2', 'MONALEESA-3', 'MONALEESA-7',
      'ASCENT', 'TROPICS-02',
      'EMERALD',
      'ADAURA', 'LAURA', 'FLAURA', 'FLAURA2',
      'AENEAS', 'AEGEAN',
      'ALEX', 'ALTA-1L', 'CROWN',
      'CODEBREAK-200', 'KRYSTAL-1', 'KRYSTAL-7',
      'COLUMBUS', 'COMBI-D', 'COMBI-V',
      'BEACON',
      'PACIFIC',
      'HIMALAYA',
      'JAVELIN-100', 'JAVELIN-BLADDER',
      'EV-301', 'EV-302',
      'CLEAR',
      'TRITON3', 'PROFOUND',
      'POLO',
      'VISION', 'THERASPHERE',
      'RATIONALE-307', 'RATIONALE-301',
      'ORIENT-31', 'ORIENT-11',
      'TOPAZ-1',
      'POSEIDON',
      'TIGER',
      'SOPHIA',
      'KATHERINE',
      'APHINITY',
      'CLEOPATRA',
      'EMILIA',
      'NALA',
      'CREATEX',
      'NEOSPHERE',
      'TROP-LUNG-01',
      'CASPIAN',
      'COAST',
      'GARNET',
      'LIBRETTO-001', 'LIBRETTO-431'
    ];

    for (const trial of landmarkTrials) {
      if (text.includes(trial)) {
        return { boost: 0.35, trialName: trial };
      }
    }
    return { boost: 0, trialName: null };
  }

  /**
   * Count how many hard endpoint metrics an article reports
   */
  countEndpointRichness(article = {}) {
    const metrics = article?.endpointMetrics || {};
    const endpointKeys = ['pcr', 'efs', 'dfs', 'pfs', 'os', 'orr', 'grade34ae'];
    return endpointKeys.filter(key => metrics[key]).length;
  }

  /**
   * Extract sample size from endpointMetrics and return a score boost
   */
  getSampleSizeBoost(article = {}) {
    const raw = article?.endpointMetrics?.sampleSize;
    const n = parseInt(raw, 10);
    if (!n || n < 10) return { boost: 0, sampleSize: null };
    if (n >= 1000) return { boost: 0.3, sampleSize: n };
    if (n >= 500) return { boost: 0.2, sampleSize: n };
    if (n >= 200) return { boost: 0.1, sampleSize: n };
    if (n >= 50) return { boost: 0.05, sampleSize: n };
    return { boost: 0, sampleSize: n };
  }

  /**
   * Score article relevance combining lexical match, context fit, and recency
   */
  scoreArticleSelection(article, queryTerms = [], options = {}) {
    const combinedText = `${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();
    const titleText = `${article?.title || ''}`.toLowerCase();
    if (!combinedText) {
      return {
        article,
        score: -1,
        include: false,
        evidenceTier: 'unparsed',
        rationale: ['Empty title/abstract text']
      };
    }

    let score = 0;
    const rationale = [];
    const evidenceTier = this.classifyEvidenceTier(article);
    const clinicalFocus = this.detectClinicalFocus(options.questionText || '', options);
    const focusProfile = this.getArticleFocusProfile(article);
    const biomarkerFocused = this.isBiomarkerFocusedPublication(article);
    const qualityOfLifeFocused = this.isQualityOfLifeFocusedPublication(article);
    const exploratoryAnalysis = this.isExploratoryAnalysisPublication(article);
    const directComparative = this.hasDirectComparativeSignals(article);
    const lateEndpointSignal = this.hasLateEndpointSignal(article);

    if (!evidenceTier.include) {
      score -= 1.2;
      rationale.push(`Excluded publication type: ${evidenceTier.label}`);
    } else if (evidenceTier.weight !== 0) {
      score += evidenceTier.weight;
      rationale.push(`Evidence tier ${evidenceTier.label}`);
    }

    if (queryTerms.length > 0) {
      const matches = queryTerms.filter(term => combinedText.includes(term)).length;
      const lexicalScore = matches / queryTerms.length;
      score += lexicalScore;
      if (matches > 0) {
        rationale.push(`Lexical match ${matches}/${queryTerms.length}`);
      }
    }

    const focusTerms = [
      options.population,
      options.intervention,
      options.comparator,
      options.outcomes,
      options.biomarker,
      options.lineOfTherapy
    ]
      .filter(Boolean)
      .flatMap(value => this.tokenize(value));

    if (focusTerms.length > 0) {
      const focusMatches = focusTerms.filter(term => combinedText.includes(term)).length;
      const focusScore = 0.35 * (focusMatches / focusTerms.length);
      score += focusScore;
      if (focusMatches > 0) {
        rationale.push(`Structured focus match ${focusMatches}/${focusTerms.length}`);
      }
    }

    const preferredStudyTypes = Array.isArray(options.studyTypes)
      ? [...new Set(options.studyTypes.map(value => this.normalizePreferenceKey(value)).filter(Boolean))]
      : [];
    if (preferredStudyTypes.length > 0) {
      const matches = preferredStudyTypes.filter(preference =>
        this.articleMatchesStudyTypePreference(article, preference)
      ).length;
      if (matches > 0) {
        score += 0.26 * (matches / preferredStudyTypes.length);
        rationale.push(`Study type preference match ${matches}/${preferredStudyTypes.length}`);
      } else {
        score -= 0.12;
      }
    }

    const preferredEndpoints = Array.isArray(options.endpoints)
      ? [...new Set(options.endpoints.map(value => this.normalizePreferenceKey(value)).filter(Boolean))]
      : [];
    if (preferredEndpoints.length > 0) {
      const matches = preferredEndpoints.filter(preference =>
        this.articleMatchesEndpointPreference(article, preference)
      ).length;
      if (matches > 0) {
        score += 0.22 * (matches / preferredEndpoints.length);
        rationale.push(`Endpoint preference match ${matches}/${preferredEndpoints.length}`);
      } else {
        score -= 0.08;
      }
    }

    const preferredTrialPhases = Array.isArray(options.trialPhases)
      ? [...new Set(options.trialPhases.map(value => this.normalizePreferenceKey(value)).filter(Boolean))]
      : [];
    if (preferredTrialPhases.length > 0) {
      const matches = preferredTrialPhases.filter(preference =>
        this.articleMatchesTrialPhasePreference(article, preference)
      ).length;
      if (matches > 0) {
        score += 0.16 * (matches / preferredTrialPhases.length);
        rationale.push(`Trial phase preference match ${matches}/${preferredTrialPhases.length}`);
      } else {
        score -= 0.06;
      }
    }

    const evidenceMode = String(options.evidenceMode || '').toLowerCase();
    if (evidenceMode === 'conservative') {
      if (/randomized|systematic review|meta-analysis|phase iii|phase 3/i.test(combinedText)) {
        score += 0.2;
        rationale.push('Boosted for conservative evidence mode');
      }
    } else if (evidenceMode === 'exploratory') {
      if (/phase i|phase 1|early phase|first-in-human|pilot/i.test(combinedText)) {
        score += 0.15;
        rationale.push('Exploratory early-phase boost');
      }
    }

    const publicationYear = parseInt(article?.year, 10);
    if (!Number.isNaN(publicationYear)) {
      const currentYear = new Date().getFullYear();
      const recencyMap = {
        last_3_years: 3,
        last_5_years: 5,
        last_10_years: 10
      };

      const recencyWindow = recencyMap[options.recency];
      if (recencyWindow) {
        if (publicationYear >= (currentYear - recencyWindow)) {
          score += 0.2;
          rationale.push(`Within ${recencyWindow}-year recency window`);
        } else {
          score -= 0.12;
        }
      } else if (publicationYear >= (currentYear - 5)) {
        score += 0.05;
        rationale.push('Recent publication');
      }
    }

    if (clinicalFocus.wantsTNBC) {
      const hasTNBCInTitle = /\btnbc\b|triple[-\s]?negative/.test(titleText);
      const hasTNBCInAny = hasTNBCInTitle || focusProfile.mentionsTNBC;
      const hrPositiveInTitle = /\bhr\s*\+|\bhormone receptor[-\s]?positive\b|er\s*\+\s*\/?\s*her2\s*-/.test(titleText);

      if (hasTNBCInTitle) {
        score += 0.35;
        rationale.push('TNBC explicitly in title');
      } else if (hasTNBCInAny) {
        score += 0.2;
        rationale.push('TNBC explicitly in abstract/title');
      } else {
        score -= 0.8;
        rationale.push('TNBC mismatch penalty');
      }

      if (hrPositiveInTitle && !hasTNBCInTitle) {
        score -= 0.65;
        rationale.push('Competing HR-positive title signal');
      }
    }

    if (clinicalFocus.wantsNeoadjuvant) {
      const hasNeoadjuvantSignal = focusProfile.mentionsNeoadjuvant;
      score += hasNeoadjuvantSignal ? 0.28 : -0.55;
      rationale.push(hasNeoadjuvantSignal ? 'Neoadjuvant setting match' : 'Neoadjuvant mismatch penalty');
    }

    if (clinicalFocus.wantsAdjuvant) {
      if (focusProfile.mentionsAdjuvant) {
        score += 0.24;
        rationale.push('Adjuvant setting match');
      } else if (focusProfile.mentionsNeoadjuvant) {
        score -= 0.4;
        rationale.push('Adjuvant vs neoadjuvant mismatch');
      }
    }

    if (clinicalFocus.wantsMetastatic) {
      if (focusProfile.mentionsMetastatic) {
        score += 0.3;
        rationale.push('Metastatic setting match');
      } else if (focusProfile.mentionsAdjuvant || focusProfile.mentionsNeoadjuvant || focusProfile.mentionsEarlyStage) {
        score -= 0.6;
        rationale.push('Metastatic mismatch penalty');
      }
    }

    if (clinicalFocus.wantsEarlyStage) {
      if (focusProfile.mentionsEarlyStage || focusProfile.mentionsAdjuvant || focusProfile.mentionsNeoadjuvant) {
        score += 0.22;
        rationale.push('Early-stage/perioperative match');
      } else if (focusProfile.mentionsMetastatic) {
        score -= 0.45;
        rationale.push('Early-stage mismatch penalty');
      }
    }

    if (clinicalFocus.wantsHER2Positive) {
      if (focusProfile.mentionsHER2Positive) {
        score += 0.3;
        rationale.push('HER2-positive match');
      } else {
        score -= 0.55;
        rationale.push('HER2-positive mismatch penalty');
      }
    }

    if (clinicalFocus.wantsHER2Negative && focusProfile.mentionsHER2Positive && !focusProfile.mentionsHER2Negative) {
      score -= 0.55;
      rationale.push('HER2-negative mismatch penalty');
    }

    if (clinicalFocus.wantsHRPositive) {
      if (focusProfile.mentionsHRPositive) {
        score += 0.26;
        rationale.push('HR-positive match');
      } else {
        score -= 0.35;
        rationale.push('HR-positive mismatch penalty');
      }
    }

    if (clinicalFocus.wantsImmunotherapy) {
      if (focusProfile.mentionsImmunotherapy) {
        score += 0.18;
        rationale.push('Immunotherapy match');
      } else {
        score -= 0.18;
      }
    }

    if (this.hasDirectOutcomeSignals(article)) {
      score += 0.16;
      rationale.push('Direct outcome signals detected');
    } else {
      score -= 0.12;
    }

    if (directComparative) {
      score += 0.28;
      rationale.push('Direct comparative study signal');
    }

    if (lateEndpointSignal) {
      score += 0.12;
      rationale.push('Late-endpoint signal');
    }

    if (exploratoryAnalysis) {
      score -= 0.18;
      rationale.push('Exploratory analysis penalty');
    }

    if (biomarkerFocused) {
      if (clinicalFocus.wantsBiomarker) {
        score += 0.08;
        rationale.push('Biomarker-focused publication');
      } else {
        score -= 0.55;
        rationale.push('Biomarker-focused publication penalty');
      }
    }

    if (qualityOfLifeFocused) {
      if (clinicalFocus.wantsQualityOfLife) {
        score += 0.08;
        rationale.push('Quality-of-life publication');
      } else {
        score -= 0.42;
        rationale.push('Quality-of-life publication penalty');
      }
    }

    if (this.isNonActionablePublication(article)) {
      score -= 0.8;
      rationale.push('Non-actionable publication penalty');
    }

    if (this.isLowActionabilityReview(article)) {
      score -= 0.4;
      rationale.push('Low-actionability review penalty');
    }

    if (this.isProtocolLikeStudy(article)) {
      score -= 0.6;
      rationale.push('Protocol-like study penalty');
    }

    if (this.hasStrongClinicalMismatch(article, clinicalFocus)) {
      score -= 0.6;
      rationale.push('Strong clinical mismatch detected');
    }

    // ── Improvement 1: Journal prestige ──────────────────────────────────────
    const journalPrestige = this.getJournalPrestigeBoost(article);
    if (journalPrestige.boost > 0) {
      score += journalPrestige.boost;
      rationale.push(`${journalPrestige.tier} (+${journalPrestige.boost})`);
    }

    // ── Improvement 2: Sample size ───────────────────────────────────────────
    const sampleSize = this.getSampleSizeBoost(article);
    if (sampleSize.boost > 0) {
      score += sampleSize.boost;
      rationale.push(`Sample size n=${sampleSize.sampleSize} (+${sampleSize.boost})`);
    }

    // ── Improvement 3: Landmark trial recognition ────────────────────────────
    const landmark = this.getLandmarkTrialBoost(article);
    if (landmark.boost > 0) {
      score += landmark.boost;
      rationale.push(`Landmark trial ${landmark.trialName}`);
    }

    // ── Improvement 4: Broad cancer-type matching ────────────────────────────
    const cancerTypeChecks = [
      { flag: 'wantsNSCLC', pattern: /\bnsclc\b|\bnon[-\s]?small[-\s]?cell[-\s]?lung\b|\blung adenocarcinoma\b|\blung squamous\b/, label: 'NSCLC' },
      { flag: 'wantsSCLC', pattern: /\bsclc\b|\bsmall[-\s]?cell[-\s]?lung\b/, label: 'SCLC' },
      { flag: 'wantsCRC', pattern: /\bcrc\b|\bcolorectal\b|\bcolon cancer\b|\brectal cancer\b/, label: 'CRC' },
      { flag: 'wantsRCC', pattern: /\brcc\b|\brenal[-\s]?cell\b|\bkidney cancer\b/, label: 'RCC' },
      { flag: 'wantsHCC', pattern: /\bhcc\b|\bhepatocellular\b|\bliver cancer\b/, label: 'HCC' },
      { flag: 'wantsMelanoma', pattern: /\bmelanoma\b/, label: 'Melanoma' },
      { flag: 'wantsGBM', pattern: /\bgbm\b|\bglioblastoma\b|\bglioma\b/, label: 'GBM' },
      { flag: 'wantsPancreatic', pattern: /\bpancreatic\b|\bpdac\b/, label: 'Pancreatic' },
      { flag: 'wantsOvarian', pattern: /\bovarian\b|\bfallopian\b/, label: 'Ovarian' },
      { flag: 'wantsProstate', pattern: /\bprostate\b|\bcrpc\b|\bmcrpc\b|\bcastration[-\s]?resistant\b/, label: 'Prostate' },
      { flag: 'wantsBladder', pattern: /\bbladder\b|\burothelial\b/, label: 'Bladder' },
      { flag: 'wantsGastric', pattern: /\bgastric\b|\bstomach\b|\bgastroesophageal\b/, label: 'Gastric' },
      { flag: 'wantsLymphoma', pattern: /\blymphoma\b|\bdlbcl\b|\bfollicular\b|\bhodgkin\b/, label: 'Lymphoma' },
      { flag: 'wantsMyeloma', pattern: /\bmyeloma\b/, label: 'Myeloma' },
      { flag: 'wantsLeukemia', pattern: /\bleukemia\b|\baml\b|\ball\b|\bcll\b/, label: 'Leukemia' },
      { flag: 'wantsHeadNeck', pattern: /\bhead and neck\b|\bhnscc\b|\bnasopharyngeal\b/, label: 'Head&Neck' },
      { flag: 'wantsMesothelioma', pattern: /\bmesothelioma\b/, label: 'Mesothelioma' },
      { flag: 'wantsThyroid', pattern: /\bthyroid\b/, label: 'Thyroid' },
      { flag: 'wantsSarcoma', pattern: /\bsarcoma\b|\bgist\b|\bosteosarcoma\b/, label: 'Sarcoma' }
    ];

    for (const { flag, pattern, label } of cancerTypeChecks) {
      if (clinicalFocus[flag]) {
        const inTitle = pattern.test(titleText);
        const inAny = inTitle || pattern.test(combinedText);
        if (inTitle) {
          score += 0.35;
          rationale.push(`${label} in title`);
        } else if (inAny) {
          score += 0.2;
          rationale.push(`${label} in abstract`);
        } else {
          score -= 0.7;
          rationale.push(`${label} mismatch penalty`);
        }
        break; // one cancer type match per article
      }
    }

    // ── Improvement 5: Drug-specific matching ────────────────────────────────
    const questionDrugs = clinicalFocus.detectedDrugs || [];
    if (questionDrugs.length > 0) {
      const articleDrugs = this.extractDrugMentions(combinedText);
      const drugMatches = questionDrugs.filter(d => articleDrugs.includes(d));
      if (drugMatches.length > 0) {
        score += 0.32;
        rationale.push(`Drug match: ${drugMatches.join(', ')}`);
      } else {
        score -= 0.55;
        rationale.push('Question drug not found in article');
      }
    }

    // ── Improvement 6: Expanded biomarker matching ───────────────────────────
    const biomarkerChecks = [
      { flag: 'wantsEGFR', pattern: /\begfr\b/, label: 'EGFR' },
      { flag: 'wantsALK', pattern: /\balk\b/, label: 'ALK' },
      { flag: 'wantsROS1', pattern: /\bros[-\s]?1\b/, label: 'ROS1' },
      { flag: 'wantsKRAS', pattern: /\bkras\b/, label: 'KRAS' },
      { flag: 'wantsBRAF', pattern: /\bbraf\b/, label: 'BRAF' },
      { flag: 'wantsMSI', pattern: /\bmsi[-\s]?h\b|\bmmr[-\s]?d\b|\bmicrosatellite[-\s]?instability\b/, label: 'MSI-H' },
      { flag: 'wantsPDL1', pattern: /\bpd[-\s]?l1\b/, label: 'PD-L1' },
      { flag: 'wantsNTRK', pattern: /\bntrk\b/, label: 'NTRK' },
      { flag: 'wantsRET', pattern: /\bret\b/, label: 'RET' },
      { flag: 'wantsMET', pattern: /\bmet\b|\bmet[-\s]?ex14\b/, label: 'MET' },
      { flag: 'wantsFGFR', pattern: /\bfgfr\b/, label: 'FGFR' },
      { flag: 'wantsTMB', pattern: /\btmb\b|\btumou?r[-\s]?mutational[-\s]?burden\b/, label: 'TMB' },
      { flag: 'wantsBRCA', pattern: /\bbrca\b|\bhrd\b|\bhomologous[-\s]?recombination\b/, label: 'BRCA/HRD' }
    ];

    for (const { flag, pattern, label } of biomarkerChecks) {
      if (clinicalFocus[flag]) {
        const matched = pattern.test(combinedText);
        if (matched) {
          score += 0.28;
          rationale.push(`${label} biomarker match`);
        } else {
          score -= 0.45;
          rationale.push(`${label} biomarker mismatch`);
        }
      }
    }

    // ── Improvement 7: Multi-endpoint richness bonus ─────────────────────────
    const endpointRichness = this.countEndpointRichness(article);
    if (endpointRichness >= 3) {
      score += 0.22;
      rationale.push(`Multi-endpoint richness (${endpointRichness} endpoints)`);
    } else if (endpointRichness === 2) {
      score += 0.1;
      rationale.push(`Dual-endpoint report (${endpointRichness} endpoints)`);
    }

    return {
      article,
      score,
      include: evidenceTier.include,
      evidenceTier: evidenceTier.label,
      rationale
    };
  }

  /**
   * Rank retrieved articles by practical clinical relevance
   */
  rankArticlesWithDiagnostics(articles = [], question = '', options = {}) {
    if (!Array.isArray(articles) || articles.length === 0) return [];
    const queryTerms = this.tokenize(question);

    return articles
      .map(article => this.scoreArticleSelection(article, queryTerms, {
        ...options,
        questionText: question
      }))
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }

        const endpointSignalDelta = Number(this.hasDirectOutcomeSignals(b.article)) - Number(this.hasDirectOutcomeSignals(a.article));
        if (endpointSignalDelta !== 0) {
          return endpointSignalDelta;
        }

        const yearA = Number.parseInt(a?.article?.year, 10) || 0;
        const yearB = Number.parseInt(b?.article?.year, 10) || 0;
        return yearB - yearA;
      })
      .map(item => ({
        ...item,
        rationale: Array.isArray(item.rationale) ? [...new Set(item.rationale)].slice(0, 8) : []
      }));
  }

  rankArticlesByRelevance(articles = [], question = '', options = {}) {
    return this.rankArticlesWithDiagnostics(articles, question, options)
      .map(item => item.article);
  }

  /**
   * Build concise clinical focus block for prompts
   */
  buildClinicalContextBlock(options = {}) {
    const lines = [
      options.population && `Population: ${options.population}`,
      options.intervention && `Intervention: ${options.intervention}`,
      options.comparator && `Comparator: ${options.comparator}`,
      options.outcomes && `Outcomes: ${options.outcomes}`,
      options.biomarker && `Biomarker: ${options.biomarker}`,
      options.lineOfTherapy && `Line of therapy: ${options.lineOfTherapy}`
    ].filter(Boolean);

    if (Array.isArray(options.studyTypes) && options.studyTypes.length > 0) {
      lines.push(`Preferred study types: ${options.studyTypes.join(', ')}`);
    }

    if (Array.isArray(options.endpoints) && options.endpoints.length > 0) {
      lines.push(`Priority endpoints: ${options.endpoints.join(', ')}`);
    }

    return lines.length > 0 ? lines.join('\n') : null;
  }

  /**
   * Extract trial acronym/name from title or abstract
   */
  extractTrialName(title = '', abstract = '') {
    const text = `${title} ${abstract}`;
    if (!text.trim()) return null;

    const knownTrialPatterns = [
      /\b(KEYNOTE[-\s]?\d+)\b/i,
      /\b(IMpassion\d+)\b/i,
      /\b(CHECKMATE[-\s]?\d+)\b/i,
      /\b(PARTNER)\b/i,
      /\b(NeoSTOP)\b/i,
      /\b(Gepar[A-Za-z0-9-]+)\b/i,
      /\b(OlympiA)\b/i
    ];

    for (const pattern of knownTrialPatterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        return match[1].replace(/\s+/g, '');
      }
    }

    const genericMatch = text.match(/\b([A-Z][A-Z0-9-]{2,})\s+(?:trial|study)\b/);
    if (genericMatch?.[1]) return genericMatch[1];

    return null;
  }

  /**
   * Extract key oncology endpoints from free text
   */
  extractEndpointMetrics(text = '') {
    const normalized = String(text || '').replace(/\s+/g, ' ');
    if (!normalized) return {};

    const connector = '(?:rate\\s+was|rate\\s+were|was|were|at|of|is|estimated\\s+at|reported\\s+at|rate\\s+of|=|:)';
    const metrics = {};

    const pickTimeHorizon = (aroundIndex = 0) => {
      const window = normalized.slice(Math.max(0, aroundIndex - 80), Math.min(normalized.length, aroundIndex + 120)).toLowerCase();
      // Common reporting patterns: "36-month", "3-year", "at 3 years"
      const m1 = window.match(/\b(\d{1,2})\s*[- ]\s*month\b/);
      if (m1?.[1]) return `${m1[1]}-month`;
      const m2 = window.match(/\b(\d{1,2})\s*[- ]\s*year\b/);
      if (m2?.[1]) return `${m2[1]}-year`;
      const m3 = window.match(/\bat\s+(\d{1,2})\s*(months?|years?)\b/);
      if (m3?.[1] && m3?.[2]) return `${m3[1]}-${m3[2].toLowerCase().startsWith('year') ? 'year' : 'month'}`;
      return null;
    };

    const capturePercentage = (regexes = []) => {
      for (const regex of regexes) {
        const matches = normalized.matchAll(regex);
        for (const match of matches) {
          const valueRaw = match?.[1];
          const value = Number.parseFloat(valueRaw);
          if (!Number.isFinite(value) || value < 0 || value > 100) continue;

          const index = Number.isFinite(match?.index) ? match.index : normalized.indexOf(match[0]);
          const trailing = normalized
            .slice(index + match[0].length, index + match[0].length + 24)
            .toLowerCase();

          // Skip common false positives such as "95% CI" immediately after HR values.
          if (/(^|\s)(ci|confidence interval)/i.test(trailing) && /^95(?:\.0+)?$/.test(String(valueRaw || '').trim())) {
            continue;
          }
          const horizon = pickTimeHorizon(index);
          const pct = `${String(valueRaw).replace(/\.0+$/, '')}%`;
          return horizon ? `${horizon} ${pct}` : pct;
        }
      }
      return null;
    };

    metrics.pcr = capturePercentage([
      new RegExp(`(?:pathologic(?:al)? complete response|pcr)\\s*${connector}\\s*(\\d+(?:\\.\\d+)?)\\s*%`, 'ig'),
      /(?:pathologic(?:al)? complete response|pcr)\s*(\d+(?:\.\d+)?)\s*%/ig,
      /(\d+(?:\.\d+)?)\s*%\s*(?:pathologic(?:al)? complete response|pcr)/ig
    ]);

    metrics.efs = capturePercentage([
      new RegExp(`(?:event[- ]free survival|efs)\\s*${connector}\\s*(\\d+(?:\\.\\d+)?)\\s*%`, 'ig'),
      /(?:event[- ]free survival|efs)\s*(\d+(?:\.\d+)?)\s*%/ig,
      /(\d+(?:\.\d+)?)\s*%\s*(?:event[- ]free survival|efs)/ig
    ]);

    metrics.dfs = capturePercentage([
      new RegExp(`(?:disease[- ]free survival|dfs)\\s*${connector}\\s*(\\d+(?:\\.\\d+)?)\\s*%`, 'ig'),
      /(?:disease[- ]free survival|dfs)\s*(\d+(?:\.\d+)?)\s*%/ig,
      /(\d+(?:\.\d+)?)\s*%\s*(?:disease[- ]free survival|dfs)/ig
    ]);

    metrics.pfs = capturePercentage([
      new RegExp(`(?:progression[- ]free survival|pfs)\\s*${connector}\\s*(\\d+(?:\\.\\d+)?)\\s*%`, 'ig'),
      /(?:progression[- ]free survival|pfs)\s*(\d+(?:\.\d+)?)\s*%/ig,
      /(\d+(?:\.\d+)?)\s*%\s*(?:progression[- ]free survival|pfs)/ig
    ]);

    metrics.os = capturePercentage([
      new RegExp(`(?:overall survival|os)\\s*${connector}\\s*(\\d+(?:\\.\\d+)?)\\s*%`, 'ig'),
      /(?:overall survival|os)\s*(\d+(?:\.\d+)?)\s*%/ig,
      /(\d+(?:\.\d+)?)\s*%\s*(?:overall survival|os)\b/ig
    ]);

    metrics.orr = capturePercentage([
      new RegExp(`(?:objective response rate|orr)\\s*${connector}\\s*(\\d+(?:\\.\\d+)?)\\s*%`, 'ig'),
      /(?:objective response rate|orr)\s*(\d+(?:\.\d+)?)\s*%/ig,
      /(\d+(?:\.\d+)?)\s*%\s*(?:objective response rate|orr)\b/ig
    ]);

    metrics.grade34ae = capturePercentage([
      new RegExp(`(?:grade\\s*3(?:\\s*\\/\\s*4|[-–]4)?\\s*(?:treatment-related\\s*)?(?:adverse events?|aes?)|g3[-–]?4\\s*(?:aes?|adverse events?))\\s*${connector}\\s*(\\d+(?:\\.\\d+)?)\\s*%`, 'ig'),
      /(?:grade\s*3(?:\s*\/\s*4|[-–]4)?\s*(?:adverse events?|aes?)|g3[-–]?4\s*(?:aes?|adverse events?))\s*(\d+(?:\.\d+)?)\s*%/ig
    ]);

    const sampleCandidates = [];
    const samplePatterns = [
      /\bn\s*=\s*(\d{2,5})\b/ig,
      /\b(?:randomized|enrolled|assigned|included|recruited)\s+(\d{2,5})\s+(?:patients|participants|subjects)?\b/ig,
      /\b(\d{2,5})\s+(?:patients|participants|subjects)\b/ig,
      /\btotal of\s+(\d{2,5})\b/ig
    ];

    for (const pattern of samplePatterns) {
      const matches = normalized.matchAll(pattern);
      for (const match of matches) {
        const parsed = Number.parseInt(match?.[1], 10);
        if (Number.isFinite(parsed) && parsed >= 20) {
          sampleCandidates.push(parsed);
        }
      }
    }

    if (sampleCandidates.length > 0) {
      metrics.sampleSize = `${Math.max(...sampleCandidates)}`;
    }

    return Object.fromEntries(Object.entries(metrics).filter(([, value]) => Boolean(value)));
  }

  /**
   * Infer high-level study design signal from text
   */
  extractStudyDesign(text = '', publicationTypes = []) {
    const t = String(text || '').toLowerCase();
    const types = (Array.isArray(publicationTypes) ? publicationTypes : [])
      .map(value => String(value || '').toLowerCase());
    if (!t) return null;

    if (types.some(type => type.includes('practice guideline') || type.includes('guideline'))) return 'Guideline';
    if (types.some(type => type.includes('systematic review'))) return 'Systematic review';
    if (types.some(type => type.includes('meta-analysis'))) return 'Meta-analysis';
    if (types.some(type => type.includes('randomized controlled trial'))) return 'Randomized controlled trial';
    if (types.some(type => type.includes('clinical trial, phase iii'))) return 'Phase III';
    if (types.some(type => type.includes('clinical trial, phase ii'))) return 'Phase II';
    if (types.some(type => type.includes('clinical trial, phase i'))) return 'Phase I';
    if (types.some(type => type.includes('observational study'))) return 'Observational study';
    if (types.some(type => type.includes('comparative study'))) return 'Comparative study';

    if (t.includes('phase iii') || t.includes('phase 3')) return 'Phase III';
    if (t.includes('phase ii') || t.includes('phase 2')) return 'Phase II';
    if (t.includes('phase i') || t.includes('phase 1')) return 'Phase I';
    if (t.includes('randomized')) return 'Randomized trial';
    if (t.includes('systematic review')) return 'Systematic review';
    if (t.includes('meta-analysis') || t.includes('meta analysis')) return 'Meta-analysis';
    if (t.includes('prospective')) return 'Prospective study';
    if (t.includes('retrospective')) return 'Retrospective study';

    return null;
  }

  extractPublicationTypes(articleXml = '') {
    return [...String(articleXml || '').matchAll(/<PublicationType[^>]*>([\s\S]*?)<\/PublicationType>/g)]
      .map(match => this.cleanXmlText(match?.[1] || ''))
      .filter(Boolean);
  }

  /**
   * Compute compact evidence readiness stats for quick review
   */
  computeQuickReviewStats(articles = []) {
    if (!Array.isArray(articles) || articles.length === 0) {
      return {
        readinessScore: 0,
        grade: 'Low',
        yearRange: '',
        recentCount: 0,
        rctCount: 0,
        medianSampleSize: null
      };
    }

    const currentYear = new Date().getFullYear();
    const years = articles
      .map(article => parseInt(article?.year, 10))
      .filter(year => Number.isFinite(year));
    const yearRange = years.length > 0 ? `${Math.min(...years)}-${Math.max(...years)}` : '';
    const recentCount = years.filter(year => year >= currentYear - 5).length;

    const sampleSizes = articles
      .map(article => parseInt(article?.endpointMetrics?.sampleSize, 10))
      .filter(value => Number.isFinite(value))
      .sort((a, b) => a - b);
    const medianSampleSize = sampleSizes.length > 0
      ? sampleSizes[Math.floor(sampleSizes.length / 2)]
      : null;

    const synthesisCount = articles.filter(article => {
      const text = `${article?.studyDesign || ''} ${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();
      return text.includes('systematic review') || text.includes('meta-analysis') || text.includes('meta analysis');
    }).length;

    const rctCount = articles.filter(article => {
      const text = `${article?.studyDesign || ''} ${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();
      const looksLikeSynthesis = text.includes('systematic review') || text.includes('meta-analysis') || text.includes('meta analysis');
      if (looksLikeSynthesis) return false;
      return text.includes('randomized') || text.includes('phase iii') || text.includes('phase 3');
    }).length;

    const endpointsPerArticle = articles.map(article => {
      const metrics = article?.endpointMetrics || {};
      return ['pcr', 'efs', 'dfs', 'pfs', 'os', 'orr', 'grade34ae']
        .filter(key => Boolean(metrics[key])).length;
    });
    const endpointCoverage = endpointsPerArticle.length > 0
      ? endpointsPerArticle.reduce((sum, v) => sum + v, 0) / endpointsPerArticle.length
      : 0;

    const total = articles.length;
    const designCoverage = total > 0
      ? Math.min(1, ((rctCount + (synthesisCount * 1.2)) / total))
      : 0;
    const recencyCoverage = total > 0 ? (recentCount / total) : 0;
    const endpointCoverageScore = Math.min(1, endpointCoverage / 4);
    const sampleCoverage = medianSampleSize >= 300
      ? 1
      : (medianSampleSize >= 100 ? 0.7 : (medianSampleSize >= 50 ? 0.4 : 0));

    let readinessScore = Math.round(
      (designCoverage * 40)
      + (recencyCoverage * 25)
      + (endpointCoverageScore * 20)
      + (sampleCoverage * 15)
    );
    if (!Number.isFinite(readinessScore)) readinessScore = 0;

    let grade = 'Low';
    if (readinessScore >= 75) grade = 'High';
    else if (readinessScore >= 55) grade = 'Moderate';

    return {
      readinessScore,
      grade,
      yearRange,
      recentCount,
      rctCount,
      medianSampleSize
    };
  }

  /**
   * Merge endpoint and design data from companion evidence
   */
  countKnownEndpointCoverage(article = {}) {
    return ['pcr', 'efs', 'os', 'orr', 'grade34ae']
      .filter(endpointKey =>
        Boolean(this.endpointClaimAgent.getEndpointMetricValue(article, endpointKey)) ||
        Boolean(article?.endpointSourceContexts?.[endpointKey])
      ).length;
  }

  buildCompanionEndpointSourceContext(article = {}, endpointKey = '') {
    const endpointMetrics = {};
    for (const metricKey of this.getEndpointMetricKeys(endpointKey)) {
      if (article?.endpointMetrics?.[metricKey]) {
        endpointMetrics[metricKey] = article.endpointMetrics[metricKey];
      }
    }

    return {
      article: {
        pmid: article?.pmid || null,
        title: article?.title || null,
        abstract: article?.abstract || null,
        year: article?.year || null,
        trialName: article?.trialName || null,
        studyDesign: article?.studyDesign || null,
        endpointMetrics
      },
      summary: null
    };
  }

  mergeArticleEvidence(baseArticle, companionArticle) {
    const merged = { ...baseArticle };
    const baseMetrics = { ...(baseArticle?.endpointMetrics || {}) };
    const companionMetrics = companionArticle?.endpointMetrics || {};

    merged.endpointMetrics = { ...baseMetrics };
    for (const [key, value] of Object.entries(companionMetrics)) {
      if (!merged.endpointMetrics[key] && value) {
        merged.endpointMetrics[key] = value;
      }
    }

    if (!merged.studyDesign && companionArticle?.studyDesign) {
      merged.studyDesign = companionArticle.studyDesign;
    }

    if (!merged.trialName && companionArticle?.trialName) {
      merged.trialName = companionArticle.trialName;
    }

    merged.endpointSources = { ...(baseArticle?.endpointSources || {}) };
    merged.endpointSourceContexts = { ...(baseArticle?.endpointSourceContexts || {}) };

    const companionEndpointKeys = this.endpointClaimAgent.getStudyEndpointKeys(companionArticle, null);
    for (const endpointKey of companionEndpointKeys) {
      const existingMetric = this.endpointClaimAgent.getEndpointMetricValue(merged, endpointKey);
      const companionMetric = this.endpointClaimAgent.getEndpointMetricValue(companionArticle, endpointKey);
      const hasExistingContext = Boolean(merged.endpointSourceContexts?.[endpointKey]);

      if (!merged.endpointSources[endpointKey]) {
        merged.endpointSources[endpointKey] = {
          pmid: companionArticle?.pmid || null,
          year: companionArticle?.year || null,
          title: companionArticle?.title || null
        };
      }

      if (!hasExistingContext || (!existingMetric && companionMetric)) {
        merged.endpointSourceContexts[endpointKey] = this.buildCompanionEndpointSourceContext(companionArticle, endpointKey);
      }
    }

    const mergedPmids = new Set([
      ...(Array.isArray(baseArticle?.relatedPmids) ? baseArticle.relatedPmids : []),
      ...(Array.isArray(companionArticle?.relatedPmids) ? companionArticle.relatedPmids : []),
      companionArticle?.pmid
    ].filter(Boolean));
    merged.relatedPmids = Array.from(mergedPmids);

    return merged;
  }

  shouldSkipCompanionEvidenceEnrichment(article = {}) {
    return this.isExploratoryAnalysisPublication(article) ||
      this.isBiomarkerFocusedPublication(article) ||
      this.isQualityOfLifeFocusedPublication(article);
  }

  /**
   * Enrich sparse studies by searching companion publications for same trial
   */
  async enrichArticleWithCompanionEvidence(article, question = '') {
    try {
      const trialName = article?.trialName;
      if (!trialName) return article;
      if (this.shouldSkipCompanionEvidenceEnrichment(article)) {
        return article;
      }

      const endpointCount = ['pcr', 'efs', 'dfs', 'pfs', 'os', 'orr', 'grade34ae']
        .filter(key => article?.endpointMetrics?.[key]).length;
      if (endpointCount >= 2 && article?.studyDesign) {
        return article;
      }

      const companionQuery = `${trialName} ${question} pCR OR EFS OR DFS OR ORR`;
      const companions = await this.searchPubMed(companionQuery, 6);
      if (!companions || companions.length === 0) {
        return article;
      }

      const sameTrialCompanions = companions.filter(candidate => {
        const candidateName = this.extractTrialName(candidate?.title, candidate?.abstract);
        if (!candidateName) return false;
        return candidateName.toLowerCase() === trialName.toLowerCase();
      });

      const candidates = sameTrialCompanions.length > 0 ? sameTrialCompanions : companions;
      const rankedCandidates = [];

      for (const candidate of candidates) {
        if (candidate?.pmid && candidate.pmid === article?.pmid) {
          continue;
        }
        if (this.shouldSkipCompanionEvidenceEnrichment(candidate)) {
          continue;
        }
        const metrics = candidate?.endpointMetrics || {};
        const metricScore = ['pcr', 'efs', 'dfs', 'pfs', 'os', 'orr', 'grade34ae']
          .filter(key => Boolean(metrics[key])).length;
        const endpointKeyScore = [...new Set(this.endpointClaimAgent.getStudyEndpointKeys(candidate, null))].length * 0.75;
        const designScore = candidate?.studyDesign ? 1 : 0;
        const recencyScore = (Number.parseInt(candidate?.year, 10) || 0) * 0.001;
        rankedCandidates.push({
          candidate,
          totalScore: metricScore + endpointKeyScore + designScore + recencyScore
        });
      }

      if (rankedCandidates.length === 0) return article;

      rankedCandidates.sort((a, b) => b.totalScore - a.totalScore);
      let enrichedArticle = article;

      for (const { candidate } of rankedCandidates.slice(0, 3)) {
        enrichedArticle = this.mergeArticleEvidence(enrichedArticle, candidate);
        if (this.countKnownEndpointCoverage(enrichedArticle) >= 4 && enrichedArticle?.studyDesign) {
          break;
        }
      }

      return enrichedArticle;
    } catch (error) {
      logger.warn(`Companion evidence enrichment failed for PMID ${article?.pmid}: ${error.message}`);
      return article;
    }
  }

  /**
   * Enrich top context articles with companion evidence where needed
   */
  async enrichContextArticles(articles = [], question = '') {
    if (!Array.isArray(articles) || articles.length === 0) return [];

    // Identify which articles need enrichment (up to maxCompanionSearches)
    let enrichmentSlots = this.maxCompanionSearches;
    const tasks = articles.map((article) => {
      const endpointCount = ['pcr', 'efs', 'dfs', 'pfs', 'os', 'orr', 'grade34ae']
        .filter(key => article?.endpointMetrics?.[key]).length;
      const needsEnrichment = enrichmentSlots > 0 && (endpointCount < 2 || !article?.studyDesign);
      if (needsEnrichment) enrichmentSlots--;
      return needsEnrichment
        ? this.enrichArticleWithCompanionEvidence(article, question)
        : Promise.resolve(article);
    });

    // Run all enrichment searches in parallel
    return Promise.all(tasks);
  }

  /**
   * Truncate an abstract to its most informative sections (results, conclusions, findings).
   * Reduces prompt token count by ~40% while preserving the data the LLM needs.
   */
  truncateAbstract(abstract = '', maxLength = 900) {
    const text = String(abstract || '').trim();
    if (text.length <= maxLength) return text;

    // Structured abstracts have labelled sections — extract the most valuable ones
    const sectionPattern = /\b(results?|findings?|conclusions?|outcomes?|efficacy|survival|response|safety)\s*[:.\-]\s*/gi;
    const matches = [...text.matchAll(sectionPattern)];

    if (matches.length > 0) {
      // Collect text from the first matching section header to the end
      const firstResultIdx = matches[0].index;
      const extracted = text.slice(firstResultIdx).trim();
      if (extracted.length >= 120) {
        return extracted.slice(0, maxLength);
      }
    }

    // Unstructured abstract — take the last portion (results/conclusions are typically at the end)
    if (text.length > maxLength) {
      return '...' + text.slice(text.length - maxLength);
    }
    return text;
  }

  /**
   * Normalize model output to keep only quick review and remove missing markers
   */
  cleanMissingPlaceholders(text = '') {
    let normalized = String(text || '');

    normalized = normalized
      .replace(/\bNR\b/gi, '')
      .replace(/\bN\/A\b/gi, '')
      .replace(/\bnot applicable\b/gi, '')
      .replace(/\bnot available(?: in source text)?\b/gi, '')
      .replace(/\bavailable in source text\b/gi, '')
      .replace(/\bavailable source\b/gi, '')
      .replace(/\bnot reported in the abstract\b/gi, '')
      .replace(/\bnot reported\b/gi, '')
      .replace(/\bmissing information\b/gi, '')
      .replace(/\bstudy not reported\b/gi, '')
      .replace(/\bdesign not clearly reported\b/gi, '')
      .replace(/\b(?:did not provide specific numbers|no specific numbers provided)\b/gi, '')
      .replace(/\b(?:specific|detailed)\s+(?:findings|results)[^.\n]{0,120}\sare\s*\[[0-9,\s]+\]\.?/gi, '')
      .replace(/\b(?:specific|detailed)\s+(?:findings|results)[^.\n]{0,120}\sare\s*\.?/gi, '')
      .replace(/\bthe specific safety profiles and limitations of the studies were in the source texts\.?/gi, '')
      .replace(/\b(?:the safety and limitations of the interventions were in the source texts)\.?/gi, '')
      .replace(/\btherefore,\s*further investigation is required to fully understand[^.\n]*\.?/gi, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s+([,.;:])/g, '$1')
      .trim();

    return normalized;
  }

  /**
   * Normalize model output to keep only quick review and remove missing markers
   */
  async enforceQuickReviewWithoutMissing(answer, question, articles, stats, options = {}) {
    const text = String(answer || '').trim();
    if (!text) return text;

    const lower = text.toLowerCase();
    const hasForbiddenToken = this.forbiddenMissingTokens.some(token => lower.includes(token));
    if (!hasForbiddenToken || !this.openai) {
      return this.cleanMissingPlaceholders(text);
    }

    try {
      const language = options.responseLanguage || 'en';
      const languageDirective = {
        pt: 'Write in European Portuguese (Portugal, pt-PT). Use Portuguese spelling and vocabulary, NOT Brazilian Portuguese.',
        en: 'Write in English.',
        auto: 'Write in the SAME language as the user question. If Portuguese, use European Portuguese (pt-PT — NOT Brazilian).'
      }[language] || 'Write in the same language as the user question.';

      const evidenceLines = (articles || []).map((article, index) => {
        const m = article?.endpointMetrics || {};
        const metrics = [
          m.pcr && `pCR ${m.pcr}`,
          m.efs && `EFS ${m.efs}`,
          m.dfs && `DFS ${m.dfs}`,
          m.pfs && `PFS ${m.pfs}`,
          m.os && `OS ${m.os}`,
          m.orr && `ORR ${m.orr}`,
          m.grade34ae && `G3-4 AEs ${m.grade34ae}`
        ].filter(Boolean).join(' | ');
        return `[${index + 1}] PMID ${article?.pmid} | ${article?.trialName || article?.title || 'Study'} | ${metrics || 'endpoint signals available in narrative evidence'}`;
      }).join('\n');

      const prompt = `Rewrite the answer as a strict QUICK STUDY REVIEW only.
${languageDirective}

Rules:
- Keep only concise quick-study-review content.
- Do NOT use placeholders like NR, N/A, not reported, missing information.
- Use only evidence that is explicitly available.
- If a study lacks a specific endpoint, omit that endpoint for that study.
- Keep citations [n] where possible.

Question: ${question}
Stats: readiness ${stats?.readinessScore || 0}, grade ${stats?.grade || 'Low'}, years ${stats?.yearRange || 'available'}, recent ${stats?.recentCount || 0}, rcts ${stats?.rctCount || 0}, medianN ${stats?.medianSampleSize || 'available'}
Evidence lines:
${evidenceLines}

Draft answer:
${text}

Return only the rewritten quick study review.`;

      const response = await this.fastModel.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 900,
        temperature: 0.1
      });

      const revised = response.choices[0]?.message?.content?.trim() || text;
      return this.cleanMissingPlaceholders(revised);
    } catch (error) {
      logger.warn(`Quick review cleanup failed: ${error.message}`);
      return this.cleanMissingPlaceholders(text);
    }
  }

  /**
   * Extract structured evidence summaries from abstracts
   */
  // ---- Evidence summary cache (keyed by sorted PMID set, avoids re-extraction) ----
  _evidenceSummaryCache = new Map();
  _EVIDENCE_CACHE_TTL = 60 * 60 * 1000; // 1 hour
  _EVIDENCE_CACHE_MAX = 50;

  _getEvidenceCacheKey(articles) {
    return articles.map(a => a.pmid).filter(Boolean).sort().join(',');
  }

  _cleanEvidenceSummaryCache() {
    if (this._evidenceSummaryCache.size <= this._EVIDENCE_CACHE_MAX) return;
    const now = Date.now();
    for (const [key, entry] of this._evidenceSummaryCache) {
      if (now - entry.ts > this._EVIDENCE_CACHE_TTL) this._evidenceSummaryCache.delete(key);
    }
    if (this._evidenceSummaryCache.size > this._EVIDENCE_CACHE_MAX) {
      const entries = [...this._evidenceSummaryCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
      for (let i = 0; i < entries.length - this._EVIDENCE_CACHE_MAX; i++) {
        this._evidenceSummaryCache.delete(entries[i][0]);
      }
    }
  }

  async extractEvidenceSummaries(articles = []) {
    try {
      const items = articles.slice(0, this.maxEvidenceArticles).map((article, index) => ({
        index: index + 1,
        pmid: article.pmid,
        title: article.title,
        journal: article.journal,
        year: article.year,
        abstract: article.abstract ? article.abstract.slice(0, 1500) : null
      }));

      if (items.length === 0) return [];

      // Check evidence summary cache
      const cacheKey = this._getEvidenceCacheKey(articles);
      const cached = this._evidenceSummaryCache.get(cacheKey);
      if (cached && (Date.now() - cached.ts < this._EVIDENCE_CACHE_TTL)) {
        logger.info(`[EvidenceSummary] Cache hit for ${items.length} articles`);
        return cached.summaries;
      }

      const prompt = this.publicationExtractionAgent.buildExtractionPrompt(items);

      const response = await this.fastModel.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1200,
        temperature: 0.1
      });

      const text = response.choices[0]?.message?.content || '[]';
      const parsed = this.tryParseJsonArray(text);
      const summaries = this.publicationExtractionAgent.normalizeExtractionResults(parsed);

      // Store in cache
      this._evidenceSummaryCache.set(cacheKey, { summaries, ts: Date.now() });
      this._cleanEvidenceSummaryCache();

      return summaries;
    } catch (error) {
      logger.warn(`Evidence extraction failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Best-effort JSON array parsing
   */
  tryParseJsonArray(text) {
    if (!text) return [];
    const trimmed = text.trim();
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      const match = trimmed.match(/\[[\s\S]*\]/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (innerError) {
          return [];
        }
      }
      return [];
    }
  }

  decodeXmlEntities(text = '') {
    return String(text || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, code) => {
        const value = parseInt(code, 10);
        return Number.isFinite(value) ? String.fromCharCode(value) : '';
      });
  }

  cleanXmlText(text = '') {
    return this.decodeXmlEntities(String(text || ''))
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Parse PubMed search results XML
   */
  parsePubMedSearchResults(xml) {
    try {
      const idMatches = xml.match(/<Id>(\d+)<\/Id>/g);
      if (!idMatches) return [];
      
      return idMatches.map(match => match.replace(/<\/?Id>/g, ''));
    } catch (error) {
      logger.error(`Failed to parse PubMed search results: ${error.message}`);
      return [];
    }
  }

  /**
   * Parse PubMed articles XML
   */
  parsePubMedArticles(xml) {
    try {
      const articles = [];
      const articleMatches = xml.match(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g);
      
      if (!articleMatches) return articles;
      
      for (const articleXml of articleMatches) {
        try {
          const article = this.parseSinglePubMedArticle(articleXml);
          if (article) {
            articles.push(article);
          }
        } catch (error) {
          logger.warn(`Failed to parse individual PubMed article: ${error.message}`);
        }
      }
      
      return articles;
    } catch (error) {
      logger.error(`Failed to parse PubMed articles: ${error.message}`);
      return [];
    }
  }

  /**
   * Parse single PubMed article XML
   */
  parseSinglePubMedArticle(articleXml) {
    try {
      // Extract PMID
      const pmidMatch = articleXml.match(/<PMID[^>]*>(\d+)<\/PMID>/);
      
      // Extract title
      const titleMatch = articleXml.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/);
      const title = this.cleanXmlText(titleMatch?.[1] || '');
      
      // Extract abstract
      const abstractMatches = [...articleXml.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)];
      const abstract = abstractMatches
        .map(match => this.cleanXmlText(match[1]))
        .filter(Boolean)
        .join(' ');
      
      // Extract authors
      let authors = [];
      const authorBlocks = articleXml.match(/<Author[^>]*>[\s\S]*?<\/Author>/g) || [];
      authors = authorBlocks.map(block => {
        const lastName = this.cleanXmlText((block.match(/<LastName>([\s\S]*?)<\/LastName>/) || [])[1] || '');
        const foreName = this.cleanXmlText((block.match(/<ForeName>([\s\S]*?)<\/ForeName>/) || [])[1] || '');
        const initials = this.cleanXmlText((block.match(/<Initials>([\s\S]*?)<\/Initials>/) || [])[1] || '');
        if (!lastName) return null;
        if (foreName) return `${foreName} ${lastName}`;
        if (initials) return `${initials} ${lastName}`;
        return lastName;
      }).filter(Boolean);
      
      // Extract journal
      const journalMatch = articleXml.match(/<Journal>[\s\S]*?<Title>([\s\S]*?)<\/Title>/);
      
      // Extract publication date
      const dateMatch =
        articleXml.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/) ||
        articleXml.match(/<ArticleDate[^>]*>[\s\S]*?<Year>(\d{4})<\/Year>/);
      
      // Extract DOI
      const doiMatch = articleXml.match(/<ArticleId[^>]*IdType="doi"[^>]*>([^<]+)<\/ArticleId>/);
      
      if (!pmidMatch || !title) return null;

      const fullTextForSignals = `${title || ''} ${abstract || ''}`;
      const publicationTypes = this.extractPublicationTypes(articleXml);
      const endpointMetrics = this.extractEndpointMetrics(fullTextForSignals);
      const trialName = this.extractTrialName(title, abstract);
      const studyDesign = this.extractStudyDesign(fullTextForSignals, publicationTypes);
      
      return {
        pmid: pmidMatch[1],
        title,
        abstract: abstract || null,
        authors: authors.length > 0 ? authors.join(', ') : null,
        journal: journalMatch ? this.cleanXmlText(journalMatch[1]) : null,
        year: dateMatch ? dateMatch[1] : null,
        doi: doiMatch ? doiMatch[1] : null,
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmidMatch[1]}/`,
        trialName,
        studyDesign,
        endpointMetrics,
        publicationTypes
      };
    } catch (error) {
      logger.warn(`Failed to parse PubMed article: ${error.message}`);
      return null;
    }
  }

  /**
   * Build the system prompt and user message for generateResponse.
   * Extracted so it can be reused by both generateResponse (non-streaming)
   * and processQuestionStream (true streaming).
   */
  buildGenerateResponsePrompts(question, articles = [], evidenceSummaries = [], options = {}) {
      const responseLanguage = options.responseLanguage || this.resolveResponseLanguage(question, options);
      const languageDirective = {
        pt: 'Write the full answer in European Portuguese (Portugal, pt-PT). Use Portuguese spelling and vocabulary — NOT Brazilian Portuguese.',
        en: 'Write the full answer in English.',
        es: 'Write the full answer in Spanish (Castilian).',
        fr: 'Write the full answer in French.',
        bilingual: 'Write the answer in European Portuguese (Portugal, pt-PT — NOT Brazilian Portuguese), then add a brief section titled "English summary".',
        auto: 'IMPORTANT: Reply in the SAME language as the user question. If the question is in Portuguese, write in European Portuguese (Portugal, pt-PT — NOT Brazilian). If in English, write in English.'
      }[responseLanguage] || 'Reply in the SAME language as the user question. If Portuguese, use European Portuguese (pt-PT).';

      const detailLevel = String(options.detailLevel || 'detailed').toLowerCase();
      const quickStudyOnly = options.quickStudyOnly === true || detailLevel === 'executive';
      const conversationHistory = this.normalizeConversationHistory(options.conversationHistory);
      const previousAssistantReply = this.getLastAssistantResponse(conversationHistory);
      const clinicalContextBlock = this.buildClinicalContextBlock(options);
      const quickStats = options.quickStats || this.computeQuickReviewStats(articles);
      const placeboComparatorRequested = this.isPlaceboComparatorRequested(question, options);
      const isHeadToHeadQuestion = !quickStudyOnly && /\bvs\.?\b|versus|\bcompare\b|\bcomparison\b|\bhead.to.head\b|\bdifference between\b/i.test(question);
      const comparisonEntities = this.detectComparisonEntities(options.standaloneQuestion || question, options);
      const isIndirectComparison = isHeadToHeadQuestion && !!comparisonEntities;
      const comparativeTable = quickStudyOnly
        ? ''
        : this.buildComparativeStudyTable(articles, evidenceSummaries, responseLanguage, { ...options, question });

      // Build context from PubMed articles or evidence summaries
      let articlesContext = '';
      if (articles.length > 0) {
        articlesContext = '\n\nRAW EVIDENCE REFERENCE (structured format for your use only — transform into prose, do not reproduce these fields):\n\n';
        const summariesByIndex = new Map();
        for (const summary of evidenceSummaries || []) {
          if (summary?.index) summariesByIndex.set(summary.index, summary);
        }
        articles.forEach((article, index) => {
          const articleIndex = index + 1;
          articlesContext += `Article ${articleIndex}: ${article.title}`;
          if (article.journal && article.year) articlesContext += ` - ${article.journal}, ${article.year}`;
          articlesContext += `\nPMID: ${article.pmid}`;
          if (article.abstract) {
            articlesContext += `\nAbstract: ${this.truncateAbstract(article.abstract)}`;
          } else {
            const summary = summariesByIndex.get(articleIndex);
            if (summary) {
              const keyFindings = this.sanitizeEvidenceField(summary.key_findings || '');
              const design = this.sanitizeEvidenceField(summary.study_design || article.studyDesign || '');
              const intervention = this.inferInterventionLabel(article, summary);
              const comparator = this.inferComparatorLabel(article, summary);
              const limitations = this.sanitizeEvidenceField(summary.limitations || '');
              if (design) articlesContext += `\nStudy design: ${design}`;
              if (intervention) articlesContext += `\nIntervention: ${intervention}`;
              if (comparator) articlesContext += `\nComparator: ${comparator}`;
              if (keyFindings) articlesContext += `\nKey findings: ${keyFindings}`;
              if (limitations) articlesContext += `\nLimitations: ${limitations}`;
            }
          }
          if (Array.isArray(article?.relatedPmids) && article.relatedPmids.length > 1) {
            articlesContext += `\nRelated PMIDs: ${article.relatedPmids.join(', ')}`;
          }
          if (article?.endpointSources && typeof article.endpointSources === 'object') {
            const endpointSourceParts = Object.entries(article.endpointSources)
              .map(([endpointKey, meta]) => {
                const label = this.getEndpointLabel(endpointKey, 'en');
                const pmid = meta?.pmid ? `PMID ${meta.pmid}` : '';
                const year = meta?.year ? `(${meta.year})` : '';
                return [label, pmid, year].filter(Boolean).join(' ');
              })
              .filter(Boolean);
            if (endpointSourceParts.length > 0) {
              articlesContext += `\nEndpoint source publications: ${endpointSourceParts.join(' | ')}`;
            }
          }
          if (article.trialName) articlesContext += `\nTrial name: ${article.trialName}`;
          if (article.studyDesign) articlesContext += `\nStudy design signal: ${article.studyDesign}`;
          articlesContext += `\n\n`;
        });
      } else {
        articlesContext = '\n\nNote: No specific MEDLINE/PubMed articles were found for this question. Answer using general knowledge, but mention that updated literature should be consulted.';
      }

      const isSupportiveCare = options.questionType === 'supportive_care';

      // ── Supportive care prompt ──────────────────────────────────────────
      const supportiveCarePrompt = `You are a senior oncologist practising in Europe, helping the user with a supportive care or toxicity management question.
${languageDirective}

This is a SUPPORTIVE CARE question — not a treatment efficacy question. Your primary sources are clinical practice guidelines (ESMO, ASCO, EORTC), not individual drug trials. Your job is to provide a clear, actionable clinical algorithm — not a literature review.

Structure your answer as follows:

1. **Open with the decision algorithm**: Lead with the practical decision framework. For prophylaxis questions, state the risk thresholds and criteria clearly (e.g., ">20% risk of febrile neutropenia → primary prophylaxis indicated; 10–20% + patient risk factors → consider prophylaxis"). Use a concise decision tree structure — this CAN use bullet points or a short numbered list for clarity. This is the most important part of your answer.

2. **Patient risk factors**: List the specific patient-level factors that modify the decision (e.g., age >65, ECOG ≥2, prior chemotherapy, comorbidities). Be concrete — name the factors, don't just say "patient factors should be considered."

3. **Practical implementation**: Drug names, doses, timing, and duration when relevant from guidelines. Be specific (e.g., "pegfilgrastim 6mg SC, 24–72h after chemotherapy" not just "G-CSF should be given").

4. **Regimen-specific context**: If the question is about a specific regimen (e.g., FOLFIRI, FOLFIRINOX), state the known toxicity profile and neutropenia risk category for that regimen specifically.

5. **Brief evidence note**: If high-quality studies are provided below, briefly mention them to support the guideline recommendations — but do NOT pad the answer with tangentially related studies from different regimens. If the available studies are from different regimens or populations, say so explicitly and briefly rather than presenting them as if they directly apply.

Guidelines hierarchy:
- ESMO Clinical Practice Guidelines are the PRIMARY reference for supportive care in European practice.
- ASCO guidelines and EORTC guidelines are valid complementary references.
- NCCN guidelines may be cited when ESMO/ASCO/EORTC do not cover the topic.
- For G-CSF prophylaxis specifically: reference the ESMO/EORTC guidelines on G-CSF use and the neutropenic fever risk classification of regimens.

European context:
- Reference EMA-approved drugs and formulations.
- For INFARMED (Portugal) reimbursement: use ONLY verified INFARMED data if provided below. If not, state "a disponibilidade deve ser confirmada com o INFARMED ou a farmácia hospitalar."
- Biosimilars: when G-CSF or other supportive agents have biosimilars available in Europe, mention this as it affects accessibility.

Source citations:
- For PubMed articles: cite with [n] referencing the numbered studies provided.
- For guideline recommendations: cite as "ESMO CPG", "ASCO guideline", or "EORTC guideline" as appropriate.
- Do NOT cite studies from unrelated regimens without explicitly stating the limitation.

Formatting:
- You MAY use bullet points and short numbered lists for decision algorithms — clarity is more important than prose style for supportive care.
- Use **bold** for drug names, key thresholds (e.g., **>20% NF risk**), and critical decision points.
- Keep the answer concise and actionable. Aim for 2–4 paragraphs plus the decision algorithm. Do NOT pad with verbose caveats or indirect evidence.
- No tables unless comparing two or more prophylaxis strategies head-to-head.

Quality rules:
- ALWAYS cite with [n] when referencing specific studies.
- ALWAYS cite guideline source when stating guideline recommendations.
- NEVER pad the answer with studies from different regimens presented as if they are direct evidence.
- If evidence is limited for the specific regimen, say so in ONE sentence — do not spend paragraphs discussing indirect evidence.
- Be direct and practical. An oncologist reading this should be able to make a clinical decision immediately.

After your clinical answer, on a new line write exactly this (replace the placeholders with 3 short follow-up questions in the SAME language as your answer — if Portuguese, use European Portuguese pt-PT):
FOLLOW_UPS: <question 1> | <question 2> | <question 3>

IMPORTANT: This information is for educational purposes only. Clinical decisions should be made by qualified professionals.`;

      // ── Quick study review prompt ───────────────────────────────────────
      const quickStudyPrompt = `You are a senior oncologist practising in Europe. Your task is to produce a condensed clinical summary — the same depth of analysis as a full detailed answer, compressed into scannable bullet points. Do NOT simplify the clinical reasoning or omit key data to be brief. Every important number, trial name, and clinical nuance that would appear in a detailed answer must appear here, just more compressed.
${languageDirective}

Return only one section titled "## Consulta Rápida". Use bullet points throughout — no flowing prose.

Structure (use exactly these bold subsection headers):

**Conclusão clínica:** 1–3 bullets. Lead with the direct clinical answer — what the evidence supports, what to do, and why. Include the ESMO guideline recommendation (with LOE/GOR if available). Be specific: name the drug, the line of therapy, the population, and the key qualifying condition (e.g., biomarker status). Do NOT be vague.

**Evidência-chave:** One bullet per pivotal study, maximum 5. Format: **Trial name** ([n]) — population, intervention vs comparator, primary endpoint result with exact numbers (HR x.xx, 95% CI x.xx–x.xx, p=x.xxxx; or pCR/ORR/OS as appropriate). Include the year. Name the control arm explicitly — do not just write "vs placebo" if it was "vs physician's choice chemotherapy".${isIndirectComparison ? `\n\nNo head-to-head trial exists between **${comparisonEntities.entity1}** and **${comparisonEntities.entity2}**. Organise evidence in two labelled subsections:\n  - *${comparisonEntities.entity1}:* one bullet per pivotal trial\n  - *${comparisonEntities.entity2}:* one bullet per pivotal trial\n  End with one bullet explicitly stating this is an indirect comparison and what factors guide clinical choice (toxicity, subgroup, access, guideline preference).` : ''}

**Acesso em Portugal:** 1–2 bullets. State EMA approval status and INFARMED reimbursement status. If verified INFARMED data is provided below, reproduce the exact classification (AUE, PAP, AIM+SNS) — do NOT use vague terms like "disponível" or "acessível". If multiple drugs are listed in INFARMED data, include all of them. If no INFARMED data is provided, write: "Confirmar com INFARMED ou farmácia hospitalar."

**Atenção:** 0–2 bullets. Include ONLY if there is a clinically important safety signal, a guideline conflict, a premise challenge, or a subgroup where evidence differs meaningfully. Omit this subsection entirely if nothing critical applies — do not pad.

Quality rules (same as detailed mode — do not relax these for brevity):
- ALWAYS use specific numbers (HR, CI, p-value, response rates) from the provided abstracts — never generalise when the data is available.
- ALWAYS name the trial when known.
- ALWAYS cite with [n] for every factual claim.
- NEVER leave vague statements like "improved survival" without the actual numbers.
- NEVER invent data. If a number is not in the provided abstracts, omit it rather than estimating.
- Bold **drug names**, **trial names**, and **key numbers**.

European context:
- ESMO guidelines are the primary framework. Reference EMA approval (not FDA). INFARMED for Portuguese reimbursement — use ONLY verified data provided below.
- NEVER use AUE or PAP unless the verified INFARMED data explicitly uses those terms.

Premise challenges: If a "PREMISE CHALLENGES" section is provided below, address the discrepancy in the **Atenção** subsection.

IMPORTANT: This information is for educational purposes only. Clinical decisions should be made by qualified professionals.`;

      // ── Treatment efficacy prompt (default) ─────────────────────────────
      const treatmentEfficacyPrompt = `You are a senior oncologist practising in Europe, helping the user think through a clinical question.
${languageDirective}

Your job is to synthesize what the evidence means, not to present or enumerate it. Think out loud the way a thoughtful clinician would — lead with the insight, use the data to support it.

The evidence will be provided below as article abstracts and metadata. Transform them into clinical narrative — do not reproduce field names, endpoint lists, or structured shorthand in your answer.

Structure your answer as 2–5 paragraphs of flowing prose:
1. Open with the clinical bottom line: what should the user take away from this?
2. Explain the reasoning by discussing the most important studies — what they studied, what they found, and what it means. **Always name the trial when known** (e.g., KEYNOTE-522, CheckMate 816, MONARCH-3). Cite with [n]. When the abstract provides specific numbers (HR, 95% CI, p-value, response rate, median OS/PFS), use them — do not generalize when you have the data.
3. Address meaningful uncertainty, conflicting results, or safety signals where they affect the decision — integrated into the narrative, not as a separate section.
4. Close with a concrete clinical implication tied to the actual evidence.
${isIndirectComparison ? `\nIMPORTANT — INDIRECT COMPARISON: There is no head-to-head trial between ${comparisonEntities.entity1} and ${comparisonEntities.entity2}. You MUST:\n- Summarize the pivotal evidence for each agent separately (different trials, different control arms, different populations — make this explicit).\n- State clearly that cross-trial comparisons are indirect and subject to patient-selection bias and different control arms.\n- Do NOT present numbers from different trials as if they are directly comparable.\n- If a network meta-analysis or indirect comparison study exists in the provided evidence, use it and flag it as such.\n- Conclude with a practical clinical statement on how clinicians typically choose between the two agents in the absence of head-to-head data (e.g., toxicity profile, patient subgroup, guideline preference, access).\n` : ''}

European context:
- Reference ESMO guidelines and ESMO clinical practice recommendations as the primary framework. Cite NCCN only when ESMO guidelines are unavailable for the topic.
- For drug approvals, reference EMA (European Medicines Agency) authorization status. For INFARMED (Portugal) reimbursement: if verified INFARMED reimbursement data is provided below, use ONLY that data for Portuguese reimbursement claims — do not guess, hallucinate, or infer reimbursement status from general knowledge. If no verified INFARMED data is provided for a specific drug/indication, explicitly state that reimbursement should be confirmed with INFARMED or the hospital pharmacy. NEVER use terms like "AUE" (Autorização de Utilização Especial) or "PAP" (Programa de Acesso Precoce) unless the verified INFARMED data below explicitly contains that classification — these have specific regulatory meanings and confusing them is clinically misleading. AUE applies ONLY to drugs without EMA marketing authorisation (rare); PAP applies to EMA-approved drugs pending full Portuguese reimbursement. If you are unsure which mechanism applies, say "a disponibilidade em Portugal deve ser confirmada com o INFARMED ou a farmácia hospitalar" instead of guessing the specific pathway. CRITICAL: When verified INFARMED data IS provided with a specific reimbursement status or access pathway (e.g., AUE, PAP, AIM+SNS), you MUST state that exact status explicitly in your answer — do not use vague terms like "listed", "available", or "accessible" when the data provides a precise classification. The whole point of the verified data is to give the clinician actionable specificity. IMPORTANT: If INFARMED data lists MULTIPLE drugs approved for the queried indication, mention ALL of them — do not cherry-pick only the drug the user asked about. Present the full landscape of approved options with their respective lines of therapy.
- When available, include the ESMO-MCBS (Magnitude of Clinical Benefit Scale) score to quantify the magnitude of clinical benefit of a therapy.
- Frame treatment recommendations within European standard-of-care and drug accessibility context. Not all FDA-approved drugs are EMA-approved or reimbursed in Portugal.
- If unified drug cards are provided below, use them to cross-reference EMA approval, INFARMED reimbursement/PAP status, and ESMO recommendations for each drug in a single coherent statement — do not discuss each source separately.
- If clinical trials recruiting in Portugal are listed for a drug, mention them as part of the treatment landscape — patients may benefit from referral.

Source citations:
- For PubMed articles: cite with [n] referencing the numbered studies provided.
- For ESMO guideline data (if provided below): cite as "ESMO CPG" with the guideline title, and include Level of Evidence (LOE), Grade of Recommendation (GOR), and ESMO-MCBS score when available.
- For EMA authorisation data (if provided below): cite as "EMA EPAR" when referencing EU marketing authorisation status or approved indications.
- For INFARMED reimbursement data (if provided below): cite as "INFARMED" when referencing Portuguese reimbursement or availability. If a drug has PAP (Programa de Acesso Precoce) status, cite as "INFARMED PAP" and explain that the drug is accessible in Portuguese SNS hospitals via the early access program, even if full reimbursement is not yet finalized.
- For clinical trials recruiting in Portugal (if provided below): mention relevant trials by NCT ID, phase, and Portuguese sites. Frame them as actionable options: "There is a Phase III trial (NCTxxxxxxxx) currently recruiting in [city] that may be relevant for this patient." Do not cite trials as evidence — they are access opportunities, not results.
- For GRADE certainty assessment (if provided below): integrate the certainty level (high/moderate/low/very low) into your evidence quality discussion.

Premise challenges: If a "PREMISE CHALLENGES" section is provided below, the question's assumptions conflict with verified regulatory data (e.g., the question asks about second-line use but the drug is approved first-line). You MUST address the discrepancy proactively in your answer — do not simply accept the question's framing. State the correct regulatory status clearly and early in your response, then address the clinical question.

Formatting:
- Use **bold** to highlight clinically important terms: drug names, trial names, key outcomes (HR, pCR, OS, PFS with numbers), and decision-relevant conclusions. Aim for **6 to 10 bolds** per answer — enough to let the reader scan the key points at a glance.
- No bullet points or section headers. Prose only.${isHeadToHeadQuestion ? '\n- You MAY include one compact markdown table if comparing two or more agents head-to-head clarifies the data. Place it after a paragraph of prose context, not as the opener.' : '\n- No tables.'}

Quality rules (follow these to avoid needing a revision pass):
- ALWAYS cite specific articles with [n] when making factual claims.
- ALWAYS use specific numbers (HR, CI, p-value, response rates) when available in the abstracts — do not generalize.
- NEVER leave unfinished clauses or placeholder text.
- If evidence is limited, say so plainly rather than padding.

Use only evidence from the provided sources and do not invent data. When evidence is thin or mixed, say so plainly and explain what can and cannot be concluded. For follow-up questions, focus on what is new or different — do not repeat prior text.

After your clinical answer, on a new line write exactly this (replace the placeholders with 3 short follow-up questions in the SAME language as your answer — if Portuguese, use European Portuguese pt-PT):
FOLLOW_UPS: <question 1> | <question 2> | <question 3>

IMPORTANT: This information is for educational purposes only. Clinical decisions should be made by qualified professionals.`;

      // ── Select the appropriate prompt ───────────────────────────────────
      const systemPrompt = quickStudyOnly
        ? quickStudyPrompt
        : (isSupportiveCare ? supportiveCarePrompt : treatmentEfficacyPrompt);

      const premiseChallengeBlock = this.detectPremiseChallenges(question, options);

      const userMessage = `Current clinical question: ${question}
${options.originalQuestion && options.originalQuestion !== question ? `Original user wording: ${options.originalQuestion}` : ''}
${clinicalContextBlock ? `\nStructured clinical context:\n${clinicalContextBlock}` : ''}
${previousAssistantReply ? `\nPrevious assistant answer (for continuity only, avoid repetition):\n${previousAssistantReply}` : ''}
Response depth requested: ${quickStudyOnly ? 'executive quick review' : 'detailed synthesis'}
Quick stats available if useful:
- readiness score: ${quickStats.readinessScore}
- grade: ${quickStats.grade}
- year range: ${quickStats.yearRange || 'available years'}
- recent studies (<=5y): ${quickStats.recentCount}
- RCTs: ${quickStats.rctCount}
- median N: ${quickStats.medianSampleSize || '—'}
${placeboComparatorRequested ? '- Comparator requested: placebo. Only placebo-controlled studies count as direct comparative evidence; non-placebo or uncontrolled studies must be labeled indirect/supportive.\n' : ''}${comparativeTable ? `Deterministic comparative values for grounding only. Do not render them as a table or list:\n${comparativeTable}\n` : ''}
${articlesContext}
${options.unifiedRegulatoryContext ? `\n\n${options.unifiedRegulatoryContext}` : `${options.reimbursementContext ? `\n\n${options.reimbursementContext}` : ''}${options.emaContext ? `\n\n${options.emaContext}` : ''}${options.esmoContext ? `\n\n${options.esmoContext}` : ''}`}${options.trialContext ? `\n\n${options.trialContext}` : ''}${options.gradeContext ? `\n\n${options.gradeContext}` : ''}${premiseChallengeBlock}`;

      return { systemPrompt, userMessage };
  }

  /**
   * Generate AI response based on question and PubMed articles
   */
  async generateResponse(question, articles = [], evidenceSummaries = [], options = {}) {
    try {
      if (!this.openai) {
        throw new Error('Bedrock client not initialized');
      }

      const responseLanguage = options.responseLanguage || this.resolveResponseLanguage(question, options);
      const detailLevel = String(options.detailLevel || 'detailed').toLowerCase();
      const quickStudyOnly = options.quickStudyOnly === true || detailLevel === 'executive';

      const { systemPrompt, userMessage } = this.buildGenerateResponsePrompts(question, articles, evidenceSummaries, options);
      // Legacy path kept for non-streaming callers — uses the extracted prompts
      // Prompt building is now in buildGenerateResponsePrompts; use the extracted prompts
      const quickStats = options.quickStats || this.computeQuickReviewStats(articles);

      const completion = await this.openai.chat.completions.create({
        model: config.openai?.model || 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        max_tokens: config.openai?.maxTokens || 2000,
        temperature: config.openai?.temperature ?? 0.3,
      });

      const rawFull = completion.choices[0]?.message?.content || 'Sorry, I could not generate a response.';

      // Parse and strip follow-up questions embedded by the model
      let rawAnswer = rawFull;
      let inlineFollowUps = [];
      const followUpMatch = rawFull.match(/\nFOLLOW_UPS:\s*(.+)$/m);
      if (followUpMatch) {
        rawAnswer = rawFull.slice(0, followUpMatch.index).trim();
        inlineFollowUps = followUpMatch[1].split('|').map(q => q.trim()).filter(q => q.length > 5).slice(0, 3);
      }

      let answer = quickStudyOnly
        ? await this.enforceQuickReviewWithoutMissing(
          rawAnswer,
          question,
          articles,
          quickStats,
          { responseLanguage }
        )
        : this.cleanMissingPlaceholders(rawAnswer);

      if (!quickStudyOnly && articles.length > 0) {
        const claimAudit = this.validateNumericClaims(answer, articles, evidenceSummaries);
        const hasUnsupportedClaims = (claimAudit?.unsupportedClaims?.length || 0) > 0;
        const hasUncitedClaims = (claimAudit?.uncitedClaims?.length || 0) > 1;
        if (hasUnsupportedClaims || hasUncitedClaims) {
          answer = await this.repairUnsupportedNumericClaims(
            answer,
            question,
            articles,
            evidenceSummaries,
            claimAudit,
            { responseLanguage }
          );
        }
      }

      const references = this.buildResponseReferences(articles);

      return {
        answer,
        references,
        followUpQuestions: inlineFollowUps
      };

    } catch (error) {
      logger.error(`Error generating response: ${error.message}`);
      throw error;
    }
  }

  /**
   * Main method: search PubMed and generate AI response
   */
  async processQuestion(question, options = {}) {
    try {
      logger.info(`Processing question: ${question.substring(0, 100)}...`);
      logger.info(`Simple chat architecture: ${this.architectureVersion}`);

      // ── Classify clinical question type ─────────────────────────────────
      const questionClassification = this.questionClassifier.classify(question, options);
      const questionType = questionClassification.type;
      logger.info(`Question classification: ${questionType} (confidence: ${questionClassification.confidence}, signals: ${questionClassification.signals.join(', ') || 'none'})`);

      const conversationHistory = this.normalizeConversationHistory(
        options.conversationHistory || options.history || []
      );
      const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
      if (onProgress) onProgress({ stage: 'searching', message: 'Searching PubMed literature...' });

      const responseLanguage = this.resolveResponseLanguage(question, options);

      // ── Parallel rewrite + PubMed pre-search ──────────────────────────
      // Start LLM rewrite AND initial PubMed search concurrently.
      // The pre-search uses the original question; if the rewrite produces
      // a different question, additional queries run after it resolves.
      const rewritePromise = this.rewriteStandaloneQuestion(question, conversationHistory, options);
      const preSearchOpts = { ...options, questionType };
      const preSearchQueries = this.buildSearchQueriesSync(question, question, preSearchOpts);
      const candidateLimit = Math.max(this.maxEvidenceArticles * 4, 20);
      const preSearchPromise = this.evidenceSelectionService.collectArticlesFromQueries(
        preSearchQueries, preSearchOpts, [], candidateLimit
      ).catch(() => []);

      let standaloneQuestion = await rewritePromise;

      // If rewrite was skipped for a Portuguese question, build an English query from extracted terms
      if (standaloneQuestion === question && responseLanguage === 'pt') {
        const { extractClinicalTerms } = await import('./clinicalTermExtractor.js');
        const terms = extractClinicalTerms({
          question,
          population: options.population,
          intervention: options.intervention,
          biomarker: options.biomarker,
          lineOfTherapy: options.lineOfTherapy
        });
        const englishParts = [terms.substance, terms.cancerType, terms.biomarker, terms.lineOfTherapy, terms.stage].filter(Boolean);
        if (englishParts.length >= 2) {
          standaloneQuestion = englishParts.join(' ');
          logger.info(`[FastRewrite] Local PT→EN: "${standaloneQuestion}"`);
        }
      }

      // Merge pre-search results with any additional rewrite-specific queries
      let preSearchArticles = await preSearchPromise;
      if (standaloneQuestion !== question) {
        const rewriteQueries = this.buildSearchQueriesSync(question, standaloneQuestion, preSearchOpts);
        const newQueries = rewriteQueries.filter(q =>
          !preSearchQueries.some(pq => pq.toLowerCase() === q.toLowerCase())
        );
        if (newQueries.length > 0) {
          const extraArticles = await this.evidenceSelectionService.collectArticlesFromQueries(
            newQueries, preSearchOpts, [], candidateLimit
          ).catch(() => []);
          preSearchArticles = this.mergeArticles(preSearchArticles, extraArticles);
        }
      }

      const requirePlaceboComparator = this.isPlaceboComparatorRequested(
        `${question || ''} ${standaloneQuestion || ''}`,
        options
      );

      // Organize evidence (rank, enrich, extract summaries) from pre-fetched articles
      const organization = await this.evidenceSelectionService.organizeEvidenceContext(
        preSearchArticles,
        standaloneQuestion,
        { ...options, questionType, requirePlaceboComparator },
        this.maxEvidenceArticles
      );

      const selection = {
        articles: preSearchArticles,
        queriesUsed: preSearchQueries,
        ...organization,
        selectionTrace: this.evidenceSelectionService.buildSelectionTrace({
          retrievedCount: preSearchArticles.length,
          rankedCount: organization.rankedArticles.length,
          focusedCount: organization.focusedArticles.length,
          contextCount: organization.contextArticles.length,
          evidenceSummaryCount: organization.evidenceSummaries.length,
          endpointSignalCount: organization.endpointSignalCount,
          comparatorFilteredCount: organization.comparatorFilteredCount,
          comparatorFilterApplied: organization.comparatorFilterApplied,
          usedFallbackQueries: false,
          queriesUsed: preSearchQueries,
          rankedDiagnostics: organization.rankedDiagnostics,
          selectedContextDiagnostics: organization.selectedContextDiagnostics
        })
      };
      const {
        articles,
        rankedArticles,
        focusedArticles,
        queriesUsed,
        selectionTrace
      } = selection;
      let {
        contextArticles,
        evidenceSummaries,
        quickStats
      } = selection;

      const preparedEvidence = this.trimEvidenceForDetailedAnswer(
        contextArticles,
        evidenceSummaries,
        standaloneQuestion,
        {
          ...options,
          requirePlaceboComparator,
          responseLanguage
        }
      );
      contextArticles = preparedEvidence.articles;
      evidenceSummaries = preparedEvidence.evidenceSummaries;
      quickStats = options.quickStats || this.computeQuickReviewStats(contextArticles);
      const detailLevel = String(options.detailLevel || 'detailed').toLowerCase();
      const quickStudyOnly = options.quickStudyOnly === true || detailLevel === 'executive';
      const evidenceAdequacy = this.buildEvidenceSuitabilityAssessment(
        standaloneQuestion,
        contextArticles,
        evidenceSummaries,
        quickStats,
        {
          ...options,
          questionType,
          requirePlaceboComparator,
          responseLanguage
        }
      );
      const warnings = this.buildEvidenceWarnings(evidenceAdequacy, responseLanguage);

      if (onProgress) onProgress({ stage: 'analyzing', message: `Analyzing ${articles.length} articles...` });
      logger.info(`Found ${articles.length} articles from PubMed`);
      if (focusedArticles.length !== rankedArticles.length) {
        logger.info(`Focused filtering retained ${focusedArticles.length}/${rankedArticles.length} articles`);
      }

      if (standaloneQuestion !== question) {
        logger.info(`Resolved standalone question: ${standaloneQuestion}`);
      }

      if (queriesUsed.length > 1) {
        logger.info(`Search variants used: ${queriesUsed.join(' | ')}`);
      }

      const enrichedSignals = selectionTrace?.counts?.endpointSignals || 0;
      logger.info(`Context studies with endpoint signals: ${enrichedSignals}/${contextArticles.length}`);
      logger.info(`Evidence adequacy: ${evidenceAdequacy.status} (${(evidenceAdequacy.reasons || []).join(' | ') || 'no major issues'})`);
      if (Array.isArray(selectionTrace?.selectedContext) && selectionTrace.selectedContext.length > 0) {
        const selectedStudyLog = selectionTrace.selectedContext
          .map(item => `${item?.pmid || 'n/a'}:${item?.evidenceTier || 'unknown'}:${Array.isArray(item?.rationale) ? item.rationale.slice(0, 2).join('; ') : 'no rationale'}`)
          .join(' | ');
        logger.info(`Selected evidence context: ${selectedStudyLog}`);
      }

      // If reimbursement/regulatory data is available, override the abstain decision.
      // The user asked about drug access/reimbursement — we can answer from INFARMED data
      // even without strong PubMed literature. Downgrade to borderline instead.
      const hasUnifiedContext = !!(options.unifiedRegulatoryContext && options.unifiedRegulatoryContext.length > 50);
      const hasReimbursementContext = !!(options.reimbursementContext && options.reimbursementContext.length > 50);
      const hasEmaContext = !!(options.emaContext && options.emaContext.length > 50);
      const hasEsmoContext = !!(options.esmoContext && options.esmoContext.length > 50);
      const hasRegulatoryContext = hasUnifiedContext || hasReimbursementContext || hasEmaContext || hasEsmoContext;
      if (evidenceAdequacy.abstain && hasRegulatoryContext) {
        const sources = [hasReimbursementContext && 'INFARMED', hasEmaContext && 'EMA', hasEsmoContext && 'ESMO'].filter(Boolean).join(', ');
        logger.info(`Overriding abstain: regulatory context available (${sources}), downgrading to borderline`);
        evidenceAdequacy.abstain = false;
        evidenceAdequacy.status = 'borderline';
        evidenceAdequacy.reasons = [...(evidenceAdequacy.reasons || []), `${sources} data supplements limited PubMed evidence`];
      }

      if (evidenceAdequacy.abstain) {
        const answer = this.buildInsufficientEvidenceAnswer(
          standaloneQuestion,
          contextArticles,
          evidenceSummaries,
          evidenceAdequacy,
          {
            ...options,
            requirePlaceboComparator,
            responseLanguage
          }
        );
        return {
          success: true,
          answer,
          references: this.buildResponseReferences(contextArticles),
          warnings,
          evidenceAdequacy,
          articlesFound: articles.length,
          metadata: {
            originalQuestion: question,
            standaloneQuestion,
            searchQueriesUsed: queriesUsed,
            responseLanguage,
            contextArticles: contextArticles.length,
            quickStats,
            evidenceSelection: selectionTrace,
            evidenceAdequacy,
            architecture: this.getArchitectureMetadata()
          }
        };
      }

      // Generate AI response based on ranked articles + evidence summaries
      // GRADE certainty assessment — before synthesis, so the rating is an input
      // to the answer rather than a post-hoc annotation on it.
      if (onProgress) onProgress({ stage: 'grading', message: 'Assessing certainty of evidence (GRADE)...' });
      const gradeAssessment = await this.runGradeAssessment(
        standaloneQuestion, contextArticles, evidenceSummaries, options
      );

      if (onProgress) onProgress({ stage: 'generating', message: 'Generating clinical synthesis...' });
      logger.info('Generating AI response...');
      let response = await this.generateResponse(
        standaloneQuestion,
        contextArticles,
        evidenceSummaries,
        {
          ...options,
          questionType,
          requirePlaceboComparator,
          conversationHistory,
          originalQuestion: question,
          standaloneQuestion,
          responseLanguage,
          quickStats,
          gradeContext: gradeAssessment?.contextSummary || ''
        }
      );
      // Deterministic quality guardrails only — no LLM refinement pass.
      // The main prompt now includes quality rules inline, so the first generation
      // should be high quality. Only the deterministic enforceDetailedAnswerQuality
      // and single claim repair pass remain.
      if (!quickStudyOnly && contextArticles.length > 0) {
        response.answer = this.enforceDetailedAnswerQuality(
          response.answer,
          standaloneQuestion,
          contextArticles,
          evidenceSummaries,
          quickStats,
          {
            ...options,
            requirePlaceboComparator,
            responseLanguage
          }
        );
      }

      return {
        success: true,
        answer: response.answer,
        references: response.references,
        warnings,
        evidenceAdequacy,
        gradeAssessment: gradeAssessment || null,
        followUpQuestions: Array.isArray(response.followUpQuestions) ? response.followUpQuestions : [],
        articlesFound: articles.length,
        metadata: {
          originalQuestion: question,
          standaloneQuestion,
          searchQueriesUsed: queriesUsed,
          responseLanguage,
          questionType,
          questionClassification,
          contextArticles: contextArticles.length,
          quickStats,
          evidenceSelection: selectionTrace,
          evidenceAdequacy,
          gradeAvailable: !!gradeAssessment,
          gradeCertainty: gradeAssessment?.certainty_of_evidence || null,
          architecture: this.getArchitectureMetadata()
        }
      };

    } catch (error) {
      logger.error(`Error processing question: ${error.message}`);
      return {
        success: false,
        answer: `Erro ao processar a pergunta: ${error.message}`,
        references: [],
        articlesFound: 0
      };
    }
  }

  /**
   * Refine a draft response using quality feedback and evidence summaries
   */
  async refineResponse(question, draftAnswer, articles, evidenceSummaries, qualityReport, options = {}) {
    try {
      const responseLanguage = options.responseLanguage || 'en';
      const detailLevel = String(options.detailLevel || 'detailed').toLowerCase();
      const quickStudyOnly = options.quickStudyOnly === true || detailLevel === 'executive';
      const languageInstruction = {
        pt: 'Write the improved answer in European Portuguese (Portugal, pt-PT). Use Portuguese spelling — NOT Brazilian Portuguese.',
        en: 'Write the improved answer in English.',
        bilingual: 'Write in European Portuguese (Portugal, pt-PT — NOT Brazilian Portuguese) and include a concise "English summary" section.',
        auto: 'Write the improved answer in the SAME language as the original. If Portuguese, use European Portuguese (pt-PT — NOT Brazilian).'
      }[responseLanguage] || 'Write in the SAME language as the user question. If Portuguese, use European Portuguese (pt-PT).';
      const placeboComparatorRequested = this.isPlaceboComparatorRequested(question, options);

      const issues = [];
      if (qualityReport?.criticalIssues?.length) {
        for (const issue of qualityReport.criticalIssues) {
          issues.push(`- ${issue.message}`);
        }
      }
      if (qualityReport?.suggestions?.length) {
        for (const suggestion of qualityReport.suggestions) {
          issues.push(`- ${suggestion.suggestion}`);
        }
      }

      const evidenceContext = articles.map((article, index) => {
        const summary = (evidenceSummaries || []).find(s => s.index === index + 1);
        return {
          index: index + 1,
          title: article.title,
          journal: article.journal,
          year: article.year,
          pmid: article.pmid,
          studyDesign: article.studyDesign,
          summary
        };
      });
      const comparativeTable = quickStudyOnly
        ? ''
        : this.buildComparativeStudyTable(articles, evidenceSummaries, responseLanguage, {
          ...options,
          question
        });

      const outputRules = quickStudyOnly
        ? `Return only one section titled "## Quick Study Review". Write in flowing prose — no bullets, tables, or lists. Use **bold** for trial names and key outcomes (2–4 bolds).`
        : `Write 2–5 paragraphs of flowing prose. Open with the clinical bottom line. Weave evidence into the narrative — do not enumerate endpoints or reproduce the structured fields. Use **bold** for the most clinically important terms: drug names, trial names, critical numbers, key conclusions (3–6 bolds, sparingly).`;

      const prompt = `You are a senior oncologist refining a draft answer for the user.
${quickStudyOnly
    ? 'Goal: produce a concise Quick Study Review in flowing prose.'
    : 'Goal: make the answer read like a thoughtful clinician explaining the evidence, not a systematic reviewer presenting it.'}
${languageInstruction}

Question: ${question}

Issues to address:
${issues.length > 0 ? issues.join('\n') : '- Improve clinical narrative flow and clarity.'}

RAW EVIDENCE REFERENCE (structured format for your use only — transform into prose, do not reproduce these fields or endpoint lists):
${evidenceContext.map(item => {
        const s = item.summary || {};
        return `\n[${item.index}] ${item.title} (${item.journal || 'available source'}, ${item.year || 'available source'}) PMID:${item.pmid}
Study design: ${this.sanitizeEvidenceField(s.study_design || item.studyDesign || '') || '—'}
Population: ${this.sanitizeEvidenceField(s.population || '') || '—'}
Intervention: ${this.inferInterventionLabel(item, s) || '—'}
Comparator: ${this.inferComparatorLabel(item, s) || '—'}
Key findings: ${this.sanitizeEvidenceField(s.key_findings || '') || '—'}
Limitations: ${this.sanitizeEvidenceField(s.limitations || '') || '—'}`;
      }).join('\n')}
${comparativeTable ? `\nComparative values for grounding (do not reproduce as a list or table):\n${comparativeTable}\n` : ''}

Draft answer:
${draftAnswer}

Rewrite requirements:
${outputRules}
- Ground key claims with [n] citations.
- Omit data points that are unavailable rather than flagging them.
- Remove unfinished clauses and dangling statements.
- If evidence is limited or mixed, say so plainly and summarize what can be concluded.
- ${languageInstruction}
${placeboComparatorRequested ? '- Placebo comparator was requested: distinguish direct placebo-controlled evidence from indirect/supportive studies.\n' : ''}

Return only the rewritten answer.`;

      // Large prompt (evidence context + full draft) — route to Bedrock to avoid Groq rate limits
      const response = await this.openai.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: config.openai?.maxTokens || 2000,
        temperature: 0.2
      });

      const improved = response.choices[0]?.message?.content || null;
      if (!improved) return null;
      const cleaned = this.cleanMissingPlaceholders(improved);
      return cleaned;
    } catch (error) {
      logger.warn(`Response refinement failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Generate 2-3 follow-up questions based on the answer and question context.
   */
  async generateFollowUpQuestions(question, answer, responseLanguage = 'en') {
    try {
      const lang = responseLanguage === 'pt' ? 'European Portuguese (Portugal, pt-PT)'
        : responseLanguage === 'auto' ? 'the same language as the question (if Portuguese, use European Portuguese pt-PT)'
        : 'English';
      const prompt = `You are a senior oncologist. Based on this clinical question and answer, suggest exactly 3 natural follow-up questions a clinician might ask next.

Question: ${question.slice(0, 500)}
Answer excerpt: ${answer.slice(0, 800)}

Return ONLY a JSON array of 3 short question strings (no explanations, no markdown, no numbering). Write questions in ${lang}. Example format: ["Question 1?", "Question 2?", "Question 3?"]`;

      const completion = await this.fastModel.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.4
      });

      const raw = completion.choices[0]?.message?.content || '[]';
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) return [];
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed.slice(0, 3).filter(q => typeof q === 'string' && q.length > 5) : [];
    } catch (err) {
      logger.warn(`Follow-up question generation failed: ${err.message}`);
      return [];
    }
  }

  /**
   * SSE streaming version of processQuestion.
   * Runs the full evidence-gathering pipeline, then streams the LLM response
   * token-by-token via Bedrock ConverseStream, so the user sees the first token
   * within seconds. Post-generation quality checks run after the stream completes
   * and, if they change the answer, a 'revision' event is sent.
   */
  async processQuestionStream(question, options = {}, sendEvent) {
    try {
      const onProgress = (event) => sendEvent({ type: 'progress', ...event });
      onProgress({ stage: 'searching', message: 'Searching PubMed literature...' });

      // ── Classify clinical question type ─────────────────────────────────
      const questionClassification = this.questionClassifier.classify(question, options);
      const questionType = questionClassification.type;
      logger.info(`[Stream] Question classification: ${questionType} (confidence: ${questionClassification.confidence}, signals: ${questionClassification.signals.join(', ') || 'none'})`);

      // ── Phase 1: Evidence gathering (same as processQuestion) ───────────
      const conversationHistory = this.normalizeConversationHistory(
        options.conversationHistory || options.history || []
      );
      const responseLanguage = this.resolveResponseLanguage(question, options);

      // ── Parallel rewrite + PubMed pre-search (streaming path) ─────────
      // Both run simultaneously — rewrite (Groq ~200ms) and PubMed (~2-5s).
      const rewritePromise = this.rewriteStandaloneQuestion(question, conversationHistory, options);
      const preSearchOpts = { ...options, questionType };
      const candidateLimit = Math.max(this.maxEvidenceArticles * 4, 20);

      // Check if this is a comparison question — if so, use separate per-entity searches
      const comparisonStrategy = this.buildComparisonSearchStrategy(question, question, preSearchOpts);
      let preSearchQueries;
      let preSearchPromise;

      if (comparisonStrategy) {
        // ── Comparison-aware search: separate parallel searches per entity ──
        preSearchQueries = [
          ...comparisonStrategy.entity1Queries,
          ...comparisonStrategy.entity2Queries,
          ...comparisonStrategy.sharedQueries
        ];
        preSearchPromise = this.evidenceSelectionService.collectComparisonArticles(
          comparisonStrategy.entity1Queries,
          comparisonStrategy.entity2Queries,
          comparisonStrategy.sharedQueries,
          preSearchOpts,
          candidateLimit
        ).then(result => {
          logger.info(`[ComparisonSearch] Results — E1: ${result.entity1Count}, E2: ${result.entity2Count}, Shared: ${result.sharedCount}`);
          return result.articles;
        }).catch(() => []);
      } else {
        // ── Standard search: combined OR strategy ──
        preSearchQueries = this.buildSearchQueriesSync(question, question, preSearchOpts);
        preSearchPromise = this.evidenceSelectionService.collectArticlesFromQueries(
          preSearchQueries, preSearchOpts, [], candidateLimit
        ).catch(() => []);
      }

      let standaloneQuestion = await rewritePromise;

      // If rewrite was skipped for a Portuguese question, build an English query from extracted terms
      if (standaloneQuestion === question && responseLanguage === 'pt') {
        const { extractClinicalTerms } = await import('./clinicalTermExtractor.js');
        const terms = extractClinicalTerms({
          question,
          population: options.population,
          intervention: options.intervention,
          biomarker: options.biomarker,
          lineOfTherapy: options.lineOfTherapy
        });
        const englishParts = [terms.substance, terms.cancerType, terms.biomarker, terms.lineOfTherapy, terms.stage].filter(Boolean);
        if (englishParts.length >= 2) {
          standaloneQuestion = englishParts.join(' ');
          logger.info(`[FastRewrite] Local PT→EN: "${standaloneQuestion}"`);
        }
      }

      let preSearchArticles = await preSearchPromise;

      // For comparison questions, also run rewrite-based queries if standalone differs
      // For standard questions, merge additional queries from rewrite
      if (standaloneQuestion !== question) {
        if (comparisonStrategy) {
          // Re-run comparison strategy with the rewritten question for better queries
          const rewriteComparison = this.buildComparisonSearchStrategy(question, standaloneQuestion, preSearchOpts);
          if (rewriteComparison) {
            const allNewQueries = [
              ...rewriteComparison.entity1Queries,
              ...rewriteComparison.entity2Queries,
              ...rewriteComparison.sharedQueries
            ].filter(q => !preSearchQueries.some(pq => pq.toLowerCase() === q.toLowerCase()));
            if (allNewQueries.length > 0) {
              const extraResult = await this.evidenceSelectionService.collectComparisonArticles(
                rewriteComparison.entity1Queries.filter(q => !preSearchQueries.some(pq => pq.toLowerCase() === q.toLowerCase())),
                rewriteComparison.entity2Queries.filter(q => !preSearchQueries.some(pq => pq.toLowerCase() === q.toLowerCase())),
                rewriteComparison.sharedQueries.filter(q => !preSearchQueries.some(pq => pq.toLowerCase() === q.toLowerCase())),
                preSearchOpts,
                candidateLimit
              ).catch(() => ({ articles: [] }));
              preSearchArticles = this.mergeArticles(preSearchArticles, extraResult.articles || extraResult);
            }
          }
        } else {
          const rewriteQueries = this.buildSearchQueriesSync(question, standaloneQuestion, preSearchOpts);
          const newQueries = rewriteQueries.filter(q =>
            !preSearchQueries.some(pq => pq.toLowerCase() === q.toLowerCase())
          );
          if (newQueries.length > 0) {
            const extraArticles = await this.evidenceSelectionService.collectArticlesFromQueries(
              newQueries, preSearchOpts, [], candidateLimit
            ).catch(() => []);
            preSearchArticles = this.mergeArticles(preSearchArticles, extraArticles);
          }
        }
      }

      // ── Comparison fallback: if either entity has <3 articles, broaden with class search ──
      if (comparisonStrategy) {
        const activeComparison = comparisonStrategy.comparison;
        const class1 = this.lookupDrugClass(activeComparison.entity1);
        const class2 = this.lookupDrugClass(activeComparison.entity2);

        // Quick check: count articles mentioning each entity in title/abstract
        const countEntityArticles = (articles, entity) => {
          const drugInfo = this.lookupDrugClass(entity);
          const terms = [entity.toLowerCase()];
          if (drugInfo) {
            terms.push(drugInfo.drug.toLowerCase());
            terms.push(...drugInfo.aliases.map(a => a.toLowerCase()));
          }
          return articles.filter(a => {
            const text = `${a.title || ''} ${a.abstract || ''}`.toLowerCase();
            return terms.some(t => text.includes(t));
          }).length;
        };

        const e1Count = countEntityArticles(preSearchArticles, activeComparison.entity1);
        const e2Count = countEntityArticles(preSearchArticles, activeComparison.entity2);
        logger.info(`[ComparisonCoverage] ${activeComparison.entity1}: ${e1Count} articles | ${activeComparison.entity2}: ${e2Count} articles`);

        const MIN_COVERAGE = 3;
        const fallbackSearches = [];

        if (e1Count < MIN_COVERAGE && class1) {
          const classQuery = this.sanitizePubMedQuery(
            `${class1.class} ${activeComparison.populationHint || ''} ${class1.mesh ? `OR ${class1.mesh}[MeSH Terms]` : ''}`
          );
          if (classQuery) {
            logger.info(`[ComparisonFallback] Entity1 "${activeComparison.entity1}" has only ${e1Count} articles — broadening to class "${class1.class}"`);
            fallbackSearches.push(
              this.evidenceSelectionService._runEntitySearch([classQuery], preSearchOpts, 8).catch(() => [])
            );
          }
        }
        if (e2Count < MIN_COVERAGE && class2) {
          const classQuery = this.sanitizePubMedQuery(
            `${class2.class} ${activeComparison.populationHint || ''} ${class2.mesh ? `OR ${class2.mesh}[MeSH Terms]` : ''}`
          );
          if (classQuery) {
            logger.info(`[ComparisonFallback] Entity2 "${activeComparison.entity2}" has only ${e2Count} articles — broadening to class "${class2.class}"`);
            fallbackSearches.push(
              this.evidenceSelectionService._runEntitySearch([classQuery], preSearchOpts, 8).catch(() => [])
            );
          }
        }

        if (fallbackSearches.length > 0) {
          const fallbackResults = await Promise.all(fallbackSearches);
          for (const extra of fallbackResults) {
            preSearchArticles = this.mergeArticles(preSearchArticles, extra);
          }
          logger.info(`[ComparisonFallback] After fallback: ${preSearchArticles.length} total articles`);
        }
      }

      const requirePlaceboComparator = this.isPlaceboComparatorRequested(
        `${question || ''} ${standaloneQuestion || ''}`,
        options
      );

      // Organize evidence from pre-fetched articles
      const organization = await this.evidenceSelectionService.organizeEvidenceContext(
        preSearchArticles,
        standaloneQuestion,
        { ...options, questionType, requirePlaceboComparator },
        this.maxEvidenceArticles
      );

      const selection = {
        articles: preSearchArticles,
        queriesUsed: preSearchQueries,
        ...organization,
        selectionTrace: this.evidenceSelectionService.buildSelectionTrace({
          retrievedCount: preSearchArticles.length,
          rankedCount: organization.rankedArticles.length,
          focusedCount: organization.focusedArticles.length,
          contextCount: organization.contextArticles.length,
          evidenceSummaryCount: organization.evidenceSummaries.length,
          endpointSignalCount: organization.endpointSignalCount,
          comparatorFilteredCount: organization.comparatorFilteredCount,
          comparatorFilterApplied: organization.comparatorFilterApplied,
          usedFallbackQueries: false,
          queriesUsed: preSearchQueries,
          rankedDiagnostics: organization.rankedDiagnostics,
          selectedContextDiagnostics: organization.selectedContextDiagnostics
        })
      };

      const { articles, rankedArticles, focusedArticles, queriesUsed, selectionTrace } = selection;
      let { contextArticles, evidenceSummaries, quickStats } = selection;

      const preparedEvidence = this.trimEvidenceForDetailedAnswer(
        contextArticles, evidenceSummaries, standaloneQuestion,
        { ...options, questionType, requirePlaceboComparator, responseLanguage }
      );
      contextArticles = preparedEvidence.articles;
      evidenceSummaries = preparedEvidence.evidenceSummaries;
      quickStats = options.quickStats || this.computeQuickReviewStats(contextArticles);

      const detailLevel = String(options.detailLevel || 'detailed').toLowerCase();
      const quickStudyOnly = options.quickStudyOnly === true || detailLevel === 'executive';
      const evidenceAdequacy = this.buildEvidenceSuitabilityAssessment(
        standaloneQuestion, contextArticles, evidenceSummaries, quickStats,
        { ...options, questionType, requirePlaceboComparator, responseLanguage }
      );
      const warnings = this.buildEvidenceWarnings(evidenceAdequacy, responseLanguage);

      // Log evidence results (streaming path)
      logger.info(`[Stream] Found ${articles.length} articles, ${contextArticles.length} context articles`);
      logger.info(`[Stream] Evidence adequacy: ${evidenceAdequacy.status} (${(evidenceAdequacy.reasons || []).join(' | ')})`);
      if (standaloneQuestion !== question) {
        logger.info(`[Stream] Standalone question: ${standaloneQuestion}`);
      }

      // Override abstain if regulatory context available
      const hasUnifiedContext = !!(options.unifiedRegulatoryContext && options.unifiedRegulatoryContext.length > 50);
      const hasReimbursementContext = !!(options.reimbursementContext && options.reimbursementContext.length > 50);
      const hasEmaContext = !!(options.emaContext && options.emaContext.length > 50);
      const hasEsmoContext = !!(options.esmoContext && options.esmoContext.length > 50);
      const hasRegulatoryContext = hasUnifiedContext || hasReimbursementContext || hasEmaContext || hasEsmoContext;
      if (evidenceAdequacy.abstain && hasRegulatoryContext) {
        const sources = [hasReimbursementContext && 'INFARMED', hasEmaContext && 'EMA', hasEsmoContext && 'ESMO'].filter(Boolean).join(', ');
        evidenceAdequacy.abstain = false;
        evidenceAdequacy.status = 'borderline';
        evidenceAdequacy.reasons = [...(evidenceAdequacy.reasons || []), `${sources} data supplements limited PubMed evidence`];
      }

      if (evidenceAdequacy.abstain) {
        const answer = this.buildInsufficientEvidenceAnswer(
          standaloneQuestion, contextArticles, evidenceSummaries, evidenceAdequacy,
          { ...options, requirePlaceboComparator, responseLanguage }
        );
        // Send insufficient-evidence answer as chunks
        const words = answer.match(/\S+\s*/g) || [answer];
        for (const word of words) sendEvent({ type: 'chunk', text: word });
        sendEvent({
          type: 'done',
          references: this.buildResponseReferences(contextArticles),
          warnings,
          evidenceAdequacy,
          articlesFound: articles.length,
          followUpQuestions: [],
          metadata: {
            originalQuestion: question, standaloneQuestion, searchQueriesUsed: queriesUsed,
            responseLanguage, contextArticles: contextArticles.length, quickStats,
            evidenceSelection: selectionTrace, evidenceAdequacy,
            architecture: this.getArchitectureMetadata()
          }
        });
        return;
      }

      // ── Phase 1b: GRADE certainty assessment (before synthesis) ────────
      // Runs on the assembled evidence so the certainty rating is an input to
      // the answer, not an annotation on it.
      onProgress({ stage: 'grading', message: 'Assessing certainty of evidence (GRADE)...' });
      const gradeAssessment = await this.runGradeAssessment(
        standaloneQuestion, contextArticles, evidenceSummaries, options
      );

      // ── Phase 2: Build prompts (same as generateResponse) ──────────────
      onProgress({ stage: 'generating', message: 'Generating clinical synthesis...' });

      const generateOptions = {
        ...options,
        questionType,
        requirePlaceboComparator,
        conversationHistory,
        originalQuestion: question,
        standaloneQuestion,
        responseLanguage,
        quickStats,
        gradeContext: gradeAssessment?.contextSummary || ''
      };

      const { systemPrompt, userMessage } = this.buildGenerateResponsePrompts(
        standaloneQuestion, contextArticles, evidenceSummaries, generateOptions
      );

      // ── Phase 3: Stream the LLM response token-by-token ────────────────
      let fullText = '';
      const streamStartTime = Date.now();
      let firstChunkLogged = false;
      try {
        for await (const chunk of this.openai.streamChatCompletion({
          model: config.openai?.model || 'gpt-4',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          max_tokens: config.openai?.maxTokens || 2000,
          temperature: config.openai?.temperature ?? 0.3
        })) {
          if (!firstChunkLogged) {
            logger.info(`[Stream] First token in ${Date.now() - streamStartTime}ms`);
            firstChunkLogged = true;
          }
          fullText += chunk;
          sendEvent({ type: 'chunk', text: chunk });
        }
        logger.info(`[Stream] Bedrock streaming completed in ${Date.now() - streamStartTime}ms (${fullText.length} chars)`);
      } catch (streamError) {
        logger.error(`LLM stream error: ${streamError.message}`);
        sendEvent({ type: 'error', message: `Generation failed: ${streamError.message}` });
        return;
      }

      // ── Phase 4: Post-stream processing (non-blocking for the user) ────
      // Parse follow-up questions from the streamed text
      let answer = fullText;
      let inlineFollowUps = [];
      const followUpMatch = fullText.match(/\nFOLLOW_UPS:\s*(.+)$/m);
      if (followUpMatch) {
        answer = fullText.slice(0, followUpMatch.index).trim();
        inlineFollowUps = followUpMatch[1].split('|').map(q => q.trim()).filter(q => q.length > 5).slice(0, 3);
      }

      // Apply deterministic quality guardrails
      answer = quickStudyOnly
        ? await this.enforceQuickReviewWithoutMissing(answer, standaloneQuestion, contextArticles, quickStats, { responseLanguage })
        : this.cleanMissingPlaceholders(answer);

      // Claim repair — only invoke LLM repair for significant issues (≥2 unsupported claims)
      // to avoid blocking the stream with a repair pass for minor issues
      if (!quickStudyOnly && contextArticles.length > 0) {
        const claimAudit = this.validateNumericClaims(answer, contextArticles, evidenceSummaries);
        const unsupportedCount = claimAudit?.unsupportedClaims?.length || 0;
        const uncitedCount = claimAudit?.uncitedClaims?.length || 0;
        if (unsupportedCount >= 2 || uncitedCount >= 3) {
          answer = await this.repairUnsupportedNumericClaims(
            answer, standaloneQuestion, contextArticles, evidenceSummaries, claimAudit, { responseLanguage }
          );
        }
        answer = this.enforceDetailedAnswerQuality(
          answer, standaloneQuestion, contextArticles, evidenceSummaries, quickStats,
          { ...options, requirePlaceboComparator, responseLanguage }
        );
      }

      // Always send a revision if the streamed text differs from the final answer
      // (e.g. FOLLOW_UPS: line was streamed but needs stripping, or quality checks changed text)
      if (answer !== fullText) {
        sendEvent({ type: 'revision', answer });
      }

      const references = this.buildResponseReferences(contextArticles);
      sendEvent({
        type: 'done',
        references,
        warnings,
        evidenceAdequacy,
        gradeAssessment: gradeAssessment || null,
        articlesFound: articles.length,
        followUpQuestions: inlineFollowUps,
        metadata: {
          originalQuestion: question, standaloneQuestion, searchQueriesUsed: queriesUsed,
          responseLanguage, questionType, questionClassification,
          contextArticles: contextArticles.length, quickStats,
          evidenceSelection: selectionTrace, evidenceAdequacy,
          gradeAvailable: !!gradeAssessment,
          gradeCertainty: gradeAssessment?.certainty_of_evidence || null,
          architecture: this.getArchitectureMetadata()
        }
      });


    } catch (error) {
      logger.error(`Stream processing error: ${error.message}`);
      sendEvent({ type: 'error', message: `Processing failed: ${error.message}` });
    }
  }
}

export default new SimpleChatService();
