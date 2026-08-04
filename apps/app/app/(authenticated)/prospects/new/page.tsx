import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import { ProspectForm } from "../prospect-form";

const empty = {
  businessName: "",
  websiteUrl: "",
  contactName: "",
  contactEmail: "",
  phone: "",
  location: "",
  notes: "",
};

const NewProspectPage = () => (
  <div className="mx-auto max-w-3xl space-y-6">
    <div>
      <p className="font-medium text-emerald-600 text-xs uppercase tracking-[0.22em]">
        New record
      </p>
      <h1 className="font-semibold text-3xl tracking-tight">Add prospect</h1>
    </div>
    <Card>
      <CardHeader>
        <CardTitle>Business details</CardTitle>
        <CardDescription>
          Start with what you know. Only the business name is required.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ProspectForm initial={empty} mode="create" />
      </CardContent>
    </Card>
  </div>
);

export default NewProspectPage;
