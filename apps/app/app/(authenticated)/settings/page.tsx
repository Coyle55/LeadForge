import { ensureCurrentUser } from "@repo/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import { SettingsForm } from "./settings-form";

const SettingsPage = async () => {
  const user = await ensureCurrentUser();

  return (
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
  );
};

export default SettingsPage;
