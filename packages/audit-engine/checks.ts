import type { CrawlResult } from "./crawler";
import type { AuditCategory, AuditFinding, AuditStatus } from "./types";

const CONTACT_PATH = /\/contact\b/;
const CALL_TO_ACTION = /(contact|call|book|request|quote|buy|schedule)/;
const PRIVACY = /privacy/;
const TERMS = /(terms|conditions|legal)/;
const SITEMAP = /sitemap\.xml/;
const PHONE_SIGNALS = /(tel:|\bphone\b|\bcall us\b)/;
const EMAIL_SIGNALS = /(mailto:|\bemail\b)/;
const BOOKING_SIGNALS =
  /(book now|schedule an? appointment|calendly\.com|acuityscheduling\.com|square\.site\/appointments|book\.squareup\.com)/;
const COPYRIGHT_YEAR = /(?:©|copyright)\D{0,10}(\d{4})/i;

const finding = (
  category: AuditCategory,
  key: string,
  label: string,
  status: AuditStatus,
  evidence: Record<string, string | number | boolean | null>
): AuditFinding => ({
  category,
  key,
  label,
  status,
  summary: `${label} ${status === "PASS" ? "meets" : "needs attention for"} the audit check.`,
  evidence,
});

const ratioStatus = (ratio: number): AuditStatus => {
  if (ratio >= 0.95) {
    return "PASS";
  }
  if (ratio >= 0.7) {
    return "WARNING";
  }
  return "FAIL";
};
const allStatus = (count: number, total: number): AuditStatus => {
  if (count === total) {
    return "PASS";
  }
  if (count === 0) {
    return "FAIL";
  }
  return "WARNING";
};
const threshold = (
  value: number,
  pass: number,
  warning: number
): AuditStatus => {
  if (value <= pass) {
    return "PASS";
  }
  if (value <= warning) {
    return "WARNING";
  }
  return "FAIL";
};

