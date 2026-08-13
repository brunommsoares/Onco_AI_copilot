import express from 'express';
import { body, validationResult } from 'express-validator';
import { logger } from '../utils/logger.js';
import { resolveSimpleChatEngine } from '../services/simpleChatEngineSelector.js';
import simpleChatService from '../services/simpleChatService.js';
import trialRegistryService, { buildTrialRegistryInput } from '../services/trialRegistryService.js';
import infarmedReimbursementService from '../services/infarmedReimbursementService.js';
import emaService from '../services/emaService.js';
import esmoGuidelinesService from '../services/esmoGuidelinesService.js';
import { extractClinicalTerms } from '../services/clinicalTermExtractor.js';
import { buildUnifiedDrugContext } from '../services/unifiedDrugContext.js';
import ClinicalQuestionClassifier from '../services/simple-chat/ClinicalQuestionClassifier.js';

const questionClassifier = new ClinicalQuestionClassifier();

const router = express.Router();

// Validation middleware
const validateQuestion = [
  body('question').trim().isLength({ min: 1, max: 2000 }).withMessage('Question must be between 1 and 2000 characters'),
  body('options').optional().isObject().withMessage('Options must be an object'),
  body('conversationHistory').optional().isArray({ max: 12 }).withMessage('Conversation history must be an array up to 12 items'),
  body('conversationHistory.*.role').optional().isIn(['user', 'assistant', 'system']).withMessage('History role must be user, assistant or system'),
  body('conversationHistory.*.content').optional().isString().trim().isLength({ min: 1, max: 2000 }).withMessage('History content must be between 1 and 2000 characters')
];

/**
 * POST /api/chat
 * Simple chat endpoint: searches PubMed and returns AI response
 */
