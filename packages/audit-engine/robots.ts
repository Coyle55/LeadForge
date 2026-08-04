export const isPathAllowed = (text: string, pathname: string) => {
  const groups = text.split(/(?=^user-agent:)/gim);
  const preferred = groups.find((group) =>
    /^user-agent:\s*LeadForgeAudit\s*$/im.test(group)
  );
  const wildcard = groups.find((group) => /^user-agent:\s*\*\s*$/im.test(group));
  const group = preferred ?? wildcard;
  if (!group) return true;
  const disallowed = [...group.matchAll(/^disallow:\s*(.*)$/gim)]
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);
  return !disallowed.some((path) => pathname.startsWith(path));
};
