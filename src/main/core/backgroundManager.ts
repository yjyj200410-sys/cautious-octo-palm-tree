/**
 * Background file management — select, list, delete custom backgrounds.
 */
import { app, dialog } from 'electron';
import { getMainWindow } from './windowRef';
import { maybeMakeLoopVideo } from './loop/loopDetector';

export async function selectCustomBackground() {
  const { filePaths } = await dialog.showOpenDialog(getMainWindow(), {
    title: '选择自定义背景',
    buttonLabel: '选择文件',
    filters: [
      { name: '图片 & 视频', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'mov', 'mkv'] },
    ],
    properties: ['openFile'],
  });
  const src = filePaths[0];
  if (!src) return undefined;

  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const bgDir = path.join(app.getPath('userData'), 'backgrounds');
    await fs.mkdir(bgDir, { recursive: true });
    const ext = path.extname(src);
    const name = path.basename(src, ext);
    const dest = path.join(bgDir, `${name}${ext}`);
    await fs.copyFile(src, dest);
    return dest;
  } catch {
    return src;
  }
}

export async function listBackgrounds() {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const bgDir = path.join(app.getPath('userData'), 'backgrounds');
    await fs.mkdir(bgDir, { recursive: true });
    const entries = await fs.readdir(bgDir, { withFileTypes: true });
    const videoExts = ['.mp4', '.webm', '.mov', '.mkv'];

    const result: { name: string; path: string; type: 'image' | 'video'; cover?: string }[] = [];
    for (const e of entries) {
      if (!e.isFile()) continue;
      // A `<video>_cover.jpg` is a recording THUMBNAIL, not a background — it must
      // not appear as its own entry.  It is instead attached to its video below.
      if (e.name.toLowerCase().endsWith('_cover.jpg')) continue;

      const ext = path.extname(e.name).toLowerCase();
      const isVideo = videoExts.includes(ext);
      const entry: { name: string; path: string; type: 'image' | 'video'; cover?: string } = {
        name: e.name,
        path: path.join(bgDir, e.name),
        type: isVideo ? 'video' : 'image',
      };

      // Video entries carry their paired cover as a preview thumbnail (written by
      // saveRecordedBackground with the same timestamp → `<stem>_cover.jpg`).
      if (isVideo) {
        const coverPath = path.join(bgDir, path.basename(e.name, ext) + '_cover.jpg');
        if (await fs.stat(coverPath).then(() => true).catch(() => false)) {
          entry.cover = coverPath;
        }
      }

      result.push(entry);
    }
    return result;
  } catch {
    return [];
  }
}

export async function saveRecordedBackground(
  buffer: Uint8Array,
  saveToDesktop: boolean,
  prefix?: string,
  coverDataUrl?: string,
): Promise<{ success: boolean; path: string; name: string }> {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');

    const bgDir = path.join(app.getPath('userData'), 'backgrounds');
    await fs.mkdir(bgDir, { recursive: true });

    const safeName = (prefix || 'we_recording').replace(/[\\/:*?"<>|]/g, '').slice(0, 40);
    // One timestamp for BOTH names so the cover is pair-able with its video:
    // <video> → `<name>_<ts>.<ext>`, cover → `<name>_<ts>_cover.jpg`.
    const ts = Date.now();
    const stem = `${safeName}_${ts}`;
    const videoName = `${stem}.webm`;
    const videoPath = path.join(bgDir, videoName);

    // 1) Write the raw recording (WebM VP9) as today.
    await fs.writeFile(videoPath, buffer);

    // 2) Loop detection + crop (main process; any failure falls back to the
    //    untouched recording — the recording/apply flow never breaks).
    //    On success the cropped H.264 `.mp4` REPLACES the webm under the SAME
    //    stem, so the cover thumbnail pairing in `listBackgrounds` still works.
    const outcome = await maybeMakeLoopVideo(videoPath, path.join(bgDir, stem));
    if (outcome.kind === 'loop') {
      try {
        await fs.unlink(videoPath); // remove the original webm, keep the mp4
      } catch {
        // keep both rather than fail the save
      }
    }
    const finalPath = outcome.videoPath;
    const finalName = path.basename(finalPath);

    // 3) Save cover thumbnail if provided — stored beside the video so the list
    //    can show it as the video card's preview (see listBackgrounds).
    if (coverDataUrl) {
      const coverName = `${stem}_cover.jpg`;
      const coverPath = path.join(bgDir, coverName);
      const base64 = coverDataUrl.replace(/^data:image\/\w+;base64,/, '');
      await fs.writeFile(coverPath, Buffer.from(base64, 'base64'));
    }

    // 4) Optionally also save to desktop
    if (saveToDesktop) {
      const desktopDir = app.getPath('desktop');
      const desktopPath = path.join(desktopDir, finalName);
      await fs.copyFile(finalPath, desktopPath);
    }

    return { success: true, path: finalPath, name: finalName };
  } catch (err: any) {
    console.error('saveRecordedBackground failed:', err);
    return { success: false, path: '', name: '' };
  }
}

export async function deleteBackground(filePath: string) {
  try {
    const fs = await import('fs/promises');
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}
