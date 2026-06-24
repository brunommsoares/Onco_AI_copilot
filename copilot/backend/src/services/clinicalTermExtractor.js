// ---------------------------------------------------------------------------
// Unified Clinical Term Extractor
//
// Single source of truth for extracting clinical terms (substance, cancer type,
// biomarker, line of therapy) from questions and structured parameters.
// Used by INFARMED, EMA, ESMO, and trial matching services.
// ---------------------------------------------------------------------------

import { ONCOLOGY_SUBSTANCES } from '../../infarmedScraper.js';

// ---- Cancer type patterns (English + Portuguese) --------------------------
// ORDERING RULES:
//   1. More specific subtypes BEFORE generic (e.g. DLBCL before lymphoma)
//   2. Abbreviation-only patterns must be UPPERCASE-safe (use \b carefully)
//   3. Avoid single common words without required context (no "liver" alone,
//      no "renal" alone, no "mm" alone) — these cause massive false positives
//      in clinical text that mentions "liver enzymes", "renal function", "15 mm"

const CANCER_PATTERNS = [
  // ── Lung (specific before generic) ──────────────────────────────────────
  [/\b(?:non[- ]?small[- ]?cell|nsclc)\b/i, 'non-small cell lung cancer'],
  [/\b(?:small[- ]?cell\s*lung|sclc)\b/i, 'small cell lung cancer'],

  // ── Breast ───────────────────────────────────────────────────────────────
  [/\b(?:triple[- ]?negative\s*breast|tnbc)\b/i, 'triple-negative breast cancer'],
  [/\bbreast\s*(?:cancer|carcinoma)\b/i, 'breast cancer'],

  // ── Colorectal ────────────────────────────────────────────────────────────
  [/\b(?:colorectal|mcrc|colon\s*cancer|rectal\s*cancer)\b/i, 'colorectal cancer'],
  [/\bcrc\b/i, 'colorectal cancer'],

  // ── Haematology — lymphomas (specific before generic "lymphoma") ──────────
  [/\b(?:dlbcl|diffuse\s*large\s*b[- ]?cell)\b/i, 'diffuse large b-cell lymphoma'],
  [/\b(?:lbcl|large\s*b[- ]?cell\s*lymphoma)\b/i, 'large b-cell lymphoma'],
  [/\b(?:mcl|mantle\s*cell\s*lymphoma)\b/i, 'mantle cell lymphoma'],
  [/\b(?:follicular\s*lymphoma|fl\s*(?:lymphoma|grade))\b/i, 'follicular lymphoma'],
  [/\b(?:hodgkin|hl\b)\b/i, 'hodgkin lymphoma'],
  [/\b(?:mzl|marginal\s*zone\s*lymphoma)\b/i, 'marginal zone lymphoma'],
  [/\blymphoma\b/i, 'lymphoma'],

  // ── Haematology — leukaemias (specific before generic) ────────────────────
  [/\b(?:b[- ]?all|b[- ]?cell\s*all|precursor\s*b[- ]?all)\b/i, 'acute lymphoblastic leukemia'],
  [/\b(?:aml|acute\s*myeloid\s*leuk[ae]mia)\b/i, 'acute myeloid leukemia'],
  [/\b(?:all|acute\s*lymphoblastic\s*leuk[ae]mia)\b/i, 'acute lymphoblastic leukemia'],
  [/\b(?:cll|chronic\s*lymphocytic\s*leuk[ae]mia)\b/i, 'chronic lymphocytic leukemia'],
  [/\b(?:cml|chronic\s*myeloid\s*leuk[ae]mia)\b/i, 'chronic myeloid leukemia'],
  [/\b(?:mds|myelodysplastic\s*syndrome)\b/i, 'myelodysplastic syndrome'],
  [/\bleuk[ae]mi[ao]\b/i, 'leukemia'],

  // ── Haematology — plasma cell / myeloma (NO 'mm' — millimeters false positive) ──
  [/\b(?:multiple\s*myeloma|mieloma\s*m[uú]ltiplo|plasma\s*cell\s*myeloma)\b/i, 'multiple myeloma'],
  [/\bmyeloma\b/i, 'multiple myeloma'],

  // ── Haematology — other ───────────────────────────────────────────────────
  [/\b(?:myelofibrosis|mielofibrose)\b/i, 'myelofibrosis'],
  [/\b(?:polycythemia\s*vera|policit[eê]mia\s*vera)\b/i, 'polycythemia vera'],

  // ── Melanoma (uveal before generic — tebentafusp is ONLY uveal) ───────────
  [/\b(?:uveal\s*melanoma|ocular\s*melanoma|choroidal\s*melanoma)\b/i, 'uveal melanoma'],
  [/\bmelanoma\b/i, 'melanoma'],

  // ── Kidney / RCC (no "renal" alone — "renal failure"/"renal function" false positives) ─
  [/\b(?:rcc|renal\s*cell\s*(?:carcinoma|cancer)|kidney\s*(?:cancer|carcinoma))\b/i, 'renal cell carcinoma'],
  [/\bclear\s*cell\s*(?:rcc|renal)\b/i, 'renal cell carcinoma'],

  // ── Bladder / Urothelial (no "bladder" alone) ─────────────────────────────
  [/\b(?:urothelial\s*(?:carcinoma|cancer)|bladder\s*(?:cancer|carcinoma))\b/i, 'urothelial carcinoma'],
  [/\b(?:uc\b|upper\s*tract\s*urothelial)\b/i, 'urothelial carcinoma'],

  // ── Liver / HCC (no "liver" alone — "liver enzymes"/"liver toxicity" false positives) ──
  [/\b(?:hcc|hepatocellular\s*(?:carcinoma|cancer))\b/i, 'hepatocellular carcinoma'],

  // ── Gastric / GEJ ────────────────────────────────────────────────────────
  [/\b(?:gastric\s*(?:cancer|carcinoma|adenocarcinoma)|stomach\s*(?:cancer|carcinoma))\b/i, 'gastric cancer'],
  [/\b(?:gastroesophageal|gastro[- ]?oesophageal|gej)\b/i, 'gastric cancer'],

  // ── Head & neck ──────────────────────────────────────────────────────────
  [/\b(?:hnscc|head\s*(?:and|&)\s*neck\s*(?:squamous|cancer)?)\b/i, 'head and neck squamous cell carcinoma'],
  [/\bnasopharyngeal\s*(?:carcinoma|cancer)\b/i, 'nasopharyngeal carcinoma'],

  // ── Gynaecological ────────────────────────────────────────────────────────
  [/\bovarian\s*(?:cancer|carcinoma)\b/i, 'ovarian cancer'],
  [/\b(?:endometrial|uterine)\s*(?:cancer|carcinoma)\b/i, 'endometrial cancer'],
  [/\b(?:cervical|cervix)\s*(?:cancer|carcinoma)\b/i, 'cervical cancer'],

  // ── Pancreatic (no "pancreatic" alone — "pancreatic enzymes" false positive) ─
  [/\b(?:pdac|pancreatic\s*(?:cancer|adenocarcinoma|ductal))\b/i, 'pancreatic cancer'],
  [/\b(?:pnet|pancreatic\s*(?:neuroendocrine|net))\b/i, 'pancreatic neuroendocrine tumor'],

  // ── Prostate (no "prostate" alone — "PSA"/"prostate specific antigen" false positive) ─
  [/\b(?:mcrpc|castration[- ]?resistant\s*prostate)\b/i, 'metastatic castration-resistant prostate cancer'],
  [/\b(?:crpc|hormone[- ]?resistant\s*prostate)\b/i, 'castration-resistant prostate cancer'],
  [/\bprostate\s*(?:cancer|carcinoma)\b/i, 'prostate cancer'],

  // ── Esophageal ───────────────────────────────────────────────────────────
  [/\b(?:esophageal|oesophageal)\s*(?:cancer|carcinoma|squamous|adenocarcinoma)\b/i, 'esophageal cancer'],
  [/\bescc\b/i, 'esophageal cancer'],

  // ── Biliary tract (CCA ≠ biliary tract cancer broadly) ────────────────────
  [/\b(?:cholangiocarcinoma|cca\b|bile\s*duct\s*(?:cancer|carcinoma))\b/i, 'cholangiocarcinoma'],
  [/\b(?:biliary\s*tract\s*(?:cancer|carcinoma)|btc\b)\b/i, 'biliary tract cancer'],
  [/\bgallbladder\s*(?:cancer|carcinoma)\b/i, 'gallbladder cancer'],

  // ── Thyroid ──────────────────────────────────────────────────────────────
  [/\b(?:anaplastic\s*thyroid)\b/i, 'anaplastic thyroid cancer'],
  [/\b(?:medullary\s*thyroid|mtc\b)\b/i, 'medullary thyroid cancer'],
  [/\b(?:thyroid\s*(?:cancer|carcinoma))\b/i, 'thyroid cancer'],

  // ── CNS ──────────────────────────────────────────────────────────────────
  [/\b(?:glioblastoma|gbm)\b/i, 'glioblastoma'],
  [/\bglioma\b/i, 'glioma'],

  // ── GIST ─────────────────────────────────────────────────────────────────
  [/\b(?:gist|gastrointestinal\s*stromal)\b/i, 'gastrointestinal stromal tumor'],

  // ── NET / neuroendocrine ─────────────────────────────────────────────────
  [/\b(?:neuroendocrine\s*(?:tumor|tumour|neoplasm|carcinoma)|carcinoid)\b/i, 'neuroendocrine tumor'],
  // NET abbreviation alone — only match uppercase NET to reduce false positives with "net" (word)
  [/\bNET\b/, 'neuroendocrine tumor'],

  // ── Sarcoma ───────────────────────────────────────────────────────────────
  [/\b(?:soft\s*tissue\s*sarcoma|sts\b|liposarcoma|leiomyosarcoma)\b/i, 'soft tissue sarcoma'],
  [/\bsarcoma\b/i, 'sarcoma'],

  // ── Mesothelioma ──────────────────────────────────────────────────────────
  [/\bmesothelioma\b/i, 'mesothelioma'],

  // ── Portuguese (SCLC must be before generic lung) ─────────────────────────
  [/\bcancro\s*(?:(?:do\s*)?(?:pulm[aã]o)\s*(?:de\s*)?pequenas\s*c[eé]lulas|pulmonar\s*(?:de\s*)?pequenas\s*c[eé]lulas)\b/i, 'small cell lung cancer'],
  [/\bcancro\s*(?:do\s*)?pulm[aã]o\b/i, 'lung cancer'],
  [/\bcancro\s*(?:da\s*)?mama\b/i, 'breast cancer'],
  [/\bcancro\s*(?:do\s*)?(?:c[oó]lon|colorretal|colorrectal)\b/i, 'colorectal cancer'],
  [/\bcancro\s*(?:do\s*)?(?:rim|renal)\b/i, 'renal cell carcinoma'],
  [/\bcancro\s*(?:do\s*)?(?:est[oô]mago|g[aá]strico)\b/i, 'gastric cancer'],
  [/\bcancro\s*(?:da\s*)?pr[oó]stata\b/i, 'prostate cancer'],
  [/\bcancro\s*(?:do\s*)?p[aâ]ncreas\b/i, 'pancreatic cancer'],
  [/\bcancro\s*(?:do\s*)?ov[aá]rio\b/i, 'ovarian cancer'],
  [/\bcancro\s*(?:do\s*)?endom[eé]trio\b/i, 'endometrial cancer'],
  [/\bcancro\s*(?:do\s*)?f[ií]gado\b/i, 'hepatocellular carcinoma'],
  [/\bcancro\s*(?:da\s*)?bexiga\b/i, 'urothelial carcinoma'],
  [/\bcancro\s*(?:do\s*)?es[oó]fago\b/i, 'esophageal cancer'],
  [/\bcancro\s*(?:da\s*)?(?:cabe[cç]a|cabeca)\s*e\s*pesco[cç]o\b/i, 'head and neck squamous cell carcinoma'],
  // Portuguese haematological
  [/\blinfoma\s*(?:difuso\s*(?:de\s*)?grandes\s*c[eé]lulas\s*b|dlbcl)\b/i, 'diffuse large b-cell lymphoma'],
  [/\blinfoma\s*(?:do\s*)?manto\b/i, 'mantle cell lymphoma'],
  [/\blinfoma\s*folicular\b/i, 'follicular lymphoma'],
  [/\blinfoma\s*(?:de\s*)?hodgkin\b/i, 'hodgkin lymphoma'],
  [/\blinfoma\b/i, 'lymphoma'],
  [/\bleucem[ií]a\s*miel[oó]ide\s*aguda\b/i, 'acute myeloid leukemia'],
  [/\bleucem[ií]a\s*linfoblástica\s*aguda\b/i, 'acute lymphoblastic leukemia'],
  [/\bleucem[ií]a\s*linfoc[ií]tica\s*cr[oô]nica\b/i, 'chronic lymphocytic leukemia'],
  [/\bleucem[ií]a\s*miel[oó]ide\s*cr[oô]nica\b/i, 'chronic myeloid leukemia'],
  [/\bleucem[ií]a\b/i, 'leukemia'],
  [/\bmieloma\s*m[uú]ltiplo\b/i, 'multiple myeloma'],
  [/\bmielofibrose\b/i, 'myelofibrosis'],
  [/\bs[ií]ndrome\s*mielodispl[aá]sic[ao]\b/i, 'myelodysplastic syndrome'],
];

