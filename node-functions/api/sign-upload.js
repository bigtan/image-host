import COS from "cos-nodejs-sdk-v5";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const ALLOWED_MIME_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif"
};

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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function getEnv(name, fallback = "") {
  const value = process.env[name] ?? fallback;
  return typeof value === "string" ? value.trim() : fallback;
}

function inferExtension(contentType) {
  return ALLOWED_MIME_TYPES[contentType] ?? "";
}

function sanitizeDownloadFileName(fileName, extension) {
  const normalized = String(fileName ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]+/g, "")
    .replace(/[\\/]/g, "-")
    .replace(/[";]+/g, "")
    .trim();

  if (!normalized) {
    return `image.${extension}`;
  }

  const maxLength = 120;
  return normalized.slice(0, maxLength);
}

function buildContentDisposition(fileName) {
  return `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function normalizePrefix(prefix) {
  return prefix
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.replace(/[^a-zA-Z0-9_-]/g, "-"))
    .join("/");
}

function createObjectKey(prefix, extension) {
  const now = new Date();
  const datePath = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0")
  ].join("/");
  const fileId = `${randomBytes(6).toString("base64url")}.${extension}`;
  return prefix ? `${prefix}/${datePath}/${fileId}` : `${datePath}/${fileId}`;
}

function buildPublicUrl(baseUrl, bucket, region, objectKey) {
  const trimmedBase = baseUrl.replace(/\/$/, "");
  if (trimmedBase) {
    return `${trimmedBase}/${objectKey}`;
  }

  return `https://${bucket}.cos.${region}.myqcloud.com/${objectKey}`;
}

function getAllowedOrigins() {
  return getEnv("CORS_ALLOWED_ORIGINS")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function getCorsHeaders(request) {
  const origin = request.headers.get("origin")?.trim() ?? "";
  if (!origin) {
    return { ok: true, headers: {} };
  }

  const allowedOrigins = getAllowedOrigins();
  if (!allowedOrigins.length) {
    return { ok: false, headers: {} };
  }

  if (!allowedOrigins.includes(origin)) {
    return { ok: false, headers: {} };
  }

  return {
    ok: true,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-upload-token",
      vary: "Origin"
    }
  };
}

function verifyUploadToken(token) {
  const rawToken = getEnv("UPLOAD_TOKEN");
  const hashedToken = getEnv("UPLOAD_TOKEN_SHA256");

  if (!rawToken && !hashedToken) {
    throw new Error("服务端缺少上传令牌配置");
  }

  if (!token) return false;
  if (rawToken && safeCompare(token, rawToken)) return true;
  if (hashedToken && safeCompare(sha256(token), hashedToken)) return true;
  return false;
}

async function parseBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function getSignedUploadUrl(cos, options) {
  return new Promise((resolve, reject) => {
    cos.getObjectUrl(options, (error, data) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(data.Url);
    });
  });
}

export async function onRequestOptions(context) {
  const { request } = context;
  const cors = getCorsHeaders(request);

  if (!cors.ok) {
    return new Response(null, { status: 403 });
  }

  return new Response(null, {
    status: 204,
    headers: cors.headers
  });
}

export async function onRequestPost(context) {
  const { request } = context;
  const cors = getCorsHeaders(request);

  if (!cors.ok) {
    return json({ error: "当前来源未被允许访问签名接口" }, 403);
  }

  try {
    const token = request.headers.get("x-upload-token")?.trim() ?? "";
    const body = await parseBody(request);

    if (!verifyUploadToken(token)) {
      return json({ error: "上传令牌无效" }, 401, cors.headers);
    }

    if (!body) {
      return json({ error: "请求体不是合法 JSON" }, 400, cors.headers);
    }

    const contentType = String(body.contentType ?? "").trim().toLowerCase();
    const fileSize = Number(body.fileSize ?? 0);
    const fileName = String(body.fileName ?? "").trim();
    const pathPrefix = normalizePrefix(String(body.pathPrefix ?? getEnv("DEFAULT_PATH_PREFIX")));

    if (!ALLOWED_MIME_TYPES[contentType]) {
      return json({ error: "不支持的图片类型" }, 400, cors.headers);
    }

    const maxUploadSize = Number(getEnv("MAX_UPLOAD_SIZE_BYTES", `${10 * 1024 * 1024}`));
    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > maxUploadSize) {
      return json({ error: `文件大小超出限制，最大 ${maxUploadSize} 字节` }, 400, cors.headers);
    }

    const bucket = getEnv("COS_BUCKET");
    const region = getEnv("COS_REGION");
    const secretId = getEnv("COS_SECRET_ID");
    const secretKey = getEnv("COS_SECRET_KEY");
    const publicBaseUrl = getEnv("COS_PUBLIC_BASE_URL");
    const uploadExpires = Number(getEnv("SIGNED_URL_EXPIRES_SECONDS", "300"));

    if (!bucket || !region || !secretId || !secretKey) {
      return json({ error: "服务端缺少 COS 配置" }, 500, cors.headers);
    }

    const extension = inferExtension(contentType);
    const objectKey = createObjectKey(pathPrefix, extension);
    const downloadFileName = sanitizeDownloadFileName(fileName, extension);
    const cos = new COS({
      SecretId: secretId,
      SecretKey: secretKey
    });

    const signedHeaders = {
      "Content-Type": contentType,
      "Content-Length": String(fileSize),
      "Content-Disposition": buildContentDisposition(downloadFileName)
    };

    const uploadUrl = await getSignedUploadUrl(cos, {
      Bucket: bucket,
      Region: region,
      Key: objectKey,
      Method: "PUT",
      Sign: true,
      Expires: uploadExpires,
      Query: {},
      Headers: signedHeaders
    });

    return json(
      {
        uploadUrl,
        publicUrl: buildPublicUrl(publicBaseUrl, bucket, region, objectKey),
        objectKey,
        expiresAt: new Date(Date.now() + uploadExpires * 1000).toISOString(),
        headers: signedHeaders
      },
      200,
      cors.headers
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "签名接口异常";
    return json({ error: message }, 500, cors.headers);
  }
}
