import { describe, expect, it } from 'vitest';

import { BRANCH_FORMAT, parseBranchListing, parsePorcelainStatus } from '@/lib/git/parse';

/** Build a NUL-separated porcelain payload the way git writes it. */
function porcelain(...records: string[]): string {
  return records.map((r) => `${r}\0`).join('');
}

describe('parsePorcelainStatus', () => {
  it('reports a clean tree for empty output', () => {
    const status = parsePorcelainStatus('');
    expect(status).toMatchObject({ clean: true, staged: 0, unstaged: 0, untracked: 0, total: 0 });
  });

  it('counts staged, unstaged and untracked entries separately', () => {
    const status = parsePorcelainStatus(
      porcelain('M  staged.txt', ' M unstaged.txt', '?? new.txt', 'MM both.txt'),
    );
    expect(status.clean).toBe(false);
    expect(status.staged).toBe(2); // M_ and MM
    expect(status.unstaged).toBe(2); // _M and MM
    expect(status.untracked).toBe(1);
    expect(status.total).toBe(4);
  });

  it('consumes the extra record a rename emits instead of double-counting', () => {
    // git writes the destination, then the source, as two NUL-terminated records.
    const status = parsePorcelainStatus(porcelain('R  new-name.txt', 'old-name.txt'));
    expect(status.total).toBe(1);
    expect(status.staged).toBe(1);
    expect(status.untracked).toBe(0);
  });

  it('classifies unmerged entries as conflicts, not as staged work', () => {
    const status = parsePorcelainStatus(porcelain('UU conflict.txt', 'AA both-added.txt'));
    expect(status.conflicted).toBe(2);
    expect(status.staged).toBe(0);
    expect(status.unstaged).toBe(0);
    expect(status.clean).toBe(false);
  });
});

describe('parseBranchListing', () => {
  const line = (ref: string, short: string, sha: string, upstream = '', head = '') =>
    [ref, short, sha, upstream, head].join('\0');

  it('splits local and remote branches and marks the current one', () => {
    const { local, remote } = parseBranchListing(
      [
        line('refs/heads/main', 'main', 'aaa1111', 'origin/main', '*'),
        line('refs/heads/feature', 'feature', 'bbb2222'),
        line('refs/remotes/origin/main', 'origin/main', 'aaa1111'),
      ].join('\n'),
    );

    expect(local.map((b) => b.name)).toEqual(['feature', 'main']);
    expect(local.find((b) => b.name === 'main')).toMatchObject({
      current: true,
      upstream: 'origin/main',
    });
    expect(remote.map((b) => b.name)).toEqual(['origin/main']);
  });

  it('drops refs/remotes/<remote>/HEAD so no confusing duplicate appears', () => {
    const { remote } = parseBranchListing(
      [
        line('refs/remotes/origin/HEAD', 'origin/HEAD', 'aaa1111'),
        line('refs/remotes/origin/main', 'origin/main', 'aaa1111'),
      ].join('\n'),
    );
    expect(remote.map((b) => b.name)).toEqual(['origin/main']);
  });

  it('flags only those remote branches that have no local counterpart', () => {
    const { remote } = parseBranchListing(
      [
        line('refs/heads/main', 'main', 'aaa1111', '', '*'),
        line('refs/remotes/origin/main', 'origin/main', 'aaa1111'),
        line('refs/remotes/origin/deploy/staging', 'origin/deploy/staging', 'ccc3333'),
      ].join('\n'),
    );

    const main = remote.find((b) => b.name === 'origin/main');
    const staging = remote.find((b) => b.name === 'origin/deploy/staging');

    expect(main?.remoteOnlyLocalName).toBeUndefined();
    // Slash-containing branch names must keep their full name after the remote.
    expect(staging?.remoteOnlyLocalName).toBe('deploy/staging');
    expect(staging?.remote).toBe('origin');
  });
});

describe('BRANCH_FORMAT', () => {
  it('requests machine-readable fields rather than human output', () => {
    expect(BRANCH_FORMAT).toContain('%(refname)');
    expect(BRANCH_FORMAT).toContain('%(upstream:short)');
    expect(BRANCH_FORMAT).toContain('%00');
  });
});
