import { test } from "node:test";
import assert from "node:assert/strict";
import { preferOtherProvider, shouldFailoverCancelledRun, cancelledProviderMark, appendCancelledProviderMark } from "../src/lib/commentDelivery.ts";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

test("provider that cancelled goes last so priority 2 is tried next", () => {
  const ordered = [{ user_provider_account_id: A }, { user_provider_account_id: B }];
  const out = preferOtherProvider(ordered, `cancelled${cancelledProviderMark(A)}`);
  assert.deepEqual(out.map((m) => m.user_provider_account_id), [B, A]);
});

test("without a cancel mark priority order is kept", () => {
  const ordered = [{ user_provider_account_id: A }, { user_provider_account_id: B }];
  assert.deepEqual(preferOtherProvider(ordered, null), ordered);
});

test("views cancelled with nothing delivered fail over", () => {
  assert.equal(shouldFailoverCancelledRun({ engagement_type: "views", status: "Canceled", quantity_to_send: 500, remains: 500 }), true);
});

test("partially delivered views are never re-sent", () => {
  assert.equal(shouldFailoverCancelledRun({ engagement_type: "views", status: "Canceled", quantity_to_send: 500, remains: 200 }), false);
});

test("provider Failed with zero delivery can fail over, but partial Failed cannot", () => {
  assert.equal(shouldFailoverCancelledRun({ engagement_type: "likes", status: "Failed", quantity_to_send: 20, remains: 20 }), true);
  assert.equal(shouldFailoverCancelledRun({ engagement_type: "likes", status: "Failed", quantity_to_send: 20, remains: 7 }), false);
});

test("priority 3 is tried after priorities 1 and 2 both failed", () => {
  const C = "33333333-3333-3333-3333-333333333333";
  const ordered = [A, B, C].map((user_provider_account_id) => ({ user_provider_account_id }));
  const first = `failed${cancelledProviderMark(A)}`;
  const marks = appendCancelledProviderMark(first, B);
  assert.deepEqual(preferOtherProvider(ordered, `retry${marks}`).map((mapping) => mapping.user_provider_account_id), [C, A, B]);
});
