import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckIcon,
  CloudIcon,
  CopyIcon,
  FolderIcon,
  ImageIcon,
  InfoIcon,
  LockIcon,
  EyeIcon,
  EyeOffIcon,
  ServerIcon,
  TrashIcon,
  XIcon
} from "./icons";
import {
  fileToResult,
  saveUploadHistory,
  formatBytes,
  requestUploadSignature,
  uploadToSignedUrl
} from "./upload";
import HistoryPage from "./HistoryPage";
import type {
  HealthResponse,
  ProviderOption,
  UploadItem,
  UploadProvider,
  UploadResult
} from "./types";

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

function CopyButton({
  text,
  idleLabel,
  copiedLabel,
  className = ""
}: {
  text: string;
  idleLabel: string;
  copiedLabel: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时静默忽略
    }
  };

  return (
    <button
      type="button"
      className={`${className} ${copied ? "btn-success" : ""}`.trim()}
      onClick={() => void handleCopy()}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? copiedLabel : idleLabel}
    </button>
  );
}

export default function App() {
  const [token, setToken] = useState("");
  const [pathPrefix, setPathPrefix] = useState("uploads");
  const [provider, setProvider] = useState<UploadProvider>("cos");
  const [providers, setProviders] = useState<ProviderOption[]>(FALLBACK_PROVIDERS);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [globalDragging, setGlobalDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [route, setRoute] = useState<"upload" | "history">(
    () => (window.location.hash === "#/history" ? "history" : "upload")
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previousItemsRef = useRef<UploadItem[]>([]);
  const tokenRef = useRef("");
  const pathPrefixRef = useRef("uploads");
  const providerRef = useRef<UploadProvider>("cos");
  const maxUploadSizeRef = useRef(DEFAULT_MAX_UPLOAD_SIZE);

  useEffect(() => {
    const storedToken = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    const storedPrefix = window.localStorage.getItem(PREFIX_STORAGE_KEY);
    const storedProvider = window.localStorage.getItem(PROVIDER_STORAGE_KEY) as UploadProvider | null;

    if (storedToken) setToken(storedToken);
    setPathPrefix(storedPrefix?.trim() || "uploads");
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
    const handleHashChange = () => {
      setRoute(window.location.hash === "#/history" ? "history" : "upload");
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
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
    const activePrefix = pathPrefix.trim() || "uploads";
    pathPrefixRef.current = activePrefix;

    window.localStorage.setItem(PREFIX_STORAGE_KEY, activePrefix);
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

      const result = fileToResult(sign);
      setItems((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                status: "done",
                progress: 100,
                result,
                historyStatus: "saving",
                historyError: undefined
              }
            : item
        )
      );

      await persistUploadHistory(id, file, result, activeToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : "上传失败";
      setItems((current) =>
        current.map((item) =>
          item.id === id ? { ...item, status: "error", error: message } : item
        )
      );
    }
  }

  async function persistUploadHistory(id: string, file: File, result: UploadResult, activeToken: string) {
    try {
      await saveUploadHistory(file, result, activeToken);
      setItems((current) =>
        current.map((item) =>
          item.id === id ? { ...item, historyStatus: "saved", historyError: undefined } : item
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "上传历史保存失败";
      setItems((current) =>
        current.map((item) =>
          item.id === id ? { ...item, historyStatus: "error", historyError: message } : item
        )
      );
      setNotice("图片已上传，但上传历史保存失败。你可以在卡片中重试保存。");
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
      setNotice(`已跳过 ${rejected.length} 个文件：${rejected.join("、")}。仅支持 PNG, JPEG, WEBP, GIF, AVIF 图片。`);
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
    if (route === "history") return;

    const handlePaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []).filter(isAcceptedImage);

      if (!files.length) return;
      event.preventDefault();
      void enqueueFiles(files);
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [route]);

  // Global window-level drag-and-drop handler
  useEffect(() => {
    if (route === "history") return;

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
  }, [providers, provider, route]);

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

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const doneResults = useMemo(
    () =>
      items
        .filter((item) => item.status === "done" && item.result)
        .map((item) => item.result as UploadResult),
    [items]
  );
  const completedCount = doneResults.length;
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

  function retryHistorySave(id: string) {
    const item = items.find((current) => current.id === id);
    const activeToken = tokenRef.current.trim();
    if (!item?.result || !activeToken) {
      setNotice("请先输入上传令牌后重试保存历史记录。");
      return;
    }

    setItems((current) =>
      current.map((current) =>
        current.id === id ? { ...current, historyStatus: "saving", historyError: undefined } : current
      )
    );
    void persistUploadHistory(id, item.file, item.result, activeToken);
  }

  if (route === "history") {
    return (
      <HistoryPage
        token={token}
        onTokenChange={setToken}
        onNavigateUpload={() => {
          window.location.hash = "#/upload";
        }}
      />
    );
  }

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

      {notice ? (
        <div className="notice-banner" role="alert">
          <InfoIcon />
          <span>{notice}</span>
          <button type="button" className="notice-close" onClick={() => setNotice(null)} aria-label="关闭提示">
            <XIcon />
          </button>
        </div>
      ) : null}

      <nav className="page-nav" aria-label="主导航">
        <button type="button" className="nav-link is-active" aria-current="page">
          上传图片
        </button>
        <button type="button" className="nav-link" onClick={() => { window.location.hash = "#/history"; }}>
          上传历史
        </button>
      </nav>

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
            <span>
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
            <span>
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
            <span>
              <FolderIcon /> 路径前缀
            </span>
            <input
              type="text"
              autoComplete="off"
              placeholder="默认 uploads，例如 uploads/forum"
              value={pathPrefix}
              onChange={(event) => setPathPrefix(event.target.value)}
            />
          </label>

          <label className="field-card">
            <span>
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
        role="button"
        tabIndex={0}
        aria-label="选择或拖拽图片上传"
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
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            fileInputRef.current?.click();
          }
        }}
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
            <CopyButton
              className="batch-button"
              text={doneResults.map((result) => result.originalUrl).join("\n")}
              idleLabel="复制全部链接"
              copiedLabel="链接已复制"
            />
            <CopyButton
              className="batch-button"
              text={doneResults.map((result) => result.markdown).join("\n")}
              idleLabel="复制全部 Markdown"
              copiedLabel="Markdown已复制"
            />
            <CopyButton
              className="batch-button"
              text={doneResults.map((result) => result.html).join("\n")}
              idleLabel="复制全部 HTML"
              copiedLabel="HTML已复制"
            />
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
          const resultFields = result
            ? [
                { label: "原图链接", value: result.originalUrl, copyLabel: "复制链接" },
                { label: "Markdown", value: result.markdown, copyLabel: "复制 Markdown" },
                { label: "HTML", value: result.html, copyLabel: "复制 HTML" },
                { label: "BBCode", value: result.bbcode, copyLabel: "复制 BBCode" }
              ]
            : [];

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
                  {resultFields.map((field) => (
                    <div className="result-field" key={field.label}>
                      <span>{field.label}</span>
                      <textarea readOnly value={field.value} />
                      <CopyButton text={field.value} idleLabel={field.copyLabel} copiedLabel="已复制" />
                    </div>
                  ))}
                </div>
              ) : null}

              {item.historyStatus === "saving" ? <p className="history-saving">正在保存上传历史…</p> : null}
              {item.historyStatus === "error" ? (
                <div className="history-save-error">
                  <span>图片已上传，但历史未保存：{item.historyError}</span>
                  <button type="button" className="ghost-button" onClick={() => retryHistorySave(item.id)}>
                    重试保存
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
      </section>
    </main>
  );
}
