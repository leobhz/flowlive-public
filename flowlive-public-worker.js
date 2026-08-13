const SITE_ORIGIN = "https://raw.githubusercontent.com";
const SITE_BASE_PATH = "/leobhz/flowlive-public/main";
const ALLOWED_ORIGINS = new Set(["https://flow-live.com", "https://www.flow-live.com"]);
const ALLOWED_LIVE_VOLUMES = new Set(["até_2", "3_a_8", "9_ou_mais"]);
const TRACKING_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid"];
const LEAD_STATUSES = new Set(["new", "contacted", "diagnosis", "qualified", "onboarding", "lost"]);
const LEAD_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

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
    headers.set("Content-Type", "text/html; charset=UTF-8");
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

function normalizeTrackingValue(value, maxLength = 255) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : null;
}

function normalizeLandingUrl(value) {
  const raw = normalizeTrackingValue(value, 2_000);
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !ALLOWED_ORIGINS.has(url.origin)) return null;

    const params = new URLSearchParams();
    for (const field of TRACKING_FIELDS) {
      const tracked = normalizeTrackingValue(url.searchParams.get(field));
      if (tracked) params.set(field, tracked);
    }
    const query = params.toString();
    return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return null;
  }
}

function normalizeReferrer(value) {
  const raw = normalizeTrackingValue(value, 2_000);
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (!["https:", "http:"].includes(url.protocol)) return null;
    return `${url.origin}${url.pathname}`.slice(0, 1_000);
  } catch {
    return null;
  }
}

function getAttribution(payload) {
  const attribution = {};
  for (const field of TRACKING_FIELDS) {
    attribution[field] = normalizeTrackingValue(payload?.[field]);
  }
  attribution.entryUrl = normalizeLandingUrl(payload?.entryUrl);
  attribution.referrer = normalizeReferrer(payload?.referrer);
  return attribution;
}

function secretsMatch(expected, received) {
  if (typeof expected !== "string" || typeof received !== "string" || expected.length < 32 || expected.length !== received.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ received.charCodeAt(index);
  return difference === 0;
}

function authorizedForLeads(request, env) {
  return secretsMatch(env.LEADS_PUBLIC_SYNC_SECRET, request.headers.get("X-FlowLive-Leads-Secret") || "");
}

function normalizeWorkflowText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : null;
}

function leadRow(row) {
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    email: row.email,
    whatsapp: row.whatsapp,
    liveVolume: row.live_volume,
    emailStatus: row.email_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.lead_status,
    owner: row.owner,
    priority: row.priority,
    nextContactAt: row.next_contact_at,
    notes: row.notes,
    utmSource: row.utm_source,
    utmMedium: row.utm_medium,
    utmCampaign: row.utm_campaign,
    utmContent: row.utm_content,
    utmTerm: row.utm_term,
    fbclid: row.fbclid,
    entryUrl: row.entry_url,
    referrer: row.referrer,
  };
}

async function listInternalLeads(env, url) {
  if (!env.LEADS_DB) return json({ error: "Base de leads temporariamente indisponível." }, 503);

  const filters = [];
  const values = [];
  const addFilter = (sql, value) => { filters.push(sql); values.push(value); };
  const query = normalizeWorkflowText(url.searchParams.get("q"), 120);
  const status = normalizeWorkflowText(url.searchParams.get("status"), 24);
  const priority = normalizeWorkflowText(url.searchParams.get("priority"), 24);
  const utmSource = normalizeTrackingValue(url.searchParams.get("utm_source"));
  const utmCampaign = normalizeTrackingValue(url.searchParams.get("utm_campaign"));

  if (query) {
    const term = `%${query.toLowerCase()}%`;
    filters.push("(LOWER(name) LIKE ? OR LOWER(company) LIKE ? OR LOWER(email) LIKE ? OR whatsapp LIKE ?)");
    values.push(term, term, term, `%${query}%`);
  }
  if (status && LEAD_STATUSES.has(status)) addFilter("lead_status = ?", status);
  if (priority && LEAD_PRIORITIES.has(priority)) addFilter("priority = ?", priority);
  if (utmSource) addFilter("utm_source = ?", utmSource);
  if (utmCampaign) addFilter("utm_campaign = ?", utmCampaign);

  const requestedLimit = Number(url.searchParams.get("limit") || 100);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 250) : 100;
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const statement = env.LEADS_DB.prepare(`SELECT id, name, company, email, whatsapp, live_volume, email_status, created_at, updated_at, lead_status, owner, priority, next_contact_at, notes, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, entry_url, referrer FROM waitlist_leads ${where} ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END, created_at DESC LIMIT ?`);
  const result = await statement.bind(...values, limit).all();
  return json({ leads: (result.results || []).map(leadRow) });
}

