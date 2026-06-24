import test from 'node:test';
import assert from 'node:assert/strict';

import { TrialRegistryService } from '../src/services/trialRegistryService.js';

const createMockStore = (snapshot) => ({
  type: 'mock',
  async writeSnapshot() {},
  async getTrials() {
    return snapshot.trials || [];
  },
  async getConditions() {
    return snapshot.conditions || [];
  },
  async getTrial(trialId) {
    return (snapshot.trials || []).find((trial) => trial.nctId === trialId) || null;
  },
  async getLatestRun() {
    return snapshot.meta || null;
  }
});

test('trial registry service ranks the most relevant Portugal recruiting trial for the queried population', async () => {
  const snapshot = {
    meta: {
      finishedAt: '2026-03-10T12:00:00.000Z',
      location: 'Portugal'
    },
    conditions: [
      {
        conditionKey: 'cond-nsclc',
        condition: 'Metastatic Non-Small Cell Lung Cancer',
        trials: [{ nctId: 'NCT-NSCLC-1' }]
      },
      {
        conditionKey: 'cond-tnbc',
        condition: 'Triple-Negative Breast Cancer',
        trials: [{ nctId: 'NCT-TNBC-1' }]
      }
    ],
    trials: [
      {
        nctId: 'NCT-NSCLC-1',
        title: 'Osimertinib in EGFR-mutated metastatic NSCLC',
        overallStatus: 'Recruiting',
        overallStatusKey: 'RECRUITING',
        studyType: 'Interventional',
        phases: ['PHASE3'],
        conditions: ['Metastatic Non-Small Cell Lung Cancer'],
        keywords: ['EGFR', 'NSCLC'],
        year: '2026',
        geography: 'Portugal + 4 other countries',
        regionTags: ['Europe', 'Global'],
        countries: ['Portugal', 'Spain', 'France'],
        referenceDate: '2026-02-20T00:00:00.000Z',
        studyFirstPostDate: '2025-12-20T00:00:00.000Z',
        lastUpdatePostDate: '2026-02-20T00:00:00.000Z',
        recruitingInPortugal: true,
        portugalSiteCount: 4,
        portugalRecruitingSiteCount: 3,
        interventions: [{ name: 'Osimertinib', type: 'Drug', description: '' }],
        arms: [{ label: 'Osimertinib', type: 'Experimental', description: '' }],
        inclusionCriteria: ['EGFR exon 19 deletion or L858R'],
        exclusionCriteria: ['Untreated CNS metastases'],
        eligibilitySummary: 'Adults with EGFR-mutated metastatic NSCLC.',
        sponsor: { leadSponsorName: 'AstraZeneca' },
        briefSummary: 'International phase III study for EGFR-mutated NSCLC.',
        sourceUrl: 'https://clinicaltrials.gov/study/NCT-NSCLC-1'
      },
      {
        nctId: 'NCT-TNBC-1',
        title: 'Pembrolizumab in triple-negative breast cancer',
        overallStatus: 'Recruiting',
        overallStatusKey: 'RECRUITING',
        studyType: 'Interventional',
        phases: ['PHASE2'],
        conditions: ['Triple-Negative Breast Cancer'],
        keywords: ['TNBC'],
        year: '2026',
        geography: 'Portugal',
        regionTags: ['Europe'],
        countries: ['Portugal'],
        referenceDate: '2026-02-18T00:00:00.000Z',
        studyFirstPostDate: '2025-10-11T00:00:00.000Z',
        lastUpdatePostDate: '2026-02-18T00:00:00.000Z',
        recruitingInPortugal: true,
        portugalSiteCount: 2,
        portugalRecruitingSiteCount: 2,
        interventions: [{ name: 'Pembrolizumab', type: 'Drug', description: '' }],
        arms: [],
        inclusionCriteria: ['Adults with TNBC'],
        exclusionCriteria: [],
        eligibilitySummary: 'Adults with locally advanced TNBC.',
        sponsor: { leadSponsorName: 'Academic Sponsor' },
        briefSummary: 'Phase II TNBC trial.',
        sourceUrl: 'https://clinicaltrials.gov/study/NCT-TNBC-1'
      }
    ]
  };

  const service = new TrialRegistryService({
    env: {
      ENABLE_TRIAL_REGISTRY_SYNC: 'false',
      TRIAL_REGISTRY_LOCATION: 'Portugal'
    },
    storeFactory: async () => createMockStore(snapshot),
    logger: {
      info() {},
      warn() {},
      error() {}
    }
  });

  const result = await service.findMatches({
    question: 'What recruiting trials are available for EGFR-mutated metastatic NSCLC in Portugal?',
    population: 'EGFR-mutated metastatic NSCLC',
    biomarker: 'EGFR',
    maxTrials: 5
  });

  assert.equal(result.available, true);
  assert.equal(result.trials[0].nctId, 'NCT-NSCLC-1');
  assert.equal(result.trials[0].interventionSummary, 'Osimertinib');
  assert.match(result.trials[0].eligibilitySummary, /EGFR/i);
  assert.ok(result.trials[0].matchReasons.some((reason) => /Population|Condition|Biomarker/i.test(reason)));
  assert.ok(result.weeklyTable.length >= 1);

  // New fields: diseaseStage, questionMatch, trialGroups
  assert.equal(typeof result.trials[0].diseaseStage, 'string');
  assert.equal(typeof result.trials[0].questionMatch, 'boolean');
  assert.ok(result.trials[0].questionMatch, 'Top-scoring trial should be flagged as matching the question');
  assert.ok(Array.isArray(result.trialGroups), 'Response should include trialGroups');
  assert.ok(result.trialGroups.length > 0, 'trialGroups should not be empty');
  assert.ok(result.trialGroups[0].condition, 'Each group should have a condition');
  assert.ok(result.trialGroups[0].stage, 'Each group should have a stage');
  assert.ok(Array.isArray(result.trialGroups[0].trials), 'Each group should have a trials array');
});

