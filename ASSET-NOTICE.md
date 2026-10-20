# 素材与第三方权利说明

本仓库的原创程序代码、脚本、配置和文字文档使用 [MIT License](LICENSE)。以下角色美术及其衍生预览不在 MIT 授权范围内：

- `assets/v3/*.png`、`assets/v4/*.png`、`assets/v5/*.png`、`assets/v6/*.png`、`assets/v7/*.png`、`assets/v8/*.png`：按用户提供的爱莉希雅参考图片，经图像生成工具重绘或编辑的桌宠素材。`v7` 包括睡觉、生气、晕的表情与睡觉、晕的装饰图层；`v8` 包括分层前发、后发、脸部补底与完整猫尾；对应提示词和来源说明保存在同目录中。
- `docs/media/`：使用上述素材生成的运行截图和动画预览。
- 发布包中包含的相同角色素材。

爱莉希雅、《崩坏3》相关角色、原始美术、名称和品牌等权利归 miHoYo / HoYoverse 及各自权利人所有。参考图片还涉及 CoCo 都可联动设计；相关品牌权利归各自权利人所有。本项目是非官方桌宠项目，不声称获得这些权利人的授权或背书。

素材随项目提供用于展示其运行效果；这不代表本项目向使用者授予这些第三方内容的版权或商标许可。MIT 代码授权不扩展至上述素材或第三方权利。单独复用、再发布或商业使用相关素材时，请另行确认所需权限。

原 BongoCat / Live2D 模型、模型纹理与教程文件不随本仓库分发。`assets/original-controls.json` 仅记录原项目的历史按键与参数，**不是当前桌宠的按键配置**。当前按键见 [README.md](README.md#按键)，实现位于 `renderer/state.mjs` 与 `electron/host-policy.cjs`；程序不加载原模型，也不依赖 BongoCat。

Electron、Chromium、Node.js 及其他依赖保留其各自许可证；构建时请保留依赖随附的许可声明。

## English summary

The MIT license applies to this project's original source code, scripts, configuration, and textual documentation. Character artwork in `assets/v3` through `assets/v8`, derived previews in `docs/media`, and the same artwork bundled in releases are excluded. These images were redrawn or edited with an image-generation tool from user-provided Elysia references. Character, original illustration, and trademark rights remain with their respective owners. This unofficial project does not grant a separate license to those third-party rights or imply official endorsement. `assets/original-controls.json` is a historical reference, not the current shortcut configuration. Dependencies retain their own licenses.
