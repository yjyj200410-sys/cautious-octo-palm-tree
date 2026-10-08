export interface SavedNcmAccount {
  userId: number;
  nickname: string;
  avatarUrl: string;
}

export interface NcmAccountSnapshot {
  accounts: SavedNcmAccount[];
  activeUserId: number | null;
}
