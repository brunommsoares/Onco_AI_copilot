import test from 'node:test';
import assert from 'node:assert/strict';

import simpleChatService from '../src/services/simpleChatService.js';

test('filterForPlaceboComparator keeps placebo-controlled studies even when comparator extraction is sparse', () => {
  const articles = [
    {
      pmid: '40691458',
      title: 'Camrelizumab vs Placebo in Combination With Chemotherapy as Neoadjuvant Treatment in Patients With TNBC',
      abstract: 'Randomized placebo-controlled phase III trial reporting pCR 56.8%.',
      year: '2025'
    },
    {
      pmid: '33208340',
      title: 'NeoSTOP randomized trial in triple-negative breast cancer',
      abstract: 'Open-label randomized study without placebo comparator.',
      year: '2021'
    }
  ];
  const evidenceSummaries = [
    { index: 1, comparator: null },
    { index: 2, comparator: null }
  ];

  const filtered = simpleChatService.filterForPlaceboComparator(articles, evidenceSummaries);

  assert.equal(filtered.articles.length, 1);
  assert.equal(filtered.articles[0].pmid, '40691458');
});

test('buildDeterministicDetailedAnswer distinguishes direct placebo evidence from indirect supportive studies', () => {
  const articles = [
    {
      pmid: '39671272',
      title: 'Camrelizumab vs Placebo in Combination With Chemotherapy as Neoadjuvant Treatment in Patients With TNBC',
      trialName: 'Camrelizumab vs Placebo',
      studyDesign: 'Randomized clinical trial',
      year: '2025',
      endpointMetrics: { pcr: '56.8%' }
    },
    {
      pmid: '38588696',
      title: 'The PARTNER trial of neoadjuvant olaparib with chemotherapy in triple-negative breast cancer',
      trialName: 'PARTNER',
      studyDesign: 'Clinical trial',
      year: '2024',
      endpointMetrics: { pcr: '51%', efs: '80%' }
    }
  ];
  const evidenceSummaries = [
    {
      index: 1,
      comparator: 'placebo',
      intervention: 'camrelizumab + chemotherapy',
      limitations: 'OS immature.'
    },
    {
      index: 2,
      comparator: 'single-arm/no control',
      intervention: 'olaparib + chemotherapy',
      limitations: 'Single-arm signal with immature OS.'
    }
  ];
  const quickStats = {
    readinessScore: 68,
    grade: 'Moderate',
    yearRange: '2024-2025',
    recentCount: 2,
    rctCount: 1,
    medianSampleSize: 160
  };

  const answer = simpleChatService.buildDeterministicDetailedAnswer(
    'In TNBC, what is the evidence for neoadjuvant therapy versus placebo?',
    articles,
    evidenceSummaries,
    quickStats,
    {
      comparator: 'placebo',
      requirePlaceboComparator: true,
      responseLanguage: 'en'
    }
  );

  assert.match(answer, /The most directly relevant study is Camrelizumab vs Placebo \[1\]/i);
  assert.match(answer, /For the placebo comparison, only 1\/2 study\/studies addressed it directly/i);
  assert.match(answer, /The remaining papers, such as PARTNER \[2\], mostly add context or indirect signal/i);
  assert.match(answer, /Overall, the retrieved evidence is insufficient for a firm comparative conclusion \[1\]/i);
  assert.doesNotMatch(answer, /PARTNER also showed a favorable signal/i);
});

test('buildDeterministicDetailedAnswer provides fuller narrative in detailed mode', () => {
  const articles = [
    {
      pmid: '39282906',
      title: 'Overall Survival with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer',
      trialName: 'KEYNOTE-522',
      studyDesign: 'Randomized controlled trial',
      year: '2024',
      endpointMetrics: { os: '86.6%', efs: '81.3%', pcr: '64.8%' }
    },
    {
      pmid: '37612624',
      title: 'Neoadjuvant immunotherapy and chemotherapy regimens for the treatment of high-risk, early-stage triple-negative breast cancer: a systematic review and network meta-analysis',
      studyDesign: 'Systematic review and network meta-analysis',
      year: '2023'
    }
  ];
  const evidenceSummaries = [
    {
      index: 1,
      study_design: 'Randomized controlled trial',
      population: 'Patients with high-risk early-stage TNBC',
      comparator: 'placebo',
      intervention: 'pembrolizumab plus chemotherapy',
      outcomes: 'OS, EFS/DFS/PFS, pCR',
      key_findings: 'Pembrolizumab improved overall survival, event-free survival, and pathologic complete response versus placebo.',
      evidence_strength: 'high'
    },
    {
      index: 2,
      analysis_type: 'synthesis',
      study_design: 'Systematic review and network meta-analysis',
      comparator: 'other neoadjuvant treatments',
      intervention: 'pembrolizumab-based regimens',
      outcomes: 'EFS/DFS/PFS, pCR',
      key_findings: 'Indirect comparisons favored pembrolizumab-based regimens.',
      evidence_strength: 'moderate',
      endpoint_claims: [
        {
          endpoint: 'EFS/DFS/PFS',
          direction: 'positive',
          maturity: 'reported',
          support_level: 'indirect',
          effect_size_text: null,
          population_scope: 'overall'
        }
      ]
    }
  ];

  const answer = simpleChatService.buildDeterministicDetailedAnswer(
    'In early-stage TNBC, what is the evidence for event-free survival versus placebo?',
    articles,
    evidenceSummaries,
    {
      readinessScore: 84,
      grade: 'High',
      yearRange: '2023-2024',
      recentCount: 2,
      rctCount: 1,
      medianSampleSize: 1174
    },
    {
      responseLanguage: 'en',
      comparator: 'placebo',
      requirePlaceboComparator: true,
      outcomes: 'EFS/DFS/PFS'
    }
  );

  assert.match(answer, /This randomized controlled trial evaluated pembrolizumab plus chemotherapy versus placebo in Patients with high-risk early-stage TNBC\./i);
  assert.match(answer, /For this question, the evidence suggests benefit\./i);
  assert.match(answer, /The most directly relevant study is KEYNOTE-522 \[1\]/i);
  assert.match(answer, /Other papers in the set.*are mainly helpful for context, consistency, or related questions rather than the core comparison\./i);
  assert.match(answer, /this limits cross-trial safety comparisons between regimens\./i);
  assert.doesNotMatch(answer, /^\s*[-*]\s+/m);
  assert.doesNotMatch(answer, /\n\|.*\|\n\| ---/i);
});

test('buildDeterministicDetailedAnswer calls out insufficient evidence when nominally direct studies are sparse and non-directional', () => {
  const articles = [
    {
      pmid: '34045175',
      title: 'Bone-modifying Agents (BMAs) in Breast Cancer.',
      studyDesign: 'Randomized trial',
      year: '2021',
      endpointMetrics: { os: 'reported' }
    },
    {
      pmid: '21060033',
      title: 'Denosumab compared with zoledronic acid for the treatment of bone metastases in patients with advanced breast cancer: a randomized, double-blind study.',
      studyDesign: 'Randomized controlled trial',
      year: '2010',
      endpointMetrics: { os: 'reported' }
    },
    {
      pmid: '35860287',
      title: 'Cancer Treatment-Induced Bone Loss: Role of Denosumab in Non-Metastatic Breast Cancer.',
      studyDesign: 'Review',
      year: '2022'
    }
  ];
  const evidenceSummaries = [
    {
      index: 1,
      comparator: 'active control',
      intervention: 'bone-modifying agents',
      outcomes: 'OS',
      key_findings: 'Reported OS without a clear directional estimate.',
      evidence_strength: 'moderate',
      endpoint_claims: [
        {
          endpoint: 'OS',
          direction: 'neutral',
          maturity: 'reported',
          support_level: 'direct',
          effect_size_text: null,
          population_scope: 'overall'
        }
      ]
    },
    {
      index: 2,
      comparator: 'placebo',
      intervention: 'zoledronic acid',
      outcomes: 'OS',
      key_findings: 'Did not show a clear advantage in OS.',
      evidence_strength: 'moderate',
      endpoint_claims: [
        {
          endpoint: 'OS',
          direction: 'neutral',
          maturity: 'reported',
          support_level: 'direct',
          effect_size_text: null,
          population_scope: 'overall'
        }
      ]
    },
    {
      index: 3,
      analysis_type: 'synthesis',
      study_design: 'Review',
      key_findings: 'Contextual review of denosumab use in breast cancer.',
      evidence_strength: 'low'
    }
  ];

  const answer = simpleChatService.buildDeterministicDetailedAnswer(
    'zometa evidence in breast cancer',
    articles,
    evidenceSummaries,
    {
      readinessScore: 65,
      grade: 'Moderate',
      yearRange: '2010-2022',
      recentCount: 1,
      rctCount: 2,
      medianSampleSize: 1822
    },
    {
      responseLanguage: 'en',
      intervention: 'zoledronic acid'
    }
  );

  assert.match(answer, /available evidence on zoledronic acid is too limited, indirect, or heterogeneous to support a clear conclusion/i);
  assert.match(answer, /Overall, the retrieved evidence is insufficient for a firm comparative conclusion/i);
  assert.doesNotMatch(answer, /provides the clearest signal in this set/i);
});

