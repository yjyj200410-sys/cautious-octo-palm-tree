const TopSpacer = () => (
  <div
    className="app-top-spacer"
    style={{
      height: 'var(--app-topbar-height)',
      width: '100%',
      background: 'transparent',
      pointerEvents: 'none',
      flexShrink: 0
    }}
  />
);

export default TopSpacer;
