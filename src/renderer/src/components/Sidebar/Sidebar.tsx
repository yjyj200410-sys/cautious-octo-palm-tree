import { linkOptions } from '@tanstack/react-router';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ErrorBoundary from '../ErrorBoundary';
import SideBarItem from './SideBarItem';

const Sidebar = memo(() => {
  const { t } = useTranslation();

  const linkData = useMemo(
    () =>
      linkOptions([
        {
          to: '/main-player/home',
          id: 'Home',
          parentClassName: 'home',
          icon: 'home',
          content: t('sideBar.home'),
          isActive: true
        }
      ]),
    [t]
  );

  const [data, setData] = useState<typeof linkData>();

  useEffect(() => {
    setData(linkData);
  }, [linkData]);

  const sideBarItems = useMemo(
    () =>
      data
        ? data.map((link) => (
            <SideBarItem
              to={link.to}
              key={link.id}
              parentClassName={link.parentClassName}
              icon={link.icon}
              content={link.content}
            />
          ))
        : [],
    [data]
  );

  return (
    <nav
      className="side-bar absolute top-[60px] left-1/2 -translate-x-1/2 z-30 w-auto max-w-[95vw] rounded-full ring-1 ring-white/10 backdrop-blur-lg"
      style={{ background: 'rgba(102,102,102,0.18)' }}
    >
      <ErrorBoundary>
        <ul className="relative flex h-full flex-row items-center gap-2 overflow-x-auto px-2 py-1">
          {sideBarItems}
        </ul>
      </ErrorBoundary>
    </nav>
  );
});

Sidebar.displayName = 'Sidebar';
export default Sidebar;
