import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;
webpush.setVapidDetails(
  "mailto:noreply@lastfrequency.app",
  vapidPublicKey,
  vapidPrivateKey
);

async function sendPushTo(supabase: any, userId: string, payload: Record<string, unknown>) {
  const { data: subRow } = await supabase
    .from("push_subscriptions")
    .select("subscription")
    .eq("user_id", userId)
    .maybeSingle();
  if (!subRow?.subscription) return false;
  try {
    await webpush.sendNotification(subRow.subscription, JSON.stringify(payload));
    return true;
  } catch (err) {
    console.error("push failed for", userId, err);
    return false;
  }
}

Deno.serve(async (_req) => {
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const nowIso = new Date().toISOString();
  let sent = 0;

  // ---------- Mission complete notifications (existing) ----------
  const { data: dueRows, error } = await supabase
    .from("player_state")
    .select("user_id, player_id, notify_at")
    .not("notify_at", "is", null)
    .lte("notify_at", nowIso)
    .eq("notified", false);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  for (const row of dueRows ?? []) {
    const ok = await sendPushTo(supabase, row.user_id, {
      title: "Last Frequency",
      body: "Your mission is complete. Resources are waiting at the shelter.",
      url: "https://gabrielblauth.github.io/last-frequency/",
    });
    if (ok) sent++;
    await supabase
      .from("player_state")
      .update({ notified: true })
      .eq("user_id", row.user_id);
  }

  // ---------- Encounter notifications (new) ----------
  const { data: encounterRows, error: encounterError } = await supabase
    .from("player_state")
    .select("user_id, player_id, encounter_notify_at, active_mission")
    .not("encounter_notify_at", "is", null)
    .lte("encounter_notify_at", nowIso)
    .eq("encounter_notified", false);
  if (encounterError) {
    return new Response(JSON.stringify({ error: encounterError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  for (const row of encounterRows ?? []) {
    const enemy = row.active_mission?.encounter?.enemy;
    const body = enemy
      ? `${enemy} spotted. Open Last Frequency to decide — fight or retreat.`
      : "Something's out there. Open Last Frequency to decide — fight or retreat.";
    const ok = await sendPushTo(supabase, row.user_id, {
      title: "Last Frequency",
      body,
      url: "https://gabrielblauth.github.io/last-frequency/",
    });
    if (ok) sent++;
    await supabase
      .from("player_state")
      .update({ encounter_notified: true })
      .eq("user_id", row.user_id);
  }

  return new Response(
    JSON.stringify({
      checked: (dueRows?.length ?? 0) + (encounterRows?.length ?? 0),
      sent,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
});
