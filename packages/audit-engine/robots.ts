const GROUP_SPLIT = /(?=^user-agent:)/gim;
const LEADFORGE_AGENT = /^user-agent:\s*LeadForgeAudit\s*$/im;
const WILDCARD_AGENT = /^user-agent:\s*\*\s*$/im;
const DISALLOW = /^disallow:\s*(.*)$/gim;

export const isPathAllowed = (text: string, pathname: string) => {
  const groups = text.split(GROUP_SPLIT);
  const preferred = groups.find((group) => LEADFORGE_AGENT.test(group));
  const wildcard = groups.find((group) => WILDCARD_AGENT.test(group));
  const group = preferred ?? wildcard;
  if (!group) {
    return true;
  }
  const disallowed = [...group.matchAll(DISALLOW)]
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);
  return !disallowed.some((path) => pathname.startsWith(path));
};