router.post('/', validateQuestion, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { question, options = {}, conversationHistory = [] } = req.body;
    const normalizedOptions = (options && typeof options === 'object' && !Array.isArray(options))
      ? { ...options }
      : {};

    if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      normalizedOptions.conversationHistory = conversationHistory;
    }

    logger.info(`Chat request: ${question.substring(0, 100)}...`);

    const engine = resolveSimpleChatEngine(question, normalizedOptions);
    normalizedOptions.engine = normalizedOptions.engine || engine;

    // ── Classify question type early to decide which data sources to fetch ──
    const questionClassification = questionClassifier.classify(question, normalizedOptions);
    const questionType = questionClassification.type;
    normalizedOptions.questionType = questionType;
    logger.info(`[Route] Question type: ${questionType} (confidence: ${questionClassification.confidence})`);

    // Trial search is relevant for treatment efficacy AND regulatory questions
    // (regulatory questions benefit from knowing about ongoing trials).
    // Regulatory context (INFARMED/EMA) is always useful — even supportive care
    // questions benefit from knowing biosimilar availability and reimbursement.
    const needsTrialSearch = questionType === 'treatment_efficacy' || questionType === 'regulatory';
    const needsRegulatoryContext = true;

    // Extract clinical terms from the free-text question BEFORE building contextParams
    // so that INFARMED/EMA/ESMO services receive meaningful search terms even when
    // the user doesn't fill in the structured fields (population, intervention, etc.)
    const extractedTerms = extractClinicalTerms({
      question,
      substance: normalizedOptions.intervention || '',
      cancerType: normalizedOptions.population || '',
      biomarker: normalizedOptions.biomarker || '',
      lineOfTherapy: normalizedOptions.lineOfTherapy || '',
      population: normalizedOptions.population || '',
      intervention: normalizedOptions.intervention || ''
    });

    // Log extracted terms so we can diagnose data access issues
    logger.info(`[Route] Extracted terms: substance="${extractedTerms.substance}" cancer="${extractedTerms.cancerType}" biomarker="${extractedTerms.biomarker}" line="${extractedTerms.lineOfTherapy}" stage="${extractedTerms.stage}"`);

    // Fetch all local context data in parallel (SQLite, sub-ms each)
    const contextParams = {
      question,
      substance: normalizedOptions.intervention || extractedTerms.substance || '',
      cancerType: normalizedOptions.population || extractedTerms.cancerType || '',
      biomarker: normalizedOptions.biomarker || extractedTerms.biomarker || '',
      lineOfTherapy: normalizedOptions.lineOfTherapy || extractedTerms.lineOfTherapy || '',
      population: normalizedOptions.population || extractedTerms.cancerType || '',
      intervention: normalizedOptions.intervention || extractedTerms.substance || ''
    };

    // Fetch local data sources in parallel — only what's relevant for this question type
    const contextFetches = [
      needsRegulatoryContext
        ? infarmedReimbursementService.findReimbursementData(contextParams)
        : Promise.resolve({ available: false, drugs: [], indications: [], contextSummary: '' }),
      needsRegulatoryContext
        ? emaService.findEmaData(contextParams)
        : Promise.resolve({ available: false, products: [], indications: [], contextSummary: '' }),
      esmoGuidelinesService.findRecommendations(contextParams),
      needsTrialSearch
        ? trialRegistryService.findMatches(buildTrialRegistryInput(question, normalizedOptions))
        : Promise.resolve({ available: false, trials: [], conditions: [], weeklyTable: [], meta: { location: 'Portugal' } })
    ];

    const [reimbursementResult, emaResult, esmoResult, trialRegistryResult] = await Promise.allSettled(contextFetches);

    const reimbursement = reimbursementResult.status === 'fulfilled'
      ? reimbursementResult.value
      : { available: false, drugs: [], indications: [], contextSummary: '' };
    const ema = emaResult.status === 'fulfilled'
      ? emaResult.value
      : { available: false, products: [], indications: [], contextSummary: '' };
    const esmoGuidelines = esmoResult.status === 'fulfilled'
      ? esmoResult.value
      : { available: false, recommendations: [], contextSummary: '' };
    const trialRegistry = trialRegistryResult.status === 'fulfilled'
      ? trialRegistryResult.value
      : { available: false, trials: [], conditions: [], weeklyTable: [], meta: { location: 'Portugal' } };

    // Log data source results for diagnostics
    logger.info(`[Route] Data sources: INFARMED=${reimbursement.available ? `${(reimbursement.drugs || []).length} drugs` : reimbursement.reason || 'unavailable'}, EMA=${ema.available ? `${(ema.products || []).length} products` : ema.reason || 'unavailable'}, ESMO=${esmoGuidelines.available ? `${(esmoGuidelines.recommendations || []).length} recs` : esmoGuidelines.reason || 'unavailable'}, Trials=${trialRegistry.available ? `${(trialRegistry.trials || []).length} trials` : 'unavailable'}`);

    // Use pre-extracted clinical terms for unified context building
    const searchTerms = extractedTerms;

    // Filter trials to high/moderate relevance (top 8)
    const topTrials = (trialRegistry.trials || [])
      .filter((t) => t.llmRelevance === 'high' || t.llmRelevance === 'moderate' || (t.matchScore && parseFloat(t.matchScore) >= 1.5))
      .slice(0, 8);

    // Build unified cross-referenced drug context (replaces separate blobs)
    const { unifiedContext, trialContext } = buildUnifiedDrugContext({
      reimbursement,
      ema,
      esmo: esmoGuidelines,
      trials: topTrials,
      searchTerms
    });

    // Inject unified context into options (replaces separate contexts)
    normalizedOptions.unifiedRegulatoryContext = unifiedContext;
    normalizedOptions.trialContext = trialContext;
    // Keep individual contexts as fallback for premise challenge detection
    if (reimbursement.contextSummary) normalizedOptions.reimbursementContext = reimbursement.contextSummary;
    if (ema.contextSummary) normalizedOptions.emaContext = ema.contextSummary;
    if (esmoGuidelines.contextSummary) normalizedOptions.esmoContext = esmoGuidelines.contextSummary;

    const chatResult = await simpleChatService.processQuestion(question, normalizedOptions);

    const result = chatResult;

    // GRADE assessment is produced inside simpleChatService BEFORE synthesis
    // (see runGradeAssessment), so that the certainty rating is injected into
    // the synthesis prompt rather than appended afterwards. The route only
    // surfaces the result.
    const gradeAssessment = result.gradeAssessment || { available: false, certainty_of_evidence: null };

    if (result.success) {
      // Build combined references: PubMed articles + institutional sources
      const allReferences = [...(result.references || [])];

      // Add EMA as a source reference
      if (ema.available && ema.products?.length) {
        allReferences.push({
          id: 'ema_epar',
          source: 'EMA',
          type: 'regulatory',
          title: 'European Medicines Agency — European Public Assessment Reports (EPAR)',
          url: 'https://www.ema.europa.eu/en/medicines',
          description: `${ema.products.length} EMA-authorised product(s) matched`,
          products: ema.products.map(p => `${p.activeSubstance} (${p.medicineName}) — ${p.authorizationStatus}`).slice(0, 5)
        });
      }

      // Add guideline documents as source references, attributed to the body
      // that actually issued them (the corpus contains both ESMO and NCCN PDFs)
      if (esmoGuidelines.available && esmoGuidelines.recommendations?.length) {
        const guidelineTitles = [...new Set(esmoGuidelines.recommendations.map(r => r.guidelineTitle).filter(Boolean))];
        for (const title of guidelineTitles.slice(0, 5)) {
          const recs = esmoGuidelines.recommendations.filter(r => r.guidelineTitle === title);
          const publisher = recs.find(r => r.publisher)?.publisher || '';
          const label = publisher === 'NCCN'
            ? `NCCN Clinical Practice Guidelines — ${title}`
            : publisher === 'ESMO'
              ? `ESMO Clinical Practice Guidelines — ${title}`
              : `Clinical practice guideline — ${title}`;
          allReferences.push({
            id: `guideline_${title.replace(/\s+/g, '_').slice(0, 30).toLowerCase()}`,
            source: publisher || 'Guideline',
            type: 'guideline',
            title: label,
            url: publisher === 'NCCN'
              ? 'https://www.nccn.org/guidelines'
              : publisher === 'ESMO' ? 'https://www.esmo.org/guidelines' : '',
            description: `${recs.length} recommendation(s)`,
            recommendations: recs.map(r => {
              const parts = [r.drug, r.cancerType, r.biomarker, r.lineOfTherapy].filter(Boolean).join(' | ');
              const scores = [r.levelOfEvidence && `LOE ${r.levelOfEvidence}`, r.gradeOfRecommendation && `GOR ${r.gradeOfRecommendation}`, r.esmoMcbsScore && `MCBS ${r.esmoMcbsScore}`].filter(Boolean).join(', ');
              return `${parts}${scores ? ` [${scores}]` : ''}`;
            }).slice(0, 10)
          });
        }
      }

      // Add GRADE as a source reference
      if (gradeAssessment.available && gradeAssessment.certainty_of_evidence) {
        allReferences.push({
          id: 'grade_assessment',
          source: 'GRADE',
          type: 'methodology',
          title: `GRADE Certainty of Evidence: ${(gradeAssessment.certainty_of_evidence || '').replace('_', ' ').toUpperCase()}`,
          url: 'https://www.gradeworkinggroup.org',
          description: gradeAssessment.summary || '',
          certainty: gradeAssessment.certainty_of_evidence,
          direction: gradeAssessment.direction_of_effect
        });
      }

      // Add INFARMED as a source reference
      if (reimbursement.available && reimbursement.drugs?.length) {
        allReferences.push({
          id: 'infarmed',
          source: 'INFARMED',
          type: 'reimbursement',
          title: 'INFARMED — Portuguese National Authority of Medicines and Health Products',
          url: 'https://www.infarmed.pt',
          description: `${reimbursement.drugs.length} drug(s) with Portuguese reimbursement data`,
          drugs: reimbursement.drugs.map(d => `${d.activeSubstance} — ${d.reimbursementType || 'unknown'}`).slice(0, 5)
        });
      }

      res.json({
        success: true,
        answer: result.answer,
        references: allReferences,
        warnings: Array.isArray(result.warnings) ? result.warnings : [],
        evidenceAdequacy: result.evidenceAdequacy || null,
        followUpQuestions: Array.isArray(result.followUpQuestions) ? result.followUpQuestions : [],
        articlesFound: result.articlesFound,
        metadata: {
          ...(result.metadata || {}),
          engine,
          trialRegistryAvailable: trialRegistry.available === true,
          trialRegistryTrialsFound: Array.isArray(trialRegistry.trials) ? trialRegistry.trials.length : 0,
          reimbursementAvailable: reimbursement.available === true,
          reimbursementDrugsFound: Array.isArray(reimbursement.drugs) ? reimbursement.drugs.length : 0,
          emaAvailable: ema.available === true,
          emaProductsFound: Array.isArray(ema.products) ? ema.products.length : 0,
          esmoGuidelinesAvailable: esmoGuidelines.available === true,
          esmoRecommendationsFound: Array.isArray(esmoGuidelines.recommendations) ? esmoGuidelines.recommendations.length : 0,
          gradeAvailable: gradeAssessment.available === true,
          gradeCertainty: gradeAssessment.certainty_of_evidence || null
        },
        trialRegistry,
        reimbursement,
        ema,
        esmoGuidelines,
        gradeAssessment,
        structured: {
          readiness: result.evidenceAdequacy || null,
          trialRegistry,
          reimbursement,
          ema,
          esmoGuidelines,
          gradeAssessment
        }
      });

    } else {
      res.status(500).json({
        success: false,
        error: result.answer,
        references: []
      });
    }

  } catch (error) {
    logger.error(`Chat error: ${error.message}`);
    next(error);
  }
});

