const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_TOKEN_INFO = "https://oauth2.googleapis.com/tokeninfo";
const GOOGLE_REVOKE = "https://oauth2.googleapis.com/revoke";
const DRIVE_APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const SESSION_COOKIE = "pil_sync_session";
const OAUTH_COOKIE = "pil_oauth_state";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const OAUTH_STATE_TTL_SECONDS = 10 * 60;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, private",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });

const redirect = (url, headers = {}) => {
  const responseHeaders = new Headers({ Location: url, "Cache-Control": "no-store" });
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, item));
    else responseHeaders.set(name, value);
  }
  return new Response(null, { status: 302, headers: responseHeaders });
};

function base64url(bytes) {
  if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

const randomToken = (size = 32) => {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return base64url(bytes);
};

async function sha256(value) {
  return base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name)
      return decodeURIComponent(part.slice(index + 1).trim());
  }
  return "";
}

function cookieHeader(value, maxAge = SESSION_TTL_SECONDS) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/api/google; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function clearCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/api/google; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function oauthCookieHeader(value = "") {
  return `${OAUTH_COOKIE}=${encodeURIComponent(value)}; Path=/api/google; Max-Age=${value ? OAUTH_STATE_TTL_SECONDS : 0}; HttpOnly; Secure; SameSite=Lax`;
}

function appOrigin(env) {
  const origin = String(env.APP_ORIGIN || "").replace(/\/$/u, "");
  if (!origin.startsWith("https://")) throw new Error("APP_ORIGIN must use HTTPS");
  return origin;
}

function redirectUri(env) {
  return env.GOOGLE_REDIRECT_URI || `${appOrigin(env)}/api/google/callback`;
}

async function encryptionKey(env) {
  const raw = fromBase64(String(env.TOKEN_ENCRYPTION_KEY || ""));
  if (raw.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptRefreshToken(token, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(env),
    new TextEncoder().encode(token),
  );
  return { cipher: base64url(new Uint8Array(encrypted)), iv: base64url(iv) };
}

async function decryptRefreshToken(cipher, iv, env) {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv) },
    await encryptionKey(env),
    fromBase64(cipher),
  );
  return new TextDecoder().decode(decrypted);
}

async function sessionFor(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const sessionHash = await sha256(token);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.AUTH_DB.prepare(
    "SELECT session_hash, google_sub, refresh_cipher, refresh_iv, expires_at FROM google_sessions WHERE session_hash = ?1 AND expires_at > ?2",
  ).bind(sessionHash, now).first();
  return row || null;
}

async function clearExpiredRows(env) {
  const now = Math.floor(Date.now() / 1000);
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare("DELETE FROM oauth_states WHERE created_at < ?1").bind(now - OAUTH_STATE_TTL_SECONDS),
    env.AUTH_DB.prepare("DELETE FROM google_sessions WHERE expires_at < ?1").bind(now),
  ]);
}

function assertSameOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== appOrigin(env)) throw new Error("요청 출처를 확인할 수 없어요.");
}

async function startOAuth(request, env) {
  await clearExpiredRows(env);
  const state = randomToken(32);
  const verifier = randomToken(48);
  const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const now = Math.floor(Date.now() / 1000);
  await env.AUTH_DB.prepare(
    "INSERT INTO oauth_states (state_hash, code_verifier, created_at) VALUES (?1, ?2, ?3)",
  ).bind(await sha256(state), verifier, now).run();

  const url = new URL(GOOGLE_AUTH);
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(env),
    response_type: "code",
    scope: `openid ${DRIVE_APPDATA_SCOPE}`,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return redirect(url.toString(), { "Set-Cookie": oauthCookieHeader(state) });
}

