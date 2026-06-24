import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import simpleChatService from '../src/services/simpleChatService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROMPTS_PATH = path.resolve(__dirname, 'simple_chat_golden_prompts.json');
const LOGS_DIR = path.resolve(__dirname, '..', '..', 'logs');

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = { limit: null, caseId: null };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--limit' && args[i + 1]) {
      out.limit = Number.parseInt(args[i + 1], 10);
      i += 1;
    } else if (arg === '--case' && args[i + 1]) {
      out.caseId = String(args[i + 1]).trim();
      i += 1;
    }
  }
  return out;
};

const normalizeText = (value = '') => String(value || '').toLowerCase();

const evaluateAnswer = ({ answer, references, options }) => {
  const text = String(answer || '');
  const lower = normalizeText(text);
  const refs = Array.isArray(references) ? references : [];
  const detailLevel = String(options?.detailLevel || 'detailed').toLowerCase();
  const quickMode = options?.quickStudyOnly === true || detailLevel === 'executive';

  const hasCitations = /\[\d+\]/.test(text);
  const citationMax = Math.max(0, ...[...text.matchAll(/\[(\d+)\]/g)].map(match => Number.parseInt(match[1], 10) || 0));
  const citationOverflow = citationMax > refs.length;
  const hasBrokenFragments = /(?:specific|detailed)\s+(?:findings|results)[^.\n]{0,120}\sare\s*(?:\[[0-9,\s]+\])?\.?(?=\s|$)|the specific safety profiles and limitations of the studies were in the source texts|are\s*\[[0-9,\s]+\]/i.test(text);
  const hasMissingPlaceholders = /not reported|missing information|\bn\/a\b|\bnr\b/i.test(lower);
  const hasEndpointMentions = /(pcr|pathologic(?:al)? complete response|efs|event[- ]free survival|dfs|disease[- ]free survival|pfs|progression[- ]free survival|overall survival|\bos\b|orr|objective response rate|grade\s*3|grade\s*4|adverse)/i.test(text);

  if (quickMode) {
    const hasQuickHeading = /##\s*quick study review/i.test(text);
    const pass = hasQuickHeading && hasEndpointMentions && !hasBrokenFragments && !citationOverflow;
    return {
      mode: 'quick',
      pass,
      checks: {
        hasQuickHeading,
        hasEndpointMentions,
        hasBrokenFragments: !hasBrokenFragments,
        citationOverflow: !citationOverflow,
        hasCitations
      }
    };
  }

  const hasClinicalQuestion = /##\s*(clinical question|pergunta cl[ií]nica)/i.test(text);
  const hasEvidenceIdentified = /##\s*(evidence identified|evid[eê]ncia encontrada)/i.test(text);
  const hasComparative = /##\s*(comparative findings|achados comparativos)/i.test(text);
  const hasSafety = /##\s*(safety and limitations|seguran[çc]a e limita[çc][õo]es)/i.test(text);
  const hasTakeaway = /##\s*(practical takeaway|implica[çc][ãa]o pr[aá]tica)/i.test(text);
  const hasComparativeTable = /##\s*(comparative findings|achados comparativos)[\s\S]*?\n\|.+\|/i.test(text);

  const pass = hasClinicalQuestion &&
    hasEvidenceIdentified &&
    hasComparative &&
    hasSafety &&
    hasTakeaway &&
    hasComparativeTable &&
    hasEndpointMentions &&
    !hasBrokenFragments &&
    !citationOverflow;

  return {
    mode: 'detailed',
    pass,
    checks: {
      hasClinicalQuestion,
      hasEvidenceIdentified,
      hasComparative,
      hasSafety,
      hasTakeaway,
      hasComparativeTable,
      hasEndpointMentions,
      hasBrokenFragments: !hasBrokenFragments,
      citationOverflow: !citationOverflow,
      hasCitations,
      hasMissingPlaceholders: !hasMissingPlaceholders
    }
  };
};

const main = async () => {
  const args = parseArgs();
  const payload = JSON.parse(await fs.readFile(PROMPTS_PATH, 'utf8'));
  let cases = Array.isArray(payload?.cases) ? payload.cases : [];

  if (args.caseId) {
    cases = cases.filter(item => item?.id === args.caseId);
  }
  if (Number.isFinite(args.limit) && args.limit > 0) {
    cases = cases.slice(0, args.limit);
  }

  if (cases.length === 0) {
    throw new Error('No regression cases selected');
  }

  const startedAt = new Date();
  const results = [];
  for (const testCase of cases) {
    const id = String(testCase?.id || '').trim() || `case_${results.length + 1}`;
    const question = String(testCase?.question || '').trim();
    const options = testCase?.options || {};

    const row = {
      id,
      question,
      options,
      success: false,
      error: null,
      durationMs: null,
      referencesCount: 0,
      articlesFound: 0,
      evaluation: null
    };

    const start = Date.now();
    try {
      const response = await simpleChatService.processQuestion(question, options);
      row.durationMs = Date.now() - start;
      row.success = Boolean(response?.success);
      row.referencesCount = Array.isArray(response?.references) ? response.references.length : 0;
      row.articlesFound = Number.isFinite(response?.articlesFound) ? response.articlesFound : 0;
      row.evaluation = evaluateAnswer({
        answer: response?.answer || '',
        references: response?.references || [],
        options
      });
    } catch (error) {
      row.durationMs = Date.now() - start;
      row.error = error?.message || String(error);
      row.evaluation = { pass: false, checks: { runtime: false } };
    }
    results.push(row);
    console.log(`[${id}] ${row.evaluation?.pass ? 'PASS' : 'FAIL'} (${row.durationMs}ms)`);
  }

  const passed = results.filter(item => item?.evaluation?.pass).length;
  const failed = results.length - passed;
  const summary = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    total: results.length,
    passed,
    failed,
    passRate: Number(((passed / Math.max(results.length, 1)) * 100).toFixed(1)),
    avgDurationMs: Math.round(results.reduce((sum, item) => sum + (item.durationMs || 0), 0) / Math.max(results.length, 1))
  };

  const report = {
    version: payload?.version || '1.0.0',
    summary,
    results
  };

  await fs.mkdir(LOGS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(LOGS_DIR, `simple_chat_regression_${stamp}.json`);
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\nRegression summary');
  console.log(`- total: ${summary.total}`);
  console.log(`- passed: ${summary.passed}`);
  console.log(`- failed: ${summary.failed}`);
  console.log(`- pass rate: ${summary.passRate}%`);
  console.log(`- report: ${outputPath}`);

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
};

main().catch(error => {
  console.error(`Regression run failed: ${error?.message || error}`);
  process.exit(1);
});
