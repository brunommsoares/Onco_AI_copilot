import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { openai as defaultOpenAI } from '../config/openai.js';
import { parseBoolean } from '../config/runtimeEnv.js';
import { logger as defaultLogger } from '../utils/logger.js';
import { createEsmoGuidelinesStore } from '../../esmoGuidelinesStore.js';
import EsmoExtractionAgent from './simple-chat/EsmoExtractionAgent.js';
import { PDFProcessingService } from './pdfProcessingService.js';

// ---------------------------------------------------------------------------
// ESMO Guidelines Service
//
// Orchestrates:
//   1. PDF upload and text extraction
//   2. LLM-based recommendation extraction via EsmoExtractionAgent
//   3. Structured recommendation storage and query
//
// No cron schedule — triggered by user PDF uploads.
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXTRACTION_MODEL =
  process.env.BEDROCK_ESMO_MODEL_ID ||
  process.env.BEDROCK_INFARMED_MODEL_ID ||
  process.env.BEDROCK_FALLBACK_MODEL_ID ||
  'us.anthropic.claude-haiku-4-5-20251001-v1:0';

const DEFAULT_CHUNK_SIZE = 2000;
const DEFAULT_CHUNK_OVERLAP = 200;

class EsmoGuidelinesService {
  constructor({ openai, logger, storeOptions } = {}) {
    this._openai = openai || defaultOpenAI;
    this._logger = logger || defaultLogger;
    this._store = null;
    this._ready = false;
    this._storeOptions = storeOptions || {};
    this._extractionAgent = null;
    this._uploadDir = process.env.ESMO_UPLOAD_DIR || path.resolve(__dirname, '..', '..', 'data', 'esmo_pdfs');
  }

  get settings() {
    return {
      enabled: parseBoolean(process.env.ENABLE_ESMO_GUIDELINES, true),
      store: process.env.ESMO_STORE || 'sqlite',
      sqlitePath: process.env.ESMO_SQLITE_PATH || './data/esmo_guidelines.sqlite',
      filePath: process.env.ESMO_FILE_PATH || './data/esmo_guidelines_snapshot.json',
      llmModel: EXTRACTION_MODEL,
      uploadDir: this._uploadDir
    };
  }

  // ---- lifecycle -----------------------------------------------------------

  async start() {
    if (!this.settings.enabled) {
      this._logger.info('[ESMO] Service disabled via ENABLE_ESMO_GUIDELINES');
      return;
    }

    this._logger.info('[ESMO] Starting ESMO guidelines service...');

    this._store = createEsmoGuidelinesStore(
      {
        store: this.settings.store,
        sqlitePath: this.settings.sqlitePath,
        filePath: this.settings.filePath
      },
      this._logger
    );

    this._extractionAgent = new EsmoExtractionAgent({
      openai: this._openai,
      logger: this._logger,
      model: this.settings.llmModel
    });

    // Ensure upload directory exists
    await fs.mkdir(this._uploadDir, { recursive: true });

    this._ready = true;
    this._logger.info('[ESMO] Service started');
  }

  stop() {
    if (this._store?.close) {
      this._store.close();
    }
    this._ready = false;
    this._logger.info('[ESMO] Service stopped');
  }

  // ---- PDF processing ------------------------------------------------------

