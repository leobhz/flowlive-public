const SITE_ORIGIN = "https://raw.githubusercontent.com";
const SITE_BASE_PATH = "/leobhz/flowlive-public/main";
const MAX_BODY_BYTES = 12_000;
const MAX_MESSAGE_LENGTH = 500;

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

function secured(response, isHtml = false) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (isHtml) {
    headers.set("Content-Type", "text/html; charset=UTF-8");
    headers.set("Content-Security-Policy", "default-src 'self'; frame-src https://customer-i4uy8ubvrde1t8js.cloudflarestream.com; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'self'; form-action 'self'");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function cleanText(value, limit = 255) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, limit) : "";
}

function validLiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id < 2_147_483_647 ? id : null;
}

function validSession(value) {
  return typeof value === "string" && /^s_[a-zA-Z0-9_-]{8,96}$/.test(value) ? value : null;
}

function constantTimeEquals(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function publicLiveRow(row) {
  if (!row) return null;
  return {
    liveId: row.live_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    tenantLogo: row.tenant_logo,
    title: row.title,
    status: row.status,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    playerUid: row.player_uid,
    accentColor: row.accent_color,
    surfaceColor: row.surface_color,
  };
}

async function parseBody(request) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_BODY_BYTES) return null;
  return request.json().catch(() => null);
}

async function getLive(env, liveId) {
  return env.HOTSITE_DB.prepare("SELECT * FROM public_lives WHERE live_id = ?1 LIMIT 1").bind(liveId).first();
}

async function getProducts(env, liveId) {
  const result = await env.HOTSITE_DB.prepare(
    "SELECT public_product_id AS id, name, price, image_url AS imageUrl, checkout_url AS checkoutUrl, display_order AS displayOrder, is_featured AS isFeatured, is_available AS isAvailable FROM public_products WHERE live_id = ?1 ORDER BY is_featured DESC, display_order ASC"
  ).bind(liveId).all();
  return result.results ?? [];
}

async function rateLimited(env, sessionId, scope) {
  const since = new Date(Date.now() - 12_000).toISOString();
  const result = await env.HOTSITE_DB.prepare(
    "SELECT COUNT(*) AS count FROM public_events WHERE session_id = ?1 AND event_type = ?2 AND created_at >= ?3"
  ).bind(sessionId, scope, since).first();
  return Number(result?.count ?? 0) >= 8;
}

async function refreshSession(env, liveId, sessionId, profileId = null) {
  const now = new Date().toISOString();
  await env.HOTSITE_DB.prepare(
    "INSERT INTO public_sessions (session_id, live_id, public_profile_id, last_seen_at, created_at) VALUES (?1, ?2, ?3, ?4, ?4) ON CONFLICT(session_id) DO UPDATE SET live_id = excluded.live_id, public_profile_id = COALESCE(excluded.public_profile_id, public_sessions.public_profile_id), last_seen_at = excluded.last_seen_at"
  ).bind(sessionId, liveId, profileId, now).run();
}

async function publicLive(request, env, liveId) {
  const live = await getLive(env, liveId);
  if (!live) return json({ error: "Live não encontrada." }, 404);
  return json({ live: publicLiveRow(live), products: await getProducts(env, liveId) });
}

async function publicMessages(request, env, liveId) {
  const url = new URL(request.url);
  const after = Math.max(0, Number(url.searchParams.get("after") || 0));
  const result = await env.HOTSITE_DB.prepare(
    "SELECT id, display_name AS userName, avatar_url AS avatarUrl, message, sentiment, is_intent_to_buy AS isIntentToBuy, created_at AS createdAt FROM public_messages WHERE live_id = ?1 AND is_approved = 1 AND id > ?2 ORDER BY id ASC LIMIT 80"
  ).bind(liveId, after).all();
  return json({ messages: result.results ?? [] });
}

