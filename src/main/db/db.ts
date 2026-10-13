import { mkdirSync, existsSync } from 'fs';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import path from 'path';

import * as schema from '@db/schema';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
// PostgreSQL Database extensions
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import logger from '@main/logger';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { app } from 'electron';

import { IdleResource } from './idleResource';
import { seedDatabase } from './seed';

const DB_NAME = 'nora.pglite.db';
export const DB_PATH = app.getPath('userData') + '/' + DB_NAME;

/**
 * 解析 drizzle migrations 目录 — 找到第一个存在 meta/_journal.json 的候选路径。
 *
 * 优先级: 生产 → process.resourcesPath/drizzle(extraResources 复制) 开发 →
 * app.getAppPath()/resources/drizzle(项目根) fallback → app 路径上级 resources(未打包 --dir 模式)、out 内、cwd、旧
 * import.meta 解析
 *
 * 注意:electron-vite 无论 dev/build,main 进程都从 out/main 运行编译产物, 所以不能依赖 import.meta.dirname 反推项目根。
 */
function findMigrationsFolder(): string {
  const candidates = [
    ...(app.isPackaged ? [path.join(process.resourcesPath, 'drizzle')] : []),
    path.join(app.getAppPath(), 'resources', 'drizzle'),
    path.join(app.getAppPath(), '..', 'resources', 'drizzle'),
    path.join(app.getAppPath(), 'out', 'resources', 'drizzle'),
    path.resolve(process.cwd(), 'resources', 'drizzle'),
    path.resolve(import.meta.dirname, '../../resources/drizzle')
  ];
  const seen = new Set<string>();
  const unique = candidates.filter((c) => (seen.has(c) ? false : (seen.add(c), true)));
  for (const c of unique) {
    try {
      if (existsSync(path.join(c, 'meta', '_journal.json'))) return c;
    } catch {
      /* ignore */
    }
  }
  return unique[0] || path.join(app.getAppPath(), 'resources', 'drizzle');
}

const migrationsFolder = findMigrationsFolder();
logger.debug(`[db] isPackaged=${app.isPackaged} resourcesPath=${process.resourcesPath}`);
logger.debug(`Migrations folder: ${migrationsFolder}`);

mkdirSync(DB_PATH, { recursive: true });

function collectReleasedMemory() {
  setFlagsFromString('--expose-gc');
  try {
    (runInNewContext('gc') as () => void)();
  } finally {
    setFlagsFromString('--no-expose-gc');
  }
}

// Keep the existing durable database and IDs. Ordinary audio playback needs no
// live PostgreSQL instance: reopen on the next query, flush and release on idle.
const database = new IdleResource<PGlite>(
  async () => {
    const instance = await PGlite.create(DB_PATH, {
      debug: process.env.PGLITE_DEBUG === '1' ? 1 : 0,
      initialMemory: 128 * 1024 * 1024,
      startParams: [
        ...PGlite.defaultStartParams,
        '-c',
        'shared_buffers=16MB',
        '-c',
        'work_mem=2MB',
        '-c',
        'maintenance_work_mem=16MB'
      ],
      extensions: { pg_trgm, citext }
    });
    return instance;
  },
  (instance) => instance.close(),
  10_000,
  collectReleasedMemory,
  (error) => logger.error('Failed to release idle database', { error })
);

// Drizzle uses query() and transaction(); a lease covers the entire transaction,
// including rollback. No underlying instance can close while work is in flight.
const client = {
  query: (...args: Parameters<PGlite['query']>) =>
    database.with((instance) => instance.query(...args)),
  exec: (...args: Parameters<PGlite['exec']>) =>
    database.with((instance) => instance.exec(...args)),
  transaction: <T>(fn: Parameters<PGlite['transaction']>[0]) =>
    database.with((instance) => instance.transaction(fn)) as Promise<T>
} as unknown as PGlite;
export const db = drizzle({ client, schema });
export const closeDatabaseInstance = () => database.close();
await database.with((instance) =>
  instance.exec('CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS pg_trgm;')
);

await migrate(db, { migrationsFolder });
await seedDatabase();

// Release temporary first-run initdb allocations before presenting the UI.
collectReleasedMemory();

export const nukeDatabase = async () => {
  try {
    logger.debug('Performing complete database reset...');

    // Drop everything - public schema AND drizzle schema
    await db.execute('DROP SCHEMA IF EXISTS public CASCADE;');
    await db.execute('DROP SCHEMA IF EXISTS drizzle CASCADE;');

    // Recreate public schema
    await db.execute('CREATE SCHEMA public;');
    await db.execute('GRANT ALL ON SCHEMA public TO public;');

    logger.debug('Database completely reset');
  } catch (error) {
    logger.error('Failed to reset database:', { error });
    throw error;
  }
};
