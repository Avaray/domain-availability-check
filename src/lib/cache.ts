import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

const dir = () => process.env.DAC_CACHE_DIR ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "dac");

/**
 * File cache for IANA data (TLD list, RDAP bootstrap, WHOIS servers).
 * If a refresh fails, we return stale data instead of an error.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  keep: (value: T) => boolean = () => true,
): Promise<T> {
  const file = Bun.file(join(dir(), `${key}.json`));
  let stale: { value: T } | undefined;

  try {
    if (await file.exists()) {
      const hit = (await file.json()) as { at: number; value: T };
      if (Date.now() - hit.at < ttlMs) return hit.value;
      stale = hit;
    }
  } catch {
    /* corrupted cache: ignore */
  }

  try {
    const value = await load();
    if (keep(value)) {
      try {
        await mkdir(dir(), { recursive: true });
        await Bun.write(file, JSON.stringify({ at: Date.now(), value }));
      } catch {
        /* the cache is optional */
      }
    }
    return value;
  } catch (e) {
    if (stale) return stale.value;
    throw e;
  }
}
