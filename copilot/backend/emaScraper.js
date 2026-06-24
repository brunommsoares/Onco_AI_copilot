import fetch from 'node-fetch';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// EMA Scraper — fetches EU marketing authorisation data from the European
// Medicines Agency open-data sources:
//   1. EMA Medicines Download (Excel/CSV) — all EU-authorised medicines
//   2. ePI Consuming API (optional) — electronic product information (no auth)
//
// Follows the same pattern as infarmedScraper.js.
// ---------------------------------------------------------------------------

const EMA_MEDICINES_URL =
  'https://www.ema.europa.eu/en/medicines/download-medicine-data';

// Direct download links for the EMA medicines dataset (Excel)
const EMA_EXCEL_URL =
  'https://www.ema.europa.eu/en/documents/report/medicines-output-medicines-report_en.xlsx';

const EMA_EPI_API_BASE = 'https://epi.developer.ema.europa.eu';

const REQUEST_TIMEOUT = 60_000;
const RETRY_DELAY = 2_000;
const MAX_RETRIES = 3;

// ATC codes for antineoplastic and immunomodulating agents
const ONCOLOGY_ATC_PREFIXES = ['L01', 'L02', 'L03', 'L04'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hashId = (raw) =>
  crypto.createHash('sha1').update(String(raw)).digest('hex').slice(0, 12);

const normalizeSubstance = (name) =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[áàâã]/g, 'a')
    .replace(/[éèê]/g, 'e')
    .replace(/[íìî]/g, 'i')
    .replace(/[óòôõ]/g, 'o')
    .replace(/[úùû]/g, 'u')
    .replace(/[ç]/g, 'c');

const isOncologyATC = (atcCode) => {
  if (!atcCode) return false;
  const upper = String(atcCode).trim().toUpperCase();
  return ONCOLOGY_ATC_PREFIXES.some((prefix) => upper.startsWith(prefix));
};

const safeFetch = async (url, options = {}, retries = MAX_RETRIES) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'User-Agent': 'SilverCancer-Oncology-Platform/1.0 (clinical-research)',
          ...options.headers
        }
      });
      clearTimeout(timeout);
      return res;
    } catch (err) {
      clearTimeout(timeout);
      if (attempt === retries) throw err;
      await sleep(RETRY_DELAY * attempt);
    }
  }
};

// ---------------------------------------------------------------------------
// 1. EMA Medicines Excel Download
// ---------------------------------------------------------------------------

/**
 * Fetches the EMA medicines dataset (EPAR list) and parses it.
 * The Excel contains columns like:
 *   - Medicine name, Active substance, ATC code, Therapeutic area,
 *   - Authorisation status, Date of issue, Marketing-authorisation holder,
 *   - Orphan medicine, Condition / indication
 */
