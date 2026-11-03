import { afterEach, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "./api";

afterEach(() => vi.unstubAllGlobals());

it("binds writes to their world and sends the real session cookie", async () => {
  const requests: RequestInit[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    requests.push(init);
    return new Response(JSON.stringify({ version: 2 }), { status: 200 });
  });
  await new ApiClient("world_a").saveBuilding(
    "atelier",
    { name: "Atelier" },
    1,
  );
  expect(new Headers(requests[0].headers).get("X-Kingdom-Server")).toBe(
    "world_a",
  );
  expect(requests[0].credentials).toBe("same-origin");
  expect(JSON.parse(String(requests[0].body))).toEqual({
    payload: { name: "Atelier" },
    expected_version: 1,
    author: "kingdomweb-next",
  });
});

it("keeps conflict and authentication errors distinguishable", async () => {
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(JSON.stringify({ detail: "Version courante 3" }), {
        status: 409,
      }),
  );
  await expect(
    new ApiClient("world_a").get("/api/content"),
  ).rejects.toMatchObject({ status: 409, message: "Version courante 3" });
  vi.stubGlobal("fetch", async () => new Response("expired", { status: 401 }));
  await expect(
    new ApiClient("world_a").get("/api/content"),
  ).rejects.toBeInstanceOf(ApiError);
});

it("does not let a request wait indefinitely", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  );
  const result = expect(
    new ApiClient("world_a").get("/api/content"),
  ).rejects.toThrow("délai");
  await vi.advanceTimersByTimeAsync(15000);
  await result;
  vi.useRealTimers();
});
