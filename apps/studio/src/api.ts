/** Client de l'API du serveur KingdomEngine. */

export class ApiError extends Error {
  readonly status: number;
  readonly data: any;
  constructor(status: number, message: string, data: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

let onUnauthorized: (() => void) | undefined;
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

export async function api<T = any>(method: string, path: string, body?: unknown, raw?: { data: Blob; type: string }): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), raw ? 600_000 : 20_000);
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      signal: ctrl.signal,
      credentials: 'same-origin',
      headers: {
        ...(method !== 'GET' ? { 'x-kingdom': '1' } : {}),
        ...(raw ? { 'content-type': raw.type } : body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: raw ? raw.data : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError(0, (e as Error).name === 'AbortError' ? 'Le serveur ne répond pas.' : 'Serveur injoignable. Vérifie qu’il est démarré.', null);
  } finally {
    clearTimeout(timer);
  }
  const data = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/')) onUnauthorized?.();
    throw new ApiError(res.status, data?.error ?? `Erreur ${res.status}`, data);
  }
  return data as T;
}

export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b?: unknown) => api<T>('POST', p, b ?? {});
export const put = <T = any>(p: string, b?: unknown) => api<T>('PUT', p, b ?? {});
export const del = <T = any>(p: string, b?: unknown) => api<T>('DELETE', p, b ?? {});
