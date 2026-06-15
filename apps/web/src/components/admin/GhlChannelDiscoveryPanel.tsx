// Channel-signal discovery + mapping for the GHL integration.
//
// Three-step flow:
//   1. "Discover" — runs a full contact sync (paginated), fetches custom
//      field definitions, then calls ghl_channel_signal_distribution.
//   2. Pick a field: source, tags, or one of the named custom fields.
//      Each option shows top distinct values with contact + won counts.
//   3. Map each value → a Revenue Engine channel (free-text; we don't
//      enforce a fixed list because every client has different channels).
//      Save → ghl_save_channel_signal.
//
// After the mapping is saved, the parent component (GhlIntegrationSection)
// can call ghl_sync_finalize which reads the saved config and rolls won
// opportunities into kpi_periods.data.channels[] by (close-month, channel).

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { S1, S2, S3, B1, TEXT, T2, T3, G, RED, AMBER } from "@/shared/kpi";

const IS: React.CSSProperties = {
  width: "100%", background: S2, border: "1px solid " + B1, borderRadius: 8,
  color: TEXT, padding: "8px 12px", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box",
};
const BTN_PRIMARY: React.CSSProperties = {
  background: G, border: "none", borderRadius: 8, padding: "9px 18px",
  color: "#000", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
};
const BTN_GHOST: React.CSSProperties = {
  background: "transparent", border: "1px solid " + B1, borderRadius: 8,
  padding: "8px 16px", color: TEXT, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
};

