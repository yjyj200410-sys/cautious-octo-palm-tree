# Volo Android 功能原型

本目录是独立 Android 原生验证工程，不依赖 Electron 或电脑服务。当前先用 Java + Android 原生控件验证音频链路；正式页面尚未实现。

## 已实现

- 系统文件选择器导入音频，MediaExtractor/MediaCodec 本地解码。
- 流式写入临时 PCM，按块重采样到 48 kHz 双声道。
- ONNX Runtime Android CPU 推理，移植桌面端 FFT、循环状态、重叠重建及延迟补偿。
- 输出 48 kHz / stereo / PCM16 人声、伴奏 WAV。
- 进度、取消、试听、通过系统文件选择器导出。
- 分轨任务期间需保持前台；旋转/销毁界面会取消任务。新版增加联网权限，不申请全盘文件权限。

## 本机构建

SDK 原路径是指向不可用 G 盘的 Junction。本次使用 `C:\Users\test123\AndroidLocal\sdk`，Gradle 缓存也独立存放在 AndroidLocal，不改原链接。

```powershell
node mobile/scripts/prepare-assets.mjs
cd mobile
.\gradlew.bat --gradle-user-home C:\Users\test123\AndroidLocal\gradle-home :app:assembleDebug
```

`local.properties` 指定本机 sdk.dir，已忽略。APK 位于 `app/build/outputs/apk/debug/app-debug.apk`。
模型由脚本校验 SHA-256 后从桌面资源复制；模型及合成测试 WAV 不入 Git。厂商模型授权尚未确定，此阶段限本机试验，不发布含模型安装包。

## 真机验证（2026-11-12，用户本地日期）

- 设备 PKR110，Android API 36，SoC 标识 SM8750。
- Debug APK 已安装，包名 com.volo.mobile；当前启动入口为 MusicActivity；独立分轨工作台已删除，分轨通过播放页使用。
- 10 秒合成立体声音频输出两份长度完全一致的 WAV；优化后推理和写出约 2 秒。
- 与桌面算法逐样本比对（960000 个样本）：RMSE 0.0000088152，最大误差 0.0000153249；两轨重建原音频最大误差 0.0000305111。
- 180 秒合成测试音频：分轨阶段约 38 秒；单次过程采样 PSS 约 100 MB，结束约 119 MB。这不是峰值测量，也不是实际歌曲音质评估。
- 测试为 PCM WAV，其他压缩格式、真实歌曲听感、试听/导出的实际点击、后台持续运行仍待验证。

`validation/compare.cjs` 用桌面模型对比已从手机取回的 10 秒测试结果；先用 esbuild bundle `src/main/audio/colorosMssModel.ts` 至 `validation/desktop.cjs`，external 为 onnxruntime-node。结果见 validation/result.json。

## 未接入

网易云登录、音源解析、音乐下载、正式页面、前台服务/后台任务和结果库管理。现有结果保存在应用私有目录；下一次任务仅在完成后切换到新结果。卸载会清除结果，请先导出。

构建检查：`:app:assembleDebug`、`:app:lintDebug` 已通过（仍有原型界面硬编码文案、ARM-only 等警告）。最低版本暂定 Android 13/API 33，真机目标为 Android 16。


## 登录修复（2026-11-12）

默认使用二维码。可保存至 Pictures/Volo，尝试网易云扫一扫的相册识别，或用另一台设备扫描。只保存用户点击要求保存的二维码，不读取其他应用会话。不模拟通过安全验证；如官方 App 同样提示风险，需要在官方流程中完成验证。

轮询间隔 2.5 秒，最多 120 秒；过期、网络失败或关闭弹窗后停止，不自动循环刷新。授权 803 时提取响应 Cookie，用独立客户端读取账号信息成功后才替换加密会话；二维码请求使用独立无账号客户端。构建与 lintDebug 通过，真机创建 key 和 801 状态检查通过。

## 深色视觉试版（2026-11-12）

依用户提供的 6 段视频和 1 张图片，改为近黑底、蓝灰面板、细边框、局部电蓝选中态。底部固定导航，下载结果使用独立状态卡片。主按钮有轻微缩放和涟漪反馈；系统关闭动画时遵循系统动画设置。

新增可拖动播放刻度条（使用实际播放位置），分轨刻度进度（使用实际任务进度）。首页抽象波形和线框图形仅为品牌装饰，不作为音频测量结果；待分轨/解码时进度条为不确定态。

构建和 lintDebug 通过。已在 PKR110 真机查看主页、下载和分轨界面；未发现运行时崩溃。当前只验证真机原尺寸视觉，尚未覆盖窄屏、放大字体和拖动播放进度的完整手动回归。扫码登录已由用户反馈通过，界面改版未更改认证逻辑。

## 播放内分轨（2026-11-12）

底部导航收敛为音乐、下载、我的，移除常规页面通往独立分轨 Activity 的入口。支持本地音乐导入播放。播放控制中的「人声 / 伴奏」打开当前歌曲的音轨面板；原曲继续播放时在本机后台线程处理，完成后可切换原曲/人声/伴奏并导出。切换时保留当前位置和暂停状态；更换歌曲或取消会使旧任务失效。处理仍要求应用在前台，网络音频依赖服务器对系统解码器的支持。

真机回归：10 秒本地测试音频分轨完成时 originalPlaying=true，切换到人声后 prepared 回调记录 seek=4229ms、resume=true。构建与 lintDebug 通过；网络歌曲的并行分轨尚未单独验证。参考 Spotify Now Playing 的播放集中入口及 Apple Music Sing 的播放内人声控制，当前实现为预处理后音轨切换，并非即时逐帧分离或无缝混音。

## 空间播放器实施状态（2026-11-12）

已增加 SpatialPlayer 全屏播放界面，具有层叠卡片、在原位展开的人声/伴奏层、播放位置、队列选歌和可加载的真实专辑封面。无封面时显示程序绘制的 VOLO 占位图，不应当作真实专辑封面。右侧最多显示前三首队列缩略图，完整队列由队列按钮打开。卡片动画为二维变换，当前材料效果尚未达到生成概念图和用户视频参考的质量，不视为视觉验收通过。

真机本地测试：原曲播放中完成分轨，切换音轨保留位置。新版构建及 lintDebug 通过。用户指出界面质感差距，已收紧控件高度、改为半透明渐变并增加卡片边缘高光；真实封面、队列滑动、较小屏幕与材质效果仍需继续视觉回归。

## 播放与页面重构（2026-11-12）

参考 Metrolist 的全局播放层、独立队列和曲库分层，在当前 Java Android 工程中重新实现对应结构，未直接移植其 Kotlin Compose 源码，也不宣称视觉等同于 Metrolist。

- 一级页面为音乐 / 音乐库 / 我的。搜索结果、歌单详情和下载属于浏览页面，提供回到上级的路径。
- 常驻紧凑迷你播放器；点歌曲标题展开常规完整播放器，收起保留原浏览页面。已移除试验性的透视卡片播放器。
- PlaybackService 独立管理 MediaPlayer、媒体会话、前台通知、音频焦点、耳机断开暂停，以及队列/歌曲/位置持久化。恢复时暂停，避免无意自动发声。
- 浏览结果和活动队列分开，队列使用歌曲 ID/文件 URI 定位；播完自动下一首。下载成功项可构成离线队列。
- 分轨仍挂在当前歌曲内，处理完成后索引到歌曲 ID，并提供音乐库结果入口。

本轮验证：assembleDebug、lintDebug 通过；PKR110 真机本地分轨完成时 originalPlaying=true；两首 10 秒本地测试队列切到桌面后系统媒体会话仍为 PLAYING，后续 metadata 从测试队列 A 自动变成 B；重启应用可读取队列并暂停恢复。实际检查了迷你播放器、完整播放页与音乐库的原尺寸布局。

边界：这是结构重构版本，尚未完成队列拖动排序、随机/单曲循环、完整本地媒体库扫描、搜索/歌单分页与小屏/大字体适配；网络过期音源恢复、耳机及电话中断、分轨结果的跨进程找回仍需专项回归。分轨任务目前仍跟随 Activity 生命周期，页面销毁会取消，不视为后台分轨服务。旧 README 中与这些新状态冲突的早期“未接入”说明属于历史记录，以此节为准。

补充真机检查：在线搜索返回 30 首且未覆盖原测试播放队列；点击在线歌曲后媒体会话切换为该歌曲并进入 PLAYING。页面返回首页后播放条仍在。重启后恢复测试音频位置 5180ms，状态 PAUSED。上述检查不替代完整音频中断和离线故障回归。

## 播放状态与边分轨边试听（2026-11-12）

本轮遵循用户要求保持页面布局不变，仅调整播放状态和既有控件的可用状态。

- 队列遍历独立为 PlaybackOrder，包含顺序结束停止、列表循环、单曲循环、随机不立即重复及随机上一首历史。服务提供队列追加/下一首插入、删除和移动接口；页面入口留待用户下一轮规定。
- 所有拖动进度、切换音轨交给播放服务。连续切换、准备过程中暂停保留最新意图；旧解析结果和过期播放回调不再覆盖新选择。在线恢复重新获取音源，解码失败最多自动重取一次，避免无限重试。
- 增加准备超时、音频焦点丢失/短暂中断、duck 音量和耳机断开处理。媒体会话同步队列、当前项、歌手和播放模式自定义操作。
- AudioJob 在 PCM 写入完成后发布已提交帧数，并提前写入有效 WAV 头。首段达到 0.5 秒后，人声/伴奏原有按钮可用于试听。
- 试听采用 LiveStemPlayer 的 AudioTrack PCM 通道，从磁盘读取已提交前缀，固定大小缓冲。追上处理进度时等待新数据，不把临时边界当歌曲结束。保留暂停/进度，允许切回原曲；取消或失败时回到原曲。导出仍需完整结果。
- 仍需要先完成原音频解码再开始分轨；不是尚未下载/解码就立即分离，也不是无等待的实时模型推理。分轨生产仍跟随 Activity 生命周期。

