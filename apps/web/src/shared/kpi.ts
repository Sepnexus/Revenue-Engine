// ── Tokens ───────────────────────────────────────────────────
export const G      = "#47ed3d";
export const BG     = "#080a08";
export const S1     = "#0f120f";
export const S2     = "#141814";
export const S3     = "#1a1e1a";
export const B1     = "#1c201c";
export const B2     = "#232823";
export const TEXT   = "#eaeee8";
export const T2     = "#9aa09a";
export const T3     = "#525a52";
export const RED    = "#f05050";
export const AMBER  = "#f0a830";
export const PURPLE = "#8b7cf8";

// ── Formatters ───────────────────────────────────────────────
export const fmt$   = (v: number) => "$" + Math.round(v).toLocaleString();
export const fmtK   = (v: number) => "$" + (v / 1000).toFixed(0) + "k";
export const fmtPct = (v: number) => Number(v).toFixed(1) + "%";
export const fmtN   = (v: number) => Math.round(v).toLocaleString();
export const fmtRx  = (v: number) => Number(v).toFixed(2) + "x";

// ── Period helpers ───────────────────────────────────────────
export const MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const periodLabel = (m: number, y: number) => MN[m] + " " + y;
export const periodKey   = (m: number, y: number) => y + "_" + String(m).padStart(2, "0");
export const nowPeriod   = () => { const d = new Date(); return { month: d.getMonth(), year: d.getFullYear() }; };
export const isPast      = (m: number, y: number) => { const n = new Date(); return new Date(y, m, 1) < new Date(n.getFullYear(), n.getMonth(), 1); };
export const isCurrent   = (m: number, y: number) => { const n = new Date(); return m === n.getMonth() && y === n.getFullYear(); };
export const getLast12   = () => { const r: { month: number; year: number }[] = []; const n = new Date(); for (let i = 11; i >= 0; i--) { const d = new Date(n.getFullYear(), n.getMonth() - i, 1); r.push({ month: d.getMonth(), year: d.getFullYear() }); } return r; };

// ── Channel type ─────────────────────────────────────────────
export interface Channel {
  name: string;
  spend: number;
  newLeads: number;
  netLeads: number;
  offers: number;
  contracts: number;
  closedRevenue: number;
  closedDeals: number;
}

export const EMPTY_CHANNEL: Channel = {
  name: "", spend: 0, newLeads: 0, netLeads: 0, offers: 0, contracts: 0, closedRevenue: 0, closedDeals: 0,
};

export const DEFAULT_CHANNELS: Channel[] = [
  { name: "Cold Calling", spend: 0, newLeads: 0, netLeads: 0, offers: 0, contracts: 0, closedRevenue: 0, closedDeals: 0 },
  { name: "Direct Mail", spend: 0, newLeads: 0, netLeads: 0, offers: 0, contracts: 0, closedRevenue: 0, closedDeals: 0 },
  { name: "PPC / Google", spend: 0, newLeads: 0, netLeads: 0, offers: 0, contracts: 0, closedRevenue: 0, closedDeals: 0 },
];

// ── Sales Rep type ───────────────────────────────────────────
export interface SalesRep {
  id: number;
  name: string;
  callsMade: number;
  talkTimeMinutes: number;
  leadsAssigned: number;
  leadsContacted: number;
  offersMade: number;
  contractsSigned: number;
  dealsClosed: number;
  revenueGenerated: number;
}

// Legacy RepData alias
export interface RepData {
  id: number; name: string; calls: number; talkTime: number; offers: number; contracts: number; revenue: number;
}

export const DEFAULT_REPS: RepData[] = [
  { id: 1, name: "Marcus D.", calls: 180, talkTime: 520, offers: 12, contracts: 5, revenue: 62000 },
  { id: 2, name: "Jada R.",   calls: 210, talkTime: 680, offers: 15, contracts: 6, revenue: 74000 },
  { id: 3, name: "Tyler K.",  calls: 150, talkTime: 390, offers: 8,  contracts: 3, revenue: 36000 },
];

// ── KPI Data type ────────────────────────────────────────────
export interface KPIData {
  companyName: string;

  // Dynamic channels array
  channels: Channel[];

  // Legacy channel fields (kept for backward compat with existing DB data)
  m1Name: string; m1Spend: number; m1NewLeads: number; m1NetLeads: number; m1Offers: number; m1Contracts: number; m1ClosedRevenue: number; m1ClosedDeals: number;
  m2Name: string; m2Spend: number; m2NewLeads: number; m2NetLeads: number; m2Offers: number; m2Contracts: number; m2ClosedRevenue: number; m2ClosedDeals: number;
  m3Name: string; m3Spend: number; m3NewLeads: number; m3NetLeads: number; m3Offers: number; m3Contracts: number; m3ClosedRevenue: number; m3ClosedDeals: number;
  totalACQCalls: number; totalACQTalkTime: number;

  // Legacy expense fields (kept for backward compat)
  acqCommission: number; dispoCommission: number; baseSalaries: number; systemsSoftware: number; propertyExp: number;
  avgAssignmentFee: number;

  // Sales Team Reps
  reps: SalesRep[];

  // Financial Statement - COGS
  cogsDealPartnerSplits: number;
  cogsDispositionFees: number;
  cogsClosingCosts: number;

  // Financial Statement - Labor
  laborAcquisitionTeam: number;
  laborSalesCommissions: number;
  laborVirtualAssistants: number;
  laborLegalFees: number;

  // Financial Statement - Marketing (channel spend is separate, these are additional)
  mktgPPC: number;
  mktgSMS: number;
  mktgColdCalling: number;
  mktgDirectMail: number;
  mktgLeadProviders: number;

  // Financial Statement - Software
  softwareCloserControl: number;
  softwareOther: number;

  // Financial Statement - Accounting
  accountingBookkeeping: number;
  accountingCPA: number;
}

