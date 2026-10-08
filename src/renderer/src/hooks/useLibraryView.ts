import { useEffect, useMemo, useRef, useState } from 'react';

type LibraryView = { query: string; sort: string; scrollTop: number };
const views = new Map<string, LibraryView>();

/** Session-only, account-scoped list state; never stores music or user credentials. */
export default function useLibraryView(key: string) {
  const [, refresh] = useState(0);
  const view = useMemo(() => {
    let value = views.get(key);
    if (!value) {
      value = { query: '', sort: 'default', scrollTop: 0 };
      if (views.size >= 40) views.delete(views.keys().next().value!);
      views.set(key, value);
    }
    return value;
  }, [key]);
  const scroller = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const save = () => { view.scrollTop = node.scrollTop; };
    node.addEventListener('scroll', save, { passive: true });
    return () => node.removeEventListener('scroll', save);
  }, [view]);
  return {
    view,
    scroller,
    setQuery: (query: string) => { view.query = query; view.scrollTop = 0; refresh((n) => n + 1); },
    setSort: (sort: string) => { view.sort = sort; view.scrollTop = 0; refresh((n) => n + 1); }
  };
}
