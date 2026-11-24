/* Pen & Ink Lab 서비스 워커. 사용자 데이터(IndexedDB)는 건드리지 않는다. */
const CACHE = "pil2-v1.136.0-recovered-source";
const ASSETS = [
  "./",
  "./assets/app.css?v=1.136.0",
  "./assets/app.js?v=1.136.0",
  "./icons/favicon-32.png",
  "./icons/favicon-64.png",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/logo-512.webp",
  "./icons/logo-56.webp",
  "./index.html",
  "./manifest.webmanifest",
  "./privacy.html",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then(async (c) => {
        await Promise.all(ASSETS.map(async (asset) => {
          const request = new Request(new URL(asset, self.registration.scope), { cache: "reload" });
          const response = await fetch(request);
          if (!response.ok) throw new Error(`Failed to cache ${asset}: ${response.status}`);
          await c.put(request, response);
        }));
      })
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("pil2-") && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin)
    return;
  if (new URL(req.url).pathname.startsWith(new URL(self.registration.scope).pathname + "api/"))
    return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() =>
            req.mode === "navigate"
              ? caches.match("./index.html")
              : Response.error(),
          ),
    ),
  );
});
