import { sleep } from "./throttle";

/** fetch with a timeout and retries (network errors, 429, 5xx). DAC_RETRIES sets the retry count (default 2). */
export async function fetchRetry(url: string, init: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const retries = Number(process.env.DAC_RETRIES ?? 2);
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await res.body?.cancel();
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 700 * 2 ** attempt);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(700 * 2 ** attempt);
    }
  }
  throw lastErr;
}
