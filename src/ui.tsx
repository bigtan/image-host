import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon } from "./icons";

export const UPLOAD_STATUS_LABELS = {
  queued: "等待上传",
  signing: "正在准备",
  uploading: "正在上传",
  done: "上传完成",
  error: "上传失败"
} as const;

export function PageNav({ active }: { active: "upload" | "history" }) {
  const navigate = (route: "upload" | "history") => {
    window.location.hash = `#/${route}`;
  };

  return (
    <nav className="page-nav" aria-label="主导航">
      <button type="button" className={`nav-link ${active === "upload" ? "is-active" : ""}`} aria-current={active === "upload" ? "page" : undefined} onClick={() => navigate("upload")}>
        上传图片
      </button>
      <button type="button" className={`nav-link ${active === "history" ? "is-active" : ""}`} aria-current={active === "history" ? "page" : undefined} onClick={() => navigate("history")}>
        上传历史
      </button>
    </nav>
  );
}

export function PageHeader({ eyebrow, title, description, children, className = "" }: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`hero-card ${className}`.trim()}>
      <div className="hero-copy">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </section>
  );
}

export function CopyButton({ text, idleLabel, copiedLabel = "已复制", className = "" }: {
  text: string;
  idleLabel: string;
  copiedLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access is optional.
    }
  };

  return (
    <button type="button" className={`${className} ${copied ? "btn-success" : ""}`.trim()} onClick={() => void copy()}>
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? copiedLabel : idleLabel}
    </button>
  );
}
