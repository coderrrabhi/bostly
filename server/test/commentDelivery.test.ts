import { strict as assert } from "node:assert";
import { test } from "node:test";
import { commentRetryMinutes, runCommentText, validateCommentOrder } from "../src/lib/commentDelivery.ts";

test("each comment run sends only its scheduled quantity, not the full order", () => {
  const item_comments = "first\nsecond\nthird\nfourth\nfifth\nsixth";
  const quantities = [1, 2, 2, 1];
  let offset = 0;
  const sent = quantities.map((quantity_to_send) => {
    const text = runCommentText({ engagement_type: "comments", quantity_to_send,
      custom_comments: item_comments, item_comments, comment_offset: offset });
    assert.equal(text?.split("\n").length, quantity_to_send);
    offset += quantity_to_send;
    return text;
  });
  assert.deepEqual(sent, ["first", "second\nthird", "fourth\nfifth", "sixth"]);
});
test("modern per-run comments remain unchanged", () => {
  assert.equal(runCommentText({ engagement_type: "comments", quantity_to_send: 2,
    custom_comments: " hello\r\n\n world ", item_comments: "other", comment_offset: 8 }), "hello\nworld");
});
test("missing comment text cannot reach the provider", () => {
  assert.throws(() => runCommentText({ engagement_type: "comments", quantity_to_send: 1 }), /needs attention/);
});
test("single and mass order validation rejects missing or insufficient comment text", () => {
  assert.throws(() => validateCommentOrder("comments", undefined, 6), /exactly 6/);
  assert.throws(() => validateCommentOrder("comments", "one\ntwo", 6), /exactly 6/);
  assert.doesNotThrow(() => validateCommentOrder("comments", "1\n2\n3\n4\n5\n6", 6));
});
test("likes shares saves and reposts do not receive comment parameters", () => {
  for (const engagement_type of ["likes", "shares", "saves", "reposts"]) {
    assert.equal(runCommentText({ engagement_type, quantity_to_send: 6, custom_comments: "text" }), undefined);
    assert.doesNotThrow(() => validateCommentOrder(engagement_type, undefined, 6));
  }
});
test("rejected comment runs use bounded retries rather than immediate terminal failure", () => {
  assert.equal(commentRetryMinutes(0), 2);
  assert.equal(commentRetryMinutes(1), 4);
  assert.equal(commentRetryMinutes(10), 60);
});import { shouldRecreateCancelledComment } from "../src/lib/commentDelivery.ts";
test("provider-cancelled comment run with nothing delivered is recreated", () => {
  assert.equal(shouldRecreateCancelledComment({ engagement_type: "comments", status: "Canceled", quantity_to_send: 2, remains: "2", charge: "0.00" }), true);
  assert.equal(shouldRecreateCancelledComment({ engagement_type: "comments", status: "Refunded", quantity_to_send: 1, remains: "1" }), true);
});
test("delivered, partial, non-comment or exhausted runs are not recreated", () => {
  assert.equal(shouldRecreateCancelledComment({ engagement_type: "comments", status: "Completed", quantity_to_send: 2, remains: 0 }), false);
  assert.equal(shouldRecreateCancelledComment({ engagement_type: "comments", status: "Canceled", quantity_to_send: 2, remains: 1, charge: "0.01" }), false);
  assert.equal(shouldRecreateCancelledComment({ engagement_type: "likes", status: "Canceled", quantity_to_send: 2, remains: 2 }), false);
  assert.equal(shouldRecreateCancelledComment({ engagement_type: "comments", status: "Canceled", quantity_to_send: 2, remains: 2, retry_count: 20 }), false);
});
test("partial delivery is never recreated even when the charge reads zero", () => {
  assert.equal(shouldRecreateCancelledComment({ engagement_type: "comments", status: "Canceled", quantity_to_send: 2, remains: 1, charge: "0.00" }), false);
  assert.equal(shouldRecreateCancelledComment({ engagement_type: "comments", status: "Canceled", quantity_to_send: 2, remains: "1" }), false);
});
test("zero charge recreates only when the panel did not report remains", () => {
  assert.equal(shouldRecreateCancelledComment({ engagement_type: "comments", status: "Canceled", quantity_to_send: 2, charge: "0.00" }), true);
  assert.equal(shouldRecreateCancelledComment({ engagement_type: "comments", status: "Canceled", quantity_to_send: 2, remains: null, charge: "0.00" }), true);
  assert.equal(shouldRecreateCancelledComment({ engagement_type: "comments", status: "Canceled", quantity_to_send: 2 }), false);
});
