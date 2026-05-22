import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/hooks/useSubscription";
import { useKPIPeriods } from "@/hooks/useKPIPeriods";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useOrgSettings } from "@/hooks/useOrgSettings";
import { useActivityLog } from "@/hooks/useActivityLog";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { trackedQuery, friendlyErrorMessage } from "@/lib/query-utils";
import { PageLoading, PageError, InlineError } from "@/components/QueryStates";
import {
  G, BG, S1, S2, S3, B1, B2, TEXT, T2, T3, RED, AMBER, PURPLE,
  fmt$, fmtK, fmtPct, fmtN, fmtRx,
  periodLabel, periodKey, nowPeriod, isPast, isCurrent, getLast12,
  DEFAULTS, ZERO_DATA, DEFAULT_REPS, SAMPLE_HISTORY,
  calc, buildAlerts, exportPDF, AGENTS, buildAIContext, aggregateKPIData,
  calcRepMetrics, calcTeamTotals, getChannels, syncChannelsToLegacy, EMPTY_CHANNEL,
  type KPIData, type CalcResult, type Alert, type SalesRep, type Channel,
} from "@/shared/kpi";
import { supabase } from "@/integrations/supabase/client";
import closerControlLogo from "@/assets/closer-control-logo.png";
import LockedFeature from "@/components/LockedFeature";

// ── Tooltip ──────────────────────────────────────────────────
function CTip({ active, payload, label, money }: any) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: S2, border: "1px solid " + B2, borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
      <div style={{ color: T2, marginBottom: 6 }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color || TEXT, fontWeight: 600 }}>
          {p.name}: {money ? fmt$(p.value) : p.value}
        </div>
      ))}
    </div>
  );
}

