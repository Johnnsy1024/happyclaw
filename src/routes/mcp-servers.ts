// MCP Servers management routes

import { Hono } from 'hono';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { Variables } from '../web-context.js';
import type { AuthUser } from '../types.js';
import { authMiddleware } from '../middleware/auth.js';
import { DATA_DIR } from '../config.js';
import { checkMcpServerLimit } from '../billing.js';

// --- Types ---

interface McpServerEntry {
  // stdio type
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // http/sse type
  type?: 'http' | 'sse';
  url?: string;
  headers?: Record<string, string>;
  // metadata
  enabled: boolean;
  syncedFromHost?: boolean;
  description?: string;
  addedAt: string;
}

interface McpServersFile {
  servers: Record<string, McpServerEntry>;
}

interface HostSyncManifest {
  syncedServers: string[];
  lastSyncAt: string;
}

interface HostMcpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  type?: 'http' | 'sse';
  url?: string;
  headers?: Record<string, string>;
}

// --- Utility Functions ---

function getUserMcpServersDir(userId: string): string {
  return path.join(DATA_DIR, 'mcp-servers', userId);
}

function getServersFilePath(userId: string): string {
  return path.join(getUserMcpServersDir(userId), 'servers.json');
}

function getHostSyncManifestPath(userId: string): string {
  return path.join(getUserMcpServersDir(userId), '.host-sync.json');
}

function validateServerId(id: string): boolean {
  return /^[\w\-]+$/.test(id) && id !== 'happyclaw';
}

async function readMcpServersFile(userId: string): Promise<McpServersFile> {
  try {
    const data = await fs.readFile(getServersFilePath(userId), 'utf-8');
    return JSON.parse(data);
  } catch {
    return { servers: {} };
  }
}

async function writeMcpServersFile(
  userId: string,
  data: McpServersFile,
): Promise<void> {
  const dir = getUserMcpServersDir(userId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(getServersFilePath(userId), JSON.stringify(data, null, 2));
}

async function readHostSyncManifest(userId: string): Promise<HostSyncManifest> {
  try {
    const data = await fs.readFile(getHostSyncManifestPath(userId), 'utf-8');
    return JSON.parse(data);
  } catch {
    return { syncedServers: [], lastSyncAt: '' };
  }
}

async function writeHostSyncManifest(
  userId: string,
  manifest: HostSyncManifest,
): Promise<void> {
  const dir = getUserMcpServersDir(userId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    getHostSyncManifestPath(userId),
    JSON.stringify(manifest, null, 2),
  );
}

function stripTomlComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const escaped = i > 0 && line[i - 1] === '\\';
    if (char === "'" && !inDouble && !escaped) inSingle = !inSingle;
    if (char === '"' && !inSingle && !escaped) inDouble = !inDouble;
    if (char === '#' && !inSingle && !inDouble) {
      return line.slice(0, i).trim();
    }
  }
  return line.trim();
}

function parseTomlString(value: string): string | null {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      return JSON.parse(trimmed.replace(/^'/, '"').replace(/'$/, '"'));
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return null;
}

function splitTomlTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const escaped = i > 0 && input[i - 1] === '\\';
    if (char === "'" && !inDouble && !escaped) inSingle = !inSingle;
    if (char === '"' && !inSingle && !escaped) inDouble = !inDouble;
    if (!inSingle && !inDouble) {
      if (char === '[' || char === '{') depth++;
      if (char === ']' || char === '}') depth--;
      if (char === separator && depth === 0) {
        parts.push(current.trim());
        current = '';
        continue;
      }
    }
    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseTomlStringArray(value: string): string[] | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  const parts = splitTomlTopLevel(inner, ',');
  const result: string[] = [];
  for (const part of parts) {
    const parsed = parseTomlString(part);
    if (parsed === null) return null;
    result.push(parsed);
  }
  return result;
}

function parseTomlStringRecord(value: string): Record<string, string> | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return {};
  const result: Record<string, string> = {};
  for (const entry of splitTomlTopLevel(inner, ',')) {
    const eqIndex = entry.indexOf('=');
    if (eqIndex < 0) return null;
    const rawKey = entry.slice(0, eqIndex).trim();
    const rawValue = entry.slice(eqIndex + 1).trim();
    const key = parseTomlString(rawKey);
    const parsedValue = parseTomlString(rawValue);
    if (!key || parsedValue === null) return null;
    result[key] = parsedValue;
  }
  return result;
}

