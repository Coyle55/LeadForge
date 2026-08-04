import { isAllowedUserId } from "@repo/auth";
import { UserButton } from "@repo/auth/client";
import { auth } from "@repo/auth/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

const AuthenticatedLayout = async ({
  children,
}: {
  readonly children: ReactNode;
}) => {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }
  if (!isAllowedUserId(userId)) {
    redirect("/access-denied");
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link className="font-semibold text-lg" href="/">
            LeadForge
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <Link href="/">Dashboard</Link>
            <Link href="/settings">Settings</Link>
            <UserButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
};

export default AuthenticatedLayout;