async function createMessage(request, env, liveId) {
  const payload = await parseBody(request);
  const sessionId = validSession(payload?.sessionId);
  const displayName = cleanText(payload?.displayName, 60);
  const message = cleanText(payload?.message, MAX_MESSAGE_LENGTH);
  if (!sessionId || displayName.length < 2 || message.length < 1) return json({ error: "Informe seu nome e uma mensagem válida." }, 400);
  if (await rateLimited(env, sessionId, "heartbeat")) return json({ error: "Aguarde alguns segundos antes de enviar outra mensagem." }, 429);
  const live = await getLive(env, liveId);
  if (!live || live.status !== "live") return json({ error: "O chat está disponível apenas durante a live." }, 409);
  const now = new Date().toISOString();
  const intent = /\b(comprar|quero|tem (no|na)|qual.*preço|quanto custa|como pago)\b/i.test(message) ? 1 : 0;
  const sentiment = intent ? "high_intent" : /\b(linda|amei|adorei|maravilhosa|perfeito)\b/i.test(message) ? "positive" : "neutral";
  await refreshSession(env, liveId, sessionId, cleanText(payload?.profileId, 96) || null);
  const inserted = await env.HOTSITE_DB.prepare(
    "INSERT INTO public_messages (live_id, session_id, public_profile_id, display_name, avatar_url, message, sentiment, is_intent_to_buy, is_approved, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?9)"
  ).bind(liveId, sessionId, cleanText(payload?.profileId, 96) || null, displayName, cleanText(payload?.avatarUrl, 512) || null, message, sentiment, intent, now).run();
  return json({ id: inserted.meta.last_row_id, deliveryStatus: "published", sentiment, isIntentToBuy: intent, createdAt: now }, 201);
}

async function trackEvent(request, env, liveId) {
  const payload = await parseBody(request);
  const sessionId = validSession(payload?.sessionId);
  const eventType = cleanText(payload?.eventType, 32);
  const allowed = new Set(["heartbeat", "favorite", "checkout_start", "product_view", "login_prompt", "login_complete"]);
  if (!sessionId || !allowed.has(eventType)) return json({ error: "Evento inválido." }, 400);
  if (await rateLimited(env, sessionId, eventType)) return json({ error: "Muitas interações em pouco tempo." }, 429);
  const live = await getLive(env, liveId);
  if (!live) return json({ error: "Live não encontrada." }, 404);
  const now = new Date().toISOString();
  const profileId = cleanText(payload?.profileId, 96) || null;
  await refreshSession(env, liveId, sessionId, profileId);
  await env.HOTSITE_DB.prepare(
    "INSERT INTO public_events (live_id, session_id, public_profile_id, event_type, public_product_id, utm_source, utm_medium, utm_campaign, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
  ).bind(liveId, sessionId, profileId, eventType, Number(payload?.productId) || null, cleanText(payload?.utm?.source, 255) || null, cleanText(payload?.utm?.medium, 255) || null, cleanText(payload?.utm?.campaign, 255) || null, now).run();
  const viewerRow = await env.HOTSITE_DB.prepare("SELECT COUNT(*) AS count FROM public_sessions WHERE live_id = ?1 AND last_seen_at >= ?2").bind(liveId, new Date(Date.now() - 90_000).toISOString()).first();
  return json({ ok: true, viewers: Number(viewerRow?.count ?? 0) });
}

function authorizedSync(request, env) {
  const received = request.headers.get("X-FlowLive-Sync-Secret") || "";
  return Boolean(env.SYNC_SECRET) && constantTimeEquals(received, env.SYNC_SECRET);
}

