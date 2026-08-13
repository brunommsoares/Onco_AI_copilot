import { GRADE_ASSESSMENT_PROMPT, GRADE_CONTEXT_TEMPLATE } from './gradePrompts.js';

// ---------------------------------------------------------------------------
// GRADE Assessment Agent
//
// LLM-based agent that takes evidence already extracted by
// EndpointClaimAgent and PublicationExtractionAgent and maps it to the
// formal GRADE framework (certainty of evidence assessment).
//
// Called from simpleChatService.runGradeAssessment after evidence retrieval and
// before response generation, on both the streaming and non-streaming paths.
// Produces structured output + a context string (contextSummary) that is passed
// to buildGenerateResponsePrompts via options.gradeContext, so the certainty
// rating is an input to the synthesis rather than an annotation on it.
// ---------------------------------------------------------------------------

const GRADE_MODEL =
  process.env.BEDROCK_GRADE_MODEL_ID ||
  process.env.BEDROCK_INFARMED_MODEL_ID ||
  process.env.BEDROCK_FALLBACK_MODEL_ID ||
  'us.anthropic.claude-haiku-4-5-20251001-v1:0';

class GradeAssessmentAgent {
  constructor(dependencies = {}) {
    this.openai = dependencies.openai;
    this.logger = dependencies.logger || console;
    this.model = dependencies.model || GRADE_MODEL;
  }

