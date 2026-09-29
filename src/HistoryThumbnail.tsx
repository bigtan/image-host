import { useState } from "react";
import { thumbnailUrl } from "./thumbnail";

export default function HistoryThumbnail({ url, alt, enabled = import.meta.env?.VITE_COS_THUMBNAILS === "true" }: { url: string; alt: string; enabled?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const thumbnail = thumbnailUrl(url, enabled);
  return <img
    src={failedUrl === thumbnail ? url : thumbnail}
    alt={alt}
    className="history-image"
    loading="lazy"
    decoding="async"
    width={640}
    height={640}
    onError={() => { if (thumbnail !== url) setFailedUrl(thumbnail); }}
  />;
}
