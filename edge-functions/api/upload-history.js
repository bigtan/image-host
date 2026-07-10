const HISTORY_KV_BINDING = "IMAGE_HISTORY_KV";
const HISTORY_KEY_PREFIX = "upload_history_";
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 24;
const MAX_REVERSE_TIMESTAMP = 9_999_999_999_999;
const encoder = new TextEncoder();

const PROVIDERS = {
  cos: "Tencent COS",
  upyun: "UpYun"
};

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders
    }
  });
}

function getEnv(context, name, fallback = "") {
  const value = context.env?.[name] ?? fallback;
  return typeof value === "string" ? value.trim() : fallback;
}

function getCorsHeaders(context) {
  const origin = context.request.headers.get("origin")?.trim() ?? "";
  if (!origin) return { ok: true, headers: {} };

  const allowedOrigins = getEnv(context, "CORS_ALLOWED_ORIGINS")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!allowedOrigins.includes(origin)) return { ok: false, headers: {} };

  return {
    ok: true,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-upload-token",
      vary: "Origin"
    }
  };
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function verifyUploadToken(context) {
  const token = context.request.headers.get("x-upload-token")?.trim() ?? "";
  const rawToken = getEnv(context, "UPLOAD_TOKEN");
  const configuredHash = getEnv(context, "UPLOAD_TOKEN_SHA256").toLowerCase();

  if (!rawToken && !configuredHash) {
    throw new ApiError("服务端缺少上传令牌配置", 500);
  }
  if (!token) throw new ApiError("上传令牌无效", 401);

  const tokenHash = await sha256Hex(token);
  const rawTokenHash = rawToken ? await sha256Hex(rawToken) : "";
  const matchesRawToken = rawTokenHash && constantTimeEqual(tokenHash, rawTokenHash);
  const matchesConfiguredHash = /^[a-f0-9]{64}$/.test(configuredHash) && constantTimeEqual(tokenHash, configuredHash);

  if (!matchesRawToken && !matchesConfiguredHash) {
    throw new ApiError("上传令牌无效", 401);
  }

  return tokenHash;
}

function getHistoryKv() {
  const kv = globalThis[HISTORY_KV_BINDING];
  if (!kv || typeof kv.put !== "function" || typeof kv.get !== "function" || typeof kv.list !== "function") {
    throw new ApiError(`服务端未绑定 KV 命名空间 ${HISTORY_KV_BINDING}`, 500);
  }
  return kv;
}

function readString(value, field, maxLength) {
  if (typeof value !== "string") throw new ApiError(`${field} 必须是字符串`, 400);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new ApiError(`${field} 无效`, 400);
  return normalized;
}

function parseUploadRecord(value) {
  if (!value || typeof value !== "object") throw new ApiError("请求体不是合法 JSON", 400);

  const provider = readString(value.provider, "provider", 16).toLowerCase();
  if (!Object.hasOwn(PROVIDERS, provider)) throw new ApiError("上传后端无效", 400);

  const objectKey = readString(value.objectKey, "objectKey", 512);
  if (!/^[a-zA-Z0-9/_\-.]+$/.test(objectKey)) throw new ApiError("objectKey 包含非法字符", 400);

  const originalUrl = readString(value.originalUrl, "originalUrl", 2048);
  try {
    const url = new URL(originalUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("unsupported protocol");
  } catch {
    throw new ApiError("originalUrl 无效", 400);
  }

  const fileName = readString(value.fileName, "fileName", 255);
  const contentType = readString(value.contentType, "contentType", 128).toLowerCase();
  if (!contentType.startsWith("image/")) throw new ApiError("contentType 无效", 400);

  if (!Number.isSafeInteger(value.fileSize) || value.fileSize <= 0) {
    throw new ApiError("fileSize 无效", 400);
  }

  return {
    provider,
    providerLabel: PROVIDERS[provider],
    objectKey,
    originalUrl,
    fileName,
    contentType,
    fileSize: value.fileSize
  };
}

function createHistoryKey(tokenHash) {
  const reverseTimestamp = String(MAX_REVERSE_TIMESTAMP - Date.now()).padStart(13, "0");
  const randomId = crypto.randomUUID().replaceAll("-", "");
  return `${HISTORY_KEY_PREFIX}${tokenHash}_${reverseTimestamp}_${randomId}`;
}

function pageSizeFrom(url) {
  const raw = url.searchParams.get("limit");
  if (!raw) return DEFAULT_PAGE_SIZE;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new ApiError(`limit 必须在 1 到 ${MAX_PAGE_SIZE} 之间`, 400);
  }
  return value;
}

function cursorFrom(url) {
  const cursor = url.searchParams.get("cursor");
  if (!cursor) return undefined;
  if (!/^[A-Za-z0-9_]{1,512}$/.test(cursor)) throw new ApiError("cursor 无效", 400);
  return cursor;
}

export async function onRequestOptions(context) {
  const cors = getCorsHeaders(context);
  return new Response(null, { status: cors.ok ? 204 : 403, headers: cors.headers });
}

export async function onRequestPost(context) {
  const cors = getCorsHeaders(context);
  if (!cors.ok) return json({ error: "当前来源未被允许访问上传历史" }, 403);

  try {
    const tokenHash = await verifyUploadToken(context);
    const body = await context.request.json().catch(() => null);
    const input = parseUploadRecord(body);
    const uploadedAt = new Date().toISOString();
    const item = { id: crypto.randomUUID(), ...input, uploadedAt };

    await getHistoryKv().put(createHistoryKey(tokenHash), JSON.stringify(item));
    return json({ item }, 201, cors.headers);
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "保存上传历史失败";
    return json({ error: message }, status, cors.headers);
  }
}

export async function onRequestGet(context) {
  const cors = getCorsHeaders(context);
  if (!cors.ok) return json({ error: "当前来源未被允许访问上传历史" }, 403);

  try {
    const tokenHash = await verifyUploadToken(context);
    const url = new URL(context.request.url);
    const cursor = cursorFrom(url);
    const listOptions = {
      prefix: `${HISTORY_KEY_PREFIX}${tokenHash}_`,
      limit: pageSizeFrom(url)
    };
    if (cursor) listOptions.cursor = cursor;

    const result = await getHistoryKv().list(listOptions);
    const values = await Promise.all(result.keys.map(({ key }) => getHistoryKv().get(key, { type: "json" })));
    const items = values.filter((value) => value && typeof value === "object");

    return json(
      {
        items,
        nextCursor: result.complete ? null : result.cursor ?? null
      },
      200,
      cors.headers
    );
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "读取上传历史失败";
    return json({ error: message }, status, cors.headers);
  }
}
