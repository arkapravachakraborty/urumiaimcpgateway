"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Boxes,
  KeyRound,
  LogOut,
  MessageSquareText,
  ShieldCheck,
  Users,
} from "lucide-react";
import { trpc } from "~/providers/trpc";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { ErrorNotice } from "~/components/page-heading";

const links = [
  { href: "/servers", label: "Servers", icon: Boxes, admin: true },
  { href: "/members", label: "Members", icon: Users, admin: true },
  { href: "/keys", label: "API keys", icon: KeyRound, admin: false },
  { href: "/audit", label: "Audit log", icon: Activity, admin: false },
  { href: "/chat", label: "Chat", icon: MessageSquareText, admin: false },
];

export function DashboardShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [logoutError, setLogoutError] = useState("");
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const logout = trpc.useUtils();

  useEffect(() => {
    if (me.error) router.replace("/login");
  }, [me.error, router]);

  useEffect(() => {
    if (me.data?.role === "MEMBER" && ["/servers", "/members"].includes(pathname)) {
      router.replace("/keys");
    }
  }, [me.data?.role, pathname, router]);

  async function signOut() {
    setLogoutError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error("Logout request failed.");
      await logout.auth.me.invalidate();
      router.replace("/login");
    } catch {
      setLogoutError("Unable to sign out. Please try again.");
    }
  }

  if (me.isLoading || !me.data) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="mx-auto flex max-w-6xl gap-8">
          <Skeleton className="h-[calc(100vh-4rem)] w-56 rounded-2xl" />
          <Skeleton className="h-80 flex-1 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (me.data.role !== "ADMIN" && ["/servers", "/members"].includes(pathname)) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r bg-card/70 px-5 py-6 lg:flex lg:flex-col">
        <Link href="/servers" className="mb-10 flex items-center gap-3 px-2">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck className="size-5" />
          </span>
          <span>
            <span className="block text-sm font-semibold">Team Gateway</span>
            <span className="text-xs text-muted-foreground">MCP Control Plane</span>
          </span>
        </Link>
        <nav className="space-y-1">
          {links
            .filter(({ admin }) => !admin || me.data.role === "ADMIN")
            .map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                    active
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="size-4" />
                  {label}
                </Link>
              );
            })}
        </nav>
        <div className="mt-auto rounded-xl border bg-background p-3">
          <p className="truncate text-sm font-medium">{me.data.email}</p>
          <p className="mt-1 text-xs text-muted-foreground">{me.data.role}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 w-full justify-start px-2 text-muted-foreground"
            onClick={() => void signOut()}
          >
            <LogOut className="size-4" />
            Sign out
          </Button>
        </div>
      </aside>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b bg-background/90 px-5 backdrop-blur lg:px-10">
          <div>
            <p className="text-xs text-muted-foreground">Workspace</p>
            <p className="text-sm font-semibold capitalize">{pathname.slice(1)}</p>
          </div>
          <div className="flex items-center gap-3 lg:hidden">
            {links
              .filter(({ admin }) => !admin || me.data.role === "ADMIN")
              .map(({ href, label }) => (
                <Link key={href} href={href} className="text-xs text-muted-foreground">
                  {label}
                </Link>
              ))}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Sign out"
              onClick={() => void signOut()}
            >
              <LogOut />
            </Button>
          </div>
          <span className="hidden rounded-full border px-3 py-1 text-xs text-muted-foreground sm:block">
            {me.data.role === "ADMIN" ? "Administrator" : "Team member"}
          </span>
        </header>
        <main className="mx-auto max-w-7xl px-5 py-8 lg:px-10">
          {logoutError && (
            <div className="mb-5">
              <ErrorNotice message={logoutError} />
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
