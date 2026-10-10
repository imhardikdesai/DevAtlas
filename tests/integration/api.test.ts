import { promises as fs } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { configPath, dataPath } from '@/lib/config/paths';
import { ensureWorkspace } from '@/lib/workspace/store';
import {
  addRemote,
  createSandbox,
  git,
  makeBranchWithContent,
  makeRepo,
  readFileText,
  writeFile,
  type Sandbox,
} from '../helpers/sandbox';
import { callApi, rawRequest, startServer, type RunningServer } from '../helpers/server';

let sandbox: Sandbox;
let ws: string;
let server: RunningServer;

/** repositories keyed by relative path, for readable assertions. */
async function repositories(): Promise<Record<string, any>> {
  const { body } = await callApi(server, '/api/repositories?force=1');
  return Object.fromEntries((body.repositories as any[]).map((r) => [r.relativePath, r]));
}

beforeAll(async () => {
  sandbox = await createSandbox('devatlas-api-');
  ws = path.join(sandbox.root, 'workspace');
  await fs.mkdir(ws, { recursive: true });

  // A realistic workspace: root repo, nested repos, a remote-only branch,
  // a dirty tree with a conflicting edit, a detached HEAD, an empty repo,
  // and decoys that must never be discovered.
  await makeRepo(sandbox, ws);
  await makeRepo(sandbox, path.join(ws, 'frontend'));
  await makeRepo(sandbox, path.join(ws, 'services', 'backend'));
  await makeRepo(sandbox, path.join(ws, 'mobile'));
  await makeRepo(sandbox, path.join(ws, 'empty-repo'), { commit: false });
  await makeRepo(sandbox, path.join(ws, 'node_modules', 'decoy'));
  await makeRepo(sandbox, path.join(ws, 'dist', 'decoy'));

  const infra = await makeRepo(sandbox, path.join(ws, 'infra'));
  await makeBranchWithContent(sandbox, infra, 'deploy/staging', '# staging\n');
  await addRemote(sandbox, infra, path.join(sandbox.root, 'origin-infra.git'), [
    'main',
    'deploy/staging',
  ]);
  await git(sandbox, infra, ['branch', '-D', 'deploy/staging']);
  await git(sandbox, infra, ['fetch', '-q', 'origin']);

  // frontend: a committed, conflicting change on feature/x plus an
  // uncommitted edit on main, so a switch must be refused.
  const frontend = path.join(ws, 'frontend');
  await makeBranchWithContent(sandbox, frontend, 'feature/x', '# FEATURE CONTENT\n');
  await writeFile(path.join(frontend, 'README.md'), '# PRECIOUS UNCOMMITTED WORK\n');

  await git(sandbox, path.join(ws, 'mobile'), ['switch', '-q', '--detach', 'HEAD']);

  await ensureWorkspace(ws);
  server = await startServer(ws, { GIT_CONFIG_GLOBAL: sandbox.env.GIT_CONFIG_GLOBAL });
  await callApi(server, '/api/repositories/refresh', { method: 'POST' });
}, 180_000);

afterAll(async () => {
  await server?.stop();
  await sandbox?.cleanup();
});

/* -------------------------------------------------------------------------- */

describe('discovery through the API', () => {
  it('discovers the root repository and nested independent repositories', async () => {
    const repos = await repositories();
    expect(Object.keys(repos).sort()).toEqual([
      '.',
      'empty-repo',
      'frontend',
      'infra',
      'mobile',
      'services/backend',
    ]);
  });

  it('excludes dependency and build directories', async () => {
    const repos = await repositories();
    expect(Object.keys(repos).some((p) => p.includes('node_modules'))).toBe(false);
    expect(Object.keys(repos).some((p) => p.includes('dist'))).toBe(false);
  });

  it('reports live branch and working-tree status', async () => {
    const repos = await repositories();
    expect(repos['services/backend'].head).toMatchObject({ kind: 'branch', branch: 'main' });
    expect(repos['services/backend'].status.clean).toBe(true);
    expect(repos.frontend.status).toMatchObject({ clean: false, unstaged: 1 });
    expect(repos.mobile.head.kind).toBe('detached');
    expect(repos['empty-repo'].head).toMatchObject({ kind: 'unborn', branch: 'main' });
  });
});

