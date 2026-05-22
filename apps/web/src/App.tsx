import { useState, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ImpersonationProvider } from "@/contexts/ImpersonationContext";

import Landing from "./pages/Landing";
import Join from "./pages/app/Join";
import RequestAccess from "./pages/RequestAccess";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import ClientLogin from "./pages/app/Login";
// Public signup removed — invite-only B2B SaaS
import ForgotPassword from "./pages/app/ForgotPassword";
import ResetPassword from "./pages/app/ResetPassword";
import Dashboard from "./pages/app/Dashboard";
import Settings from "./pages/app/Settings";
import Account from "./pages/app/Account";
import AccountProfile from "./pages/app/AccountProfile";
import AccountSubscription from "./pages/app/AccountSubscription";
import AccountActivity from "./pages/app/AccountActivity";
import AccountExports from "./pages/app/AccountExports";
import Support from "./pages/app/Support";
import AdminLogin from "./pages/admin/Login";
import AdminDashboard from "./pages/admin/Dashboard";
import AdminClients from "./pages/admin/Clients";
import NewClient from "./pages/admin/NewClient";
import ClientDetail from "./pages/admin/ClientDetail";
import AdminClientDashboard from "./pages/admin/ClientDashboard";
import AdminsPage from "./pages/admin/Admins";
import AuditLog from "./pages/admin/AuditLog";
import AdminSupportTickets from "./pages/admin/SupportTickets";
import AdminAccessRequests from "./pages/admin/AccessRequests";
import AdminPlans from "./pages/admin/Plans";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,          // 30s — don't refetch if data is fresh
      gcTime: 5 * 60_000,         // 5 min cache
      retry: 1,                    // auto-retry once on failure
      retryDelay: 2000,           // 2s before retry
      refetchOnWindowFocus: false, // prevent re-fetches on tab switch
      refetchOnReconnect: true,
    },
  },
});

function ClientGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [showTimeout, setShowTimeout] = useState(false);
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setShowTimeout(true), 15000);
    return () => clearTimeout(timer);
  }, [loading]);
  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#080a08", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans',sans-serif" }}>
      {showTimeout ? (
        <div style={{ textAlign: "center", color: "#eaeee8" }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Loading is taking too long</div>
          <div style={{ fontSize: 13, color: "#8a8e88", marginBottom: 16 }}>This might be a network issue.</div>
          <button onClick={() => window.location.reload()} style={{ background: "#47ed3d", border: "none", borderRadius: 9, padding: "10px 24px", color: "#000", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Reload Page</button>
        </div>
      ) : null}
    </div>
  );
  if (!user) return <Navigate to="/app/login" replace />;
  return <>{children}</>;
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, role, loading } = useAuth();
  const [showTimeout, setShowTimeout] = useState(false);
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setShowTimeout(true), 15000);
    return () => clearTimeout(timer);
  }, [loading]);
  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#080a08", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans',sans-serif" }}>
      {showTimeout ? (
        <div style={{ textAlign: "center", color: "#eaeee8" }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Loading is taking too long</div>
          <div style={{ fontSize: 13, color: "#8a8e88", marginBottom: 16 }}>This might be a network issue.</div>
          <button onClick={() => window.location.reload()} style={{ background: "#f0a830", border: "none", borderRadius: 9, padding: "10px 24px", color: "#000", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Reload Page</button>
        </div>
      ) : null}
    </div>
  );
  if (!user || role !== "super_admin") return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <ImpersonationProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/request-access" element={<RequestAccess />} />
              <Route path="/join" element={<Join />} />

              <Route path="/app/login" element={<ClientLogin />} />
              {/* Public signup removed — invite-only */}
              <Route path="/app/forgot-password" element={<ForgotPassword />} />
              <Route path="/app/reset-password" element={<ResetPassword />} />
              <Route path="/app/dashboard" element={<ClientGuard><Dashboard /></ClientGuard>} />
              <Route path="/app/settings" element={<ClientGuard><Settings /></ClientGuard>} />
              <Route path="/app/account" element={<ClientGuard><Account /></ClientGuard>} />
              <Route path="/app/account/profile" element={<ClientGuard><AccountProfile /></ClientGuard>} />
              <Route path="/app/account/subscription" element={<ClientGuard><AccountSubscription /></ClientGuard>} />
              <Route path="/app/account/activity" element={<ClientGuard><AccountActivity /></ClientGuard>} />
              <Route path="/app/account/exports" element={<ClientGuard><AccountExports /></ClientGuard>} />
              <Route path="/app/support" element={<ClientGuard><Support /></ClientGuard>} />

              <Route path="/admin/login" element={<AdminLogin />} />
              <Route path="/admin/forgot-password" element={<ForgotPassword admin />} />
              <Route path="/admin/dashboard" element={<AdminGuard><AdminDashboard /></AdminGuard>} />
              <Route path="/admin/clients" element={<AdminGuard><AdminClients /></AdminGuard>} />
              <Route path="/admin/clients/new" element={<AdminGuard><NewClient /></AdminGuard>} />
              <Route path="/admin/clients/:orgId" element={<AdminGuard><ClientDetail /></AdminGuard>} />
              <Route path="/admin/clients/:orgId/revenue-engine" element={<AdminGuard><AdminClientDashboard /></AdminGuard>} />
              <Route path="/admin/admins" element={<AdminGuard><AdminsPage /></AdminGuard>} />
              <Route path="/admin/audit" element={<AdminGuard><AuditLog /></AdminGuard>} />
              <Route path="/admin/support" element={<AdminGuard><AdminSupportTickets /></AdminGuard>} />
              <Route path="/admin/access-requests" element={<AdminGuard><AdminAccessRequests /></AdminGuard>} />
              <Route path="/admin/plans" element={<AdminGuard><AdminPlans /></AdminGuard>} />

              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </ImpersonationProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
