import { ensureCurrentUser } from "@repo/auth";
import { database } from "@repo/database";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import { OutreachProfileForm } from "./outreach-profile-form";
import { SettingsForm } from "./settings-form";

const SettingsPage = async () => {
  const user = await ensureCurrentUser();
  const outreachProfile = await database.outreachProfile.findUnique({
    where: { userId: user.id },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>
            Update the profile attached to {user.email}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsForm displayName={user.displayName ?? ""} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Outreach Profile</CardTitle>
          <CardDescription>
            Set the details used to prepare your outreach drafts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OutreachProfileForm
            initial={{
              senderName: outreachProfile?.senderName ?? "",
              companyName: outreachProfile?.companyName ?? "",
              serviceOffered: outreachProfile?.serviceOffered ?? "",
              valueProposition: outreachProfile?.valueProposition ?? "",
              defaultCta: outreachProfile?.defaultCta ?? "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default SettingsPage;
