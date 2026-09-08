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
  return String(value ?? "").trim().toLowerCase() || "cos";
}

export function buildCosPublicUrl(baseUrl, bucket, region, objectKey) {
  const trimmedBase = removeTrailingSlash(baseUrl);
  if (trimmedBase) {
    return `${trimmedBase}/${removeLeadingSlash(objectKey)}`;
  }

  return `https://${bucket}.cos.${region}.myqcloud.com/${removeLeadingSlash(objectKey)}`;
}

export function getProviderCatalog() {
  const cosBucket = getEnv("COS_BUCKET");
  const cosRegion = getEnv("COS_REGION");
  const cosConfigured =
    Boolean(cosBucket) &&
    Boolean(cosRegion) &&
    Boolean(getEnv("COS_SECRET_ID")) &&
    Boolean(getEnv("COS_SECRET_KEY"));

  return {
    cos: {
      name: "cos",
      label: "Tencent COS",
      configured: cosConfigured,
      cdnBaseUrl: cosBucket && cosRegion
        ? removeTrailingSlash(buildCosPublicUrl(getEnv("COS_PUBLIC_BASE_URL"), cosBucket, cosRegion, ""))
        : removeTrailingSlash(getEnv("COS_PUBLIC_BASE_URL")),
      description: "预签名 PUT 直传"
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

