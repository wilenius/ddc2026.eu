interface Env {
  REGISTRATIONS: KVNamespace;
  TURNSTILE_SECRET: string;
  ADMIN_TOKEN: string;
  ALLOWED_ORIGIN: string;
  RESEND_API_KEY: string;
  EMAIL_FROM: string;
}

interface Registration {
  name: string;
  email: string;
  lunchSat: boolean;
  lunchSun: boolean;
  partner: string;
  lookingForPartner: boolean;
  allergies: string;
  court: boolean;
  extraDiscs: number;
  fridayPickup: boolean;
  publishName: boolean;
  totalCost: number;
  waiver: boolean;
  registeredAt: string;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function jsonResponse(body: object, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

async function verifyTurnstile(token: string, secret: string): Promise<boolean> {
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret, response: token }),
  });
  const data = (await res.json()) as { success: boolean };
  return data.success;
}

function buildConfirmationEmail(reg: Registration): { subject: string; html: string } {
  const lines: string[] = [];
  lines.push(`Registration fee: 150€`);
  if (reg.lunchSat) lines.push(`Lunch Saturday July 25th: 15€`);
  if (reg.lunchSun) lines.push(`Lunch Sunday July 26th: 15€`);
  if (reg.court) lines.push(`SweDisc Pro Court: 100€`);
  if (reg.extraDiscs > 0) lines.push(`Extra discs × ${reg.extraDiscs}: ${reg.extraDiscs * 7}€`);

  const html = `
<h2>DDC European Open 2026 — Registration Confirmed</h2>
<p>Hi ${reg.name},</p>
<p>Thank you for registering! Here is your registration summary and payment details.</p>
<h3>Cost breakdown</h3>
<table style="border-collapse:collapse;">
${lines.map(l => {
  const [label, amount] = l.split(': ');
  return `<tr><td style="padding:4px 16px 4px 0;">${label}</td><td style="text-align:right;padding:4px 0;">${amount}</td></tr>`;
}).join('\n')}
<tr style="border-top:2px solid #333;font-weight:bold;">
  <td style="padding:8px 16px 4px 0;">Total</td>
  <td style="text-align:right;padding:8px 0 4px;">${reg.totalCost}€</td>
</tr>
</table>
${reg.partner ? `<p><strong>Partner:</strong> ${reg.partner}</p>` : ''}
${reg.lookingForPartner ? `<p><strong>Partner:</strong> Looking for a partner</p>` : ''}
${reg.allergies ? `<p><strong>Allergies/dietary needs:</strong> ${reg.allergies}</p>` : ''}
<h3>Payment instructions</h3>
<p>Please transfer <strong>${reg.totalCost}€</strong> to the following account:</p>
<table style="border-collapse:collapse;">
<tr><td style="padding:2px 12px 2px 0;font-weight:bold;">IBAN</td><td>TODO</td></tr>
<tr><td style="padding:2px 12px 2px 0;font-weight:bold;">BIC</td><td>TODO</td></tr>
<tr><td style="padding:2px 12px 2px 0;font-weight:bold;">Reference</td><td>DDC2026 ${reg.name}</td></tr>
</table>
<p>Please complete the payment within 14 days to secure your spot.</p>
<p>See you at the tournament!<br>DDC European Open 2026 Organizers</p>
`.trim();

  return { subject: 'DDC European Open 2026 — Registration Confirmed', html };
}

async function sendConfirmationEmail(reg: Registration, env: Env): Promise<void> {
  const { subject, html } = buildConfirmationEmail(reg);
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      reply_to: 'registration@ddc2026.eu',
      to: [reg.email],
      subject,
      html,
    }),
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const requestOrigin = request.headers.get("Origin") || "";
    const allowedOrigins = [env.ALLOWED_ORIGIN, "http://localhost:4321"];
    const origin = allowedOrigins.includes(requestOrigin) ? requestOrigin : env.ALLOWED_ORIGIN;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === "/register" && request.method === "POST") {
      let body: any;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: "Invalid JSON" }, 400, origin);
      }

      // Verify Turnstile
      const turnstileToken = body["cf-turnstile-response"];
      if (!turnstileToken || !(await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET))) {
        return jsonResponse({ error: "CAPTCHA verification failed" }, 403, origin);
      }

      // Validate required fields
      const name = (body.name || "").trim();
      const email = (body.email || "").trim().toLowerCase();
      if (!name || !email) {
        return jsonResponse({ error: "Name and email are required" }, 400, origin);
      }

      if (!body.waiver) {
        return jsonResponse({ error: "Liability waiver must be accepted" }, 400, origin);
      }

      // Check duplicate
      const existing = await env.REGISTRATIONS.get(`reg:${email}`);
      if (existing) {
        return jsonResponse({ error: "This email is already registered" }, 409, origin);
      }

      // Store registration
      const lunchSat = !!body.lunchSat;
      const lunchSun = !!body.lunchSun;
      const court = !!body.court;
      const extraDiscs = Math.min(Math.max(parseInt(body.extraDiscs, 10) || 0, 0), 9);

      const totalCost = 150
        + (lunchSat ? 15 : 0)
        + (lunchSun ? 15 : 0)
        + (court ? 100 : 0)
        + extraDiscs * 7;

      const partner = (body.partner || "").trim().slice(0, 200);
      const lookingForPartner = !!body.lookingForPartner && !partner;

      const registration: Registration = {
        name,
        email,
        partner,
        lookingForPartner,
        lunchSat,
        lunchSun,
        allergies: (body.allergies || "").trim().slice(0, 500),
        court,
        extraDiscs,
        fridayPickup: !!body.fridayPickup,
        publishName: !!body.publishName,
        totalCost,
        waiver: true,
        registeredAt: new Date().toISOString(),
      };

      await env.REGISTRATIONS.put(`reg:${email}`, JSON.stringify(registration));

      // Update index
      const indexRaw = await env.REGISTRATIONS.get("reg:_index");
      const index: string[] = indexRaw ? JSON.parse(indexRaw) : [];
      index.push(email);
      await env.REGISTRATIONS.put("reg:_index", JSON.stringify(index));

      // Send confirmation email (fire-and-forget — don't block registration on email failure)
      try {
        await sendConfirmationEmail(registration, env);
      } catch {
        // Log but don't fail the registration
        console.error("Failed to send confirmation email to", email);
      }

      return jsonResponse({ success: true, message: "Registration confirmed" }, 200, origin);
    }

    if (url.pathname === "/registrations" && request.method === "GET") {
      const auth = request.headers.get("Authorization");
      if (auth !== `Bearer ${env.ADMIN_TOKEN}`) {
        return jsonResponse({ error: "Unauthorized" }, 401, origin);
      }

      const indexRaw = await env.REGISTRATIONS.get("reg:_index");
      const index: string[] = indexRaw ? JSON.parse(indexRaw) : [];

      const registrations = await Promise.all(
        index.map(async (email) => {
          const raw = await env.REGISTRATIONS.get(`reg:${email}`);
          return raw ? JSON.parse(raw) : null;
        })
      );

      return jsonResponse(registrations.filter(Boolean), 200, origin);
    }

    return jsonResponse({ error: "Not found" }, 404, origin);
  },
};
