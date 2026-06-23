import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Registering orca as an MCP server in a (same-host) Hermes instance: write the orca bearer token
 *  into Hermes's `.env` and add an `orca` entry under `mcp_servers:` in its `config.yaml`. We edit
 *  both as text (so comments/formatting survive) — this mirrors exactly what `hermes mcp add` does
 *  internally, but deterministically and non-interactively (that CLI is built for a human at a TTY). */

const MCP_NAME = 'orca';
const ENV_KEY = 'MCP_ORCA_API_KEY';

export interface HermesStatus {
  home: string;
  exists: boolean;
  /** `orca` is present under `mcp_servers:` in config.yaml. */
  registered: boolean;
  /** The orca server isn't disabled (`enabled: false`); absent key counts as enabled. */
  enabled: boolean;
}

export interface HermesInstallInput {
  home: string;        // Hermes home (contains config.yaml + .env), e.g. ~/.hermes
  url: string;         // orca base URL; the MCP endpoint `<url>/mcp` is derived from it
  token: string;       // orca bearer token (stored in .env, referenced via ${MCP_ORCA_API_KEY})
}

export interface HermesInstallResult {
  mcpUrl: string;
  registered: boolean;
  enabled: boolean;
  envWritten: boolean;
  backedUp: boolean;
}

/** The MCP endpoint for an orca base URL — append `/mcp` unless it's already there. */
export function mcpEndpoint(url: string): string {
  const base = url.trim().replace(/\/+$/, '');
  return base.endsWith('/mcp') ? base : `${base}/mcp`;
}

/** Parse whether `orca` is configured under `mcp_servers:` and whether it's enabled. Text-scanned so
 *  we never round-trip the whole document. `enabled` defaults to true unless an `enabled: false` line
 *  appears inside the orca block. */
export function orcaServerState(text: string): { registered: boolean; enabled: boolean } {
  const lines = text.split('\n');
  let inServers = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^mcp_servers:\s*$/.test(line)) { inServers = true; continue; }
    if (!inServers) continue;
    const indent = (line.match(/^(\s*)/)?.[1] ?? '').length;
    if (line.trim() !== '' && indent === 0) break; // left the mcp_servers block
    if (/^\s{2}orca:\s*$/.test(line)) {
      // Scan the orca block (lines indented deeper than the key) for `enabled: false`.
      let enabled = true;
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j] ?? '';
        const ind = (l.match(/^(\s*)/)?.[1] ?? '').length;
        if (l.trim() !== '' && ind <= 2) break; // end of the orca block
        if (/^\s*enabled:\s*false\s*$/.test(l)) enabled = false;
      }
      return { registered: true, enabled };
    }
  }
  return { registered: false, enabled: false };
}

/** The orca server block (2-space indent under `mcp_servers:`). */
function renderOrcaServer(mcpUrl: string): string[] {
  return [
    `  ${MCP_NAME}:`,
    `    url: "${mcpUrl}"`,
    '    headers:',
    `      Authorization: "Bearer \${${ENV_KEY}}"`,
    '    enabled: true',
  ];
}

/** Insert or replace the `orca` server under `mcp_servers:`, preserving the rest of the file. Creates
 *  the `mcp_servers:` section at end-of-file if it's missing. */
export function upsertOrcaServer(text: string, mcpUrl: string): string {
  const block = renderOrcaServer(mcpUrl);
  const lines = text.split('\n');
  const serversIdx = lines.findIndex((l) => /^mcp_servers:\s*$/.test(l));

  if (serversIdx === -1) {
    // No section yet — append one. Keep exactly one blank separator from prior content.
    const body = text.replace(/\n+$/, '');
    return `${body ? `${body}\n` : ''}mcp_servers:\n${block.join('\n')}\n`;
  }

  // Find an existing `  orca:` within the section.
  let orcaIdx = -1;
  for (let i = serversIdx + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const indent = (line.match(/^(\s*)/)?.[1] ?? '').length;
    if (line.trim() !== '' && indent === 0) break; // left the section
    if (/^\s{2}orca:\s*$/.test(line)) { orcaIdx = i; break; }
  }

  if (orcaIdx === -1) {
    lines.splice(serversIdx + 1, 0, ...block); // insert as the first server
    return lines.join('\n');
  }

  // Replace the existing orca block (its key line + all deeper-indented lines).
  let end = orcaIdx + 1;
  while (end < lines.length) {
    const l = lines[end] ?? '';
    const ind = (l.match(/^(\s*)/)?.[1] ?? '').length;
    if (l.trim() !== '' && ind <= 2) break;
    end++;
  }
  lines.splice(orcaIdx, end - orcaIdx, ...block);
  return lines.join('\n');
}

/** Insert or replace a `KEY=value` line in a .env file, preserving the rest. */
export function upsertEnvVar(text: string, key: string, value: string): string {
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (idx !== -1) { lines[idx] = `${key}=${value}`; return lines.join('\n'); }
  const body = text.replace(/\n+$/, '');
  return `${body ? `${body}\n` : ''}${key}=${value}\n`;
}

export function hermesStatus(home: string): HermesStatus {
  const cfgPath = join(home, 'config.yaml');
  let registered = false; let enabled = false;
  try {
    if (existsSync(cfgPath)) ({ registered, enabled } = orcaServerState(readFileSync(cfgPath, 'utf8')));
  } catch { /* ignore unreadable config */ }
  return { home, exists: existsSync(home) && safeIsDir(home), registered, enabled };
}

export function installOrcaMcp(input: HermesInstallInput): HermesInstallResult {
  const { home, url, token } = input;
  if (!existsSync(home) || !safeIsDir(home)) throw new Error('hermes home not found');
  const cfgPath = join(home, 'config.yaml');
  if (!existsSync(cfgPath)) throw new Error('hermes config.yaml not found');

  const mcpUrl = mcpEndpoint(url);

  // 1) Token → .env (mode 0600; an existing file keeps its mode, a new one is locked down).
  const envPath = join(home, '.env');
  const envText = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  writeFileSync(envPath, upsertEnvVar(envText, ENV_KEY, token), { mode: 0o600 });

  // 2) orca server → config.yaml (back up the original first).
  const original = readFileSync(cfgPath, 'utf8');
  writeFileSync(`${cfgPath}.orca-bak`, original, 'utf8');
  writeFileSync(cfgPath, upsertOrcaServer(original, mcpUrl), 'utf8');

  const state = orcaServerState(readFileSync(cfgPath, 'utf8'));
  return { mcpUrl, registered: state.registered, enabled: state.enabled, envWritten: true, backedUp: true };
}

function safeIsDir(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}
