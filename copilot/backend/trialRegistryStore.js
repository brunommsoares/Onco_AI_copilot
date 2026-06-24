import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DEFAULT_PREFIX = "trial_registry";

const resolveStoreType = (options, firebaseAdmin) => {
  const explicit = String(options.store || "").trim().toLowerCase();
  if (explicit) {
    if (explicit === "firebase" || explicit === "firestore") return "firestore";
    if (explicit === "postgres" || explicit === "postgresql") return "postgres";
    if (explicit === "sqlite" || explicit === "sqlite3") return "sqlite";
    if (explicit === "file" || explicit === "json") return "file";
    return explicit;
  }
  if (firebaseAdmin) return "firestore";
  return "file";
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
  if (typeof payload === "object") return payload;
  try {
    return JSON.parse(payload);
  } catch (error) {
    return null;
  }
};

const applyPagination = (items, limit, offset) => {
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeLimit = Math.max(0, Number(limit) || 0);
  if (!safeLimit) return items.slice(safeOffset);
  return items.slice(safeOffset, safeOffset + safeLimit);
};

const buildCollectionNames = (prefix) => {
  const safePrefix = prefix || DEFAULT_PREFIX;
  return {
    trials: `${safePrefix}_trials`,
    sites: `${safePrefix}_sites`,
    conditions: `${safePrefix}_conditions`,
    runs: `${safePrefix}_runs`
  };
};

const chunkArray = (items, size) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const createFileStore = (options, logger) => {
  const filePath = resolvePath(
    options.filePath,
    "./data/trial_registry_snapshot.json"
  );

  const readSnapshot = () => {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    return parseJsonPayload(raw);
  };

  return {
    type: "file",
    async writeSnapshot(snapshot) {
      if (!filePath) throw new Error("Trial registry file path is not configured");
      ensureDir(filePath);
      fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
      logger.warn(`[TrialRegistry] Snapshot saved to ${filePath}`);
    },
    async getSites({ limit, offset } = {}) {
      const snapshot = readSnapshot();
      const sites = snapshot?.sites || [];
      return applyPagination(sites, limit, offset);
    },
    async getSite(siteKey) {
      const snapshot = readSnapshot();
      const sites = snapshot?.sites || [];
      return sites.find(site => site.siteKey === siteKey) || null;
    },
    async getConditions({ limit, offset } = {}) {
      const snapshot = readSnapshot();
      const conditions = snapshot?.conditions || [];
      return applyPagination(conditions, limit, offset);
    },
    async getCondition(conditionKey) {
      const snapshot = readSnapshot();
      const conditions = snapshot?.conditions || [];
      return conditions.find(condition => condition.conditionKey === conditionKey) || null;
    },
    async getTrials({ limit, offset } = {}) {
      const snapshot = readSnapshot();
      const trials = snapshot?.trials || [];
      return applyPagination(trials, limit, offset);
    },
    async getTrial(trialId) {
      const snapshot = readSnapshot();
      const trials = snapshot?.trials || [];
      return trials.find(trial => trial.nctId === trialId) || null;
    },
    async getLatestRun() {
      const snapshot = readSnapshot();
      return snapshot?.meta || null;
    }
  };
};

