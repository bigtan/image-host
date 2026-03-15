import { useEffect, useMemo, useRef, useState } from "react";

type UploadStatus = "queued" | "signing" | "uploading" | "done" | "error";

type UploadResult = {
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
  uploadUrl: string;
  publicUrl: string;
  objectKey: string;
  expiresAt: string;
  headers: Record<string, string>;
};

const TOKEN_STORAGE_KEY = "image-host.upload-token";
const PREFIX_STORAGE_KEY = "image-host.path-prefix";
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fileToResult(url: string, objectKey: string): UploadResult {
  return {
    objectKey,
    originalUrl: url,
    html: `<img src="${url}" alt="" />`,
    markdown: `![](${url})`,
    bbcode: `[img]${url}[/img]`
  };
}

async function requestUploadSignature(file: File, token: string, prefix: string) {
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
      pathPrefix: prefix
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
    xhr.open("PUT", sign.uploadUrl, true);

    Object.entries(sign.headers).forEach(([key, value]) => {
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

      reject(new Error(`上传失败，COS 返回 ${xhr.status}`));
    };

    xhr.onerror = () => reject(new Error("上传过程中网络异常"));
    xhr.send(file);
  });
}

export default function App() {
  const [token, setToken] = useState("");
  const [pathPrefix, setPathPrefix] = useState("");
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previousItemsRef = useRef<UploadItem[]>([]);

  useEffect(() => {
    const storedToken = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    const storedPrefix = window.localStorage.getItem(PREFIX_STORAGE_KEY);

    if (storedToken) setToken(storedToken);
    if (storedPrefix) setPathPrefix(storedPrefix);
  }, []);

  useEffect(() => {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  }, [token]);

  useEffect(() => {
    if (pathPrefix) {
      window.localStorage.setItem(PREFIX_STORAGE_KEY, pathPrefix);
    } else {
      window.localStorage.removeItem(PREFIX_STORAGE_KEY);
    }
  }, [pathPrefix]);

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

  async function uploadItem(id: string, file: File) {
    const activeToken = token.trim();
    const activePrefix = pathPrefix.trim();

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

      const sign = await requestUploadSignature(file, activeToken, activePrefix);

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
                result: fileToResult(sign.publicUrl, sign.objectKey)
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
          <span className="eyebrow">EdgeOne Pages + COS</span>
          <h1>个人图床上传台</h1>
          <p>
            直接粘贴截图、拖拽图片或选择文件，前端拿到签名后直传 COS，上传完成立即生成原图链接和嵌入代码。
          </p>
        </div>

        <div className="settings-grid">
          <label className="field-card">
            <span>上传令牌</span>
            <input
              type="password"
              autoComplete="off"
              placeholder="会保存到 localStorage"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>

          <label className="field-card">
            <span>对象前缀</span>
            <input
              type="text"
              autoComplete="off"
              placeholder="例如 forum/avatars"
              value={pathPrefix}
              onChange={(event) => setPathPrefix(event.target.value)}
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
          <strong>拖拽图片到这里</strong>
          <p>也支持点击选择文件，或者直接 Ctrl + V 粘贴截图上传</p>
        </div>
      </section>

      <section className="toolbar">
        <div className="stat-pill">
          <span>总文件</span>
          <strong>{items.length}</strong>
        </div>
        <div className="stat-pill">
          <span>完成上传</span>
          <strong>{completedCount}</strong>
        </div>
        <button type="button" className="ghost-button" onClick={clearFinished}>
          清除已完成
        </button>
      </section>

      <section className="queue-grid">
        {items.length === 0 ? (
          <article className="empty-card">
            <h2>还没有文件</h2>
            <p>把截图直接粘贴进页面，就能测试完整上传链路。</p>
          </article>
        ) : null}

        {items.map((item) => (
          <article key={item.id} className="upload-card">
            <img src={item.previewUrl} alt={item.file.name} className="preview-image" />

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

            {item.result ? (
              <div className="result-grid">
                <label className="result-field">
                  <span>原始链接</span>
                  <textarea readOnly value={item.result.originalUrl} />
                  <button type="button" onClick={() => void copyText(item.result.originalUrl)}>
                    复制链接
                  </button>
                </label>

                <label className="result-field">
                  <span>HTML</span>
                  <textarea readOnly value={item.result.html} />
                  <button type="button" onClick={() => void copyText(item.result.html)}>
                    复制 HTML
                  </button>
                </label>

                <label className="result-field">
                  <span>Markdown</span>
                  <textarea readOnly value={item.result.markdown} />
                  <button type="button" onClick={() => void copyText(item.result.markdown)}>
                    复制 Markdown
                  </button>
                </label>

                <label className="result-field">
                  <span>BBCode</span>
                  <textarea readOnly value={item.result.bbcode} />
                  <button type="button" onClick={() => void copyText(item.result.bbcode)}>
                    复制 BBCode
                  </button>
                </label>
              </div>
            ) : null}
          </article>
        ))}
      </section>
    </main>
  );
}

