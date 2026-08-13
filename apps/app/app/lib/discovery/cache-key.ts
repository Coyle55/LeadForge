import { hashIdentity, normalizeAddress, normalizeName } from "./normalize";
import { DISCOVERY_PROMPT_VERSION } from "./prompt";

// Deterministic, version-aware cache key: any change to the provider,
// reasoning model, prompt version, or normalized query params must produce
// a different key, so a prompt/model change never yields a stale-shaped
// cache hit. businessType/location are normalized first so case and
// whitespace variance alone never changes the key.
export const buildDiscoveryCacheKey = (params: {
  businessType: string;
  location: string;
  model: string;
  provider: string;
  resultLimit: number;
}): string =>
  hashIdentity(
    [
      params.provider,
      params.model,
      DISCOVERY_PROMPT_VERSION,
      normalizeName(params.businessType),
      normalizeAddress(params.location),
      String(params.resultLimit),
    ].join("|")
  );
