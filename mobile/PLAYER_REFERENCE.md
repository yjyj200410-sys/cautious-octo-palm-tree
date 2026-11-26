# Android 播放器参考基线

日期：2026-11-12。状态：源码已下载并静态检查，尚未编译、安装或移植。

## 来源

主参考：https://github.com/MetrolistGroup/Metrolist
本地完整源码：C:/Users/test123/AndroidLocal/music-reference/Metrolist-main
来源压缩包：C:/Users/test123/AndroidLocal/music-reference/Metrolist-source.zip
许可证：上游 LICENSE 为 GPL v3；源码复用保留上游版权与许可证，发布前核对组合工程的许可要求。
此目录为上游参考，不将其中网络服务、品牌和账号逻辑原样接入 Volo。

备选：OxygenCobalt/Auxio（本地音乐体验）、FoedusProgramme/Gramophone（Media3 原生音乐播放）。本次仅下载并检查 Metrolist。

## 已核实的源码入口

以下相对路径以 app/src/main/kotlin/com/metrolist/music 为根：
- MainActivity.kt：NavHost、底部导航的 saveState/restoreState、独立 BottomSheetPlayer。
- ui/player/MiniPlayer.kt：独立迷你播放条。
- ui/player/Player.kt：完整播放界面。
- ui/player/Queue.kt：队列面板。
- ui/screens/search：搜索与结果独立页面。
- ui/screens/library：歌曲、专辑、歌手、歌单等曲库页面。
- ui/screens/playlist：在线与本地歌单详情。
- playback/queues/ListQueue.kt：队列包含 items、startIndex、position，与浏览列表分离。
- playback/MusicService.kt：媒体播放服务及队列持久化。

## Volo 应沿用的页面层级（移植方案，并非上游原样菜单）

一级：音乐 / 音乐库 / 我的。
音乐：搜索入口 -> 搜索结果 -> 专辑、歌手或歌单详情。
音乐库：网易云歌单 / 已下载 / 本地音乐 / 最近播放；分轨结果挂在对应歌曲下。
我的：网易云账号、设置。

所有浏览页面共享同一条底部迷你播放器；无播放内容时隐藏。有播放内容时显示封面、歌名、歌手、播放暂停；点击展开完整播放器。
完整播放器属于全局播放层，不是浏览页面的替代首页。收起后回到原页面、原列表位置。
完整播放器：封面、歌名、歌手、进度、上一首/播放暂停/下一首、播放模式、队列、歌曲更多操作。
队列面板：标出正在播放项，允许选歌、移除与排序；浏览和再次搜索不应更改队列。
分轨属于当前歌曲的播放器功能：未处理 -> 确认开始 -> 处理中/取消 -> 完成可选原曲/人声/伴奏 -> 导出。切换歌曲后结果仍按歌曲 ID 保存。
返回顺序：先关闭队列/更多面板，再收起完整播放器，再退回浏览上级；浏览退出不停止音乐。

## 移植边界与实施顺序

1. 先完成统一歌曲身份、播放队列、媒体服务、进度恢复及音频焦点。
2. 按上述结构重建页面导航和共享迷你播放器；先使用常规封面播放器。
3. 接回现有网易云账号、音源解析与系统下载；本地/下载与在线歌曲共用播放模型。
4. 将已有 AudioJob/Separator 挂到当前歌曲，增加结果索引及清理管理。
5. 验收连续播放、后台/锁屏、返回、搜索不改队列、下载离线播放、分轨找回后，再恢复视觉精修。

当前 Java Activity 原型不能直接粘贴 Kotlin Compose 页面运行；实际采用代码前需要确定 Android 模块的 Compose 改造与依赖接入，并保留已验证的分轨模块。
