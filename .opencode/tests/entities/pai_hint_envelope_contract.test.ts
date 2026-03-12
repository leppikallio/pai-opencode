import { describe, expect, test } from "bun:test";

import {
  HINT_PRODUCER_REGISTRY,
  containsImperativeHintField,
  createAdvisoryHintCandidate,
  listDefaultRuntimeHintProducers,
  reduceAdvisoryHintCandidates,
} from "../../plugins/shared/hint-envelope";

describe("PAI hint envelope contract", () => {
  test("registry keeps one default runtime producer and one shadow-capable secondary", () => {
    const defaults = listDefaultRuntimeHintProducers();
    expect(defaults).toEqual(["runtime_heuristic"]);

    expect(HINT_PRODUCER_REGISTRY.runtime_carrier_openai.defaultRuntime).toBe(false);
    expect(HINT_PRODUCER_REGISTRY.runtime_carrier_openai.shadowCapable).toBe(true);
    expect(HINT_PRODUCER_REGISTRY.runtime_carrier_openai.utilityCapable).toBe(true);
  });

  test("deterministic reducer output is stable across candidate ordering", () => {
    const heuristic = createAdvisoryHintCandidate({
      producer: "runtime_heuristic",
      mode: "runtime_default",
      advisory: {
        depth: "FULL",
        reasoning_profile: "standard",
        verbosity: "standard",
        capabilities: ["Engineer"],
        thinking_tools: ["FirstPrinciples"],
        confidence: 0.55,
      },
    });
    const carrier = createAdvisoryHintCandidate({
      producer: "runtime_carrier_openai",
      mode: "utility",
      advisory: {
        depth: "FULL",
        reasoning_profile: "deep",
        verbosity: "detailed",
        capabilities: ["Engineer", "QATester"],
        thinking_tools: ["FirstPrinciples", "red-team"],
        confidence: 0.9,
      },
    });

    const now = () => "2026-03-11T12:00:00.000Z";
    const a = reduceAdvisoryHintCandidates({
      userMessageId: "U1",
      carrierMode: "active",
      candidates: [heuristic, carrier],
      now,
    });
    const b = reduceAdvisoryHintCandidates({
      userMessageId: "U1",
      carrierMode: "active",
      candidates: [carrier, heuristic],
      now,
    });

    expect(a).toEqual(b);
    expect(a.reducer.selectedProducer).toBe("runtime_carrier_openai");
    expect(a.provenance[0]?.selected).toBe(true);
  });

  test("envelope stays advisory-only with imperative fields stripped", () => {
    const unsafe = createAdvisoryHintCandidate({
      producer: "runtime_carrier_openai",
      mode: "utility",
      advisory: {
        depth: "FULL",
        reasoning_profile: "deep",
        verbosity: "detailed",
        capabilities: ["Engineer"],
        thinking_tools: [],
        confidence: 0.8,
      },
    }) as Record<string, unknown>;

    unsafe.run_in_background = true;
    expect(containsImperativeHintField(unsafe)).toBe(true);

    const out = reduceAdvisoryHintCandidates({
      userMessageId: "U2",
      carrierMode: "active",
      candidates: [unsafe as any],
      now: () => "2026-03-11T12:00:00.000Z",
    });

    expect(containsImperativeHintField(out)).toBe(false);
    expect(JSON.stringify(out)).not.toContain("run_in_background");
    expect(JSON.stringify(out)).not.toContain("subagent_type");
  });
});