test('buildEvidenceSuitabilityAssessment marks weak mixed direct evidence as borderline instead of forcing abstention', () => {
  const articles = [
    {
      pmid: '34045175',
      title: 'Bone-modifying Agents (BMAs) in Breast Cancer.',
      studyDesign: 'Randomized trial',
      year: '2021',
      endpointMetrics: { os: 'reported' }
    },
    {
      pmid: '21060033',
      title: 'Denosumab compared with zoledronic acid for the treatment of bone metastases in patients with advanced breast cancer: a randomized, double-blind study.',
      studyDesign: 'Randomized controlled trial',
      year: '2010',
      endpointMetrics: { os: 'reported' }
    },
    {
      pmid: '35860287',
      title: 'Cancer Treatment-Induced Bone Loss: Role of Denosumab in Non-Metastatic Breast Cancer.',
      studyDesign: 'Review',
      year: '2022'
    }
  ];
  const evidenceSummaries = [
    {
      index: 1,
      comparator: 'active control',
      intervention: 'bone-modifying agents',
      outcomes: 'OS',
      key_findings: 'Reported OS without a clear directional estimate.',
      evidence_strength: 'moderate',
      endpoint_claims: [
        {
          endpoint: 'OS',
          direction: 'neutral',
          maturity: 'reported',
          support_level: 'direct',
          effect_size_text: null,
          population_scope: 'overall'
        }
      ]
    },
    {
      index: 2,
      comparator: 'placebo',
      intervention: 'zoledronic acid',
      outcomes: 'OS',
      key_findings: 'Did not show a clear advantage in OS.',
      evidence_strength: 'moderate',
      endpoint_claims: [
        {
          endpoint: 'OS',
          direction: 'neutral',
          maturity: 'reported',
          support_level: 'direct',
          effect_size_text: null,
          population_scope: 'overall'
        }
      ]
    },
    {
      index: 3,
      analysis_type: 'synthesis',
      study_design: 'Review',
      key_findings: 'Contextual review of denosumab use in breast cancer.',
      evidence_strength: 'low'
    }
  ];

  const adequacy = simpleChatService.buildEvidenceSuitabilityAssessment(
    'zometa evidence in breast cancer',
    articles,
    evidenceSummaries,
    {
      readinessScore: 65,
      grade: 'Moderate',
      yearRange: '2010-2022',
      recentCount: 1,
      rctCount: 2,
      medianSampleSize: 1822
    },
    {
      responseLanguage: 'en',
      intervention: 'zoledronic acid'
    }
  );

  assert.equal(adequacy.status, 'borderline');
  assert.equal(adequacy.abstain, false);
  assert.match(adequacy.message, /can be summarized, but interpretation should stay cautious/i);
  assert.ok(
    adequacy.reasons.some((reason) => /did not provide a clear directional effect/i.test(reason)),
    'expected a non-directional evidence reason'
  );
});

test('buildInsufficientEvidenceAnswer does not narrate generic reviews as closest studies when no direct evidence exists', () => {
  const articles = [
    {
      pmid: '1',
      title: 'Benefits of Bisphosphonate Therapy: Beyond the Skeleton.',
      studyDesign: 'Review',
      year: '2021'
    },
    {
      pmid: '2',
      title: 'Bisphosphonates in early and locally advanced breast cancer: a systematic review',
      studyDesign: 'Systematic review',
      year: '2022',
      endpointMetrics: { os: 'reported' }
    }
  ];
  const evidenceSummaries = [
    {
      index: 1,
      study_design: 'Review',
      key_findings: 'Contextual discussion of bisphosphonate mechanisms.',
      evidence_strength: 'low'
    },
    {
      index: 2,
      analysis_type: 'synthesis',
      study_design: 'Systematic review',
      comparator: 'placebo',
      outcomes: 'OS',
      key_findings: 'Indirect evidence did not show a clear advantage in OS.',
      evidence_strength: 'moderate'
    }
  ];

  const adequacy = simpleChatService.buildEvidenceSuitabilityAssessment(
    'zometa evidence in breast cancer',
    articles,
    evidenceSummaries,
    {
      readinessScore: 68,
      grade: 'Moderate',
      yearRange: '2021-2022',
      recentCount: 2,
      rctCount: 0,
      medianSampleSize: null
    },
    {
      responseLanguage: 'en',
      intervention: 'zoledronic acid'
    }
  );

  const answer = simpleChatService.buildInsufficientEvidenceAnswer(
    'zometa evidence in breast cancer',
    articles,
    evidenceSummaries,
    adequacy,
    {
      responseLanguage: 'en',
      intervention: 'zoledronic acid'
    }
  );

  assert.equal(adequacy.abstain, true);
  assert.match(answer, /The retrieved papers do not support a reliable comparative answer/i);
  assert.doesNotMatch(answer, /closest study to the question/i);
  assert.doesNotMatch(answer, /most relevant direct study/i);
  assert.doesNotMatch(answer, /Benefits of Bisphosphonate Therapy/i);
  assert.doesNotMatch(answer, /early and locally advanced breast cancer/i);
});

test('isGenericTopicPublication keeps broad bisphosphonate topic titles generic even if the abstract mentions a randomized trial', () => {
  const article = {
    title: 'Bone-modifying Agents (BMAs) in Breast Cancer.',
    abstract: 'Randomized trial evidence and comparative analyses were reviewed across breast cancer settings.',
    studyDesign: 'Randomized trial'
  };

  assert.equal(simpleChatService.isGenericTopicPublication(article, null), true);
});

test('enforceDetailedAnswerQuality keeps a concise natural answer for mixed limited evidence', () => {
  const articles = [
    {
      pmid: '34045175',
      title: 'Bone-modifying Agents (BMAs) in Breast Cancer.',
      studyDesign: 'Randomized trial',
      year: '2021',
      endpointMetrics: { os: 'reported' }
    },
    {
      pmid: '21060033',
      title: 'Denosumab compared with zoledronic acid for the treatment of bone metastases in patients with advanced breast cancer: a randomized, double-blind study.',
      studyDesign: 'Randomized controlled trial',
      year: '2010',
      endpointMetrics: { os: 'reported' }
    }
  ];
  const evidenceSummaries = [
    {
      index: 1,
      comparator: 'active control',
      intervention: 'bone-modifying agents',
      outcomes: 'OS',
      key_findings: 'Reported OS without a clear directional estimate.',
      evidence_strength: 'moderate',
      endpoint_claims: [
        {
          endpoint: 'OS',
          direction: 'neutral',
          maturity: 'reported',
          support_level: 'direct',
          effect_size_text: null,
          population_scope: 'overall'
        }
      ]
    },
    {
      index: 2,
      comparator: 'placebo',
      intervention: 'zoledronic acid',
      outcomes: 'OS',
      key_findings: 'Did not show a clear advantage in OS.',
      evidence_strength: 'moderate',
      endpoint_claims: [
        {
          endpoint: 'OS',
          direction: 'neutral',
          maturity: 'reported',
          support_level: 'direct',
          effect_size_text: null,
          population_scope: 'overall'
        }
      ]
    }
  ];
  const draft = [
    'The evidence on Zometa in breast cancer is limited and mixed [1] [2].',
    'A broad breast cancer randomized study did not provide a clear OS signal, and a denosumab versus zoledronic acid metastatic study also did not show a clear OS advantage, but these studies address different settings and do not cleanly answer the same clinical question [1] [2].'
  ].join('\n\n');

  const answer = simpleChatService.enforceDetailedAnswerQuality(
    draft,
    'zometa evidence in breast cancer',
    articles,
    evidenceSummaries,
    {
      readinessScore: 65,
      grade: 'Moderate',
      yearRange: '2010-2022',
      recentCount: 1,
      rctCount: 2,
      medianSampleSize: 1822
    },
    {
      responseLanguage: 'en',
      qualityScore: 0.74
    }
  );

  assert.equal(answer, draft);
});

