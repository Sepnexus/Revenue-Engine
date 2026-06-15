// Per-channel configuration UI for the GHL integration.
//
// Replaces the earlier "signal discovery" panel. The mapping now lives ON
// the channel itself — each channel owns:
//   • Source rules: which contact source/tag/custom-field values count as
//     this channel (multi-select from the discovered set)
//   • Stage rules: which pipeline_stage_ids = net lead / offer / contract
//     for opps in this channel
//   • Optional default spend
//
// One-time bootstrap: clicking the panel for the first time triggers a full
// contact sync + custom fields fetch + pipeline metadata fetch so the
// pickers below have real options.

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { S1, S2, S3, B1, TEXT, T2, T3, G, RED, AMBER } from "@/shared/kpi";

const IS: React.CSSProperties = {
  width: "100%", background: S2, border: "1px solid " + B1, borderRadius: 8,
  color: TEXT, padding: "8px 12px", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box",
};
const BTN_PRIMARY: React.CSSProperties = {
  background: G, border: "none", borderRadius: 8, padding: "8px 16px",
  color: "#000", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
};
const BTN_GHOST: React.CSSProperties = {
  background: "transparent", border: "1px solid " + B1, borderRadius: 8,
  padding: "7px 14px", color: TEXT, fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: "inherit",
};

interface ValueRow { value: string; contact_count: number; won_count: number; won_revenue: number; }
interface CFDist { field_id: string; field_name: string; values: ValueRow[]; }
interface Distribution { source: ValueRow[]; tags: ValueRow[]; custom_fields: CFDist[]; }
interface Stage { id: string; name: string; }
interface Pipeline { id: string; name: string; stages: Stage[]; }
interface SourceRules {
  sources?: string[];
  tags?: string[];
  custom_fields?: Array<{ field_id: string; values: string[] }>;
}
interface Channel {
  id: string;
  org_id: string;
  name: string;
  display_order: number;
  source_rules: SourceRules;
  net_stage_ids: string[];
  offer_stage_ids: string[];
  contract_stage_ids: string[];
  default_spend: number;
  is_active: boolean;
}

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

