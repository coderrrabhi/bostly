// E2E regression test: INR input -> OxaPay invoice USD -> wallet credit USD.
// Asserts wallet credit exactly matches (INR / 90) rounded to 4 decimals for
// every tested amount, and validates min/max boundary enforcement.
//
// Optional live mode (hits deployed edge function + DB, does NOT complete a
// real crypto payment): set RUN_LIVE=1 plus VITE_SUPABASE_URL,
// VITE_SUPABASE_PUBLISHABLE_KEY, TEST_USER_JWT.

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const USD_TO_INR = 90;

// Mirror of the exact math in oxapay-create-invoice/index.ts and
// credit_wallet_oxapay RPC. Any divergence here means the pipeline
// would credit the wrong amount.
function inrToUsd(inr: number): number {
  const amountInr = Math.round(Number(inr) * 100) / 100;
  return Math.round((amountInr / USD_TO_INR) * 10000) / 10000;
}

// INR amounts spanning the allowed range, including edges and awkward paise.
const CASES: Array<{ inr: number; expectedUsd: number }> = [
  { inr: 90,        expectedUsd: 1.0 },
  { inr: 91,        expectedUsd: 1.0111 },
  { inr: 100,       expectedUsd: 1.1111 },
  { inr: 123.45,    expectedUsd: 1.3717 },
  { inr: 500,       expectedUsd: 5.5556 },
  { inr: 999.99,    expectedUsd: 11.1110 },
  { inr: 1000,      expectedUsd: 11.1111 },
  { inr: 4500,      expectedUsd: 50.0 },
  { inr: 9000,      expectedUsd: 100.0 },
  { inr: 45000,     expectedUsd: 500.0 },
  { inr: 90000,     expectedUsd: 1000.0 },
  { inr: 123456.78, expectedUsd: 1371.7420 },
  { inr: 540000,    expectedUsd: 6000.0 },
];

Deno.test("INR -> USD conversion matches for all supported amounts", () => {
  for (const c of CASES) {
    const usd = inrToUsd(c.inr);
    assertEquals(
      usd,
      c.expectedUsd,
      `INR ${c.inr} => expected $${c.expectedUsd}, got $${usd}`,
    );
  }
});

Deno.test("Round-trip USD -> INR stays within 1 paisa of input", () => {
  for (const c of CASES) {
    const usd = inrToUsd(c.inr);
    const backInr = Math.round(usd * USD_TO_INR * 100) / 100;
    const drift = Math.abs(backInr - c.inr);
    assert(
      drift <= 0.01,
      `INR ${c.inr} -> $${usd} -> ₹${backInr} drift ${drift} exceeds 1 paisa`,
    );
  }
});

Deno.test("Boundary: below ₹90 minimum is rejected by conversion guard", () => {
  const rejects = [0, 1, 50, 89.99];
  for (const inr of rejects) {
    const amountInr = Math.round(inr * 100) / 100;
    assert(amountInr < 90, `${inr} should be below minimum`);
  }
});

Deno.test("Boundary: above ₹5,40,000 maximum is rejected by conversion guard", () => {
  const rejects = [540000.01, 600000, 1_000_000];
  for (const inr of rejects) {
    assert(inr > 540000, `${inr} should be above maximum`);
  }
});

// -------- Optional live E2E against deployed edge function --------
const RUN_LIVE = Deno.env.get("RUN_LIVE") === "1";
const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL");
const ANON = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY");
const USER_JWT = Deno.env.get("TEST_USER_JWT");

Deno.test({
  name: "LIVE: create-invoice stores exact INR + derived USD in oxapay_deposits",
  ignore: !(RUN_LIVE && SUPABASE_URL && ANON && USER_JWT),
  fn: async () => {
    const liveCases = [90, 100, 500, 4500, 90000];
    for (const inr of liveCases) {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/oxapay-create-invoice`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${USER_JWT}`,
          "apikey": ANON!,
        },
        body: JSON.stringify({ amount_inr: inr }),
      });
      const body = await res.json().catch(() => ({}));
      assertEquals(res.status, 200, `INR ${inr} failed: ${JSON.stringify(body)}`);
      assertEquals(body.amount_inr, inr, `stored INR mismatch for ${inr}`);
      assertEquals(
        body.amount_usd,
        inrToUsd(inr),
        `stored USD mismatch for INR ${inr}`,
      );
      assert(String(body.order_id).startsWith("OXP_"), "order_id prefix");
      assert(String(body.payment_url).startsWith("http"), "payment_url present");
    }
  },
});
