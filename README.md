# Elysia Standalone Pet

独立运行的 Windows 爱莉希雅 Q 版桌宠：透明窗口、全身人物、没有键盘，也不依赖 BongoCat 或 Elysia AI。

![表情预览](docs/media/expressions.png)

[观看 6 秒待机动画](docs/media/idle.webm)

## 下载与使用

从 [GitHub Releases](https://github.com/ActorF/Elysia-Standalone-Pet/releases) 下载 Windows 便携版 `.exe`，双击运行，无需安装 Node.js。更新前请先从旧版右键菜单退出。

- 拖动人物移动位置；轻点人物切换摸头表情。
- 右键人物或系统托盘图标，打开“表情说明与设置”。
- **Ctrl + 滚轮**调整大小；位置、大小和设置自动保存。
- 眼神跟随屏幕上的鼠标，角色会自动眨眼，头发、刘海、衣摆与腿部轻摆。
- 设置中可调整置顶、鼠标穿透、眼神跟随、待机动作和全局快捷键。
- 开启鼠标穿透后，用 **Ctrl + Alt + P** 或点击托盘图标恢复操作。

## 表情按键

按住 **空格**，再按下表中的按键。再次触发同一表情会恢复默认。

| 按键 | 功能 | 按键 | 功能 |
| --- | --- | --- | --- |
| 1 | 眼镜 | 2 | 害羞 |
| 3 | 生气 | 4 | 睡觉 |
| 5 | 惊讶 | 6 | 眯眯眼 |
| 7 | 晕 | 8 | Wink |
| 9 | 哭 | 0 | 爱心眼 |
| - | 星星眼 | = | 眯眼笑 |
| F1 | 猫猫形态 | F2 | 吃蛋糕 |
| F3 | 喝奶茶 | F4 | 囧 |
| F5 | 摸头 | M | 拿出／收起喇叭 |
| Backspace | 重置表情与喇叭 | | |

喇叭独立切换，只显示喊话动作，不播放声音。全局组合键不拦截其他软件的按键输入，可在设置中关闭，或改用 **Ctrl + Alt** 组合；也可以直接点击设置面板中的表情按钮。

## 从源码运行

需要 **Windows、Node.js 22 或更新版本**。视觉检查还需要已安装 Microsoft Edge。

```powershell
git clone https://github.com/ActorF/Elysia-Standalone-Pet.git
cd Elysia-Standalone-Pet
npm ci
npm start
```

测试与构建：

```powershell
npm test
npm run test:smoke
npm run test:visual
npm run test:faces

npm run package
npm run make:portable
```

构建结果写入 `release/`。可用 `npm run preview:expressions` 和 `npm run preview:motion` 生成本地表情截图与待机录像；验收范围见 [验证说明](docs/verification.md)。

## 项目结构

| 目录 | 内容 |
| --- | --- |
| `electron/` | 透明窗口、托盘、全局输入与设置持久化 |
| `renderer/` | 人物绘制、表情、动画与设置面板 |
| `assets/` | 运行素材及按键映射 |
| `scripts/` | 启动、检查与预览工具 |
| `tests/` | 自动测试 |
| `docs/` | 验证说明与公开预览 |

角色使用 PNG 原画与 WebGL／Canvas 动画，属于独立实现，并非 Live2D 模型。WebGL 不可用时仍可显示人物和表情，网格摆动与眼神纹理位移会降级。

## 授权

项目代码采用 [MIT License](LICENSE)。

角色设计、人物图像、动画预览及相关美术**不纳入 MIT 授权**。素材来源与使用说明见 [ASSET-NOTICE.md](ASSET-NOTICE.md)。
