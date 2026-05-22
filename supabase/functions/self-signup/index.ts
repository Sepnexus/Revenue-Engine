import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, password, fullName, companyName } = await req.json();

    // Validate inputs
    if (!email || !password || !fullName || !companyName) {
      return new Response(
        JSON.stringify({ error: "All fields are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: "Password must be at least 6 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Create auth user (auto-confirmed)
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (userError) {
      const msg = userError.message?.includes("already been registered")
        ? "An account with this email already exists"
        : userError.message;
      return new Response(
        JSON.stringify({ error: msg }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = userData.user.id;

    // 2. Create organization
    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .insert({ name: companyName, created_by: userId })
      .select("id")
      .single();

    if (orgError) throw orgError;

    // 3. Update profile with org_id and full_name
    // handle_new_user trigger already created the profile row
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({ org_id: org.id, full_name: fullName })
      .eq("id", userId);

    if (profileError) throw profileError;

    // 4. Assign client_user role
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: "client_user" });

    if (roleError) throw roleError;

    // 5. Create subscription — Starter, active, no expiration (lifetime)
    const { error: subError } = await supabaseAdmin
      .from("subscriptions")
      .insert({
        org_id: org.id,
        plan_name: "Starter",
        plan_status: "active",
        expires_at: null,
      });

    if (subError) throw subError;

    // 6. Create org_settings with defaults
    const { error: settingsError } = await supabaseAdmin
      .from("org_settings")
      .insert({ org_id: org.id });

    if (settingsError) throw settingsError;

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("self-signup error:", err);
    return new Response(
      JSON.stringify({ error: "Something went wrong. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
