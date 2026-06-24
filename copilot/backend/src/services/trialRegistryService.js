import cron from 'node-cron';

import admin, { firebaseApp } from '../config/firebase.js';
import { openai as defaultOpenAI } from '../config/openai.js';
import { createFastModelRouter } from '../lib/fastModelRouter.js';
import { parseBoolean, parseCsv, parseInteger } from '../config/runtimeEnv.js';
import { logger as defaultLogger } from '../utils/logger.js';
import { createTrialRegistryStore } from '../../trialRegistryStore.js';
import { runTrialRegistrySync } from '../../trialRegistrySync.js';
import TrialMatchAgent from './simple-chat/TrialMatchAgent.js';
import { normalizeSites } from './portugueseHospitalMap.js';

const RECRUITING_STATUS = 'RECRUITING';
const DEFAULT_ACTIVE_STATUSES = [RECRUITING_STATUS];

const DEFAULT_SCHEDULE = '0 3 * * 1';
const DEFAULT_TIMEZONE = 'Europe/Lisbon';
const DEFAULT_LOCATION = 'Portugal';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'onto', 'about',
  'what', 'which', 'when', 'where', 'show', 'find', 'trial', 'trials', 'study',
  'studies', 'available', 'recruiting', 'active', 'patient', 'patients',
  'cancer', 'tumor', 'tumour', 'therapy', 'treatment', 'line', 'question',
  'portugal', 'does', 'work', 'need', 'evidence', 'search', 'searching',
  'clinical', 'in', 'on', 'to', 'of', 'a', 'an', 'or', 'by',
  'que', 'como', 'para', 'com', 'sem', 'dos', 'das', 'nos', 'nas', 'ensaios',
  'ensaio', 'doente', 'doentes', 'disponiveis', 'disponíveis', 'recrutamento'
]);

const COUNTRY_REGION_MAP = new Map([
  ['portugal', 'Europe'],
  ['spain', 'Europe'],
  ['france', 'Europe'],
  ['germany', 'Europe'],
  ['italy', 'Europe'],
  ['united kingdom', 'Europe'],
  ['ireland', 'Europe'],
  ['belgium', 'Europe'],
  ['netherlands', 'Europe'],
  ['switzerland', 'Europe'],
  ['austria', 'Europe'],
  ['sweden', 'Europe'],
  ['norway', 'Europe'],
  ['denmark', 'Europe'],
  ['poland', 'Europe'],
  ['czech republic', 'Europe'],
  ['united states', 'North America'],
  ['canada', 'North America'],
  ['mexico', 'North America'],
  ['brazil', 'Latin America'],
  ['argentina', 'Latin America'],
  ['chile', 'Latin America'],
  ['colombia', 'Latin America'],
  ['peru', 'Latin America'],
  ['china', 'Asia-Pacific'],
  ['japan', 'Asia-Pacific'],
  ['south korea', 'Asia-Pacific'],
  ['australia', 'Asia-Pacific'],
  ['new zealand', 'Asia-Pacific'],
  ['india', 'Asia-Pacific'],
  ['singapore', 'Asia-Pacific'],
  ['taiwan', 'Asia-Pacific'],
  ['hong kong', 'Asia-Pacific'],
  ['israel', 'Middle East/Africa'],
  ['saudi arabia', 'Middle East/Africa'],
  ['united arab emirates', 'Middle East/Africa'],
  ['south africa', 'Middle East/Africa'],
  ['egypt', 'Middle East/Africa']
]);

