/**
 * 字体就绪等待 — 依赖零,主窗口与桌面歌词窗口共用。
 *
 * document.fonts.load() 的坑:当目标 @font-face 尚未注册(如 Google Fonts 的 <link> 刚
 * 插入、样式表还没加载完)时会立即 resolve 空数组,不会真正触发字体加载 → 依赖它的
 * "lumina:fontLoaded" 事件丢失,歌词纹理停留在旧/默认字体。
 *
 * 这里先轮询 FontFaceSet 确认 family 已注册(样式表就绪),再主动 load 与歌词画布一致的
 * 字重("bold 64px"),确保 resolve 时字体真正可被 canvas 使用。
 */
export function fontReady(fontName: string, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || !document.fonts) {
      resolve();
      return;
    }
    const faces = document.fonts;
    const face = `bold 64px "${fontName}"`;
    const familyExists = (): boolean => {
      try {
        for (const f of faces) {
          // font-family 可能带引号也可能不带,统一剥掉两侧引号再比较
          const fam = String((f as { family?: string }).family ?? '').replace(/^"+|"+$/g, '');
          if (fam === fontName) return true;
        }
      } catch { /* ignore */ }
      return false;
    };
    const start = performance.now();
    const poll = (): void => {
      if (familyExists()) {
        try {
          // face 已注册 → 主动加载具体字重;加载失败也不阻塞,resolve 兜底
          faces.load(face)
            .then(() => resolve())
            .catch(() => resolve());
        } catch {
          resolve();
        }
      } else if (performance.now() - start > timeoutMs) {
        resolve(); // 超时兜底(离线等),不永久卡住
      } else {
        setTimeout(poll, 100);
      }
    };
    poll();
  });
}
