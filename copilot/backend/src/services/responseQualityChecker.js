import { logger } from '../utils/logger.js';

/**
 * Response Quality Checker - Verifica qualidade das respostas de forma assÃ­ncrona
 * Executa verificaÃ§Ãµes rÃ¡pidas (< 100ms) e profundas opcionais
 */
class ResponseQualityChecker {
  constructor() {
    this.fastChecks = [
      this.checkCitationIntegrity,
      this.checkTrialCitationAlignment,
      this.checkEvidenceAlignment,
      this.checkSafetyMentions,
      this.checkLimitationsMentioned,
      this.checkResponseStructure,
      this.checkBrokenStatements
    ];
    
    this.deepChecks = [
      this.checkClinicalAccuracy,
      this.checkEvidenceGrading,
      this.checkTreatmentRecommendations,
      this.checkBiomarkerMentions
    ];
    
    this.qualityThresholds = {
      fastMode: 0.6,
      standardMode: 0.7,
      researchMode: 0.8
    };
  }

  /**
   * Executa verificaÃ§Ã£o de qualidade da resposta
   * @param {string} response - Resposta gerada pelo assistente
   * @param {Array} articles - Artigos cientÃ­ficos utilizados
   * @param {string} mode - Modo de operaÃ§Ã£o (fastMode, standardMode, researchMode)
   * @returns {Object} RelatÃ³rio de qualidade
   */
  async performQualityCheck(response, articles, mode = 'standardMode') {
    const startTime = Date.now();
    const config = this.getQualityConfig(mode);
    
    try {
      // ðŸ” VerificaÃ§Ãµes rÃ¡pidas (sempre executadas)
      const fastResults = await this.runFastChecks(response, articles);
      
      // ðŸ”¬ VerificaÃ§Ãµes profundas (apenas se configurado)
      let deepResults = null;
      if (config.enableDeepChecks) {
        deepResults = await this.runDeepChecks(response, articles);
      }
      
      const totalTime = Date.now() - startTime;
      const overallScore = this.calculateOverallScore(fastResults, deepResults, config);
      
      const qualityReport = {
        score: overallScore,
        fastChecks: fastResults,
        deepChecks: deepResults,
        criticalIssues: this.identifyCriticalIssues(fastResults, deepResults),
        suggestions: this.generateImprovementSuggestions(fastResults, deepResults, overallScore),
        checkTime: totalTime,
        timestamp: new Date().toISOString(),
        mode: mode,
        config: config
      };
      
      logger.info(`Quality check completed in ${totalTime}ms with score: ${overallScore.toFixed(2)}`);
      
      return qualityReport;
      
    } catch (error) {
      logger.error(`Quality check failed: ${error.message}`);
      return {
        score: 0.5,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Executa verificaÃ§Ãµes rÃ¡pidas (< 100ms)
   */
  async runFastChecks(response, articles) {
    const results = {};
    
    for (const check of this.fastChecks) {
      try {
        const startTime = Date.now();
        results[check.name] = await check.call(this, response, articles);
        const checkTime = Date.now() - startTime;
        
        // Log se demorar mais de 50ms
        if (checkTime > 50) {
          logger.warn(`Fast check ${check.name} took ${checkTime}ms (expected < 50ms)`);
        }
        
      } catch (error) {
        results[check.name] = { 
          passed: false, 
          error: error.message,
          score: 0 
        };
      }
    }
    
    return results;
  }

  /**
   * Executa verificaÃ§Ãµes profundas (pode demorar mais)
   */
  async runDeepChecks(response, articles) {
    const results = {};
    
    for (const check of this.deepChecks) {
      try {
        results[check.name] = await check.call(this, response, articles);
      } catch (error) {
        results[check.name] = { 
          passed: false, 
          error: error.message,
          score: 0 
        };
      }
    }
    
    return results;
  }

  // ===== VERIFICAÃ‡Ã•ES RÃPIDAS =====

  /**
   * Verifica integridade das citaÃ§Ãµes [1], [2], etc.
   */
  async checkCitationIntegrity(response, articles) {
    const citationPattern = /\[(\d+)\]/g;
    const citations = [...response.matchAll(citationPattern)].map(m => parseInt(m[1]));
    
    if (citations.length === 0) {
      return {
        passed: true,
        score: 1.0,
        details: { 
          citationCount: 0, 
          articleCount: articles.length,
          message: 'No citations found - acceptable for general questions'
        }
      };
    }
    
    const maxCitation = Math.max(...citations);
    const articleCount = articles.length;
    const citationGap = Math.max(0, maxCitation - articleCount);
    
    return {
      passed: citationGap === 0,
      score: Math.max(0, 1 - (citationGap / Math.max(articleCount, 1))),
      details: {
        citationCount: citations.length,
        maxCitation,
        articleCount,
        citationGap,
        message: citationGap > 0 ? 
          `Citations [1]-[${maxCitation}] but only ${articleCount} articles available` :
          'All citations are valid'
      }
    };
  }

  /**
   * Verifica se nomes de ensaios clínicos mencionados na resposta correspondem
   * aos artigos citados. Exemplo: se a resposta diz "KEYNOTE-158 [2]", o artigo
   * na posição [2] deve mencionar "KEYNOTE-158" no título ou abstract.
   */
  async checkTrialCitationAlignment(response, articles) {
    if (!articles || articles.length === 0) {
      return { passed: true, score: 1.0, details: { message: 'No articles — skipped' } };
    }

    // Match patterns like "KEYNOTE-158 trial [2]", "the MONARCH-3 study [1,3]", "CheckMate 816 [4]"
    const trialCitationPattern = /\b([A-Z][A-Za-z]*[-\s]?\d{2,4}(?:[A-Za-z])?)\b[^[]{0,40}\[(\d+(?:\s*,\s*\d+)*)\]/g;
    const mismatches = [];
    let totalChecked = 0;

    for (const match of response.matchAll(trialCitationPattern)) {
      const trialName = match[1].trim();
      const citedIndices = match[2].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));

      // Skip very short or generic patterns that are unlikely to be trial names
      if (trialName.length < 4) continue;
      // Skip patterns that are clearly not trial names (e.g., "Table 1", "Grade 3")
      if (/^(Table|Grade|Stage|Phase|Group|Class|Level|Score|Type)\b/i.test(trialName)) continue;

      for (const idx of citedIndices) {
        const article = articles[idx - 1];
        if (!article) continue;

        totalChecked++;
        const articleText = `${article.title || ''} ${article.abstract || ''} ${article.trialName || ''}`.toLowerCase();
        const trialNameLower = trialName.toLowerCase().replace(/[-\s]+/g, '[-\\s]?');
        const trialRegex = new RegExp(trialNameLower);

        if (!trialRegex.test(articleText)) {
          mismatches.push({
            trialName,
            citedIndex: idx,
            articleTitle: (article.title || '').substring(0, 120),
            articlePmid: article.pmid
          });
        }
      }
    }

    const mismatchCount = mismatches.length;
    const score = totalChecked === 0 ? 1.0 : Math.max(0, 1 - (mismatchCount / totalChecked));

    return {
      passed: mismatchCount === 0,
      score,
      details: {
        totalChecked,
        mismatchCount,
        mismatches: mismatches.slice(0, 5),
        message: mismatchCount === 0
          ? `All ${totalChecked} trial-citation pairs verified`
          : `${mismatchCount}/${totalChecked} trial names do not match their cited references`
      }
    };
  }

  /**
   * Verifica se a resposta estÃ¡ alinhada com as evidÃªncias fornecidas
   */
  async checkEvidenceAlignment(response, articles) {
    if (articles.length === 0) {
      return {
        passed: true,
        score: 1.0,
        details: { 
          message: 'No articles provided - general response acceptable' 
        }
      };
    }

    // If the response uses citation markers [n], treat that as evidence anchoring
    const citationPattern = /\[(\d+)\]/g;
    const citations = [...response.matchAll(citationPattern)].map(m => parseInt(m[1]));
    if (citations.length > 0) {
      const uniqueCitations = new Set(citations);
      const maxCitation = Math.max(...uniqueCitations);
      const coverageScore = Math.min(1, uniqueCitations.size / Math.max(1, articles.length));
      const citationIntegrity = maxCitation <= articles.length;
      
      return {
        passed: citationIntegrity && coverageScore >= 0.3,
        score: citationIntegrity ? Math.max(0.5, coverageScore) : 0.2,
        details: {
          citationCount: citations.length,
          uniqueCitations: uniqueCitations.size,
          maxCitation,
          articleCount: articles.length,
          coverageScore: coverageScore.toFixed(2),
          message: citationIntegrity
            ? `Evidence alignment inferred via citations: ${uniqueCitations.size}/${articles.length} articles cited`
            : `Citation index exceeds available articles: [1]-[${maxCitation}] vs ${articles.length}`
        }
      };
    }
    
    const responseLower = response.toLowerCase();
    let evidenceMatches = 0;
    const matchedArticles = [];
    
    articles.forEach(article => {
      const title = (article.title || '').toLowerCase();
      const journal = (article.journal || '').toLowerCase();
      const authorsRaw = article.authors || '';
      const authors = Array.isArray(authorsRaw) ? authorsRaw.join(' ') : authorsRaw;
      const authorsLower = authors.toLowerCase();
      
      // Verificar se elementos do artigo aparecem na resposta
      const titleWords = title.split(' ').filter(word => word.length > 3);
      const hasTitleMatch = titleWords.some(word => responseLower.includes(word));
      const hasJournalMatch = journal && responseLower.includes(journal);
      const hasAuthorMatch = authorsLower && authorsLower.split(' ').some(author =>
        author.length > 2 && responseLower.includes(author)
      );
      
      if (hasTitleMatch || hasJournalMatch || hasAuthorMatch) {
        evidenceMatches++;
        matchedArticles.push({
          pmid: article.pmid,
          title: article.title,
          matchType: [hasTitleMatch && 'title', hasJournalMatch && 'journal', hasAuthorMatch && 'author'].filter(Boolean)
        });
      }
    });
    
    const alignmentScore = evidenceMatches / articles.length;
    
    return {
      passed: alignmentScore >= 0.5,
      score: alignmentScore,
      details: {
        evidenceMatches,
        totalArticles: articles.length,
        alignmentScore: alignmentScore.toFixed(2),
        matchedArticles: matchedArticles.slice(0, 3), // Primeiros 3 para nÃ£o sobrecarregar
        message: `Evidence alignment: ${evidenceMatches}/${articles.length} articles referenced`
      }
    };
  }

  /**
   * Verifica se a resposta menciona consideraÃ§Ãµes de seguranÃ§a
   */
  async checkSafetyMentions(response, articles) {
    const safetyKeywords = [
      'seguranÃ§a', 'safety', 'toxicidade', 'toxicity', 'efeitos secundÃ¡rios', 
      'adverse', 'side effects', 'reaÃ§Ã£o adversa', 'adverse reaction',
      'monitorizaÃ§Ã£o', 'monitoring', 'vigilÃ¢ncia', 'surveillance'
    ];
    
    const responseLower = response.toLowerCase();
    const foundKeywords = safetyKeywords.filter(keyword => 
      responseLower.includes(keyword)
    );
    
    const hasSafetyInfo = foundKeywords.length > 0;
    
    return {
      passed: hasSafetyInfo,
      score: hasSafetyInfo ? 1.0 : 0.4,
      details: {
        safetyMentioned: hasSafetyInfo,
        foundKeywords: foundKeywords.slice(0, 5),
        totalKeywords: safetyKeywords.length,
        message: hasSafetyInfo ? 
          `Safety considerations mentioned (${foundKeywords.length} keywords)` :
          'No safety considerations found'
      }
    };
  }

  /**
   * Verifica se a resposta menciona limitaÃ§Ãµes e incertezas
   */
  async checkLimitationsMentioned(response, articles) {
    const limitationKeywords = [
      'limitaÃ§Ã£o', 'limitation', 'incerteza', 'uncertainty', 'gap', 'lacuna',
      'limitaÃ§Ã£o', 'limitation', 'restriÃ§Ã£o', 'restriction', 'caveat',
      'necessita mais investigaÃ§Ã£o', 'needs more research', 'futuro estudo'
    ];
    
    const responseLower = response.toLowerCase();
    const foundKeywords = limitationKeywords.filter(keyword => 
      responseLower.includes(keyword)
    );
    
    const hasLimitations = foundKeywords.length > 0;
    
    return {
      passed: hasLimitations,
      score: hasLimitations ? 1.0 : 0.5,
      details: {
        limitationsMentioned: hasLimitations,
        foundKeywords: foundKeywords.slice(0, 5),
        message: hasLimitations ? 
          `Limitations acknowledged (${foundKeywords.length} keywords)` :
          'No limitations or uncertainties mentioned'
      }
    };
  }

  /**
   * Verifica estrutura bÃ¡sica da resposta
   */
  async checkResponseStructure(response, articles) {
    const hasCitations = /\[\d+\]/.test(response);
    const isQuickReviewFormat = /##\s*quick study review/i.test(response);

    // Quick-study mode: just needs the header and citations
    if (isQuickReviewFormat) {
      const hasReadinessLine = /readiness|prontid[aã]o|recent studies|estudos recentes|median n|mediana n|grade|anos|years/i.test(response);
      const quickScore = [isQuickReviewFormat, hasCitations || hasReadinessLine].filter(Boolean).length / 2;
      return {
        passed: quickScore >= 0.5,
        score: quickScore,
        details: { mode: 'quick', structureScore: quickScore.toFixed(2), message: `Quick structure score: ${quickScore.toFixed(2)}/1.0` }
      };
    }

    // Prose narrative mode: reward clinical content, not formatting scaffolding
    const hasSafety = /safety|tolerability|tolerabilidade|seguran[çc]a|adverse|toxicit/i.test(response);
    const hasGaps = /limitation|gap|lacuna|uncertainty|incerteza/i.test(response);
    const hasSubstance = /trial|study|patients|survival|response rate|efficacy|benefi/i.test(response);
    const hasClinicalClose = /clinical|practice|clinician|recommend|decision|treatment/i.test(response);
    const hasAdequateLength = response.trim().split(/\n+/).filter(l => l.trim().length > 40).length >= 2;

    const hits = [hasCitations, hasSafety, hasGaps, hasSubstance, hasClinicalClose, hasAdequateLength].filter(Boolean).length;
    const structureScore = hits / 6;

    return {
      passed: structureScore >= 0.5,
      score: structureScore,
      details: {
        mode: 'prose',
        hasCitations,
        hasSafety,
        hasGaps,
        hasSubstance,
        hasClinicalClose,
        hasAdequateLength,
        structureScore: structureScore.toFixed(2),
        message: `Prose quality score: ${structureScore.toFixed(2)}/1.0`
      }
    };
  }

  /**
   * Verifica cobertura de endpoints clínicos relevantes no texto
   */
  async checkEndpointCoverage(response, articles) {
    if (!Array.isArray(articles) || articles.length === 0) {
      return {
        passed: true,
        score: 1.0,
        details: {
          expectedEndpoints: [],
          matchedEndpoints: [],
          message: 'No evidence articles; endpoint coverage check skipped'
        }
      };
    }

    const expected = new Set();
    const addIf = (key, condition) => {
      if (condition) expected.add(key);
    };

    for (const article of articles) {
      const metrics = article?.endpointMetrics || {};
      const text = `${article?.title || ''} ${article?.abstract || ''}`.toLowerCase();
      addIf('pcr', Boolean(metrics.pcr) || /pcr|pathologic(?:al)? complete response/.test(text));
      addIf('efs', Boolean(metrics.efs) || /efs|event[- ]free survival/.test(text));
      addIf('dfs', Boolean(metrics.dfs) || /dfs|disease[- ]free survival/.test(text));
      addIf('pfs', Boolean(metrics.pfs) || /pfs|progression[- ]free survival/.test(text));
      addIf('os', Boolean(metrics.os) || /overall survival|\bos\b/.test(text));
      addIf('orr', Boolean(metrics.orr) || /objective response rate|\borr\b/.test(text));
      addIf('safety', Boolean(metrics.grade34ae) || /grade\s*3|grade\s*4|adverse events?|toxicity/.test(text));
    }

    if (expected.size === 0) {
      ['pcr', 'efs', 'os', 'safety'].forEach(key => expected.add(key));
    }

    const responseLower = String(response || '').toLowerCase();
    const endpointMatchers = {
      pcr: /pcr|pathologic(?:al)? complete response/,
      efs: /\befs\b|event[- ]free survival/,
      dfs: /\bdfs\b|disease[- ]free survival/,
      pfs: /\bpfs\b|progression[- ]free survival/,
      os: /\boverall survival\b|\bos\b/,
      orr: /\bobjective response rate\b|\borr\b/,
      safety: /grade\s*3|grade\s*4|adverse events?|toxicity|safety|tolerability/
    };

    const expectedEndpoints = Array.from(expected);
    const matchedEndpoints = expectedEndpoints.filter(key => endpointMatchers[key].test(responseLower));
    const coverage = matchedEndpoints.length / Math.max(expectedEndpoints.length, 1);
    const hasComparativeTable = /\|\s*(Study|Estudo)\s*\|/i.test(responseLower);
    const score = Math.min(1, coverage + (hasComparativeTable ? 0.1 : 0));

    return {
      passed: coverage >= 0.5,
      score,
      details: {
        expectedEndpoints,
        matchedEndpoints,
        coverage: coverage.toFixed(2),
        hasComparativeTable,
        message: `Endpoint coverage ${matchedEndpoints.length}/${expectedEndpoints.length}`
      }
    };
  }

  /**
   * Verifica frases quebradas/inacabadas na resposta final
   */
  async checkBrokenStatements(response, articles) {
    const text = String(response || '');
    const patterns = [
      /(?:specific|detailed)\s+(?:findings|results)[^.\n]{0,120}\sare\s*(?:\[[0-9,\s]+\])?\.?(?=\s|$)/gi,
      /the specific safety profiles and limitations of the studies were in the source texts\.?/gi,
      /\bwere in the source texts\.?/gi,
      /\bare\s*\[[0-9,\s]+\](?=\s|$)/gi
    ];

    const fragments = [];
    patterns.forEach(pattern => {
      const matches = text.match(pattern) || [];
      matches.forEach(match => {
        const cleaned = String(match || '').trim();
        if (cleaned.length > 0) fragments.push(cleaned);
      });
    });

    const uniqueFragments = [...new Set(fragments)];
    const count = uniqueFragments.length;
    return {
      passed: count === 0,
      score: Math.max(0, 1 - (count * 0.35)),
      details: {
        count,
        fragments: uniqueFragments.slice(0, 6),
        message: count === 0 ? 'No broken statements detected' : `${count} broken statement(s) detected`
      }
    };
  }

  // ===== VERIFICAÃ‡Ã•ES PROFUNDAS =====

  /**
   * Verifica precisÃ£o clÃ­nica (requer mais tempo)
   */
  async checkClinicalAccuracy(response, articles) {
    // VerificaÃ§Ã£o bÃ¡sica de terminologia mÃ©dica
    const medicalTerms = [
      'oncologia', 'oncology', 'cancro', 'cancer', 'tumor', 'neoplasia',
      'metastÃ¡tico', 'metastatic', 'adjuvante', 'adjuvant', 'neoadjuvante', 'neoadjuvant'
    ];
    
    const responseLower = response.toLowerCase();
    const foundTerms = medicalTerms.filter(term => 
      responseLower.includes(term)
    );
    
    const accuracyScore = foundTerms.length / medicalTerms.length;
    
    return {
      passed: accuracyScore >= 0.3,
      score: accuracyScore,
      details: {
        medicalTermsFound: foundTerms.length,
        totalMedicalTerms: medicalTerms.length,
        accuracyScore: accuracyScore.toFixed(2),
        message: `Clinical terminology accuracy: ${accuracyScore.toFixed(2)}`
      }
    };
  }

  /**
   * Verifica se menciona nÃ­veis de evidÃªncia
   */
  async checkEvidenceGrading(response, articles) {
    const gradingKeywords = [
      'grau', 'grade', 'nÃ­vel', 'level', 'evidÃªncia', 'evidence',
      'ensaios clÃ­nicos', 'clinical trials', 'meta-anÃ¡lise', 'meta-analysis',
      'revisÃ£o sistemÃ¡tica', 'systematic review'
    ];
    
    const responseLower = response.toLowerCase();
    const foundKeywords = gradingKeywords.filter(keyword => 
      responseLower.includes(keyword)
    );
    
    const gradingScore = foundKeywords.length / gradingKeywords.length;
    
    return {
      passed: gradingScore >= 0.4,
      score: gradingScore,
      details: {
        gradingKeywordsFound: foundKeywords.length,
        totalGradingKeywords: gradingKeywords.length,
        gradingScore: gradingScore.toFixed(2),
        message: `Evidence grading mentions: ${gradingScore.toFixed(2)}`
      }
    };
  }

  /**
   * Verifica recomendaÃ§Ãµes de tratamento
   */
  async checkTreatmentRecommendations(response, articles) {
    const treatmentKeywords = [
      'tratamento', 'treatment', 'terapia', 'therapy', 'protocolo', 'protocol',
      'quimioterapia', 'chemotherapy', 'imunoterapia', 'immunotherapy',
      'terapia dirigida', 'targeted therapy', 'radioterapia', 'radiotherapy'
    ];
    
    const responseLower = response.toLowerCase();
    const foundKeywords = treatmentKeywords.filter(keyword => 
      responseLower.includes(keyword)
    );
    
    const treatmentScore = foundKeywords.length / treatmentKeywords.length;
    
    return {
      passed: treatmentScore >= 0.3,
      score: treatmentScore,
      details: {
        treatmentKeywordsFound: foundKeywords.length,
        totalTreatmentKeywords: treatmentKeywords.length,
        treatmentScore: treatmentScore.toFixed(2),
        message: `Treatment recommendations: ${treatmentScore.toFixed(2)}`
      }
    };
  }

  /**
   * Verifica menÃ§Ãµes de biomarcadores
   */
  async checkBiomarkerMentions(response, articles) {
    const biomarkerKeywords = [
      'biomarcador', 'biomarker', 'pd-l1', 'pd-l1', 'her2', 'her2',
      'egfr', 'egfr', 'alk', 'alk', 'braf', 'braf', 'kras', 'kras',
      'mutation', 'mutaÃ§Ã£o', 'expressÃ£o', 'expression'
    ];
    
    const responseLower = response.toLowerCase();
    const foundKeywords = biomarkerKeywords.filter(keyword => 
      responseLower.includes(keyword)
    );
    
    const biomarkerScore = foundKeywords.length / biomarkerKeywords.length;
    
    return {
      passed: biomarkerScore >= 0.2,
      score: biomarkerScore,
      details: {
        biomarkerKeywordsFound: foundKeywords.length,
        totalBiomarkerKeywords: biomarkerKeywords.length,
        biomarkerScore: biomarkerScore.toFixed(2),
        message: `Biomarker mentions: ${biomarkerScore.toFixed(2)}`
      }
    };
  }

  // ===== UTILITÃRIOS =====

  /**
   * ObtÃ©m configuraÃ§Ã£o de qualidade baseada no modo
   */
  getQualityConfig(mode) {
    const configs = {
      fastMode: {
        enableQualityCheck: true,
        enableDeepChecks: false,
        qualityThreshold: this.qualityThresholds.fastMode,
        backgroundImprovement: false
      },
      standardMode: {
        enableQualityCheck: true,
        enableDeepChecks: true,
        qualityThreshold: this.qualityThresholds.standardMode,
        backgroundImprovement: true
      },
      researchMode: {
        enableQualityCheck: true,
        enableDeepChecks: true,
        qualityThreshold: this.qualityThresholds.researchMode,
        backgroundImprovement: true,
        enableRealTimeImprovement: false
      }
    };
    
    return configs[mode] || configs.standardMode;
  }

  /**
   * Calcula pontuaÃ§Ã£o geral baseada nos resultados
   */
  calculateOverallScore(fastResults, deepResults, config) {
    // PontuaÃ§Ã£o das verificaÃ§Ãµes rÃ¡pidas (70% do peso)
    const fastScore = Object.values(fastResults).reduce((sum, result) => 
      sum + (result.score || 0), 0) / Object.keys(fastResults).length;
    
    // Se nÃ£o hÃ¡ verificaÃ§Ãµes profundas, retorna apenas as rÃ¡pidas
    if (!deepResults || !config.enableDeepChecks) {
      return fastScore;
    }
    
    // PontuaÃ§Ã£o das verificaÃ§Ãµes profundas (30% do peso)
    const deepScore = Object.values(deepResults).reduce((sum, result) => 
      sum + (result.score || 0), 0) / Object.keys(deepResults).length;
    
    // Peso: 70% rÃ¡pidas + 30% profundas
    return (fastScore * 0.7) + (deepScore * 0.3);
  }

  /**
   * Identifica problemas crÃ­ticos que precisam de atenÃ§Ã£o
   */
  identifyCriticalIssues(fastResults, deepResults) {
    const issues = [];
    
    // Problemas crÃ­ticos das verificaÃ§Ãµes rÃ¡pidas
    if (fastResults.checkCitationIntegrity && !fastResults.checkCitationIntegrity.passed) {
      issues.push({
        type: 'CRITICAL',
        category: 'citation_integrity',
        message: 'Resposta cita artigos que nÃ£o existem',
        impact: 'high',
        details: fastResults.checkCitationIntegrity.details
      });
    }
    
    if (fastResults.checkTrialCitationAlignment && !fastResults.checkTrialCitationAlignment.passed) {
      const mismatches = fastResults.checkTrialCitationAlignment.details?.mismatches || [];
      const mismatchDetail = mismatches
        .map(m => `"${m.trialName}" cited as [${m.citedIndex}] but reference [${m.citedIndex}] is "${m.articleTitle}"`)
        .join('; ');
      issues.push({
        type: 'CRITICAL',
        category: 'trial_citation_mismatch',
        message: `Trial names do not match cited references: ${mismatchDetail}. Remove or rewrite claims about trials not present in the provided articles — do not fabricate citation mappings.`,
        impact: 'high',
        details: fastResults.checkTrialCitationAlignment.details
      });
    }

    if (fastResults.checkEvidenceAlignment && !fastResults.checkEvidenceAlignment.passed) {
      const evidenceDetails = fastResults.checkEvidenceAlignment.details || {};
      const hasCitationOverflow = typeof evidenceDetails.maxCitation === 'number' &&
        typeof evidenceDetails.articleCount === 'number' &&
        evidenceDetails.maxCitation > evidenceDetails.articleCount;
      issues.push({
        type: hasCitationOverflow ? 'CRITICAL' : 'WARNING',
        category: 'evidence_alignment',
        message: 'Resposta nÃ£o estÃ¡ alinhada com evidÃªncias fornecidas',
        impact: hasCitationOverflow ? 'high' : 'medium',
        details: evidenceDetails
      });
    }

    if (fastResults.checkBrokenStatements && !fastResults.checkBrokenStatements.passed) {
      issues.push({
        type: 'CRITICAL',
        category: 'broken_statements',
        message: 'Resposta contém frases quebradas/incompletas',
        impact: 'high',
        details: fastResults.checkBrokenStatements.details
      });
    }

    if (fastResults.checkEndpointCoverage && !fastResults.checkEndpointCoverage.passed) {
      const coverageDetails = fastResults.checkEndpointCoverage.details || {};
      issues.push({
        type: 'WARNING',
        category: 'endpoint_coverage',
        message: 'Cobertura insuficiente de endpoints clínicos relevantes',
        impact: 'medium',
        details: coverageDetails
      });
    }
    
    // Problemas de verificaÃ§Ãµes profundas (se disponÃ­veis)
    if (deepResults) {
      if (deepResults.checkClinicalAccuracy && deepResults.checkClinicalAccuracy.score < 0.3) {
        issues.push({
          type: 'WARNING',
          category: 'clinical_accuracy',
          message: 'Baixa precisÃ£o clÃ­nica na resposta',
          impact: 'medium',
          details: deepResults.checkClinicalAccuracy.details
        });
      }
    }
    
    return issues;
  }

  /**
   * Gera sugestÃµes de melhoria baseadas nos resultados
   */
  generateImprovementSuggestions(fastResults, deepResults, overallScore) {
    const suggestions = [];
    
    // SugestÃµes baseadas em verificaÃ§Ãµes rÃ¡pidas
    if (fastResults.checkCitationIntegrity && !fastResults.checkCitationIntegrity.passed) {
      suggestions.push({
        priority: 'high',
        category: 'citations',
        suggestion: 'Verificar e corrigir citaÃ§Ãµes para artigos disponÃ­veis',
        impact: 'critical'
      });
    }
    
    if (fastResults.checkTrialCitationAlignment && !fastResults.checkTrialCitationAlignment.passed) {
      suggestions.push({
        priority: 'high',
        category: 'trial_citations',
        suggestion: 'Remove trial names that are not present in any provided article, or remove incorrect citation numbers next to trial names',
        impact: 'critical'
      });
    }

    if (fastResults.checkSafetyMentions && !fastResults.checkSafetyMentions.passed) {
      suggestions.push({
        priority: 'medium',
        category: 'safety',
        suggestion: 'Adicionar consideraÃ§Ãµes de seguranÃ§a e toxicidade',
        impact: 'important'
      });
    }
    
    if (fastResults.checkLimitationsMentioned && !fastResults.checkLimitationsMentioned.passed) {
      suggestions.push({
        priority: 'medium',
        category: 'limitations',
        suggestion: 'Mencionar limitaÃ§Ãµes e incertezas da evidÃªncia',
        impact: 'important'
      });
    }

    if (fastResults.checkBrokenStatements && !fastResults.checkBrokenStatements.passed) {
      suggestions.push({
        priority: 'high',
        category: 'coherence',
        suggestion: 'Remover frases incompletas e reescrever trechos com claims numéricos sem suporte',
        impact: 'critical'
      });
    }
    
    // SugestÃµes baseadas na pontuaÃ§Ã£o geral
    if (overallScore < 0.6) {
      suggestions.push({
        priority: 'high',
        category: 'overall',
        suggestion: 'RevisÃ£o completa da resposta para melhorar qualidade geral',
        impact: 'high'
      });
    } else if (overallScore < 0.8) {
      suggestions.push({
        priority: 'medium',
        category: 'overall',
        suggestion: 'Melhorias incrementais para atingir qualidade superior',
        impact: 'medium'
      });
    }
    
    return suggestions;
  }
}

export default ResponseQualityChecker;

