/** Micro-routeur HTTP sans dépendance : JSON, cookies, fichiers statiques. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { HttpError, type Account } from './platform.ts';

export interface Req {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  cookies: Record<string, string>;
  ip: string;
  body: any;
  raw?: Buffer;
  account?: Account;
  setCookie(name: string, value: string, opts?: { maxAge?: number; clear?: boolean }): void;
}

export type Handler = (req: Req) => unknown | Promise<unknown>;

/** Réponse fichier (téléchargement / lecture audio). */
export class FileReply {
  readonly path: string;
  readonly mime: string;
  constructor(path: string, mime: string) {
    this.path = path;
    this.mime = mime;
  }
}

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
  raw: boolean;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export class Router {
  private readonly routes: Route[] = [];
  secureCookies = false;
  maxJsonBytes = 4 * 1024 * 1024;
  maxRawBytes = 100 * 1024 * 1024;
  staticDir?: string;
  authenticate?: (token: string | undefined) => Account | undefined;

  add(method: string, pattern: string, handler: Handler, opts: { raw?: boolean } = {}) {
    this.routes.push({ method, parts: pattern.split('/').filter(Boolean), handler, raw: !!opts.raw });
  }
  get = (p: string, h: Handler) => this.add('GET', p, h);
  post = (p: string, h: Handler) => this.add('POST', p, h);
  put = (p: string, h: Handler) => this.add('PUT', p, h);
  delete = (p: string, h: Handler) => this.add('DELETE', p, h);

  private match(method: string, path: string): { route: Route; params: Record<string, string> } | undefined {
    const parts = path.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method || route.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const p = route.parts[i]!;
        if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(parts[i]!);
        else if (p !== parts[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { route, params };
    }
    return undefined;
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://local');
    const method = req.method ?? 'GET';
    const cookies = parseCookies(req.headers.cookie);
    const setCookies: string[] = [];
    const send = (status: number, data: unknown) => {
      const body = JSON.stringify(data);
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        ...(setCookies.length ? { 'set-cookie': setCookies } : {}),
      });
      res.end(body);
    };

    if (!url.pathname.startsWith('/api/')) return this.serveStatic(url.pathname, res);

    try {
      const m = this.match(method, url.pathname);
      if (!m) throw new HttpError(404, 'Route inconnue.');
      // Protection CSRF : toute écriture doit venir du Studio (en-tête personnalisé + cookie SameSite=Strict).
      if (method !== 'GET' && req.headers['x-kingdom'] !== '1') throw new HttpError(403, 'Requête refusée.');
      const r: Req = {
        method,
        path: url.pathname,
        params: m.params,
        query: url.searchParams,
        headers: req.headers,
        cookies,
        ip: (req.socket.remoteAddress ?? '').replace('::ffff:', ''),
        body: {},
        account: this.authenticate?.(cookies.kingdom_session),
        setCookie: (name, value, opts = {}) => {
          const parts = [`${name}=${opts.clear ? '' : encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
          if (this.secureCookies) parts.push('Secure');
          if (opts.clear) parts.push('Max-Age=0');
          else if (opts.maxAge) parts.push(`Max-Age=${Math.floor(opts.maxAge)}`);
          setCookies.push(parts.join('; '));
        },
      };
      if (method !== 'GET') {
        const buf = await readBody(req, m.route.raw ? this.maxRawBytes : this.maxJsonBytes);
        if (m.route.raw) r.raw = buf;
        else if (buf.length) {
          try {
            r.body = JSON.parse(buf.toString('utf8'));
          } catch {
            throw new HttpError(400, 'JSON invalide.');
          }
        }
      }
      const out = await m.route.handler(r);
      if (out instanceof FileReply) {
        const size = statSync(out.path).size;
        res.writeHead(200, { 'content-type': out.mime, 'content-length': size, 'cache-control': 'private, max-age=300' });
        createReadStream(out.path).pipe(res);
        return;
      }
      send(200, out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) send(e.status, { error: e.message, ...(e.data && typeof e.data === 'object' ? e.data : {}) });
      else {
        console.error(`Erreur ${method} ${url.pathname} :`, e);
        send(500, { error: 'Erreur interne. Consulte les journaux du serveur.' });
      }
    }
  }

  private serveStatic(pathname: string, res: ServerResponse) {
    if (!this.staticDir) {
      res.writeHead(404).end();
      return;
    }
    const safe = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
    let file = join(this.staticDir, safe);
    if (!file.startsWith(this.staticDir + sep) && file !== this.staticDir) {
      res.writeHead(403).end();
      return;
    }
    // Application monopage : toute route inconnue renvoie index.html.
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(this.staticDir, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }).end('Studio non compilé : lance « npm run build ».');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=60',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'same-origin',
    });
    createReadStream(file).pipe(res);
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, `Fichier trop volumineux (max ${Math.round(limit / 1024 / 1024)} Mo).`));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
