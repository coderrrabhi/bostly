import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const deployed = new URL("../frontend-src/src/lib/", import.meta.url);
const source = new URL("../../frontend/src/lib/", import.meta.url);
const libFile = (file: string) => existsSync(new URL(file, deployed))
  ? new URL(file, deployed).href
  : new URL(file, source).href;
const { buildLiveGrowthPreview, formatPreviewDuration } = await import(libFile("live-growth-preview.ts"));

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 13, 12, minutes)).toISOString();

test("growth preview uses the exact planned run quantities and totals", () => {
  const result = buildLiveGrowthPreview({
    views: [
      { scheduled_at: at(0), quantity_to_send: 240 },
      { scheduled_at: at(20), quantity_to_send: 320 },
    ],
    likes: [
      { scheduled_at: at(15), quantity_to_send: 7 },
      { scheduled_at: at(35), quantity_to_send: 11 },
    ],
  });

  assert.equal(result.stats.totalRuns, 4);
  assert.equal(result.stats.totalEngagements, 578);
  assert.equal(result.stats.durationMs, 35 * 60_000);
  assert.deepEqual(result.typeBreakdown, [
    { type: "views", quantity: 560, runs: 2 },
    { type: "likes", quantity: 18, runs: 2 },
  ]);
  assert.equal(result.chartData.at(-1).views, 560);
  assert.equal(result.chartData.at(-1).likes, 18);
});

test("changing only the selected curve timing changes the real preview timestamps", () => {
  const early = buildLiveGrowthPreview({ views: [{ scheduled_at: at(0), quantity_to_send: 1000 }] });
  const late = buildLiveGrowthPreview({ views: [{ scheduled_at: at(90), quantity_to_send: 1000 }] });

  assert.equal(early.stats.startTime, Date.UTC(2026, 10, 13, 12, 0));
  assert.equal(late.stats.startTime, Date.UTC(2026, 10, 13, 13, 30));
  assert.equal(early.stats.totalEngagements, late.stats.totalEngagements);
});

test("manual per-run quantity edits are reflected without generating another schedule", () => {
  const result = buildLiveGrowthPreview({
    saves: [
      { scheduled_at: at(0), quantity_to_send: 1 },
      { scheduled_at: at(20), quantity_to_send: 9 },
    ],
  });

  assert.equal(result.stats.totalRuns, 2);
  assert.equal(result.stats.totalEngagements, 10);
  assert.deepEqual(result.chartData.filter((point) => point.total > 0).map((point) => point.saves), [1, 10]);
});

test("empty and invalid schedules show a calculating state rather than fake data", () => {
  const result = buildLiveGrowthPreview({
    views: [{ scheduled_at: "not-a-date", quantity_to_send: 100 }],
    likes: [{ scheduled_at: at(0), quantity_to_send: 0 }],
  });

  assert.equal(result.chartData.length, 0);
  assert.equal(result.stats.totalRuns, 0);
  assert.equal(result.stats.totalEngagements, 0);
});

test("preview duration is formatted from the actual first and last run", () => {
  assert.equal(formatPreviewDuration(0), "0m");
  assert.equal(formatPreviewDuration(35 * 60_000), "35m");
  assert.equal(formatPreviewDuration(13 * 60 * 60_000), "13h");
  assert.equal(formatPreviewDuration((13 * 60 + 20) * 60_000), "13h 20m");
});
