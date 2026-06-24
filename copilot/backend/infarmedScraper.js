import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

// ---------------------------------------------------------------------------
// INFARMED Scraper — fetches oncology drug reimbursement & indication data
// from multiple INFARMED public sources:
//   1. AUE Excel list (CHNM) — downloadable .xls with all AUE-authorised drugs
//   2. INFOMED — drug authorisation database (HTML scraping)
//   3. Transparencia SNS API — hospital spending data (OpenDataSoft JSON API)
// ---------------------------------------------------------------------------

const AUE_EXCEL_URL =
  'https://app.infarmed.pt/CHNM_listagem_AEX_AUE/CHNM_med_autorizados.xls';

const AUE_BENEFIT_URL =
  'https://www.infarmed.pt/documents/15786/5261813/Lista+de+medicamentos+identificados+pelo+Infarmed+%C2%BF+AUE+de+benef%C3%ADcio+cl%C3%ADnico+bem+reconhecido/74525694-78d4-1d2c-a19d-ebd326ca522f';

// PAP (Programa de Acesso Precoce) — early access program list page
const PAP_LIST_URL =
  'https://www.infarmed.pt/web/infarmed/avaliacao-terapeutica-e-economica/programa-de-acesso-precoce-a-medicamentos';
const PAP_LIST_ALT_URL =
  'https://www.infarmed.pt/web/infarmed/-/lista-dos-pap-programa-de-acesso-precoce-a-medicamentos-';
// Additional PAP document URLs (direct document downloads — more stable than CMS pages)
const PAP_DOCUMENT_URLS = [
  'https://www.infarmed.pt/web/infarmed/-/lista-de-acesso-precoce-ativo',
  'https://www.infarmed.pt/documents/15786/17838/Lista+PAP+ativo',
  'https://www.infarmed.pt/documents/15786/17838/Lista_PAP_ativo.xlsx',
  'https://www.infarmed.pt/documents/15786/17838/Lista_PAP_Ativo.xlsx',
  'https://www.infarmed.pt/documents/15786/17838/Lista_medicamentos_PAP_ativo.xlsx',
];

// EMA EPAR product list — public dataset confirming EU marketing authorisation (AIM)
// This CSV/Excel lists all centrally-authorised medicines and is the ground truth for AIM status.
const EMA_EPAR_CSV_URL =
  'https://www.ema.europa.eu/en/documents/report/medicines-output-medicines-report_en.xlsx';

const INFOMED_SEARCH_URL = 'https://extranet.infarmed.pt/INFOMED-fo/';
const INFOMED_API_BASE = 'https://extranet.infarmed.pt/INFOMED-fo/pesquisa-avancada';

const TRANSPARENCIA_BASE =
  'https://transparencia.sns.gov.pt/api/explore/v2.1/catalog/datasets';
const TRANSPARENCIA_HOSPITAL_DATASET =
  'despesa-com-medicamentos-nos-hospitais-do-sns';

const REQUEST_TIMEOUT = 30_000;
const RETRY_DELAY = 2_000;
const MAX_RETRIES = 3;

// ATC codes for antineoplastic and immunomodulating agents
const ONCOLOGY_ATC_PREFIXES = ['L01', 'L02', 'L03', 'L04'];

// Known oncology active substances for INFOMED lookup
const ONCOLOGY_SUBSTANCES = [
  // ── Checkpoint inhibitors (PD-1 / PD-L1 / CTLA-4 / LAG-3) ────────────────
  'pembrolizumab', 'nivolumab', 'atezolizumab', 'durvalumab', 'avelumab',
  'ipilimumab', 'cemiplimab', 'dostarlimab', 'tremelimumab',
  'retifanlimab', 'tislelizumab', 'sintilimab', 'toripalimab',
  'zimberelimab', 'sugemalimab', 'serplulimab', 'adebrelimab',
  'cosibelimab', 'ivonescimab', 'cadonilimab', 'fianlimab',

  // ── HER2-targeted agents ──────────────────────────────────────────────────
  'trastuzumab', 'pertuzumab', 'trastuzumab deruxtecan', 'trastuzumab emtansina',
  'lapatinib', 'neratinib', 'tucatinib',
  'zanidatamab', 'margetuximab',

  // ── TROP2 / other ADCs (solid tumors) ────────────────────────────────────
  'sacituzumab govitecano', 'datopotamab deruxtecan',
  'patritumab deruxtecan', 'ifinatamab deruxtecan',
  'disitamab vedotina', 'sacituzumab tirumotecan',
  'tisotumab vedotina', 'mirvetuximab soravtansina',
  'enfortumab vedotina', 'telisotuzumab vedotina',

  // ── VEGF / angiogenesis ──────────────────────────────────────────────────
  'bevacizumab', 'ramucirumab',
  'lenvatinib', 'cabozantinib', 'sunitinib', 'pazopanib', 'axitinib',
  'regorafenib', 'sorafenib', 'tivozanib', 'fruquintinib',
  // zanzalintinib removed — Phase 3, not approved EMA/FDA

  // ── EGFR inhibitors (NSCLC) ──────────────────────────────────────────────
  'osimertinib', 'erlotinib', 'gefitinib', 'afatinib', 'dacomitinib',
  'lazertinib',
  // furmonertinib / aumolertinib removed — China approval only, never EMA/FDA
  'amivantamab', 'mobocertinib',
  // sunvozertinib / zipalertinib removed — Phase 3, not yet approved
  'cetuximab', 'panitumumab',

  // ── ALK / ROS1 / MET / NTRK inhibitors ──────────────────────────────────
  'alectinib', 'crizotinib', 'brigatinib', 'lorlatinib', 'ceritinib',
  'entrectinib', 'larotrectinib', 'repotrectinib', 'taletrectinib',
  'capmatinib', 'tepotinib',
  // savolitinib removed — no EMA/FDA approval

  // ── RET inhibitors ───────────────────────────────────────────────────────
  'selpercatinib', 'pralsetinib',

  // ── KRAS G12C inhibitors ─────────────────────────────────────────────────
  'sotorasib', 'adagrasib',
  // divarasib / glecirasib / olomorasib removed — Phase 2, not approved EMA/FDA

  // ── PARP inhibitors ──────────────────────────────────────────────────────
  'olaparib', 'niraparib', 'rucaparib', 'talazoparib',
  // fuzuloparib removed — China approval only (fluzoparib/Fuzuloparib), never EMA/FDA

  // ── BRAF / MEK inhibitors ────────────────────────────────────────────────
  'vemurafenib', 'dabrafenib', 'encorafenib',
  'trametinib', 'cobimetinib', 'binimetinib',

  // ── CDK4/6 inhibitors (breast) ───────────────────────────────────────────
  'ribociclib', 'palbociclib', 'abemaciclib',

  // ── PI3K / AKT inhibitors ────────────────────────────────────────────────
  'alpelisib', 'capivasertib', 'inavolisib', 'copanlisib',

  // ── Oral SERDs (breast ER+) ──────────────────────────────────────────────
  // elacestrant: EMA approved (ESR1-mutated breast cancer) ✓
  // imlunestrant: Phase 3 (EMBER-4), not yet approved → removed
  'elacestrant',

  // ── BCR-ABL1 / TKI (CML, GIST) ──────────────────────────────────────────
  'imatinib', 'dasatinib', 'nilotinib', 'bosutinib', 'ponatinib',
  'asciminib',

  // ── GIST targeted ────────────────────────────────────────────────────────
  'avapritinib', 'ripretinib',

  // ── BTK inhibitors ───────────────────────────────────────────────────────
  'ibrutinib', 'acalabrutinib', 'zanubrutinib', 'pirtobrutinib', 'nemtabrutinib',

  // ── BCL-2 / PI3K (CLL / lymphoma) ───────────────────────────────────────
  'venetoclax', 'idelalisib',

  // ── JAK inhibitors (MF / GVHD) ──────────────────────────────────────────
  // ruxolitinib: EMA approved (MF, PV, GvHD) ✓
  // fedratinib: EMA approved (MF) ✓
  // pacritinib: FDA approved (MF 2022) but NOT EMA approved → removed
  'ruxolitinib', 'fedratinib',
  'belumosudil', 'axatilimab',

  // ── Myeloma — proteasome inhibitors ──────────────────────────────────────
  'bortezomib', 'carfilzomib', 'ixazomib',

  // ── Myeloma — IMiDs ──────────────────────────────────────────────────────
  'lenalidomida', 'pomalidomida', 'talidomida',
  // iberdomide removed — investigational only (Phase 1/2, BMS-986325), not approved

  // ── Myeloma — CD38 / SLAMF7 / BCMA monoclonals ───────────────────────────
  'daratumumab', 'isatuximab', 'elotuzumab',
  'belantamab mafodotin',

  // ── Myeloma — bispecifics / CAR-T ────────────────────────────────────────
  'talquetamab', 'teclistamab', 'elranatamab', 'linvoseltamab',
  'ciltacabtagene autoleucel', 'idecabtagene vicleucel',

  // ── XPO1 inhibitor (myeloma) ─────────────────────────────────────────────
  'selinexor',

  // ── CD20 monoclonals / lymphoma ──────────────────────────────────────────
  'rituximab', 'obinutuzumab',

  // ── Lymphoma — ADCs ──────────────────────────────────────────────────────
  'brentuximab vedotina', 'polatuzumab vedotina',
  'loncastuximab tesirina', 'camidanlumab tesirina',

  // ── Lymphoma — bispecifics ────────────────────────────────────────────────
  'glofitamab', 'epcoritamab', 'mosunetuzumab', 'odronextamab',

  // ── Lymphoma — CD19 monoclonal ────────────────────────────────────────────
  'tafasitamab',

  // ── B-ALL bispecific ─────────────────────────────────────────────────────
  'blinatumomab',

  // ── CAR-T (ALL / LBCL / MCL) ─────────────────────────────────────────────
  'tisagenlecleucel', 'axicabtagene ciloleucel',
  'lisocabtagene maraleucel', 'brexucabtagene autoleucel',

  // ── AML — FLT3 inhibitors ─────────────────────────────────────────────────
  'gilteritinib', 'midostaurina', 'quizartinib',

  // ── AML — IDH inhibitors ─────────────────────────────────────────────────
  // ivosidenib (IDH1): EMA approved for AML + cholangiocarcinoma ✓
  // olutasidenib (IDH1): EMA approved for AML ✓
  // enasidenib (IDH2): FDA only — NOT EMA approved → removed
  'ivosidenib', 'olutasidenib',

  // ── AML — hedgehog / other ────────────────────────────────────────────────
  'glasdegib',

  // ── AML / MDS — hypomethylating agents ───────────────────────────────────
  'decitabina', 'azacitidina',

  // ── MDS — luspatercept / imetelstat ──────────────────────────────────────
  'luspatercept', 'imetelstat',

  // ── Prostate ─────────────────────────────────────────────────────────────
  'abiraterona', 'enzalutamida', 'apalutamida', 'darolutamida',
  // Full EMA INN includes isotope designation (required for INFOMED search)
  'lutetium (177lu) vipivotide tetraxetan',
  'cabazitaxel',

  // ── Chemotherapy backbone agents ─────────────────────────────────────────
  'docetaxel', 'paclitaxel', 'nab-paclitaxel',
  'carboplatina', 'cisplatina', 'oxaliplatina',
  'pemetrexedo', 'gencitabina', 'capecitabina', 'fluorouracilo',
  'irinotecano', 'topotecano', 'etoposido',
  'doxorrubicina', 'epirrubicina',
  'eribulin', 'trabectedina',
  'temozolomida', 'lomustina',
  'lurbinectedin',

  // ── mTOR inhibitors ──────────────────────────────────────────────────────
  'everolimus', 'temsirolimus',

  // ── FGFR inhibitors ──────────────────────────────────────────────────────
  // futibatinib: EMA approved (CCA FGFR2) ✓
  // pemigatinib: EMA approved (CCA FGFR2) ✓
  // erdafitinib: EMA approved (bladder FGFR) ✓
  // infigratinib: FDA approval voluntarily withdrawn by BridgeBio in 2023 → removed
  'futibatinib', 'pemigatinib', 'erdafitinib',

  // ── Thyroid / medullary thyroid ──────────────────────────────────────────
  'vandetanib',

  // ── GI targeted ──────────────────────────────────────────────────────────
  'zolbetuximab',

  // ── NET / radioligand therapy (Lutathera) ────────────────────────────────
  // Full EMA INN: lutetium (177Lu) oxodotreotide
  'lutetium (177lu) oxodotreotide',

  // ── HIF-2α inhibitor (RCC) ────────────────────────────────────────────────
  'belzutifano',

  // ── LAG-3 combination ────────────────────────────────────────────────────
  // nivolumab + relatlimab: EMA approved as fixed-dose combination (Opdualag) ✓
  // favezelimab: investigational anti-LAG-3, not approved → removed
  'nivolumab relatlimab',

  // ── TCR-T / TIL therapy ──────────────────────────────────────────────────
  'tebentafusp', 'lifileucel',

  // ── SCLC bispecific ──────────────────────────────────────────────────────
  'tarlatamab',

  // ── CD33 / CD22 ADCs (AML / ALL) ─────────────────────────────────────────
  // inotuzumab ozogamicin: EMA approved (B-cell ALL) ✓
  // gemtuzumab ozogamicin: EMA approved (AML CD33+) ✓
  'inotuzumab ozogamicina', 'gemtuzumab ozogamicina',
  // pelabresib: Phase 3 (MF), not approved → excluded from active list
  // navtemadlin: Phase 2 (DDLPS), not approved → excluded from active list
];