const ONCOLOGY_ALIAS_MAP = new Map([
  // Disease acronyms
  ['nsclc', 'non small cell lung cancer lung'],
  ['sclc', 'small cell lung cancer lung'],
  ['tnbc', 'triple negative breast cancer breast'],
  ['hr+', 'hormone receptor positive breast'],
  ['hr positive', 'hormone receptor positive breast'],
  ['her2-', 'her2 negative breast'],
  ['her2 negative', 'her2 negative breast'],
  ['her2+', 'her2 positive breast trastuzumab'],
  ['crc', 'colorectal cancer colon rectal'],
  ['mcrc', 'metastatic colorectal cancer colon rectal'],
  ['hnscc', 'head neck squamous cell carcinoma head neck'],
  ['gbm', 'glioblastoma brain glioma'],
  ['ovca', 'ovarian cancer ovarian'],
  ['hcc', 'hepatocellular carcinoma liver'],
  ['rcc', 'renal cell carcinoma kidney'],
  ['ubc', 'urothelial bladder cancer bladder'],
  ['pca', 'prostate cancer prostate'],
  ['mcrpc', 'metastatic castration resistant prostate cancer prostate'],
  ['crpc', 'castration resistant prostate cancer prostate'],
  ['pdac', 'pancreatic ductal adenocarcinoma pancreatic'],
  ['mbc', 'metastatic breast cancer breast'],
  ['aml', 'acute myeloid leukemia leukemia'],
  ['cll', 'chronic lymphocytic leukemia leukemia'],
  ['dlbcl', 'diffuse large b cell lymphoma lymphoma'],
  ['mm', 'multiple myeloma myeloma'],
  ['mds', 'myelodysplastic syndrome'],
  ['cml', 'chronic myeloid leukemia leukemia'],
  ['all', 'acute lymphoblastic leukemia leukemia'],
  ['hl', 'hodgkin lymphoma lymphoma'],
  ['nhl', 'non hodgkin lymphoma lymphoma'],
  ['mpm', 'malignant pleural mesothelioma mesothelioma'],
  ['escc', 'esophageal squamous cell carcinoma esophageal'],
  ['eac', 'esophageal adenocarcinoma esophageal'],
  ['gc', 'gastric cancer gastric stomach'],
  ['gej', 'gastroesophageal junction gastric'],
  ['cca', 'cholangiocarcinoma biliary bile duct'],
  ['bdc', 'biliary duct cancer biliary'],
  ['thca', 'thyroid cancer thyroid'],
  ['mcc', 'merkel cell carcinoma merkel'],

  // Biomarkers
  ['er+', 'estrogen receptor positive breast'],
  ['pr+', 'progesterone receptor positive breast'],
  ['msi-h', 'microsatellite instability high mismatch repair deficient mmr'],
  ['msi high', 'microsatellite instability high mismatch repair deficient'],
  ['dmmr', 'mismatch repair deficient microsatellite instability'],
  ['mmrd', 'mismatch repair deficient microsatellite instability'],
  ['brca1/2', 'brca1 brca2 brca homologous recombination'],
  ['brca', 'brca1 brca2 brca homologous recombination'],
  ['pdl1', 'pd-l1 pd1 programmed death checkpoint'],
  ['pd-l1', 'pd-l1 pd1 programmed death checkpoint immunotherapy'],
  ['tmb', 'tumor mutational burden biomarker'],
  ['tmb-h', 'tumor mutational burden high biomarker'],
  ['egfr', 'epidermal growth factor receptor egfr'],
  ['alk', 'anaplastic lymphoma kinase alk rearrangement'],
  ['ros1', 'ros1 rearrangement fusion'],
  ['kras', 'kras mutation ras'],
  ['kras g12c', 'kras g12c mutation kras'],
  ['braf', 'braf mutation braf v600'],
  ['braf v600', 'braf v600e mutation braf'],
  ['ntrk', 'ntrk fusion trk tropomyosin receptor'],
  ['ret', 'ret fusion rearrangement'],
  ['met', 'met amplification exon14 skipping hepatocyte growth factor'],
  ['erbb2', 'her2 erbb2 trastuzumab'],
  ['pik3ca', 'pik3ca mutation pi3k'],
  ['fgfr', 'fgfr fibroblast growth factor receptor'],
  ['cdh1', 'cdh1 e-cadherin hereditary gastric'],
  ['tp53', 'tp53 p53 tumor suppressor'],
  ['arid1a', 'arid1a swi/snf'],
  ['homologous recombination', 'brca parp homologous recombination repair'],
  ['hrd', 'homologous recombination deficiency brca parp'],

  // PD-1/PD-L1 checkpoint inhibitors (most commonly queried)
  ['pembrolizumab', 'pembrolizumab pd-1 anti-pd-1 pd1 keytruda mk-3475 checkpoint immunotherapy'],
  ['nivolumab', 'nivolumab pd-1 anti-pd-1 pd1 opdivo bms-936558 checkpoint immunotherapy'],
  ['atezolizumab', 'atezolizumab pd-l1 anti-pd-l1 tecentriq checkpoint immunotherapy'],
  ['durvalumab', 'durvalumab pd-l1 anti-pd-l1 imfinzi checkpoint immunotherapy'],
  ['avelumab', 'avelumab pd-l1 anti-pd-l1 bavencio checkpoint immunotherapy'],
  ['ipilimumab', 'ipilimumab ctla-4 anti-ctla-4 yervoy checkpoint immunotherapy'],
  ['cemiplimab', 'cemiplimab pd-1 anti-pd-1 pd1 libtayo checkpoint immunotherapy'],
  ['dostarlimab', 'dostarlimab pd-1 anti-pd-1 pd1 jemperli checkpoint immunotherapy'],
  ['tremelimumab', 'tremelimumab ctla-4 anti-ctla-4 checkpoint immunotherapy'],

  // Anti-HER2
  ['trastuzumab', 'trastuzumab herceptin her2 anti-her2 erbb2'],
  ['pertuzumab', 'pertuzumab perjeta her2 anti-her2'],
  ['lapatinib', 'lapatinib tykerb her2 egfr tyrosine kinase inhibitor'],
  ['neratinib', 'neratinib nerlynx her2 tyrosine kinase inhibitor'],
  ['tucatinib', 'tucatinib tukysa her2 tyrosine kinase inhibitor'],
  ['trastuzumab deruxtecan', 'trastuzumab deruxtecan t-dxd enhertu her2 adc'],
  ['t-dxd', 'trastuzumab deruxtecan enhertu her2 adc antibody drug conjugate'],
  ['ado-trastuzumab', 'trastuzumab emtansine tdm1 kadcyla her2 adc'],
  ['tdm1', 'trastuzumab emtansine kadcyla her2 adc antibody drug conjugate'],

  // VEGF/angiogenesis
  ['bevacizumab', 'bevacizumab avastin vegf anti-vegf angiogenesis'],
  ['ramucirumab', 'ramucirumab cyramza vegfr2 anti-vegfr'],
  ['sunitinib', 'sunitinib sutent vegfr tyrosine kinase inhibitor'],
  ['sorafenib', 'sorafenib nexavar vegfr raf tyrosine kinase inhibitor'],
  ['pazopanib', 'pazopanib votrient vegfr tyrosine kinase inhibitor'],
  ['axitinib', 'axitinib inlyta vegfr tyrosine kinase inhibitor'],
  ['cabozantinib', 'cabozantinib cabometyx cometriq vegfr met tyrosine kinase inhibitor'],
  ['lenvatinib', 'lenvatinib lenvima vegfr fgfr tyrosine kinase inhibitor'],
  ['regorafenib', 'regorafenib stivarga vegfr raf multikinase inhibitor'],

  // EGFR inhibitors
  ['erlotinib', 'erlotinib tarceva egfr tyrosine kinase inhibitor nsclc'],
  ['gefitinib', 'gefitinib iressa egfr tyrosine kinase inhibitor nsclc'],
  ['afatinib', 'afatinib giotrif gilotrif egfr her2 tyrosine kinase inhibitor'],
  ['osimertinib', 'osimertinib tagrisso egfr t790m third generation inhibitor nsclc'],
  ['dacomitinib', 'dacomitinib vizimpro egfr tyrosine kinase inhibitor'],
  ['cetuximab', 'cetuximab erbitux egfr anti-egfr colorectal head neck'],
  ['panitumumab', 'panitumumab vectibix egfr anti-egfr colorectal'],

  // ALK/ROS1/RET inhibitors
  ['crizotinib', 'crizotinib xalkori alk ros1 met inhibitor nsclc'],
  ['alectinib', 'alectinib alecensa alk inhibitor nsclc'],
  ['brigatinib', 'brigatinib alunbrig alk inhibitor nsclc'],
  ['lorlatinib', 'lorlatinib lorbrena alk ros1 inhibitor nsclc'],
  ['ceritinib', 'ceritinib zykadia alk inhibitor nsclc'],
  ['entrectinib', 'entrectinib rozlytrek ntrk ros1 alk inhibitor'],
  ['larotrectinib', 'larotrectinib vitrakvi ntrk trk inhibitor'],
  ['selpercatinib', 'selpercatinib retevmo ret inhibitor nsclc thyroid'],
  ['pralsetinib', 'pralsetinib gavreto ret inhibitor nsclc thyroid'],
  ['capmatinib', 'capmatinib tabrecta met exon14 inhibitor nsclc'],
  ['tepotinib', 'tepotinib tepmetko met exon14 inhibitor nsclc'],
  ['amivantamab', 'amivantamab rybrevant egfr met bispecific nsclc'],

  // KRAS/BRAF
  ['sotorasib', 'sotorasib lumakras kras g12c inhibitor nsclc colorectal'],
  ['adagrasib', 'adagrasib krazati kras g12c inhibitor nsclc colorectal'],
  ['vemurafenib', 'vemurafenib zelboraf braf v600e inhibitor melanoma'],
  ['dabrafenib', 'dabrafenib tafinlar braf v600 inhibitor melanoma nsclc'],
  ['encorafenib', 'encorafenib braftovi braf v600 inhibitor melanoma colorectal'],
  ['trametinib', 'trametinib mekinist mek inhibitor braf melanoma'],
  ['cobimetinib', 'cobimetinib cotellic mek inhibitor braf melanoma'],
  ['binimetinib', 'binimetinib mektovi mek inhibitor braf melanoma'],

  // CDK4/6 inhibitors
  ['palbociclib', 'palbociclib ibrance cdk4 cdk6 cyclin inhibitor breast'],
  ['ribociclib', 'ribociclib kisqali cdk4 cdk6 cyclin inhibitor breast'],
  ['abemaciclib', 'abemaciclib verzenio cdk4 cdk6 cyclin inhibitor breast'],

  // PARP inhibitors
  ['olaparib', 'olaparib lynparza parp inhibitor brca ovarian breast prostate'],
  ['niraparib', 'niraparib zejula parp inhibitor brca ovarian'],
  ['rucaparib', 'rucaparib rubraca parp inhibitor brca ovarian'],
  ['talazoparib', 'talazoparib talzenna parp inhibitor brca breast'],
  ['veliparib', 'veliparib parp inhibitor brca'],

  // PI3K/AKT/mTOR
  ['everolimus', 'everolimus afinitor mtor inhibitor breast rcc'],
  ['temsirolimus', 'temsirolimus torisel mtor inhibitor rcc'],
  ['idelalisib', 'idelalisib zydelig pi3k delta inhibitor cll lymphoma'],
  ['copanlisib', 'copanlisib aliqopa pi3k inhibitor lymphoma'],
  ['alpelisib', 'alpelisib piqray pi3k alpha inhibitor breast pik3ca'],
  ['capivasertib', 'capivasertib truqap akt inhibitor breast'],
  ['ipatasertib', 'ipatasertib akt inhibitor breast prostate'],

  // BTK inhibitors
  ['ibrutinib', 'ibrutinib imbruvica btk inhibitor cll mcl lymphoma'],
  ['acalabrutinib', 'acalabrutinib calquence btk inhibitor cll lymphoma'],
  ['zanubrutinib', 'zanubrutinib brukinsa btk inhibitor cll lymphoma'],
  ['pirtobrutinib', 'pirtobrutinib jaypirca btk inhibitor cll lymphoma'],

  // BCL-2/venetoclax
  ['venetoclax', 'venetoclax venclexta bcl-2 inhibitor aml cll'],

  // ADCs
  ['sacituzumab', 'sacituzumab govitecan trodelvy trop2 adc breast urothelial'],
  ['enfortumab', 'enfortumab vedotin padcev nectin4 adc urothelial bladder'],
  ['belantamab', 'belantamab mafodotin blenrep bcma adc myeloma'],
  ['loncastuximab', 'loncastuximab tesirine zynlonta cd19 adc lymphoma'],
  ['polatuzumab', 'polatuzumab vedotin polivy cd79b adc lymphoma'],
  ['inotuzumab', 'inotuzumab ozogamicin besylone cd22 adc leukemia'],

  // Hormonal therapies
  ['enzalutamide', 'enzalutamide xtandi androgen receptor inhibitor prostate'],
  ['abiraterone', 'abiraterone zytiga abiraterone acetate androgen biosynthesis prostate'],
  ['apalutamide', 'apalutamide erleada androgen receptor inhibitor prostate'],
  ['darolutamide', 'darolutamide nubeqa androgen receptor inhibitor prostate'],
  ['fulvestrant', 'fulvestrant faslodex er estrogen receptor degrader breast'],
  ['tamoxifen', 'tamoxifen serm estrogen receptor breast'],
  ['letrozole', 'letrozole femara aromatase inhibitor breast'],
  ['anastrozole', 'anastrozole arimidex aromatase inhibitor breast'],
  ['exemestane', 'exemestane aromasin aromatase inhibitor breast'],
  ['elacestrant', 'elacestrant orserdu er estrogen receptor degrader breast esr1'],

  // IDH inhibitors
  ['enasidenib', 'enasidenib idhifa idh2 inhibitor aml'],
  ['ivosidenib', 'ivosidenib tibsovo idh1 inhibitor aml cholangiocarcinoma'],
  ['olutasidenib', 'olutasidenib rezlidhia idh1 inhibitor aml'],

  // FLT3 inhibitors
  ['midostaurin', 'midostaurin rydapt flt3 inhibitor aml'],
  ['gilteritinib', 'gilteritinib xospata flt3 inhibitor aml'],
  ['quizartinib', 'quizartinib vanflyta flt3 inhibitor aml'],

  // CD20 therapies
  ['rituximab', 'rituximab mabthera rituxan cd20 anti-cd20 lymphoma cll'],
  ['obinutuzumab', 'obinutuzumab gazyva cd20 anti-cd20 lymphoma cll'],
  ['ofatumumab', 'ofatumumab arzerra cd20 anti-cd20 cll lymphoma'],
  ['mosunetuzumab', 'mosunetuzumab lunsumio cd20 cd3 bispecific lymphoma'],

  // Miscellaneous targeted therapies
  ['olaparib', 'olaparib lynparza parp inhibitor brca ovarian'],
  ['imatinib', 'imatinib gleevec glivec bcr-abl tyrosine kinase inhibitor cml gist'],
  ['dasatinib', 'dasatinib sprycel bcr-abl src tyrosine kinase inhibitor cml all'],
  ['nilotinib', 'nilotinib tasigna bcr-abl tyrosine kinase inhibitor cml'],
  ['ponatinib', 'ponatinib iclusig bcr-abl t315i inhibitor cml all'],
  ['irinotecan', 'irinotecan camptosar camptothecin topoisomerase colorectal'],
  ['oxaliplatin', 'oxaliplatin eloxatin platinum chemotherapy colorectal'],
  ['capecitabine', 'capecitabine xeloda fluoropyrimidine chemotherapy breast colorectal'],
  ['gemcitabine', 'gemcitabine gemzar antimetabolite chemotherapy pancreatic lung breast'],
  ['docetaxel', 'docetaxel taxotere taxane chemotherapy breast lung prostate'],
  ['paclitaxel', 'paclitaxel taxol taxane chemotherapy breast lung ovarian'],
  ['nab-paclitaxel', 'nab-paclitaxel abraxane albumin paclitaxel taxane chemotherapy'],
  ['carboplatin', 'carboplatin paraplatin platinum chemotherapy'],
  ['cisplatin', 'cisplatin platinol platinum chemotherapy'],
  ['etoposide', 'etoposide vp-16 topoisomerase sclc'],
  ['pemetrexed', 'pemetrexed alimta antifolate chemotherapy nsclc mesothelioma'],
  ['5-fu', '5-fluorouracil fluorouracil fluoropyrimidine chemotherapy colorectal'],
  ['doxorubicin', 'doxorubicin adriamycin anthracycline chemotherapy breast sarcoma'],
  ['cyclophosphamide', 'cyclophosphamide cytoxan alkylating chemotherapy'],
  ['trastuzumab emtansine', 'trastuzumab emtansine tdm1 kadcyla her2 adc'],
  ['elotuzumab', 'elotuzumab empliciti slamf7 cs1 myeloma'],
  ['daratumumab', 'daratumumab darzalex cd38 anti-cd38 myeloma'],
  ['isatuximab', 'isatuximab sarclisa cd38 anti-cd38 myeloma'],

  // Disease stage / setting
  ['1l', 'first line first-line frontline treatment naive'],
  ['2l', 'second line second-line previously treated'],
  ['2l+', 'second line later line previously treated relapsed refractory'],
  ['3l', 'third line third-line heavily pretreated'],
  ['mtnbc', 'metastatic triple negative breast cancer breast'],
  ['la', 'locally advanced'],
  ['metastatic', 'metastatic advanced disseminated stage iv'],
  ['neoadjuvant', 'neoadjuvant pre-operative preoperative induction'],
  ['adjuvant', 'adjuvant post-operative postoperative maintenance'],
]);

