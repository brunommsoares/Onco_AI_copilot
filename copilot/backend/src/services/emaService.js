import cron from 'node-cron';
import crypto from 'crypto';

import { openai as defaultOpenAI } from '../config/openai.js';
import { parseBoolean, parseInteger } from '../config/runtimeEnv.js';
import { logger as defaultLogger } from '../utils/logger.js';
import { createEmaStore } from '../../emaStore.js';
import { runEmaSync, normalizeSubstance } from '../../emaScraper.js';
import { extractClinicalTerms } from './clinicalTermExtractor.js';

// ---------------------------------------------------------------------------
// EMA Service
//
// Orchestrates:
//   1. Periodic sync of EMA marketing authorisation data (EPAR dataset)
//   2. LLM-based indication extraction & structuring (dedicated model)
//   3. Clinical query matching (product lookup by cancer type, biomarker, line)
//
// Follows the same pattern as InfarmedReimbursementService.
// ---------------------------------------------------------------------------

const DEFAULT_SCHEDULE = '0 5 * * 3'; // Weekly Wednesday 5am
const DEFAULT_TIMEZONE = 'Europe/Lisbon';
const STALE_HOURS = 168; // 7 days

const INDICATION_EXTRACTION_MODEL =
  process.env.BEDROCK_EMA_MODEL_ID ||
  process.env.BEDROCK_INFARMED_MODEL_ID ||
  process.env.BEDROCK_FALLBACK_MODEL_ID ||
  'us.anthropic.claude-haiku-4-5-20251001-v1:0';

// System prompt for the dedicated indication-extraction LLM
const EMA_INDICATION_EXTRACTION_PROMPT = `You are a clinical pharmacology expert specialising in oncology drug indications and European regulatory affairs. Your task is to extract structured oncology indication data from EMA marketing authorisation information.

For each product, extract ALL oncology indications into a structured format. Each indication MUST include:

1. product_id: The exact "id" field from the input product object (copy it verbatim)
2. active_substance: The active substance name (e.g., "nivolumab", "pembrolizumab")
3. cancer_type: The primary cancer type (e.g., "non-small cell lung cancer", "breast cancer", "colorectal cancer")
4. cancer_subtype: Histological or molecular subtype if specified (e.g., "squamous", "adenocarcinoma", "triple-negative")
5. biomarker: Required biomarker if any (e.g., "PD-L1 TPS ≥50%", "EGFR mutation", "HER2-positive", "MSI-H/dMMR", "BRCA1/2 mutation")
6. line_of_therapy: Line of therapy (e.g., "1L", "2L", "2L+", "adjuvant", "neoadjuvant", "maintenance", "any line")
7. stage: Disease stage (e.g., "metastatic", "locally advanced", "unresectable", "early stage", "resectable")
8. combination: Whether used as monotherapy or in combination, and with what
9. approval_date: If discernible from the text
10. confidence: Your confidence in this extraction — "high" (explicit in source data), "medium" (inferred from context), "low" (best guess)

Respond in JSON format only. Output an array of indication objects.

Important rules:
- Use standardised cancer type names (English, lowercase)
- Use standardised biomarker notation
- If the raw text mentions multiple indications, create separate objects for each
- If line of therapy is not specified, use "any line" or infer from context
- This is EMA (EU) marketing authorisation data — focus on EU-approved indications
- Include ESMO-MCBS score if known from your training data`;

class EmaService {
  constructor({ openai, logger, storeOptions } = {}) {
    this._openai = openai || defaultOpenAI;
    this._logger = logger || defaultLogger;
    this._store = null;
    this._scheduler = null;
    this._ready = false;
    this._initialising = null;
    this._storeOptions = storeOptions || {};
  }

  // ---- configuration -------------------------------------------------------

  get settings() {
    return {
      enabled: parseBoolean(process.env.ENABLE_EMA, true),
      syncOnBoot: parseBoolean(process.env.EMA_SYNC_ON_BOOT, true),
      schedule: process.env.EMA_SYNC_SCHEDULE || DEFAULT_SCHEDULE,
      timezone: process.env.EMA_SYNC_TIMEZONE || DEFAULT_TIMEZONE,
      staleHours: parseInteger(process.env.EMA_STALE_HOURS, STALE_HOURS),
      store: process.env.EMA_STORE || 'sqlite',
      sqlitePath: process.env.EMA_SQLITE_PATH || './data/ema_products.sqlite',
      filePath: process.env.EMA_FILE_PATH || './data/ema_products_snapshot.json',
      llmExtractionEnabled: parseBoolean(process.env.EMA_LLM_EXTRACTION, true),
      llmModel: INDICATION_EXTRACTION_MODEL
    };
  }

