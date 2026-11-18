import { test } from "node:test";
import assert from "node:assert/strict";
import { requestNeverReachedProvider } from "../src/lib/providerNetwork.ts";

const fetchFailed = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(code), { code }) });

test("provider site down (connect timeout / refused / DNS) is safe to send to next provider", () => {
  for (const c of ["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]) assert.equal(requestNeverReachedProvider(fetchFailed(c)), true, c);
});

test("reset or timeout after connecting stays uncertain (no resend, no duplicate paid order)", () => {
  assert.equal(requestNeverReachedProvider(fetchFailed("ECONNRESET")), false);
  assert.equal(requestNeverReachedProvider(fetchFailed("UND_ERR_SOCKET")), false);
  assert.equal(requestNeverReachedProvider(Object.assign(new Error("aborted"), { name: "TimeoutError" })), false);
});
