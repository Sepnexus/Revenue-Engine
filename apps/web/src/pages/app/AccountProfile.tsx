import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useOrgSettings } from "@/hooks/useOrgSettings";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { G, BG, S1, S2, S3, B1, B2, TEXT, T2, T3 } from "@/shared/kpi";
import closerControlLogo from "@/assets/closer-control-logo.png";

const TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Phoenix", "America/Anchorage", "Pacific/Honolulu", "UTC",
  "Europe/London", "Europe/Berlin", "Asia/Tokyo", "Australia/Sydney",
];

export default function AccountProfile() {
  const { user, orgId, signOut } = useAuth();
  const { settings, upsert } = useOrgSettings(orgId);
  const queryClient = useQueryClient();

  const { data: org } = useQuery({
    queryKey: ["my-org", orgId],
    queryFn: async () => {
      if (!orgId) return null;
      const { data } = await supabase.from("organizations").select("name").eq("id", orgId).maybeSingle();
      return data;
    },
    enabled: !!orgId,
  });

  const { data: profile } = useQuery({
    queryKey: ["my-profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const [orgName, setOrgName] = useState("");
  const [fullName, setFullName] = useState("");
  const [timezone, setTimezone] = useState("America/New_York");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (org) setOrgName(org.name);
    if (profile) setFullName(profile.full_name || "");
    if (settings) setTimezone(settings.timezone || "America/New_York");
  }, [org, profile, settings]);

  const updateOrgName = useMutation({
    mutationFn: async () => {
      if (!orgId) return;
      await supabase.from("organizations").update({ name: orgName }).eq("id", orgId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-org", orgId] });
      setMsg("Organization updated ✓");
      setTimeout(() => setMsg(""), 2000);
    },
  });

  const updateProfile = async () => {
    if (!user) return;
    await supabase.from("profiles").update({ full_name: fullName }).eq("id", user.id);
    setMsg("Profile updated ✓");
    setTimeout(() => setMsg(""), 2000);
  };

  const saveTimezone = () => {
    upsert.mutate({ timezone } as any);
    setMsg("Timezone saved ✓");
    setTimeout(() => setMsg(""), 2000);
  };

  const IS: React.CSSProperties = { background: S2, border: "1px solid " + B2, borderRadius: 9, padding: "12px 16px", color: TEXT, fontSize: 14, outline: "none", fontFamily: "'DM Sans',sans-serif", width: "100%" };

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "'DM Sans',sans-serif", color: TEXT }}>
      <header style={{ background: S1, borderBottom: "1px solid " + B1, padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src={closerControlLogo} alt="Closer Control" style={{ height: 30 }} />
          <Link to="/app/account" style={{ color: T2, fontSize: 13, textDecoration: "none" }}>← Account</Link>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Profile</span>
        </div>
        <button onClick={signOut} style={{ background: "transparent", border: "1px solid " + B2, borderRadius: 8, padding: "6px 15px", color: T2, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Sign Out</button>
      </header>
      <main style={{ maxWidth: 600, margin: "0 auto", padding: "40px 28px" }}>
        {msg && <div style={{ background: G + "15", border: "1px solid " + G + "40", borderRadius: 8, padding: "10px 14px", color: G, fontSize: 13, marginBottom: 20 }}>{msg}</div>}

        <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "24px", marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Organization</div>
          <div style={{ fontSize: 12, color: T3, marginBottom: 4 }}>Organization Name</div>
          <input value={orgName} onChange={e => setOrgName(e.target.value)} style={{ ...IS, marginBottom: 12 }} />
          <button onClick={() => updateOrgName.mutate()} disabled={updateOrgName.isPending} style={{ background: G + "15", border: "1px solid " + G + "40", borderRadius: 8, padding: "8px 16px", color: G, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Save Org Name</button>
        </div>

        <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "24px", marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Contact</div>
          <div style={{ fontSize: 12, color: T3, marginBottom: 4 }}>Full Name</div>
          <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your name" style={{ ...IS, marginBottom: 12 }} />
          <button onClick={updateProfile} style={{ background: G + "15", border: "1px solid " + G + "40", borderRadius: 8, padding: "8px 16px", color: G, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Update Name</button>
          <div style={{ fontSize: 12, color: T3, marginTop: 16, marginBottom: 4 }}>Email (read-only)</div>
          <div style={{ fontSize: 14, color: T2, padding: "12px 16px", background: S3, borderRadius: 9, border: "1px solid " + B2 }}>{user?.email}</div>
        </div>

        <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "24px", marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Timezone</div>
          <select value={timezone} onChange={e => setTimezone(e.target.value)} style={{ ...IS, cursor: "pointer", marginBottom: 12 }}>
            {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
          </select>
          <button onClick={saveTimezone} style={{ background: G + "15", border: "1px solid " + G + "40", borderRadius: 8, padding: "8px 16px", color: G, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Save Timezone</button>
        </div>

        <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "24px" }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Security</div>
          <Link to="/app/forgot-password" style={{ color: G, fontSize: 13, fontWeight: 600 }}>Change Password →</Link>
        </div>
      </main>
    </div>
  );
}