export default function GhlChannelManagerPanel({ orgId }: { orgId: string }) {
  const qc = useQueryClient();

  // ─── Current channels for this org ────────────────────────────────────────
  const { data: channels = [] } = useQuery<Channel[]>({
    queryKey: ["admin-org-channels", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("org_channels")
        .select("*")
        .eq("org_id", orgId)
        .order("display_order", { ascending: true });
      if (error) throw error;
      return (data as Channel[]) || [];
    },
  });

  // ─── Unmapped revenue warning — recomputed whenever channels change ───────
  const { data: unmapped } = useQuery({
    queryKey: ["admin-org-unmapped", orgId, channels.map((c) => c.id).join(",")],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ghl_unmapped_won", { p_org_id: orgId });
      if (error) throw error;
      return data as {
        total_mapped_deals: number;
        total_mapped_revenue: number;
        total_unmapped_deals: number;
        total_unmapped_revenue: number;
        by_value: Array<{ signal: string; field_id: string | null; field_name: string | null; value: string; deals: number; revenue: number }>;
      };
    },
  });

  // Distribution + pipeline metadata (cached after first Discover)
  const [dist, setDist] = useState<Distribution | null>(null);
  const [pipelines, setPipelines] = useState<Pipeline[] | null>(null);

  const [busy, setBusy] = useState<null | "discover" | "save" | "del" | "seed">(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ─── Discover: pulls contacts + custom fields + pipelines + distribution ──
  async function handleDiscover() {
    setMsg(null);
    setBusy("discover");
    try {
      // contacts (paginated)
      let cursor: string | null = null, cursorId: string | null = null, page = 0, total = 0;
      do {
        page++;
        setProgress(`Contacts · page ${page} · ${total.toLocaleString()} synced…`);
        const { data: reqId, error: e1 } = await supabase.rpc("ghl_contacts_sync_page_start", {
          p_org_id: orgId, p_cursor: cursor, p_cursor_id: cursorId,
        });
        if (e1) throw e1;
        await waitForRequest(Number(reqId));
        const { data: r, error: e2 } = await supabase.rpc("ghl_contacts_sync_page_finish", {
          p_org_id: orgId, p_request_id: Number(reqId),
        });
        if (e2) throw e2;
        const rr = r as any;
        if (!rr.ok) throw new Error(`Contacts: ${rr.error}`);
        total += Number(rr.rows_synced) || 0;   // RPC returns a string — coerce so we add, not concatenate
        cursor = rr.next_cursor; cursorId = rr.next_cursor_id;
        if (page >= 200) break;
      } while (cursor);

      // custom fields
      setProgress("Fetching custom field definitions…");
      const { data: cfReq } = await supabase.rpc("ghl_fetch_custom_fields_start", { p_org_id: orgId });
      await waitForRequest(Number(cfReq));
      await supabase.rpc("ghl_fetch_custom_fields_finish", { p_org_id: orgId, p_request_id: Number(cfReq) });

      // pipelines
      setProgress("Fetching pipeline metadata…");
      const { data: pReq } = await supabase.rpc("ghl_list_pipelines_start", { p_org_id: orgId });
      const pResp = await waitForRequest(Number(pReq));
      if (pResp.ok) setPipelines((pResp.body?.pipelines || []) as Pipeline[]);

      // distribution
      setProgress("Computing distributions…");
      const { data: d } = await supabase.rpc("ghl_channel_signal_distribution", { p_org_id: orgId });
      setDist(d as Distribution);

      setMsg({ kind: "ok", text: `Discovered ${total.toLocaleString()} contacts, ${(pResp.body?.pipelines || []).length} pipelines. You can now configure each channel below.` });
    } catch (e: any) {
      setMsg({ kind: "err", text: String(e?.message || e) });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function handleSeedDefaults() {
    setBusy("seed");
    try {
      await supabase.rpc("ghl_seed_default_channels", { p_org_id: orgId });
      qc.invalidateQueries({ queryKey: ["admin-org-channels", orgId] });
      qc.invalidateQueries({ queryKey: ["admin-org-unmapped"] });
    } finally { setBusy(null); }
  }

  async function handleSave(ch: Channel) {
    setBusy("save");
    setMsg(null);
    try {
      const { error } = await supabase.rpc("ghl_save_channel", {
        p_org_id: orgId,
        p_channel_id: ch.id,
        p_name: ch.name,
        p_source_rules: ch.source_rules as any,
        p_net_stage_ids: ch.net_stage_ids,
        p_offer_stage_ids: ch.offer_stage_ids,
        p_contract_stage_ids: ch.contract_stage_ids,
        p_default_spend: ch.default_spend,
        p_display_order: ch.display_order,
      });
      if (error) throw error;
      setMsg({ kind: "ok", text: `Saved "${ch.name}".` });
      qc.invalidateQueries({ queryKey: ["admin-org-channels", orgId] });
      qc.invalidateQueries({ queryKey: ["admin-org-unmapped"] });
    } catch (e: any) {
      setMsg({ kind: "err", text: String(e?.message || e) });
    } finally { setBusy(null); }
  }

  async function handleAddChannel() {
    setBusy("save");
    try {
      const { data, error } = await supabase.rpc("ghl_save_channel", {
        p_org_id: orgId,
        p_channel_id: null,
        p_name: "New Channel",
        p_source_rules: {} as any,
        p_net_stage_ids: [],
        p_offer_stage_ids: [],
        p_contract_stage_ids: [],
        p_default_spend: 0,
        p_display_order: null,
      });
      if (error) throw error;
      setExpandedId(data as string);
      qc.invalidateQueries({ queryKey: ["admin-org-channels", orgId] });
      qc.invalidateQueries({ queryKey: ["admin-org-unmapped"] });
    } finally { setBusy(null); }
  }

  async function handleDelete(ch: Channel) {
    if (!confirm(`Delete channel "${ch.name}"?`)) return;
    setBusy("del");
    try {
      await supabase.rpc("ghl_delete_channel", { p_org_id: orgId, p_channel_id: ch.id });
      qc.invalidateQueries({ queryKey: ["admin-org-channels", orgId] });
      qc.invalidateQueries({ queryKey: ["admin-org-unmapped"] });
    } finally { setBusy(null); }
  }

  const allStages: Array<{ pipelineName: string; stageId: string; stageName: string }> =
    (pipelines || []).flatMap((p) =>
      (p.stages || []).map((s) => ({ pipelineName: p.name, stageId: s.id, stageName: s.name })),
    );

  return (
    <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 12, padding: 20, marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>📊 Channels</div>
        <div style={{ fontSize: 11, color: T3 }}>{channels.length} channel{channels.length === 1 ? "" : "s"}</div>
      </div>
      <div style={{ fontSize: 12, color: T3, marginBottom: 14 }}>
        Each channel owns its own rules: which GHL contact source/tag/field values feed it, and which pipeline stages count as net lead / offer / contract for opps in it. Sync derives every funnel metric from these rules per channel per month.
      </div>

      {msg && (
        <div style={{
          background: (msg.kind === "err" ? RED : msg.kind === "ok" ? G : AMBER) + "15",
          border: "1px solid " + (msg.kind === "err" ? RED : msg.kind === "ok" ? G : AMBER) + "40",
          color: msg.kind === "err" ? RED : msg.kind === "ok" ? G : AMBER,
          borderRadius: 8, padding: "8px 12px", fontSize: 12, marginBottom: 12,
        }}>{msg.text}</div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={handleDiscover} disabled={busy !== null} style={{ ...BTN_PRIMARY, opacity: busy ? 0.6 : 1 }}>
          {busy === "discover" ? "Discovering…" : dist ? "Re-discover" : "Discover GHL data (run once)"}
        </button>
        {channels.length === 0 && (
          <button onClick={handleSeedDefaults} disabled={busy !== null} style={BTN_GHOST}>
            {busy === "seed" ? "Seeding…" : "Seed default channels"}
          </button>
        )}
        <button onClick={handleAddChannel} disabled={busy !== null} style={BTN_GHOST}>
          + Add channel
        </button>
        {progress && <span style={{ fontSize: 11, color: T2 }}>{progress}</span>}
      </div>

      {/* ─── Unmapped revenue warning ─── */}
      {unmapped && unmapped.total_unmapped_revenue > 0 && (() => {
        const total = (unmapped.total_mapped_revenue || 0) + (unmapped.total_unmapped_revenue || 0);
        const pct = total > 0 ? Math.round((unmapped.total_unmapped_revenue / total) * 100) : 0;
        return (
          <div style={{
            background: RED + "12", border: "1px solid " + RED + "40",
            borderRadius: 10, padding: "12px 14px", marginBottom: 16,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: RED, marginBottom: 4 }}>
              ⚠️ ${Number(unmapped.total_unmapped_revenue).toLocaleString()} in closed deals isn't being counted
            </div>
            <div style={{ fontSize: 12, color: T2, marginBottom: unmapped.by_value.length ? 10 : 0 }}>
              {unmapped.total_unmapped_deals} won deal{unmapped.total_unmapped_deals === 1 ? "" : "s"} ({pct}% of total revenue)
              come from lead sources not mapped to any channel — so they're missing from the dashboard.
              Map the values below to a channel (or add a new one) to capture them.
            </div>
            {unmapped.by_value.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {unmapped.by_value.slice(0, 12).map((v, i) => (
                  <span key={i} style={{
                    background: S3, borderRadius: 6, padding: "3px 9px", fontSize: 11, color: TEXT,
                  }}>
                    <strong>{v.value}</strong>
                    {v.field_name ? <span style={{ color: T3 }}> · {v.field_name}</span> : null}
                    <span style={{ color: T3 }}> · {v.deals} deal{v.deals === 1 ? "" : "s"}</span>
                    {v.revenue > 0 && <span style={{ color: RED }}> · ${Number(v.revenue).toLocaleString()}</span>}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {!dist && (
        <div style={{ fontSize: 12, color: T3, fontStyle: "italic", padding: "8px 0" }}>
          Run Discover once to load the source values and pipeline stages that the channel editor uses.
        </div>
      )}

      {channels.map((ch) => (
        <ChannelRow
          key={ch.id}
          channel={ch}
          dist={dist}
          allStages={allStages}
          expanded={expandedId === ch.id}
          onToggle={() => setExpandedId((cur) => (cur === ch.id ? null : ch.id))}
          onSave={handleSave}
          onDelete={handleDelete}
          busy={busy === "save" || busy === "del"}
        />
      ))}
    </div>
  );
}

function summarize(ch: Channel): string {
  const sources = (ch.source_rules?.sources || []).length;
  const tags = (ch.source_rules?.tags || []).length;
  const cfs = (ch.source_rules?.custom_fields || []).reduce((acc, c) => acc + (c.values?.length || 0), 0);
  const total = sources + tags + cfs;
  if (total === 0) return "(unconfigured — add at least one source rule)";
  const bits: string[] = [];
  if (sources > 0) bits.push(`${sources} source value${sources === 1 ? "" : "s"}`);
  if (tags > 0) bits.push(`${tags} tag${tags === 1 ? "" : "s"}`);
  if (cfs > 0) bits.push(`${cfs} custom field value${cfs === 1 ? "" : "s"}`);
  return bits.join(" · ");
}

function ChannelRow({
  channel, dist, allStages, expanded, onToggle, onSave, onDelete, busy,
}: {
  channel: Channel; dist: Distribution | null;
  allStages: Array<{ pipelineName: string; stageId: string; stageName: string }>;
  expanded: boolean; onToggle: () => void;
  onSave: (ch: Channel) => Promise<void>; onDelete: (ch: Channel) => Promise<void>; busy: boolean;
}) {
  // Local editor state — only writes on Save.
  const [name, setName] = useState(channel.name);
  const [defaultSpend, setDefaultSpend] = useState(channel.default_spend);
  const [sources, setSources] = useState<string[]>(channel.source_rules.sources || []);
  const [tags, setTags] = useState<string[]>(channel.source_rules.tags || []);
  const [cfRules, setCfRules] = useState<Array<{ field_id: string; values: string[] }>>(channel.source_rules.custom_fields || []);
  const [netStages, setNetStages] = useState<string[]>(channel.net_stage_ids);
  const [offerStages, setOfferStages] = useState<string[]>(channel.offer_stage_ids);
  const [contractStages, setContractStages] = useState<string[]>(channel.contract_stage_ids);

  useEffect(() => {
    setName(channel.name);
    setDefaultSpend(channel.default_spend);
    setSources(channel.source_rules.sources || []);
    setTags(channel.source_rules.tags || []);
    setCfRules(channel.source_rules.custom_fields || []);
    setNetStages(channel.net_stage_ids);
    setOfferStages(channel.offer_stage_ids);
    setContractStages(channel.contract_stage_ids);
  }, [channel.id]);

  function toggle(arr: string[], v: string, set: (a: string[]) => void) {
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  }

  return (
    <div style={{ background: S2, borderRadius: 10, marginBottom: 10, overflow: "hidden" }}>
      <div
        onClick={onToggle}
        style={{ padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{channel.name}</div>
          <div style={{ fontSize: 11, color: T3, marginTop: 2 }}>{summarize(channel)}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <span style={{ fontSize: 11, color: T2 }}>{expanded ? "▲ collapse" : "▼ edit"}</span>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: "0 14px 14px 14px", borderTop: "1px solid " + B1 }}>
          {/* Name + spend */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10, marginTop: 12, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: T3, marginBottom: 4 }}>Name</div>
              <input value={name} onChange={(e) => setName(e.target.value)} style={IS} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: T3, marginBottom: 4 }}>Default monthly spend ($)</div>
              <input type="number" value={defaultSpend} onChange={(e) => setDefaultSpend(Number(e.target.value) || 0)} style={IS} />
            </div>
          </div>

          {/* Source rules */}
          <div style={{ fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>
            Sources — which GHL contact attributes feed this channel
          </div>
          {!dist ? (
            <div style={{ fontSize: 12, color: T3, fontStyle: "italic" }}>Run Discover above to see source options.</div>
          ) : (
            <>
              <MultiPickGroup
                title={`source field (${dist.source.length})`}
                values={dist.source}
                picked={sources}
                onToggle={(v) => toggle(sources, v, setSources)}
              />
              <MultiPickGroup
                title={`tags (${dist.tags.length})`}
                values={dist.tags}
                picked={tags}
                onToggle={(v) => toggle(tags, v, setTags)}
              />
              {dist.custom_fields.map((cf) => {
                const ruleForField = cfRules.find((r) => r.field_id === cf.field_id);
                const pickedValues = ruleForField?.values || [];
                return (
                  <MultiPickGroup
                    key={cf.field_id}
                    title={`custom field: ${cf.field_name} (${cf.values.length})`}
                    values={cf.values}
                    picked={pickedValues}
                    onToggle={(v) => {
                      const newValues = pickedValues.includes(v)
                        ? pickedValues.filter((x) => x !== v)
                        : [...pickedValues, v];
                      setCfRules((cur) => {
                        const others = cur.filter((r) => r.field_id !== cf.field_id);
                        return newValues.length > 0
                          ? [...others, { field_id: cf.field_id, values: newValues }]
                          : others;
                      });
                    }}
                  />
                );
              })}
            </>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 10, marginTop: 16, paddingTop: 12, borderTop: "1px solid " + B1 }}>
            <button
              onClick={() => onSave({
                ...channel, name, default_spend: defaultSpend,
                source_rules: { sources, tags, custom_fields: cfRules },
                net_stage_ids: netStages, offer_stage_ids: offerStages, contract_stage_ids: contractStages,
              })}
              disabled={busy}
              style={{ ...BTN_PRIMARY, opacity: busy ? 0.6 : 1 }}
            >
              Save channel
            </button>
            <button onClick={() => onDelete(channel)} disabled={busy} style={{ ...BTN_GHOST, color: RED, borderColor: RED + "40" }}>
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MultiPickGroup({
  title, values, picked, onToggle,
}: { title: string; values: ValueRow[]; picked: string[]; onToggle: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  if (values.length === 0) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ cursor: "pointer", fontSize: 12, color: T2, marginBottom: 4, padding: "4px 0" }}
      >
        {open ? "▼" : "▶"} {title} {picked.length > 0 && <span style={{ color: G }}>· {picked.length} selected</span>}
      </div>
      {open && (
        <div style={{ background: S3, borderRadius: 8, padding: 8, maxHeight: 200, overflowY: "auto" }}>
          {values.map((v) => {
            const sel = picked.includes(v.value);
            return (
              <label key={v.value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "3px 4px", cursor: "pointer" }}>
                <input type="checkbox" checked={sel} onChange={() => onToggle(v.value)} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={v.value}>{v.value}</span>
                <span style={{ fontSize: 10, color: T3 }}>{v.contact_count}c</span>
                {v.won_count > 0 && <span style={{ fontSize: 10, color: G }}>· {v.won_count}w · ${Number(v.won_revenue || 0).toLocaleString()}</span>}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
