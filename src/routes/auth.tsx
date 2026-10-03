import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toaster, toast } from "sonner";
import { ScanLine, Loader2, Eye, EyeOff } from "lucide-react";
import { lovable } from "@/integrations/lovable/index";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Staff Access — ScriptScan Office of Examinations" },
      { name: "description", content: "Secure sign-in for examination officers to digitise marked scripts and compile verified result workbooks." },
      { property: "og:title", content: "Staff Access — ScriptScan Office of Examinations" },
      { property: "og:description", content: "Secure sign-in for examination officers." },
    ],
  }),
  component: AuthPage,
});


function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const social = async (provider: "google" | "apple" | "microsoft") => {
    setBusy(true);
    try {
      // Off Lovable hosting (e.g. Vercel): sign in via the Lovable-hosted bridge, which hands the session back.
      if (!isLovableHost()) {
        const back = `${window.location.origin}/auth`;
        window.location.href = `${BRIDGE_ORIGIN}/auth?bridge=${provider}&return=${encodeURIComponent(back)}`;
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const ret = params.get("return");
      const redirect = ret && isAllowedReturn(ret)
        ? `${window.location.origin}/auth?return=${encodeURIComponent(ret)}`
        : window.location.origin;
      const result = await lovable.auth.signInWithOAuth(provider, { redirect_uri: redirect });
      if (result.error) { toast.error(result.error.message ?? "Sign-in failed"); return; }
      if (result.redirected) return;
      if (ret && isAllowedReturn(ret)) { await handBack(ret); return; }
      navigate({ to: "/" });
    } catch (e: any) {
      toast.error(e?.message ?? "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  // Bridge: receive session from Lovable host, or start/finish the bridge on the Lovable host.
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const at = hash.get("bridge_at"), rt = hash.get("bridge_rt");
    if (at && rt) {
      history.replaceState(null, "", window.location.pathname);
      supabase.auth.setSession({ access_token: at, refresh_token: rt }).then(({ error }) => {
        if (error) toast.error(error.message); else navigate({ to: "/" });
      });
      return;
    }
    if (!isLovableHost()) return;
    const params = new URLSearchParams(window.location.search);
    const ret = params.get("return");
    if (!ret || !isAllowedReturn(ret)) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) { handBack(ret); return; }
      const p = params.get("bridge");
      if (p === "google" || p === "apple" || p === "microsoft") social(p);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { display_name: name || email.split("@")[0] },
          },
        });
        if (error) throw error;
        if (data.session) {
          toast.success("Account created");
          navigate({ to: "/" });
        } else {
          const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
          if (signInError) throw signInError;
          toast.success("Account created");
          navigate({ to: "/" });
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/" });
      }

    } catch (e: any) {
      toast.error(e.message ?? "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[minmax(0,1fr)_480px]">
      <Toaster richColors position="top-center" />

      {/* Institutional panel */}
      <section className="hidden flex-col justify-between bg-[color:var(--color-navy-dark)] px-12 py-12 lg:flex">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-md border border-[color:var(--color-gold)]/60">
            <ScanLine className="h-4.5 w-4.5 text-[color:var(--color-gold)]" aria-hidden />
          </div>
          <div>
            <p className="text-[15px] font-semibold leading-tight text-white">ScriptScan</p>
            <p className="text-[10px] font-medium tracking-[0.14em] text-white/55">OFFICE OF EXAMINATIONS</p>
          </div>
        </div>

        <div className="max-w-md">
          <h2 className="text-[30px] font-semibold leading-[1.2] text-white">
            Examination script digitisation and result compilation
          </h2>
          <p className="mt-4 text-[15px] leading-7 text-white/65">
            Capture marked scripts by photograph, recorded video sweep or dictation, verify every matric number and
            score, and issue auditable Excel workbooks.
          </p>
          <div className="mt-8 h-px w-16 bg-[color:var(--color-gold)]" />
        </div>

        <p className="text-[12px] text-white/45">Authorised examination officers only. All activity is attributable to your account.</p>
      </section>

      {/* Form */}
      <section className="flex min-h-screen items-center justify-center bg-card px-5 py-12 lg:min-h-0">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="grid h-9 w-9 place-items-center rounded-md bg-[color:var(--color-navy)]">
              <ScanLine className="h-4.5 w-4.5 text-[color:var(--color-gold)]" aria-hidden />
            </div>
            <div>
              <p className="text-[15px] font-semibold leading-tight">ScriptScan</p>
              <p className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground">OFFICE OF EXAMINATIONS</p>
            </div>
          </div>

          <h1 className="text-[24px] font-semibold tracking-[-0.02em]">
            {mode === "signin" ? "Staff sign in" : "Request staff access"}
          </h1>
          <p className="mt-1.5 text-[14px] text-muted-foreground">
            {mode === "signin"
              ? "Use your institutional credentials to continue."
              : "Register an examination officer account for this workstation."}
          </p>

          <form onSubmit={submit} className="mt-7 grid gap-4">
            {mode === "signup" && (
              <div className="grid gap-1.5">
                <Label htmlFor="name" className="field-label">Display name</Label>
                <Input id="name" className="h-10" value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. Jane Doe" />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="email" className="field-label">Email address</Label>
              <Input id="email" className="h-10" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password" className="field-label">Password</Label>
              <div className="relative">
                <Input id="password" className="h-10 pr-10" type={showPassword ? "text" : "password"} autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" className="mt-1 h-10 w-full" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3 text-[12px] text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> or continue with <span className="h-px flex-1 bg-border" />
          </div>
          <div className="grid gap-2">
            <Button type="button" variant="outline" className="h-10 w-full" disabled={busy} onClick={() => social("google")}>Continue with Google</Button>
            <Button type="button" variant="outline" className="h-10 w-full" disabled={busy} onClick={() => social("apple")}>Continue with Apple</Button>
            <Button type="button" variant="outline" className="h-10 w-full" disabled={busy} onClick={() => social("microsoft")}>Continue with Microsoft</Button>
          </div>

          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-6 w-full text-center text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {mode === "signin" ? "Need an account? Request access" : "Already registered? Sign in"}
          </button>
        </div>
      </section>
    </div>
  );
}


const BRIDGE_ORIGIN = "https://scriptscan.lovable.app";
function isLovableHost() {
  const h = window.location.hostname;
  return h.endsWith(".lovable.app") || h.endsWith(".lovableproject.com") || h === "localhost";
}
function isAllowedReturn(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "scriptscan.vercel.app" || /^scriptscan-[a-z0-9-]+\.vercel\.app$/.test(u.hostname));
  } catch { return false; }
}
async function handBack(ret: string) {
  const { data } = await supabase.auth.getSession();
  const s = data.session;
  if (!s) return;
  window.location.href = `${ret}#bridge_at=${encodeURIComponent(s.access_token)}&bridge_rt=${encodeURIComponent(s.refresh_token)}`;
}
