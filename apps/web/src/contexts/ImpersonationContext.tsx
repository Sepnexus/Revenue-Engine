import { createContext, useContext, useState, ReactNode, useCallback } from "react";

interface ImpersonationContextType {
  impersonatedOrgId: string | null;
  impersonatedOrgName: string | null;
  isImpersonating: boolean;
  startImpersonation: (orgId: string, orgName: string) => void;
  stopImpersonation: () => void;
}

const ImpersonationContext = createContext<ImpersonationContextType>({
  impersonatedOrgId: null,
  impersonatedOrgName: null,
  isImpersonating: false,
  startImpersonation: () => {},
  stopImpersonation: () => {},
});

export const useImpersonation = () => useContext(ImpersonationContext);

export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const [impersonatedOrgId, setOrgId] = useState<string | null>(null);
  const [impersonatedOrgName, setOrgName] = useState<string | null>(null);

  const startImpersonation = useCallback((orgId: string, orgName: string) => {
    setOrgId(orgId);
    setOrgName(orgName);
  }, []);

  const stopImpersonation = useCallback(() => {
    setOrgId(null);
    setOrgName(null);
  }, []);

  return (
    <ImpersonationContext.Provider value={{
      impersonatedOrgId,
      impersonatedOrgName,
      isImpersonating: !!impersonatedOrgId,
      startImpersonation,
      stopImpersonation,
    }}>
      {children}
    </ImpersonationContext.Provider>
  );
}
