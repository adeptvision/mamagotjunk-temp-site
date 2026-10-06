# Careers endpoint — Worker notes (deployed)

The `mama-got-junk` Cloudflare Worker (Adeptvisionai account, edited in the dashboard, not Git-connected)
handles `/api/lead`, `/api/internal-lead` and `/api/careers`. `careers.html` posts to
`https://mama-got-junk.adeptvisionai.workers.dev/api/careers`, which is served by this handler.
This folder starts with `_`, so GitHub Pages/Jekyll does not publish it.

## Production status

- `/api/careers` is deployed on the `mama-got-junk` Cloudflare Worker.
- Production Worker version: **#21** (`743f362d…`), deployed 2026-10-06.
- Verified end-to-end through Worker → GHL (validation, spam checks and one live test application).
- Rollback point: **version #20** (`20840ba3…`), the version from before the careers integration.
  Cloudflare → Workers & Pages → `mama-got-junk` → Deployments → version #20 → Rollback.
- `GHL_CAREERS_WEBHOOK_URL` is configured as a Cloudflare **secret** on the Worker. Its value is not
  stored in this repo.
- `careers-endpoint.js` is a reference copy of the deployed handler. The Worker's copy is identical
  apart from its header comment.

## How it was installed

1. Cloudflare → Workers & Pages → `mama-got-junk` → Settings → Variables and secrets → added a
   **Secret** named `GHL_CAREERS_WEBHOOK_URL` = the GoHighLevel inbound webhook URL.
2. Edit code → pasted the handler from `careers-endpoint.js` above `export default {`.
3. In the `fetch` handler, added `/api/careers` to the existing OPTIONS (CORS preflight) line:

   ```js
   if (request.method === "OPTIONS" && (path === "/api/lead" || path === "/api/chat" || path === "/api/internal-lead" || path === "/api/careers")) {
   ```

4. Directly below that block, added:

   ```js
   if (request.method === "POST" && path === "/api/careers") return handleCareers(request, env, url);
   ```

5. Deployed the Worker. `careers.html` goes live when this branch is merged to `main`.

## Behavior

- Allowed origins: `https://mamagotjunk.com` (CORS, from the existing `apiCors`), plus the Worker's own origin.
- Honeypot field `companyWebsite` and a 3-second minimum fill time. Spam gets `{ok:true}` and is not forwarded.
- Responses: `200 {ok:true}`, `400 {ok:false, field, error}`, `403` bad origin, `413` body over 20 KB,
  `503` secret missing, `502` webhook failed or timed out (10 s).
- Nothing is stored. Logs never include applicant details.
