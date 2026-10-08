import {
  SETTINGS_SECTIONS,
  closeSettingsDrawer,
  openMusicFolders,
  setActiveSettingsSection,
  settingsStore,
  type SettingsSectionKey
} from '@renderer/store/settingsStore';
import {
  lyricTransformStore,
  updateLyricTransformSettings
} from '@renderer/store/lyricTransformStore';
import { useNavigate } from '@tanstack/react-router';
import { useStore } from '@tanstack/react-store';
import { Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { store } from '@renderer/store/store';
import { useTranslation } from 'react-i18next';

import ErrorBoundary from '../ErrorBoundary';
import FullScreenSettings, {
  type FullScreenSettingsTab
} from '../FullScreenPlayer/FullScreenSettings';
import FontSettings from '../FontSettings';
import AppearanceSettings from '../SettingsPage/Settings/AppearanceSettings';
import BackgroundSettings from '../SettingsPage/Settings/BackgroundSettings';
import AudioPlaybackSettings from '../SettingsPage/Settings/AudioPlaybackSettings';
import LanguageSettings from '../SettingsPage/Settings/LanguageSettings';
import LyricsFontSettings from '../SettingsPage/Settings/LyricsFontSettings';
import WallpaperCenterOverlay from '../WallpaperCenter/WallpaperCenter';
import MusicFoldersOverlay from '../MusicFoldersPage/MusicFoldersOverlay';

type LyricsSettingsSubsection = 'font' | FullScreenSettingsTab;

const LYRICS_SUBSECTIONS: Array<{
  key: LyricsSettingsSubsection;
  label: string;
}> = [
  { key: 'font', label: '字体' },
  { key: 'visual', label: '视觉' },
  { key: 'desk', label: '桌面歌词' }
];

/**
 * 设置抽屉：五个主分类，歌词项在左侧展开二级菜单。
 *
 * 开合状态 + 当前激活分类统一由 settingsStore 持有(MenuButton 写入 isOpen=true; 本组件关闭时写回 false;activeSection 持久化
 * localStorage,重开回到上次所在分类)。
 *
 * 交互: - 左侧分类导航 + 右侧真实设置内容 - 滑入动画:左侧 translate-x
 * 进出场,300ms ease-out(纯 Tailwind,无 JS 定时器) - 遮罩:半透明黑 + backdrop-blur,点击遮罩关闭 - ESC 关闭(仅打开时注册
 * keydown;快捷键编辑时不拦截) - 标题栏关闭按钮
 *
 * 布局:右侧内容区独立滚动;均衡器等宽内容超出时横向滚动(不裁剪、不改动设置组件)。
 */
const SettingsDrawer = () => {
  const { t } = useTranslation();
  const isOpen = useStore(settingsStore, (s) => s.isOpen);
  const activeSection = useStore(settingsStore, (s) => s.activeSection);
  const [lyricsSubsection, setLyricsSubsection] =
    useState<LyricsSettingsSubsection>('font');
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const [visitedSections, setVisitedSections] = useState(() => new Set([activeSection]));
  const sectionPath = activeSection === 'lyrics' ? `lyrics/${lyricsSubsection}` : activeSection;

  useLayoutEffect(() => {
    const node = contentRef.current;
    if (node) node.scrollTop = scrollPositions.current.get(sectionPath) ?? 0;
    setVisitedSections((previous) => previous.has(activeSection) ? previous : new Set([...previous, activeSection]));
  }, [activeSection, sectionPath]);

  // ESC 关闭(快捷键编辑模式下不拦截,避免编辑按键时误关抽屉;
  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || store.state.promptMenuData.isVisible || store.state.contextMenuData.isVisible) return;
      if (document.querySelector('.shortcut.editing')) return;
      if (
        settingsStore.state.isWallpaperCenterOpen ||
        settingsStore.state.isMusicFoldersOpen
      )
        return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSettingsDrawer();
      }
      if (e.key === 'Tab') {
        const items = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex="0"]') ?? [])
          .filter((element) => element.getClientRects().length > 0 && !element.closest('[hidden], [inert]') && !element.matches(':disabled'));
        const first = items[0];
        const last = items.at(-1);
        if (e.shiftKey && (document.activeElement === first || !drawerRef.current?.contains(document.activeElement))) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !drawerRef.current?.contains(document.activeElement))) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [isOpen]);

  return (
    <>
      {/* 遮罩:点击外部关闭 */}
      <div
        className={`fixed inset-0 z-[60] bg-black/8 transition-opacity duration-250 ${
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={closeSettingsDrawer}
        aria-hidden
      />
      {/* 抽屉主体:左侧滑入 */}
      <aside
        ref={drawerRef}
        className={`settings-drawer-shell fixed top-0 left-0 z-[61] flex h-full w-[clamp(460px,48vw,520px)] max-w-[calc(100vw-180px)] flex-col border-r border-black/8 shadow-[20px_0_64px_rgba(0,0,0,0.2)] transition-transform duration-240 ease-out dark:border-white/8 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={
          {
            background: 'var(--background-color-1)',
            // Clear the native exclusion before the closing slide; compositor
            // transforms alone can leave it over the uncovered titlebar.
            WebkitAppRegion: isOpen ? 'no-drag' : undefined,
            appRegion: isOpen ? 'no-drag' : undefined
          } as React.CSSProperties
        }
        aria-label={t('settingsPage.settings')}
        aria-modal="true"
        aria-hidden={!isOpen}
        inert={!isOpen}
        role="dialog"
      >
        {/* 标题栏 */}
        <div className="settings-drawer-header relative flex min-h-[60px] items-center justify-between border-b border-black/8 px-5 py-3 dark:border-white/8">
          <div className="flex items-center gap-3">
            <span className="settings-drawer-mark flex h-8 w-8 items-center justify-center rounded-[9px]">
              <span className="material-icons-round-outlined text-lg">settings</span>
            </span>
            <div>
              <div className="text-font-color text-[17px] font-semibold tracking-[-0.02em]">
                {t('settingsPage.settings')}
              </div>
              <div className="text-font-color/55 text-[11px] tracking-[0.01em]">
                让Volo按你的方式工作
              </div>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            onClick={closeSettingsDrawer}
            className="settings-close-button text-font-color/65 hover:text-font-color flex h-9 w-9 items-center justify-center transition-[background-color,color,transform] active:scale-95"
            title={t('titleBar.close')}
            aria-label={t('titleBar.close')}
          >
            <span className="material-icons-round text-xl">close</span>
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* 左列:分类导航 */}
          <nav
            className="settings-category-nav flex w-36 shrink-0 flex-col overflow-y-auto overscroll-contain border-r border-black/8 px-2 py-3 dark:border-white/8"
            aria-label="设置分类"
          >
            <div className="settings-category-label text-font-color/45 px-2.5 pb-2 text-[10px] font-semibold tracking-[0.14em]">
              设置分类
            </div>
            {SETTINGS_SECTIONS.map(({ key, icon, label }) => (
              <div key={key}>
                <button
                  onClick={() => setActiveSettingsSection(key)}
                  aria-current={activeSection === key ? 'page' : undefined}
                  aria-expanded={key === 'lyrics' ? activeSection === 'lyrics' : undefined}
                  className={`settings-nav-item relative flex min-h-[44px] w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-[background-color,color,box-shadow,transform] active:scale-[.985] ${
                    activeSection === key
                      ? 'is-active text-font-color-highlight dark:text-dark-font-color-highlight'
                      : 'text-font-color/72 hover:bg-black/5 dark:hover:bg-white/7'
                  }`}
                >
                  <span className="material-icons-round-outlined text-[18px]">{icon}</span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{t(label)}</span>
                  </span>
                  <span
                    className={`material-icons-round ml-auto text-base opacity-40 transition-transform ${
                      key === 'lyrics' && activeSection === 'lyrics' ? 'rotate-90' : ''
                    }`}
                  >
                    chevron_right
                  </span>
                </button>
                {key === 'lyrics' && activeSection === 'lyrics' && (
                  <div className="settings-subnav mt-1 mb-1.5 ml-[18px] border-l border-black/10 pl-2 dark:border-white/10">
                    {LYRICS_SUBSECTIONS.map((subsection) => (
                      <button
                        key={subsection.key}
                        onClick={() => setLyricsSubsection(subsection.key)}
                        aria-current={
                          lyricsSubsection === subsection.key ? 'page' : undefined
                        }
                        className={`settings-subnav-item flex min-h-8 w-full cursor-pointer items-center rounded-lg px-2.5 text-left text-[12px] transition-[background-color,color,transform] active:scale-[.985] ${
                          lyricsSubsection === subsection.key
                            ? 'is-active text-font-color-highlight dark:text-dark-font-color-highlight'
                            : 'text-font-color/62 hover:bg-black/5 dark:hover:bg-white/6'
                        }`}
                      >
                        {subsection.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>

          {/* 右侧:当前分类的设置内容(复用现有设置组件) */}
          <div ref={contentRef} onScroll={(event) => scrollPositions.current.set(sectionPath, event.currentTarget.scrollTop)} className="settings-content-scroll min-w-0 flex-1 overflow-auto overscroll-contain">
            <div
              className="settings-content-stack px-4 pt-4 pb-7"
            >
              <ErrorBoundary>
                <Suspense fallback={null}>
                  {SETTINGS_SECTIONS.filter(({ key }) => visitedSections.has(key) || key === activeSection).map(({ key }) => (
                    <div key={key} hidden={key !== activeSection} inert={key !== activeSection}>
                      <SettingsSectionContent section={key} lyricsSubsection={lyricsSubsection} />
                    </div>
                  ))}
                </Suspense>
              </ErrorBoundary>
            </div>
          </div>
        </div>
      </aside>
      <WallpaperCenterOverlay />
      <MusicFoldersOverlay />
    </>
  );
};

/**
 * 入口卡：壁纸中心、音乐文件夹等管理内容保留独立浮窗。
 */
const SettingsEntryCard = ({
  icon,
  title,
  description,
  to,
  onClick
}: {
  icon: string;
  title: string;
  description?: string;
  to?: string;
  onClick?: () => void;
}) => {
  const navigate = useNavigate();
  const isNavigable = Boolean(to) || Boolean(onClick);
  return (
    <button
      type="button"
      className={`settings-entry-card secondary-container mb-4 block w-full text-left ${isNavigable ? 'cursor-pointer' : 'cursor-default'}`}
      onClick={() => {
        if (onClick) onClick();
        else if (to) navigate({ to });
      }}
    >
      <div className="flex items-center gap-3">
        <span className="material-icons-round text-font-color-highlight dark:text-dark-font-color-highlight text-2xl">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="description mb-0!">{title}</div>
          {description && (
            <div className="text-font-color/60 mt-0.5 text-sm">
              {description}
            </div>
          )}
        </div>
        <span className="material-icons-round text-font-color/48">
          {isNavigable ? 'chevron_right' : 'schedule'}
        </span>
      </div>
    </button>
  );
};

/** 按 activeSection 组合对应的设置组件(全部复用 SettingsPage/Settings 现有组件,保持逻辑与持久化不变)。 */
const SettingsSectionContent = ({
  section,
  lyricsSubsection
}: {
  section: SettingsSectionKey;
  lyricsSubsection: LyricsSettingsSubsection;
}) => {
  const { t } = useTranslation();
  const lyricTx = useStore(lyricTransformStore, (state) => state.settings);
  const content: Record<SettingsSectionKey, ReactNode> = {
    appearance: <AppearanceSettings />,
    background: <BackgroundSettings />,
    player: <AudioPlaybackSettings />,
    lyrics: (
      <>
        <div hidden={lyricsSubsection !== 'font'}>
          <FontSettings scope="lyrics" />
          <LyricsFontSettings />
        </div>
          <section hidden={lyricsSubsection === 'font'} id="fullscreen-lyrics-settings" className="lyrics-effects-settings mb-5">
            <FullScreenSettings
              embedded
              embeddedTab={lyricsSubsection === 'font' ? 'visual' : lyricsSubsection}
              lyricTx={lyricTx}
              setLyricTx={updateLyricTransformSettings}
            />
          </section>
      </>
    ),
    general: (
      <>
        <LanguageSettings />
        <FontSettings scope="global" />
        <SettingsEntryCard
          icon="folder"
          title={t('foldersPage.musicFolders')}
          description={t('settingsPage.musicFoldersDescription')}
          onClick={openMusicFolders}
        />
      </>
    )
  };
  return <>{content[section]}</>;
};

export default SettingsDrawer;
