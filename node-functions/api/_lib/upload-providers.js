function getEnv(name, fallback = "") {
  const value = process.env[name] ?? fallback;
  return typeof value === "string" ? value.trim() : fallback;
}

function removeTrailingSlash(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function removeLeadingSlash(value) {
  return String(value ?? "").trim().replace(/^\/+/, "");
}

export function normalizeProviderName(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "upyun" ? "upyun" : "cos";
}

export function buildCosPublicUrl(baseUrl, bucket, region, objectKey) {
  const trimmedBase = removeTrailingSlash(baseUrl);
  if (trimmedBase) {
    return `${trimmedBase}/${removeLeadingSlash(objectKey)}`;
  }

  return `https://${bucket}.cos.${region}.myqcloud.com/${removeLeadingSlash(objectKey)}`;
}

export function buildUpyunPublicUrl(baseUrl, serviceName, objectKey) {
  const trimmedBase = removeTrailingSlash(baseUrl);
  if (trimmedBase) {
    return `${trimmedBase}/${removeLeadingSlash(objectKey)}`;
  }

  return `https://${serviceName}.test.upcdn.net/${removeLeadingSlash(objectKey)}`;
}

export function getProviderCatalog() {
  const cosBucket = getEnv("COS_BUCKET");
  const cosRegion = getEnv("COS_REGION");
  const cosConfigured =
    Boolean(cosBucket) &&
    Boolean(cosRegion) &&
    Boolean(getEnv("COS_SECRET_ID")) &&
    Boolean(getEnv("COS_SECRET_KEY"));

  const upyunServiceName = getEnv("UPYUN_SERVICE_NAME");
  const upyunConfigured =
    Boolean(upyunServiceName) &&
    Boolean(getEnv("UPYUN_OPERATOR_NAME")) &&
    Boolean(getEnv("UPYUN_OPERATOR_PASSWORD"));

  return {
    cos: {
      name: "cos",
      label: "Tencent COS",
      configured: cosConfigured,
      cdnBaseUrl: cosBucket && cosRegion
        ? removeTrailingSlash(buildCosPublicUrl(getEnv("COS_PUBLIC_BASE_URL"), cosBucket, cosRegion, ""))
        : removeTrailingSlash(getEnv("COS_PUBLIC_BASE_URL")),
      description: "预签名 PUT 直传"
    },
    upyun: {
      name: "upyun",
      label: "UpYun",
      configured: upyunConfigured,
      cdnBaseUrl: upyunServiceName
        ? removeTrailingSlash(buildUpyunPublicUrl(getEnv("UPYUN_PUBLIC_BASE_URL"), upyunServiceName, ""))
        : removeTrailingSlash(getEnv("UPYUN_PUBLIC_BASE_URL")),
      description: "FORM API 直传"
    }
  };
}

export function getProviderList() {
  return Object.values(getProviderCatalog());
}

export function getDefaultProvider() {
  const catalog = getProviderCatalog();
  const configuredProviders = Object.values(catalog).filter((provider) => provider.configured);
  const preferred = normalizeProviderName(getEnv("DEFAULT_UPLOAD_PROVIDER", "cos"));

  if (catalog[preferred]?.configured) {
    return preferred;
  }

  return configuredProviders[0]?.name ?? preferred;
}

