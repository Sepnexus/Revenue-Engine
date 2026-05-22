import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useActivityLog } from "@/hooks/useActivityLog";
import { useKPIPeriods } from "@/hooks/useKPIPeriods";
import { G, BG, S1, S2, S3, B1, B2, TEXT, T2, T3, RED, AMBER } from "@/shared/kpi";
import { calc, periodLabel, type KPIData } from "@/shared/kpi";
import closerControlLogo from "@/assets/closer-control-logo.png";

export default function AccountExports() {
  const { orgId, signOut } = useAuth();
  const ent = useEntitlements(orgId);
  const { logActivity } = useActivityLog(orgId);
  const { periodsMap } = useKPIPeriods(orgId);
  const [includeComputed, setIncludeComputed] = useState(true);

  const exportDisabled = ent.data && !ent.data.exports_enabled;

  const exportCSV = () => {
    if (exportDisabled) return;
    const entries = Object.entries(periodsMap);
    if (entries.length === 0) return;

    // Sort by key (year_month)
    entries.sort((a, b) => a[0].localeCompare(b[0]));

    const rawKeys = Object.keys(entries[0][1].data) as (keyof KPIData)[];
    const computedKeys = includeComputed ? ["revenue", "profit", "margin", "mROI", "bROI", "totalSpend", "totalExpenses", "deals", "cpl", "cpDeal"] : [];

    const headers = ["period", ...rawKeys, ...computedKeys];
    const rows = entries.map(([key, period]) => {
      const d = period.data as KPIData;
      const [y, m] = key.split("_");
      const label = periodLabel(Number(m), Number(y));
      const rawVals = rawKeys.map(k => String(d[k] ?? ""));

      let computedVals: string[] = [];
      if (includeComputed) {
        const c = calc(d);
        computedVals = [
          String(c.rev), String(c.profit), c.margin.toFixed(2), c.mROI.toFixed(2),
          c.bROI.toFixed(2), String(c.ts), String(c.exp), String(c.deals),
          c.cpl.toFixed(2), c.cpDeal.toFixed(2),
        ];
      }
      return [label, ...rawVals, ...computedVals];
    });

    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kpi-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    logActivity.mutate({ event_type: "csv_exported", metadata: { periods: entries.length, includeComputed } });
  };

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "'DM Sans',sans-serif", color: TEXT }}>
      <header style={{ background: S1, borderBottom: "1px solid " + B1, padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src={closerControlLogo} alt="Closer Control" style={{ height: 30 }} />
          <Link to="/app/account" style={{ color: T2, fontSize: 13, textDecoration: "none" }}>← Account</Link>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Exports</span>
        </div>
        <button onClick={signOut} style={{ background: "transparent", border: "1px solid " + B2, borderRadius: 8, padding: "6px 15px", color: T2, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Sign Out</button>
      </header>
      <main style={{ maxWidth: 600, margin: "0 auto", padding: "40px 28px" }}>
        {exportDisabled && (
          <div style={{ background: AMBER + "12", border: "1px solid " + AMBER + "30", borderRadius: 12, padding: "16px 20px", marginBottom: 24, color: AMBER, fontSize: 14 }}>
            Exports are not available on your current plan. <Link to="/app/support" style={{ color: AMBER, fontWeight: 600 }}>Contact support</Link> to upgrade.
          </div>
        )}

        <div style={{ background: S1, border: "1px solid " + B1, borderRadius: 16, padding: "24px" }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Export KPI Data</div>
          <div style={{ fontSize: 14, color: T3, marginBottom: 20 }}>
            Download all your KPI data as a CSV file. Includes all saved periods ({Object.keys(periodsMap).length} periods available).
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, cursor: "pointer" }}>
            <input type="checkbox" checked={includeComputed} onChange={e => setIncludeComputed(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: G }} />
            <span style={{ fontSize: 14, color: TEXT }}>Include computed metrics (revenue, profit, margin, mROI, etc.)</span>
          </label>

          <button onClick={exportCSV} disabled={!!exportDisabled || Object.keys(periodsMap).length === 0}
            style={{ background: exportDisabled ? S3 : G, border: "none", borderRadius: 10, padding: "12px 24px", color: exportDisabled ? T3 : "#000", fontWeight: 700, fontSize: 14, cursor: exportDisabled ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: Object.keys(periodsMap).length === 0 ? 0.5 : 1 }}>
            📥 Download CSV
          </button>

          {Object.keys(periodsMap).length === 0 && (
            <div style={{ fontSize: 13, color: T3, marginTop: 12 }}>No KPI data to export yet. Save your first period in the dashboard.</div>
          )}
        </div>
      </main>
    </div>
  );
}
