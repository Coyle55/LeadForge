import { auth, currentUser } from "@clerk/nextjs/server";
import { database } from "@repo/database";
import { logger } from "@repo/observability";

export const ensureCurrentUser = async () => {
  const { userId } = await auth();
  if (!userId) {
    throw new Error("Authentication required");
  }

  const clerkUser = await currentUser();
  const primaryEmail = clerkUser?.emailAddresses.find(
    ({ id }) => id === clerkUser.primaryEmailAddressId
  )?.emailAddress;

  if (!primaryEmail) {
    throw new Error("Primary email required");
  }

  try {
    const user = await database.user.upsert({
      where: { id: userId },
      create: { id: userId, email: primaryEmail },
      update: { email: primaryEmail },
    });
    logger.info("user.ensure.succeeded", { userId });
    return user;
  } catch (error) {
    logger.error("user.ensure.failed", { userId, error });
    throw new Error("Unable to synchronize user");
  }
};