test('buildDeterministicDetailedAnswer demotes generic melanoma reviews instead of treating them as core comparative trials', () => {
  const articles = [
    {
      pmid: '1',
      title: 'Immune checkpoint inhibitors in melanoma.',
      studyDesign: 'Phase III',
      year: '2021',
      endpointMetrics: { os: 'reported', efs: 'reported' }
    },
    {
      pmid: '2',
      title: 'Melanoma neoadjuvant treatment: review and update of recent trials.',
      studyDesign: 'Comparative study',
      year: '2022',
      endpointMetrics: { efs: 'reported' }
    },
    {
      pmid: '5',
      title: 'S1801',
      studyDesign: 'Randomized trial',
      year: '2023',
      endpointMetrics: { efs: '72%', os: 'reported' }
    }
  ];
  const evidenceSummaries = [
    {
      index: 1,
      comparator: 'active control',
      intervention: 'immune checkpoint inhibitors',
      outcomes: 'OS, EFS/DFS/PFS',
      key_findings: 'Reported OS and EFS/DFS/PFS.',
      evidence_strength: 'high'
    },
    {
      index: 2,
      comparator: 'active control',
      intervention: 'melanoma neoadjuvant treatment',
      outcomes: 'EFS/DFS/PFS',
      key_findings: 'Showed benefit in EFS/DFS/PFS.',
      evidence_strength: 'moderate'
    },
    {
      index: 3,
      comparator: 'active control',
      intervention: 'pembrolizumab neoadjuvant-adjuvant strategy',
      outcomes: 'EFS/DFS/PFS, OS',
      key_findings: 'Showed benefit in EFS/DFS/PFS.',
      evidence_strength: 'high'
    }
  ];

  const answer = simpleChatService.buildDeterministicDetailedAnswer(
    'melanoma neoadjuvant immunotherapy evidence',
    articles,
    evidenceSummaries,
    {
      readinessScore: 66,
      grade: 'Moderate',
      yearRange: '2021-2023',
      recentCount: 2,
      rctCount: 1,
      medianSampleSize: 313
    },
    {
      responseLanguage: 'en',
      outcomes: 'EFS/DFS/PFS, OS'
    }
  );

  assert.match(answer, /available evidence is too limited, indirect, or heterogeneous to support a clear conclusion/i);
  assert.match(answer, /remaining papers.*Immune checkpoint inhibitors in melanoma\./i);
  assert.match(answer, /remaining papers.*Melanoma neoadjuvant treatment: review and update of recent trials\./i);
  assert.doesNotMatch(answer, /Immune checkpoint inhibitors in melanoma\..*provides the clearest signal/i);
  assert.doesNotMatch(answer, /Melanoma neoadjuvant treatment: review and update of recent trials\..*adds additional comparative evidence/i);
});

test('trimEvidenceForDetailedAnswer drops background biomarker papers when enough clinically actionable studies exist', () => {
  const articles = [
    {
      pmid: '1',
      title: 'Triple-Negative Breast Cancer and Predictive Markers of Response to Neoadjuvant Chemotherapy',
      studyDesign: 'Systematic review',
      year: '2023'
    },
    {
      pmid: '2',
      title: 'Overall Survival with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer',
      trialName: 'KEYNOTE-522',
      studyDesign: 'Randomized, phase 3 trial',
      year: '2024',
      endpointMetrics: { os: '86.6%', efs: '81.3%', pcr: '64.8%' }
    },
    {
      pmid: '3',
      title: 'Event-free survival by residual cancer burden with pembrolizumab in early-stage TNBC: exploratory analysis from KEYNOTE-522',
      trialName: 'KEYNOTE-522',
      studyDesign: 'Exploratory analysis from a randomized, phase 3 trial',
      year: '2024',
      endpointMetrics: { efs: '84.5%' }
    },
    {
      pmid: '4',
      title: 'Camrelizumab vs Placebo in Combination With Chemotherapy as Neoadjuvant Treatment in Patients With Early or Locally Advanced TNBC',
      trialName: 'CamRelief',
      studyDesign: 'Randomized clinical trial',
      year: '2025',
      endpointMetrics: { pcr: '56.8%' }
    },
    {
      pmid: '5',
      title: 'Neoadjuvant immunotherapy and chemotherapy regimens for the treatment of high-risk, early-stage TNBC: a systematic review and network meta-analysis',
      studyDesign: 'Systematic review and network meta-analysis',
      year: '2023'
    }
  ];
  const evidenceSummaries = [
    {
      index: 1,
      study_design: 'Systematic review',
      population: 'Patients with primary invasive TNBC without distant metastases',
      outcomes: 'pCR',
      key_findings: 'High PD-L1, TILs, and Ki-67 were associated with pCR.',
      evidence_strength: 'moderate'
    },
    {
      index: 2,
      study_design: 'Randomized, phase 3 trial',
      comparator: 'placebo',
      intervention: 'pembrolizumab plus chemotherapy',
      key_findings: 'Pembrolizumab improved overall survival, pCR, and event-free survival versus placebo.',
      evidence_strength: 'high'
    },
    {
      index: 3,
      study_design: 'Exploratory analysis from a randomized, phase 3 trial',
      comparator: 'placebo',
      intervention: 'pembrolizumab plus chemotherapy followed by adjuvant pembrolizumab',
      key_findings: 'Pembrolizumab shifted patients into lower residual cancer burden categories and improved event-free survival.',
      evidence_strength: 'moderate'
    },
    {
      index: 4,
      study_design: 'Randomized clinical trial',
      comparator: 'placebo',
      intervention: 'camrelizumab plus chemotherapy',
      key_findings: 'Camrelizumab improved pCR versus placebo plus chemotherapy.',
      evidence_strength: 'high'
    },
    {
      index: 5,
      study_design: 'Systematic review and network meta-analysis',
      comparator: 'other neoadjuvant regimens',
      intervention: 'pembrolizumab-based regimens',
      key_findings: 'Pembrolizumab-based regimens ranked favorably.',
      evidence_strength: 'moderate'
    }
  ];

  const prepared = simpleChatService.trimEvidenceForDetailedAnswer(
    articles,
    evidenceSummaries,
    'In early-stage TNBC, compare neoadjuvant immunotherapy regimens.',
    {
      responseLanguage: 'en'
    }
  );

  assert.equal(prepared.articles[0].trialName, 'KEYNOTE-522');
  assert.equal(prepared.articles[1].trialName, 'CamRelief');
  assert.equal(prepared.articles.some(article => /Predictive Markers of Response/i.test(article.title)), false);
});

