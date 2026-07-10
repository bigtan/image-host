export type UploadStatus = "queued" | "signing" | "uploading" | "done" | "error";
export type UploadProvider = "cos" | "upyun";

export type ProviderOption = {
  name: UploadProvider;
  label: string;
  configured: boolean;
  cdnBaseUrl: string;
  description: string;
};

export type UploadResult = {
  provider: UploadProvider;
  providerLabel: string;
  cdnBaseUrl: string;
  objectKey: string;
  originalUrl: string;
  html: string;
  markdown: string;
  bbcode: string;
};

export type UploadItem = {
  id: string;
  file: File;
  previewUrl: string;
  progress: number;
  status: UploadStatus;
  error?: string;
  result?: UploadResult;
  historyStatus?: "saving" | "saved" | "error";
  historyError?: string;
};

export type UploadHistoryItem = {
  id: string;
  provider: UploadProvider;
  providerLabel: string;
  objectKey: string;
  originalUrl: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  uploadedAt: string;
};

export type UploadHistoryResponse = {
  items: UploadHistoryItem[];
  nextCursor: string | null;
};

export type SignResponse = {
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

export type HealthResponse = {
  ok: true;
  defaultProvider: UploadProvider;
  providers: ProviderOption[];
  maxUploadSize?: number;
};
