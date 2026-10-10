'use client';

import { useEffect, useRef, useState } from 'react';

import { Button, Field, Modal, TextInput } from '@/components/ui/primitives';
import type { GroupRecord } from '@/types';

export interface GroupFormDialogProps {
  open: boolean;
  mode: 'create' | 'rename';
  initialName?: string;
  busy: boolean;
  error: string | null;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

/**
 * Rendered only while open, and keyed by the group being edited, so each
 * appearance is a fresh mount. That is what lets the form initialize straight
 * from props instead of resetting itself inside an effect.
 */
export function GroupFormDialog({
  open,
  mode,
  initialName = '',
  busy,
  error,
  onSubmit,
  onCancel,
}: GroupFormDialogProps) {
  const [name, setName] = useState(initialName);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // autoFocus races <dialog>.showModal(), so focus explicitly on mount, once
  // the value is already committed — selecting it makes renaming a single
  // keystroke rather than a select-all followed by typing.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function submit() {
    if (!name.trim()) {
      setLocalError('Enter a name with at least one non-space character.');
      return;
    }
    onSubmit(name.trim());
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={mode === 'create' ? 'New group' : 'Rename group'}
      description={
        mode === 'create'
          ? 'Groups are yours to define — Frontend, Backend, Infrastructure, or anything else that fits how you work.'
          : undefined
      }
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : mode === 'create' ? 'Create group' : 'Save'}
          </Button>
        </>
      }
    >
      <Field label="Group name" error={localError ?? error ?? undefined}>
        <TextInput
          ref={inputRef}
          value={name}
          disabled={busy}
          placeholder="Frontend"
          onChange={(event) => {
            setName(event.target.value);
            setLocalError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
        />
      </Field>
    </Modal>
  );
}

export interface DeleteGroupDialogProps {
  open: boolean;
  group: GroupRecord | null;
  repositoryCount: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Deleting a group only removes the grouping. The repositories stay in the
 * workspace as Ungrouped, and nothing is removed from disk — the dialog says so
 * plainly so the action is never mistaken for something destructive.
 */
export function DeleteGroupDialog({
  open,
  group,
  repositoryCount,
  busy,
  onConfirm,
  onCancel,
}: DeleteGroupDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={`Delete “${group?.name ?? ''}”?`}
      description="This removes the group only."
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete group'}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-muted">
        {repositoryCount === 0 ? (
          <>This group has no repositories in it.</>
        ) : (
          <>
            {repositoryCount} {repositoryCount === 1 ? 'repository' : 'repositories'} will move to{' '}
            <span className="font-medium text-ink">Ungrouped</span>.
          </>
        )}{' '}
        No repository is removed from the workspace, and no files are deleted.
      </p>
    </Modal>
  );
}