// ── Cancer-type synonym dictionary ──────────────────────────────────────────
// Maps abbreviations and variants to canonical English names stored in the DB.
// Used to expand search queries so "NSCLC" finds "non-small cell lung cancer".
export const CANCER_TYPE_SYNONYMS = {
  // ── Lung ─────────────────────────────────────────────────────────────────
  nsclc: ['non-small cell lung cancer', 'non small cell lung cancer', 'lung adenocarcinoma', 'lung squamous cell carcinoma', 'lung cancer', 'carcinoma pulmonar de nao pequenas celulas'],
  sclc: ['small cell lung cancer', 'small-cell lung cancer', 'carcinoma pulmonar de pequenas celulas'],
  // Generic lung — reverse lookup finds nsclc+sclc
  lung: ['lung cancer', 'non-small cell lung cancer', 'small cell lung cancer', 'pulmonary carcinoma'],

  // ── Breast ────────────────────────────────────────────────────────────────
  breast: ['breast cancer', 'breast carcinoma', 'cancro da mama', 'cancro mama', 'carcinoma da mama'],
  tnbc: ['triple-negative breast cancer', 'triple negative breast cancer', 'cancro mama triplo negativo'],
  her2_breast: ['her2-positive breast cancer', 'her2+ breast cancer', 'breast cancer her2-positive'],
  hr_breast: ['hr-positive breast cancer', 'hormone receptor positive breast cancer', 'er-positive breast cancer'],

  // ── Colorectal ────────────────────────────────────────────────────────────
  crc: ['colorectal cancer', 'colorectal carcinoma', 'colon cancer', 'rectal cancer', 'cancro colorrectal', 'cancro colorretal'],
  mcrc: ['metastatic colorectal cancer', 'colorrectal metastatico', 'metastatic crc', 'colorectal cancer'],

  // ── Liver ─────────────────────────────────────────────────────────────────
  hcc: ['hepatocellular carcinoma', 'hepatocellular cancer', 'liver cancer', 'carcinoma hepatocelular', 'cancro do figado'],

  // ── Biliary tract ─────────────────────────────────────────────────────────
  // CCA = cholangiocarcinoma specifically; BTC = broader biliary tract
  cca: ['cholangiocarcinoma', 'bile duct cancer', 'colangiocarcinoma', 'intrahepatic cholangiocarcinoma', 'extrahepatic cholangiocarcinoma', 'biliary tract cancer'],
  btc: ['biliary tract cancer', 'biliary tract carcinoma', 'vias biliares', 'cholangiocarcinoma', 'gallbladder cancer'],
  gbc: ['gallbladder cancer', 'gallbladder carcinoma', 'cancro vesicula biliar', 'carcinoma vesicula biliar'],

  // ── Kidney ────────────────────────────────────────────────────────────────
  rcc: ['renal cell carcinoma', 'renal cell cancer', 'kidney cancer', 'carcinoma de celulas renais', 'cancro do rim'],
  ccrcc: ['clear cell renal cell carcinoma', 'clear cell rcc', 'carcinoma celulas renais de celulas claras', 'renal cell carcinoma'],

  // ── Bladder / urothelial ──────────────────────────────────────────────────
  uc: ['urothelial carcinoma', 'urothelial cancer', 'carcinoma urotelial', 'bladder cancer', 'cancro da bexiga'],
  utuc: ['upper tract urothelial carcinoma', 'upper tract urothelial cancer', 'urothelial carcinoma'],

  // ── Prostate ──────────────────────────────────────────────────────────────
  pca: ['prostate cancer', 'prostate carcinoma', 'cancro da prostata', 'carcinoma prostata'],
  crpc: ['castration-resistant prostate cancer', 'crpc', 'hormone-resistant prostate cancer', 'prostate cancer'],
  mcrpc: ['metastatic castration-resistant prostate cancer', 'castration-resistant prostate cancer', 'crpc', 'carcinoma prostata resistente castracao metastatico', 'prostate cancer'],

  // ── Gynaecological ────────────────────────────────────────────────────────
  oc: ['ovarian cancer', 'ovarian carcinoma', 'cancro do ovario', 'fallopian tube cancer', 'primary peritoneal cancer', 'carcinoma ovario'],
  ec: ['endometrial cancer', 'endometrial carcinoma', 'uterine cancer', 'cancro do endometrio', 'carcinoma do endometrio'],
  cc: ['cervical cancer', 'cervical carcinoma', 'cancro do colo do utero', 'colo do utero', 'colo uterino', 'carcinoma cervical'],

  // ── Haematology — lymphomas ───────────────────────────────────────────────
  dlbcl: ['diffuse large b-cell lymphoma', 'diffuse large b cell lymphoma', 'linfoma difuso de grandes celulas b', 'linfoma difuso grandes celulas b', 'large b-cell lymphoma'],
  lbcl: ['large b-cell lymphoma', 'large b cell lymphoma', 'linfoma grandes celulas b', 'diffuse large b-cell lymphoma'],
  fl: ['follicular lymphoma', 'linfoma folicular'],
  hl: ['hodgkin lymphoma', 'classical hodgkin lymphoma', 'linfoma de hodgkin', 'doenca de hodgkin'],
  mcl: ['mantle cell lymphoma', 'linfoma do manto', 'linfoma de celulas do manto'],
  mzl: ['marginal zone lymphoma', 'linfoma da zona marginal'],
  ptcl: ['peripheral t-cell lymphoma', 't-cell lymphoma', 'linfoma t periferico'],

  // ── Haematology — leukaemias ──────────────────────────────────────────────
  aml: ['acute myeloid leukemia', 'acute myeloid leukaemia', 'leucemia mieloide aguda', 'lma'],
  // B-ALL cross-links — blinatumomab, tisagenlecleucel, inotuzumab are B-ALL specific
  all: ['acute lymphoblastic leukemia', 'acute lymphoblastic leukaemia', 'leucemia linfoblastica aguda', 'lla', 'b-cell all', 'b-all', 'precursor b-all'],
  cll: ['chronic lymphocytic leukemia', 'chronic lymphocytic leukaemia', 'leucemia linfocitica cronica', 'llc'],
  cml: ['chronic myeloid leukemia', 'chronic myeloid leukaemia', 'leucemia mieloide cronica', 'lmc'],
  mds: ['myelodysplastic syndrome', 'myelodysplastic syndromes', 'sindrome mielodisplasico', 'sindrome mielodisplasica'],

  // ── Haematology — plasma cell ─────────────────────────────────────────────
  mm: ['multiple myeloma', 'mieloma multiplo', 'plasma cell myeloma'],

  // ── Haematology — other ───────────────────────────────────────────────────
  mf: ['myelofibrosis', 'mielofibrose', 'primary myelofibrosis', 'post-et myelofibrosis', 'post-pv myelofibrosis'],
  pv: ['polycythemia vera', 'policitemia vera', 'polycythaemia vera'],
  et: ['essential thrombocythemia', 'essential thrombocythaemia', 'trombocitemia essencial'],

  // ── Head & neck ───────────────────────────────────────────────────────────
  hnscc: ['head and neck squamous cell carcinoma', 'head and neck cancer', 'squamous cell carcinoma of the head and neck', 'carcinoma espinocelular cabeca pescoco'],
  npc: ['nasopharyngeal carcinoma', 'nasopharyngeal cancer', 'carcinoma nasofaringeo'],

  // ── Pancreatic ────────────────────────────────────────────────────────────
  pdac: ['pancreatic ductal adenocarcinoma', 'pancreatic cancer', 'pancreatic adenocarcinoma', 'cancro do pancreas'],
  // pnet cross-links to net — pNET is a subset of NET
  pnet: ['pancreatic neuroendocrine tumor', 'pancreatic neuroendocrine tumour', 'pancreatic net', 'tumor neuroendocrino pancreatico', 'neuroendocrine tumor'],

  // ── Gastric / GEJ ─────────────────────────────────────────────────────────
  // EMA approvals cover "gastric and GEJ" together for pembrolizumab, nivolumab, T-DXd.
  gc: ['gastric cancer', 'gastric adenocarcinoma', 'stomach cancer', 'gastric/gej', 'gastric or gej', 'cancro gastrico', 'carcinoma gastrico', 'gastroesophageal junction cancer', 'gastroesophageal junction adenocarcinoma'],
  gej: ['gastroesophageal junction cancer', 'gastroesophageal junction adenocarcinoma', 'juncao gastroesofagica', 'gastric cancer', 'gastric adenocarcinoma', 'gastric/gej'],

  // ── Esophageal ────────────────────────────────────────────────────────────
  esophageal: ['esophageal cancer', 'oesophageal cancer', 'esophageal squamous cell carcinoma', 'esophageal adenocarcinoma', 'escc', 'cancro do esofago', 'carcinoma esofagico'],

  // ── GIST ──────────────────────────────────────────────────────────────────
  gist: ['gastrointestinal stromal tumor', 'gastrointestinal stromal tumour', 'tumor estromal gastrointestinal'],

  // ── Sarcoma ───────────────────────────────────────────────────────────────
  sts: ['soft tissue sarcoma', 'sarcoma dos tecidos moles', 'liposarcoma', 'leiomyosarcoma', 'dedifferentiated liposarcoma', 'sarcoma'],

  // ── Neuroendocrine ────────────────────────────────────────────────────────
  net: ['neuroendocrine tumor', 'neuroendocrine tumour', 'neuroendocrine neoplasm', 'tumor neuroendocrino', 'carcinoid tumor', 'carcinoid', 'pancreatic neuroendocrine tumor'],

  // ── CNS ───────────────────────────────────────────────────────────────────
  gbm: ['glioblastoma', 'glioblastoma multiforme', 'grade iv glioma', 'glioma grau iv'],

  // ── Melanoma — uveal MUST be separate (tebentafusp is uveal only, not cutaneous) ──
  uveal_melanoma: ['uveal melanoma', 'ocular melanoma', 'choroidal melanoma', 'melanoma uveal', 'melanoma ocular'],
  mel: ['melanoma', 'cutaneous melanoma', 'skin melanoma', 'melanoma cutaneo'],

  // ── Mesothelioma ──────────────────────────────────────────────────────────
  meso: ['mesothelioma', 'pleural mesothelioma', 'malignant pleural mesothelioma', 'mesotelioma'],

  // ── Thyroid ───────────────────────────────────────────────────────────────
  dtc: ['differentiated thyroid cancer', 'papillary thyroid cancer', 'follicular thyroid cancer', 'cancro diferenciado da tiroide'],
  mtc: ['medullary thyroid cancer', 'medullary thyroid carcinoma', 'carcinoma medular da tiroide'],
  anaplastic_thyroid: ['anaplastic thyroid cancer', 'anaplastic thyroid carcinoma', 'carcinoma anaplasico da tiroide'],
};