// ---- Biomarker patterns ---------------------------------------------------

const BIOMARKER_PATTERNS = [
  [/\b(?:msi[- ]?h|microsatellite\s*instability[- ]?high)\b/i, 'MSI-H/dMMR'],
  [/\bdmmr\b/i, 'MSI-H/dMMR'],
  [/\b(?:pd[- ]?l1|pdl1)\b/i, 'PD-L1'],
  [/\b(?:her2|erbb2)[- ]?(?:positive|\+)\b/i, 'HER2-positive'],
  [/\b(?:her2|erbb2)[- ]?low\b/i, 'HER2-low'],       // distinct therapeutic entity (T-DXd)
  [/\b(?:her2|erbb2)[- ]?(?:negative|-)\b/i, 'HER2-negative'],
  [/\begfr\s*(?:exon\s*(?:19|20|21)|mutation|mut|mutated|del|deletion|l858r|c797s)?\b/i, 'EGFR mutation'],
  [/\b(?:alk)\s*(?:positive|\+|rearrang|fusion|translocat)\b/i, 'ALK-positive'],
  [/\b(?:brca)\s*(?:1|2|1\/2|mutation|mut|germline|somatic)?\b/i, 'BRCA mutation'],
  [/\b(?:kras)\s*g12c\b/i, 'KRAS G12C'],
  [/\b(?:braf)\s*v600[ek]?\b/i, 'BRAF V600'],
  [/\b(?:braf)\s*(?:mutation|mut)\b/i, 'BRAF mutation'],
  [/\bntrk\s*(?:fusion|rearrangement)?\b/i, 'NTRK fusion'],
  [/\bros1\s*(?:positive|\+|fusion|rearrangement)?\b/i, 'ROS1-positive'],
  [/\bret\s*(?:fusion|mutation|rearrangement)?\b/i, 'RET alteration'],
  [/\b(?:hr\+|hormone[- ]?receptor[- ]?positive|hr[- ]?positiv[eo])\b/i, 'HR-positive'],
  [/\b(?:tmb[- ]?h|tumor\s*mutational\s*burden[- ]?high)\b/i, 'TMB-H'],
  [/\bfgfr\s*(?:1|2|3|4)?\s*(?:alteration|mutation|fusion|amplif)?\b/i, 'FGFR alteration'],
  [/\bmet\s*(?:exon\s*14|amplif|overexpress)\b/i, 'MET alteration'],
  [/\bpik3ca\s*(?:mutation|mut)?\b/i, 'PIK3CA mutation'],
  [/\b(?:idh1|idh2)\s*(?:mutation|mut|r132|r140|r172)?\b/i, 'IDH mutation'],
  [/\besr1\s*(?:mutation|mut)?\b/i, 'ESR1 mutation'],                        // elacestrant
  [/\bpsma[- ]?(?:positive|\+|express)?\b/i, 'PSMA-positive'],               // lutetium vipivotide
  [/\b(?:hrd|homologous\s*recombination\s*deficien)\b/i, 'HRD positive'],    // olaparib/niraparib extended
  [/\b(?:claudin[- ]?18\.2|cldn18\.?2)\b/i, 'Claudin 18.2-positive'],       // zolbetuximab
  [/\btrop[- ]?2\s*(?:positive|\+|express|high)?\b/i, 'TROP2-positive'],    // sacituzumab
  [/\bsstr\s*(?:2|positive|\+)?\b/i, 'SSTR-positive'],                      // lutetium oxodotreotide
  // Portuguese
  [/\b(?:instabilidade\s*(?:de\s*)?micross?atélite|instabilidade\s*(?:de\s*)?microsatelite)\b/i, 'MSI-H/dMMR'],
  [/\btriplo[- ]?negativ[ao]\b/i, 'Triple-negative'],
  [/\brecep?tor(?:es)?\s*hormonais?\s*positiv[ao]s?\b/i, 'HR-positive'],
  [/\bmuta[cç][aã]o\s*(?:de\s*)?brca\b/i, 'BRCA mutation'],
];

