import net from 'node:net';

import { DEFAULT_HOST, DEFAULT_PORT, PORT_SCAN_RANGE } from '@/lib/config/paths';
import { DevAtlasError } from '@/lib/errors';

/** True when a TCP listener can be bound on host:port right now. */
export function isPortFree(port: number, host: string = DEFAULT_HOST): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    // exclusive avoids a false positive when another process bound with SO_REUSEADDR.
    server.listen({ port, host, exclusive: true });
  });
}

/**
 * Pick a port, preferring {@link DEFAULT_PORT} and scanning upwards when it is
 * taken. DevAtlas never kills whatever already owns 4317 — it simply moves.
 */
export async function selectPort(
  preferred: number = DEFAULT_PORT,
  host: string = DEFAULT_HOST,
): Promise<number> {
  for (let offset = 0; offset <= PORT_SCAN_RANGE; offset += 1) {
    const candidate = preferred + offset;
    if (candidate > 65_535) break;
    if (await isPortFree(candidate, host)) return candidate;
  }
  throw new DevAtlasError(
    'PORT_UNAVAILABLE',
    `No free port found between ${preferred} and ${preferred + PORT_SCAN_RANGE}.`,
  );
}