  // ---- lifecycle -----------------------------------------------------------

  async start() {
    const { enabled, syncOnBoot, schedule, timezone } = this.settings;

    if (!enabled) {
      this._logger.info('[EMA] Service disabled via ENABLE_EMA');
      return;
    }

    this._logger.info('[EMA] Starting EMA service...');

    // Initialise store
    this._store = createEmaStore(
      {
        store: this.settings.store,
        sqlitePath: this.settings.sqlitePath,
        filePath: this.settings.filePath
      },
      this._logger
    );

    // Schedule periodic sync
    if (cron.validate(schedule)) {
      this._scheduler = cron.schedule(
        schedule,
        () => this.runSync({ reason: 'scheduled' }).catch((e) =>
          this._logger.error(`[EMA] Scheduled sync failed: ${e.message}`)
        ),
        { timezone }
      );
      this._logger.info(`[EMA] Sync scheduled: ${schedule} (${timezone})`);
    }

    // Sync on boot if stale
    if (syncOnBoot) {
      this._initialising = this._syncIfStale().catch((e) =>
        this._logger.warn(`[EMA] Boot sync skipped: ${e.message}`)
      );
    }

    this._ready = true;
  }

  stop() {
    if (this._scheduler) {
      this._scheduler.stop();
      this._scheduler = null;
    }
    if (this._store?.close) {
      this._store.close();
    }
    this._ready = false;
    this._logger.info('[EMA] Service stopped');
  }

  // ---- sync ----------------------------------------------------------------

  async _syncIfStale() {
    const lastRun = await this._store.getLastSyncRun();
    if (lastRun?.completed_at) {
      const age = Date.now() - new Date(lastRun.completed_at).getTime();
      const staleMs = this.settings.staleHours * 3600_000;
      if (age < staleMs) {
        this._logger.info(
          `[EMA] Data is fresh (${Math.round(age / 3600_000)}h old), skipping boot sync`
        );
        return;
      }
    }
    return this.runSync({ reason: 'boot_stale' });
  }

  async runSync({ reason = 'manual', force = false } = {}) {
    this._logger.info(`[EMA] Starting sync (reason: ${reason}, force: ${force})`);
    const startedAt = new Date().toISOString();

    try {
      // Phase 1: Scrape EMA data
      const { products, meta } = await runEmaSync({
        logger: this._logger
      });

      // Phase 2: LLM-based indication extraction
      let structuredIndications = [];
      if (this.settings.llmExtractionEnabled && products.length > 0) {
        structuredIndications = await this._extractIndicationsWithLLM(products);

        // Attach structured indications back to products
        const indicationsByProduct = new Map();
        for (const ind of structuredIndications) {
          if (!indicationsByProduct.has(ind.productId)) {
            indicationsByProduct.set(ind.productId, []);
          }
          indicationsByProduct.get(ind.productId).push(ind);
        }
        for (const product of products) {
          product.indicationsStructured = indicationsByProduct.get(product.id) || [];
        }
      }

      // Phase 3: Persist
      await this._store.writeProducts(products);
      if (structuredIndications.length) {
        await this._store.writeIndications(structuredIndications);
      }

      // Record sync run
      const completedAt = new Date().toISOString();
      await this._store.writeSyncRun({
        startedAt,
        completedAt,
        status: 'completed',
        totalProducts: products.length,
        sourcesSummary: meta.sources,
        durationMs: meta.durationMs,
        error: ''
      });

      this._logger.info(
        `[EMA] Sync complete: ${products.length} products, ${structuredIndications.length} structured indications`
      );

      return {
        success: true,
        totalProducts: products.length,
        totalIndications: structuredIndications.length,
        sources: meta.sources,
        durationMs: meta.durationMs
      };
    } catch (err) {
      this._logger.error(`[EMA] Sync failed: ${err.message}`);
      await this._store?.writeSyncRun?.({
        startedAt,
        completedAt: new Date().toISOString(),
        status: 'failed',
        totalProducts: 0,
        sourcesSummary: {},
        durationMs: Date.now() - new Date(startedAt).getTime(),
        error: err.message
      });
      throw err;
    }
  }