describe('workspace', () => {
  it('renames without touching the directory, and persists', async () => {
    const before = await fs.readdir(path.dirname(ws));

    const { status, body } = await callApi(server, '/api/workspace', {
      method: 'PATCH',
      body: { name: '   Acme Platform   ' },
    });

    expect(status).toBe(200);
    expect(body.workspace.name).toBe('Acme Platform'); // trimmed
    expect(body.workspace.rootPath).toBe(ws);
    expect(await fs.readdir(path.dirname(ws))).toEqual(before);

    const onDisk = JSON.parse(await readFileText(configPath(ws)));
    expect(onDisk.name).toBe('Acme Platform');
  });

  it('rejects an empty or whitespace-only name', async () => {
    for (const name of ['', '   ', '\t\n']) {
      const { status, body } = await callApi(server, '/api/workspace', {
        method: 'PATCH',
        body: { name },
      });
      expect(status).toBe(400);
      expect(body.error.code).toBe('INVALID_INPUT');
    }
    const { body } = await callApi(server, '/api/workspace');
    expect(body.workspace.name).toBe('Acme Platform');
  });
});

describe('groups', () => {
  let groupId = '';

  it('creates a group', async () => {
    const { status, body } = await callApi(server, '/api/groups', {
      method: 'POST',
      body: { name: '  Infrastructure  ' },
    });
    expect(status).toBe(201);
    expect(body.group.name).toBe('Infrastructure');
    groupId = body.group.id;
  });

  it('rejects a duplicate name regardless of case', async () => {
    const { status, body } = await callApi(server, '/api/groups', {
      method: 'POST',
      body: { name: 'INFRASTRUCTURE' },
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe('GROUP_NAME_TAKEN');
  });

  it('rejects an empty name', async () => {
    const { status } = await callApi(server, '/api/groups', {
      method: 'POST',
      body: { name: '  ' },
    });
    expect(status).toBe(400);
  });

  it('assigns a repository to the group', async () => {
    const repos = await repositories();
    const { status } = await callApi(server, '/api/groups/assign', {
      method: 'PATCH',
      body: { repositoryId: repos.infra.id, groupId },
    });
    expect(status).toBe(200);

    const after = await repositories();
    expect(after.infra.groupId).toBe(groupId);
    expect(after.infra.groupName).toBe('Infrastructure');
  });

  it('keeps a repository in at most one group', async () => {
    const { body: created } = await callApi(server, '/api/groups', {
      method: 'POST',
      body: { name: 'Platform' },
    });
    const repos = await repositories();

    await callApi(server, '/api/groups/assign', {
      method: 'PATCH',
      body: { repositoryId: repos.infra.id, groupId: created.group.id },
    });

    const { body } = await callApi(server, '/api/groups');
    const holders = (body.groups as any[]).filter((g) =>
      g.repositoryIds.includes(repos.infra.id),
    );
    expect(holders).toHaveLength(1);
    expect(holders[0].id).toBe(created.group.id);

    // Put it back for the following tests.
    await callApi(server, '/api/groups/assign', {
      method: 'PATCH',
      body: { repositoryId: repos.infra.id, groupId },
    });
    await callApi(server, `/api/groups/${created.group.id}`, { method: 'DELETE' });
  });

  it('removes a repository from every group when groupId is null', async () => {
    const repos = await repositories();
    await callApi(server, '/api/groups/assign', {
      method: 'PATCH',
      body: { repositoryId: repos.infra.id, groupId: null },
    });
    expect((await repositories()).infra.groupId).toBeNull();

    await callApi(server, '/api/groups/assign', {
      method: 'PATCH',
      body: { repositoryId: repos.infra.id, groupId },
    });
  });

  it('renames a group', async () => {
    const { status, body } = await callApi(server, `/api/groups/${groupId}`, {
      method: 'PATCH',
      body: { name: 'Infra & Ops' },
    });
    expect(status).toBe(200);
    expect(body.group.name).toBe('Infra & Ops');
    expect((await repositories()).infra.groupName).toBe('Infra & Ops');
  });

  it('rejects an unknown group id', async () => {
    const { status, body } = await callApi(server, '/api/groups/does-not-exist', {
      method: 'PATCH',
      body: { name: 'Nope' },
    });
    expect(status).toBe(404);
    expect(body.error.code).toBe('GROUP_NOT_FOUND');
  });

  it('deleting a group moves its repositories to Ungrouped and deletes no files', async () => {
    const infraPath = path.join(ws, 'infra');
    const filesBefore = await fs.readdir(infraPath);

    const { status, body } = await callApi(server, `/api/groups/${groupId}`, {
      method: 'DELETE',
    });
    expect(status).toBe(200);
    expect(body.released).toBe(1);

    const after = await repositories();
    expect(after.infra).toBeDefined();
    expect(after.infra.groupId).toBeNull();
    expect(await fs.readdir(infraPath)).toEqual(filesBefore);
  });
});

describe('branches', () => {
  it('lists local and remote branches without duplicate entries', async () => {
    const repos = await repositories();
    const { body } = await callApi(server, `/api/repositories/${repos.infra.id}/branches`);

    expect(body.branches.local.map((b: any) => b.name)).toEqual(['main']);
    expect(body.branches.remote.map((b: any) => b.name).sort()).toEqual([
      'origin/deploy/staging',
      'origin/main',
    ]);
    // No refs/remotes/origin/HEAD alias leaking through.
    expect(body.branches.remote.some((b: any) => b.name.endsWith('/HEAD'))).toBe(false);

    const staging = body.branches.remote.find((b: any) => b.name === 'origin/deploy/staging');
    expect(staging.remoteOnlyLocalName).toBe('deploy/staging');
    const remoteMain = body.branches.remote.find((b: any) => b.name === 'origin/main');
    expect(remoteMain.remoteOnlyLocalName).toBeUndefined();
  });

  it('switches to a local branch on a clean repository', async () => {
    const repos = await repositories();
    const backend = repos['services/backend'];
    await git(sandbox, backend.absolutePath, ['branch', 'release']);

    const { status, body } = await callApi(
      server,
      `/api/repositories/${backend.id}/branches/switch`,
      { method: 'POST', body: { branch: 'release', kind: 'local' } },
    );

    expect(status).toBe(200);
    expect(body.outcome).toBe('switched');
    expect(body.head).toMatchObject({ kind: 'branch', branch: 'release' });

    // The list reflects the new state immediately after the switch.
    expect((await repositories())['services/backend'].head.branch).toBe('release');
  });

  it('creates a local tracking branch for a remote-only branch', async () => {
    const repos = await repositories();
    const { status, body } = await callApi(
      server,
      `/api/repositories/${repos.infra.id}/branches/switch`,
      { method: 'POST', body: { branch: 'origin/deploy/staging', kind: 'remote' } },
    );

    expect(status).toBe(200);
    expect(body.outcome).toBe('switched');
    expect(body.createdTrackingBranch).toBe('deploy/staging');
    expect(body.head).toMatchObject({ kind: 'branch', branch: 'deploy/staging' });

    const local = body.branches.local.find((b: any) => b.name === 'deploy/staging');
    expect(local.upstream).toBe('origin/deploy/staging');
  });

  it('rejects a branch that does not exist', async () => {
    const repos = await repositories();
    const { status, body } = await callApi(
      server,
      `/api/repositories/${repos.infra.id}/branches/switch`,
      { method: 'POST', body: { branch: 'no-such-branch', kind: 'local' } },
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe('BRANCH_NOT_FOUND');
  });

  it('rejects an unknown repository id', async () => {
    const { status, body } = await callApi(
      server,
      '/api/repositories/deadbeefdeadbeef/branches',
    );
    expect(status).toBe(404);
    expect(body.error.code).toBe('REPOSITORY_NOT_FOUND');
  });
});

describe('dirty working tree safety', () => {
  it('asks for confirmation instead of switching', async () => {
    const repos = await repositories();
    const { status, body } = await callApi(
      server,
      `/api/repositories/${repos.frontend.id}/branches/switch`,
      { method: 'POST', body: { branch: 'feature/x', kind: 'local' } },
    );

    expect(status).toBe(200);
    expect(body.outcome).toBe('needs-confirmation');
    expect(body.status.clean).toBe(false);

    // Nothing happened: still on main, still dirty.
    const after = await repositories();
    expect(after.frontend.head.branch).toBe('main');
    expect(after.frontend.status.clean).toBe(false);
  });

  it('preserves the working tree byte-for-byte when git refuses', async () => {
    const repos = await repositories();
    const readme = path.join(ws, 'frontend', 'README.md');
    const before = await readFileText(readme);

    const { status, body } = await callApi(
      server,
      `/api/repositories/${repos.frontend.id}/branches/switch`,
      { method: 'POST', body: { branch: 'feature/x', kind: 'local', confirmDirty: true } },
    );

    // Git refuses because the local change would be overwritten.
    expect(status).toBe(409);
    expect(body.error.code).toBe('GIT_REFUSED');
    // Git's own words are passed through, not paraphrased.
    expect(body.error.detail).toMatch(/would be overwritten/i);

    expect(await readFileText(readme)).toBe(before);

    const after = await repositories();
    expect(after.frontend.head.branch).toBe('main');
    expect(after.frontend.status.clean).toBe(false);

    // And absolutely no stash was created behind the user's back.
    const stashes = await git(sandbox, path.join(ws, 'frontend'), ['stash', 'list']);
    expect(stashes).toBe('');
  });

  it('switches once the conflicting change is resolved by the user', async () => {
    const frontend = path.join(ws, 'frontend');
    // The user commits their own work — DevAtlas never would.
    await git(sandbox, frontend, ['add', '-A']);
    await git(sandbox, frontend, ['commit', '-qm', 'user commits their work']);

    const repos = await repositories();
    const { status, body } = await callApi(
      server,
      `/api/repositories/${repos.frontend.id}/branches/switch`,
      { method: 'POST', body: { branch: 'feature/x', kind: 'local' } },
    );
    expect(status).toBe(200);
    expect(body.outcome).toBe('switched');
  });
});

describe('request validation and security', () => {
  it('rejects a state-changing request with no Origin header', async () => {
    const { status, body } = await callApi(server, '/api/workspace', {
      method: 'PATCH',
      body: { name: 'hacked' },
      origin: null,
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('rejects a cross-origin request', async () => {
    const { status } = await callApi(server, '/api/workspace', {
      method: 'PATCH',
      body: { name: 'hacked' },
      origin: 'http://evil.example',
    });
    expect(status).toBe(403);
  });

  it('rejects a request with a missing or wrong CSRF token', async () => {
    for (const csrf of [null, 'wrong-token']) {
      const { status } = await callApi(server, '/api/workspace', {
        method: 'PATCH',
        body: { name: 'hacked' },
        csrf,
      });
      expect(status).toBe(403);
    }
  });

  it('rejects a non-loopback Host header, defeating DNS rebinding', async () => {
    // A rebinding attack resolves the attacker's domain to 127.0.0.1, so the
    // request arrives here with *their* hostname in Host.
    const { status, body } = await rawRequest(server, '/api/workspace', 'attacker.example');
    expect(status).toBe(403);
    expect(body).toMatch(/localhost/i);
  });

  it('still accepts a loopback Host header', async () => {
    const { status } = await rawRequest(server, '/api/workspace', `localhost:${server.port}`);
    expect(status).toBe(200);
  });

  it('left the workspace name untouched through all of that', async () => {
    const { body } = await callApi(server, '/api/workspace');
    expect(body.workspace.name).toBe('Acme Platform');
  });

  it('rejects a malformed body', async () => {
    const response = await fetch(`${server.url}/api/groups`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: server.url,
        'x-devatlas-csrf': server.csrf,
      },
      body: 'not json',
    });
    expect(response.status).toBe(400);
  });

  it('exposes no endpoint that accepts a filesystem path', async () => {
    // The only repository-addressing mechanism is an opaque id.
    for (const attempt of ['/api/repositories/..%2F..%2Fetc', '/api/repositories/%2Fetc%2Fpasswd']) {
      const { status } = await callApi(server, `${attempt}/branches`);
      expect([400, 404]).toContain(status);
    }
  });
});

describe('unavailable repositories', () => {
  it('keeps metadata and reports the problem rather than crashing', async () => {
    const doomed = path.join(ws, 'temporary');
    await makeRepo(sandbox, doomed);
    await callApi(server, '/api/repositories/refresh', { method: 'POST' });

    const { body: created } = await callApi(server, '/api/groups', {
      method: 'POST',
      body: { name: 'Transient' },
    });
    const repoId = (await repositories()).temporary.id;
    await callApi(server, '/api/groups/assign', {
      method: 'PATCH',
      body: { repositoryId: repoId, groupId: created.group.id },
    });

    await fs.rm(doomed, { recursive: true, force: true });
    await callApi(server, '/api/repositories/refresh', { method: 'POST' });

    const after = await repositories();
    expect(after.temporary).toBeDefined();
    expect(after.temporary.available).toBe(false);
    expect(after.temporary.problem).toBe('missing');

    // The group assignment survived, ready for the repository to return.
    const data = JSON.parse(await readFileText(dataPath(ws)));
    const group = data.groups.find((g: any) => g.id === created.group.id);
    expect(group.repositoryIds).toContain(repoId);
  });
});
