// Pulls accounts, balances, transactions, direct debits and standing orders for one bank connection.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  getResults,
  refreshToken,
  TrueLayerError,
  type TlAccount,
  type TlBalance,
  type TlCard,
  type TlDirectDebit,
  type TlMe,
  type TlStandingOrder,
  type TlTransaction,
} from "./truelayer.ts";

const DAY = 24 * 60 * 60 * 1000;
const FIRST_SYNC_DAYS = 90;
// Re-read a few days back on every sync because banks can book transactions late
const OVERLAP_DAYS = 5;
// Only notify about spends this recent, so catching up after a gap doesn't spam the user
const NOTIFY_WINDOW_DAYS = 2;

export interface SyncResult {
  connectionId: string;
  ok: boolean;
  newTransactions: number;
  error?: string;
}

async function freshAccessToken(admin: SupabaseClient, connectionId: string): Promise<string> {
  const { data: secret, error } = await admin
    .from("bank_connection_secrets")
    .select("*")
    .eq("connection_id", connectionId)
    .single();
  if (error || !secret) throw new Error("No stored credentials for this connection");

  if (new Date(secret.access_token_expires_at).getTime() - Date.now() > 2 * 60 * 1000) {
    return secret.access_token;
  }
  if (!secret.refresh_token) throw new TrueLayerError(401, "Access expired and no refresh token");

  const tokens = await refreshToken(secret.refresh_token);
  await admin
    .from("bank_connection_secrets")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? secret.refresh_token,
      access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    })
    .eq("connection_id", connectionId);
  return tokens.access_token;
}

function mapAccountType(tlType: string): "current" | "savings" {
  return tlType.toUpperCase().includes("SAVINGS") ? "savings" : "current";
}

