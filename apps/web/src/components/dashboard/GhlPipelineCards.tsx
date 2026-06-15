// Replacement for the Channels tab when GHL data is present.
// Reads kpi_periods.data.ghl_channel (the shape ghl_sync_finalize writes)
// and renders one card per pipeline + a global stage rollup.
//
// Drops the manual Cold Calling / Direct Mail / PPC placeholders that have
// always been $0 for clients that don't enter them by hand.

import { S1, S2, S3, B1, TEXT, T2, T3, G, AMBER } from "@/shared/kpi";

interface StageTotal {
  stage_name: string;
  count: number;
  pipelines: number;
}
interface PipelineBreakdown {
  pipeline_id: string;
  pipeline_name: string;
  total: number;
  spend?: number;
  by_stage: Record<string, number>;
}
export interface GhlChannelData {
  total_opportunities: number;
  total_spend: number;
  selected_pipelines: string[];
  stage_totals: StageTotal[];
  pipeline_breakdown: PipelineBreakdown[];
  computed_at?: string;
}

const fmtNum = (n: number) => Number(n || 0).toLocaleString();
const fmt$   = (n: number) => "$" + Number(n || 0).toLocaleString();

export default function GhlPipelineCards({ data }: { data: GhlChannelData }) {
  const totalOpps = data.total_opportunities || 0;
  const totalSpend = data.total_spend || 0;
  const pipelines = data.pipeline_breakdown || [];
  const stageTotals = data.stage_totals || [];

  return (
    <>
      {/* ─── Top: aggregate numbers + computed_at ─── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>
          GoHighLevel · {pipelines.length} pipeline{pipelines.length === 1 ? "" : "s"} · {fmtNum(totalOpps)} opportunities
        </div>
        {data.computed_at && (
          <div style={{ fontSize: 11, color: T3 }}>
            synced {new Date(data.computed_at).toLocaleString()}
          </div>
        )}
      </div>

      {/* ─── Global stage rollup (summed across all selected pipelines) ─── */}
      {stageTotals.length > 0 && (
        <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "22px 24px", marginBottom: 18 }}>
          <div style={{ fontSize: 11, color: T3, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 12 }}>
            Stage rollup — counts summed across all selected pipelines
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
            {stageTotals.map((s) => (
              <div key={s.stage_name} style={{ background: S2, borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 12, color: T2, marginBottom: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={s.stage_name}>
                  {s.stage_name}
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: G, fontFamily: "'DM Mono', monospace" }}>
                  {fmtNum(s.count)}
                </div>
                {s.pipelines > 1 && (
                  <div style={{ fontSize: 10, color: T3, marginTop: 2 }}>
                    across {s.pipelines} pipelines
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Per-pipeline cards ─── */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(pipelines.length, 3) || 1}, 1fr)`, gap: 16, marginBottom: 20 }}>
        {pipelines.map((pb) => {
          const stages = Object.entries(pb.by_stage || {}).sort((a, b) => b[1] - a[1]);
          const max = stages.length ? stages[0][1] : 0;
          return (
            <div key={pb.pipeline_id} style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "22px 22px", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg," + G + "60,transparent)" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={pb.pipeline_name}>
                    {pb.pipeline_name}
                  </div>
                  <div style={{ fontSize: 12, color: TEXT }}>
                    Spend: <span style={{ color: TEXT, fontFamily: "'DM Mono', monospace" }}>{fmt$(pb.spend || 0)}</span>
                  </div>
                </div>
                <div style={{ background: G + "15", border: "1px solid " + G + "30", borderRadius: 8, padding: "5px 12px", textAlign: "center", marginLeft: 10 }}>
                  <div style={{ fontSize: 10, color: T3, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 2 }}>
                    Opps
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: G, fontFamily: "'DM Mono', monospace" }}>
                    {fmtNum(pb.total)}
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 11, color: T3, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>
                Stages
              </div>
              {stages.length === 0 && (
                <div style={{ fontSize: 12, color: T3, fontStyle: "italic" }}>(no opportunities in this pipeline yet)</div>
              )}
              {stages.map(([stageName, count]) => {
                const w = max > 0 ? Math.max((count / max) * 100, 4) : 4;
                return (
                  <div key={stageName} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                    <div style={{ width: 110, fontSize: 11, color: TEXT, textAlign: "right", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={stageName}>
                      {stageName}
                    </div>
                    <div style={{ flex: 1, height: 22, background: S3, borderRadius: 5, overflow: "hidden" }}>
                      <div style={{ width: w + "%", height: "100%", borderRadius: 5, background: G + "a0", display: "flex", alignItems: "center", paddingLeft: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(0,0,0,0.8)" }}>{count}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* ─── Footer: bottom stats ─── */}
      <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "16px 24px", display: "flex", gap: 28, fontSize: 13 }}>
        <div>
          <div style={{ fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>Total Opportunities</div>
          <div style={{ fontWeight: 700, color: TEXT, fontFamily: "'DM Mono', monospace", fontSize: 18 }}>{fmtNum(totalOpps)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>Total Spend</div>
          <div style={{ fontWeight: 700, color: AMBER, fontFamily: "'DM Mono', monospace", fontSize: 18 }}>{fmt$(totalSpend)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>Pipelines Tracked</div>
          <div style={{ fontWeight: 700, color: TEXT, fontFamily: "'DM Mono', monospace", fontSize: 18 }}>{pipelines.length}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>Distinct Stages</div>
          <div style={{ fontWeight: 700, color: TEXT, fontFamily: "'DM Mono', monospace", fontSize: 18 }}>{stageTotals.length}</div>
        </div>
      </div>
    </>
  );
}
