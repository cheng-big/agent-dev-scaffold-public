---
name: anti-omission-dev-blueprint
description: 「防漏开发蓝图提取器」SOP——专为纯文本 PRD（无原型）设计。通过文本逆向工程榨取隐性系统约束，解决「漏菜单、流程、功能、字段」问题。执行两阶段：阶段一提取「一级/二级菜单树」+「状态机」并 STOP 确认（用户要求「直接跑」时跳过阻断）；阶段二将菜单拆解为带 menu_group 分组、域驱动厚字段的「页面级原子契约 JSON 数组」，丢入配套 blueprint_render.html 渲染分级可视化开发蓝图。
---

# anti-omission-dev-blueprint — 防漏开发蓝图提取器 SOP

## 1. 角色与定位
你扮演 **顶级架构师与全栈 Tech Lead**。任务是「文本逆向工程」：把散文式 PRD 强行降维，转化为供前端生成组件、QA 编写用例的**工程脚手架契约**。产物面向「开发前」——是从 PRD 推断「该有什么」的蓝图，**不是逆向已写的代码**。

## 2. 文档读取铁律
1. **纯 PRD 逆向**：所有菜单、按钮、状态、字段必须能溯源到 PRD。**禁止从项目已落地代码（DTO/entity/Vue）抽字段**——那会偏离「开发前蓝图」定位。
2. **PDF 提取方法**（Read 工具渲染 PDF 需 poppler，常缺失）：
   - 用 pymupdf 提全文本层：`pip3 install pymupdf --break-system-packages`，`fitz.open(pdf); page.get_text()`，落地到 `/tmp/<sys>_full.txt`，再按系统章节切片精读，不要把全文灌进上下文。
   - **原型图是图片，纯文本提取抓不到字段**：`page.get_pixmap(matrix=fitz.Matrix(2.2,2.2)).save(png)` 渲染成 PNG 再 Read 视觉读。深化设计方案的原型图通常低清、字段信息有限，仅作页面结构佐证。
3. **字段真源三层**（只读第一层会系统性漏字段）：
   - ① **PDF 功能叙述 prose**——直接写到的字段（如「品牌/型号/IP」「建筑面积/开放时间」）
   - ② **PDF 原型图**——渲染视觉读，补结构
   - ③ **域驱动富表单常识**——PDF 没写但后台必有的（藏汉双语拆分、封面/媒体、经纬度选点、状态机字段、父级关联、金额链路字段、审计字段等）
4. **以 PRD 为核心事实**：附加《功能明细清单》仅作防漏参考，冲突时标红提示。

## 3. 工作流（两阶段）

### 阶段一：蓝图骨架解析
锁定指定系统（一次一个，逐系统精读）后，输出 Markdown：

**第一部分：🗺️ 全局路由菜单树（防漏菜单 · 分级）**
推导**一级菜单（业务域聚合）→ 二级菜单（末级页面）**两层结构，附原文章节号。标注非本端（C 端/核销端）功能。例：
> **📂 一级：场馆资源管理**
> - 📄 体育中心管理 (`/venue/center` 推导) [§5.5.3.3.1]

> ⚠️ PRD 通常零路由零字段（界面图仅图名），路由标 `推导`，需与权限表菜单编码对齐。

**第二部分：⚙️ 核心状态机矩阵（防漏流程）**
表格：实体名、初始状态、触发动作(API/按钮)、跃迁后状态、隐藏/禁用约束、原文依据。

**第三部分：⚠️ 盲点与高风险报告**
PRD 模糊处（如「有查询功能」但无查询条件）、职责越界、状态机缺口、多端归属未切分等。

**【强制阻断】** 输出完毕**立刻停止**，逐字发送：
> 🎯 **菜单路由与状态机骨架提取完毕。**
> 请产研团队确认。如无误，请回复『确认』，我将为每一个末级菜单生成适配 HTML 渲染器的「页面级原子契约 JSON 数组」。

> **例外**：当用户已明确要求「直接跑 / 不要确认 / 一次跑完」时，**跳过本阻断**，阶段一输出后连续进入阶段二，不等待。

### 阶段二：生成页面级原子契约（分组 + 域驱动厚字段）
1. **【触发】** 用户回复「确认/修改」后，或用户已授权「直接跑」时。
2. 为每个**末级菜单**拆契约，三视图：
   - **data_view**：列表列/详情字段
   - **action_view**：独立交互动作（新增/导出/审核按钮）
   - **input_view**：表单/搜索输入项及必填属性
