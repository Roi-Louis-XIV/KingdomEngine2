import type { BuildingPayload, Entity } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export class ApiClient {
  constructor(readonly world = "") {}
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const headers = new Headers(init.headers);
    if (this.world) headers.set("X-Kingdom-Server", this.world);
    if (init.body) headers.set("Content-Type", "application/json");
    try {
      const response = await fetch(path, {
        ...init,
        headers,
        credentials: "same-origin",
        signal: init.signal
          ? AbortSignal.any([controller.signal, init.signal])
          : controller.signal,
      });
      const text = await response.text();
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      if (!response.ok) {
        const detail =
          body && typeof body === "object" && "detail" in body
            ? String(body.detail)
            : `La requête a échoué (${response.status}).`;
        throw new ApiError(response.status, detail);
      }
      return body as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (init.signal?.aborted) throw error;
      throw new ApiError(
        0,
        controller.signal.aborted
          ? "Le délai de réponse est dépassé. Vérifiez l’état avant de réessayer une opération."
          : "Connexion interrompue. Vos modifications restent dans cet écran.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  get<T>(path: string, signal?: AbortSignal): Promise<T> {
    return this.request(path, { signal });
  }
  post<T>(path: string, body: unknown): Promise<T> {
    return this.request(path, { method: "POST", body: JSON.stringify(body) });
  }
  saveBuilding(
    key: string,
    payload: BuildingPayload,
    expected_version: number,
  ): Promise<Entity> {
    return this.post(`/api/content/building/${encodeURIComponent(key)}`, {
      payload,
      expected_version,
      author: "kingdomweb-next",
    });
  }
  publish(entity: Entity): Promise<Entity> {
    return this.post(
      `/api/content/building/${encodeURIComponent(entity.entity_key)}/${entity.version}/publish`,
      { author: "kingdomweb-next" },
    );
  }
}