// ── Zero data (for new clients) ──────────────────────────────
export const ZERO_DATA: KPIData = {
  companyName: "",
  channels: [
    { name: "Cold Calling", spend: 0, newLeads: 0, netLeads: 0, offers: 0, contracts: 0, closedRevenue: 0, closedDeals: 0 },
    { name: "Direct Mail", spend: 0, newLeads: 0, netLeads: 0, offers: 0, contracts: 0, closedRevenue: 0, closedDeals: 0 },
    { name: "PPC / Google", spend: 0, newLeads: 0, netLeads: 0, offers: 0, contracts: 0, closedRevenue: 0, closedDeals: 0 },
  ],
  m1Name: "Cold Calling", m1Spend: 0, m1NewLeads: 0, m1NetLeads: 0, m1Offers: 0, m1Contracts: 0, m1ClosedRevenue: 0, m1ClosedDeals: 0,
  m2Name: "Direct Mail",  m2Spend: 0, m2NewLeads: 0, m2NetLeads: 0, m2Offers: 0, m2Contracts: 0, m2ClosedRevenue: 0, m2ClosedDeals: 0,
  m3Name: "PPC / Google", m3Spend: 0, m3NewLeads: 0, m3NetLeads: 0, m3Offers: 0, m3Contracts: 0, m3ClosedRevenue: 0, m3ClosedDeals: 0,
  totalACQCalls: 0, totalACQTalkTime: 0,
  acqCommission: 0, dispoCommission: 0, baseSalaries: 0, systemsSoftware: 0, propertyExp: 0,
  avgAssignmentFee: 0,
  reps: [],
  cogsDealPartnerSplits: 0, cogsDispositionFees: 0, cogsClosingCosts: 0,
  laborAcquisitionTeam: 0, laborSalesCommissions: 0, laborVirtualAssistants: 0, laborLegalFees: 0,
  mktgPPC: 0, mktgSMS: 0, mktgColdCalling: 0, mktgDirectMail: 0, mktgLeadProviders: 0,
  softwareCloserControl: 0, softwareOther: 0,
  accountingBookkeeping: 0, accountingCPA: 0,
};

// ── Default data (sample) ────────────────────────────────────
export const DEFAULTS: KPIData = {
  companyName: "Apex Wholesale Group",
  channels: [
    { name: "Cold Calling", spend: 4500, newLeads: 85, netLeads: 60, offers: 22, contracts: 8, closedRevenue: 96000, closedDeals: 4 },
    { name: "Direct Mail", spend: 3200, newLeads: 62, netLeads: 44, offers: 18, contracts: 6, closedRevenue: 72000, closedDeals: 3 },
    { name: "PPC / Google", spend: 2100, newLeads: 40, netLeads: 28, offers: 11, contracts: 4, closedRevenue: 48000, closedDeals: 2 },
  ],
  m1Name: "Cold Calling", m1Spend: 4500,  m1NewLeads: 85, m1NetLeads: 60, m1Offers: 22, m1Contracts: 8,  m1ClosedRevenue: 96000, m1ClosedDeals: 4,
  m2Name: "Direct Mail",  m2Spend: 3200,  m2NewLeads: 62, m2NetLeads: 44, m2Offers: 18, m2Contracts: 6,  m2ClosedRevenue: 72000, m2ClosedDeals: 3,
  m3Name: "PPC / Google", m3Spend: 2100,  m3NewLeads: 40, m3NetLeads: 28, m3Offers: 11, m3Contracts: 4,  m3ClosedRevenue: 48000, m3ClosedDeals: 2,
  totalACQCalls: 450, totalACQTalkTime: 1200,
  acqCommission: 8500, dispoCommission: 4200, baseSalaries: 12000, systemsSoftware: 1800, propertyExp: 600,
  avgAssignmentFee: 24000,
  reps: [
    { id: 1, name: "Marcus D.", callsMade: 180, talkTimeMinutes: 520, leadsAssigned: 30, leadsContacted: 22, offersMade: 12, contractsSigned: 5, dealsClosed: 3, revenueGenerated: 62000 },
    { id: 2, name: "Jada R.", callsMade: 210, talkTimeMinutes: 680, leadsAssigned: 35, leadsContacted: 28, offersMade: 15, contractsSigned: 6, dealsClosed: 4, revenueGenerated: 74000 },
    { id: 3, name: "Tyler K.", callsMade: 150, talkTimeMinutes: 390, leadsAssigned: 22, leadsContacted: 15, offersMade: 8, contractsSigned: 3, dealsClosed: 2, revenueGenerated: 36000 },
  ],
  cogsDealPartnerSplits: 5000, cogsDispositionFees: 4200, cogsClosingCosts: 3000,
  laborAcquisitionTeam: 8500, laborSalesCommissions: 6000, laborVirtualAssistants: 2500, laborLegalFees: 1200,
  mktgPPC: 2100, mktgSMS: 800, mktgColdCalling: 4500, mktgDirectMail: 3200, mktgLeadProviders: 1500,
  softwareCloserControl: 500, softwareOther: 1300,
  accountingBookkeeping: 400, accountingCPA: 300,
};

export interface HistoryRow {
  month: string; revenue: number; spend: number; profit: number; contracts: number; leads: number; deals: number; mROI: number; margin: number;
}

export const SAMPLE_HISTORY: HistoryRow[] = [
  { month: "Aug 2024", revenue: 188000, spend: 8200,  profit: 49000, contracts: 7,  leads: 160, deals: 7,  mROI: 22.9, margin: 26.1 },
  { month: "Sep 2024", revenue: 200000, spend: 8550,  profit: 55000, contracts: 8,  leads: 169, deals: 8,  mROI: 23.4, margin: 27.5 },
  { month: "Oct 2024", revenue: 224000, spend: 8900,  profit: 63000, contracts: 9,  leads: 178, deals: 9,  mROI: 25.2, margin: 28.1 },
  { month: "Nov 2024", revenue: 212000, spend: 9250,  profit: 58000, contracts: 10, leads: 187, deals: 10, mROI: 22.9, margin: 27.4 },
  { month: "Dec 2024", revenue: 240000, spend: 9600,  profit: 71000, contracts: 11, leads: 196, deals: 11, mROI: 25.0, margin: 29.6 },
  { month: "Jan 2025", revenue: 216000, spend: 9800,  profit: 62000, contracts: 12, leads: 205, deals: 9,  mROI: 22.0, margin: 28.7 },
];

