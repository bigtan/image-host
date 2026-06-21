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
  maxUploadSize?: number;
};

const TOKEN_STORAGE_KEY = "image-host.upload-token";
const PREFIX_STORAGE_KEY = "image-host.path-prefix";
const PROVIDER_STORAGE_KEY = "image-host.upload-provider";
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"];
const DEFAULT_MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 3;

function isAcceptedImage(file: File) {
  return ACCEPTED_TYPES.includes(file.type);
}
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

const EyeIcon = ({ className = "icon", ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg className={className} viewBox="0 0 24 24" {...props}><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z"/><circle cx="12" cy="12" r="3"/></svg>
);

const EyeOffIcon = ({ className = "icon", ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg className={className} viewBox="0 0 24 24" {...props}><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20"/></svg>
);

const CloudIcon = ({ className = "icon", ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg className={className} viewBox="0 0 24 24" {...props}><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M12 12v9m-4-4 4-4 4 4"/></svg>
);

const LockIcon = ({ className = "icon", ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg className={className} viewBox="0 0 24 24" {...props}><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
);

const FolderIcon = ({ className = "icon", ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg className={className} viewBox="0 0 24 24" {...props}><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
);

const ServerIcon = ({ className = "icon", ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg className={className} viewBox="0 0 24 24" {...props}><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>
);

const InfoIcon = ({ className = "icon", ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg className={className} viewBox="0 0 24 24" {...props}><circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/></svg>
);

const TrashIcon = ({ className = "icon", ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg className={className} viewBox="0 0 24 24" {...props}><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2m-9 5v6m4-6v6"/></svg>
);

const XIcon = ({ className = "icon", ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg className={className} viewBox="0 0 24 24" {...props}><path d="M18 6 6 18M6 6l12 12"/></svg>
);

const CopyIcon = ({ className = "icon", ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg className={className} viewBox="0 0 24 24" {...props}><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
);

const CheckIcon = ({ className = "icon", ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg className={className} viewBox="0 0 24 24" {...props}><path d="m9 11 3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
);

const ImageIcon = ({ className = "icon", ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg className={className} viewBox="0 0 24 24" {...props}><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
);

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

export default function App() {
  const [token, setToken] = useState("");
  const [pathPrefix, setPathPrefix] = useState("");
  const [provider, setProvider] = useState<UploadProvider>("cos");
  const [providers, setProviders] = useState<ProviderOption[]>(FALLBACK_PROVIDERS);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [globalDragging, setGlobalDragging] = useState(false);
  const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previousItemsRef = useRef<UploadItem[]>([]);
  const tokenRef = useRef("");
  const pathPrefixRef = useRef("");
  const providerRef = useRef<UploadProvider>("cos");
  const maxUploadSizeRef = useRef(DEFAULT_MAX_UPLOAD_SIZE);

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
        if (payload.maxUploadSize && payload.maxUploadSize > 0) {
          maxUploadSizeRef.current = payload.maxUploadSize;
        }

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
    const maxSize = maxUploadSizeRef.current;
    const rejected: string[] = [];
    const candidates = files.filter((file) => {
      if (!isAcceptedImage(file)) {
        rejected.push(`${file.name || "未命名文件"}（格式不支持）`);
        return false;
      }
      if (maxSize > 0 && file.size > maxSize) {
        rejected.push(`${file.name || "未命名文件"}（超过 ${formatBytes(maxSize)}）`);
        return false;
      }
      return true;
    });
    if (rejected.length) {
      alert(`以下文件已被跳过：\n${rejected.join("\n")}\n\n仅支持 PNG, JPEG, WEBP, GIF, AVIF 图片。`);
    }
    if (!candidates.length) return;

    const nextItems = candidates.map<UploadItem>((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      progress: 0,
      status: "queued"
    }));

    setItems((current) => [...nextItems, ...current]);

    // 并发上传，最多同时处理 UPLOAD_CONCURRENCY 个，其余排队
    const queue = [...nextItems];
    const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const item = queue.shift();
        if (!item) break;
        await uploadItem(item.id, item.file);
      }
    });
    await Promise.all(workers);
  }

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []).filter(isAcceptedImage);

      if (!files.length) return;
      event.preventDefault();
      void enqueueFiles(files);
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  // Global window-level drag-and-drop handler
  useEffect(() => {
    let dragCounter = 0;

    const handleDragEnter = (event: DragEvent) => {
      event.preventDefault();
      dragCounter++;
      if (event.dataTransfer?.types.includes("Files")) {
        setGlobalDragging(true);
      }
    };

    const handleDragOver = (event: DragEvent) => {
      event.preventDefault();
    };

    const handleDragLeave = (event: DragEvent) => {
      event.preventDefault();
      dragCounter--;
      if (dragCounter === 0) {
        setGlobalDragging(false);
      }
    };

    const handleDrop = (event: DragEvent) => {
      event.preventDefault();
      setGlobalDragging(false);
      dragCounter = 0;
      if (event.dataTransfer?.files) {
        handleFileSelection(event.dataTransfer.files);
      }
    };

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, [providers, provider]);

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

  function removeCard(id: string) {
    setItems((current) => {
      const itemToRemove = current.find((item) => item.id === id);
      if (itemToRemove) {
        URL.revokeObjectURL(itemToRemove.previewUrl);
      }
      return current.filter((item) => item.id !== id);
    });
  }

  const triggerCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedStates((current) => ({ ...current, [id]: true }));
      setTimeout(() => {
        setCopiedStates((current) => ({ ...current, [id]: false }));
      }, 1500);
    } catch {
      // ignore
    }
  };

  return (
    <main className="page-shell">
      {/* Full screen global drag overlay */}
      <div className={`global-drag-overlay ${globalDragging ? "is-active" : ""}`}>
        <div className="global-drag-content">
          <CloudIcon className="cloud-icon" />
          <h2>释放鼠标立即上传</h2>
          <p>支持拖拽多个 PNG, JPEG, WEBP, GIF, AVIF 格式图片</p>
        </div>
      </div>

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
            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <ServerIcon /> 上传后端
            </span>
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
            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <LockIcon /> 上传令牌
            </span>
            <div className="field-card-input-wrapper">
              <input
                type={showToken ? "text" : "password"}
                autoComplete="off"
                placeholder="令牌将保存至本地"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
              <button 
                type="button" 
                className="eye-button" 
                onClick={() => setShowToken(!showToken)}
                title={showToken ? "隐藏令牌" : "显示令牌"}
              >
                {showToken ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </label>

          <label className="field-card">
            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <FolderIcon /> 路径前缀
            </span>
            <input
              type="text"
              autoComplete="off"
              placeholder="例如 forum/avatars"
              value={pathPrefix}
              onChange={(event) => setPathPrefix(event.target.value)}
            />
          </label>

          <label className="field-card">
            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <InfoIcon /> CDN 域名
            </span>
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
          event.stopPropagation();
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
          <CloudIcon className="cloud-icon" style={{ width: "48px", height: "48px", color: "var(--accent)", marginBottom: "12px" }} />
          <strong>准备好上传了吗？</strong>
          <p>拖拽图片到这里，点击浏览，或者直接从剪贴板粘贴</p>
        </div>
      </section>

      <section className="toolbar">
        <div className="stat-pill">
          <ImageIcon />
          <span>总文件</span>
          <strong>{items.length}</strong>
        </div>
        <div className="stat-pill">
          <CheckIcon />
          <span>已完成</span>
          <strong>{completedCount}</strong>
        </div>

        {completedCount > 0 && (
          <div className="batch-actions">
            <button
              type="button"
              className={`batch-button ${copiedStates["batch-url"] ? "btn-success" : ""}`}
              onClick={() => {
                const urls = items.filter(item => item.status === "done" && item.result).map(item => item.result!.originalUrl).join("\n");
                void triggerCopy("batch-url", urls);
              }}
            >
              {copiedStates["batch-url"] ? <CheckIcon /> : <CopyIcon />}
              {copiedStates["batch-url"] ? "链接已复制" : "复制全部链接"}
            </button>
            <button
              type="button"
              className={`batch-button ${copiedStates["batch-markdown"] ? "btn-success" : ""}`}
              onClick={() => {
                const mds = items.filter(item => item.status === "done" && item.result).map(item => item.result!.markdown).join("\n");
                void triggerCopy("batch-markdown", mds);
              }}
            >
              {copiedStates["batch-markdown"] ? <CheckIcon /> : <CopyIcon />}
              {copiedStates["batch-markdown"] ? "Markdown已复制" : "复制全部 Markdown"}
            </button>
            <button
              type="button"
              className={`batch-button ${copiedStates["batch-html"] ? "btn-success" : ""}`}
              onClick={() => {
                const htmls = items.filter(item => item.status === "done" && item.result).map(item => item.result!.html).join("\n");
                void triggerCopy("batch-html", htmls);
              }}
            >
              {copiedStates["batch-html"] ? <CheckIcon /> : <CopyIcon />}
              {copiedStates["batch-html"] ? "HTML已复制" : "复制全部 HTML"}
            </button>
          </div>
        )}

        <button type="button" className="ghost-button" onClick={clearFinished}>
          <TrashIcon />
          清空已完成
        </button>
      </section>

      <section className="queue-grid">
        {items.length === 0 ? (
          <article className="empty-card">
            <ImageIcon style={{ width: "40px", height: "40px", color: "var(--muted)", marginBottom: "12px" }} />
            <h2>暂无文件</h2>
            <p>上传后的图片将在这里显示。</p>
          </article>
        ) : null}

        {items.map((item) => {
          const result = item.result;

          return (
            <article key={item.id} className="upload-card">
              <button 
                type="button" 
                className="card-remove-btn" 
                onClick={() => removeCard(item.id)}
                title="移除此卡片"
              >
                <XIcon />
              </button>

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
                    <button 
                      type="button" 
                      className={copiedStates[`${item.id}-url`] ? "btn-success" : ""}
                      onClick={() => void triggerCopy(`${item.id}-url`, result.originalUrl)}
                    >
                      {copiedStates[`${item.id}-url`] ? <CheckIcon /> : <CopyIcon />}
                      {copiedStates[`${item.id}-url`] ? "已复制" : "复制链接"}
                    </button>
                  </div>

                  <div className="result-field">
                    <span>Markdown</span>
                    <textarea readOnly value={result.markdown} />
                    <button 
                      type="button" 
                      className={copiedStates[`${item.id}-md`] ? "btn-success" : ""}
                      onClick={() => void triggerCopy(`${item.id}-md`, result.markdown)}
                    >
                      {copiedStates[`${item.id}-md`] ? <CheckIcon /> : <CopyIcon />}
                      {copiedStates[`${item.id}-md`] ? "已复制" : "复制 Markdown"}
                    </button>
                  </div>

                  <div className="result-field">
                    <span>HTML</span>
                    <textarea readOnly value={result.html} />
                    <button 
                      type="button" 
                      className={copiedStates[`${item.id}-html`] ? "btn-success" : ""}
                      onClick={() => void triggerCopy(`${item.id}-html`, result.html)}
                    >
                      {copiedStates[`${item.id}-html`] ? <CheckIcon /> : <CopyIcon />}
                      {copiedStates[`${item.id}-html`] ? "已复制" : "复制 HTML"}
                    </button>
                  </div>

                  <div className="result-field">
                    <span>BBCode</span>
                    <textarea readOnly value={result.bbcode} />
                    <button 
                      type="button" 
                      className={copiedStates[`${item.id}-bbcode`] ? "btn-success" : ""}
                      onClick={() => void triggerCopy(`${item.id}-bbcode`, result.bbcode)}
                    >
                      {copiedStates[`${item.id}-bbcode`] ? <CheckIcon /> : <CopyIcon />}
                      {copiedStates[`${item.id}-bbcode`] ? "已复制" : "复制 BBCode"}
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
