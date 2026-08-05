import { zonedLocalInputToIso } from "../../../lib/tasks/time";

const stringEntry = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

export const prepareTaskFormData = (formData: FormData) => {
  const prepared = new FormData();
  prepared.set("title", stringEntry(formData, "title"));
  prepared.set(
    "dueAt",
    zonedLocalInputToIso(stringEntry(formData, "dueAtLocal"))
  );
  prepared.set("priority", stringEntry(formData, "priority"));
  return prepared;
};
