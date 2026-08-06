import { describe, expect, it, vi } from "vitest";

// Regex hoisted for performance
const HEX_REGEX = /^[0-9a-f]+$/;

const generateMock = vi.fn();
vi.mock("./generate", () => ({ generateDiscovery: generateMock }));

describe("PerplexityGatewayDiscoveryProvider", () => {
  it("derives discoveryId from the normalized domain when a website is present", async () => {
    generateMock.mockResolvedValue({
      candidates: [
        {
          businessName: "Ace Plumbing",
          websiteUrl: "https://www.aceplumbing.com/",
          sourceUrls: ["https://example.com/listing"],
          confidence: "HIGH",
        },
      ],
      inputTokens: 10,
      outputTokens: 20,
      durationMs: 5,
    });
    const { PerplexityGatewayDiscoveryProvider } = await import(
      "./perplexity-provider"
    );
    const provider = new PerplexityGatewayDiscoveryProvider({
      model: "anthropic/claude-haiku-4.5",
    });
    const result = await provider.search({
      businessType: "plumbers",
      location: "Cincinnati, OH",
      resultLimit: 10,
    });
    expect(result.results[0].discoveryId).toBe("aceplumbing.com");
    expect(result.results[0].websiteVerified).toBe(true);
  });

  it("derives discoveryId from a name+address hash when no website is present", async () => {
    generateMock.mockResolvedValue({
      candidates: [
        {
          businessName: "Ace Plumbing",
          formattedAddress: "123 Main St, Cincinnati, OH",
          sourceUrls: ["https://example.com/listing"],
          confidence: "LOW",
        },
      ],
      inputTokens: 10,
      outputTokens: 20,
      durationMs: 5,
    });
    const { PerplexityGatewayDiscoveryProvider } = await import(
      "./perplexity-provider"
    );
    const provider = new PerplexityGatewayDiscoveryProvider({
      model: "anthropic/claude-haiku-4.5",
    });
    const result = await provider.search({
      businessType: "plumbers",
      location: "Cincinnati, OH",
      resultLimit: 10,
    });
    expect(result.results[0].discoveryId).toMatch(HEX_REGEX);
    expect(result.results[0].websiteVerified).toBe(false);
  });

  it("rejects an invalid candidate without failing the whole search", async () => {
    generateMock.mockResolvedValue({
      candidates: [
        {
          businessName: "Ace Plumbing",
          sourceUrls: ["https://example.com"],
          confidence: "HIGH",
        },
        { sourceUrls: ["https://example.com"], confidence: "LOW" }, // missing businessName
      ],
      inputTokens: 10,
      outputTokens: 20,
      durationMs: 5,
    });
    const { PerplexityGatewayDiscoveryProvider } = await import(
      "./perplexity-provider"
    );
    const provider = new PerplexityGatewayDiscoveryProvider({
      model: "anthropic/claude-haiku-4.5",
    });
    const result = await provider.search({
      businessType: "plumbers",
      location: "Cincinnati, OH",
      resultLimit: 10,
    });
    expect(result.results).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
  });
});