async function updateInternalLead(request, env, id) {
  if (!env.LEADS_DB) return json({ error: "Base de leads temporariamente indisponível." }, 503);
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return json({ error: "Atualização inválida." }, 400);

  const updates = [];
  const values = [];
  const set = (column, value) => { updates.push(`${column} = ?`); values.push(value); };
  if (typeof payload.status === "string" && LEAD_STATUSES.has(payload.status)) set("lead_status", payload.status);
  if (typeof payload.priority === "string" && LEAD_PRIORITIES.has(payload.priority)) set("priority", payload.priority);
  if (payload.owner === null || typeof payload.owner === "string") set("owner", payload.owner === null ? null : normalizeWorkflowText(payload.owner, 160));
  if (payload.nextContactAt === null || typeof payload.nextContactAt === "string") {
    const nextContactAt = payload.nextContactAt === null ? null : normalizeWorkflowText(payload.nextContactAt, 64);
    if (nextContactAt && Number.isNaN(Date.parse(nextContactAt))) return json({ error: "Próximo contato inválido." }, 400);
    set("next_contact_at", nextContactAt);
  }
  if (payload.notes === null || typeof payload.notes === "string") set("notes", payload.notes === null ? null : normalizeWorkflowText(payload.notes, 5_000));
  if (!updates.length) return json({ error: "Nenhuma alteração comercial válida foi informada." }, 400);

  const now = new Date().toISOString();
  updates.push("updated_at = ?");
  values.push(now, id);
  const result = await env.LEADS_DB.prepare(`UPDATE waitlist_leads SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
  if (!result.meta.changes) return json({ error: "Lead não encontrado." }, 404);
  return json({ updated: true, id });
}

async function handleInternalLeads(request, env, url) {
  if (!authorizedForLeads(request, env)) return json({ error: "Não autorizado." }, 401);
  if (request.method === "GET" && url.pathname === "/api/internal/leads") return listInternalLeads(env, url);
  const match = url.pathname.match(/^\/api\/internal\/leads\/(\d+)$/);
  if (request.method === "PATCH" && match) return updateInternalLead(request, env, Number(match[1]));
  return json({ error: "Método não permitido." }, 405);
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

  return { name, company, email, whatsapp, liveVolume, contactConsent, ...getAttribution(payload) };
}

async function sendWelcomeEmail(env, lead) {
  if (!env.RESEND_API_KEY) return { status: "not_configured", providerId: null };

  const safeFirstName = escapeHtml(lead.name.trim().split(/\s+/)[0] || "");
  const safeCompany = escapeHtml(lead.company || "sua marca");
  const learnMoreUrl = "https://conheca.flow-live.com";
  const logoUrl = "https://files.manuscdn.com/user_upload_by_module/session_file/310519663507895753/JjlRXdJtAaAgEHBM.png";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "FlowLive <boas-vindas@flow-live.com>",
      to: [lead.email],
      subject: "Você entrou na lista de espera da FlowLive",
      html: `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#09070d;color:#ffffff;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#09070d"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;overflow:hidden;background:#120e1b;border:1px solid #30273a;border-radius:24px"><tr><td style="padding:30px 34px 34px;background:#1b1230;background-image:linear-gradient(138deg,#20143a 0%,#120e1b 58%,#2f1715 100%)"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-right:9px;vertical-align:middle"><img src="${logoUrl}" width="28" height="28" alt="Logo FlowLive" style="display:block;width:28px;height:28px;border:0;border-radius:8px;object-fit:contain"></td><td style="vertical-align:middle;color:#ffffff;font-size:16px;line-height:28px;font-weight:700;letter-spacing:-0.4px">FlowLive</td></tr></table><div style="display:inline-block;margin-top:38px;padding:7px 10px;border:1px solid #5d463b;border-radius:999px;background:#362115;color:#ffc17d;font-size:10px;line-height:12px;font-weight:700;letter-spacing:1.2px">LISTA DE ESPERA CONFIRMADA</div><h1 style="margin:15px 0 0;color:#ffffff;font-size:34px;line-height:1.1;letter-spacing:-1.7px">Olá, ${safeFirstName}.<br>Sua marca entrou na próxima etapa.</h1><p style="margin:17px 0 0;max-width:430px;color:#d6cfe0;font-size:16px;line-height:1.6">Recebemos o interesse da <strong style="color:#ffffff">${safeCompany}</strong>. Agora vamos entender o momento da sua operação e avaliar a melhor forma de colocar sua marca ao vivo.</p></td></tr><tr><td style="padding:31px 34px 36px"><p style="margin:0 0 7px;color:#ffad5a;font-size:10px;line-height:14px;font-weight:700;letter-spacing:1.4px">O QUE ACONTECE AGORA</p><h2 style="margin:0;color:#ffffff;font-size:21px;line-height:1.3;letter-spacing:-0.7px">Uma jornada simples, pensada para vender.</h2><p style="margin:10px 0 22px;color:#bdb5c9;font-size:14px;line-height:1.65">A FlowLive une live, checkout, inteligência e relacionamento em uma operação que continua sendo da sua marca.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #30273a;border-radius:16px"><tr><td style="padding:16px;border-bottom:1px solid #30273a"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="width:38px;vertical-align:top"><div style="width:26px;height:26px;line-height:26px;text-align:center;border-radius:9px;background:#2c2048;color:#c8acff;font-size:11px;font-weight:700">01</div></td><td><strong style="display:block;color:#f9f6ff;font-size:13px;line-height:18px">Seu cadastro foi confirmado</strong><span style="display:block;margin-top:3px;color:#9f96ae;font-size:12px;line-height:18px">Guardamos seus dados para retornar pelo canal que você escolheu.</span></td></tr></table></td></tr><tr><td style="padding:16px;border-bottom:1px solid #30273a"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="width:38px;vertical-align:top"><div style="width:26px;height:26px;line-height:26px;text-align:center;border-radius:9px;background:#2c2048;color:#c8acff;font-size:11px;font-weight:700">02</div></td><td><strong style="display:block;color:#f9f6ff;font-size:13px;line-height:18px">Avaliamos o perfil da operação</strong><span style="display:block;margin-top:3px;color:#9f96ae;font-size:12px;line-height:18px">Entendemos o momento da marca, produtos e volume de lives esperado.</span></td></tr></table></td></tr><tr><td style="padding:16px"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="width:38px;vertical-align:top"><div style="width:26px;height:26px;line-height:26px;text-align:center;border-radius:9px;background:#2c2048;color:#c8acff;font-size:11px;font-weight:700">03</div></td><td><strong style="display:block;color:#f9f6ff;font-size:13px;line-height:18px">Falamos sobre o melhor próximo passo</strong><span style="display:block;margin-top:3px;color:#9f96ae;font-size:12px;line-height:18px">Quando houver disponibilidade de onboarding, nosso time entra em contato.</span></td></tr></table></td></tr></table><table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:26px"><tr><td style="border-radius:10px;background:#ff8a19"><a href="${learnMoreUrl}" style="display:inline-block;padding:13px 17px;color:#1b0b04;font-size:13px;font-weight:700;text-decoration:none">Conhecer a experiência FlowLive →</a></td></tr></table><p style="margin:18px 0 0;color:#a79eaf;font-size:12px;line-height:1.55"><strong style="color:#e6e0ed">Sem promessas genéricas.</strong> Abrimos novas vagas conforme a disponibilidade de onboarding, para que cada marca entre com a estrutura certa.</p></td></tr><tr><td style="padding:24px 34px 29px;border-top:1px solid #30273a;background:#0e0b14"><p style="margin:0;color:#81788d;font-size:11px;line-height:1.6"><strong style="color:#c6becf">FlowLive</strong> · Live commerce white-label para marcas que querem transformar atenção ao vivo em relacionamento e vendas.</p><p style="margin:8px 0 0;color:#81788d;font-size:11px;line-height:1.6">Você recebeu esta mensagem porque solicitou informações da FlowLive.</p></td></tr></table></td></tr></table></body></html>`,
      text: `Olá, ${lead.name}. Recebemos o interesse da ${lead.company || "sua marca"}. Seu cadastro na lista de espera foi confirmado. Agora vamos avaliar o momento da sua operação e entraremos em contato quando houver disponibilidade de onboarding. Conheça a experiência FlowLive: ${learnMoreUrl}`,
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
    "INSERT INTO waitlist_leads (name, company, email, whatsapp, live_volume, contact_consent, consent_at, source, email_status, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, entry_url, referrer, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'flow-live.com', 'pending', ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?7, ?7)",
  )
    .bind(lead.name, lead.company, lead.email, lead.whatsapp, lead.liveVolume, 1, now, lead.utm_source, lead.utm_medium, lead.utm_campaign, lead.utm_content, lead.utm_term, lead.fbclid, lead.entryUrl, lead.referrer)
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
    if (url.pathname.startsWith("/api/internal/leads")) return handleInternalLeads(request, env, url);
    if (url.pathname === "/api/waitlist") return handleWaitlist(request, env);
    if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });

    const publicDocuments = { "/privacidade": "/privacidade.html", "/termos": "/termos.html" };
    const path = url.pathname === "/" ? "/index.html" : (publicDocuments[url.pathname] || url.pathname);
    const upstreamUrl = new URL(`${SITE_BASE_PATH}${path}`, SITE_ORIGIN);
    const upstreamResponse = await fetch(new Request(upstreamUrl, {
      method: request.method,
      headers: { Accept: request.headers.get("Accept") || "*/*", "User-Agent": "FlowLivePublicLanding/1.0" },
    }));
    return withSecurityHeaders(upstreamResponse, path.endsWith(".html"));
  },
};
