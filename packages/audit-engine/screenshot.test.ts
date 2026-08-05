import { describe, expect, it } from "vitest";
import { noopScreenshotProvider } from "./screenshot";

describe("noopScreenshotProvider", () => {
  it("always resolves to an unavailable result and never rejects", async () => {
    await expect(
      noopScreenshotProvider.capture("https://example.com")
    ).resolves.toEqual({ status: "unavailable", reason: "not_configured" });
  });

  it("resolves the same way regardless of the URL passed", async () => {
    await expect(
      noopScreenshotProvider.capture("https://another-example.test/page")
    ).resolves.toEqual({ status: "unavailable", reason: "not_configured" });
  });
});
