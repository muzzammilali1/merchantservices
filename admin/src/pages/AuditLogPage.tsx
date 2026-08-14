import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { AuditLogEntry } from "../lib/types";
import { formatDate, formatTime } from "../lib/format";

const ENTITY_TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "merchant", label: "Merchant" },
  { value: "gateway", label: "Gateway" },
  { value: "merchant_gateway_rate", label: "Rate" },
  { value: "payment", label: "Payment" },
  { value: "user", label: "User" },
];

export function AuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [entityType, setEntityType] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = entityType ? `?entityType=${entityType}` : "";
    api.get<AuditLogEntry[]>(`/api/audit-logs${params}`).then((res) => {
      setEntries(res);
      setLoading(false);
    });
  }, [entityType]);

  return (
    <div>
      <div className="page-header">
        <h1>Audit Log</h1>
      </div>

      <div className="card">
        <div className="filter-bar">
          <label className="filter-field">
            <span>Entity Type</span>
            <select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
              {ENTITY_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <p className="subtitle">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="subtitle">No changes recorded yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Entity</th>
                  <th>Field</th>
                  <th>Old Value</th>
                  <th>New Value</th>
                  <th>Note</th>
                  <th>Changed By</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDate(entry.changedAt)}</td>
                    <td>{formatTime(entry.changedAt)}</td>
                    <td>{entry.entityType}</td>
                    <td>{entry.fieldChanged}</td>
                    <td>{entry.oldValue ?? "—"}</td>
                    <td>{entry.newValue ?? "—"}</td>
                    <td>{entry.note ?? ""}</td>
                    <td>{entry.changedBy.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