// ── Portuguese INN → EMA English INN mapping ────────────────────────────────
// INFARMED uses Portuguese-spelled INNs; EMA EPAR uses English INNs.
// Without this map, drugs like abiraterona/abiraterone won't match in EMA EPAR
// lookup, causing them to be incorrectly left as AUE instead of AIM/PAP.
const PORTUGUESE_TO_EMA_INN = {
  // Prostate / hormonal
  'abiraterona': 'abiraterone',
  'enzalutamida': 'enzalutamide',
  'apalutamida': 'apalutamide',
  'darolutamida': 'darolutamide',
  // IMiDs
  'lenalidomida': 'lenalidomide',
  'pomalidomida': 'pomalidomide',
  'talidomida': 'thalidomide',
  // AML / MDS
  'midostaurina': 'midostaurin',
  'decitabina': 'decitabine',
  'azacitidina': 'azacitidine',
  // Chemotherapy backbones
  'gencitabina': 'gemcitabine',
  'capecitabina': 'capecitabine',
  'irinotecano': 'irinotecan',
  'topotecano': 'topotecan',
  'etoposido': 'etoposide',
  'doxorrubicina': 'doxorubicin',
  'epirrubicina': 'epirubicin',
  'fluorouracilo': 'fluorouracil',
  'pemetrexedo': 'pemetrexed',
  'carboplatina': 'carboplatin',
  'cisplatina': 'cisplatin',
  'oxaliplatina': 'oxaliplatin',
  'temozolomida': 'temozolomide',
  'trabectedina': 'trabectedin',
  'lomustina': 'lomustine',
  // RCC
  'belzutifano': 'belzutifan',
  // Sarcoma
  'eribulin': 'eribulin mesilate',
};

/**
 * Expands a cancer-type search term into all known synonyms/aliases.
 * E.g. "NSCLC" → ["nsclc", "non-small cell lung cancer", "non small cell lung cancer", ...]
 */
export const expandCancerTypeSynonyms = (term) => {
  if (!term) return [];
  const norm = term.trim().toLowerCase();
  const expanded = new Set([norm]);

  // Direct key lookup
  if (CANCER_TYPE_SYNONYMS[norm]) {
    for (const s of CANCER_TYPE_SYNONYMS[norm]) expanded.add(s);
  }

  // Reverse lookup — if the term matches a value, include its key + siblings
  for (const [key, values] of Object.entries(CANCER_TYPE_SYNONYMS)) {
    if (values.some((v) => norm.includes(v) || v.includes(norm))) {
      expanded.add(key);
      for (const s of values) expanded.add(s);
    }
  }

  return [...expanded];
};

// ---- helpers ---------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hashId = (raw) =>
  crypto.createHash('sha1').update(String(raw)).digest('hex').slice(0, 12);

const safeFetch = async (url, options = {}, retries = MAX_RETRIES) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'User-Agent': 'SilverCancer-Oncology-Platform/1.0 (clinical-research)',
          'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8',
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

// ---- 1. AUE Excel scraping ------------------------------------------------

/**
 * Parses drug data from PDF text extracted by pdf-parse.
 * INFARMED PDFs typically have tabular data with drug names, substances,
 * ATC codes, and indications in a semi-structured text format.
 */
