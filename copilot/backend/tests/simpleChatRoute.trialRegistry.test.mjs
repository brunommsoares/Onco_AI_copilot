import test from 'node:test';
import assert from 'node:assert/strict';

import request from 'supertest';

import app from '../src/app.js';
import simpleChatService from '../src/services/simpleChatService.js';
import trialRegistryService from '../src/services/trialRegistryService.js';

test('simple chat route returns trial registry payload alongside the synthesized answer', async () => {
  const originalProcessQuestion = simpleChatService.processQuestion;
  const originalFindMatches = trialRegistryService.findMatches;

  simpleChatService.processQuestion = async () => ({
    success: true,
    answer: 'Structured oncology answer.',
    references: [{ index: 1, title: 'Reference A' }],
    warnings: [
      {
        level: 'warning',
        code: 'insufficient_evidence',
        message: 'The retrieved studies do not answer the question directly.'
      }
    ],
    evidenceAdequacy: {
      status: 'insufficient',
      label: 'Insufficient evidence',
      score: 42,
      reasons: ['No directly relevant comparative study was identified for the question.']
    },
    articlesFound: 1,
    metadata: {
      originalQuestion: 'Show EGFR NSCLC trials.'
    }
  });

  trialRegistryService.findMatches = async () => ({
    available: true,
    trials: [
      {
        nctId: 'NCT-NSCLC-1',
        title: 'Osimertinib in EGFR-mutated metastatic NSCLC',
        phases: ['Phase III'],
        overallStatus: 'Recruiting',
        geography: 'Portugal',
        sourceUrl: 'https://clinicaltrials.gov/study/NCT-NSCLC-1'
      }
    ],
    weeklyTable: [],
    meta: {
      location: 'Portugal',
      lastSyncedAt: '2026-03-10T12:00:00.000Z'
    }
  });

  try {
    const response = await request(app)
      .post('/api/simple-chat')
      .send({
        question: 'Show EGFR NSCLC trials.',
        options: {
          trialRecruitingInPortugalOnly: true
        }
      });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.answer, 'Structured oncology answer.');
    assert.equal(response.body.warnings[0].code, 'insufficient_evidence');
    assert.equal(response.body.evidenceAdequacy.status, 'insufficient');
    assert.equal(response.body.trialRegistry.available, true);
    assert.equal(response.body.trialRegistry.trials[0].nctId, 'NCT-NSCLC-1');
    assert.equal(response.body.structured.trialRegistry.trials[0].nctId, 'NCT-NSCLC-1');
    assert.equal(response.body.structured.readiness.status, 'insufficient');
    assert.equal(response.body.metadata.trialRegistryAvailable, true);
    assert.equal(response.body.metadata.trialRegistryTrialsFound, 1);
    assert.equal(typeof response.body.metadata.engine, 'string');
  } finally {
    simpleChatService.processQuestion = originalProcessQuestion;
    trialRegistryService.findMatches = originalFindMatches;
  }
});
