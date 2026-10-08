import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { AppDataProvider, useApp } from "./lib/data";
import AuthPage from "./pages/AuthPage";
import WalletPage from "./pages/WalletPage";
import ActivityPage from "./pages/ActivityPage";
import BillsPage from "./pages/BillsPage";
import CashFlowPage from "./pages/CashFlowPage";
import PointsPage from "./pages/PointsPage";
import AccountsPage from "./pages/AccountsPage";
import SettingsPage from "./pages/SettingsPage";
import OnboardingPage from "./pages/OnboardingPage";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <div className="splash">Loading…</div>;
  if (!session) return <AuthPage />;
  return (
    <AppDataProvider session={session}>
      <Shell />
    </AppDataProvider>
  );
}

const NAV = [
  { to: "/", label: "Wallet", icon: "💷" },
  { to: "/activity", label: "Activity", icon: "🧾" },
  { to: "/bills", label: "Bills", icon: "📅" },
  { to: "/cash-flow", label: "Cash flow", icon: "📊" },
  { to: "/points", label: "Points", icon: "🏆" },
];

function Shell() {
  const { profile, loading, toast, dismissToast } = useApp();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(dismissToast, 6000);
    return () => clearTimeout(t);
  }, [toast, dismissToast]);

  if (loading) return <div className="splash">Loading your money…</div>;
  if (profile && !profile.onboarded) return <OnboardingPage />;

  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand">Personal CFO</NavLink>
        <nav className="topnav">
          <NavLink to="/accounts">Accounts</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      </header>

      {toast && (
        <button className="toast" onClick={dismissToast}>
          <strong>{toast.title}</strong>
          <span>{toast.body}</span>
        </button>
      )}

      <main className="content">
        <Routes>
          <Route path="/" element={<WalletPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/bills" element={<BillsPage />} />
          <Route path="/cash-flow" element={<CashFlowPage />} />
          <Route path="/points" element={<PointsPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <nav className="tabbar">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"}>
            <span aria-hidden>{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