async function verifyIdentity(idToken, clientId) {
  const response = await fetch(`${GOOGLE_TOKEN_INFO}?id_token=${encodeURIComponent(idToken)}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Google 계정을 확인하지 못했어요.");
  const claims = await response.json();
  const now = Math.floor(Date.now() / 1000);
  if (
    claims.aud !== clientId ||
    !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss) ||
    !claims.sub ||
    Number(claims.exp) <= now
  ) throw new Error("Google 로그인 응답이 유효하지 않아요.");
  return claims.sub;
}

async function finishOAuth(request, env) {
  await clearExpiredRows(env);
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const googleError = url.searchParams.get("error");
  const clearOAuthCookie = { "Set-Cookie": oauthCookieHeader() };
  if (googleError) return redirect(`${appOrigin(env)}/?driveAuth=cancelled`, clearOAuthCookie);
  if (!code || !state || getCookie(request, OAUTH_COOKIE) !== state)
    return redirect(`${appOrigin(env)}/?driveAuth=failed`, clearOAuthCookie);

  const stateHash = await sha256(state);
  const now = Math.floor(Date.now() / 1000);
  const stateRow = await env.AUTH_DB.prepare(
    "SELECT code_verifier, created_at FROM oauth_states WHERE state_hash = ?1",
  ).bind(stateHash).first();
  await env.AUTH_DB.prepare("DELETE FROM oauth_states WHERE state_hash = ?1").bind(stateHash).run();
  if (!stateRow || now - Number(stateRow.created_at) > OAUTH_STATE_TTL_SECONDS)
    return redirect(`${appOrigin(env)}/?driveAuth=expired`, clearOAuthCookie);

  const tokenResponse = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(env),
      grant_type: "authorization_code",
      code_verifier: stateRow.code_verifier,
    }),
  });
  const tokens = await tokenResponse.json();
  if (!tokenResponse.ok || !tokens.access_token || !tokens.id_token)
    return redirect(`${appOrigin(env)}/?driveAuth=failed`, clearOAuthCookie);
  if (!String(tokens.scope || "").split(/\s+/u).includes(DRIVE_APPDATA_SCOPE))
    return redirect(`${appOrigin(env)}/?driveAuth=scope`, clearOAuthCookie);

  const googleSub = await verifyIdentity(tokens.id_token, env.GOOGLE_CLIENT_ID);
  let refreshToken = tokens.refresh_token || "";
  if (!refreshToken) {
    const prior = await env.AUTH_DB.prepare(
      "SELECT refresh_cipher, refresh_iv FROM google_sessions WHERE google_sub = ?1 ORDER BY created_at DESC LIMIT 1",
    ).bind(googleSub).first();
    if (!prior) return redirect(`${appOrigin(env)}/?driveAuth=refresh`, clearOAuthCookie);
    refreshToken = await decryptRefreshToken(prior.refresh_cipher, prior.refresh_iv, env);
  }

  const encrypted = await encryptRefreshToken(refreshToken, env);
  const sessionToken = randomToken(32);
  const sessionHash = await sha256(sessionToken);
  const expiresAt = now + SESSION_TTL_SECONDS;
  await env.AUTH_DB.prepare(
    "INSERT INTO google_sessions (session_hash, google_sub, refresh_cipher, refresh_iv, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
  ).bind(sessionHash, googleSub, encrypted.cipher, encrypted.iv, now, expiresAt).run();

  return redirect(`${appOrigin(env)}/?driveAuth=connected`, {
    "Set-Cookie": [cookieHeader(sessionToken), oauthCookieHeader()],
    "Referrer-Policy": "no-referrer",
  });
}

async function getAccessToken(request, env) {
  assertSameOrigin(request, env);
  const session = await sessionFor(request, env);
  if (!session) return json({ error: "세션이 만료됐어요. Google Drive를 다시 연결해 주세요." }, 401);
  const refreshToken = await decryptRefreshToken(session.refresh_cipher, session.refresh_iv, env);
  const response = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const tokens = await response.json();
  if (!response.ok || !tokens.access_token) {
    if (tokens.error === "invalid_grant")
      await env.AUTH_DB.prepare("DELETE FROM google_sessions WHERE session_hash = ?1").bind(session.session_hash).run();
    return json({ error: "Google 권한을 갱신할 수 없어요. 다시 연결해 주세요." }, 401);
  }
  return json({ access_token: tokens.access_token, expires_in: Number(tokens.expires_in) || 3600 });
}

async function disconnect(request, env) {
  assertSameOrigin(request, env);
  const session = await sessionFor(request, env);
  if (session) await env.AUTH_DB.prepare("DELETE FROM google_sessions WHERE session_hash = ?1").bind(session.session_hash).run();
  return json({ connected: false }, 200, { "Set-Cookie": clearCookieHeader() });
}

export async function onRequest({ request, env }) {
  const pathname = new URL(request.url).pathname;
  try {
    if (!env.AUTH_DB || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY || !env.APP_ORIGIN)
      return json({ error: "Google Drive 서버 설정이 아직 완료되지 않았어요." }, 503);
    if (request.method === "GET" && pathname.endsWith("/start")) return await startOAuth(request, env);
    if (request.method === "GET" && pathname.endsWith("/callback")) return await finishOAuth(request, env);
    if (request.method === "POST" && pathname.endsWith("/status")) {
      assertSameOrigin(request, env);
      const session = await sessionFor(request, env);
      return json({ connected: !!session });
    }
    if (request.method === "POST" && pathname.endsWith("/access-token")) return await getAccessToken(request, env);
    if (request.method === "POST" && pathname.endsWith("/disconnect")) return await disconnect(request, env);
    return json({ error: "요청한 경로를 찾을 수 없어요." }, 404);
  } catch (error) {
    console.error("Google Drive authentication handler failed", error?.message || "unknown");
    return json({ error: error?.message || "Google Drive 연결을 처리하지 못했어요." }, 500);
  }
}
