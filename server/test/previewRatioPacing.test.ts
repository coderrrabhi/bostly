import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const deployed = new URL('../frontend-src/src/lib/preview-ratio-pacing.ts', import.meta.url);
const source = existsSync(deployed) ? deployed : new URL('../../frontend/src/lib/preview-ratio-pacing.ts', import.meta.url);
const { pacePreviewToViews } = await import(source.href);
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 20, 3, 36) + minutes * 60_000);

test('69 Likes of 1557 cannot be previewed after only 468 of 38567 Views', () => {
  const views = { engagementType: 'views', runs: [135, 122, 108, 103, 2000, 36099].map((quantity, i) => ({ quantity, scheduledAt: at(i * 30) })) };
  const likes = { engagementType: 'likes', runs: [34, 35, 1488].map((quantity, i) => ({ quantity, scheduledAt: at(43 + i * 84) })) };
  const [, out] = pacePreviewToViews([views, likes]);
  assert.ok(out[1].scheduledAt.getTime() > at(120).getTime());
  let sent = 0;
  for (const r of out) {
    sent += r.quantity;
    const v = views.runs.filter((p) => p.scheduledAt < r.scheduledAt).reduce((a, p) => a + p.quantity, 0);
    assert.ok(sent / 1557 <= v / 38567 + 1e-9);
  }
  assert.deepEqual(out.map((r) => r.quantity), [34, 35, 1488]);
});

test('rising, peak and falling selected-curve quantities are not overwritten by pacing', () => {
  const views = { engagementType: 'views', runs: [100, 200, 400, 200, 100].map((quantity, i) => ({ quantity, scheduledAt: at(i * 30) })) };
  const likes = { engagementType: 'likes', runs: [10, 20, 40, 20, 10].map((quantity, i) => ({ quantity, scheduledAt: at(i * 30 + 1) })) };
  const [, out] = pacePreviewToViews([views, likes]);
  assert.deepEqual(out.map((r) => r.quantity), [10, 20, 40, 20, 10]);
  assert.deepEqual(out.map((r) => r.scheduledAt.getTime()), likes.runs.map((r) => r.scheduledAt.getTime()));
});