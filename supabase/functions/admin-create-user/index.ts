import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: callerUser }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !callerUser) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", callerUser.id)
      .eq("role", "super_admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Admin access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const payload = await req.json();
    const { action = "create-user", email, password, fullName, orgId, role, userIds } = payload || {};

    const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    if (action === "list-users") {
      const wanted = Array.isArray(userIds) ? userIds.filter(Boolean) : [];
      if (wanted.length === 0) {
        return new Response(JSON.stringify({ users: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data, error } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) throw error;

      const users = (data.users || [])
        .filter((u) => wanted.includes(u.id))
        .map((u) => ({ id: u.id, email: u.email || null, created_at: u.created_at || null }));

      return new Response(JSON.stringify({ users }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "delete-org") {
      if (!orgId || typeof orgId !== "string") {
        return new Response(JSON.stringify({ error: "orgId is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Get all users in this org
      const { data: profiles } = await adminClient.from("profiles").select("id").eq("org_id", orgId);
      const userIdsToDelete = (profiles || []).map((p: any) => p.id);

      // Delete related data in order (respecting foreign keys)
      await adminClient.from("chat_messages").delete().eq("org_id", orgId);
      await adminClient.from("chat_conversations").delete().eq("org_id", orgId);
      await adminClient.from("ai_usage_logs").delete().eq("org_id", orgId);
      await adminClient.from("kpi_period_revisions").delete().eq("org_id", orgId);
      await adminClient.from("kpi_periods").delete().eq("org_id", orgId);
      await adminClient.from("support_tickets").delete().eq("org_id", orgId);
      await adminClient.from("billing_records").delete().eq("org_id", orgId);
      await adminClient.from("subscription_events").delete().eq("org_id", orgId);
      await adminClient.from("subscriptions").delete().eq("org_id", orgId);
      await adminClient.from("activity_events").delete().eq("org_id", orgId);
      await adminClient.from("org_settings").delete().eq("org_id", orgId);

      // Delete user roles and profiles, then auth users
      for (const uid of userIdsToDelete) {
        await adminClient.from("user_roles").delete().eq("user_id", uid);
        await adminClient.from("profiles").delete().eq("id", uid);
        await adminClient.auth.admin.deleteUser(uid);
      }

      // Delete the organization itself
      const { error: orgDelErr } = await adminClient.from("organizations").delete().eq("id", orgId);
      if (orgDelErr) throw orgDelErr;

      return new Response(JSON.stringify({ deleted: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "invite-user") {
      if (!email || typeof email !== "string" || email.length > 255) {
        return new Response(JSON.stringify({ error: "Valid email is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data: invited, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
        data: { full_name: typeof fullName === "string" ? fullName.slice(0, 200) : "" },
      });

      let userId: string;

      if (inviteErr && (inviteErr as any).code === "email_exists") {
        const { data: listData } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const existing = (listData?.users || []).find((u: any) => u.email === email);
        if (!existing) {
          return new Response(JSON.stringify({ error: "User exists but could not be found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        userId = existing.id;
        // Use a plain client to send a password reset email (actually sends unlike generateLink)
        const anonClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
        await anonClient.auth.resetPasswordForEmail(email, {
          redirectTo: req.headers.get("origin") || req.headers.get("referer")?.replace(/\/[^/]*$/, "") || "",
        });
      } else if (inviteErr) {
        throw inviteErr;
      } else {
        if (!invited?.user) {
          return new Response(JSON.stringify({ error: "Failed to create invitation" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        userId = invited.user.id;
      }

      const safeName = typeof fullName === "string" ? fullName.slice(0, 200) : "";
      const profileUpdate: any = { full_name: safeName };
      if (orgId && typeof orgId === "string") profileUpdate.org_id = orgId;
      await adminClient.from("profiles").update(profileUpdate).eq("id", userId);

      const assignRole = role === "super_admin" ? "super_admin" : "client_user";
      await adminClient.from("user_roles").upsert({ user_id: userId, role: assignRole }, { onConflict: "user_id,role" });

      return new Response(JSON.stringify({ userId, invited: true, reInvite: !!inviteErr }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!email || !password) {
      return new Response(JSON.stringify({ error: "Email and password are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: typeof fullName === "string" ? fullName.slice(0, 200) : "" },
    });
    if (createErr) throw createErr;

    const profileUpdate: any = { full_name: typeof fullName === "string" ? fullName.slice(0, 200) : "" };
    if (orgId && typeof orgId === "string") profileUpdate.org_id = orgId;
    await adminClient.from("profiles").update(profileUpdate).eq("id", newUser.user.id);

    const assignRole = role === "super_admin" ? "super_admin" : "client_user";
    await adminClient.from("user_roles").upsert({ user_id: newUser.user.id, role: assignRole }, { onConflict: "user_id,role" });

    return new Response(JSON.stringify({ userId: newUser.user.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("admin-create-user error:", e);
    // Generic error to client — details stay in server logs
    const msg = e instanceof Error && e.message.includes("already been registered")
      ? "A user with this email already exists"
      : "An error occurred. Please try again.";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
