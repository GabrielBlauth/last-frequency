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

Deno.serve(async (_req) => {
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const nowIso = new Date().toISOString();

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

  let sent = 0;

  for (const row of dueRows ?? []) {
    const { data: subRow } = await supabase
      .from("push_subscriptions")
      .select("subscription")
      .eq("user_id", row.user_id)
      .maybeSingle();

    if (subRow?.subscription) {
      try {
        await webpush.sendNotification(
          subRow.subscription,
          JSON.stringify({
            title: "Last Frequency",
            body: "Your mission is complete. Resources are waiting at the shelter.",
            url: "https://gabrielblauth.github.io/last-frequency/",
          })
        );
        sent++;
      } catch (err) {
        console.error("push failed for", row.user_id, err);
      }
    }

    await supabase
      .from("player_state")
      .update({ notified: true })
      .eq("user_id", row.user_id);
  }

  return new Response(
    JSON.stringify({ checked: dueRows?.length ?? 0, sent }),
    { headers: { "Content-Type": "application/json" } }
  );
});