/**
 * POST /api/simple-chat/stream
 * SSE streaming chat endpoint: sends progress events then streams the answer
 */
router.post('/stream', validateQuestion, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
    }

    const { question, options = {}, conversationHistory = [] } = req.body;
    const normalizedOptions = (options && typeof options === 'object' && !Array.isArray(options))
      ? { ...options }
      : {};
    if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      normalizedOptions.conversationHistory = conversationHistory;
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const engine = resolveSimpleChatEngine(question, normalizedOptions);
    normalizedOptions.engine = normalizedOptions.engine || engine;

    // ── Classify question type early to decide which data sources to fetch ──
    const streamClassification = questionClassifier.classify(question, normalizedOptions);
    const streamQuestionType = streamClassification.type;
    normalizedOptions.questionType = streamQuestionType;
    logger.info(`[Stream Route] Question type: ${streamQuestionType} (confidence: ${streamClassification.confidence})`);

    const needsTrialSearch = streamQuestionType === 'treatment_efficacy' || streamQuestionType === 'regulatory';
    const needsRegulatoryContext = true;

    // Extract clinical terms from the free-text question BEFORE building contextParams
    const streamExtractedTerms = extractClinicalTerms({
      question,
      substance: normalizedOptions.intervention || '',
      cancerType: normalizedOptions.population || '',
      biomarker: normalizedOptions.biomarker || '',
      lineOfTherapy: normalizedOptions.lineOfTherapy || '',
      population: normalizedOptions.population || '',
      intervention: normalizedOptions.intervention || ''
    });

    // Fetch all local context data in parallel (SQLite, sub-ms each)
    const streamContextParams = {
      question,
      substance: normalizedOptions.intervention || streamExtractedTerms.substance || '',
      cancerType: normalizedOptions.population || streamExtractedTerms.cancerType || '',
      biomarker: normalizedOptions.biomarker || streamExtractedTerms.biomarker || '',
      lineOfTherapy: normalizedOptions.lineOfTherapy || streamExtractedTerms.lineOfTherapy || '',
      population: normalizedOptions.population || streamExtractedTerms.cancerType || '',
      intervention: normalizedOptions.intervention || streamExtractedTerms.substance || ''
    };

    // Send early progress so the user sees activity immediately
    const sendEarlyEvent = (data) => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    sendEarlyEvent({ type: 'progress', stage: 'searching', message: 'Searching clinical databases...' });

    // ── Fetch fast context (SQLite, <100ms) WITHOUT waiting for trial match ──
    const fastContextFetches = [
      needsRegulatoryContext
        ? infarmedReimbursementService.findReimbursementData(streamContextParams)
        : Promise.resolve({ available: false, drugs: [], indications: [], contextSummary: '' }),
      needsRegulatoryContext
        ? emaService.findEmaData(streamContextParams)
        : Promise.resolve({ available: false, products: [], indications: [], contextSummary: '' }),
      esmoGuidelinesService.findRecommendations(streamContextParams)
    ];

    // Trial match runs in background — does NOT block the Bedrock stream
    const trialMatchPromise = needsTrialSearch
      ? trialRegistryService.findMatches(buildTrialRegistryInput(question, normalizedOptions))
          .catch((err) => {
            logger.warn(`[Stream Route] Trial match failed: ${err.message}`);
            return { available: false, trials: [], conditions: [], weeklyTable: [], meta: { location: 'Portugal' } };
          })
      : Promise.resolve({ available: false, trials: [], conditions: [], weeklyTable: [], meta: { location: 'Portugal' } });

    const [reimbursementResult, emaResult, esmoResult] = await Promise.allSettled(fastContextFetches);

    const reimbursement = reimbursementResult.status === 'fulfilled'
      ? reimbursementResult.value
      : { available: false, drugs: [], indications: [], contextSummary: '' };
    const ema = emaResult.status === 'fulfilled'
      ? emaResult.value
      : { available: false, products: [], indications: [], contextSummary: '' };
    const esmoGuidelines = esmoResult.status === 'fulfilled'
      ? esmoResult.value
      : { available: false, recommendations: [], contextSummary: '' };

    sendEarlyEvent({ type: 'progress', stage: 'analyzing', message: 'Analyzing regulatory & guideline data...' });

    // Build unified context with regulatory data only (no trials yet)
    const streamSearchTerms = streamExtractedTerms;
    const { unifiedContext, trialContext } = buildUnifiedDrugContext({
      reimbursement,
      ema,
      esmo: esmoGuidelines,
      trials: [],
      searchTerms: streamSearchTerms
    });

    normalizedOptions.unifiedRegulatoryContext = unifiedContext;
    normalizedOptions.trialContext = trialContext;
    if (reimbursement.contextSummary) normalizedOptions.reimbursementContext = reimbursement.contextSummary;
    if (ema.contextSummary) normalizedOptions.emaContext = ema.contextSummary;
    if (esmoGuidelines.contextSummary) normalizedOptions.esmoContext = esmoGuidelines.contextSummary;

    const sendEvent = (data) => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Send regulatory data immediately (before LLM starts)
    sendEarlyEvent({ type: 'reimbursement', reimbursement });
    sendEarlyEvent({ type: 'ema', ema });
    sendEarlyEvent({ type: 'esmoGuidelines', esmoGuidelines });

    sendEarlyEvent({ type: 'progress', stage: 'generating', message: 'Synthesizing evidence...' });

    // Start Bedrock streaming immediately — trial match resolves in background
    const STREAM_TIMEOUT_MS = 120_000; // 2 minutes max for the entire stream
    const TRIAL_TIMEOUT_MS = 30_000;   // 30s max for trial matching

    const streamPromise = simpleChatService.processQuestionStream(question, normalizedOptions, sendEvent);

    // Send trial results as soon as they arrive (may be during or after streaming)
    const trialWithTimeout = Promise.race([
      trialMatchPromise,
      new Promise((resolve) => setTimeout(() => resolve({ available: false, trials: [], conditions: [], weeklyTable: [], error: 'Trial match timeout' }), TRIAL_TIMEOUT_MS))
    ]);

    trialWithTimeout.then((trialRegistry) => {
      if (res.writableEnded) return;
      sendEvent({ type: 'trialRegistry', trialRegistry: trialRegistry || { available: false, trials: [], conditions: [], weeklyTable: [] } });
    });

    // Race the stream against the timeout
    await Promise.race([
      streamPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Stream timeout')), STREAM_TIMEOUT_MS))
    ]);

    // Wait for trial results (with its own timeout) before closing
    await trialWithTimeout;

    res.end();
  } catch (error) {
    logger.error(`Stream chat error: ${error.message}`);
    if (!res.headersSent) {
      next(error);
    } else {
      try {
        res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
        res.end();
      } catch {}
    }
  }
});

/**
 * GET /api/chat/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'simple-chat',
    timestamp: new Date().toISOString(),
    architecture: simpleChatService.getArchitectureMetadata()
  });
});

export default router;
