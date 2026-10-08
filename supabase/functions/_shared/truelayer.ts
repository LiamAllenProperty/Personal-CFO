// Thin TrueLayer Data API client. Docs: https://docs.truelayer.com/docs/data-api-basics
import { env } from "./http.ts";

const sandbox = () => (Deno.env.get("TRUELAYER_ENV") ?? "sandbox") !== "live";
export const authBase = () => (sandbox() ? "https://auth.truelayer-sandbox.com" : "https://auth.truelayer.com");
const apiBase = () => (sandbox() ? "https://api.truelayer-sandbox.com" : "https://api.truelayer.com");

export const SCOPES = "info accounts balance cards transactions direct_debits standing_orders offline_access";

export function redirectUri(): string {
  return `${env("SUPABASE_URL")}/functions/v1/truelayer-callback`;
}

export function authLink(state: string): string {
  const providers = sandbox() ? "uk-cs-mock uk-ob-all uk-oauth-all" : "uk-ob-all uk-oauth-all";
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env("TRUELAYER_CLIENT_ID"),
    scope: SCOPES,
    redirect_uri: redirectUri(),
    providers,
    state,
  });
  return `${authBase()}/?${params}`;
}

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(`${authBase()}/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("TRUELAYER_CLIENT_ID"),
      client_secret: env("TRUELAYER_CLIENT_SECRET"),
      ...body,
    }),
  });
  if (!res.ok) throw new TrueLayerError(res.status, await res.text());
  return await res.json();
}

export const exchangeCode = (code: string) =>
  tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });

export const refreshToken = (refresh_token: string) =>
  tokenRequest({ grant_type: "refresh_token", refresh_token });

export class TrueLayerError extends Error {
  constructor(public status: number, public body: string) {
    super(`TrueLayer ${status}: ${body.slice(0, 300)}`);
  }
}

/** GET a Data API resource and return its `results` array. Returns null when the bank doesn't support the endpoint. */
export async function getResults<T>(path: string, accessToken: string, psuIp?: string): Promise<T[] | null> {
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  if (psuIp) headers["X-PSU-IP"] = psuIp;
  const res = await fetch(`${apiBase()}/data/v1${path}`, { headers });
  if (res.status === 501 || res.status === 404) return null; // not supported by this provider
  if (!res.ok) throw new TrueLayerError(res.status, await res.text());
  const body = await res.json();
  return body.results ?? [];
}

export interface TlAccount {
  account_id: string;
  account_type: string;
  display_name: string;
  currency: string;
}
export interface TlCard {
  account_id: string;
  card_type: string;
  display_name: string;
  currency: string;
}
export interface TlBalance {
  current: number;
  available?: number;
}
export interface TlTransaction {
  transaction_id: string;
  timestamp: string;
  description: string;
  amount: number;
  currency: string;
  transaction_type: "DEBIT" | "CREDIT";
  transaction_category?: string;
  transaction_classification?: string[];
  merchant_name?: string;
}
export interface TlDirectDebit {
  direct_debit_id: string;
  name: string;
  status?: string;
  previous_payment_timestamp?: string;
  previous_payment_amount?: number;
}
export interface TlStandingOrder {
  frequency?: string;
  status?: string;
  timestamp?: string;
  next_payment_date?: string;
  next_payment_amount?: number;
  payee?: string;
  reference?: string;
}
export interface TlMe {
  provider?: { display_name?: string };
  consent_expires_at?: string;
}
