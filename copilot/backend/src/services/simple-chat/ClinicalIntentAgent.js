class ClinicalIntentAgent {
  constructor(dependencies = {}) {
    this.normalizePreferenceKey = dependencies.normalizePreferenceKey;
    this.textMentionsEndpointKey = dependencies.textMentionsEndpointKey;
    this.getEndpointLabel = dependencies.getEndpointLabel;
    this.joinListWithAnd = dependencies.joinListWithAnd;
    this.validateDependencies();
  }

  validateDependencies() {
    const required = [
      'normalizePreferenceKey',
      'textMentionsEndpointKey',
      'getEndpointLabel',
      'joinListWithAnd'
    ];
    const missing = required.filter(name => typeof this[name] !== 'function');
    if (missing.length > 0) {
      throw new Error(`ClinicalIntentAgent missing dependencies: ${missing.join(', ')}`);
    }
  }

  isContextOnlyOutcomeClause(text = '') {
    const source = String(text || '').toLowerCase().trim();
    if (!source) return false;

    return /\bmaturity\b|\bimmature\b|\blimited\b|\binconsisten(?:t|cy)\b|\bwhen reported\b|\bif reported\b|\bwhen available\b|\bincompletely reported\b/.test(source);
  }

  splitOutcomeClauses(text = '') {
    return String(text || '')
      .split(/[\n;|]+/)
      .map(clause => clause.replace(/\s+/g, ' ').trim().toLowerCase())
      .filter(Boolean)
      .map(clause => clause.replace(/^outcomes?\s*:?\s*/i, '').trim())
      .filter(Boolean);
  }

  clauseMentionsEndpoint(text = '') {
    return ['os', 'efs', 'pcr', 'orr', 'grade34ae']
      .some(key => this.textMentionsEndpointKey(text, key));
  }

  buildEndpointDetectionSource(question = '', options = {}) {
    const normalizeClauses = (text = '') => this.splitOutcomeClauses(text)
      .filter(clause => !(this.clauseMentionsEndpoint(clause) && this.isContextOnlyOutcomeClause(clause)));

    const questionClauses = normalizeClauses(question);
    const outcomesClauses = normalizeClauses(options.outcomes || '');

    return [...questionClauses, ...outcomesClauses].join(' ');
  }

  getRequestedEndpointKeys(question = '', options = {}) {
    const explicit = Array.isArray(options.endpoints)
      ? options.endpoints.map(value => this.normalizePreferenceKey(value))
      : [];

    const source = this.buildEndpointDetectionSource(question, options);
    const keys = new Set(explicit.filter(Boolean));

    if (this.textMentionsEndpointKey(source, 'os')) keys.add('os');
    if (this.textMentionsEndpointKey(source, 'efs')) keys.add('efs');
    if (this.textMentionsEndpointKey(source, 'pcr')) keys.add('pcr');
    if (this.textMentionsEndpointKey(source, 'orr')) keys.add('orr');
    if (this.textMentionsEndpointKey(source, 'grade34ae')) keys.add('grade34ae');

    return ['os', 'efs', 'pcr', 'orr', 'grade34ae'].filter(key => keys.has(key));
  }

  describeRequestedEndpoints(question = '', options = {}, language = 'en') {
    const keys = this.getRequestedEndpointKeys(question, options);
    if (keys.length === 0) return '';
    return this.joinListWithAnd(
      keys.map(key => this.getEndpointLabel(key, language)).filter(Boolean),
      language
    );
  }
}

export default ClinicalIntentAgent;
