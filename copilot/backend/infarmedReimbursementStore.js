import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// INFARMED Reimbursement Store — persistence layer for oncology drug
// reimbursement data. Follows the same multi-store pattern as
// trialRegistryStore.js (SQLite primary, file fallback).
// ---------------------------------------------------------------------------

const DEFAULT_PREFIX = 'infarmed_reimbursement';

const resolveStoreType = (options) => {
  const explicit = String(options.store || '').trim().toLowerCase();
  if (explicit === 'sqlite' || explicit === 'sqlite3') return 'sqlite';
  if (explicit === 'file' || explicit === 'json') return 'file';
  return 'sqlite'; // default to SQLite
};

const resolvePath = (value, fallback) => {
  const raw = value || fallback;
  if (!raw) return null;
  if (path.isAbsolute(raw)) return raw;
  const baseDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(baseDir, raw);
};

const ensureDir = (filePath) => {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
};

const parseJsonPayload = (payload) => {
  if (!payload) return null;
  if (typeof payload === 'object') return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
};

// ---- SQLite store ----------------------------------------------------------

const createSQLiteStore = (options, logger) => {
  const dbPath = resolvePath(options.sqlitePath, './data/infarmed_reimbursement.sqlite');
  let db = null;

  const getDb = async () => {
    if (db) return db;
    const { default: Database } = await import('better-sqlite3');
    ensureDir(dbPath);
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
    return db;
  };

  const initSchema = (database) => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS drugs (
        id TEXT PRIMARY KEY,
        active_substance TEXT NOT NULL,
        active_substance_normalized TEXT NOT NULL,
        trade_names TEXT DEFAULT '[]',
        atc_code TEXT DEFAULT '',
        reimbursement_type TEXT DEFAULT '',
        reimbursement_status TEXT DEFAULT '',
        aim_status TEXT DEFAULT '',
        commercialised TEXT DEFAULT '',
        clinical_benefit TEXT DEFAULT '',
        is_oncology INTEGER DEFAULT 1,
        sources TEXT DEFAULT '[]',
        indications_raw TEXT DEFAULT '[]',
        indications_structured TEXT DEFAULT '[]',
        infomed_entries TEXT DEFAULT '[]',
        hospital_spending TEXT DEFAULT '[]',
        ema_approved INTEGER DEFAULT 0,
        ema_indications TEXT DEFAULT '[]',
        sns_covered INTEGER DEFAULT 0,
        payload TEXT NOT NULL,
        fetched_at TEXT DEFAULT '',
        updated_at TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS indications (
        id TEXT NOT NULL,
        drug_id TEXT NOT NULL,
        cancer_type TEXT NOT NULL,
        cancer_subtype TEXT DEFAULT '',
        biomarker TEXT DEFAULT '',
        line_of_therapy TEXT DEFAULT '',
        stage TEXT DEFAULT '',
        indication_text TEXT DEFAULT '',
        reimbursement_status TEXT DEFAULT '',
        source TEXT DEFAULT '',
        confidence TEXT DEFAULT 'low',
        llm_extracted INTEGER DEFAULT 0,
        PRIMARY KEY (id, drug_id),
        FOREIGN KEY (drug_id) REFERENCES drugs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sync_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        completed_at TEXT DEFAULT '',
        status TEXT DEFAULT 'running',
        total_drugs INTEGER DEFAULT 0,
        sources_summary TEXT DEFAULT '{}',
        duration_ms INTEGER DEFAULT 0,
        error TEXT DEFAULT ''
      );

      -- PAP (Programa de Acesso Precoce) columns — added dynamically for existing DBs
      CREATE INDEX IF NOT EXISTS idx_drugs_substance ON drugs(active_substance_normalized);
      CREATE INDEX IF NOT EXISTS idx_drugs_atc ON drugs(atc_code);
      CREATE INDEX IF NOT EXISTS idx_drugs_reimb_type ON drugs(reimbursement_type);
      CREATE INDEX IF NOT EXISTS idx_drugs_oncology ON drugs(is_oncology);
      CREATE INDEX IF NOT EXISTS idx_indications_cancer ON indications(cancer_type);
      CREATE INDEX IF NOT EXISTS idx_indications_biomarker ON indications(biomarker);
      CREATE INDEX IF NOT EXISTS idx_indications_line ON indications(line_of_therapy);
      CREATE INDEX IF NOT EXISTS idx_indications_drug ON indications(drug_id);
    `);

    // Migrate: add PAP columns if they don't exist yet (safe for existing DBs)
    const columns = database.pragma('table_info(drugs)').map((c) => c.name);
    if (!columns.includes('pap_status')) {
      database.exec(`ALTER TABLE drugs ADD COLUMN pap_status TEXT DEFAULT ''`);
    }
    if (!columns.includes('pap_indication')) {
      database.exec(`ALTER TABLE drugs ADD COLUMN pap_indication TEXT DEFAULT ''`);
    }
    if (!columns.includes('pap_start_date')) {
      database.exec(`ALTER TABLE drugs ADD COLUMN pap_start_date TEXT DEFAULT ''`);
    }
  };

  return {
    type: 'sqlite',

    async writeDrugs(drugs) {
      const database = await getDb();
      const upsert = database.prepare(`
        INSERT OR REPLACE INTO drugs (
          id, active_substance, active_substance_normalized, trade_names,
          atc_code, reimbursement_type, reimbursement_status, aim_status,
          commercialised, clinical_benefit, is_oncology, sources,
          indications_raw, indications_structured, infomed_entries,
          hospital_spending, ema_approved, ema_indications, sns_covered,
          pap_status, pap_indication, pap_start_date,
          payload, fetched_at, updated_at
        ) VALUES (
          @id, @activeSubstance, @activeSubstanceNormalized, @tradeNames,
          @atcCode, @reimbursementType, @reimbursementStatus, @aimStatus,
          @commercialised, @clinicalBenefit, @isOncology, @sources,
          @indicationsRaw, @indicationsStructured, @infomedEntries,
          @hospitalSpending, @emaApproved, @emaIndications, @snsCovered,
          @papStatus, @papIndication, @papStartDate,
          @payload, @fetchedAt, @updatedAt
        )
      `);

      const insertMany = database.transaction((items) => {
        for (const drug of items) {
          upsert.run({
            id: drug.id,
            activeSubstance: drug.activeSubstance || '',
            activeSubstanceNormalized: drug.activeSubstanceNormalized || '',
            tradeNames: JSON.stringify(drug.tradeNames || []),
            atcCode: drug.atcCode || '',
            reimbursementType: drug.reimbursementType || '',
            reimbursementStatus: drug.status || '',
            aimStatus: drug.aimStatus || '',
            commercialised: drug.commercialised || '',
            clinicalBenefit: drug.clinicalBenefit || '',
            isOncology: drug.isOncology ? 1 : 0,
            sources: JSON.stringify(drug.sources || []),
            indicationsRaw: JSON.stringify(drug.indications || []),
            indicationsStructured: JSON.stringify(drug.indicationsStructured || []),
            infomedEntries: JSON.stringify(drug.infomedEntries || []),
            hospitalSpending: JSON.stringify(drug.hospitalSpending || []),
            emaApproved: drug.emaApproved ? 1 : 0,
            emaIndications: JSON.stringify(drug.emaIndications || []),
            snsCovered: drug.snsCovered ? 1 : 0,
            papStatus: drug.papStatus || '',
            papIndication: drug.papIndication || '',
            papStartDate: drug.papStartDate || '',
            payload: JSON.stringify(drug),
            fetchedAt: drug.fetchedAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        }
      });

      insertMany(drugs);
      logger.info(`[ReimbursementStore] Wrote ${drugs.length} drugs to SQLite`);
    },

    async writeIndications(indications) {
      const database = await getDb();
      const upsert = database.prepare(`
        INSERT OR REPLACE INTO indications (
          id, drug_id, cancer_type, cancer_subtype, biomarker,
          line_of_therapy, stage, indication_text, reimbursement_status,
          source, confidence, llm_extracted
        ) VALUES (
          @id, @drugId, @cancerType, @cancerSubtype, @biomarker,
          @lineOfTherapy, @stage, @indicationText, @reimbursementStatus,
          @source, @confidence, @llmExtracted
        )
      `);

      const insertMany = database.transaction((items) => {
        for (const ind of items) {
          upsert.run({
            id: ind.id,
            drugId: ind.drugId,
            cancerType: ind.cancerType || '',
            cancerSubtype: ind.cancerSubtype || '',
            biomarker: ind.biomarker || '',
            lineOfTherapy: ind.lineOfTherapy || '',
            stage: ind.stage || '',
            indicationText: ind.indicationText || '',
            reimbursementStatus: ind.reimbursementStatus || '',
            source: ind.source || '',
            confidence: ind.confidence || 'low',
            llmExtracted: ind.llmExtracted ? 1 : 0
          });
        }
      });

      insertMany(indications);
      logger.info(`[ReimbursementStore] Wrote ${indications.length} structured indications`);
    },

    async writeSyncRun(run) {
      const database = await getDb();
      const stmt = database.prepare(`
        INSERT INTO sync_runs (started_at, completed_at, status, total_drugs, sources_summary, duration_ms, error)
        VALUES (@startedAt, @completedAt, @status, @totalDrugs, @sourcesSummary, @durationMs, @error)
      `);
      const info = stmt.run({
        startedAt: run.startedAt || new Date().toISOString(),
        completedAt: run.completedAt || '',
        status: run.status || 'completed',
        totalDrugs: run.totalDrugs || 0,
        sourcesSummary: JSON.stringify(run.sourcesSummary || {}),
        durationMs: run.durationMs || 0,
        error: run.error || ''
      });
      return info.lastInsertRowid;
    },

    async searchDrugs({ substance, atcCode, reimbursementType, oncologyOnly = true, limit = 50, offset = 0 }) {
      const database = await getDb();
      let sql = 'SELECT payload FROM drugs WHERE 1=1';
      const params = {};

      if (oncologyOnly) {
        sql += ' AND is_oncology = 1';
      }
      if (substance) {
        sql += ' AND (active_substance_normalized LIKE @substance OR trade_names LIKE @substanceTrade)';
        params.substance = `%${substance.toLowerCase()}%`;
        params.substanceTrade = `%${substance}%`;
      }
      if (atcCode) {
        sql += ' AND atc_code LIKE @atcCode';
        params.atcCode = `${atcCode}%`;
      }
      if (reimbursementType) {
        sql += ' AND reimbursement_type = @reimbursementType';
        params.reimbursementType = reimbursementType;
      }

      sql += ' ORDER BY active_substance_normalized ASC LIMIT @limit OFFSET @offset';
      params.limit = limit;
      params.offset = offset;

      const rows = database.prepare(sql).all(params);
      return rows.map((r) => parseJsonPayload(r.payload)).filter(Boolean);
    },

    async findBySubstance(substanceNormalized) {
      const database = await getDb();
      const row = database.prepare(
        'SELECT payload FROM drugs WHERE active_substance_normalized = ?'
      ).get(substanceNormalized);
      return row ? parseJsonPayload(row.payload) : null;
    },

    async getIndicationsForDrug(drugId) {
      const database = await getDb();
      return database.prepare(
        'SELECT * FROM indications WHERE drug_id = ? ORDER BY cancer_type, line_of_therapy'
      ).all(drugId);
    },

    async searchIndications({ cancerType, cancerTypeAliases, biomarker, lineOfTherapy, substance, limit = 50 }) {
      const database = await getDb();
      let sql = `
        SELECT i.*, d.active_substance, d.trade_names, d.reimbursement_type, d.reimbursement_status
        FROM indications i
        JOIN drugs d ON i.drug_id = d.id
        WHERE 1=1
      `;
      const params = {};

      // Cancer type — expand with synonyms for much broader recall
      // e.g. "NSCLC" → also matches "non-small cell lung cancer" stored in the DB
      if (cancerType || (cancerTypeAliases && cancerTypeAliases.length)) {
        const allAliases = cancerTypeAliases && cancerTypeAliases.length
          ? cancerTypeAliases
          : [cancerType];
        const cancerClauses = allAliases.map((_, idx) => `i.cancer_type LIKE @ct${idx}`);
        sql += ` AND (${cancerClauses.join(' OR ')})`;
        allAliases.forEach((alias, idx) => {
          params[`ct${idx}`] = `%${alias}%`;
        });
      }

      if (biomarker) {
        sql += ' AND i.biomarker LIKE @biomarker';
        params.biomarker = `%${biomarker}%`;
      }
      if (lineOfTherapy) {
        // When searching for a later line (2L, 2L+, 3L), also return earlier-line
        // and "any line" indications — a drug approved in 1L is always relevant
        // context when asking about 2L+. The context summary will flag the
        // discrepancy so the LLM can report accurately.
        const lineAliases = [lineOfTherapy];
        if (/^2l/i.test(lineOfTherapy) || /^3l/i.test(lineOfTherapy)) {
          lineAliases.push('1L', 'any line');
          if (/^3l/i.test(lineOfTherapy)) lineAliases.push('2L');
        }
        if (/^2l\+/i.test(lineOfTherapy)) {
          lineAliases.push('2L', '3L');
        }
        const lineClauses = lineAliases.map((_, idx) => `i.line_of_therapy LIKE @lineAlias${idx}`);
        sql += ` AND (${lineClauses.join(' OR ')})`;
        lineAliases.forEach((alias, idx) => {
          params[`lineAlias${idx}`] = `%${alias}%`;
        });
      }
      if (substance) {
        sql += ' AND d.active_substance_normalized LIKE @substance';
        params.substance = `%${substance.toLowerCase()}%`;
      }

      sql += ' ORDER BY i.confidence DESC, i.cancer_type LIMIT @limit';
      params.limit = limit;

      return database.prepare(sql).all(params);
    },

    async getAllDrugs() {
      const database = await getDb();
      const rows = database.prepare('SELECT payload FROM drugs WHERE is_oncology = 1 ORDER BY active_substance_normalized').all();
      return rows.map((r) => parseJsonPayload(r.payload)).filter(Boolean);
    },

    async getLastSyncRun() {
      const database = await getDb();
      return database.prepare(
        'SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1'
      ).get() || null;
    },

    async getDrugCount() {
      const database = await getDb();
      const row = database.prepare('SELECT COUNT(*) as count FROM drugs WHERE is_oncology = 1').get();
      return row?.count || 0;
    },

    async getIndicationCount() {
      const database = await getDb();
      const row = database.prepare('SELECT COUNT(*) as count FROM indications').get();
      return row?.count || 0;
    },

    async close() {
      if (db) {
        db.close();
        db = null;
      }
    }
  };
};

// ---- File store (fallback) -------------------------------------------------

const createFileStore = (options, logger) => {
  const filePath = resolvePath(options.filePath, './data/infarmed_reimbursement_snapshot.json');

  const readSnapshot = () => {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return parseJsonPayload(raw);
  };

  const writeSnapshot = (data) => {
    ensureDir(filePath);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  };

  return {
    type: 'file',

    async writeDrugs(drugs) {
      const snapshot = readSnapshot() || { drugs: [], indications: [], syncRuns: [] };
      snapshot.drugs = drugs;
      writeSnapshot(snapshot);
      logger.info(`[ReimbursementStore] Wrote ${drugs.length} drugs to file`);
    },

    async writeIndications(indications) {
      const snapshot = readSnapshot() || { drugs: [], indications: [], syncRuns: [] };
      snapshot.indications = indications;
      writeSnapshot(snapshot);
    },

    async writeSyncRun(run) {
      const snapshot = readSnapshot() || { drugs: [], indications: [], syncRuns: [] };
      snapshot.syncRuns = snapshot.syncRuns || [];
      snapshot.syncRuns.push(run);
      writeSnapshot(snapshot);
    },

    async searchDrugs({ substance, oncologyOnly = true }) {
      const snapshot = readSnapshot();
      if (!snapshot?.drugs) return [];
      let drugs = snapshot.drugs;
      if (oncologyOnly) drugs = drugs.filter((d) => d.isOncology !== false);
      if (substance) {
        const norm = substance.toLowerCase();
        drugs = drugs.filter((d) =>
          (d.activeSubstanceNormalized || '').includes(norm) ||
          (d.tradeNames || []).some((t) => t.toLowerCase().includes(norm))
        );
      }
      return drugs;
    },

    async findBySubstance(substanceNormalized) {
      const snapshot = readSnapshot();
      return snapshot?.drugs?.find((d) => d.activeSubstanceNormalized === substanceNormalized) || null;
    },

    async getIndicationsForDrug(drugId) {
      const snapshot = readSnapshot();
      return (snapshot?.indications || []).filter((i) => i.drugId === drugId);
    },

    async searchIndications({ cancerType, cancerTypeAliases, biomarker, lineOfTherapy, substance }) {
      const snapshot = readSnapshot();
      let indications = snapshot?.indications || [];
      if (cancerType || (cancerTypeAliases && cancerTypeAliases.length)) {
        const aliases = cancerTypeAliases && cancerTypeAliases.length ? cancerTypeAliases : [cancerType];
        indications = indications.filter((i) => {
          const ct = (i.cancerType || '').toLowerCase();
          return aliases.some((a) => ct.includes(a.toLowerCase()));
        });
      }
      if (biomarker) indications = indications.filter((i) => (i.biomarker || '').toLowerCase().includes(biomarker.toLowerCase()));
      if (lineOfTherapy) {
        const lineAliases = [lineOfTherapy.toLowerCase()];
        if (/^2l/i.test(lineOfTherapy) || /^3l/i.test(lineOfTherapy)) {
          lineAliases.push('1l', 'any line');
          if (/^3l/i.test(lineOfTherapy)) lineAliases.push('2l');
        }
        if (/^2l\+/i.test(lineOfTherapy)) lineAliases.push('2l', '3l');
        indications = indications.filter((i) => {
          const indLine = (i.lineOfTherapy || '').toLowerCase();
          return lineAliases.some((alias) => indLine.includes(alias));
        });
      }
      return indications;
    },

    async getAllDrugs() {
      const snapshot = readSnapshot();
      return (snapshot?.drugs || []).filter((d) => d.isOncology !== false);
    },

    async getLastSyncRun() {
      const snapshot = readSnapshot();
      const runs = snapshot?.syncRuns || [];
      return runs[runs.length - 1] || null;
    },

    async getDrugCount() {
      const drugs = await this.getAllDrugs();
      return drugs.length;
    },

    async getIndicationCount() {
      const snapshot = readSnapshot();
      return (snapshot?.indications || []).length;
    },

    async close() { }
  };
};

// ---- Factory ---------------------------------------------------------------

export const createInfarmedReimbursementStore = (options = {}, logger = console) => {
  const storeType = resolveStoreType(options);

  if (storeType === 'sqlite') {
    return createSQLiteStore(options, logger);
  }

  return createFileStore(options, logger);
};
