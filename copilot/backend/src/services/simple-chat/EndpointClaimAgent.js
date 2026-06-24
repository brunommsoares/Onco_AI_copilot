class EndpointClaimAgent {
  constructor(dependencies = {}) {
    this.sanitizeEvidenceField = dependencies.sanitizeEvidenceField;
    this.getEndpointLabel = dependencies.getEndpointLabel;
    this.inferComparatorLabel = dependencies.inferComparatorLabel;
    this.hasDirectComparativeSignals = dependencies.hasDirectComparativeSignals;
    this.inferEvidenceStrength = dependencies.inferEvidenceStrength;
    this.validateDependencies();
  }

  validateDependencies() {
    const required = [
      'sanitizeEvidenceField',
      'getEndpointLabel',
      'inferComparatorLabel',
      'hasDirectComparativeSignals',
      'inferEvidenceStrength'
    ];
    const missing = required.filter(name => typeof this[name] !== 'function');
    if (missing.length > 0) {
      throw new Error(`EndpointClaimAgent missing dependencies: ${missing.join(', ')}`);
    }
  }

  getEndpointPatterns(endpointKey = '') {
    return {
      os: /\boverall survival\b|\bos\b/,
      efs: /\bevent[- ]free survival\b|\befs\b|\bdisease[- ]free survival\b|\bdfs\b|\bprogression[- ]free survival\b|\bpfs\b/,
      pcr: /\bpathologic(?:al)? complete response\b|\bpcr\b/,
      orr: /\bobjective response rate\b|\borr\b/,
      grade34ae: /\bsafety\b|\btoxicity\b|\bgrade\s*3(?:\s*\/\s*4|[-â€“]4)?\b|g3[-â€“]?4/
    }[String(endpointKey || '').toLowerCase()] || null;
  }

  normalizeEndpointKey(value = '') {
    const source = String(value || '').toLowerCase();
    if (!source.trim()) return '';
    if (/\boverall survival\b|\bos\b/.test(source)) return 'os';
    if (/\bevent[- ]free survival\b|\befs\b|\bdisease[- ]free survival\b|\bdfs\b|\bprogression[- ]free survival\b|\bpfs\b/.test(source)) return 'efs';
    if (/\bpathologic(?:al)? complete response\b|\bpcr\b/.test(source)) return 'pcr';
    if (/\bobjective response rate\b|\borr\b/.test(source)) return 'orr';
    if (/\bg3[-â€“]?4\b|\bgrade\s*3(?:\s*\/\s*4|[-â€“]4)?\b|\badverse events?\b|\bsafety\b|\btoxicity\b/.test(source)) return 'grade34ae';
    return '';
  }

  getStructuredEndpointClaims(summary = null) {
    const claims = Array.isArray(summary?.endpoint_claims) ? summary.endpoint_claims : [];
    return claims
      .map((claim) => {
        const endpointKey = this.normalizeEndpointKey(claim?.endpoint || '');
        if (!endpointKey) return null;
        return {
          endpointKey,
          direction: String(claim?.direction || '').toLowerCase() || 'unclear',
          maturity: String(claim?.maturity || '').toLowerCase() || 'unclear',
          supportLevel: String(claim?.support_level || '').toLowerCase() || 'supportive',
          effectSizeText: this.sanitizeEvidenceField(claim?.effect_size_text || ''),
          populationScope: String(claim?.population_scope || '').toLowerCase() || 'unclear'
        };
      })
      .filter(Boolean);
  }

  getNormalizedAnalysisType(summary = null) {
    return String(summary?.analysis_type || '').trim().toLowerCase();
  }

  isSynthesisStudy(article = {}, summary = null) {
    const analysisType = this.getNormalizedAnalysisType(summary);
    if (analysisType === 'synthesis') return true;

    const text = `${summary?.study_design || ''} ${article?.studyDesign || ''} ${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();
    return /systematic review|meta-analysis|meta analysis|network meta-analysis/.test(text);
  }

  inferSupportLevel(article = {}, summary = null, extractedClaim = null) {
    const analysisType = this.getNormalizedAnalysisType(summary);
    const extractedLevel = String(extractedClaim?.supportLevel || '').toLowerCase();

    if (this.isSynthesisStudy(article, summary)) {
      return 'indirect';
    }

    if (['biomarker', 'qol', 'exploratory', 'secondary_endpoint'].includes(analysisType)) {
      return extractedLevel === 'indirect' ? 'indirect' : 'supportive';
    }

    if (extractedLevel === 'direct' && !this.hasDirectComparativeSignals(article, summary)) {
      return 'supportive';
    }
    if (['direct', 'indirect', 'supportive'].includes(extractedLevel)) {
      return extractedLevel;
    }

    return this.hasDirectComparativeSignals(article, summary) ? 'direct' : 'supportive';
  }

  splitIntoSentences(text = '') {
    return String(text || '')
      .replace(/\n+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map(item => item.trim())
      .filter(Boolean);
  }

  getEndpointMetricValue(article = {}, endpointKey = '') {
    const metrics = article?.endpointMetrics || {};
    const key = String(endpointKey || '').toLowerCase();
    if (key === 'efs') {
      return [metrics.efs, metrics.dfs, metrics.pfs].filter(Boolean).join(' / ');
    }
    return metrics?.[key] || '';
  }

  getEndpointDetectionSource(article = {}, summary = null) {
    const structuredSource = [
      summary?.outcomes,
      summary?.key_findings,
      summary?.limitations
    ]
      .filter(Boolean)
      .join(' ')
      .trim();

    if (structuredSource) {
      return structuredSource.toLowerCase();
    }

    return `${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();
  }

  collectEndpointKeysFromSource(article = {}, summary = null) {
    const metrics = article?.endpointMetrics || {};
    const source = this.getEndpointDetectionSource(article, summary);
    const keys = this.getStructuredEndpointClaims(summary).map(claim => claim.endpointKey);

    if (metrics.os || /\boverall survival\b/.test(source)) keys.push('os');
    if (metrics.efs || metrics.dfs || metrics.pfs || /\bevent[- ]free survival\b|\bdisease[- ]free survival\b|\bprogression[- ]free survival\b/.test(source)) {
      keys.push('efs');
    }
    if (metrics.pcr || /\bpathologic(?:al)? complete response\b|\bpcr\b/.test(source)) keys.push('pcr');
    if (metrics.orr || /\bobjective response rate\b|\borr\b/.test(source)) keys.push('orr');
    if (metrics.grade34ae || /\bgrade\s*3(?:\s*\/\s*4|[-â€“]4)?\b|g3[-â€“]?4/.test(source)) {
      keys.push('grade34ae');
    }

    return keys;
  }

  getStudyEndpointKeys(article = {}, summary = null) {
    const keys = this.collectEndpointKeysFromSource(article, summary);
    const sourceContexts = article?.endpointSourceContexts;

    if (sourceContexts && typeof sourceContexts === 'object') {
      for (const [endpointKey, context] of Object.entries(sourceContexts)) {
        const normalizedKey = this.normalizeEndpointKey(endpointKey);
        if (normalizedKey) {
          keys.push(normalizedKey);
        }
        keys.push(...this.collectEndpointKeysFromSource(context?.article || {}, context?.summary || null));
      }
    }

    return [...new Set(keys)];
  }

  getStudyEndpointLabels(article = {}, summary = null, language = 'en', filterKeys = []) {
    const studyKeys = this.getStudyEndpointKeys(article, summary);
    const selectedKeys = Array.isArray(filterKeys) && filterKeys.length > 0
      ? filterKeys.filter(key => studyKeys.includes(key))
      : studyKeys;

    return selectedKeys
      .map(key => this.getEndpointLabel(key, language))
      .filter(Boolean);
  }

  studyMatchesRequestedEndpoints(article = {}, summary = null, requestedEndpointKeys = []) {
    if (!Array.isArray(requestedEndpointKeys) || requestedEndpointKeys.length === 0) return true;
    const studyKeys = this.getStudyEndpointKeys(article, summary);
    return requestedEndpointKeys.some(key => studyKeys.includes(key));
  }

  inferDirectionFromText(text = '', fallback = '') {
    const normalized = `${text || ''} ${fallback || ''}`.toLowerCase();
    if (!normalized.trim()) return 'unknown';

    if (/\bno (?:clear |significant )?(?:difference|benefit|advantage)\b|\bsimilar\b|\bdid not improve\b|\bnot superior\b|\bnoninferior\b/.test(normalized)) {
      return 'neutral';
    }
    if (/\bworse\b|\binferior\b|\bhigher toxicity without\b/.test(normalized)) {
      return 'negative';
    }
    if (/\bimproved\b|\bhigher\b|\bbenefit\b|\bfavorable\b|\bfavourable\b|\bsuperior\b|\bbetter\b|\bshifted\b/.test(normalized)) {
      return 'positive';
    }
    return 'unknown';
  }

  extractEndpointFocusedText(article = {}, summary = null, endpointKey = '') {
    const source = [
      summary?.outcomes,
      summary?.key_findings,
      summary?.limitations,
      article?.title,
      article?.abstract
    ]
      .filter(Boolean)
      .join(' ');
    const pattern = this.getEndpointPatterns(endpointKey);
    if (!pattern) return source;

    const relevantSentences = this.splitIntoSentences(source).filter(sentence =>
      pattern.test(String(sentence || '').toLowerCase())
    );
    return relevantSentences.length > 0 ? relevantSentences.join(' ') : source;
  }

  inferEndpointDirection(article = {}, summary = null, endpointKey = '') {
    const metric = this.getEndpointMetricValue(article, endpointKey);
    const focusedText = this.extractEndpointFocusedText(article, summary, endpointKey);
    return this.inferDirectionFromText(focusedText, summary?.effect_direction || metric);
  }

  inferEndpointMaturity(article = {}, summary = null, endpointKey = '') {
    const source = `${summary?.limitations || ''} ${summary?.key_findings || ''} ${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();
    const pattern = this.getEndpointPatterns(endpointKey);
    const mentionsEndpoint = pattern ? pattern.test(source) : false;
    if (/\bimmature\b|\bmaturity remained limited\b|\bnot mature\b|\bearly follow-up\b|\bshort follow-up\b|\binterim\b/.test(source)) {
      return mentionsEndpoint || !pattern ? 'immature' : 'mixed';
    }
    return 'reported';
  }

  buildEndpointClaim({
    article = {},
    summary = null,
    endpointKey = '',
    sourceMeta = null,
    requestedEndpointKeys = [],
    extractedClaim = null
  } = {}) {
    const metricValue = this.getEndpointMetricValue(article, endpointKey);
    const studyKeys = this.getStudyEndpointKeys(article, summary);
    if (!metricValue && !studyKeys.includes(endpointKey) && !extractedClaim) {
      return null;
    }

    const supportLevel = this.inferSupportLevel(article, summary, extractedClaim);

    return {
      endpointKey,
      endpointLabel: this.getEndpointLabel(endpointKey, 'en'),
      requested: Array.isArray(requestedEndpointKeys) && requestedEndpointKeys.includes(endpointKey),
      direction: extractedClaim?.direction || this.inferEndpointDirection(article, summary, endpointKey),
      maturity: extractedClaim?.maturity || this.inferEndpointMaturity(article, summary, endpointKey),
      metricValue: extractedClaim?.effectSizeText || metricValue || null,
      comparator: this.inferComparatorLabel(article, summary) || null,
      directComparative: supportLevel === 'direct',
      supportLevel,
      evidenceStrength: this.inferEvidenceStrength(article, summary),
      sourcePmid: sourceMeta?.pmid || article?.pmid || null,
      sourceTitle: sourceMeta?.title || article?.title || null,
      sourceYear: sourceMeta?.year || article?.year || null,
      populationScope: extractedClaim?.populationScope || 'unclear'
    };
  }

  buildEndpointClaims(article = {}, summary = null, options = {}) {
    if (Array.isArray(article?.endpointClaims) && article.endpointClaims.length > 0) {
      return article.endpointClaims;
    }

    const requestedEndpointKeys = Array.isArray(options.requestedEndpointKeys) ? options.requestedEndpointKeys : [];
    const sourceContexts = article?.endpointSourceContexts || {};
    const sourceMap = article?.endpointSources || {};
    const structuredClaims = this.getStructuredEndpointClaims(summary);
    const endpointKeys = [...new Set([
      ...requestedEndpointKeys,
      ...this.getStudyEndpointKeys(article, summary),
      ...structuredClaims.map(claim => claim.endpointKey)
    ])];

    return endpointKeys
      .map(endpointKey => {
        const context = sourceContexts?.[endpointKey];
        const contextSummary = context && Object.prototype.hasOwnProperty.call(context, 'summary')
          ? context.summary
          : summary;
        const extractedClaim = this.getStructuredEndpointClaims(contextSummary)
          .find(claim => claim.endpointKey === endpointKey) ||
          structuredClaims.find(claim => claim.endpointKey === endpointKey) ||
          null;
        return this.buildEndpointClaim({
          article: context?.article || article,
          summary: contextSummary,
          endpointKey,
          sourceMeta: sourceMap?.[endpointKey],
          requestedEndpointKeys,
          extractedClaim
        });
      })
      .filter(Boolean);
  }
}

export default EndpointClaimAgent;
