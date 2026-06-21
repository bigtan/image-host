import type { SignResponse, UploadProvider, UploadResult } from "./types";

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function fileToResult(sign: SignResponse): UploadResult {
  const url = sign.publicUrl;
  return {
    provider: sign.provider,
    providerLabel: sign.providerLabel,
    cdnBaseUrl: sign.cdnBaseUrl,
    objectKey: sign.objectKey,
    originalUrl: url,
    html: `<img src="${url}" alt="" />`,
    markdown: `![](${url})`,
    bbcode: `[img]${url}[/img]`
  };
}

export async function requestUploadSignature(
  file: File,
  token: string,
  prefix: string,
  provider: UploadProvider
) {
  const response = await fetch("/api/sign-upload", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-upload-token": token
    },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      fileSize: file.size,
      pathPrefix: prefix,
      provider
    })
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error ?? "签名失败");
  }

  return payload as SignResponse;
}

export function uploadToSignedUrl(
  file: File,
  sign: SignResponse,
  onProgress: (progress: number) => void
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(sign.upload.method, sign.upload.url, true);

    Object.entries(sign.upload.headers ?? sign.headers).forEach(([key, value]) => {
      // 浏览器禁止手动设置 Content-Length，会自动按请求体填入正确值
      if (key.toLowerCase() === "content-length") return;
      xhr.setRequestHeader(key, value);
    });

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }

      reject(new Error(`上传失败，${sign.providerLabel} 返回 ${xhr.status}`));
    };

    xhr.onerror = () => reject(new Error("上传过程中网络异常"));

    if (sign.upload.method === "POST") {
      const formData = new FormData();

      Object.entries(sign.upload.fields ?? {}).forEach(([key, value]) => {
        if (key !== "file") {
          formData.append(key, value);
        }
      });

      formData.append("file", file);
      xhr.send(formData);
      return;
    }

    xhr.send(file);
  });
}