async function waitForRequest(reqId: number, opts: { timeoutMs?: number; intervalMs?: number } = {}) {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const intervalMs = opts.intervalMs ?? 400;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data, error } = await supabase.rpc("ghl_request_result", { p_request_id: reqId });
    if (error) throw error;
    if (data && (data as any).pending === false) return data as any;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for GHL response after ${timeoutMs}ms`);
}

interface ValueRow {
  value: string;
  contact_count: number;
  won_count: number;
  won_revenue: number;
}
interface CustomFieldDist {
  field_id: string;
  field_name: string;
  values: ValueRow[];
}
interface Distribution {
  source: ValueRow[];
  tags: ValueRow[];
  custom_fields: CustomFieldDist[];
}
interface ChannelSignal {
  field_type?: "source" | "tags" | "custom_field";
  field_id?: string;
  field_name?: string;
  value_to_channel?: Record<string, string>;
  default_channel?: string;
}

export default function GhlChannelDiscoveryPanel({ orgId }: { orgId: string }) {
  const qc = useQueryClient();

  // Load current signal config from the org row
  const { data: signal } = useQuery({
    queryKey: ["admin-org-ghl-signal", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("ghl_channel_signal, ghl_custom_fields_cache")
        .eq("id", orgId)
        .single();
      if (error) throw error;
      return data as { ghl_channel_signal: ChannelSignal; ghl_custom_fields_cache: any[] };
    },
  });

  const savedSignal: ChannelSignal = signal?.ghl_channel_signal || {};

  const [busy, setBusy] = useState<null | "discover" | "save">(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  const [dist, setDist] = useState<Distribution | null>(null);
  const [pickedFieldKey, setPickedFieldKey] = useState<string>(""); // e.g. "source", "tags", "cf:<id>"
  const [mapping, setMapping] = useState<Record<string, string>>(savedSignal.value_to_channel || {});
  const [defaultChannel, setDefaultChannel] = useState<string>(savedSignal.default_channel || "Other / Unmapped");

  // Hydrate picked field + mapping from saved config
  useEffect(() => {
    if (!savedSignal.field_type) return;
    setPickedFieldKey(
      savedSignal.field_type === "custom_field" && savedSignal.field_id
        ? `cf:${savedSignal.field_id}`
        : savedSignal.field_type,
    );
    setMapping(savedSignal.value_to_channel || {});
    if (savedSignal.default_channel) setDefaultChannel(savedSignal.default_channel);
  }, [signal?.ghl_channel_signal]);

  // ─── Discover: sync ALL contacts + fetch custom fields + load distribution ──
  async function handleDiscover() {
    setMsg(null);
    setBusy("discover");
    setProgress("Syncing contacts page 1…");
    try {
      // 1. Paginate full contact sync
      let cursor: string | null = null;
      let cursorId: string | null = null;
      let page = 0;
      let totalRows = 0;
      do {
        page++;
        setProgress(`Syncing contacts · page ${page} · ${totalRows.toLocaleString()} so far…`);
        const { data: reqId, error: e1 } = await supabase.rpc("ghl_contacts_sync_page_start", {
          p_org_id: orgId, p_cursor: cursor, p_cursor_id: cursorId,
        });
        if (e1) throw e1;
        await waitForRequest(Number(reqId));
        const { data: result, error: e2 } = await supabase.rpc("ghl_contacts_sync_page_finish", {
          p_org_id: orgId, p_request_id: Number(reqId),
        });
        if (e2) throw e2;
        const r = result as any;
        if (!r.ok) throw new Error(`Contact sync failed: HTTP ${r.status} — ${r.error}`);
        totalRows += r.rows_synced;
        cursor = r.next_cursor; cursorId = r.next_cursor_id;
        if (page >= 200) { console.warn("Stopped contact sync at 200 pages"); break; }
      } while (cursor);

      // 2. Fetch custom field definitions
      setProgress("Fetching custom field definitions…");
      const { data: cfReq, error: e3 } = await supabase.rpc("ghl_fetch_custom_fields_start", { p_org_id: orgId });
      if (e3) throw e3;
      await waitForRequest(Number(cfReq));
      const { data: cfResp, error: e4 } = await supabase.rpc("ghl_fetch_custom_fields_finish", {
        p_org_id: orgId, p_request_id: Number(cfReq),
      });
      if (e4) throw e4;
      const cf = cfResp as any;
      if (!cf.ok) throw new Error(`Custom fields fetch failed: HTTP ${cf.status} — ${cf.error}`);

      // 3. Compute distribution
      setProgress("Computing value distributions…");
      const { data: d, error: e5 } = await supabase.rpc("ghl_channel_signal_distribution", { p_org_id: orgId });
      if (e5) throw e5;
      setDist(d as Distribution);
      setMsg({
        kind: "ok",
        text: `Discovered: ${totalRows.toLocaleString()} contacts, ${cf.fields_count} custom fields. Pick the field you use for channel tracking below.`,
      });
      qc.invalidateQueries({ queryKey: ["admin-org-ghl-signal", orgId] });
    } catch (e: any) {
      setMsg({ kind: "err", text: String(e?.message || e) });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  // Decode picked field
  const pickedField = (() => {
    if (!pickedFieldKey) return null;
    if (pickedFieldKey === "source") {
      return { type: "source" as const, id: null, name: "source", values: dist?.source || [] };
    }
    if (pickedFieldKey === "tags") {
      return { type: "tags" as const, id: null, name: "tags", values: dist?.tags || [] };
    }
    if (pickedFieldKey.startsWith("cf:")) {
      const id = pickedFieldKey.slice(3);
      const cf = (dist?.custom_fields || []).find((f) => f.field_id === id);
      return cf ? { type: "custom_field" as const, id, name: cf.field_name, values: cf.values } : null;
    }
    return null;
  })();

  async function handleSaveMapping() {
    if (!pickedField) {
      setMsg({ kind: "err", text: "Pick a field above before saving." });
      return;
    }
    setBusy("save");
    setMsg(null);
    try {
      const config: ChannelSignal = {
        field_type: pickedField.type,
        field_id: pickedField.id || undefined,
        field_name: pickedField.name,
        value_to_channel: mapping,
        default_channel: defaultChannel,
      };
      const { error } = await supabase.rpc("ghl_save_channel_signal", {
        p_org_id: orgId, p_config: config as any,
      });
      if (error) throw error;
      setMsg({
        kind: "ok",
        text: `Saved: channel = ${pickedField.name} mapped to ${Object.keys(mapping).filter((k) => mapping[k]).length} channel(s). Click "Sync now" to roll closed opps into kpi_periods.`,
      });
      qc.invalidateQueries({ queryKey: ["admin-org-ghl-signal", orgId] });
    } catch (e: any) {
      setMsg({ kind: "err", text: String(e?.message || e) });
    } finally {
      setBusy(null);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 12, padding: 20, marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>📡 Channel signal discovery</div>
        {savedSignal.field_type && (
          <div style={{ fontSize: 11, color: T3 }}>
            saved: <strong style={{ color: TEXT }}>{savedSignal.field_name || savedSignal.field_type}</strong>
            {" · "}{Object.keys(savedSignal.value_to_channel || {}).filter((k) => (savedSignal.value_to_channel || {})[k]).length} mapping(s)
          </div>
        )}
      </div>
      <div style={{ fontSize: 12, color: T3, marginBottom: 14 }}>
        Pulls all contacts from GHL, fetches your custom-field definitions, then shows you which field actually has the channel info so you can pick one and map values to your Revenue Engine channels.
      </div>

      {msg && (
        <div style={{
          background: (msg.kind === "err" ? RED : msg.kind === "ok" ? G : AMBER) + "15",
          border: "1px solid " + (msg.kind === "err" ? RED : msg.kind === "ok" ? G : AMBER) + "40",
          color: msg.kind === "err" ? RED : msg.kind === "ok" ? G : AMBER,
          borderRadius: 8, padding: "8px 12px", fontSize: 12, marginBottom: 12,
        }}>{msg.text}</div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <button onClick={handleDiscover} disabled={busy !== null} style={{ ...BTN_PRIMARY, opacity: busy ? 0.6 : 1 }}>
          {busy === "discover" ? "Discovering…" : dist ? "Re-discover" : "Discover sources"}
        </button>
        {progress && <span style={{ fontSize: 11, color: T2 }}>{progress}</span>}
      </div>

      {/* Field options — radio cards */}
      {dist && (
        <div style={{ background: S2, borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>
            Step 1 · Pick the field that contains your channel info
          </div>

          <FieldOption
            id="source" label="source field" picked={pickedFieldKey === "source"}
            onPick={() => setPickedFieldKey("source")}
            rows={dist.source.slice(0, 5)} totalCount={dist.source.length}
          />
          <FieldOption
            id="tags" label="tags array" picked={pickedFieldKey === "tags"}
            onPick={() => setPickedFieldKey("tags")}
            rows={dist.tags.slice(0, 5)} totalCount={dist.tags.length}
          />
          {dist.custom_fields.map((cf) => (
            <FieldOption
              key={cf.field_id}
              id={`cf:${cf.field_id}`} label={`custom field: ${cf.field_name}`} picked={pickedFieldKey === `cf:${cf.field_id}`}
              onPick={() => setPickedFieldKey(`cf:${cf.field_id}`)}
              rows={cf.values.slice(0, 5)} totalCount={cf.values.length}
            />
          ))}
        </div>
      )}

      {/* Value → channel mapping */}
      {pickedField && pickedField.values.length > 0 && (
        <div style={{ background: S2, borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>
            Step 2 · Map each value to a Revenue Engine channel ({pickedField.values.length} values)
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.6fr 0.4fr 0.4fr 0.6fr 1.4fr", gap: 8, fontSize: 11, color: T3, padding: "0 8px", marginBottom: 4 }}>
            <div>Value</div>
            <div style={{ textAlign: "right" }}>Contacts</div>
            <div style={{ textAlign: "right" }}>Won</div>
            <div style={{ textAlign: "right" }}>Revenue</div>
            <div>Channel</div>
          </div>
          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {pickedField.values.map((v) => (
              <div key={v.value} style={{
                display: "grid", gridTemplateColumns: "1.6fr 0.4fr 0.4fr 0.6fr 1.4fr", gap: 8,
                padding: "5px 8px", fontSize: 13, alignItems: "center",
                borderBottom: "1px solid " + B1,
              }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={v.value}>{v.value}</div>
                <div style={{ textAlign: "right", color: T2 }}>{v.contact_count}</div>
                <div style={{ textAlign: "right", color: v.won_count > 0 ? G : T3 }}>{v.won_count}</div>
                <div style={{ textAlign: "right", color: v.won_revenue > 0 ? G : T3, fontFamily: "'DM Mono', monospace" }}>
                  ${Number(v.won_revenue || 0).toLocaleString()}
                </div>
                <input
                  value={mapping[v.value] || ""}
                  onChange={(e) => setMapping((m) => ({ ...m, [v.value]: e.target.value }))}
                  placeholder="e.g. PPC / Google · leave blank to ignore"
                  style={{ ...IS, padding: "5px 8px" }}
                />
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14, paddingTop: 12, borderTop: "1px solid " + B1 }}>
            <div style={{ fontSize: 11, color: T3 }}>Default channel for unmapped values:</div>
            <input
              value={defaultChannel}
              onChange={(e) => setDefaultChannel(e.target.value)}
              style={{ ...IS, width: 200, padding: "6px 10px" }}
            />
            <button onClick={handleSaveMapping} disabled={busy !== null} style={{ ...BTN_PRIMARY, marginLeft: "auto", opacity: busy ? 0.6 : 1 }}>
              {busy === "save" ? "Saving…" : "Save mapping"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldOption({
  id, label, picked, onPick, rows, totalCount,
}: { id: string; label: string; picked: boolean; onPick: () => void; rows: ValueRow[]; totalCount: number }) {
  return (
    <label
      onClick={onPick}
      style={{
        display: "block", cursor: "pointer", padding: 10, marginBottom: 8,
        background: picked ? "rgba(80,220,120,0.08)" : S3,
        border: "1px solid " + (picked ? G + "60" : B1),
        borderRadius: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <input type="radio" checked={picked} onChange={onPick} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 11, color: T3 }}>· {totalCount} distinct value{totalCount === 1 ? "" : "s"}</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 11, color: T3, fontStyle: "italic", marginLeft: 26 }}>(no values found)</div>
      ) : (
        <div style={{ marginLeft: 26, display: "flex", flexWrap: "wrap", gap: 6, fontSize: 11 }}>
          {rows.map((r) => (
            <span key={r.value} style={{ background: S2, padding: "2px 8px", borderRadius: 4, color: T2 }}>
              <strong style={{ color: TEXT }}>{r.value}</strong>{" "}
              <span style={{ color: T3 }}>· {r.contact_count}c</span>
              {r.won_count > 0 && <span style={{ color: G }}> · {r.won_count}w · ${Number(r.won_revenue || 0).toLocaleString()}</span>}
            </span>
          ))}
          {totalCount > rows.length && <span style={{ color: T3 }}>+{totalCount - rows.length} more</span>}
        </div>
      )}
    </label>
  );
}
