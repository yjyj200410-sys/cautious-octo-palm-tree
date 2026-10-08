import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Radio,
  RadioGroup,
  Tab,
  TabGroup,
  TabList,
  TabPanel,
  TabPanels
} from '@headlessui/react';
import { useMemo, useState } from 'react';

import type { NcmSong } from '../../ncm/types';
import { normalizeLibraryText } from '../../utils/librarySearch';

export type FavoriteFilter = { artist: string; album: string; days: number };
export const emptyFavoriteFilter: FavoriteFilter = { artist: '', album: '', days: 0 };

type Choice = { value: string; label: string; count?: number };

function FilterChoices({
  label,
  options,
  value,
  onChange,
  searchable = false
}: {
  label: string;
  options: Choice[];
  value: string;
  onChange: (value: string) => void;
  searchable?: boolean;
}) {
  const [query, setQuery] = useState('');
  const terms = normalizeLibraryText(query).split(' ').filter(Boolean);
  const visible = options.filter(
    (option) =>
      !option.value || terms.every((term) => normalizeLibraryText(option.label).includes(term))
  );
  return (
    <>
      {searchable && (
        <label className="library-filter-search">
          <span className="material-icons-round" aria-hidden="true">
            search
          </span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`查找${label}`}
            aria-label={`查找${label}`}
            spellCheck={false}
          />
          {query && (
            <button type="button" aria-label={`清除${label}搜索`} onClick={() => setQuery('')}>
              <span className="material-icons-round" aria-hidden="true">
                close
              </span>
            </button>
          )}
        </label>
      )}
      <RadioGroup
        value={value}
        onChange={onChange}
        aria-label={label}
        className="library-filter-options"
      >
        {visible.map((option) => (
          <Radio key={option.value} value={option.value} className="library-filter-option">
            <span className="library-filter-option-name" title={option.label}>
              {option.label}
            </span>
            {option.count !== undefined && (
              <span className="library-filter-option-count">{option.count}</span>
            )}
            <span className="library-filter-check material-icons-round" aria-hidden="true">
              check
            </span>
          </Radio>
        ))}
        {visible.length === 1 && terms.length > 0 && (
          <p className="library-filter-empty" role="status">
            没有找到匹配的{label}
          </p>
        )}
      </RadioGroup>
    </>
  );
}

export default function FavoriteFilters({
  songs,
  value,
  onChange
}: {
  songs: NcmSong[];
  value: FavoriteFilter;
  onChange: (filter: FavoriteFilter) => void;
}) {
  const options = useMemo(() => {
    const artists = new Map<string, number>();
    const albums = new Map<string, number>();
    for (const song of songs) {
      for (const name of new Set(song.artists.map((artist) => artist.name).filter(Boolean)))
        artists.set(name, (artists.get(name) ?? 0) + 1);
      if (song.album?.name) albums.set(song.album.name, (albums.get(song.album.name) ?? 0) + 1);
    }
    const choices = (map: Map<string, number>) =>
      [...map]
        .sort(([a], [b]) => a.localeCompare(b, 'zh'))
        .map(([name, count]) => ({ value: name, label: name, count }));
    return { artists: choices(artists), albums: choices(albums) };
  }, [songs]);
  const activeCount =
    Number(Boolean(value.artist)) + Number(Boolean(value.album)) + Number(Boolean(value.days));
  const tabs = [
    { label: '歌手', active: Boolean(value.artist) },
    { label: '专辑', active: Boolean(value.album) },
    { label: '收藏时间', active: Boolean(value.days) }
  ];
  return (
    <Popover className="relative">
      {({ close }) => (
        <>
          <PopoverButton
            className="library-pill lumina-hero-secondary"
            title="筛选我喜欢的音乐"
            data-active={activeCount > 0}
          >
            <span className="material-icons-round" aria-hidden="true">
              filter_list
            </span>
            {activeCount ? '已筛选' : '筛选'}
          </PopoverButton>
          <PopoverPanel
            anchor="bottom end"
            transition
            className="library-filter-panel z-[80] [--anchor-gap:10px] [--anchor-padding:12px]"
            onKeyDown={(event) => event.stopPropagation()}
          >
            <div className="library-filter-heading">
              <h2>筛选音乐</h2>
              <button
                type="button"
                className="library-filter-reset"
                disabled={!activeCount}
                onClick={() => onChange(emptyFavoriteFilter)}
              >
                重置
              </button>
            </div>
            <TabGroup>
              <TabList className="library-filter-tabs" aria-label="筛选类别">
                {tabs.map((tab) => (
                  <Tab key={tab.label} className="library-filter-tab">
                    {tab.label}
                    {tab.active && <span className="library-filter-tab-dot" aria-label="已设置" />}
                  </Tab>
                ))}
              </TabList>
              <TabPanels className="library-filter-panels">
                <TabPanel>
                  <FilterChoices
                    label="歌手"
                    searchable
                    options={[{ value: '', label: '全部歌手' }, ...options.artists]}
                    value={value.artist}
                    onChange={(artist) => onChange({ ...value, artist })}
                  />
                </TabPanel>
                <TabPanel>
                  <FilterChoices
                    label="专辑"
                    searchable
                    options={[{ value: '', label: '全部专辑' }, ...options.albums]}
                    value={value.album}
                    onChange={(album) => onChange({ ...value, album })}
                  />
                </TabPanel>
                <TabPanel>
                  <FilterChoices
                    label="收藏时间"
                    options={[
                      { value: '0', label: '全部时间' },
                      { value: '7', label: '最近 7 天' },
                      { value: '30', label: '最近 30 天' },
                      { value: '365', label: '最近一年' }
                    ]}
                    value={String(value.days)}
                    onChange={(days) => onChange({ ...value, days: Number(days) })}
                  />
                </TabPanel>
              </TabPanels>
            </TabGroup>
            <div className="library-filter-footer">
              <span aria-live="polite">
                {activeCount ? `已设置 ${activeCount} 项筛选` : '显示全部音乐'}
              </span>
              <button
                type="button"
                className="library-pill lumina-hero-primary"
                onClick={() => close()}
              >
                完成
              </button>
            </div>
          </PopoverPanel>
        </>
      )}
    </Popover>
  );
}
