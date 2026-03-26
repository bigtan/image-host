import { useEffect, useMemo, useRef, useState } from "react";

type UploadStatus = "queued" | "signing" | "uploading" | "done" | "error";
type UploadProvider = "cos" | "upyun";

type ProviderOption = {
  name: UploadProvider;
  label: string;
  configured: boolean;
  cdnBaseUrl: string;
  description: string;
};

type UploadResult = {
  provider: UploadProvider;
  providerLabel: string;
  cdnBaseUrl: string;
  objectKey: string;
  originalUrl: string;
  html: string;
  markdown: string;
  bbcode: string;
};

type UploadItem = {
  id: string;
  file: File;
  previewUrl: string;
  progress: number;
  status: UploadStatus;
  error?: string;
  result?: UploadResult;
};

type SignResponse = {
  provider: UploadProvider;
  providerLabel: string;
  cdnBaseUrl: string;
  upload: {
    method: "PUT" | "POST";
    url: string;
    headers?: Record<string, string>;
    fields?: Record<string, string>;
  };
  publicUrl: string;
  objectKey: string;
  expiresAt: string;
  headers: Record<string, string>;
};

type HealthResponse = {
  ok: true;
  defaultProvider: UploadProvider;
  providers: ProviderOption[];
};

const TOKEN_STORAGE_KEY = "image-host.upload-token";
const PREFIX_STORAGE_KEY = "image-host.path-prefix";
const PROVIDER_STORAGE_KEY = "image-host.upload-provider";
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"];
const FALLBACK_PROVIDERS: ProviderOption[] = [
  {
    name: "cos",
    label: "Tencent COS",
    configured: true,
    cdnBaseUrl: "",
    description: "预签名 PUT 直传"
  },
  {
    name: "upyun",
    label: "UpYun",
    configured: false,
    cdnBaseUrl: "",
    description: "FORM API 直传"
  }
];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fileToResult(sign: SignResponse): UploadResult {
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

async function requestUploadSignature(
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

function uploadToSignedUrl(file: File, sign: SignResponse, onProgress: (progress: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(sign.upload.method, sign.upload.url, true);

    Object.entries(sign.upload.headers ?? sign.headers).forEach(([key, value]) => {
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

export default function App() {
  const [token, setToken] = useState("");
  const [pathPrefix, setPathPrefix] = useState("");
  const [provider, setProvider] = useState<UploadProvider>("cos");
  const [providers, setProviders] = useState<ProviderOption[]>(FALLBACK_PROVIDERS);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previousItemsRef = useRef<UploadItem[]>([]);
  const tokenRef = useRef("");
  const pathPrefixRef = useRef("");
  const providerRef = useRef<UploadProvider>("cos");

  useEffect(() => {
    const storedToken = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    const storedPrefix = window.localStorage.getItem(PREFIX_STORAGE_KEY);
    const storedProvider = window.localStorage.getItem(PROVIDER_STORAGE_KEY) as UploadProvider | null;

    if (storedToken) setToken(storedToken);
    if (storedPrefix) setPathPrefix(storedPrefix);
    if (storedProvider === "cos" || storedProvider === "upyun") {
      setProvider(storedProvider);
    }

    void fetch("/api/health")
      .then((response) => response.json())
      .then((payload: HealthResponse) => {
        if (!Array.isArray(payload.providers) || !payload.providers.length) return;

        setProviders(payload.providers);

        const configuredNames = new Set(
          payload.providers.filter((item) => item.configured).map((item) => item.name)
        );
        const preferredProvider =
          storedProvider && configuredNames.has(storedProvider)
            ? storedProvider
            : configuredNames.has(payload.defaultProvider)
              ? payload.defaultProvider
              : payload.providers.find((item) => item.configured)?.name ?? "cos";

        setProvider(preferredProvider);
      })
      .catch(() => {
        // Keep the local fallback provider list when metadata is unavailable.
      });
  }, []);

  useEffect(() => {
    tokenRef.current = token;

    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  }, [token]);

  useEffect(() => {
    pathPrefixRef.current = pathPrefix;

    if (pathPrefix) {
      window.localStorage.setItem(PREFIX_STORAGE_KEY, pathPrefix);
    } else {
      window.localStorage.removeItem(PREFIX_STORAGE_KEY);
    }
  }, [pathPrefix]);

  useEffect(() => {
    providerRef.current = provider;
    window.localStorage.setItem(PROVIDER_STORAGE_KEY, provider);
  }, [provider]);

  async function uploadItem(id: string, file: File) {
    const activeToken = tokenRef.current.trim();
    const activePrefix = pathPrefixRef.current.trim();
    const activeProvider = providerRef.current;

    if (!activeToken) {
      setItems((current) =>
        current.map((item) =>
          item.id === id ? { ...item, status: "error", error: "请先输入上传令牌" } : item
        )
      );
      return;
    }

    try {
      setItems((current) =>
        current.map((item) => (item.id === id ? { ...item, status: "signing" } : item))
      );

      const sign = await requestUploadSignature(file, activeToken, activePrefix, activeProvider);

      setItems((current) =>
        current.map((item) =>
          item.id === id ? { ...item, status: "uploading", progress: 3 } : item
        )
      );

      await uploadToSignedUrl(file, sign, (progress) => {
        setItems((current) =>
          current.map((item) => (item.id === id ? { ...item, progress } : item))
        );
      });

      setItems((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                status: "done",
                progress: 100,
                result: fileToResult(sign)
              }
            : item
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "上传失败";
      setItems((current) =>
        current.map((item) =>
          item.id === id ? { ...item, status: "error", error: message } : item
        )
      );
    }
  }

  async function enqueueFiles(files: File[]) {
    const candidates = files.filter((file) => file.type.startsWith("image/"));
    if (!candidates.length) return;

    const nextItems = candidates.map<UploadItem>((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      progress: 0,
      status: "queued"
    }));

    setItems((current) => [...nextItems, ...current]);

    for (const item of nextItems) {
      await uploadItem(item.id, item.file);
    }
  }

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
        file.type.startsWith("image/")
      );

      if (!files.length) return;
      event.preventDefault();
      void enqueueFiles(files);
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  useEffect(() => {
    const previousItems = previousItemsRef.current;
    const activeIds = new Set(items.map((item) => item.id));

    previousItems
      .filter((item) => !activeIds.has(item.id))
      .forEach((item) => URL.revokeObjectURL(item.previewUrl));

    previousItemsRef.current = items;
  }, [items]);

  useEffect(() => {
    return () => {
      previousItemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, []);

  const completedCount = useMemo(
    () => items.filter((item) => item.status === "done").length,
    [items]
  );
  const selectedProvider = useMemo(
    () => providers.find((item) => item.name === provider) ?? FALLBACK_PROVIDERS[0],
    [provider, providers]
  );

  function handleFileSelection(files: FileList | null) {
    if (!files?.length) return;
    void enqueueFiles(Array.from(files));
  }

  function clearFinished() {
    setItems((current) => current.filter((item) => item.status !== "done"));
  }

  async function copyText(value: string) {
    await navigator.clipboard.writeText(value);
  }

  return (
    <main className="page-shell">
      <section className="hero-card">
        <div className="hero-copy">
          <span className="eyebrow">EdgeOne Pages + Multi Backend</span>
          <h1>个人图床上传台</h1>
          <p>
            简洁、快速且安全的图片托管方案。支持直接粘贴、拖拽或点击上传。
          </p>
        </div>

        <div className="settings-grid">
          <label className="field-card">
            <span>上传后端</span>
            <select value={provider} onChange={(event) => setProvider(event.target.value as UploadProvider)}>
              {providers.map((item) => (
                <option key={item.name} value={item.name} disabled={!item.configured}>
                  {item.label}
                  {item.configured ? "" : " (未配置)"}
                </option>
              ))}
            </select>
            <small>{selectedProvider.description}</small>
          </label>

          <label className="field-card">
            <span>上传令牌</span>
            <input
              type="password"
              autoComplete="off"
              placeholder="令牌将保存至本地"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>

          <label className="field-card">
            <span>路径前缀</span>
            <input
              type="text"
              autoComplete="off"
              placeholder="例如 forum/avatars"
              value={pathPrefix}
              onChange={(event) => setPathPrefix(event.target.value)}
            />
          </label>

          <label className="field-card">
            <span>CDN 域名</span>
            <input
              type="text"
              readOnly
              value={selectedProvider.cdnBaseUrl || "当前后端未配置域名"}
            />
          </label>
        </div>
      </section>

      <section
        className={`dropzone ${dragging ? "is-dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          handleFileSelection(event.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          multiple
          hidden
          onChange={(event) => {
            handleFileSelection(event.target.files);
            event.currentTarget.value = "";
          }}
        />
        <div className="dropzone-content">
          <strong>准备好上传了吗？</strong>
          <p>拖拽图片到这里，点击浏览，或者直接从剪贴板粘贴</p>
        </div>
      </section>

      <section className="toolbar">
        <div className="stat-pill">
          <span>总文件</span>
          <strong>{items.length}</strong>
        </div>
        <div className="stat-pill">
          <span>已完成</span>
          <strong>{completedCount}</strong>
        </div>
        <button type="button" className="ghost-button" onClick={clearFinished}>
          清空已完成
        </button>
      </section>

      <section className="queue-grid">
        {items.length === 0 ? (
          <article className="empty-card">
            <h2>暂无文件</h2>
            <p>上传后的图片将在这里显示。</p>
          </article>
        ) : null}

        {items.map((item) => {
          const result = item.result;

          return (
            <article key={item.id} className="upload-card">
              <div className="upload-meta">
                <div>
                  <h3>{item.file.name || "clipboard-image.png"}</h3>
                  <p>
                    {item.file.type || "unknown"} · {formatBytes(item.file.size)}
                  </p>
                </div>
                <span className={`status-chip status-${item.status}`}>{item.status}</span>
              </div>

              <div className="progress-bar">
                <div style={{ width: `${item.progress}%` }} />
              </div>

              {item.error ? <p className="error-text">{item.error}</p> : null}

              <img src={item.previewUrl} alt={item.file.name} className="preview-image" />

              {result ? (
                <div className="result-grid">
                  <div className="result-field">
                    <span>原图链接</span>
                    <textarea readOnly value={result.originalUrl} />
                    <button type="button" onClick={() => void copyText(result.originalUrl)}>
                      复制链接
                    </button>
                  </div>

                  <div className="result-field">
                    <span>Markdown</span>
                    <textarea readOnly value={result.markdown} />
                    <button type="button" onClick={() => void copyText(result.markdown)}>
                      复制 Markdown
                    </button>
                  </div>

                  <div className="result-field">
                    <span>HTML</span>
                    <textarea readOnly value={result.html} />
                    <button type="button" onClick={() => void copyText(result.html)}>
                      复制 HTML
                    </button>
                  </div>

                  <div className="result-field">
                    <span>BBCode</span>
                    <textarea readOnly value={result.bbcode} />
                    <button type="button" onClick={() => void copyText(result.bbcode)}>
                      复制 BBCode
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </section>
    </main>
  );
}
