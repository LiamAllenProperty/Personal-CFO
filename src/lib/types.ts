export type Kind = "income" | "spending" | "direct_debit" | "standing_order" | "saving" | "investment" | "transfer";

export const KIND_LABELS: Record<Kind, string> = {
  income: "Income",
  spending: "Spending",
  direct_debit: "Direct debit",
  standing_order: "Standing order",
  saving: "Saving",
  investment: "Investing",
  transfer: "Transfer",
};

export interface Profile {
  id: string;
  display_name: string | null;
  currency: string;
  monthly_allowance: number | null;
  payday: number;
  notify_each_spend: boolean;
  onboarded: boolean;
}

export interface AllowanceStatus {
  period_start: string;
  period_end: string;
  days_left: number;
  allowance: number;
  spent: number;
  remaining: number;
  per_day: number;
  income: number;
  bills_due: number;
  currency: string;
}

export interface Transaction {
  id: string;
  account_id: string;
  booked_at: string;
  amount: number;
  description: string;
  merchant: string | null;
  kind: Kind;
  kind_locked: boolean;
}

export interface Account {
  id: string;
  connection_id: string;
  name: string;
  account_type: "current" | "savings" | "investment" | "credit_card";
  balance: number | null;
  available: number | null;
  balance_updated_at: string | null;
  include_in_spending: boolean;
}

export interface Connection {
  id: string;
  provider: "truelayer" | "demo";
  institution_name: string | null;
  status: "active" | "expired" | "error" | "revoked";
  status_detail: string | null;
  consent_expires_at: string | null;
  last_synced_at: string | null;
}

export interface RecurringPayment {
  id: string;
  type: "direct_debit" | "standing_order";
  payee: string;
  reference: string | null;
  amount: number | null;
  frequency: string | null;
  status: string | null;
  last_payment_at: string | null;
  next_payment_date: string | null;
}

export interface PeriodScore {
  period_start: string;
  period_end: string;
  income: number;
  spending: number;
  bills: number;
  saved: number;
  invested: number;
  net: number;
  saved_pct: number;
  invested_pct: number;
  points_saved: number;
  points_invested: number;
  points_budget: number;
  points_total: number;
  is_current: boolean;
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}
