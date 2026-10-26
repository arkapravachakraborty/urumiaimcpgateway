"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ErrorNotice } from "~/components/page-heading";
import { trpc } from "~/providers/trpc";

export default function LoginPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        setError("Email or password is incorrect.");
        return;
      }
      await utils.auth.me.invalidate();
      router.replace("/servers");
    } catch {
      setError("Could not reach the gateway. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-5 py-12">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl border bg-card shadow-2xl lg:grid-cols-[1fr_0.85fr]">
        <section className="hidden flex-col justify-between bg-primary p-12 text-primary-foreground lg:flex">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-white/15">
              <ShieldCheck className="size-6" />
            </span>
            <span className="font-semibold">Team Gateway</span>
          </div>
          <div>
            <p className="mb-4 text-sm font-medium uppercase tracking-[0.2em] opacity-70">
              One secure workspace
            </p>
            <h1 className="max-w-sm text-4xl font-semibold leading-tight">
              Your tools, connected and under control.
            </h1>
            <p className="mt-5 max-w-sm text-sm leading-6 opacity-75">
              Manage MCP servers, team access, and API keys from one place.
            </p>
          </div>
          <p className="text-xs opacity-60">Private by design · Built for teams</p>
        </section>
        <section className="p-7 sm:p-12">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
              <ShieldCheck className="size-5" />
            </span>
            <span className="font-semibold">Team Gateway</span>
          </div>
          <p className="text-sm font-medium text-primary">Welcome back</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-2 text-sm text-muted-foreground">Use your team account to continue.</p>
          <form onSubmit={(event) => void submit(event)} className="mt-8 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {error && <ErrorNotice message={error} />}
            <Button className="w-full" size="lg" disabled={pending}>
              {pending ? "Signing in..." : "Continue"}
              {!pending && <ArrowRight />}
            </Button>
          </form>
          <p className="mt-8 text-center text-xs text-muted-foreground">
            Access is managed by your workspace administrator.
          </p>
        </section>
      </div>
    </main>
  );
}