验证：队列遍历桌面测试、提交前缀/等待/EOF/取消的桌面测试通过；assembleDebug、assembleDebugAndroidTest、lintDebug 通过。PKR110 已通过 30 项播放服务集成检查，包括从只有 2 秒 PCM 的 10 秒试听流开始播放、追上前缀不切歌/不报错、追加剩余数据后续播。实际模型边处理边试听的额外测试已编写；运行前 ADB 连接断开，尚未验证。随后增加的回调隔离、唤醒锁、取消状态和完成流生命周期修正已构建通过，待设备恢复后重跑完整套件。

测试命令：
`javac -encoding UTF-8 -d <output> app/src/main/java/com/volo/mobile/PlaybackOrder.java app/src/main/java/com/volo/mobile/StemStream.java validation/PlaybackOrderTest.java validation/StemStreamTest.java`
`java -cp <output> com.volo.mobile.PlaybackOrderTest`
`java -cp <output> com.volo.mobile.StemStreamTest`
`adb shell am instrument -w com.volo.mobile.test/com.volo.mobile.PlaybackInstrumentation`
测试 APK 仅用于本机回归，运行会替换测试播放队列，不更改登录或下载数据。

## 真机最终回归（2026-11-13）

手机重新连接后已重新构建并安装最新 Debug APK 和测试 APK。PKR110 / API36 上执行 PlaybackInstrumentation：`PASS: 34 service integration checks`、`INSTRUMENTATION_CODE: -1`。

覆盖实际播放服务和系统音频输出通道：准备过程中暂停、独立队列快照、进度拖动、快速切换音轨保留暂停与位置、队列删除/移动不重建无关播放项、移除当前项、缺失音频错误恢复、顺序结束停止、单曲重复、手动下一首、分段 PCM 提前播放、处理边界等待/追加续播、取消试听返回原曲。

新增真实模型检查通过：使用 10 秒测试 WAV，AudioJob 实际调用本地模型，在仅生成首段且尚未完成整首处理时启动人声试听；输出最终重命名后仍可返回原曲。该结果验证实际处理/播放链路，不代表真实歌曲的听感评测或所有厂商设备适配。

本节替代上一节因 ADB 断开而待验证的状态。页面布局未更改，仅同步已有操作的可用状态。原音频仍先解码，再进入可提前试听的分轨阶段。

## 双主页柔光玻璃实现（2026-11-13）

用户选择生图方案 B 的发现页与 C 的个人页组合。参考稿保存于 design/discover-reference.png 与 design/personal-reference.png，作为视觉方向，不是运行时背景或截图贴图。

- 主导航改为发现 / 个人两个目的地，纯黑页面，底部独立悬浮胶囊导航及迷你播放器。搜索通过顶部图标进入，下载和分轨结果作为个人页/设置内的功能。
- 发现顶部每日推荐采用真实推荐封面的层叠展示；下方展示真实推荐歌曲与推荐歌单。网络接口从已安装桌面模块核对；无登录/网络失败使用说明与重试入口，不伪造推荐数据。
- 个人页包含喜欢的音乐、本地与下载、最近播放和实际网易云歌单。各页面有独立滚动位置，浏览列表与播放队列保持分离。
- 头像旁设置按钮；头像弹出切换 / 添加 / 退出账号。会话沿用 Android Keystore AES-GCM 加密；已保存账号分别保留加密会话，切换前校验会话，退出仅移除当前账号。本轮没有为用户添加或退出真实账号。
- GlassUi 提供自绘材质边缘、柔光、统一线性图标；Surface 使用封面经 RenderEffect 模糊形成局部色光，不宣称全屏实时背景采样。图片加载带内存缓存、相同 URL 请求合并和视图身份检查。
- 最近播放由服务在有效歌曲准备完成后保存最多 50 首；测试用的非正式歌曲身份不写入最近播放。修正在线音源准备完成后 Activity 未同步 originalUri 导致播放器入口失效的问题。

验证：assembleDebug / assembleDebugAndroidTest / lintDebug 通过；完整设备集成 39 项通过（原播放 34 项及隔离账号存储 5 项），分段试听前台定向连续 3 次、24 项检查通过。旧测试在后台曾出现一次续播超时及一次播放已暂停的超时，未记录到旧运行的焦点事件，不能据此断言根因；当前测试先将应用置于前台，全部通过。额外修正停止队列时同步持久化清空，避免测试进程退出后恢复旧测试队列。

真机目视与交互：PKR110 原尺寸检查发现页、个人页、头像菜单和胶囊导航；真实账号头像、每日推荐、推荐歌曲、推荐歌单、个人歌单已加载。已点击每日推荐歌曲进入队列，系统媒体会话进入 PLAYING，打开完整播放器，返回可继续浏览。截图位于本机 validation/glass-final-discovery.png、validation/glass-account-final.png 等，默认忽略提交。

验收边界：尚未人工登录第二个真实账号；多账号的加密保存、切换、退出保留其他账号通过隔离存储测试。尚未完成全部字号与窄屏适配；完整播放页仍保留现有布局，本轮主要替换两个主页。

## 歌曲列表采用参考方案 B（2026-11-13）

用户选择第二版“封面歌单”。新增 SongListPanel，统一应用于每日推荐、推荐歌曲、个人歌单、收藏歌曲与搜索结果的歌曲列表。顶部为真实封面、歌单名称、可用的创建者与简介、歌曲数量和总时长；元数据不全时省略未知信息，返回部分曲目时明确标注载入数量。原主页面保留发现 / 个人及迷你播放器，列表顶栏收敛为返回、搜索和歌单操作。

列表为纯黑底紧凑行，包含编号、真实专辑封面、歌曲与歌手/专辑信息、歌曲操作；当前播放/暂停标记通过独立绘制呈现，并按歌曲 ID 同步，不靠歌名匹配。下载和已分轨徽标只从实际成功下载/有效结果文件生成。长列表初次绘制 50 首，通过“显示更多”追加，避免一次创建数百个带网络封面的原生视图。

播放全部、随机播放、歌曲播放、下一首播放、加入队列和播放器入口接入现有服务。普通点歌保留当前播放模式，随机按钮显式切换随机模式。下载按钮打开用户选择框，确认后逐首获取音源并加入系统下载队列；仅试听/不可用项目跳过并反馈数量，未绕过音源权限。

验收：assembleDebug / lintDebug 通过，最新版安装 PKR110。实机查看每日推荐 33 首和个人收藏 758 首，确认封面、创建者、真实时长、长标题截断、当前项标记、歌曲操作菜单、下载选择框及返回路径。点击每日推荐首曲后媒体会话切换为该曲且进入加载/播放流程。下载选择框只检查打开与取消，未为验证额外提交实际下载；大字号/窄窗口尚未全面覆盖。本轮未改播放服务，不重复声称重新执行此前 39 项服务检查。

视觉参考：design/song-list-reference.png；实机截图：validation/cover-list-final.png 等（本机忽略提交）。

## 照片卡片播放页与拉动切歌胶囊（2026-11-13）

采用用户最后提供的 JPG 布局，参考保存在 design/player-photo-card-reference.jpg。原生 Canvas 按 931×2048 坐标缩放：黑底、顶部收起柄、白色发光歌曲卡、右侧封面胶囊、虚线进度、喜欢、左下人声/原声/伴奏三档、右下播放按钮。封面、标题、歌手、专辑和剩余时间使用实际歌曲数据；没有把参考图直接当作界面。喜欢按钮读取实际收藏状态，用户点击后才提交收藏变更。

胶囊拉动为持续速度控制：向下拉时队列游标增加，封面列表向上滚；反向拉则反向滚动。超过触摸阈值后，手指保持固定位置也继续滚。拉动强度按 220 个设计坐标单位达到上限，速度为强度平方×24 首/秒；小幅拉动便于细选。顶部白色竖向波浪线随强度变长、变直，完全绷直时达到上限。队列首尾停止，不越界循环。松手停止并吸附到最近歌曲，只在松手后提交切歌；取消手势恢复当前曲目。浏览过程中原曲持续播放，暂停状态也不会被浏览改变。

切歌更新同一个播放弹窗，避免回到主页闪烁。同一曲目的元数据刷新保留正在进行的拉动；外部实际切歌会取消旧手势，后续旧 MOVE 事件安全忽略。长按胶囊打开完整队列，长按三档音轨栏打开分轨管理/导出入口。尚未分轨时选择人声或伴奏会启动分轨，首段就绪后切换，保留原播放/暂停意图。

验证：assembleDebug、assembleDebugAndroidTest、lintDebug 通过；PKR110/API36 上 `-e suite photo` 39 项播放页交互/布局检查通过，普通播放服务集成另 39 项通过。播放页测试使用 60 首本地测试队列验证固定拉幅持续滚动、幅度影响速度、满幅上限、反向/取消/松手吸附、原曲播放不中断、元数据刷新/外部切歌竞争、长按分轨菜单；另覆盖进度、播放暂停、实际模型生成首段后切换人声。截图检查 6 个布局/颜色采样位置，人工检查真实在线歌曲封面与元数据及小幅/满幅波浪线。

截图：validation/photo-player-real-song.png、photo-player-geometry.png、elastic-rail-small-pull.png、elastic-rail-full-pull.png。字体、真实封面和歌曲状态随设备/内容变化，六个采样点通过不等于全像素完全一致。当前实机验证尺寸为 1264×2780；其他屏幕比例、大字号与完整无障碍操作未全面验收。收藏 API 写入未为测试额外操作用户真实收藏。

## 五项切歌、姿态卡片与跟手收起（2026-11-13）

本节更新上一节播放页：移除专辑文字和点击入口，歌名可用宽度扩至 540；顶部收起柄和命中区域左移 277 个设计单位。黑色空白处与顶部柄允许向下拖动，整页按实际触摸位移平移并露出下层页面；短距离释放/取消回弹，超过页面高度 18% 或达到有效下甩速度后收起。卡片、切歌胶囊、进度和音轨控件不启动空白手势。收起只关闭页面，保留服务状态。系统边缘手势区可能优先于应用接收触摸。

