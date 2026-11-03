import { useOutletContext } from "react-router-dom";
import type { ApiClient } from "./api";
import type { Profile, World } from "./types";

export interface Workspace {
  api: ApiClient;
  world: World;
  profile: Profile;
  href: (path: string) => string;
  writable: boolean;
}
export const useWorkspace = () => useOutletContext<Workspace>();
