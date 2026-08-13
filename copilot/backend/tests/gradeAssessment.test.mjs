import test from 'node:test';
import assert from 'node:assert/strict';

import simpleChatService from '../src/services/simpleChatService.js';
import GradeAssessmentAgent from '../src/services/simple-chat/GradeAssessmentAgent.js';
import config from '../src/config/config.js';

// ---------------------------------------------------------------------------
// These tests lock in the contract that the GRADE certainty layer is actually
// reachable and that its rating is an INPUT to synthesis rather than an
// annotation appended afterwards.
//
// Regression guard: the agent previously existed but was wired only into the
// non-streaming route behind a flag that defaulted to false, so it never ran in
// the shipped application and its contextSummary never reached the prompt.
// ---------------------------------------------------------------------------

const ARTICLES = [
  { pmid: '1', title: 'Randomised trial of drug A vs placebo', year: '2024', journal: 'NEJM' },
  { pmid: '2', title: 'Phase III trial of drug A', year: '2023', journal: 'Lancet' }
];
const SUMMARIES = [
  { index: 1, study_design: 'Randomized controlled trial', endpoint_claims: [{ endpoint: 'OS', direction: 'favours_intervention' }] },
  { index: 2, study_design: 'Randomized controlled trial', endpoint_claims: [{ endpoint: 'PFS', direction: 'favours_intervention' }] }
];

/** Minimal stub of the Bedrock/OpenAI-compatible client the agent expects. */
function stubClient(payload, { onCall } = {}) {
  return {
    chat: {
      completions: {
        create: async (req) => {
          if (onCall) onCall(req);
          return { choices: [{ message: { content: JSON.stringify(payload) } }] };
        }
      }
    }
  };
}

const VALID_ASSESSMENT = {
  certainty_of_evidence: 'moderate',
  starting_level: 'high',
  starting_rationale: 'Randomised trials',
  domains: {
    risk_of_bias: { rating: 'no_serious', downgrade: 0, rationale: 'Low risk' },
    inconsistency: { rating: 'serious', downgrade: -1, rationale: 'Heterogeneous effect' },
    indirectness: { rating: 'no_serious', downgrade: 0, rationale: 'Direct population' },
    imprecision: { rating: 'no_serious', downgrade: 0, rationale: 'Tight CI' },
    publication_bias: { rating: 'undetected', downgrade: 0, rationale: 'No asymmetry' }
  },
  summary: 'Moderate certainty of benefit.',
  direction_of_effect: 'favours_intervention'
};

test('GRADE assessment is enabled by default so certainty accompanies every evidence-based answer', () => {
  assert.equal(
    config.external.enableGradeAssessment,
    true,
    'ENABLE_GRADE_ASSESSMENT must default to true; a clean clone previously ran with GRADE silently disabled'
  );
});

test('GradeAssessmentAgent returns all five GRADE domains and a contextSummary for prompt injection', async () => {
  const agent = new GradeAssessmentAgent({ openai: stubClient(VALID_ASSESSMENT), logger: { info() {}, warn() {} } });
  const result = await agent.assess('Does drug A improve OS?', ARTICLES, SUMMARIES, {});

  assert.equal(result.certainty_of_evidence, 'moderate');
  for (const domain of ['risk_of_bias', 'inconsistency', 'indirectness', 'imprecision', 'publication_bias']) {
    assert.ok(result.domains[domain], `missing GRADE domain: ${domain}`);
  }
  assert.match(result.contextSummary, /GRADE CERTAINTY OF EVIDENCE ASSESSMENT/);
  assert.match(result.contextSummary, /Certainty: MODERATE/);
  assert.match(result.contextSummary, /Inconsistency: serious/);
});

test('runGradeAssessment returns an assessment carrying the contextSummary used for prompt injection', async () => {
  const original = simpleChatService.gradeAgent;
  simpleChatService.gradeAgent = new GradeAssessmentAgent({
    openai: stubClient(VALID_ASSESSMENT),
    logger: { info() {}, warn() {} }
  });
  try {
    const assessment = await simpleChatService.runGradeAssessment('Does drug A improve OS?', ARTICLES, SUMMARIES, {});
    assert.ok(assessment, 'expected an assessment when the feature is enabled and evidence exists');
    assert.equal(assessment.available, true);
    assert.equal(assessment.certainty_of_evidence, 'moderate');
    assert.ok(assessment.contextSummary.length > 0, 'contextSummary must be populated for prompt injection');
  } finally {
    simpleChatService.gradeAgent = original;
  }
});

test('runGradeAssessment returns null without evidence rather than fabricating a rating', async () => {
  const original = simpleChatService.gradeAgent;
  simpleChatService.gradeAgent = new GradeAssessmentAgent({
    openai: stubClient(VALID_ASSESSMENT),
    logger: { info() {}, warn() {} }
  });
  try {
    assert.equal(await simpleChatService.runGradeAssessment('q', [], [], {}), null);
  } finally {
    simpleChatService.gradeAgent = original;
  }
});

test('runGradeAssessment degrades to null on agent failure instead of throwing', async () => {
  const original = simpleChatService.gradeAgent;
  simpleChatService.gradeAgent = {
    assess: async () => { throw new Error('bedrock unavailable'); }
  };
  try {
    assert.equal(await simpleChatService.runGradeAssessment('q', ARTICLES, SUMMARIES, {}), null);
  } finally {
    simpleChatService.gradeAgent = original;
  }
});

test('buildGenerateResponsePrompts injects gradeContext into the synthesis prompt', () => {
  const marker = '=== GRADE CERTAINTY OF EVIDENCE ASSESSMENT ===\nCertainty: MODERATE';

  const withGrade = simpleChatService.buildGenerateResponsePrompts(
    'Does drug A improve OS?', ARTICLES, SUMMARIES, { gradeContext: marker }
  );
  const withoutGrade = simpleChatService.buildGenerateResponsePrompts(
    'Does drug A improve OS?', ARTICLES, SUMMARIES, {}
  );

  const combined = `${withGrade.systemPrompt}\n${withGrade.userMessage}`;
  assert.ok(
    combined.includes('GRADE CERTAINTY OF EVIDENCE ASSESSMENT'),
    'the GRADE context must reach the synthesis prompt — otherwise the rating is a post-hoc annotation, not an input'
  );
  assert.ok(combined.includes('Certainty: MODERATE'));

  const combinedWithout = `${withoutGrade.systemPrompt}\n${withoutGrade.userMessage}`;
  assert.ok(
    !combinedWithout.includes('GRADE CERTAINTY OF EVIDENCE ASSESSMENT'),
    'no GRADE block should appear when no assessment was produced'
  );
});