右侧胶囊加长至设计坐标 y=310..1215，可显示五项封面；上下采用独立离屏图层的透明渐变遮罩柔化裁剪，不把封面与背景一起擦除。持续拉动速度、波浪线张力和松手提交规则保持，当前项周围按五项窗口滚动。

卡片接入 GAME_ROTATION_VECTOR（不可用时使用 ROTATION_VECTOR）姿态传感器，使用打开页面时的姿态作为基准，低通平滑后限制俯仰/横滚到 ±9°。Canvas Camera 为封面、卡框和文字统一添加透视；阴影跟随同一投影扭曲，并随倾斜改变偏移及模糊范围。页面关闭即注销传感器。没有传感器时保留静态卡片。

验证：Debug APK、测试 APK 和 lint 构建通过，安装 PKR110。最新 `-e suite photo` 共 52 项通过，包括原播放页操作、传感器实际注册、倾斜输入到透视路径、下拉位移与原生收到的手指位移一致、取消/短拉回弹、长拉收起、重新打开及左侧按钮。已查看五项渐隐、倾斜卡片/阴影和下拉露出主页的截图。透视测试使用受控姿态输入；没有远程代替用户人工拿起手机评估实际倾斜手感。服务代码未改，本轮不重复计为重跑服务套件。

新增实机截图：validation/player-tilted-card.png、player-pull-following.png、player-left-handle.png；五项窗口见更新的 validation/elastic-rail-small-pull.png。

## 卡片抵消转动与静止复原（2026-11-13）

按用户手持反馈反转左右透视方向，俯仰/横滚补偿按实际弧度转换成角度，上限由 ±9° 提高到 ±24°。目标是通过相对手机的反向透视，让卡片视觉上保持原平面；这是屏幕内两轴姿态补偿，没有空间位置追踪。阴影沿用同一透视与倾斜偏移。

手机最后一次有效转动后静止 1000ms，开始平滑回正，同时将当前手机姿态设为新基准。0.45° 以内的累计姿态噪声不刷新定时器；新的有效转动取消复原并重新计时。回正动画不依赖后续传感器事件，稳定姿态不会回正后再次跳回倾斜。关闭页面时清理复原任务。

验证：Debug、测试 APK、lint 构建通过并安装；最新播放页套件 60 项通过。增加方向、物理角度比例、24° 上限、持续运动重置等待、静止采样不延期、无新采样也能回正、新姿态基准不反弹及再次转动的检查。人工检查受控倾斜的实际渲染截图 validation/player-counter-tilt.png 和回正图 player-restored-plane.png。修正长队列测试在持续滚动时预读目标与真实松手时刻之间的竞争：先将拉幅归零，再检查松手吸附。真实手持观感仍由用户现场体验反馈。

## 跟手横滑与阴影方向调整（2026-11-13）

用户最终选择以卡片左右滑动切换胶囊状态，点击不切换。右滑收起胶囊、左滑展开；拖动时卡片平移/缩放、胶囊移出/淡化实时联动，松手吸附。收起时卡片中心位于屏幕横向中心、放大 8%。命中区域随卡片的实际透视及缩放变化，隐藏胶囊不拦截触摸，辅助功能提供展开/收起操作。

根据后续反馈，完整手势行程从 107.5 提高至 280 个设计单位，降低响应速度约 2.6 倍；超出边界使用最大 60 个设计单位的渐增阻尼，松手回弹，可中途反向。UiMotion 统一胶囊吸附、页面收起/回弹、姿态回正和通用点击反馈的 cubic-bezier(.22,1,.36,1) 曲线，作为柔和原生动效的近似，没有声称复用 Apple 私有实现。姿态静止等待改为 500ms，之后用 400ms 曲线回正。页面回弹结束显式对齐零位移。

按用户手持反馈，将卡片阴影的垂直偏移由 tiltX×3 改为 −tiltX×3；卡片本身的透视和左右阴影保持原逻辑。Debug、测试 APK、lint 构建通过，最新安装 PKR110，播放页 74 项检查通过；检查了受控倾斜阴影及跟手、居中放大、越界阻尼的实际渲染。截图为 validation/player-counter-tilt.png、player-capsule-follow.png、player-capsule-hidden.png、player-capsule-rubber.png。真实拿机方向/手感仍以用户现场体验反馈为准。

## 移除顶部按钮、降低下滑退出门槛（2026-11-13）

移除顶部收起柄的绘制和点击区域，原区域成为普通空白。下滑收起距离阈值从页面高度的 18% 改为 8%，下甩速度阈值从 900dp/s 改为 500dp/s，最小有效下甩距离从 2 倍触摸阈值改为 1.5 倍；拖动仍保持跟手，未达门槛松手或取消则回弹。退出动画保持统一曲线，时长从 320ms 调为 280ms。速度采样改用屏幕坐标，避免页面自身平移影响手势速度。

Debug、测试 APK、lint 构建通过，安装 PKR110，播放页最新 76 项检查通过。检查更短距离可退出、短拉/取消回弹、顶部按钮及命中区域已移除、系统返回仍可收起。测试注入 DOWN/MOVE 之间增加 20ms 帧间隔，避免零间隔跳跃触发设备输入预测；查看实际渲染 validation/player-no-top-button.png。

横滑灵敏度后续调整（2026-11-13）：按用户反馈，将胶囊完整横滑行程从 280 降为 220 个设计单位，同距离响应提高约 27%，保留越界阻尼和缓动。构建、lint 通过并安装；首次回归被其他应用切换前台中断，重跑播放页 76 项通过。

左侧越界联动（2026-11-13）：完全展开后继续左滑，胶囊获得卡片越界位移的 60%，随同一曲线回弹至默认位置。同步移动胶囊触摸区域，空白手势命中计算读取实际平移；扩大离屏绘制范围避免左移时被裁断。构建、lint 通过并安装，最新播放页回归 78 项通过，覆盖胶囊越界移动和触摸区域一起回弹。实际渲染截图：validation/player-capsule-left-overpull.png。此前一轮测试因测试代码读取已取消手势而崩溃，最新重跑通过，不作为生产界面崩溃记录。

姿态参数后续调整（2026-11-13）：微动过滤阈值为 1.2°，到 4° 平滑恢复完整响应；回正等待仍为 500ms，回正动画放慢为 900ms，采用 UiMotion 曲线。用户要求局部修改按范围验证，后续不再默认执行整个播放页套件。

最新转角上限提高到 ±45°，透视强度设为 1.2，通过相机距离 −18/1.2 增强深度投影，避免直接放大转角而突破 45° 上限。相关上限断言同步更新以供以后专项回归。本次仅 assembleDebug 构建、参数核对及 PKR110 安装通过，没有执行全套测试。

## SVG 手绘收藏按钮（2026-11-13）

用用户选定的白色粗笔轮廓、红色粗排线替换播放页原实心爱心。图形源为 design/hand-drawn-heart-button.svg，副本随 APK 放入 assets；SketchHeartButton 读取 SVG 的 M/L/Q/Z 路径、排线宽度、内轮廓裁剪和干笔遮罩，用原生 PathMeasure 顺次绘出十笔红线。没有在手机图标中嵌入 WebView 或执行 SVG 脚本；浏览器 turbulence 毛边在原生端以矢量干笔遮罩近似。

实际收藏成功回调启动约 1.15 秒的逐笔填充，取消喜欢反向擦除约 0.65 秒；加载已有收藏/切歌时直接同步状态，常规播放状态刷新不重新触发或打断动画。按钮作为独立原生 View 重绘，保留原命中范围和收藏接口；页面关闭取消动画。SVG/HTML 可交互设计预览保留在 design/heart-button-preview.html。

Debug 与定向测试 APK 构建、安装通过。PKR110 运行 `-e suite heart` 的十项收藏按钮检查通过，包含真实触摸、填充中间态、填满、擦除/中途反向、状态刷新与生命周期。该分支使用本地模拟收藏回调，不提交真实账号收藏，不替换播放队列；没有运行其他播放回归套件。已查看 native-heart-filling.png、native-heart-filled.png 的实际渲染。真实网络收藏写入不为测试额外执行。

### 连点与等速修正（2026-11-13）

原收藏请求复用了通用 requesting 门闩，忙碌时会忽略新点击；动画也等网络成功才更新。现在按钮立即反馈，每首歌保存最后意图，200ms 合并连点；单个收藏写入在途时继续接收点击，只在旧请求完成后补交仍然需要的最终状态。旧成功/失败不能覆盖较新的选择，当前请求失败时回退到确认状态。收藏使用独立串行工作线程，捕获账号 cookie，切换账号/销毁页面清理待发送操作；正在加载的旧收藏列表通过修订号隔离。

填充与擦除统一为完整行程 650ms，使用同一 UiMotion 曲线；中途反向按剩余行程缩短时长。SVG 设计源、预览和 APK 资源同步更新。构建及安装通过，仅运行收藏相关验证：13 项受控请求合并检查，以及 PKR110 的 12 项按钮检查（含八次快速原生点击），均通过。没有执行其他功能回归，也没有为测试写入真实收藏。

播放图标后续调整（2026-11-13）：暂停时显示的三角形缩小约四分之一，并按视觉重心对齐按钮中心 (781,1815)，降低阴影偏移。按用户最新要求移除灰色圆底及外圈，仅保留白色播放/暂停图标；点击区域沿用原大小。assembleDebug 与 PKR110 安装通过，仅核对本处绘制参数，没有运行整套测试。

## 收起形变与并排悬浮胶囊（2026-11-13）

SpatialPlayer 下拉以独立进度驱动，播放键固定在屏幕设计坐标 (781,1815)。前半段页面跟手平移；后半段圆角裁剪逐渐收成圆形，再变成黑色胶囊。封面在裁剪范围内缩为圆形、移动到播放键左侧。胶囊是真实迷你播放器，播放键接服务，封面反向展开全屏。PlayerMorph 共享最终几何和图标，避免收起交接时位置跳变。

