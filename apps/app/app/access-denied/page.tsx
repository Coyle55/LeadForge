import { SignOutButton } from "@repo/auth/client";
import { Button } from "@repo/design-system/components/ui/button";

const AccessDeniedPage = () => (
  <main className="grid min-h-screen place-items-center p-6">
    <div className="max-w-md space-y-4 text-center">
      <h1 className="font-semibold text-2xl">Access denied</h1>
      <p className="text-muted-foreground">
        This private LeadForge workspace is restricted to its configured owner.
      </p>
      <SignOutButton>
        <Button>Sign out</Button>
      </SignOutButton>
    </div>
  </main>
);

export default AccessDeniedPage;
