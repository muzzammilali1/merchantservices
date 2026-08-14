import type { ReportFilters } from "./types";
import { API_URL } from "./api";

export function toQueryString(filters: ReportFilters, extra?: Record<string, string>): string {
  const params = new URLSearchParams();
  if (filters.merchantId) params.set("merchantId", filters.merchantId);
  if (filters.gatewayId) params.set("gatewayId", filters.gatewayId);
  if (filters.status) params.set("status", filters.status);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function exportUrl(path: string, filters: ReportFilters, format: "csv" | "pdf"): string {
  return `${API_URL}${path}${toQueryString(filters, { format })}`;
}
