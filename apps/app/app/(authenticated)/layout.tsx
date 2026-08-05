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
        <div className="mx-auto flex max-w-5xl flex-col items-start gap-4 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <Link className="font-semibold text-lg" href="/">
            LeadForge
          </Link>
          <nav className="flex w-full items-center gap-5 overflow-x-auto whitespace-nowrap pb-1 text-sm sm:w-auto sm:pb-0">
            <Link href="/">Dashboard</Link>
            <Link href="/pipeline">Pipeline</Link>
            <Link href="/prospects">Prospects</Link>
            <Link href="/audits">Audits</Link>
            <Link href="/opportunities">Opportunities</Link>
            <Link href="/outreach">Outreach</Link>
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
