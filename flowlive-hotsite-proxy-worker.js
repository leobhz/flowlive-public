const APP_ORIGIN = "https://flowliveapp-ki8zugp8.manus.space";
const PUBLIC_LIVE_PATH = /^\/live\/\d+(?:\/historico)?\/?$/;
const PUBLIC_AUTH_PATH = /^\/api\/oauth\/(?:google|callback)(?:\/.*)?$/;
const PUBLIC_DATA_PATH = /^\/api\/(?:trpc|ws)(?:\/.*)?$/;
const PUBLIC_ASSET_PATH = /^\/(?:assets|manus-storage|manifest\.json|sw\.js|favicon\.ico)(?:\/.*)?$/;

function isAllowedPath(pathname) {
  return (
    PUBLIC_LIVE_PATH.test(pathname) ||
    PUBLIC_AUTH_PATH.test(pathname) ||
    PUBLIC_DATA_PATH.test(pathname) ||
    PUBLIC_ASSET_PATH.test(pathname)
  );
}

export default {
  async fetch(request) {
    const incomingUrl = new URL(request.url);

    if (!isAllowedPath(incomingUrl.pathname)) {
      return new Response("Página não encontrada", {
        status: 404,
        headers: {
          "Content-Type": "text/plain; charset=UTF-8",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const upstreamUrl = new URL(incomingUrl.pathname + incomingUrl.search, APP_ORIGIN);
    const headers = new Headers(request.headers);
    headers.set("X-Forwarded-Host", incomingUrl.host);
    headers.set("X-Forwarded-Proto", "https");
    headers.set("X-FlowLive-Public-Hotsite", "1");

    const upstreamRequest = new Request(upstreamUrl, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    });

    const response = await fetch(upstreamRequest);
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("X-Content-Type-Options", "nosniff");
    responseHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");
    responseHeaders.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  },
};
