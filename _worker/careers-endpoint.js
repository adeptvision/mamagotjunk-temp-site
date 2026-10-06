// Mama Got Junk — POST /api/careers handler for the existing `mama-got-junk` Cloudflare Worker.
//
// DEPLOYED AND VERIFIED LIVE (Worker version #21, 2026-10-06): /api/careers is installed in the
// `mama-got-junk` Worker and was verified end-to-end (Worker -> GHL). Rollback point: version #20.
// The Worker is edited in the Cloudflare dashboard (not connected to Git), so this file is a reference
// copy of the deployed handler. See _worker/README.md for how it was installed.
//
// Relies on two things already defined in the Worker: `json(data, status)` and `apiCors`.
// Requires one secret: GHL_CAREERS_WEBHOOK_URL (GoHighLevel inbound webhook URL).
// The webhook URL is never sent to the browser.

const CAREERS_EVENT = "mama_got_junk_career_application";
const CAREERS_SOURCE = "Mama Got Junk careers page";
const CAREERS_ALLOWED_ORIGINS = ["https://mamagotjunk.com", "https://www.mamagotjunk.com"];
const CAREERS_POSITIONS = [
  "Junk removal crew member",
  "Driver",
  "Light demolition & cleanup",
  "Office / scheduling support",
  "Other / open to any role"
];
const CAREERS_AVAILABILITY = ["Full-time", "Part-time", "Weekends only", "Flexible / as needed"];
const CAREERS_MAX_BODY_BYTES = 20000;
const CAREERS_MIN_FILL_MS = 3000;

function careersClean(value, max) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max + 1);
}

function validateCareers(body) {
  const d = {
    firstName: careersClean(body.firstName, 60),
    lastName: careersClean(body.lastName, 60),
    email: careersClean(body.email, 254).toLowerCase(),
    phone: careersClean(body.phone, 30),
    position: careersClean(body.position, 80),
    availability: careersClean(body.availability, 80),
    experience: careersClean(body.experience, 2000),
    message: careersClean(body.message, 2000)
  };
  const fail = (field, error) => ({ ok: false, field, error });
  if (!d.firstName || d.firstName.length > 60) return fail("firstName", "Please enter your first name.");
  if (!d.lastName || d.lastName.length > 60) return fail("lastName", "Please enter your last name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email) || d.email.length > 254) return fail("email", "Please enter a valid email address.");
  const digits = d.phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15 || d.phone.length > 30) return fail("phone", "Please enter a valid phone number, including area code.");
  if (!CAREERS_POSITIONS.includes(d.position)) return fail("position", "Please choose a role.");
  if (!CAREERS_AVAILABILITY.includes(d.availability)) return fail("availability", "Please choose your availability.");
  if (d.experience.length > 2000) return fail("experience", "Please keep this under 2,000 characters.");
  if (!d.message || d.message.length > 2000) return fail("message", "Please tell us why you want to join the team.");
  return { ok: true, data: d };
}

function buildCareersPayload(d, meta) {
  const fullName = [d.firstName, d.lastName].filter(Boolean).join(" ");
  return {
    event: CAREERS_EVENT,
    source: CAREERS_SOURCE,
    sourceUrl: meta.sourceUrl,
    submittedAt: meta.submittedAt,
    submissionId: meta.submissionId,
    firstName: d.firstName,
    lastName: d.lastName,
    fullName,
    email: d.email,
    phone: d.phone,
    position: d.position,
    availability: d.availability,
    experience: d.experience,
    message: d.message,
    // GoHighLevel-friendly aliases (same convention as the existing /api/lead payload)
    first_name: d.firstName,
    last_name: d.lastName,
    name: fullName
  };
}

async function handleCareers(request, env, url) {
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin && !CAREERS_ALLOWED_ORIGINS.includes(origin)) {
    return json({ ok: false, error: "Invalid origin" }, 403);
  }
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > CAREERS_MAX_BODY_BYTES) return json({ ok: false, error: "Application is too large." }, 413);

  let raw;
  try { raw = await request.text(); } catch { return json({ ok: false, error: "Invalid request" }, 400); }
  if (raw.length > CAREERS_MAX_BODY_BYTES) return json({ ok: false, error: "Application is too large." }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ ok: false, error: "Invalid request" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: "Invalid request" }, 400);

  // Basic spam protection: hidden honeypot field + minimum time on page.
  // Bots get a generic success so they don't learn what tripped the filter; nothing is forwarded.
  const honeypot = String(body.companyWebsite || "").trim();
  const elapsed = Number(body.elapsedMs);
  if (honeypot || !Number.isFinite(elapsed) || elapsed < CAREERS_MIN_FILL_MS) {
    console.warn("Careers submission dropped by spam filter", { honeypot: !!honeypot, elapsed });
    return json({ ok: true });
  }

  const result = validateCareers(body);
  if (!result.ok) return json({ ok: false, field: result.field, error: result.error }, 400);

  const webhook = env && env.GHL_CAREERS_WEBHOOK_URL;
  if (!webhook) {
    console.error("GHL_CAREERS_WEBHOOK_URL is not configured");
    return json({ ok: false, error: "Online applications are temporarily unavailable." }, 503);
  }

  let sourceUrl = "https://mamagotjunk.com/careers";
  try {
    const s = new URL(String(body.sourceUrl || ""));
    if (CAREERS_ALLOWED_ORIGINS.includes(s.origin)) sourceUrl = s.origin + s.pathname;
  } catch {}

  const payload = buildCareersPayload(result.data, {
    sourceUrl,
    submittedAt: new Date().toISOString(),
    submissionId: crypto.randomUUID()
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) {
      console.error("Careers webhook rejected", { status: response.status, submissionId: payload.submissionId });
      return json({ ok: false, error: "Application service unavailable." }, 502);
    }
  } catch (error) {
    console.error("Careers webhook failed", { submissionId: payload.submissionId, error: String(error) });
    return json({ ok: false, error: "Application service unavailable." }, 502);
  } finally {
    clearTimeout(timer);
  }
  return json({ ok: true });
}
