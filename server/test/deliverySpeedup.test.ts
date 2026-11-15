import { test } from "node:test";
import assert from "node:assert/strict";
import { speedupTicketDelayMinutes, speedupTicketEligible, speedupTicketMessage } from "../src/lib/deliverySpeedup.ts";

const delayed = {
  providerOrderId: "5797899",
  status: "started",
  startedAt: "2026-11-14T18:00:00Z",
  quantityToSend: 12,
  providerRemains: 12,
  now: "2026-11-14T18:03:00Z",
};

test("a provider order with no delivery after three minutes becomes ticket-eligible", () => {
  assert.equal(speedupTicketEligible(delayed), true);
  assert.equal(speedupTicketEligible({ ...delayed, now: "2026-11-14T18:02:59Z" }), false);
});

test("the automatic ticket delay is always within the requested 2–5 minutes", () => {
  assert.equal(speedupTicketDelayMinutes(1), 2);
  assert.equal(speedupTicketDelayMinutes(4), 4);
  assert.equal(speedupTicketDelayMinutes(20), 5);
  assert.equal(speedupTicketDelayMinutes(undefined), 3);
});

test("confirmed delivery, terminal orders and existing tickets never create another ticket", () => {
  assert.equal(speedupTicketEligible({ ...delayed, providerRemains: 5 }), false);
  assert.equal(speedupTicketEligible({ ...delayed, status: "completed", providerRemains: 0 }), false);
  assert.equal(speedupTicketEligible({ ...delayed, speedupTicketedAt: "2026-11-14T18:02:00Z" }), false);
  assert.equal(speedupTicketEligible({ ...delayed, providerOrderId: null }), false);
});

test("the ticket contains unique provider order IDs and the requested urgent message", () => {
  assert.equal(
    speedupTicketMessage(["5797899", "5797364", "5797899"]),
    "5797899,5797364 -- speed up this order and complete quickly. These orders are very urgent; please complete all orders asap.",
  );
  assert.throws(() => speedupTicketMessage([]));
});
