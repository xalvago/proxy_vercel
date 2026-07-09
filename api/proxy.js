/**
 * Reverse proxy (Vercel Edge Function) para embeber una Web App de
 * Google Apps Script en un iframe bajo tu propio dominio.
 *
 * Solo necesitas 1 registro CNAME en tu DNS actual, no mover el dominio.
 */

export const config = { runtime: "edge" };

const GAS_EXEC_URL =
  "https://script.google.com/macros/s/AKfycbxXHaLP5Nm7NAXxNskc5nsThgRoIkFPhaw3QQrLmtciwKroxdmSWiDdq-bP9U36B4LD/exec";

const GAS_ASSET_HOST = "https://script.google.com";

export default async function handler(request) {
  const incomingUrl = new URL(request.url);

  // La raíz ("/") es la propia app -> va contra el exec.
  // Cualquier otra ruta (JS, CSS, recursos internos que pide la app tras
  // cargar) -> se pide la MISMA ruta pero contra script.google.com,
  // preservando path + querystring. Antes esto se ignoraba y siempre se
  // devolvía el HTML del exec disfrazado de JS/CSS -> página en blanco.
  let targetUrl;
  if (incomingUrl.pathname === "/" || incomingUrl.pathname === "/api/proxy") {
    targetUrl = new URL(GAS_EXEC_URL);
    incomingUrl.searchParams.forEach((value, key) => {
      targetUrl.searchParams.set(key, value);
    });
  } else {
    targetUrl = new URL(
      GAS_ASSET_HOST + incomingUrl.pathname + incomingUrl.search
    );
  }

  const init = {
    method: request.method,
    headers: cleanRequestHeaders(request.headers),
    redirect: "follow", // sigue el 302 a googleusercontent.com en el servidor, invisible para el navegador
  };

  if (!["GET", "HEAD"].includes(request.method)) {
    init.body = await request.arrayBuffer();
  }

  const upstreamResponse = await fetch(targetUrl.toString(), init);

  const contentType = upstreamResponse.headers.get("content-type") || "";
  const isTextual =
    contentType.includes("text/html") ||
    contentType.includes("javascript") ||
    contentType.includes("text/css") ||
    contentType.includes("json");

  let body;
  if (isTextual) {
    let text = await upstreamResponse.text();
    text = rewriteGoogleUrls(text, incomingUrl.origin);
    body = text;
  } else {
    body = upstreamResponse.body; // binarios (imágenes, etc.) pasan tal cual
  }

  const newHeaders = new Headers(upstreamResponse.headers);
  newHeaders.delete("X-Frame-Options");
  newHeaders.delete("Content-Security-Policy");
  newHeaders.delete("Set-Cookie");
  newHeaders.set("Access-Control-Allow-Origin", "*");

  return new Response(body, {
    status: upstreamResponse.status,
    headers: newHeaders,
  });
}

function cleanRequestHeaders(headers) {
  const h = new Headers(headers);
  h.delete("cookie");
  h.delete("host");
  return h;
}

function rewriteGoogleUrls(text, proxyOrigin) {
  let out = text;
  out = out.replace(/https:\/\/script\.googleusercontent\.com/g, proxyOrigin);
  out = out.replace(/https:\/\/script\.google\.com/g, proxyOrigin);
  out = out.replace(
    /https:\/\/n-[\w-]+\.script\.googleusercontent\.com/g,
    proxyOrigin
  );
  return out;
}