// ── Helper: get channels from KPIData (handles legacy data) ──
export function getChannels(d: KPIData): Channel[] {
  if (d.channels && d.channels.length > 0) return d.channels;
  // Legacy fallback: build from m1/m2/m3
  return [
    { name: d.m1Name || "Channel 1", spend: d.m1Spend || 0, newLeads: d.m1NewLeads || 0, netLeads: d.m1NetLeads || 0, offers: d.m1Offers || 0, contracts: d.m1Contracts || 0, closedRevenue: d.m1ClosedRevenue || 0, closedDeals: d.m1ClosedDeals || 0 },
    { name: d.m2Name || "Channel 2", spend: d.m2Spend || 0, newLeads: d.m2NewLeads || 0, netLeads: d.m2NetLeads || 0, offers: d.m2Offers || 0, contracts: d.m2Contracts || 0, closedRevenue: d.m2ClosedRevenue || 0, closedDeals: d.m2ClosedDeals || 0 },
    { name: d.m3Name || "Channel 3", spend: d.m3Spend || 0, newLeads: d.m3NewLeads || 0, netLeads: d.m3NetLeads || 0, offers: d.m3Offers || 0, contracts: d.m3Contracts || 0, closedRevenue: d.m3ClosedRevenue || 0, closedDeals: d.m3ClosedDeals || 0 },
  ].filter(ch => ch.name || ch.spend > 0 || ch.newLeads > 0 || ch.closedRevenue > 0);
}

// ── Sync channels back to legacy fields (for DB compat) ──────
export function syncChannelsToLegacy(d: KPIData): KPIData {
  const chs = d.channels || [];
  const c = (i: number) => chs[i] || { name: "", spend: 0, newLeads: 0, netLeads: 0, offers: 0, contracts: 0, closedRevenue: 0, closedDeals: 0 };
  return {
    ...d,
    m1Name: c(0).name, m1Spend: c(0).spend, m1NewLeads: c(0).newLeads, m1NetLeads: c(0).netLeads, m1Offers: c(0).offers, m1Contracts: c(0).contracts, m1ClosedRevenue: c(0).closedRevenue, m1ClosedDeals: c(0).closedDeals,
    m2Name: c(1).name, m2Spend: c(1).spend, m2NewLeads: c(1).newLeads, m2NetLeads: c(1).netLeads, m2Offers: c(1).offers, m2Contracts: c(1).contracts, m2ClosedRevenue: c(1).closedRevenue, m2ClosedDeals: c(1).closedDeals,
    m3Name: c(2).name, m3Spend: c(2).spend, m3NewLeads: c(2).newLeads, m3NetLeads: c(2).netLeads, m3Offers: c(2).offers, m3Contracts: c(2).contracts, m3ClosedRevenue: c(2).closedRevenue, m3ClosedDeals: c(2).closedDeals,
  };
}

// ── Normalize helper (backward compat) ───────────────────────
export function normalizeKPIData(raw: any): KPIData {
  const base = {
    ...ZERO_DATA,
    ...raw,
    reps: Array.isArray(raw?.reps) ? raw.reps : [],
    cogsDealPartnerSplits: raw?.cogsDealPartnerSplits ?? 0,
    cogsDispositionFees: raw?.cogsDispositionFees ?? 0,
    cogsClosingCosts: raw?.cogsClosingCosts ?? 0,
    laborAcquisitionTeam: raw?.laborAcquisitionTeam ?? 0,
    laborSalesCommissions: raw?.laborSalesCommissions ?? 0,
    laborVirtualAssistants: raw?.laborVirtualAssistants ?? 0,
    laborLegalFees: raw?.laborLegalFees ?? 0,
    mktgPPC: raw?.mktgPPC ?? 0,
    mktgSMS: raw?.mktgSMS ?? 0,
    mktgColdCalling: raw?.mktgColdCalling ?? 0,
    mktgDirectMail: raw?.mktgDirectMail ?? 0,
    mktgLeadProviders: raw?.mktgLeadProviders ?? 0,
    softwareCloserControl: raw?.softwareCloserControl ?? 0,
    softwareOther: raw?.softwareOther ?? 0,
    accountingBookkeeping: raw?.accountingBookkeeping ?? 0,
    accountingCPA: raw?.accountingCPA ?? 0,
  };

  // If channels array exists in raw data, use it; otherwise build from legacy m1/m2/m3
  if (Array.isArray(raw?.channels) && raw.channels.length > 0) {
    base.channels = raw.channels.map((ch: any) => ({
      name: ch.name || "",
      spend: ch.spend || 0,
      newLeads: ch.newLeads || 0,
      netLeads: ch.netLeads || 0,
      offers: ch.offers || 0,
      contracts: ch.contracts || 0,
      closedRevenue: ch.closedRevenue || 0,
      closedDeals: ch.closedDeals || 0,
    }));
  } else {
    // Build channels from legacy fields
    base.channels = [
      { name: base.m1Name, spend: base.m1Spend, newLeads: base.m1NewLeads, netLeads: base.m1NetLeads, offers: base.m1Offers, contracts: base.m1Contracts, closedRevenue: base.m1ClosedRevenue, closedDeals: base.m1ClosedDeals },
      { name: base.m2Name, spend: base.m2Spend, newLeads: base.m2NewLeads, netLeads: base.m2NetLeads, offers: base.m2Offers, contracts: base.m2Contracts, closedRevenue: base.m2ClosedRevenue, closedDeals: base.m2ClosedDeals },
      { name: base.m3Name, spend: base.m3Spend, newLeads: base.m3NewLeads, netLeads: base.m3NetLeads, offers: base.m3Offers, contracts: base.m3Contracts, closedRevenue: base.m3ClosedRevenue, closedDeals: base.m3ClosedDeals },
    ];
  }

  return base;
}

// ── Channel metrics type ─────────────────────────────────────
export interface ChannelMetrics {
  cpl: number; cpnl: number; cpOff: number; cpCon: number; cpDeal: number;
  revDeal: number; roi: number;
  l2n: number; nl2o: number; o2c: number; nl2c: number; c2cl: number;
}

