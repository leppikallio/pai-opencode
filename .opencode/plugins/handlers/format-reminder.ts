export type FormatHintVerdict = 'ok' | 'warn' | 'fail';

export type FormatHint = {
  v: '0.1';
  ts: string;
  assistantMessageId: string;
  verdict: FormatHintVerdict;
  reasons: string[];
  features: {
    hasVoiceLine: boolean;
    hasSummaryLine: boolean;
    hasPaiAlgorithmHeader: boolean;
    hasIscTracker: boolean;
    hasRateLine: boolean;
    phaseCount: number;
  };
  toast?: {
    message: string;
    variant: 'info' | 'warning' | 'error';
    durationMs?: number;
  };
};

function countMatches(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

export function classifyFormatHint(assistantText: string, assistantMessageId: string): FormatHint {
  const text = assistantText;

  const startsWithRobot = text.trimStart().startsWith("🤖");

  const hasVoiceLine = /^🗣️\s*[^:\n]{1,40}:/m.test(text);
  const hasSummaryLine = /^📋 SUMMARY:/m.test(text);

  // Accept both legacy "🤖 PAI ALGORITHM" and upstream "🤖 Entering the PAI ALGORITHM".
  const hasPaiAlgorithmHeader = /^🤖\s+(?:PAI ALGORITHM\b|Entering the PAI ALGORITHM)/m.test(text);

  // Accept both table-based trackers and upstream task-list markers.
  const hasIscTracker = /ISC TRACKER|FINAL ISC STATE|\bISC Tasks\b/i.test(text);

  // Explicitly detect (and discourage) rating prompts.
  const hasRateLine = /⭐\s*RATE\s*\(1-10\):/m.test(text);

  // Rough phase coverage for the phased algorithm format.
  const phaseCountLegacy = countMatches(
    text,
    /^━━━\s+.*\b(O B S E R V E|T H I N K|P L A N|B U I L D|E X E C U T E|V E R I F Y|L E A R N)\b/mg
  );
  const phaseCountUpstream = countMatches(
    text,
    /^━━━\s+.*\b(OBSERVE|THINK|PLAN|BUILD|EXECUTE|VERIFY|LEARN)\b/mg
  );
  const phaseCount = Math.max(phaseCountLegacy, phaseCountUpstream);

  const reasons: string[] = [];
  let verdict: FormatHintVerdict = 'ok';

  if (!startsWithRobot) {
    verdict = 'fail';
    reasons.push('missing_robot_first_token');
  }

  if (!hasVoiceLine) {
    verdict = 'fail';
    reasons.push('missing_voice_line');
  }

  if (hasRateLine) {
    verdict = 'fail';
    reasons.push('forbidden_rate_prompt');
  }

  if (!hasSummaryLine) {
    // Summary is recommended but not mandatory (upstream v2.5 format).
    if (verdict === 'ok') verdict = 'warn';
    reasons.push('missing_summary');
  }

  if (hasPaiAlgorithmHeader) {
    if (!hasIscTracker) {
      if (verdict === 'ok') verdict = 'warn';
      reasons.push('missing_isc_tracker');
    }
    if (phaseCount < 5) {
      if (verdict === 'ok') verdict = 'warn';
      reasons.push('missing_phases');
    }
  }

  // Rate prompts are forbidden; do not suggest adding them.

  let toast: FormatHint['toast'] | undefined;
  if (verdict === 'fail') {
    const msg =
      !startsWithRobot
        ? 'Format: first token must be 🤖.'
        : hasRateLine
          ? 'Format: remove ⭐ RATE prompt (forbidden).'
          : 'Format: missing 🗣️ voice line (required every response).';
    toast = {
      message: msg,
      variant: 'error',
      durationMs: 8000,
    };
  } else if (verdict === 'warn') {
    const bits: string[] = [];
    if (!hasSummaryLine) bits.push('📋 SUMMARY');
    if (hasPaiAlgorithmHeader && !hasIscTracker) bits.push('ISC tasks');
    if (hasPaiAlgorithmHeader && phaseCount < 5) bits.push('phases');
    toast = {
      message: bits.length ? `Format: consider adding ${bits.join(', ')}.` : 'Format: minor issues detected.',
      variant: 'warning',
      durationMs: 6000,
    };
  }

  return {
    v: '0.1',
    ts: new Date().toISOString(),
    assistantMessageId,
    verdict,
    reasons,
    features: {
      hasVoiceLine,
      hasSummaryLine,
      hasPaiAlgorithmHeader,
      hasIscTracker,
      hasRateLine,
      phaseCount,
    },
    ...(toast ? { toast } : {}),
  };
}
