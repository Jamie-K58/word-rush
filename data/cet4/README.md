# 四级词汇：完整保留源词性、释义与例句

本目录是整理后的词库资料，已接入游戏内置“四级完整词库 · 4543 词”。原 `cet4` 选择值和学习记录保持兼容，没有改动游戏规则。完整内置词库由静态脚本加载，不把整库写入浏览器本地存储；学习记录仍按原方式保存。

在线游戏：[Word Rush](https://jamie-k58.github.io/word-rush/)。保留玩家与怪物战斗、护盾、连击、十回合 Boss、经验等级与错题复习。

数据来自 [KyleBing/english-vocabulary](https://github.com/KyleBing/english-vocabulary) 的完整 JSONL；本次固定源版本为 `c4c6c80879ff17d7025c28fb853a4991c8e6be6a`，源文件哈希见 `manifest.json`：

- [正序四级](https://github.com/KyleBing/english-vocabulary/blob/c4c6c80879ff17d7025c28fb853a4991c8e6be6a/full_line_jsonl/full/%E6%AD%A3%E5%BA%8F/%E5%9B%9B%E7%BA%A7.jsonl)：7,508 条源记录。
- [乱序四级](https://github.com/KyleBing/english-vocabulary/blob/c4c6c80879ff17d7025c28fb853a4991c8e6be6a/full_line_jsonl/full/%E4%B9%B1%E5%BA%8F/%E5%9B%9B%E7%BA%A7.jsonl)：4,901 条源记录。

上游说明它由 [kajweb/dict](https://github.com/kajweb/dict) 经 KyleBing/dict 整理而来；本目录保留上游声明的 [BSD-3-Clause 许可](LICENSE-KyleBing.txt)，没有将其描述为考试机构官方词表。

## 文件与使用

打开 Word Rush 即可直接使用内置四级词库，无需导入。若需要另建可编辑副本，在“词库 → 新建词库 → 导入”中选择 `cet4-full.json`。它符合当前 `WordData.parse` 支持的 `{name, source, words}` 格式。每个词条保留全部源主释义，按词性分组，并带有该词所有去重后的英文例句。

| 文件 | 内容 |
| --- | --- |
| `cet4-full.json` | 4,543 个可导入词条；主数据 |
| `cet4-bank.js` | 由主数据生成的内置浏览器词库；不写入本地存储 |
| `cet4-a-f.json` | A–F，1,910 词；替代分包 |
| `cet4-g-l.json` | G–L，780 词；替代分包 |
| `cet4-m-r.json` | M–R，1,132 词；替代分包 |
| `cet4-s-z.json` | S–Z，721 词；替代分包 |
| `source-provenance.json` | 审计资料：原始词性、源书/词条 ID、原始中英文释义、音标、例句中文译文；不是导入包 |
| `manifest.json` | 源文件 SHA-256、原始记录数、输出体积和数据统计 |
| `manual-qc.json` | 已知问题与纠错记录 |

日常使用内置词库无需导入或占用整库的本地保存空间。全量与分包是手动导入时的替代选择，不要同时重复导入。分包便于按需选用，全部累计导入仍会占用全量空间。

主 JSON 共 1,211,678 个 JavaScript 字符，UTF-8 为 1,375,630 字节；按 UTF-16 估算为 2,423,356 字节。命名词库紧凑保存词条约需 2,422,500 字节，另有少量词库名称/进度等开销。旧默认自定义词库使用 `WordData.serialize` 美化格式再编码，单本词库约需 4,167,602 字节，因此推荐新建命名词库。实际可用空间还取决于已有本地数据与浏览器配额。

## 合并与词性规则

- 12,409 条源记录按大小写不敏感的 headWord 合并，得到 4,544 个源拼写。
- 已核实的源错拼 `reservior` 合并入 `reservoir`，得到 4,543 个可用词条。正确拼写可见 [Cambridge reservoir](https://dictionary.cambridge.org/us/dictionary/english/reservoir)。原拼写、书籍 ID 和原始释义仍保留于审计文件，错拼不会成为独立训练答案。
- 完整保留所有 `content.word.content.trans` 的词性与中文释义，不把多词性压成一个标签。原始 POS、英文释义及记录 ID 保留于 `source-provenance.json`。
- 部分源书主释义只覆盖一个词性，例如 `like` 只有 v、`light` 只有 adj。对缺失的词性族，使用**同一个 headWord** 的 `syno.synos` 内现成的 `pos` 和 `tran` 补充；不使用 `relWord` 的其他同根词，不自行推断释义。
- `a`/`ad` 规范显示为 `adj`/`adv`，`determiner.` 规范为 `det`，`modal verb` 为 `modal`，`aux v` 为 `aux & v`，`interjection`/`int` 为 `interj`。修复 `. v`、`3、释义:n`、`(缩作OK)a&ad` 等源标签格式杂质；复合词性使用 ` & ` 或 ` / `，去除重复标签。原始标签完整保留于审计资料。
- `convention` 作为惯用表达标签显示为 `convention (惯用表达)`，不擅自推断为感叹词。原始 `vt`/`vi` 在保留或新增的释义中不改成泛指 v；判断是否缺失词性族时将三者视为 verb，以免重复添加已被源主释义覆盖的动词组。
- 相同词性＋相同释义仅去除完全重复项，标点或内容不同的源义项继续保留。
- 所有源普通例句按完整英文文本去重。例句属于词条层级，**没有可靠源映射时不绑定到某个词性或单独义项**。
- `source-provenance.json` 每个词的 `exampleTranslations` 与主文件该词的 `examples` 数组按下标对应；同一句的不同源中文译文均保留。源例句原样保留，其中有短语式例句；不扩写、不补造句子。真题字段内带省略号的摘录没有冒充普通完整例句加入。

## 覆盖与缺失

| 指标 | 数量 |
| --- | ---: |
| 可用词条 | 4,543 |
| 词性与释义组 | 11,344 |
| 含多个词性族的词条 | 1,970 |
| 从同源 `syno.synos` 补充了缺失词性族的词条 | 1,096 |
| 补充词性释义组 | 1,409 |
| 去重英文例句 | 12,800 |
| 缺失词性 | 0 |
| 缺失普通例句的词条 | 22 |

“完整”表示完整保留并合并所选源数据的词性与释义，不能保证穷尽所有词典义项，也不等同于官方大纲独立核验。没有把 ECDICT 内容混入主数据：它的 POS 列在该下载版本中为空，考试标签不含全部基础词，个别技术释义质量不适合直接替代学习释义。

以下 22 词缺少源普通例句，保留空数组，不生成未经核实的例句：

`according`, `advocator`, `avail`, `china`, `connexion`, `donkey`, `downfall`, `dramatically`, `england`, `france`, `fulfill`, `guitar`, `impermanency`, `installment`, `irrationally`, `mold`, `ox`, `prohibitively`, `providing`, `radically`, `ring`, `scary`。

## 确定性重建

源下载文件保存在项目 `.openai/cet4-sources/`。在项目根目录执行：

```powershell
node tools/prepare-cet4.cjs
```

该命令从现有 JSONL 重建 JSON 资料和内置脚本；相同源文件得到相同输出。源哈希记录在 `manifest.json`。如本地没有源文件，或需要重新下载固定版本后构建：

```powershell
node tools/prepare-cet4.cjs --download
```

下载默认固定上述完整 commit ID；需要其他版本时，先将环境变量 `CET4_SOURCE_REVISION` 设为对应完整 commit ID。重新下载后应比对源哈希和统计，确认数据版本。脚本不依赖第三方库，不写入浏览器；生成的 `cet4-bank.js` 随应用部署，JSON、说明与许可证也随静态构建发布。
