# 归位 Lab

面向高校实验室的器材套装借还应用。蓝白界面，围绕一套 5 件电工工具，支持照片上传、借出清单人工修改、归还照片对照、缺件暂存与记录查询。借出与归还页面提供视觉识别辅助：识别结果只作为核对建议，任何情况下都不会自动勾选人工确认。

## 启动

需要 Node.js 20.19+ 或 22.12+（当前环境为 Node.js 24）。在本目录运行：

```powershell
npm install
npm run build
npm start
```

打开 http://localhost:4317 。使用 `Ctrl+C` 停止。可通过 `PORT` 环境变量修改端口。

首次启动自动创建 1 个套装（每套 5 件，共 3 套库存）以及 3 条示例借还记录，其中 1 条借用中、1 条待核验、1 条已归还。示例人名与学号为虚构内容。待核验与已归还的示例记录内含**演示来源**（`mode=demo`、`provider=demo-sample`）的识别建议与核验历史，用于展示新增能力；演示数据不代表照片内容，不是真实识别。

视觉识别默认未配置：页面会显示“服务端未配置真实识别服务”，可以使用明确标注的演示结果；如需真实识别，请按下方「识别配置（服务端）」填写 `.env` 后重启。

也可以双击本目录的 `启动归位Lab.cmd`，自动检查依赖、构建并启动。开发时运行 `npm run dev` 即可启用界面热更新。

## 体验完整流程

1. 在“器材套装”查看或编辑套装，维护每件物品名称、数量、规格和参考照片。可新增套装及库存套数。
2. 点击“新建借出”，输入姓名、学号和预计归还时间，上传照片或点击“使用示例照片”。
3. 上传照片后可点击“开始识别”，由服务端视觉识别返回预期清单、识别建议、疑似缺件与待人工确认项目。识别结果只作提示：对照照片修改清单名称和数量，可将不借用物品减到 0，每一行都需要人工确认，至少借用一件。
4. 确认借出后，在记录中点击“办理归还”，并排查看借出照片和归还照片。
5. 上传归还照片后同样可以“开始识别”，识别建议会显示在每行的“识别建议”列，并汇总疑似缺件与待人工确认项目。未配置识别服务时可用“演示结果”，界面会明确标注这是固定示例、未分析照片内容。
6. 调整实还数量、核验结果，逐项人工确认。更换照片、切换套装或记录、重新识别后，相关的人工确认会自动失效，需要重新核对。缺件或疑问可“保存待核验”，稍后继续。
7. 全部数量相符、状态为“已核对”且人工确认后，“确认归还”才会启用。服务端也验证同样规则，识别结果不能替代人工确认。
8. 在“借还记录”查询未归还、待核验、已归还记录，通过顶部搜索人名、学号、器材或编号，可筛选套装并导出 CSV。

## 存储与使用范围

- `data/database.json`：套装与借还记录。借出时保存独立快照，不受后续套装编辑影响。
- `data/uploads/`：真实上传的照片。支持 PNG、JPEG、WebP，最大 10 MB。
- 重启、刷新网页后数据仍然存在；备份请复制整个 `data` 文件夹。不要在运行时直接修改数据库文件。
- 未归还与待核验记录均占用库存，完成核验后才释放库存。当前按整套库存预留，即使仅借部分物品，也占用一套。
- 数据保存在提供服务的本机，而非浏览器缓存。不同浏览器打开同一个服务可读取相同数据。
- 当前为无登录的本地原型；管理员 / 学生切换仅改变体验界面，不构成访问控制。服务仅监听 `127.0.0.1`，适用于本机预览。
- 视觉识别为服务端适配层，来源分为三种并在界面明确标注：真实识别 `live`、演示 `demo`、不可用 `unavailable`。未配置服务、请求失败、超时或返回格式无效时，界面会说明原因，并保留人工登记与核验通道。识别结果不会自动勾选人工确认，也不会绕过服务端校验。
- 识别建议、识别来源与时间随记录一起保存；识别的建议数量与人工最终数量分别保存，互不覆盖。旧版本记录会显示“历史记录未包含识别结果”。
- 核验历史（借出登记 / 保存待核验 / 完成归还）随记录保留；为避免文件无限增长，每条记录最多保留最近 200 条，超出时界面会明确提示“较早核验事件已按 200 条上限截断”，不会静默丢弃。
- 数量规则：识别到的确定数量少于预期（含 0 件）标记为“疑似缺件”；数量不明（`null`）为“待人工确认”；多于预期只提示、不截断；清单外物品单独列出。任何情况下都不会把清单预期数量当作识别到的数量。
- 时间显示统一为北京时间（Asia/Shanghai）。

## 识别配置（服务端）

视觉识别在服务端调用，密钥只保存在服务端。配置步骤：

1. 复制 `.env.example` 为 `.env`（同目录），填入实际服务信息。
2. 重启 `npm start`。启动日志与页面页脚会显示识别是否已配置。
3. 未配置时接口返回 `mode="unavailable"`，界面提示“服务端未配置真实识别服务”，可以使用界面中明确标注的演示结果。

支持的服务类型为 `openai-compatible`：任何提供 OpenAI 兼容 `/chat/completions` 接口、且模型支持图片输入的多模态服务，都可以按官方文档填写服务地址与模型名称。**本仓库不预设任何服务端点或模型名称，请以你所选服务的官方文档为准**；具体接入协议、模型能力与费用以该服务说明为准。

环境变量（详见 `.env.example`）：

