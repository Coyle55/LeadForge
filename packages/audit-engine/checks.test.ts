import { describe, expect, it } from "vitest";
import { evaluateChecks } from "./checks";
import type { CrawlResult, PageFacts } from "./crawler";

const THIS_BUSINESS = /this business/i;

const page = (overrides: Partial<PageFacts> = {}): PageFacts => ({
  url: "https://example.com/",
  title: "Example",
  description: "A useful description",
  language: "en",
  headings: [1, 2],
  images: 10,
  imagesWithAlt: 10,
  imageUrls: [],
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

const crawl = (
  facts = page(),
  overrides: Partial<CrawlResult> = {}
): CrawlResult => ({
  brokenInternalLinks: 0,
  brokenImages: 0,
  requestedUrl: facts.url,
  finalUrl: facts.url,
  redirectCount: 0,
  pagesAttempted: 1,
  pagesAudited: 1,
  pages: [facts],
  robotsAvailable: true,
  ...overrides,
});

describe("evaluateChecks", () => {
  it("returns one stable finding for every documented check", () => {
    const findings = evaluateChecks(crawl());
    expect(findings).toHaveLength(31);
    expect(new Set(findings.map((finding) => finding.key)).size).toBe(31);
  });

  it("does not produce a contact_signals finding", () => {
    const findings = evaluateChecks(crawl());
    expect(findings.some((finding) => finding.key === "contact_signals")).toBe(
      false
    );
  });

  it("detects phone and email signals independently", () => {
    const phoneOnly = evaluateChecks(
      crawl(page({ text: "Call us at tel:555-1234 today" }))
    );
    expect(phoneOnly.find((f) => f.key === "phone_detection")?.status).toBe(
      "PASS"
    );
    expect(phoneOnly.find((f) => f.key === "email_detection")?.status).toBe(
      "FAIL"
    );

    const emailOnly = evaluateChecks(
      crawl(page({ text: "Reach out mailto:hello@example.com" }))
    );
    expect(emailOnly.find((f) => f.key === "email_detection")?.status).toBe(
      "PASS"
    );
    expect(emailOnly.find((f) => f.key === "phone_detection")?.status).toBe(
      "FAIL"
    );
  });

  it("detects booking signals from text and outbound links, with detection-scoped summary on FAIL", () => {
    const noBooking = evaluateChecks(crawl(page({ text: "Nothing here" })));
    const noBookingFinding = noBooking.find(
      (f) => f.key === "booking_detection"
    );
    expect(noBookingFinding?.status).toBe("FAIL");
    expect(noBookingFinding?.summary).toBe(
      "No booking system detected on the sampled pages."
    );
    expect(noBookingFinding?.summary).not.toMatch(THIS_BUSINESS);
    expect(noBookingFinding?.category).toBe("BOOKING");

    const withBookingText = evaluateChecks(
      crawl(page({ text: "Schedule an appointment today" }))
    );
    expect(
      withBookingText.find((f) => f.key === "booking_detection")?.status
    ).toBe("PASS");

    const withBookingLink = evaluateChecks(
      crawl(
        page({
          text: "Nothing here",
          links: ["https://calendly.com/example"],
        })
      )
    );
    expect(
      withBookingLink.find((f) => f.key === "booking_detection")?.status
    ).toBe("PASS");
  });

  it("evaluates broken_images from the crawl's sampled broken-image count", () => {
    const clean = evaluateChecks(crawl(page(), { brokenImages: 0 }));
    expect(clean.find((f) => f.key === "broken_images")?.status).toBe("PASS");

    const warn = evaluateChecks(crawl(page(), { brokenImages: 1 }));
    expect(warn.find((f) => f.key === "broken_images")?.status).toBe("WARNING");

    const fail = evaluateChecks(crawl(page(), { brokenImages: 2 }));
    expect(fail.find((f) => f.key === "broken_images")?.status).toBe("FAIL");
  });

  it("flags stale copyright years without ever failing", () => {
    const currentYear = new Date().getUTCFullYear();

    const fresh = evaluateChecks(
      crawl(page({ text: `All rights reserved. © ${currentYear} Acme` }))
    );
    expect(fresh.find((f) => f.key === "copyright_year")?.status).toBe("PASS");

    const stale = evaluateChecks(
      crawl(page({ text: `© ${currentYear - 3} Acme Inc.` }))
    );
    expect(stale.find((f) => f.key === "copyright_year")?.status).toBe(
      "WARNING"
    );

    const missing = evaluateChecks(crawl(page({ text: "No copyright text" })));
    expect(missing.find((f) => f.key === "copyright_year")?.status).toBe(
      "PASS"
    );
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