// ── Rep calculated metrics ───────────────────────────────────
export interface RepCalcMetrics {
  contactRate: number;
  offerRate: number;
  closeRate: number;
  avgTalkTime: number;
}

export function calcRepMetrics(rep: SalesRep): RepCalcMetrics {
  const sv = (n: number, d: number) => d === 0 ? 0 : n / d;
  return {
    contactRate: sv(rep.leadsContacted, rep.leadsAssigned) * 100,
    offerRate: sv(rep.offersMade, rep.leadsContacted) * 100,
    closeRate: sv(rep.contractsSigned, rep.offersMade) * 100,
    avgTalkTime: sv(rep.talkTimeMinutes, rep.callsMade),
  };
}

export interface TeamTotals {
  callsMade: number; talkTimeMinutes: number; leadsAssigned: number; leadsContacted: number;
  offersMade: number; contractsSigned: number; dealsClosed: number; revenueGenerated: number;
  contactRate: number; offerRate: number; closeRate: number;
}

export function calcTeamTotals(reps: SalesRep[]): TeamTotals {
  const sv = (n: number, d: number) => d === 0 ? 0 : n / d;
  const t = reps.reduce((a, r) => ({
    callsMade: a.callsMade + r.callsMade,
    talkTimeMinutes: a.talkTimeMinutes + r.talkTimeMinutes,
    leadsAssigned: a.leadsAssigned + r.leadsAssigned,
    leadsContacted: a.leadsContacted + r.leadsContacted,
    offersMade: a.offersMade + r.offersMade,
    contractsSigned: a.contractsSigned + r.contractsSigned,
    dealsClosed: a.dealsClosed + r.dealsClosed,
    revenueGenerated: a.revenueGenerated + r.revenueGenerated,
  }), { callsMade: 0, talkTimeMinutes: 0, leadsAssigned: 0, leadsContacted: 0, offersMade: 0, contractsSigned: 0, dealsClosed: 0, revenueGenerated: 0 });
  return {
    ...t,
    contactRate: sv(t.leadsContacted, t.leadsAssigned) * 100,
    offerRate: sv(t.offersMade, t.leadsContacted) * 100,
    closeRate: sv(t.contractsSigned, t.offersMade) * 100,
  };
}

export interface ChannelCalcResult {
  name: string;
  channel: Channel;
  metrics: ChannelMetrics;
}

export interface CalcResult {
  ts: number; tnl: number; tnet: number; toff: number; tcon: number; rev: number; deals: number; exp: number; profit: number;
  mROI: number; bROI: number; margin: number;
  cpl: number; cpnl: number; cpOff: number; cpCon: number; cpDeal: number;
  avgRev: number; avgProfit: number;
  l2n: number; nl2o: number; o2c: number; nl2c: number; c2cl: number;
  // Dynamic channel results
  channelResults: ChannelCalcResult[];
  // Legacy accessors (for backward compat in code that uses m1/m2/m3)
  m1: ChannelMetrics; m2: ChannelMetrics; m3: ChannelMetrics;
  // P&L fields
  totalCOGS: number;
  grossProfit: number;
  totalLabor: number;
  totalMarketing: number;
  totalSoftware: number;
  totalAccounting: number;
  totalOpEx: number;
  netProfit: number;
  cashFlow: number;
  costPerDealMktg: number;
  revPerDeal: number;
  profitMarginPct: number;
}

function calcChannelMetrics(ch: Channel): ChannelMetrics {
  const sv = (n: number, d: number) => d === 0 ? 0 : n / d;
  return {
    cpl: sv(ch.spend, ch.newLeads), cpnl: sv(ch.spend, ch.netLeads),
    cpOff: sv(ch.spend, ch.offers), cpCon: sv(ch.spend, ch.contracts),
    cpDeal: sv(ch.spend, ch.closedDeals), revDeal: sv(ch.closedRevenue, ch.closedDeals),
    roi: sv(ch.closedRevenue, ch.spend),
    l2n: sv(ch.netLeads, ch.newLeads) * 100, nl2o: sv(ch.offers, ch.netLeads) * 100,
    o2c: sv(ch.contracts, ch.offers) * 100, nl2c: sv(ch.contracts, ch.netLeads) * 100,
    c2cl: sv(ch.closedDeals, ch.contracts) * 100,
  };
}

const ZERO_METRICS: ChannelMetrics = { cpl: 0, cpnl: 0, cpOff: 0, cpCon: 0, cpDeal: 0, revDeal: 0, roi: 0, l2n: 0, nl2o: 0, o2c: 0, nl2c: 0, c2cl: 0 };

