import { mkdirSync, existsSync } from 'fs';
import path from 'path';

import * as schema from '@db/schema';
import { PGlite } from '@electric-sql/pglite';
import { pgDump } from '@electric-sql/pglite-tools/pg_dump';
import { citext } from '@electric-sql/pglite/contrib/citext';
// PostgreSQL Database extensions
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import logger from '@main/logger';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { app } from 'electron';

import { seedDatabase } from './seed';

const DB_NAME = 'nora.pglite.db';
export const DB_PATH = app.getPath('userData') + '/' + DB_NAME;

/**
 * 解析 drizzle migrations 目录 — 找到第一个存在 meta/_journal.json 的候选路径。
 *
 * 优先级:
 *   生产  → process.resourcesPath/drizzle(extraResources 复制)
 *   开发  → app.getAppPath()/resources/drizzle(项目根)
 *   fallback → app 路径上级 resources(未打包 --dir 模式)、out 内、cwd、旧 import.meta 解析
 *
 * 注意:electron-vite 无论 dev/build,main 进程都从 out/main 运行编译产物,
 * 所以不能依赖 import.meta.dirname 反推项目根。
 */
function findMigrationsFolder(): string {
  const candidates = [
    ...(app.isPackaged ? [path.join(process.resourcesPath, 'drizzle')] : []),
    path.join(app.getAppPath(), 'resources', 'drizzle'),
    path.join(app.getAppPath(), '..', 'resources', 'drizzle'),
    path.join(app.getAppPath(), 'out', 'resources', 'drizzle'),
    path.resolve(process.cwd(), 'resources', 'drizzle'),
    path.resolve(import.meta.dirname, '../../resources/drizzle'),
  ];
  const seen = new Set<string>();
  const unique = candidates.filter((c) => (seen.has(c) ? false : (seen.add(c), true)));
  for (const c of unique) {
    try {
      if (existsSync(path.join(c, 'meta', '_journal.json'))) return c;
    } catch { /* ignore */ }
  }
  return unique[0] || path.join(app.getAppPath(), 'resources', 'drizzle');
}

const migrationsFolder = findMigrationsFolder();
logger.debug(`[db] isPackaged=${app.isPackaged} resourcesPath=${process.resourcesPath}`);
logger.debug(`Migrations folder: ${migrationsFolder}`);

mkdirSync(DB_PATH, { recursive: true });

// debug: 1 会把每条 SQL(含巨型 lateral join)全量打印 — 默认关闭,需要时 PGLITE_DEBUG=1 开启
const pgliteInstance = await PGlite.create(DB_PATH, {
  debug: process.env.PGLITE_DEBUG === '1' ? 1 : 0,
  extensions: { pg_trgm, citext },
});
pgliteInstance.onNotification((notification) => {
  logger.info('Database notification:', { notification });
});

// Initialize extension types
await pgliteInstance.exec('CREATE EXTENSION IF NOT EXISTS citext;');
await pgliteInstance.exec('CREATE EXTENSION IF NOT EXISTS pg_trgm;');

// Initialize Drizzle ORM
export const db = drizzle(pgliteInstance, {
  schema
});

export const closeDatabaseInstance = async () => {
  if (pgliteInstance.closed) return logger.debug('Database instance already closed.');

  await pgliteInstance.close();
  logger.debug('Database instance closed.');
};

await migrate(db, { migrationsFolder });
await seedDatabase();

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

export const exportDatabase = async () => {
  const initialSearchPath = (
    await pgliteInstance.query<{ search_path: string }>('SHOW SEARCH_PATH;')
  ).rows[0].search_path;

  logger.debug('Current database search_path:', { initialSearchPath });

  const clonedPg = await pgliteInstance.clone();

  const dump = await pgDump({ pg: clonedPg as PGlite });

  const [, dumpTextPromise] = await Promise.allSettled([clonedPg.close(), dump.text()]);

  const sql = dumpTextPromise.status === 'fulfilled' ? dumpTextPromise.value : '';
  return sql;
};

/**
 * Imports a database by executing the provided SQL query after resetting the database file.
 *
 * This function closes the current database instance, deletes the database file, reinitializes the
 * database, and executes the given SQL query. Useful for restoring or reinitializing the database
 * from a dump or migration.
 *
 * @param query - The SQL query or migration to execute after reset.
 * @returns A promise that resolves to true when the import is successful.
 */
export const importDatabase = async (query: string) => {
  await pgliteInstance.exec(query);

  logger.info('Database imported successfully.');
  return true;
};