右侧胶囊先按用户要求放大两倍，后续回调到原版 1.5 倍：边界 (566.5,1725)..(883,1905)，圆形封面直径 129；播放图标不随胶囊放大，中心保持固定。左侧导航改为黑色悬浮胶囊，保留发现/个人入口，设计边界 (28,1745)..(467,1885)，与迷你播放器中心线平行。完整迷你旧栏隐藏，主页默认使用新的悬浮播放器。

父容器不画底部整块遮罩、不保留 body 底部占位，主页内容可延伸到胶囊后；仅实际胶囊区域拦截触摸，内容尾部增加滚动留白便于翻到最后。主页默认隐藏状态栏，回到前台及获得焦点时保持隐藏，可通过系统手势临时调出。已在 PKR110 实际查看状态栏隐藏、调整后胶囊大小和导航，并从两胶囊空白处滑动确认主页可滚动。截图：validation/floating-capsules-final.png、floating-capsules-scroll-through.png。

修正固定播放图标的父层缓存：播放状态改变时主动刷新 Layout，解决从迷你胶囊展开后图标不切换。最新专项 play-icon 三项检查通过，验证展开及原生点击回调后的暂停/播放实际像素；此前 morph 八项定向检查验证跟手、圆形裁剪、收起交接、迷你播放、封面展开及短拉/取消。后续仅做本轮参数/主页相关检查，未运行全套播放器测试。最终 Debug/定向测试 APK 构建、PKR110 安装通过；验证不写入真实收藏或替换播放队列。

胶囊与封面动效更新（2026-11-13）：导航与迷你播放器统一黑色胶囊高度 180，两侧屏幕边距均为 84 个设计单位，向中间靠拢；导航宽度 370，播放器边界 (530.5,1725)..(847,1905)。迷你胶囊支持左滑、上滑展开，右滑、下滑不展开。封面独立绘制，贯穿全程连续缩放、移动和圆角变化，其余控件在收起进度前 48% 淡出；页面缓存减少逐帧重绘。实机查看中间帧，play-icon 八项相关检查通过，不改账号或队列。按用户最新反馈，展开时长由 900ms 缩为 520ms，收起由 850ms 缩为 480ms，取消回弹 280ms，保留曲线；最后这次仅时长调整构建并安装通过，没有重复运行测试套件。

下滑收起衔接修正（2026-11-13）：松手时补入最后触点位置，用屏幕坐标速度接入单调 Hermite 收尾，避免从零速度重新 ease-in。收尾时间按剩余进度平方根缩短，快速下甩继续缩短，以不超过 3 的归一化起始斜率避免越界，最终速度为零。点击展开时长仍为 520ms。过渡快照宽高各减半，封面仍单独以原图绘制；快照直接带透明度绘制，完全淡出后跳过，移除每帧整屏 saveLayer。Debug 和定向测试构建、安装通过，只执行 pull-settle：32 次定向断言（含逐帧单调检查）通过，已查看实际拖动截图 validation/pull-settle-following.png。没有运行其他套件或更改账号/队列；真实手持停顿感仍以用户反馈为准。

控件延后淡出（2026-11-13）：按用户反馈，其他控件在收起进度 0..55% 保持完全可见，55%..92% 以 smoothstep 平滑淡出，封面形变和速度衔接保持。构建、安装和仅 pull-settle 定向检查通过（34 次，含逐帧断言）。本次截图时设备已切回桌面，不作为界面验证证据。

可逆展开与首尾交接（2026-11-13）：迷你胶囊左滑/上滑在手指移动时实时控制展开，同次手势可反向收回，取消则回到胶囊；松手后的自动展开可再次按住接管，从当前帧继续向右/向下收回。原手势保留在 Activity，非交互 Dialog 承载渲染，松手恢复正常触摸和焦点。胶囊常驻主页上方，translationZ 为 32dp，取消窗口首尾的隐藏/显示交接。修改前的真实跨窗口触摸 11 项检查通过；最新原生 View 事件定向 capsule-drag-native 13 项通过，查看了原生视图实际绘制的 capsule-opening-following.png。物理注入复测有一次被前台实际页面操作打断，不作为通过证据；没有运行全套。
播放键微调：共享图标及全屏点击区左移 18 个设计单位，迷你胶囊点击分界同步左移，全屏与胶囊参考中心为 (763,1815)。此局部调整仅 assembleDebug 构建及 PKR110 安装通过，未重复运行测试。

双击空白收藏与填充触感（2026-11-13）：全屏播放页空白区域使用系统 GestureDetector 识别双击，第二次抬手才提交仅添加收藏意图；已喜欢时不写请求、不取消、不重启动画或触感。卡片和控件区域、移动超过触摸阈值、多指、取消、页面形变以及切歌会中断识别。原爱心按钮仍可显式取消收藏。填充动画以原生触感在开始、时程四分点和结束给出短反馈，间隔至少 80ms；中间使用 SEGMENT_FREQUENT_TICK（低版本 CLOCK_TICK），不持续振动，遵循系统触感设置。擦除、静态同步、关闭或取消动画不继续触发填充反馈。构建、PKR110 安装及仅 blank-favorite 定向 14 项检查通过，验证添加幂等、命中排除、移动取消、原按钮取消动作及触感阶段与生命周期；回调为本地模拟，不写真实收藏或替换队列。检查证明触感请求和阶段执行，实际手持强弱仍由用户体验。

填充触感加密（2026-11-13）：根据用户手持反馈，将完整填充的节奏分段从 4 提到 12，650ms 时程下目标间隔约 54ms；最短触感间隔从 80ms 降为 35ms，保留轻微 SEGMENT_FREQUENT_TICK 和系统设置约束。构建与安装通过，本次只调参数，未重复执行测试。

## 手绘 SVG 播放操作（2026-11-13）

按用户认可的生图描摹白色粗笔轮廓，输出七种独立 SVG 状态及三个 Android SVG 资源；设计源和静态预览在 design/playback-icons/，可用 scripts/build-playback-icons.py 复现。排线宽 12.0..13.4 个 SVG 单位，间距 27，接近收藏爱心的粗排线；保留黑缝。SketchActionButton 读取 SVG Path/clip，原生逐线绘制填充和完成大勾，不嵌入 PNG 或 WebView。收藏、循环、随机、下载四个原生按钮从左至右并排，点击范围均 122×129 个设计单位，间距 12。

按后续反馈，将循环与随机拆为独立状态：循环为关闭/列表/单曲，随机只决定选歌顺序。循环与随机可同时激活；单曲循环下自动重复当前歌曲、手动切歌走随机；关闭循环时随机播完一轮停止；列表循环下继续新一轮。开关随机不改变循环设置，切换循环不重置随机剩余队列。服务、锁屏操作、设置、歌单随机入口和持久化同步更新，旧 SHUFFLE 设置恢复为列表循环加随机。

播放页下载沿用音源解析和 DownloadManager；处理中禁用重复点击，排线反映进度，只有系统成功状态或本地歌曲显示大勾。记录下载任务与歌曲 ID 关联，兼容旧文件名；切歌立即清掉上一首的大勾，后台检查仅在页面前台可见时进行。音源失败允许重试，试听音源沿用原来的限制。

验证：Debug 和定向测试 APK 构建安装 PKR110，通过仅 sketch-controls 的 20 项检查及 PlaybackOrderTest 队列专项检查；覆盖模式共存、单曲自动/手动行为、随机一轮耗尽/历史、旧状态恢复、按钮命中、下载进度/成功/失败/歌曲隔离。查看原生视图实际渲染 validation/sketch-controls-loop.png、sketch-controls-shuffle.png、sketch-controls-downloaded.png，粗排线和并排布局已核对。定向测试使用模拟操作回调与系统下载游标数据，不修改真实账号、播放队列或新增下载，没有运行其他套件；未额外执行真实歌曲网络下载。

图标填充修正（2026-11-13）：随机图标右下箭头在交叉处开口，原闭合区域识别遗漏了它。现在只在填充分析蒙版上临时封口，原始轮廓和交叉间隙保持，右下箭头纳入同一排线裁剪范围。已下载状态保持白色粗排线满填；完成勾移到图标中央，并保留黑色细分隔保证叠加可辨识。设计 SVG 与 APK 资源同步重新生成。构建安装、仅 sketch-controls 的 21 项相关检查通过，新增右下裁剪区域检查，下载完成断言同时等待填充和勾画完；已查看两张原生实际绘制状态。未运行其他套件或新增真实下载。

切歌胶囊默认与闲置行为（2026-11-13）：默认 capsuleFraction=1，卡片居中放大，右侧胶囊不占触摸区域。展开后无操作 1000ms 开始沿原曲线收起；任何页面触摸会重置计时，按住横滑或持续选歌时暂停，松手后重新计时。全屏形变时暂停闲置任务，关闭清理任务。此前仅 capsule-idle 的 14 项专项检查通过，已查看 validation/capsule-default-hidden.png。

封面加载修正（2026-11-13）：原预加载范围是 preview±2，队列两端与实际显示的五项窗口不一致；失败请求永久留在 requested 中，图片加载器关闭时还会清掉自身缓存。改为按实际窗口加邻项请求 256px 缩略图，当前/预览图另取 960px；快速滚动也更新小封面预加载，缩略图单独保留 64 项，大图清理不再一起清掉小图。32MiB 共享图片缓存跨页面实例保留。请求仅在在途期间去重，成功/失败单次释放监听器，失败受限退避重试，重新展开允许再次尝试；修复双重清理可能删除新重试监听器的竞争。封面 URL 兼容 al/album/顶层字段回退，网易 CDN 替换旧 param，其他源不附加网易尺寸参数，解码做采样。

Debug 与定向测试 APK 构建安装通过。只运行 rail-artwork：缓存复用、加载失败重试、尺寸参数、五项首尾预加载与滑回保留均通过；额外从现有队列只读获取五个真实 CDN 封面，在 PKR110 成功加载，查看原生绘制 validation/rail-artwork-live.png。测试未修改账号或真实队列，没有运行其他套件。随后仅删除测试里的无条件计数，不改运行代码、不重复跑测试。