const createFirestoreStore = (firebaseAdmin, options, logger) => {
  if (!firebaseAdmin) {
    throw new Error("Firebase Admin is not initialized");
  }

  const db = firebaseAdmin.firestore();
  const collections = buildCollectionNames(options.collectionPrefix);

  const deleteCollection = async (collectionName) => {
    const snapshot = await db.collection(collectionName).get();
    if (snapshot.empty) return;
    const docs = snapshot.docs;
    const chunks = chunkArray(docs, 400);
    for (const chunk of chunks) {
      const batch = db.batch();
      chunk.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
  };

  const writeCollection = async (collectionName, docs, idField) => {
    const chunks = chunkArray(docs, 400);
    for (const chunk of chunks) {
      const batch = db.batch();
      chunk.forEach(doc => {
        const docId = doc[idField];
        const ref = db.collection(collectionName).doc(docId);
        batch.set(ref, doc, { merge: false });
      });
      await batch.commit();
    }
  };

  const fetchCollection = async (collectionName) => {
    const snapshot = await db.collection(collectionName).get();
    return snapshot.docs.map(doc => doc.data());
  };

  return {
    type: "firestore",
    async writeSnapshot(snapshot) {
      await deleteCollection(collections.trials);
      await deleteCollection(collections.sites);
      await deleteCollection(collections.conditions);

      await writeCollection(collections.trials, snapshot.trials, "nctId");
      await writeCollection(collections.sites, snapshot.sites, "siteKey");
      await writeCollection(collections.conditions, snapshot.conditions, "conditionKey");

      await db.collection(collections.runs).add(snapshot.meta);
      logger.info(
        `[TrialRegistry] Snapshot stored in Firestore (${collections.trials}, ${collections.sites}, ${collections.conditions})`
      );
    },
    async getSites({ limit, offset } = {}) {
      const allSites = await fetchCollection(collections.sites);
      return applyPagination(allSites, limit, offset);
    },
    async getSite(siteKey) {
      const doc = await db.collection(collections.sites).doc(siteKey).get();
      return doc.exists ? doc.data() : null;
    },
    async getConditions({ limit, offset } = {}) {
      const allConditions = await fetchCollection(collections.conditions);
      return applyPagination(allConditions, limit, offset);
    },
    async getCondition(conditionKey) {
      const doc = await db.collection(collections.conditions).doc(conditionKey).get();
      return doc.exists ? doc.data() : null;
    },
    async getTrials({ limit, offset } = {}) {
      const allTrials = await fetchCollection(collections.trials);
      return applyPagination(allTrials, limit, offset);
    },
    async getTrial(trialId) {
      const doc = await db.collection(collections.trials).doc(trialId).get();
      return doc.exists ? doc.data() : null;
    },
    async getLatestRun() {
      const snapshot = await db
        .collection(collections.runs)
        .orderBy("finishedAt", "desc")
        .limit(1)
        .get();
      if (snapshot.empty) return null;
      return snapshot.docs[0].data();
    }
  };
};

const loadSqlite = async () => {
  try {
    const mod = await import("better-sqlite3");
    return mod.default || mod;
  } catch (error) {
    throw new Error("Missing dependency: better-sqlite3");
  }
};

const createSqliteStore = async (options, logger) => {
  const sqlitePath = resolvePath(options.sqlitePath, "./data/trial_registry.sqlite");
  if (!sqlitePath) throw new Error("SQLite path is not configured");

  const Sqlite = await loadSqlite();

  const withDb = (callback) => {
    ensureDir(sqlitePath);
    const db = new Sqlite(sqlitePath);
    try {
      return callback(db);
    } finally {
      db.close();
    }
  };

  const slugifyCondition = (value) =>
    String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  const normalizePhaseKey = (value = "") =>
    String(value || "")
      .toLowerCase()
      .replace(/phase/g, " ")
      .replace(/early/g, "")
      .trim()
      .replace(/\b1\b/g, "i")
      .replace(/\b2\b/g, "ii")
      .replace(/\b3\b/g, "iii")
      .replace(/\b4\b/g, "iv")
      .replace(/\s+/g, "")
      .replace(/[^iv/]+/g, "");

  // Read-safe schema init — never drops existing tables, preserves data
  const initSchema = (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS trial_registry_trials (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS trial_registry_sites (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS trial_registry_conditions (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS trial_registry_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payload TEXT NOT NULL
      );
    `);
  };

  // Write-time schema — drops and recreates with indexed columns + junction tables
  const initWriteSchema = (db) => {
    db.exec(`
      DROP TABLE IF EXISTS trial_registry_trials;
      DROP TABLE IF EXISTS trial_registry_trial_conditions;
      DROP TABLE IF EXISTS trial_registry_trial_phases;
      DROP TABLE IF EXISTS trial_registry_trial_regions;
      DROP TABLE IF EXISTS trial_registry_trial_interventions;
      DROP TABLE IF EXISTS trial_registry_sites;
      DROP TABLE IF EXISTS trial_registry_conditions;

      CREATE TABLE trial_registry_trials (
        id TEXT PRIMARY KEY,
        overall_status_key TEXT,
        recruiting_in_portugal INTEGER DEFAULT 0,
        phase_rank REAL DEFAULT 0,
        portugal_recruiting_site_count INTEGER DEFAULT 0,
        reference_date TEXT,
        ipo_porto INTEGER DEFAULT 0,
        disease_stage TEXT DEFAULT 'unspecified',
        payload TEXT NOT NULL
      );
      CREATE TABLE trial_registry_trial_conditions (
        nct_id TEXT NOT NULL,
        condition_key TEXT NOT NULL,
        condition_text TEXT NOT NULL,
        PRIMARY KEY (nct_id, condition_key)
      );
      CREATE TABLE trial_registry_trial_phases (
        nct_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        phase_normalized TEXT NOT NULL,
        PRIMARY KEY (nct_id, phase)
      );
      CREATE TABLE trial_registry_trial_regions (
        nct_id TEXT NOT NULL,
        region TEXT NOT NULL,
        PRIMARY KEY (nct_id, region)
      );
      CREATE TABLE trial_registry_trial_interventions (
        nct_id TEXT NOT NULL,
        intervention_name TEXT NOT NULL,
        intervention_type TEXT,
        PRIMARY KEY (nct_id, intervention_name)
      );
      CREATE TABLE trial_registry_sites (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      CREATE TABLE trial_registry_conditions (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS trial_registry_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payload TEXT NOT NULL
      );

      CREATE INDEX idx_trials_status ON trial_registry_trials(overall_status_key);
      CREATE INDEX idx_trials_recruiting_pt ON trial_registry_trials(recruiting_in_portugal);
      CREATE INDEX idx_trials_phase_rank ON trial_registry_trials(phase_rank);
      CREATE INDEX idx_trials_ref_date ON trial_registry_trials(reference_date);
      CREATE INDEX idx_trials_ipo ON trial_registry_trials(ipo_porto);
      CREATE INDEX idx_tc_condition ON trial_registry_trial_conditions(condition_key);
      CREATE INDEX idx_tc_text ON trial_registry_trial_conditions(condition_text);
      CREATE INDEX idx_tp_normalized ON trial_registry_trial_phases(phase_normalized);
      CREATE INDEX idx_tr_region ON trial_registry_trial_regions(region);
      CREATE INDEX idx_ti_name ON trial_registry_trial_interventions(intervention_name);
      CREATE INDEX idx_trials_stage ON trial_registry_trials(disease_stage);
    `);
  };

  const hasFilterColumns = (db) => {
    const tableInfo = db.pragma("table_info(trial_registry_trials)");
    return tableInfo.some((col) => col.name === "overall_status_key");
  };

  const readAllPayloads = (db, table) => {
    const rows = db.prepare(`SELECT payload FROM ${table}`).all();
    return rows.map(row => parseJsonPayload(row.payload)).filter(Boolean);
  };

  const readPayloadById = (db, table, id) => {
    const row = db.prepare(`SELECT payload FROM ${table} WHERE id = ?`).get(id);
    return row ? parseJsonPayload(row.payload) : null;
  };

  return {
    type: "sqlite",
    async writeSnapshot(snapshot) {
      withDb((db) => {
        initWriteSchema(db);
        const writeTransaction = db.transaction(() => {

          const insertTrial = db.prepare(
            `INSERT INTO trial_registry_trials
             (id, overall_status_key, recruiting_in_portugal, phase_rank,
              portugal_recruiting_site_count, reference_date, ipo_porto, disease_stage, payload)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          const insertTrialCondition = db.prepare(
            "INSERT OR IGNORE INTO trial_registry_trial_conditions (nct_id, condition_key, condition_text) VALUES (?, ?, ?)"
          );
          const insertTrialPhase = db.prepare(
            "INSERT OR IGNORE INTO trial_registry_trial_phases (nct_id, phase, phase_normalized) VALUES (?, ?, ?)"
          );
          const insertTrialRegion = db.prepare(
            "INSERT OR IGNORE INTO trial_registry_trial_regions (nct_id, region) VALUES (?, ?)"
          );
          const insertTrialIntervention = db.prepare(
            "INSERT OR IGNORE INTO trial_registry_trial_interventions (nct_id, intervention_name, intervention_type) VALUES (?, ?, ?)"
          );

          snapshot.trials.forEach(trial => {
            const statusKey = String(trial.overallStatusKey || trial.overallStatus || "")
              .trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");

            insertTrial.run(
              trial.nctId,
              statusKey,
              trial.recruitingInPortugal ? 1 : 0,
              trial.phaseRank || 0,
              trial.portugalRecruitingSiteCount || 0,
              trial.referenceDate || "",
              trial.ipoPorto ? 1 : 0,
              trial.diseaseStage || "unspecified",
              JSON.stringify(trial)
            );

            (trial.conditions || []).forEach(condition => {
              insertTrialCondition.run(trial.nctId, slugifyCondition(condition), condition.toLowerCase());
            });

            (Array.isArray(trial.phases) ? trial.phases : []).forEach(phase => {
              const normalized = normalizePhaseKey(phase);
              if (normalized) {
                insertTrialPhase.run(trial.nctId, phase, normalized);
              }
            });

            (trial.regionTags || []).forEach(region => {
              insertTrialRegion.run(trial.nctId, region.toLowerCase());
            });

            (trial.interventions || []).forEach(intervention => {
              if (intervention.name) {
                insertTrialIntervention.run(trial.nctId, intervention.name, intervention.type || "");
              }
            });
          });

          const insertSite = db.prepare(
            "INSERT INTO trial_registry_sites (id, payload) VALUES (?, ?)"
          );
          snapshot.sites.forEach(site => {
            insertSite.run(site.siteKey, JSON.stringify(site));
          });

          const insertCondition = db.prepare(
            "INSERT INTO trial_registry_conditions (id, payload) VALUES (?, ?)"
          );
          snapshot.conditions.forEach(condition => {
            insertCondition.run(condition.conditionKey, JSON.stringify(condition));
          });

          const insertRun = db.prepare(
            "INSERT INTO trial_registry_runs (payload) VALUES (?)"
          );
          insertRun.run(JSON.stringify(snapshot.meta));
        });

        writeTransaction();
      });
      logger.info("[TrialRegistry] Snapshot stored in SQLite");
    },
    async getFilteredTrials(filters = {}) {
      return withDb((db) => {
        initSchema(db);

        // If the DB has old schema (no indexed columns), signal the caller to use JS fallback
        if (!hasFilterColumns(db)) return null;

        const whereClauses = [];
        const params = [];
        const joins = [];

        if (filters.overallStatusKey) {
          whereClauses.push("t.overall_status_key = ?");
          params.push(filters.overallStatusKey);
        }

        if (filters.recruitingInPortugal) {
          whereClauses.push("t.recruiting_in_portugal = 1");
        }

        if (Array.isArray(filters.phases) && filters.phases.length > 0) {
          joins.push("JOIN trial_registry_trial_phases tp ON t.id = tp.nct_id");
          const placeholders = filters.phases.map(() => "?").join(", ");
          whereClauses.push(`tp.phase_normalized IN (${placeholders})`);
          params.push(...filters.phases);
        }

        if (Array.isArray(filters.regions) && filters.regions.length > 0) {
          joins.push("JOIN trial_registry_trial_regions tr ON t.id = tr.nct_id");
          const placeholders = filters.regions.map(() => "?").join(", ");
          whereClauses.push(`tr.region IN (${placeholders})`);
          params.push(...filters.regions);
        }

        if (filters.diseaseStage) {
          whereClauses.push("t.disease_stage = ?");
          params.push(filters.diseaseStage);
        }

        if (Array.isArray(filters.conditionKeys) && filters.conditionKeys.length > 0) {
          joins.push("JOIN trial_registry_trial_conditions tc ON t.id = tc.nct_id");
          const placeholders = filters.conditionKeys.map(() => "?").join(", ");
          whereClauses.push(`tc.condition_key IN (${placeholders})`);
          params.push(...filters.conditionKeys);
        }

        let sql = "SELECT DISTINCT t.payload FROM trial_registry_trials t";
        if (joins.length > 0) sql += " " + joins.join(" ");
        if (whereClauses.length > 0) sql += " WHERE " + whereClauses.join(" AND ");
        sql += " ORDER BY t.phase_rank DESC, t.ipo_porto DESC, t.reference_date DESC";

        if (filters.limit) {
          sql += " LIMIT ?";
          params.push(filters.limit);
        }

        const rows = db.prepare(sql).all(...params);
        return rows.map(row => parseJsonPayload(row.payload)).filter(Boolean);
      });
    },
    async getSites({ limit, offset } = {}) {
      return withDb((db) => {
        initSchema(db);
        const sites = readAllPayloads(db, "trial_registry_sites");
        return applyPagination(sites, limit, offset);
      });
    },
    async getSite(siteKey) {
      return withDb((db) => {
        initSchema(db);
        return readPayloadById(db, "trial_registry_sites", siteKey);
      });
    },
    async getConditions({ limit, offset } = {}) {
      return withDb((db) => {
        initSchema(db);
        const conditions = readAllPayloads(db, "trial_registry_conditions");
        return applyPagination(conditions, limit, offset);
      });
    },
    async getCondition(conditionKey) {
      return withDb((db) => {
        initSchema(db);
        return readPayloadById(db, "trial_registry_conditions", conditionKey);
      });
    },
    async getTrials({ limit, offset } = {}) {
      return withDb((db) => {
        initSchema(db);
        const trials = readAllPayloads(db, "trial_registry_trials");
        return applyPagination(trials, limit, offset);
      });
    },
    async getTrial(trialId) {
      return withDb((db) => {
        initSchema(db);
        return readPayloadById(db, "trial_registry_trials", trialId);
      });
    },
    async getLatestRun() {
      return withDb((db) => {
        initSchema(db);
        const row = db
          .prepare("SELECT payload FROM trial_registry_runs ORDER BY id DESC LIMIT 1")
          .get();
        return row ? parseJsonPayload(row.payload) : null;
      });
    }
  };
};

