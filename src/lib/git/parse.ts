import type { BranchInfo, WorkingTreeStatus } from '@/types';

/**
 * Parse `git status --porcelain=v1 -z` output.
 *
 * Records are NUL-separated. Each record is `XY <path>`, except renames and
 * copies (X or Y in R/C) which are followed by a *second* NUL-terminated record
 * holding the original path — that extra record must be consumed, not counted
 * as another change.
 */
export function parsePorcelainStatus(stdout: string): WorkingTreeStatus {
  const records = stdout.split('\0').filter((r) => r.length > 0);

  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  let conflicted = 0;
  let total = 0;

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]!;
    if (record.length < 3) continue;

    const x = record[0]!;
    const y = record[1]!;
    total += 1;

    if (x === '?' && y === '?') {
      untracked += 1;
      continue;
    }
    if (x === '!' && y === '!') {
      // Ignored entries are not requested, but tolerate them.
      total -= 1;
      continue;
    }

    // Unmerged states per git-status(1): DD, AU, UD, UA, DU, AA, UU.
    const unmerged =
      x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D');
    if (unmerged) {
      conflicted += 1;
    } else {
      if (x !== ' ' && x !== '?') staged += 1;
      if (y !== ' ' && y !== '?') unstaged += 1;
    }

    // Renames/copies carry an extra record with the source path.
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') i += 1;
  }

  return {
    clean: total === 0,
    staged,
    unstaged,
    untracked,
    conflicted,
    total,
  };
}

/**
 * Field order written by {@link BRANCH_FORMAT}. Using for-each-ref keeps the
 * output machine-readable rather than parsing `git branch`'s human output.
 */
export const BRANCH_FORMAT =
  '%(refname)%00%(refname:short)%00%(objectname:short)%00%(upstream:short)%00%(HEAD)';

interface RawBranch {
  ref: string;
  short: string;
  sha: string;
  upstream: string;
  head: string;
}

function parseBranchLines(stdout: string): RawBranch[] {
  return stdout
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.length > 0)
    .map((line) => {
      const [ref = '', short = '', sha = '', upstream = '', head = ''] = line.split('\0');
      return { ref, short, sha, upstream, head };
    })
    .filter((b) => b.ref.length > 0);
}

/**
 * Split for-each-ref output into local and remote branches.
 *
 * `refs/remotes/<remote>/HEAD` is dropped — it is a symbolic alias, and showing
 * it alongside the branch it points at is exactly the "confusing duplicate
 * entry" the spec warns about. Remote branches that have no local counterpart
 * are flagged so the UI can offer to create a local tracking branch.
 */
export function parseBranchListing(stdout: string): {
  local: BranchInfo[];
  remote: BranchInfo[];
} {
  const raw = parseBranchLines(stdout);

  const local: BranchInfo[] = [];
  const remoteRaw: RawBranch[] = [];

  for (const branch of raw) {
    if (branch.ref.startsWith('refs/heads/')) {
      local.push({
        name: branch.short,
        ref: branch.ref,
        kind: 'local',
        sha: branch.sha,
        upstream: branch.upstream || undefined,
        current: branch.head === '*',
      });
    } else if (branch.ref.startsWith('refs/remotes/')) {
      // refs/remotes/origin/HEAD -> short name "origin/HEAD"
      const tail = branch.ref.slice('refs/remotes/'.length);
      if (tail.endsWith('/HEAD')) continue;
      remoteRaw.push(branch);
    }
  }

  const localNames = new Set(local.map((b) => b.name));

  const remote: BranchInfo[] = remoteRaw.map((branch) => {
    const tail = branch.ref.slice('refs/remotes/'.length);
    const slash = tail.indexOf('/');
    const remoteName = slash === -1 ? tail : tail.slice(0, slash);
    const localName = slash === -1 ? tail : tail.slice(slash + 1);
    return {
      name: branch.short,
      ref: branch.ref,
      kind: 'remote',
      sha: branch.sha,
      current: false,
      remote: remoteName,
      remoteOnlyLocalName: localNames.has(localName) ? undefined : localName,
    };
  });

  local.sort(byName);
  remote.sort(byName);
  return { local, remote };
}

function byName(a: BranchInfo, b: BranchInfo): number {
  return a.name.localeCompare(b.name);
}