切歌胶囊闲置等待后续调整（2026-11-13）：无操作等待由 1000ms 改为 2000ms，默认隐藏、操作暂停计时、松手重计及原有收起动画保持。仅构建和 PKR110 安装通过，定向测试时序已同步调整，本次未重跑测试。

按钮等距与双侧切歌胶囊（2026-11-13）：收藏、循环、随机、下载按左右 84 个设计单位边距均匀分布，按钮宽 122，中心步长约 213.67；绘制与原生命中区域一起移动。胶囊隐藏状态下右滑卡片，从左侧呼出；左滑仍从右侧呼出。左侧打开时卡片向右让位，隐藏后均回到居中放大状态；按方向换算滑幅、速度、越界联动与回弹。胶囊图层在平移后创建裁剪层，避免左侧被裁掉；空白命中减去实际控件平移，左侧选歌不会被下拉手势抢走。保留 2 秒闲置隐藏。构建安装通过，仅 capsule-sides 五项相关检查通过，核对左侧和右侧原生绘制。之前的等距调整已构建安装；其 layout-only 参数读取已修正为 instrumentation 字符串参数，没有额外运行其他套件。

切歌胶囊手感综合试调（2026-11-13）：手势行程 220→260 设计单位（当前设备约 101dp），卡片中心位移 107.5→128（约 50dp），普通状态缩放差 8%→4%。松手以当前原始进度加 0.16s 速度投影选端点，带入真实归一化速度；解析弹簧 omega=19、阻尼比=.9，按实际时间求解，同一标量驱动位移、缩放和回弹，不再固定 420ms 缓动。重新按住从当前进度接管。越界阻力随距离增加，空间深度最多额外缩小卡片 3%、胶囊 1%；额外屏幕位移再限于 24 个设计单位，保持卡片边缘可见，胶囊跟随更少。普通胶囊位移使用平滑进度，避免越界前后硬切；命中与缩放平移一致，露出部分时即响应。

拖卡期间冻结传感器对卡片姿态的影响，吸附完成后以最新手机姿态重建基准，再沿已有回正曲线恢复。自动隐藏仍 2 秒，从完全停稳且触摸结束后计时。没有重构绘制后端，也没有对掉帧率作未测量的改善声明。构建安装通过，仅运行弹簧连续性/稳定收敛专项及 capsule-sides 扩展后的 13 项原生检查，覆盖左右呼出、命中、收起、闲置、越界缩小、姿态冻结和中途接管；查看了实际原生绘制 capsule-overtravel-depth.png。未执行其他功能回归，实际手持感受待用户体验。

卡片缩放与双击收藏（2026-11-13）：隐藏胶囊时卡片比例仍为 1.04，展开时从 1.00 降为 .92，用同一平滑进度和弹簧连续衔接，越界额外缩小仍最多 3%。收藏双击范围扩至实际透视卡片与空白区域；第二次抬手时才提交添加，已收藏不取消。移动、多指、控件点击和页面形变仍取消双击识别，原心形按钮可明确取消收藏。构建安装通过，仅 blank-favorite 更新后的 16 项相关检查通过，查看 card-zoom-hidden.png / card-zoom-revealed.png 原生绘制；不写真实收藏或替换队列，未运行其他套件。

全屏下滑收起（2026-11-13）：播放页所有区域均可开始向下拖动，包括卡片、切歌胶囊、进度条和操作按钮。父容器依据首次有效方向接管：向下优先页面收起，横向锁给原控件，上滑保留选歌。SeekBar 不再永久屏蔽父层方向判断；接管时发送的取消事件禁止提交 seek/source/favorite/play。接管 MOVE 当帧就更新形变进度，避免等下一帧；页面拖动期间冻结胶囊吸附，取消回全屏后恢复其状态。构建、安装和仅 full-pull 的 16 项专项通过，覆盖六个区域下滑、无误点击/误提交、横向进度控制和取消恢复，查看 full-screen-pull-following.png 原生绘制。没有执行其他套件或改动真实账号/队列。

全屏下滑例外调整（2026-11-13）：按用户补充，切歌胶囊区域排除页面下滑收起，向上/向下均保留原选歌逻辑。按原生 View 逆矩阵判断触点，兼容左右侧、平移、缩放与越界位置，隐藏胶囊不占区域。其他卡片和控件区域仍可下滑收起。构建安装和仅 full-pull 的 17 项专项通过，包含左右胶囊排除及其他区域收起，没有运行其他套件。

姿态按屏幕帧补间（2026-11-13）：移除传感器事件中 32ms 重绘门槛，传感器仅写目标角度，Choreographer 在实际屏幕帧回调中用 alpha=1-exp(-dt/.06) 追踪目标。按实际帧间隔计算，避免固定每采样 .22 平滑导致响应随采样率变化；误差小于 .015° 停止调度，无目标变化不重复启动。微角死区、45° 上限、500ms 静止等待及 900ms 回正保留，回正/拖卡/胶囊吸附/页面形变时停止或暂停补间，关闭移除回调。

构建安装和仅 pose-smoothing 的 14 项相关检查通过：受控目标间补帧、递增响应不超调、拖动冻结、45° 上限与关闭清理；查看 pose-smoothing-native.png 原生绘制。实机显示报告 90Hz，受控测试 760ms 内执行 40 次补间回调，约 53Hz；这是回调节奏，含测试注入和断言开销，不能当作屏幕实际呈现帧率，没有做呈现 FPS/掉帧率测量，没有执行其他套件或改队列。

透视倍率恢复（2026-11-13）：按用户要求将 PERSPECTIVE_STRENGTH 从 1.2 恢复为默认 1.0，相机距离恢复 -18。45° 角度上限和按帧姿态补间保持。仅 assembleDebug 构建与 PKR110 安装通过，未重复运行测试。

### 2026-11-13：手机平移的短时空间暂留

- 播放卡片接入 TYPE_LINEAR_ACCELERATION，按显示方向转换坐标，在屏幕刷新回调中产生反向惯性偏移；卡片及阴影共用变换。
- 这是有界视觉近似，不是世界坐标定位。低于 0.12m/s² 的输入过滤，位移矢量上限 42 设计单位；停稳约 0.5 秒后阻尼回位，避免持续积分漂移。
- 卡片拖动、切歌胶囊回弹和页面收起期间暂停；关闭播放页注销传感器和帧回调。设备无对应传感器时保持原有旋转效果。
- 保留 45° 旋转上限、默认透视强度与既有旋转平滑处理。
- 验证：SpatialHoldTest 在 30/60/90/120Hz 下验证方向、边界、噪声过滤和回位；手机 spatial-hold 专项 6 项通过；构建、安装通过。已查看原生渲染截图 spatial-hold-native.png（测试数据无封面），未对真实手持移动的主观手感作远程结论。


切歌空间交接（2026-11-13）：胶囊呼出后同向再滑切歌。拖动阶段卡片跟手倾斜退深，松手后固定旧卡内容，与新卡交叠过渡；Camera Z 位移、Y/Z 旋转、缩放与侧向位移共用同一弹簧进度，保留松手速度。支持再次触摸结束交接，系统关闭动画时直接切歌。已构建安装；track-depth 的 14 项专项通过并查看原生中间帧，左右切歌使用隔离回调，不改真实队列。手持主观体验待用户验收。

切歌跟手修正（2026-11-13）：移除第二次滑动进度 .24 的硬上限；行程归一化从 1400 降至 560，前 .75 线性、末段渐进阻力至 .95。切歌拖动期间不再叠加胶囊越界回弹。修正切歌帧只 invalidate 父布局的问题，直接 redraw 实际 Scene；切换中卡片内容缓存为两张有限大小纹理，避免逐帧重复阴影/文字和整层透明合成，关闭页面释放缓存。动画中按住保留当前进度，允许反向拖动接管，松手续接且不重复切歌。构建安装通过，track-depth 24 项（含长行程、连续实际 Scene 绘制、接管不跳帧与不重复提交）和 capsule-sides 13 项通过，查看原生过渡帧。未测量 FPS/掉帧率，手持体验仍待用户验收。

连续切歌与反向收起修正（2026-11-13，覆盖上一段的反向接管规则）：取消重按时暂停并倒拖旧切歌动画的行为。新 DOWN 先完成旧交接并清理旧卡状态，允许当前卡片及交接前静止卡片区域开始新手势；每次同向滑动独立提交下一/上一首。展开时反向有效横滑直接收起胶囊，不再受过半行程门槛限制，不切歌也不倒拖交接。构建安装通过；track-depth 36 项覆盖左右各连续 4 次切歌、动画未结束时再滑、真实 track() 元数据回调、短反向关闭和逐帧重绘，使用隔离队列回调。

相邻卡提前露出（2026-11-13）：第二次同向拖动初段即绘制真实相邻卡，透明度进度窗口从 .08–.60 提前至 0–.24，松手沿用相同空间进度。播放仍只在松手确认后提交；反向关闭胶囊、连续切歌规则保留。PlaybackOrder.peek 只预留随机候选而不消耗候选或推进播放，确保随机模式预览与后续实际切歌一致。构建安装通过，track-depth 扩展至 40 项，包含短拖未松手已绘制相邻卡且无播放提交，连续各 4 首及反向关闭；PlaybackOrder 本地回归含 30 轮随机预览/提交一致性。查看 track-early-next.png 原生拖动帧。

切歌终点衔接修正（2026-11-13）：以有限时长、单调 Hermite 轨迹取代渐近弹簧尾段，起始切线依松手速度并限制在单调范围，终点准确到位且速度为零。平移、透视纵深、原姿态和惯性偏移在同一段 320–420ms 轨迹结束；不再在已展开的切歌路径启动冗余胶囊弹簧及其延迟 resetPlane，切歌期间阻止姿态输入/回正插入。终点同时更新姿态基准，避免落位后再回正。构建安装通过，track-depth 46 项：新增左右切换的末帧/静止位置差小于 .08 设计单位、落位后 650ms 无二次位移、无延迟回正动画；保留连续各 4 首、反向关闭与早期预览检查。测试使用隔离播放回调，主观手持体验待用户验收。

