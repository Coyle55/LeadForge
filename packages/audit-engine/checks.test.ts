import { describe, expect, it } from "vitest";
import { evaluateChecks } from "./checks";
import type { CrawlResult, PageFacts } from "./crawler";

const page = (overrides: Partial<PageFacts> = {}): PageFacts => ({
  url: "https://example.com/",
  title: "Example",
  description: "A useful description",
  language: "en",
  headings: [1, 2],
  images: 10,
  imagesWithAlt: 10,
  formControls: 0,
  labeledControls: 0,
  links: ["https://example.com/contact", "https://example.com/privacy"],
  text: "Contact us Call today Request a quote",
  canonical: "https://example.com/",
  robotsMeta: "index,follow",
  jsonLdCount: 1,
  viewport: true,
  insecureAssets: 0,
  externalScripts: 3,
  blockingResources: 1,
  htmlBytes: 100_000,
  responseMs: 300,
  status: 200,
  ...overrides,
});

const crawl = (facts = page()): CrawlResult => ({
  brokenInternalLinks: 0,
  requestedUrl: facts.url,
  finalUrl: facts.url,
  redirectCount: 0,
  pagesAttempted: 1,
  pagesAudited: 1,
  pages: [facts],
  robotsAvailable: true,
});

describe("evaluateChecks", () => {
  it("returns one stable finding for every documented check", () => {
    const findings = evaluateChecks(crawl());
    expect(findings).toHaveLength(27);
    expect(new Set(findings.map((finding) => finding.key)).size).toBe(27);
  });

  it("applies accessibility and performance thresholds", () => {
    const findings = evaluateChecks(
      crawl(
        page({
          images: 10,
          imagesWithAlt: 6,
          responseMs: 1600,
          htmlBytes: 800_000,
        })
      )
    );
    expect(
      findings.find(({ key }) => key === "image_alt_coverage")?.status
    ).toBe("FAIL");
    expect(
      findings.find(({ key }) => key === "server_response_time")?.status
    ).toBe("FAIL");
    expect(findings.find(({ key }) => key === "html_size")?.status).toBe(
      "FAIL"
    );
  });
});
