import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/ui/globals.css";
import App from "@/ui/App";
import { createLocalRepo, type Seed } from "@/data/localRepo";
import seed from "./seed.json";

const repo = createLocalRepo(seed as unknown as Seed);
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App repo={repo} />
  </StrictMode>
);
