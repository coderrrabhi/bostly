import { test } from "node:test";
import assert from "node:assert/strict";
import { assertWithinBundleMaximum, bundleMaximum, capAtBundleMaximum } from "../src/lib/bundleQuantityLimit.ts";

test("Mass Order caps an automatically calculated engagement at the bundle Max of 10,000", () => {
  assert.equal(capAtBundleMaximum(25_000, 10_000), 10_000);
});

test("Mass Order keeps a quantity exactly at or below the bundle Max unchanged", () => {
  assert.equal(capAtBundleMaximum(10_000, 10_000), 10_000);
  assert.equal(capAtBundleMaximum(9_999, 10_000), 9_999);
});

test("an empty or zero bundle Max leaves the quantity uncapped", () => {
  assert.equal(capAtBundleMaximum(25_000, null), 25_000);
  assert.equal(capAtBundleMaximum(25_000, 0), 25_000);
});

test("the final server check accepts 10,000 but rejects 10,001", () => {
  assert.equal(assertWithinBundleMaximum("likes", 10_000, 10_000), 10_000);
  assert.throws(
    () => assertWithinBundleMaximum("likes", 10_001, 10_000),
    /likes quantity 10,001 exceeds My Bundles maximum 10,000/,
  );
});

test("invalid Max values never become a negative or fractional limit", () => {
  assert.equal(bundleMaximum(-5), 0);
  assert.equal(bundleMaximum("not-a-number"), 0);
  assert.equal(bundleMaximum(100.9), 100);
});
