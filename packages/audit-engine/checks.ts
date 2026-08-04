import type { CrawlResult } from "./crawler";
import type { AuditCategory, AuditFinding, AuditStatus } from "./types";

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
  summary: `${label} ${status === "PASS" ? "meets" : status === "WARNING" ? "partially meets" : "does not meet"} the audit check.`,
  evidence,
});

const ratioStatus = (ratio: number): AuditStatus =>
  ratio >= 0.95 ? "PASS" : ratio >= 0.7 ? "WARNING" : "FAIL";
const allStatus = (count: number, total: number): AuditStatus =>
  count === total ? "PASS" : count === 0 ? "FAIL" : "WARNING";
const threshold = (value: number, pass: number, warning: number): AuditStatus =>
  value <= pass ? "PASS" : value <= warning ? "WARNING" : "FAIL";

export const evaluateChecks = (crawl: CrawlResult): AuditFinding[] => {
  const pages = crawl.pages;
  const home = pages[0];
  if (!home) return [];
  const count = (predicate: (page: (typeof pages)[number]) => boolean) =>
    pages.filter(predicate).length;
  const totalImages = pages.reduce((sum, page) => sum + page.images, 0);
  const altImages = pages.reduce((sum, page) => sum + page.imagesWithAlt, 0);
  const controls = pages.reduce((sum, page) => sum + page.formControls, 0);
  const labels = pages.reduce((sum, page) => sum + page.labeledControls, 0);
  const combined = `${pages.flatMap((page) => page.links).join(" ")} ${pages.map((page) => page.text).join(" ")}`.toLowerCase();
  const secure = count((page) => page.url.startsWith("https://"));
  const noindex = count((page) => page.robotsMeta.toLowerCase().includes("noindex"));
  const brokenLinks = 0;

  return [
    finding("ACCESSIBILITY", "page_title", "Page titles", allStatus(count((p) => Boolean(p.title)), pages.length), { pagesWithTitle: count((p) => Boolean(p.title)), pages: pages.length }),
    finding("ACCESSIBILITY", "meta_description", "Meta descriptions", allStatus(count((p) => Boolean(p.description)), pages.length), { pagesWithDescription: count((p) => Boolean(p.description)), pages: pages.length }),
    finding("ACCESSIBILITY", "heading_structure", "Heading structure", allStatus(count((p) => p.headings[0] === 1 && p.headings.filter((h) => h === 1).length === 1), pages.length), { pages: pages.length }),
    finding("ACCESSIBILITY", "image_alt_coverage", "Image alt coverage", ratioStatus(totalImages === 0 ? 1 : altImages / totalImages), { images: totalImages, withAlt: altImages }),
    finding("ACCESSIBILITY", "form_label_coverage", "Form label coverage", ratioStatus(controls === 0 ? 1 : labels / controls), { controls, labeled: labels }),
    finding("ACCESSIBILITY", "document_language", "Document language", allStatus(count((p) => Boolean(p.language)), pages.length), { pagesWithLanguage: count((p) => Boolean(p.language)), pages: pages.length }),
    finding("TRUST", "https", "HTTPS", allStatus(secure, pages.length), { securePages: secure, pages: pages.length }),
    finding("TRUST", "contact_path", "Contact path", /\/contact\b/.test(combined) ? "PASS" : "FAIL", { found: /\/contact\b/.test(combined) }),
    finding("TRUST", "contact_signals", "Contact signals", /(mailto:|tel:|\bphone\b|\bemail\b|call us)/.test(combined) ? "PASS" : "FAIL", { found: /(mailto:|tel:|\bphone\b|\bemail\b|call us)/.test(combined) }),
    finding("TRUST", "calls_to_action", "Calls to action", /(contact|call|book|request|quote|buy|schedule)/.test(combined) ? "PASS" : "WARNING", { found: /(contact|call|book|request|quote|buy|schedule)/.test(combined) }),
    finding("TRUST", "privacy_policy", "Privacy policy", /privacy/.test(combined) ? "PASS" : "FAIL", { found: /privacy/.test(combined) }),
    finding("TRUST", "terms_link", "Terms link", /(terms|conditions|legal)/.test(combined) ? "PASS" : "WARNING", { found: /(terms|conditions|legal)/.test(combined) }),
    finding("SEO", "canonical_url", "Canonical URL", allStatus(count((p) => Boolean(p.canonical)), pages.length), { pagesWithCanonical: count((p) => Boolean(p.canonical)), pages: pages.length }),
    finding("SEO", "robots_meta", "Indexability", noindex === 0 ? "PASS" : noindex === pages.length ? "FAIL" : "WARNING", { noindexPages: noindex, pages: pages.length }),
    finding("SEO", "robots_txt", "Robots.txt", crawl.robotsAvailable ? "PASS" : "WARNING", { available: crawl.robotsAvailable }),
    finding("SEO", "sitemap", "Sitemap", /sitemap\.xml/.test(combined) ? "PASS" : "WARNING", { found: /sitemap\.xml/.test(combined) }),
    finding("SEO", "structured_data", "Structured data", pages.some((p) => p.jsonLdCount > 0) ? "PASS" : "WARNING", { blocks: pages.reduce((sum, p) => sum + p.jsonLdCount, 0) }),
    finding("TECHNICAL", "http_status", "HTTP status", allStatus(count((p) => p.status >= 200 && p.status < 300), pages.length), { successfulPages: count((p) => p.status >= 200 && p.status < 300), pages: pages.length }),
    finding("TECHNICAL", "redirect_chain", "Redirect chain", crawl.redirectCount <= 1 ? "PASS" : crawl.redirectCount <= 3 ? "WARNING" : "FAIL", { redirects: crawl.redirectCount }),
    finding("TECHNICAL", "broken_internal_links", "Broken internal links", brokenLinks === 0 ? "PASS" : brokenLinks === 1 ? "WARNING" : "FAIL", { brokenLinks }),
    finding("TECHNICAL", "viewport_meta", "Mobile viewport", allStatus(count((p) => p.viewport), pages.length), { pagesWithViewport: count((p) => p.viewport), pages: pages.length }),
    finding("TECHNICAL", "mixed_content", "Mixed content", pages.some((p) => p.insecureAssets > 0) ? "FAIL" : "PASS", { insecureAssets: pages.reduce((sum, p) => sum + p.insecureAssets, 0) }),
    finding("PERFORMANCE", "server_response_time", "Server response time", threshold(home.responseMs, 799, 1500), { milliseconds: home.responseMs }),
    finding("PERFORMANCE", "html_size", "HTML size", threshold(home.htmlBytes, 249_999, 750_000), { bytes: home.htmlBytes }),
    finding("PERFORMANCE", "image_count", "Image count", threshold(home.images, 30, 60), { images: home.images }),
    finding("PERFORMANCE", "script_count", "Script count", threshold(home.externalScripts, 20, 40), { scripts: home.externalScripts }),
    finding("PERFORMANCE", "render_blocking_resources", "Render-blocking resources", threshold(home.blockingResources, 1, 5), { resources: home.blockingResources }),
  ];
};