const parsePdfDrugList = (pdfText, source, logger) => {
  const drugs = [];
  if (!pdfText || typeof pdfText !== 'string') return drugs;

  const lines = pdfText.split('\n').map((l) => l.trim()).filter(Boolean);

  // Strategy 1: Line-by-line extraction for tabular PDFs
  // Look for lines that contain drug-like patterns (trade name + substance)
  const drugLinePattern = /^(.+?)\s{2,}(.+?)(?:\s{2,}(.+?))?(?:\s{2,}(.+))?$/;
  const substancePattern = /^[A-Za-zÀ-ÿ][a-zà-ÿ]+(?:\s[a-zà-ÿ]+)*$/;

  let currentDrug = null;
  let headerFound = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect header row
    if (/substância|DCI|nome\s*comercial|medicamento/i.test(line)) {
      headerFound = true;
      continue;
    }

    // Skip non-data lines
    if (line.length < 5) continue;
    if (/^(página|page|\d+\s*\/\s*\d+|^\d+$|^-+$)/i.test(line)) continue;

    // Try to extract drug info from structured lines
    const match = line.match(drugLinePattern);
    if (match && headerFound) {
      const [, col1, col2, col3, col4] = match;
      const substance = col2 || col1 || '';
      const tradeName = col1 || '';
      const atcCode = (col3 || col4 || '').match(/[A-Z]\d{2}[A-Z]{2}\d{2}/)?.[0] || '';

      if (substance.length > 2) {
        drugs.push({
          id: hashId(`${source}-${tradeName}-${substance}`),
          source,
          chnmCode: '',
          tradeName: tradeName.trim(),
          activeSubstance: substance.trim(),
          activeSubstanceNormalized: normalizeSubstance(substance),
          atcCode: atcCode.trim().toUpperCase(),
          reimbursementType: 'AUE',
          status: 'AUE',
          indication: '',
          isOncology: isOncologyATC(atcCode) ||
            ONCOLOGY_SUBSTANCES.some((s) => normalizeSubstance(substance).includes(s)),
          fetchedAt: new Date().toISOString()
        });
      }
      continue;
    }

    // Strategy 2: Look for known oncology substance names in free text
    for (const knownSubstance of ONCOLOGY_SUBSTANCES) {
      if (line.toLowerCase().includes(knownSubstance.toLowerCase())) {
        // Check if we already captured this substance
        const norm = normalizeSubstance(knownSubstance);
        if (!drugs.some((d) => d.activeSubstanceNormalized === norm)) {
          // Try to extract trade name from surrounding context
          const tradeMatch = line.match(
            new RegExp(`([A-Z][a-zA-Zà-ÿ]+(?:\\s*®)?)\\s*.*${knownSubstance}`, 'i')
          );
          drugs.push({
            id: hashId(`${source}-pdf-${knownSubstance}`),
            source,
            chnmCode: '',
            tradeName: tradeMatch?.[1]?.replace('®', '').trim() || '',
            activeSubstance: knownSubstance,
            activeSubstanceNormalized: norm,
            atcCode: '',
            reimbursementType: 'AUE',
            status: 'AUE',
            indication: '',
            isOncology: true,
            fetchedAt: new Date().toISOString()
          });
        }
      }
    }
  }

  // Deduplicate by normalized substance
  const seen = new Set();
  const deduped = drugs.filter((d) => {
    const key = d.activeSubstanceNormalized || d.tradeName.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  logger.info(`[INFARMED] PDF parser extracted ${deduped.length} drugs from ${lines.length} lines`);
  return deduped;
};

/**
 * Fetches the AUE Excel list from INFARMED.
 * Since we're in Node.js without native Excel parsing, we fetch the .xls
 * (which is often an HTML table saved as .xls) and parse it as HTML.
 * If it's a true binary Excel file, we fall back to the xlsx library.
 * If it's a PDF, we extract text with pdf-parse.
 */
const fetchAUEList = async (logger) => {
  logger.info('[INFARMED] Fetching AUE list from CHNM...');
  const drugs = [];

  try {
    const res = await safeFetch(AUE_EXCEL_URL, {
      headers: { Accept: 'application/vnd.ms-excel, text/html, */*' }
    });

    if (!res.ok) {
      logger.warn(`[INFARMED] AUE list HTTP ${res.status}`);
      return drugs;
    }

    const buffer = await res.buffer();

    // Detect PDF files (INFARMED often serves PDFs with wrong MIME type)
    if (buffer.length > 4 && buffer.toString('utf-8', 0, 5) === '%PDF-') {
      logger.info('[INFARMED] AUE list is a PDF, parsing with pdf-parse...');
      try {
        const pdfData = await pdfParse(buffer);
        const pdfDrugs = parsePdfDrugList(pdfData.text, 'aue_chnm', logger);
        drugs.push(...pdfDrugs);
        logger.info(`[INFARMED] Parsed ${pdfDrugs.length} drugs from AUE PDF`);
      } catch (pdfErr) {
        logger.warn(`[INFARMED] PDF parsing failed: ${pdfErr.message}`);
      }
      return drugs;
    }

    const text = buffer.toString('utf-8');

    // Many INFARMED "Excel" files are actually HTML tables
    if (text.includes('<table') || text.includes('<TABLE')) {
      const $ = cheerio.load(text);
      const rows = $('tr');

      let headers = [];
      rows.each((i, row) => {
        const cells = $(row).find('td, th').map((_, cell) => $(cell).text().trim()).get();

        if (i === 0 || (!headers.length && cells.some((c) => /substância|substance|DCI/i.test(c)))) {
          headers = cells.map((h) => h.toLowerCase());
          return;
        }

        if (!cells.length || cells.length < 3) return;

        const record = {};
        headers.forEach((h, idx) => {
          record[h] = cells[idx] || '';
        });

        const substance = record['substância ativa'] || record['substancia ativa'] ||
          record['dci'] || record['substance'] || cells[1] || '';
        const tradeName = record['nome comercial'] || record['nome'] ||
          record['medicamento'] || cells[0] || '';
        const chnmCode = record['chnm'] || record['código'] || record['codigo'] || cells[0] || '';
        const atcCode = record['atc'] || record['código atc'] || '';
        const status = record['estado'] || record['status'] || 'AUE';
        const indication = record['indicação'] || record['indicacao'] ||
          record['indication'] || record['indicação terapêutica'] || '';

        if (!substance && !tradeName) return;

        drugs.push({
          id: hashId(`aue-${chnmCode || tradeName}-${substance}`),
          source: 'aue_chnm',
          chnmCode: chnmCode.trim(),
          tradeName: tradeName.trim(),
          activeSubstance: substance.trim(),
          activeSubstanceNormalized: normalizeSubstance(substance),
          atcCode: atcCode.trim().toUpperCase(),
          reimbursementType: 'AUE',
          status: status.trim(),
          indication: indication.trim(),
          isOncology: isOncologyATC(atcCode) ||
            ONCOLOGY_SUBSTANCES.some((s) => normalizeSubstance(substance).includes(s)),
          fetchedAt: new Date().toISOString()
        });
      });

      logger.info(`[INFARMED] Parsed ${drugs.length} drugs from AUE HTML table`);
    } else {
      // Binary Excel — try dynamic import of xlsx
      try {
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

        for (const row of rows) {
          const substance = row['Substância Ativa'] || row['DCI'] || row['Substance'] || '';
          const tradeName = row['Nome Comercial'] || row['Medicamento'] || row['Nome'] || '';
          const chnmCode = row['CHNM'] || row['Código'] || '';
          const atcCode = row['ATC'] || row['Código ATC'] || '';
          const indication = row['Indicação'] || row['Indicação Terapêutica'] || '';

          if (!substance && !tradeName) continue;

          drugs.push({
            id: hashId(`aue-${chnmCode || tradeName}-${substance}`),
            source: 'aue_chnm',
            chnmCode: String(chnmCode).trim(),
            tradeName: String(tradeName).trim(),
            activeSubstance: String(substance).trim(),
            activeSubstanceNormalized: normalizeSubstance(substance),
            atcCode: String(atcCode).trim().toUpperCase(),
            reimbursementType: 'AUE',
            status: 'AUE',
            indication: String(indication).trim(),
            isOncology: isOncologyATC(atcCode) ||
              ONCOLOGY_SUBSTANCES.some((s) => normalizeSubstance(substance).includes(s)),
            fetchedAt: new Date().toISOString()
          });
        }

        logger.info(`[INFARMED] Parsed ${drugs.length} drugs from AUE Excel binary`);
      } catch (xlsxErr) {
        logger.warn(`[INFARMED] xlsx library not available, skipping binary Excel: ${xlsxErr.message}`);
      }
    }
  } catch (err) {
    logger.error(`[INFARMED] Failed to fetch AUE list: ${err.message}`);
  }

  return drugs;
};

// ---- 2. INFOMED scraping ---------------------------------------------------

/**
 * Searches INFOMED for a specific active substance and extracts:
 * - AIM (Autorização de Introdução no Mercado) status
 * - Commercialisation status
 * - Approved indications (from RCM link if available)
 * - Trade names
 */
const searchINFOMED = async (substance, logger) => {
  const results = [];

  try {
    // INFOMED uses a search form — we POST the substance name
    // Try multiple URL patterns (INFOMED has changed endpoints over time)
    const searchUrls = [
      `${INFOMED_SEARCH_URL}pesquisa-avancada?substancia=${encodeURIComponent(substance)}`,
      `https://extranet.infarmed.pt/INFOMED-fo/pesquisa-avancada?substanciaAtiva=${encodeURIComponent(substance)}`,
      `https://extranet.infarmed.pt/INFOMED-fo/index.xhtml?substancia=${encodeURIComponent(substance)}`,
    ];

    let res = null;
    for (const searchUrl of searchUrls) {
      try {
        res = await safeFetch(searchUrl, {
          headers: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            Referer: 'https://extranet.infarmed.pt/INFOMED-fo/',
            'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.5',
            'Cache-Control': 'no-cache',
          }
        });
        if (res && res.ok) break;
      } catch {
        // try next URL
      }
    }

    if (!res || !res.ok) return results;

    const html = await res.text();
    const $ = cheerio.load(html);

    // Parse search results table
    $('table.resultados tr, table.table tr, .search-results tr').each((i, row) => {
      if (i === 0) return; // skip header

      const cells = $(row).find('td').map((_, cell) => $(cell).text().trim()).get();
      const links = $(row).find('a[href]').map((_, a) => $(a).attr('href')).get();

      if (cells.length < 3) return;

      const tradeName = cells[0] || '';
      const activeSubst = cells[1] || substance;
      const dosageForm = cells[2] || '';
      const aimStatus = cells[3] || '';
      const commercialised = cells[4] || '';

      // Extract RCM link for indication scraping
      const rcmLink = links.find((l) => /rcm|rci|resumo/i.test(l)) || null;

      results.push({
        tradeName: tradeName.trim(),
        activeSubstance: activeSubst.trim(),
        dosageForm: dosageForm.trim(),
        aimStatus: aimStatus.trim(),
        commercialised: commercialised.trim(),
        rcmLink,
        source: 'infomed'
      });
    });

    // Alternative: try JSON API endpoint (INFOMED sometimes returns JSON)
    if (!results.length) {
      try {
        const apiRes = await safeFetch(
          `${INFOMED_API_BASE}?substanciaAtiva=${encodeURIComponent(substance)}&output=json`,
          { headers: { Accept: 'application/json' } }
        );
        if (apiRes.ok) {
          const contentType = apiRes.headers.get('content-type') || '';
          if (contentType.includes('json')) {
            const json = await apiRes.json();
            const items = json.results || json.data || json.medicamentos || [];
            for (const item of (Array.isArray(items) ? items : [])) {
              results.push({
                tradeName: item.nome || item.nomeComercial || '',
                activeSubstance: item.substanciaAtiva || substance,
                dosageForm: item.formaFarmaceutica || '',
                aimStatus: item.estadoAIM || item.estado || '',
                commercialised: item.comercializado || '',
                rcmLink: item.rcmUrl || item.rcm || null,
                source: 'infomed_api'
              });
            }
          }
        }
      } catch {
        // silent — JSON API is undocumented
      }
    }
  } catch (err) {
    logger.warn(`[INFOMED] Search failed for "${substance}": ${err.message}`);
  }

  return results;
};

