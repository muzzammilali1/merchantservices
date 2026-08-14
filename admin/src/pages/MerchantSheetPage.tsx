import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, API_URL } from "../lib/api";
import type { CurrentUser, Gateway, MerchantSummary, Payment, PaymentStatus } from "../lib/types";
import { formatCurrency, formatDate, formatTime, STATUS_LABELS } from "../lib/format";
import { ExportButtons } from "../components/ExportButtons";

interface Props {
  user: CurrentUser;
}

const STATUS_OPTIONS: PaymentStatus[] = ["PENDING", "RECEIVED", "NOT_RECEIVED"];

export function MerchantSheetPage({ user }: Props) {
  const { id } = useParams<{ id: string }>();
  const [summary, setSummary] = useState<MerchantSummary | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rateGatewayId, setRateGatewayId] = useState("");
  const [ratePercentage, setRatePercentage] = useState("");
  const [applyRetroactively, setApplyRetroactively] = useState(false);
  const [rateSubmitting, setRateSubmitting] = useState(false);
  const [rateMessage, setRateMessage] = useState<string | null>(null);

  const isAdmin = user.role === "ADMIN";

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [summaryRes, paymentsRes, gatewaysRes] = await Promise.all([
        api.get<MerchantSummary>(`/api/merchants/${id}/summary`),
        api.get<Payment[]>(`/api/payments?merchantId=${id}`),
        api.get<Gateway[]>(`/api/gateways?active=true`),
      ]);
      setSummary(summaryRes);
      setPayments(paymentsRes);
      setGateways(gatewaysRes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load merchant.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  async function handleSetRate(e: FormEvent) {
    e.preventDefault();
    if (!id || !rateGatewayId) return;
    setRateSubmitting(true);
    setRateMessage(null);
    try {
      const result = await api.post<{ paymentsAffectedCount: number }>(
        `/api/merchants/${id}/gateway-rates`,
        {
          gatewayId: rateGatewayId,
          percentage: Number(ratePercentage),
          applyRetroactively,
        }
      );
      setRateMessage(
        applyRetroactively
          ? `Rate updated. ${result.paymentsAffectedCount} existing payment(s) were recalculated.`
          : "Rate updated for future payments."
      );
      setRateGatewayId("");
      setRatePercentage("");
      setApplyRetroactively(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to set rate.");
    } finally {
      setRateSubmitting(false);
    }
  }

  async function handleStatusChange(paymentId: string, status: PaymentStatus) {
    try {
      await api.patch(`/api/payments/${paymentId}`, { status });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update payment status.");
    }
  }

  if (loading) return <div className="card">Loading…</div>;
  if (error && !summary) return <div className="card error-banner">{error}</div>;
  if (!summary) return null;

  const { merchant, totals, gatewayBreakdown, currentRates } = summary;

  return (
    <div className="sheet">
      <Link to="/merchants" className="back-link">
        ← All merchants
      </Link>

      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <div className="page-header">
          <div>
            <h1>{merchant.name}</h1>
            <p className="subtitle">
              {merchant.merchantCode} · Created {formatDate(merchant.createdAt)} by {merchant.createdBy.name}
            </p>
          </div>
          <span className={`badge ${merchant.active ? "badge-active" : "badge-inactive"}`}>
            {merchant.active ? "Active" : "Inactive"}
          </span>
        </div>
        <ExportButtons
          label="Statement"
          csvUrl={`${API_URL}/api/payments?merchantId=${id}&format=csv`}
          pdfUrl={`${API_URL}/api/merchants/${id}/summary?format=pdf`}
        />
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">Total Received</span>
          <span className="stat-value">{formatCurrency(totals.totalReceived)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Unreceived</span>
          <span className="stat-value">{formatCurrency(totals.totalNotReceived)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Pending</span>
          <span className="stat-value">{formatCurrency(totals.totalPending)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Deduction</span>
          <span className="stat-value">{formatCurrency(totals.totalDeduction)}</span>
        </div>
        <div className="stat-card stat-card-highlight">
          <span className="stat-label">Net Amount</span>
          <span className="stat-value">{formatCurrency(totals.totalNet)}</span>
        </div>
      </div>

      <div className="card">
        <h2>By Gateway</h2>
        {gatewayBreakdown.length === 0 ? (
          <p className="subtitle">No payments yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Gateway</th>
                <th>Received</th>
                <th>Not Received</th>
                <th>Pending</th>
                <th>Deduction</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {gatewayBreakdown.map((g) => (
                <tr key={g.gatewayId}>
                  <td>{g.gatewayName}</td>
                  <td>{formatCurrency(g.received)}</td>
                  <td>{formatCurrency(g.notReceived)}</td>
                  <td>{formatCurrency(g.pending)}</td>
                  <td>{formatCurrency(g.deduction)}</td>
                  <td>{formatCurrency(g.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Rates by Gateway</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Gateway</th>
              <th>Current Rate</th>
            </tr>
          </thead>
          <tbody>
            {currentRates.length === 0 ? (
              <tr>
                <td colSpan={2} className="subtitle">
                  No rates configured yet.
                </td>
              </tr>
            ) : (
              currentRates.map((r) => (
                <tr key={r.gatewayId}>
                  <td>{r.gatewayName}</td>
                  <td>{r.percentage}%</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {isAdmin && (
          <form className="rate-form" onSubmit={handleSetRate}>
            <div className="inline-form">
              <select value={rateGatewayId} onChange={(e) => setRateGatewayId(e.target.value)} required>
                <option value="" disabled>
                  Select gateway…
                </option>
                {gateways.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                placeholder="Rate %"
                value={ratePercentage}
                onChange={(e) => setRatePercentage(e.target.value)}
                required
              />
              <button type="submit" className="btn-secondary" disabled={rateSubmitting}>
                {rateSubmitting ? "Saving…" : "Set Rate"}
              </button>
            </div>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={applyRetroactively}
                onChange={(e) => setApplyRetroactively(e.target.checked)}
              />
              <span>
                Recalculate existing payments with this new rate (otherwise it only applies to payments
                submitted from now on)
              </span>
            </label>
            {rateMessage && <p className="rate-message">{rateMessage}</p>}
          </form>
        )}
      </div>

      <div className="card">
        <h2>Payments</h2>
        {payments.length === 0 ? (
          <p className="subtitle">No payments yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Gateway</th>
                  <th>Gross</th>
                  <th>Status</th>
                  <th>Rate</th>
                  <th>Deduction</th>
                  <th>Net</th>
                  <th>Notes</th>
                  <th>Created By</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDate(p.submittedAt)}</td>
                    <td>{formatTime(p.submittedAt)}</td>
                    <td>{p.gateway.name}</td>
                    <td>{formatCurrency(p.grossAmount)}</td>
                    <td>
                      {isAdmin ? (
                        <select
                          value={p.status}
                          onChange={(e) => handleStatusChange(p.id, e.target.value as PaymentStatus)}
                          className={`status-select status-${p.status.toLowerCase()}`}
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className={`badge status-${p.status.toLowerCase()}`}>{STATUS_LABELS[p.status]}</span>
                      )}
                    </td>
                    <td>{p.rateSnapshot}%</td>
                    <td>{p.deductionAmount ? formatCurrency(p.deductionAmount) : "—"}</td>
                    <td>{p.netAmount ? formatCurrency(p.netAmount) : "—"}</td>
                    <td>{p.notes ?? ""}</td>
                    <td>{p.createdBy.name}</td>
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
