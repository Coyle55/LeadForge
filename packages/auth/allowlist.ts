export const isAllowedUserId = (
  userId: string,
  configuredIds = process.env.ALLOWED_USER_IDS
): boolean => {
  const allowedIds = new Set(
    (configuredIds ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );

  return allowedIds.has(userId);
};
