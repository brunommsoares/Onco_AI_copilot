import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveSimpleChatEngine,
  shouldPreferUnifiedSimpleChat
} from '../src/services/simpleChatEngineSelector.js';

test('UI default narrative payload with unrestricted recency stays on simple_v2', () => {
  const engine = resolveSimpleChatEngine('What is the role of adjuvant osimertinib?', {
    language: 'auto',
    recency: 'any',
    detailLevel: 'detailed',
    evidenceMode: 'balanced',
    quickStudyOnly: false,
    responseStyle: 'narrative',
    includeCuriaMaterials: false,
    includeAscoSepMaterials: false,
    includeTrialRegistry: false,
    trialRecruitingInPortugalOnly: false
  });

  assert.equal(engine, 'simple_v2');
});

test('structured clinical context still prefers unified_clinical', () => {
  const engine = resolveSimpleChatEngine('Compare pembrolizumab regimens.', {
    responseStyle: 'structured',
    population: 'metastatic NSCLC',
    intervention: 'pembrolizumab plus chemotherapy',
    outcomes: 'OS, PFS'
  });

  assert.equal(engine, 'unified_clinical');
});

test('trial filters alone still prefer unified_clinical', () => {
  assert.equal(
    shouldPreferUnifiedSimpleChat('Show recruiting studies.', {
      trialPhases: ['phase_3'],
      trialRecruitingInPortugalOnly: true
    }),
    true
  );
});

test('explicit engine override wins over heuristics', () => {
  assert.equal(
    resolveSimpleChatEngine('Need a quick answer.', {
      engine: 'simple_v2',
      responseStyle: 'structured',
      population: 'TNBC'
    }),
    'simple_v2'
  );
});
