import type { NcmSong } from '../ncm/types';

export const normalizeLibraryText = (value: string) =>
  value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();

/** Search within this collection; each space-separated term may match a different field. */
export function matchesLibrarySearch(song: NcmSong, query: string): boolean {
  const terms = normalizeLibraryText(query).split(' ').filter(Boolean);
  if (!terms.length) return true;
  const fields = [
    song.title,
    ...song.artists.map((artist) => artist.name),
    song.album?.name ?? ''
  ].map(normalizeLibraryText);
  return terms.every((term) => fields.some((field) => field.includes(term)));
}
