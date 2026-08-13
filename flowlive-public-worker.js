const SITE_ORIGIN = "https://raw.githubusercontent.com";
const SITE_BASE_PATH = "/leobhz/flowlive-public/main";
const ALLOWED_ORIGINS = new Set(["https://flow-live.com", "https://www.flow-live.com"]);
const ALLOWED_LIVE_VOLUMES = new Set(["até_2", "3_a_8", "9_ou_mais"]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function withSecurityHeaders(response, isHtml = false) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (isHtml) {
    headers.set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self' data:; base-uri 'self'; form-action 'self'");
  }
  return new Response(response.body, { status: response.status, headers });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function waitlistValidation(payload) {
  const name = normalizeText(payload?.name);
  const company = normalizeText(payload?.company);
  const email = normalizeText(payload?.email).toLowerCase();
  const whatsapp = normalizeText(payload?.whatsapp);
  const liveVolume = normalizeText(payload?.liveVolume);
  const contactConsent = payload?.contactConsent === true;
  const honeypot = normalizeText(payload?.website);

  if (honeypot) return { error: "Não foi possível processar o cadastro." };
  if (name.length < 2 || company.length < 2 || !validEmail(email)) return { error: "Revise nome, marca e e-mail antes de continuar." };
  if (whatsapp.replace(/\D/g, "").length < 10) return { error: "Informe um WhatsApp válido para contato." };
  if (!ALLOWED_LIVE_VOLUMES.has(liveVolume)) return { error: "Selecione a faixa mensal de lives." };
  if (!contactConsent) return { error: "É necessário autorizar o contato sobre a lista de espera." };

  return { name, company, email, whatsapp, liveVolume, contactConsent };
}

async function sendWelcomeEmail(env, lead) {
  if (!env.RESEND_API_KEY) return { status: "not_configured", providerId: null };

  const safeName = escapeHtml(lead.name);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "FlowLive <boas-vindas@flow-live.com>",
      to: [lead.email],
      subject: "Recebemos seu interesse na FlowLive",
      html: `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#08080d;color:#f5f2fa;font-family:Arial,sans-serif"><div style="max-width:600px;margin:0 auto;padding:36px 24px"><p style="margin:0 0 18px;color:#ffb060;font-size:12px;font-weight:700;letter-spacing:1.2px">FLOWLIVE · LISTA DE ESPERA</p><h1 style="margin:0 0 18px;font-size:30px;line-height:1.05">Olá, ${safeName}.<br>Seu interesse foi recebido.</h1><p style="color:#d0cadb;line-height:1.6">A FlowLive foi pensada para transformar audiência em conversa, lead próprio e próxima venda — com a sua marca no centro.</p><p style="color:#d0cadb;line-height:1.6">Nossa equipe avalia cada entrada conforme a disponibilidade de onboarding. Quando houver aderência e capacidade, retornaremos pelo canal informado.</p><a href="https://conheca.flow-live.com" style="display:inline-block;margin-top:12px;padding:13px 18px;background:#ff7a18;border-radius:9px;color:#fff;text-decoration:none;font-weight:700">Conhecer a experiência FlowLive</a><p style="margin-top:30px;color:#9d95aa;font-size:12px;line-height:1.5">Você recebeu este e-mail porque autorizou o contato sobre a lista de espera da FlowLive.</p></div></body></html>`,
      text: `Olá, ${lead.name}. Recebemos seu interesse na lista de espera da FlowLive. Nossa equipe avalia cada entrada conforme a disponibilidade de onboarding. Conheça a experiência: https://conheca.flow-live.com`,
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Resend ${response.status}`);
  return { status: "sent", providerId: result?.id || null };
}

async function handleWaitlist(request, env) {
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  const origin = request.headers.get("Origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "Origem não autorizada." }, 403);
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 10_000) return json({ error: "Solicitação inválida." }, 413);

  const payload = await request.json().catch(() => null);
  const lead = waitlistValidation(payload);
  if (lead.error) return json({ error: lead.error }, 400);
  if (!env.LEADS_DB) return json({ error: "Captação temporariamente indisponível." }, 503);

  const existing = await env.LEADS_DB.prepare("SELECT id FROM waitlist_leads WHERE email = ?1 LIMIT 1")
    .bind(lead.email)
    .first();
  if (existing) return json({ accepted: true, duplicate: true });

  const now = new Date().toISOString();
  const insert = await env.LEADS_DB.prepare(
    "INSERT INTO waitlist_leads (name, company, email, whatsapp, live_volume, contact_consent, consent_at, source, email_status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'flow-live.com', 'pending', ?7, ?7)",
  )
    .bind(lead.name, lead.company, lead.email, lead.whatsapp, lead.liveVolume, 1, now)
    .run();

  const leadId = insert.meta.last_row_id;
  try {
    const email = await sendWelcomeEmail(env, lead);
    await env.LEADS_DB.prepare(
      "UPDATE waitlist_leads SET email_status = ?1, email_provider_id = ?2, email_sent_at = CASE WHEN ?1 = 'sent' THEN ?3 ELSE NULL END, updated_at = ?3 WHERE id = ?4",
    )
      .bind(email.status, email.providerId, now, leadId)
      .run();
  } catch (error) {
    console.error("[Waitlist] Welcome email delivery failed", error);
    await env.LEADS_DB.prepare("UPDATE waitlist_leads SET email_status = 'failed', updated_at = ?1 WHERE id = ?2")
      .bind(now, leadId)
      .run();
  }

  return json({ accepted: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/waitlist") return handleWaitlist(request, env);
    if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });

    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const upstreamUrl = new URL(`${SITE_BASE_PATH}${path}`, SITE_ORIGIN);
    const upstreamResponse = await fetch(new Request(upstreamUrl, {
      method: request.method,
      headers: { Accept: request.headers.get("Accept") || "*/*", "User-Agent": "FlowLivePublicLanding/1.0" },
    }));
    return withSecurityHeaders(upstreamResponse, path.endsWith(".html"));
  },
};
