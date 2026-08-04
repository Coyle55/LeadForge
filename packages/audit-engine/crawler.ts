import { parse, type DefaultTreeAdapterMap } from "parse5";
import { AuditEngineError } from "./errors";
import { isPathAllowed } from "./robots";
import { resolveRedirectTarget, validatePublicTarget } from "./target-policy";
import type { AuditDependencies } from "./types";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

export interface PageFacts {
  url: string;
  title: string;
  description: string;
  language: string;
  headings: number[];
  images: number;
  imagesWithAlt: number;
  formControls: number;
  labeledControls: number;
  links: string[];
  text: string;
  canonical: string | null;
  robotsMeta: string;
  jsonLdCount: number;
  viewport: boolean;
  insecureAssets: number;
  externalScripts: number;
  blockingResources: number;
  htmlBytes: number;
  responseMs: number;
  status: number;
}

export interface CrawlResult {
  requestedUrl: string;
  finalUrl: string;
  redirectCount: number;
  pagesAttempted: number;
  pagesAudited: number;
  pages: PageFacts[];
  robotsAvailable: boolean;
}

const attr = (element: Element | undefined, name: string) =>
  element?.attrs.find((item) => item.name.toLowerCase() === name)?.value ?? "";

const elements = (node: Node, output: Element[] = []) => {
  if ("tagName" in node) output.push(node);
  if ("childNodes" in node) {
    for (const child of node.childNodes) elements(child, output);
  }
  return output;
};

const textOf = (node: Node): string => {
  if ("value" in node) return node.value;
  return "childNodes" in node ? node.childNodes.map(textOf).join(" ") : "";
};

const fetchHtml = async (
  initialUrl: URL,
  dependencies: AuditDependencies
) => {
  const fetcher = dependencies.fetch ?? fetch;
  let url = initialUrl;
  let redirects = 0;
  while (true) {
    await validatePublicTarget(url, dependencies);
    const started = (dependencies.now ?? Date.now)();
    let response: Response;
    try {
      response = await fetcher(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
        headers: { "user-agent": "LeadForgeAudit/1.0" },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new AuditEngineError("TIMEOUT");
      }
      throw new AuditEngineError("UNREACHABLE");
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!(location && redirects < 5)) {
        throw new AuditEngineError("INVALID_RESPONSE");
      }
      url = await resolveRedirectTarget(location, url, dependencies);
      redirects += 1;
      continue;
    }
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.toLowerCase().includes("text/html")) {
      throw new AuditEngineError("INVALID_RESPONSE");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 2 * 1024 * 1024) {
      throw new AuditEngineError("RESPONSE_TOO_LARGE");
    }
    return {
      html: new TextDecoder().decode(bytes),
      url,
      redirects,
      responseMs: (dependencies.now ?? Date.now)() - started,
      status: response.status,
      htmlBytes: bytes.byteLength,
    };
  }
};

const parseFacts = (
  result: Awaited<ReturnType<typeof fetchHtml>>
): PageFacts => {
  const document = parse(result.html);
  const nodes = elements(document);
  const find = (tag: string) => nodes.filter((node) => node.tagName === tag);
  const meta = (name: string) =>
    find("meta").find((node) => attr(node, "name").toLowerCase() === name);
  const links = find("a")
    .map((node) => attr(node, "href"))
    .filter(Boolean)
    .map((href) => {
      try {
        return new URL(href, result.url).href;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  const images = find("img");
  const controls = nodes.filter((node) =>
    ["input", "select", "textarea"].includes(node.tagName)
  );
  const labelsFor = new Set(find("label").map((node) => attr(node, "for")));
  const resources = nodes.filter((node) =>
    ["script", "link", "img"].includes(node.tagName)
  );
  const canonical = find("link").find((node) =>
    attr(node, "rel").toLowerCase().split(/\s+/).includes("canonical")
  );
  return {
    url: result.url.href,
    title: textOf(find("title")[0] ?? document).trim(),
    description: attr(meta("description"), "content"),
    language: attr(find("html")[0], "lang"),
    headings: nodes
      .map((node) => /^h([1-6])$/.exec(node.tagName)?.[1])
      .filter(Boolean)
      .map(Number),
    images: images.length,
    imagesWithAlt: images.filter((node) => node.attrs.some((item) => item.name === "alt")).length,
    formControls: controls.length,
    labeledControls: controls.filter((node) => labelsFor.has(attr(node, "id")) || attr(node, "aria-label")).length,
    links,
    text: textOf(document).replace(/\s+/g, " ").trim(),
    canonical: canonical ? attr(canonical, "href") : null,
    robotsMeta: attr(meta("robots"), "content"),
    jsonLdCount: find("script").filter((node) => attr(node, "type") === "application/ld+json").length,
    viewport: Boolean(meta("viewport")),
    insecureAssets: resources.filter((node) => /^(src|href)$/.test(node.attrs[0]?.name ?? "") && /http:\/\//i.test(node.attrs[0]?.value ?? "")).length,
    externalScripts: find("script").filter((node) => Boolean(attr(node, "src"))).length,
    blockingResources: find("script").filter((node) => attr(node, "src") && !(attr(node, "async") || attr(node, "defer"))).length + find("link").filter((node) => attr(node, "rel") === "stylesheet").length,
    htmlBytes: result.htmlBytes,
    responseMs: result.responseMs,
    status: result.status,
  };
};

const preferredScore = (url: string) => {
  const index = ["contact", "about", "services", "pricing", "privacy", "terms", "legal"].findIndex((word) => url.toLowerCase().includes(word));
  return index === -1 ? 99 : index;
};

export const crawlWebsite = async (
  input: string,
  dependencies: AuditDependencies
): Promise<CrawlResult> => {
  const requested = await validatePublicTarget(input, dependencies);
  const robotsUrl = new URL("/robots.txt", requested);
  let robotsText = "";
  let robotsAvailable = false;
  try {
    const response = await (dependencies.fetch ?? fetch)(robotsUrl, { headers: { "user-agent": "LeadForgeAudit/1.0" } });
    if (response.ok) {
      robotsText = await response.text();
      robotsAvailable = true;
    }
  } catch {
    robotsAvailable = false;
  }
  if (!isPathAllowed(robotsText, requested.pathname)) {
    throw new AuditEngineError("ROBOTS_BLOCKED");
  }
  const homepage = await fetchHtml(requested, dependencies);
  const origin = homepage.url.origin;
  const first = parseFacts(homepage);
  const candidates = [...new Set(first.links)]
    .filter((href) => {
      const url = new URL(href);
      return url.origin === origin && isPathAllowed(robotsText, url.pathname) && !/(login|sign-in|account)/i.test(url.pathname);
    })
    .sort((a, b) => preferredScore(a) - preferredScore(b));
  const pages = [first];
  let pagesAttempted = 1;
  for (const candidate of candidates) {
    if (pages.length >= 5) break;
    pagesAttempted += 1;
    try {
      pages.push(parseFacts(await fetchHtml(new URL(candidate), dependencies)));
    } catch {
      // A sampled internal-page failure is evidence for later checks, not a fatal run.
    }
  }
  return {
    requestedUrl: requested.href,
    finalUrl: homepage.url.href,
    redirectCount: homepage.redirects,
    pagesAttempted,
    pagesAudited: pages.length,
    pages,
    robotsAvailable,
  };
};