function parseCodexMcpServersToml(
  content: string,
): Record<string, HostMcpServerConfig> {
  const servers: Record<string, HostMcpServerConfig> = {};
  let currentServerId: string | null = null;

  for (const rawLine of content.split('\n')) {
    const line = stripTomlComment(rawLine);
    if (!line) continue;

    const sectionMatch = line.match(/^\[mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\]$/);
    if (sectionMatch) {
      currentServerId = sectionMatch[1] || sectionMatch[2] || null;
      if (currentServerId && !servers[currentServerId]) {
        servers[currentServerId] = {};
      }
      continue;
    }

    if (line.startsWith('[')) {
      currentServerId = null;
      continue;
    }
    if (!currentServerId) continue;

    const eqIndex = line.indexOf('=');
    if (eqIndex < 0) continue;
    const key = line.slice(0, eqIndex).trim();
    const rawValue = line.slice(eqIndex + 1).trim();
    const current = servers[currentServerId];

    switch (key) {
      case 'command': {
        const parsed = parseTomlString(rawValue);
        if (parsed) current.command = parsed;
        break;
      }
      case 'url': {
        const parsed = parseTomlString(rawValue);
        if (parsed) {
          current.url = parsed;
          current.type = 'http';
        }
        break;
      }
      case 'args': {
        const parsed = parseTomlStringArray(rawValue);
        if (parsed) current.args = parsed;
        break;
      }
      case 'env': {
        const parsed = parseTomlStringRecord(rawValue);
        if (parsed) current.env = parsed;
        break;
      }
      case 'http_headers': {
        const parsed = parseTomlStringRecord(rawValue);
        if (parsed) current.headers = parsed;
        break;
      }
      case 'env_http_headers': {
        const parsed = parseTomlStringRecord(rawValue);
        if (parsed) {
          current.headers = Object.fromEntries(
            Object.entries(parsed)
              .map(([headerName, envVar]) => [headerName, process.env[envVar] || ''])
              .filter(([, headerValue]) => !!headerValue),
          );
        }
        break;
      }
      case 'bearer_token_env_var': {
        const parsed = parseTomlString(rawValue);
        const token = parsed ? process.env[parsed] : '';
        if (token) {
          current.headers = {
            ...(current.headers || {}),
            Authorization: `Bearer ${token}`,
          };
        }
        break;
      }
      case 'type': {
        const parsed = parseTomlString(rawValue);
        if (parsed === 'http' || parsed === 'sse') current.type = parsed;
        break;
      }
      default:
        break;
    }
  }

  return Object.fromEntries(
    Object.entries(servers).filter(([, server]) => !!server.command || !!server.url),
  );
}

async function readCodexHostMcpServers(): Promise<Record<string, HostMcpServerConfig>> {
  const configPath = path.join(os.homedir(), '.codex', 'config.toml');
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    return parseCodexMcpServersToml(raw);
  } catch {
    return {};
  }
}

// --- Routes ---

const mcpServersRoutes = new Hono<{ Variables: Variables }>();

// GET / — list all MCP servers for the current user
mcpServersRoutes.get('/', authMiddleware, async (c) => {
  const authUser = c.get('user') as AuthUser;
  const file = await readMcpServersFile(authUser.id);
  const servers = Object.entries(file.servers).map(([id, entry]) => ({
    id,
    ...entry,
  }));
  return c.json({ servers });
});

