import { ensureCurrentUser } from "@repo/auth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";

const Dashboard = async () => {
  const user = await ensureCurrentUser();

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="text-muted-foreground">Name:</span>{" "}
            {user.displayName ?? "Not set"}
          </p>
          <p>
            <span className="text-muted-foreground">Email:</span> {user.email}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Database</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-green-700">Connected</p>
          <p>Created {user.createdAt.toLocaleString()}</p>
          <p>Updated {user.updatedAt.toLocaleString()}</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;
