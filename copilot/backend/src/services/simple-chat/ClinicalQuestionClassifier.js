/**
 * ClinicalQuestionClassifier
 *
 * Deterministic classifier that distinguishes clinical question types:
 * - 'treatment_efficacy'  → drug/regimen outcomes (OS, PFS, response rates)
 * - 'supportive_care'     → toxicity management, prophylaxis, supportive measures
 * - 'regulatory'          → drug access, reimbursement, approval status
 *
 * The classification drives downstream behavior: search strategy, prompt template,
 * and evidence adequacy thresholds.
 */
class ClinicalQuestionClassifier {
  constructor() {
    // Supportive care patterns — prophylaxis, toxicity, symptom management
    this.supportiveCarePatterns = [
      // Prophylaxis / prevention
      /\bprofilaxia\b/i,
      /\bprophylax/i,
      /\bpreven(?:ção|tion|tive|ir)\b/i,
      /\bpre[-\s]?medica(?:ção|tion)\b/i,

      // G-CSF / colony-stimulating factors
      /\bG-?CSF\b/i,
      /\bfilgrastim\b/i,
      /\bpegfilgrastim\b/i,
      /\blenograstim\b/i,
      /\blipegfilgrastim\b/i,
      /\bfat(?:or|ores)\s+estimulador/i,
      /\bcolony.stimulating\s+factor/i,
      /\bgranuloc(?:yte|ito)/i,

      // Neutropenia / febrile neutropenia
      /\bneutropenia\b/i,
      /\bneutrop[eé]ni(?:a|co)/i,
      /\bfebril\b/i,
      /\bfebrile\b/i,
      /\bmielossupres/i,
      /\bmyelosuppres/i,
      /\bleucop[eé]nia/i,
      /\bleucopenia\b/i,
      /\bleukopenia\b/i,

      // Antiemetic management
      /\banti[-\s]?em[eé]ti/i,
      /\bn[áa]usea/i,
      /\bnausea\b/i,
      /\bvomit/i,
      /\bv[óo]mito/i,
      /\bemesis\b/i,
      /\bemetog[eé]ni/i,
      /\bemetogenic/i,
      /\bondansetron\b/i,
      /\bgranisetron\b/i,
      /\bpalonosetron\b/i,
      /\baprepitant\b/i,
      /\bfosaprepitant\b/i,
      /\bnetupitant\b/i,
      /\bolanzapine\b/i,
      /\b5-?HT3\b/i,
      /\bNK-?1\b/i,

      // Diarrhea management
      /\bdiarr(?:eia|h[eo]ea|eia)\b/i,
      /\bloperamid/i,
      /\batropin/i,
      /\bs[íi]ndrome colin[eé]rgi/i,
      /\bcholinergic\s+syndrome/i,

      // Mucositis / stomatitis
      /\bmucosite\b/i,
      /\bmucositis\b/i,
      /\bestomatite\b/i,
      /\bstomatitis\b/i,

      // Hand-foot syndrome
      /\bm[ãa]o[-\s]?p[ée]\b/i,
      /\bhand[-\s]?foot/i,
      /\bpalmar[-\s]?plantar/i,
      /\beritrodisestesia/i,

      // Cardiotoxicity
      /\bcardiotoxic/i,
      /\bdexrazoxan/i,

      // Nephrotoxicity / hydration
      /\bnefrotoxic/i,
      /\bnephrotoxic/i,
      /\bhidrata[çc][ãa]o/i,
      /\bhydration\b/i,

      // Bone health / bisphosphonates
      /\bbis?fosfonat/i,
      /\bbisphosphonat/i,
      /\bdenosumab/i,
      /\b[áa]cido\s+zoledr[ôo]nico/i,
      /\bzoledronic\b/i,

      // Anemia / EPO
      /\banemia\b/i,
      /\beritropoetina\b/i,
      /\berythropoietin\b/i,
      /\bdarbepoetina\b/i,
      /\bdarbepoetin\b/i,

      // Pain / analgesics
      /\bdor\s+oncol[óo]gica/i,
      /\bcancer\s+pain\b/i,
      /\banalgesia\b/i,
      /\banalg[eé]si/i,
      /\bopi[óo]ide/i,
      /\bopioid\b/i,

      // Supportive care general terms
      /\bcuidados\s+de\s+suporte/i,
      /\bsupportive\s+care/i,
      /\btoxicidade/i,
      /\btoxicity\b/i,
      /\befeitos?\s+(?:advers|secund[áa]ri)/i,
      /\badverse\s+e(?:vent|ffect)/i,
      /\bside\s+effect/i,
      /\bgestão\s+(?:de\s+)?toxicidade/i,
      /\btoxicity\s+management/i,
      /\bredução\s+de\s+dose/i,
      /\bdose\s+reduction/i,
      /\batraso\s+(?:de\s+)?ciclo/i,
      /\bcycle\s+delay/i,
      /\bmanejo\b/i,
      /\bmanagement\b.*(?:toxicit|adverse|side\s+effect|complication)/i,

      // Extravasation
      /\bextravasa[çc][ãa]o/i,
      /\bextravasation\b/i,

      // Fertility preservation
      /\bfertilidade/i,
      /\bfertility\s+preserv/i,

      // Tumor lysis syndrome
      /\bl[íi]se\s+tumoral/i,
      /\btumor\s+lysis/i,

      // Infection management in oncology
      /\binfec[çc][ãa]o\b.*(?:neutropen|quimio|oncol)/i,
      /\binfection\b.*(?:neutropen|chemo|oncol)/i,
      /\bantibioticoterapia\s+emp[íi]rica/i,
      /\bempiric\s+antibiotic/i,

      // Thromboprophylaxis
      /\btromboprofilaxia/i,
      /\bthromboprophylax/i,
      /\btromboembolismo/i,
      /\bthromboembol/i,
      /\bTEV\b/,
      /\bVTE\b/
    ];

    // Regulatory patterns — drug access, reimbursement, approval
    this.regulatoryPatterns = [
      /\bcomparticipa/i,
      /\breimburs/i,
      /\bINFARMED\b/i,
      /\baprov(?:a[çc][ãa]o|ado|ed)\b/i,
      /\bapproval\b/i,
      /\bapproved\b/i,
      /\bEMA\b/,
      /\bFDA\b/,
      /\bautoriza[çc][ãa]o/i,
      /\bauthori[sz]ation/i,
      /\bSNS\b/,
      /\bformul[áa]rio/i,
      /\bformulary\b/i,
      /\bacesso\b.*(?:medicamento|f[áa]rmaco|droga|terap)/i,
      /\baccess\b.*(?:drug|therap|medic)/i,
      /\bPAP\b/,
      /\bAUE\b/,
      /\bprograma\s+de\s+acesso/i,
      /\bearly\s+access/i,
      /\bcompassionate\s+use/i,
      /\buso\s+compassivo/i,
      /\bdispon[íi]vel\b/i,
      /\bavailable\b.*(?:portugal|europe|market)/i,
      /\bcusto\b/i,
      /\bcost\b/i,
      /\bpre[çc]o\b/i,
      /\bprice\b/i
    ];

    // Treatment efficacy signals — these help disambiguate when both supportive
    // and treatment terms appear (e.g., "toxicity of pembrolizumab" is actually
    // about treatment, not supportive care per se)
    this.treatmentEfficacySignals = [
      /\boverall\s+survival\b/i,
      /\bprogression[-\s]?free/i,
      /\bsobreviv[êe]ncia\s+(?:global|livre)/i,
      /\bresponse\s+rate/i,
      /\btaxa\s+de\s+resposta/i,
      /\bpCR\b/,
      /\bremiss[ãa]o\s+completa/i,
      /\bcomplete\s+(?:response|remission|resection)/i,
      /\bfirst[-\s]?line\b/i,
      /\bsecond[-\s]?line\b/i,
      /\bprimeira\s+linha/i,
      /\bsegunda\s+linha/i,
      /\bterceira\s+linha/i,
      /\bneoadjuvan/i,
      /\badjuvan/i,
      /\bmonotherapy\b/i,
      /\bcombination\s+therapy/i,
      /\bHR\s*[=:]\s*\d/i,
      /\bmediana?\s+de\s+sobreviv/i,
      /\bmedian\s+(?:OS|PFS|DFS|EFS)\b/i
    ];
  }

