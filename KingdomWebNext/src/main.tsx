import React from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import { App, Logout } from "./App";
import { Dashboard } from "./features/Dashboard";
import { Library } from "./features/Library";
import { BuildingEditor } from "./features/BuildingEditor";
import { Space } from "./features/Space";
import "./tokens.css";
import "./styles.css";

const router = createHashRouter([
  {
    element: <App />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "logout", element: <Logout /> },
      { path: "studio", element: <Library /> },
      { path: "studio/:key", element: <BuildingEditor /> },
      { path: "monde", element: <Space kind="monde" /> },
      { path: "scenarios", element: <Space kind="scenarios" /> },
      { path: "supervision", element: <Space kind="supervision" /> },
      { path: "mediatheque", element: <Space kind="mediatheque" /> },
      { path: "*", element: <Space kind="missing" /> },
    ],
  },
]);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
