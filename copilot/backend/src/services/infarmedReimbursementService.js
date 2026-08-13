import cron from 'node-cron';
import crypto from 'crypto';

import { openai as defaultOpenAI } from '../config/openai.js';
import { parseBoolean, parseInteger } from '../config/runtimeEnv.js';
import { logger as defaultLogger } from '../utils/logger.js';
import { createInfarmedReimbursementStore } from '../../infarmedReimbursementStore.js';
import {
  runInfarmedSync,
  normalizeSubstance,
  ONCOLOGY_SUBSTANCES,
  CANCER_TYPE_SYNONYMS,
  expandCancerTypeSynonyms
} from '../../infarmedScraper.js';
import { extractClinicalTerms } from './clinicalTermExtractor.js';
import { getMedinovDataService } from './medinovDataService.js';

// ---------------------------------------------------------------------------
// INFARMED Reimbursement Service
//
// Orchestrates:
//   1. Periodic scraping/sync of INFARMED data (AUE, INFOMED, Transparencia)
//   2. LLM-based indication extraction & structuring (dedicated model)
//   3. Clinical query matching (drug lookup by cancer type, biomarker, line)
//
// The LLM agent is independent from the main chat LLM — it runs on a
// configurable model (default: Haiku for cost efficiency) and is responsible
// only for structuring raw indication text into queryable fields.
// ---------------------------------------------------------------------------

const DEFAULT_SCHEDULE = '0 4 * * 1'; // Weekly, Monday at 4am Lisbon time
const DEFAULT_TIMEZONE = 'Europe/Lisbon';
const STALE_HOURS = 168; // 7 days — re-sync if data is older than 1 week

const INDICATION_EXTRACTION_MODEL =
  process.env.BEDROCK_INFARMED_MODEL_ID ||
  process.env.BEDROCK_FALLBACK_MODEL_ID ||
  'us.anthropic.claude-haiku-4-5-20251001-v1:0';

