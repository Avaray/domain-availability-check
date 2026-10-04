/** Simple TCP query (WHOIS, port 43): send text, read until the connection closes. */
export function tcpQuery(
  host: string,
  port: number,
  payload: string,
  timeoutMs = 10_000,
  maxBytes = 262_144,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    let socket: { end(): void } | undefined;

    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.end();
      } catch {
        /* already closed */
      }
      if (err) reject(err);
      else resolve(Buffer.concat(chunks).toString("utf8"));
    };

    // On timeout, return whatever has arrived; with no data at all it's an error.
    const timer = setTimeout(() => done(size > 0 ? undefined : new Error(`timeout (${host}:${port})`)), timeoutMs);

    Bun.connect({
      hostname: host,
      port,
      socket: {
        open(s) {
          socket = s;
          s.write(payload);
        },
        data(_s, data) {
          chunks.push(Buffer.from(data)); // copy: the buffer may be shared
          size += data.length;
          if (size > maxBytes) done();
        },
        close() {
          done();
        },
        error(_s, e) {
          done(e);
        },
        connectError(_s, e) {
          done(e);
        },
      },
    }).catch((e) => done(e));
  });
}