// ── Calculations ─────────────────────────────────────────────
export function calc(d: KPIData): CalcResult {
  const sv = (n: number, dn: number) => dn === 0 ? 0 : n / dn;
  const channels = getChannels(d);

  const channelResults: ChannelCalcResult[] = channels.map(ch => ({
    name: ch.name,
    channel: ch,
    metrics: calcChannelMetrics(ch),
  }));

  const ts    = channels.reduce((s, ch) => s + ch.spend, 0);
  const tnl   = channels.reduce((s, ch) => s + ch.newLeads, 0);
  const tnet  = channels.reduce((s, ch) => s + ch.netLeads, 0);
  const toff  = channels.reduce((s, ch) => s + ch.offers, 0);
  const tcon  = channels.reduce((s, ch) => s + ch.contracts, 0);
  const rev   = channels.reduce((s, ch) => s + ch.closedRevenue, 0);
  const deals = channels.reduce((s, ch) => s + ch.closedDeals, 0);

  // P&L calculations
  const totalCOGS = (d.cogsDealPartnerSplits || 0) + (d.cogsDispositionFees || 0) + (d.cogsClosingCosts || 0);
  const grossProfit = rev - totalCOGS;
  const totalLabor = (d.laborAcquisitionTeam || 0) + (d.laborSalesCommissions || 0) + (d.laborVirtualAssistants || 0) + (d.laborLegalFees || 0);
  const totalMarketing = (d.mktgPPC || 0) + (d.mktgSMS || 0) + (d.mktgColdCalling || 0) + (d.mktgDirectMail || 0) + (d.mktgLeadProviders || 0);
  const totalSoftware = (d.softwareCloserControl || 0) + (d.softwareOther || 0);
  const totalAccounting = (d.accountingBookkeeping || 0) + (d.accountingCPA || 0);
  const totalOpEx = totalLabor + totalMarketing + totalSoftware + totalAccounting;
  const netProfit = grossProfit - totalOpEx;
  const cashFlow = netProfit;

  // Use P&L fields if any are filled, else fall back to legacy
  const hasNewPL = totalCOGS > 0 || totalLabor > 0 || totalMarketing > 0 || totalSoftware > 0 || totalAccounting > 0;
  const legacyExp = ts + (d.acqCommission || 0) + (d.dispoCommission || 0) + (d.baseSalaries || 0) + (d.systemsSoftware || 0) + (d.propertyExp || 0);
  const exp = hasNewPL ? totalCOGS + totalOpEx : legacyExp;
  const profit = hasNewPL ? netProfit : rev - legacyExp;

  return {
    ts, tnl, tnet, toff, tcon, rev, deals, exp, profit,
    mROI: sv(rev, ts), bROI: sv(rev, exp), margin: sv(profit, rev) * 100,
    cpl: sv(ts, tnl), cpnl: sv(ts, tnet), cpOff: sv(ts, toff), cpCon: sv(ts, tcon), cpDeal: sv(ts, deals),
    avgRev: sv(rev, deals), avgProfit: sv(profit, deals),
    l2n: sv(tnet, tnl) * 100, nl2o: sv(toff, tnet) * 100, o2c: sv(tcon, toff) * 100,
    nl2c: sv(tcon, tnet) * 100, c2cl: sv(deals, tcon) * 100,
    channelResults,
    // Legacy accessors
    m1: channelResults[0]?.metrics || ZERO_METRICS,
    m2: channelResults[1]?.metrics || ZERO_METRICS,
    m3: channelResults[2]?.metrics || ZERO_METRICS,
    totalCOGS, grossProfit, totalLabor, totalMarketing, totalSoftware, totalAccounting, totalOpEx, netProfit, cashFlow,
    costPerDealMktg: sv(totalMarketing, deals),
    revPerDeal: sv(rev, deals),
    profitMarginPct: sv(netProfit, rev) * 100,
  };
}

// ── Alert type ───────────────────────────────────────────────
export interface Alert {
  level: "critical" | "warning";
  channel: string;
  metric: string;
  current: string;
  benchmark: string;
  why: string;
  fix: string;
  pipelineNote?: string;
}

// ── Red Zone engine ──────────────────────────────────────────
export function buildAlerts(inp: KPIData, m: CalcResult): Alert[] {
  const alerts: Alert[] = [];

  m.channelResults.forEach(cr => {
    const c = cr.channel;
    const ch = cr.metrics;
    const name = cr.name;

    if (ch.l2n > 0 && ch.l2n < 40) alerts.push({
      level: ch.l2n < 25 ? "critical" : "warning", channel: name,
      metric: "Lead to Net Lead %", current: fmtPct(ch.l2n), benchmark: "40-60%",
      why: "Too many new leads are being disqualified or not followed up fast enough.",
      fix: "Audit your lead list first — wrong lists produce junk leads. Then check if reps are screening too aggressively or not calling fast enough.",
    });
    if (ch.o2c > 0 && ch.o2c < 20) alerts.push({
      level: ch.o2c < 12 ? "critical" : "warning", channel: name,
      metric: "Offer to Contract %", current: fmtPct(ch.o2c), benchmark: "25-40%",
      why: "Offers are being made but sellers are not accepting.",
      fix: "Listen to recorded calls to identify objection patterns. Check if offers are competitive.",
    });
    if (ch.c2cl > 0 && ch.c2cl < 40) {
      const pipelineDeals = c.contracts - c.closedDeals;
      let pipelineNote: string | undefined;
      if (pipelineDeals > 0) {
        const avgDealRev = c.closedDeals > 0 ? c.closedRevenue / c.closedDeals : (m.deals > 0 ? m.avgRev : 0);
        const pipelineRev = pipelineDeals * avgDealRev;
        const benchCloses = Math.round(c.contracts * 0.5);
        const pipelineStatus = benchCloses > c.closedDeals ? "🟡 Potential upside" : "🔴 Still concerning";
        pipelineNote = `Closed deals only: ${ch.c2cl < 25 ? "🔴 Critical" : "🟡 Warning"} (${fmtPct(ch.c2cl)}). Pipeline: ${pipelineDeals} contract${pipelineDeals !== 1 ? "s" : ""} pending (${fmt$(pipelineRev)} projected revenue). At 50% benchmark close rate → ${benchCloses} closings from ${c.contracts} contracts. ${pipelineStatus}.`;
      }
      alerts.push({
        level: ch.c2cl < 25 ? "critical" : "warning", channel: name,
        metric: "Contract to Close %", current: fmtPct(ch.c2cl), benchmark: "40-55%",
        why: "Too many deals are dying after contract.",
        fix: "Run title search earlier. Strengthen your active buyer list.",
        pipelineNote,
      });
    } else if (c.contracts > 0 && c.closedDeals === 0) {
      const avgDealRev = m.deals > 0 ? m.avgRev : 0;
      const pipelineRev = c.contracts * avgDealRev;
      alerts.push({
        level: "warning", channel: name,
        metric: "Contract to Close %", current: "0.0%", benchmark: "40-55%",
        why: `${c.contracts} contract${c.contracts !== 1 ? "s" : ""} signed but zero closed deals yet.`,
        fix: "Focus on getting your first closings. Review each contract status and identify blockers.",
        pipelineNote: `Pipeline: ${c.contracts} contract${c.contracts !== 1 ? "s" : ""} worth an estimated ${fmt$(pipelineRev)}. At 50% benchmark close rate → ${Math.round(c.contracts * 0.5)} expected closings.`,
      });
    }
    if (ch.roi > 0 && ch.roi < 3) alerts.push({
      level: ch.roi < 1.5 ? "critical" : "warning", channel: name,
      metric: "Marketing ROI", current: fmtRx(ch.roi), benchmark: "3x-5x minimum",
      why: ch.roi < 1 ? "This channel is losing money." : "Less than $3 back for every $1 spent.",
      fix: "Do not scale this channel until you diagnose the conversion issue.",
    });
  });

  const totalPipeline = m.tcon - m.deals;
  if (totalPipeline > 0) {
    const pipelineRev = totalPipeline * (m.deals > 0 ? m.avgRev : 0);
    const benchCloses = Math.round(m.tcon * 0.5);
    const pipelineStatus = m.c2cl >= 40 ? "🟢 On track" : m.c2cl >= 25 ? "🟡 Needs attention" : "🔴 Critical";
    alerts.push({
      level: m.c2cl < 25 ? "critical" : "warning", channel: "Pipeline",
      metric: "Pipeline Overview", current: totalPipeline + " pending", benchmark: "Close rate 40-55%",
      why: `${totalPipeline} contract${totalPipeline !== 1 ? "s" : ""} pending close. Current overall close rate: ${fmtPct(m.c2cl)}.`,
      fix: `Focus on closing existing pipeline before scaling marketing. Expected closings at benchmark: ${benchCloses} of ${m.tcon} contracts.`,
      pipelineNote: `${pipelineStatus}. Projected pipeline revenue: ${fmt$(pipelineRev)}. Closed so far: ${m.deals} deal${m.deals !== 1 ? "s" : ""} for ${fmt$(m.rev)}.`,
    });
  }

  if (m.margin > 0 && m.margin < 20) alerts.push({
    level: m.margin < 10 ? "critical" : "warning", channel: "Overall",
    metric: "Profit Margin", current: fmtPct(m.margin), benchmark: "20%+",
    why: "Keeping less than 20 cents of every dollar earned.",
    fix: "Review your expense breakdown line by line.",
  });
  if (m.bROI > 0 && m.bROI < 1.5) alerts.push({
    level: m.bROI < 1 ? "critical" : "warning", channel: "Overall",
    metric: "Business ROI", current: fmtRx(m.bROI), benchmark: "1.5x+",
    why: m.bROI < 1 ? "Total expenses exceed revenue." : "For every dollar of total expenses you are only generating " + fmtRx(m.bROI) + " back.",
    fix: "Identify your biggest expense category and evaluate if it is producing proportional revenue.",
  });
  return alerts;
}

