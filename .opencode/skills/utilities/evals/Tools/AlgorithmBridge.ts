#!/usr/bin/env bun
/**
 * Algorithm Bridge
 * Integration between Evals and THE ALGORITHM verification system
 */

import type { AlgorithmEvalRequest, AlgorithmEvalResult, EvalRun, Task } from '../Types/index.ts';
import { loadSuite, checkSaturation } from './SuiteManager.ts';
import { TrialRunner, } from './TrialRunner.ts';
import { createTranscript } from './TranscriptCapture.ts';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseArgs } from 'node:util';
import { getPaiDir } from '../../../pai-tools/PaiRuntime';

const EVALS_DIR = join(import.meta.dir, '..');
const RESULTS_DIR = join(EVALS_DIR, 'Results');

/**
 * Run an eval suite for ALGORITHM verification
 */
export async function runEvalForAlgorithm(
  request: AlgorithmEvalRequest
): Promise<AlgorithmEvalResult> {
  const suite = loadSuite(request.suite);
  if (!suite) {
    return {
      isc_row: request.isc_row,
      suite: request.suite,
      passed: false,
      score: 0,
      summary: `Suite not found: ${request.suite}`,
      run_id: 'error',
    };
  }

  // Load tasks from suite
  const tasks: Task[] = [];
  for (const taskId of suite.tasks) {
    const taskPath = findTaskFile(taskId);
    if (taskPath && existsSync(taskPath)) {
      const task = parseYaml(readFileSync(taskPath, 'utf-8')) as Task;
      tasks.push(task);
    }
  }

  if (tasks.length === 0) {
    return {
      isc_row: request.isc_row,
      suite: request.suite,
      passed: false,
      score: 0,
      summary: `No tasks found in suite: ${request.suite}`,
      run_id: 'error',
    };
  }

  // Run each task and aggregate
  const results: EvalRun[] = [];
  let totalScore = 0;
  let passedTasks = 0;

  for (const task of tasks) {
    const runner = new TrialRunner({
      task,
      executor: async (t, trialNum) => {
        // For ALGORITHM integration, we use a simplified executor
        // that captures the current agent's work
        const transcript = createTranscript(t.id, `trial_${trialNum}`, {
          turns: [
            { role: 'system', content: t.description },
            { role: 'assistant', content: 'Task executed via ALGORITHM' },
          ],
          toolCalls: [],
        });

        return {
          output: 'Executed via ALGORITHM bridge',
          transcript,
        };
      },
      onTrialComplete: (trial) => {
        console.log(`  Trial ${trial.trial_number}: ${trial.passed ? '✅ PASS' : '❌ FAIL'} (${trial.score.toFixed(2)})`);
      },
    });

    console.log(`Running task: ${task.id}`);
    const run = await runner.run();
    results.push(run);

    totalScore += run.mean_score;
    if (run.pass_rate >= (task.pass_threshold ?? 0.75)) {
      passedTasks++;
    }

    // Save run results
    saveRunResults(request.suite, run);
  }

  const overallScore = totalScore / tasks.length;
  const overallPassed = passedTasks === tasks.length ||
    overallScore >= (suite.pass_threshold ?? 0.75);

  const summary = `${passedTasks}/${tasks.length} tasks passed, score: ${(overallScore * 100).toFixed(1)}%`;

  return {
    isc_row: request.isc_row,
    suite: request.suite,
    passed: overallPassed,
    score: overallScore,
    summary,
    run_id: results[0]?.id ?? 'aggregate',
  };
}

/**
 * Find task file by ID
 */
function findTaskFile(taskId: string): string | null {
  const useCasesDir = join(EVALS_DIR, 'UseCases');
  const possiblePaths = [
    join(useCasesDir, `${taskId}.yaml`),
    join(useCasesDir, 'Regression', `${taskId}.yaml`),
    join(useCasesDir, 'Capability', `${taskId}.yaml`),
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) return path;
  }

  return null;
}

/**
 * Save run results
 */
function saveRunResults(suiteName: string, run: EvalRun): void {
  const suiteResultsDir = join(RESULTS_DIR, suiteName);
  if (!existsSync(suiteResultsDir)) mkdirSync(suiteResultsDir, { recursive: true });

  const runDir = join(suiteResultsDir, run.id);
  if (!existsSync(runDir)) mkdirSync(runDir);

  writeFileSync(join(runDir, 'run.json'), JSON.stringify(run, null, 2));
}