  /**
   * Process an uploaded ESMO guideline PDF.
   * 1. Extract text from PDF
   * 2. Chunk text for LLM processing
   * 3. Extract structured recommendations via EsmoExtractionAgent
   * 4. Store in SQLite
   */
  async processGuidelinePdf(filePath, metadata = {}) {
    if (!this._ready || !this._store) {
      throw new Error('ESMO Guidelines service not ready');
    }

    const startTime = Date.now();
    const pdfBuffer = await fs.readFile(filePath);

    // Generate guideline ID from file hash
    const pdfHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex').slice(0, 16);
    const guidelineId = metadata.id || `esmo-${pdfHash}`;

    this._logger.info(`[ESMO] Processing guideline: ${metadata.title || filePath} (hash: ${pdfHash})`);

    // Save guideline record as "processing"
    const guideline = {
      id: guidelineId,
      title: metadata.title || path.basename(filePath, path.extname(filePath)),
      cancerType: metadata.cancerType || '',
      version: metadata.version || '',
      uploadDate: new Date().toISOString(),
      pdfHash,
      filePath,
      status: 'processing',
      totalRecommendations: 0
    };
    await this._store.writeGuideline(guideline);

    try {
      // Step 1: Extract text from PDF or PPTX
      const ext = path.extname(filePath).toLowerCase();
      let fullText = '';

      if (ext === '.pptx' || ext === '.ppt') {
        // PPTX: use officeparser for text extraction
        const officeparser = await import('officeparser');
        fullText = await officeparser.parseOffice(filePath);
        this._logger.info(`[ESMO] Extracted ${fullText.length} chars from PPTX`);
      } else {
        // PDF: use pdf-parse
        const { createRequire } = await import('module');
        const require = createRequire(import.meta.url);
        const pdfParse = require('pdf-parse');
        const pdfData = await pdfParse(pdfBuffer);
        fullText = pdfData.text || '';
        this._logger.info(`[ESMO] Extracted ${fullText.length} chars from ${pdfData.numpages} pages`);
      }

      // Fallback: try OCR for image-based PDFs
      if (!fullText.trim() && (ext === '.pdf')) {
        this._logger.info('[ESMO] No text extracted via pdf-parse, attempting OCR fallback...');
        try {
          const pdfService = new PDFProcessingService();
          const ocrResult = await pdfService.extractTextWithOcr(filePath, {
            maxPages: 50,
            language: 'eng+por'
          });
          fullText = ocrResult.text || '';
          if (fullText.trim()) {
            this._logger.info(`[ESMO] OCR extracted ${fullText.length} chars (${ocrResult.pagesProcessed} pages, engine: ${ocrResult.engine})`);
          }
        } catch (ocrErr) {
          this._logger.warn(`[ESMO] OCR fallback failed: ${ocrErr.message}`);
        }
      }

      if (!fullText.trim()) {
        throw new Error('No text extracted — file may be image-based or empty');
      }

      // Step 1c: Detect publisher. The corpus contains both ESMO and NCCN PDFs;
      // recommendations must be attributed to the body that actually issued them.
      guideline.publisher = this._detectPublisher(fullText, guideline.title);
      await this._store.writeGuideline(guideline);
      this._logger.info(`[ESMO] Publisher detected: ${guideline.publisher || 'unknown'}`);

      // Step 2: Chunk text
      const chunks = this._chunkText(fullText, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP);
      this._logger.info(`[ESMO] Split into ${chunks.length} chunks`);

      // Step 3: Extract recommendations via LLM agent
      const recommendations = await this._extractionAgent.extractRecommendations(chunks, {
        guidelineId,
        title: guideline.title,
        cancerType: guideline.cancerType
      });

      // Step 4: Store recommendations
      if (recommendations.length) {
        this._logger.info(`[ESMO] Writing ${recommendations.length} recommendations to store...`);
        try {
          await this._store.writeRecommendations(recommendations);
          this._logger.info(`[ESMO] Successfully wrote ${recommendations.length} recommendations`);
        } catch (writeErr) {
          this._logger.error(`[ESMO] Failed to write recommendations: ${writeErr.message}`);
          // Try writing one by one to find the bad record
          let written = 0;
          for (const rec of recommendations) {
            try {
              await this._store.writeRecommendations([rec]);
              written++;
            } catch (singleErr) {
              this._logger.warn(`[ESMO] Failed to write rec ${rec.id}: ${singleErr.message} — data: ${JSON.stringify(rec).slice(0, 200)}`);
            }
          }
          this._logger.info(`[ESMO] Recovered ${written}/${recommendations.length} recommendations via individual writes`);
        }
      }

      // Update guideline status (use UPDATE, not INSERT OR REPLACE, to avoid
      // cascading DELETE on recommendations via foreign key)
      guideline.status = 'completed';
      guideline.totalRecommendations = recommendations.length;
      await this._store.updateGuidelineStatus(guideline.id, 'completed', recommendations.length);

      const durationMs = Date.now() - startTime;
      await this._store.writeSyncRun({
        startedAt: guideline.uploadDate,
        completedAt: new Date().toISOString(),
        status: 'completed',
        guidelineId,
        totalRecommendations: recommendations.length,
        durationMs,
        error: ''
      });

      this._logger.info(
        `[ESMO] Processing complete: ${recommendations.length} recommendations in ${durationMs}ms`
      );

      return {
        success: true,
        guidelineId,
        title: guideline.title,
        totalRecommendations: recommendations.length,
        durationMs
      };
    } catch (err) {
      guideline.status = 'failed';
      await this._store.writeGuideline(guideline);

      await this._store.writeSyncRun({
        startedAt: guideline.uploadDate,
        completedAt: new Date().toISOString(),
        status: 'failed',
        guidelineId,
        totalRecommendations: 0,
        durationMs: Date.now() - startTime,
        error: err.message
      });

      this._logger.error(`[ESMO] Processing failed: ${err.message}`);
      throw err;
    }
  }

