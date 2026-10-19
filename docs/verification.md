# 验证说明

本页说明当前实现的检查范围和复现方法。发布包及其校验文件以 [GitHub Releases](https://github.com/ActorF/Elysia-Standalone-Pet/releases) 为准；本页不固定某个构建的文件数量、大小或哈希。

## 环境与命令

在 Windows 上安装 Node.js 22 或更新版本、Microsoft Edge，然后在仓库根目录执行：

```powershell
npm ci
npm test
npm run test:smoke
npm run test:visual
npm run test:faces
```

- `npm test`：按键映射、重复切换与重置、状态稳定性、设置校验、屏幕位置、IPC 边界，以及待机网格的位移和几何稳定性。
- `npm run test:smoke`：使用独立测试配置启动真实 Electron 窗口，检查预加载桥梁、IPC、素材加载和 WebGL，随后退出。
- `npm run test:visual`：在 Edge 中检查表情切换、喇叭、重置、设置面板、焦点内组合按键、复选框操作和眼神方向，并生成截图。
- `npm run test:faces`：检查爱心眼的局部修改范围、眨眼时的嘴型、摸头画面的绘制一致性，以及全部 17 种表情能否正常渲染。

浏览器检查需要本机 Edge，桌宠日常运行不依赖它。全局快捷键可能被其他应用占用；浏览器中的组合键检查不能代替目标 Windows 环境中的实际全局按键操作。

依赖检查（2026-10-19）：Electron 已更新至 43.8.0，包含上游 [预加载缓存问题的修复](https://github.com/electron/electron/security/advisories/GHSA-qmv3-fv6v-rmhq)。`npm audit` 仍报告 8 项中等告警，来自构建工具的 `sprintf-js`／日志依赖链；这些构建依赖不随桌宠运行代码打包。相关记录见 [上游公告](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)。

## 当前已完成的验收

当前功能实现已通过单元测试、Electron 启动检查、全部 17 种表情的界面回归，以及脸部像素与绘制检查。人工视觉复核覆盖：

- 默认脸、爱心眼、睡觉、眯眯眼、Wink、摸头，以及其他表情总览。
- 爱心只改变虹膜内的小区域与嘴部，原眼睛边界保留，嘴周围没有明显旧图残影。
- 闭眼两端保持圆厚收尾，没有重复的旧上睫毛。
- 摸头全身画面没有额外叠加手掌；实时眨眼时原有嘴型、眼镜和腮红保持。
- 固定鼠标的 6 秒实录，以及上半头发、刘海、后发、衣摆、腿部的时间帧。动作幅度轻缓，采样画面未见明显轮廓撕裂、双线或连接破口。

以上视觉结论来自实际渲染截图和录像采样，不是仅凭脚本退出成功推断。公开预览见 [表情图](media/expressions.png) 和 [待机录像](media/idle.webm)。

## 重新生成视觉证据

```powershell
npm run preview:expressions
npm run preview:motion
```

脚本将截图、时间帧、录像及检查记录写入本地 `artifacts/`。这些是每次运行生成的检查产物，无需历史安装包或旧版归档。请实际查看图片和视频，特别留意脸部合成边缘、闭眼线条、手与道具连接、发梢和衣摆运动。

## 构建与手动检查

```powershell
npm run package
npm run make:portable
```

目录包与便携版写入 `release/`。源码整理或构建配置变化后，应重新执行测试并检查新生成的包，不能沿用旧包的校验值。

运行便携版后，确认透明窗口、拖动、缩放、托盘、设置保存、鼠标穿透及 **Ctrl + Alt + P** 恢复正常；切换表情和喇叭，确认素材完整。使用全局快捷键前先退出旧实例，避免注册冲突。关闭应用后检查其进程是否正常退出。
