import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  role: "super_admin" | "client_user" | null;
  orgId: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null, session: null, loading: true, role: null, orgId: null, signOut: async () => {},
});

const META_TIMEOUT_MS = 12000;
const SESSION_TIMEOUT_MS = 15000;
const MAX_AUTH_LOADING_MS = 20000;

const withTimeout = <T,>(promise: Promise<T>, ms: number, code: string) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const timeoutError = new Error(`${code}: timeout`) as Error & { code: string };
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

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<"super_admin" | "client_user" | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const latestRunRef = useRef(0);

  const fetchUserMeta = async (userId: string, runId: number) => {
    try {
      console.log("[Auth] fetchUserMeta start", { userId, runId });
      const [roleRes, profileRes] = await withTimeout(
        Promise.all([
          supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
          supabase.from("profiles").select("org_id").eq("id", userId).maybeSingle(),
        ]),
        META_TIMEOUT_MS,
        "AUTH_META_TIMEOUT"
      );

      if (runId !== latestRunRef.current) return;

      setRole((roleRes.data?.role as "super_admin" | "client_user") || null);
      setOrgId(profileRes.data?.org_id || null);
      console.log("[Auth] fetchUserMeta done", {
        runId,
        role: roleRes.data?.role ?? null,
        orgId: profileRes.data?.org_id ?? null,
      });
    } catch (err) {
      if (runId !== latestRunRef.current) return;
      console.error("[Auth] fetchUserMeta error", err);
      setRole(null);
      setOrgId(null);
    }
  };

  useEffect(() => {
    let mounted = true;

    const finalizeAuth = (runId: number) => {
      if (!mounted || runId !== latestRunRef.current) return;
      setLoading(false);
    };

    const resolveSession = async (incomingSession: Session | null, source: string) => {
      const runId = ++latestRunRef.current;
      if (!mounted) return;

      console.log("[Auth] resolveSession start", {
        source,
        runId,
        hasUser: !!incomingSession?.user,
      });

      setSession(incomingSession);
      setUser(incomingSession?.user ?? null);

      if (!incomingSession?.user) {
        setRole(null);
        setOrgId(null);
        finalizeAuth(runId);
        return;
      }

      await fetchUserMeta(incomingSession.user.id, runId);
      finalizeAuth(runId);
    };

    const failsafeTimer = setTimeout(() => {
      if (!mounted) return;
      console.warn("[Auth] loading failsafe fired");
      setLoading(false);
    }, MAX_AUTH_LOADING_MS);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void resolveSession(nextSession, "onAuthStateChange");
    });

    withTimeout(supabase.auth.getSession(), SESSION_TIMEOUT_MS, "AUTH_GET_SESSION_TIMEOUT")
      .then(({ data: { session: initialSession } }) => {
        void resolveSession(initialSession, "getSession");
      })
      .catch((err) => {
        console.error("[Auth] getSession error", err);
        const runId = ++latestRunRef.current;
        setSession(null);
        setUser(null);
        setRole(null);
        setOrgId(null);
        finalizeAuth(runId);
      });

    return () => {
      mounted = false;
      clearTimeout(failsafeTimer);
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("[Auth] signOut error", err);
    } finally {
      setUser(null);
      setSession(null);
      setRole(null);
      setOrgId(null);
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, role, orgId, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
