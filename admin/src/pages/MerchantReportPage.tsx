import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { Gateway, Merchant, MerchantReportRow, ReportFilters } from "../lib/types";
import { formatCurrency } from "../lib/format";
import { exportUrl, toQueryString } from "../lib/queryString";
import { ReportFilterBar } from "../components/ReportFilterBar";
import { ExportButtons } from "../components/ExportButtons";

export function MerchantReportPage() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [filters, setFilters] = useState<ReportFilters>({});
  const [rows, setRows] = useState<MerchantReportRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Merchant[]>("/api/merchants").then(setMerchants);
    api.get<Gateway[]>("/api/gateways").then(setGateways);
  }, []);

  useEffect(() => {
    setLoading(true);
    api.get<MerchantReportRow[]>(`/api/reports/merchants${toQueryString(filters)}`).then((res) => {
      setRows(res);
      setLoading(false);
    });
  }, [filters]);

  return (
    <div>
      <div className="page-header">
        <h1>Merchant Report</h1>
        <ExportButtons
          csvUrl={exportUrl("/api/reports/merchants", filters, "csv")}
          pdfUrl={exportUrl("/api/reports/merchants", filters, "pdf")}
        />
      </div>

      <div className="card">
        <ReportFilterBar merchants={merchants} gateways={gateways} filters={filters} onChange={setFilters} />
      </div>

      <div className="card">
        {loading ? (
          <p className="subtitle">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="subtitle">No merchants found.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th>Status</th>
                  <th>Gross</th>
                  <th>Received</th>
                  <th>Not Received</th>
                  <th>Pending</th>
                  <th>Deduction</th>
                  <th>Net</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.merchantId}>
                    <td>
                      <Link to={`/merchants/${row.merchantId}`}>{row.name}</Link>
                    </td>
                    <td>
                      <span className={`badge ${row.active ? "badge-active" : "badge-inactive"}`}>
                        {row.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>{formatCurrency(row.totals.gross)}</td>
                    <td>{formatCurrency(row.totals.received)}</td>
                    <td>{formatCurrency(row.totals.notReceived)}</td>
                    <td>{formatCurrency(row.totals.pending)}</td>
                    <td>{formatCurrency(row.totals.deduction)}</td>
                    <td>{formatCurrency(row.totals.net)}</td>
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