切歌掉帧实测与硬件绘制（2026-11-13）：新增 track-profile 隔离 8 次同向切歌的真实 Window FrameMetrics 采样，测量不包含截图。原软件 Scene：246 帧，total p50=31.57ms、p95=44.79ms、max=75.91ms，164 帧超过系统 deadline，draw p95=30.30ms。去除 Scene 强制软件层；卡片用两个有界 RenderNode/GPU 合成层缓存绘制指令，软件截图保留原位图路径，关闭释放显示列表。完全不透明页面直接 dispatchDraw，免去全屏 saveLayer。最新硬件版：352 帧，total p50=6.79ms、p95=8.35ms、max=18.38ms，6 帧超过 deadline，draw p95=2.12ms。保留原始逐帧 JSON（track-profile-baseline/gpu/optimized.json）；中间 GPU 轮有单帧124.85ms尖峰，最终轮未复现，不能据此承诺无任何偶发掉帧。检查真实 UIAutomation 硬件窗口截图 track-hardware-optimized.png，阴影、透视、遮罩和交叠可见。构建安装及 track-depth 46 项通过；采样使用合成队列元数据且不触发真实音频/网络加载，不代表所有实际播放负载。
硬件版补充回归：full-pull 17 项通过，页面下滑与左右胶囊排除行为保留。

自动续播卡片（2026-11-13）：外部 track() 选择变化在无手势交接时也捕获旧卡、复位进度并运行同一有限轨迹；已在手势交接内的回调不重复启动。同步 rail 端点，重复同曲元数据回调不重启动画。GPU 卡片透明度改为每次绘制独立合成，避免相同缓存节点在同帧的两个引用互相覆盖 alpha；缓存轮换不再 discard 仍可能被当前显示列表引用的旧节点。构建安装通过，track-auto 25 项以无触摸的连续 4 首外部更新检查真实 GPU 屏幕中途及落位后卡片可见、延迟封面、无重复播放命令，track-depth 46 项通过；查看 auto-card-settled.png。该专项模拟续播元数据回调，未等待真实歌曲自然播完或改写真实队列。性能复查 track-profile-auto-fixed.json，隔离 8 次切换总耗时 p95=8.38ms。

反复来回卡片丢失再修正（2026-11-13）：撤销自管 RenderNode 卡片缓存，真实硬件 Canvas 直接记录并绘制卡片，不再维护可复用节点的显示列表/透明度生命周期；保留硬件加速，软件截图仍有位图缓存。track-auto 扩展至同两首来回 12 次、73 项通过。新增 track-roundtrip 用真实触摸事件在隔离回调中交替下一首/上一首 6 轮，每次确认真实硬件屏幕卡片存在及反向关闭；查看 roundtrip-card.png。帧采样 direct-gpu.json：p95=12.41ms，仍有一次130.13ms尖峰，不宣称完全消除掉帧。仍未修改真实队列或等待真实歌曲自然结束，实际手持待验收。
补充：track-roundtrip 54 项通过，6 轮手势往返均保留卡片。

胶囊正在播放封面强调（2026-11-13）：实际 current 项封面放大 6%、逆时针倾斜 4°；拖动预览不会将强调移到未播放项，保留原 preview 描边。横向遮罩范围扩至 724–879 设计单位，容纳旋转放大边角，纵向渐隐与命中/滚动逻辑保留。构建安装通过，capsule-sides 13 项及 track-profile 通过；查看真实硬件截图 rail-playing-emphasis.png。

胶囊手指选择与松手播放（2026-11-13，替代按 current 强调）：封面 6% 放大/逆时针4°倾斜及描边统一使用 Rail.selectedIndex()，按下即突出触点封面，拖动跟随 scrub 选中项；松手从同一函数取最终索引并提交 queue(index)，取消不播放。构建安装通过，rail-selection 5 项验证按下选中、未松手不播放、松手播放索引3、取消不提交、拖动后提交与强调项一致，均使用隔离回调不修改真实队列。

胶囊触点命中规则（2026-11-13）：Rail 保存最新局部触点，并通过与绘制共用的 railOffset() 将触点映射到封面行；放大/倾斜、预览和松手提交均使用该触点索引，不再使用 scrub.selected()（胶囊中间游标）。弹性滚动推进时也按静止手指下的新封面重新计算。构建安装，rail-selection 6 项通过（包含手指从第4张移至第3张时选中第3张，而游标仍在顶部），capsule-sides 13 项通过。

胶囊选择不预览大卡（2026-11-13）：railTick 不再写 preview，拖动只更新触点封面的强调和列表滚动；松手先保存触点选择，提交 queue(index)，大卡片由实际 track() 播放回调更新并交接，不提前换图。取消保持当前曲目。构建安装，rail-selection 7 项通过，包含持续拖动时大卡 preview 保持当前歌曲、松手播放触点索引与取消不提交，使用隔离回调。

胶囊侧面实时预览（2026-11-13）：按住选歌时，在胶囊朝大卡片的一侧绘制约1.5倍缩略封面，内容和纵向位置实时跟随 selectedIndex()；左右胶囊自动镜像位置。预览脱离列表渐隐遮罩，松手/取消/长按菜单时隐藏。大卡片仍由松手后的实际播放回调更新。构建安装、rail-selection 7 项通过，查看 rail-finger-preview-2/3.png 原生绘制，触点变动后预览位置随选中行改变。

侧面预览触发调整（2026-11-13）：仅 draggingRail 且 moved（已超过原拖动门槛）时显示侧面大封面；单纯按下/点击不显示，仍可松手播放触点项。构建安装、rail-selection 原7项回归通过。

移出胶囊取消选择（2026-11-13）：以原生 View 局部坐标映射到实际圆头胶囊轮廓，MOVE 或 UP 离开即清理选歌、长按与滚动回调，隐藏侧面预览，恢复当前歌曲并保留胶囊展开；该次手势回到内部也不恢复选择，松手不提交播放。构建安装，rail-selection 9 项通过，新增移出立即取消及重新进入后松手无误播检查。

上一首语义修正（2026-11-13）：删除 PlaybackService.step 中播放超过3秒时 seek(0) 并提前返回的分支，所有手动上一首请求直接按 PlaybackOrder.previous 遍历队列/随机历史，不再被转换成当前曲目重播。PlaybackOrder 本地回归、Android 构建与安装通过；未改写真实播放队列做音频回归。

长按翻面歌词（2026-11-13）：大卡片按住500ms触发，460ms透视Y轴翻面，中点切换正背面避免文字镜像，再次长按翻回。移动超过系统slop、多指、取消与关闭清理长按回调，长按抑制双击收藏。背面白色，黑色加粗歌词、下移柔影，缓存StaticLayout并按LRC时间戳随播放位置定位。首次翻面经现有NeteaseClient后台只读请求歌词，切歌时按歌曲id和对话框实例防止旧响应串歌；缺失/加载/错误显示对应状态，背面切歌会重新获取。构建安装；lyric-flip 8项含半秒门槛、再翻回、滑动/取消、LRC解析及真实歌词接口返回内容，track-depth46项与full-pull17项通过。查看 lyrics-card-back.png（自写合成测试歌词），无真实队列/收藏改写。

歌词背面排版加强（2026-11-13）：字号40→52，sans-serif-black加粗，阴影半径8、偏移(5,9)。每次仅绘制以当前句附近为中心的最多5句，每句最多两行并截断超长文本，固定行槽与底部信息分离；底部80设计单位微缩封面及歌名/歌手。构建安装，更新6句合成歌词的lyric-flip8项通过，查看 lyrics-card-back.png 确认仅5句且底部信息无遮挡。

歌词换句动效（2026-11-13）：新增340ms换句过渡，浮点窗口平滑上移、当前句3.5%强调与透明度/阴影渐变；最多绘制5句、底部信息固定。播放回调仅目标句变化才启动，从当前进度接管，支持拖进度反向重定向；歌词加载、正面隐藏及关闭取消/定位，关闭系统动画时直接落位。构建安装，lyric-flip11项通过，新增中间位置、反向接管不跳和准确落位检查，查看 lyrics-motion-midpoint.png。

长句完整显示（2026-11-13）：移除单句两行上限与省略号，按单句完整排版高度二分选最大可容纳字号；短句保持52，长句允许三行以上且独立缩字号，不缩其他句。仅缓存实际显示句的排版，按歌词更新缓存分句，避免动画帧中重复全文split/测量。构建安装，lyric-flip13项通过，含长句超过两行、完整末尾无省略号与槽位高度检查；查看 lyrics-long-sentence.png。

歌词滚动柔化（2026-11-13）：换句340→580ms，改用起止速度/加速度为零的五次平滑曲线；窗口索引跟随浮点位置，在交接前让离开/进入句完全渐隐，避免目标变化当帧直接删旧句。当前句强调缩放3.5%降至2%，保留最多5句和固定底部。构建安装，lyric-flip13项通过，含中途反向接管与准确落位。

歌词面收起封面起点（2026-11-13）：按用户选择2，不自动翻回。PlayerMorph.LYRIC_COVER 共享底部微缩封面边界，prepareCover 按实际可见面捕获源矩形/圆角和cardMatrix姿态；收起将该源矩形映射至迷你封面，圆角随源尺寸过渡。歌词页快照隐藏已接管的底部封面避免双影；翻转中收起冻结当前翻转角，取消收起保留歌词面。构建安装，lyric-flip16项及full-pull17项通过，新增底部源区域、实际透视位置一致与取消不翻面检查；查看 lyrics-footer-collapse.png。