  /**
   * Classify a clinical question.
   * Returns { type, confidence, signals }
   */
  classify(question = '', options = {}) {
    const text = this.buildClassificationText(question, options);

    const supportiveHits = this.countPatternHits(text, this.supportiveCarePatterns);
    const regulatoryHits = this.countPatternHits(text, this.regulatoryPatterns);
    const efficacyHits = this.countPatternHits(text, this.treatmentEfficacySignals);

    // Collect matched signal descriptions for debugging
    const signals = [];
    if (supportiveHits > 0) signals.push(`supportive_care:${supportiveHits}`);
    if (regulatoryHits > 0) signals.push(`regulatory:${regulatoryHits}`);
    if (efficacyHits > 0) signals.push(`treatment_efficacy:${efficacyHits}`);

    // Decision logic:
    // 1. If strong supportive care signals and no dominant efficacy signals → supportive_care
    // 2. If strong regulatory signals → regulatory
    // 3. Default → treatment_efficacy
    let type = 'treatment_efficacy';
    let confidence = 'low';

    if (supportiveHits >= 2 && supportiveHits > efficacyHits) {
      type = 'supportive_care';
      confidence = supportiveHits >= 4 ? 'high' : 'medium';
    } else if (supportiveHits === 1 && efficacyHits === 0) {
      type = 'supportive_care';
      confidence = 'medium';
    } else if (regulatoryHits >= 2 && regulatoryHits > efficacyHits && regulatoryHits >= supportiveHits) {
      type = 'regulatory';
      confidence = regulatoryHits >= 3 ? 'high' : 'medium';
    } else if (regulatoryHits === 1 && efficacyHits === 0 && supportiveHits === 0) {
      type = 'regulatory';
      confidence = 'low';
    } else if (efficacyHits >= 1) {
      type = 'treatment_efficacy';
      confidence = efficacyHits >= 2 ? 'high' : 'medium';
    }

    return { type, confidence, signals };
  }

  /**
   * Check if a question is about supportive care.
   */
  isSupportiveCare(question = '', options = {}) {
    const { type } = this.classify(question, options);
    return type === 'supportive_care';
  }

  /**
   * Build the text used for classification from question + structured options.
   */
  buildClassificationText(question = '', options = {}) {
    return [
      question,
      options.population,
      options.intervention,
      options.comparator,
      options.outcomes,
      options.biomarker,
      options.lineOfTherapy
    ].filter(Boolean).join(' ');
  }

  /**
   * Count how many distinct patterns match in the text.
   */
  countPatternHits(text = '', patterns = []) {
    return patterns.filter(pattern => pattern.test(text)).length;
  }
}

export default ClinicalQuestionClassifier;