  // ---- LLM indication extraction -------------------------------------------

  async _extractIndicationsWithLLM(products) {
    const allIndications = [];
    const batchSize = 3;
    const batches = [];

    for (let i = 0; i < products.length; i += batchSize) {
      batches.push(products.slice(i, i + batchSize));
    }

    this._logger.info(
      `[EMA] Extracting indications via LLM (${products.length} products in ${batches.length} batches, model: ${this.settings.llmModel})`
    );

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];

      try {
        const productSummaries = batch.map((product) => ({
          id: product.id,
          medicineName: product.medicineName,
          activeSubstance: product.activeSubstance,
          atcCode: product.atcCode || '',
          therapeuticArea: product.therapeuticArea || '',
          conditionIndication: product.conditionIndication || '',
          authorizationStatus: product.authorizationStatus || '',
          approvalDate: product.approvalDate || '',
          orphanMedicine: product.orphanMedicine || false
        }));

        const userMessage = `Extract structured oncology indications for these EMA-authorised products:\n\n${JSON.stringify(productSummaries, null, 2)}`;

        const response = await this._openai.chat.completions.create({
          model: this.settings.llmModel,
          messages: [
            { role: 'system', content: EMA_INDICATION_EXTRACTION_PROMPT },
            { role: 'user', content: userMessage }
          ],
          max_tokens: 8000,
          temperature: 0.1
        });

        const content = response.choices?.[0]?.message?.content || '';

        // Parse JSON from response (handle markdown code blocks)
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);

