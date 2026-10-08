import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dialog: vi.fn(), fetch: vi.fn(), api: vi.fn() }));
vi.mock('electron', () => ({
  dialog: { showOpenDialog: mocks.dialog },
  net: { fetch: mocks.fetch }
}));
vi.mock('../../../src/main/ncm-server/ncm-server', () => ({ callNcmApi: mocks.api }));
import { downloadNcmSongs } from '../../../src/main/core/downloadNcmSongs';

let folder: string;
beforeEach(async () => {
  vi.clearAllMocks();
  folder = await mkdtemp(join(tmpdir(), 'volo-download-test-'));
  mocks.dialog.mockResolvedValue({ canceled: false, filePaths: [folder] });
  mocks.api.mockResolvedValue({
    code: 200,
    data: { url: 'https://example.com/song.mp3', type: 'mp3' }
  });
  mocks.fetch.mockImplementation(() => Promise.resolve(new Response('music')));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe('account-authorized batch download', () => {
  it('canceling the folder picker makes no network request', async () => {
    mocks.dialog.mockResolvedValue({ canceled: true, filePaths: [] });
    expect((await downloadNcmSongs([{ id: 1, title: 'Song' }], '')).canceled).toBe(true);
    expect(mocks.api).not.toHaveBeenCalled();
  });
  it('reports unavailable tracks and still downloads subsequent songs with safe filenames', async () => {
    mocks.api.mockResolvedValueOnce({ code: 200, data: { url: null } });
    const result = await downloadNcmSongs(
      [
        { id: 1, title: 'Unavailable' },
        { id: 2, title: '../Title?' }
      ],
      'test'
    );
    expect(result.saved).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(await readdir(folder)).toEqual(['.._Title_-2.mp3']);
    expect(await readFile(join(folder, '.._Title_-2.mp3'), 'utf8')).toBe('music');
    expect(mocks.api).toHaveBeenLastCalledWith(
      'song/download/url/v1',
      { id: '2', level: 'exhigh' },
      'test'
    );
  });
  it('passes the selected quality to the download endpoint', async () => {
    await downloadNcmSongs([{ id: 1, title: 'Hi-Res Song' }], 'test', 'hires');
    expect(mocks.api).toHaveBeenCalledWith(
      'song/download/url/v1',
      { id: '1', level: 'hires' },
      'test'
    );
  });
  it('rejects unsupported quality values before opening the folder picker', async () => {
    await expect(
      downloadNcmSongs([{ id: 1, title: 'Song' }], 'test', 'invalid' as never)
    ).rejects.toThrow('下载音质参数无效');
    expect(mocks.dialog).not.toHaveBeenCalled();
  });
  it('never overwrites or deletes an existing file', async () => {
    await writeFile(join(folder, 'Song-1.mp3'), 'original');
    const result = await downloadNcmSongs([{ id: 1, title: 'Song' }], '');
    expect(result.saved).toBe(0);
    expect(result.failures[0]).toContain('文件已存在');
    expect(await readFile(join(folder, 'Song-1.mp3'), 'utf8')).toBe('original');
  });
  it('does not fetch trial URLs', async () => {
    mocks.api.mockResolvedValue({
      code: 200,
      data: { url: 'https://example.com/trial.mp3', freeTrialInfo: {} }
    });
    expect((await downloadNcmSongs([{ id: 1, title: 'Trial' }], '')).saved).toBe(0);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
