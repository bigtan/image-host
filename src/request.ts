export const API_TIMEOUT_MS = 30_000;
export const UPLOAD_TIMEOUT_MS = 5 * 60_000;

/** Keep the deadline active until the response body has also been consumed. */
export async function requestJson<T>(url: string, init: RequestInit = {}, timeoutMs = API_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("请求超时，请重试", "TimeoutError")), timeoutMs);
  try {
    controller.signal.throwIfAborted();
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = await response.json().catch(error => {
      controller.signal.throwIfAborted();
      if (!response.ok) return {};
      throw new Error("服务端返回了无效响应", { cause: error });
    });
    controller.signal.throwIfAborted();
    if (!response.ok) throw new Error(payload.error ?? `请求失败（${response.status}）`);
    return payload as T;
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}