const normalizeKey = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const normalizeText = (value = '') =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/+.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const uniq = (items = []) => [...new Set(items.filter(Boolean))];

const truncate = (value = '', max = 220) => {
  const text = String(value || '').trim();
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
};

const parseList = (value) => {
  if (Array.isArray(value)) return uniq(value.map((item) => String(item || '').trim()));
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') {
    return uniq(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    );
  }
  return [];
};

const hasMeaningfulValue = (value) => {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((item) => hasMeaningfulValue(item));
  if (typeof value === 'object') return Object.values(value).some((item) => hasMeaningfulValue(item));
  return true;
};

const normalizeStatusFilter = (value = '') => normalizeKey(value).toUpperCase();

const extractPhaseRank = (phases = []) => {
  const values = parseList(phases);
  let best = 0;

  values.forEach((value) => {
    const normalized = normalizeText(value)
      .replace(/phase/g, ' ')
      .replace(/early/g, '')
      .trim()
      .replace(/\s+/g, '')
      .replace(/[^iv0-9/]+/g, '');

    if (['ii/iii', '2/3'].includes(normalized)) best = Math.max(best, 4.5);
    else if (['iii', '3'].includes(normalized)) best = Math.max(best, 5);
    else if (['ii', '2'].includes(normalized)) best = Math.max(best, 4);
    else if (['i/ii', '1/2'].includes(normalized)) best = Math.max(best, 3);
    else if (['iv', '4'].includes(normalized)) best = Math.max(best, 2);
    else if (['i', '1'].includes(normalized)) best = Math.max(best, 1);
  });

  return best;
};

const hasIpoPortoSite = (trial = {}) => {
  const ipoPattern = /(?:\bipo\b.*\bporto\b)|(?:instituto portugu[eê]s de oncologia.*porto)|(?:oncologia do porto)/i;
  return (trial.locations || []).some((location) => {
    const facility = String(location?.facility || '');
    const city = String(location?.city || '');
    return ipoPattern.test(facility) || (/\bipo\b/i.test(facility) && /\bporto\b/i.test(city));
  });
};

const normalizeTrialRegistryInput = (input = {}) => ({
  ...input,
  statuses: ['Recruiting'],
  recruitingInPortugalOnly: true
});

const normalizePhaseFilter = (value = '') =>
  normalizeText(value)
    .replace(/phase/g, ' ')
    .replace(/early/g, '')
    .trim()
    .replace(/\b1\b/g, 'i')
    .replace(/\b2\b/g, 'ii')
    .replace(/\b3\b/g, 'iii')
    .replace(/\b4\b/g, 'iv')
    .replace(/\s+/g, '')
    .replace(/[^iv/]+/g, '');

