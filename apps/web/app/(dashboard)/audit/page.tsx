"use client";

import { useState } from "react";
import { Filter, RotateCcw } from "lucide-react";
import { PageHeading, EmptyNotice, ErrorNotice } from "~/components/page-heading";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
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

type AuditStatus = "success" | "error" | "timeout" | "rejected";
function statusVariant(status: AuditStatus): "default" | "destructive" | "secondary" | "outline" {
  if (status === "success") return "default";
  if (status === "error") return "destructive";
  if (status === "timeout") return "outline";
  return "secondary";
}

export default function AuditPage() {
  const [filters, setFilters] = useState({
    userId: "",
    serverSlug: "",
    toolName: "",
    status: "",
    from: "",
    to: "",
  });
  const [applied, setApplied] = useState(filters);
  const [cursor, setCursor] = useState<string | undefined>();
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>([]);
  const [dateError, setDateError] = useState("");
  const logs = trpc.audit.list.useQuery({
    ...(applied.userId ? { userId: applied.userId } : {}),
    ...(applied.serverSlug ? { serverSlug: applied.serverSlug } : {}),
    ...(applied.toolName ? { toolName: applied.toolName } : {}),
    ...(applied.status ? { status: applied.status as AuditStatus } : {}),
    ...(applied.from ? { from: new Date(applied.from) } : {}),
    ...(applied.to ? { to: new Date(`${applied.to}T23:59:59.999`) } : {}),
    limit: 25,
    ...(cursor ? { cursor } : {}),
  });

  function applyFilters() {
    if (
      (filters.from && Number.isNaN(Date.parse(`${filters.from}T00:00:00`))) ||
      (filters.to && Number.isNaN(Date.parse(`${filters.to}T00:00:00`))) ||
      (filters.from && filters.to && filters.from > filters.to)
    ) {
      setDateError("Choose a valid date range.");
      return;
    }
    setDateError("");
    setApplied(filters);
    setCursor(undefined);
    setCursorHistory([]);
  }

  function clearFilters() {
    const empty = { userId: "", serverSlug: "", toolName: "", status: "", from: "", to: "" };
    setFilters(empty);
    setApplied(empty);
    setDateError("");
    setCursor(undefined);
    setCursorHistory([]);
  }

  function nextPage() {
    if (!logs.data?.nextCursor) return;
    setCursorHistory((history) => [...history, cursor]);
    setCursor(logs.data.nextCursor);
  }

  function previousPage() {
    setCursorHistory((history) => {
      const next = [...history];
      setCursor(next.pop());
      return next;
    });
  }

  return (
    <div>
      <PageHeading
        eyebrow="Observability"
        title="Audit log"
        description="Review tool calls and activity across your workspace."
      />
      <Card className="mb-6">
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 xl:grid-cols-6">
          <div className="space-y-2">
            <Label htmlFor="filter-user">User ID</Label>
            <Input
              id="filter-user"
              value={filters.userId}
              onChange={(event) => setFilters({ ...filters, userId: event.target.value })}
              placeholder="User ID"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="filter-server">Server</Label>
            <Input
              id="filter-server"
              value={filters.serverSlug}
              onChange={(event) => setFilters({ ...filters, serverSlug: event.target.value })}
              placeholder="Slug"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="filter-tool">Tool</Label>
            <Input
              id="filter-tool"
              value={filters.toolName}
              onChange={(event) => setFilters({ ...filters, toolName: event.target.value })}
              placeholder="Tool name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="filter-status">Status</Label>
            <select
              id="filter-status"
              value={filters.status}
              onChange={(event) => setFilters({ ...filters, status: event.target.value })}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">All statuses</option>
              <option value="success">Success</option>
              <option value="error">Error</option>
              <option value="timeout">Timeout</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="filter-from">From</Label>
            <Input
              id="filter-from"
              type="date"
              value={filters.from}
              onChange={(event) => setFilters({ ...filters, from: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="filter-to">To</Label>
            <Input
              id="filter-to"
              type="date"
              value={filters.to}
              onChange={(event) => setFilters({ ...filters, to: event.target.value })}
            />
          </div>
          <div className="flex gap-2 sm:col-span-2 xl:col-span-6">
            <Button onClick={applyFilters}>
              <Filter /> Apply filters
            </Button>
            <Button variant="outline" onClick={clearFilters}>
              <RotateCcw /> Clear
            </Button>
          </div>
        </CardContent>
      </Card>
      {dateError && (
        <div className="mb-5">
          <ErrorNotice message={dateError} />
        </div>
      )}

      {logs.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : logs.error ? (
        <ErrorNotice message="Unable to load audit entries." />
      ) : logs.data?.items.length ? (
        <>
          <Card className="py-0">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead>When</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Server</TableHead>
                    <TableHead>Tool</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.data.items.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-muted-foreground">
                        {new Date(entry.startedAt).toLocaleString()}
                      </TableCell>
                      <TableCell>{entry.userEmail}</TableCell>
                      <TableCell className="font-mono text-xs">{entry.serverSlug ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{entry.toolName}</TableCell>
                      <TableCell>{entry.durationMs} ms</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(entry.status)}>{entry.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!cursorHistory.length}
              onClick={previousPage}
            >
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={!logs.data.nextCursor} onClick={nextPage}>
              Next
            </Button>
          </div>
        </>
      ) : (
        <EmptyNotice>No audit entries match these filters.</EmptyNotice>
      )}
    </div>
  );
}
