import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { logger as defaultLogger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// MedInov Excel Data Service
//
// Reads the curated MedInov Excel file (medicamento-patologia-intuito sheet)
// and provides structured lookup for drug approval data including:
//   - RAFP (reimbursement) status
//   - PAP (early access program) status
//   - EMA/RCM dates
//   - Lines of therapy, biomarkers
//   - Pivotal trial evidence (trial name, phase, arms, OS/PFS)
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');

const COLUMN_MAP = {
  medOral: 0,
  medEV: 1,
  dataEPAR: 2,
  dataRCM: 3,
  rcmAuth: 4,
  lab: 5,
  gft: 6,
  tradeName: 7,
  substance: 8,
  clinicGroup: 9,
  pathologyGroup: 10,
  ageGroup: 11,
  indication: 12,
  indicationComplement: 13,
  rafp: 14,
  pap: 15,
  papDate: 16,
  nPatients: 17,
  adj: 18,
  neoadj: 19,
  curativo: 20,
  intermedio: 21,
  paliativo: 22,
  line1: 23,
  line2: 24,
  line3: 25,
  line4: 26,
  line5: 27,
  line6: 28,
  lineND: 29,
  egfr: 30,
  her2: 31,
  hr: 32,
  ros: 33,
  alk: 34,
  ph: 35,
  otherMarkers: 36,
  otherGenes: 37,
  trialName: 38,
  trialPhase: 39,
  patientDesc: 40,
  armA: 41,
  armB: 42,
  armC: 43,
  osArmA: 44,
  osArmB: 45,
  osArmC: 46,
  pfsArmA: 47,
  pfsArmB: 48,
  pfsArmC: 49,
  estado: 50,
  nct: 51,
  doi: 52,
  obsStudies: 53,
  obsCFFM: 54,
  articleDate: 55,
  trialEnd: 56,
  obsMR: 57
};

function excelDateToString(val) {
  if (!val) return '';
  if (typeof val === 'string') return val.trim();
  // Excel serial date number
  if (typeof val === 'number') {
    try {
      const d = XLSX.SSF.parse_date_code(val);
      if (d) return `${String(d.d).padStart(2, '0')}/${String(d.m).padStart(2, '0')}/${d.y}`;
    } catch { /* ignore */ }
    return String(val);
  }
  return String(val);
}

function cellStr(row, col) {
  const v = row?.[col];
  if (v == null) return '';
  return String(v).trim();
}

function cellBool(row, col) {
  const v = cellStr(row, col).toUpperCase();
  return v === 'X' || v === 'SIM' || v === 'YES';
}

function parseLinesOfTherapy(row) {
  const lines = [];
  if (cellBool(row, COLUMN_MAP.line1)) lines.push('1L');
  if (cellBool(row, COLUMN_MAP.line2)) lines.push('2L');
  if (cellBool(row, COLUMN_MAP.line3)) lines.push('3L');
  if (cellBool(row, COLUMN_MAP.line4)) lines.push('4L');
  if (cellBool(row, COLUMN_MAP.line5)) lines.push('5L');
  if (cellBool(row, COLUMN_MAP.line6)) lines.push('6L');
  return lines;
}

function parseTherapyIntent(row) {
  const intents = [];
  if (cellBool(row, COLUMN_MAP.adj)) intents.push('Adjuvante');
  if (cellBool(row, COLUMN_MAP.neoadj)) intents.push('Neoadjuvante');
  if (cellBool(row, COLUMN_MAP.curativo)) intents.push('Curativo');
  if (cellBool(row, COLUMN_MAP.intermedio)) intents.push('Intermédio');
  if (cellBool(row, COLUMN_MAP.paliativo)) intents.push('Paliativo');
  return intents;
}

function parseBiomarkers(row) {
  const markers = [];
  const egfr = cellStr(row, COLUMN_MAP.egfr);
  const her2 = cellStr(row, COLUMN_MAP.her2);
  const hr = cellStr(row, COLUMN_MAP.hr);
  const ros = cellStr(row, COLUMN_MAP.ros);
  const alk = cellStr(row, COLUMN_MAP.alk);
  const ph = cellStr(row, COLUMN_MAP.ph);
  const other = cellStr(row, COLUMN_MAP.otherMarkers);
  const genes = cellStr(row, COLUMN_MAP.otherGenes);

  if (egfr) markers.push(`EGFR ${egfr}`);
  if (her2) markers.push(her2.startsWith('HER2') ? her2 : `HER2 ${her2}`);
  if (hr) markers.push(hr.startsWith('HR') ? hr : `HR ${hr}`);
  if (ros) markers.push(`ROS1 ${ros}`);
  if (alk) markers.push(`ALK ${alk}`);
  if (ph) markers.push(`Ph ${ph}`);
  if (other) markers.push(other);
  if (genes) markers.push(genes);

  return markers;
}

function parseTrialEvidence(row) {
  const name = cellStr(row, COLUMN_MAP.trialName);
  if (!name) return null;

  const arms = [];
  const armA = cellStr(row, COLUMN_MAP.armA);
  const armB = cellStr(row, COLUMN_MAP.armB);
  const armC = cellStr(row, COLUMN_MAP.armC);
  if (armA) arms.push({ label: 'A', description: armA, osMonths: cellStr(row, COLUMN_MAP.osArmA), pfsMonths: cellStr(row, COLUMN_MAP.pfsArmA) });
  if (armB) arms.push({ label: 'B', description: armB, osMonths: cellStr(row, COLUMN_MAP.osArmB), pfsMonths: cellStr(row, COLUMN_MAP.pfsArmB) });
  if (armC) arms.push({ label: 'C', description: armC, osMonths: cellStr(row, COLUMN_MAP.osArmC), pfsMonths: cellStr(row, COLUMN_MAP.pfsArmC) });

  return {
    name,
    phase: cellStr(row, COLUMN_MAP.trialPhase),
    patientDescription: cellStr(row, COLUMN_MAP.patientDesc),
    arms,
    status: cellStr(row, COLUMN_MAP.estado),
    nct: cellStr(row, COLUMN_MAP.nct),
    doi: cellStr(row, COLUMN_MAP.doi),
    nPatients: cellStr(row, COLUMN_MAP.nPatients),
    articleDate: cellStr(row, COLUMN_MAP.articleDate),
    trialEnd: cellStr(row, COLUMN_MAP.trialEnd)
  };
}

class MedinovDataService {
  constructor({ logger = defaultLogger } = {}) {
    this._logger = logger;
    this._entries = [];
    this._loaded = false;
    this._lastModified = null;
    this._filePath = null;
  }

  load() {
    // Find the Excel file
    let filePath = null;
    try {
      for (const f of readdirSync(DATA_DIR)) {
        if (f.endsWith('.xlsx') && f.toLowerCase().includes('medinov')) {
          filePath = join(DATA_DIR, f);
          break;
        }
      }
    } catch { /* ignore */ }
    if (!filePath) {
      filePath = join(DATA_DIR, 'MedInov_act_03NOV2025_CF_Final_NOV2025.xlsx');
    }

    if (!existsSync(filePath)) {
      this._logger.warn(`[MedInov] Excel file not found at ${filePath}`);
      return;
    }

    try {
      const stat = statSync(filePath);
      // Skip reload if file hasn't changed
      if (this._loaded && this._lastModified && this._filePath === filePath && stat.mtimeMs <= this._lastModified) {
        return;
      }

      const wb = XLSX.readFile(filePath);
      const sheetName = 'medicamento-patologia-intuito';
      const ws = wb.Sheets[sheetName];
      if (!ws) {
        this._logger.warn(`[MedInov] Sheet "${sheetName}" not found`);
        return;
      }

      const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
      // Data rows start at index 4 (rows 0-3 are headers)
      const entries = [];
      for (let i = 4; i < data.length; i++) {
        const row = data[i];
        if (!row || !row.some(c => c != null)) continue;

        const substance = cellStr(row, COLUMN_MAP.substance);
        if (!substance) continue;

        entries.push({
          isOral: cellBool(row, COLUMN_MAP.medOral),
          isEV: cellBool(row, COLUMN_MAP.medEV),
          dataEPAR: excelDateToString(row[COLUMN_MAP.dataEPAR]),
          dataRCM: excelDateToString(row[COLUMN_MAP.dataRCM]),
          rcmAuth: cellStr(row, COLUMN_MAP.rcmAuth),
          lab: cellStr(row, COLUMN_MAP.lab),
          gft: cellStr(row, COLUMN_MAP.gft),
          tradeName: cellStr(row, COLUMN_MAP.tradeName),
          substance,
          clinicGroup: cellStr(row, COLUMN_MAP.clinicGroup),
          pathologyGroup: cellStr(row, COLUMN_MAP.pathologyGroup),
          ageGroup: cellStr(row, COLUMN_MAP.ageGroup),
          indication: cellStr(row, COLUMN_MAP.indication),
          indicationComplement: cellStr(row, COLUMN_MAP.indicationComplement),
          rafpStatus: cellStr(row, COLUMN_MAP.rafp),
          papStatus: cellStr(row, COLUMN_MAP.pap),
          papDate: excelDateToString(row[COLUMN_MAP.papDate]),
          linesOfTherapy: parseLinesOfTherapy(row),
          therapyIntent: parseTherapyIntent(row),
          biomarkers: parseBiomarkers(row),
          trialEvidence: parseTrialEvidence(row),
          notes: cellStr(row, COLUMN_MAP.obsCFFM),
          notesMR: cellStr(row, COLUMN_MAP.obsMR)
        });
      }

      this._entries = entries;
      this._loaded = true;
      this._lastModified = stat.mtimeMs;
      this._filePath = filePath;
      this._logger.info(`[MedInov] Loaded ${entries.length} entries from Excel`);
    } catch (err) {
      this._logger.error(`[MedInov] Failed to load Excel: ${err.message}`);
    }
  }

  getEntries() {
    if (!this._loaded) this.load();
    return this._entries;
  }

  /**
   * Search entries by substance name (fuzzy match).
   */
  searchBySubstance(query) {
    if (!query) return [];
    if (!this._loaded) this.load();
    const q = query.toLowerCase().replace(/[^a-záàâãéèêíóòôõúç\s]/gi, '');
    return this._entries.filter((e) => {
      const sub = e.substance.toLowerCase();
      return sub.includes(q) || q.split(/\s+/).every(w => sub.includes(w));
    });
  }

  /**
   * Search entries by cancer type / pathology.
   */
  searchByPathology(query) {
    if (!query) return [];
    if (!this._loaded) this.load();
    const q = query.toLowerCase();
    return this._entries.filter((e) => {
      const path = e.pathologyGroup.toLowerCase();
      const ind = e.indication.toLowerCase();
      const clinic = e.clinicGroup.toLowerCase();
      return path.includes(q) || ind.includes(q) || clinic.includes(q);
    });
  }

  /**
   * Full search: match by substance, pathology, indication, biomarker.
   */
  search({ substance = '', cancerType = '', biomarker = '', lineOfTherapy = '' } = {}) {
    if (!this._loaded) this.load();

    let results = [...this._entries];

    if (substance) {
      const q = substance.toLowerCase();
      results = results.filter((e) => e.substance.toLowerCase().includes(q) || e.tradeName.toLowerCase().includes(q));
    }

    if (cancerType) {
      const q = cancerType.toLowerCase();
      results = results.filter((e) =>
        e.pathologyGroup.toLowerCase().includes(q) ||
        e.indication.toLowerCase().includes(q) ||
        e.clinicGroup.toLowerCase().includes(q)
      );
    }

    if (biomarker) {
      const q = biomarker.toLowerCase();
      results = results.filter((e) =>
        e.biomarkers.some(b => b.toLowerCase().includes(q))
      );
    }

    if (lineOfTherapy) {
      const q = lineOfTherapy.replace(/[^\d]/g, '');
      if (q) {
        const lineKey = `${q}L`;
        results = results.filter((e) => e.linesOfTherapy.includes(lineKey));
      }
    }

    return results;
  }

  /**
   * Build a context summary for LLM injection.
   */
  buildContextSummary(entries) {
    if (!entries.length) return '';

    const lines = ['## MedInov Approval Data (Portugal)\n'];

    for (const entry of entries.slice(0, 15)) {
      lines.push(`### ${entry.substance} (${entry.tradeName})`);
      lines.push(`- **Indicação:** ${entry.indication}`);
      if (entry.indicationComplement) lines.push(`  - ${entry.indicationComplement}`);
      lines.push(`- **Patologia:** ${entry.pathologyGroup} | **Clínica:** ${entry.clinicGroup}`);
      lines.push(`- **RAFP:** ${entry.rafpStatus || 'ND'} | **PAP:** ${entry.papStatus || 'ND'}${entry.papDate ? ` (${entry.papDate})` : ''}`);
      if (entry.dataEPAR) lines.push(`- **Data EPAR:** ${entry.dataEPAR}${entry.dataRCM ? ` | **Data RCM:** ${entry.dataRCM}` : ''}`);
      if (entry.rcmAuth) lines.push(`- **RCM autorização:** ${entry.rcmAuth}`);
      if (entry.linesOfTherapy.length) lines.push(`- **Linhas de terapia:** ${entry.linesOfTherapy.join(', ')}`);
      if (entry.therapyIntent.length) lines.push(`- **Intuito:** ${entry.therapyIntent.join(', ')}`);
      if (entry.biomarkers.length) lines.push(`- **Biomarcadores:** ${entry.biomarkers.join(', ')}`);

      if (entry.trialEvidence) {
        const t = entry.trialEvidence;
        lines.push(`- **Ensaio pivotal:** ${t.name} (Fase ${t.phase})`);
        if (t.patientDescription) lines.push(`  - Doentes: ${t.patientDescription}`);
        for (const arm of t.arms) {
          const results = [];
          if (arm.osMonths && arm.osMonths !== 'NA') results.push(`OS ${arm.osMonths}m`);
          if (arm.pfsMonths && arm.pfsMonths !== 'NA') results.push(`PFS ${arm.pfsMonths}m`);
          lines.push(`  - Braço ${arm.label}: ${arm.description}${results.length ? ` → ${results.join(', ')}` : ''}`);
        }
        if (t.nct) lines.push(`  - NCT: ${t.nct}`);
        if (t.doi) lines.push(`  - DOI: ${t.doi}`);
      }

      if (entry.notes) lines.push(`- **Notas:** ${entry.notes}`);
      lines.push('');
    }

    return lines.join('\n');
  }
}

// Singleton
let _instance = null;

export function getMedinovDataService(opts = {}) {
  if (!_instance) {
    _instance = new MedinovDataService(opts);
  }
  return _instance;
}

export default MedinovDataService;
