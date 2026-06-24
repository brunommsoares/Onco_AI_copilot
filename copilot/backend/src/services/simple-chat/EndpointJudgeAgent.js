class EndpointJudgeAgent {
  constructor(dependencies = {}) {
    this.getRequestedEndpointKeys = dependencies.getRequestedEndpointKeys;
    this.describeRequestedEndpoints = dependencies.describeRequestedEndpoints;
    this.joinListWithAnd = dependencies.joinListWithAnd;
    this.getEndpointLabel = dependencies.getEndpointLabel;
    this.inferComparatorLabel = dependencies.inferComparatorLabel;
    this.getPreferredEvidenceLabel = dependencies.getPreferredEvidenceLabel;
    this.hasDirectComparativeSignals = dependencies.hasDirectComparativeSignals;
    this.endpointClaimAgent = dependencies.endpointClaimAgent;
    this.validateDependencies();
  }

  validateDependencies() {
    const required = [
      'getRequestedEndpointKeys',
      'describeRequestedEndpoints',
      'joinListWithAnd',
      'getEndpointLabel',
      'inferComparatorLabel',
      'getPreferredEvidenceLabel',
      'hasDirectComparativeSignals',
      'endpointClaimAgent'
    ];
    const missing = required.filter(name =>
      name === 'endpointClaimAgent'
        ? !this[name]
        : typeof this[name] !== 'function'
    );
    if (missing.length > 0) {
      throw new Error(`EndpointJudgeAgent missing dependencies: ${missing.join(', ')}`);
    }
  }

  getRelevantClaims(article = {}, summary = null, question = '', options = {}) {
    const requestedEndpointKeys = this.getRequestedEndpointKeys(question, options);
    const claims = this.endpointClaimAgent.buildEndpointClaims(article, summary, { requestedEndpointKeys });
    if (requestedEndpointKeys.length === 0) {
      return claims;
    }

    return claims.filter(claim => requestedEndpointKeys.includes(claim.endpointKey));
  }

  getClaimsForNarrative(article = {}, summary = null, question = '', options = {}) {
    const requestedEndpointKeys = this.getRequestedEndpointKeys(question, options);
    const requestedClaims = this.getRelevantClaims(article, summary, question, options);
    if (requestedClaims.length > 0) return requestedClaims;
    if (requestedEndpointKeys.length > 0) return [];

    const fallbackClaims = this.endpointClaimAgent.buildEndpointClaims(article, summary, {
      requestedEndpointKeys
    });
    const preferredOrder = ['os', 'efs', 'pcr', 'orr', 'grade34ae'];
    return preferredOrder
      .map(key => fallbackClaims.find(claim => claim.endpointKey === key))
      .filter(Boolean)
      .slice(0, 2);
  }

  formatClaimLabels(claims = [], language = 'en') {
    const labels = [...new Set((Array.isArray(claims) ? claims : [])
      .map(claim => this.getEndpointLabel(claim?.endpointKey, language))
      .filter(Boolean))];
    return this.joinListWithAnd(labels, language);
  }

  buildClaimQualifierText(claim = {}, article = {}, language = 'en') {
    const isPt = language === 'pt' || language === 'bilingual';
    const parts = [];
    if (claim?.metricValue) {
      parts.push(claim.metricValue);
    }
    if (claim?.maturity === 'immature') {
      parts.push(isPt ? 'maturidade limitada' : 'maturity limited');
    } else if (claim?.maturity === 'mixed') {
      parts.push(isPt ? 'maturidade mista' : 'maturity mixed');
    }
    if (claim?.sourcePmid && article?.pmid && claim.sourcePmid !== article.pmid) {
      parts.push(isPt ? 'apoiado por publicação relacionada do mesmo ensaio' : 'supported by a related same-trial publication');
    }
    return parts.length > 0 ? ` (${parts.join('; ')})` : '';
  }

  hasRelatedSameTrialRequestedSource(article = {}, summary = null, question = '', options = {}) {
    return this.getRelevantClaims(article, summary, question, options)
      .some(claim => claim?.sourcePmid && article?.pmid && claim.sourcePmid !== article.pmid);
  }

  buildStudyFindingText(article = {}, summary = null, question = '', options = {}, language = 'en') {
    const isPt = language === 'pt' || language === 'bilingual';
    const requestedEndpointText = this.describeRequestedEndpoints(question, options, language);
    const claims = this.getClaimsForNarrative(article, summary, question, options);
    const hasDirectClaim = claims.some(claim => claim?.directComparative === true || claim?.supportLevel === 'direct');
    const positiveLead = hasDirectClaim
      ? (isPt ? 'Mostrou beneficio em' : 'Showed benefit in')
      : (isPt ? 'Evidencia indireta favoreceu' : 'Indirect evidence favored');
    const neutralLead = hasDirectClaim
      ? (isPt ? 'Nao mostrou vantagem clara em' : 'Did not show a clear advantage in')
      : (isPt ? 'Evidencia indireta nao mostrou vantagem clara em' : 'Indirect evidence did not show a clear advantage in');
    const negativeLead = hasDirectClaim
      ? (isPt ? 'O sinal global nao favoreceu claramente o regime em' : 'The overall signal did not clearly favor the regimen in')
      : (isPt ? 'Evidencia indireta nao favoreceu claramente' : 'Indirect evidence did not clearly favor');

    if (claims.length === 0) {
      return requestedEndpointText
        ? (isPt
            ? `Nao estabelece diretamente o desfecho pedido (${requestedEndpointText})`
            : `Does not directly establish the requested outcome (${requestedEndpointText})`)
        : (isPt ? 'Sinal clinico qualitativo no texto da publicacao' : 'Qualitative clinical signal in the publication text');
    }

    if (claims.length === 1) {
      const claim = claims[0];
      const label = this.getEndpointLabel(claim?.endpointKey, language);
      const qualifier = this.buildClaimQualifierText(claim, article, language);
      if (claim.direction === 'positive') {
        return `${positiveLead} ${label}${qualifier}`;
      }
      if (claim.direction === 'neutral') {
        return `${neutralLead} ${label}${qualifier}`;
      }
      if (claim.direction === 'negative') {
        return `${negativeLead} ${label}${qualifier}`;
      }
      return isPt
        ? `Informou ${label} sem estimativa direcional clara${qualifier}`
        : `Reported ${label} without a clear directional estimate${qualifier}`;
    }

    const positive = claims.filter(claim => claim.direction === 'positive');
    const neutral = claims.filter(claim => claim.direction === 'neutral');
    const negative = claims.filter(claim => claim.direction === 'negative');
    const unknown = claims.filter(claim => !['positive', 'neutral', 'negative'].includes(claim.direction));

    if (positive.length > 0 && neutral.length === 0 && negative.length === 0) {
      return `${positiveLead} ${this.formatClaimLabels(positive, language)}`;
    }
    if (neutral.length > 0 && positive.length === 0 && negative.length === 0) {
      return `${neutralLead} ${this.formatClaimLabels(neutral, language)}`;
    }
    if (negative.length > 0 && positive.length === 0) {
      return `${negativeLead} ${this.formatClaimLabels(negative, language)}`;
    }

    const parts = [];
    if (positive.length > 0) {
      parts.push(isPt
        ? `beneficio em ${this.formatClaimLabels(positive, language)}`
        : `benefit in ${this.formatClaimLabels(positive, language)}`);
    }
    if (neutral.length > 0) {
      parts.push(isPt
        ? `sem vantagem clara em ${this.formatClaimLabels(neutral, language)}`
        : `without a clear advantage in ${this.formatClaimLabels(neutral, language)}`);
    }
    if (negative.length > 0) {
      parts.push(isPt
        ? `sinal desfavoravel em ${this.formatClaimLabels(negative, language)}`
        : `an unfavorable signal in ${this.formatClaimLabels(negative, language)}`);
    }
    if (parts.length === 0 && unknown.length > 0) {
      return isPt
        ? `Informou ${this.formatClaimLabels(unknown, language)}`
        : `Reported ${this.formatClaimLabels(unknown, language)}`;
    }

    return isPt
      ? `${hasDirectClaim ? 'Resultados mistos' : 'Evidencia indireta com resultados mistos'}: ${parts.join('; ')}`
      : `${hasDirectClaim ? 'Mixed results' : 'Indirect evidence with mixed results'}: ${parts.join('; ')}`;
  }

  buildDetailedTakeaway(orderedItems = [], question = '', options = {}, language = 'en') {
    const isPt = language === 'pt' || language === 'bilingual';
    const requestedEndpointText = this.describeRequestedEndpoints(question, options, language);
    if (!Array.isArray(orderedItems) || orderedItems.length === 0) {
      return isPt
        ? 'A sintese disponivel continua limitada e deve ser integrada com guidelines e contexto clinico individual.'
        : 'Available evidence remains limited and should be integrated with guidelines and individual clinical context.';
    }

    const directPrimary = orderedItems.filter(item => item.classification.role === 'direct-comparative-primary');
    const supportivePrimary = orderedItems.filter(item => item.classification.role === 'supportive-primary');
    const supportiveSecondary = orderedItems.filter(item => item.classification.role === 'supportive-secondary');
    const exploratory = orderedItems.filter(item => item.classification.role === 'supportive-exploratory');
    const supportiveSynthesis = orderedItems.filter(item => item.classification.role === 'supportive-synthesis');
    const background = orderedItems.filter(item => item.classification.role.startsWith('background'));
    const summaryState = options?._summaryState || null;
    const mainItem = directPrimary[0] || supportivePrimary[0] || supportiveSecondary[0] || exploratory[0] || supportiveSynthesis[0] || orderedItems[0];

    const rawMainLabel = this.getPreferredEvidenceLabel(mainItem.article, mainItem.summary);
    const mainLabel = `**${rawMainLabel}**`;
    const rawMainComparator = this.inferComparatorLabel(mainItem.article, mainItem.summary);
    const mainComparator = rawMainComparator ? `**${rawMainComparator}**` : null;
    const mainFinding = this.buildStudyFindingText(mainItem.article, mainItem.summary, question, options, language);
    const mainRef = `[${mainItem.index}]`;

    if (summaryState?.insufficient) {
      const leadRefs = [...new Set((directPrimary.length > 0 ? directPrimary : orderedItems)
        .slice(0, 2)
        .map(item => `[${item.index}]`))].join(' ');
      const supportRefs = [...new Set([
        ...supportivePrimary.slice(0, 1).map(item => `[${item.index}]`),
        ...supportiveSecondary.slice(0, 2).map(item => `[${item.index}]`),
        ...exploratory.slice(0, 2).map(item => `[${item.index}]`),
        ...supportiveSynthesis.slice(0, 2).map(item => `[${item.index}]`),
        ...background.slice(0, 1).map(item => `[${item.index}]`)
      ])].join(' ');

      let takeaway = isPt
        ? `No conjunto, a base recuperada e insuficiente para uma conclusao comparativa firme${requestedEndpointText ? ` em ${requestedEndpointText}` : ''}${leadRefs ? ` ${leadRefs}` : ''}.`
        : `Overall, the retrieved evidence is insufficient for a firm comparative conclusion${requestedEndpointText ? ` in ${requestedEndpointText}` : ''}${leadRefs ? ` ${leadRefs}` : ''}.`;

      if (directPrimary.length > 0) {
        takeaway += isPt
          ? ' Mesmo os estudos mais diretamente relevantes nao fornecem um efeito claro e consistente.'
          : ' Even the most directly relevant studies do not provide a clear and consistent effect estimate.';
      } else {
        takeaway += isPt
          ? ' A maior parte das publicacoes recuperadas e indireta, exploratoria ou apenas contextual.'
          : ' Most of the retrieved publications are indirect, exploratory, or mainly contextual.';
      }

      if (supportRefs) {
        takeaway += isPt
          ? ` As restantes publicacoes funcionam sobretudo como contexto ${supportRefs}.`
          : ` The remaining publications function mainly as context ${supportRefs}.`;
      }

      takeaway += isPt
        ? ' A aplicabilidade final depende da maturidade real dos endpoints e do contexto clinico.'
        : ' Final applicability still depends on endpoint maturity and clinical context.';

      return takeaway;
    }

    let takeaway = '';
    if (mainItem.classification.role === 'direct-comparative-primary') {
      takeaway = isPt
        ? `${mainLabel} tem a evidencia mais forte neste conjunto${mainComparator ? ` versus ${mainComparator}` : ''}. ${mainFinding} ${mainRef}.`
        : `${mainLabel}${mainComparator ? ` versus ${mainComparator}` : ''} provides the clearest signal in this set. ${mainFinding} ${mainRef}.`;

      const secondaryDirect = directPrimary.find(item =>
        item.index !== mainItem.index &&
        this.getPreferredEvidenceLabel(item.article, item.summary) !== mainLabel
      );
      if (secondaryDirect) {
        const secondaryLabel = `**${this.getPreferredEvidenceLabel(secondaryDirect.article, secondaryDirect.summary)}**`;
        const secondaryComparator = this.inferComparatorLabel(secondaryDirect.article, secondaryDirect.summary);
        const secondaryFinding = this.buildStudyFindingText(secondaryDirect.article, secondaryDirect.summary, question, options, language);
        takeaway += ` ${secondaryLabel}${secondaryComparator ? ` versus ${secondaryComparator}` : ''}: ${secondaryFinding} [${secondaryDirect.index}].`;
      }
      takeaway += isPt
        ? ' Em termos práticos, esta é a evidência que deve ancorar a interpretação clínica antes de análises exploratórias, biomarcadores ou sínteses indiretas.'
        : ' The remaining publications mainly help qualify consistency and limits of the readout.';
      if (this.hasRelatedSameTrialRequestedSource(mainItem.article, mainItem.summary, question, options)) {
        takeaway += isPt
          ? ' Para o desfecho pedido, esta conclusÃ£o reflete seguimento endpoint-especÃ­fico em publicaÃ§Ãµes relacionadas do mesmo ensaio, e nÃ£o apenas o artigo principal.'
          : ' For the requested outcome, this readout also depends on related same-trial follow-up publications.';
      }
    } else if (supportivePrimary.length > 0 || supportiveSecondary.length > 0 || exploratory.length > 0) {
      takeaway = isPt
        ? `O sinal clinico e sustentado sobretudo por evidencia de apoio${requestedEndpointText ? ` em ${requestedEndpointText}` : ''}, sem um estudo comparativo primario dominante que torne a conclusao definitiva ${mainRef}.`
        : `The clinical signal comes mainly from supportive evidence${requestedEndpointText ? ` in ${requestedEndpointText}` : ''}, without a dominant comparative study that settles the question ${mainRef}.`;
      takeaway += isPt
        ? ' Isso significa que a leitura atual é mais útil para contextualizar tendência e consistência do que para definir superioridade clínica inequívoca.'
        : ' That makes the readout more useful for trend and consistency than for a firm comparative conclusion.';
    } else if (supportiveSynthesis.length > 0) {
      takeaway = isPt
        ? `A sintese disponivel e sobretudo indireta; ela favorece ${mainLabel} como sinal agregador, mas nao substitui evidencia comparativa primaria ${mainRef}.`
        : `The available synthesis is mainly indirect; it favors ${mainLabel} as an aggregate signal, but it does not replace primary comparative evidence ${mainRef}.`;
      takeaway += isPt
        ? ' A decisão prática continua dependente de confirmação em ensaios comparativos diretamente aplicáveis à pergunta clínica.'
        : ' The conclusion still depends on comparative trials that answer the question more directly.';
    } else {
      takeaway = isPt
        ? `A evidencia disponivel continua limitada e heterogenea para suportar uma conclusao pratica forte ${mainRef}.`
        : `Available evidence remains limited and heterogeneous for a strong practical conclusion ${mainRef}.`;
      takeaway += isPt
        ? ' O conjunto atual ajuda mais a mapear lacunas do que a estabelecer uma recomendação comparativa robusta.'
        : ' The current evidence base is more useful for mapping gaps than for defining a robust comparative recommendation.';
    }

    const supportRefs = [...new Set([
      ...supportiveSecondary.slice(0, 2).map(item => `[${item.index}]`),
      ...exploratory.slice(0, 2).map(item => `[${item.index}]`),
      ...supportiveSynthesis.slice(0, 2).map(item => `[${item.index}]`),
      ...background.slice(0, 1).map(item => `[${item.index}]`)
    ])].join(' ');
    if (supportRefs) {
      takeaway += isPt
        ? ` Analises exploratorias e revisoes servem como apoio/contexto, nao como prova comparativa definidora de pratica ${supportRefs}.`
        : ` Exploratory analyses and reviews remain mainly supportive/contextual ${supportRefs}.`;
    }

    const nonTargetComparative = orderedItems.filter(item =>
      this.hasDirectComparativeSignals(item.article, item.summary) &&
      this.getRelevantClaims(item.article, item.summary, question, options).length === 0
    );
    if (requestedEndpointText && nonTargetComparative.length > 0) {
      const refs = [...new Set(nonTargetComparative.map(item => `[${item.index}]`))].join(' ');
      takeaway += isPt
        ? ` Para o desfecho pedido (${requestedEndpointText}), a evidencia para regimes adicionais continua limitada ou imatura ${refs}.`
        : ` For the requested outcome (${requestedEndpointText}), evidence for additional regimens remains limited or immature ${refs}.`;
    }

    takeaway += isPt
      ? ' A aplicabilidade final depende da maturidade real dos endpoints e do contexto clinico.'
      : ' Final applicability still depends on endpoint maturity and clinical context.';

    return takeaway;
  }

  buildRequestedEndpointLimitations(primaryPool = [], question = '', options = {}, language = 'en') {
    const isPt = language === 'pt' || language === 'bilingual';
    const requestedEndpointKeys = this.getRequestedEndpointKeys(question, options);
    const targetKeys = requestedEndpointKeys.length > 0 ? requestedEndpointKeys : ['os'];
    const targetLabel = requestedEndpointKeys.length > 0
      ? this.describeRequestedEndpoints(question, options, language)
      : this.getEndpointLabel('os', language);

    const limitedRefs = [];
    for (const item of Array.isArray(primaryPool) ? primaryPool : []) {
      const claims = this.endpointClaimAgent.buildEndpointClaims(item.article, item.summary, { requestedEndpointKeys: targetKeys });
      const targetClaims = claims.filter(claim => targetKeys.includes(claim.endpointKey));
      if (targetClaims.length === 0 || targetClaims.every(claim => claim.maturity !== 'reported')) {
        limitedRefs.push(item.index);
      }
    }

    if (limitedRefs.length === 0) {
      return '';
    }

    return isPt
      ? `${targetLabel} permaneceu limitado/imatura em ${limitedRefs.length}/${Math.max(primaryPool.length, 1)} estudos clinicamente centrais`
      : `${targetLabel} remained limited/immature in ${limitedRefs.length}/${Math.max(primaryPool.length, 1)} clinically central studies`;
  }
}

export default EndpointJudgeAgent;
