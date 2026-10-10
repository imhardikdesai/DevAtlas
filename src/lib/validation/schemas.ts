import { z } from 'zod';

/** Current on-disk schema version for `.devatlas/config.json`. */
export const SCHEMA_VERSION = 1;

const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
  message: 'must be an ISO-8601 timestamp',
});

/** `.devatlas/config.json` */
export const workspaceConfigSchema = z.object({
  schemaVersion: z.number().int().positive(),
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  rootPath: z.string().min(1),
  createdAt: isoDate,
  updatedAt: isoDate.optional(),
});

export const repositoryRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  absolutePath: z.string().min(1),
  relativePath: z.string().min(1),
  /**
   * False when the repository was not found during the most recent discovery.
   * The record is deliberately retained so group membership survives a repo
   * that is only temporarily unavailable.
   */
  available: z.boolean().default(true),
  lastSeenAt: isoDate.optional(),
});

export const groupRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  repositoryIds: z.array(z.string().min(1)).default([]),
  createdAt: isoDate.optional(),
});

/** `.devatlas/data.json` */
export const workspaceDataSchema = z.object({
  repositories: z.array(repositoryRecordSchema).default([]),
  groups: z.array(groupRecordSchema).default([]),
  updatedAt: isoDate.optional(),
});

/** `.devatlas/runtime.json` — transient, not part of user metadata. */
export const runtimeRecordSchema = z.object({
  pid: z.number().int().positive(),
  port: z.number().int().positive(),
  workspaceId: z.string().min(1),
  url: z.string().min(1),
  startedAt: isoDate,
});

export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;
export type WorkspaceData = z.infer<typeof workspaceDataSchema>;
export type RepositoryRecord = z.infer<typeof repositoryRecordSchema>;
export type GroupRecord = z.infer<typeof groupRecordSchema>;
export type RuntimeRecord = z.infer<typeof runtimeRecordSchema>;

/* -------------------------------------------------------------------------- */
/* API request payloads                                                       */
/* -------------------------------------------------------------------------- */

/** Names are trimmed before validation so "  " is rejected as empty. */
const displayName = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.string().min(1, 'Name cannot be empty').max(120, 'Name is too long'));

export const renameWorkspaceSchema = z.object({ name: displayName });

export const createGroupSchema = z.object({ name: displayName });

export const updateGroupSchema = z.object({ name: displayName });

export const assignRepositorySchema = z.object({
  repositoryId: z.string().min(1),
  /** null removes the repository from its current group (→ Ungrouped). */
  groupId: z.string().min(1).nullable(),
});

export const switchBranchSchema = z.object({
  /** Short branch name: `main` for a local, `origin/main` for a remote. */
  branch: z.string().min(1).max(255),
  kind: z.enum(['local', 'remote']),
  /** Explicit user confirmation that uncommitted changes are present. */
  confirmDirty: z.boolean().optional().default(false),
});

export type RenameWorkspaceInput = z.infer<typeof renameWorkspaceSchema>;
export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
export type AssignRepositoryInput = z.infer<typeof assignRepositorySchema>;
export type SwitchBranchInput = z.infer<typeof switchBranchSchema>;
