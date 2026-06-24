import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// EMA Store — persistence layer for EMA marketing authorisation data.
// Follows the same multi-store pattern as infarmedReimbursementStore.js
// (SQLite primary, file fallback).
// ---------------------------------------------------------------------------

const DEFAULT_PREFIX = 'ema_products';

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
  const dbPath = resolvePath(options.sqlitePath, './data/ema_products.sqlite');
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
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        medicine_name TEXT NOT NULL,
        active_substance TEXT NOT NULL,
        active_substance_normalized TEXT NOT NULL,
        atc_code TEXT DEFAULT '',
        therapeutic_area TEXT DEFAULT '',
        authorization_status TEXT DEFAULT '',
        approval_date TEXT DEFAULT '',
        authorization_holder TEXT DEFAULT '',
        orphan_medicine INTEGER DEFAULT 0,
        condition_indication TEXT DEFAULT '',
        url TEXT DEFAULT '',
        generic_biosimilar TEXT DEFAULT '',
        is_oncology INTEGER DEFAULT 1,
        indications_structured TEXT DEFAULT '[]',
        payload TEXT NOT NULL,
        fetched_at TEXT DEFAULT '',
        updated_at TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS indications (
        id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        cancer_type TEXT NOT NULL,
        cancer_subtype TEXT DEFAULT '',
        biomarker TEXT DEFAULT '',
        line_of_therapy TEXT DEFAULT '',
        stage TEXT DEFAULT '',
        indication_text TEXT DEFAULT '',
        approval_date TEXT DEFAULT '',
        source TEXT DEFAULT '',
        confidence TEXT DEFAULT 'low',
        llm_extracted INTEGER DEFAULT 0,
        PRIMARY KEY (id, product_id),
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sync_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        completed_at TEXT DEFAULT '',
        status TEXT DEFAULT 'running',
        total_products INTEGER DEFAULT 0,
        sources_summary TEXT DEFAULT '{}',
        duration_ms INTEGER DEFAULT 0,
        error TEXT DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_products_substance ON products(active_substance_normalized);
      CREATE INDEX IF NOT EXISTS idx_products_atc ON products(atc_code);
      CREATE INDEX IF NOT EXISTS idx_products_auth_status ON products(authorization_status);
      CREATE INDEX IF NOT EXISTS idx_products_oncology ON products(is_oncology);
      CREATE INDEX IF NOT EXISTS idx_ema_indications_cancer ON indications(cancer_type);
      CREATE INDEX IF NOT EXISTS idx_ema_indications_biomarker ON indications(biomarker);
      CREATE INDEX IF NOT EXISTS idx_ema_indications_line ON indications(line_of_therapy);
      CREATE INDEX IF NOT EXISTS idx_ema_indications_product ON indications(product_id);
    `);
  };

  return {
    type: 'sqlite',

    async writeProducts(products) {
      const database = await getDb();
      const upsert = database.prepare(`
        INSERT OR REPLACE INTO products (
          id, medicine_name, active_substance, active_substance_normalized,
          atc_code, therapeutic_area, authorization_status, approval_date,
          authorization_holder, orphan_medicine, condition_indication, url,
          generic_biosimilar, is_oncology, indications_structured,
          payload, fetched_at, updated_at
        ) VALUES (
          @id, @medicineName, @activeSubstance, @activeSubstanceNormalized,
          @atcCode, @therapeuticArea, @authorizationStatus, @approvalDate,
          @authorizationHolder, @orphanMedicine, @conditionIndication, @url,
          @genericBiosimilar, @isOncology, @indicationsStructured,
          @payload, @fetchedAt, @updatedAt
        )
      `);

      const insertMany = database.transaction((items) => {
        for (const product of items) {
          upsert.run({
            id: product.id,
            medicineName: product.medicineName || '',
            activeSubstance: product.activeSubstance || '',
            activeSubstanceNormalized: product.activeSubstanceNormalized || '',
            atcCode: product.atcCode || '',
            therapeuticArea: product.therapeuticArea || '',
            authorizationStatus: product.authorizationStatus || '',
            approvalDate: product.approvalDate || '',
            authorizationHolder: product.authorizationHolder || '',
            orphanMedicine: product.orphanMedicine ? 1 : 0,
            conditionIndication: product.conditionIndication || '',
            url: product.url || '',
            genericBiosimilar: product.genericBiosimilar || '',
            isOncology: product.isOncology ? 1 : 0,
            indicationsStructured: JSON.stringify(product.indicationsStructured || []),
            payload: JSON.stringify(product),
            fetchedAt: product.fetchedAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        }
      });

      insertMany(products);
      logger.info(`[EmaStore] Wrote ${products.length} products to SQLite`);
    },

    async writeIndications(indications) {
      const database = await getDb();
      const upsert = database.prepare(`
        INSERT OR REPLACE INTO indications (
          id, product_id, cancer_type, cancer_subtype, biomarker,
          line_of_therapy, stage, indication_text, approval_date,
          source, confidence, llm_extracted
        ) VALUES (
          @id, @productId, @cancerType, @cancerSubtype, @biomarker,
          @lineOfTherapy, @stage, @indicationText, @approvalDate,
          @source, @confidence, @llmExtracted
        )
      `);

      const insertMany = database.transaction((items) => {
        for (const ind of items) {
          upsert.run({
            id: ind.id,
            productId: ind.productId,
            cancerType: ind.cancerType || '',
            cancerSubtype: ind.cancerSubtype || '',
            biomarker: ind.biomarker || '',
            lineOfTherapy: ind.lineOfTherapy || '',
            stage: ind.stage || '',
            indicationText: ind.indicationText || '',
            approvalDate: ind.approvalDate || '',
            source: ind.source || '',
            confidence: ind.confidence || 'low',
            llmExtracted: ind.llmExtracted ? 1 : 0
          });
        }
      });

      insertMany(indications);
      logger.info(`[EmaStore] Wrote ${indications.length} structured indications`);
    },

    async writeSyncRun(run) {
      const database = await getDb();
      const stmt = database.prepare(`
        INSERT INTO sync_runs (started_at, completed_at, status, total_products, sources_summary, duration_ms, error)
        VALUES (@startedAt, @completedAt, @status, @totalProducts, @sourcesSummary, @durationMs, @error)
      `);
      const info = stmt.run({
        startedAt: run.startedAt || new Date().toISOString(),
        completedAt: run.completedAt || '',
        status: run.status || 'completed',
        totalProducts: run.totalProducts || 0,
        sourcesSummary: JSON.stringify(run.sourcesSummary || {}),
        durationMs: run.durationMs || 0,
        error: run.error || ''
      });
      return info.lastInsertRowid;
    },

    async searchProducts({ substance, atcCode, authorizationStatus, oncologyOnly = true, limit = 50, offset = 0 }) {
      const database = await getDb();
      let sql = 'SELECT payload FROM products WHERE 1=1';
      const params = {};

      if (oncologyOnly) {
        sql += ' AND is_oncology = 1';
      }
      if (substance) {
        sql += ' AND (active_substance_normalized LIKE @substance OR medicine_name LIKE @substanceName)';
        params.substance = `%${substance.toLowerCase()}%`;
        params.substanceName = `%${substance}%`;
      }
      if (atcCode) {
        sql += ' AND atc_code LIKE @atcCode';
        params.atcCode = `${atcCode}%`;
      }
      if (authorizationStatus) {
        sql += ' AND authorization_status LIKE @authorizationStatus';
        params.authorizationStatus = `%${authorizationStatus}%`;
      }

      sql += ' ORDER BY active_substance_normalized ASC LIMIT @limit OFFSET @offset';
      params.limit = limit;
      params.offset = offset;

      const rows = database.prepare(sql).all(params);
      return rows.map((r) => parseJsonPayload(r.payload)).filter(Boolean);
    },

    async findBySubstance(substanceNormalized) {
      const database = await getDb();
      const rows = database.prepare(
        'SELECT payload FROM products WHERE active_substance_normalized = ?'
      ).all(substanceNormalized);
      return rows.map((r) => parseJsonPayload(r.payload)).filter(Boolean);
    },

    async getIndicationsForProduct(productId) {
      const database = await getDb();
      return database.prepare(
        'SELECT * FROM indications WHERE product_id = ? ORDER BY cancer_type, line_of_therapy'
      ).all(productId);
    },

    async searchIndications({ cancerType, biomarker, lineOfTherapy, substance, limit = 50 }) {
      const database = await getDb();
      let sql = `
        SELECT i.*, p.active_substance, p.medicine_name, p.authorization_status, p.approval_date
        FROM indications i
        JOIN products p ON i.product_id = p.id
        WHERE 1=1
      `;
      const params = {};

      if (cancerType) {
        sql += ' AND i.cancer_type LIKE @cancerType';
        params.cancerType = `%${cancerType}%`;
      }
      if (biomarker) {
        sql += ' AND i.biomarker LIKE @biomarker';
        params.biomarker = `%${biomarker}%`;
      }
      if (lineOfTherapy) {
        sql += ' AND i.line_of_therapy LIKE @lineOfTherapy';
        params.lineOfTherapy = `%${lineOfTherapy}%`;
      }
      if (substance) {
        sql += ' AND p.active_substance_normalized LIKE @substance';
        params.substance = `%${substance.toLowerCase()}%`;
      }

      sql += ' ORDER BY i.confidence DESC, i.cancer_type LIMIT @limit';
      params.limit = limit;

      return database.prepare(sql).all(params);
    },

    async getAllProducts() {
      const database = await getDb();
      const rows = database.prepare('SELECT payload FROM products WHERE is_oncology = 1 ORDER BY active_substance_normalized').all();
      return rows.map((r) => parseJsonPayload(r.payload)).filter(Boolean);
    },

    async getLastSyncRun() {
      const database = await getDb();
      return database.prepare(
        'SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1'
      ).get() || null;
    },

    async getProductCount() {
      const database = await getDb();
      const row = database.prepare('SELECT COUNT(*) as count FROM products WHERE is_oncology = 1').get();
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
  const filePath = resolvePath(options.filePath, './data/ema_products_snapshot.json');

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

    async writeProducts(products) {
      const snapshot = readSnapshot() || { products: [], indications: [], syncRuns: [] };
      snapshot.products = products;
      writeSnapshot(snapshot);
      logger.info(`[EmaStore] Wrote ${products.length} products to file`);
    },

    async writeIndications(indications) {
      const snapshot = readSnapshot() || { products: [], indications: [], syncRuns: [] };
      snapshot.indications = indications;
      writeSnapshot(snapshot);
    },

    async writeSyncRun(run) {
      const snapshot = readSnapshot() || { products: [], indications: [], syncRuns: [] };
      snapshot.syncRuns = snapshot.syncRuns || [];
      snapshot.syncRuns.push(run);
      writeSnapshot(snapshot);
    },

    async searchProducts({ substance, oncologyOnly = true }) {
      const snapshot = readSnapshot();
      if (!snapshot?.products) return [];
      let products = snapshot.products;
      if (oncologyOnly) products = products.filter((p) => p.isOncology !== false);
      if (substance) {
        const norm = substance.toLowerCase();
        products = products.filter((p) =>
          (p.activeSubstanceNormalized || '').includes(norm) ||
          (p.medicineName || '').toLowerCase().includes(norm)
        );
      }
      return products;
    },

    async findBySubstance(substanceNormalized) {
      const snapshot = readSnapshot();
      return (snapshot?.products || []).filter((p) => p.activeSubstanceNormalized === substanceNormalized);
    },

    async getIndicationsForProduct(productId) {
      const snapshot = readSnapshot();
      return (snapshot?.indications || []).filter((i) => i.productId === productId);
    },

    async searchIndications({ cancerType, biomarker, lineOfTherapy, substance }) {
      const snapshot = readSnapshot();
      let indications = snapshot?.indications || [];
      if (cancerType) indications = indications.filter((i) => (i.cancerType || '').toLowerCase().includes(cancerType.toLowerCase()));
      if (biomarker) indications = indications.filter((i) => (i.biomarker || '').toLowerCase().includes(biomarker.toLowerCase()));
      if (lineOfTherapy) indications = indications.filter((i) => (i.lineOfTherapy || '').toLowerCase().includes(lineOfTherapy.toLowerCase()));
      return indications;
    },

    async getAllProducts() {
      const snapshot = readSnapshot();
      return (snapshot?.products || []).filter((p) => p.isOncology !== false);
    },

    async getLastSyncRun() {
      const snapshot = readSnapshot();
      const runs = snapshot?.syncRuns || [];
      return runs[runs.length - 1] || null;
    },

    async getProductCount() {
      const products = await this.getAllProducts();
      return products.length;
    },

    async getIndicationCount() {
      const snapshot = readSnapshot();
      return (snapshot?.indications || []).length;
    },

    async close() { }
  };
};

// ---- Factory ---------------------------------------------------------------

export const createEmaStore = (options = {}, logger = console) => {
  const storeType = resolveStoreType(options);

  if (storeType === 'sqlite') {
    return createSQLiteStore(options, logger);
  }

  return createFileStore(options, logger);
};
