import { useAuth } from "./hooks/useAuth";
import { LoginForm } from "./components/LoginForm";
import { ChangePasswordForm } from "./components/ChangePasswordForm";
import { PaymentForm } from "./components/PaymentForm";
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
    <div className="app-shell">
      <header className="topbar">
        <span className="brand">Merchant Payment Portal</span>
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
        <PaymentForm />
      </main>
    </div>
  );
}
