import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/** Redirects to /auth when there is no session. Presentation-level guard only. */
export function useSessionGuard() {
  const navigate = useNavigate();
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        navigate({ to: "/auth" });
        setReady(true);
        return;
      }
      setUser({ id: data.session.user.id, email: data.session.user.email ?? undefined });
      setReady(true);
    });
  }, [navigate]);

  return { user, ready };
}