// ── AI Agents ────────────────────────────────────────────────
export const AGENTS: Record<string, { label: string; icon: string; color: string; tagline: string; tips: string[]; sys: string }> = {
  diagnosing: {
    label: "Diagnose", icon: "⚡", color: G,
    tagline: "What's working. What's not. Where money leaked.",
    tips: ["What's improving this period?", "Where is money leaking?", "Which channel is underperforming?", "Why is my Contract-to-Close low?"],
    sys: "You are the Diagnosing AI inside Revenue Engine by Closer Control — a KPI platform for direct-to-seller real estate wholesalers.\n\nIMPORTANT CONTEXT: Most clients have NEVER tracked conversion KPIs before. Always explain what each metric means before advising. Be direct and specific. Sound like the most experienced wholesaling consultant in the country.\n\nBENCHMARKS:\n- Marketing ROI: 3x-5x is normal, 5x-8x is target, under 3x is a problem\n- Contract-to-Close: 40-55% is industry average (50% deals fall through normally)\n- Lead-to-Net Lead: healthy is 60-75%, below 50% means list quality issues\n- Net Lead-to-Offer: healthy is 30-50%, below 25% means reps not pitching enough\n- Offer-to-Contract: healthy is 25-40%, below 20% means negotiation issues\n- Net Lead-to-Contract: healthy is 10-20%, below 10% means serious funnel issues\n\nYou also have access to Financial Statement (P&L) data including COGS, Labor, Marketing, Software, and Accounting expenses. Use these for deeper profitability analysis.\n\nFORMAT: Bullet points max 5, always tie advice to specific numbers, end with one actionable next step.",
  },
  prioritization: {
    label: "Prioritize", icon: "🎯", color: AMBER,
    tagline: "Biggest constraints. Fastest wins. Ranked by impact.",
    tips: ["What is my #1 revenue constraint right now?", "What is the fastest win I can get this month?", "Where should I focus — marketing or conversions?", "What lever has the highest ROI to pull?"],
    sys: "You are the Prioritization AI inside Revenue Engine by Closer Control.\n\nYour job: look at all KPIs and tell the client exactly what to prioritize ranked by revenue impact. Be decisive. Always give a clear #1, #2, #3 with dollar reasoning.\n\nFRAMEWORK:\n1. REVENUE CONSTRAINT — what single bottleneck limits closed deals most?\n2. EFFICIENCY LEAK — where is the most money being wasted per dollar?\n3. QUICK WIN — what can they do in 7-14 days for free that could produce a deal?\n4. SCALE LEVER — what is highest ROI to double down on once basics are fixed?\n\nYou also have access to P&L data (COGS, Labor, Marketing, Software, Accounting) and Sales Team performance data. Use these for expense optimization recommendations.\n\nFORMAT: Lead with biggest constraint in one sentence. Rank #1 #2 #3 with problem, number, impact, action. End with what to do TODAY.",
  },
  simulation: {
    label: "Simulate", icon: "🔮", color: PURPLE,
    tagline: "Model what-if scenarios before you commit a dollar.",
    tips: ["If my Offer-to-Contract rate improves by 5%?", "If I scale marketing spend by $5K per month?", "What if Contract-to-Close hits 60%?", "If I reactivate 20% of my dead leads?"],
    sys: "You are the Simulation AI inside Revenue Engine by Closer Control.\n\nYour job: run financial what-if simulations using the client's ACTUAL numbers. Show before vs after clearly. Make the math exciting because small conversion improvements = massive revenue swings in wholesaling.\n\nSIMULATION STEPS:\n1. State current baseline (actual number)\n2. Apply proposed change\n3. Calculate downstream funnel impact\n4. Show projected revenue impact in dollars\n5. State what it would realistically take to achieve this\n\nYou also have P&L data and Sales Team metrics. Use for expense and team simulations.\n\nFORMAT: Current State then Simulated State then Revenue Impact. Show every math step. End with reality check and offer to simulate another scenario.",
  },
};