/**
 * Batch scrape INFOMED for all known oncology substances.
 * Rate-limited to avoid overloading the server.
 */
const scrapeINFOMED = async (substances, logger, delayMs = 1500) => {
  const allResults = new Map();

  for (const substance of substances) {
    const results = await searchINFOMED(substance, logger);
    if (results.length) {
      allResults.set(normalizeSubstance(substance), {
        substance,
        entries: results,
        scrapedAt: new Date().toISOString()
      });
    }
    await sleep(delayMs);
  }

  logger.info(`[INFOMED] Scraped ${allResults.size}/${substances.length} substances with results`);
  return allResults;
};

// ---- 3. Transparencia SNS API ----------------------------------------------

/**
 * Fetches hospital drug spending data from Transparencia SNS.
 * Filters for L-group (antineoplastic) drugs.
 * This confirms real-world usage/availability in Portuguese hospitals.
 */
const fetchTransparenciaSNS = async (logger) => {
  const records = [];

  try {
    // Fetch hospital drug spending, filtered for antineoplastic group
    const url = new URL(
      `${TRANSPARENCIA_BASE}/${TRANSPARENCIA_HOSPITAL_DATASET}/records`
    );
    url.searchParams.set('limit', '100');
    url.searchParams.set('offset', '0');
    // Order by most recent data (field name: 'tempo' in current dataset schema)
    url.searchParams.set('order_by', 'tempo DESC');

    logger.info(`[Transparencia] Fetching hospital drug spending data...`);

    let hasMore = true;
    let offset = 0;
    const maxRecords = 2000;

    while (hasMore && offset < maxRecords) {
      url.searchParams.set('offset', String(offset));

      const res = await safeFetch(url.toString(), {
        headers: { Accept: 'application/json' }
      });

      if (!res.ok) {
        logger.warn(`[Transparencia] HTTP ${res.status} at offset ${offset}`);
        break;
      }

      const json = await res.json();
      const results = json.results || json.records || [];

      if (!results.length) {
        hasMore = false;
        break;
      }

      for (const record of results) {
        const fields = record.fields || record;
        // Current dataset fields: tempo, regiao, encargos_sns_hospitalar
        // Legacy fields: grupo_farmacoterapeutico_codigo, medicamento, substancia_ativa, etc.
        const groupCode = fields.grupo_farmacoterapeutico_codigo ||
          fields.cfth_codigo || fields.atc || fields.grupo_cfth_codigo || '';
        const groupName = fields.grupo_farmacoterapeutico ||
          fields.cfth_designacao || fields.grupo_cfth || '';
        const drugName = fields.medicamento || fields.designacao ||
          fields.denominacao || fields.nome_medicamento || '';
        const substance = fields.substancia_ativa || fields.dci ||
          fields.substancia || fields.principio_ativo || '';

        // Filter oncology-related groups (ATC L-group or name match)
        const isOnco = isOncologyATC(groupCode) ||
          /antineopl|oncol|citot[oó]x|imunomodul|anticorp.*monoclonal/i.test(groupName) ||
          ONCOLOGY_SUBSTANCES.some((s) => normalizeSubstance(substance).includes(s) ||
            normalizeSubstance(drugName).includes(s));

        if (isOnco || (substance && ONCOLOGY_SUBSTANCES.some((s) =>
          normalizeSubstance(substance).includes(normalizeSubstance(s))))) {
          records.push({
            drugName,
            activeSubstance: substance,
            groupCode,
            groupName,
            hospital: fields.entidade || fields.hospital || fields.regiao || '',
            spending: fields.despesa || fields.valor || fields.encargos_sns_hospitalar || 0,
            quantity: fields.quantidade || fields.unidades || 0,
            period: fields.periodo || fields.tempo || fields.date || fields.ano || '',
            source: 'transparencia_sns'
          });
        }
      }

      offset += results.length;
      if (results.length < 100) hasMore = false;
      await sleep(500);
    }

    logger.info(`[Transparencia] Found ${records.length} oncology drug spending records`);
  } catch (err) {
    logger.error(`[Transparencia] Failed to fetch spending data: ${err.message}`);
  }

  return records;
};

// ---- 4. AUE Benefit list ---------------------------------------------------

/**
 * Fetches the "AUE de benefício clínico bem reconhecido" list.
 * These are drugs with well-recognized clinical benefit under AUE.
 */