test('trimEvidenceForDetailedAnswer collapses duplicate trial publications and keeps the main efficacy paper', () => {
  const articles = [
    {
      pmid: '39282906',
      title: 'Overall Survival with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer',
      trialName: 'KEYNOTE-522',
      studyDesign: 'Randomized controlled trial',
      year: '2024',
      endpointMetrics: { os: '86.6%', efs: '81.3%', pcr: '64.8%' }
    },
    {
      pmid: '38913881',
      title: 'Neoadjuvant pembrolizumab plus chemotherapy/adjuvant pembrolizumab for early-stage triple-negative breast cancer: quality-of-life results from the randomized KEYNOTE-522 study',
      trialName: 'KEYNOTE-522',
      studyDesign: 'Randomized controlled trial',
      year: '2024'
    },
    {
      pmid: '39671272',
      title: 'Camrelizumab vs Placebo in Combination With Chemotherapy as Neoadjuvant Treatment in Patients With Early or Locally Advanced Triple-Negative Breast Cancer',
      trialName: 'CamRelief',
      studyDesign: 'Randomized, double-blind, phase 3 trial',
      year: '2025',
      endpointMetrics: { pcr: '56.8%' }
    }
  ];
  const evidenceSummaries = [
    {
      index: 1,
      study_design: 'Randomized controlled trial',
      comparator: 'placebo',
      intervention: 'pembrolizumab plus chemotherapy',
      outcomes: 'OS, EFS, pCR',
      key_findings: 'Pembrolizumab improved overall survival, pCR, and event-free survival versus placebo.',
      evidence_strength: 'high'
    },
    {
      index: 2,
      study_design: 'Randomized controlled trial',
      comparator: 'placebo',
      intervention: 'pembrolizumab plus chemotherapy followed by adjuvant pembrolizumab',
      outcomes: 'quality of life',
      key_findings: 'No clinically meaningful deterioration in quality of life was seen.',
      evidence_strength: 'moderate'
    },
    {
      index: 3,
      study_design: 'Randomized, double-blind, phase 3 trial',
      comparator: 'placebo',
      intervention: 'camrelizumab plus chemotherapy',
      outcomes: 'pCR',
      key_findings: 'Camrelizumab improved pCR versus placebo plus chemotherapy.',
      evidence_strength: 'high'
    }
  ];

  const prepared = simpleChatService.trimEvidenceForDetailedAnswer(
    articles,
    evidenceSummaries,
    'In early-stage TNBC, compare neoadjuvant immunotherapy regimens.',
    {
      responseLanguage: 'en'
    }
  );

  assert.equal(prepared.articles.filter(article => article.trialName === 'KEYNOTE-522').length, 1);
  assert.equal(prepared.articles[0].pmid, '39282906');
});

test('aggregateTrialEvidence merges endpoint data from multiple publications of the same trial', () => {
  const articles = [
    {
      pmid: '11111111',
      title: 'Pathological Complete Response with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer',
      trialName: 'KEYNOTE-522',
      studyDesign: 'Randomized controlled trial',
      year: '2023',
      endpointMetrics: { pcr: '64.8%', efs: '84.5%' }
    },
    {
      pmid: '39282906',
      title: 'Overall Survival with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer',
      trialName: 'KEYNOTE-522',
      studyDesign: 'Randomized controlled trial',
      year: '2024',
      endpointMetrics: { os: '86.6%' }
    }
  ];
  const evidenceSummaries = [
    {
      index: 1,
      study_design: 'Randomized controlled trial',
      comparator: 'placebo plus chemotherapy',
      intervention: 'pembrolizumab plus chemotherapy',
      outcomes: 'pCR, EFS',
      key_findings: 'Pembrolizumab improved pathological complete response and event-free survival.',
      evidence_strength: 'high'
    },
    {
      index: 2,
      study_design: 'Randomized controlled trial',
      comparator: 'placebo plus chemotherapy',
      intervention: 'pembrolizumab plus chemotherapy',
      outcomes: 'OS',
      key_findings: 'Pembrolizumab improved overall survival versus placebo.',
      evidence_strength: 'high'
    }
  ];

  const aggregated = simpleChatService.aggregateTrialEvidence(
    articles,
    evidenceSummaries,
    'In early-stage TNBC, what is the evidence for OS and pCR?',
    {
      responseLanguage: 'en',
      outcomes: 'OS, pCR'
    }
  );

  assert.equal(aggregated.articles.length, 1);
  assert.equal(aggregated.articles[0].pmid, '39282906');
  assert.equal(aggregated.articles[0].endpointMetrics.os, '86.6%');
  assert.equal(aggregated.articles[0].endpointMetrics.pcr, '64.8%');
  assert.equal(aggregated.articles[0].endpointSources.os.pmid, '39282906');
  assert.equal(aggregated.articles[0].endpointSources.pcr.pmid, '11111111');
  assert.equal(aggregated.articles[0].endpointClaims.find(claim => claim.endpointKey === 'os')?.sourcePmid, '39282906');
  assert.equal(aggregated.articles[0].endpointClaims.find(claim => claim.endpointKey === 'pcr')?.sourcePmid, '11111111');
  assert.deepEqual(aggregated.articles[0].relatedPmids.sort(), ['11111111', '39282906']);
});

test('getStudyEndpointKeys prefers structured study findings over raw abstract endpoint mentions', () => {
  const keys = simpleChatService.getStudyEndpointKeys(
    {
      pmid: '39671272',
      title: 'Camrelizumab vs Placebo in Combination With Chemotherapy as Neoadjuvant Treatment in Patients With Early or Locally Advanced Triple-Negative Breast Cancer',
      abstract: 'Secondary endpoints included event-free survival and overall survival, but mature long-term results were not reported in this publication.',
      endpointMetrics: { pcr: '56.8%' }
    },
    {
      study_design: 'Randomized controlled trial',
      outcomes: 'pathologic complete response',
      key_findings: 'Camrelizumab improved pathologic complete response versus placebo.',
      evidence_strength: 'high'
    }
  );

  assert.deepEqual(keys, ['pcr']);
});

test('enrichArticleWithCompanionEvidence carries endpoint-specific source contexts from multiple same-trial publications', async () => {
  const originalSearchPubMed = simpleChatService.searchPubMed.bind(simpleChatService);
  simpleChatService.searchPubMed = async () => ([
    {
      pmid: '11111111',
      title: 'Event-free Survival with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer',
      abstract: 'Pembrolizumab improved event-free survival versus placebo.',
      trialName: 'KEYNOTE-522',
      studyDesign: 'Randomized controlled trial',
      year: '2023',
      endpointMetrics: {}
    },
    {
      pmid: '22222222',
      title: 'Pathological Complete Response with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer',
      abstract: 'Pembrolizumab improved pathological complete response versus placebo.',
      trialName: 'KEYNOTE-522',
      studyDesign: 'Randomized controlled trial',
      year: '2022',
      endpointMetrics: { pcr: '64.8%' }
    }
  ]);

  try {
    const article = {
      pmid: '39282906',
      title: 'Overall Survival with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer',
      abstract: 'Pembrolizumab improved overall survival versus placebo.',
      trialName: 'KEYNOTE-522',
      studyDesign: 'Randomized controlled trial',
      year: '2024',
      endpointMetrics: { os: '86.6%' }
    };

    const enriched = await simpleChatService.enrichArticleWithCompanionEvidence(
      article,
      'In early-stage TNBC, what is the evidence for event-free survival versus placebo?'
    );

    assert.equal(enriched.endpointSources.efs.pmid, '11111111');
    assert.equal(enriched.endpointSourceContexts.efs.article.title, 'Event-free Survival with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer');
    assert.equal(enriched.endpointClaims, undefined);

    const claims = simpleChatService.endpointClaimAgent.buildEndpointClaims(enriched, null, {
      requestedEndpointKeys: ['efs', 'os']
    });
    assert.equal(claims.find(claim => claim.endpointKey === 'efs')?.sourcePmid, '11111111');
    assert.equal(claims.find(claim => claim.endpointKey === 'efs')?.direction, 'positive');
  } finally {
    simpleChatService.searchPubMed = originalSearchPubMed;
  }
});