// POST / — add a new MCP server
mcpServersRoutes.post('/', authMiddleware, async (c) => {
  const authUser = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => ({}));

  const { id, command, args, env, description, type, url, headers } = body as {
    id?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    description?: string;
    type?: string;
    url?: string;
    headers?: Record<string, string>;
  };

  if (!id || typeof id !== 'string') {
    return c.json({ error: 'id is required and must be a string' }, 400);
  }
  if (!validateServerId(id)) {
    return c.json(
      {
        error:
          'Invalid server ID: must match /^[\\w\\-]+$/ and cannot be "happyclaw"',
      },
      400,
    );
  }

  // Billing: check MCP server limit
  const existingServers = await readMcpServersFile(authUser.id);
  const currentCount = Object.keys(existingServers.servers).length;
  if (!existingServers.servers[id]) {
    // Only check limit for new servers, not updates
    const limit = checkMcpServerLimit(authUser.id, authUser.role, currentCount);
    if (!limit.allowed) {
      return c.json({ error: limit.reason }, 403);
    }
  }

  const isHttpType = type === 'http' || type === 'sse';

  if (isHttpType) {
    if (!url || typeof url !== 'string') {
      return c.json({ error: 'url is required for http/sse type' }, 400);
    }
    if (
      headers !== undefined &&
      (typeof headers !== 'object' ||
        headers === null ||
        Array.isArray(headers))
    ) {
      return c.json({ error: 'headers must be a plain object' }, 400);
    }
  } else {
    if (!command || typeof command !== 'string') {
      return c.json({ error: 'command is required and must be a string' }, 400);
    }
    if (args !== undefined && !Array.isArray(args)) {
      return c.json({ error: 'args must be an array of strings' }, 400);
    }
    if (
      env !== undefined &&
      (typeof env !== 'object' || env === null || Array.isArray(env))
    ) {
      return c.json({ error: 'env must be a plain object' }, 400);
    }
  }

  const file = await readMcpServersFile(authUser.id);
  if (file.servers[id]) {
    return c.json({ error: `Server "${id}" already exists` }, 409);
  }

  const entry: McpServerEntry = {
    enabled: true,
    ...(description ? { description } : {}),
    addedAt: new Date().toISOString(),
  };

  if (isHttpType) {
    entry.type = type as 'http' | 'sse';
    entry.url = url;
    if (headers && Object.keys(headers).length > 0) entry.headers = headers;
  } else {
    entry.command = command;
    if (args && args.length > 0) entry.args = args;
    if (env && Object.keys(env).length > 0) entry.env = env;
  }

  file.servers[id] = entry;

  await writeMcpServersFile(authUser.id, file);
  return c.json({ success: true, server: { id, ...file.servers[id] } });
});