// ---- Line of therapy patterns ---------------------------------------------
// IMPORTANT: more specific patterns (2L+, 3L+) BEFORE their base (2L, 3L)
// because /\b2l\b/ matches "2L+" (word boundary after 'l' before '+').

const LINE_PATTERNS = [
  [/\b(?:2l\+|2nd[- ]?line\s*(?:or\s*later|and\s*beyond|\+)|second[- ]?line\s*(?:or\s*later|and\s*beyond|\+))\b/i, '2L+'],
  [/\b(?:after\s*(?:first[- ]?line|1l)\s*(?:failure|progression|therapy))\b/i, '2L+'],
  [/\b(?:ap[oó]s\s*(?:primeira|1[aª])\s*linha)\b/i, '2L+'],
  [/\b(?:3l\+|3rd[- ]?line\s*(?:or\s*later|and\s*beyond|\+)|third[- ]?line\s*(?:or\s*later|and\s*beyond|\+))\b/i, '3L+'],
  [/\b(?:first[- ]?line|1st[- ]?line|1l\b|primeira[- ]?linha)\b/i, '1L'],
  [/\b(?:second[- ]?line|2nd[- ]?line|2l\b|segunda[- ]?linha)\b/i, '2L'],
  [/\b(?:third[- ]?line|3rd[- ]?line|3l\b|terceira[- ]?linha)\b/i, '3L'],
  [/\b(?:neoadjuvant|neoadjuvante)\b/i, 'neoadjuvant'],   // neoadjuvant before adjuvant — "neoadjuvant" contains "adjuvant"
  [/\b(?:adjuvant|adjuvante)\b/i, 'adjuvant'],
  [/\b(?:maintenance|manuten[cç][aã]o)\b/i, 'maintenance'],
  [/\b(?:perioperativ[eo])\b/i, 'perioperative'],
];

