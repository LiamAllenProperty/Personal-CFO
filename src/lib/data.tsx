import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../supabase";
import type {
  Account,
  AllowanceStatus,
  AppNotification,
  Connection,
  PeriodScore,
  Profile,
  RecurringPayment,
  Transaction,
} from "./types";
import { flushPush } from "./push";

interface AppData {
  session: Session;
  profile: Profile | null;
  status: AllowanceStatus | null;
  accounts: Account[];
  connections: Connection[];
  recurring: RecurringPayment[];
  scores: PeriodScore[];
  transactions: Transaction[];
  notifications: AppNotification[];
  loading: boolean;
  syncing: boolean;
  toast: AppNotification | null;
  dismissToast: () => void;
  refresh: () => Promise<void>;
  syncBanks: () => Promise<void>;
  updateProfile: (patch: Partial<Profile>) => Promise<string | null>;
}

const Ctx = createContext<AppData | null>(null);

export function useApp(): AppData {
  const value = useContext(Ctx);
  if (!value) throw new Error("useApp must be used inside <AppDataProvider>");
  return value;
}

const num = (v: unknown) => (v == null ? null : Number(v));

export function AppDataProvider({ session, children }: { session: Session; children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState<AllowanceStatus | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [recurring, setRecurring] = useState<RecurringPayment[]>([]);
  const [scores, setScores] = useState<PeriodScore[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<AppNotification | null>(null);
  const userId = session.user.id;

  const refresh = useCallback(async () => {
    const since = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString();
    const [p, s, a, c, r, sc, t, n] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).single(),
      supabase.rpc("allowance_status"),
      supabase.from("accounts").select("*").order("created_at"),
      supabase.from("bank_connections").select("*").order("created_at"),
      supabase.from("recurring_payments").select("*").order("payee"),
      supabase.rpc("period_scores", { p_months: 6 }),
      supabase.from("transactions").select("id, account_id, booked_at, amount, description, merchant, kind, kind_locked")
        .gte("booked_at", since).order("booked_at", { ascending: false }).limit(1000),
      supabase.from("notifications").select("id, title, body, read_at, created_at").order("created_at", { ascending: false }).limit(30),
    ]);
    if (p.data) setProfile({ ...p.data, monthly_allowance: num(p.data.monthly_allowance) });
    if (s.data) {
      const d = s.data as Record<string, unknown>;
      setStatus({
        ...(d as unknown as AllowanceStatus),
        allowance: Number(d.allowance), spent: Number(d.spent), remaining: Number(d.remaining),
        per_day: Number(d.per_day), income: Number(d.income), bills_due: Number(d.bills_due), days_left: Number(d.days_left),
      });
    }
    setAccounts((a.data ?? []).map((x) => ({ ...x, balance: num(x.balance), available: num(x.available) })));
    setConnections(c.data ?? []);
    setRecurring((r.data ?? []).map((x) => ({ ...x, amount: num(x.amount) })));
    setScores(
      ((sc.data as PeriodScore[] | null) ?? []).map((x) => ({
        ...x,
        income: Number(x.income), spending: Number(x.spending), bills: Number(x.bills), saved: Number(x.saved),
        invested: Number(x.invested), net: Number(x.net), saved_pct: Number(x.saved_pct), invested_pct: Number(x.invested_pct),
      })),
    );
    setTransactions((t.data ?? []).map((x) => ({ ...x, amount: Number(x.amount) })));
    setNotifications(n.data ?? []);
    setLoading(false);
  }, [userId]);

  const syncBanks = useCallback(async () => {
    setSyncing(true);
    try {
      await supabase.functions.invoke("sync", { method: "POST" });
    } finally {
      setSyncing(false);
      await refresh();
    }
  }, [refresh]);

  const updateProfile = useCallback(
    async (patch: Partial<Profile>) => {
      const { error } = await supabase.from("profiles").update(patch).eq("id", userId);
      await refresh();
      return error?.message ?? null;
    },
    [refresh, userId],
  );

  // First load, then pull fresh bank data while the user is here (doesn't count against bank limits)
  const synced = useRef(false);
  useEffect(() => {
    refresh().then(() => {
      if (!synced.current) {
        synced.current = true;
        syncBanks();
      }
    });
  }, [refresh, syncBanks]);

  // Live: new spend notifications pop up as a toast and refresh the numbers
  useEffect(() => {
    const channel = supabase
      .channel(`user-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          setToast(payload.new as AppNotification);
          flushPush();
          refresh();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh, userId]);

  return (
    <Ctx.Provider
      value={{
        session, profile, status, accounts, connections, recurring, scores, transactions, notifications,
        loading, syncing, toast, dismissToast: () => setToast(null), refresh, syncBanks, updateProfile,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