const fetchAUEBenefitList = async (logger) => {
  const drugs = [];

  try {
    logger.info('[INFARMED] Fetching AUE benefit list...');
    const res = await safeFetch(AUE_BENEFIT_URL, {
      headers: { Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, */*' }
    });

    if (!res.ok) {
      logger.warn(`[INFARMED] AUE benefit list HTTP ${res.status}`);
      return drugs;
    }

    const buffer = await res.buffer();

    // Detect PDF
    if (buffer.length > 4 && buffer.toString('utf-8', 0, 5) === '%PDF-') {
      logger.info('[INFARMED] AUE benefit list is a PDF, parsing...');
      try {
        const pdfData = await pdfParse(buffer);
        const pdfDrugs = parsePdfDrugList(pdfData.text, 'aue_benefit', logger);
        for (const d of pdfDrugs) {
          d.clinicalBenefit = 'well_recognized';
          d.status = 'AUE - Benefício Clínico Reconhecido';
        }
        drugs.push(...pdfDrugs);
        logger.info(`[INFARMED] Parsed ${pdfDrugs.length} drugs from AUE benefit PDF`);
      } catch (pdfErr) {
        logger.warn(`[INFARMED] AUE benefit PDF parsing failed: ${pdfErr.message}`);
      }
      return drugs;
    }

    const text = buffer.toString('utf-8');

    // Try HTML parsing first (INFARMED pattern)
    if (text.includes('<table') || text.includes('<TABLE')) {
      const $ = cheerio.load(text);
      $('tr').each((i, row) => {
        if (i === 0) return;
        const cells = $(row).find('td').map((_, c) => $(c).text().trim()).get();
        if (cells.length < 2) return;

        drugs.push({
          id: hashId(`aue-benefit-${cells[0]}-${cells[1]}`),
          source: 'aue_benefit',
          tradeName: cells[0] || '',
          activeSubstance: cells[1] || '',
          activeSubstanceNormalized: normalizeSubstance(cells[1] || ''),
          indication: cells[2] || '',
          clinicalBenefit: 'well_recognized',
          reimbursementType: 'AUE',
          status: 'AUE - Benefício Clínico Reconhecido',
          fetchedAt: new Date().toISOString()
        });
      });
    } else {
      // Try xlsx
      try {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(buffer, { type: 'buffer' });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

        for (const row of rows) {
          const substance = row['Substância Ativa'] || row['DCI'] || Object.values(row)[1] || '';
          const tradeName = row['Nome Comercial'] || row['Medicamento'] || Object.values(row)[0] || '';
          const indication = row['Indicação'] || row['Indicação Terapêutica'] || Object.values(row)[2] || '';

          if (!substance && !tradeName) continue;

          drugs.push({
            id: hashId(`aue-benefit-${tradeName}-${substance}`),
            source: 'aue_benefit',
            tradeName: String(tradeName).trim(),
            activeSubstance: String(substance).trim(),
            activeSubstanceNormalized: normalizeSubstance(substance),
            indication: String(indication).trim(),
            clinicalBenefit: 'well_recognized',
            reimbursementType: 'AUE',
            status: 'AUE - Benefício Clínico Reconhecido',
            fetchedAt: new Date().toISOString()
          });
        }
      } catch {
        logger.warn('[INFARMED] Could not parse AUE benefit list as Excel');
      }
    }

    logger.info(`[INFARMED] Parsed ${drugs.length} drugs from AUE benefit list`);
  } catch (err) {
    logger.error(`[INFARMED] Failed to fetch AUE benefit list: ${err.message}`);
  }

  return drugs;
};

// ---- 5. PAP (Programa de Acesso Precoce) scraping --------------------------

/**
 * Fetches the list of active PAP programs from INFARMED.
 * INFARMED's PAP page is a Liferay CMS portal — the content may be rendered
 * as an HTML table, a linked PDF/Excel document, or embedded journal content.
 * We try multiple strategies:
 *   1. Fetch the PAP list page and look for download links (PDF/Excel)
 *   2. Parse any HTML table directly on the page
 *   3. Follow document links and parse PDF/Excel content
 */
const fetchPAPList = async (logger) => {
  const drugs = [];

  const tryParsePageForDrugs = async (url, label) => {
    try {
      const res = await safeFetch(url, {
        headers: { Accept: 'text/html,application/xhtml+xml,*/*' }
      });

      if (!res.ok) {
        logger.warn(`[INFARMED PAP] ${label} HTTP ${res.status}`);
        return { drugs: [], documentUrls: [] };
      }

      const buffer = await res.buffer();

      // Check if the response is a PDF
      if (buffer.length > 4 && buffer.toString('utf-8', 0, 5) === '%PDF-') {
        logger.info(`[INFARMED PAP] ${label} returned a PDF, parsing...`);
        try {
          const pdfData = await pdfParse(buffer);
          const pdfDrugs = parsePapPdfText(pdfData.text, logger);
          return { drugs: pdfDrugs, documentUrls: [] };
        } catch (pdfErr) {
          logger.warn(`[INFARMED PAP] PDF parsing failed: ${pdfErr.message}`);
          return { drugs: [], documentUrls: [] };
        }
      }

      // Check if response is Excel
      const contentType = res.headers?.get?.('content-type') || '';
      if (contentType.includes('spreadsheet') || contentType.includes('excel')) {
        try {
          const XLSX = await import('xlsx');
          const wb = XLSX.read(buffer, { type: 'buffer' });
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
          const xlsDrugs = parsePapExcelRows(rows, logger);
          return { drugs: xlsDrugs, documentUrls: [] };
        } catch {
          logger.warn(`[INFARMED PAP] Excel parsing failed for ${label}`);
        }
      }

      const html = buffer.toString('utf-8');
      const $ = cheerio.load(html);
      const pageDrugs = [];
      const documentUrls = [];

      // Strategy 1: Find download links to PDF/Excel documents
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (/\.(pdf|xls|xlsx|csv)/i.test(href) ||
            /documents\/\d+/i.test(href) ||
            /PAP|acesso.precoce|programa.*acesso/i.test($(el).text())) {
          const fullUrl = href.startsWith('http') ? href : `https://www.infarmed.pt${href}`;
          documentUrls.push(fullUrl);
        }
      });

      // Strategy 2: Parse HTML tables on the page
      $('table').each((_, table) => {
        const rows = $(table).find('tr');
        let headers = [];

        rows.each((i, row) => {
          const cells = $(row).find('td, th').map((__, cell) => $(cell).text().trim()).get();

          if (i === 0 || (!headers.length && cells.some((c) =>
            /substância|medicamento|DCI|nome|programa|indicação/i.test(c)))) {
            headers = cells.map((h) => h.toLowerCase());
            return;
          }

          if (!cells.length || cells.length < 2) return;

          const record = {};
          headers.forEach((h, idx) => { record[h] = cells[idx] || ''; });

          const substance = record['substância ativa'] || record['substancia ativa'] ||
            record['dci'] || record['substance'] || '';
          const tradeName = record['nome comercial'] || record['medicamento'] ||
            record['nome'] || record['programa'] || '';
          const indication = record['indicação'] || record['indicação terapêutica'] ||
            record['indicacao'] || '';
          const status = record['estado'] || record['status'] || record['situação'] || 'Ativo';
          const startDate = record['data início'] || record['data inicio'] ||
            record['data de início'] || record['data'] || '';

          if (!substance && !tradeName) return;

          pageDrugs.push({
            id: hashId(`pap-${tradeName}-${substance}`),
            source: 'pap',
            tradeName: tradeName.trim(),
            activeSubstance: substance.trim(),
            activeSubstanceNormalized: normalizeSubstance(substance),
            atcCode: record['atc'] || record['código atc'] || '',
            reimbursementType: 'PAP',
            status: status.trim() || 'PAP Ativo',
            indication: indication.trim(),
            papStartDate: startDate.trim(),
            isOncology: ONCOLOGY_SUBSTANCES.some((s) =>
              normalizeSubstance(substance).includes(s)),
            fetchedAt: new Date().toISOString()
          });
        });
      });

      // Strategy 3: Parse Liferay journal-content divs (common in INFARMED)
      if (!pageDrugs.length) {
        $('.journal-content-article, .web-content-article, .asset-entry, [class*="journal"]').each((_, el) => {
          const text = $(el).text();
          // Look for drug names from our known list within the content
          for (const substance of ONCOLOGY_SUBSTANCES) {
            const regex = new RegExp(`\\b${substance.replace(/\s+/g, '\\s+')}\\b`, 'i');
            if (regex.test(text)) {
              // Extract surrounding context for indication
              const match = text.match(new RegExp(
                `(.{0,200}${substance.replace(/\s+/g, '\\s+')}.{0,200})`, 'i'
              ));
              const context = match ? match[1].trim() : '';

              pageDrugs.push({
                id: hashId(`pap-content-${substance}`),
                source: 'pap',
                tradeName: '',
                activeSubstance: substance,
                activeSubstanceNormalized: normalizeSubstance(substance),
                atcCode: '',
                reimbursementType: 'PAP',
                status: 'PAP Ativo',
                indication: context.slice(0, 500),
                papStartDate: '',
                isOncology: true,
                fetchedAt: new Date().toISOString()
              });
            }
          }
        });
      }

      return { drugs: pageDrugs, documentUrls };
    } catch (err) {
      logger.warn(`[INFARMED PAP] Failed to fetch ${label}: ${err.message}`);
      return { drugs: [], documentUrls: [] };
    }
  };

  try {
    logger.info('[INFARMED PAP] Fetching PAP list...');

    // Try all known PAP URLs in parallel (CMS pages + direct document links)
    const pageResults = await Promise.all([
      tryParsePageForDrugs(PAP_LIST_URL, 'PAP main page'),
      tryParsePageForDrugs(PAP_LIST_ALT_URL, 'PAP alt page'),
      ...PAP_DOCUMENT_URLS.map((u) => tryParsePageForDrugs(u, `PAP document ${u.split('/').pop()}`))
    ]);

    for (const r of pageResults) drugs.push(...r.drugs);

    // Follow any document links found on the pages
    const allDocUrls = [...new Set(pageResults.flatMap((r) => r.documentUrls))];
    for (const docUrl of allDocUrls.slice(0, 5)) {
      logger.info(`[INFARMED PAP] Following document link: ${docUrl}`);
      try {
        const docRes = await safeFetch(docUrl, {
          headers: { Accept: 'application/pdf, application/vnd.ms-excel, */*' }
        });

        if (!docRes.ok) continue;

        const docBuffer = await docRes.buffer();

        // PDF document
        if (docBuffer.length > 4 && docBuffer.toString('utf-8', 0, 5) === '%PDF-') {
          const pdfData = await pdfParse(docBuffer);
          const pdfDrugs = parsePapPdfText(pdfData.text, logger);
          drugs.push(...pdfDrugs);
          continue;
        }

        // Excel document
        try {
          const XLSX = await import('xlsx');
          const wb = XLSX.read(docBuffer, { type: 'buffer' });
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
          drugs.push(...parsePapExcelRows(rows, logger));
        } catch {
          // Try as HTML table
          const html = docBuffer.toString('utf-8');
          if (html.includes('<table')) {
            const { drugs: htmlDrugs } = await tryParsePageForDrugs(docUrl, 'PAP document');
            drugs.push(...htmlDrugs);
          }
        }
      } catch (docErr) {
        logger.warn(`[INFARMED PAP] Failed to fetch document: ${docErr.message}`);
      }
      await sleep(1000);
    }

    // Deduplicate by normalized substance
    const seen = new Set();
    const deduped = drugs.filter((d) => {
      const key = d.activeSubstanceNormalized || normalizeSubstance(d.tradeName);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    logger.info(`[INFARMED PAP] Found ${deduped.length} drugs in PAP programs`);
    return deduped;
  } catch (err) {
    logger.error(`[INFARMED PAP] Failed to fetch PAP list: ${err.message}`);
    return drugs;
  }
};

/**
 * Parses PAP drug data from PDF text.
 */
const parsePapPdfText = (pdfText, logger) => {
  const drugs = [];
  if (!pdfText) return drugs;

  const lines = pdfText.split('\n').map((l) => l.trim()).filter(Boolean);

  // Look for oncology substances in PDF text
  for (const substance of ONCOLOGY_SUBSTANCES) {
    const regex = new RegExp(`\\b${substance.replace(/\s+/g, '\\s+')}\\b`, 'i');
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        // Extract surrounding lines as context for indication
        const context = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 3)).join(' ');

        drugs.push({
          id: hashId(`pap-pdf-${substance}-${i}`),
          source: 'pap',
          tradeName: '',
          activeSubstance: substance,
          activeSubstanceNormalized: normalizeSubstance(substance),
          atcCode: '',
          reimbursementType: 'PAP',
          status: 'PAP Ativo',
          indication: context.slice(0, 500),
          papStartDate: '',
          isOncology: true,
          fetchedAt: new Date().toISOString()
        });
        break; // one entry per substance
      }
    }
  }

  // Also try tabular parsing (like parsePdfDrugList)
  const tabularDrugs = parsePdfDrugList(pdfText, 'pap', logger);
  for (const d of tabularDrugs) {
    d.reimbursementType = 'PAP';
    d.status = 'PAP Ativo';
  }
  drugs.push(...tabularDrugs);

  // Deduplicate
  const seen = new Set();
  return drugs.filter((d) => {
    const key = d.activeSubstanceNormalized;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Parses PAP drug data from Excel rows.
 */
const parsePapExcelRows = (rows, logger) => {
  const drugs = [];

  for (const row of rows) {
    const substance = row['Substância Ativa'] || row['DCI'] || row['Substance'] ||
      row['substância ativa'] || row['dci'] || Object.values(row)[1] || '';
    const tradeName = row['Nome Comercial'] || row['Medicamento'] || row['Nome'] ||
      row['Programa'] || Object.values(row)[0] || '';
    const indication = row['Indicação'] || row['Indicação Terapêutica'] ||
      row['indicação'] || Object.values(row)[2] || '';
    const status = row['Estado'] || row['Situação'] || row['Status'] || 'PAP Ativo';
    const startDate = row['Data Início'] || row['Data'] || '';

    if (!substance && !tradeName) continue;

    drugs.push({
      id: hashId(`pap-xls-${tradeName}-${substance}`),
      source: 'pap',
      tradeName: String(tradeName).trim(),
      activeSubstance: String(substance).trim(),
      activeSubstanceNormalized: normalizeSubstance(substance),
      atcCode: row['ATC'] || row['Código ATC'] || '',
      reimbursementType: 'PAP',
      status: String(status).trim() || 'PAP Ativo',
      indication: String(indication).trim(),
      papStartDate: String(startDate).trim(),
      isOncology: ONCOLOGY_SUBSTANCES.some((s) =>
        normalizeSubstance(substance).includes(s)),
      fetchedAt: new Date().toISOString()
    });
  }

  logger.info(`[INFARMED PAP] Parsed ${drugs.length} drugs from Excel`);
  return drugs;
};

// ---- 6. EMA EPAR product list (AIM ground-truth) ---------------------------

/**
 * Downloads the EMA EPAR Excel product list and extracts oncology drugs with
 * central marketing authorisation (AIM). This is the authoritative source for
 * whether a drug has EMA approval — critical for correctly classifying
 * PAP vs AUE (AUE is ONLY for drugs WITHOUT EMA approval).
 *
 * Returns a Map<normalizedSubstance, { activeSubstance, tradeName, status, therapeuticArea }>
 */
export const fetchEMAEPAR = async (logger) => {
  const epaMap = new Map();

  try {
    logger.info('[EMA EPAR] Fetching EMA product list...');

    const res = await safeFetch(EMA_EPAR_CSV_URL, {
      headers: {
        Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel, */*',
        Referer: 'https://www.ema.europa.eu/'
      }
    });

    if (!res.ok) {
      logger.warn(`[EMA EPAR] HTTP ${res.status} from EMA EPAR URL`);
      return epaMap;
    }

    const buffer = await res.buffer();
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buffer, { type: 'buffer' });

    // Try all sheets — EMA sometimes puts data in different sheets
    let rows = [];
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      // Try default parsing first
      let candidate = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      // If first row has __EMPTY columns, the real headers are in a later row
      // Try to detect header row by looking for known keywords
      if (candidate.length > 0 && Object.keys(candidate[0]).some((k) => k.startsWith('__EMPTY'))) {
        logger.info(`[EMA EPAR] Sheet "${sheetName}" has __EMPTY columns, scanning for header row...`);
        const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        const headerKeywords = /active.?substance|inn|medicine.?name|therapeutic.?area|authoris/i;
        let headerIdx = -1;
        for (let i = 0; i < Math.min(rawRows.length, 20); i++) {
          const rowText = rawRows[i].join(' ');
          if (headerKeywords.test(rowText)) {
            headerIdx = i;
            break;
          }
        }
        if (headerIdx >= 0) {
          const headers = rawRows[headerIdx].map((h) => String(h).trim());
          candidate = rawRows.slice(headerIdx + 1).map((dataRow) => {
            const obj = {};
            headers.forEach((h, idx) => { if (h) obj[h] = dataRow[idx] !== undefined ? dataRow[idx] : ''; });
            return obj;
          }).filter((obj) => Object.values(obj).some((v) => v !== ''));
          logger.info(`[EMA EPAR] Found header at row ${headerIdx}: ${headers.filter(Boolean).slice(0, 10).join(' | ')}`);
        }
      }

      // Check if this sheet has medicine-like data (has substance/name columns)
      if (candidate.length > 0) {
        const firstRowKeys = Object.keys(candidate[0]).join(' ').toLowerCase();
        if (/substance|inn|medicine|active|therapeutic|authoris/i.test(firstRowKeys)) {
          rows = candidate;
          logger.info(`[EMA EPAR] Using sheet "${sheetName}" with ${rows.length} rows`);
          break;
        }
      }

      // If no good sheet found yet, keep the largest sheet as fallback
      if (candidate.length > rows.length) {
        rows = candidate;
      }
    }

    // Log column names from first valid row for debugging
    if (rows.length > 0) {
      const cols = Object.keys(rows[0]).filter((k) => !k.startsWith('__EMPTY'));
      logger.info(`[EMA EPAR] Excel columns (${cols.length}): ${cols.slice(0, 15).join(' | ')}`);
    }

    // Column names vary between EMA EPAR versions — try all known variants
    // Also try case-insensitive lookup as a fallback
    const getField = (row, ...keys) => {
      for (const k of keys) {
        if (row[k] !== undefined && row[k] !== '') return String(row[k]).trim();
      }
      // Case-insensitive fallback
      const rowKeys = Object.keys(row);
      for (const k of keys) {
        const kl = k.toLowerCase();
        const found = rowKeys.find((rk) => rk.toLowerCase() === kl || rk.toLowerCase().includes(kl));
        if (found && row[found] !== undefined && row[found] !== '') return String(row[found]).trim();
      }
      return '';
    };

    for (const row of rows) {
      const substance = getField(row,
        'Active substance', 'INN', 'Substance', 'active_substance',
        'International non-proprietary name (INN) / common name',
        'International non-proprietary name (INN)',
        'Active Substance', 'inn');
      const tradeName = getField(row,
        'Medicine name', 'Trade name', 'Product name', 'Name',
        'medicine_name', 'Category');
      const therapeuticArea = getField(row,
        'Therapeutic area', 'ATC code', 'Pharmacotherapeutic group',
        'Condition / indication', 'therapeutic_area', 'Indication',
        'ATC Code', 'Anatomical therapeutic chemical (ATC) code');
      const status = getField(row,
        'Authorisation status', 'Marketing authorisation status',
        'Status', 'authorisation_status');
      const authDate = getField(row,
        'Marketing authorisation date', 'Date of issue of marketing authorisation valid throughout the European Union',
        'First published', 'Authorisation date', 'authorisation_date',
        'Date of issue of marketing authorisation');

      if (!substance) continue;

      // Check if this substance is in our oncology list (most reliable filter)
      const normSub = normalizeSubstance(substance);
      const inOncologyList = ONCOLOGY_SUBSTANCES.some((s) =>
        normSub.includes(normalizeSubstance(s)) || normalizeSubstance(s).includes(normSub));

      // Filter for oncology: in our drug list, or therapeutic area match, or ATC L-group
      const isOnco =
        inOncologyList ||
        isOncologyATC(therapeuticArea) ||
        /oncolog|antineopl|cancer|tumour|tumor|leukaem|leukemi|lymphoma|myeloma|sarcoma|melanoma|carcinoma|glioma|mesothelioma/i.test(therapeuticArea);

      if (!isOnco) continue;

      const normKey = normalizeSubstance(substance);
      if (!epaMap.has(normKey)) {
        epaMap.set(normKey, {
          activeSubstance: substance,
          tradeName,
          therapeuticArea,
          status,
          authDate,
          hasEmaApproval: /authorised|valid|active/i.test(status),
          source: 'ema_epar'
        });
      }
    }

    logger.info(`[EMA EPAR] Found ${epaMap.size} oncology substances with EMA authorisation`);
  } catch (err) {
    logger.warn(`[EMA EPAR] Failed to fetch/parse EMA product list: ${err.message}`);
  }

  return epaMap;
};

// ---- 7. Master sync function -----------------------------------------------

/**
 * Runs the full INFARMED sync: AUE list + AUE benefit + PAP + INFOMED + Transparencia.
 * Merges all sources into a unified drug reimbursement dataset.
 */
export const runInfarmedSync = async ({
  logger,
  substances = ONCOLOGY_SUBSTANCES,
  includeTransparencia = true,
  includeINFOMED = true,
  includePAP = true,
  includeEMAEPAR = true,
  infomedDelayMs = 1500
} = {}) => {
  const startTime = Date.now();
  logger.info('[INFARMED Sync] Starting full sync...');

  // Phase 1: Fetch all sources in parallel where possible
  const [aueList, aueBenefitList, papList, transparenciaData, emaEpar] = await Promise.all([
    fetchAUEList(logger),
    fetchAUEBenefitList(logger),
    includePAP ? fetchPAPList(logger) : Promise.resolve([]),
    includeTransparencia ? fetchTransparenciaSNS(logger) : Promise.resolve([]),
    includeEMAEPAR ? fetchEMAEPAR(logger) : Promise.resolve(new Map())
  ]);

  // Phase 2: INFOMED scraping (sequential, rate-limited)
  let infomedData = new Map();
  if (includeINFOMED) {
    infomedData = await scrapeINFOMED(substances, logger, infomedDelayMs);
  }

  // Phase 3: Merge into unified dataset
  const drugMap = new Map();

  // AUE list as primary source
  for (const drug of aueList) {
    const key = drug.activeSubstanceNormalized || normalizeSubstance(drug.tradeName);
    if (!drugMap.has(key)) {
      drugMap.set(key, {
        ...drug,
        sources: ['aue_chnm'],
        infomedEntries: [],
        hospitalSpending: [],
        indications: drug.indication ? [drug.indication] : [],
        tradeNames: drug.tradeName ? [drug.tradeName] : []
      });
    } else {
      const existing = drugMap.get(key);
      existing.sources = [...new Set([...existing.sources, 'aue_chnm'])];
      if (drug.tradeName && !existing.tradeNames.includes(drug.tradeName)) {
        existing.tradeNames.push(drug.tradeName);
      }
      if (drug.indication && !existing.indications.includes(drug.indication)) {
        existing.indications.push(drug.indication);
      }
    }
  }

  // Merge AUE benefit data
  for (const drug of aueBenefitList) {
    const key = drug.activeSubstanceNormalized || normalizeSubstance(drug.tradeName);
    if (drugMap.has(key)) {
      const existing = drugMap.get(key);
      existing.clinicalBenefit = 'well_recognized';
      existing.sources = [...new Set([...existing.sources, 'aue_benefit'])];
      if (drug.indication && !existing.indications.includes(drug.indication)) {
        existing.indications.push(drug.indication);
      }
    } else {
      drugMap.set(key, {
        ...drug,
        sources: ['aue_benefit'],
        infomedEntries: [],
        hospitalSpending: [],
        indications: drug.indication ? [drug.indication] : [],
        tradeNames: drug.tradeName ? [drug.tradeName] : []
      });
    }
  }

  // Merge PAP (Programa de Acesso Precoce) data
  // PAP implies the drug HAS EMA marketing authorisation (AIM) but is pending
  // full INFARMED reimbursement evaluation. PAP takes precedence over AUE for
  // reimbursementType because AUE is only for drugs WITHOUT EMA authorisation.
  for (const drug of papList) {
    const key = drug.activeSubstanceNormalized || normalizeSubstance(drug.tradeName);
    if (drugMap.has(key)) {
      const existing = drugMap.get(key);
      existing.sources = [...new Set([...existing.sources, 'pap'])];
      existing.papStatus = drug.status || 'PAP Ativo';
      existing.papIndication = drug.indication || '';
      existing.papStartDate = drug.papStartDate || '';
      // PAP overrides AUE: if a drug is in PAP, it has EMA authorisation and
      // is accessible via early access — this is NOT the same as AUE
      if (existing.reimbursementType === 'AUE') {
        existing.reimbursementType = 'PAP';
        existing.status = drug.status || 'PAP Ativo';
      }
      if (drug.tradeName && !existing.tradeNames.includes(drug.tradeName)) {
        existing.tradeNames.push(drug.tradeName);
      }
      if (drug.indication && !existing.indications.includes(drug.indication)) {
        existing.indications.push(drug.indication);
      }
    } else {
      drugMap.set(key, {
        ...drug,
        sources: ['pap'],
        infomedEntries: [],
        hospitalSpending: [],
        indications: drug.indication ? [drug.indication] : [],
        tradeNames: drug.tradeName ? [drug.tradeName] : [],
        papStatus: drug.status || 'PAP Ativo',
        papIndication: drug.indication || '',
        papStartDate: drug.papStartDate || ''
      });
    }
  }

  // Merge INFOMED data
  // INFOMED confirms EMA marketing authorisation (AIM). If a drug was labelled
  // as AUE but INFOMED shows it has AIM, it should be reclassified — AUE is
  // only valid for drugs WITHOUT EMA authorisation.
  for (const [normKey, data] of infomedData) {
    if (drugMap.has(normKey)) {
      const existing = drugMap.get(normKey);
      existing.infomedEntries = data.entries;
      existing.sources = [...new Set([...existing.sources, 'infomed'])];
      // Add trade names from INFOMED
      for (const entry of data.entries) {
        if (entry.tradeName && !existing.tradeNames.includes(entry.tradeName)) {
          existing.tradeNames.push(entry.tradeName);
        }
        if (entry.aimStatus) existing.aimStatus = entry.aimStatus;
        if (entry.commercialised) existing.commercialised = entry.commercialised;
      }
      // If INFOMED confirms AIM and the drug was tagged as AUE, reclassify:
      // - If it also has PAP, keep PAP (already set by PAP merge above)
      // - Otherwise, upgrade to AIM (drug has EMA authorisation, AUE is wrong)
      const hasAIM = data.entries.some((e) => e.aimStatus && e.aimStatus !== 'Revogado');
      if (hasAIM && existing.reimbursementType === 'AUE') {
        existing.reimbursementType = existing.papStatus ? 'PAP' : 'AIM';
        if (!existing.papStatus) {
          existing.status = data.entries[0]?.aimStatus || 'Autorizado';
        }
      }
    } else {
      // Drug found in INFOMED but not in AUE — it has standard AIM
      const first = data.entries[0] || {};
      drugMap.set(normKey, {
        id: hashId(`infomed-${data.substance}`),
        source: 'infomed',
        sources: ['infomed'],
        tradeName: first.tradeName || '',
        tradeNames: data.entries.map((e) => e.tradeName).filter(Boolean),
        activeSubstance: data.substance,
        activeSubstanceNormalized: normKey,
        atcCode: '',
        reimbursementType: 'AIM',
        status: first.aimStatus || 'Autorizado',
        aimStatus: first.aimStatus || '',
        commercialised: first.commercialised || '',
        indication: '',
        indications: [],
        infomedEntries: data.entries,
        hospitalSpending: [],
        isOncology: true,
        clinicalBenefit: null,
        fetchedAt: new Date().toISOString()
      });
    }
  }

  // Merge Transparencia spending data
  // If a drug appears in Transparência SNS hospital spending data, it means
  // Portuguese hospitals are actually purchasing it — strong signal it is funded/reimbursed.
  for (const record of transparenciaData) {
    const key = normalizeSubstance(record.activeSubstance || record.drugName);
    if (drugMap.has(key)) {
      drugMap.get(key).hospitalSpending.push(record);
      drugMap.get(key).sources = [...new Set([...drugMap.get(key).sources, 'transparencia_sns'])];
      // Mark as SNS-covered: if hospitals are spending on it, it is funded
      drugMap.get(key).snsCovered = true;
      // If it was tagged as AUE but has hospital spending + AIM, reclassify
      if (drugMap.get(key).reimbursementType === 'AUE') {
        drugMap.get(key).reimbursementType = 'AIM+SNS';
        drugMap.get(key).status = 'Financiado SNS';
      } else if (drugMap.get(key).reimbursementType === 'PAP') {
        // PAP with hospital spending = effectively funded
        drugMap.get(key).reimbursementType = 'AIM+SNS';
        drugMap.get(key).status = 'Financiado SNS (anteriormente PAP)';
      }
    }
  }

  // Merge EMA EPAR data
  // EMA EPAR is the definitive source for which drugs have central EU marketing
  // authorisation (AIM). Any drug with EMA approval found tagged as AUE must be
  // reclassified — AUE is ONLY valid for drugs WITHOUT EMA authorisation.
  //
  // NOTE: EMA EPAR uses English INNs (e.g. "abiraterone") while INFARMED uses
  // Portuguese INNs (e.g. "abiraterona"). The PORTUGUESE_TO_EMA_INN map handles
  // the reverse: we also look up each drugMap entry by its English equivalent.
  //
  // Build a reverse map: English normalized INN → Portuguese normalized INN in drugMap
  const engToPort = new Map();
  for (const [portName, engName] of Object.entries(PORTUGUESE_TO_EMA_INN)) {
    const portNorm = normalizeSubstance(portName);
    const engNorm = normalizeSubstance(engName);
    if (drugMap.has(portNorm)) {
      engToPort.set(engNorm, portNorm);
    }
  }

  for (const [normKey, epaEntry] of emaEpar) {
    // Try direct match first, then Portuguese variant (abiraterone → abiraterona)
    const drugMapKey = drugMap.has(normKey) ? normKey : (engToPort.get(normKey) || null);
    if (drugMapKey) {
      const existing = drugMap.get(drugMapKey);
      // Also index under the English EMA name for future lookups
      if (drugMapKey !== normKey) {
        drugMap.set(normKey, existing);
      }
      existing.emaApproved = epaEntry.hasEmaApproval;
      existing.emaAuthDate = epaEntry.authDate || '';
      existing.sources = [...new Set([...existing.sources, 'ema_epar'])];
      // Reclassify AUE → AIM / PAP when EMA approval confirmed
      if (epaEntry.hasEmaApproval && existing.reimbursementType === 'AUE') {
        existing.reimbursementType = existing.papStatus ? 'PAP' : 'AIM';
        if (!existing.aimStatus) existing.aimStatus = 'Autorizado (EMA)';
      }
      if (epaEntry.tradeName && !existing.tradeNames.includes(epaEntry.tradeName)) {
        existing.tradeNames.push(epaEntry.tradeName);
      }
    } else if (epaEntry.hasEmaApproval) {
      // Drug in EMA EPAR but not yet in our map — add with AIM status
      drugMap.set(normKey, {
        id: hashId(`ema-${epaEntry.activeSubstance}`),
        source: 'ema_epar',
        sources: ['ema_epar'],
        tradeName: epaEntry.tradeName || '',
        tradeNames: epaEntry.tradeName ? [epaEntry.tradeName] : [],
        activeSubstance: epaEntry.activeSubstance,
        activeSubstanceNormalized: normKey,
        atcCode: '',
        reimbursementType: 'AIM',
        status: 'Autorizado EMA',
        aimStatus: 'Autorizado (EMA)',
        commercialised: '',
        indication: '',
        indications: [],
        infomedEntries: [],
        hospitalSpending: [],
        isOncology: true,
        emaApproved: true,
        emaAuthDate: epaEntry.authDate || '',
        clinicalBenefit: null,
        fetchedAt: new Date().toISOString()
      });
    }
  }

  // Build final array — filter to oncology-relevant drugs
  const drugs = [...drugMap.values()].filter((d) => d.isOncology !== false);

  const meta = {
    syncedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    totalDrugs: drugs.length,
    sources: {
      aue_chnm: aueList.length,
      aue_benefit: aueBenefitList.length,
      pap: papList.length,
      infomed: infomedData.size,
      transparencia_sns: transparenciaData.length,
      ema_epar: emaEpar.size
    },
    oncologySubstancesQueried: substances.length
  };

  logger.info(
    `[INFARMED Sync] Complete: ${drugs.length} oncology drugs merged from ${Object.keys(meta.sources).length} sources in ${meta.durationMs}ms`
  );

  return { drugs, meta };
};

// fetchEMAEPAR, CANCER_TYPE_SYNONYMS, expandCancerTypeSynonyms and
// runInfarmedSync are declared with inline `export const` above — no re-export needed here.
export {
  ONCOLOGY_SUBSTANCES,
  ONCOLOGY_ATC_PREFIXES,
  normalizeSubstance,
  isOncologyATC,
  fetchAUEList,
  fetchAUEBenefitList,
  fetchPAPList,
  scrapeINFOMED,
  searchINFOMED,
  fetchTransparenciaSNS
};
