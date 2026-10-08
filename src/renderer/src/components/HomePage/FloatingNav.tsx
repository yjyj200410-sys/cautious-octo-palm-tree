import { memo, useEffect, useRef } from 'react';

/** 歌单分类 tab(切换 PlaylistRail 的数据集合) */
export type RailTab = 'my-music' | 'recommend' | 'discover' | 'radar' | 'local';

const TABS: { id: RailTab; label: string; icon: string }[] = [
  { id: 'my-music', label: '我的音乐', icon: 'library_music' },
  { id: 'recommend', label: '推荐音乐', icon: 'auto_awesome' },
  { id: 'discover', label: '发现音乐', icon: 'explore' },
  { id: 'local', label: '本地音乐', icon: 'folder' }
];

/** 悬浮胶囊导航：仅当前分类展开名称，其他分类保留图标入口。 */
const FloatingNav = memo(
  ({ activeTab, onSelect }: { activeTab: RailTab; onSelect: (tab: RailTab) => void }) => {
    // 滚轮切换:悬停在导航上滚轮,向上切上一 tab、向下切下一 tab。
    // 用原生非 passive 监听(preventDefault 才有效,阻止页面滚动);delta 累计过阈值切一次,
    // 一次"滚轮格"= 切一个 tab,避免单个滚轮事件反复触发连跳。
    const containerRef = useRef<HTMLElement | null>(null);
    const wheelAccumRef = useRef(0);
    const activeTabRef = useRef(activeTab);
    activeTabRef.current = activeTab;
    const onSelectRef = useRef(onSelect);
    onSelectRef.current = onSelect;
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        else if (e.deltaMode === 2) dy *= 100;
        wheelAccumRef.current += dy;
        if (Math.abs(wheelAccumRef.current) >= 30) {
          const dir = wheelAccumRef.current > 0 ? 1 : -1;
          wheelAccumRef.current = 0;
          const idx = TABS.findIndex((t) => t.id === activeTabRef.current);
          const nextIdx = (idx + dir + TABS.length) % TABS.length;
          if (nextIdx !== idx) onSelectRef.current(TABS[nextIdx].id);
        }
      };
      el.addEventListener('wheel', onWheel, { passive: false });
      return () => el.removeEventListener('wheel', onWheel);
    }, []);

    return (
      <nav
        ref={containerRef}
        aria-label="首页内容分类"
        className="ipod-section-tabs"
      >
        <div className="ipod-section-tabs__capsule">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelect(tab.id)}
              onKeyDown={(event) => {
                // Let focused buttons activate without triggering player shortcuts.
                if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
              }}
              title={tab.label}
              aria-label={tab.label}
              aria-current={activeTab === tab.id ? 'page' : undefined}
              className={`ipod-section-tab ${activeTab === tab.id ? 'is-active' : ''}`}
            >
              <span aria-hidden="true" className="ipod-section-tab__icon material-icons-round">{tab.icon}</span>
              <span aria-hidden="true" className="ipod-section-tab__label">
                <span>{tab.label}</span>
              </span>
            </button>
          ))}
        </div>
      </nav>
    );
  }
);
FloatingNav.displayName = 'FloatingNav';

export default FloatingNav;
