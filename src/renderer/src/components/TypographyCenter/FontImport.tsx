/**
 * FontImport — 导入字体按钮 + 导入流程(文件选择 → @font-face 注入 → 持久化)。
 * 导入完成后回调 onImported(font),由父组件刷新字体列表并应用。
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type FontDef, saveCustomFont } from '@renderer/utils/fontLoader';

interface FontImportProps {
  onImported: (font: FontDef) => void;
}

function FontImport({ onImported }: FontImportProps) {
  const { t } = useTranslation();
  const [error, setError] = useState('');

  const importFont = async () => {
    setError('');
    try {
      const filePath = await window.api.settingsHelpers.getFontFileLocation();
      if (!filePath) return;
      const name = filePath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') || 'Custom Font';
      const fontUrl = `file:///${filePath.replace(/\\/g, '/')}`;
      // 注入 @font-face 并持久化
      const style = document.createElement('style');
      style.dataset.customFont = name;
      style.textContent = `@font-face { font-family: "${name}"; src: url("${fontUrl}"); }`;
      document.head.appendChild(style);
      const custom = saveCustomFont(name, filePath);
      onImported(custom);
    } catch (e) {
      setError('导入失败: ' + String(e));
    }
  };

  return (
    <div>
      <button
        className="flex cursor-pointer items-center gap-1 rounded-full bg-font-color-highlight/15 px-3 py-1.5 text-xs text-font-color-highlight transition-colors hover:bg-font-color-highlight/25 dark:text-dark-font-color-highlight"
        onClick={importFont}
        title={t('fontManagerPage.import')}
      >
        <span className="material-icons-round text-sm">upload_file</span>
        {t('fontManagerPage.import')}
      </button>
      {error && <div className="text-xs text-red-400">{error}</div>}
    </div>
  );
}

export default FontImport;