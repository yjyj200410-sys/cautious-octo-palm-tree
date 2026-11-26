# 手绘播放图标

三个未激活轮廓由用户认可的生图直接描摹，白色粗排线单独保存在 clipPath 内；单曲数字与完成勾是独立路径。

- repeat.svg / repeat-active.svg / repeat-one.svg：循环关闭、列表循环、单曲循环。
- shuffle.svg / shuffle-active.svg：随机关闭、开启，与循环状态独立。
- download.svg / download-complete.svg：未下载、已下载大勾。
- preview.html：静态状态预览。
- reference-*.png：认可的原始生图，作为描摹依据。

复现：python mobile/scripts/build-playback-icons.py（本地需要 numpy、opencv-python）。三个基础 SVG 同步写入 APK assets，包含全部可见性分层；Android 原生按 class 读取 outline/interior/ink/single/check，分别驱动填充和大勾动画。