// ── PDF Export ───────────────────────────────────────────────
export function exportPDF(inp: KPIData, m: CalcResult) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write("<html><head><title>Revenue Engine</title><style>body{font-family:sans-serif;padding:40px;max-width:960px;margin:0 auto}h1{font-size:24px;font-weight:800}h2{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#666;margin:24px 0 10px;border-bottom:1px solid #eee;padding-bottom:5px}.grid{display:grid;gap:10px;margin-bottom:4px}.g4{grid-template-columns:repeat(4,1fr)}.g5{grid-template-columns:repeat(5,1fr)}.card{border:1px solid #e8e8e8;border-radius:8px;padding:12px 14px}.lbl{font-size:10px;color:#999;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}.val{font-size:18px;font-weight:700;font-family:monospace}.green{color:#2db829}.footer{margin-top:40px;text-align:center;font-size:10px;color:#ccc}table{width:100%;border-collapse:collapse;margin:10px 0}th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #eee;font-size:12px}th{font-weight:600;color:#666;text-transform:uppercase;font-size:10px}</style></head><body>");
  w.document.write("<h1>Revenue Engine Report</h1><p style='color:#888;font-size:13px;margin-bottom:28px'>" + inp.companyName + " &nbsp;&middot;&nbsp; " + new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) + "</p>");

  // P&L Summary
  w.document.write("<h2>Profit & Loss Summary</h2><div class='grid g4'>");
  const plItems: [string, string, boolean][] = [
    ["Revenue (Sales)", fmt$(m.rev), true],
    ["COGS", fmt$(m.totalCOGS), false],
    ["Gross Profit", fmt$(m.grossProfit), true],
    ["Total Operating Expenses", fmt$(m.totalOpEx), false],
    ["Net Profit", fmt$(m.netProfit), m.netProfit > 0],
    ["Profit Margin", fmtPct(m.profitMarginPct), false],
    ["Marketing Spend", fmt$(m.totalMarketing), false],
    ["Cost Per Deal", fmt$(m.costPerDealMktg), false],
  ];
  plItems.forEach(([l, v, g]) => {
    w.document.write("<div class='card'><div class='lbl'>" + l + "</div><div class='val" + (g ? " green" : "") + "'>" + v + "</div></div>");
  });
  w.document.write("</div>");

  // Channel Performance
  w.document.write("<h2>Channel Performance</h2><table><thead><tr><th>Channel</th><th>Spend</th><th>Leads</th><th>Deals</th><th>Revenue</th><th>ROI</th></tr></thead><tbody>");
  m.channelResults.forEach(cr => {
    w.document.write("<tr><td>" + cr.name + "</td><td>" + fmt$(cr.channel.spend) + "</td><td>" + cr.channel.newLeads + "</td><td>" + cr.channel.closedDeals + "</td><td>" + fmt$(cr.channel.closedRevenue) + "</td><td>" + fmtRx(cr.metrics.roi) + "</td></tr>");
  });
  w.document.write("</tbody></table>");

  // Conversion Rates
  w.document.write("<h2>Conversion Rates</h2><div class='grid g5'>");
  const convs: [string, string][] = [["Lead to Net Lead", fmtPct(m.l2n)], ["Net Lead to Offer", fmtPct(m.nl2o)], ["Offer to Contract", fmtPct(m.o2c)], ["Net Lead to Contract", fmtPct(m.nl2c)], ["Contract to Close", fmtPct(m.c2cl)]];
  convs.forEach(([l, v]) => {
    w.document.write("<div class='card'><div class='lbl'>" + l + "</div><div class='val'>" + v + "</div></div>");
  });
  w.document.write("</div>");

  // Sales Team
  if (inp.reps && inp.reps.length > 0) {
    w.document.write("<h2>Sales Team Performance</h2><table><thead><tr><th>Rep</th><th>Calls</th><th>Talk Time</th><th>Leads</th><th>Contacted</th><th>Offers</th><th>Contracts</th><th>Deals</th><th>Revenue</th></tr></thead><tbody>");
    inp.reps.forEach(r => {
      w.document.write("<tr><td>" + r.name + "</td><td>" + r.callsMade + "</td><td>" + r.talkTimeMinutes + " min</td><td>" + r.leadsAssigned + "</td><td>" + r.leadsContacted + "</td><td>" + r.offersMade + "</td><td>" + r.contractsSigned + "</td><td>" + r.dealsClosed + "</td><td>" + fmt$(r.revenueGenerated) + "</td></tr>");
    });
    w.document.write("</tbody></table>");
  }

  w.document.write("<div class='footer'>Revenue Engine &copy; Closer Control &mdash; Confidential</div></body></html>");
  w.document.close();
  w.print();
}

