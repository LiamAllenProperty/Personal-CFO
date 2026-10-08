import { supabase } from "../supabase";

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch (err) {
    console.warn("Service worker registration failed", err);
    return null;
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Asks permission and subscribes this device to "you just spent" notifications. */
export async function enablePush(userId: string): Promise<{ ok: boolean; message: string }> {
  if (!pushSupported()) {
    return {
      ok: false,
      message: "This browser can't receive notifications. On iPhone, add Personal CFO to your Home Screen first (Share → Add to Home Screen).",
    };
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, message: "Notifications are blocked in your browser settings." };

  const { data, error } = await supabase.functions.invoke<{ publicKey: string | null }>("push-dispatch", { method: "GET" });
  if (error || !data?.publicKey) {
    return { ok: false, message: "Push isn't configured on the server yet (missing VAPID keys)." };
  }

  const registration = (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker());
  if (!registration) return { ok: false, message: "Couldn't start the background worker." };
  await navigator.serviceWorker.ready;

  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(data.publicKey),
    }));
  const json = subscription.toJSON();
  const { error: saveError } = await supabase.from("push_subscriptions").upsert(
    { user_id: userId, endpoint: json.endpoint!, p256dh: json.keys!.p256dh, auth: json.keys!.auth },
    { onConflict: "endpoint", ignoreDuplicates: true },
  );
  if (saveError) return { ok: false, message: saveError.message };
  return { ok: true, message: "Notifications are on for this device." };
}

export async function devicePushEnabled(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

/** Ask the server to deliver any queued notifications right away. */
export function flushPush(): void {
  supabase.functions.invoke("push-dispatch", { method: "POST" }).catch(() => {});
}