// System prompt for the dedicated indication-extraction LLM
const INDICATION_EXTRACTION_PROMPT = `You are a clinical pharmacology expert specialising in oncology drug indications and European regulatory affairs (EMA, INFARMED). Your task is to extract structured indication data from raw drug information.

For each drug, extract ALL oncology indications into structured objects. Each object must have:

1. cancer_type: Primary cancer type using FULL canonical English name — lowercase, spelled out.
   - Do NOT use abbreviations in this field. Examples:
     NSCLC → "non-small cell lung cancer"
     SCLC → "small cell lung cancer"
     DLBCL → "diffuse large b-cell lymphoma"
     LBCL → "large b-cell lymphoma"
     FL → "follicular lymphoma"
     HL → "hodgkin lymphoma"
     MCL → "mantle cell lymphoma"
     MZL → "marginal zone lymphoma"
     MM → "multiple myeloma"
     MF → "myelofibrosis"
     AML → "acute myeloid leukemia"
     ALL → "acute lymphoblastic leukemia"
     CLL → "chronic lymphocytic leukemia"
     CML → "chronic myeloid leukemia"
     MDS → "myelodysplastic syndrome"
     CRC → "colorectal cancer"
     mCRC → "metastatic colorectal cancer"
     HCC → "hepatocellular carcinoma"
     CCA → "cholangiocarcinoma"
     BTC → "biliary tract cancer"
     GBC → "gallbladder cancer"
     RCC → "renal cell carcinoma"
     UC → "urothelial carcinoma"
     TNBC → "triple-negative breast cancer"
     HNSCC → "head and neck squamous cell carcinoma"
     mCRPC → "metastatic castration-resistant prostate cancer"
     CRPC → "castration-resistant prostate cancer"
     OC → "ovarian cancer"
     EC → "endometrial cancer"   ← NOT esophageal cancer
     CC → "cervical cancer"
     GIST → "gastrointestinal stromal tumor"
     NET → "neuroendocrine tumor"
     PNET → "pancreatic neuroendocrine tumor"
     PDAC → "pancreatic ductal adenocarcinoma"
     GC → "gastric cancer"
     GEJ → "gastroesophageal junction cancer"
     STS → "soft tissue sarcoma"
     GBM → "glioblastoma"
     DTC → "differentiated thyroid cancer"
     MTC → "medullary thyroid cancer"

2. cancer_subtype: Histological or molecular subtype (e.g., "squamous cell", "adenocarcinoma", "clear cell", "luminal B"). Leave empty if not specified.

3. biomarker: Required biomarker using standard notation. Examples:
   - "PD-L1 TPS ≥50%", "PD-L1 CPS ≥10", "PD-L1 CPS ≥1", "PD-L1 CPS (all-comers)",
   "EGFR exon 19 del/L858R", "EGFR exon 20 insertion",
   "ALK rearrangement", "ROS1 rearrangement", "HER2-positive (IHC 3+ or ISH+)", "HER2-low (IHC 1+ or 2+/ISH-)",
   "BRCA1/2 mutation (germline or somatic)", "HRD positive", "MSI-H/dMMR", "TMB-H (≥10 mut/Mb)",
   "BRAF V600E/K", "KRAS G12C", "PIK3CA mutation", "ESR1 mutation", "NTRK fusion", "RET fusion",
   "FGFR1/2/3 alteration", "MET exon 14 skipping", "PSMA-positive", "IDH1 R132",
   "Claudin 18.2-positive (IHC ≥2+, ≥75% of cells)"
   Leave empty if no biomarker required.
   CRITICAL PD-L1 CPS RULES by drug/cancer combination:
   - pembrolizumab + trastuzumab + chemo in HER2-positive gastric/GEJ → biomarker: "HER2-positive (IHC 3+ or ISH+), PD-L1 CPS ≥1"
   - pembrolizumab + chemo in HER2-negative gastric/GEJ → biomarker: "" (no mandatory PD-L1 cut-off per KEYNOTE-859 EMA label)
   - pembrolizumab in NSCLC 1L monotherapy → biomarker: "PD-L1 TPS ≥50%"
   - pembrolizumab in NSCLC 1L + chemo → biomarker: "PD-L1 any" (no cutoff required)
   - nivolumab + chemo in gastric/GEJ → biomarker: "PD-L1 CPS ≥5" (CHECKMATE-649 EMA label)
   - nivolumab monotherapy in gastric/GEJ 2L → biomarker: "MSI-H/dMMR" or "PD-L1 CPS ≥1"

4. line_of_therapy: Use these exact values only:
   "1L" (first-line), "2L" (second-line), "2L+" (second-line or later), "3L" (third-line),
   "3L+" (third-line or later), "adjuvant", "neoadjuvant", "perioperative", "maintenance",
   "any line" (no restriction), or a combination (e.g., "1L maintenance").

5. stage: "metastatic", "locally advanced", "unresectable locally advanced", "resectable",
   "early stage", "stage III", "stage IV", "any stage". Be specific.

6. combination: Brief description (e.g., "monotherapy", "plus chemotherapy", "plus bevacizumab",
   "plus carboplatin/pemetrexed", "FOLFOX/FOLFIRI backbone"). Leave empty if unknown.

7. reimbursement_status: Portuguese reimbursement status — MUST come from the SOURCE DATA fields
   (reimbursementType, status, sources, papStatus). Do NOT use your training knowledge.
   Use exactly one of:
   - "PAP" — Programa de Acesso Precoce: drug HAS EMA marketing authorisation (AIM) but is
     pending full INFARMED reimbursement. Source data has papStatus or sources includes "pap".
   - "AUE" — Autorização de Utilização Especial: ONLY for drugs WITHOUT EMA AIM. Extremely rare
     for standard oncology drugs. Do NOT use AUE for EMA-approved drugs.
   - "AIM" — EMA authorisation confirmed but no SNS reimbursement data.
   - "AIM+SNS" — Fully reimbursed under Portuguese SNS (source confirms snsCovered=true or
     sources includes "transparencia_sns").
   - "hospital_only" — Only available via hospital pharmacy.
   - "unknown" — Insufficient data. PREFER this over guessing.

8. confidence: "high" (explicit in source), "medium" (inferred), "low" (best guess).
   For reimbursement_status, use "low" unless source data is explicit.

9. esmo_mcbs: ESMO-MCBS score if you know it from your training data (e.g., "4", "5", "A", "B").
   Leave empty if unknown. Only fill this when you are highly confident.

10. drug_id: Copy the "id" field from the drug object you are extracting for.

Output a JSON array only — no markdown, no explanations. Each element is one indication.

CRITICAL RULES:
- Create SEPARATE objects for EACH distinct indication (cancer type × biomarker × line combination).
- Translate Portuguese text to English in all fields.
- NEVER use AUE for a drug that has EMA marketing authorisation — those use PAP.
- If the source data shows emaApproved=true or sources includes "ema_epar", the drug has EMA AIM.
  → reimbursement_status must be "PAP", "AIM", or "AIM+SNS" — NEVER "AUE".
- When reimbursement_status is uncertain, output "unknown" — wrong classification misleads clinicians.
- Common combinations to recognise: R-CHOP, R-CVP, FOLFOX, FOLFIRI, FOLFIRINOX, BEACOPP,
  ABVD, BEP, carboplatin+pemetrexed, carboplatin+paclitaxel, nab-paclitaxel+gemcitabine,
  FLOT (fluorouracil+leucovorin+oxaliplatin+docetaxel), XELOX/CAPOX (capecitabine+oxaliplatin).
- Gastric/GEJ cancer ALWAYS uses cancer_type "gastric cancer" (not "GEJ" separately) — GEJ is
  a subtype. If the source mentions "gastric or GEJ" or "gastric/GEJ", use cancer_type "gastric cancer"
  and cancer_subtype "adenocarcinoma" or "gastroesophageal junction" as appropriate.
- For gastric/GEJ: EMA-approved immunotherapy indications require creating SEPARATE entries for
  HER2-positive (trastuzumab combination) and HER2-negative arms — they have different biomarkers.`;