// ── Context builder for AI chat ──────────────────────────────
export function buildAIContext(inp: KPIData, m: CalcResult, period: string): string {
  const lines = [
    "PERIOD: " + (period || "Current"),
    "Revenue (Sales): " + fmt$(m.rev) + " | COGS: " + fmt$(m.totalCOGS) + " | Gross Profit: " + fmt$(m.grossProfit),
    "Operating Expenses: " + fmt$(m.totalOpEx) + " | Net Profit: " + fmt$(m.netProfit) + " | Profit Margin: " + fmtPct(m.profitMarginPct),
    "Marketing ROI: " + fmtRx(m.mROI) + " | Business ROI: " + fmtRx(m.bROI) + " | Total Channel Spend: " + fmt$(m.ts),
    "Leads: " + m.tnl + " | Net: " + m.tnet + " | Offers: " + m.toff + " | Contracts: " + m.tcon + " | Deals: " + m.deals,
    "Cost Per Lead: " + fmt$(m.cpl) + " | Cost Per Deal (Mktg): " + fmt$(m.costPerDealMktg) + " | Rev Per Deal: " + fmt$(m.revPerDeal),
    "Lead to Net Lead: " + fmtPct(m.l2n) + " | Net Lead to Offer: " + fmtPct(m.nl2o) + " | Offer to Contract: " + fmtPct(m.o2c) + " | Contract to Close: " + fmtPct(m.c2cl),
    "Pipeline: " + (m.tcon - m.deals) + " contracts pending close",
    "--- P&L Breakdown ---",
    "COGS: Partner Splits " + fmt$(inp.cogsDealPartnerSplits || 0) + " | Dispo Fees " + fmt$(inp.cogsDispositionFees || 0) + " | Closing Costs " + fmt$(inp.cogsClosingCosts || 0),
    "Labor: ACQ Team " + fmt$(inp.laborAcquisitionTeam || 0) + " | Sales Commissions " + fmt$(inp.laborSalesCommissions || 0) + " | VAs " + fmt$(inp.laborVirtualAssistants || 0) + " | Legal Fees " + fmt$(inp.laborLegalFees || 0),
    "Marketing: PPC " + fmt$(inp.mktgPPC || 0) + " | SMS " + fmt$(inp.mktgSMS || 0) + " | Cold Calling " + fmt$(inp.mktgColdCalling || 0) + " | Direct Mail " + fmt$(inp.mktgDirectMail || 0) + " | Data " + fmt$(inp.mktgLeadProviders || 0),
    "Software: Closer Control " + fmt$(inp.softwareCloserControl || 0) + " | Other " + fmt$(inp.softwareOther || 0),
    "Accounting: Bookkeeping " + fmt$(inp.accountingBookkeeping || 0) + " | CPA " + fmt$(inp.accountingCPA || 0),
    "--- Channel Breakdown ---",
  ];

  m.channelResults.forEach(cr => {
    lines.push(cr.name + ": spend " + fmt$(cr.channel.spend) + " leads " + cr.channel.newLeads + " deals " + cr.channel.closedDeals + " rev " + fmt$(cr.channel.closedRevenue) + " ROI " + fmtRx(cr.metrics.roi));
  });

  // Sales team data
  if (inp.reps && inp.reps.length > 0) {
    lines.push("--- Sales Team ---");
    const team = calcTeamTotals(inp.reps);
    lines.push("Team Totals: " + team.callsMade + " calls, " + team.talkTimeMinutes + " min talk, " + team.leadsAssigned + " assigned, " + team.dealsClosed + " deals, " + fmt$(team.revenueGenerated) + " rev");
    inp.reps.forEach(r => {
      const rm = calcRepMetrics(r);
      lines.push(r.name + ": " + r.callsMade + " calls, " + r.dealsClosed + " deals, " + fmt$(r.revenueGenerated) + " rev, Contact " + fmtPct(rm.contactRate) + " Offer " + fmtPct(rm.offerRate) + " Close " + fmtPct(rm.closeRate));
    });
  }

  return lines.join("\n");
}

// ── Aggregate KPI data across periods ────────────────────────
export function aggregateKPIData(periods: KPIData[]): KPIData {
  if (periods.length === 0) return { ...ZERO_DATA };

  const sum: KPIData = { ...ZERO_DATA, channels: [], reps: [] };
  const aggregatedChannels = new Map<string, Channel>();

  // Pre-scan ALL periods to build slot→name mapping (order-independent).
  // This ensures unnamed channels at a given index get merged with the
  // named channel that occupies the same slot in any other period.
  const slotKeys = new Map<number, string>();
  for (const period of periods) {
    const channels = getChannels(period);
    channels.forEach((channel, index) => {
      const trimmedName = channel.name.trim();
      if (trimmedName && !slotKeys.has(index)) {
        slotKeys.set(index, `name:${trimmedName.toLowerCase()}`);
      }
    });
  }

  const upsertChannel = (key: string, fallbackName: string, channel: Channel) => {
    const existing = aggregatedChannels.get(key);
    if (existing) {
      existing.spend += channel.spend;
      existing.newLeads += channel.newLeads;
      existing.netLeads += channel.netLeads;
      existing.offers += channel.offers;
      existing.contracts += channel.contracts;
      existing.closedRevenue += channel.closedRevenue;
      existing.closedDeals += channel.closedDeals;
      // Prefer a real channel name over a generated fallback like "Channel 1"
      if (fallbackName && (!existing.name || existing.name.match(/^Channel \d+$/))) existing.name = fallbackName;
      return;
    }

    aggregatedChannels.set(key, {
      name: fallbackName,
      spend: channel.spend,
      newLeads: channel.newLeads,
      netLeads: channel.netLeads,
      offers: channel.offers,
      contracts: channel.contracts,
      closedRevenue: channel.closedRevenue,
      closedDeals: channel.closedDeals,
    });
  };

  for (const period of periods) {
    const channels = getChannels(period);

    channels.forEach((channel, index) => {
      const trimmedName = channel.name.trim();
      const namedKey = trimmedName ? `name:${trimmedName.toLowerCase()}` : null;
      const key = namedKey ?? slotKeys.get(index) ?? `slot:${index}`;
      const fallbackName = trimmedName || aggregatedChannels.get(key)?.name || `Channel ${index + 1}`;

      upsertChannel(key, fallbackName, channel);
    });
  }

  sum.channels = Array.from(aggregatedChannels.values());
  sum.companyName = periods[0].companyName;

  // Sum non-channel numeric fields
  const numericKeys: (keyof KPIData)[] = [
    'totalACQCalls','totalACQTalkTime',
    'acqCommission','dispoCommission','baseSalaries','systemsSoftware','propertyExp',
    'cogsDealPartnerSplits','cogsDispositionFees','cogsClosingCosts',
    'laborAcquisitionTeam','laborSalesCommissions','laborVirtualAssistants','laborLegalFees',
    'mktgPPC','mktgSMS','mktgColdCalling','mktgDirectMail','mktgLeadProviders',
    'softwareCloserControl','softwareOther',
    'accountingBookkeeping','accountingCPA',
  ];
  for (const p of periods) {
    for (const k of numericKeys) {
      (sum as any)[k] += (p as any)[k] || 0;
    }
  }

  const synced = syncChannelsToLegacy(sum);
  const totalDeals = synced.channels.reduce((s, ch) => s + ch.closedDeals, 0);
  const totalRev = synced.channels.reduce((s, ch) => s + ch.closedRevenue, 0);
  synced.avgAssignmentFee = totalDeals > 0 ? totalRev / totalDeals : 0;
  return synced;
}
