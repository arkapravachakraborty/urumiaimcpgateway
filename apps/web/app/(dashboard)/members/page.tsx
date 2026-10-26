"use client";

import { useState, type FormEvent } from "react";
import { Copy, UserPlus, Users } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { trpc } from "~/providers/trpc";

export default function MembersPage() {
  const utils = trpc.useUtils();
  const members = trpc.members.list.useQuery(undefined);
  const create = trpc.members.create.useMutation({
    onSuccess: () => void utils.members.list.invalidate(),
  });
  const disable = trpc.members.disable.useMutation({
    onSuccess: () => void utils.members.list.invalidate(),
  });
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await create.mutateAsync({
        email: String(form.get("email")).trim(),
        role: String(form.get("role")) as "ADMIN" | "MEMBER",
      });
      setCreated({ email: result.member.email, password: result.temporaryPassword });
      setOpen(false);
    } catch {
      setError("Could not create the account. The email may already be in use.");
    }
  }

  async function copyPassword() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.password);
    } catch {
      setError("Clipboard access was denied. Select and copy the password manually.");
    }
  }

  function closeTemporaryPassword() {
    setCreated(null);
    create.reset();
  }

  return (
    <div>
      <PageHeading
        eyebrow="Workspace access"
        title="Members"
        description="Invite teammates and manage access to the gateway."
        action={
          <Button
            onClick={() => {
              setError("");
              setOpen(true);
            }}
          >
            <UserPlus /> Create member
          </Button>
        }
      />
      {error && (
        <div className="mb-5">
          <ErrorNotice message={error} />
        </div>
      )}
      {disable.error && (
        <div className="mb-5">
          <ErrorNotice message="Could not disable the account. Please retry." />
        </div>
      )}
      {members.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : members.error ? (
        <ErrorNotice message="Unable to load members." />
      ) : members.data?.length ? (
        <Card className="py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.data.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <span className="grid size-9 place-items-center rounded-full bg-primary/10 text-primary">
                          <Users className="size-4" />
                        </span>
                        <span className="font-medium">{member.email}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={member.role === "ADMIN" ? "default" : "secondary"}>
                        {member.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(member.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={member.disabledAt ? "outline" : "secondary"}>
                        {member.disabledAt ? "Disabled" : "Active"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {!member.disabledAt && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={disable.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Disable ${member.email}? They will lose access immediately.`,
                              )
                            )
                              disable.mutate({ userId: member.id });
                          }}
                        >
                          Disable
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
        <EmptyNotice>No team members yet. Create an account to invite someone.</EmptyNotice>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create member</DialogTitle>
            <DialogDescription>
              A temporary password will be generated and shown once. Share it securely.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => void submit(event)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="member-email">Email</Label>
              <Input
                id="member-email"
                name="email"
                type="email"
                required
                autoComplete="off"
                placeholder="teammate@company.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="member-role">Role</Label>
              <select
                id="member-role"
                name="role"
                defaultValue="MEMBER"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="MEMBER">Member</option>
                <option value="ADMIN">Administrator</option>
              </select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Creating..." : "Create account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={created !== null}
        onOpenChange={(next) => {
          if (!next) closeTemporaryPassword();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Temporary password</DialogTitle>
            <DialogDescription>
              Copy this password now. It cannot be retrieved after closing this dialog.
            </DialogDescription>
          </DialogHeader>
          {created && (
            <div className="space-y-3">
              <p className="text-sm">{created.email}</p>
              <div className="flex gap-2">
                <Input readOnly value={created.password} className="font-mono" />
                <Button
                  variant="outline"
                  onClick={() => void copyPassword()}
                  aria-label="Copy temporary password"
                >
                  <Copy />
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={closeTemporaryPassword}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