          for (const ind of parsed) {
            const productId = ind.product_id || ind.productId ||
              batch.find((p) =>
                normalizeSubstance(p.activeSubstance) === normalizeSubstance(ind.active_substance || ind.drug || ind.substance || '')
              )?.id ||
              (batch.length === 1 ? batch[0].id : undefined);

            if (!productId) {
              this._logger.warn(`[EMA] Skipping indication (no product_id match): ${ind.cancer_type || 'unknown'} — ${ind.active_substance || ind.drug || 'no drug'}`);
              continue;
            }

            allIndications.push({
              id: crypto.createHash('sha1')
                .update(`${productId}-${ind.cancer_type}-${ind.biomarker || ''}-${ind.line_of_therapy || ''}`)
                .digest('hex')
                .slice(0, 12),
              productId,
              cancerType: ind.cancer_type || '',
              cancerSubtype: ind.cancer_subtype || '',
              biomarker: ind.biomarker || '',
              lineOfTherapy: ind.line_of_therapy || '',
              stage: ind.stage || '',
              indicationText: ind.indication_text || ind.summary || '',
              approvalDate: ind.approval_date || '',
              combination: ind.combination || '',
              source: 'llm_extraction',
              confidence: ind.confidence || 'medium',
              llmExtracted: true
            });
          }
        }

        this._logger.info(
          `[EMA] Batch ${batchIdx + 1}/${batches.length}: extracted ${allIndications.length} indications so far`
        );
      } catch (err) {
        this._logger.warn(
          `[EMA] LLM extraction failed for batch ${batchIdx + 1}: ${err.message}`
        );
      }
    }

    return allIndications;
  }

  // ---- query interface -----------------------------------------------------

  /**
   * Main query method — finds EMA authorisation data relevant to a clinical question.
   * Called from simpleChat in parallel with evidence retrieval, trial matching,
   * and INFARMED reimbursement.
   */
  async findEmaData({
    question = '',
    substance = '',
    cancerType = '',
    biomarker = '',
    lineOfTherapy = '',
    population = '',
    intervention = ''
  } = {}) {
    if (!this._ready || !this._store) {
      return { available: false, reason: 'service_not_ready', products: [], indications: [] };
    }

    // Wait for initialisation if still running
    if (this._initialising) {
      try {
        await Promise.race([
          this._initialising,
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000))
        ]);
      } catch {
        // proceed with whatever data is available
      }
    }

    try {
      const searchTerms = this._extractSearchTerms({
        question, substance, cancerType, biomarker, lineOfTherapy,
        population, intervention
      });

      // Search products
      const products = await this._searchProductsMultiStrategy(searchTerms);

      // Search structured indications
      const indications = await this._store.searchIndications({
        cancerType: searchTerms.cancerType,
        biomarker: searchTerms.biomarker,
        lineOfTherapy: searchTerms.lineOfTherapy,
        substance: searchTerms.substance
      });

      // Build response
      const matchedProducts = products.map((product) => ({
        medicineName: product.medicineName,
        activeSubstance: product.activeSubstance,
        atcCode: product.atcCode || '',
        therapeuticArea: product.therapeuticArea || '',
        authorizationStatus: product.authorizationStatus || '',
        approvalDate: product.approvalDate || '',
        authorizationHolder: product.authorizationHolder || '',
        orphanMedicine: product.orphanMedicine || false,
        conditionIndication: product.conditionIndication || '',
        indicationsCount: (product.indicationsStructured || []).length,
        indications: (product.indicationsStructured || []).map((ind) => ({
          cancerType: ind.cancerType,
          cancerSubtype: ind.cancerSubtype,
          biomarker: ind.biomarker,
          lineOfTherapy: ind.lineOfTherapy,
          stage: ind.stage,
          confidence: ind.confidence
        }))
      }));

      // Build contextual summary for injection into chat prompt
      const contextSummary = this._buildContextSummary(matchedProducts, indications, searchTerms);

      return {
        available: true,
        products: matchedProducts,
        indications: indications.map((ind) => ({
          productName: ind.active_substance || ind.activeSubstance || '',
          medicineName: ind.medicine_name || ind.medicineName || '',
          cancerType: ind.cancer_type || ind.cancerType || '',
          cancerSubtype: ind.cancer_subtype || ind.cancerSubtype || '',
          biomarker: ind.biomarker || '',
          lineOfTherapy: ind.line_of_therapy || ind.lineOfTherapy || '',
          stage: ind.stage || '',
          approvalDate: ind.approval_date || ind.approvalDate || '',
          confidence: ind.confidence || ''
        })),
        contextSummary,
        meta: {
          searchTerms,
          productsFound: matchedProducts.length,
          indicationsFound: indications.length,
          dataSource: 'ema_epar',
          lastSync: (await this._store.getLastSyncRun())?.completed_at || null
        }
      };
    } catch (err) {
      this._logger.error(`[EMA] Query failed: ${err.message}`);
      return { available: false, reason: err.message, products: [], indications: [] };
    }
  }

  // ---- search helpers -------------------------------------------------------

  _extractSearchTerms(params) {
    return extractClinicalTerms(params);
  }

  async _searchProductsMultiStrategy(terms) {
    const results = new Map();

    // Strategy 1: Direct substance search
    if (terms.substance) {
      const products = await this._store.searchProducts({
        substance: terms.substance,
        oncologyOnly: true,
        limit: 20
      });
      for (const p of products) results.set(p.id, p);
    }

    // Strategy 2: ATC code prefix search
    if (terms.cancerType && !terms.substance) {
      for (const prefix of ['L01', 'L02']) {
        const products = await this._store.searchProducts({
          atcCode: prefix,
          oncologyOnly: true,
          limit: 50
        });
        for (const p of products) results.set(p.id, p);
      }
    }

    // Strategy 3: If nothing found, get all oncology products but score and limit to top 20
    if (!results.size && (terms.cancerType || terms.biomarker)) {
      const allProducts = await this._store.getAllProducts();
      const queryCancer = (terms.cancerType || '').toLowerCase();
      const queryBio = (terms.biomarker || '').toLowerCase();

      const scored = allProducts.map((p) => {
        let score = 0;
        const payload = JSON.stringify(p).toLowerCase();
        if (queryCancer && payload.includes(queryCancer)) score += 3;
        if (queryBio && payload.includes(queryBio)) score += 3;
        for (const ind of (p.indicationsStructured || [])) {
          const indText = JSON.stringify(ind).toLowerCase();
          if (queryCancer && indText.includes(queryCancer)) score += 2;
          if (queryBio && indText.includes(queryBio)) score += 2;
        }
        return { product: p, score };
      });

      scored.sort((a, b) => b.score - a.score);
      for (const { product } of scored.slice(0, 20)) {
        results.set(product.id, product);
      }
    }

    return [...results.values()];
  }

  /**
   * Builds a plain-text context summary for injection into the chat system prompt.
   */
  _buildContextSummary(products, indications, searchTerms) {
    if (!products.length && !indications.length) {
      return 'No EMA marketing authorisation data found for this query. Do not make claims about EU approval status unless citing a specific source.';
    }

    const lines = ['=== EMA MARKETING AUTHORISATION DATA (verified, from EMA EPAR dataset) ==='];
    lines.push(`Query: substance="${searchTerms.substance}" cancer="${searchTerms.cancerType}" biomarker="${searchTerms.biomarker}" line="${searchTerms.lineOfTherapy}"`);
    lines.push('');

    for (const product of products.slice(0, 10)) {
      lines.push(`PRODUCT: ${product.activeSubstance} (${product.medicineName})`);
      lines.push(`  EU Authorisation status: ${product.authorizationStatus || 'unknown'}`);
      lines.push(`  Approval date: ${product.approvalDate || 'unknown'}`);
      lines.push(`  Authorisation holder: ${product.authorizationHolder || 'unknown'}`);
      lines.push(`  Therapeutic area: ${product.therapeuticArea || 'unknown'}`);
      lines.push(`  Orphan medicine: ${product.orphanMedicine ? 'Yes' : 'No'}`);

      if (product.conditionIndication) {
        lines.push(`  EMA-approved indication: ${product.conditionIndication}`);
      }

      if (product.indications?.length) {
        lines.push('  Structured oncology indications (EU-approved):');
        for (const ind of product.indications) {
          const parts = [ind.cancerType];
          if (ind.cancerSubtype) parts.push(ind.cancerSubtype);
          if (ind.biomarker) parts.push(`[${ind.biomarker}]`);
          if (ind.lineOfTherapy) parts.push(`(${ind.lineOfTherapy})`);
          if (ind.stage) parts.push(`— ${ind.stage}`);
          lines.push(`    • ${parts.join(' ')} [confidence: ${ind.confidence || 'medium'}]`);
        }
      }
      lines.push('');
    }

    if (indications.length) {
      lines.push('MATCHING EMA INDICATIONS:');
      for (const ind of indications.slice(0, 15)) {
        const drug = ind.productName || ind.active_substance || '';
        const cancer = ind.cancerType || ind.cancer_type || '';
        const bio = ind.biomarker || '';
        const line = ind.lineOfTherapy || ind.line_of_therapy || '';
        const date = ind.approvalDate || ind.approval_date || '';
        lines.push(`  • ${drug} — ${cancer} ${bio ? `[${bio}]` : ''} ${line ? `(${line})` : ''} ${date ? `[approved: ${date}]` : ''}`);
      }
    }

    lines.push('');
    lines.push('IMPORTANT: Use this verified EMA data for EU marketing authorisation claims.');
    lines.push('EMA approval ≠ national reimbursement. Refer to INFARMED data for Portuguese reimbursement.');

    return lines.join('\n');
  }

  // ---- status --------------------------------------------------------------

  async getStatus() {
    if (!this._store) {
      return {
        available: false,
        ready: this._ready,
        productCount: 0,
        indicationCount: 0,
        lastSync: null
      };
    }

    const [productCount, indicationCount, lastSync] = await Promise.all([
      this._store.getProductCount(),
      this._store.getIndicationCount(),
      this._store.getLastSyncRun()
    ]);

    return {
      available: true,
      ready: this._ready,
      storeType: this._store.type,
      productCount,
      indicationCount,
      lastSync: lastSync
        ? {
            completedAt: lastSync.completed_at || lastSync.completedAt,
            status: lastSync.status,
            totalProducts: lastSync.total_products || lastSync.totalProducts,
            durationMs: lastSync.duration_ms || lastSync.durationMs
          }
        : null,
      settings: {
        schedule: this.settings.schedule,
        llmModel: this.settings.llmModel,
        llmExtractionEnabled: this.settings.llmExtractionEnabled
      }
    };
  }
}

// Singleton export
const emaService = new EmaService();
export default emaService;
export { EmaService };
