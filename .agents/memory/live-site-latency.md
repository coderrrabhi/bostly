---
name: Live-site latency model (India users, North America VM)
description: Why Boostly Pro feels slow from India, what actually moved the needle, and what did not.
---
The deployment region is North America; the owner and customers are in Mumbai. Every request costs ~280 ms warm / ~750 ms on a new connection regardless of handler time, so perceived speed is dominated by request count and bytes, not CPU.

**Why:** Measured on 2026-09-07: static HTML and a trivial /api/healthz both took ~280 ms; Google control was 23 ms. The platform static handler served everything uncompressed with no cache headers (548 KB JS, 205 KB CSS, 881 KB logo PNG at 40 px).

**How to apply:**
- Prefer fewer round trips over faster handlers: coalesce/cached session data, pinned Clerk script versions (each unpinned version was a 307 redirect = one extra RTT), fonts linked from index.html instead of CSS @import chains.
- Serve the SPA from the sirv server with pre-compressed brotli + immutable hashed assets; the platform "static" mode had no compression or caching.
- Keep legacy page selects narrow; the Engagement Orders page shipped 9.4 MB raw JSON because nested relations were SELECT *.
- The remaining lever is geography: Replit geography is fixed per project, so an Asia deployment means remixing the project and publishing the copy there (new DB, data migration, Clerk/domain reconfiguration).
- Verification trick that works here: headless Chromium at /repl/tools/bin/chromium driven over CDP from Node (no Playwright); sign in with a Clerk sign-in token via window.Clerk.client.signIn.create({ strategy: "ticket" }). localhost:80 proxies the full app in dev.