// PATCH /:id — update config / enable / disable
mcpServersRoutes.patch('/:id', authMiddleware, async (c) => {
  const authUser = c.get('user') as AuthUser;
  const id = c.req.param('id');

  if (!validateServerId(id)) {
    return c.json({ error: 'Invalid server ID' }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const { command, args, env, enabled, description, url, headers } = body as {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    enabled?: boolean;
    description?: string;
    url?: string;
    headers?: Record<string, string>;
  };

  const file = await readMcpServersFile(authUser.id);
  const entry = file.servers[id];
  if (!entry) {
    return c.json({ error: 'Server not found' }, 404);
  }

  // stdio fields
  if (command !== undefined) {
    if (typeof command !== 'string' || !command) {
      return c.json({ error: 'command must be a non-empty string' }, 400);
    }
    entry.command = command;
  }
  if (args !== undefined) {
    if (!Array.isArray(args)) {
      return c.json({ error: 'args must be an array of strings' }, 400);
    }
    entry.args = args;
  }
  if (env !== undefined) {
    if (typeof env !== 'object' || env === null || Array.isArray(env)) {
      return c.json({ error: 'env must be a plain object' }, 400);
    }
    entry.env = env;
  }
  // http/sse fields
  if (url !== undefined) {
    if (typeof url !== 'string' || !url) {
      return c.json({ error: 'url must be a non-empty string' }, 400);
    }
    entry.url = url;
  }
  if (headers !== undefined) {
    if (
      typeof headers !== 'object' ||
      headers === null ||
      Array.isArray(headers)
    ) {
      return c.json({ error: 'headers must be a plain object' }, 400);
    }
    entry.headers = headers;
  }
  // common fields
  if (enabled !== undefined) {
    if (typeof enabled !== 'boolean') {
      return c.json({ error: 'enabled must be a boolean' }, 400);
    }
    entry.enabled = enabled;
  }
  if (description !== undefined) {
    entry.description =
      typeof description === 'string' ? description : undefined;
  }

  await writeMcpServersFile(authUser.id, file);
  return c.json({ success: true, server: { id, ...entry } });
});

// DELETE /:id — delete a server
mcpServersRoutes.delete('/:id', authMiddleware, async (c) => {
  const authUser = c.get('user') as AuthUser;
  const id = c.req.param('id');

  if (!validateServerId(id)) {
    return c.json({ error: 'Invalid server ID' }, 400);
  }

  const file = await readMcpServersFile(authUser.id);
  if (!file.servers[id]) {
    return c.json({ error: 'Server not found' }, 404);
  }

  delete file.servers[id];
  await writeMcpServersFile(authUser.id, file);
  return c.json({ success: true });
});

// POST /sync-host — sync from host MCP configs (admin only)
// Reads from ~/.claude/settings.json, ~/.claude.json, and ~/.codex/config.toml
mcpServersRoutes.post('/sync-host', authMiddleware, async (c) => {
  const authUser = c.get('user') as AuthUser;
  if (authUser.role !== 'admin') {
    return c.json({ error: 'Only admin can sync host MCP servers' }, 403);
  }

  // Read MCP servers from both config file locations
  let hostServers: Record<string, any> = {};

  // Source 1: ~/.claude/settings.json
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  try {
    const raw = await fs.readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(raw);
    if (settings.mcpServers) {
      hostServers = { ...hostServers, ...settings.mcpServers };
    }
  } catch {
    // File may not exist, that's OK
  }

  // Source 2: ~/.claude.json (global Claude Code config, stores per-user MCP settings)
  // When both files define the same server ID, ~/.claude.json wins because it's
  // the primary user-facing config file where Claude Code persists MCP settings.
  const globalConfigPath = path.join(os.homedir(), '.claude.json');
  try {
    const raw = await fs.readFile(globalConfigPath, 'utf-8');
    const config = JSON.parse(raw);
    if (config.mcpServers) {
      hostServers = { ...hostServers, ...config.mcpServers };
    }
  } catch {
    // File may not exist, that's OK
  }

  // Source 3: ~/.codex/config.toml (Codex CLI MCP settings)
  // When both Claude and Codex configs define the same server ID, Codex wins
  // because it is the newer host-level source for Codex runtime integrations.
  const codexServers = await readCodexHostMcpServers();
  if (Object.keys(codexServers).length > 0) {
    hostServers = { ...hostServers, ...codexServers };
  }

  if (Object.keys(hostServers).length === 0) {
    return c.json({
      added: 0,
      updated: 0,
      deleted: 0,
      skipped: 0,
      message: 'No MCP servers found in host Claude/Codex config files',
    });
  }

  const file = await readMcpServersFile(authUser.id);
  const manifest = await readHostSyncManifest(authUser.id);
  const previouslySynced = new Set(manifest.syncedServers);
  const hostServerIds = new Set(Object.keys(hostServers));

  const stats = { added: 0, updated: 0, deleted: 0, skipped: 0 };
  const newSyncedList: string[] = [];

  // Add/update from host
  for (const [id, hostEntry] of Object.entries(hostServers) as [
    string,
    any,
  ][]) {
    if (!validateServerId(id)) {
      stats.skipped++;
      continue;
    }

    const existsInUser = !!file.servers[id];
    const wasSynced = previouslySynced.has(id);

    // Skip manually added entries
    if (existsInUser && !wasSynced) {
      stats.skipped++;
      continue;
    }

    const isHttpType = hostEntry.type === 'http' || hostEntry.type === 'sse';

    const entry: McpServerEntry = {
      enabled: true,
      syncedFromHost: true,
      addedAt: existsInUser
        ? file.servers[id].addedAt || new Date().toISOString()
        : new Date().toISOString(),
    };

    if (isHttpType) {
      entry.type = hostEntry.type;
      entry.url = hostEntry.url || '';
      if (hostEntry.headers) entry.headers = hostEntry.headers;
    } else {
      entry.command = hostEntry.command || '';
      if (hostEntry.args) entry.args = hostEntry.args;
      if (hostEntry.env) entry.env = hostEntry.env;
    }

    if (existsInUser) {
      stats.updated++;
    } else {
      stats.added++;
    }

    file.servers[id] = entry;
    newSyncedList.push(id);
  }

  // Delete servers that were synced before but no longer on host
  for (const id of previouslySynced) {
    if (!hostServerIds.has(id) && file.servers[id]?.syncedFromHost) {
      delete file.servers[id];
      stats.deleted++;
    }
  }

  await writeMcpServersFile(authUser.id, file);
  await writeHostSyncManifest(authUser.id, {
    syncedServers: newSyncedList,
    lastSyncAt: new Date().toISOString(),
  });

  return c.json(stats);
});

export { getUserMcpServersDir, readMcpServersFile };
export default mcpServersRoutes;