class InfarmedReimbursementService {
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
      enabled: parseBoolean(process.env.INFARMED_REIMBURSEMENT_ENABLED, true),
      syncOnBoot: parseBoolean(process.env.INFARMED_SYNC_ON_BOOT, true),
      schedule: process.env.INFARMED_SYNC_SCHEDULE || DEFAULT_SCHEDULE,
      timezone: process.env.INFARMED_SYNC_TIMEZONE || DEFAULT_TIMEZONE,
      staleHours: parseInteger(process.env.INFARMED_STALE_HOURS, STALE_HOURS),
      store: process.env.INFARMED_STORE || 'sqlite',
      sqlitePath: process.env.INFARMED_SQLITE_PATH || './data/infarmed_reimbursement.sqlite',
      filePath: process.env.INFARMED_FILE_PATH || './data/infarmed_reimbursement_snapshot.json',
      includeINFOMED: parseBoolean(process.env.INFARMED_INCLUDE_INFOMED, true),
      includePAP: parseBoolean(process.env.INFARMED_INCLUDE_PAP, true),
      includeTransparencia: parseBoolean(process.env.INFARMED_INCLUDE_TRANSPARENCIA, true),
      includeEMAEPAR: parseBoolean(process.env.INFARMED_INCLUDE_EMA_EPAR, true),
      infomedDelayMs: parseInteger(process.env.INFARMED_INFOMED_DELAY_MS, 1500),
      llmExtractionEnabled: parseBoolean(process.env.INFARMED_LLM_EXTRACTION, true),
      llmModel: INDICATION_EXTRACTION_MODEL
    };
  }

  // ---- lifecycle -----------------------------------------------------------

  async start() {
    const { enabled, syncOnBoot, schedule, timezone } = this.settings;

    if (!enabled) {
      this._logger.info('[INFARMED] Service disabled via INFARMED_REIMBURSEMENT_ENABLED');
      return;
    }

    this._logger.info('[INFARMED] Starting reimbursement service...');

    // Initialise store
    this._store = createInfarmedReimbursementStore(
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
          this._logger.error(`[INFARMED] Scheduled sync failed: ${e.message}`)
        ),
        { timezone }
      );
      this._logger.info(`[INFARMED] Weekly sync scheduled: ${schedule} (${timezone})`);
    }

    // Sync on boot if stale (data older than ~1 month)
    if (syncOnBoot) {
      this._initialising = this._syncIfStale().catch((e) =>
        this._logger.warn(`[INFARMED] Boot sync skipped: ${e.message}`)
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
      this._store.close().catch((e) =>
        this._logger.warn(`[INFARMED] Store close error: ${e.message}`)
      );
    }
    this._ready = false;
    this._logger.info('[INFARMED] Service stopped');
  }

  // ---- sync ----------------------------------------------------------------

  async _syncIfStale() {
    const lastRun = await this._store.getLastSyncRun();
    if (lastRun?.completed_at) {
      const age = Date.now() - new Date(lastRun.completed_at).getTime();
      const staleMs = this.settings.staleHours * 3600_000;
      if (age < staleMs) {
        this._logger.info(
          `[INFARMED] Data is fresh (${Math.round(age / 3600_000)}h old), skipping boot sync`
        );
        return;
      }
    }
    return this.runSync({ reason: 'boot_stale' });
  }

  async runSync({ reason = 'manual', force = false } = {}) {
    this._logger.info(`[INFARMED] Starting sync (reason: ${reason}, force: ${force})`);
    const startedAt = new Date().toISOString();

    try {
      // Phase 1: Scrape INFARMED sources
      const { drugs, meta } = await runInfarmedSync({
        logger: this._logger,
        substances: ONCOLOGY_SUBSTANCES,
        includeTransparencia: this.settings.includeTransparencia,
        includeINFOMED: this.settings.includeINFOMED,
        includePAP: this.settings.includePAP,
        includeEMAEPAR: this.settings.includeEMAEPAR,
        infomedDelayMs: this.settings.infomedDelayMs
      });

      // Phase 2: LLM-based indication extraction
      let structuredIndications = [];
      if (this.settings.llmExtractionEnabled && drugs.length > 0) {
        structuredIndications = await this._extractIndicationsWithLLM(drugs);

        // Attach structured indications back to drugs
        const indicationsByDrug = new Map();
        for (const ind of structuredIndications) {
          if (!indicationsByDrug.has(ind.drugId)) {
            indicationsByDrug.set(ind.drugId, []);
          }
          indicationsByDrug.get(ind.drugId).push(ind);
        }
        for (const drug of drugs) {
          drug.indicationsStructured = indicationsByDrug.get(drug.id) || [];
        }
      }

      // Phase 3: Persist
      await this._store.writeDrugs(drugs);
      if (structuredIndications.length) {
        await this._store.writeIndications(structuredIndications);
      }

      // Record sync run
      const completedAt = new Date().toISOString();
      await this._store.writeSyncRun({
        startedAt,
        completedAt,
        status: 'completed',
        totalDrugs: drugs.length,
        sourcesSummary: meta.sources,
        durationMs: meta.durationMs,
        error: ''
      });

      const src = meta.sources || {};
      this._logger.info(
        `[INFARMED] Weekly sync complete: ${drugs.length} drugs, ${structuredIndications.length} structured indications — ` +
        `Sources: AUE=${src.aue_chnm || 0}, AUE-benefit=${src.aue_benefit || 0}, PAP=${src.pap || 0}, ` +
        `INFOMED=${src.infomed || 0}, Transparência=${src.transparencia_sns || 0}, EMA-EPAR=${src.ema_epar || 0}`
      );

      return {
        success: true,
        totalDrugs: drugs.length,
        totalIndications: structuredIndications.length,
        sources: meta.sources,
        durationMs: meta.durationMs
      };
    } catch (err) {
      this._logger.error(`[INFARMED] Sync failed: ${err.message}`);
      await this._store?.writeSyncRun?.({
        startedAt,
        completedAt: new Date().toISOString(),
        status: 'failed',
        totalDrugs: 0,
        sourcesSummary: {},
        durationMs: Date.now() - new Date(startedAt).getTime(),
        error: err.message
      });
      throw err;
    }
  }

  // ---- LLM indication extraction -------------------------------------------

  /**
   * Uses a dedicated LLM (independent from the main chat model) to extract
   * structured indication data from raw drug information.
   * Processes drugs in batches to manage token usage.
   */
  async _extractIndicationsWithLLM(drugs) {
    const allIndications = [];
    const batchSize = 10;
    const batches = [];

    for (let i = 0; i < drugs.length; i += batchSize) {
      batches.push(drugs.slice(i, i + batchSize));
    }

    this._logger.info(
      `[INFARMED] Extracting indications via LLM (${drugs.length} drugs in ${batches.length} batches, model: ${this.settings.llmModel})`
    );

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];

      try {
        const drugSummaries = batch.map((drug) => ({
          id: drug.id,
          activeSubstance: drug.activeSubstance,
          tradeNames: drug.tradeNames || [],
          atcCode: drug.atcCode || '',
          reimbursementType: drug.reimbursementType || '',
          status: drug.status || '',
          aimStatus: drug.aimStatus || '',
          emaApproved: drug.emaApproved || false,
          papStatus: drug.papStatus || '',
          papIndication: drug.papIndication || '',  // PAP-specific indication text
          snsCovered: drug.snsCovered || false,
          rawIndications: drug.indications || [],
          clinicalBenefit: drug.clinicalBenefit || '',
          sources: drug.sources || []
        }));

        const userMessage = `Extract structured oncology indications for these drugs:\n\n${JSON.stringify(drugSummaries, null, 2)}`;

        const response = await this._openai.chat.completions.create({
          model: this.settings.llmModel,
          messages: [
            { role: 'system', content: INDICATION_EXTRACTION_PROMPT },
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
            const drugId = ind.drug_id || ind.drugId ||
              batch.find((d) =>
                normalizeSubstance(d.activeSubstance) === normalizeSubstance(ind.drug || ind.substance || '')
              )?.id;

            if (!drugId) continue;

            allIndications.push({
              id: crypto.createHash('sha1')
                .update(`${drugId}-${ind.cancer_type}-${ind.biomarker || ''}-${ind.line_of_therapy || ''}`)
                .digest('hex')
                .slice(0, 12),
              drugId,
              cancerType: ind.cancer_type || '',
              cancerSubtype: ind.cancer_subtype || '',
              biomarker: ind.biomarker || '',
              lineOfTherapy: ind.line_of_therapy || '',
              stage: ind.stage || '',
              indicationText: ind.indication_text || ind.summary || '',
              reimbursementStatus: ind.reimbursement_status || '',
              combination: ind.combination || '',
              esmoMcbs: ind.esmo_mcbs || '',
              source: 'llm_extraction',
              confidence: ind.confidence || 'medium',
              llmExtracted: true
            });
          }
        }

        this._logger.info(
          `[INFARMED] Batch ${batchIdx + 1}/${batches.length}: extracted ${allIndications.length} indications so far`
        );
      } catch (err) {
        this._logger.warn(
          `[INFARMED] LLM extraction failed for batch ${batchIdx + 1}: ${err.message}`
        );
      }
    }

    return allIndications;
  }

  // ---- query interface -----------------------------------------------------

  /**
   * Main query method — finds reimbursement data relevant to a clinical question.
   * Called from simpleChat in parallel with evidence retrieval and trial matching.
   *
   * @param {Object} params
   * @param {string} params.question - The clinical question
   * @param {string} params.substance - Drug/substance name (optional)
   * @param {string} params.cancerType - Cancer type (optional)
   * @param {string} params.biomarker - Biomarker (optional)
   * @param {string} params.lineOfTherapy - Line of therapy (optional)
   * @returns {Object} Reimbursement matches with structured indication data
   */
  async findReimbursementData({
    question = '',
    substance = '',
    cancerType = '',
    biomarker = '',
    lineOfTherapy = '',
    population = '',
    intervention = ''
  } = {}) {
    if (!this._ready || !this._store) {
      return { available: false, reason: 'service_not_ready', drugs: [], indications: [] };
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
      // Extract search terms from question if specific params not provided
      const searchTerms = this._extractSearchTerms({
        question, substance, cancerType, biomarker, lineOfTherapy,
        population, intervention
      });

      // Search drugs
      const drugs = await this._searchDrugsMultiStrategy(searchTerms);

      // Expand cancer type with synonyms before querying the store
      const cancerTypeAliases = expandCancerTypeSynonyms(searchTerms.cancerType);

      // Search structured indications (with synonym expansion)
      const indications = await this._store.searchIndications({
        cancerType: searchTerms.cancerType,
        cancerTypeAliases,
        biomarker: searchTerms.biomarker,
        lineOfTherapy: searchTerms.lineOfTherapy,
        substance: searchTerms.substance
      });

      // Build response
      const matchedDrugs = drugs.map((drug) => ({
        activeSubstance: drug.activeSubstance,
        tradeNames: drug.tradeNames || [],
        atcCode: drug.atcCode || '',
        reimbursementType: drug.reimbursementType || '',
        reimbursementStatus: drug.status || '',
        clinicalBenefit: drug.clinicalBenefit || '',
        aimStatus: drug.aimStatus || '',
        commercialised: drug.commercialised || '',
        snsCovered: drug.snsCovered || false,
        papStatus: drug.papStatus || '',
        papIndication: drug.papIndication || '',
        papStartDate: drug.papStartDate || '',
        sources: drug.sources || [],
        indicationsCount: (drug.indicationsStructured || []).length,
        indications: (drug.indicationsStructured || []).map((ind) => ({
          cancerType: ind.cancerType,
          cancerSubtype: ind.cancerSubtype,
          biomarker: ind.biomarker,
          lineOfTherapy: ind.lineOfTherapy,
          stage: ind.stage,
          reimbursementStatus: ind.reimbursementStatus,
          confidence: ind.confidence
        }))
      }));

      // Enrich with curated MedInov Excel data
      let medinovEntries = [];
      let medinovContext = '';
      try {
        const medinov = getMedinovDataService({ logger: this._logger });
        medinovEntries = medinov.search({
          substance: searchTerms.substance,
          cancerType: searchTerms.cancerType,
          biomarker: searchTerms.biomarker,
          lineOfTherapy: searchTerms.lineOfTherapy
        });
        if (medinovEntries.length > 0) {
          medinovContext = medinov.buildContextSummary(medinovEntries);
          this._logger.info(`[INFARMED] MedInov enrichment: ${medinovEntries.length} entries found`);
        }
      } catch (medinovErr) {
        this._logger.warn(`[INFARMED] MedInov enrichment failed: ${medinovErr.message}`);
      }

      // Build contextual summary for injection into chat prompt
      const scrapedSummary = this._buildContextSummary(matchedDrugs, indications, searchTerms);
      const contextSummary = medinovContext
        ? `${scrapedSummary}\n\n${medinovContext}`
        : scrapedSummary;

      // Build structured MedInov approval entries for frontend
      const medinovApprovals = medinovEntries.map((e) => ({
        substance: e.substance,
        tradeName: e.tradeName,
        lab: e.lab,
        indication: e.indication,
        indicationComplement: e.indicationComplement,
        pathology: e.pathologyGroup,
        clinicGroup: e.clinicGroup,
        rafpStatus: e.rafpStatus,
        papStatus: e.papStatus,
        papDate: e.papDate,
        dataEPAR: e.dataEPAR,
        dataRCM: e.dataRCM,
        rcmAuth: e.rcmAuth,
        linesOfTherapy: e.linesOfTherapy,
        therapyIntent: e.therapyIntent,
        biomarkers: e.biomarkers,
        isOral: e.isOral,
        isEV: e.isEV,
        trialEvidence: e.trialEvidence
      }));

      return {
        available: true,
        drugs: matchedDrugs,
        indications: indications.map((ind) => ({
          drugName: ind.active_substance || ind.activeSubstance || '',
          cancerType: ind.cancer_type || ind.cancerType || '',
          cancerSubtype: ind.cancer_subtype || ind.cancerSubtype || '',
          biomarker: ind.biomarker || '',
          lineOfTherapy: ind.line_of_therapy || ind.lineOfTherapy || '',
          stage: ind.stage || '',
          reimbursementStatus: ind.reimbursement_status || ind.reimbursementStatus || '',
          confidence: ind.confidence || ''
        })),
        medinovApprovals,
        contextSummary,
        meta: {
          searchTerms,
          drugsFound: matchedDrugs.length,
          indicationsFound: indications.length,
          medinovEntriesFound: medinovEntries.length,
          // Report the actual provenance of the matched records (e.g. curated_seed,
          // aue_benefit) rather than a blanket "scraped" label — oncology coverage
          // currently comes from the curated seed dataset, not the live scraper.
          dataSource: this._describeProvenance(matchedDrugs, medinovEntries),
          lastSync: (await this._store.getLastSyncRun())?.completed_at || null
        }
      };
    } catch (err) {
      this._logger.error(`[INFARMED] Query failed: ${err.message}`);
      return { available: false, reason: err.message, drugs: [], indications: [] };
    }
  }

  // ---- search helpers ------------------------------------------------------

  /**
   * Honest provenance label for a result set, built from the source tags the
   * matched drug records actually carry (curated_seed, aue_benefit, pap, ...).
   */
  _describeProvenance(matchedDrugs = [], medinovEntries = []) {
    const tags = new Set();
    for (const drug of matchedDrugs) {
      for (const source of (drug.sources || [])) tags.add(source);
    }
    const parts = [];
    parts.push(tags.size ? `infarmed:${[...tags].sort().join('+')}` : 'infarmed');
    if (medinovEntries.length > 0) parts.push('medinov');
    return parts.join('+');
  }

  _extractSearchTerms(params) {
    return extractClinicalTerms(params);
  }

  async _searchDrugsMultiStrategy(terms) {
    const results = new Map();

    // Strategy 1: Direct substance search
    if (terms.substance) {
      const drugs = await this._store.searchDrugs({
        substance: terms.substance,
        oncologyOnly: true,
        limit: 20
      });
      for (const d of drugs) results.set(d.id, d);
    }

    // Strategy 2: ATC code prefix search (if cancer type known, search L01/L02)
    if (terms.cancerType && !terms.substance) {
      for (const prefix of ['L01', 'L02']) {
        const drugs = await this._store.searchDrugs({
          atcCode: prefix,
          oncologyOnly: true,
          limit: 50
        });
        for (const d of drugs) results.set(d.id, d);
      }
    }

    // Strategy 3: If nothing found, get all oncology drugs but score and limit to top 20
    if (!results.size && (terms.cancerType || terms.biomarker)) {
      const allDrugs = await this._store.getAllDrugs();
      const queryCancer = (terms.cancerType || '').toLowerCase();
      const queryBio = (terms.biomarker || '').toLowerCase();

      // Score each drug by relevance to the query
      const scored = allDrugs.map((d) => {
        let score = 0;
        const payload = JSON.stringify(d).toLowerCase();
        if (queryCancer && payload.includes(queryCancer)) score += 3;
        if (queryBio && payload.includes(queryBio)) score += 3;
        // Boost drugs with structured indications matching query
        for (const ind of (d.indicationsStructured || [])) {
          const indText = JSON.stringify(ind).toLowerCase();
          if (queryCancer && indText.includes(queryCancer)) score += 2;
          if (queryBio && indText.includes(queryBio)) score += 2;
        }
        return { drug: d, score };
      });

      scored.sort((a, b) => b.score - a.score);
      for (const { drug } of scored.slice(0, 20)) {
        results.set(drug.id, drug);
      }
    }

    return [...results.values()];
  }

  /**
   * Builds a plain-text context summary for injection into the chat system prompt.
   * This replaces the LLM-hallucinated reimbursement claims with grounded data.
   */
  _buildContextSummary(drugs, indications, searchTerms) {
    if (!drugs.length && !indications.length) {
      return 'No INFARMED reimbursement data found for this query. Do not make claims about Portuguese reimbursement status. ' +
        'Specifically, do NOT use terms like "AUE" (Autorização de Utilização Especial) or "PAP" (Programa de Acesso Precoce) ' +
        'unless you have verified data — these have precise regulatory meanings. AUE is ONLY for drugs without EMA marketing ' +
        'authorisation; PAP is for EMA-approved drugs pending full reimbursement. State that availability should be confirmed ' +
        'with INFARMED or the hospital pharmacy.';
    }

    const lines = ['=== INFARMED REIMBURSEMENT DATA (verified, scraped from infarmed.pt) ==='];
    lines.push(`Query: substance="${searchTerms.substance}" cancer="${searchTerms.cancerType}" biomarker="${searchTerms.biomarker}" line="${searchTerms.lineOfTherapy}"`);
    lines.push('');

    for (const drug of drugs.slice(0, 10)) {
      const sources = drug.sources || [];
      const hasPAP = sources.includes('pap') || drug.papStatus;
      const hasInfomed = sources.includes('infomed');
      const hasTransparencia = sources.includes('transparencia_sns');
      const hasAIM = hasInfomed && drug.aimStatus && drug.aimStatus !== 'Revogado';
      const hasHospitalSpending = hasTransparencia || (drug.hospitalSpending && drug.hospitalSpending.length > 0);

      // Runtime cross-reference: if ANY source confirms the drug has EMA/AIM or
      // is being purchased by SNS hospitals, "AUE" is wrong — AUE is ONLY for
      // drugs WITHOUT EMA marketing authorisation.
      let correctedReimbType = drug.reimbursementType || 'unknown';
      if (correctedReimbType === 'AUE' && (hasAIM || hasPAP || hasHospitalSpending)) {
        if (drug.snsCovered || hasHospitalSpending) {
          correctedReimbType = 'AIM+SNS';
        } else if (hasPAP) {
          correctedReimbType = 'PAP';
        } else {
          correctedReimbType = 'AIM';
        }
      }

      lines.push(`DRUG: ${drug.activeSubstance} (${drug.tradeNames.join(', ') || 'N/A'})`);
      if (drug.snsCovered) {
        lines.push(`  ✓ FUNDED/REIMBURSED under Portuguese SNS (comparticipado/financiado)`);
      }
      if (hasPAP) {
        lines.push(`  ⚠ PAP (Programa de Acesso Precoce): ${drug.papStatus || 'Ativo'}`);
        if (drug.papIndication) lines.push(`    PAP indication: ${drug.papIndication}`);
        if (drug.papStartDate) lines.push(`    PAP start date: ${drug.papStartDate}`);
        lines.push(`    → This drug is available via early access program in Portugal (SNS hospitals can request it through INFARMED before full reimbursement evaluation is complete)`);
      }
      lines.push(`  Reimbursement type: ${correctedReimbType}`);
      lines.push(`  Status: ${drug.reimbursementStatus || 'unknown'}`);
      lines.push(`  AIM status: ${drug.aimStatus || 'unknown'}`);
      lines.push(`  Clinical benefit: ${drug.clinicalBenefit || 'not assessed'}`);
      lines.push(`  SNS covered: ${drug.snsCovered ? 'Yes — funded/reimbursed' : 'Check with institution'}`);
      lines.push(`  Sources: ${drug.sources.join(', ')}`);

      if (drug.indications?.length) {
        lines.push('  Approved indications in Portugal:');
        for (const ind of drug.indications) {
          const parts = [ind.cancerType];
          if (ind.cancerSubtype) parts.push(ind.cancerSubtype);
          if (ind.biomarker) parts.push(`[${ind.biomarker}]`);
          if (ind.lineOfTherapy) parts.push(`(${ind.lineOfTherapy})`);
          if (ind.stage) parts.push(`— ${ind.stage}`);
          if (ind.reimbursementStatus) parts.push(`→ ${ind.reimbursementStatus}`);
          lines.push(`    • ${parts.join(' ')} [confidence: ${ind.confidence || 'medium'}]`);
        }
      }
      lines.push('');
    }

    if (indications.length) {
      lines.push('MATCHING INDICATIONS:');
      const queriedLine = (searchTerms.lineOfTherapy || '').toUpperCase();
      for (const ind of indications.slice(0, 15)) {
        const drug = ind.drugName || ind.active_substance || '';
        const cancer = ind.cancerType || ind.cancer_type || '';
        const bio = ind.biomarker || '';
        const line = ind.lineOfTherapy || ind.line_of_therapy || '';
        const reimb = ind.reimbursementStatus || ind.reimbursement_status || '';
        // Flag when the indication's line differs from the queried line
        const lineUpper = (line || '').toUpperCase();
        let lineNote = '';
        if (queriedLine && lineUpper && !lineUpper.includes(queriedLine) && !queriedLine.includes(lineUpper)) {
          lineNote = ` ⚠ NOTE: This indication is approved for ${line}, not ${queriedLine} — report the ACTUAL approved line accurately`;
        }
        lines.push(`  • ${drug} — ${cancer} ${bio ? `[${bio}]` : ''} ${line ? `(${line})` : ''} → ${reimb}${lineNote}`);
      }
    }

    lines.push('');
    lines.push('IMPORTANT: Use ONLY this verified data for Portuguese reimbursement claims.');
    lines.push('If a drug has PAP (Programa de Acesso Precoce) status, ALWAYS mention this prominently — it means the drug IS accessible in Portugal via early access even if full SNS reimbursement is not yet finalized. Explain that hospitals can request it through INFARMED.');
    lines.push('If the approved line of therapy differs from what was asked, clearly state the ACTUAL approved line (e.g., "approved in first-line" even if the question asks about second-line).');
    lines.push('If the specific indication is not listed above, state that reimbursement status should be confirmed with INFARMED/hospital pharmacy.');
    lines.push('NEVER use "AUE" (Autorização de Utilização Especial) for drugs with EMA marketing authorisation — AUE is ONLY for drugs without EMA approval. EMA-approved drugs use PAP (Programa de Acesso Precoce), not AUE. If unsure, state that availability should be confirmed with INFARMED.');

    return lines.join('\n');
  }

  // ---- status --------------------------------------------------------------

  async getStatus() {
    if (!this._store) {
      return {
        available: false,
        ready: this._ready,
        drugCount: 0,
        indicationCount: 0,
        lastSync: null
      };
    }

    const [drugCount, indicationCount, lastSync] = await Promise.all([
      this._store.getDrugCount(),
      this._store.getIndicationCount(),
      this._store.getLastSyncRun()
    ]);

    return {
      available: true,
      ready: this._ready,
      storeType: this._store.type,
      drugCount,
      indicationCount,
      lastSync: lastSync
        ? {
            completedAt: lastSync.completed_at || lastSync.completedAt,
            status: lastSync.status,
            totalDrugs: lastSync.total_drugs || lastSync.totalDrugs,
            durationMs: lastSync.duration_ms || lastSync.durationMs
          }
        : null,
      settings: {
        schedule: this.settings.schedule,
        llmModel: this.settings.llmModel,
        llmExtractionEnabled: this.settings.llmExtractionEnabled,
        includeINFOMED: this.settings.includeINFOMED,
        includePAP: this.settings.includePAP,
        includeTransparencia: this.settings.includeTransparencia
      }
    };
  }
}

// Singleton export
const infarmedReimbursementService = new InfarmedReimbursementService();
export default infarmedReimbursementService;
export { InfarmedReimbursementService };
