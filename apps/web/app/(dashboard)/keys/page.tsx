"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, Copy, KeyRound, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { PageHeading, EmptyNotice, ErrorNotice } from "~/components/page-heading";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { trpc } from "~/providers/trpc";

export default function KeysPage() {
  const utils = trpc.useUtils();
  const keys = trpc.keys.listMine.useQuery(undefined);
  const create = trpc.keys.create.useMutation({
    onSuccess: () => void utils.keys.listMine.invalidate(),
  });
  const revoke = trpc.keys.revoke.useMutation({
    onSuccess: () => void utils.keys.listMine.invalidate(),
  });
  const [newKey, setNewKey] = useState<{ id: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [gatewayUrl, setGatewayUrl] = useState("");
  useEffect(() => {
    setGatewayUrl(`${window.location.origin}/mcp`);
  }, []);
  const claudeConfig = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            "team-gateway": {
              type: "http",
              url: gatewayUrl,
              headers: { Authorization: `Bearer ${newKey?.key ?? "<YOUR_API_KEY>"}` },
            },
          },
        },
        null,
        2,
      ),
    [gatewayUrl, newKey?.key],
  );
  const cursorConfig = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            "team-gateway": {
              url: gatewayUrl,
              headers: { Authorization: `Bearer ${newKey?.key ?? "<YOUR_API_KEY>"}` },
            },
          },
        },
        null,
        2,
      ),
    [gatewayUrl, newKey?.key],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await create.mutateAsync({ name: String(form.get("name")).trim() });
      setNewKey({ id: result.id, key: result.key });
      setCopied(false);
    } catch {
      setError("Could not generate an API key.");
    }
  }

  async function copySnippet(snippet: string) {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
    } catch {
      setError("Clipboard access was denied. Select and copy the configuration manually.");
    }
  }

  function closeKeyDialog() {
    setNewKey(null);
    create.reset();
  }

  return (
    <div>
      <PageHeading
        eyebrow="Developer access"
        title="API keys"
        description="Create revocable keys for MCP clients. A raw key is displayed only once."
      />
      {error && (
        <div className="mb-5">
          <ErrorNotice message={error} />
        </div>
      )}
      {revoke.error && (
        <div className="mb-5">
          <ErrorNotice message="Could not revoke this key. Please retry." />
        </div>
      )}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4 text-primary" />
            Generate a key
          </CardTitle>
          <CardDescription>
            Use a separate key for each client and revoke it whenever access should end.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => void submit(event)}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="w-full space-y-2 sm:max-w-sm">
              <Label htmlFor="key-name">Key name</Label>
              <Input
                id="key-name"
                name="name"
                required
                maxLength={100}
                placeholder="Claude Code on laptop"
              />
            </div>
            <Button disabled={create.isPending}>
              {create.isPending ? (
                "Generating..."
              ) : (
                <>
                  <Plus /> Generate key
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <h2 className="mb-3 text-sm font-semibold">Your keys</h2>
      {keys.isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((item) => (
            <Skeleton key={item} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : keys.error ? (
        <ErrorNotice message="Unable to load API keys." />
      ) : keys.data?.length ? (
        <Card className="py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead>Name</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.data.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">{key.name}</TableCell>
                    <TableCell>
                      <code className="rounded bg-muted px-2 py-1 text-xs">{key.prefix}…</code>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(key.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "Never"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={key.revokedAt ? "outline" : "secondary"}>
                        {key.revokedAt ? "Revoked" : "Active"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {!key.revokedAt && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Revoke ${key.name}`}
                          disabled={revoke.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Revoke "${key.name}"? The next request using it will be rejected.`,
                              )
                            )
                              revoke.mutate({ id: key.id });
                          }}
                        >
                          <Trash2 className="text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <EmptyNotice>You have not created any API keys.</EmptyNotice>
      )}

      <Dialog
        open={newKey !== null}
        onOpenChange={(open) => {
          if (!open) closeKeyDialog();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Your API key is ready</DialogTitle>
            <DialogDescription>
              Copy the key and configuration now. The full key will not be shown again.
            </DialogDescription>
          </DialogHeader>
          {newKey && (
            <div className="space-y-5">
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium text-amber-500">
                  <ShieldAlert className="size-4" />
                  Keep this key private
                </div>
                <p className="mt-1 text-muted-foreground">
                  Anyone with this key can access MCP tools as your account.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Gateway URL</Label>
                <Input readOnly value={gatewayUrl} />
              </div>
              <div className="space-y-2">
                <Label>API key</Label>
                <div className="flex gap-2">
                  <Input readOnly type="password" value={newKey.key} className="font-mono" />
                  <Button
                    variant="outline"
                    onClick={() => void copySnippet(newKey.key)}
                    aria-label="Copy API key"
                  >
                    {copied ? <Check /> : <Copy />}
                  </Button>
                </div>
              </div>
              <ConfigBlock
                title="Claude Code"
                value={claudeConfig}
                onCopy={() => void copySnippet(claudeConfig)}
              />
              <ConfigBlock
                title="Cursor"
                value={cursorConfig}
                onCopy={() => void copySnippet(cursorConfig)}
              />
            </div>
          )}
          <DialogFooter>
            <Button onClick={closeKeyDialog}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConfigBlock({
  title,
  value,
  onCopy,
}: {
  title: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{title} config</Label>
        <Button variant="ghost" size="sm" onClick={onCopy}>
          <Copy /> Copy
        </Button>
      </div>
      <pre className="max-h-40 overflow-auto rounded-lg bg-muted p-3 text-xs leading-5">
        {value}
      </pre>
    </div>
  );
}