  // ---- query interface -----------------------------------------------------

  /**
   * Find ESMO guideline recommendations relevant to a clinical question.
   * Called from simpleChat in parallel with other data sources.
   */
  async findRecommendations({
    question = '',
    substance = '',
    cancerType = '',
    biomarker = '',
    lineOfTherapy = '',
    population = '',
    intervention = ''
  } = {}) {
    if (!this._ready || !this._store) {
      return { available: false, reason: 'service_not_ready', recommendations: [] };
    }

    try {
      const searchTerms = {
        drug: substance || intervention || '',
        cancerType: cancerType || population || '',
        biomarker: biomarker || '',
        lineOfTherapy: lineOfTherapy || ''
      };

      // Extract terms from question if not provided
      if (!searchTerms.drug && !searchTerms.cancerType && question) {
        const q = question.toLowerCase();

        // Simple cancer type detection
        const cancerPatterns = [
          [/\b(?:non[- ]?small[- ]?cell|nsclc)\b/i, 'non-small cell lung cancer'],
          [/\bbreast\s*cancer\b/i, 'breast cancer'],
          [/\b(?:colorectal|crc|colon)\b/i, 'colorectal cancer'],
          [/\bmelanoma\b/i, 'melanoma'],
          [/\b(?:gastric|stomach)\s*cancer\b/i, 'gastric cancer'],
          [/\b(?:ovarian)\s*cancer\b/i, 'ovarian cancer'],
          [/\b(?:prostate)\s*cancer\b/i, 'prostate cancer']
        ];
        for (const [pattern, type] of cancerPatterns) {
          if (pattern.test(question)) {
            searchTerms.cancerType = type;
            break;
          }
        }
      }

      const recommendations = await this._store.searchRecommendations(searchTerms);

      const contextSummary = this._buildContextSummary(recommendations, searchTerms);

      return {
        available: true,
        recommendations: recommendations.map((rec) => ({
          drug: rec.drug || '',
          cancerType: rec.cancer_type || rec.cancerType || '',
          cancerSubtype: rec.cancer_subtype || rec.cancerSubtype || '',
          biomarker: rec.biomarker || '',
          lineOfTherapy: rec.line_of_therapy || rec.lineOfTherapy || '',
          stage: rec.stage || '',
          esmoMcbsScore: rec.esmo_mcbs_score || rec.esmoMcbsScore || '',
          escatScore: rec.escat_score || rec.escatScore || '',
          levelOfEvidence: rec.level_of_evidence || rec.levelOfEvidence || '',
          gradeOfRecommendation: rec.grade_of_recommendation || rec.gradeOfRecommendation || '',
          recommendationText: rec.recommendation_text || rec.recommendationText || '',
          guidelineTitle: rec.guideline_title || rec.guidelineTitle || '',
          guidelineVersion: rec.guideline_version || rec.guidelineVersion || '',
          publisher: this._publisherFromRow(rec),
          confidence: rec.confidence || ''
        })),
        contextSummary,
        meta: {
          searchTerms,
          recommendationsFound: recommendations.length,
          dataSource: 'esmo_guidelines'
        }
      };
    } catch (err) {
      this._logger.error(`[ESMO] Query failed: ${err.message}`);
      return { available: false, reason: err.message, recommendations: [] };
    }
  }