// ---- Stage patterns -------------------------------------------------------
// IMPORTANT: 'locally advanced' BEFORE 'metastatic' — "locally advanced"
// contains "advanced" which is also in the metastatic pattern.

const STAGE_PATTERNS = [
  [/\b(?:locally\s*advanced|localmente\s*avan[cç]ado|stage\s*iii\b|estadio\s*iii\b|unresectable|irressec[aá]vel)\b/i, 'locally_advanced'],
  [/\b(?:metastatic|metast[aá]s[eé]?|stage\s*iv\b|estadio\s*iv\b)\b/i, 'metastatic'],
  [/\bavan[cç]ado\b/i, 'metastatic'],   // "avançado" alone (after locally_advanced already handled above)
  [/\b(?:early[- ]?stage|precoce|stage\s*(?:i|ii)\b|estadio\s*(?:i|ii)\b|resectable|ressec[aá]vel|curative|curativ[ao])\b/i, 'early'],
  [/\b(?:adjuvant|adjuvante|neoadjuvant|neoadjuvante)\b/i, 'early'],
];

/**
 * Extracts clinical terms from a question and/or structured parameters.
 * Returns { substance, cancerType, biomarker, lineOfTherapy, stage }.
 */
export function extractClinicalTerms({
  question = '',
  substance = '',
  cancerType = '',
  biomarker = '',
  lineOfTherapy = '',
  population = '',
  intervention = ''
} = {}) {
  let detectedSubstance = substance || intervention || '';
  let detectedCancer = cancerType || population || '';
  let detectedBiomarker = biomarker || '';
  let detectedLine = lineOfTherapy || '';
  let detectedStage = '';

  const q = (question || '').toLowerCase();
  const fullText = `${question} ${population} ${intervention}`;

  // Drug detection — match against known oncology substances
  if (!detectedSubstance && q) {
    for (const sub of ONCOLOGY_SUBSTANCES) {
      if (q.includes(sub.toLowerCase())) {
        detectedSubstance = sub;
        break;
      }
    }
  }

  // Cancer type detection
  if (!detectedCancer) {
    for (const [pattern, type] of CANCER_PATTERNS) {
      if (pattern.test(fullText)) {
        detectedCancer = type;
        break;
      }
    }
  }

  // Biomarker detection
  if (!detectedBiomarker) {
    for (const [pattern, marker] of BIOMARKER_PATTERNS) {
      if (pattern.test(fullText)) {
        detectedBiomarker = marker;
        break;
      }
    }
  }

  // Line of therapy detection
  if (!detectedLine) {
    for (const [pattern, line] of LINE_PATTERNS) {
      if (pattern.test(fullText)) {
        detectedLine = line;
        break;
      }
    }
  }

  // Stage detection
  for (const [pattern, stage] of STAGE_PATTERNS) {
    if (pattern.test(fullText)) {
      detectedStage = stage;
      break;
    }
  }

  return {
    substance: detectedSubstance,
    cancerType: detectedCancer,
    biomarker: detectedBiomarker,
    lineOfTherapy: detectedLine,
    stage: detectedStage
  };
}

export { CANCER_PATTERNS, BIOMARKER_PATTERNS, LINE_PATTERNS, STAGE_PATTERNS };