const fetchEmaMedicinesExcel = async (logger) => {
  logger.info('[EMA] Fetching EMA medicines dataset...');
  const products = [];

  try {
    const res = await safeFetch(EMA_EXCEL_URL, {
      headers: { Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, */*' }
    });

    if (!res.ok) {
      logger.warn(`[EMA] Medicines Excel HTTP ${res.status}`);
      return products;
    }

    const buffer = await res.buffer();

    // Parse Excel — EMA file has merged header cells, so we need to find
    // the actual header row and remap columns manually
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });

    // Find the header row (contains "Name of medicine" or "Active substance")
    let headerIdx = -1;
    let headers = [];
    for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
      const rowStr = (rawRows[i] || []).join('|').toLowerCase();
      if (rowStr.includes('name of medicine') || rowStr.includes('active substance')) {
        headerIdx = i;
        headers = rawRows[i].map((h) => String(h || '').trim().toLowerCase());
        break;
      }
    }

    if (headerIdx < 0) {
      logger.warn('[EMA] Could not find header row in Excel — trying row 1 as fallback');
      headerIdx = 1;
      headers = (rawRows[1] || []).map((h) => String(h || '').trim().toLowerCase());
    }

    // Build column index map
    const colIdx = (name) => headers.findIndex((h) => h.includes(name));
    const col = {
      medicineName: colIdx('name of medicine'),
      inn: colIdx('international non-proprietary'),
      activeSubstance: colIdx('active substance'),
      therapeuticArea: colIdx('therapeutic area'),
      atcCode: colIdx('atc code (human)'),
      pharmacoGroup: colIdx('pharmacotherapeutic group'),
      indication: colIdx('therapeutic indication'),
      orphan: colIdx('orphan medicine'),
      authHolder: colIdx('marketing authorisation developer'),
      authDate: colIdx('marketing authorisation date'),
      status: colIdx('medicine status'),
      url: colIdx('medicine url'),
      generic: colIdx('generic'),
      biosimilar: colIdx('biosimilar'),
      category: colIdx('category'),
    };

    logger.info(`[EMA] Header row at index ${headerIdx}, data starts at ${headerIdx + 1}`);
    logger.info(`[EMA] Column mapping: medicineName=${col.medicineName}, activeSubstance=${col.activeSubstance}, atcCode=${col.atcCode}, indication=${col.indication}`);

    const dataRows = rawRows.slice(headerIdx + 1);
    logger.info(`[EMA] Parsed ${dataRows.length} data rows from EMA Excel`);

    for (const cells of dataRows) {
      if (!cells || !cells.length) continue;

      const get = (idx) => (idx >= 0 && idx < cells.length) ? String(cells[idx] || '').trim() : '';

      const medicineName = get(col.medicineName);
      const activeSubstance = get(col.activeSubstance) || get(col.inn);
      const atcCode = get(col.atcCode);
      const therapeuticArea = get(col.therapeuticArea);
      const authStatus = get(col.status);
      const approvalDate = get(col.authDate);
      const authHolder = get(col.authHolder);
      const orphan = get(col.orphan);
      const conditionIndication = get(col.indication);
      const url = get(col.url);
      const genericBiosimilar = [get(col.generic), get(col.biosimilar)].filter(Boolean).join(', ');

      if (!medicineName && !activeSubstance) continue;

      const product = {
        id: hashId(`ema-${medicineName}-${activeSubstance}`),
        source: 'ema_epar',
        medicineName: String(medicineName).trim(),
        activeSubstance: String(activeSubstance).trim(),
        activeSubstanceNormalized: normalizeSubstance(activeSubstance),
        atcCode: String(atcCode).trim().toUpperCase(),
        therapeuticArea: String(therapeuticArea).trim(),
        authorizationStatus: String(authStatus).trim(),
        approvalDate: parseEmaDate(approvalDate),
        authorizationHolder: String(authHolder).trim(),
        orphanMedicine: /yes|true|sim/i.test(String(orphan)),
        conditionIndication: String(conditionIndication).trim(),
        url: String(url).trim(),
        genericBiosimilar: String(genericBiosimilar).trim(),
        isOncology: isOncologyATC(atcCode) ||
          /oncol|cancer|carcinom|tumou?r|neoplas|leukaem|lymphom|melanom|sarcom|myelom|mesotheliom/i.test(therapeuticArea) ||
          /oncol|cancer|carcinom|tumou?r|neoplas|leukaem|lymphom|melanom|sarcom|myelom/i.test(conditionIndication),
        fetchedAt: new Date().toISOString()
      };

      products.push(product);
    }

    const oncologyCount = products.filter((p) => p.isOncology).length;
    logger.info(`[EMA] Total products: ${products.length}, oncology-related: ${oncologyCount}`);
  } catch (err) {
    logger.error(`[EMA] Failed to fetch/parse EMA medicines Excel: ${err.message}`);
  }

  return products;
};

/**
 * Parse EMA date fields which can be various formats.
 */
const parseEmaDate = (raw) => {
  if (!raw) return '';
  const str = String(raw).trim();

  // Already ISO-like
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);

  // DD/MM/YYYY
  const dmy = str.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;

  // Excel serial number
  const num = Number(str);
  if (num > 30000 && num < 60000) {
    const d = new Date((num - 25569) * 86400000);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  return str;
};

// ---------------------------------------------------------------------------
// 2. Master sync function
// ---------------------------------------------------------------------------

/**
 * Runs the full EMA sync: downloads the medicines dataset, filters to
 * oncology, and returns the unified product array.
 */
export const runEmaSync = async ({ logger } = {}) => {
  const startTime = Date.now();
  logger.info('[EMA Sync] Starting full EMA sync...');

  // Phase 1: Fetch the EMA medicines dataset
  const allProducts = await fetchEmaMedicinesExcel(logger);

  // Phase 2: Filter to oncology-relevant products
  const oncologyProducts = allProducts.filter((p) => p.isOncology);

  // Phase 3: Deduplicate by normalized substance + medicine name
  const seen = new Set();
  const deduped = oncologyProducts.filter((p) => {
    const key = `${p.activeSubstanceNormalized}|${p.medicineName.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const meta = {
    syncedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    totalProducts: allProducts.length,
    oncologyProducts: deduped.length,
    sources: {
      ema_epar: allProducts.length
    }
  };

  logger.info(
    `[EMA Sync] Complete: ${deduped.length} oncology products from ${allProducts.length} total in ${meta.durationMs}ms`
  );

  return { products: deduped, meta };
};

export {
  ONCOLOGY_ATC_PREFIXES,
  normalizeSubstance,
  isOncologyATC,
  hashId,
  fetchEmaMedicinesExcel,
  safeFetch
};