| 变量 | 说明 |
| --- | --- |
| `LAB_VISION_PROVIDER` | 服务类型，当前支持 `openai-compatible` |
| `LAB_VISION_BASE_URL` | 服务基础地址，不含 `/chat/completions` |
| `LAB_VISION_MODEL` | 支持图片输入的模型名称 |
| `LAB_VISION_API_KEY` | 服务密钥，仅服务端读取，不进入日志、响应或前端产物 |
| `LAB_VISION_CHAT_PATH` | 可选，默认 `/chat/completions` |
| `LAB_VISION_TIMEOUT_MS` | 可选，默认 30000 毫秒 |
| `LAB_VISION_JSON_MODE` | 可选，设为 `1` 时要求服务返回严格 JSON |
| `LAB_VISION_ALLOW_DEMO` | 可选，设为 `0` 时关闭演示入口 |

接口说明：

- `POST /api/recognize`，请求体 `{stage:'borrow'|'return', photo, kitId 或 recordId, demo?, demoScenario?}`。`photo` 只接受本服务管理的上传标识或示例图，不接受任意本地路径或远程地址。
- 借出阶段按当前套装清单核对；归还阶段按该笔借出的历史快照核对，不使用可能已被编辑的当前套装。
- 返回 `{recognition, scope}`，其中 `recognition.mode` 为 `live` / `demo` / `unavailable`，`items[].observedQuantity` 在无法判断时为 `null`，`items[].assessment` 为 `present` / `missing` / `uncertain`。
- `GET /api/health` 返回当前识别能力摘要（不含密钥）：`available`（真实识别是否已就绪）、`demoAllowed`（是否允许演示）、`configured`、`provider`、`model`、`timeoutMs`、`missing`。`mode` 仅作为兼容别名保留，**不表示已完成一次真实识别**。
- 当 `LAB_VISION_ALLOW_DEMO=0` 时，`demoAllowed=false`，前端会隐藏“演示结果”入口；此时只保留人工核对通道。

## 测试

```powershell
npm test
```

测试使用独立临时数据库，覆盖照片上传、人工确认、清单修改、库存不足、快照隔离、缺件暂存、完整归还、重复归还、并发借用、重启持久化，以及本轮新增的识别行为：未配置凭据、模型超时、错误响应、格式无效、数量无效、物品齐全、疑似缺件、遮挡待确认、多出物品、识别后仍需人工确认、人工修正后完成归还、更换照片与重新识别的确认失效、过期结果保护、缺件暂存到补齐归还的完整闭环与识别数据持久化。测试不会更改预览环境的数据。当前共 87 项，全部通过（HTTP 端到端在回环可用时已实际通过）；新库示例含 demo 识别与核验历史，核验历史上限 200 条且超限可解释。

测试文件：

- `tests/workflow.test.mjs`：原有借还主流程与边界（断言与首版一致，改为直接调用应用核心）。
- `tests/recognition.test.mjs`：识别适配层、识别接口与人工核验闭环、前端识别状态失效规则。
- `tests/recognition-boundaries.test.mjs`：识别与核验边界补充用例（跨记录隔离、识别来源与人工结果分离、demo 与 live 区分、更多非法输入拒绝）。
- `tests/http.test.mjs`：HTTP 层端到端（上传、演示识别、借出、归还、静态页面）。禁止本机回环连接的环境中会自动跳过；本轮回环可用时已实际通过。

测试既可以走进程内调用，也可以走真实 HTTP：本仓库的应用核心（`createLabApp`）与 HTTP 层共用同一套路由逻辑。

如需在命令行完整走一遍“借出 → 缺件暂存 → 继续核验 → 补齐归还”，可运行闭环验证脚本（在临时数据库上执行，不影响 `data/`）：

```powershell
node scripts/verify-flow.mjs
```

脚本使用注入的模拟识别服务来验证接口契约与闭环，输出会明确标注“模拟注入，非真实模型”。

## 技术结构

- React + Vite + Lucide：界面与图标。
- Node.js 内置 HTTP 服务：接口、照片存储、JSON 数据持久化。
- `src/main.jsx` / `src/styles.css`：界面和响应式样式。
- `src/RecognitionPanel.jsx`：识别面板与清单行内的识别建议展示。
- `src/recognitionState.js`：识别状态机（过期保护、确认失效规则），纯函数便于测试。
- `server/recognizer.mjs`：视觉识别适配层（配置解析、provider 调用、结果规范化、超时与错误分类）。
- `server.mjs`：应用核心 `createLabApp`（可进程内调用）与 HTTP 服务。
- `tests/workflow.test.mjs` / `tests/recognition.test.mjs` / `tests/http.test.mjs`：业务流程、识别行为与 HTTP 端到端测试。
- `scripts/verify-flow.mjs`：命令行闭环验证脚本。
- `docs/codearts/`：本轮码道开发记录与真实测试日志。
- `.env.example`：识别服务配置模板（真实 `.env` 已被忽略）。

## 示例图

`public/images/toolkit.png` 由内置 ImageGen 生成，已在应用内标注为 AI 生成示例图。默认每件物品参考图使用此整套照片，可逐项上传真实单品照片替换。照片只用于演示，不属于真实借还凭证。

识别请求默认只使用本次上传的借出 / 归还照片或该示例图。由于默认参考图是整套示例照片、并非单品实拍，它不能代表具体某一件的真实外观；在正式核对前请逐项上传对应的单品参考照片。

生成提示：`Photorealistic top-down catalog photograph of exactly five evenly spaced tools on a pale blue laboratory desk: blue-black Phillips screwdriver, blue-black flat-head screwdriver, blue-handled combination pliers, adjustable steel wrench, yellow digital multimeter with red and black probes. Landscape 3:2, soft daylight, realistic materials, no hands, text, logos or watermark.`
