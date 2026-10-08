import { getAllSongListeningData } from '@main/db/queries/listens';

export const getListeningData = async (songIds: number[]) => {
  // 过滤 NCM 负 ID（不存于本地数据库）
  const validIds = songIds.map((id) => Number(id)).filter((id) => !isNaN(id) && id > 0);
  if (validIds.length === 0) return [];

  const listeningData = await getAllSongListeningData(validIds);
  return listeningData;
};
