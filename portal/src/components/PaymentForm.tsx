import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import type { CreatedPayment, Gateway, Merchant, PaymentStatus } from "../lib/types";
import { MerchantAutocomplete } from "./MerchantAutocomplete";

const STATUS_OPTIONS: { value: PaymentStatus; label: string }[] = [
  { value: "PENDING", label: "Pending" },
  { value: "RECEIVED", label: "Received" },
  { value: "NOT_RECEIVED", label: "Not Received" },
];

function formatSubmittedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function PaymentForm() {
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [merchantName, setMerchantName] = useState("");
  const [selectedMerchant, setSelectedMerchant] = useState<Merchant | null>(null);
  const [gatewayId, setGatewayId] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<PaymentStatus>("PENDING");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastPayment, setLastPayment] = useState<CreatedPayment | null>(null);

  useEffect(() => {
    api.get<Gateway[]>("/api/gateways?active=true").then(setGateways);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLastPayment(null);

    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError("Enter a valid payment amount greater than zero.");
      return;
    }
    if (!gatewayId) {
      setError("Select a gateway.");
      return;
    }
    if (merchantName.trim().length === 0) {
      setError("Enter a merchant name.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = selectedMerchant
        ? { merchantId: selectedMerchant.id, gatewayId, grossAmount: amountNum, status, notes: notes || undefined }
        : { merchantName: merchantName.trim(), gatewayId, grossAmount: amountNum, status, notes: notes || undefined };

      const created = await api.post<CreatedPayment>("/api/payments", payload);
      setLastPayment(created);
      setMerchantName("");
      setSelectedMerchant(null);
      setAmount("");
      setStatus("PENDING");
      setNotes("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card payment-card">
      <h1>Submit a Payment</h1>
      <p className="subtitle">Enter the merchant, gateway, and amount. Date and time are recorded automatically.</p>

      {lastPayment && (
        <div className="success-banner">
          <strong>Submitted</strong>
          <div>Merchant: {lastPayment.merchant.name}</div>
          <div>Submitted: {formatSubmittedAt(lastPayment.submittedAt)}</div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <label className="field">
          <span>Merchant Name</span>
          <MerchantAutocomplete
            value={merchantName}
            onChange={(name, merchant) => {
              setMerchantName(name);
              setSelectedMerchant(merchant);
            }}
          />
        </label>

        <label className="field">
          <span>Gateway</span>
          <select value={gatewayId} onChange={(e) => setGatewayId(e.target.value)} required>
            <option value="" disabled>
              Select a gateway…
            </option>
            {gateways.map((gateway) => (
              <option key={gateway.id} value={gateway.id}>
                {gateway.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Payment Amount</span>
          <input
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            required
          />
        </label>

        <label className="field">
          <span>Payment Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as PaymentStatus)}>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Notes (optional)</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </label>

        {error && <div className="error-banner">{error}</div>}

        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Submitting…" : "Submit Payment"}
        </button>
      </form>
    </div>
  );
}