test('enrichArticleWithCompanionEvidence does not inject efficacy endpoints into quality-of-life publications', async () => {
  const originalSearchPubMed = simpleChatService.searchPubMed.bind(simpleChatService);
  simpleChatService.searchPubMed = async () => ([
    {
      pmid: '39282906',
      title: 'Overall Survival with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer',
      trialName: 'KEYNOTE-522',
      studyDesign: 'Randomized controlled trial',
      year: '2024',
      endpointMetrics: { os: '86.6%', efs: '81.3%', pcr: '64.8%' }
    }
  ]);

  try {
    const article = {
      pmid: '38913881',
      title: 'Neoadjuvant pembrolizumab plus chemotherapy/adjuvant pembrolizumab for early-stage triple-negative breast cancer: quality-of-life results from the randomized KEYNOTE-522 study',
      trialName: 'KEYNOTE-522',
      studyDesign: 'Randomized controlled trial',
      year: '2024',
      endpointMetrics: {}
    };

    const enriched = await simpleChatService.enrichArticleWithCompanionEvidence(
      article,
      'In early-stage TNBC, compare neoadjuvant immunotherapy regimens.'
    );

    assert.deepEqual(enriched.endpointMetrics, {});
  } finally {
    simpleChatService.searchPubMed = originalSearchPubMed;
  }
});

test('buildDeterministicDetailedAnswer uses companion endpoint contexts for requested endpoint matching', () => {
  const answer = simpleChatService.buildDeterministicDetailedAnswer(
    'In early-stage TNBC, what is the evidence for event-free survival?',
    [
      {
        pmid: '39282906',
        title: 'Overall Survival with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer',
        abstract: 'Pembrolizumab improved overall survival versus placebo.',
        trialName: 'KEYNOTE-522',
        studyDesign: 'Randomized controlled trial',
        year: '2024',
        endpointMetrics: { os: '86.6%' },
        endpointSources: {
          os: { pmid: '39282906', year: '2024', title: 'Overall Survival with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer' },
          efs: { pmid: '11111111', year: '2023', title: 'Event-free Survival with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer' }
        },
        endpointSourceContexts: {
          os: {
            article: {
              pmid: '39282906',
              title: 'Overall Survival with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer',
              abstract: 'Pembrolizumab improved overall survival versus placebo.',
              year: '2024',
              studyDesign: 'Randomized controlled trial',
              endpointMetrics: { os: '86.6%' }
            },
            summary: null
          },
          efs: {
            article: {
              pmid: '11111111',
              title: 'Event-free Survival with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer',
              abstract: 'Pembrolizumab improved event-free survival versus placebo.',
              year: '2023',
              studyDesign: 'Randomized controlled trial',
              endpointMetrics: {}
            },
            summary: null
          }
        },
        relatedPmids: ['11111111', '39282906']
      }
    ],
    [
      {
        index: 1,
        study_design: 'Randomized controlled trial',
        population: 'Patients with early-stage triple-negative breast cancer',
        comparator: 'placebo',
        intervention: 'pembrolizumab plus chemotherapy',
        outcomes: 'overall survival',
        key_findings: 'Pembrolizumab improved overall survival versus placebo.',
        evidence_strength: 'high'
      }
    ],
    {
      readinessScore: 82,
      grade: 'High',
      yearRange: '2023-2024',
      recentCount: 2,
      rctCount: 1,
      medianSampleSize: 1174
    },
    {
      responseLanguage: 'en',
      outcomes: 'EFS/DFS/PFS'
    }
  );

  assert.match(answer, /KEYNOTE-522.*Showed benefit in EFS\/DFS\/PFS/i);
  assert.doesNotMatch(answer, /KEYNOTE-522.*Reported OS/i);
  assert.match(answer, /related same-trial publication/i);
});

test('buildStudyFindingText adds qualifiers for related same-trial endpoint claims', () => {
  const text = simpleChatService.endpointJudgeAgent.buildStudyFindingText(
    {
      pmid: '39282906',
      title: 'Overall Survival with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer',
      endpointSourceContexts: {
        efs: {
          article: {
            pmid: '11111111',
            title: 'Event-free Survival with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer',
            abstract: 'Pembrolizumab improved event-free survival versus placebo.',
            endpointMetrics: {}
          },
          summary: null
        }
      },
      endpointSources: {
        efs: {
          pmid: '11111111',
          title: 'Event-free Survival with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer',
          year: '2023'
        }
      }
    },
    null,
    'In early-stage TNBC, what is the evidence for event-free survival?',
    { outcomes: 'EFS/DFS/PFS' },
    'en'
  );

  assert.match(text, /Showed benefit in EFS\/DFS\/PFS/i);
  assert.match(text, /supported by a related same-trial publication/i);
});

test('buildDeterministicDetailedAnswer does not label a neutral direct comparator study as favorable', () => {
  const articles = [
    {
      pmid: '39282906',
      title: 'Overall Survival with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer',
      trialName: 'KEYNOTE-522',
      studyDesign: 'Randomized controlled trial',
      year: '2024',
      endpointMetrics: { os: '86.6%', efs: '81.3%', pcr: '64.8%' }
    },
    {
      pmid: '38588696',
      title: 'The PARTNER trial of neoadjuvant olaparib with chemotherapy in triple-negative breast cancer',
      trialName: 'PARTNER',
      studyDesign: 'Randomized controlled trial',
      year: '2024',
      endpointMetrics: { os: '90%' }
    }
  ];
  const evidenceSummaries = [
    {
      index: 1,
      study_design: 'Randomized controlled trial',
      comparator: 'placebo plus chemotherapy',
      intervention: 'pembrolizumab plus chemotherapy',
      key_findings: 'Pembrolizumab improved overall survival, event-free survival, and pCR versus placebo.',
      evidence_strength: 'high'
    },
    {
      index: 2,
      study_design: 'Randomized controlled trial',
      comparator: 'carboplatin-paclitaxel without olaparib',
      intervention: 'carboplatin-paclitaxel with olaparib',
      key_findings: 'Olaparib did not improve pCR, EFS, or overall survival.',
      evidence_strength: 'moderate'
    }
  ];

  const answer = simpleChatService.buildDeterministicDetailedAnswer(
    'In early-stage TNBC, compare neoadjuvant pembrolizumab- and olaparib-based regimens.',
    articles,
    evidenceSummaries,
    {
      readinessScore: 85,
      grade: 'High',
      yearRange: '2024-2024',
      recentCount: 2,
      rctCount: 2,
      medianSampleSize: 1174
    },
    {
      responseLanguage: 'en'
    }
  );

  assert.match(answer, /Did not show a clear advantage in OS and pCR/i);
  assert.doesNotMatch(answer, /PARTNER also showed a favorable signal/i);
});

