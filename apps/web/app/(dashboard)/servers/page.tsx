"use client";

import { useState, type FormEvent } from "react";
import { Fragment } from "react";
import { ChevronDown, ChevronRight, CirclePlus, Pencil, Plug, Server, Trash2 } from "lucide-react";
import { PageHeading, EmptyNotice, ErrorNotice } from "~/components/page-heading";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
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
import { Switch } from "~/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { trpc } from "~/providers/trpc";

function serverTools(value: unknown): Array<{ name: string; description?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    if (!item || typeof item !== "object" || !("name" in item) || typeof item.name !== "string") {
      return [];
    }
    return [
      {
        name: item.name,
        description:
          "description" in item && typeof item.description === "string"
            ? item.description
            : undefined,
      },
    ];
  });
}

function StatusBadge({ status }: { status: "CONNECTED" | "UNREACHABLE" | "DISABLED" }) {
  const variant =
    status === "CONNECTED" ? "default" : status === "UNREACHABLE" ? "destructive" : "secondary";
  const label =
    status === "CONNECTED" ? "Connected" : status === "UNREACHABLE" ? "Unreachable" : "Disabled";
  return <Badge variant={variant}>{label}</Badge>;
}

export default function ServersPage() {
  const utils = trpc.useUtils();
  const servers = trpc.servers.list.useQuery(undefined, { retry: false });
  const create = trpc.servers.create.useMutation({
    onSuccess: () => void utils.servers.list.invalidate(),
  });
  const update = trpc.servers.update.useMutation({
    onSuccess: () => void utils.servers.list.invalidate(),
  });
  const setEnabled = trpc.servers.setEnabled.useMutation({
    onSuccess: () => void utils.servers.list.invalidate(),
  });
  const remove = trpc.servers.remove.useMutation({
    onSuccess: () => void utils.servers.list.invalidate(),
  });
  const testConnection = trpc.servers.testConnection.useMutation({
    onSuccess: () => void utils.servers.list.invalidate(),
  });
  const [editing, setEditing] = useState<{
    slug: string;
    name: string;
    url: string;
    authType: "NONE" | "BEARER" | "HEADER";
    authHeaderName: string | null;
    hasCredential: boolean;
  } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [formError, setFormError] = useState("");
  const pending = create.isPending || update.isPending;

  function toggleExpanded(slug: string) {
    setExpanded((current) =>
      current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug],
    );
  }

  function openDialog(record?: typeof editing) {
    setEditing(record ?? null);
    setFormError("");
    setDialogOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const authType = String(form.get("authType")) as "NONE" | "BEARER" | "HEADER";
    const credential = String(form.get("credential") ?? "");
    const authHeaderName = String(form.get("authHeaderName") ?? "").trim();
    const values = {
      name: String(form.get("name")).trim(),
      url: String(form.get("url")).trim(),
      authType,
      ...(authHeaderName ? { authHeaderName } : {}),
      ...(credential ? { credential } : {}),
    };
    try {
      if (editing) {
        await update.mutateAsync({ slug: editing.slug, data: values });
      } else {
        await create.mutateAsync({
          slug: String(form.get("slug")).trim(),
          ...values,
          enabled: true,
        });
      }
      setDialogOpen(false);
    } catch {
      setFormError("Could not save this server. Check the details and try again.");
    }
  }

  return (
    <div>
      <PageHeading
        eyebrow="Infrastructure"
        title="MCP servers"
        description="Manage upstream connections and inspect the tools available to your team."
        action={
          <Button onClick={() => openDialog()}>
            <CirclePlus /> Add server
          </Button>
        }
      />

      {(setEnabled.error || remove.error || testConnection.error) && (
        <div className="mb-5">
          <ErrorNotice message="A server action failed. Refresh and try again." />
        </div>
      )}
      {servers.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : servers.error ? (
        <ErrorNotice message="Unable to load servers. Please try again." />
      ) : servers.data?.length ? (
        <Card className="overflow-hidden py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="w-10" />
                  <TableHead>Server</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {servers.data.map((server) => {
                  const tools = serverTools(server.tools);
                  const isExpanded = expanded.includes(server.slug);
                  return (
                    <Fragment key={server.id}>
                      <TableRow>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Show tools for ${server.name}`}
                            onClick={() => toggleExpanded(server.slug)}
                          >
                            {isExpanded ? <ChevronDown /> : <ChevronRight />}
                          </Button>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                              <Server className="size-4" />
                            </span>
                            <span>
                              <span className="block font-medium">{server.name}</span>
                              <span className="text-xs text-muted-foreground">{server.slug}</span>
                            </span>
                          </div>
                        </TableCell>
                        <TableCell
                          className="max-w-64 truncate text-muted-foreground"
                          title={server.url}
                        >
                          {server.url}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={server.status} />
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={server.enabled}
                            aria-label={`${server.enabled ? "Disable" : "Enable"} ${server.name}`}
                            disabled={setEnabled.isPending}
                            onCheckedChange={(enabled) =>
                              setEnabled.mutate({ slug: server.slug, enabled })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Test ${server.name}`}
                              disabled={testConnection.isPending}
                              onClick={() => testConnection.mutate({ slug: server.slug })}
                            >
                              <Plug />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Edit ${server.name}`}
                              onClick={() => openDialog(server)}
                            >
                              <Pencil />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Remove ${server.name}`}
                              onClick={() => {
                                if (window.confirm(`Remove ${server.name}? This cannot be undone.`))
                                  remove.mutate({ slug: server.slug });
                              }}
                            >
                              <Trash2 className="text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow className="bg-muted/20 hover:bg-muted/20">
                          <TableCell />
                          <TableCell colSpan={5}>
                            <div className="py-2">
                              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Available tools · {tools.length}
                              </p>
                              {tools.length ? (
                                <div className="flex flex-wrap gap-2">
                                  {tools.map((tool) => (
                                    <span
                                      key={tool.name}
                                      title={tool.description}
                                      className="rounded-md border bg-background px-2.5 py-1 font-mono text-xs"
                                    >
                                      {tool.name}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-sm text-muted-foreground">
                                  No cached tools available. Test the connection to refresh.
                                </p>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <EmptyNotice>No MCP servers registered yet. Add an upstream to get started.</EmptyNotice>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit server" : "Add MCP server"}</DialogTitle>
            <DialogDescription>
              Connection credentials are encrypted by the gateway and are never returned to this
              dashboard.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => void submit(event)} className="space-y-4">
            {!editing && (
              <div className="space-y-2">
                <Label htmlFor="server-slug">Slug</Label>
                <Input
                  id="server-slug"
                  name="slug"
                  required
                  pattern="[a-z0-9-]+"
                  maxLength={64}
                  placeholder="my-server"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="server-name">Name</Label>
              <Input
                id="server-name"
                name="name"
                defaultValue={editing?.name}
                required
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="server-url">MCP endpoint URL</Label>
              <Input
                id="server-url"
                name="url"
                type="url"
                defaultValue={editing?.url}
                required
                placeholder="https://example.com/mcp"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="server-auth">Authentication</Label>
              <select
                id="server-auth"
                name="authType"
                defaultValue={editing?.authType ?? "NONE"}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="NONE">None</option>
                <option value="BEARER">Bearer token</option>
                <option value="HEADER">Custom header</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="server-header">
                Header name <span className="text-muted-foreground">(for custom header)</span>
              </Label>
              <Input
                id="server-header"
                name="authHeaderName"
                defaultValue={editing?.authHeaderName ?? ""}
                placeholder="X-API-Key"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="server-credential">
                Credential{" "}
                {editing && (
                  <span className="text-muted-foreground">(leave blank to keep existing)</span>
                )}
              </Label>
              <Input
                id="server-credential"
                name="credential"
                type="password"
                autoComplete="new-password"
                placeholder={
                  editing?.hasCredential ? "Stored securely · enter to replace" : "Enter secret"
                }
              />
            </div>
            {formError && <ErrorNotice message={formError} />}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving..." : editing ? "Save changes" : "Add server"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