  /**
   * Builds a plain-text context summary for injection into the chat system prompt.
   */
  _buildContextSummary(recommendations, searchTerms) {
    if (!recommendations.length) {
      return '';
    }

    const lines = ['=== CLINICAL PRACTICE GUIDELINE RECOMMENDATIONS (extracted from the locally indexed guideline corpus: ESMO and NCCN documents) ==='];
    lines.push(`Query: drug="${searchTerms.drug}" cancer="${searchTerms.cancerType}" biomarker="${searchTerms.biomarker}" line="${searchTerms.lineOfTherapy}"`);
    lines.push('');

    for (const rec of recommendations.slice(0, 15)) {
      const drug = rec.drug || '';
      const cancer = rec.cancer_type || rec.cancerType || '';
      const bio = rec.biomarker || '';
      const line = rec.line_of_therapy || rec.lineOfTherapy || '';
      const stage = rec.stage || '';
      const mcbs = rec.esmo_mcbs_score || rec.esmoMcbsScore || '';
      const escat = rec.escat_score || rec.escatScore || '';
      const loe = rec.level_of_evidence || rec.levelOfEvidence || '';
      const gor = rec.grade_of_recommendation || rec.gradeOfRecommendation || '';
      const text = rec.recommendation_text || rec.recommendationText || '';
      const guidelineTitle = rec.guideline_title || rec.guidelineTitle || '';

      lines.push(`RECOMMENDATION: ${drug} for ${cancer}`);
      if (bio) lines.push(`  Biomarker: ${bio}`);
      if (line) lines.push(`  Line: ${line}`);
      if (stage) lines.push(`  Stage: ${stage}`);
      if (mcbs) lines.push(`  ESMO-MCBS: ${mcbs}`);
      if (escat) lines.push(`  ESCAT: ${escat}`);
      if (loe) lines.push(`  Level of Evidence: ${loe}`);
      if (gor) lines.push(`  Grade of Recommendation: ${gor}`);
      if (text) lines.push(`  "${text}"`);
      const publisher = this._publisherFromRow(rec);
      if (guidelineTitle) lines.push(`  Source: ${publisher ? `${publisher} — ` : ''}${guidelineTitle}`);
      lines.push('');
    }

    lines.push('IMPORTANT: Cite these guideline recommendations when relevant, attributing each to the issuing body shown in its Source line (ESMO or NCCN) — never attribute an NCCN recommendation to ESMO or vice versa. Include LOE, GOR, and ESMO-MCBS scores where present.');

    return lines.join('\n');
  }

  // ---- helpers -------------------------------------------------------------

  /**
   * Identify the guideline's issuing body from the document text.
   * Phrase matches are checked before bare acronyms because an ESMO guideline
   * can cite NCCN in passing (and vice versa).
   */
  _detectPublisher(text = '', title = '') {
    const head = `${title}\n${String(text).slice(0, 8000)}`;
    if (/national comprehensive cancer network|NCCN (?:clinical practice )?guidelines/i.test(head)) return 'NCCN';
    if (/european society for medical oncology|ESMO (?:clinical practice|living) guideline/i.test(head)) return 'ESMO';
    if (/\bNCCN\b/.test(head)) return 'NCCN';
    if (/\bESMO\b/.test(head)) return 'ESMO';
    return '';
  }

  /**
   * Publisher for a store row, read from the guideline's payload JSON
   * (populated at ingest by _detectPublisher, or by scripts/fixGuidelinePublishers.mjs
   * for guidelines ingested before publisher detection existed).
   */
  _publisherFromRow(rec) {
    if (rec.publisher) return rec.publisher;
    const raw = rec.guideline_payload || rec.guidelinePayload;
    if (!raw) return '';
    try {
      return JSON.parse(raw).publisher || '';
    } catch {
      return '';
    }
  }

  _chunkText(text, chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP) {
    const words = text.split(/\s+/);
    const chunks = [];

    for (let i = 0; i < words.length; i += chunkSize - overlap) {
      const chunk = words.slice(i, i + chunkSize).join(' ');
      if (chunk.trim()) chunks.push(chunk);
      if (i + chunkSize >= words.length) break;
    }

    return chunks;
  }

  // ---- status --------------------------------------------------------------

  async getStatus() {
    if (!this._store) {
      return {
        available: false,
        ready: this._ready,
        guidelineCount: 0,
        recommendationCount: 0
      };
    }

    const [guidelineCount, recommendationCount, lastSync] = await Promise.all([
      this._store.getGuidelineCount(),
      this._store.getRecommendationCount(),
      this._store.getLastSyncRun()
    ]);

    return {
      available: true,
      ready: this._ready,
      storeType: this._store.type,
      guidelineCount,
      recommendationCount,
      guidelines: await this._store.getGuidelines(),
      lastSync: lastSync || null,
      settings: {
        llmModel: this.settings.llmModel,
        uploadDir: this.settings.uploadDir
      }
    };
  }

  async deleteGuideline(id) {
    if (!this._store) throw new Error('Service not ready');
    await this._store.deleteGuideline(id);
  }
}

// Singleton export
const esmoGuidelinesService = new EsmoGuidelinesService();
export default esmoGuidelinesService;
export { EsmoGuidelinesService };
