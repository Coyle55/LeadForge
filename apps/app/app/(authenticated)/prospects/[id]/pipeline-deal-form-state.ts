const stringEntry = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

export const formatDealValueForInput = (valueCents: number | null) =>
  valueCents === null ? "" : (valueCents / 100).toFixed(2);

export const prepareDealFormData = (formData: FormData) => {
  const prepared = new FormData();
  prepared.set("prospectId", stringEntry(formData, "prospectId"));
  prepared.set("value", stringEntry(formData, "value"));
  prepared.set("expectedCloseDate", stringEntry(formData, "expectedCloseDate"));
  return prepared;
};
