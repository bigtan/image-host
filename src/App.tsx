import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckIcon,
  CloudIcon,
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
import UploadCard from "./UploadCard";
import { UploadQueue } from "./uploadQueue";
import { requestJson } from "./request";
import { CopyButton, PageHeader, PageNav } from "./ui";
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
  }
];

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
  const [uploadQueue] = useState(() => new UploadQueue(UPLOAD_CONCURRENCY));
  const historyControllers = useRef(new Map<string, AbortController>());
  const uploadTokens = useRef(new Map<string, string>());

  useEffect(() => {
    const storedToken = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    const storedPrefix = window.localStorage.getItem(PREFIX_STORAGE_KEY);
    const storedProvider = window.localStorage.getItem(PROVIDER_STORAGE_KEY) as UploadProvider | null;

    if (storedToken) setToken(storedToken);
    setPathPrefix(storedPrefix?.trim() || "uploads");
    if (storedProvider === "cos") {
      setProvider(storedProvider);
    }

    const controller = new AbortController();
    void requestJson<HealthResponse>("/api/health", { signal: controller.signal })
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
    return () => controller.abort();
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

  async function uploadItem(id: string, file: File, activeToken: string, activePrefix: string, activeProvider: UploadProvider, signal: AbortSignal) {

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

      const sign = await requestUploadSignature(file, activeToken, activePrefix, activeProvider, signal);
      signal.throwIfAborted();

      setItems((current) =>
        current.map((item) =>
          item.id === id ? { ...item, status: "uploading", progress: 3 } : item
        )
      );

      await uploadToSignedUrl(file, sign, (progress) => {
        setItems((current) =>
          current.map((item) => (item.id === id && item.progress !== progress ? { ...item, progress } : item))
        );
      }, signal);
      signal.throwIfAborted();

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

      await persistUploadHistory(id, file, result, activeToken, signal);
    } catch (error) {
      if (signal.aborted) return;
      const message = error instanceof Error ? error.message : "上传失败";
      setItems((current) =>
        current.map((item) =>
          item.id === id ? { ...item, status: "error", error: message } : item
        )
      );
    }
  }

  async function persistUploadHistory(id: string, file: File, result: UploadResult, activeToken: string, signal: AbortSignal) {
    try {
      await saveUploadHistory(file, result, activeToken, signal);
      signal.throwIfAborted();
      setItems((current) =>
        current.map((item) =>
          item.id === id ? { ...item, historyStatus: "saved", historyError: undefined } : item
        )
      );
    } catch (error) {
      if (signal.aborted) return;
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

    const activeToken = tokenRef.current.trim();
    const activePrefix = pathPrefixRef.current.trim();
    const activeProvider = providerRef.current;
    for (const item of nextItems) {
      uploadTokens.current.set(item.id, activeToken);
      uploadQueue.add(item.id, signal => uploadItem(item.id, item.file, activeToken, activePrefix, activeProvider, signal));
    }
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
    setGlobalDragging(false);
    setDragging(false);
    if (route === "history") return;

    let dragCounter = 0;

    const handleDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      dragCounter++;
      setGlobalDragging(true);
    };

    const handleDragOver = (event: DragEvent) => {
      event.preventDefault();
    };

    const handleDragLeave = (event: DragEvent) => {
      event.preventDefault();
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) {
        setGlobalDragging(false);
      }
    };

    const handleDrop = (event: DragEvent) => {
      event.preventDefault();
      setGlobalDragging(false);
      setDragging(false);
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
  }, [route]);

  useEffect(() => {
    const previousItems = previousItemsRef.current;
    const activeIds = new Set(items.map((item) => item.id));

    previousItems
      .filter((item) => !activeIds.has(item.id))
      .forEach((item) => {
        URL.revokeObjectURL(item.previewUrl);
        uploadTokens.current.delete(item.id);
      });

    previousItemsRef.current = items;
  }, [items]);

  useEffect(() => {
    return () => {
      uploadQueue.cancelAll();
      historyControllers.current.forEach(controller => controller.abort());
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
    setItems(current => current.filter(item => item.status !== "done" || item.historyStatus !== "saved"));
  }

  const removeCard = useCallback((id: string) => {
    uploadQueue.cancel(id);
    historyControllers.current.get(id)?.abort();
    historyControllers.current.delete(id);
    setItems(current => current.filter(item => item.id !== id));
  }, [uploadQueue]);

  const retryHistorySave = useCallback((item: UploadItem) => {
    const id = item.id;
    const activeToken = uploadTokens.current.get(id) ?? "";
    if (historyControllers.current.has(id)) return;
    if (!item?.result || !activeToken) {
      setNotice("请先输入上传令牌后重试保存历史记录。");
      return;
    }

    setItems((current) =>
      current.map((current) =>
        current.id === id ? { ...current, historyStatus: "saving", historyError: undefined } : current
      )
    );
    const controller = new AbortController();
    historyControllers.current.set(id, controller);
    void persistUploadHistory(id, item.file, item.result, activeToken, controller.signal)
      .finally(() => historyControllers.current.delete(id));
  }, []);

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

      <PageNav active="upload" />

      <PageHeader eyebrow="多后端图片托管" title="个人图床上传台" description="简洁、快速且安全的图片托管方案，支持粘贴、拖拽或选择图片上传。">
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
      </PageHeader>

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
          // The window handler owns enqueueing and resetting both drag indicators.
          setDragging(false);
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
          <CloudIcon className="dropzone-icon" />
          <strong>选择要上传的图片</strong>
          <p>拖拽到此处、点击选择，或直接从剪贴板粘贴</p>
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
              copiedLabel="Markdown 已复制"
            />
            <CopyButton
              className="batch-button"
              text={doneResults.map((result) => result.html).join("\n")}
              idleLabel="复制全部 HTML"
              copiedLabel="HTML 已复制"
            />
          </div>
        )}

        <button type="button" className="ghost-button" onClick={clearFinished}>
          <TrashIcon />
          清空已保存
        </button>
      </section>

      <section className="queue-grid">
        {items.length === 0 ? (
          <article className="empty-card">
            <ImageIcon className="empty-icon" />
            <h2>还没有上传任务</h2>
            <p>选择图片后，上传进度和结果会显示在这里。</p>
          </article>
        ) : null}

        {items.map(item => (
          <UploadCard key={item.id} item={item} onRemove={removeCard} onRetryHistory={retryHistorySave} />
        ))}
      </section>
    </main>
  );
}