// ── Hero Card ────────────────────────────────────────────────
function HeroCard({ label, value, sub, accent, trend, up }: { label: string; value: string; sub?: string; accent?: boolean; trend?: string; up?: boolean }) {
  return (
    <div style={{
      background: accent ? "linear-gradient(145deg,rgba(71,237,61,0.08),rgba(71,237,61,0.02))" : "linear-gradient(145deg," + S1 + "," + S2 + ")",
      border: "1px solid " + (accent ? "rgba(71,237,61,0.2)" : B1),
      borderRadius: 16, padding: "24px 22px", position: "relative", overflow: "hidden",
    }}>
      {accent && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg,transparent," + G + "," + G + "80)" }} />}
      <div style={{ fontSize: 12, color: T3, letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 500, marginBottom: 10 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 800, color: accent ? G : TEXT, fontFamily: "'DM Mono',monospace", letterSpacing: -1, lineHeight: 1 }}>{value}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
        {sub && <span style={{ fontSize: 13, color: TEXT }}>{sub}</span>}
        {trend && (
          <span style={{ fontSize: 12, fontWeight: 600, color: up ? "#4ade80" : RED, background: up ? "rgba(74,222,128,0.1)" : "rgba(240,80,80,0.1)", padding: "2px 7px", borderRadius: 4 }}>
            {up ? "▲" : "▼"} {trend}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Stat Card ────────────────────────────────────────────────
function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 12, padding: "16px 18px" }}>
      <div style={{ fontSize: 11, color: T3, letterSpacing: 1, textTransform: "uppercase", fontWeight: 500, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: TEXT, fontFamily: "'DM Mono',monospace" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: TEXT, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

// ── Section Header ───────────────────────────────────────────
function SH({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{title}</div>
      {right}
    </div>
  );
}

// ── AI Chat ──────────────────────────────────────────────────
function AgentChat({ agentKey, m, inp, period, expanded, onToggleExpand, orgId, historicalContext }: { agentKey: string; m: CalcResult; inp: KPIData; period: string; expanded: boolean; onToggleExpand: () => void; orgId: string | null; historicalContext?: string }) {
  const agent = AGENTS[agentKey];
  const [msgs, setMsgs] = useState<{ role: string; content: string }[]>([]);
  const [val, setVal] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const loadedKeyRef = useRef<string>("");
  const prevMsgCount = useRef(0);
  useEffect(() => {
    if (msgs.length > prevMsgCount.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    prevMsgCount.current = msgs.length;
  }, [msgs]);

  useEffect(() => {
    const loadKey = `${agentKey}-${orgId}`;
    if (!orgId || loadedKeyRef.current === loadKey) return;
    loadedKeyRef.current = loadKey;
    setHistoryLoaded(false);
    setMsgs([]);
    setConversationId(null);

    (async () => {
      try {
        const { data: convs } = await supabase
          .from("chat_conversations")
          .select("id")
          .eq("org_id", orgId)
          .eq("agent_key", agentKey)
          .order("updated_at", { ascending: false })
          .limit(1);

        if (convs && convs.length > 0) {
          const convId = convs[0].id;
          setConversationId(convId);
          const { data: savedMsgs } = await supabase
            .from("chat_messages")
            .select("role, content")
            .eq("conversation_id", convId)
            .order("created_at", { ascending: true });
          if (savedMsgs && savedMsgs.length > 0) {
            setMsgs(savedMsgs.map((m: any) => ({ role: m.role, content: m.content })));
          }
        }
      } catch (e) {
        console.error("Failed to load chat history:", e);
      }
      setHistoryLoaded(true);
    })();
  }, [agentKey, orgId]);

  const send = async (text?: string) => {
    const msg = (text || val).trim();
    if (!msg || loading) return;
    setVal("");
    const next = [...msgs, { role: "user", content: msg }];
    setMsgs(next);
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-chat", {
        body: { agentKey, messages: next, period, kpiData: inp, conversationId, historicalContext },
      });
      if (error) throw error;
      const reply = data?.reply || "Unable to get response.";
      if (data?.conversationId) setConversationId(data.conversationId);
      setMsgs([...next, { role: "assistant", content: reply }]);
    } catch (e) {
      setMsgs([...next, { role: "assistant", content: "Connection error. Please try again." }]);
    }
    setLoading(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {!historyLoaded && (
        <div style={{ padding: "20px", textAlign: "center", color: T3, fontSize: 13 }}>Loading conversation…</div>
      )}
      {historyLoaded && (
        <div style={{ padding: "16px 20px", borderBottom: "1px solid " + B1 }}>
          <div style={{ fontSize: 12, color: T3, marginBottom: 8 }}>Try asking</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {agent.tips.map(t => (
              <button key={t} onClick={() => send(t)} style={{ background: S3, border: "1px solid " + B2, borderRadius: 7, padding: "6px 12px", color: T2, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>{t}</button>
            ))}
          </div>
        </div>
      )}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
        {msgs.map((msg, i) => (
          <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{ maxWidth: expanded ? "70%" : "86%", padding: "10px 14px", borderRadius: 10, fontSize: 13, lineHeight: 1.7, background: msg.role === "user" ? "rgba(71,237,61,0.1)" : S2, border: "1px solid " + (msg.role === "user" ? "rgba(71,237,61,0.25)" : B2), color: TEXT }}>
              {msg.role === "user" ? msg.content : <ReactMarkdown components={{ p: ({children}) => <p style={{margin:"0 0 8px 0"}}>{children}</p>, strong: ({children}) => <span style={{color:G,fontWeight:700}}>{children}</span>, ul: ({children}) => <ul style={{margin:"4px 0",paddingLeft:18}}>{children}</ul>, ol: ({children}) => <ol style={{margin:"4px 0",paddingLeft:18}}>{children}</ol>, li: ({children}) => <li style={{marginBottom:4}}>{children}</li>, h1: ({children}) => <div style={{fontWeight:700,fontSize:16,marginBottom:6}}>{children}</div>, h2: ({children}) => <div style={{fontWeight:700,fontSize:15,marginBottom:6}}>{children}</div>, h3: ({children}) => <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>{children}</div>, code: ({children}) => <code style={{background:"rgba(255,255,255,0.06)",padding:"1px 5px",borderRadius:4,fontSize:12}}>{children}</code> }}>{msg.content}</ReactMarkdown>}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: "flex", gap: 5, padding: "4px 2px" }}>
            {[0, 1, 2].map(i => <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: agent.color, animation: "bounce 1.1s ease-in-out " + (i * 0.18) + "s infinite" }} />)}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div style={{ padding: "12px 20px", borderTop: "1px solid " + B1 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === "Enter" && send()}
            placeholder={"Message " + agent.label + " AI..."}
            style={{ flex: 1, background: S3, border: "1px solid " + B2, borderRadius: 9, padding: "10px 14px", color: TEXT, fontSize: 13, outline: "none", fontFamily: "inherit" }}
          />
          <button onClick={() => send()} style={{ background: agent.color, border: "none", borderRadius: 9, padding: "10px 18px", color: "#000", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>↑</button>
        </div>
      </div>
    </div>
  );
}

// ── Red Zone component ───────────────────────────────────────
function RedZone({ alerts }: { alerts: Alert[] }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const toggle = (i: number) => setOpen(p => ({ ...p, [i]: !p[i] }));
  const crits = alerts.filter(a => a.level === "critical");
  const warns = alerts.filter(a => a.level === "warning");
  const clear = alerts.length === 0;
  return (
    <div style={{ marginTop: 32, borderTop: "1px solid " + B1, paddingTop: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <div style={{ width: 3, height: 18, background: clear ? G : crits.length ? RED : AMBER, borderRadius: 2 }} />
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>Red Zone Monitor</span>
            {!clear && (
              <div style={{ display: "flex", gap: 6 }}>
                {crits.length > 0 && <span style={{ fontSize: 12, fontWeight: 600, color: RED, background: "rgba(240,80,80,0.12)", border: "1px solid rgba(240,80,80,0.25)", borderRadius: 5, padding: "2px 8px" }}>{crits.length} Critical</span>}
                {warns.length > 0 && <span style={{ fontSize: 12, fontWeight: 600, color: AMBER, background: "rgba(240,168,48,0.12)", border: "1px solid rgba(240,168,48,0.25)", borderRadius: 5, padding: "2px 8px" }}>{warns.length} Warning</span>}
              </div>
            )}
          </div>
          <div style={{ fontSize: 12, color: TEXT, marginTop: 2 }}>Automated scan of your KPIs against industry benchmarks</div>
        </div>
      </div>
      {clear && (
        <div style={{ background: "rgba(71,237,61,0.05)", border: "1px solid rgba(71,237,61,0.18)", borderRadius: 14, padding: "22px 26px", display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 30 }}>✅</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: G, marginBottom: 4 }}>All Clear — Business is healthy</div>
            <div style={{ fontSize: 13, color: TEXT }}>All monitored KPIs are within industry benchmarks.</div>
          </div>
        </div>
      )}
      {!clear && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {alerts.map((alert, i) => {
            const isCrit = alert.level === "critical";
            const color = isCrit ? RED : AMBER;
            return (
              <div key={i} style={{ background: isCrit ? "rgba(240,80,80,0.04)" : "rgba(240,168,48,0.04)", border: "1px solid " + color + "22", borderLeft: "3px solid " + color, borderRadius: 12, overflow: "hidden" }}>
                <div onClick={() => toggle(i)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", cursor: "pointer" }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: color + "18", border: "1px solid " + color + "30", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{isCrit ? "🚨" : "⚠️"}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {alert.channel !== "Overall" && <span style={{ fontSize: 11, fontWeight: 600, color: color, background: color + "15", border: "1px solid " + color + "25", borderRadius: 4, padding: "1px 7px" }}>{alert.channel}</span>}
                      <span style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{alert.metric}</span>
                    </div>
                    <div style={{ display: "flex", gap: 16, marginTop: 4, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, color: color, fontFamily: "'DM Mono',monospace", fontWeight: 600 }}>Current: {alert.current}</span>
                      <span style={{ fontSize: 12, color: TEXT }}>Benchmark: {alert.benchmark}</span>
                    </div>
                  </div>
                  <span style={{ fontSize: 12, color: T3, transition: "transform .2s", transform: open[i] ? "rotate(180deg)" : "rotate(0deg)", display: "inline-block" }}>▾</span>
                </div>
                {open[i] && (
                  <div style={{ padding: "0 18px 16px 60px", borderTop: "1px solid " + color + "15" }}>
                    <div style={{ paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: T3, letterSpacing: .8, textTransform: "uppercase", marginBottom: 4 }}>Why this is happening</div>
                        <div style={{ fontSize: 13, color: TEXT, lineHeight: 1.65 }}>{alert.why}</div>
                      </div>
                      <div style={{ background: color + "08", border: "1px solid " + color + "20", borderRadius: 8, padding: "11px 14px" }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: color, letterSpacing: .8, textTransform: "uppercase", marginBottom: 4 }}>Recommended Fix</div>
                        <div style={{ fontSize: 13, color: TEXT, lineHeight: 1.65 }}>{alert.fix}</div>
                      </div>
                      {alert.pipelineNote && (
                        <div style={{ background: "rgba(71,237,61,0.04)", border: "1px solid rgba(71,237,61,0.15)", borderRadius: 8, padding: "11px 14px" }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: G, letterSpacing: .8, textTransform: "uppercase", marginBottom: 4 }}>Pipeline Assessment</div>
                          <div style={{ fontSize: 13, color: TEXT, lineHeight: 1.65 }}>{alert.pipelineNote}</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main Dashboard ───────────────────────────────────────────
export default function Dashboard({ adminOrgId }: { adminOrgId?: string }) {
  const { user, orgId: userOrgId, role, signOut } = useAuth();
  const effectiveOrgId = adminOrgId || userOrgId;
  const sub = useSubscription(effectiveOrgId);
  const ent = useEntitlements(effectiveOrgId);
  const { settings, upsert: upsertSettings } = useOrgSettings(effectiveOrgId);
  const { logActivity } = useActivityLog(effectiveOrgId);
  const { periodsMap, isLoading: kpiLoading, isError: kpiError, refetch: kpiRefetch, savePeriod, isSaving, toggleLock, isLocking } = useKPIPeriods(effectiveOrgId);
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  const { data: orgData } = useQuery({
    queryKey: ["org-name", effectiveOrgId],
    queryFn: async () => {
      if (!effectiveOrgId) return null;
      const { data } = await supabase.from("organizations").select("name").eq("id", effectiveOrgId).maybeSingle();
      return data;
    },
    enabled: !!effectiveOrgId,
  });

  const [tab, setTab] = useState("summary");
  const [activeAgent, setAgent] = useState("diagnosing");
  const [dataOpen, setDataOpen] = useState(false);
  const [chatExpanded, setChatExpanded] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [showPicker, setPicker] = useState(false);
  const [channelRange, setChannelRange] = useState<"mtd" | "l3m" | "qtd" | "ytd" | "all">("mtd");

  const cur = nowPeriod();
  const [activePeriod, setActivePeriod] = useState(cur);
  const periods = getLast12();
  const current = isCurrent(activePeriod.month, activePeriod.year);
  const periodInfo = periodsMap[periodKey(activePeriod.month, activePeriod.year)];
  const isDbLocked = periodInfo?.is_locked ?? false;
  const subscriptionActive = sub.data?.isActive ?? false;
  const isAdmin = role === "super_admin";
  const effectiveLocked = isAdmin ? false : (isDbLocked || (!subscriptionActive));

  const [periodData, setPeriodData] = useState<KPIData>({ ...DEFAULTS });

  useEffect(() => {
    const key = periodKey(activePeriod.month, activePeriod.year);
    const saved = periodsMap[key];
    if (saved) {
      setPeriodData({ ...saved.data });
    } else {
      setPeriodData({ ...ZERO_DATA, companyName: orgData?.name || "" });
    }
  }, [periodsMap, activePeriod.month, activePeriod.year, orgData?.name]);

  const switchPeriod = (month: number, year: number) => {
    setActivePeriod({ month, year });
    setPicker(false);
    setTab("summary");
  };

  const handleSave = async () => {
    if (!effectiveOrgId) return;
    try {
      // Sync channels array to legacy m1/m2/m3 fields before saving
      const dataToSave = syncChannelsToLegacy(periodData);
      await savePeriod({ orgId: effectiveOrgId, month: activePeriod.month, year: activePeriod.year, data: dataToSave });
      setSaveMsg("Saved ✓");
      logActivity.mutate({ event_type: "kpi_saved", metadata: { period: periodLabel(activePeriod.month, activePeriod.year) } });
      setTimeout(() => setSaveMsg(""), 2000);
    } catch (e: any) {
      console.error("Save error:", e);
      setSaveMsg("Error saving");
      setTimeout(() => setSaveMsg(""), 3000);
    }
  };

  const inp = periodData;
  const m = calc(inp);
  const [editingField, setEditingField] = useState<{ key: string; raw: string } | null>(null);
  const getNumDisplay = (k: string) => {
    if (editingField?.key === k) return editingField.raw;
    return String((inp as any)[k]);
  };
  const setN = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9.-]/g, "");
    setEditingField({ key: k, raw });
    setPeriodData(p => ({ ...p, [k]: raw === "" || raw === "-" ? 0 : Number(raw) }));
  };
  const onNumFocus = (k: string) => () => {
    setEditingField({ key: k, raw: String((inp as any)[k]) });
  };
  const onNumBlur = () => setEditingField(null);
  const setS = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setPeriodData(p => ({ ...p, [k]: e.target.value }));

  // Channel management
  const addChannel = () => {
    setPeriodData(p => ({ ...p, channels: [...getChannels(p), { ...EMPTY_CHANNEL, name: "New Channel" }] }));
  };
  const removeChannel = (index: number) => {
    setPeriodData(p => {
      const chs = [...getChannels(p)];
      chs.splice(index, 1);
      return { ...p, channels: chs };
    });
  };
  const updateChannel = (index: number, field: keyof Channel, value: string | number) => {
    setPeriodData(p => {
      const chs = getChannels(p).map((ch, i) => {
        if (i !== index) return ch;
        return { ...ch, [field]: typeof value === 'string' && field !== 'name' ? (value === '' ? 0 : Number(value)) : value };
      });
      return { ...p, channels: chs };
    });
  };

  // Rep management
  const addRep = () => {
    const newId = (inp.reps?.length || 0) > 0 ? Math.max(...inp.reps.map(r => r.id)) + 1 : 1;
    const newRep: SalesRep = { id: newId, name: "", callsMade: 0, talkTimeMinutes: 0, leadsAssigned: 0, leadsContacted: 0, offersMade: 0, contractsSigned: 0, dealsClosed: 0, revenueGenerated: 0 };
    setPeriodData(p => ({ ...p, reps: [...(p.reps || []), newRep] }));
  };
  const removeRep = (id: number) => {
    setPeriodData(p => ({ ...p, reps: (p.reps || []).filter(r => r.id !== id) }));
  };
  const updateRep = (id: number, field: keyof SalesRep, value: string | number) => {
    setPeriodData(p => ({
      ...p,
      reps: (p.reps || []).map(r => r.id === id ? { ...r, [field]: typeof value === 'string' && field !== 'name' ? (value === '' ? 0 : Number(value)) : value } : r),
    }));
  };

  const historyData = periods.map(p => {
    const d = periodsMap[periodKey(p.month, p.year)];
    if (!d) return null;
    const cm = calc(d.data);
    return { month: periodLabel(p.month, p.year), revenue: cm.rev, spend: cm.ts, profit: cm.profit, contracts: cm.tcon, leads: cm.tnl, deals: cm.deals, mROI: cm.mROI, margin: cm.margin };
  }).filter(Boolean) as any[];

  const chartData = historyData.length >= 2 ? historyData : SAMPLE_HISTORY;
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentQuarter = Math.floor(now.getMonth() / 3); // 0-based: 0=Q1, 1=Q2, 2=Q3, 3=Q4
  const qtdStartMonth = currentQuarter * 3; // 0-based month
  const allPeriodsData: KPIData[] = [];
  const ytdPeriodsData: KPIData[] = [];
  const qtdPeriodsData: KPIData[] = [];
  Object.entries(periodsMap).forEach(([key, info]) => {
    const [yStr, mStr] = key.split("_");
    const year = parseInt(yStr, 10);
    const month = parseInt(mStr, 10); // 0-based month
    allPeriodsData.push(info.data);
    if (year === currentYear) {
      ytdPeriodsData.push(info.data);
      if (month >= qtdStartMonth && month < qtdStartMonth + 3) qtdPeriodsData.push(info.data);
    }
  });
  const allTimeCalc = allPeriodsData.length > 0 ? calc(aggregateKPIData(allPeriodsData)) : null;
  const ytdCalc = ytdPeriodsData.length > 0 ? calc(aggregateKPIData(ytdPeriodsData)) : null;
  const qtdCalc = qtdPeriodsData.length > 0 ? calc(aggregateKPIData(qtdPeriodsData)) : null;
  const qtdLabel = `Quarter to Date (Q${currentQuarter + 1} ${currentYear})`;

  const historicalContext = [
    qtdCalc ? `QTD (Q${currentQuarter + 1} ${currentYear}): Revenue ${fmt$(qtdCalc.rev)} | Profit ${fmt$(qtdCalc.profit)} | Margin ${fmtPct(qtdCalc.margin)} | Mktg ROI ${fmtRx(qtdCalc.mROI)} | Deals ${qtdCalc.deals} | Contracts ${qtdCalc.tcon}` : null,
    ytdCalc ? `YTD (${currentYear}): Revenue ${fmt$(ytdCalc.rev)} | Profit ${fmt$(ytdCalc.profit)} | Margin ${fmtPct(ytdCalc.margin)} | Mktg ROI ${fmtRx(ytdCalc.mROI)} | Deals ${ytdCalc.deals} | Contracts ${ytdCalc.tcon}` : null,
    allTimeCalc ? `ALL-TIME: Revenue ${fmt$(allTimeCalc.rev)} | Profit ${fmt$(allTimeCalc.profit)} | Margin ${fmtPct(allTimeCalc.margin)} | Mktg ROI ${fmtRx(allTimeCalc.mROI)} | Deals ${allTimeCalc.deals} | Contracts ${allTimeCalc.tcon}` : null,
  ].filter(Boolean).join("\n") || undefined;

  const alerts = buildAlerts(inp, m);
  const e = ent.data;
  const tabs = ["summary", "channels", "conversions", "team", "history"];
  const PIE_COLORS = [G, "#228b1e", "#145a10", AMBER, PURPLE, "#e05050", "#50a0e0", "#e0a050"];
  const channels = getChannels(inp);
  const pieData = channels.map(ch => ({ name: ch.name, value: ch.closedRevenue }));

  // L3M: last 3 calendar months relative to active period
  const l3mPeriods: KPIData[] = (() => {
    const periods3: KPIData[] = [];
    for (let i = 0; i < 3; i++) {
      let m = activePeriod.month - i;
      let y = activePeriod.year;
      if (m < 0) { m += 12; y -= 1; }
      const info = periodsMap[periodKey(m, y)];
      if (info) periods3.push(info.data);
    }
    return periods3;
  })();
  const l3mCalc = l3mPeriods.length > 0 ? calc(aggregateKPIData(l3mPeriods)) : null;
  const l3mChannels = l3mCalc ? getChannels(aggregateKPIData(l3mPeriods)) : channels;
  const l3mLabel = (() => {
    let startM = activePeriod.month - 2;
    let startY = activePeriod.year;
    if (startM < 0) { startM += 12; startY -= 1; }
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const startLabel = startY !== activePeriod.year ? `${months[startM]} ${startY}` : months[startM];
    return `${startLabel} – ${months[activePeriod.month]} ${activePeriod.year}`;
  })();
  const qtdChannels = qtdPeriodsData.length > 0 ? getChannels(aggregateKPIData(qtdPeriodsData)) : channels;
  const ytdChannels = ytdPeriodsData.length > 0 ? getChannels(aggregateKPIData(ytdPeriodsData)) : channels;
  const allChannels = allPeriodsData.length > 0 ? getChannels(aggregateKPIData(allPeriodsData)) : channels;

  const activeChannelResults =
    channelRange === "l3m" && l3mCalc ? l3mCalc.channelResults :
    channelRange === "qtd" && qtdCalc ? qtdCalc.channelResults :
    channelRange === "ytd" && ytdCalc ? ytdCalc.channelResults :
    channelRange === "all" && allTimeCalc ? allTimeCalc.channelResults :
    m.channelResults;
  const activeChannels =
    channelRange === "l3m" ? l3mChannels :
    channelRange === "qtd" ? qtdChannels :
    channelRange === "ytd" ? ytdChannels :
    channelRange === "all" ? allChannels :
    channels;
  const channelRangeLabel =
    channelRange === "l3m" ? `L3M · ${l3mLabel}` :
    channelRange === "qtd" ? `QTD · Q${currentQuarter + 1} ${currentYear}` :
    channelRange === "ytd" ? `YTD · ${currentYear}` :
    channelRange === "all" ? "All Time" :
    "Current Month";

  const IS: React.CSSProperties = { background: S3, border: "1px solid " + B2, borderRadius: 7, padding: "7px 10px", color: TEXT, fontSize: 13, outline: "none", fontFamily: "'DM Mono',monospace", width: "100%" };
  const displayName = orgData?.name || inp.companyName;

  const teamTotals = inp.reps?.length > 0 ? calcTeamTotals(inp.reps) : null;

  if (kpiLoading && Object.keys(periodsMap).length === 0) {
    return <PageLoading message="Loading your dashboard..." />;
  }
  if (kpiError && Object.keys(periodsMap).length === 0) {
    return <PageError message="Dashboard data could not load." onRetry={() => kpiRefetch()} />;
  }

  return (
    <div style={{ minHeight: "100vh", background: BG, color: TEXT, fontFamily: "'DM Sans',sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=DM+Mono:wght@400;500;600&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:#080a08}
        ::-webkit-scrollbar-thumb{background:#232823;border-radius:2px}
        input[type=number]::-webkit-outer-spin-button,input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none}
        @keyframes bounce{0%,100%{transform:translateY(0);opacity:.35}50%{transform:translateY(-5px);opacity:1}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        .tab-content{animation:fadeUp .3s ease both}
        .ghost{background:transparent;border:1px solid #232823;border-radius:8px;padding:7px 16px;color:#eaeee8;font-size:13px;cursor:pointer;font-family:inherit;transition:all .15s}
        .ghost:hover{border-color:#47ed3d;color:#47ed3d}
      `}</style>

      {/* Subscription expired/suspended banner */}
      {sub.data && !sub.data.isActive && (
        <div className="sub-banner" style={{ background: "rgba(240,80,80,0.1)", borderBottom: "1px solid rgba(240,80,80,0.25)", padding: "10px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ color: RED, fontSize: 14, fontWeight: 600 }}>
            ⚠️ {sub.data.isSuspended ? "Your account has been suspended." : "Your subscription has expired."} Data is read-only.
          </span>
          <Link to="/app/support" style={{ color: RED, fontSize: 13, fontWeight: 700, textDecoration: "none", border: "1px solid " + RED + "40", borderRadius: 7, padding: "5px 14px" }}>Contact Support</Link>
        </div>
      )}
      {sub.data?.isActive && sub.data.expiresAt && (() => {
        const days = Math.ceil((new Date(sub.data.expiresAt!).getTime() - Date.now()) / 86400000);
        return days <= 14 && days > 0 ? (
          <div style={{ background: AMBER + "10", borderBottom: "1px solid " + AMBER + "25", padding: "10px 28px", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: AMBER, fontSize: 14, fontWeight: 600 }}>⚠️ Your subscription expires on {new Date(sub.data.expiresAt!).toLocaleDateString()} ({days} days remaining)</span>
          </div>
        ) : null;
      })()}

      {/* Onboarding Checklist */}
      {!adminOrgId && !settings?.onboarding_dismissed && (
        <div style={{ background: S1, borderBottom: "1px solid " + B1, padding: "16px 28px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: G }}>🚀 Getting Started</div>
            <button onClick={() => upsertSettings.mutate({ onboarding_dismissed: true } as any)} style={{ background: "transparent", border: "none", color: T3, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>✕ Dismiss</button>
          </div>
          <div className="onboarding-steps" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {[
              { label: "Complete company profile", done: !!settings?.timezone },
              { label: "Enter KPI data for current month", done: !!periodsMap[periodKey(nowPeriod().month, nowPeriod().year)] },
              { label: "Save your first period", done: Object.keys(periodsMap).length > 0 },
              { label: "Download a PDF report", done: false },
            ].map(step => (
              <div key={step.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: step.done ? G : T3 }}>
                <span>{step.done ? "✓" : "○"}</span>
                <span>{step.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="dashboard-header" style={{ position: "sticky", top: 0, zIndex: 300, background: "rgba(8,10,8,0.92)", backdropFilter: "blur(20px)", borderBottom: "1px solid " + B1, display: "flex", alignItems: "center", gap: 20, padding: "0 28px", height: 60 }}>
        <div className="dashboard-brand" style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <img src={closerControlLogo} alt="Closer Control" style={{ height: 28 }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, lineHeight: 1.1 }}>Revenue Engine</div>
            <div style={{ fontSize: 10, color: T3, letterSpacing: 1.4, textTransform: "uppercase" }}>by Closer Control</div>
          </div>
          <div style={{ width: 1, height: 26, background: B2, margin: "0 4px" }} />
          <span style={{ fontSize: 14, color: TEXT, fontWeight: 500 }}>{displayName}</span>
        </div>

        {/* Period Selector */}
        <div style={{ position: "relative" }}>
          <button onClick={() => setPicker(p => !p)} style={{ display: "flex", alignItems: "center", gap: 8, background: showPicker ? S2 : S1, border: "1px solid " + (showPicker ? G + "40" : B2), borderRadius: 9, padding: "6px 14px", cursor: "pointer", fontFamily: "inherit" }}>
            <span style={{ fontSize: 12, color: effectiveLocked ? T3 : G }}>{effectiveLocked ? "🔒" : "●"}</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: current ? G : effectiveLocked ? T2 : T3 }}>{periodLabel(activePeriod.month, activePeriod.year)}</span>
            <span style={{ fontSize: 11, color: T3 }}>▾</span>
          </button>
          {showPicker && (
            <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 500, background: S2, border: "1px solid " + B2, borderRadius: 12, padding: 8, minWidth: 200, boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
              <div style={{ fontSize: 11, color: T3, letterSpacing: .8, textTransform: "uppercase", padding: "4px 8px 8px", borderBottom: "1px solid " + B1, marginBottom: 6 }}>Select Period</div>
              {periods.map(p => {
                const isActive = p.month === activePeriod.month && p.year === activePeriod.year;
                const pastPd = isPast(p.month, p.year);
                const curPd = isCurrent(p.month, p.year);
                const pInfo = periodsMap[periodKey(p.month, p.year)];
                const hasSaved = !!pInfo;
                const pLocked = pInfo?.is_locked ?? false;
                return (
                  <div key={p.year + "-" + p.month} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <button onClick={() => switchPeriod(p.month, p.year)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: 7, background: isActive ? G + "12" : "transparent", border: "1px solid " + (isActive ? G + "30" : "transparent"), color: isActive ? G : TEXT, fontSize: 13, fontWeight: isActive ? 600 : 400, cursor: "pointer", fontFamily: "inherit" }}>
                      <span>{periodLabel(p.month, p.year)}</span>
                      <span style={{ fontSize: 11 }}>
                        {curPd ? <span style={{ color: G }}>● Active</span> : pLocked ? <span style={{ color: AMBER }}>🔒 Locked</span> : hasSaved ? <span style={{ color: T3 }}>Saved</span> : null}
                      </span>
                    </button>
                    {isAdmin && pastPd && (
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleLock({ orgId: effectiveOrgId!, month: p.month, year: p.year, locked: !pLocked }); }}
                        title={pLocked ? "Unlock month" : "Lock month"}
                        style={{ background: pLocked ? AMBER + "15" : G + "12", border: "1px solid " + (pLocked ? AMBER + "30" : G + "28"), borderRadius: 5, padding: "4px 7px", cursor: "pointer", fontSize: 11, color: pLocked ? AMBER : G, fontFamily: "inherit", flexShrink: 0, minWidth: 56 }}
                      >
                        {pLocked ? "🔒 Lock" : "🔓 Open"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {effectiveLocked && (
          <div className="period-locked-badge" style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(240,168,48,0.1)", border: "1px solid rgba(240,168,48,0.25)", borderRadius: 7, padding: "4px 10px" }}>
            <span style={{ fontSize: 12 }}>🔒</span>
            <span style={{ fontSize: 11, color: AMBER, fontWeight: 500 }}>Read-only</span>
          </div>
        )}

        <nav style={{ display: "flex", gap: 2, flex: 1, justifyContent: "center", alignItems: "center" }}>
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ background: tab === t ? S2 : "transparent", border: "1px solid " + (tab === t ? B2 : "transparent"), borderRadius: 8, padding: "6px 16px", color: tab === t ? TEXT : T3, fontSize: 13, fontWeight: tab === t ? 500 : 400, cursor: "pointer", fontFamily: "inherit", transition: "all .15s", textTransform: "capitalize" }}>{t}</button>
          ))}
          {sub.data?.planName?.toLowerCase() === "starter" && (
            <>
              <div style={{ width: 1, height: 20, background: B2, margin: "0 8px" }} />
              <a href="https://info.closercontrol.com/how-to-rel" target="_blank" rel="noopener noreferrer" style={{ background: "transparent", border: "1px solid " + B2, borderRadius: 8, padding: "6px 18px", color: AMBER, fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", transition: "all .15s", textDecoration: "none", whiteSpace: "nowrap" }}>How To Use</a>
              <div style={{ width: 8 }} />
              <a href="https://info.closercontrol.com/rev-engine-pro-landing" target="_blank" rel="noopener noreferrer" style={{ background: G + "15", border: "1px solid " + G + "30", borderRadius: 8, padding: "6px 18px", color: G, fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", transition: "all .15s", textDecoration: "none", whiteSpace: "nowrap" }}>Revenue Engine Pro</a>
            </>
          )}
        </nav>

        <div className="dashboard-header-actions" style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {(!ent.data || ent.data.pdf_enabled) && (
            <button className="ghost" onClick={() => { exportPDF(inp, m); logActivity.mutate({ event_type: "pdf_exported", metadata: { period: periodLabel(activePeriod.month, activePeriod.year) } }); }}>↓ PDF</button>
          )}
          {!effectiveLocked && (
            <button className="ghost" onClick={() => setDataOpen(p => !p)} style={{ color: dataOpen ? G : undefined, borderColor: dataOpen ? G + "40" : undefined }}>⚙ Data Entry</button>
          )}
          {!adminOrgId && (
            <div style={{ position: "relative" }}>
              <button className="ghost" onClick={() => setShowAccountMenu(p => !p)} style={{ fontSize: 12 }}>⚙ Account ▾</button>
              {showAccountMenu && (
                <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 500, background: S2, border: "1px solid " + B2, borderRadius: 10, padding: 6, minWidth: 170, boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
                  {[
                    { label: "Account", path: "/app/account" },
                    { label: "Subscription", path: "/app/account/subscription" },
                    { label: "Support", path: "/app/support" },
                  ].map(item => (
                    <Link key={item.path} to={item.path} onClick={() => setShowAccountMenu(false)}
                      style={{ display: "block", padding: "8px 12px", fontSize: 13, color: TEXT, textDecoration: "none", borderRadius: 6 }}
                      onMouseEnter={e => (e.currentTarget.style.background = S3)}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>{item.label}</Link>
                  ))}
                  <div style={{ borderTop: "1px solid " + B1, margin: "4px 0" }} />
                  <button onClick={() => { setShowAccountMenu(false); signOut(); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", fontSize: 13, color: RED, background: "transparent", border: "none", borderRadius: 6, cursor: "pointer", fontFamily: "inherit" }}>Sign Out</button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* DATA ENTRY PANEL */}
      {dataOpen && !effectiveLocked && (
        <div style={{ background: S1, borderBottom: "1px solid " + B1, padding: "22px 28px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: G, letterSpacing: 1.2, textTransform: "uppercase" }}>Data Entry</div>
              <select
                value={periodKey(activePeriod.month, activePeriod.year)}
                onChange={(e) => {
                  const [yy, mm] = e.target.value.split("_");
                  switchPeriod(Number(mm), Number(yy));
                }}
                style={{ ...IS, width: 170, fontFamily: "'DM Sans',sans-serif", fontSize: 12 }}
              >
                {periods.map((p) => (
                  <option key={periodKey(p.month, p.year)} value={periodKey(p.month, p.year)}>
                    {periodLabel(p.month, p.year)}
                  </option>
                ))}
              </select>
            </div>
            <button onClick={handleSave} disabled={isSaving} style={{ background: G, border: "none", borderRadius: 8, padding: "10px 24px", color: "#000", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>{saveMsg || (isSaving ? "Saving..." : "Save Period")}</button>
          </div>

          {/* Channel Marketing Data */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T2, letterSpacing: 1, textTransform: "uppercase" }}>Marketing Channels</div>
            <button onClick={addChannel} style={{ background: G + "15", border: "1px solid " + G + "30", borderRadius: 7, padding: "5px 14px", color: G, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>+ Add Channel</button>
          </div>
          <div className="grid-data-entry" style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(channels.length, 4)},1fr)`, gap: 22 }}>
            {channels.map((ch, idx) => (
              <div key={idx}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                  <input value={ch.name} onChange={e => updateChannel(idx, 'name', e.target.value)} style={{ ...IS, color: G, fontWeight: 600, fontSize: 14, flex: 1 }} />
                  {channels.length > 1 && (
                    <button onClick={() => removeChannel(idx)} style={{ background: RED + "15", border: "1px solid " + RED + "30", borderRadius: 5, padding: "4px 8px", color: RED, fontSize: 11, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>✕</button>
                  )}
                </div>
                {(["spend","newLeads","netLeads","offers","contracts","closedRevenue","closedDeals"] as (keyof Channel)[]).map(field => {
                  const lbl = field.replace(/([A-Z])/g, " $1").trim();
                  const editKey = `ch_${idx}_${field}`;
                  return (
                    <div key={field} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontSize: 12, color: TEXT }}>{lbl}</span>
                      <input
                        type="text" inputMode="numeric"
                        value={editingField?.key === editKey ? editingField.raw : String(ch[field])}
                        onChange={e => {
                          const raw = e.target.value.replace(/[^0-9.-]/g, "");
                          setEditingField({ key: editKey, raw });
                          updateChannel(idx, field, raw === "" || raw === "-" ? 0 : Number(raw));
                        }}
                        onFocus={() => setEditingField({ key: editKey, raw: String(ch[field]) })}
                        onBlur={onNumBlur}
                        style={{ ...IS, width: 120, textAlign: "right" }}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Activity */}
          <div style={{ borderTop: "1px solid " + B1, marginTop: 18, paddingTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T2, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>Activity</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
              {([["totalACQCalls","ACQ Calls"],["totalACQTalkTime","Talk Time (min)"]] as [string, string][]).map(([k, l]) => (
                <div key={k}>
                  <div style={{ fontSize: 11, color: TEXT, marginBottom: 4, textTransform: "uppercase", letterSpacing: .5 }}>{l}</div>
                  <input type="text" inputMode="numeric" value={getNumDisplay(k)} onChange={setN(k)} onFocus={onNumFocus(k)} onBlur={onNumBlur} style={{ ...IS }} />
                </div>
              ))}
            </div>
          </div>

          {/* Sales Team Reps - gated by team_enabled */}
          {(!e || e.team_enabled) && (
          <div style={{ borderTop: "1px solid " + B1, marginTop: 18, paddingTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: T2, letterSpacing: 1, textTransform: "uppercase" }}>Sales Team</div>
              <button onClick={addRep} style={{ background: G + "15", border: "1px solid " + G + "30", borderRadius: 7, padding: "5px 14px", color: G, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>+ Add Rep</button>
            </div>
            {(inp.reps || []).map(rep => {
              const rm = calcRepMetrics(rep);
              return (
                <div key={rep.id} style={{ background: S2, border: "1px solid " + B1, borderRadius: 10, padding: "12px 16px", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <input value={rep.name} onChange={e => updateRep(rep.id, 'name', e.target.value)} placeholder="Rep Name" style={{ ...IS, width: 160, color: G, fontWeight: 600 }} />
                    <button onClick={() => removeRep(rep.id)} style={{ background: RED + "15", border: "1px solid " + RED + "30", borderRadius: 5, padding: "4px 10px", color: RED, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
                    <div style={{ marginLeft: "auto", display: "flex", gap: 12, fontSize: 11, color: T2 }}>
                      <span>Contact: <span style={{ color: G, fontWeight: 600 }}>{fmtPct(rm.contactRate)}</span></span>
                      <span>Offer: <span style={{ color: G, fontWeight: 600 }}>{fmtPct(rm.offerRate)}</span></span>
                      <span>Close: <span style={{ color: G, fontWeight: 600 }}>{fmtPct(rm.closeRate)}</span></span>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                    {([
                      ["callsMade","Calls"], ["talkTimeMinutes","Talk Time (min)"], ["leadsAssigned","Leads Assigned"], ["leadsContacted","Leads Contacted"],
                      ["offersMade","Offers Made"], ["contractsSigned","Contracts"], ["dealsClosed","Deals Closed"], ["revenueGenerated","Revenue"],
                    ] as [keyof SalesRep, string][]).map(([field, label]) => (
                      <div key={field}>
                        <div style={{ fontSize: 10, color: T3, marginBottom: 3, textTransform: "uppercase", letterSpacing: .5 }}>{label}</div>
                        <input type="text" inputMode="numeric" value={String(rep[field])} onChange={e => updateRep(rep.id, field, e.target.value)} style={{ ...IS, textAlign: "right" }} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {(inp.reps || []).length === 0 && (
              <div style={{ fontSize: 12, color: T3, padding: "10px 0" }}>No reps added yet. Click "+ Add Rep" to start tracking sales team performance.</div>
            )}
          </div>
          )}

          {/* Financial Statement - gated by financials_enabled */}
          {(!e || e.financials_enabled) && (
          <div style={{ borderTop: "1px solid " + B1, marginTop: 18, paddingTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T2, letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>Financial Statement (P&L)</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 16 }}>
              {/* COGS */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: AMBER, marginBottom: 8 }}>COGS</div>
                {([["cogsDealPartnerSplits","Partner Splits"],["cogsDispositionFees","Dispo Fees"],["cogsClosingCosts","Closing Costs"]] as [string, string][]).map(([k, l]) => (
                  <div key={k} style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 10, color: T3, marginBottom: 2 }}>{l}</div>
                    <input type="text" inputMode="numeric" value={getNumDisplay(k)} onChange={setN(k)} onFocus={onNumFocus(k)} onBlur={onNumBlur} style={{ ...IS, textAlign: "right" }} />
                  </div>
                ))}
              </div>
              {/* Labor */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: AMBER, marginBottom: 8 }}>Labor</div>
                {([["laborAcquisitionTeam","ACQ Team"],["laborSalesCommissions","Sales Commissions"],["laborVirtualAssistants","Virtual Assistants"],["laborLegalFees","Legal Fees"]] as [string, string][]).map(([k, l]) => (
                  <div key={k} style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 10, color: T3, marginBottom: 2 }}>{l}</div>
                    <input type="text" inputMode="numeric" value={getNumDisplay(k)} onChange={setN(k)} onFocus={onNumFocus(k)} onBlur={onNumBlur} style={{ ...IS, textAlign: "right" }} />
                  </div>
                ))}
              </div>
              {/* Marketing */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: AMBER, marginBottom: 8 }}>Marketing</div>
                {([["mktgPPC","PPC"],["mktgSMS","SMS"],["mktgColdCalling","Cold Calling"],["mktgDirectMail","Direct Mail"],["mktgLeadProviders","Data"]] as [string, string][]).map(([k, l]) => (
                  <div key={k} style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 10, color: T3, marginBottom: 2 }}>{l}</div>
                    <input type="text" inputMode="numeric" value={getNumDisplay(k)} onChange={setN(k)} onFocus={onNumFocus(k)} onBlur={onNumBlur} style={{ ...IS, textAlign: "right" }} />
                  </div>
                ))}
              </div>
              {/* Software */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: AMBER, marginBottom: 8 }}>Software</div>
                {([["softwareCloserControl","Closer Control"],["softwareOther","Other Tools"]] as [string, string][]).map(([k, l]) => (
                  <div key={k} style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 10, color: T3, marginBottom: 2 }}>{l}</div>
                    <input type="text" inputMode="numeric" value={getNumDisplay(k)} onChange={setN(k)} onFocus={onNumFocus(k)} onBlur={onNumBlur} style={{ ...IS, textAlign: "right" }} />
                  </div>
                ))}
              </div>
              {/* Accounting */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: AMBER, marginBottom: 8 }}>Accounting</div>
                {([["accountingBookkeeping","Bookkeeping"],["accountingCPA","CPA"]] as [string, string][]).map(([k, l]) => (
                  <div key={k} style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 10, color: T3, marginBottom: 2 }}>{l}</div>
                    <input type="text" inputMode="numeric" value={getNumDisplay(k)} onChange={setN(k)} onFocus={onNumFocus(k)} onBlur={onNumBlur} style={{ ...IS, textAlign: "right" }} />
                  </div>
                ))}
              </div>
            </div>
            {/* P&L auto-calc summary */}
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, background: S2, border: "1px solid " + B1, borderRadius: 10, padding: "12px 16px" }}>
              {([
                ["Revenue", fmt$(m.rev)], ["COGS", fmt$(m.totalCOGS)], ["Gross Profit", fmt$(m.grossProfit)],
                ["Operating Exp", fmt$(m.totalOpEx)], ["Net Profit", fmt$(m.netProfit)],
              ] as [string, string][]).map(([l, v]) => (
                <div key={l} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: .5, marginBottom: 3 }}>{l}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: l === "Net Profit" ? (m.netProfit >= 0 ? G : RED) : TEXT, fontFamily: "'DM Mono',monospace" }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
          )}
        </div>
      )}

      {/* MAIN */}
      <main className="dashboard-main" style={{ padding: "28px 28px 48px", maxWidth: 1440, margin: "0 auto" }}>
        {/* SUMMARY */}
        {tab === "summary" && (
          <div className="tab-content">
            {/* Primary hero cards - simplified for Lite (no financials) */}
            {(!e || e.financials_enabled) ? (
              <>
                <div className="grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 14 }}>
                  <HeroCard label="Revenue" value={fmt$(m.rev)} accent />
                  <HeroCard label="Gross Profit" value={fmt$(m.grossProfit)} accent sub={"COGS: " + fmt$(m.totalCOGS)} />
                  <HeroCard label="Net Profit" value={fmt$(m.netProfit)} accent={m.netProfit > 0} sub={fmtPct(m.profitMarginPct) + " margin"} />
                  <HeroCard label="Profit Margin" value={fmtPct(m.profitMarginPct)} sub={m.profitMarginPct >= 20 ? "Healthy" : "Below 20% target"} />
                </div>
                <div className="grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 26 }}>
                  <StatCard label="Marketing Spend" value={fmt$(m.totalMarketing)} sub={"Channel spend: " + fmt$(m.ts)} />
                  <StatCard label="Deals Closed" value={fmtN(m.deals)} sub={fmtN(m.tcon) + " contracts signed"} />
                  <StatCard label="Cost Per Deal" value={fmt$(m.costPerDealMktg)} sub="marketing ÷ deals" />
                  <StatCard label="Revenue Per Deal" value={fmt$(m.revPerDeal)} sub="revenue ÷ deals" />
                </div>
              </>
            ) : (
              <div className="grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 26 }}>
                <HeroCard label="Revenue" value={fmt$(m.rev)} accent />
                <HeroCard label="Total Spend" value={fmt$(m.ts)} sub="channel marketing" />
                <HeroCard label="Deals Closed" value={fmtN(m.deals)} sub={fmtN(m.tcon) + " contracts signed"} />
                <HeroCard label="Marketing ROI" value={fmtRx(m.mROI)} sub="revenue ÷ spend" />
              </div>
            )}

            <div className="summary-chart-sidebar" style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, marginBottom: 20 }}>
              <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "22px 24px" }}>
                <SH title="Revenue and Profit Trend" right={<span style={{ fontSize: 12, color: T3 }}>{historyData.length >= 2 ? "Live data" : "Sample data"}</span>} />
                <ResponsiveContainer width="100%" height={230}>
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={G} stopOpacity={.18} /><stop offset="100%" stopColor={G} stopOpacity={0} /></linearGradient>
                      <linearGradient id="gPro" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={PURPLE} stopOpacity={.2} /><stop offset="100%" stopColor={PURPLE} stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={B1} vertical={false} />
                    <XAxis dataKey="month" tick={{ fill: T3, fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: T3, fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={fmtK} width={48} />
                    <Tooltip content={<CTip money />} />
                    <Area type="monotone" dataKey="revenue" name="Revenue" stroke={G} strokeWidth={2.5} fill="url(#gRev)" />
                    <Area type="monotone" dataKey="profit" name="Profit" stroke={PURPLE} strokeWidth={2} fill="url(#gPro)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "18px 20px", flex: 1 }}>
                  <SH title="Revenue by Channel" />
                  <ResponsiveContainer width="100%" height={110}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={30} outerRadius={50} dataKey="value" strokeWidth={0}>
                        {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: S2, border: "1px solid " + B2, borderRadius: 8, fontSize: 12 }} formatter={(v: any) => [fmt$(v)]} />
                    </PieChart>
                  </ResponsiveContainer>
                  {pieData.map((d, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: PIE_COLORS[i] }} />
                        <span style={{ fontSize: 12, color: TEXT }}>{d.name}</span>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: TEXT, fontFamily: "'DM Mono',monospace" }}>{fmt$(d.value)}</span>
                    </div>
                  ))}
                </div>
                <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "16px 20px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {([["Closed Deals", fmtN(m.deals)], ["Marketing ROI", fmtRx(m.mROI)], ["Business ROI", fmtRx(m.bROI)], ["Avg Assignment Fee", fmt$(m.avgRev)]] as [string, string][]).map(([l, v]) => (
                      <div key={l}>
                        <div style={{ fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: .8, marginBottom: 4 }}>{l}</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, fontFamily: "'DM Mono',monospace" }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* P&L WATERFALL - gated by financials_enabled */}
            {(!e || e.financials_enabled) && (
            <div style={{ marginTop: 4, marginBottom: 20 }}>
              <SH title="Financial Statement — P&L Summary" />
              <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "22px 24px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 10 }}>
                  {([
                    ["Sales", fmt$(m.rev), G, true],
                    ["COGS", "–" + fmt$(m.totalCOGS), RED, false],
                    ["Gross Profit", fmt$(m.grossProfit), m.grossProfit >= 0 ? G : RED, true],
                    ["Labor", fmt$(m.totalLabor), TEXT, false],
                    ["Marketing", fmt$(m.totalMarketing), TEXT, false],
                    ["Software", fmt$(m.totalSoftware), TEXT, false],
                    ["Accounting", fmt$(m.totalAccounting), TEXT, false],
                  ] as [string, string, string, boolean][]).map(([l, v, c, bold]) => (
                    <div key={l} style={{ textAlign: "center", padding: "12px 0" }}>
                      <div style={{ fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: .6, marginBottom: 6 }}>{l}</div>
                      <div style={{ fontSize: bold ? 20 : 16, fontWeight: bold ? 800 : 600, color: c, fontFamily: "'DM Mono',monospace" }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ borderTop: "1px solid " + B1, marginTop: 12, paddingTop: 12, display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: .6, marginBottom: 6 }}>Total OpEx</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: TEXT, fontFamily: "'DM Mono',monospace" }}>{fmt$(m.totalOpEx)}</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: .6, marginBottom: 6 }}>Net Profit</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: m.netProfit >= 0 ? G : RED, fontFamily: "'DM Mono',monospace" }}>{fmt$(m.netProfit)}</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: .6, marginBottom: 6 }}>Cash Flow</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: m.cashFlow >= 0 ? G : RED, fontFamily: "'DM Mono',monospace" }}>{fmt$(m.cashFlow)}</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: .6, marginBottom: 6 }}>Profit Margin</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: m.profitMarginPct >= 20 ? G : m.profitMarginPct >= 10 ? AMBER : RED, fontFamily: "'DM Mono',monospace" }}>{fmtPct(m.profitMarginPct)}</div>
                  </div>
                </div>
              </div>
            </div>
            )}

            {/* PROJECTED REVENUE FROM CONTRACTS */}
            <div style={{ marginTop: 4 }}>
              <SH title="Projected Revenue from Contracts" />
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(channels.length + 1, 5)},1fr)`, gap: 12 }}>
                {channels.map(ch => {
                  const avgDealRev = ch.closedDeals > 0 ? ch.closedRevenue / ch.closedDeals : (m.deals > 0 ? m.avgRev : 0);
                  const projectedRev = ch.contracts * avgDealRev;
                  return (
                    <StatCard key={ch.name} label={ch.name + " Projected"} value={fmt$(projectedRev)} sub={fmtN(ch.contracts) + " contracts × " + fmt$(avgDealRev)} />
                  );
                })}
                <StatCard label="Total Projected" value={fmt$(m.tcon * (m.deals > 0 ? m.avgRev : 0))} sub={fmtN(m.tcon) + " total contracts"} />
              </div>
            </div>

            {/* QTD, YTD & ALL-TIME OVERVIEW - gated by financials_enabled */}
            {(!e || e.financials_enabled) && (qtdCalc || ytdCalc || allTimeCalc) && (
              <div style={{ marginTop: 24 }}>
                <SH title="Business Overview" />
                {(() => {
                  const sections = [
                    qtdCalc ? { title: qtdLabel, data: qtdCalc, count: qtdPeriodsData.length } : null,
                    ytdCalc ? { title: "Year to Date (" + currentYear + ")", data: ytdCalc, count: ytdPeriodsData.length } : null,
                    allTimeCalc ? { title: "All Time", data: allTimeCalc, count: allPeriodsData.length } : null,
                  ].filter(Boolean) as { title: string; data: any; count: number }[];
                  return (
                    <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(sections.length, 3)}, 1fr)`, gap: 16 }}>
                      {sections.map((section) => (
                        <div key={section.title} style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "20px 22px" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: G }}>{section.title}</div>
                            <span style={{ fontSize: 11, color: T3 }}>{section.count} period{section.count !== 1 ? "s" : ""}</span>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
                            {([
                              ["Revenue", fmt$(section.data.rev)],
                              ["Gross Profit", fmt$(section.data.grossProfit)],
                              ["Net Profit", fmt$(section.data.netProfit)],
                              ["Profit Margin", fmtPct(section.data.profitMarginPct)],
                              ["Mktg ROI", fmtRx(section.data.mROI)],
                              ["Business ROI", fmtRx(section.data.bROI)],
                              ["Total Spend", fmt$(section.data.ts)],
                              ["Marketing", fmt$(section.data.totalMarketing)],
                              ["Closed Deals", fmtN(section.data.deals)],
                              ["Contracts", fmtN(section.data.tcon)],
                              ["Cost Per Deal", fmt$(section.data.costPerDealMktg)],
                              ["Rev Per Deal", fmt$(section.data.revPerDeal)],
                            ] as [string, string][]).map(([l, v]) => (
                              <div key={l}>
                                <div style={{ fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: .8, marginBottom: 3 }}>{l}</div>
                                <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, fontFamily: "'DM Mono',monospace" }}>{v}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {/* CHANNELS */}
        {tab === "channels" && (
          <div className="tab-content">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>
                Channel Performance · {channelRangeLabel}
              </div>
              <div style={{ display: "flex", gap: 4, background: S3, borderRadius: 8, padding: 3 }}>
                {([["mtd", "MTD"], ["l3m", "L3M"], ["qtd", "QTD"], ["ytd", "YTD"], ["all", "All"]] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setChannelRange(key)}
                    style={{
                      padding: "5px 14px", fontSize: 12, fontWeight: 600, borderRadius: 6,
                      border: "none", cursor: "pointer", transition: "all .15s",
                      background: channelRange === key ? G : "transparent",
                      color: channelRange === key ? BG : T3,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(activeChannelResults.length, 3)},1fr)`, gap: 16, marginBottom: 20 }}>
              {activeChannelResults.map(cr => {
                const c = cr.channel;
                const ch = cr.metrics;
                return (
                <div key={cr.name} style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "22px 22px", position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg," + G + "60,transparent)" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginBottom: 3 }}>{cr.name}</div>
                      <div style={{ fontSize: 12, color: TEXT }}>Spend: <span style={{ color: TEXT, fontFamily: "'DM Mono',monospace" }}>{fmt$(c.spend)}</span></div>
                    </div>
                    <div style={{ background: ch.roi >= 1 ? G + "15" : "rgba(240,80,80,0.12)", border: "1px solid " + (ch.roi >= 1 ? G + "30" : "rgba(240,80,80,0.3)"), borderRadius: 8, padding: "5px 12px", textAlign: "center" }}>
                      <div style={{ fontSize: 10, color: T3, letterSpacing: .8, textTransform: "uppercase", marginBottom: 2 }}>ROI</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: ch.roi >= 1 ? G : RED, fontFamily: "'DM Mono',monospace" }}>{fmtRx(ch.roi)}</div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
                    {([["Revenue", fmt$(c.closedRevenue)], ["Closed Deals", String(c.closedDeals)], ["Cost Per Lead", fmt$(ch.cpl)], ["Cost Per Contract", fmt$(ch.cpCon)], ["Cost Per Deal", fmt$(ch.cpDeal)], ["Rev / Deal", fmt$(ch.revDeal)], ["Net Lead to Contract", fmtPct(ch.nl2c)], ["Con to Close", fmtPct(ch.c2cl)]] as [string, string][]).map(([l, v]) => (
                      <div key={l} style={{ background: S3, borderRadius: 8, padding: "9px 11px" }}>
                        <div style={{ fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: .5, marginBottom: 4 }}>{l}</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, fontFamily: "'DM Mono',monospace" }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: T3, letterSpacing: .8, textTransform: "uppercase", marginBottom: 8 }}>Funnel</div>
                  {([["Leads", c.newLeads], ["Net Leads", c.netLeads], ["Offers", c.offers], ["Contracts", c.contracts]] as [string, number][]).map(([l, v], i) => {
                    const w = c.newLeads > 0 ? Math.max((v / c.newLeads) * 100, 4) : 4;
                    const ops = ["e0", "a0", "70", "50"][i];
                    return (
                      <div key={l} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                        <div style={{ width: 68, fontSize: 11, color: TEXT, textAlign: "right", flexShrink: 0 }}>{l}</div>
                        <div style={{ flex: 1, height: 22, background: S3, borderRadius: 5, overflow: "hidden" }}>
                          <div style={{ width: w + "%", height: "100%", borderRadius: 5, background: G + ops, display: "flex", alignItems: "center", paddingLeft: 8 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(0,0,0,0.8)" }}>{v}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                );
              })}
            </div>
            <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "22px 24px" }}>
              <SH title="Revenue vs Spend by Channel" />
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={activeChannels.map(ch => ({ name: ch.name, Revenue: ch.closedRevenue, Spend: ch.spend }))} barCategoryGap="32%">
                  <CartesianGrid strokeDasharray="3 3" stroke={B1} vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: T3, fontSize: 13 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: T3, fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={fmtK} width={48} />
                  <Tooltip content={<CTip money />} />
                  <Bar dataKey="Revenue" fill={G} radius={[6, 6, 0, 0]} />
                  <Bar dataKey="Spend" fill={AMBER} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* CONVERSIONS */}
        {tab === "conversions" && (
          <div className="tab-content">
            <div className="grid-5" style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, marginBottom: 20 }}>
              {([["Lead to Net Lead", fmtPct(m.l2n), "40-60%"], ["Net Lead to Offer", fmtPct(m.nl2o), "30-50%"], ["Offer to Contract", fmtPct(m.o2c), "25-40%"], ["Net Lead to Contract", fmtPct(m.nl2c), "10-20%"], ["Contract to Close", fmtPct(m.c2cl), "40-55%"]] as [string, string, string][]).map(([l, v, b]) => (
                <div key={l} style={{ background: S1, border: "1px solid " + B1, borderRadius: 14, padding: "18px 18px" }}>
                  <div style={{ fontSize: 11, color: T3, letterSpacing: .8, textTransform: "uppercase", fontWeight: 500, marginBottom: 8 }}>{l}</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: G, fontFamily: "'DM Mono',monospace", marginBottom: 4 }}>{v}</div>
                  <div style={{ fontSize: 11, color: TEXT }}>Benchmark: {b}</div>
                </div>
              ))}
            </div>
            <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "22px 24px" }}>
                <SH title="Deal Pipeline Funnel" />
                {([["New Leads", m.tnl], ["Net Leads", m.tnet], ["Offers Made", m.toff], ["Contracts", m.tcon], ["Closed Deals", m.deals]] as [string, number][]).map(([l, v], i) => {
                  const w = m.tnl > 0 ? Math.max((v / m.tnl) * 100, 2) : 2;
                  const ops = Math.round((1 - i * 0.15) * 255).toString(16).padStart(2, "0");
                  return (
                    <div key={l} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                      <div style={{ width: 110, fontSize: 12, color: TEXT, textAlign: "right", flexShrink: 0 }}>{l}</div>
                      <div style={{ flex: 1, height: 32, background: S3, borderRadius: 7, overflow: "hidden" }}>
                        <div style={{ width: w + "%", height: "100%", background: G + ops, borderRadius: 7, display: "flex", alignItems: "center", paddingLeft: 10 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(0,0,0,0.8)" }}>{fmtN(v)}</span>
                        </div>
                      </div>
                      <div style={{ width: 38, fontSize: 12, color: T3, fontFamily: "'DM Mono',monospace", textAlign: "right" }}>{w.toFixed(0)}%</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "22px 24px" }}>
                <SH title="Conversion Rates" />
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart layout="vertical" data={[{ name: "Lead to Net Lead", value: m.l2n }, { name: "Net Lead to Offer", value: m.nl2o }, { name: "Offer to Contract", value: m.o2c }, { name: "Net Lead to Contract", value: m.nl2c }, { name: "Contract to Close", value: m.c2cl }]} margin={{ left: 0, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={B1} horizontal={false} />
                    <XAxis type="number" tick={{ fill: T3, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v.toFixed(0) + "%"} domain={[0, 100]} />
                    <YAxis type="category" dataKey="name" tick={{ fill: "#c4cac4", fontSize: 12 }} axisLine={false} tickLine={false} width={82} />
                    <Tooltip contentStyle={{ background: S2, border: "1px solid " + B2, borderRadius: 8, fontSize: 12 }} formatter={(v: any) => [v.toFixed(1) + "%"]} />
                    <Bar dataKey="value" fill={G} radius={[0, 6, 6, 0]} background={{ fill: S3, radius: 6 }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="grid-5" style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12 }}>
              <StatCard label="Avg Cost Per Lead" value={fmt$(m.cpl)} sub="spend / new leads" />
              <StatCard label="Avg Cost Per Net Lead" value={fmt$(m.cpnl)} sub="spend / net leads" />
              <StatCard label="Avg Cost Per Offer" value={fmt$(m.cpOff)} sub="spend / offers" />
              <StatCard label="Avg Cost Per Contract" value={fmt$(m.cpCon)} sub="spend / contracts" />
              <StatCard label="Avg Cost Per Deal" value={fmt$(m.cpDeal)} sub="spend / closed deals" />
            </div>
          </div>
        )}

        {/* TEAM - gated by team_enabled */}
        {tab === "team" && (
          <div className="tab-content">
            {e && !e.team_enabled ? (
              <LockedFeature
                title="Sales Team Performance"
                icon="👥"
                description="Track individual rep performance, conversion rates, and team totals. See who's crushing it and who needs coaching."
              />
            ) : (inp.reps || []).length === 0 ? (
              <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "40px 24px", textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>👥</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: TEXT, marginBottom: 6 }}>No sales team data yet</div>
                <div style={{ fontSize: 13, color: TEXT }}>Open Data Entry and add reps to start tracking team performance.</div>
              </div>
            ) : (
              <>
                {/* Team Summary Cards */}
                {teamTotals && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 20 }}>
                    <HeroCard label="Team Revenue" value={fmt$(teamTotals.revenueGenerated)} accent />
                    <HeroCard label="Total Calls" value={fmtN(teamTotals.callsMade)} sub={fmtN(teamTotals.talkTimeMinutes) + " min talk time"} />
                    <HeroCard label="Team Deals" value={fmtN(teamTotals.dealsClosed)} sub={fmtN(teamTotals.contractsSigned) + " contracts"} />
                    <HeroCard label="Contact Rate" value={fmtPct(teamTotals.contactRate)} sub={"Offer: " + fmtPct(teamTotals.offerRate) + " | Close: " + fmtPct(teamTotals.closeRate)} />
                  </div>
                )}

                {/* Rep Performance Table */}
                <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "22px 24px", marginBottom: 20 }}>
                  <SH title="Sales Rep Performance" right={<span style={{ fontSize: 12, color: T3 }}>{inp.reps.length} rep{inp.reps.length !== 1 ? "s" : ""}</span>} />
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>{["Rep", "Calls", "Talk Time", "Leads", "Contacted", "Contact %", "Offers", "Offer %", "Contracts", "Close %", "Deals", "Revenue"].map(h => (
                          <th key={h} style={{ textAlign: h === "Rep" ? "left" : "right", padding: "10px 12px", fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: .6, borderBottom: "1px solid " + B1, fontWeight: 500 }}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {inp.reps.map(rep => {
                          const rm = calcRepMetrics(rep);
                          return (
                            <tr key={rep.id} style={{ borderBottom: "1px solid " + B1 }}>
                              <td style={{ padding: "12px", fontSize: 13, fontWeight: 600, color: TEXT }}>{rep.name || "Unnamed"}</td>
                              <td style={{ padding: "12px", fontSize: 13, color: TEXT, fontFamily: "'DM Mono',monospace", textAlign: "right" }}>{fmtN(rep.callsMade)}</td>
                              <td style={{ padding: "12px", fontSize: 13, color: TEXT, fontFamily: "'DM Mono',monospace", textAlign: "right" }}>{fmtN(rep.talkTimeMinutes)} min</td>
                              <td style={{ padding: "12px", fontSize: 13, color: TEXT, fontFamily: "'DM Mono',monospace", textAlign: "right" }}>{fmtN(rep.leadsAssigned)}</td>
                              <td style={{ padding: "12px", fontSize: 13, color: TEXT, fontFamily: "'DM Mono',monospace", textAlign: "right" }}>{fmtN(rep.leadsContacted)}</td>
                              <td style={{ padding: "12px", fontSize: 13, fontFamily: "'DM Mono',monospace", textAlign: "right", color: rm.contactRate >= 60 ? G : rm.contactRate >= 40 ? AMBER : RED }}>{fmtPct(rm.contactRate)}</td>
                              <td style={{ padding: "12px", fontSize: 13, color: TEXT, fontFamily: "'DM Mono',monospace", textAlign: "right" }}>{fmtN(rep.offersMade)}</td>
                              <td style={{ padding: "12px", fontSize: 13, fontFamily: "'DM Mono',monospace", textAlign: "right", color: rm.offerRate >= 30 ? G : rm.offerRate >= 20 ? AMBER : RED }}>{fmtPct(rm.offerRate)}</td>
                              <td style={{ padding: "12px", fontSize: 13, color: TEXT, fontFamily: "'DM Mono',monospace", textAlign: "right" }}>{fmtN(rep.contractsSigned)}</td>
                              <td style={{ padding: "12px", fontSize: 13, fontFamily: "'DM Mono',monospace", textAlign: "right", color: rm.closeRate >= 25 ? G : rm.closeRate >= 15 ? AMBER : RED }}>{fmtPct(rm.closeRate)}</td>
                              <td style={{ padding: "12px", fontSize: 13, color: TEXT, fontFamily: "'DM Mono',monospace", textAlign: "right" }}>{fmtN(rep.dealsClosed)}</td>
                              <td style={{ padding: "12px", fontSize: 13, color: G, fontFamily: "'DM Mono',monospace", fontWeight: 600, textAlign: "right" }}>{fmt$(rep.revenueGenerated)}</td>
                            </tr>
                          );
                        })}
                        {/* Team Totals Row */}
                        {teamTotals && (
                          <tr style={{ borderTop: "2px solid " + G + "30", background: G + "08" }}>
                            <td style={{ padding: "12px", fontSize: 13, fontWeight: 700, color: G }}>Team Total</td>
                            <td style={{ padding: "12px", fontSize: 13, color: G, fontFamily: "'DM Mono',monospace", fontWeight: 600, textAlign: "right" }}>{fmtN(teamTotals.callsMade)}</td>
                            <td style={{ padding: "12px", fontSize: 13, color: G, fontFamily: "'DM Mono',monospace", fontWeight: 600, textAlign: "right" }}>{fmtN(teamTotals.talkTimeMinutes)} min</td>
                            <td style={{ padding: "12px", fontSize: 13, color: G, fontFamily: "'DM Mono',monospace", fontWeight: 600, textAlign: "right" }}>{fmtN(teamTotals.leadsAssigned)}</td>
                            <td style={{ padding: "12px", fontSize: 13, color: G, fontFamily: "'DM Mono',monospace", fontWeight: 600, textAlign: "right" }}>{fmtN(teamTotals.leadsContacted)}</td>
                            <td style={{ padding: "12px", fontSize: 13, color: G, fontFamily: "'DM Mono',monospace", fontWeight: 600, textAlign: "right" }}>{fmtPct(teamTotals.contactRate)}</td>
                            <td style={{ padding: "12px", fontSize: 13, color: G, fontFamily: "'DM Mono',monospace", fontWeight: 600, textAlign: "right" }}>{fmtN(teamTotals.offersMade)}</td>
                            <td style={{ padding: "12px", fontSize: 13, color: G, fontFamily: "'DM Mono',monospace", fontWeight: 600, textAlign: "right" }}>{fmtPct(teamTotals.offerRate)}</td>
                            <td style={{ padding: "12px", fontSize: 13, color: G, fontFamily: "'DM Mono',monospace", fontWeight: 600, textAlign: "right" }}>{fmtN(teamTotals.contractsSigned)}</td>
                            <td style={{ padding: "12px", fontSize: 13, color: G, fontFamily: "'DM Mono',monospace", fontWeight: 600, textAlign: "right" }}>{fmtPct(teamTotals.closeRate)}</td>
                            <td style={{ padding: "12px", fontSize: 13, color: G, fontFamily: "'DM Mono',monospace", fontWeight: 600, textAlign: "right" }}>{fmtN(teamTotals.dealsClosed)}</td>
                            <td style={{ padding: "12px", fontSize: 13, color: G, fontFamily: "'DM Mono',monospace", fontWeight: 700, textAlign: "right" }}>{fmt$(teamTotals.revenueGenerated)}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Rep Revenue Bar Chart */}
                <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "22px 24px" }}>
                  <SH title="Revenue by Rep" />
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={inp.reps.map(r => ({ name: r.name || "Unnamed", Revenue: r.revenueGenerated, Deals: r.dealsClosed }))} barCategoryGap="28%">
                      <CartesianGrid strokeDasharray="3 3" stroke={B1} vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: T3, fontSize: 13 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: T3, fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={fmtK} width={48} />
                      <Tooltip content={<CTip money />} />
                      <Bar dataKey="Revenue" fill={G} radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>
        )}

        {/* HISTORY - gated by history_enabled */}
        {tab === "history" && (
          <div className="tab-content">
            {e && !e.history_enabled ? (
              <LockedFeature
                title="Historical Performance"
                icon="📊"
                description="Track your business performance over time with trend charts and monthly comparison tables."
              />
            ) : chartData.length === 0 ? (
              <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "40px 24px", textAlign: "center", marginBottom: 20 }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: TEXT, marginBottom: 6 }}>No historical data yet</div>
                <div style={{ fontSize: 13, color: TEXT }}>Enter data for each month and click Save to build history.</div>
              </div>
            ) : (
              <>
                <div className="grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 20 }}>
                  {[{ title: "Revenue", key: "revenue", color: G, fmt: fmtK }, { title: "Spend", key: "spend", color: AMBER, fmt: fmtK }, { title: "Contracts", key: "contracts", color: PURPLE, fmt: fmtN }].map(c => (
                    <div key={c.key} style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "20px 22px" }}>
                      <SH title={c.title} />
                      <ResponsiveContainer width="100%" height={120}>
                        <AreaChart data={chartData}>
                          <defs>
                            <linearGradient id={"hg" + c.key} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={c.color} stopOpacity={.22} /><stop offset="100%" stopColor={c.color} stopOpacity={0} /></linearGradient>
                          </defs>
                          <XAxis dataKey="month" tick={{ fill: T3, fontSize: 11 }} axisLine={false} tickLine={false} />
                          <YAxis hide />
                          <Tooltip contentStyle={{ background: S2, border: "1px solid " + B2, borderRadius: 8, fontSize: 12 }} formatter={(v: any) => [c.fmt(v)]} />
                          <Area type="monotone" dataKey={c.key} stroke={c.color} strokeWidth={2.5} fill={"url(#hg" + c.key + ")"} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ))}
                </div>
                <div className="history-table-wrap" style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "22px 24px" }}>
                  <SH title="Monthly Performance Table" right={<span style={{ fontSize: 12, color: T3 }}>{chartData.length} periods</span>} />
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>{["Period", "Revenue", "Spend", "Profit", "Contracts", "Deals", "Mktg ROI", "Margin"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "10px 14px", fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: .6, borderBottom: "1px solid " + B1, fontWeight: 500 }}>{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {[...chartData].reverse().map((row: any, i: number) => (
                        <tr key={i} style={{ borderBottom: "1px solid " + B1 }}>
                          <td style={{ padding: "12px 14px", fontSize: 13, fontWeight: 600, color: TEXT }}>{row.month}</td>
                          <td style={{ padding: "12px 14px", fontSize: 13, color: G, fontFamily: "'DM Mono',monospace", fontWeight: 600 }}>{fmt$(row.revenue)}</td>
                          <td style={{ padding: "12px 14px", fontSize: 13, color: TEXT, fontFamily: "'DM Mono',monospace" }}>{fmt$(row.spend)}</td>
                          <td style={{ padding: "12px 14px", fontSize: 13, color: TEXT, fontFamily: "'DM Mono',monospace" }}>{fmt$(row.profit)}</td>
                          <td style={{ padding: "12px 14px", fontSize: 13, color: TEXT, fontFamily: "'DM Mono',monospace" }}>{row.contracts}</td>
                          <td style={{ padding: "12px 14px", fontSize: 13, color: TEXT, fontFamily: "'DM Mono',monospace" }}>{fmtN(row.deals)}</td>
                          <td style={{ padding: "12px 14px" }}>
                            <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'DM Mono',monospace", color: (row.mROI || 0) >= 5 ? G : (row.mROI || 0) >= 3 ? AMBER : RED, background: (row.mROI || 0) >= 5 ? G + "12" : (row.mROI || 0) >= 3 ? AMBER + "12" : RED + "12", padding: "2px 8px", borderRadius: 5 }}>{fmtRx(row.mROI || 0)}</span>
                          </td>
                          <td style={{ padding: "12px 14px" }}>
                            <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'DM Mono',monospace", color: row.margin >= 30 ? G : row.margin >= 20 ? AMBER : RED, background: row.margin >= 30 ? G + "12" : row.margin >= 20 ? AMBER + "12" : RED + "12", padding: "2px 8px", borderRadius: 5 }}>{fmtPct(row.margin)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* AI INTELLIGENCE */}
        {(!ent.data || ent.data.ai_enabled) && chatExpanded && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, background: BG, display: "flex", flexDirection: "column" }}>
            <div className="ai-chat-expanded-header" style={{ padding: "14px 22px", borderBottom: "1px solid " + B1, display: "flex", alignItems: "center", gap: 10, background: S1, flexShrink: 0 }}>
              <span style={{ fontSize: 18 }}>{AGENTS[activeAgent].icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: AGENTS[activeAgent].color }}>{AGENTS[activeAgent].label} AI</div>
                <div style={{ fontSize: 11, color: TEXT }}>{AGENTS[activeAgent].tagline}</div>
              </div>
              <div className="ai-chat-expanded-agents" style={{ display: "flex", gap: 6, marginRight: 12 }}>
                {Object.entries(AGENTS).map(([k, a]) => (
                  <button key={k} onClick={() => setAgent(k)} style={{ background: activeAgent === k ? a.color + "12" : "transparent", border: "1px solid " + (activeAgent === k ? a.color + "40" : B1), borderRadius: 8, padding: "5px 12px", color: activeAgent === k ? a.color : T3, fontSize: 12, fontWeight: activeAgent === k ? 600 : 400, cursor: "pointer", fontFamily: "inherit" }}>
                    <span style={{ fontSize: 13 }}>{a.icon}</span> {a.label}
                  </button>
                ))}
              </div>
              <button onClick={() => setChatExpanded(false)} style={{ background: S3, border: "1px solid " + B2, borderRadius: 8, padding: "6px 14px", color: TEXT, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>✕ Close</button>
            </div>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <AgentChat key={activeAgent + "-expanded"} agentKey={activeAgent} m={m} inp={inp} period={periodLabel(activePeriod.month, activePeriod.year)} expanded onToggleExpand={() => setChatExpanded(false)} orgId={effectiveOrgId} historicalContext={historicalContext} />
            </div>
          </div>
        )}

        {(!ent.data || ent.data.ai_enabled) && !chatExpanded && (
        <div style={{ marginTop: 32, borderTop: "1px solid " + B1, paddingTop: 28 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 3, height: 18, background: G, borderRadius: 2 }} />
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>AI Intelligence Layer</div>
                <div style={{ fontSize: 12, color: TEXT, marginTop: 1 }}>Three specialized agents trained on your data</div>
              </div>
            </div>
            <div className="ai-agent-tabs" style={{ display: "flex", gap: 6 }}>
              {Object.entries(AGENTS).map(([k, a]) => (
                <button key={k} onClick={() => setAgent(k)} style={{ background: activeAgent === k ? a.color + "12" : S1, border: "1px solid " + (activeAgent === k ? a.color + "40" : B1), borderRadius: 10, padding: "8px 18px", color: activeAgent === k ? a.color : T3, fontSize: 13, fontWeight: activeAgent === k ? 600 : 400, cursor: "pointer", fontFamily: "inherit", transition: "all .15s", display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontSize: 15 }}>{a.icon}</span>
                  <span>{a.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, height: 420, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "14px 22px", borderBottom: "1px solid " + B1, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18 }}>{AGENTS[activeAgent].icon}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: AGENTS[activeAgent].color }}>{AGENTS[activeAgent].label} AI</div>
                <div style={{ fontSize: 11, color: TEXT }}>{AGENTS[activeAgent].tagline}</div>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: G, boxShadow: "0 0 6px " + G }} />
                  <span style={{ fontSize: 11, color: TEXT }}>Live · AI Powered</span>
                </div>
                <button onClick={() => setChatExpanded(true)} style={{ background: S3, border: "1px solid " + B2, borderRadius: 7, padding: "4px 10px", color: T2, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }} title="Expand chat">⛶ Expand</button>
              </div>
            </div>
            <AgentChat key={activeAgent} agentKey={activeAgent} m={m} inp={inp} period={periodLabel(activePeriod.month, activePeriod.year)} expanded={false} onToggleExpand={() => setChatExpanded(true)} orgId={effectiveOrgId} historicalContext={historicalContext} />
          </div>
        </div>
        )}

        {ent.data && !ent.data.ai_enabled && (
          <div style={{ marginTop: 32, borderTop: "1px solid " + B1, paddingTop: 28 }}>
            <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "32px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>🤖</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: T2 }}>AI Intelligence Layer is not available on your current plan</div>
              <div style={{ fontSize: 13, color: T3, marginTop: 6 }}>Contact support to upgrade your subscription.</div>
            </div>
          </div>
        )}

        {/* RED ZONE */}
        <RedZone alerts={alerts} />
      </main>
    </div>
  );
}