正背面状态恢复（2026-11-13）：翻面写入 player-view/lyrics-back 本地偏好，关闭/收起按实际可见面再次保存；创建播放页时先直接恢复正/背面再展开，歌词面请求当前曲歌词，mini展开封面目标沿用该面的源区域。不会额外播放一次翻转动画，应用重开也保留面状态。构建安装，lyric-flip19项通过，含恢复背面、底部封面展开目标和恢复正面三项检查。

歌词面切歌预览隔离（2026-11-13）：drawTrackCard 增加 metadataOnly 标记，呼出的下一张/上一张卡片在拖动和交接阶段只显示对应歌名/歌手，不读取当前歌词及播放进度。提交后退出中的旧卡也使用旧曲元信息，避免新曲歌词写入后串到旧卡；交接结束才由主卡显示当前曲歌词。正面封面展示保留。构建安装，歌词背面下的 track-depth46项通过，查看 lyrics-incoming-metadata.png 原生拖动帧确认两张卡内容分离。

预览卡元信息样式补齐（2026-11-13）：切换中的歌词背面预览卡保留底部微缩封面及歌名/歌手，与正常歌词背面共用footer绘制。中间两项改用与歌词同源的52号sans-serif-black粗黑字体、(5,9)阴影偏移及居中布局，长名称按完整内容自适应字号；小型排版缓存避免逐帧测量。构建安装，track-depth46项通过，查看 lyrics-incoming-metadata.png。

切换到歌词的入场过渡（2026-11-13）：曲目变更时保持中间粗体歌名/歌手，等切歌轨迹结束且新歌词加载完成后，460ms五次平滑曲线让元信息淡出略上移、歌词淡入并上浮18设计单位。底部封面/元信息拆出过渡层，只绘制一次，保持稳定；新加载取消旧入场，关闭注销动画，关闭系统动画时直接落位。构建安装，lyric-flip22项和track-depth46项通过，含加载期间保留元信息、渐变中间态与完全显示终点检查，查看 lyrics-reveal-midpoint.png。

移出取消过渡（2026-11-13）：取消语义立即生效并禁止该手势后续提交，显示使用独立320ms收尾；侧面预览保留原选中封面，淡出/缩至75%并向胶囊收回，列表偏移、封面倾斜缩放及描边同步回到当前播放项。移出不更新触点选中，重复取消不重启动画，新按下可结束旧收尾并重新选择；关闭清理动画。构建安装，rail-selection11项及capsule-sides13项通过，新增取消中间态及结束清零检查；查看 rail-cancel-midpoint.png。

点击切歌列表平滑滚动（2026-11-13）：track更新前保存实际列表偏移，更新后以420ms五次平滑曲线移动到新曲窗口，松手提交前保留列表位置防止先跳再动。再次按住取消居中动画并以实际偏移锚定ElasticScrub游标，拖动可连续接管；关闭清理动画。构建安装，rail-selection14项通过，新增8首列表点击第5首的中间偏移、终点与实际播放回调一致、滚动中重新按住位置连续检查。

卡片双击翻面（2026-11-13，替代长按翻面/卡片双击收藏）：移除卡片500ms长按回调，双击同一张卡片在第二次抬手后翻转；单击/长按不翻面，双击卡片不收藏，空白双击收藏保留。移动、多指、形变或取消清理双击识别及首次点击归属，避免手势残留。构建安装，lyric-flip23项（含长按无效、单击无效、双击正反面）和track-depth46项最终通过，full-pull17项通过。切歌回归最初两轮出现落位稳定性/短帧窗口断言失败，补齐取消时首次点击归属清理后最终轮通过，未宣称这些失败全部具有已证实相同根因。

卡片传感器旋转反向（2026-11-14）：用户要求将卡片陀螺仪感应的旋转方向反转，pitch/roll 两轴的目标倾角同时取反；保留物理角度幅度、45°上限、死区、显示帧补间与回正。未反转独立的平移惯性效果。构建安装，pose-smoothing15项通过，验证两轴新方向、单调补间无越界、拖动冻结、恢复及关闭帧回调清理。

倾斜方向同步平移（2026-11-14）：移除播放页线性加速度传感器注册、惯性积分和位置暂留帧回调；平移改由当前已平滑倾角直接映射，横向tiltY×42/45、纵向−tiltX×42/45设计单位。与旋转共用显示帧进度和回正，正面/背面/命中与收起封面起点都使用同一cardMatrix。保留上一轮两轴旋转反向、45°限制、死区及现有姿态回正。构建安装，新spatial-hold（已替换旧惯性测试）3项验证方向、回正立即消除平移与无独立暂留漂移，pose-smoothing15项通过。

倾斜平移加大（2026-11-14）：最大单轴位移从42增至72设计单位（约1.7倍），保持原方向、45°旋转上限与同步回正。构建安装，spatial-hold3项通过。

旋转方向恢复（2026-11-14）：按用户要求恢复反转前的pitch/roll旋转符号；平移映射同步补偿旋转符号，因此物理平移方向不变，单轴72设计单位幅度保留。构建安装，pose-smoothing15项与spatial-hold3项通过。

平移反向并再次加大（2026-11-14）：用户要求平移方向也反过来，故将横纵平移符号同时反转，单轴最大位移72→110设计单位（约1.53倍），旋转符号不变、不恢复位置暂留。构建安装，spatial-hold3项通过。

透视与动作过滤调整（2026-11-14）：透视强度1→.55（相机后移），传感器渲染旋转按倾角75%输出，翻面角度不缩减；切歌透视相机保持同强度。倾斜过滤死区1.2→2°，显示帧低通时间常数60→110ms，增加180°/s角速度限制削弱突然晃动。平移保持当前方向与110设计单位幅度，不恢复位置暂留。构建安装，pose-smoothing16项（含小幅手抖过滤）及spatial-hold3项通过，查看 pose-filtered-perspective.png 原生绘制。

透视强度微调（2026-11-14）：按用户要求将 PERSPECTIVE_STRENGTH 从.55调为.60（60%），保留75%传感器旋转映射、动作过滤与平移设置。Android构建与安装通过。

撤回虚拟相机试版（2026-11-14）：用户明确要求返回上一版，移除刚加入的HoverProjection/OneEuroFilter及试验测试源码，恢复60%透视、75%渲染旋转、110设计单位反向平移、2°死区、110ms低通和180°/s限速及原回正逻辑。其他歌词/翻面/胶囊功能不变。重新构建安装，pose-smoothing16项与spatial-hold3项通过。

圆形展开分轨按钮与SVG接入（2026-11-14）：新增main/assets/stem-vocals.svg、stem-original.svg、stem-accompaniment.svg，统一64视图框、规整几何线条，运行时由StemModeControl读取实际SVG路径并绘制。替换底部SourceBar滑杆与标签，默认原声主圆；人声在右上、伴奏在右侧的小圆，260ms展开/收起。选中项与主圆交换，保持展开，再点主圆收起；主圆长按仍打开分轨管理。接回requestMode → vocals.wav/null/accompaniment.wav既有流程，实际播放状态通过setMode同步；模式文字仅用于无障碍描述。原生按钮取消事件防止下滑误提交，隐藏小圆禁用触摸/无障碍焦点，关闭清理动画。构建安装，stem-control10项与full-pull17项通过，查看stem-circles-expanded/vocals.png原生绘制。使用隔离回调验证控制交互和音轨参数，未重新运行真实分轨模型生成。

橙蓝分轨波形图标第3版（2026-11-14）：用户选定version-3参考图，重绘节奏型SVG。原声包含橙色#FF850A与蓝色#1677FF两条反相波形，人声与伴奏分别使用其中同一条路径，几何完全一致（XML结构校验通过）。StemModeControl按每个SVG path的颜色/线宽/填充分别读取绘制，保留展开、图标交换和分轨回调。构建安装，stem-control10项通过，查看stem-circles-orange-blue.png原生画面。

副按钮同心参考圆布局（2026-11-14）：右侧两个副按钮中心改由主按钮圆心(140,170)、参考半径150（主圆半径75的两倍）、±25°计算，形成紧凑右上/右下竖排；不绘制参考圆。展开平移使用同一几何参数，图标与音轨交互保留。构建安装，stem-control12项通过，新增两个副按钮距主圆心等距及参考半径检查。

液体张力分轨动画（2026-11-14）：沿用右侧同心参考圆位置，展开400ms、收起340ms，以五次平滑曲线驱动副圆增长和位移；原生Canvas贝塞尔液体连接随距离拉细并断开，收起反向融合。连接与按钮使用同一圆形切面避免接缝尖角，选择交换时圆形背景轻微弹性形变，橙蓝SVG图标不变形。动画中反向点击从当前进度接续，关闭系统动画直接落位。构建安装，stem-control16项和full-pull17项通过，查看stem-liquid-opening/closing.png中间帧。验证为隔离回调测试，未运行真实分轨模型生成。

Stem exchange motion (2026-11-14): selected satellite and main circle exchange positions on opposite arcs over 420ms, interpolating circle and SVG sizes. Playback selection commits immediately. Repeated taps snapshot all three visible icon positions before retargeting, preserving continuity. Collapse, external mode changes and detach clear the overlay. Existing main-button press spring remains. Android build/install passed; stem-control 18 checks (including immediate rapid selection and position continuity), full-pull 17 checks. Native visual: validation/stem-swap-midpoint.png. Isolated callbacks; real stem generation was not repeated.

Stem exchange refinement (2026-11-14): use straight position interpolation instead of opposite arcs; selected satellite renders last, above the outgoing main circle. Size interpolation, immediate selection and interrupted-motion retargeting retained. Build/install and 18 stem-control checks passed; native midpoint screenshot updated.

