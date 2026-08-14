import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { Merchant } from "../lib/types";
import { formatDate } from "../lib/format";

export function MerchantListPage() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handle = setTimeout(async () => {
      setLoading(true);
      const params = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
      const results = await api.get<Merchant[]>(`/api/merchants${params}`);
      setMerchants(results);
      setLoading(false);
    }, 200);
    return () => clearTimeout(handle);
  }, [search]);

  return (
    <div className="card">
      <div className="page-header">
        <h1>Merchants</h1>
        <input
          type="text"
          className="search-input"
          placeholder="Search merchants…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <p className="subtitle">Loading…</p>
      ) : merchants.length === 0 ? (
        <p className="subtitle">No merchants found.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {merchants.map((merchant) => (
              <tr key={merchant.id}>
                <td>
                  <Link to={`/merchants/${merchant.id}`}>{merchant.merchantCode}</Link>
                </td>
                <td>
                  <Link to={`/merchants/${merchant.id}`}>{merchant.name}</Link>
                </td>
                <td>
                  <span className={`badge ${merchant.active ? "badge-active" : "badge-inactive"}`}>
                    {merchant.active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td>{formatDate(merchant.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
