/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Dev-only: serve the Vercel-style handlers in /api (export async function GET/POST(req: Request))
 * from the Vite dev server, so the whole app runs locally with `npm run dev`.
 */
function devApi(): Plugin {
  return {
    name: 'lawnlens-dev-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = new URL(req.url ?? '/', 'https://localhost');
        const m = url.pathname.match(/^\/api\/([a-z-]+)$/);
        if (!m) return next();
        try {
          const mod = await server.ssrLoadModule(`/api/${m[1]}.ts`);
          const handler = mod[req.method ?? 'GET'];
          if (typeof handler !== 'function') {
            res.statusCode = 405;
            return res.end('Method not allowed');
          }
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const body = chunks.length ? Buffer.concat(chunks) : undefined;
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (k.startsWith(':') || v === undefined) continue; // skip HTTP/2 pseudo-headers
            headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
          }
          const request = new Request(url, {
            method: req.method,
            headers,
            body: body && req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined,
          });
          const response: Response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          server.config.logger.error(String((err as Error)?.stack ?? err));
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: `Dev API crashed: ${(err as Error)?.message ?? err}` }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Expose MODEL_API_KEY etc. to the dev API handlers (server-side only; never prefixed with VITE_).
  const env = loadEnv(mode, process.cwd(), '');
  for (const k of ['MODEL_API_KEY', 'MUSE_MODEL', 'SAM_MODEL']) if (env[k] && !process.env[k]) process.env[k] = env[k];
  return {
    plugins: [react(), basicSsl(), devApi()],
    server: { host: true },
    test: { include: ['src/**/*.test.ts', 'api/**/*.test.ts'] },
  };
});
