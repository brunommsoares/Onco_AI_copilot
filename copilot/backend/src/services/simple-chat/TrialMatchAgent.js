class TrialMatchAgent {
  buildMatchPrompt(question, clinicalContext, trials) {
    const trialList = trials.map((trial, i) => {
      const conditions = (trial.conditions || []).join(', ');
      const interventions = (trial.interventions || [])
        .map((iv) => iv.name).filter(Boolean).join(' + ');
      const inclusion = (trial.inclusionCriteria || []).slice(0, 5).join('; ');
      const exclusion = (trial.exclusionCriteria || []).slice(0, 5).join('; ');
      const armsText = (trial.arms || [])
        .map((arm) => [arm.label, arm.type, arm.description].filter(Boolean).join(' — '))
        .filter(Boolean)
        .slice(0, 4)
        .join(' | ');
      // Include Portuguese recruiting sites so the LLM can assess accessibility
      const ptSites = (trial.locations || [])
        .filter((loc) => /portugal/i.test(loc.country || '') && /recruiting/i.test(loc.status || ''))
        .map((loc) => loc.facility)
        .filter(Boolean)
        .slice(0, 5);
      const siteLine = ptSites.length > 0 ? `PT sites: ${ptSites.join('; ')}` : 'PT sites: None listed';
      return `[${i + 1}] NCT: ${trial.nctId}
Title: ${trial.title}
Conditions: ${conditions}
Phase: ${(trial.phases || []).join(', ')}
Stage: ${trial.diseaseStage || 'unspecified'}
Interventions: ${interventions || 'Not specified'}
Arms: ${armsText || 'Not specified'}
Key inclusion: ${inclusion || trial.eligibilitySummary || 'Not specified'}
Key exclusion: ${exclusion || 'Not specified'}
${siteLine}
Summary: ${(trial.briefSummary || '').slice(0, 400)}`;
    });

    const contextLines = [];
    if (clinicalContext.population) contextLines.push(`Population: ${clinicalContext.population}`);
    if (clinicalContext.biomarker) contextLines.push(`Biomarker: ${clinicalContext.biomarker}`);
    if (clinicalContext.intervention) contextLines.push(`Intervention of interest: ${clinicalContext.intervention}`);
    if (clinicalContext.lineOfTherapy) contextLines.push(`Line of therapy: ${clinicalContext.lineOfTherapy}`);

    return `You are a senior oncologist and clinical trial specialist practising in Europe (Portugal). Given a clinical question and candidate recruiting trials, determine how relevant each trial is for a patient matching the clinical question. Consider European standard-of-care (ESMO guidelines) and EMA-approved therapies when assessing relevance.

CLINICAL QUESTION:
${question}
${contextLines.length > 0 ? '\nCLINICAL CONTEXT:\n' + contextLines.join('\n') : ''}

CANDIDATE TRIALS:
${trialList.join('\n\n')}

For each trial, return a JSON array with one object per trial:
- index (integer, 1-based)
- nctId (string)
- relevance: "high", "moderate", "low", or "none"
- score (number 0-10, where 10 = perfect match)
- reason (1-2 concise sentences explaining the match or mismatch — name the specific cancer type, biomarker, drug, or eligibility criterion that matches or conflicts)
- interventionDescription (string, 1-2 sentences: describe the experimental arm(s) vs comparator/control in plain clinical language. Name the drugs, doses if available, and what each arm receives. E.g. "Experimental: pembrolizumab 200mg Q3W + chemotherapy vs Control: placebo + chemotherapy")
- summary (string, 2-3 sentences: a concise clinical summary of what the trial studies, its design, and target population. Do NOT include eligibility criteria. Focus on the hypothesis, design, and clinical relevance)
- matchedCondition (the primary condition from the trial that matches the question, or null)
- matchedStage (disease stage: "metastatic", "locally advanced", "localized", or null)

Scoring rules:
- "high" (7-10): trial targets the exact cancer type, biomarker, disease stage, and line of therapy in the question. Drug class or mechanism matches.
- "moderate" (4-6): trial targets the right cancer type but broader population, adjacent biomarker, or nearby line of therapy. Could be relevant.
- "low" (1-3): related cancer type or mechanism but significant mismatch in key eligibility criteria.
- "none" (0): clearly different cancer type, unrelated condition, or explicitly excludes the patient population in the question.
- CANCER TYPE GATE (CRITICAL): If the trial targets a fundamentally different primary cancer type from the question (e.g., prostate cancer trial for a lung cancer query, or breast cancer trial for a colorectal query), always score "none" (0) — even if they share drugs, biomarkers, or treatment modalities. Shared drugs like pembrolizumab, docetaxel, or carboplatin do NOT make a trial relevant to a different tumour type.
- EXCLUSION CRITERIA CHECK (CRITICAL): Carefully read the Key exclusion field. If the exclusion criteria explicitly rule out the patient described in the question (e.g., prior therapy the patient had, a biomarker the patient has, a disease stage, or an age range), downgrade to "low" or "none" regardless of how well other fields match. A trial that excludes EGFR+ patients is "none" for an EGFR+ query.
- Phase III in the exact population > Phase I/II in a broader population, but relevance to the specific clinical question matters more than phase alone.
- Biomarker-specific trials (e.g., EGFR+, BRCA1/2, MSI-H, HER2+) must match the biomarker in the question or context.
- If the question specifies a drug, trials with that drug or the same drug class score highest.
- Drug synonyms count (e.g., pembrolizumab = anti-PD-1 = checkpoint inhibitor = MK-3475).
- Return ONLY the JSON array, no markdown, no other text.`;
  }

  normalizeResults(parsed, trialIds) {
    if (!Array.isArray(parsed)) return [];
    const idSet = new Set(trialIds);
    return parsed
      .filter((item) => item && idSet.has(item.nctId))
      .map((item) => ({
        nctId: item.nctId,
        relevance: ['high', 'moderate', 'low', 'none'].includes(item.relevance)
          ? item.relevance
          : 'low',
        score: typeof item.score === 'number' ? Math.min(10, Math.max(0, item.score)) : 0,
        reason: typeof item.reason === 'string' ? item.reason.slice(0, 400) : '',
        interventionDescription: typeof item.interventionDescription === 'string' ? item.interventionDescription.slice(0, 500) : '',
        summary: typeof item.summary === 'string' ? item.summary.slice(0, 500) : '',
        matchedCondition: item.matchedCondition || null,
        matchedStage: item.matchedStage || null
      }));
  }
}

export default TrialMatchAgent;
