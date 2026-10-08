/**
 * FontPreviewCard — 单个字体卡片:实时预览(Aa / 用户输入文本) + 名称 + 已应用标记 + 自定义字体删除。
 * 纯展示组件,选中/删除逻辑由父组件注入,不持有字体状态。
 */
import type { FontDef } from '@renderer/utils/fontLoader';

interface FontPreviewCardProps {
  font: FontDef;
  applied: boolean;
  previewText: string;
  deleteLabel: string;
  appliedLabel: string;
  onSelect: () => void;
  onDelete: () => void;
}

function FontPreviewCard({
  font,
  applied,
  previewText,
  deleteLabel,
  appliedLabel,
  onSelect,
  onDelete
}: FontPreviewCardProps) {
  const isCustom = font.category === '自定义';
  return (
    <button
      className={`group relative flex h-[104px] w-full cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border p-2 transition-colors ${
        applied
          ? 'border-font-color-highlight bg-font-color-highlight/10 shadow-lg dark:border-dark-font-color-highlight'
          : 'border-transparent bg-white/5 hover:bg-white/10'
      }`}
      onClick={onSelect}
      title={`${font.name} · ${font.nameZh}`}
    >
      {isCustom && (
        <span
          className="absolute right-1 top-1 z-10 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-red-500/80 text-white opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title={deleteLabel}
        >
          <span className="material-icons-round text-[10px] leading-none">close</span>
        </span>
      )}
      <span
        className="font-preview-name flex h-8 w-full items-center justify-center overflow-hidden text-ellipsis whitespace-nowrap text-xl leading-none"
        style={{ fontFamily: `"${font.name}"` }}
      >
        {previewText || 'Aa'}
      </span>
      <span className="w-full truncate text-center text-[10px] text-white/70">{font.nameZh}</span>
      {applied && (
        <span className="mt-0.5 flex items-center gap-0.5 text-[9px] text-font-color-highlight dark:text-dark-font-color-highlight">
          <span className="material-icons-round text-[10px] leading-none">check_circle</span>
          {appliedLabel}
        </span>
      )}
    </button>
  );
}

export default FontPreviewCard;