const expandAliases = (value = '') => {
  let expanded = ` ${normalizeText(value)} `;
  for (const [alias, replacement] of ONCOLOGY_ALIAS_MAP.entries()) {
    const pattern = new RegExp(`(^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'g');
    expanded = expanded.replace(pattern, ` ${replacement} `);
  }
  return expanded.replace(/\s+/g, ' ').trim();
};

// Primary cancer type keywords used to enforce cancer-type overlap between query and trial.
// Prevents unrelated tumour types (e.g. prostate) from appearing in NSCLC searches.
const PRIMARY_CANCER_TYPES = new Set([
  'lung', 'nsclc', 'sclc', 'breast', 'prostate', 'colorectal', 'colon', 'rectal',
  'melanoma', 'ovarian', 'pancreatic', 'gastric', 'stomach', 'esophageal',
  'hepatocellular', 'liver', 'kidney', 'renal', 'bladder', 'urothelial',
  'glioblastoma', 'glioma', 'brain', 'thyroid', 'merkel', 'mesothelioma',
  'cholangiocarcinoma', 'biliary', 'sarcoma', 'lymphoma', 'leukemia',
  'myeloma', 'myelodysplastic', 'hodgkin', 'cervical', 'endometrial',
  'uterine', 'testicular', 'head', 'neck', 'hnscc', 'neuroblastoma',
  'retinoblastoma', 'wilms', 'carcinoid', 'neuroendocrine', 'adrenal',
  'pheochromocytoma', 'thymoma', 'penile', 'vulvar', 'vaginal',
  'nasopharyngeal', 'laryngeal', 'oropharyngeal', 'salivary',
  'appendiceal', 'peritoneal', 'pleural', 'anal'
]);

const extractCancerTypeTokens = (tokens = []) =>
  tokens.filter((t) => PRIMARY_CANCER_TYPES.has(t));

// Simple oncology-aware stemmer: strips common suffixes so "melanomas" matches "melanoma", etc.
const stem = (token) => {
  if (token.length < 5) return token;
  // Preserve well-known oncology terms from over-stemming
  const preserve = new Set([
    'kinase', 'phase', 'dose', 'tissue', 'disease', 'icense', 'positive', 'negative',
    'invasive', 'intensive', 'sensitive', 'refractory', 'resistance', 'maintenance'
  ]);
  if (preserve.has(token)) return token;
  return token
    .replace(/omas$/,  'oma')   // carcinomas → carcinoma, melanomas → melanoma
    .replace(/ias$/,   'ia')    // leukemias → leukemia
    .replace(/ies$/,   'y')     // therapies → therapy
    .replace(/oses$/,  'osis')  // metastases → metastasis (close enough)
    .replace(/ants$/,  'ant')   // inhibitants
    .replace(/ents$/,  'ent')   // agents → agent
    .replace(/(?<![ius])es$/,  'e')  // kinases → kinase, but keep statuses
    .replace(/(?<![ius])s$/,   '');  // tumors → tumor, but keep status/radius
};

const tokenize = (value = '') =>
  uniq(
    expandAliases(value)
      .split(/\s+/)
      .map((token) => stem(token.trim()))
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
  );

// Build bigrams from an array of tokens (order-sensitive adjacent pairs)
const buildBigrams = (tokens = []) => {
  const bigrams = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.push(`${tokens[i]}|${tokens[i + 1]}`);
  }
  return bigrams;
};

const intersectionCount = (left = [], right = []) => {
  const rightSet = new Set(right);
  return left.filter((token) => rightSet.has(token)).length;
};

// Weighted intersection: exact match = 1.0, stem match already handled, bigram bonus
const smartIntersection = (queryTokens = [], trialTokens = []) => {
  const trialSet = new Set(trialTokens);
  const exactHits = queryTokens.filter((t) => trialSet.has(t)).length;

  // Bigram overlap rewards multi-word phrase matches (e.g. "non small" + "small cell")
  const queryBigrams = buildBigrams(queryTokens);
  const trialBigrams = new Set(buildBigrams(trialTokens));
  const bigramHits = queryBigrams.filter((b) => trialBigrams.has(b)).length;

  return exactHits + bigramHits * 0.5;
};

const buildRegionTags = (countries = []) => {
  const regions = new Set();
  countries.forEach((country) => {
    const normalized = normalizeText(country);
    const region = COUNTRY_REGION_MAP.get(normalized);
    if (region) regions.add(region);
  });
  if (regions.size > 1) regions.add('Global');
  return [...regions];
};

const getWeekKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
  const week = String(weekNo).padStart(2, '0');
  return `${utcDate.getUTCFullYear()}-W${week}`;
};

const getWeekRange = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { week: null, weekStart: null, weekEnd: null };
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  const weekStart = new Date(utcDate);
  weekStart.setUTCDate(utcDate.getUTCDate() - day + 1);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  return {
    week: getWeekKey(utcDate.toISOString()),
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString()
  };
};

const summarizeInterventions = (trial = {}) => {
  const names = uniq((trial.interventions || []).map((item) => item.name).filter(Boolean));
  return names.join(' + ');
};

const summarizeArms = (trial = {}) => {
  const arms = trial.arms || [];
  if (arms.length === 0) return '';
  return arms
    .map((arm) => {
      const label = arm.label || arm.type || '';
      const desc = arm.description || '';
      if (label && desc) return `${label}: ${desc}`;
      return label || desc;
    })
    .filter(Boolean)
    .slice(0, 6)
    .join(' | ');
};

const summarizeEligibility = (trial = {}) => {
  const parts = [];
  if (trial.minimumAge || trial.maximumAge) {
    parts.push([trial.minimumAge || 'Any age', trial.maximumAge || 'No upper age'].join(' to '));
  }
  if (trial.sex && normalizeText(trial.sex) !== 'all') {
    parts.push(trial.sex);
  }
  if (Array.isArray(trial.standardAges) && trial.standardAges.length > 0) {
    parts.push(trial.standardAges.join(', '));
  }
  if (trial.inclusionCriteria?.length) {
    parts.push(trial.inclusionCriteria[0]);
  }
  if (parts.length === 0 && trial.eligibilitySummary) {
    parts.push(trial.eligibilitySummary);
  }
  return parts.join(' • ');
};

const buildSearchText = (input = {}) => {
  const ordered = [
    input.q,
    input.question,
    input.population,
    input.biomarker,
    input.lineOfTherapy,
    input.intervention,
    input.comparator,
    input.outcomes
  ];

  return uniq(ordered.map((item) => String(item || '').trim()).filter(Boolean)).join(' ');
};

export const buildTrialRegistryInput = (question = '', options = {}, overrides = {}) => {
  const normalizedOptions = (options && typeof options === 'object' && !Array.isArray(options))
    ? options
    : {};

  return {
    q: overrides.q || question,
    question,
    population: overrides.population ?? normalizedOptions.population ?? normalizedOptions.clinicalContext?.population,
    biomarker: overrides.biomarker ?? normalizedOptions.biomarker ?? normalizedOptions.clinicalContext?.biomarker,
    lineOfTherapy: overrides.lineOfTherapy ?? normalizedOptions.lineOfTherapy ?? normalizedOptions.clinicalContext?.lineOfTherapy,
    intervention: overrides.intervention ?? normalizedOptions.intervention ?? normalizedOptions.clinicalContext?.intervention,
    comparator: overrides.comparator ?? normalizedOptions.comparator ?? normalizedOptions.clinicalContext?.comparator,
    outcomes: overrides.outcomes ?? normalizedOptions.outcomes ?? normalizedOptions.clinicalContext?.outcomes,
    phases: overrides.phases ?? normalizedOptions.trialPhases,
    statuses: ['Recruiting'],
    regions: overrides.regions ?? normalizedOptions.trialRegions,
    recruitingInPortugalOnly: true,
    maxTrials: overrides.maxTrials ?? normalizedOptions.maxTrials,
    maxConditions: overrides.maxConditions ?? normalizedOptions.maxConditions
  };
};

// Stage detection patterns (reuse the same patterns used at sync time)
const QUERY_STAGE_PATTERNS = [
  { stage: 'metastatic', pattern: /\b(?:metast[aá]tic[oa]?s?|metast[aá]tico|stage\s*iv|est[aá]dio\s*iv|advanced|avan[çc]ado|mcrc|mbc|mnsclc|m[a-z]{2,})\b/i },
  { stage: 'locally advanced', pattern: /\b(?:locally\s+advanced|localmente\s+avan[çc]ado|stage\s*iii[abc]?|est[aá]dio\s*iii[abc]?|unresectable|irressec[aá]vel|inoper[aá]vel)\b/i },
  { stage: 'localized', pattern: /\b(?:localiz(?:ed|ado)|early[- ]stage|est[aá]dio\s*precoce|stage\s*i[ab]?\b|stage\s*ii[abc]?\b|resectable|ressec[aá]vel|operable|oper[aá]vel|non[- ]metastatic|n[aã]o[- ]metast[aá]tico|curative|curativ[oa]|adjuvant|neoadjuvant)\b/i }
];

const detectQueryStage = (texts = []) => {
  const combined = texts.filter(Boolean).join(' ');
  for (const { stage, pattern } of QUERY_STAGE_PATTERNS) {
    if (pattern.test(combined)) return stage;
  }
  return '';
};

const buildQueryProfile = (input = {}) => {
  const searchText = buildSearchText(input);
  const detectedStage = detectQueryStage([input.q, input.question, input.population]);
  const allTokens = tokenize(searchText);
  const cancerTypeTokens = extractCancerTypeTokens(allTokens);
  return {
    searchText,
    normalizedSearchText: expandAliases(searchText),
    tokens: allTokens,
    cancerTypeTokens,
    populationTokens: tokenize(input.population || ''),
    biomarkerTokens: tokenize(input.biomarker),
    interventionTokens: tokenize(input.intervention),
    comparatorTokens: tokenize(input.comparator),
    outcomeTokens: tokenize(input.outcomes),
    lineTokens: tokenize(input.lineOfTherapy),
    detectedStage,
    phrases: uniq([
      input.population,
      input.biomarker,
      input.lineOfTherapy
    ].map((item) => expandAliases(item)).filter(Boolean))
  };
};

export class TrialRegistryService {
  constructor({
    logger = defaultLogger,
    env = process.env,
    storeFactory = null,
    openai = null
  } = {}) {
    this.logger = logger;
    this.env = env;
    this.storeFactory = storeFactory;
    this.openai = openai;
    this.fastModel = createFastModelRouter(openai);
    this.trialMatchAgent = new TrialMatchAgent();
    this.store = null;
    this.initPromise = null;
    this.syncPromise = null;
    this.scheduler = null;
  }

  get settings() {
    const syncStatuses = parseCsv(
      this.env.TRIAL_REGISTRY_SYNC_STATUSES || DEFAULT_ACTIVE_STATUSES.join(',')
    );

    return {
      enabled: parseBoolean(this.env.ENABLE_TRIAL_REGISTRY_SYNC, false),
      syncOnBoot: parseBoolean(this.env.TRIAL_REGISTRY_SYNC_ON_BOOT, true),
      schedule: this.env.TRIAL_REGISTRY_SYNC_SCHEDULE || DEFAULT_SCHEDULE,
      timezone: this.env.TRIAL_REGISTRY_SYNC_TIMEZONE || DEFAULT_TIMEZONE,
      location: this.env.TRIAL_REGISTRY_LOCATION || DEFAULT_LOCATION,
      staleHours: parseInteger(this.env.TRIAL_REGISTRY_SYNC_STALE_HOURS, 168),
      pageSize: parseInteger(this.env.TRIAL_REGISTRY_PAGE_SIZE, 100),
      maxPages: parseInteger(this.env.TRIAL_REGISTRY_MAX_PAGES, 20),
      store: this.env.TRIAL_REGISTRY_STORE || 'sqlite',
      sqlitePath: this.env.TRIAL_REGISTRY_SQLITE_PATH || './data/trial_registry.sqlite',
      filePath: this.env.TRIAL_REGISTRY_FILE_PATH || './data/trial_registry_snapshot.json',
      postgresUrl: this.env.TRIAL_REGISTRY_POSTGRES_URL || this.env.DATABASE_URL,
      collectionPrefix: this.env.TRIAL_REGISTRY_COLLECTION_PREFIX || 'trial_registry',
      conditionQuery: this.env.TRIAL_REGISTRY_CONDITION_QUERY || '',
      statuses: syncStatuses.length > 0 ? syncStatuses : [...DEFAULT_ACTIVE_STATUSES]
    };
  }

  async ensureInitialized() {
    if (this.store) return this.store;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      if (this.storeFactory) {
        this.store = await this.storeFactory();
        return this.store;
      }

      const store = await createTrialRegistryStore({
        firebaseAdmin: firebaseApp ? admin : null,
        logger: this.logger,
        options: {
          store: this.settings.store,
          sqlitePath: this.settings.sqlitePath,
          postgresUrl: this.settings.postgresUrl,
          databaseUrl: this.settings.postgresUrl,
          filePath: this.settings.filePath,
          collectionPrefix: this.settings.collectionPrefix
        }
      });

      this.store = store;
      return store;
    })();

    try {
      return await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  async start() {
    await this.ensureInitialized();
    this.startScheduler();

    if (this.settings.enabled && this.settings.syncOnBoot) {
      try {
        const latestRun = await this.store.getLatestRun();
        let needsSync = this.shouldSync(latestRun);

        // Also sync if runs exist but trials table is empty (corrupted state)
        if (!needsSync && latestRun) {
          const trials = await this.store.getTrials({ limit: 1 });
          if (!Array.isArray(trials) || trials.length === 0) {
            this.logger.warn('[TrialRegistry] Trials table is empty despite run record — forcing startup sync');
            needsSync = true;
          }
        }

        if (needsSync) {
          this.logger.info('[TrialRegistry] Performing startup sync');
          await this.runSync({ reason: 'startup' });
        }
      } catch (error) {
        this.logger.warn(`[TrialRegistry] Startup sync skipped: ${error.message}`);
      }
    }
  }

  startScheduler() {
    if (!this.settings.enabled || this.scheduler) return;
    if (!cron.validate(this.settings.schedule)) {
      this.logger.warn(`[TrialRegistry] Invalid cron expression: ${this.settings.schedule}`);
      return;
    }

    this.scheduler = cron.schedule(
      this.settings.schedule,
      () => {
        this.runSync({ reason: 'scheduled' }).catch((error) => {
          this.logger.error(`[TrialRegistry] Scheduled sync failed: ${error.message}`);
        });
      },
      {
        timezone: this.settings.timezone
      }
    );

    this.logger.info(
      `[TrialRegistry] Weekly sync scheduled (${this.settings.schedule}, ${this.settings.timezone})`
    );
  }

  stop() {
    if (!this.scheduler) return;
    this.scheduler.stop();
    if (typeof this.scheduler.destroy === 'function') this.scheduler.destroy();
    this.scheduler = null;
  }

  shouldSync(latestRun) {
    if (!latestRun) return true;
    if (this.settings.staleHours <= 0) return false;

    const finishedAt = latestRun.finishedAt || latestRun.lastSyncedAt || latestRun.startedAt;
    const timestamp = new Date(finishedAt);
    if (Number.isNaN(timestamp.getTime())) return true;

    const ageMs = Date.now() - timestamp.getTime();
    return ageMs >= (this.settings.staleHours * 60 * 60 * 1000);
  }

  async runSync({ reason = 'manual', force = false } = {}) {
    if (!this.settings.enabled && !force) {
      throw new Error('Trial registry sync is disabled');
    }

    if (this.syncPromise) return this.syncPromise;

    this.syncPromise = (async () => {
      await this.ensureInitialized();
      this.logger.info(`[TrialRegistry] Sync started (${reason})`);
      const meta = await runTrialRegistrySync({
        store: this.store,
        logger: this.logger,
        options: {
          location: this.settings.location,
          statuses: this.settings.statuses,
          conditionQuery: this.settings.conditionQuery,
          pageSize: this.settings.pageSize,
          maxPages: this.settings.maxPages,
          collectionPrefix: this.settings.collectionPrefix
        }
      });
      this.logger.info(
        `[TrialRegistry] Sync completed (${reason}) with ${meta.trialsCount || 0} trials`
      );
      return meta;
    })();

    try {
      return await this.syncPromise;
    } finally {
      this.syncPromise = null;
    }
  }

  async ensureSnapshotReady() {
    await this.ensureInitialized();

    let latestRun = await this.store.getLatestRun();

    // Verify trials actually exist — the runs table may say data was synced
    // but the trials table could be empty due to a schema migration.
    if (latestRun) {
      const trials = await this.store.getTrials({ limit: 1 });
      const hasTrials = Array.isArray(trials) && trials.length > 0;
      if (hasTrials) {
        return {
          available: true,
          latestRun
        };
      }
      this.logger.warn('[TrialRegistry] Run record exists but trials table is empty — forcing re-sync');
      latestRun = null;
    }

    if (!this.settings.enabled) {
      return {
        available: false,
        error: 'Trial registry has no snapshot and sync is disabled.'
      };
    }

    try {
      latestRun = await this.runSync({ reason: 'on-demand', force: true });
      return {
        available: true,
        latestRun
      };
    } catch (error) {
      return {
        available: false,
        error: `Trial registry sync failed: ${error.message}`
      };
    }
  }

  buildConditionMatches(conditions = [], profile, limit = 10) {
    if (!profile.searchText) return [];

    const normalizedQuestion = profile.normalizedSearchText;

    return conditions
      .map((conditionEntry) => {
        const conditionText = expandAliases(conditionEntry.condition || '');
        const conditionTokens = tokenize(conditionText);
        const overlap = intersectionCount(profile.tokens, conditionTokens);
        let score = overlap * 0.45;

        if (conditionText && normalizedQuestion.includes(conditionText)) {
          score += 2.6;
        }

        profile.phrases.forEach((phrase) => {
          if (phrase && conditionText.includes(phrase)) score += 0.9;
        });

        if (score <= 0) return null;

        return {
          conditionKey: conditionEntry.conditionKey,
          condition: conditionEntry.condition,
          score,
          trialsCount: Array.isArray(conditionEntry.trials) ? conditionEntry.trials.length : 0
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score || right.trialsCount - left.trialsCount)
      .slice(0, limit);
  }

  trialMatchesFilters(trial, { phases, regions }) {
    const normalizedPhases = parseList(phases).map(normalizePhaseFilter).filter(Boolean);
    const normalizedRegions = parseList(regions).map((item) => normalizeText(item)).filter(Boolean);

    if (!trial.recruitingInPortugal) {
      return false;
    }

    const trialStatuses = new Set([
      normalizeStatusFilter(trial.overallStatusKey),
      normalizeStatusFilter(trial.overallStatus)
    ]);
    if (!trialStatuses.has(RECRUITING_STATUS)) {
      return false;
    }

    if (normalizedPhases.length > 0) {
      const trialPhaseKeys = parseList(trial.phases).map(normalizePhaseFilter).filter(Boolean);
      if (!normalizedPhases.some((phase) => trialPhaseKeys.includes(phase))) {
        return false;
      }
    }

    if (normalizedRegions.length > 0) {
      const trialRegions = [
        ...(trial.regionTags || []),
        trial.geography,
        ...(trial.countries || [])
      ].map((item) => normalizeText(item)).filter(Boolean);

      if (!normalizedRegions.some((region) => trialRegions.includes(region))) {
        return false;
      }
    }

    return true;
  }

  scoreTrial(trial, profile, conditionMatches) {
    // Build separate text for inclusion and exclusion so we can score them differently
    const inclusionText = expandAliases([
      trial.title,
      trial.officialTitle,
      trial.briefSummary,
      trial.detailedDescription,
      (trial.conditions || []).join(' '),
      (trial.keywords || []).join(' '),
      (trial.regionTags || []).join(' '),
      (trial.interventions || []).map((item) => [item.name, item.type, item.description].filter(Boolean).join(' ')).join(' '),
      (trial.arms || []).map((item) => [item.label, item.type, item.description].filter(Boolean).join(' ')).join(' '),
      (trial.inclusionCriteria || []).join(' '),
      trial.eligibilitySummary,
      trial.studyType,
      trial.sponsor?.leadSponsorName
    ].join(' '));

    const exclusionText = expandAliases((trial.exclusionCriteria || []).join(' '));

    const inclusionTokens = tokenize(inclusionText);
    const exclusionTokens = tokenize(exclusionText);
    // Combined tokens for backward-compatible general matching
    const tokens = uniq([...inclusionTokens, ...exclusionTokens]);
    const reasons = [];
    let score = 0;

    if (profile.tokens.length > 0) {
      const overlap = smartIntersection(profile.tokens, inclusionTokens);
      score += (overlap / profile.tokens.length) * 4.2;
      if (overlap > 0) reasons.push(`Lexical match ${Math.round(overlap)}/${profile.tokens.length}`);
    }

    if (profile.populationTokens.length > 0) {
      const populationOverlap = smartIntersection(profile.populationTokens, inclusionTokens);
      if (populationOverlap > 0) {
        score += (populationOverlap / profile.populationTokens.length) * 2.8;
        reasons.push('Population match');
      }

      // Penalise if population tokens appear heavily in exclusion criteria
      if (exclusionTokens.length > 0) {
        const exclusionOverlap = intersectionCount(profile.populationTokens, exclusionTokens);
        if (exclusionOverlap > 0) {
          const exclusionRatio = exclusionOverlap / profile.populationTokens.length;
          score -= exclusionRatio * 2.5;
          reasons.push('Potential exclusion conflict');
        }
      }
    }

    if (profile.biomarkerTokens.length > 0) {
      const biomarkerOverlap = smartIntersection(profile.biomarkerTokens, inclusionTokens);
      if (biomarkerOverlap > 0) {
        score += (biomarkerOverlap / profile.biomarkerTokens.length) * 2.5;
        reasons.push(`Biomarker match ${Math.round(biomarkerOverlap)}/${profile.biomarkerTokens.length}`);
      }

      // Penalise if queried biomarker appears in exclusion criteria
      if (exclusionTokens.length > 0) {
        const bioExclusion = intersectionCount(profile.biomarkerTokens, exclusionTokens);
        if (bioExclusion > 0) {
          const bioExclusionRatio = bioExclusion / profile.biomarkerTokens.length;
          score -= bioExclusionRatio * 3.0;
          reasons.push('Biomarker in exclusion criteria');
        }
      }
    }

    if (profile.interventionTokens.length > 0) {
      const interventionOverlap = smartIntersection(profile.interventionTokens, inclusionTokens);
      if (interventionOverlap > 0) {
        score += (interventionOverlap / profile.interventionTokens.length) * 1.8;
        reasons.push(`Intervention match ${Math.round(interventionOverlap)}/${profile.interventionTokens.length}`);
      }
    }

    if (profile.comparatorTokens.length > 0) {
      const comparatorOverlap = smartIntersection(profile.comparatorTokens, inclusionTokens);
      if (comparatorOverlap > 0) {
        score += (comparatorOverlap / profile.comparatorTokens.length) * 1.0;
        reasons.push(`Comparator match ${Math.round(comparatorOverlap)}/${profile.comparatorTokens.length}`);
      }
    }

    if (profile.outcomeTokens.length > 0) {
      const outcomeOverlap = smartIntersection(profile.outcomeTokens, inclusionTokens);
      if (outcomeOverlap > 0) {
        score += (outcomeOverlap / profile.outcomeTokens.length) * 0.8;
        reasons.push(`Outcome match ${Math.round(outcomeOverlap)}/${profile.outcomeTokens.length}`);
      }
    }

    if (profile.lineTokens.length > 0) {
      const lineOverlap = smartIntersection(profile.lineTokens, inclusionTokens);
      if (lineOverlap > 0) {
        score += (lineOverlap / profile.lineTokens.length) * 1.0;
        reasons.push(`Line-of-therapy match ${Math.round(lineOverlap)}/${profile.lineTokens.length}`);
      }
    }

    // ── Disease stage matching ────────────────────────────────────────────
    if (profile.detectedStage) {
      const trialStage = (trial.diseaseStage || 'unspecified').toLowerCase();
      const wantedStage = profile.detectedStage.toLowerCase();

      if (trialStage === wantedStage) {
        score += 2.0;
        reasons.push(`Stage match: ${trialStage}`);
      } else if (trialStage === 'unspecified') {
        // No penalty — trial may still be relevant, stage just wasn't extracted
      } else {
        // Penalise stage mismatch (e.g. metastatic question vs adjuvant trial)
        score -= 2.5;
        reasons.push(`Stage mismatch: wanted ${wantedStage}, trial is ${trialStage}`);
      }
    }

    profile.phrases.forEach((phrase) => {
      if (phrase && inclusionText.includes(phrase)) {
        score += 1.1;
      }
    });

    const matchedConditions = conditionMatches.filter((entry) =>
      (trial.conditions || []).some((condition) => normalizeText(condition) === normalizeText(entry.condition))
    );

    if (matchedConditions.length > 0) {
      const conditionBoost = matchedConditions[0].score;
      score += Math.min(conditionBoost, 4);
      reasons.push(`Condition match: ${matchedConditions[0].condition}`);
    }

    // ── Cancer type gate ──────────────────────────────────────────────
    // When the query explicitly mentions a cancer type (e.g. "lung", "nsclc"),
    // require the trial to share at least one cancer-type token.  This prevents
    // unrelated tumour types from leaking through on generic keyword overlap.
    if (profile.cancerTypeTokens.length > 0) {
      const trialCancerTokens = extractCancerTypeTokens(inclusionTokens);
      const cancerOverlap = intersectionCount(profile.cancerTypeTokens, trialCancerTokens);
      if (cancerOverlap > 0) {
        score += 1.5;
        reasons.push(`Cancer type match (${cancerOverlap})`);
      } else {
        // Heavy penalty — almost certainly irrelevant
        score -= 4.0;
        reasons.push('Cancer type mismatch');
      }
    }

    if (trial.recruitingInPortugal) {
      score += 0.6;
      reasons.push('Recruiting in Portugal');
    }

    if ((trial.portugalRecruitingSiteCount || 0) > 1) {
      score += 0.2;
    }

    const referenceTime = new Date(trial.referenceDate || trial.lastUpdatePostDate || trial.studyFirstPostDate || 0).getTime();
    if (Number.isFinite(referenceTime) && referenceTime > 0) {
      const ageDays = Math.max(0, Math.round((Date.now() - referenceTime) / 86400000));
      if (ageDays <= 365) {
        score += 0.35;
      } else if (ageDays <= 730) {
        score += 0.15;
      }
    }

    return {
      score,
      reasons: uniq(reasons)
    };
  }

  buildWeeklyTable(trials = []) {
    const grouped = new Map();

    trials.forEach((trial) => {
      const dateValue =
        trial.referenceDate ||
        trial.lastUpdatePostDate ||
        trial.studyFirstPostDate ||
        trial.syncedAt;
      const { week, weekStart, weekEnd } = getWeekRange(dateValue);
      if (!week) return;

      const entry = grouped.get(week) || {
        week,
        weekStart,
        weekEnd,
        totalTrials: 0,
        recruitingInPortugal: 0,
        phaseSignals: new Set()
      };

      entry.totalTrials += 1;
      if (trial.recruitingInPortugal) entry.recruitingInPortugal += 1;
      parseList(trial.phases).forEach((phase) => entry.phaseSignals.add(phase));
      grouped.set(week, entry);
    });

    return [...grouped.values()]
      .sort((left, right) => String(right.week).localeCompare(String(left.week)))
      .slice(0, 8)
      .map((entry) => ({
        week: entry.week,
        weekStart: entry.weekStart,
        weekEnd: entry.weekEnd,
        totalTrials: entry.totalTrials,
        recruitingInPortugal: entry.recruitingInPortugal,
        phaseSignals: [...entry.phaseSignals].slice(0, 4)
      }));
  }

  mapTrial(trial, score, reasons, opts = {}) {
    const {
      questionMatch = false,
      llmRelevance = null,
      llmScore = null,
      llmReason = null,
      llmInterventionDescription = null,
      llmSummary = null,
      llmMatchedCondition = null,
      llmMatchedStage = null
    } = opts;
    const phaseRank = extractPhaseRank(trial.phases);
    const ipoPortoPriority = hasIpoPortoSite(trial);

    // Extract Portuguese recruiting sites and normalize to canonical hospital names
    const rawPortugueseSites = (trial.locations || [])
      .filter((loc) => {
        const country = (loc.country || '').toLowerCase();
        const status = (loc.status || loc.statusKey || '').toUpperCase();
        return country === 'portugal' && status === 'RECRUITING' && loc.facility;
      })
      .map((loc) => ({
        facility: loc.facility,
        city: loc.city || '',
        status: 'Recruiting'
      }));

    // Normalize to canonical hospital names and deduplicate
    const uniqueSites = normalizeSites(rawPortugueseSites);

    return {
      ...trial,
      diseaseStage: trial.diseaseStage || 'unspecified',
      interventionSummary: llmInterventionDescription || summarizeInterventions(trial),
      armsSummary: llmInterventionDescription ? '' : summarizeArms(trial),
      briefSummaryShort: llmSummary || (trial.briefSummary || ''),
      eligibilitySummary: trial.eligibilitySummary || summarizeEligibility(trial),
      phaseRank,
      ipoPortoPriority,
      portugueseRecruitingSites: uniqueSites,
      questionMatch,
      llmRelevance,
      llmScore,
      llmReason,
      llmMatchedCondition,
      llmMatchedStage,
      matchScore: Number(score.toFixed(3)),
      matchReasons: reasons
    };
  }

  async runLlmTrialMatch(question, input, heuristicTrials) {
    const client = this.fastModel || this.openai || defaultOpenAI;
    if (!client?.chat?.completions) return null;
    if (!question || heuristicTrials.length === 0) return null;

    const maxCandidates = Math.min(heuristicTrials.length, 50);
    const candidates = heuristicTrials.slice(0, maxCandidates);

    const clinicalContext = {
      population: input.population,
      biomarker: input.biomarker,
      intervention: input.intervention,
      lineOfTherapy: input.lineOfTherapy
    };

    try {
      const t0 = Date.now();
      const prompt = this.trialMatchAgent.buildMatchPrompt(question, clinicalContext, candidates);

      const response = await client.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4000,
        temperature: 0.1
      });
      this.logger.info(`[TrialRegistry] LLM trial match completed in ${Date.now() - t0}ms (${candidates.length} candidates)`);

      const text = response.choices?.[0]?.message?.content || '[]';
      const parsed = this.tryParseJsonArray(text);
      const trialIds = candidates.map((t) => t.nctId);
      return this.trialMatchAgent.normalizeResults(parsed, trialIds);
    } catch (error) {
      this.logger.warn(`[TrialRegistry] LLM trial match failed, using heuristic only: ${error.message}`);
      return null;
    }
  }

  tryParseJsonArray(text) {
    if (!text) return [];
    const trimmed = text.trim();
    try {
      return JSON.parse(trimmed);
    } catch (_err) {
      const match = trimmed.match(/\[[\s\S]*\]/);
      if (match) {
        try { return JSON.parse(match[0]); } catch (_inner) { return []; }
      }
      return [];
    }
  }

  groupTrialsByConditionAndStage(trials = []) {
    const relevanceOrder = { high: 0, moderate: 1, low: 2, none: 3 };
    const groups = new Map();
    trials.forEach((trial) => {
      const stage = trial.diseaseStage || 'unspecified';
      (trial.conditions || ['Unspecified']).forEach((condition) => {
        const key = `${condition}|||${stage}`;
        const group = groups.get(key) || { condition, stage, trials: [] };
        group.trials.push(trial);
        groups.set(key, group);
      });
    });
    // Sort trials within each group: high relevance first, then by score
    for (const group of groups.values()) {
      group.trials.sort((a, b) => {
        const aRel = relevanceOrder[a.llmRelevance] ?? 3;
        const bRel = relevanceOrder[b.llmRelevance] ?? 3;
        if (aRel !== bRel) return aRel - bRel;
        return (b.matchScore || 0) - (a.matchScore || 0);
      });
    }
    return [...groups.values()].sort((a, b) => {
      const aBestRel = relevanceOrder[a.trials[0]?.llmRelevance] ?? 3;
      const bBestRel = relevanceOrder[b.trials[0]?.llmRelevance] ?? 3;
      if (aBestRel !== bBestRel) return aBestRel - bBestRel;
      const aBestScore = a.trials[0]?.matchScore || 0;
      const bBestScore = b.trials[0]?.matchScore || 0;
      if (aBestScore !== bBestScore) return bBestScore - aBestScore;
      return a.condition.localeCompare(b.condition);
    });
  }

  async findMatches(input = {}) {
    const snapshotState = await this.ensureSnapshotReady();
    if (!snapshotState.available) {
      return {
        available: false,
        error: snapshotState.error,
        trials: [],
        conditions: [],
        weeklyTable: [],
        meta: {
          location: this.settings.location,
          syncEnabled: this.settings.enabled
        }
      };
    }

    const normalizedInput = normalizeTrialRegistryInput(input);

    const [conditions, latestRun] = await Promise.all([
      this.store.getConditions(),
      this.store.getLatestRun()
    ]);

    const profile = buildQueryProfile(normalizedInput);
    const conditionMatches = this.buildConditionMatches(
      Array.isArray(conditions) ? conditions : [],
      profile,
      parseInteger(normalizedInput.maxConditions, 10)
    );

    let filteredTrials = null;
    if (typeof this.store.getFilteredTrials === 'function') {
      const dbFilters = {
        overallStatusKey: RECRUITING_STATUS,
        recruitingInPortugal: true
      };
      const normalizedPhases = parseList(normalizedInput.phases).map(normalizePhaseFilter).filter(Boolean);
      if (normalizedPhases.length > 0) dbFilters.phases = normalizedPhases;
      const normalizedRegions = parseList(normalizedInput.regions).map((r) => normalizeText(r)).filter(Boolean);
      if (normalizedRegions.length > 0) dbFilters.regions = normalizedRegions;
      filteredTrials = await this.store.getFilteredTrials(dbFilters);
    }
    if (!filteredTrials) {
      const allTrials = await this.store.getTrials();
      filteredTrials = (Array.isArray(allTrials) ? allTrials : [])
        .filter((trial) => this.trialMatchesFilters(trial, normalizedInput));
    }

    const maxTrials = parseInteger(normalizedInput.maxTrials, 20);
    const matchingTrials = (Array.isArray(filteredTrials) ? filteredTrials : [])
      .map((trial) => {
        const { score, reasons } = this.scoreTrial(trial, profile, conditionMatches);
        return {
          trial,
          score,
          reasons
        };
      })
      .filter((entry) => {
        if (!profile.searchText) return true;
        return entry.score > 1.5; // Filter low-quality candidates before LLM re-ranking
      })
      .sort((left, right) => {
        // Primary: relevance score (most important — a highly relevant Phase II
        // should rank above a barely-relevant Phase III)
        if (right.score !== left.score) return right.score - left.score;

        // Secondary: phase rank as tiebreaker among similar-score trials
        const rightPhaseRank = extractPhaseRank(right.trial.phases);
        const leftPhaseRank = extractPhaseRank(left.trial.phases);
        if (rightPhaseRank !== leftPhaseRank) return rightPhaseRank - leftPhaseRank;

        // Tertiary: IPO Porto priority
        const rightIpoPriority = hasIpoPortoSite(right.trial) ? 1 : 0;
        const leftIpoPriority = hasIpoPortoSite(left.trial) ? 1 : 0;
        if (rightIpoPriority !== leftIpoPriority) return rightIpoPriority - leftIpoPriority;

        if ((right.trial.recruitingInPortugal ? 1 : 0) !== (left.trial.recruitingInPortugal ? 1 : 0)) {
          return (right.trial.recruitingInPortugal ? 1 : 0) - (left.trial.recruitingInPortugal ? 1 : 0);
        }
        if ((right.trial.portugalRecruitingSiteCount || 0) !== (left.trial.portugalRecruitingSiteCount || 0)) {
          return (right.trial.portugalRecruitingSiteCount || 0) - (left.trial.portugalRecruitingSiteCount || 0);
        }
        return String(right.trial.referenceDate || '').localeCompare(String(left.trial.referenceDate || ''));
      })
      .slice(0, maxTrials);

    // Run LLM-based trial matching on heuristic top candidates
    const llmResults = profile.searchText.length > 0
      ? await this.runLlmTrialMatch(
          profile.searchText,
          normalizedInput,
          matchingTrials.map((e) => e.trial)
        )
      : null;

    const llmScoreMap = new Map();
    if (llmResults) {
      llmResults.forEach((r) => llmScoreMap.set(r.nctId, r));
    }

    const mappedTrials = matchingTrials.map((entry) => {
      const llm = llmScoreMap.get(entry.trial.nctId);
      const questionMatch = llm
        ? llm.relevance === 'high' || llm.relevance === 'moderate'
        : (profile.searchText.length > 0 && entry.score >= 1.5);
      const reasons = [...entry.reasons];
      if (llm?.reason) reasons.push(`LLM: ${llm.reason}`);
      return this.mapTrial(entry.trial, entry.score, reasons, {
        questionMatch,
        llmRelevance: llm?.relevance || null,
        llmScore: llm?.score ?? null,
        llmReason: llm?.reason || null,
        llmInterventionDescription: llm?.interventionDescription || null,
        llmSummary: llm?.summary || null,
        llmMatchedCondition: llm?.matchedCondition || null,
        llmMatchedStage: llm?.matchedStage || null
      });
    });

    // Re-sort: LLM high-relevance trials first, then by heuristic score
    // Filter out LLM "none" trials — keep only high/moderate/low when LLM ran
    if (llmResults) {
      const relevanceOrder = { high: 0, moderate: 1, low: 2, none: 3 };
      mappedTrials.sort((a, b) => {
        const aRel = relevanceOrder[a.llmRelevance] ?? 3;
        const bRel = relevanceOrder[b.llmRelevance] ?? 3;
        if (aRel !== bRel) return aRel - bRel;
        return (b.matchScore || 0) - (a.matchScore || 0);
      });
    }

    // Remove trials the LLM explicitly rated as irrelevant
    const finalTrials = llmResults
      ? mappedTrials.filter((t) => t.llmRelevance !== 'none')
      : mappedTrials;

    return {
      available: true,
      trials: finalTrials,
      trialGroups: this.groupTrialsByConditionAndStage(finalTrials),
      conditions: conditionMatches,
      weeklyTable: this.buildWeeklyTable(finalTrials),
      meta: {
        ...(latestRun || {}),
        location: latestRun?.location || this.settings.location,
        lastSyncedAt: latestRun?.finishedAt || latestRun?.lastSyncedAt || null,
        recruitingInPortugalOnly: true,
        query: profile.searchText,
        storeType: this.store?.type || this.settings.store,
        syncEnabled: this.settings.enabled
      }
    };
  }

  async getTrialById(trialId) {
    const snapshotState = await this.ensureSnapshotReady();
    if (!snapshotState.available) {
      return {
        available: false,
        error: snapshotState.error,
        trial: null
      };
    }

    const trial = await this.store.getTrial(trialId);
    if (!trial) {
      return {
        available: true,
        trial: null
      };
    }

    return {
      available: true,
      trial: this.mapTrial(trial, 0, [])
    };
  }

  async getStatus() {
    await this.ensureInitialized();
    const latestRun = await this.store.getLatestRun();
    return {
      available: Boolean(latestRun),
      latestRun,
      schedulerActive: Boolean(this.scheduler),
      syncEnabled: this.settings.enabled,
      storeType: this.store?.type || this.settings.store,
      location: this.settings.location,
      schedule: this.settings.schedule,
      timezone: this.settings.timezone
    };
  }
}

const trialRegistryService = new TrialRegistryService({ openai: defaultOpenAI });

export default trialRegistryService;
