import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import { ViewerApp } from "@/components/viewer/ViewerApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ViewerApp />
  </StrictMode>,
);
