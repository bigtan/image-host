import COS from "cos-nodejs-sdk-v5";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  buildCosPublicUrl,
  buildUpyunPublicUrl,
  getDefaultProvider,
  getProviderCatalog,
  normalizeProviderName
} from "./_lib/upload-providers.js";

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

function createUpyunPolicy(serviceName, objectKey, contentType, maxUploadSize, expiresAt, date) {
  return Buffer.from(
    JSON.stringify({
      bucket: serviceName,
      "save-key": `/${objectKey}`,
      expiration: expiresAt,
      date,
      "content-type": contentType,
      "content-length-range": `1, ${maxUploadSize}`
    })
  ).toString("base64");
}

function createUpyunAuthorization(operatorName, operatorPassword, serviceName, date, policy) {
  const passwordMd5 = createHash("md5").update(operatorPassword).digest("hex");
  const signPayload = ["POST", `/${serviceName}`, date, policy].join("&");
  const signature = createHmac("sha1", passwordMd5).update(signPayload).digest("base64");
  return `UPYUN ${operatorName}:${signature}`;
}

async function signCosUpload(contentType, fileSize, fileName, objectKey, uploadExpires) {
  const bucket = getEnv("COS_BUCKET");
  const region = getEnv("COS_REGION");
  const secretId = getEnv("COS_SECRET_ID");
  const secretKey = getEnv("COS_SECRET_KEY");
  const publicBaseUrl = getEnv("COS_PUBLIC_BASE_URL");

  if (!bucket || !region || !secretId || !secretKey) {
    throw new Error("服务端缺少 COS 配置");
  }

  const extension = inferExtension(contentType);
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

  return {
    provider: "cos",
    providerLabel: "Tencent COS",
    cdnBaseUrl: buildCosPublicUrl(publicBaseUrl, bucket, region, "").replace(/\/$/, ""),
    upload: {
      method: "PUT",
      url: uploadUrl,
      headers: signedHeaders
    },
    publicUrl: buildCosPublicUrl(publicBaseUrl, bucket, region, objectKey)
  };
}

function signUpyunUpload(contentType, maxUploadSize, objectKey, uploadExpires) {
  const serviceName = getEnv("UPYUN_SERVICE_NAME");
  const operatorName = getEnv("UPYUN_OPERATOR_NAME");
  const operatorPassword = getEnv("UPYUN_OPERATOR_PASSWORD");
  const publicBaseUrl = getEnv("UPYUN_PUBLIC_BASE_URL");
  const apiHost = getEnv("UPYUN_API_HOST", "v0.api.upyun.com");

  if (!serviceName || !operatorName || !operatorPassword) {
    throw new Error("服务端缺少 UpYun 配置");
  }

  const date = new Date().toUTCString();
  const expiration = Math.floor(Date.now() / 1000) + uploadExpires;
  const policy = createUpyunPolicy(
    serviceName,
    objectKey,
    contentType,
    maxUploadSize,
    expiration,
    date
  );
  const authorization = createUpyunAuthorization(
    operatorName,
    operatorPassword,
    serviceName,
    date,
    policy
  );

  return {
    provider: "upyun",
    providerLabel: "UpYun",
    cdnBaseUrl: buildUpyunPublicUrl(publicBaseUrl, serviceName, "").replace(/\/$/, ""),
    upload: {
      method: "POST",
      url: `https://${apiHost.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/${serviceName}`,
      fields: {
        policy,
        authorization,
        date,
        "content-type": contentType,
        file: ""
      }
    },
    publicUrl: buildUpyunPublicUrl(publicBaseUrl, serviceName, objectKey)
  };
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
    const catalog = getProviderCatalog();
    const provider = normalizeProviderName(body.provider ?? getDefaultProvider());

    if (!ALLOWED_MIME_TYPES[contentType]) {
      return json({ error: "不支持的图片类型" }, 400, cors.headers);
    }

    const maxUploadSize = Number(getEnv("MAX_UPLOAD_SIZE_BYTES", `${10 * 1024 * 1024}`));
    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > maxUploadSize) {
      return json({ error: `文件大小超出限制，最大 ${maxUploadSize} 字节` }, 400, cors.headers);
    }

    if (!catalog[provider]?.configured) {
      return json({ error: `${catalog[provider]?.label ?? provider} 未配置或不可用` }, 400, cors.headers);
    }

    const uploadExpires = Number(getEnv("SIGNED_URL_EXPIRES_SECONDS", "300"));

    const extension = inferExtension(contentType);
    const objectKey = createObjectKey(pathPrefix, extension);
    const signResult =
      provider === "upyun"
        ? signUpyunUpload(contentType, maxUploadSize, objectKey, uploadExpires)
        : await signCosUpload(contentType, fileSize, fileName, objectKey, uploadExpires);

    return json(
      {
        provider: signResult.provider,
        providerLabel: signResult.providerLabel,
        cdnBaseUrl: signResult.cdnBaseUrl,
        upload: signResult.upload,
        publicUrl: signResult.publicUrl,
        objectKey,
        expiresAt: new Date(Date.now() + uploadExpires * 1000).toISOString(),
        headers: signResult.upload.headers ?? {}
      },
      200,
      cors.headers
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "签名接口异常";
    return json({ error: message }, 500, cors.headers);
  }
}
