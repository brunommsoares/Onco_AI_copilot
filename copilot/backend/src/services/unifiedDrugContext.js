// ---------------------------------------------------------------------------
// Unified Drug Context Builder
//
// Cross-references INFARMED, EMA, and ESMO data by active substance to
// produce a single coherent context block for the LLM — instead of three
// disconnected blobs. Also integrates top relevant clinical trials.
//
// Output: a structured text block that replaces the separate
// reimbursementContext, emaContext, and esmoContext injections.
// ---------------------------------------------------------------------------

import { normalizeSubstance } from '../../infarmedScraper.js';

/**
 * Builds a unified, cross-referenced context block from all regulatory sources
 * and top matching trials. Produces "drug cards" that consolidate all info
 * per substance, reducing redundancy and improving LLM synthesis coherence.
 *
 * @param {object} params
 * @param {object} params.reimbursement - findReimbursementData() result
 * @param {object} params.ema - findEmaData() result
 * @param {object} params.esmo - findRecommendations() result
 * @param {object[]} params.trials - top matched trials (already ranked/filtered)
 * @param {object} params.searchTerms - { substance, cancerType, biomarker, lineOfTherapy, stage }
 * @returns {{ unifiedContext: string, drugCards: object[], trialContext: string }}
 */
export function buildUnifiedDrugContext({
  reimbursement = {},
  ema = {},
  esmo = {},
  trials = [],
  searchTerms = {}
} = {}) {
  // Step 1: Build drug card map by normalized substance
  const drugCards = new Map();

  const getOrCreateCard = (substance) => {
    const key = normalizeSubstance(substance);
    if (!key) return null;
    if (!drugCards.has(key)) {
      drugCards.set(key, {
        substance: substance,
        substanceNormalized: key,
        tradeNames: new Set(),
        ema: null,
        infarmed: null,
        esmo: [],
        trials: [],
        sources: new Set()
      });
    }
    return drugCards.get(key);
  };

  // Step 2: Populate from INFARMED
  if (reimbursement.available && reimbursement.drugs?.length) {
    for (const drug of reimbursement.drugs) {
      const card = getOrCreateCard(drug.activeSubstance);
      if (!card) continue;
      card.sources.add('INFARMED');
      (drug.tradeNames || []).forEach((n) => card.tradeNames.add(n));
      card.infarmed = {
        reimbursementType: drug.reimbursementType || '',
        reimbursementStatus: drug.reimbursementStatus || '',
        aimStatus: drug.aimStatus || '',
        clinicalBenefit: drug.clinicalBenefit || '',
        snsCovered: drug.snsCovered || false,
        papStatus: drug.papStatus || '',
        papIndication: drug.papIndication || '',
        papStartDate: drug.papStartDate || '',
        indications: (drug.indications || []).map((ind) => ({
          cancerType: ind.cancerType || '',
          cancerSubtype: ind.cancerSubtype || '',
          biomarker: ind.biomarker || '',
          lineOfTherapy: ind.lineOfTherapy || '',
          stage: ind.stage || '',
          reimbursementStatus: ind.reimbursementStatus || '',
          confidence: ind.confidence || ''
        }))
      };
    }
  }

  // Step 3: Populate from EMA
  if (ema.available && ema.products?.length) {
    for (const product of ema.products) {
      const substance = product.activeSubstance || product.active_substance || '';
      const card = getOrCreateCard(substance);
      if (!card) continue;
      card.sources.add('EMA');
      if (product.medicineName) card.tradeNames.add(product.medicineName);
      card.ema = {
        authorizationStatus: product.authorizationStatus || product.authorization_status || '',
        approvalDate: product.approvalDate || product.approval_date || '',
        therapeuticArea: product.therapeuticArea || product.therapeutic_area || '',
        orphanMedicine: product.orphanMedicine || false,
        conditionIndication: product.conditionIndication || product.condition_indication || '',
        indications: (product.indications || []).map((ind) => ({
          cancerType: ind.cancerType || ind.cancer_type || '',
          biomarker: ind.biomarker || '',
          lineOfTherapy: ind.lineOfTherapy || ind.line_of_therapy || '',
          stage: ind.stage || '',
          approvalDate: ind.approvalDate || ind.approval_date || ''
        }))
      };
    }
  }

  // Step 4: Populate from the guideline corpus (ESMO and NCCN documents;
  // each recommendation carries the publisher that actually issued it)
  if (esmo.available && esmo.recommendations?.length) {
    for (const rec of esmo.recommendations) {
      const substance = rec.drug || rec.drugName || '';
      if (!substance) continue;
      const card = getOrCreateCard(substance);
      if (!card) continue;
      const publisher = rec.publisher || 'Guideline';
      card.sources.add(publisher);
      card.esmo.push({
        publisher: rec.publisher || '',
        cancerType: rec.cancerType || rec.cancer_type || '',
        biomarker: rec.biomarker || '',
        lineOfTherapy: rec.lineOfTherapy || rec.line_of_therapy || '',
        levelOfEvidence: rec.levelOfEvidence || rec.level_of_evidence || '',
        gradeOfRecommendation: rec.gradeOfRecommendation || rec.grade_of_recommendation || '',
        esmoMcbs: rec.esmoMcbsScore || rec.esmo_mcbs_score || '',
        recommendationText: rec.recommendationText || rec.recommendation_text || '',
        guidelineTitle: rec.guidelineTitle || rec.guideline_title || ''
      });
    }
  }

  // Step 5: Attach relevant trials to drug cards
  for (const trial of trials) {
    const trialText = `${trial.title} ${trial.officialTitle || ''} ${(trial.interventions || []).map((i) => i.name || i).join(' ')}`.toLowerCase();
    for (const [key, card] of drugCards) {
      if (trialText.includes(key) || trialText.includes(card.substance.toLowerCase())) {
        card.trials.push(trial);
        card.sources.add('ClinicalTrials');
      }
    }
  }

  // Step 6: Score and sort cards by relevance to query
  const querySubstance = normalizeSubstance(searchTerms.substance || '');
  const queryCancer = (searchTerms.cancerType || '').toLowerCase();
  const queryBiomarker = (searchTerms.biomarker || '').toLowerCase();

  const scoredCards = [...drugCards.values()].map((card) => {
    let score = 0;
    if (querySubstance && card.substanceNormalized === querySubstance) score += 10;
    if (querySubstance && card.substanceNormalized.includes(querySubstance)) score += 5;
    if (card.infarmed) score += 2;
    if (card.ema) score += 1;
    if (card.esmo.length) score += 1;
    if (card.infarmed?.papStatus) score += 3; // PAP drugs are high priority
    if (card.trials.length) score += 1;

    // Boost if indications match query cancer/biomarker
    const allIndications = [
      ...(card.infarmed?.indications || []),
      ...(card.ema?.indications || []),
      ...card.esmo
    ];
    for (const ind of allIndications) {
      const indCancer = (ind.cancerType || '').toLowerCase();
      const indBio = (ind.biomarker || '').toLowerCase();
      if (queryCancer && indCancer.includes(queryCancer)) score += 2;
      if (queryBiomarker && indBio.includes(queryBiomarker)) score += 2;
    }

    return { ...card, tradeNames: [...card.tradeNames], sources: [...card.sources], score };
  });

  scoredCards.sort((a, b) => b.score - a.score);

  // Step 7: Build unified context text — top 10 drug cards
  const lines = ['=== UNIFIED REGULATORY & ACCESS DATA (cross-referenced from INFARMED, EMA and the guideline corpus [ESMO/NCCN]) ==='];
  if (searchTerms.substance || searchTerms.cancerType) {
    lines.push(`Query: substance="${searchTerms.substance || ''}" cancer="${searchTerms.cancerType || ''}" biomarker="${searchTerms.biomarker || ''}" line="${searchTerms.lineOfTherapy || ''}"`);
  }
  lines.push('');

  const topCards = scoredCards.slice(0, 10);

  if (!topCards.length) {
    lines.push('No regulatory data found for this query across INFARMED, EMA, or the guideline corpus.');
    lines.push('Do not make claims about European regulatory or Portuguese reimbursement status.');
  }

  for (const card of topCards) {
    lines.push(`── DRUG CARD: ${card.substance} (${card.tradeNames.join(', ') || 'N/A'}) ──`);
    lines.push(`  Sources: ${card.sources.join(' + ')}`);

    // EMA status
    if (card.ema) {
      lines.push(`  EMA: ${card.ema.authorizationStatus}${card.ema.approvalDate ? ` (${card.ema.approvalDate})` : ''}`);
      if (card.ema.conditionIndication) {
        lines.push(`    Authorised indication: ${card.ema.conditionIndication.slice(0, 300)}`);
      }
      if (card.ema.indications?.length) {
        for (const ind of card.ema.indications.slice(0, 5)) {
          const parts = [ind.cancerType, ind.biomarker, ind.lineOfTherapy, ind.stage].filter(Boolean);
          lines.push(`    • EMA: ${parts.join(' | ')}${ind.approvalDate ? ` (${ind.approvalDate})` : ''}`);
        }
      }
    } else {
      lines.push('  EMA: No matching EMA authorisation found');
    }

    // INFARMED status
    if (card.infarmed) {
      const hasPAP = !!card.infarmed.papStatus;
      // Cross-reference: if EMA confirms authorisation but INFARMED says "AUE",
      // AUE is wrong — AUE is ONLY for drugs without EMA marketing authorisation.
      // Correct in real-time before injecting into the LLM prompt.
      let correctedReimbType = card.infarmed.reimbursementType || 'unknown';
      const hasEmaAuth = card.ema && card.ema.authorizationStatus &&
        !card.ema.authorizationStatus.toLowerCase().includes('withdrawn') &&
        !card.ema.authorizationStatus.toLowerCase().includes('refused');
      if (correctedReimbType === 'AUE' && hasEmaAuth) {
        // Drug has EMA authorisation — cannot be AUE
        if (hasPAP) {
          correctedReimbType = 'PAP';
        } else if (card.infarmed.snsCovered) {
          correctedReimbType = 'AIM+SNS';
        } else {
          correctedReimbType = 'AIM';
        }
      }

      if (hasPAP) {
        lines.push(`  ⚠ INFARMED PAP (Programa de Acesso Precoce): ${card.infarmed.papStatus}`);
        if (card.infarmed.papIndication) lines.push(`    PAP indication: ${card.infarmed.papIndication}`);
        lines.push(`    → Drug accessible in Portuguese SNS hospitals via early access program`);
      }
      if (card.infarmed.snsCovered) {
        lines.push(`  ✓ INFARMED: Drug is FUNDED/REIMBURSED under Portuguese SNS (comparticipado)`);
      }
      lines.push(`  INFARMED: ${correctedReimbType} — ${card.infarmed.reimbursementStatus || 'unknown'}`);
      lines.push(`    AIM: ${card.infarmed.aimStatus || 'unknown'} | SNS: ${card.infarmed.snsCovered ? 'Yes — funded' : 'Check with institution'} | Benefit: ${card.infarmed.clinicalBenefit || 'not assessed'}`);
      if (card.infarmed.indications?.length) {
        const queriedLine = (searchTerms.lineOfTherapy || '').toUpperCase();
        for (const ind of card.infarmed.indications.slice(0, 5)) {
          const parts = [ind.cancerType, ind.cancerSubtype, ind.biomarker && `[${ind.biomarker}]`, ind.lineOfTherapy && `(${ind.lineOfTherapy})`, ind.stage && `— ${ind.stage}`].filter(Boolean);
          const lineUpper = (ind.lineOfTherapy || '').toUpperCase();
          let lineNote = '';
          if (queriedLine && lineUpper && !lineUpper.includes(queriedLine) && !queriedLine.includes(lineUpper)) {
            lineNote = ` ⚠ NOTE: approved for ${ind.lineOfTherapy}, not ${queriedLine}`;
          }
          lines.push(`    • INFARMED: ${parts.join(' ')} → ${ind.reimbursementStatus || 'unknown'} [${ind.confidence || 'medium'}]${lineNote}`);
        }
      }
    } else {
      lines.push('  INFARMED: No Portuguese reimbursement data found — confirm with INFARMED/hospital pharmacy');
    }

    // Guideline recommendations (attributed to the issuing body: ESMO or NCCN)
    if (card.esmo.length) {
      for (const rec of card.esmo.slice(0, 3)) {
        const scores = [
          rec.levelOfEvidence && `LOE ${rec.levelOfEvidence}`,
          rec.gradeOfRecommendation && `GOR ${rec.gradeOfRecommendation}`,
          rec.esmoMcbs && `MCBS ${rec.esmoMcbs}`
        ].filter(Boolean).join(', ');
        const context = [rec.cancerType, rec.biomarker, rec.lineOfTherapy].filter(Boolean).join(' | ');
        lines.push(`    • ${rec.publisher || 'Guideline'} CPG: ${context}${scores ? ` [${scores}]` : ''}`);
        if (rec.recommendationText) lines.push(`      "${rec.recommendationText.slice(0, 200)}"`);
        if (rec.guidelineTitle) lines.push(`      Source: ${rec.publisher ? `${rec.publisher} — ` : ''}${rec.guidelineTitle}`);
      }
    }

    // Relevant trials in Portugal
    if (card.trials.length) {
      lines.push(`  Clinical trials recruiting in Portugal:`);
      for (const trial of card.trials.slice(0, 3)) {
        const phase = (trial.phases || []).join('/') || 'N/A';
        const sites = (trial.portugueseRecruitingSites || trial.recruitingLocations || [])
          .map((s) => s.facility || s).filter(Boolean).slice(0, 2).join(', ');
        lines.push(`    • ${trial.nctId} — Phase ${phase}: ${(trial.title || '').slice(0, 120)}`);
        if (sites) lines.push(`      PT sites: ${sites}`);
        if (trial.llmReason) lines.push(`      Relevance: ${trial.llmReason}`);
      }
    }

    lines.push('');
  }

  // Step 8: Build separate trial context for non-drug-specific trials
  const drugTrialIds = new Set();
  for (const card of topCards) {
    for (const t of card.trials) drugTrialIds.add(t.nctId);
  }

  const orphanTrials = trials.filter((t) => !drugTrialIds.has(t.nctId));
  const trialLines = [];

  if (orphanTrials.length) {
    trialLines.push('=== ADDITIONAL CLINICAL TRIALS RECRUITING IN PORTUGAL ===');
    trialLines.push('These trials are relevant to the clinical question but not specific to the drugs above.');
    trialLines.push('');
    for (const trial of orphanTrials.slice(0, 5)) {
      const phase = (trial.phases || []).join('/') || 'N/A';
      const interventionSummary = trial.interventionSummary ||
        (trial.interventions || []).map((i) => i.name || i).slice(0, 3).join(' + ') || 'N/A';
      const stage = trial.diseaseStage || 'unspecified';
      const sites = (trial.portugueseRecruitingSites || trial.recruitingLocations || [])
        .map((s) => s.facility || s).filter(Boolean).slice(0, 2).join(', ');
      trialLines.push(`• ${trial.nctId} — Phase ${phase} | ${stage}`);
      trialLines.push(`  Title: ${(trial.title || '').slice(0, 150)}`);
      trialLines.push(`  Intervention: ${interventionSummary}`);
      if (sites) trialLines.push(`  PT sites: ${sites}`);
      if (trial.llmRelevance) trialLines.push(`  Relevance: ${trial.llmRelevance}${trial.llmReason ? ` — ${trial.llmReason}` : ''}`);
      trialLines.push('');
    }
  }

  // Step 9: Instructions for the LLM
  lines.push('=== INSTRUCTIONS FOR USING THIS DATA ===');
  lines.push('1. Use ONLY this verified data for regulatory/reimbursement claims. Do not guess or infer from general knowledge.');
  lines.push('2. When mentioning a drug, cross-reference all available sources (EMA + INFARMED + guidelines) in a coherent statement, attributing each guideline recommendation to its stated issuing body (ESMO or NCCN).');
  lines.push('3. If a drug has PAP status, mention it PROMINENTLY — it means early access is available in Portugal via Programa de Acesso Precoce.');
  lines.push('4. If the approved line of therapy differs from the question, state the ACTUAL approved line clearly.');
  lines.push('5. If INFARMED lists MULTIPLE drugs for the queried indication, mention ALL of them.');
  lines.push('6. If clinical trials are listed, mention them as actionable options for the patient/clinician.');
  lines.push('7. EMA approval ≠ Portuguese reimbursement. Always clarify the distinction.');
  lines.push('8. NEVER use the term "AUE" (Autorização de Utilização Especial) for a drug that has EMA marketing authorisation — AUE is ONLY for drugs WITHOUT EMA approval (e.g., compassionate use of FDA-only drugs). EMA-approved drugs pending Portuguese reimbursement use PAP, not AUE. If unsure, say "a disponibilidade deve ser confirmada com o INFARMED ou a farmácia hospitalar".');

  const unifiedContext = lines.join('\n');
  const trialContext = trialLines.join('\n');

  return {
    unifiedContext,
    trialContext,
    drugCards: topCards
  };
}
