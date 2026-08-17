import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app.js";
import { BridgeProvider } from "./rpc-client.js";
import { createDefaultBridge } from "./mockBridge.js";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, refetchOnWindowFocus: false },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BridgeProvider bridge={createDefaultBridge()}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </BridgeProvider>
  </StrictMode>,
);
