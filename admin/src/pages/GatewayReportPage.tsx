import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Gateway, GatewayReportRow, Merchant, ReportFilters } from "../lib/types";
import { formatCurrency } from "../lib/format";
import { exportUrl, toQueryString } from "../lib/queryString";
import { ReportFilterBar } from "../components/ReportFilterBar";
import { ExportButtons } from "../components/ExportButtons";

export function GatewayReportPage() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [filters, setFilters] = useState<ReportFilters>({});
  const [rows, setRows] = useState<GatewayReportRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Merchant[]>("/api/merchants").then(setMerchants);
    api.get<Gateway[]>("/api/gateways").then(setGateways);
  }, []);

  useEffect(() => {
    setLoading(true);
    api.get<GatewayReportRow[]>(`/api/reports/gateways${toQueryString(filters)}`).then((res) => {
      setRows(res);
      setLoading(false);
    });
  }, [filters]);

  return (
    <div>
      <div className="page-header">
        <h1>Gateway Report</h1>
        <ExportButtons
          csvUrl={exportUrl("/api/reports/gateways", filters, "csv")}
          pdfUrl={exportUrl("/api/reports/gateways", filters, "pdf")}
        />
      </div>

      <div className="card">
        <ReportFilterBar merchants={merchants} gateways={gateways} filters={filters} onChange={setFilters} />
      </div>

      <div className="card">
        {loading ? (
          <p className="subtitle">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="subtitle">No gateways found.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Gateway</th>
                <th>Status</th>
                <th>Transactions</th>
                <th>Received</th>
                <th>Not Received</th>
                <th>Pending</th>
                <th>Total Volume</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.gatewayId}>
                  <td>{row.name}</td>
                  <td>
                    <span className={`badge ${row.active ? "badge-active" : "badge-inactive"}`}>
                      {row.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>{row.totals.count}</td>
                  <td>{formatCurrency(row.totals.received)}</td>
                  <td>{formatCurrency(row.totals.notReceived)}</td>
                  <td>{formatCurrency(row.totals.pending)}</td>
                  <td>{formatCurrency(row.totals.gross)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