test('buildDeterministicDetailedAnswer keeps an OS-only question anchored to OS and demotes non-OS studies', () => {
  const articles = [
    {
      pmid: '39282906',
      title: 'Overall Survival with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer',
      trialName: 'KEYNOTE-522',
      studyDesign: 'Randomized controlled trial',
      year: '2024',
      endpointMetrics: { os: '86.6%', efs: '81.3%', pcr: '64.8%' }
    },
    {
      pmid: '38588696',
      title: 'The PARTNER trial of neoadjuvant olaparib with chemotherapy in triple-negative breast cancer',
      trialName: 'PARTNER',
      studyDesign: 'Randomized controlled trial',
      year: '2024',
      endpointMetrics: { os: '90%' }
    },
    {
      pmid: '39671272',
      title: 'Camrelizumab vs Placebo in Combination With Chemotherapy as Neoadjuvant Treatment in Patients With Early or Locally Advanced Triple-Negative Breast Cancer',
      trialName: 'CamRelief',
      studyDesign: 'Randomized, double-blind, phase 3 trial',
      year: '2025',
      endpointMetrics: { pcr: '56.8%' }
    },
    {
      pmid: '37612624',
      title: 'Neoadjuvant immunotherapy and chemotherapy regimens for the treatment of high-risk, early-stage TNBC: a systematic review and network meta-analysis',
      studyDesign: 'Systematic review and network meta-analysis',
      year: '2023'
    }
  ];
  const evidenceSummaries = [
    {
      index: 1,
      study_design: 'Randomized controlled trial',
      population: 'Patients with early-stage triple-negative breast cancer',
      comparator: 'placebo plus platinum-containing chemotherapy',
      intervention: 'pembrolizumab plus platinum-containing chemotherapy',
      outcomes: 'overall survival',
      key_findings: 'Pembrolizumab plus chemotherapy significantly improved overall survival compared with placebo plus chemotherapy.',
      evidence_strength: 'high'
    },
    {
      index: 2,
      study_design: 'Randomized controlled trial',
      population: 'Patients with triple-negative breast cancer and germline BRCA mutations',
      comparator: 'neoadjuvant carboplatin-paclitaxel without olaparib',
      intervention: 'neoadjuvant carboplatin-paclitaxel with olaparib',
      outcomes: 'overall survival',
      key_findings: 'Neoadjuvant olaparib did not improve overall survival.',
      evidence_strength: 'moderate'
    },
    {
      index: 3,
      study_design: 'Randomized, double-blind, phase 3 trial',
      population: 'Patients with early or locally advanced triple-negative breast cancer',
      comparator: 'placebo plus chemotherapy',
      intervention: 'camrelizumab plus chemotherapy',
      outcomes: 'pathologic complete response',
      key_findings: 'Camrelizumab plus chemotherapy did not show a significant improvement in pathological complete response compared with placebo.',
      evidence_strength: 'moderate'
    },
    {
      index: 4,
      study_design: 'Systematic review and network meta-analysis',
      population: 'Patients with high-risk early-stage TNBC',
      comparator: 'other neoadjuvant regimens',
      intervention: 'pembrolizumab-based regimens',
      outcomes: 'pCR and event-free survival',
      key_findings: 'Pembrolizumab-based regimens ranked favorably across indirect comparisons.',
      evidence_strength: 'moderate'
    }
  ];

  const answer = simpleChatService.buildDeterministicDetailedAnswer(
    'In early-stage TNBC, what is the evidence for overall survival?',
    articles,
    evidenceSummaries,
    {
      readinessScore: 81,
      grade: 'High',
      yearRange: '2023-2025',
      recentCount: 4,
      rctCount: 3,
      medianSampleSize: 1174
    },
    {
      responseLanguage: 'en',
      outcomes: 'OS'
    }
  );

  assert.match(answer, /For this question, the evidence is mixed\. The most useful comparative studies are \[1\] \[2\]\./i);
  assert.match(answer, /PARTNER \[2\] adds additional comparative evidence\./i);
  assert.match(answer, /provides the clearest signal in this set\.\s+Showed benefit in OS \(86\.6%\) \[1\]/i);
  assert.match(answer, /For the requested outcome \(OS\), evidence for additional regimens remains limited or immature \[3\]/i);
  assert.doesNotMatch(answer, /benefit in OS, EFS\/DFS\/PFS, and pCR/i);
});

test('buildDeterministicDetailedAnswer uses endpoint-specific trial claims when a newer publication updates a different endpoint', () => {
  const articles = [
    {
      pmid: '11111111',
      title: 'Event-free Survival with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer',
      trialName: 'KEYNOTE-522',
      studyDesign: 'Randomized controlled trial',
      year: '2023',
      endpointMetrics: { efs: '84.5%', pcr: '64.8%' }
    },
    {
      pmid: '39282906',
      title: 'Overall Survival with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer',
      trialName: 'KEYNOTE-522',
      studyDesign: 'Randomized controlled trial',
      year: '2024',
      endpointMetrics: { os: '86.6%' }
    },
    {
      pmid: '39671272',
      title: 'Camrelizumab vs Placebo in Combination With Chemotherapy as Neoadjuvant Treatment in Patients With Early or Locally Advanced Triple-Negative Breast Cancer',
      trialName: 'CamRelief',
      studyDesign: 'Randomized, double-blind, phase 3 trial',
      year: '2025',
      endpointMetrics: { pcr: '56.8%' }
    }
  ];
  const evidenceSummaries = [
    {
      index: 1,
      study_design: 'Randomized controlled trial',
      population: 'Patients with early-stage triple-negative breast cancer',
      comparator: 'placebo plus platinum-containing chemotherapy',
      intervention: 'pembrolizumab plus platinum-containing chemotherapy',
      outcomes: 'event-free survival, pathologic complete response',
      key_findings: 'Pembrolizumab improved event-free survival and pathologic complete response versus placebo.',
      evidence_strength: 'high'
    },
    {
      index: 2,
      study_design: 'Randomized controlled trial',
      population: 'Patients with early-stage triple-negative breast cancer',
      comparator: 'placebo plus platinum-containing chemotherapy',
      intervention: 'pembrolizumab plus platinum-containing chemotherapy',
      outcomes: 'overall survival',
      key_findings: 'Pembrolizumab significantly improved overall survival versus placebo.',
      evidence_strength: 'high'
    },
    {
      index: 3,
      study_design: 'Randomized, double-blind, phase 3 trial',
      population: 'Patients with early or locally advanced triple-negative breast cancer',
      comparator: 'placebo plus chemotherapy',
      intervention: 'camrelizumab plus chemotherapy',
      outcomes: 'pathologic complete response',
      key_findings: 'Camrelizumab improved pathologic complete response versus placebo.',
      evidence_strength: 'moderate'
    }
  ];

  const answer = simpleChatService.buildDeterministicDetailedAnswer(
    'In early-stage TNBC, what is the evidence for event-free survival?',
    articles,
    evidenceSummaries,
    {
      readinessScore: 84,
      grade: 'High',
      yearRange: '2023-2025',
      recentCount: 3,
      rctCount: 3,
      medianSampleSize: 1174
    },
    {
      responseLanguage: 'en',
      outcomes: 'EFS'
    }
  );

  assert.match(answer, /Showed benefit in EFS\/DFS\/PFS/i);
  assert.match(answer, /For the requested outcome \(EFS\/DFS\/PFS\), evidence for additional regimens remains limited or immature \[2\]/i);
  assert.doesNotMatch(answer, /KEYNOTE-522.*significantly improved overall survival compared/i);
  assert.doesNotMatch(answer, /OS maturity remained limited/i);
});

test('getRequestedEndpointKeys ignores endpoints mentioned only as maturity caveats', () => {
  const keys = simpleChatService.getRequestedEndpointKeys(
    'In early-stage TNBC, what is the evidence for event-free survival?',
    {
      outcomes: 'EFS/DFS/PFS; OS maturity limited/inconsistently reported.'
    }
  );

  assert.deepEqual(keys, ['efs']);
});

test('getRequestedEndpointKeys ignores maturity caveats embedded in clinical-question table text', () => {
  const keys = simpleChatService.getRequestedEndpointKeys(`
## Clinical Question
| Item | Value |
| --- | --- |
| Population | Patients with early-stage or locally advanced TNBC |
| Outcomes | EFS/DFS/PFS; OS maturity limited/inconsistently reported. |
`);

  assert.deepEqual(keys, ['efs']);
});