export async function syncConnection(
  admin: SupabaseClient,
  connection: { id: string; user_id: string; last_synced_at: string | null },
  psuIp?: string,
): Promise<SyncResult> {
  const result: SyncResult = { connectionId: connection.id, ok: false, newTransactions: 0 };
  try {
    const token = await freshAccessToken(admin, connection.id);
    const firstSync = !connection.last_synced_at;
    const from = firstSync
      ? new Date(Date.now() - FIRST_SYNC_DAYS * DAY)
      : new Date(new Date(connection.last_synced_at!).getTime() - OVERLAP_DAYS * DAY);
    const range = `?from=${from.toISOString()}&to=${new Date().toISOString()}`;

    const me = (await getResults<TlMe>("/me", token, psuIp))?.[0];
    const accounts = (await getResults<TlAccount>("/accounts", token, psuIp)) ?? [];
    const cards = (await getResults<TlCard>("/cards", token, psuIp)) ?? [];

    const { data: existing } = await admin
      .from("accounts")
      .select("id, provider_account_id")
      .eq("connection_id", connection.id);
    const idByProvider = new Map((existing ?? []).map((a) => [a.provider_account_id, a.id as string]));

    const sources = [
      ...accounts.map((a) => ({ kind: "accounts" as const, id: a.account_id, name: a.display_name, currency: a.currency, type: mapAccountType(a.account_type) })),
      ...cards.map((c) => ({ kind: "cards" as const, id: c.account_id, name: c.display_name, currency: c.currency, type: "credit_card" as const })),
    ];

    for (const src of sources) {
      const balance = (await getResults<TlBalance>(`/${src.kind}/${src.id}/balance`, token, psuIp))?.[0];
      // A card's "current" balance is what you owe, so store it as a negative number
      const sign = src.kind === "cards" ? -1 : 1;
      const balanceFields = balance
        ? {
            balance: sign * balance.current,
            available: balance.available ?? null,
            balance_updated_at: new Date().toISOString(),
          }
        : {};

      let accountId = idByProvider.get(src.id);
      if (accountId) {
        // Keep the user's own settings (type, include_in_spending) - only refresh name and balance
        await admin.from("accounts").update({ name: src.name, ...balanceFields }).eq("id", accountId);
      } else {
        const { data: inserted, error } = await admin
          .from("accounts")
          .insert({
            user_id: connection.user_id,
            connection_id: connection.id,
            provider_account_id: src.id,
            name: src.name,
            account_type: src.type,
            currency: src.currency,
            include_in_spending: src.type !== "savings",
            ...balanceFields,
          })
          .select("id")
          .single();
        if (error) throw error;
        accountId = inserted.id as string;
      }

      const txns = (await getResults<TlTransaction>(`/${src.kind}/${src.id}/transactions${range}`, token, psuIp)) ?? [];
      if (txns.length) {
        const rows = txns.map((t) => {
          const amount = t.transaction_type === "DEBIT" ? -Math.abs(t.amount) : Math.abs(t.amount);
          const recent = Date.now() - new Date(t.timestamp).getTime() < NOTIFY_WINDOW_DAYS * DAY;
          return {
            user_id: connection.user_id,
            account_id: accountId,
            provider_txn_id: t.transaction_id,
            booked_at: t.timestamp,
            amount,
            currency: t.currency,
            description: t.description ?? "",
            merchant: t.merchant_name ?? null,
            provider_category: t.transaction_category ?? null,
            provider_classification: t.transaction_classification ?? null,
            notify: !firstSync && recent,
          };
        });
        const { data: inserted, error } = await admin
          .from("transactions")
          .upsert(rows, { onConflict: "account_id,provider_txn_id", ignoreDuplicates: true })
          .select("id");
        if (error) throw error;
        result.newTransactions += inserted?.length ?? 0;
      }

      if (src.kind === "accounts") {
        const dds = (await getResults<TlDirectDebit>(`/accounts/${src.id}/direct_debits`, token, psuIp)) ?? [];
        const sos = (await getResults<TlStandingOrder>(`/accounts/${src.id}/standing_orders`, token, psuIp)) ?? [];
        const recurring = [
          ...dds.map((d) => ({
            user_id: connection.user_id,
            account_id: accountId,
            provider_id: d.direct_debit_id,
            type: "direct_debit",
            payee: d.name,
            amount: d.previous_payment_amount != null ? Math.abs(d.previous_payment_amount) : null,
            frequency: null,
            status: d.status ?? "Active",
            last_payment_at: d.previous_payment_timestamp ?? null,
            next_payment_date: null,
            updated_at: new Date().toISOString(),
          })),
          ...sos.map((s) => ({
            user_id: connection.user_id,
            account_id: accountId,
            provider_id: [s.payee, s.reference, s.frequency].join("|"),
            type: "standing_order",
            payee: s.payee ?? s.reference ?? "Standing order",
            reference: s.reference ?? null,
            amount: s.next_payment_amount != null ? Math.abs(s.next_payment_amount) : null,
            frequency: s.frequency ?? null,
            status: s.status ?? "Active",
            last_payment_at: null,
            next_payment_date: s.next_payment_date?.slice(0, 10) ?? null,
            updated_at: new Date().toISOString(),
          })),
        ];
        if (recurring.length) {
          const { error } = await admin
            .from("recurring_payments")
            .upsert(recurring, { onConflict: "account_id,type,provider_id" });
          if (error) throw error;
        }
      }
    }

    await admin
      .from("bank_connections")
      .update({
        status: "active",
        status_detail: null,
        last_synced_at: new Date().toISOString(),
        institution_name: me?.provider?.display_name ?? undefined,
        consent_expires_at: me?.consent_expires_at ?? undefined,
      })
      .eq("id", connection.id);
    result.ok = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = message;
    const expired = err instanceof TrueLayerError && (err.status === 401 || err.status === 403 || /invalid_grant/.test(err.body));
    const rateLimited = err instanceof TrueLayerError && err.status === 429;
    await admin
      .from("bank_connections")
      .update({
        status: expired ? "expired" : rateLimited ? "active" : "error",
        status_detail: expired
          ? "Your bank access has expired. Reconnect to keep syncing."
          : rateLimited
          ? "The bank limits background refreshes; we'll try again later."
          : message.slice(0, 500),
      })
      .eq("id", connection.id);
  }
  return result;
}
