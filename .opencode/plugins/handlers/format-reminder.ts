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

  const hasVoiceLine = /^🗣️\s*[^:\n]{1,40}:/m.test(text);
  const hasSummaryLine = /^📋 SUMMARY:/m.test(text);
  const hasPaiAlgorithmHeader = /^🤖 PAI ALGORITHM\b/m.test(text);
  const hasIscTracker = /ISC TRACKER|FINAL ISC STATE/m.test(text);
  const hasRateLine = /^⭐ RATE \(1-10\):/m.test(text);

  // Rough phase coverage for the phased algorithm format.
  const phaseCount = countMatches(
    text,
    /^━━━\s+.*\b(O B S E R V E|T H I N K|P L A N|B U I L D|E X E C U T E|V E R I F Y|L E A R N)\b/mg
  );

  const reasons: string[] = [];
  let verdict: FormatHintVerdict = 'ok';

  if (!hasVoiceLine) {
    verdict = 'fail';
    reasons.push('missing_voice_line');
  }

  if (!hasSummaryLine) {
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

  if (!hasRateLine) {
    // Optional: don't fail for missing rate line.
    reasons.push('missing_rate_line');
  }

  let toast: FormatHint['toast'] | undefined;
  if (verdict === 'fail') {
    toast = {
      message: 'Format: missing 🗣️ voice line (required every response).',
      variant: 'error',
      durationMs: 8000,
    };
  } else if (verdict === 'warn') {
    const bits: string[] = [];
    if (!hasSummaryLine) bits.push('📋 SUMMARY');
    if (hasPaiAlgorithmHeader && !hasIscTracker) bits.push('ISC table');
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