test('buildDeterministicDetailedAnswer does not fall back to off-target claims in an EFS-focused question', () => {
  const articles = [
    {
      pmid: '39282906',
      title: 'Overall Survival with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer',
      trialName: 'KEYNOTE-522',
      studyDesign: 'Randomized controlled trial',
      year: '2024',
      endpointMetrics: { os: '86.6%' }
    },
    {
      pmid: '39671272',
      title: 'Camrelizumab vs Placebo in Combination With Chemotherapy as Neoadjuvant Treatment in Patients With Early or Locally Advanced Triple-Negative Breast Cancer',
      trialName: 'CamRelief',
      studyDesign: 'Randomized controlled trial',
      year: '2025',
      endpointMetrics: { pcr: '56.8%', grade34ae: '62.1%' }
    },
    {
      pmid: '37612624',
      title: 'Neoadjuvant immunotherapy and chemotherapy regimens for the treatment of high-risk, early-stage triple-negative breast cancer: a systematic review and network meta-analysis',
      studyDesign: 'Systematic review',
      year: '2023'
    }
  ];
  const evidenceSummaries = [
    {
      index: 1,
      study_design: 'Randomized controlled trial',
      comparator: 'placebo',
      intervention: 'pembrolizumab plus chemotherapy',
      outcomes: 'overall survival',
      key_findings: 'Pembrolizumab improved overall survival versus placebo.',
      evidence_strength: 'high'
    },
    {
      index: 2,
      study_design: 'Randomized controlled trial',
      comparator: 'placebo',
      intervention: 'camrelizumab plus chemotherapy',
      outcomes: 'pathologic complete response; grade 3-4 adverse events',
      key_findings: 'Camrelizumab improved pathological complete response and reduced grade 3-4 adverse events versus placebo.',
      evidence_strength: 'high'
    },
    {
      index: 3,
      study_design: 'Systematic review',
      outcomes: 'event-free survival, pathologic complete response',
      key_findings: 'Indirect comparisons favored pembrolizumab-based regimens.',
      evidence_strength: 'high',
      endpoint_claims: [
        {
          endpoint: 'EFS/DFS/PFS',
          direction: 'positive',
          maturity: 'reported',
          support_level: 'indirect',
          effect_size_text: null,
          population_scope: 'overall'
        },
        {
          endpoint: 'pCR',
          direction: 'positive',
          maturity: 'reported',
          support_level: 'indirect',
          effect_size_text: null,
          population_scope: 'overall'
        }
      ]
    }
  ];

  const answer = simpleChatService.buildDeterministicDetailedAnswer(
    'In early-stage TNBC, what is the evidence for event-free survival?',
    articles,
    evidenceSummaries,
    {
      readinessScore: 81,
      grade: 'High',
      yearRange: '2023-2025',
      recentCount: 3,
      rctCount: 2,
      medianSampleSize: 1174
    },
    {
      responseLanguage: 'en',
      outcomes: 'EFS/DFS/PFS; OS maturity limited/inconsistently reported.'
    }
  );

  assert.match(answer, /For this question, the available evidence is too limited, indirect, or heterogeneous to support a clear conclusion \[1\] \[2\]/i);
  assert.match(answer, /Overall, the retrieved evidence is insufficient for a firm comparative conclusion in EFS\/DFS\/PFS \[1\] \[2\]/i);
  assert.doesNotMatch(answer, /KEYNOTE-522.*Reported OS/i);
  assert.doesNotMatch(answer, /Showed benefit in pCR and G3-4 AEs/i);
});

test('inferInterventionLabel prefers a regimen description over a bare trial identifier', () => {
  const label = simpleChatService.inferInterventionLabel(
    {
      trialName: 'KEYNOTE-522',
      title: 'Overall Survival with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer'
    },
    null
  );

  assert.equal(label, 'Pembrolizumab');
});

test('inferInterventionLabel extracts a leading regimen phrase and rejects non-therapeutic descriptors', () => {
  const impassionLabel = simpleChatService.inferInterventionLabel(
    {
      trialName: 'IMpassion031',
      title: 'Peri-operative atezolizumab in early-stage triple-negative breast cancer: final results and ctDNA analyses from the randomized phase 3 IMpassion031 trial'
    },
    null
  );
  const biopsyLabel = simpleChatService.inferInterventionLabel(
    {
      trialName: 'GeparQuattro',
      title: 'On-treatment biopsies to predict response to neoadjuvant chemotherapy for breast cancer'
    },
    null
  );
  const camreliefLabel = simpleChatService.inferInterventionLabel(
    {
      trialName: 'CamRelief',
      title: 'Camrelizumab vs Placebo in Combination With Chemotherapy as Neoadjuvant Treatment in Patients With Early or Locally Advanced Triple-Negative Breast Cancer: The CamRelief Randomized Clinical Trial'
    },
    null
  );

  assert.equal(impassionLabel, 'Peri-operative atezolizumab');
  assert.equal(biopsyLabel, '');
  assert.equal(camreliefLabel, 'Camrelizumab plus chemotherapy');
});

test('buildComparativeStudyTable falls back to endpoint claims when numeric metrics are absent', () => {
  const table = simpleChatService.buildComparativeStudyTable(
    [
      {
        pmid: '39282906',
        title: 'Overall Survival with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer',
        trialName: 'KEYNOTE-522',
        studyDesign: 'Randomized controlled trial',
        year: '2024',
        endpointMetrics: {}
      },
      {
        pmid: '37612624',
        title: 'Neoadjuvant immunotherapy and chemotherapy regimens for the treatment of high-risk, early-stage TNBC: a systematic review and network meta-analysis',
        studyDesign: 'Systematic review and network meta-analysis',
        year: '2023',
        endpointMetrics: {}
      }
    ],
    [
      {
        index: 1,
        study_design: 'Randomized controlled trial',
        comparator: 'placebo',
        intervention: 'pembrolizumab',
        outcomes: 'OS',
        key_findings: 'Pembrolizumab improved overall survival versus placebo.',
        evidence_strength: 'high',
        endpoint_claims: [
          {
            endpoint: 'OS',
            direction: 'positive',
            maturity: 'reported',
            support_level: 'direct',
            effect_size_text: null,
            population_scope: 'overall'
          }
        ]
      },
      {
        index: 2,
        analysis_type: 'synthesis',
        study_design: 'Systematic review and network meta-analysis',
        comparator: 'other neoadjuvant treatments',
        outcomes: 'EFS/DFS/PFS',
        key_findings: 'Indirect comparisons favored event-free survival.',
        evidence_strength: 'moderate',
        endpoint_claims: [
          {
            endpoint: 'EFS/DFS/PFS',
            direction: 'positive',
            maturity: 'reported',
            support_level: 'indirect',
            effect_size_text: null,
            population_scope: 'overall'
          }
        ]
      }
    ],
    'en',
    {
      question: 'In early-stage TNBC, what is the evidence for event-free survival versus placebo?',
      comparator: 'placebo',
      requirePlaceboComparator: true
    }
  );

  assert.match(table, /\| \[1\] KEYNOTE-522 .* \| — \| benefit \| — \| — \| high \|/i);
  assert.match(table, /\| \[2\] Neoadjuvant immunotherapy and chemotherap.*\| — \| indirect: benefit \| — \| — \| — \| moderate \|/i);
});

test('classifyStudyRole demotes translational biopsy papers from randomized parent trials', () => {
  const classification = simpleChatService.classifyStudyRole(
    {
      pmid: '39317942',
      title: 'On-treatment biopsies to predict response to neoadjuvant chemotherapy for breast cancer',
      abstract: 'Translational biomarker analysis from the randomized GeparQuattro trial reporting residual cancer burden and pathologic complete response associations.',
      studyDesign: 'Randomized controlled trial',
      trialName: 'GeparQuattro',
      endpointMetrics: { pcr: '8%' }
    },
    {
      study_design: 'Randomized controlled trial',
      analysis_type: 'biomarker',
      outcomes: 'pCR',
      key_findings: 'On-treatment biopsy signatures predicted pathologic complete response.'
    },
    'In early-stage TNBC, what is the evidence for pCR versus placebo?',
    {
      responseLanguage: 'en',
      outcomes: 'pCR'
    },
    'en'
  );

  assert.equal(classification.role, 'background-biomarker');
  assert.equal(classification.isDirectComparative, false);
});

test('systematic reviews with comparators still yield indirect endpoint claims', () => {
  const claims = simpleChatService.endpointClaimAgent.buildEndpointClaims(
    {
      pmid: '37612624',
      title: 'Neoadjuvant immunotherapy and chemotherapy regimens for the treatment of high-risk, early-stage TNBC: a systematic review and network meta-analysis',
      studyDesign: 'Systematic review and network meta-analysis'
    },
    {
      analysis_type: 'synthesis',
      study_design: 'Systematic review and network meta-analysis',
      comparator: 'other neoadjuvant treatments',
      endpoint_claims: [
        {
          endpoint: 'pCR',
          direction: 'positive',
          maturity: 'reported',
          support_level: 'direct',
          effect_size_text: null,
          population_scope: 'overall'
        }
      ]
    },
    {
      requestedEndpointKeys: ['pcr']
    }
  );

  assert.equal(claims[0].supportLevel, 'indirect');
  assert.equal(claims[0].directComparative, false);
});

