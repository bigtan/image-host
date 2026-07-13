import { useEffect, useState } from "react";
import { ImageIcon, InfoIcon, LockIcon } from "./icons";
import { fetchUploadHistory, formatBytes } from "./upload";
import type { UploadHistoryItem } from "./types";
import { CopyButton, PageHeader, PageNav } from "./ui";

function formatUploadedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

export default function HistoryPage({
  token,
  onTokenChange,
  onNavigateUpload
}: {
  token: string;
  onTokenChange: (value: string) => void;
  onNavigateUpload: () => void;
}) {
  const [draftToken, setDraftToken] = useState(token);
  const [items, setItems] = useState<UploadHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<UploadHistoryItem | null>(null);

  const loadHistory = async (reset: boolean, requestedToken = token) => {
    const activeToken = requestedToken.trim();
    if (!activeToken) {
      setItems([]);
      setNextCursor(null);
      setError("请输入上传令牌后查看历史记录。");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const payload = await fetchUploadHistory(activeToken, reset ? null : nextCursor);
      setItems((current) => (reset ? payload.items : [...current, ...payload.items]));
      setNextCursor(payload.nextCursor);
      if (reset) setSelectedItem(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "读取上传历史失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setDraftToken(token);
    void loadHistory(true, token);
    // The saved token changes only on initial restoration or an explicit history query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const submitToken = () => {
    if (draftToken === token) {
      void loadHistory(true, draftToken);
      return;
    }
    onTokenChange(draftToken);
  };

  if (selectedItem) {
    const fields = [
      { label: "原图链接", value: selectedItem.originalUrl, copyLabel: "复制原图链接" },
      { label: "Markdown", value: `![](${selectedItem.originalUrl})`, copyLabel: "复制 Markdown" },
      { label: "HTML", value: `<img src=\"${selectedItem.originalUrl}\" alt=\"\" />`, copyLabel: "复制 HTML" },
      { label: "BBCode", value: `[img]${selectedItem.originalUrl}[/img]`, copyLabel: "复制 BBCode" }
    ];

    return (
      <main className="page-shell">
        <PageNav active="history" />
        <button type="button" className="ghost-button detail-back-button" onClick={() => setSelectedItem(null)}>
          返回上传历史
        </button>
        <section className="detail-card">
          <div className="detail-preview">
            <img src={selectedItem.originalUrl} alt={selectedItem.fileName} />
          </div>
          <div className="detail-content">
            <span className="eyebrow">图片详情</span>
            <h1 title={selectedItem.fileName}>{selectedItem.fileName}</h1>
            <dl className="detail-meta">
              <div><dt>文件类型</dt><dd>{selectedItem.contentType}</dd></div>
              <div><dt>文件大小</dt><dd>{formatBytes(selectedItem.fileSize)}</dd></div>
              <div><dt>上传后端</dt><dd>{selectedItem.providerLabel}</dd></div>
              <div><dt>上传时间</dt><dd>{formatUploadedAt(selectedItem.uploadedAt)}</dd></div>
              <div className="detail-meta-wide"><dt>对象路径</dt><dd><code>{selectedItem.objectKey}</code></dd></div>
            </dl>
            <div className="detail-copy-list">
              {fields.map((field) => (
                <div className="detail-copy-row" key={field.label}>
                  <span>{field.label}</span>
                  <code title={field.value}>{field.value}</code>
                  <CopyButton className="history-copy" text={field.value} idleLabel={field.copyLabel} />
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <PageNav active="history" />
      <PageHeader eyebrow="图片管理" title="上传历史" description="查看当前上传令牌保存过的图片记录。" className="history-hero">
        <div className="history-actions">
          <button type="button" className="ghost-button" onClick={onNavigateUpload}>
            上传图片
          </button>
          <button type="button" className="primary-button" onClick={submitToken} disabled={loading}>
            {loading ? "加载中…" : "查看记录"}
          </button>
        </div>
        <label className="field-card history-token-field">
          <span>
            <LockIcon /> 上传令牌
          </span>
          <input
            type="password"
            autoComplete="off"
            placeholder="输入令牌以查看历史记录"
            value={draftToken}
            onChange={(event) => setDraftToken(event.target.value)}
          />
        </label>
      </PageHeader>

      {error ? (
        <section className="notice-banner" role="alert">
          <InfoIcon />
          <span>{error}</span>
        </section>
      ) : null}

      <section className="toolbar history-toolbar">
        <div className="stat-pill">
          <ImageIcon />
          <span>已加载</span>
          <strong>{items.length}</strong>
        </div>
      </section>

      <section className="history-grid">
        {!loading && !error && items.length === 0 ? (
          <article className="empty-card">
            <ImageIcon className="empty-icon" />
            <h2>还没有上传记录</h2>
            <p>使用当前令牌上传成功的图片会显示在这里。</p>
          </article>
        ) : null}

        {items.map((item) => (
          <article className="history-card" key={item.id}>
            <button type="button" className="history-image-link" onClick={() => setSelectedItem(item)} aria-label={`查看 ${item.fileName} 详情`}>
              <img src={item.originalUrl} alt={item.fileName} className="history-image" loading="lazy" />
            </button>
            <div className="history-card-body">
              <h2 title={item.fileName}>{item.fileName}</h2>
              <p>{item.contentType} · {formatBytes(item.fileSize)}</p>
              <p>{item.providerLabel} · {formatUploadedAt(item.uploadedAt)}</p>
              <code title={item.objectKey}>{item.objectKey}</code>
              <CopyButton className="history-copy" text={item.originalUrl} idleLabel="复制链接" />
            </div>
          </article>
        ))}
      </section>

      {nextCursor ? (
        <div className="history-load-more">
          <button type="button" className="primary-button" onClick={() => void loadHistory(false)} disabled={loading}>
            {loading ? "加载中…" : "加载更多"}
          </button>
        </div>
      ) : null}
    </main>
  );
}
