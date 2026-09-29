import { memo } from "react";
import { XIcon } from "./icons";
import { CopyButton, UPLOAD_STATUS_LABELS } from "./ui";
import { formatBytes } from "./upload";
import type { UploadItem } from "./types";

export default memo(function UploadCard({ item, onRemove, onRetryHistory }: {
  item: UploadItem;
  onRemove: (id: string) => void;
  onRetryHistory: (item: UploadItem) => void;
}) {
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
    <article className="upload-card">
      <button
        type="button"
        className="card-remove-btn"
        onClick={() => onRemove(item.id)}
        title={item.status === "queued" || item.status === "signing" || item.status === "uploading" ? "取消上传并移除" : "移除此卡片"}
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
        <span className={`status-chip status-${item.status}`}>{UPLOAD_STATUS_LABELS[item.status]}</span>
      </div>

      <div className="progress-bar">
        <div style={{ width: `${item.progress}%` }} />
      </div>

      {item.error ? <p className="error-text">{item.error}</p> : null}

      <img src={item.previewUrl} alt={item.file.name} className="preview-image" loading="lazy" decoding="async" />

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
          <button type="button" className="ghost-button" onClick={() => onRetryHistory(item)}>
            重试保存
          </button>
        </div>
      ) : null}
    </article>
  );
});
