export function formatCurrency(value: string | number): string {
  const num = typeof value === "string" ? Number(value) : value;
  return num.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "2-digit", month: "2-digit", day: "2-digit" });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export const STATUS_LABELS: Record<string, string> = {
  RECEIVED: "Received",
  NOT_RECEIVED: "Not Received",
  PENDING: "Pending",
};
