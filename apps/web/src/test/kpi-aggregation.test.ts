import { describe, expect, it } from "vitest";
import { aggregateKPIData, getChannels, normalizeKPIData } from "@/shared/kpi";

describe("aggregateKPIData", () => {
  it("merges channels by name instead of array position across periods", () => {
    const current = normalizeKPIData({
      companyName: "Lionshead",
      channels: [
        { name: "Meta Ads", spend: 100, newLeads: 10, netLeads: 8, offers: 4, contracts: 2, closedRevenue: 12000, closedDeals: 1 },
        { name: "Cold Calling", spend: 200, newLeads: 20, netLeads: 15, offers: 6, contracts: 3, closedRevenue: 18000, closedDeals: 2 },
      ],
    });

    const previous = normalizeKPIData({
      companyName: "Lionshead",
      channels: [
        { name: "Cold Calling", spend: 80, newLeads: 8, netLeads: 6, offers: 2, contracts: 1, closedRevenue: 9000, closedDeals: 1 },
        { name: "Meta Ads", spend: 90, newLeads: 9, netLeads: 7, offers: 3, contracts: 1, closedRevenue: 11000, closedDeals: 1 },
      ],
    });

    const aggregated = getChannels(aggregateKPIData([current, previous]));

    expect(aggregated.map((channel) => channel.name)).toEqual(["Meta Ads", "Cold Calling"]);
    expect(aggregated[0]).toMatchObject({
      spend: 190,
      newLeads: 19,
      netLeads: 15,
      offers: 7,
      contracts: 3,
      closedRevenue: 23000,
      closedDeals: 2,
    });
    expect(aggregated[1]).toMatchObject({
      spend: 280,
      newLeads: 28,
      netLeads: 21,
      offers: 8,
      contracts: 4,
      closedRevenue: 27000,
      closedDeals: 3,
    });
  });

  it("uses the most recent named channel label when older slot-based data is unnamed", () => {
    const current = normalizeKPIData({
      channels: [
        { name: "Meta Ads", spend: 120, newLeads: 12, netLeads: 9, offers: 5, contracts: 2, closedRevenue: 15000, closedDeals: 1 },
      ],
    });

    const previous = normalizeKPIData({
      channels: [
        { name: "", spend: 30, newLeads: 3, netLeads: 2, offers: 1, contracts: 1, closedRevenue: 3000, closedDeals: 0 },
      ],
    });

    const aggregated = getChannels(aggregateKPIData([current, previous]));

    expect(aggregated[0]).toMatchObject({
      name: "Meta Ads",
      spend: 150,
      newLeads: 15,
      netLeads: 11,
      offers: 6,
      contracts: 3,
      closedRevenue: 18000,
      closedDeals: 1,
    });
  });

  it("merges unnamed→named channels regardless of period order (oldest first)", () => {
    // BUG FIX: previously, if oldest (unnamed) period came first in the array,
    // it would create a separate "slot:0" entry instead of merging with the
    // named channel from the newer period.
    const older = normalizeKPIData({
      channels: [
        { name: "", spend: 30, newLeads: 3, netLeads: 2, offers: 1, contracts: 1, closedRevenue: 3000, closedDeals: 0 },
      ],
    });

    const newer = normalizeKPIData({
      channels: [
        { name: "Meta Ads", spend: 120, newLeads: 12, netLeads: 9, offers: 5, contracts: 2, closedRevenue: 15000, closedDeals: 1 },
      ],
    });

    // Pass oldest FIRST — this is the order that previously broke
    const aggregated = getChannels(aggregateKPIData([older, newer]));

    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]).toMatchObject({
      name: "Meta Ads",
      spend: 150,
      newLeads: 15,
      netLeads: 11,
      offers: 6,
      contracts: 3,
      closedRevenue: 18000,
      closedDeals: 1,
    });
  });
});
