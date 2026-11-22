/* Pen & Ink Lab 서비스 워커. 사용자 데이터(IndexedDB)는 건드리지 않는다. */
const CACHE = "pil2-v1.120.0-recovered-source";
const ASSETS = [
  "./",
  "./assets/app.css",
  "./assets/app.js",
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
      .then((c) => c.addAll(ASSETS))
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