test('trial registry service keeps only recruiting trials and ranks by phase before IPO Porto', async () => {
  const snapshot = {
    meta: {
      finishedAt: '2026-03-17T09:00:00.000Z',
      location: 'Portugal'
    },
    conditions: [
      {
        conditionKey: 'cond-mcrc',
        condition: 'Metastatic Colorectal Cancer',
        trials: [
          { nctId: 'NCT-CRC-PH3-IPO' },
          { nctId: 'NCT-CRC-PH3-LIS' },
          { nctId: 'NCT-CRC-PH2-IPO' },
          { nctId: 'NCT-CRC-COMPLETE' }
        ]
      }
    ],
    trials: [
      {
        nctId: 'NCT-CRC-PH3-IPO',
        title: 'Targeted maintenance study in metastatic colorectal cancer',
        overallStatus: 'Recruiting',
        overallStatusKey: 'RECRUITING',
        phases: ['PHASE3'],
        conditions: ['Metastatic Colorectal Cancer'],
        keywords: ['KRAS wild-type', 'metastatic colorectal cancer'],
        geography: 'Portugal',
        regionTags: ['Europe'],
        countries: ['Portugal'],
        referenceDate: '2026-03-10T00:00:00.000Z',
        recruitingInPortugal: true,
        portugalSiteCount: 2,
        portugalRecruitingSiteCount: 2,
        locations: [{ facility: 'IPO Porto', city: 'Porto' }],
        interventions: [{ name: 'Cetuximab', type: 'Drug', description: '' }],
        inclusionCriteria: ['KRAS wild-type metastatic colorectal cancer'],
        exclusionCriteria: [],
        eligibilitySummary: 'Adults with metastatic colorectal cancer.',
        sponsor: { leadSponsorName: 'Sponsor A' },
        briefSummary: 'Phase III metastatic colorectal cancer study.',
        sourceUrl: 'https://clinicaltrials.gov/study/NCT-CRC-PH3-IPO'
      },
      {
        nctId: 'NCT-CRC-PH3-LIS',
        title: 'First-line KRAS wild-type metastatic colorectal cancer trial',
        overallStatus: 'Recruiting',
        overallStatusKey: 'RECRUITING',
        phases: ['PHASE3'],
        conditions: ['Metastatic Colorectal Cancer'],
        keywords: ['KRAS wild-type', 'first line'],
        geography: 'Portugal',
        regionTags: ['Europe'],
        countries: ['Portugal'],
        referenceDate: '2026-03-12T00:00:00.000Z',
        recruitingInPortugal: true,
        portugalSiteCount: 3,
        portugalRecruitingSiteCount: 3,
        locations: [{ facility: 'Hospital de Santa Maria', city: 'Lisbon' }],
        interventions: [{ name: 'FOLFOX', type: 'Drug', description: '' }],
        inclusionCriteria: ['Untreated metastatic colorectal cancer'],
        exclusionCriteria: [],
        eligibilitySummary: 'First-line metastatic colorectal cancer.',
        sponsor: { leadSponsorName: 'Sponsor B' },
        briefSummary: 'Exact lexical match but not at IPO Porto.',
        sourceUrl: 'https://clinicaltrials.gov/study/NCT-CRC-PH3-LIS'
      },
      {
        nctId: 'NCT-CRC-PH2-IPO',
        title: 'KRAS wild-type metastatic colorectal cancer escalation study',
        overallStatus: 'Recruiting',
        overallStatusKey: 'RECRUITING',
        phases: ['PHASE2'],
        conditions: ['Metastatic Colorectal Cancer'],
        keywords: ['KRAS wild-type', 'first line', 'metastatic colorectal cancer'],
        geography: 'Portugal',
        regionTags: ['Europe'],
        countries: ['Portugal'],
        referenceDate: '2026-03-14T00:00:00.000Z',
        recruitingInPortugal: true,
        portugalSiteCount: 1,
        portugalRecruitingSiteCount: 1,
        locations: [{ facility: 'IPO Porto', city: 'Porto' }],
        interventions: [{ name: 'Panitumumab', type: 'Drug', description: '' }],
        inclusionCriteria: ['KRAS wild-type metastatic colorectal cancer'],
        exclusionCriteria: [],
        eligibilitySummary: 'Phase II colorectal cancer study at IPO Porto.',
        sponsor: { leadSponsorName: 'Sponsor C' },
        briefSummary: 'Lower phase despite stronger lexical overlap.',
        sourceUrl: 'https://clinicaltrials.gov/study/NCT-CRC-PH2-IPO'
      },
      {
        nctId: 'NCT-CRC-COMPLETE',
        title: 'Completed colorectal cancer trial at IPO Porto',
        overallStatus: 'Completed',
        overallStatusKey: 'COMPLETED',
        phases: ['PHASE3'],
        conditions: ['Metastatic Colorectal Cancer'],
        keywords: ['KRAS wild-type'],
        geography: 'Portugal',
        regionTags: ['Europe'],
        countries: ['Portugal'],
        referenceDate: '2026-03-15T00:00:00.000Z',
        recruitingInPortugal: false,
        portugalSiteCount: 1,
        portugalRecruitingSiteCount: 0,
        locations: [{ facility: 'IPO Porto', city: 'Porto' }],
        interventions: [{ name: 'Bevacizumab', type: 'Drug', description: '' }],
        inclusionCriteria: ['KRAS wild-type metastatic colorectal cancer'],
        exclusionCriteria: [],
        eligibilitySummary: 'Completed trial.',
        sponsor: { leadSponsorName: 'Sponsor D' },
        briefSummary: 'Should be excluded because it is not recruiting.',
        sourceUrl: 'https://clinicaltrials.gov/study/NCT-CRC-COMPLETE'
      }
    ]
  };

  const service = new TrialRegistryService({
    env: {
      ENABLE_TRIAL_REGISTRY_SYNC: 'false',
      TRIAL_REGISTRY_LOCATION: 'Portugal'
    },
    storeFactory: async () => createMockStore(snapshot),
    logger: {
      info() {},
      warn() {},
      error() {}
    }
  });

  const result = await service.findMatches({
    question: 'Find first-line KRAS wild-type metastatic colorectal cancer trials in Portugal.',
    population: 'Metastatic colorectal cancer',
    biomarker: 'KRAS wild-type',
    statuses: ['Completed'],
    maxTrials: 5
  });

  assert.equal(result.available, true);
  assert.deepEqual(
    result.trials.map((trial) => trial.nctId),
    ['NCT-CRC-PH3-IPO', 'NCT-CRC-PH3-LIS', 'NCT-CRC-PH2-IPO']
  );
  assert.equal(result.trials[0].phaseRank, 5);
  assert.equal(result.trials[0].ipoPortoPriority, true);
  assert.ok(result.trials.every((trial) => trial.overallStatusKey === 'RECRUITING'));
  assert.equal(result.meta.recruitingInPortugalOnly, true);
});

test('trial registry service reports unavailable when there is no snapshot and sync is disabled', async () => {
  const service = new TrialRegistryService({
    env: {
      ENABLE_TRIAL_REGISTRY_SYNC: 'false',
      TRIAL_REGISTRY_LOCATION: 'Portugal'
    },
    storeFactory: async () => createMockStore({
      meta: null,
      trials: [],
      conditions: []
    }),
    logger: {
      info() {},
      warn() {},
      error() {}
    }
  });

  const result = await service.findMatches({
    question: 'Show recruiting melanoma trials.'
  });

  assert.equal(result.available, false);
  assert.equal(result.trials.length, 0);
  assert.match(result.error, /no snapshot/i);
});
