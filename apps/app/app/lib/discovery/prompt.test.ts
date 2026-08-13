import { describe, expect, it } from "vitest";
import { DISCOVERY_PROMPT_VERSION, DISCOVERY_SYSTEM_PROMPT } from "./prompt";

describe("DISCOVERY_SYSTEM_PROMPT", () => {
  it("has a stable prompt version", () => {
    expect(DISCOVERY_PROMPT_VERSION).toBe("discovery-v2");
  });

  it("instructs the model not to fabricate fields it isn't confident about", () => {
    expect(DISCOVERY_SYSTEM_PROMPT).toContain("fabricate");
    expect(DISCOVERY_SYSTEM_PROMPT.toLowerCase()).toContain("do not guess");
    expect(DISCOVERY_SYSTEM_PROMPT.toLowerCase()).toContain("omit");
  });
});
