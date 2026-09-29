/** Query-bearing URLs may be signed; do not modify their signatures. */
export function thumbnailUrl(originalUrl: string, enabled: boolean) {
  if (!enabled) return originalUrl;
  try {
    const url = new URL(originalUrl);
    if (url.search || !['http:', 'https:'].includes(url.protocol)) return originalUrl;
    url.search = 'imageMogr2/thumbnail/640x640';
    return url.toString();
  } catch { return originalUrl; }
}