/**
 * Format result for ISC update
 */
export function formatForISC(result: AlgorithmEvalResult): string {
  const icon = result.passed ? '✅' : '❌';
  return `${icon} Eval: ${result.summary}`;
}

/**
 * Update ISC row with eval result
 */
export async function updateISCWithResult(result: AlgorithmEvalResult): Promise<void> {
  const paiDir = getPaiDir();
  const statePath = join(paiDir, 'MEMORY', 'STATE', 'current-work.json');
  if (!existsSync(statePath)) {
    throw new Error(`No active work session found (missing ${statePath})`);
  }

  const state = JSON.parse(readFileSync(statePath, 'utf-8')) as { work_dir?: string };
  const workDir = state.work_dir;
  if (!workDir) {
    throw new Error(`No active work session found (invalid ${statePath})`);
  }

  const iscPath = join(workDir, 'ISC.json');
  const isc = existsSync(iscPath)
    ? (JSON.parse(readFileSync(iscPath, 'utf-8')) as {
        criteria: Array<{ description: string; status: string }>;
        anti_criteria?: unknown[];
      })
    : ({ criteria: [], anti_criteria: [] } as {
        criteria: Array<{ description: string; status: string }>;
        anti_criteria: unknown[];
      });

  const entry = {
    description: formatForISC(result),
    status: result.passed ? 'VERIFIED' : 'FAILED',
  };

  const row = Number.isFinite(result.isc_row) ? result.isc_row : 0;
  if (row > 0) {
    const idx = row - 1;
    while (isc.criteria.length <= idx) {
      isc.criteria.push({ description: '', status: 'PENDING' });
    }
    isc.criteria[idx] = entry;
  } else {
    isc.criteria.push(entry);
  }

  writeFileSync(iscPath, JSON.stringify(isc, null, 2));
}

// CLI interface
if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      suite: { type: 'string', short: 's' },
      'isc-row': { type: 'string', short: 'r' },
      'update-isc': { type: 'boolean', short: 'u' },
      'show-saturation': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help || !values.suite) {
    console.log(`
AlgorithmBridge - Connect Evals to THE ALGORITHM

Usage:
  bun run AlgorithmBridge.ts -s <suite> [-r row] [-u]

Options:
  -s, --suite          Eval suite to run
  -r, --isc-row        ISC row number (for result binding)
  -u, --update-isc     Automatically update ISC with result
  --show-saturation    Show suite saturation status
  -h, --help           Show this help

Examples:
  # Run suite and show results
  bun run AlgorithmBridge.ts -s regression-core

  # Run and update ISC row 3
  bun run AlgorithmBridge.ts -s regression-core -r 3 -u

  # Check saturation status
  bun run AlgorithmBridge.ts -s capability-auth --show-saturation
`);
    process.exit(0);
  }

  const suite = values.suite;
  if (!suite) {
    console.error('Error: --suite is required');
    process.exit(1);
  }

  if (values['show-saturation']) {
    const status = checkSaturation(suite);
    console.log(`\nSaturation Status: ${suite}\n`);
    console.log(`  Saturated: ${status.saturated ? '⚠️ Yes' : '✅ No'}`);
    console.log(`  Consecutive above threshold: ${status.consecutive_above_threshold}/3`);
    console.log(`  Recommendation: ${status.recommended_action}`);
    process.exit(0);
  }

  const request: AlgorithmEvalRequest = {
    isc_row: values['isc-row'] ? parseInt(values['isc-row'], 10) : 0,
    suite,
  };

  console.log(`\nRunning eval suite: ${request.suite}\n`);

  const result = await runEvalForAlgorithm(request);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`\n📊 EVAL RESULT: ${result.passed ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`   Suite: ${result.suite}`);
  console.log(`   Score: ${(result.score * 100).toFixed(1)}%`);
  console.log(`   Summary: ${result.summary}`);
  console.log(`   Run ID: ${result.run_id}`);

  if (values['update-isc'] && request.isc_row > 0) {
    await updateISCWithResult(result);
    console.log(`\n   Updated ISC row ${request.isc_row}`);
  }

  process.exit(result.passed ? 0 : 1);
}
