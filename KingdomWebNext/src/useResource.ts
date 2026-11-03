import { useEffect, useState, useCallback } from "react";
import type { ApiClient } from "./api";

export function useResource<T>(api: ApiClient, path: string) {
  const [state, setState] = useState<{
    data?: T;
    error?: Error;
    loading: boolean;
  }>({ loading: true });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true });
    api
      .get<T>(path, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, loading: false });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ error, loading: false });
      });
    return () => controller.abort();
  }, [api, path, revision]);
  return { ...state, reload };
}
