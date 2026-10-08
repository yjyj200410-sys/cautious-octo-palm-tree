import { routeStateStore } from '@renderer/store/routeStateStore';
import { useStore } from '@tanstack/react-store';

import LibraryContent from './LibraryContent';

/**
 * LibraryPanel(阶段 4 主区域化):首页「空间化歌单浏览器」右侧的常驻主内容区域。 始终渲染(不再有 isOpen 门控),与 PlaylistRail 同处 Home flex
 * 行,flex-1 填充右侧 68~72%。 无弹窗浮层样式(无阴影/无圆角 ring/无背景模糊/无入场动画)——Rail 与 Library 之间用 渐变融合分隔(Home 的渐变分隔线 +
 * 本面板左侧淡入的底色)。面板不再有关闭按钮。 歌单切换只替换内容(标题/封面/歌曲列表),由 LibraryContent 的 idle/exit/enter 生命周期
 * 做切换动画,不整体关闭/打开。kind 为 null(未登录/无可用歌单)时显示占位。
 */
export default function LibraryPanel() {
  const state = useStore(routeStateStore, (s) => s['library-panel']);
  const kind = state?.kind ?? null;

  if (kind === null) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center select-none">
        <span className="material-icons-round-outlined text-font-color-black/28 dark:text-font-color-white/28 text-4xl">
          library_music
        </span>
        <div className="text-font-color-black/55 dark:text-font-color-white/55 text-sm font-medium">
          选择一个歌单查看内容
        </div>
      </div>
    );
  }

  return (
    <div className="ipod-content-surface relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      {/* 阶段 4.3:内容区整体下移 pt-[74px](用户定值)保留桌面应用顶部呼吸空间——避开主壳顶部
          MenuButton(left-3)与 WindowControls(right-3)悬浮层;LibraryContent 头部与歌曲列表
          随之整体下移,歌曲列表滚动区域不再从窗口顶部开始。height 保持 100%。 */}
      <LibraryContent kind={kind} id={state.id} title={state.title} cover={state.cover} />
    </div>
  );
}
