'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Loader2, Lock, RotateCcw, Search, ShieldCheck, UserPlus, UsersRound } from 'lucide-react';
import {
  ApiRequestError,
  createStaff,
  getStaff,
  logApiError,
  setStaffActive,
} from '@/lib/api-client';
import type { StaffSummary } from '@/lib/api-client';
import {
  ROLE_BACKEND_VALUE,
  ROLE_KEYS,
  roleKeyFor,
  type RoleKey,
  type SettingsCopy,
} from '@/lib/settings-i18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { SettingsCard } from './settings-ui';
import { cn } from '@/lib/utils';

const MIN_PASSWORD = 8;

interface NewAccount {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  role: RoleKey;
}

const EMPTY_ACCOUNT: NewAccount = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  /* The least-privileged role that is actually assignable. `clerk` would be the
     natural default for a new account and is exactly the one the enum cannot
     store yet — pre-selecting it would open the dialog on a choice that fails. */
  role: 'inspector',
};

/**
 * المستخدمون والأدوار — who may sign in, and as what.
 *
 * The account table and the create flow are wired to `/staff`, which has held
 * both since before this section existed.
 *
 * The role catalogue is the part worth reading. The specification asks for four
 * municipal roles — مدير النظام، محاسب، مفتّش، موظف إداري — and the database's
 * `StaffRole` enum has three values, two of which match and one of which
 * (مدقّق) is not on that list but is in use. Rather than quietly assign an
 * accountant to whichever existing role is nearest — which is how a محاسب ends
 * up with an auditor's read-only access, or worse, an administrator's — every
 * role is listed with what it is for, and the two with no enum value behind
 * them are shown as unavailable and cannot be selected.
 *
 * That gap is not a frontend task to close. Adding ACCOUNTANT and CLERK needs a
 * Postgres enum migration and a pass over every `@Roles()` guard deciding what
 * each may reach, which is a permissions decision the municipality owns.
 */
