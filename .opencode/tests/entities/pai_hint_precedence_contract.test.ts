import { describe, expect, test } from "bun:test";

import { applyExplicitRoutingPrecedence } from "../../plugins/shared/hint-envelope";

describe("PAI hint explicit-routing precedence", () => {
  test("explicit routing cues suppress advisory capability routing", () => {
    const out = applyExplicitRoutingPrecedence({
      hasExplicitRoutingCue: true,
      advisoryCapabilities: ["Engineer", "QATester"],
    });

    expect(out.precedence).toBe("explicit_routing");
    expect(out.advisorySuppressed).toBe(true);
    expect(out.effectiveCapabilities).toEqual([]);
  });

  test("without explicit routing cues advisory capabilities remain active", () => {
    const out = applyExplicitRoutingPrecedence({
      hasExplicitRoutingCue: false,
      advisoryCapabilities: ["Engineer", "Engineer", "QATester"],
    });

    expect(out.precedence).toBe("advisory");
    expect(out.advisorySuppressed).toBe(false);
    expect(out.effectiveCapabilities).toEqual(["Engineer", "QATester"]);
  });
});