Continuous stem handoff (2026-11-14): PlaybackService now keeps the active MediaPlayer/LiveStemPlayer while preparing a second output. Asynchronous prepare/seek aligns to the advancing song clock; output must advance before the 120ms smooth crossfade releases the old player. Canonical song duration and a handoff position bias preserve the progress timeline. Loading positions stay at the requested seek point until seek completion. Rapid requests dispose obsolete candidates; pause, focus ducking, seek, queue changes and teardown preserve playback intent and clean up both outputs. Candidate errors retain the active source/mode; MusicActivity displays the retained progress on recoverable errors. Growing PCM waits for enough committed data; returning from an underrun frontier and cancelling a producer cannot deadlock or apply stale failures. Build and installation passed. stem-handoff: 38 real MediaPlayer/AudioTrack checks using local 10s PCM; full service integration: 39 checks including real model preview and automatic completion. Six round-trip handoffs sampled over 263 frames: all playing, stable duration, no backwards steps; largest position increment beyond elapsed sampling time 22ms. Evidence: validation/stem-handoff-trace.json. These are playback-state/timeline checks, not a loopback recording or sample-accurate acoustic measurement. User playback/recent preferences restored after testing.

Optional stem preloading (2026-11-14): Settings > Preload stems adds a persisted native switch (playback-settings/preload-stems), default false. Disabled playback creates no separation job; explicit vocals/accompaniment actions still start separation and switch to the generated prefix. StemPreloader moves generation into the playback service and shares one serial worker for manual/current/next jobs. Enabled playback processes current first, then only one actual upcoming song, reusing valid cached WAV pairs. Automatic preloading never selects a stem or changes the active queue/audio. Sequential end, list wrap, single repeat and reserved shuffle order are respected. A prefetched song becoming current keeps its task/prefix. Unrelated skips cancel obsolete work; automatic disable cancels automatic jobs but preserves explicit requests. Failed auto tasks do not retry on each playback tick. Service teardown cancels work and releases its wake lock; browsing/activity destruction does not own generation. Android build and installation passed. Real local model/PCM fixtures: stem-preload 35 checks, stem-handoff 38, full service integration 39, stem-control 18. Native UI evidence: validation/stem-preload-setting-off.png; regression summary: validation/stem-preload-regression.json. User playback/settings/cache indexes restored after tests; generated test cache files cleaned. Online next-track resolution reuses the existing authenticated resolver; network variation was not part of the local-fixture test.

Stem button progress (2026-11-14): unseparated controls use gray circular surfaces and monochrome wave glyphs, while remaining clickable. During current-song separation the main circle shows a white remaining-work ring (drains clockwise) and a completed percentage. Progress derives from committed PCM frames/total, stays at 0 during decode/model preparation, and is capped below 100 until cached outputs finish. 160ms interpolation smooths incoming progress updates; completed results remove the ring and restore white surfaces/orange-blue SVGs over 200ms. Liquid bridges and exchange overlays use the same state colors; progress follows the selected incoming main circle during exchange. Background next-song progress cannot overwrite current-song ready state; cancellation resets unfinished progress. Reduced-animation preference and detach cleanup are supported. Build/install passed; stem-preload 39 real local-model/UI checks and stem-control 18 checks passed. Native images: validation/stem-progress-live.png (25% actual processing), stem-progress-complete.png, and stem-circles-expanded.png (unready gray controls). User playback/preferences/cache indexes restored after tests.

Stem control refinements (2026-11-14): all button surfaces stay white; original orange/blue glyph always remains colored, while vocals/accompaniment glyphs are gray until separation completes. Progress is a clockwise growing white arc, 6 design units wide with its inner edge touching the button; no visible percentage or displaced glyph. Only vocals/accompaniment circles show progress, including exchange overlays; original never shows a ring. Selecting an unavailable stem immediately keeps its requested visual mode and exchange animation, starts/joins separation and silently connects audio once the prefix is ready. Removed the preparation toast. A 500ms idle timer starts at touch release/programmatic activation; held touches suspend it, repeated interaction resets it, model progress updates do not. Idle collapse retains liquid merging and disables hidden hit targets. Detach clears callbacks. Build/install passed; stem-preload 40 real local-model/UI checks (including immediate unready selection) and stem-control 21 checks (including held touch and idle expiry). Native screenshot capture can exceed the idle boundary, so the regression accounts for an already collapsed control rather than accidentally reopening it. User playback/preferences/cache indexes restored after tests.

Stem idle timeout (2026-11-14): increased automatic collapse from 500ms to 1000ms after last release/activation; held-touch suspension retained. Updated existing regression timing. Android debug build and installation passed.

Native RubberSegment navigation (2026-11-14): replaced the bottom discovery/personal label rows with RubberNavigation using variant-2 sparkle and rounded profile-badge paths. No visible tab text; accessible names and checked radio semantics remain. Motion adapts the supplied React Bits JavaScript/CSS reference to Android Canvas/ValueAnimator: 190ms edge dilation with 150ms handoff, independent critical/momentum edge springs, 3dp trailing squash and 160ms relaxation, clipped active-icon ink, draggable thumb, 0.55 rubber resistance, 100ms velocity history and projected flick snapping. Rapid reversals start at current edges, cancelled drags restore the committed slot, keyboard changes jump and external page changes synchronize without firing another route callback. Disabled state, reduced animation and detach cleanup are handled. The existing FloatingNavigation placement stays aligned with the mini player; short windows retain at least 58dp track height/48dp item height. No React runtime or motion dependency was added to the Android project. Build/install passed; rubber-navigation 19 checks and full-pull 17 checks passed. Native visual evidence: validation/rubber-navigation-discover.png, rubber-navigation-stretch.png, rubber-navigation-personal.png. No account/queue writes were performed by these checks.

Earlier playback refinements verified on the same build: stem idle collapse is 2 seconds after release, with held-touch suspension; fullscreen stem main circle is vertically aligned to the play/pause centerline without resizing either control.

Equal bottom capsules (2026-11-14): keep navigation and playback as two independent capsules. Mini playback bounds changed to (477,1725)-(847,1905), matching the navigation 370x180 design-unit size and mirrored 84-unit outer screen margins. Artwork remains 129x129 and is repositioned into the left half; click ownership now splits at the playback capsule center for cover/open and play/pause. Shared PlayerMorph destination geometry keeps expanded/compact artwork aligned. Debug build/install passed; rubber-navigation 19 checks, full-pull 17 and play-icon 8 passed. Native screenshot: validation/equal-bottom-capsules.png.

Vertical mini playback capsule (2026-11-14): rotate the mini capsule footprint to 180x370 at (675.5,1535)-(855.5,1905), centered above the existing play/pause position. The 129x129 artwork moves to (701,1560.5)-(830,1689.5), above the unchanged playback glyph. Upper-half taps open the full player; lower-half taps toggle playback. Shared cover destination and the intermediate morph circle follow the vertical capsule so expansion/collapse use the same endpoints. Existing mini gesture tests now derive starting positions from current bounds. Debug build/install passed; morph 11 checks, capsule-drag-native 13 and rubber-navigation 19 passed. Native screenshots: validation/vertical-playback-capsule.png and vertical-capsule-opening.png. Navigation position and glyph geometry remain unchanged.

Undo vertical mini capsule (2026-11-14): user requested undo. Restored the previous horizontal 370x180 mini capsule, mirrored 84-unit outer margins, left cover/right playback click regions, original intermediate morph circle and matching test gestures. Rebuilt/reinstalled; morph 11 checks passed.


## 推荐页接口与局部换批（2026-11-17）

- 保留每日推荐 `/api/v3/discovery/recommend/songs`，增加首页 `/api/homepage/block/page` 的音乐分区适配。按真实返回标题展示歌单、雷达、定制歌单与歌曲推荐，不硬编码私人雷达 ID；忽略广告、视频、播客和未知资源。
- 推荐歌单结合登录态 `/api/v1/discovery/recommend/resource` 与 `/api/personalized/playlist`，按歌单 ID 去重。
- 心动入口使用喜欢歌单中的歌曲作为种子调用 `/api/playmode/intelligence/list`；私人漫游入口使用 `/api/v1/radio/get`。当前入口打开本批歌曲列表，不宣称完整复刻官方漫游频道、无限续播或 AI 定制生成。
- 精选歌单“换一批”只重建歌单横向列表，保留页面及其他区域；推荐池按每批 6 个展示，用完请求 `/api/playlist/list` 分页，排除当前可见 ID。相同结果和网络失败均保留原列表并提示。
- 首页分区单独请求、按账号缓存；接口不可用时保留原有每日推荐、歌曲和精选歌单，不伪造截图中的分区。
- 接口来源：已安装 `@neteasecloudmusicapienhanced/api/module/` 的 `homepage_block_page.js`、`recommend_resource.js`、`personal_fm.js`、`playmode_intelligence_list.js`、`top_playlist.js`。首页数据结构参考 https://github.com/hcanyz/flutter-netease-music-api/blob/master/lib/src/api/uncategorized/bean.dart 。
- 验证：`DiscoverySectionsChecks` 的 11 项解析/去重/批次/无新内容检查在 JVM 通过；assembleDebug、assembleDebugAndroidTest、lintDebug 通过。修复 lint 发现的旧 Android 13 HexFormat 兼容问题和 Typeface 常量问题。手机 ADB 未连接，真实账号首页返回、视觉交互、心动与私人漫游未实测，本轮 APK 尚未安装。
- 真机只读接口探测：安装测试 APK 后可运行 `adb shell am instrument -w -e suite discovery-probe com.volo.mobile.test/com.volo.mobile.PlaybackInstrumentation`；只使用应用现有加密会话读取首页，不输出 cookie，不执行收藏、删除或播放操作。`discovery-parser` suite 可在手机执行同组解析测试。


### 心动模式预取（2026-11-17）
移除私人漫游入口与私人 FM 客户端方法。心动推荐在账号恢复/切换成功后后台预取，使用独立读取队列并合并重复请求；优先从内存、喜欢歌单缓存取得种子，缺失时仅请求 n=1 的歌单详情。推荐按账号持久化，30 分钟内直接复用，过期时先展示缓存再后台刷新。预热前六首封面；不缓存临时音源 URL、不自动播放。无缓存点击立即打开详情显示准备状态，请求完成填充列表；用户已离开或切换账号时不抢回页面。构建和 lintDebug 通过；尚无真机等待时间测量，不承诺首次无缓存无等待。
