# Word Rush · V3

原生 HTML、CSS、JavaScript 单词闯关游戏。玩家与怪物的战斗舞台、护盾、连击、Boss 与等级成长结合完整的单词学习信息，无生产框架或运行时依赖。

在线游戏：[Word Rush](https://jamie-k58.github.io/word-rush/)。打开即可选择内置词库并开始十回合战斗，保留错题复习、自定义词库、统计、暂停、跳过与音效。

## 本地运行与验证

```sh
npm install
npm run dev
npm run check
npm test
npm run build
```

本地地址为 http://127.0.0.1:4173。构建产物位于 `dist/`，可直接部署到 GitHub Pages 或其他静态托管服务。仓库根目录同样可直接作为 GitHub Pages 来源，无需构建。原中文 HTML 入口继续可用，并与首页共用脚本和样式。

浏览器测试使用 Playwright：Windows 自动使用已安装的 Microsoft Edge；其他环境可运行 `npx playwright install chromium`，或设置 `PLAYWRIGHT_EXECUTABLE_PATH` 指向本地 Chromium 浏览器。测试覆盖 1440px 桌面和 360px 触屏布局。界面截图保存在 `.openai/qa/`。

## 文件结构

- `index.html`、`单词冲刺-免费网页版.html`：一致的视图与对话框入口。
- `styles.css`：统一设计变量、响应式排版与减少动态效果支持。
- `game.js`：管理答题、复习、统计、发音、本地保存，以及跨题保留生命值的遭遇战状态。
- `battle.js`：复用原角色与场景素材，呈现三阶段怪物、三格护盾、十回合路线、攻击反馈、Boss 入场与成长奖励；答题状态与计时仍由 `game.js` 管理。
- `progression.js`：章节推进、短期目标与可见的战斗奖励，使用新增字段并兼容旧进度。
- `vocabulary.js`：原内置词库与教材词库组合。
- `data/cet4/cet4-bank.js`：4,543 词的四级词库，以原有 `cet4` 选项接入，不复制到浏览器本地存储。
- `data/cet4/`：四级 JSON、来源记录、数据统计与上游许可证；[整理说明](data/cet4/README.md)。
- `tools/prepare-cet4.cjs`：从固定版本的上游 JSONL 重建四级 JSON 与内置脚本。
- `word-utils.js`：旧词条兼容、词性解析、例句遮词、CSV/JSON 导入导出。
- `教材词库.js`、`教材扩展词库.js`：原始教材数据，保持不变。
- `assets/`：本地 Space Grotesk 字体及其 OFL 许可证。
- `assets-hero.png`、`assets-enemy.png`、`assets-battle-bg-v2.webp`：沿用 GitHub 原版的玩家、怪物与战斗场景素材。
- `tests/`：数据回归、实际浏览器回归、静态服务与构建工具。

## 游戏规则

每局最多 10 回合，3 格护盾。前 6 回合每题 20 秒，第 7–9 回合 15 秒，第 10 回合 12 秒。沿用原计分公式：`100 + min(100, 答题前连击数 × 10)`。答错、超时和跳过消耗一格护盾并重置连击。

一局按遭遇战推进：普通战生命值 90，精英战 120，Boss 战 200；同一遭遇战的生命值会跨单词保留，归零后才进入下一阶段。基础攻击分别为 32、44、56，连续命中会按当前连击提升伤害，3 连击与 5 连击触发强化倍率。Boss 生命归零才算胜利；护盾耗尽或 10 回合用尽仍未击败 Boss 则失败。每次正确获得 25 XP，击败普通、精英、Boss 额外获得 30、60、100 XP，每 500 XP 升一级。

提交后暂停计时，显示完整单词、词性、释义和例句。玩家点击 Next 后才进入下一题。Esc、导航离开或进入后台会暂停当前题，继续后保留剩余时间。首字母提示与发音仍可使用。

桌面将战斗舞台与拼写操作区并排呈现。手机使用紧凑 HUD 与缩小舞台，低高度视口和键盘状态进一步压缩场景。攻击、受击、护盾损伤与连击反馈持续 150–350ms，并支持 `prefers-reduced-motion`。

## 词条与学习数据

内置四级词库整理自 [KyleBing/english-vocabulary](https://github.com/KyleBing/english-vocabulary) 的正序与乱序完整 JSONL，固定来源版本为 `c4c6c80879ff17d7025c28fb853a4991c8e6be6a`。合并后共 4,543 词，保留多词性及对应释义、12,800 条去重英文例句；无缺失词性的词条，22 词缺少源普通例句，按缺失状态显示，不补造内容。“完整”指完整保留所选来源，不表示穷尽所有词典义项或经过官方考试大纲核验。详细来源、合并规则及缺失清单见[四级词库说明](data/cet4/README.md)。

选择“四级完整词库 · 4543 词”即可使用，无需导入。词库继续使用 `cet4` 标识，已有选择偏好保持兼容；更新内置内容不会覆盖自定义词库或重置历史学习记录。需要自行管理词表时，也可导入 `data/cet4/cet4-full.json`。

兼容原数组格式 `[word, meaning, example]`，以及第四列词性；兼容旧的 `word｜中文释义` 文本。新增文本格式为 `word｜pos｜中文释义｜英文例句`；复杂多义词推荐 JSON：

```json
[
  {
    "word": "record",
    "senses": [
      {"pos": "noun", "meaning": "记录；唱片", "examples": ["This record contains every result."]},
      {"pos": "verb", "meaning": "录音；记录", "examples": ["Please record your answer carefully."]}
    ]
  }
]
```

多义词通过完整 JSON 编辑，保留词性、释义和例句之间的对应关系及未知元数据。CSV 支持带引号的标点、多行例句与表头。原始数据未提供的词性显示“词性未标注”，未提供的例句显示“暂未收录”，不会自动补写。答题提示遮住目标词及支持的常见变形，反馈中恢复完整原句。

继续读取 `spellRushProgress`、`spellRushWords`、`spellRushHelpSeen`。原有学习记录与额外字段保留，新增最佳成绩、词条快照等字段。新建命名词库使用 `spellRushLibraries`，偏好使用 `spellRushPreset` 与 `spellRushSound`。每次作答立即保存学习记录；修改或删除词库不会删除对应错题。统计页可导出、恢复完整 JSON 备份。

本地数据属于当前浏览器及来源。发布到原站点时会读取同源旧数据；本地预览无法直接访问线上浏览器保存的数据。建议使用统计页备份重要记录。
