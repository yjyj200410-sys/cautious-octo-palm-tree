import roundTo from '@common/roundTo';
import FloatingPanel from '@renderer/components/FloatingChrome/FloatingPanel';
import DiscoveryPage from '@renderer/components/HomePage/DiscoveryPage';
import FloatingNav, { type RailTab } from '@renderer/components/HomePage/FloatingNav';
import HomePlaylistDetail, {
  type HomeDetail
} from '@renderer/components/HomePage/HomePlaylistDetail';
import PlaylistRail from '@renderer/components/HomePage/PlaylistRail';
import RecommendationPage from '@renderer/components/HomePage/RecommendationPage';
import LibraryPanel from '@renderer/components/LibraryPanel/LibraryPanel';
import MainContainer from '@renderer/components/MainContainer';
import { AppUpdateContext } from '@renderer/contexts/AppUpdateContext';
import { useNcmUser } from '@renderer/contexts/NcmUserContext';
import type { NcmPlaylist } from '@renderer/ncm/types';
import { createFileRoute } from '@tanstack/react-router';
import { lazy, useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

export const Route = createFileRoute('/main-player/home/')({
  component: HomePage
});

const ErrorPrompt = lazy(() => import('@renderer/components/ErrorPrompt'));

// FloatingNav 竖直顺序(上→下):上方 tab = up 切换,下方 tab = down 切换,方向贯穿整个动画
let retainedHomeTab: RailTab = 'my-music';

/** 首页使用稳定三层结构：全局顶栏、歌单分类、歌单轨道 + 详情主从区。 保留原有分类切换动画和空间化滚动逻辑；未登录时用单一引导取代两个相互竞争的空状态。 */
function HomePage() {
  const { isLoggedIn, activeUserId } = useNcmUser();
  const { updateContextMenuData, changePromptMenuData, addNewNotifications } =
    useContext(AppUpdateContext);

  // 悬浮分类导航:切换 PlaylistRail 的数据集合(我的音乐 / 发现音乐)。
  // 阶段 3.6/3.7 分类切换动画状态机:idle 常态 / exit 旧列表退场 / enter 新列表进场。
  // 阶段 3.7:连续切换不丢点击——动画期间新点击记入 pendingTabRef(exit 阶段结束直接改道、
  // enter 阶段结束后链式开始下一次);activeTabRef 镜像当前已落定 tab,供定时器回调内读取。
  const [activeTab, setActiveTab] = useState<RailTab>(() => retainedHomeTab);
  const [detail, setDetail] = useState<HomeDetail | null>(null);
  const [navigationSlot, setNavigationSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setNavigationSlot(document.getElementById('home-navigation-slot'));
  }, []);
  // Navigation commits immediately; only the content owns a short fade.
  const handleTabSelect = (tab: RailTab) => {
    retainedHomeTab = tab;
    setActiveTab(tab);
    setDetail(null);
  };

  const openPlaylist = (playlist: NcmPlaylist) =>
    setDetail({
      kind: 'ncm',
      id: Math.abs(playlist.playlistId),
      title: playlist.name,
      cover: playlist.coverUrl,
      description: playlist.description,
      creator: playlist.creatorName,
      trackCount: playlist.trackCount
    });

  // 首页右键开发菜单(仅开发模式)
  const homePageContextMenus: ContextMenuItem[] = useMemo(
    () =>
      window.api.properties.isInDevelopment
        ? [
            {
              label: 'Alert Error',
              iconName: 'report',
              handlerFunction: () =>
                changePromptMenuData(
                  true,
                  <ErrorPrompt
                    reason="JUST_FOR_FUN"
                    message={
                      <>
                        This prompt is used to develop the prompt menu. Instead of clicking doing
                        something that will open a prompt and also result in consequences, this
                        approach is much better because nothing will change when opening this
                        prompt.
                      </>
                    }
                    showSendFeedbackBtn
                  />,
                  'error-alert-prompt'
                )
            },
            {
              label: 'Show Notification',
              iconName: 'notifications_active',
              handlerFunction: () => {
                const duration = Math.random() * 10000;
                const value = roundTo(Math.random(), 2);
                addNewNotifications([
                  {
                    id: duration.toString(),
                    duration: 5 * 60 * 1000,
                    // duration,
                    content: `This is a notification with a number ${value}`,
                    iconName: 'notifications_active',
                    type: 'WITH_PROGRESS_BAR',
                    progressBarData: { total: 1, value: value }
                  }
                ]);
              }
            }
          ]
        : [],
    [changePromptMenuData, addNewNotifications]
  );

  return (
    <MainContainer
      noDefaultStyles
      className="home-workspace-shell relative h-full w-full overflow-hidden"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (homePageContextMenus.length > 0)
          updateContextMenuData(true, homePageContextMenus, e.pageX, e.pageY);
      }}
    >
      {navigationSlot &&
        createPortal(
          <FloatingNav activeTab={activeTab} onSelect={handleTabSelect} />,
          navigationSlot
        )}
      <div className="h-full min-h-0">
        <div className="home-library-grid min-h-0 min-w-0">
          {!isLoggedIn && activeTab !== 'local' ? (
            <section className="lumina-empty-state flex h-full min-h-0 items-center justify-center overflow-hidden px-8 pb-8 text-center">
              <div className="flex max-w-md flex-col items-center">
                <div className="lumina-empty-emblem text-font-color-black/60 dark:text-font-color-white/60 mb-6 flex h-14 w-14 items-center justify-center">
                  <span className="material-icons-round-outlined text-[1.75rem]">
                    library_music
                  </span>
                </div>
                <h1 className="text-font-color-black/85 dark:text-font-color-white/90 text-[1.35rem] font-semibold tracking-[-0.025em] text-balance">
                  把你的网易云歌单带到Volo
                </h1>
                <p className="text-font-color-black/52 dark:text-font-color-white/52 mt-2.5 max-w-sm text-sm leading-6 text-pretty">
                  登录后可浏览收藏、每日推荐与雷达歌单。你也可以先切换到「本地」继续使用。
                </p>
                <button
                  type="button"
                  className="lumina-empty-primary mt-6 flex h-10 items-center gap-2 px-4 text-sm font-medium transition-[background-color,transform] active:translate-y-px"
                  onClick={() => window.dispatchEvent(new Event('open-ncm-login'))}
                >
                  <span className="material-icons-round-outlined text-lg">login</span>
                  登录网易云
                </button>
              </div>
            </section>
          ) : detail ? (
            <HomePlaylistDetail detail={detail} onBack={() => setDetail(null)} />
          ) : activeTab === 'recommend' ? (
            <RecommendationPage
              key={activeUserId ?? 'guest'}
              onOpenPlaylist={openPlaylist}
              onOpenDaily={(cover) => setDetail({ kind: 'daily', title: '每日推荐', cover })}
            />
          ) : activeTab === 'discover' ? (
            <DiscoveryPage onOpenPlaylist={openPlaylist} />
          ) : (
            <div className="home-library-columns h-full min-h-0">
              <FloatingPanel
                panel="sidebar"
                title="歌单侧栏"
                icon="library_music"
                className="floating-sidebar"
              >
                <aside className="ipod-library-rail flex min-h-0 min-w-0" aria-label="歌单导航">
                  <PlaylistRail
                    key={activeUserId ?? 'local'}
                    activeTab={activeTab}
                    transition="idle"
                    railDir="down"
                    onOpenDetail={(value) => setDetail(value)}
                  />
                </aside>
              </FloatingPanel>
              <section className="library-content-surface min-h-0 min-w-0" aria-label="歌单内容">
                <LibraryPanel key={activeUserId ?? 'local'} />
              </section>
            </div>
          )}
        </div>
      </div>
    </MainContainer>
  );
}
