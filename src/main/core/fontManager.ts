/**
 * Font file picker — opens a native dialog to select .ttf/.otf/.woff/.woff2 files.
 */
import { dialog } from 'electron';
import { getMainWindow } from './windowRef';

export async function getFontFileLocation() {
  const filePaths = await dialog.showOpenDialog(getMainWindow(), {
    title: '选择字体文件',
    buttonLabel: '导入字体',
    filters: [{ name: '字体文件', extensions: ['ttf', 'otf', 'woff', 'woff2'] }],
    properties: ['openFile'],
  });
  return filePaths.filePaths[0];
}