export const evaluateChecks = (crawl: CrawlResult): AuditFinding[] => {
  const pages = crawl.pages;
  const home = pages[0];
  if (!home) {
    return [];
  }
  const count = (predicate: (page: (typeof pages)[number]) => boolean) =>
    pages.filter(predicate).length;
  const totalImages = pages.reduce((sum, page) => sum + page.images, 0);
  const altImages = pages.reduce((sum, page) => sum + page.imagesWithAlt, 0);
  const controls = pages.reduce((sum, page) => sum + page.formControls, 0);
  const labels = pages.reduce((sum, page) => sum + page.labeledControls, 0);
  const combined =
    `${pages.flatMap((page) => page.links).join(" ")} ${pages.map((page) => page.text).join(" ")}`.toLowerCase();
  const secure = count((page) => page.url.startsWith("https://"));
  const noindex = count((page) =>
    page.robotsMeta.toLowerCase().includes("noindex")
  );
  const brokenLinks = crawl.brokenInternalLinks;
  const hasContactPath = CONTACT_PATH.test(combined);
  const hasPhoneSignal = PHONE_SIGNALS.test(combined);
  const hasEmailSignal = EMAIL_SIGNALS.test(combined);
  const hasBookingSignal = BOOKING_SIGNALS.test(combined);
  const hasCallToAction = CALL_TO_ACTION.test(combined);
  const hasPrivacy = PRIVACY.test(combined);
  const hasTerms = TERMS.test(combined);
  const hasSitemap = SITEMAP.test(combined);
  const indexability: AuditStatus = noindex === 0 ? "PASS" : "WARNING";
  const redirectStatus = threshold(crawl.redirectCount, 1, 3);
  const brokenStatus = threshold(brokenLinks, 0, 1);
  const brokenImagesStatus = threshold(crawl.brokenImages, 0, 1);
  const copyrightMatch = COPYRIGHT_YEAR.exec(home.text);
  const copyrightYear = copyrightMatch ? Number(copyrightMatch[1]) : null;
  const currentYear = new Date().getUTCFullYear();
  const copyrightStatus: AuditStatus =
    copyrightYear === null || currentYear - copyrightYear <= 1
      ? "PASS"
      : "WARNING";
  const bookingFinding: AuditFinding = {
    ...finding(
      "BOOKING",
      "booking_detection",
      "Booking detection",
      hasBookingSignal ? "PASS" : "FAIL",
      { found: hasBookingSignal }
    ),
    summary: hasBookingSignal
      ? "A booking or scheduling signal was detected on the sampled pages."
      : "No booking system detected on the sampled pages.",
  };

  return [
    finding(
      "ACCESSIBILITY",
      "page_title",
      "Page titles",
      allStatus(
        count((p) => Boolean(p.title)),
        pages.length
      ),
      { pagesWithTitle: count((p) => Boolean(p.title)), pages: pages.length }
    ),
    finding(
      "ACCESSIBILITY",
      "meta_description",
      "Meta descriptions",
      allStatus(
        count((p) => Boolean(p.description)),
        pages.length
      ),
      {
        pagesWithDescription: count((p) => Boolean(p.description)),
        pages: pages.length,
      }
    ),
    finding(
      "ACCESSIBILITY",
      "heading_structure",
      "Heading structure",
      allStatus(
        count(
          (p) =>
            p.headings[0] === 1 &&
            p.headings.filter((h) => h === 1).length === 1
        ),
        pages.length
      ),
      { pages: pages.length }
    ),
    finding(
      "ACCESSIBILITY",
      "image_alt_coverage",
      "Image alt coverage",
      ratioStatus(totalImages === 0 ? 1 : altImages / totalImages),
      { images: totalImages, withAlt: altImages }
    ),
    finding(
      "ACCESSIBILITY",
      "form_label_coverage",
      "Form label coverage",
      ratioStatus(controls === 0 ? 1 : labels / controls),
      { controls, labeled: labels }
    ),
    finding(
      "ACCESSIBILITY",
      "document_language",
      "Document language",
      allStatus(
        count((p) => Boolean(p.language)),
        pages.length
      ),
      {
        pagesWithLanguage: count((p) => Boolean(p.language)),
        pages: pages.length,
      }
    ),
    finding("TRUST", "https", "HTTPS", allStatus(secure, pages.length), {
      securePages: secure,
      pages: pages.length,
    }),
    finding(
      "TRUST",
      "contact_path",
      "Contact path",
      hasContactPath ? "PASS" : "FAIL",
      { found: hasContactPath }
    ),
    finding(
      "TRUST",
      "phone_detection",
      "Phone detection",
      hasPhoneSignal ? "PASS" : "FAIL",
      { found: hasPhoneSignal }
    ),
    finding(
      "TRUST",
      "email_detection",
      "Email detection",
      hasEmailSignal ? "PASS" : "FAIL",
      { found: hasEmailSignal }
    ),
    bookingFinding,
    finding(
      "TRUST",
      "calls_to_action",
      "Calls to action",
      hasCallToAction ? "PASS" : "WARNING",
      { found: hasCallToAction }
    ),
    finding(
      "TRUST",
      "privacy_policy",
      "Privacy policy",
      hasPrivacy ? "PASS" : "FAIL",
      { found: hasPrivacy }
    ),
    finding(
      "TRUST",
      "terms_link",
      "Terms link",
      hasTerms ? "PASS" : "WARNING",
      { found: hasTerms }
    ),
    finding("TRUST", "copyright_year", "Copyright freshness", copyrightStatus, {
      year: copyrightYear,
      currentYear,
    }),
    finding(
      "SEO",
      "canonical_url",
      "Canonical URL",
      allStatus(
        count((p) => Boolean(p.canonical)),
        pages.length
      ),
      {
        pagesWithCanonical: count((p) => Boolean(p.canonical)),
        pages: pages.length,
      }
    ),
    finding(
      "SEO",
      "robots_meta",
      "Indexability",
      noindex === pages.length ? "FAIL" : indexability,
      { noindexPages: noindex, pages: pages.length }
    ),
    finding(
      "SEO",
      "robots_txt",
      "Robots.txt",
      crawl.robotsAvailable ? "PASS" : "WARNING",
      { available: crawl.robotsAvailable }
    ),
    finding("SEO", "sitemap", "Sitemap", hasSitemap ? "PASS" : "WARNING", {
      found: hasSitemap,
    }),
    finding(
      "SEO",
      "structured_data",
      "Structured data",
      pages.some((p) => p.jsonLdCount > 0) ? "PASS" : "WARNING",
      { blocks: pages.reduce((sum, p) => sum + p.jsonLdCount, 0) }
    ),
    finding(
      "TECHNICAL",
      "http_status",
      "HTTP status",
      allStatus(
        count((p) => p.status >= 200 && p.status < 300),
        pages.length
      ),
      {
        successfulPages: count((p) => p.status >= 200 && p.status < 300),
        pages: pages.length,
      }
    ),
    finding("TECHNICAL", "redirect_chain", "Redirect chain", redirectStatus, {
      redirects: crawl.redirectCount,
    }),
    finding(
      "TECHNICAL",
      "broken_internal_links",
      "Broken internal links",
      brokenStatus,
      { brokenLinks }
    ),
    finding("TECHNICAL", "broken_images", "Broken images", brokenImagesStatus, {
      brokenImages: crawl.brokenImages,
    }),
    finding(
      "TECHNICAL",
      "viewport_meta",
      "Mobile viewport",
      allStatus(
        count((p) => p.viewport),
        pages.length
      ),
      { pagesWithViewport: count((p) => p.viewport), pages: pages.length }
    ),
    finding(
      "TECHNICAL",
      "mixed_content",
      "Mixed content",
      pages.some((p) => p.insecureAssets > 0) ? "FAIL" : "PASS",
      { insecureAssets: pages.reduce((sum, p) => sum + p.insecureAssets, 0) }
    ),
    finding(
      "PERFORMANCE",
      "server_response_time",
      "Server response time",
      threshold(home.responseMs, 799, 1500),
      { milliseconds: home.responseMs }
    ),
    finding(
      "PERFORMANCE",
      "html_size",
      "HTML size",
      threshold(home.htmlBytes, 249_999, 750_000),
      { bytes: home.htmlBytes }
    ),
    finding(
      "PERFORMANCE",
      "image_count",
      "Image count",
      threshold(home.images, 30, 60),
      { images: home.images }
    ),
    finding(
      "PERFORMANCE",
      "script_count",
      "Script count",
      threshold(home.externalScripts, 20, 40),
      { scripts: home.externalScripts }
    ),
    finding(
      "PERFORMANCE",
      "render_blocking_resources",
      "Render-blocking resources",
      threshold(home.blockingResources, 1, 5),
      { resources: home.blockingResources }
    ),
  ];
};
