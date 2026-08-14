import type { Gateway, Merchant, PaymentStatus, ReportFilters } from "../lib/types";

interface Props {
  merchants: Merchant[];
  gateways: Gateway[];
  filters: ReportFilters;
  onChange: (filters: ReportFilters) => void;
}

const STATUS_OPTIONS: { value: PaymentStatus; label: string }[] = [
  { value: "RECEIVED", label: "Received" },
  { value: "NOT_RECEIVED", label: "Not Received" },
  { value: "PENDING", label: "Pending" },
];

export function ReportFilterBar({ merchants, gateways, filters, onChange }: Props) {
  return (
    <div className="filter-bar">
      <label className="filter-field">
        <span>From</span>
        <input
          type="date"
          value={filters.from ?? ""}
          onChange={(e) => onChange({ ...filters, from: e.target.value || undefined })}
        />
      </label>
      <label className="filter-field">
        <span>To</span>
        <input
          type="date"
          value={filters.to ?? ""}
          onChange={(e) => onChange({ ...filters, to: e.target.value || undefined })}
        />
      </label>
      <label className="filter-field">
        <span>Merchant</span>
        <select
          value={filters.merchantId ?? ""}
          onChange={(e) => onChange({ ...filters, merchantId: e.target.value || undefined })}
        >
          <option value="">All merchants</option>
          {merchants.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-field">
        <span>Gateway</span>
        <select
          value={filters.gatewayId ?? ""}
          onChange={(e) => onChange({ ...filters, gatewayId: e.target.value || undefined })}
        >
          <option value="">All gateways</option>
          {gateways.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-field">
        <span>Status</span>
        <select
          value={filters.status ?? ""}
          onChange={(e) =>
            onChange({ ...filters, status: (e.target.value || undefined) as PaymentStatus | undefined })
          }
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      {(filters.from || filters.to || filters.merchantId || filters.gatewayId || filters.status) && (
        <button type="button" className="btn-link" onClick={() => onChange({})}>
          Clear filters
        </button>
      )}
    </div>
  );
}
