export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const tails = new Map<string, Promise<void>>();

/** Spaces out queries to one host/key with a minimum gap (protects against IP bans). */
export function throttle(key: string, gapMs: number): Promise<void> {
  const prev = tails.get(key) ?? Promise.resolve();
  tails.set(key, prev.then(() => sleep(gapMs)));
  return prev;
}
