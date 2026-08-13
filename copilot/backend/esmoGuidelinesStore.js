import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// ESMO Guidelines Store — persistence layer for structured guideline
// recommendations extracted from ESMO PDFs. Follows the same multi-store
// pattern as infarmedReimbursementStore.js (SQLite primary, file fallback).
// ---------------------------------------------------------------------------

const resolveStoreType = (options) => {
  const explicit = String(options.store || '').trim().toLowerCase();
  if (explicit === 'sqlite' || explicit === 'sqlite3') return 'sqlite';
  if (explicit === 'file' || explicit === 'json') return 'file';
  return 'sqlite';
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
  const dbPath = resolvePath(options.sqlitePath, './data/esmo_guidelines.sqlite');
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
      CREATE TABLE IF NOT EXISTS guidelines (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        cancer_type TEXT NOT NULL,
        version TEXT DEFAULT '',
        upload_date TEXT DEFAULT '',
        pdf_hash TEXT DEFAULT '',
        file_path TEXT DEFAULT '',
        status TEXT DEFAULT 'pending',
        total_recommendations INTEGER DEFAULT 0,
        payload TEXT DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS recommendations (
        id TEXT NOT NULL,
        guideline_id TEXT NOT NULL,
        drug TEXT DEFAULT '',
        cancer_type TEXT NOT NULL,
        cancer_subtype TEXT DEFAULT '',
        biomarker TEXT DEFAULT '',
        line_of_therapy TEXT DEFAULT '',
        stage TEXT DEFAULT '',
        esmo_mcbs_score TEXT DEFAULT '',
        escat_score TEXT DEFAULT '',
        level_of_evidence TEXT DEFAULT '',
        grade_of_recommendation TEXT DEFAULT '',
        recommendation_text TEXT DEFAULT '',
        combination TEXT DEFAULT '',
        source_page TEXT DEFAULT '',
        confidence TEXT DEFAULT 'medium',
        PRIMARY KEY (id, guideline_id),
        FOREIGN KEY (guideline_id) REFERENCES guidelines(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sync_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        completed_at TEXT DEFAULT '',
        status TEXT DEFAULT 'running',
        guideline_id TEXT DEFAULT '',
        total_recommendations INTEGER DEFAULT 0,
        duration_ms INTEGER DEFAULT 0,
        error TEXT DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_esmo_guidelines_cancer ON guidelines(cancer_type);
      CREATE INDEX IF NOT EXISTS idx_esmo_rec_cancer ON recommendations(cancer_type);
      CREATE INDEX IF NOT EXISTS idx_esmo_rec_drug ON recommendations(drug);
      CREATE INDEX IF NOT EXISTS idx_esmo_rec_biomarker ON recommendations(biomarker);
      CREATE INDEX IF NOT EXISTS idx_esmo_rec_line ON recommendations(line_of_therapy);
      CREATE INDEX IF NOT EXISTS idx_esmo_rec_guideline ON recommendations(guideline_id);
      CREATE INDEX IF NOT EXISTS idx_esmo_rec_mcbs ON recommendations(esmo_mcbs_score);
    `);
  };

  return {
    type: 'sqlite',

    async writeGuideline(guideline) {
      const database = await getDb();
      const upsert = database.prepare(`
        INSERT OR REPLACE INTO guidelines (
          id, title, cancer_type, version, upload_date, pdf_hash,
          file_path, status, total_recommendations, payload
        ) VALUES (
          @id, @title, @cancerType, @version, @uploadDate, @pdfHash,
          @filePath, @status, @totalRecommendations, @payload
        )
      `);
      upsert.run({
        id: guideline.id,
        title: guideline.title || '',
        cancerType: guideline.cancerType || '',
        version: guideline.version || '',
        uploadDate: guideline.uploadDate || new Date().toISOString(),
        pdfHash: guideline.pdfHash || '',
        filePath: guideline.filePath || '',
        status: guideline.status || 'pending',
        totalRecommendations: guideline.totalRecommendations || 0,
        payload: JSON.stringify(guideline)
      });
      logger.info(`[EsmoStore] Wrote guideline: ${guideline.title}`);
    },

    async updateGuidelineStatus(id, status, totalRecommendations) {
      const database = await getDb();
      database.prepare(
        'UPDATE guidelines SET status = ?, total_recommendations = ? WHERE id = ?'
      ).run(status, totalRecommendations || 0, id);
      logger.info(`[EsmoStore] Updated guideline ${id} status to ${status}`);
    },

    async writeRecommendations(recommendations) {
      const database = await getDb();
      const upsert = database.prepare(`
        INSERT OR REPLACE INTO recommendations (
          id, guideline_id, drug, cancer_type, cancer_subtype, biomarker,
          line_of_therapy, stage, esmo_mcbs_score, escat_score,
          level_of_evidence, grade_of_recommendation, recommendation_text,
          combination, source_page, confidence
        ) VALUES (
          @id, @guidelineId, @drug, @cancerType, @cancerSubtype, @biomarker,
          @lineOfTherapy, @stage, @esmoMcbsScore, @escatScore,
          @levelOfEvidence, @gradeOfRecommendation, @recommendationText,
          @combination, @sourcePage, @confidence
        )
      `);

      let written = 0;
      for (const rec of recommendations) {
        try {
          upsert.run({
            id: rec.id,
            guidelineId: rec.guidelineId,
            drug: rec.drug || '',
            cancerType: rec.cancerType || '',
            cancerSubtype: rec.cancerSubtype || '',
            biomarker: rec.biomarker || '',
            lineOfTherapy: rec.lineOfTherapy || '',
            stage: rec.stage || '',
            esmoMcbsScore: rec.esmoMcbsScore || '',
            escatScore: rec.escatScore || '',
            levelOfEvidence: rec.levelOfEvidence || '',
            gradeOfRecommendation: rec.gradeOfRecommendation || '',
            recommendationText: rec.recommendationText || '',
            combination: rec.combination || '',
            sourcePage: rec.sourcePage || '',
            confidence: rec.confidence || 'medium'
          });
          written++;
        } catch (runErr) {
          logger.error(`[EsmoStore] Failed to insert rec ${rec.id}: ${runErr.message}`);
        }
      }
      logger.info(`[EsmoStore] Wrote ${written}/${recommendations.length} recommendations`);
    },

    async writeSyncRun(run) {
      const database = await getDb();
      const stmt = database.prepare(`
        INSERT INTO sync_runs (started_at, completed_at, status, guideline_id, total_recommendations, duration_ms, error)
        VALUES (@startedAt, @completedAt, @status, @guidelineId, @totalRecommendations, @durationMs, @error)
      `);
      stmt.run({
        startedAt: run.startedAt || new Date().toISOString(),
        completedAt: run.completedAt || '',
        status: run.status || 'completed',
        guidelineId: run.guidelineId || '',
        totalRecommendations: run.totalRecommendations || 0,
        durationMs: run.durationMs || 0,
        error: run.error || ''
      });
    },

    async searchRecommendations({ cancerType, biomarker, lineOfTherapy, drug, substance, limit = 50 }) {
      const database = await getDb();
      let sql = 'SELECT r.*, g.title as guideline_title, g.version as guideline_version, g.payload as guideline_payload FROM recommendations r JOIN guidelines g ON r.guideline_id = g.id WHERE 1=1';
      const params = {};

      if (cancerType) {
        sql += ' AND r.cancer_type LIKE @cancerType';
        params.cancerType = `%${cancerType}%`;
      }
      if (biomarker) {
        sql += ' AND r.biomarker LIKE @biomarker';
        params.biomarker = `%${biomarker}%`;
      }
      if (lineOfTherapy) {
        sql += ' AND r.line_of_therapy LIKE @lineOfTherapy';
        params.lineOfTherapy = `%${lineOfTherapy}%`;
      }
      if (drug || substance) {
        sql += ' AND r.drug LIKE @drug';
        params.drug = `%${drug || substance}%`;
      }

      sql += ' ORDER BY r.confidence DESC, r.cancer_type LIMIT @limit';
      params.limit = limit;

      return database.prepare(sql).all(params);
    },

    async getGuidelines() {
      const database = await getDb();
      return database.prepare('SELECT * FROM guidelines ORDER BY upload_date DESC').all();
    },

    async getGuideline(id) {
      const database = await getDb();
      return database.prepare('SELECT * FROM guidelines WHERE id = ?').get(id) || null;
    },

    async deleteGuideline(id) {
      const database = await getDb();
      database.prepare('DELETE FROM guidelines WHERE id = ?').run(id);
      logger.info(`[EsmoStore] Deleted guideline: ${id}`);
    },

    async getRecommendationCount() {
      const database = await getDb();
      const row = database.prepare('SELECT COUNT(*) as count FROM recommendations').get();
      return row?.count || 0;
    },

    async getGuidelineCount() {
      const database = await getDb();
      const row = database.prepare('SELECT COUNT(*) as count FROM guidelines').get();
      return row?.count || 0;
    },

    async getLastSyncRun() {
      const database = await getDb();
      return database.prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1').get() || null;
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
  const filePath = resolvePath(options.filePath, './data/esmo_guidelines_snapshot.json');

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

    async writeGuideline(guideline) {
      const snapshot = readSnapshot() || { guidelines: [], recommendations: [], syncRuns: [] };
      const idx = snapshot.guidelines.findIndex((g) => g.id === guideline.id);
      if (idx >= 0) snapshot.guidelines[idx] = guideline;
      else snapshot.guidelines.push(guideline);
      writeSnapshot(snapshot);
      logger.info(`[EsmoStore] Wrote guideline: ${guideline.title}`);
    },

    async writeRecommendations(recommendations) {
      const snapshot = readSnapshot() || { guidelines: [], recommendations: [], syncRuns: [] };
      // Remove old recs for same guideline, then add new ones
      const guidelineIds = new Set(recommendations.map((r) => r.guidelineId));
      snapshot.recommendations = snapshot.recommendations.filter((r) => !guidelineIds.has(r.guidelineId));
      snapshot.recommendations.push(...recommendations);
      writeSnapshot(snapshot);
    },

    async writeSyncRun(run) {
      const snapshot = readSnapshot() || { guidelines: [], recommendations: [], syncRuns: [] };
      snapshot.syncRuns.push(run);
      writeSnapshot(snapshot);
    },

    async searchRecommendations({ cancerType, biomarker, lineOfTherapy, drug, substance }) {
      const snapshot = readSnapshot();
      let recs = snapshot?.recommendations || [];
      if (cancerType) recs = recs.filter((r) => (r.cancerType || '').toLowerCase().includes(cancerType.toLowerCase()));
      if (biomarker) recs = recs.filter((r) => (r.biomarker || '').toLowerCase().includes(biomarker.toLowerCase()));
      if (lineOfTherapy) recs = recs.filter((r) => (r.lineOfTherapy || '').toLowerCase().includes(lineOfTherapy.toLowerCase()));
      if (drug || substance) recs = recs.filter((r) => (r.drug || '').toLowerCase().includes((drug || substance).toLowerCase()));
      return recs;
    },

    async getGuidelines() {
      const snapshot = readSnapshot();
      return snapshot?.guidelines || [];
    },

    async getGuideline(id) {
      const snapshot = readSnapshot();
      return (snapshot?.guidelines || []).find((g) => g.id === id) || null;
    },

    async deleteGuideline(id) {
      const snapshot = readSnapshot() || { guidelines: [], recommendations: [], syncRuns: [] };
      snapshot.guidelines = snapshot.guidelines.filter((g) => g.id !== id);
      snapshot.recommendations = snapshot.recommendations.filter((r) => r.guidelineId !== id);
      writeSnapshot(snapshot);
    },

    async getRecommendationCount() {
      const snapshot = readSnapshot();
      return (snapshot?.recommendations || []).length;
    },

    async getGuidelineCount() {
      const snapshot = readSnapshot();
      return (snapshot?.guidelines || []).length;
    },

    async getLastSyncRun() {
      const snapshot = readSnapshot();
      const runs = snapshot?.syncRuns || [];
      return runs[runs.length - 1] || null;
    },

    async close() { }
  };
};

// ---- Factory ---------------------------------------------------------------

export const createEsmoGuidelinesStore = (options = {}, logger = console) => {
  const storeType = resolveStoreType(options);

  if (storeType === 'sqlite') {
    return createSQLiteStore(options, logger);
  }

  return createFileStore(options, logger);
};
