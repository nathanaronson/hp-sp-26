import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Toaster } from "sonner";
import "./index.css";
import { queryClient } from "./lib/queryClient";
import { AuthProvider } from "./lib/AuthContext";
import SignIn from "./routes/SignIn";
import Dashboard from "./routes/Dashboard";
import AddDeployment from "./routes/AddDeployment";
import DeploymentDetail from "./routes/DeploymentDetail";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<SignIn />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/add" element={<AddDeployment />} />
            <Route path="/deployment/:id" element={<DeploymentDetail />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="bottom-right" />
      </AuthProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </StrictMode>,
);
