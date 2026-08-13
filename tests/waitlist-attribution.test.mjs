import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const sourcePath = new URL("../flowlive-public-worker.js", import.meta.url);
const source = await readFile(sourcePath, "utf8");
const transformed = source.replace("export default {", "globalThis.workerModule = {");
const context = {
  URL,
  URLSearchParams,
  Request,
  Response,
  Headers,
  fetch: async () => new Response("<html>Documento público</html>", { status: 200, headers: { "Content-Type": "text/html" } }),
  console,
  globalThis: {},
};
context.globalThis = context;
vm.runInNewContext(transformed, context, { filename: "flowlive-public-worker.js" });

function createD1Stub() {
  const calls = [];
  return {
    calls,
    prepare(statement) {
      return {
        bind(...params) {
          calls.push({ statement, params });
          return {
            first: async () => null,
            run: async () => ({ meta: { last_row_id: 42 } }),
          };
        },
      };
    },
  };
}

function createInternalLeadsDb() {
  return {
    prepare() {
      return {
        bind() {
          return {
            all: async () => ({ results: [] }),
            run: async () => ({ meta: { changes: 1 } }),
          };
        },
      };
    },
  };
}

const db = createD1Stub();
const request = new Request("https://flow-live.com/api/waitlist", {
  method: "POST",
  headers: { Origin: "https://flow-live.com", "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "Ana Souza",
    company: "Marca Aurora",
    email: "ana@aurora.com",
    whatsapp: "(11) 99999-9999",
    liveVolume: "3_a_8",
    contactConsent: true,
    utm_source: "meta",
    utm_medium: "paid_social",
    utm_campaign: "piloto_agosto",
    utm_content: "video_checkout",
    utm_term: "live-commerce",
    fbclid: "fb.1.123",
    entryUrl: "https://flow-live.com/?utm_source=meta&utm_medium=paid_social&utm_campaign=piloto_agosto&utm_content=video_checkout&utm_term=live-commerce&fbclid=fb.1.123&irrelevante=remover",
    referrer: "https://www.instagram.com/reel/exemplo/?should=remove",
  }),
});

const response = await context.workerModule.fetch(request, { LEADS_DB: db });
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), { accepted: true });

const insert = db.calls.find(({ statement }) => statement.startsWith("INSERT INTO waitlist_leads"));
assert.ok(insert, "A submissão deve gerar inserção do lead.");
assert.deepEqual(insert.params.slice(7, 15), [
  "meta",
  "paid_social",
  "piloto_agosto",
  "video_checkout",
  "live-commerce",
  "fb.1.123",
  "https://flow-live.com/?utm_source=meta&utm_medium=paid_social&utm_campaign=piloto_agosto&utm_content=video_checkout&utm_term=live-commerce&fbclid=fb.1.123",
  "https://www.instagram.com/reel/exemplo/",
]);

const untrustedDb = createD1Stub();
const untrustedResponse = await context.workerModule.fetch(new Request("https://flow-live.com/api/waitlist", {
  method: "POST",
  headers: { Origin: "https://flow-live.com", "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "Bia Lima",
    company: "Marca B",
    email: "bia@marca.com",
    whatsapp: "(11) 98888-8888",
    liveVolume: "até_2",
    contactConsent: true,
    utm_source: "meta",
    entryUrl: "https://site-nao-confiavel.example/?utm_source=forjado",
    referrer: "javascript:alert(1)",
  }),
}), { LEADS_DB: untrustedDb });
assert.equal(untrustedResponse.status, 200);
const untrustedInsert = untrustedDb.calls.find(({ statement }) => statement.startsWith("INSERT INTO waitlist_leads"));
assert.equal(untrustedInsert.params[13], null, "A URL de entrada precisa pertencer à Landing FlowLive.");
assert.equal(untrustedInsert.params[14], null, "Referenciadores com protocolo inseguro não podem ser persistidos.");

const internalDb = createInternalLeadsDb();
const internalResponse = await context.workerModule.fetch(new Request("https://flow-live.com/api/internal/leads?status=new", {
  headers: { "X-FlowLive-Leads-Secret": "s".repeat(32) },
}), { LEADS_DB: internalDb, LEADS_PUBLIC_SYNC_SECRET: "s".repeat(32) });
assert.equal(internalResponse.status, 200, "O endpoint administrativo deve aceitar o segredo configurado.");
assert.deepEqual(await internalResponse.json(), { leads: [] });

const deniedResponse = await context.workerModule.fetch(new Request("https://flow-live.com/api/internal/leads"), {
  LEADS_DB: internalDb,
  LEADS_PUBLIC_SYNC_SECRET: "s".repeat(32),
});
assert.equal(deniedResponse.status, 401, "O endpoint administrativo não pode responder sem segredo.");

for (const route of ["/privacidade", "/termos"]) {
  const documentResponse = await context.workerModule.fetch(new Request(`https://flow-live.com${route}`), {});
  assert.equal(documentResponse.status, 200, `${route} precisa estar disponível publicamente.`);
  assert.equal(documentResponse.headers.get("Content-Type"), "text/html; charset=UTF-8");
}

const privatePanelResponse = await context.workerModule.fetch(new Request("https://flow-live.com/admin?from=landing"), {});
assert.equal(privatePanelResponse.status, 302, "A rota privada no domínio público deve orientar o usuário, sem 404.");
assert.equal(privatePanelResponse.headers.get("Location"), "https://flowliveapp-ki8zugp8.manus.space/admin?from=landing");

console.log("waitlist-attribution: ok");