test('enforceDetailedAnswerQuality rebuilds legacy table-and-bullet formatting into prose-only detailed output', () => {
  const original = `## Clinical Question
| Item | Value |
| --- | --- |
| Population | Patients with TNBC |
| Intervention/Exposure | Camrelizumab + chemotherapy |
| Comparator | Placebo |
| Outcomes | pCR, EFS, OS |

## Evidence Identified
- Evidence readiness: 60 | Certainty (heuristic): Moderate | Years: 2024-2025.
- Trial signals: studies=2; RCTs=1; median N=150.

## Comparative Findings
| Study | Design | Population | Intervention vs Comparator | pCR | EFS/DFS/PFS | OS | ORR | G3-4 AEs | Strength |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [1] Trial A | Randomized clinical trial | TNBC | Camrelizumab + chemo vs placebo | 56.8% | — | — | — | — | moderate |
| [2] Trial B | Clinical trial | TNBC | Olaparib + chemo vs single-arm/no control | 51% | 80% | — | — | — | low |

Direct evidence is limited to the placebo-controlled trial [1], while Trial B is indirect supportive evidence [2].

## Safety and Limitations
Safety reporting was heterogeneous and grade 3-4 adverse events were not consistently reported across studies [1] [2].

## Practical Takeaway
Only one included study directly addresses the placebo comparison, so the early pCR signal should not be over-interpreted as definitive practice-changing evidence [1] [2].`;

  const rebuilt = simpleChatService.enforceDetailedAnswerQuality(
    original,
    'TNBC placebo comparator question',
    [],
    [],
    {},
    {
      responseLanguage: 'en',
      qualityScore: 0.4,
      requirePlaceboComparator: true,
      comparator: 'placebo'
    }
  );

  assert.notEqual(rebuilt, original);
  assert.doesNotMatch(rebuilt, /^\s*[-*]\s+/m);
  assert.doesNotMatch(rebuilt, /\n\|.*\|\n\| ---/i);
  assert.doesNotMatch(rebuilt, /^\s*#{1,6}\s+/m);
  assert.match(rebuilt, /The retrieved evidence for this question was limited|A evid[eê]ncia recuperada para esta pergunta foi limitada/i);
});

test('enforceDetailedAnswerQuality rebuilds vague takeaways when strong direct evidence exists', () => {
  const original = `## Clinical Question
| Item | Value |
| --- | --- |
| Population | Patients with TNBC |
| Intervention/Exposure | Pembrolizumab + chemotherapy |
| Comparator | Placebo |
| Outcomes | pCR, EFS, OS |

## Evidence Identified
- Evidence readiness: 80 | Certainty (heuristic): High | Years: 2024-2024.
- Trial signals: studies=1; RCTs=1; median N=1174.

## Comparative Findings
| Study | Design | Population | Intervention vs Comparator | pCR | EFS/DFS/PFS | OS | ORR | G3-4 AEs | Strength |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [1] KEYNOTE-522 | Randomized, phase 3 trial | High-risk early-stage TNBC | Pembrolizumab + chemotherapy vs placebo | 64.8% | 81.3% | 86.6% | â€” | â€” | high |

## Safety and Limitations
Safety reporting was heterogeneous across the included evidence [1].

## Practical Takeaway
There is an early efficacy signal for neoadjuvant regimens in this question; late-endpoint maturity remains limited, so decisions should be integrated with guidelines and individual context [1].`;

  const rebuilt = simpleChatService.enforceDetailedAnswerQuality(
    original,
    'In early-stage TNBC, does pembrolizumab plus chemotherapy improve outcomes versus placebo?',
    [
      {
        pmid: '39282906',
        title: 'Overall Survival with Pembrolizumab in Early-Stage Triple-Negative Breast Cancer',
        trialName: 'KEYNOTE-522',
        studyDesign: 'Randomized, phase 3 trial',
        year: '2024',
        endpointMetrics: { os: '86.6%', efs: '81.3%', pcr: '64.8%' }
      }
    ],
    [
      {
        index: 1,
        study_design: 'Randomized, phase 3 trial',
        population: 'Patients with high-risk early-stage TNBC',
        intervention: 'pembrolizumab plus chemotherapy',
        comparator: 'placebo',
        outcomes: 'OS, pCR, EFS',
        key_findings: 'Pembrolizumab improved overall survival, pCR, and event-free survival versus placebo.',
        evidence_strength: 'high'
      }
    ],
    {
      readinessScore: 80,
      grade: 'High',
      yearRange: '2024-2024',
      recentCount: 1,
      rctCount: 1,
      medianSampleSize: 1174
    },
    {
      responseLanguage: 'en'
    }
  );

  assert.doesNotMatch(rebuilt, /early efficacy signal/i);
  assert.doesNotMatch(rebuilt, /^\s*#{1,6}\s+/m);
  assert.match(rebuilt, /provides the clearest signal in this set/i);
  assert.match(rebuilt, /\b(?:overall survival|OS)\b/i);
});

test('sanitizePubMedQuery preserves balanced phrase quotes for PubMed-ready queries', () => {
  const sanitized = simpleChatService.sanitizePubMedQuery(
    '"triple negative breast cancer" AND pembrolizumab'
  );

  assert.equal(sanitized, '"triple negative breast cancer" AND pembrolizumab');
});

test('buildStructuredSearchQuery converts structured clinical context into a boolean PubMed-style query', () => {
  const query = simpleChatService.buildStructuredSearchQuery('Compare regimens.', {
    population: 'metastatic NSCLC',
    intervention: 'pembrolizumab plus chemotherapy',
    outcomes: 'OS, PFS',
    studyTypes: ['phase_3']
  });

  assert.match(query, /\[MeSH Terms\]/i);
  assert.match(query, /\[Title\/Abstract\]/i);
  assert.match(query, /NSCLC\[Title\/Abstract\]/i);
  assert.match(query, /metastatic\[Title\/Abstract\]|Neoplasm Metastasis\[MeSH Terms\]/i);
  assert.match(query, /pembrolizumab\[Title\/Abstract\]/i);
  assert.match(query, /chemotherapy\[Title\/Abstract\]|Chemotherapy\[MeSH Terms\]/i);
  assert.match(query, /"?overall survival"?\[Title\/Abstract\]/i);
  assert.match(query, /"?progression-free survival"?\[Title\/Abstract\]/i);
  assert.match(query, /"?phase III"?\[Title\/Abstract\]/i);
});

test('buildStructuredSearchQuery uses subtype-specific TNBC clauses rather than generic breast cancer mesh', () => {
  const query = simpleChatService.buildStructuredSearchQuery('In TNBC, compare pembrolizumab versus placebo.', {
    population: 'high-risk early-stage TNBC',
    intervention: 'pembrolizumab',
    comparator: 'placebo',
    outcomes: 'pCR, EFS'
  });

  assert.match(query, /"?Triple Negative Breast Neoplasms"?\[MeSH Terms\]/i);
  assert.doesNotMatch(query, /Breast Neoplasms\[MeSH Terms\]/i);
});

test('articleMatchesClinicalFocus rejects explicit ER-positive HER2-negative studies for TNBC focus', () => {
  const focus = simpleChatService.detectClinicalFocus(
    'In early-stage TNBC, what is the evidence for pembrolizumab versus placebo?',
    {
      population: 'Patients with early-stage or locally advanced TNBC',
      comparator: 'placebo'
    }
  );

  const matches = simpleChatService.articleMatchesClinicalFocus(
    {
      title: 'Pembrolizumab and chemotherapy in high-risk, early-stage, ER + /HER2 - breast cancer: a randomized phase 3 trial',
      abstract: 'This randomized trial enrolled patients with hormone receptor-positive, HER2-negative early breast cancer.',
      studyDesign: 'Randomized controlled trial'
    },
    focus
  );

  assert.equal(matches, false);
});
