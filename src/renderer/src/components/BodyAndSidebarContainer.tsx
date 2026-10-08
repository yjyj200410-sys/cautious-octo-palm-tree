import { Outlet } from '@tanstack/react-router';

import ErrorBoundary from './ErrorBoundary';
import NotificationPanel from './NotificationPanel/NotificationPanel';
import TopSpacer from './TopSpacer';

const BodyAndSideBarContainer = () => {
  return (
    <div className="body-and-side-bar-container relative flex h-full w-full flex-col overflow-hidden">
      <ErrorBoundary>
        <NotificationPanel />
        <div
          className="body relative order-2 h-full! w-full overflow-x-hidden overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <TopSpacer />
          <Outlet />
        </div>
      </ErrorBoundary>
    </div>
  );
};

export default BodyAndSideBarContainer;
