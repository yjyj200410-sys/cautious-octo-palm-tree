/**
 * NCM 歌单封面更新 — 通过 IPC + Electron 原生文件对话框
 */
import { cookieManager } from '../api/ncm-client';

export async function updatePlaylistCover(
  playlistId: number,
  onSuccess: () => void,
  onError: (msg: string) => void,
): Promise<void> {
  try {
    const filePath: string | undefined = await window.api.songUpdates.getImgFileLocation();
    if (!filePath) return;

    const cookie = cookieManager.get();
    const result = await window.api.ncm.updateCover(playlistId, filePath, cookie) as { code?: number; msg?: string; message?: string };
    if ((result as any)?.body?.code === 200 || result.code === 200) {
      onSuccess();
    } else {
      onError((result as any)?.body?.msg || (result as any)?.body?.message || result.msg || result.message || '更新失败');
    }
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err));
  }
}
