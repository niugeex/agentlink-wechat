import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export function resolveDataDir(dataDir?: string): string {
  return dataDir ?? join(homedir(), '.agentlink', 'wechat');
}

export function resolveLogPath(date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  return join(tmpdir(), `agentlink-wechat-${day}.log`);
}
