import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';

import { db } from '../db/db';
import { songs, artists, artistsSongs, albums, albumsSongs } from '../db/schema';

/** Transfer IDs only; the renderer reads metadata for visible rows in small batches. */
export async function searchSongIds(keyword: string): Promise<number[]> {
  const term = keyword.trim().slice(0, 256);
  if (!term) return [];
  const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
  const matches = await db
    .select({ id: songs.id })
    .from(songs)
    .where(
      and(
        eq(songs.isBlacklisted, false),
        or(
          ilike(songs.title, pattern),
          sql`exists(select 1 from ${artistsSongs} join ${artists} on ${artists.id} = ${artistsSongs.artistId} where ${artistsSongs.songId} = ${songs.id} and ${artists.name} ilike ${pattern})`,
          sql`exists(select 1 from ${albumsSongs} join ${albums} on ${albums.id} = ${albumsSongs.albumId} where ${albumsSongs.songId} = ${songs.id} and ${albums.title} ilike ${pattern})`
        )
      )
    )
    .orderBy(asc(songs.title), asc(songs.id));
  return matches.map((song) => song.id);
}
