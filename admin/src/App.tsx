import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import { LoginForm } from "./components/LoginForm";
import { ChangePasswordForm } from "./components/ChangePasswordForm";
import { DashboardPage } from "./pages/DashboardPage";
import { MerchantListPage } from "./pages/MerchantListPage";
import { MerchantSheetPage } from "./pages/MerchantSheetPage";
import { MerchantReportPage } from "./pages/MerchantReportPage";
import { GatewayReportPage } from "./pages/GatewayReportPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import "./App.css";

export default function App() {
  const { user, loading, login, logout, refresh } = useAuth();

  if (loading) {
    return <div className="loading-screen">Loading…</div>;
  }

  if (!user) {
    return <LoginForm onLogin={login} />;
  }

  if (user.mustChangePassword) {
    return <ChangePasswordForm onChanged={refresh} />;
  }

  return (
    <BrowserRouter>
      <div className="app-shell">
        <header className="topbar">
          <span className="brand">Merchant Payment Admin</span>
          <nav className="nav-links">
            <NavLink to="/" end>
              Dashboard
            </NavLink>
            <NavLink to="/merchants">Merchants</NavLink>
            <NavLink to="/reports/merchants">Merchant Report</NavLink>
            <NavLink to="/reports/gateways">Gateway Report</NavLink>
            <NavLink to="/audit-log">Audit Log</NavLink>
          </nav>
          <div className="topbar-user">
            <span>
              {user.name} · {user.role}
            </span>
            <button className="btn-link" onClick={logout}>
              Log out
            </button>
          </div>
        </header>
        <main className="main-content">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/merchants" element={<MerchantListPage />} />
            <Route path="/merchants/:id" element={<MerchantSheetPage user={user} />} />
            <Route path="/reports/merchants" element={<MerchantReportPage />} />
            <Route path="/reports/gateways" element={<GatewayReportPage />} />
            <Route path="/audit-log" element={<AuditLogPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
