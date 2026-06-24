class TrialFamilyAgent {
  constructor(dependencies = {}) {
    this.normalizeSearchText = dependencies.normalizeSearchText;
    this.sanitizeEvidenceField = dependencies.sanitizeEvidenceField;
    this.extractTrialName = dependencies.extractTrialName;
    this.detectClinicalFocus = dependencies.detectClinicalFocus;
    this.getRequestedEndpointKeys = dependencies.getRequestedEndpointKeys;
    this.getStudyEndpointKeys = dependencies.getStudyEndpointKeys;
    this.getEvidenceStrengthWeight = dependencies.getEvidenceStrengthWeight;
    this.hasOverallSurvivalSignal = dependencies.hasOverallSurvivalSignal;
    this.hasLateEndpointSignal = dependencies.hasLateEndpointSignal;
    this.isQualityOfLifeFocusedPublication = dependencies.isQualityOfLifeFocusedPublication;
    this.isExploratoryAnalysisPublication = dependencies.isExploratoryAnalysisPublication;
    this.isBiomarkerFocusedPublication = dependencies.isBiomarkerFocusedPublication;
    this.sortEvidenceForSynthesis = dependencies.sortEvidenceForSynthesis;
    this.endpointClaimAgent = dependencies.endpointClaimAgent;
    this.maxEvidenceArticles = dependencies.maxEvidenceArticles || 5;
    this.validateDependencies();
  }

  validateDependencies() {
    const required = [
      'normalizeSearchText',
      'sanitizeEvidenceField',
      'extractTrialName',
      'detectClinicalFocus',
      'getRequestedEndpointKeys',
      'getStudyEndpointKeys',
      'getEvidenceStrengthWeight',
      'hasOverallSurvivalSignal',
      'hasLateEndpointSignal',
      'isQualityOfLifeFocusedPublication',
      'isExploratoryAnalysisPublication',
      'isBiomarkerFocusedPublication',
      'sortEvidenceForSynthesis',
      'endpointClaimAgent'
    ];
    const missing = required.filter(name =>
      name === 'endpointClaimAgent'
        ? !this[name]
        : typeof this[name] !== 'function'
    );
    if (missing.length > 0) {
      throw new Error(`TrialFamilyAgent missing dependencies: ${missing.join(', ')}`);
    }
  }

  buildTrialDedupKey(article = {}) {
    const explicitTrialName = this.sanitizeEvidenceField(article?.trialName || '');
    const inferredTrialName = explicitTrialName || this.extractTrialName(article?.title || '', article?.abstract || '');
    if (inferredTrialName) {
      return `trial:${this.normalizeSearchText(inferredTrialName)}`;
    }

    return '';
  }

  collectRelatedPmids(article = {}) {
    return [...new Set([
      article?.pmid,
      ...(Array.isArray(article?.relatedPmids) ? article.relatedPmids : [])
    ].filter(Boolean))];
  }

  getEndpointMetricKeys(endpointKey = '') {
    const key = String(endpointKey || '').toLowerCase();
    if (key === 'efs') return ['efs', 'dfs', 'pfs'];
    if (key === 'sampleSize') return ['sampleSize'];
    return key ? [key] : [];
  }

  articleHasEndpointMetric(article = {}, endpointKey = '') {
    const metrics = article?.endpointMetrics || {};
    return this.getEndpointMetricKeys(endpointKey).some(key => Boolean(metrics?.[key]));
  }

  scoreTrialPublicationCandidate(item = {}, question = '', options = {}) {
    const focus = this.detectClinicalFocus(question, options);
    const requestedEndpointKeys = this.getRequestedEndpointKeys(question, options);
    const year = Number.parseInt(item?.article?.year, 10) || 0;
    const classificationPriority = Number(item?.classification?.priority || 0);
    const strengthWeight = this.getEvidenceStrengthWeight(item?.evidenceStrength);
    const osWeight = this.hasOverallSurvivalSignal(item?.article, item?.summary) ? 1.2 : 0;
    const lateEndpointWeight = this.hasLateEndpointSignal(item?.article, item?.summary) ? 0.6 : 0;
    const directComparativeWeight = item?.classification?.isDirectComparative ? 0.6 : 0;
    const requestedEndpointWeight = requestedEndpointKeys.reduce((sum, key) =>
      sum + (this.getStudyEndpointKeys(item?.article, item?.summary).includes(key) ? 0.9 : 0), 0);
    const recencyWeight = year > 0 ? (year - 2000) * 0.01 : 0;
    const qolPenalty = (!focus.wantsQualityOfLife && this.isQualityOfLifeFocusedPublication(item?.article, item?.summary)) ? 2 : 0;
    const exploratoryPenalty = this.isExploratoryAnalysisPublication(item?.article, item?.summary) ? 1.5 : 0;
    const biomarkerPenalty = (!focus.wantsBiomarker && this.isBiomarkerFocusedPublication(item?.article, item?.summary)) ? 2 : 0;

    return classificationPriority +
      strengthWeight +
      osWeight +
      lateEndpointWeight +
      directComparativeWeight +
      requestedEndpointWeight +
      recencyWeight -
      qolPenalty -
      exploratoryPenalty -
      biomarkerPenalty;
  }

  scoreEndpointPublicationCandidate(item = {}, endpointKey = '', question = '', options = {}) {
    const studyKeys = this.getStudyEndpointKeys(item?.article, item?.summary);
    if (!studyKeys.includes(endpointKey) && !this.articleHasEndpointMetric(item?.article, endpointKey)) {
      return Number.NEGATIVE_INFINITY;
    }

    const year = Number.parseInt(item?.article?.year, 10) || 0;
    const metricWeight = this.articleHasEndpointMetric(item?.article, endpointKey) ? 1.4 : 0.5;
    const endpointSpecificWeight = endpointKey === 'os'
      ? (this.hasOverallSurvivalSignal(item?.article, item?.summary) ? 1.5 : 0)
      : (endpointKey === 'efs'
          ? (this.hasLateEndpointSignal(item?.article, item?.summary) ? 1.0 : 0)
          : 0.5);
    const recencyWeight = year > 0 ? (year - 2000) * 0.015 : 0;

    return this.scoreTrialPublicationCandidate(item, question, options) +
      metricWeight +
      endpointSpecificWeight +
      recencyWeight;
  }

  mergeEndpointMetricValues(targetMetrics = {}, sourceMetrics = {}, endpointKey = '') {
    const merged = { ...(targetMetrics || {}) };
    const source = sourceMetrics || {};
    for (const key of this.getEndpointMetricKeys(endpointKey)) {
      if (source?.[key]) {
        merged[key] = source[key];
      }
    }
    return merged;
  }

  buildEndpointSourceContext(item = {}, endpointKey = '') {
    const endpointMetrics = this.mergeEndpointMetricValues({}, item?.article?.endpointMetrics || {}, endpointKey);
    return {
      article: {
        pmid: item?.article?.pmid || null,
        title: item?.article?.title || null,
        year: item?.article?.year || null,
        trialName: item?.article?.trialName || null,
        studyDesign: item?.article?.studyDesign || null,
        endpointMetrics
      },
      summary: item?.summary ? { ...item.summary } : null
    };
  }

  aggregateTrialGroup(items = [], question = '', options = {}) {
    if (!Array.isArray(items) || items.length === 0) return null;
    if (items.length === 1) {
      const item = items[0];
      const relatedPmids = this.collectRelatedPmids(item.article);
      const article = {
        ...item.article,
        relatedPmids,
        sourcePublicationPmids: relatedPmids,
        trialPublicationCount: relatedPmids.length
      };
      article.endpointClaims = this.endpointClaimAgent.buildEndpointClaims(article, item.summary, {
        requestedEndpointKeys: this.getRequestedEndpointKeys(question, options)
      });

      return {
        article,
        summary: item.summary
          ? {
              ...item.summary,
              related_pmids: relatedPmids
            }
          : null,
        leadItem: item
      };
    }

    const sortedByLead = [...items].sort((a, b) => {
      const delta = this.scoreTrialPublicationCandidate(b, question, options) - this.scoreTrialPublicationCandidate(a, question, options);
      if (delta !== 0) return delta;
      return (Number.parseInt(b?.article?.year, 10) || 0) - (Number.parseInt(a?.article?.year, 10) || 0);
    });
    const leadItem = sortedByLead[0];
    const directItem = sortedByLead.find(item => item?.classification?.isDirectComparative) || leadItem;
    const requestedEndpointKeys = this.getRequestedEndpointKeys(question, options);
    const endpointKeys = [...new Set([
      ...requestedEndpointKeys,
      'os',
      'efs',
      'pcr',
      'orr',
      'grade34ae'
    ])];

    let mergedMetrics = { ...(leadItem?.article?.endpointMetrics || {}) };
    const endpointSources = {};
    const endpointSourceContexts = {};
    for (const endpointKey of endpointKeys) {
      const rankedForEndpoint = [...items].sort((a, b) =>
        this.scoreEndpointPublicationCandidate(b, endpointKey, question, options) -
        this.scoreEndpointPublicationCandidate(a, endpointKey, question, options)
      );
      const chosen = rankedForEndpoint.find(item =>
        this.scoreEndpointPublicationCandidate(item, endpointKey, question, options) > Number.NEGATIVE_INFINITY
      );
      if (!chosen) continue;
      mergedMetrics = this.mergeEndpointMetricValues(mergedMetrics, chosen.article?.endpointMetrics || {}, endpointKey);
      endpointSources[endpointKey] = {
        pmid: chosen.article?.pmid || null,
        year: chosen.article?.year || null,
        title: chosen.article?.title || null
      };
      endpointSourceContexts[endpointKey] = this.buildEndpointSourceContext(chosen, endpointKey);
    }

    const sampleSize = items
      .map(item => Number.parseInt(item?.article?.endpointMetrics?.sampleSize, 10))
      .filter(value => Number.isFinite(value))
      .sort((a, b) => b - a)[0];
    if (Number.isFinite(sampleSize)) {
      mergedMetrics.sampleSize = String(sampleSize);
    }

    const relatedPmids = [...new Set(items.flatMap(item => this.collectRelatedPmids(item.article)))];
    const years = items
      .map(item => Number.parseInt(item?.article?.year, 10))
      .filter(year => Number.isFinite(year))
      .sort((a, b) => a - b);
    const strongestItem = [...items].sort((a, b) =>
      this.getEvidenceStrengthWeight(b?.evidenceStrength) - this.getEvidenceStrengthWeight(a?.evidenceStrength)
    )[0] || leadItem;

    const mergedArticle = {
      ...leadItem.article,
      endpointMetrics: mergedMetrics,
      relatedPmids,
      sourcePublicationPmids: relatedPmids,
      endpointSources,
      endpointSourceContexts,
      trialPublicationCount: items.length,
      year: leadItem.article?.year || (years.length > 0 ? String(years[years.length - 1]) : null),
      trialYearRange: years.length > 0 ? `${years[0]}-${years[years.length - 1]}` : null,
      journal: leadItem.article?.journal || strongestItem?.article?.journal || null
    };

    const mergedSummary = {
      ...(leadItem.summary || directItem.summary || strongestItem.summary || {}),
      index: leadItem.index,
      analysis_type: this.sanitizeEvidenceField(
        directItem?.summary?.analysis_type ||
        leadItem?.summary?.analysis_type ||
        strongestItem?.summary?.analysis_type ||
        ''
      ),
      study_design: this.sanitizeEvidenceField(
        directItem?.summary?.study_design ||
        leadItem?.summary?.study_design ||
        strongestItem?.summary?.study_design ||
        leadItem?.article?.studyDesign ||
        ''
      ),
      population: this.sanitizeEvidenceField(
        directItem?.summary?.population ||
        leadItem?.summary?.population ||
        strongestItem?.summary?.population ||
        ''
      ),
      intervention: this.sanitizeEvidenceField(
        directItem?.summary?.intervention ||
        leadItem?.summary?.intervention ||
        strongestItem?.summary?.intervention ||
        ''
      ),
      comparator: this.sanitizeEvidenceField(
        directItem?.summary?.comparator ||
        leadItem?.summary?.comparator ||
        strongestItem?.summary?.comparator ||
        ''
      ),
      outcomes: this.sanitizeEvidenceField(
        leadItem?.summary?.outcomes ||
        directItem?.summary?.outcomes ||
        strongestItem?.summary?.outcomes ||
        ''
      ),
      key_findings: this.sanitizeEvidenceField(
        leadItem?.summary?.key_findings ||
        directItem?.summary?.key_findings ||
        strongestItem?.summary?.key_findings ||
        ''
      ),
      limitations: [...new Set(items
        .map(item => this.sanitizeEvidenceField(item?.summary?.limitations || ''))
        .filter(Boolean))]
        .slice(0, 2)
        .join('; ') || this.sanitizeEvidenceField(leadItem?.summary?.limitations || ''),
      evidence_strength: this.sanitizeEvidenceField(
        strongestItem?.summary?.evidence_strength ||
        leadItem?.summary?.evidence_strength ||
        directItem?.summary?.evidence_strength ||
        ''
      ),
      related_pmids: relatedPmids,
      endpoint_sources: endpointSources
    };

    mergedArticle.endpointClaims = this.endpointClaimAgent.buildEndpointClaims(mergedArticle, mergedSummary, {
      requestedEndpointKeys
    });

    return {
      article: mergedArticle,
      summary: mergedSummary,
      leadItem
    };
  }

  aggregateTrialEvidence(articles = [], evidenceSummaries = [], question = '', options = {}) {
    if (!Array.isArray(articles) || articles.length === 0) {
      return { articles: [], evidenceSummaries: [], aggregated: false };
    }

    const ordered = this.sortEvidenceForSynthesis(articles, evidenceSummaries, question, options);
    const grouped = new Map();
    const standalone = [];

    for (const item of ordered.orderedItems) {
      const key = this.buildTrialDedupKey(item.article);
      if (!key) {
        standalone.push(this.aggregateTrialGroup([item], question, options));
        continue;
      }
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key).push(item);
    }

    const aggregatedGroups = [
      ...standalone,
      ...Array.from(grouped.values()).map(items => this.aggregateTrialGroup(items, question, options))
    ].filter(Boolean);

    const normalized = aggregatedGroups
      .sort((a, b) => {
        const delta = this.scoreTrialPublicationCandidate(b?.leadItem, question, options) - this.scoreTrialPublicationCandidate(a?.leadItem, question, options);
        if (delta !== 0) return delta;
        return (Number.parseInt(b?.article?.year, 10) || 0) - (Number.parseInt(a?.article?.year, 10) || 0);
      })
      .map((group, idx) => ({
        article: group.article,
        summary: group.summary
          ? {
              ...group.summary,
              index: idx + 1
            }
          : null
      }));

    return {
      articles: normalized.map(item => item.article),
      evidenceSummaries: normalized.filter(item => item.summary).map(item => item.summary),
      aggregated: normalized.length < articles.length
    };
  }

  deduplicateTrialEvidenceItems(orderedItems = [], question = '', options = {}) {
    if (!Array.isArray(orderedItems) || orderedItems.length === 0) return [];

    const grouped = new Map();
    const standalone = [];

    for (const item of orderedItems) {
      const key = this.buildTrialDedupKey(item.article);
      if (!key) {
        standalone.push(item);
        continue;
      }
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key).push(item);
    }

    const deduped = [];
    for (const items of grouped.values()) {
      if (items.length === 1) {
        deduped.push(items[0]);
        continue;
      }

      const sortedGroup = [...items].sort((a, b) => {
        const delta = this.scoreTrialPublicationCandidate(b, question, options) - this.scoreTrialPublicationCandidate(a, question, options);
        if (delta !== 0) return delta;
        return a.index - b.index;
      });
      deduped.push(sortedGroup[0]);
    }

    return [...deduped, ...standalone]
      .sort((a, b) => a.index - b.index)
      .map((item, idx) => ({
        ...item,
        index: idx + 1
      }));
  }

  trimEvidenceForDetailedAnswer(articles = [], evidenceSummaries = [], question = '', options = {}) {
    const aggregated = this.aggregateTrialEvidence(articles, evidenceSummaries, question, options);
    const ordered = this.sortEvidenceForSynthesis(aggregated.articles, aggregated.evidenceSummaries, question, options);
    const dedupedItems = this.deduplicateTrialEvidenceItems(ordered.orderedItems, question, options);
    const substantiveItems = dedupedItems.filter(item => !item.classification.role.startsWith('background'));
    const selectedItems = (substantiveItems.length >= 3 ? substantiveItems : dedupedItems)
      .slice(0, this.maxEvidenceArticles)
      .map((item, idx) => ({
        ...item,
        index: idx + 1
      }));

    return {
      articles: selectedItems.map(item => item.article),
      evidenceSummaries: selectedItems
        .filter(item => item.summary)
        .map(item => ({
          ...item.summary,
          index: item.index
        })),
      orderedItems: selectedItems
    };
  }
}

export default TrialFamilyAgent;