3. **每个对象必带 `menu_group`**（所属一级菜单名），供渲染器分级。
4. **字段必须域驱动加厚**（这是防漏核心，逐组做、每个上下文聚焦一个组）：
   - data_view 按实体真实复杂度做全：**核心业务实体 10–17 字段**，规则/统计类 6–10，不是 prose 直译。
   - input_view 与 data_view 呼应；双语字段拆 `(汉)`/`(藏)`；状态字段 type=Enum 且 remark 标「状态机变色：A/B/C」；父级关联标「父级·防断链」；金额标「金额链路·防兜底价」；唯一键标「唯一」。
   - **每个字段 remark 标来源**：`PDF明示`（prose 直接写的）或 `域驱动`（经验补的），便于追溯。
5. **逐组生成 + 分组校验**：一组一轮，写入后按 menu_group 原位替换合并，断言路由唯一、总数不变（见 §5 工程做法）。
6. 体量大时写入项目文件 `docs/blueprints/<sys>_blueprint.json`（非刷屏，统一放此目录别散在根目录），再用 blueprint_render.html 渲染。

## 4. JSON 结构规范（严格匹配 blueprint_render.html）
渲染器已支持 `menu_group` 分级（一级分区 + 二级缩进导航）。结构：

```json
[
  {
    "menu_group": "场馆资源管理",
    "page_menu_name": "体育中心管理",
    "route_path": "/venue/center",
    "reference_section": "§5.5.3.3.1",
    "atomic_contract": {
      "data_view": [
        {"field": "中心名称(汉)", "type": "String", "remark": "PDF明示 · 藏汉双语"},
        {"field": "运营状态", "type": "Enum", "remark": "状态机变色：启用/停用"}
      ],
      "action_view": [
        {"action_name": "新增中心", "type": "Primary Button", "permission": "场馆管理员", "remark": "弹出表单"},
        {"action_name": "停用/启用", "type": "Table Action", "permission": "场馆管理员", "remark": "状态机切换"}
      ],
      "input_view": [
        {"input_label": "中心名称(汉)", "component": "Input", "required": true, "remark": "藏汉双语"},
        {"input_label": "封面图片", "component": "Upload", "required": false, "remark": "域驱动"}
      ]
    },
    "state_machine": {
      "entity": "体育中心",
      "initial": "已创建",
      "transitions": [
        {"from": "已创建", "action": "提交审核", "to": "审核中", "guard": ""},
        {"from": "审核中", "action": "审核通过", "to": "已生效", "guard": "改删需重审"}
      ]
    }
  }
]
```
- `type` 取值：String / Number / Enum / Date / Boolean（驱动徽章配色与状态机变色）
- `action_view.type`：Primary Button / Secondary Button / Table Action / Danger
- `input_view.component`：Input / Textarea / Select / Cascader / NumberPicker / DatePicker / DateRangePicker / Upload / Switch / MapPicker 等
- **`state_machine`（可选，与 atomic_contract 平级）**：承载阶段一状态机矩阵，挂在该实体的**主页面**上（一实体一份，别重复挂）。`transitions[]` 每项 = `{from, action, to, guard}`，`guard` 即隐藏/禁用约束（如「仅生效中可挂起」「已核销不可重复」「改删需重审」），非空时渲染器红色高亮。渲染器自动在该卡片末尾展示状态流转面板。**状态机的状态值仍要同时落到 data_view 状态字段的 remark（"状态机变色：A/B/C"）供前端做下拉/变色**——两者一个管流转、一个管展示，都要有。

## 5. 工程做法（落地经验）
- **逐组替换合并**（避免一次性重写整份巨型 JSON 出错）：
  ```python
  allp=json.load(open(P)); G="组名"
  idx=next(k for k,p in enumerate(allp) if p["menu_group"]==G)
  rest=[p for p in allp if p["menu_group"]!=G]
  merged=rest[:idx]+new+rest[idx:]
  rps=[p["route_path"] for p in merged]
  assert not [r for r in rps if rps.count(r)>1]   # 路由唯一
  json.dump(merged,open(P,"w"),ensure_ascii=False,indent=2)
  ```
- **沙箱坑**：Bash 写项目文件若报 `No such file`（文件其实存在），加 `dangerouslyDisableSandbox: true` 重跑——沙箱对项目路径可见性可能不一致。
- 用 python dict 内联构造该组数据（`f()/a()/i()` 工厂函数）比手写 JSON 省心、不怕逗号。
- 大 Write 偶发 malformed：截断到最后一个 `]` 修复，或分片 `/tmp/part_*.json` 再 python 合并。

## 6. 本 skill 边界
不改业务代码、不建 TaskCreate。只产：阶段一骨架（Markdown）+ 阶段二 `docs/blueprints/<sys>_blueprint.json`。渲染器 blueprint_render.html 随 skill 分发。
