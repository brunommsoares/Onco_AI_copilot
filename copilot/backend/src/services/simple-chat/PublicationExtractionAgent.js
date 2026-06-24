class PublicationExtractionAgent {
  buildExtractionPrompt(items = []) {
    return `You are extracting structured oncology evidence from PubMed abstracts.
Return ONLY valid JSON as an array with one object per article.

Each object must contain:
- index
- pmid
- study_design
- analysis_type
- population
- intervention
- comparator
- outcomes
- key_findings
- effect_direction
- limitations
- evidence_strength
- endpoint_claims

Rules:
- Use null when a field is not available.
- evidence_strength must be one of: "high", "moderate", "low".
- analysis_type must be one of: "primary_efficacy", "os_update", "secondary_endpoint", "qol", "exploratory", "biomarker", "synthesis", "other".
- key_findings must stay concise (1-3 sentences).
- Do not imply treatment superiority from biomarker, quality-of-life, subgroup, or exploratory papers unless a direct regimen comparison is explicitly reported.
- Correlative/translational/on-treatment biopsy/ctDNA/residual cancer burden papers should usually be labeled "biomarker" or "exploratory", not "primary_efficacy", even if they come from a randomized parent trial.
- Systematic reviews and meta-analyses are not direct head-to-head trial reports; their endpoint_claims should use "indirect" or "supportive" support_level, not "direct".
- If the title focuses on biomarkers, biopsies, ctDNA, residual cancer burden, quality of life, or exploratory subsets, do not fill unrelated efficacy endpoint_claims unless that specific analysis explicitly reports them.
- endpoint_claims must be an array. Each claim object must contain:
  endpoint, direction, maturity, support_level, effect_size_text, population_scope
- endpoint must be one of: "OS", "EFS/DFS/PFS", "pCR", "ORR", "G3-4 AEs".
- direction must be one of: "positive", "neutral", "negative", "unclear".
- maturity must be one of: "reported", "immature", "unclear".
- support_level must be one of: "direct", "indirect", "supportive".
- population_scope must be one of: "overall", "subset", "unclear".

Articles:
${items.map(item => `\n[${item.index}] PMID: ${item.pmid}
Title: ${item.title}
Journal/Year: ${item.journal || 'available source'}, ${item.year || 'available source'}
Abstract: ${item.abstract || 'available source'}`).join('\n')}`;
  }

  normalizeExtractionResults(parsed = []) {
    if (!Array.isArray(parsed)) return [];
    return parsed.map(item => ({
      index: item?.index,
      pmid: item?.pmid || null,
      study_design: item?.study_design || null,
      analysis_type: item?.analysis_type || null,
      population: item?.population || null,
      intervention: item?.intervention || null,
      comparator: item?.comparator || null,
      outcomes: item?.outcomes || null,
      key_findings: item?.key_findings || null,
      effect_direction: item?.effect_direction || null,
      limitations: item?.limitations || null,
      evidence_strength: item?.evidence_strength || null,
      endpoint_claims: Array.isArray(item?.endpoint_claims) ? item.endpoint_claims : []
    }));
  }
}

export default PublicationExtractionAgent;