const loadPostgres = async () => {
  try {
    const mod = await import("pg");
    return mod;
  } catch (error) {
    throw new Error("Missing dependency: pg");
  }
};

const createPostgresStore = async (options, logger) => {
  const pgUrl = options.postgresUrl || options.databaseUrl;
  if (!pgUrl) throw new Error("Postgres connection URL is not configured");

  const { Client } = await loadPostgres();

  const withClient = async (callback) => {
    const client = new Client({ connectionString: pgUrl });
    await client.connect();
    try {
      return await callback(client);
    } finally {
      await client.end();
    }
  };

  const initSchema = async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS trial_registry_trials (
        id TEXT PRIMARY KEY,
        payload JSONB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS trial_registry_sites (
        id TEXT PRIMARY KEY,
        payload JSONB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS trial_registry_conditions (
        id TEXT PRIMARY KEY,
        payload JSONB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS trial_registry_runs (
        id BIGSERIAL PRIMARY KEY,
        payload JSONB NOT NULL
      );
    `);
  };

  return {
    type: "postgres",
    async writeSnapshot(snapshot) {
      await withClient(async (client) => {
        await initSchema(client);
        await client.query("BEGIN");
        try {
          await client.query("TRUNCATE trial_registry_trials");
          await client.query("TRUNCATE trial_registry_sites");
          await client.query("TRUNCATE trial_registry_conditions");

          const insertTrial = "INSERT INTO trial_registry_trials (id, payload) VALUES ($1, $2)";
          for (const trial of snapshot.trials) {
            await client.query(insertTrial, [trial.nctId, trial]);
          }

          const insertSite = "INSERT INTO trial_registry_sites (id, payload) VALUES ($1, $2)";
          for (const site of snapshot.sites) {
            await client.query(insertSite, [site.siteKey, site]);
          }

          const insertCondition = "INSERT INTO trial_registry_conditions (id, payload) VALUES ($1, $2)";
          for (const condition of snapshot.conditions) {
            await client.query(insertCondition, [condition.conditionKey, condition]);
          }

          const insertRun = "INSERT INTO trial_registry_runs (payload) VALUES ($1)";
          await client.query(insertRun, [snapshot.meta]);

          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      });
      logger.info("[TrialRegistry] Snapshot stored in Postgres");
    },
    async getSites({ limit, offset } = {}) {
      return withClient(async (client) => {
        await initSchema(client);
        const result = await client.query("SELECT payload FROM trial_registry_sites");
        const sites = result.rows.map(row => row.payload);
        return applyPagination(sites, limit, offset);
      });
    },
    async getSite(siteKey) {
      return withClient(async (client) => {
        await initSchema(client);
        const result = await client.query(
          "SELECT payload FROM trial_registry_sites WHERE id = $1",
          [siteKey]
        );
        return result.rows[0]?.payload || null;
      });
    },
    async getConditions({ limit, offset } = {}) {
      return withClient(async (client) => {
        await initSchema(client);
        const result = await client.query("SELECT payload FROM trial_registry_conditions");
        const conditions = result.rows.map(row => row.payload);
        return applyPagination(conditions, limit, offset);
      });
    },
    async getCondition(conditionKey) {
      return withClient(async (client) => {
        await initSchema(client);
        const result = await client.query(
          "SELECT payload FROM trial_registry_conditions WHERE id = $1",
          [conditionKey]
        );
        return result.rows[0]?.payload || null;
      });
    },
    async getTrials({ limit, offset } = {}) {
      return withClient(async (client) => {
        await initSchema(client);
        const result = await client.query("SELECT payload FROM trial_registry_trials");
        const trials = result.rows.map(row => row.payload);
        return applyPagination(trials, limit, offset);
      });
    },
    async getTrial(trialId) {
      return withClient(async (client) => {
        await initSchema(client);
        const result = await client.query(
          "SELECT payload FROM trial_registry_trials WHERE id = $1",
          [trialId]
        );
        return result.rows[0]?.payload || null;
      });
    },
    async getLatestRun() {
      return withClient(async (client) => {
        await initSchema(client);
        const result = await client.query(
          "SELECT payload FROM trial_registry_runs ORDER BY id DESC LIMIT 1"
        );
        return result.rows[0]?.payload || null;
      });
    }
  };
};

export const createTrialRegistryStore = async ({ firebaseAdmin, logger = console, options = {} }) => {
  const storeType = resolveStoreType(options, firebaseAdmin);
  const resolvedOptions = {
    ...options,
    store: storeType,
    sqlitePath: options.sqlitePath,
    postgresUrl: options.postgresUrl,
    databaseUrl: options.databaseUrl,
    filePath: options.filePath
  };

  switch (storeType) {
    case "firestore":
      return createFirestoreStore(firebaseAdmin, resolvedOptions, logger);
    case "sqlite":
      return createSqliteStore(resolvedOptions, logger);
    case "postgres":
      return createPostgresStore(resolvedOptions, logger);
    case "file":
      return createFileStore(resolvedOptions, logger);
    default:
      throw new Error(`Unsupported trial registry store: ${storeType}`);
  }
};