export function UsersSection({
  tenant,
  token,
  copy,
}: {
  tenant: string;
  token: string;
  copy: SettingsCopy;
}) {
  const toast = useToast();

  const [rows, setRows] = useState<StaffSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<NewAccount>(EMPTY_ACCOUNT);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const { items } = await getStaff(tenant, token);
      setRows(items);
      setError(null);
    } catch (caught) {
      logApiError(caught);
      setError(caught instanceof ApiRequestError ? caught.message : copy.users.loadError);
    } finally {
      setLoading(false);
    }
  }, [tenant, token, copy.users.loadError]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (row) =>
        row.fullName.toLowerCase().includes(needle) ||
        row.email.toLowerCase().includes(needle),
    );
  }, [rows, search]);

  const toggleActive = useCallback(
    async (row: StaffSummary) => {
      setPendingId(row.id);
      try {
        await setStaffActive(tenant, token, row.id, !row.isActive);
        setRows((previous) =>
          previous.map((item) =>
            item.id === row.id ? { ...item, isActive: !row.isActive } : item,
          ),
        );
        toast.success(copy.users.statusChanged);
      } catch (caught) {
        logApiError(caught);
        toast.error(
          caught instanceof ApiRequestError ? caught.message : copy.common.saveError,
        );
      } finally {
        setPendingId(null);
      }
    },
    [tenant, token, toast, copy],
  );

  const submit = useCallback(async () => {
    const backendRole = ROLE_BACKEND_VALUE[draft.role];
    if (
      !draft.firstName.trim() ||
      !draft.lastName.trim() ||
      !draft.email.trim() ||
      draft.password.length < MIN_PASSWORD ||
      !backendRole
    ) {
      toast.error(copy.users.incomplete);
      return;
    }

    setCreating(true);
    try {
      await createStaff(tenant, token, {
        email: draft.email.trim(),
        password: draft.password,
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
        role: backendRole,
      });
      toast.success(copy.users.created);
      setDialogOpen(false);
      setDraft(EMPTY_ACCOUNT);
      await load();
    } catch (caught) {
      logApiError(caught);
      toast.error(
        caught instanceof ApiRequestError ? caught.message : copy.users.createFailed,
      );
    } finally {
      setCreating(false);
    }
  }, [tenant, token, draft, load, toast, copy.users]);

  /** Roles a new account can actually be given — see the note on this file. */
  const assignableRoles = ROLE_KEYS.filter((key) => ROLE_BACKEND_VALUE[key] !== null);

  return (
    <div className="space-y-6">
      <SettingsCard
        icon={ShieldCheck}
        title={copy.users.rolesHeading}
        hint={copy.users.rolesHint}
      >
        <ul className="grid gap-3 sm:grid-cols-2">
          {ROLE_KEYS.map((key) => {
            const available = ROLE_BACKEND_VALUE[key] !== null;
            return (
              <li
                key={key}
                className={cn(
                  'rounded-xl border p-4',
                  available ? 'border-border/70 bg-card' : 'border-dashed border-border bg-muted/20',
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className={cn('font-medium', !available && 'text-muted-foreground')}>
                    {copy.users.roleNames[key]}
                  </p>
                  {available ? null : (
                    <Badge variant="soft-warning" className="shrink-0 gap-1">
                      <Lock className="size-3" aria-hidden />
                      {copy.users.roleUnavailable}
                    </Badge>
                  )}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {copy.users.roleDuties[key]}
                </p>
                {available ? null : (
                  <p className="mt-2 text-xs leading-relaxed text-warning">
                    {copy.users.roleUnavailableHint}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </SettingsCard>

      <SettingsCard
        icon={UsersRound}
        title={copy.users.heading}
        hint={copy.users.hint}
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <UserPlus className="size-4" aria-hidden />
            {copy.users.addAccount}
          </Button>
        }
      >
        <div className="relative mb-4 max-w-sm">
          <Search
            aria-hidden
            className="pointer-events-none absolute inset-y-0 start-3.5 my-auto size-4 text-muted-foreground"
          />
          <Input
            className="ps-10"
            placeholder={copy.users.search}
            aria-label={copy.users.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
          >
            {error}
          </p>
        ) : loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="rounded-xl border border-border/70 bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            {search ? copy.users.emptySearch : copy.users.empty}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{copy.users.colName}</TableHead>
                  <TableHead>{copy.users.colEmail}</TableHead>
                  <TableHead>{copy.users.colRole}</TableHead>
                  <TableHead>{copy.users.colStatus}</TableHead>
                  <TableHead className="text-end">{copy.users.colActions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => {
                  const key = roleKeyFor(row.role);
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.fullName}</TableCell>
                      {/* An address is Latin inside an RTL table; without `dir`
                          the @ and the dots reorder around the domain. */}
                      <TableCell dir="ltr" className="text-start">
                        {row.email}
                      </TableCell>
                      <TableCell>
                        {/* Falls back to the raw enum rather than blank: an
                            unrecognised role is something to notice, not hide. */}
                        {key ? copy.users.roleNames[key] : row.role}
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.isActive ? 'soft-success' : 'soft-muted'}>
                          {row.isActive ? copy.users.statusActive : copy.users.statusSuspended}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pendingId === row.id}
                          onClick={() => void toggleActive(row)}
                        >
                          {pendingId === row.id ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                          ) : row.isActive ? (
                            <Ban className="size-4" aria-hidden />
                          ) : (
                            <RotateCcw className="size-4" aria-hidden />
                          )}
                          {row.isActive ? copy.users.suspend : copy.users.reactivate}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </SettingsCard>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.users.newAccount}</DialogTitle>
            <DialogDescription>{copy.users.newAccountHint}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 p-6 sm:grid-cols-2">
            <Field label={copy.users.firstName} htmlFor="new-first" required>
              <Input
                id="new-first"
                value={draft.firstName}
                onChange={(e) => setDraft({ ...draft, firstName: e.target.value })}
              />
            </Field>
            <Field label={copy.users.lastName} htmlFor="new-last" required>
              <Input
                id="new-last"
                value={draft.lastName}
                onChange={(e) => setDraft({ ...draft, lastName: e.target.value })}
              />
            </Field>
            <Field label={copy.users.email} htmlFor="new-email" required>
              <Input
                id="new-email"
                type="email"
                dir="ltr"
                className="text-start"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              />
            </Field>
            <Field
              label={copy.users.password}
              htmlFor="new-password"
              required
              hint={copy.users.passwordHint}
            >
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={draft.password}
                onChange={(e) => setDraft({ ...draft, password: e.target.value })}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field
                label={copy.users.role}
                htmlFor="new-role"
                required
                hint={copy.users.roleDuties[draft.role]}
              >
                <Select
                  value={draft.role}
                  onValueChange={(next) => setDraft({ ...draft, role: next as RoleKey })}
                >
                  <SelectTrigger id="new-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {/*
                      Only the assignable roles appear here. A disabled option
                      for a role the server cannot store would be a choice that
                      looks available in the list and fails on submit.
                    */}
                    {assignableRoles.map((key) => (
                      <SelectItem key={key} value={key}>
                        {copy.users.roleNames[key]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </div>

          <DialogFooter className="gap-2 border-t p-6">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={creating}>
              {copy.common.cancel}
            </Button>
            <Button onClick={() => void submit()} disabled={creating}>
              {creating ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  {copy.users.creating}
                </>
              ) : (
                copy.users.create
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
