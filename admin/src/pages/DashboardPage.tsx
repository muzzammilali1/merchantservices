import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { DashboardData, Gateway, Merchant, ReportFilters } from "../lib/types";
import { formatCurrency } from "../lib/format";
import { toQueryString } from "../lib/queryString";
import { ReportFilterBar } from "../components/ReportFilterBar";

export function DashboardPage() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [filters, setFilters] = useState<ReportFilters>({});
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Merchant[]>("/api/merchants").then(setMerchants);
    api.get<Gateway[]>("/api/gateways").then(setGateways);
  }, []);

  useEffect(() => {
    setLoading(true);
    api.get<DashboardData>(`/api/reports/dashboard${toQueryString(filters)}`).then((res) => {
      setData(res);
      setLoading(false);
    });
  }, [filters]);

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
      </div>

      <div className="card">
        <ReportFilterBar merchants={merchants} gateways={gateways} filters={filters} onChange={setFilters} />
      </div>

      {loading || !data ? (
        <div className="card">Loading…</div>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <span className="stat-label">Total Merchants</span>
              <span className="stat-value">{data.totalMerchants}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Total Gross Payments</span>
              <span className="stat-value">{formatCurrency(data.totals.gross)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Total Received</span>
              <span className="stat-value">{formatCurrency(data.totals.received)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Total Unreceived</span>
              <span className="stat-value">{formatCurrency(data.totals.notReceived)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Total Pending</span>
              <span className="stat-value">{formatCurrency(data.totals.pending)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Gateways Active</span>
              <span className="stat-value">{data.totalGatewayCount}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Total Deductions</span>
              <span className="stat-value">{formatCurrency(data.totals.deduction)}</span>
            </div>
            <div className="stat-card stat-card-highlight">
              <span className="stat-label">Total Net Amount</span>
              <span className="stat-value">{formatCurrency(data.totals.net)}</span>
            </div>
          </div>

          <div className="card">
            <h2>Volume by Gateway</h2>
            {data.gatewayBreakdown.length === 0 ? (
              <p className="subtitle">No payment activity for this filter.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Gateway</th>
                    <th>Received</th>
                    <th>Not Received</th>
                    <th>Pending</th>
                    <th>Volume</th>
                    <th>Deduction</th>
                    <th>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {data.gatewayBreakdown.map((g) => (
                    <tr key={g.gatewayId}>
                      <td>{g.gatewayName}</td>
                      <td>{formatCurrency(g.received)}</td>
                      <td>{formatCurrency(g.notReceived)}</td>
                      <td>{formatCurrency(g.pending)}</td>
                      <td>{formatCurrency(g.volume)}</td>
                      <td>{formatCurrency(g.deduction)}</td>
                      <td>{formatCurrency(g.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