  /**
   * Assess the certainty of evidence for a clinical question using GRADE.
   *
   * @param {string} question - The clinical question
   * @param {Object[]} articles - The evidence articles (from PubMed search)
   * @param {Object[]} evidenceSummaries - Extracted evidence summaries
   * @param {Object} options - Additional options (population, intervention, etc.)
   * @returns {Object} GRADE assessment with certainty, domains, summary
   */
  async assess(question, articles = [], evidenceSummaries = [], options = {}) {
    if (!articles.length && !evidenceSummaries.length) {
      return this._emptyAssessment('No evidence available for GRADE assessment');
    }

    try {
      // Build a compact evidence summary for the LLM
      const evidenceContext = this._buildEvidenceContext(articles, evidenceSummaries);

      const userMessage = [
        `Assess the certainty of evidence using GRADE methodology for this clinical question:`,
        ``,
        `Question: ${question}`,
        options.population ? `Population: ${options.population}` : '',
        options.intervention ? `Intervention: ${options.intervention}` : '',
        options.comparator ? `Comparator: ${options.comparator}` : '',
        ``,
        `Number of studies: ${articles.length}`,
        ``,
        `--- EVIDENCE SUMMARIES ---`,
        evidenceContext,
      ].filter(Boolean).join('\n');

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: GRADE_ASSESSMENT_PROMPT },
          { role: 'user', content: userMessage }
        ],
        max_tokens: 2000,
        temperature: 0.1
      });

      const content = response.choices?.[0]?.message?.content || '';

      // Parse JSON response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.warn('[GRADE] Could not parse LLM response as JSON');
        return this._emptyAssessment('Failed to parse GRADE assessment');
      }

      const assessment = JSON.parse(jsonMatch[0]);

      // Validate and normalize
      const normalized = this._normalizeAssessment(assessment);

      // Generate context summary for prompt injection
      normalized.contextSummary = GRADE_CONTEXT_TEMPLATE(normalized);

      this.logger.info(
        `[GRADE] Assessment: ${normalized.certainty_of_evidence} (${articles.length} studies, direction: ${normalized.direction_of_effect})`
      );

      return normalized;
    } catch (err) {
      this.logger.warn(`[GRADE] Assessment failed: ${err.message}`);
      return this._emptyAssessment(`Assessment error: ${err.message}`);
    }
  }

  /**
   * Build a compact evidence context string from articles and summaries.
   */
  _buildEvidenceContext(articles, evidenceSummaries) {
    const lines = [];
    const summaryMap = new Map();

    // Index summaries by article index
    for (const s of evidenceSummaries) {
      if (Number.isFinite(s?.index)) {
        summaryMap.set(s.index, s);
      }
    }

    for (let i = 0; i < Math.min(articles.length, 10); i++) {
      const article = articles[i];
      const summary = summaryMap.get(i + 1);

      lines.push(`Study ${i + 1}:`);
      lines.push(`  Title: ${(article.title || '').slice(0, 200)}`);
      lines.push(`  Year: ${article.year || article.date || 'unknown'}`);
      lines.push(`  Journal: ${article.journal || article.source || 'unknown'}`);

      if (summary) {
        if (summary.study_design) lines.push(`  Study design: ${summary.study_design}`);
        if (summary.analysis_type) lines.push(`  Analysis type: ${summary.analysis_type}`);
        if (summary.evidence_strength) lines.push(`  Evidence strength: ${summary.evidence_strength}`);
        if (summary.population_size) lines.push(`  Population: ${summary.population_size}`);
        if (summary.comparator) lines.push(`  Comparator: ${summary.comparator}`);

        // Endpoint claims
        if (Array.isArray(summary.endpoint_claims)) {
          for (const claim of summary.endpoint_claims) {
            const ep = claim.endpoint || '';
            const dir = claim.direction || '';
            const effect = claim.effect_size_text || '';
            lines.push(`  Endpoint: ${ep} — ${dir} ${effect}`);
          }
        }

        if (summary.limitations) lines.push(`  Limitations: ${summary.limitations}`);
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Normalize and validate the GRADE assessment output.
   */
  _normalizeAssessment(raw) {
    const validCertainty = ['high', 'moderate', 'low', 'very_low'];
    const validRating = ['no_serious', 'serious', 'very_serious'];

    const certainty = validCertainty.includes(raw.certainty_of_evidence)
      ? raw.certainty_of_evidence
      : 'low';

    const normalizeDomain = (domain) => {
      if (!domain) return { rating: 'no_serious', downgrade: 0, rationale: '' };
      return {
        rating: validRating.includes(domain.rating) ? domain.rating : 'no_serious',
        downgrade: typeof domain.downgrade === 'number' ? Math.max(-2, Math.min(0, domain.downgrade)) : 0,
        rationale: String(domain.rationale || '')
      };
    };

    return {
      certainty_of_evidence: certainty,
      starting_level: raw.starting_level === 'high' || raw.starting_level === 'low' ? raw.starting_level : 'high',
      starting_rationale: String(raw.starting_rationale || ''),
      domains: {
        risk_of_bias: normalizeDomain(raw.domains?.risk_of_bias),
        inconsistency: normalizeDomain(raw.domains?.inconsistency),
        indirectness: normalizeDomain(raw.domains?.indirectness),
        imprecision: normalizeDomain(raw.domains?.imprecision),
        publication_bias: {
          rating: raw.domains?.publication_bias?.rating === 'strongly_suspected' ? 'strongly_suspected' : 'undetected',
          downgrade: raw.domains?.publication_bias?.downgrade === -1 ? -1 : 0,
          rationale: String(raw.domains?.publication_bias?.rationale || '')
        }
      },
      upgrading_factors: {
        large_effect: Boolean(raw.upgrading_factors?.large_effect),
        dose_response: Boolean(raw.upgrading_factors?.dose_response),
        plausible_confounding: Boolean(raw.upgrading_factors?.plausible_confounding),
        upgrade: typeof raw.upgrading_factors?.upgrade === 'number' ? Math.max(0, Math.min(2, raw.upgrading_factors.upgrade)) : 0
      },
      summary: String(raw.summary || ''),
      direction_of_effect: ['favours_intervention', 'favours_comparator', 'no_difference', 'unclear'].includes(raw.direction_of_effect)
        ? raw.direction_of_effect
        : 'unclear',
      contextSummary: ''
    };
  }

  _emptyAssessment(reason = '') {
    return {
      certainty_of_evidence: null,
      available: false,
      reason,
      domains: null,
      upgrading_factors: null,
      summary: reason,
      direction_of_effect: 'unclear',
      contextSummary: ''
    };
  }
}

export default GradeAssessmentAgent;
export { GradeAssessmentAgent };
