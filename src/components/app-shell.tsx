import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  LayoutGrid, FolderOpen, ScanLine, Table2, FileBarChart2, Settings2,
  LifeBuoy, Menu, LogOut, Bell, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";

const NAV = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutGrid },
  { label: "Examinations", to: "/history", icon: FolderOpen },
  { label: "Capture", to: "/", icon: ScanLine },
  { label: "Results", to: "/results", icon: Table2 },
  { label: "Reports", to: "/reports", icon: FileBarChart2 },
  { label: "Settings", to: "/settings", icon: Settings2 },
] as const;

function isActive(pathname: string, to: string) {
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(to + "/");
}

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5 px-3">
      {NAV.map(({ label, to, icon: Icon }) => {
        const active = isActive(pathname, to);
        return (
          <Link
            key={to}
            to={to}
            search={to === "/" ? {} : undefined}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-white/10 text-white font-medium"
                : "text-white/70 hover:bg-white/[0.06] hover:text-white"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarBrand() {
  return (
    <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[color:var(--color-gold)]/60">
        <ScanLine className="h-4 w-4 text-[color:var(--color-gold)]" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold leading-tight text-white">ScriptScan</p>
        <p className="truncate text-[10px] font-medium tracking-[0.14em] text-white/55">
          OFFICE OF EXAMINATIONS
        </p>
      </div>
    </div>
  );
}

export function AppShell({
  title,
  description,
  actions,
  session,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  session?: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [email, setEmail] = useState<string>("");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? ""));
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const initials = (email || "?").slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-[color:var(--color-navy-dark)] lg:flex">
        <SidebarBrand />
        <div className="flex-1 overflow-y-auto py-4">
          <NavList pathname={pathname} />
        </div>
        <div className="border-t border-white/10 px-3 py-3">
          <Link
            to="/help"
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <LifeBuoy className="h-4 w-4" aria-hidden /> Help &amp; Support
          </Link>
        </div>
      </aside>

      <div className="lg:pl-60">
        {/* Top bar */}
        <header className="sticky top-0 z-20 h-16 border-b border-border bg-card">
          <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 sm:px-6">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 border-none bg-[color:var(--color-navy-dark)] p-0">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <SidebarBrand />
                <div className="py-4">
                  <NavList pathname={pathname} onNavigate={() => setMobileOpen(false)} />
                </div>
                <div className="mt-2 border-t border-white/10 px-3 py-3">
                  <Link
                    to="/help"
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-white/70 hover:text-white"
                  >
                    <LifeBuoy className="h-4 w-4" aria-hidden /> Help &amp; Support
                  </Link>
                </div>
              </SheetContent>
            </Sheet>

            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground">
                CURRENT SESSION
              </p>
              <p className="truncate text-[13px] font-medium text-foreground">
                {session || "No examination selected"}
              </p>
            </div>

            <div className="hidden items-center md:flex">
              <label htmlFor="global-search" className="sr-only">Search</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input
                  id="global-search"
                  placeholder="Search course code"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const v = (e.target as HTMLInputElement).value.trim();
                      if (v) navigate({ to: "/results", search: { q: v } });
                    }
                  }}
                  className="h-10 w-56 rounded-md border border-border bg-background pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-primary"
                />
              </div>
            </div>

            <Button variant="ghost" size="icon" aria-label="Notifications" className="text-muted-foreground">
              <Bell className="h-[18px] w-[18px]" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[color:var(--color-navy)] text-xs font-semibold text-white"
                  aria-label="Account menu"
                >
                  {initials}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
                  {email || "Signed in"}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/settings">Settings</Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={signOut}>
                  <LogOut className="mr-2 h-4 w-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8">
          <div className="mb-6 grid gap-3 sm:mb-8 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <div className="min-w-0">
              <h1 className="page-title text-foreground">{title}</h1>
              {description && (
                <p className="mt-1 max-w-2xl text-[15px] text-muted-foreground">{description}</p>
              )}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <div className="grid gap-2 border-b border-border px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="section-title text-foreground">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="px-4 py-4 sm:px-5 sm:py-5">{children}</div>
    </section>
  );
}

type Tone = "success" | "warning" | "error" | "neutral" | "info";

const TONE: Record<Tone, string> = {
  success: "border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/10 text-[color:var(--color-success)]",
  warning: "border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/10 text-[color:var(--color-warning)]",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-[color:var(--color-navy)]/20 bg-[color:var(--color-navy)]/[0.06] text-[color:var(--color-navy)]",
  neutral: "border-border bg-muted text-muted-foreground",
};

export function StatusPill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}
