import { memo } from 'react';

/**
 * 搜索结果单项(歌曲/歌手/歌单共用)。
 * 歌曲行:封面(可选) + 标题 + 副标题(歌手) + 时长(可选);
 * 歌手/歌单行:图标 + 标题 + 副标题。点击行为由父级传入。
 * onContextMenu 可选——歌曲行传右键菜单,歌手/歌单不传。
 */
interface SearchResultItemProps {
  iconName?: string;
  cover?: string;
  title: string;
  subtitle?: string;
  duration?: string;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

const SearchResultItem = memo(
  ({ iconName, cover, title, subtitle, duration, onClick, onContextMenu }: SearchResultItemProps) => (
    <button
      type="button"
      className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left outline-none transition-[background] duration-150 hover:bg-white/10 focus-visible:bg-white/10 active:bg-white/[0.06]"
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {cover ? (
        <img src={cover} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" />
      ) : (
        <span className="material-icons-round-outlined flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/5 text-lg leading-none text-white/45">
          {iconName}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-white/85">{title}</span>
        {subtitle && <span className="block truncate text-xs text-white/35">{subtitle}</span>}
      </span>
      {duration && (
        <span className="shrink-0 text-xs tabular-nums text-white/35">{duration}</span>
      )}
    </button>
  )
);

SearchResultItem.displayName = 'SearchResultItem';
export default SearchResultItem;
