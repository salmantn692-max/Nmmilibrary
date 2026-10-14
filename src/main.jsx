import React from "react";
import ReactDOM from "react-dom/client";
import App, { PublicCatalog } from "./App.jsx";

const isPublicCatalog = window.location.pathname.replace(/\/+$/, "") === "/catalog";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isPublicCatalog ? <PublicCatalog /> : <App />}
  </React.StrictMode>
);
