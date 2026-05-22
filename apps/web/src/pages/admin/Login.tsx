import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { BG, S2, B2, TEXT, T2 } from "@/shared/kpi";

const LOGIN_TIMEOUT_MS = 15000;
const SESSION_TIMEOUT_MS = 15000;

type AdminLoginErrorCode =
  | "INVALID_CREDENTIALS"
  | "LOGIN_TIMEOUT"
  | "SESSION_TIMEOUT"
  | "SESSION_MISSING"
  | "ADMIN_ROLE_REQUIRED"
  | "NETWORK_ERROR"
  | "UNKNOWN_LOGIN_ERROR";

const withTimeout = <T,>(promise: Promise<T>, ms: number, code: AdminLoginErrorCode) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const timeoutError = new Error(code) as Error & { code: AdminLoginErrorCode };
      timeoutError.code = code;
      reject(timeoutError);
    }, ms);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });

const clearStaleAuthState = () => {
  try {
    const keysToDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith("sb-") || key.includes("auth-token")) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((key) => localStorage.removeItem(key));
    console.log("[AdminLogin] cleared stale auth state", { count: keysToDelete.length });
  } catch (err) {
    console.error("[AdminLogin] failed to clear stale auth state", err);
  }
};

export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState<AdminLoginErrorCode | "">("");
  const [loading, setLoading] = useState(false);
  const [pendingRetry, setPendingRetry] = useState(false);
  const navigate = useNavigate();

  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const retryTimerRef = useRef<number | null>(null);

  const clearRetryTimer = () => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  };

  const reconcileSession = async () => {
    console.log("[AdminLogin] getSession start");
    const sessionRes = await withTimeout(supabase.auth.getSession(), SESSION_TIMEOUT_MS, "SESSION_TIMEOUT");
    console.log("[AdminLogin] getSession result", { hasSession: !!sessionRes.data.session });

    if (sessionRes.data.session) return sessionRes.data.session;

    console.log("[AdminLogin] refresh attempt");
    const refreshRes = await withTimeout(supabase.auth.refreshSession(), SESSION_TIMEOUT_MS, "SESSION_TIMEOUT");
    console.log("[AdminLogin] refresh result", { hasSession: !!refreshRes.data.session });

    if (refreshRes.data.session) return refreshRes.data.session;

    throw Object.assign(new Error("Session missing after token success"), { code: "SESSION_MISSING" as AdminLoginErrorCode });
  };

  const normalizeError = (raw: unknown): { code: AdminLoginErrorCode; message: string; retryable: boolean } => {
    const fallback = {
      code: "UNKNOWN_LOGIN_ERROR" as AdminLoginErrorCode,
      message: "Unable to sign in right now. Please retry.",
      retryable: true,
    };

    const err = raw as { message?: string; code?: string; status?: number };
    const msg = err?.message || "";

    if (err?.code === "LOGIN_TIMEOUT") {
      return {
        code: "LOGIN_TIMEOUT",
        message: "Login is taking longer than expected. Retry or check connection.",
        retryable: true,
      };
    }

    if (err?.code === "SESSION_TIMEOUT") {
      return {
        code: "SESSION_TIMEOUT",
        message: "Session verification timed out. Retry or check connection.",
        retryable: true,
      };
    }

    if (err?.code === "SESSION_MISSING") {
      return {
        code: "SESSION_MISSING",
        message: "Login succeeded but session was not established. Please retry.",
        retryable: true,
      };
    }

    if (err?.code === "ADMIN_ROLE_REQUIRED") {
      return {
        code: "ADMIN_ROLE_REQUIRED",
        message: "Access denied. Admin accounts only.",
        retryable: false,
      };
    }

    if (msg.toLowerCase().includes("invalid login credentials")) {
      return {
        code: "INVALID_CREDENTIALS",
        message: "Invalid email or password.",
        retryable: true,
      };
    }

    if (msg.toLowerCase().includes("failed to fetch") || msg.toLowerCase().includes("network")) {
      return {
        code: "NETWORK_ERROR",
        message: "Network issue detected. Please check your connection and retry.",
        retryable: true,
      };
    }

    return fallback;
  };

  const performLogin = async (allowAutoRetry = true) => {
    if (inFlightRef.current) {
      console.log("[AdminLogin] ignored duplicate submit");
      return;
    }

    clearRetryTimer();
    setPendingRetry(false);
    setError("");
    setErrorCode("");
    inFlightRef.current = true;
    setLoading(true);

    try {
      console.log("[AdminLogin] login request start", { email });
      const { data, error: signInError } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        LOGIN_TIMEOUT_MS,
        "LOGIN_TIMEOUT"
      );
      console.log("[AdminLogin] login request end", { hasError: !!signInError });

      if (signInError) throw signInError;

      console.log("[AdminLogin] token success", { userId: data.user?.id ?? null });
      const session = await reconcileSession();

      const userId = session.user.id;
      const roleRes = await withTimeout(
        Promise.resolve(
          supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", userId)
            .eq("role", "super_admin")
            .maybeSingle()
        ),
        SESSION_TIMEOUT_MS,
        "SESSION_TIMEOUT"
      );

      if (!roleRes.data) {
        await supabase.auth.signOut();
        clearStaleAuthState();
        throw Object.assign(new Error("Admin role is required"), { code: "ADMIN_ROLE_REQUIRED" as AdminLoginErrorCode });
      }

      if (!mountedRef.current) return;
      console.log("[AdminLogin] redirect event", { to: "/admin/dashboard" });
      navigate("/admin/dashboard", { replace: true });
      return;
    } catch (rawError) {
      const normalized = normalizeError(rawError);
      console.error("[AdminLogin] login flow error", {
        code: normalized.code,
        error: rawError,
      });

      await supabase.auth.signOut();
      clearStaleAuthState();

      if (!mountedRef.current) return;

      setError(normalized.message);
      setErrorCode(normalized.code);

      if (allowAutoRetry && normalized.retryable && normalized.code !== "INVALID_CREDENTIALS") {
        setPendingRetry(true);
        retryTimerRef.current = window.setTimeout(() => {
          if (!mountedRef.current) return;
          setPendingRetry(false);
          void performLogin(false);
        }, 2000);
      }
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;

    const bootstrap = async () => {
      try {
        const { data } = await withTimeout(supabase.auth.getSession(), SESSION_TIMEOUT_MS, "SESSION_TIMEOUT");
        if (!data.session) return;

        const roleRes = await withTimeout(
          Promise.resolve(
            supabase
              .from("user_roles")
              .select("role")
              .eq("user_id", data.session.user.id)
              .eq("role", "super_admin")
              .maybeSingle()
          ),
          SESSION_TIMEOUT_MS,
          "SESSION_TIMEOUT"
        );

        if (roleRes.data) {
          console.log("[AdminLogin] existing admin session found, redirecting");
          navigate("/admin/dashboard", { replace: true });
        }
      } catch (err) {
        console.warn("[AdminLogin] initial session check failed", err);
      }
    };

    void bootstrap();

    return () => {
      mountedRef.current = false;
      clearRetryTimer();
    };
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    await performLogin(true);
  };

  const IS: React.CSSProperties = { background: S2, border: "1px solid " + B2, borderRadius: 9, padding: "12px 16px", color: TEXT, fontSize: 14, outline: "none", fontFamily: "'DM Sans',sans-serif", width: "100%" };

  return (
    <div style={{ minHeight: "100vh", background: BG, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ width: 400, padding: 40 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: TEXT }}>Revenue Engine</div>
          <div style={{ fontSize: 11, color: "#f0a830", letterSpacing: 1.4, textTransform: "uppercase" }}>Admin Portal</div>
        </div>
        <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <input type="email" placeholder="Admin Email" value={email} onChange={e => setEmail(e.target.value)} style={IS} required disabled={loading} />
          <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={IS} required disabled={loading} />
          {error && (
            <div style={{ color: "#f05050", fontSize: 12 }}>
              <div>{error}</div>
              {errorCode && <div style={{ marginTop: 4 }}>Error code: {errorCode}</div>}
            </div>
          )}
          {pendingRetry && (
            <div style={{ color: T2, fontSize: 12 }}>
              Retrying automatically in 2 seconds...
            </div>
          )}
          <button type="submit" disabled={loading} style={{ background: "#f0a830", border: "none", borderRadius: 9, padding: "12px 16px", color: "#000", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit", opacity: loading ? 0.6 : 1 }}>
            {loading ? "Signing in..." : "Admin Sign In"}
          </button>
          {!!error && (
            <button type="button" onClick={() => void performLogin(true)} disabled={loading} style={{ background: "transparent", border: "1px solid " + B2, borderRadius: 9, padding: "12px 16px", color: TEXT, fontWeight: 700, fontSize: 14, cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: loading ? 0.6 : 1 }}>
              Retry
            </button>
          )}
        </form>
        <div style={{ textAlign: "center", marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <Link to="/admin/forgot-password" style={{ color: T2, fontSize: 12, textDecoration: "none" }}>Forgot password?</Link>
          <Link to="/" style={{ color: T2, fontSize: 12, textDecoration: "none" }}>← Back to Home</Link>
        </div>
      </div>
    </div>
  );
}