async function syncProjection(request, env) {
  if (!authorizedSync(request, env)) return json({ error: "Não autorizado." }, 401);
  const payload = await parseBody(request);
  if (!payload?.eventId || !payload?.type) return json({ error: "Sincronização inválida." }, 400);
  const eventId = cleanText(payload.eventId, 128);
  const now = new Date().toISOString();
  const known = await env.HOTSITE_DB.prepare("SELECT id FROM public_sync_log WHERE event_id = ?1 LIMIT 1").bind(eventId).first();
  if (known) return json({ ok: true, duplicate: true });
  if (payload.type === "live") {
    const live = payload.live;
    const liveId = validLiveId(live?.liveId);
    if (!liveId || !cleanText(live?.tenantName, 255) || !cleanText(live?.title, 255)) return json({ error: "Live inválida." }, 400);
    await env.HOTSITE_DB.prepare(
      "INSERT INTO public_lives (live_id, tenant_id, tenant_name, tenant_logo, title, status, scheduled_at, started_at, ended_at, player_uid, accent_color, surface_color, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) ON CONFLICT(live_id) DO UPDATE SET tenant_id=excluded.tenant_id, tenant_name=excluded.tenant_name, tenant_logo=excluded.tenant_logo, title=excluded.title, status=excluded.status, scheduled_at=excluded.scheduled_at, started_at=excluded.started_at, ended_at=excluded.ended_at, player_uid=excluded.player_uid, accent_color=excluded.accent_color, surface_color=excluded.surface_color, updated_at=excluded.updated_at"
    ).bind(liveId, Number(live.tenantId), cleanText(live.tenantName, 255), cleanText(live.tenantLogo, 1024) || null, cleanText(live.title, 255), ["scheduled", "live", "ended"].includes(live.status) ? live.status : "scheduled", live.scheduledAt || null, live.startedAt || null, live.endedAt || null, cleanText(live.playerUid, 255) || null, /^#[0-9a-f]{6}$/i.test(live.accentColor || "") ? live.accentColor : "#F4821F", /^#[0-9a-f]{6}$/i.test(live.surfaceColor || "") ? live.surfaceColor : "#0D0D14", now).run();
  } else if (payload.type === "products") {
    const liveId = validLiveId(payload.liveId);
    if (!liveId || !Array.isArray(payload.products)) return json({ error: "Produtos inválidos." }, 400);
    const statements = [env.HOTSITE_DB.prepare("DELETE FROM public_products WHERE live_id = ?1").bind(liveId)];
    for (const [index, product] of payload.products.slice(0, 100).entries()) {
      if (!Number.isInteger(Number(product?.id)) || !cleanText(product?.name, 255) || !cleanText(product?.price, 32)) continue;
      statements.push(env.HOTSITE_DB.prepare(
        "INSERT INTO public_products (public_product_id, live_id, name, price, image_url, checkout_url, display_order, is_featured, is_available, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
      ).bind(Number(product.id), liveId, cleanText(product.name, 255), cleanText(product.price, 32), cleanText(product.imageUrl, 1024) || null, cleanText(product.checkoutUrl, 1024) || null, Number(product.displayOrder) || index, product.isFeatured ? 1 : 0, product.isAvailable === false ? 0 : 1, now));
    }
    await env.HOTSITE_DB.batch(statements);
  } else {
    return json({ error: "Tipo de sincronização não suportado." }, 400);
  }
  await env.HOTSITE_DB.prepare("INSERT INTO public_sync_log (event_id, received_at) VALUES (?1, ?2)").bind(eventId, now).run();
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const liveMatch = url.pathname.match(/^\/api\/live\/(\d+)(?:\/(messages|events))?$/);
    if (request.method === "POST" && url.pathname === "/api/internal/sync") return syncProjection(request, env);
    if (liveMatch) {
      const liveId = validLiveId(liveMatch[1]);
      const section = liveMatch[2];
      if (!liveId) return json({ error: "Live inválida." }, 400);
      if (!section && request.method === "GET") return publicLive(request, env, liveId);
      if (section === "messages" && request.method === "GET") return publicMessages(request, env, liveId);
      if (section === "messages" && request.method === "POST") return createMessage(request, env, liveId);
      if (section === "events" && request.method === "POST") return trackEvent(request, env, liveId);
      return json({ error: "Método não permitido." }, 405);
    }

    if (!['GET', 'HEAD'].includes(request.method)) return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
    const path = /^\/live\/\d+\/?$/.test(url.pathname) ? "/live.html" : url.pathname === "/" ? "/live.html" : url.pathname;
    const upstream = new URL(`${SITE_BASE_PATH}${path}`, SITE_ORIGIN);
    const response = await fetch(new Request(upstream, { method: request.method, headers: { "Accept": request.headers.get("Accept") || "*/*", "User-Agent": "FlowLivePublicHotsite/1.0" } }));
    return secured(response, path.endsWith(".html"));
  },
};
