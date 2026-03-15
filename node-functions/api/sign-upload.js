import COS from "cos-nodejs-sdk-v5";
import { createHash, randomBytes } from "node:crypto";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function getEnv(name, fallback = "") {
  const value = process.env[name] ?? fallback;
  return typeof value === "string" ? value.trim() : fallback;
}

function inferExtension(fileName, contentType) {
  const fromName = fileName.split(".").pop()?.toLowerCase();
  const safeFromName = fromName && /^[a-z0-9]+$/.test(fromName) ? fromName : "";
  if (safeFromName) return safeFromName;

  const mapping = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif"
  };

  return mapping[contentType] ?? "bin";
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
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0")
  ].join("/");
  const fileId = `${now.getTime()}-${randomBytes(4).toString("hex")}.${extension}`;
  return prefix ? `${prefix}/${datePath}/${fileId}` : `${datePath}/${fileId}`;
}

function buildPublicUrl(baseUrl, bucket, region, objectKey) {
  const trimmedBase = baseUrl.replace(/\/$/, "");
  if (trimmedBase) {
    return `${trimmedBase}/${objectKey}`;
  }

  return `https://${bucket}.cos.${region}.myqcloud.com/${objectKey}`;
}

function verifyUploadToken(token) {
  const rawToken = getEnv("UPLOAD_TOKEN");
  const hashedToken = getEnv("UPLOAD_TOKEN_SHA256");

  if (!rawToken && !hashedToken) {
    throw new Error("服务端缺少上传令牌配置");
  }

  if (!token) return false;
  if (rawToken && token === rawToken) return true;
  if (hashedToken && sha256(token) === hashedToken) return true;
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

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-upload-token"
    }
  });
}

export async function onRequestPost(context) {
  try {
    const { request } = context;
    const token = request.headers.get("x-upload-token")?.trim() ?? "";
    const body = await parseBody(request);

    if (!verifyUploadToken(token)) {
      return json({ error: "上传令牌无效" }, 401);
    }

    if (!body) {
      return json({ error: "请求体不是合法 JSON" }, 400);
    }

    const contentType = String(body.contentType ?? "").trim().toLowerCase();
    const fileSize = Number(body.fileSize ?? 0);
    const fileName = String(body.fileName ?? "clipboard-image").trim();
    const pathPrefix = normalizePrefix(String(body.pathPrefix ?? getEnv("DEFAULT_PATH_PREFIX")));

    if (!contentType.startsWith("image/")) {
      return json({ error: "仅允许上传图片类型文件" }, 400);
    }

    const maxUploadSize = Number(getEnv("MAX_UPLOAD_SIZE_BYTES", `${10 * 1024 * 1024}`));
    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > maxUploadSize) {
      return json({ error: `文件大小超出限制，最大 ${maxUploadSize} 字节` }, 400);
    }

    const bucket = getEnv("COS_BUCKET");
    const region = getEnv("COS_REGION");
    const secretId = getEnv("COS_SECRET_ID");
    const secretKey = getEnv("COS_SECRET_KEY");
    const publicBaseUrl = getEnv("COS_PUBLIC_BASE_URL");
    const uploadExpires = Number(getEnv("SIGNED_URL_EXPIRES_SECONDS", "300"));

    if (!bucket || !region || !secretId || !secretKey) {
      return json({ error: "服务端缺少 COS 配置" }, 500);
    }

    const extension = inferExtension(fileName, contentType);
    const objectKey = createObjectKey(pathPrefix, extension);
    const cos = new COS({
      SecretId: secretId,
      SecretKey: secretKey
    });

    const uploadUrl = await getSignedUploadUrl(cos, {
      Bucket: bucket,
      Region: region,
      Key: objectKey,
      Method: "PUT",
      Sign: true,
      Expires: uploadExpires,
      Query: {},
      Headers: {
        "Content-Type": contentType
      }
    });

    return json({
      uploadUrl,
      publicUrl: buildPublicUrl(publicBaseUrl, bucket, region, objectKey),
      objectKey,
      expiresAt: new Date(Date.now() + uploadExpires * 1000).toISOString(),
      headers: {
        "Content-Type": contentType
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "签名接口异常";
    return json({ error: message }, 500);
  }
}
