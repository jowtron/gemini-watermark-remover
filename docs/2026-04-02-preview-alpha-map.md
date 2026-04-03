# Preview Alpha Map 活文档

最后更新：2026-04-03

## 背景

当前项目对原始 Gemini 导出图的去水印效果明显优于 preview 图。

已经确认：

- `21-9.webp` 去水印后残留梯度约为 `0.0758`
- `21-9-preview.png` 去水印后残留梯度约为 `0.1753`
- `9-16.webp` 与 `9-16-preview.png` 的差异较小，但 preview 仍更容易留下轻微轮廓
- 这些 preview 样本是手动保存的原始预览图，不是油猴脚本链路产物

因此，当前问题不是 userscript 页面流程，而是 preview 文件本身的像素形态与原图不同。

## 当前判断

最可能的根因不是“定位错误”，而是：

- preview 图中的水印已经经历过一次缩放 / 重采样
- 当前使用的标准 `48px / 96px alpha map` 对原图更匹配
- 对 preview 图而言，等效水印边缘更宽、更软、更淡
- 直接套用标准 alpha map，即使能命中位置，也更容易在低纹理背景留下淡残影

换句话说，preview 图与原图确实存在额外像素链路差异。

不过到 2026-04-03 为止，当前工程判断已经更新为：

- 独立 preview alpha map 仍然值得保留为离线研究方向
- 但在现有样本上，它还没有稳定优于“标准 alpha 骨架 + 更精确的 preview edge cleanup”
- 当前生产主线先回到后者，优先解决真实可见的 preview 残影

## 已有证据

### 样本对

- 原图：`src/assets/samples/21-9.webp`
- 预览图：`src/assets/samples/21-9-preview.png`
- 原图：`src/assets/samples/9-16.webp`
- 预览图：`src/assets/samples/9-16-preview.png`

### 已确认现象

- preview 图尺寸与原图不同，且是独立栅格文件
- 将原图缩放到 preview 尺寸后，仍不能完全复现 preview 图像素
- 说明 preview 图不只是“原图简单缩小”，还可能包含额外重采样、压缩或渲染链路差异

### 已完成修复

- preview-anchor 选点逻辑已修复，避免误吸到极端右下角
- preview-anchor 路径默认单 pass 停止，避免后续 pass 重新拉出边缘

这部分已经提交：

- commit: `77bb964`

## 方案选择

当前主推方案已经调整为：继续保留 preview alpha 标定链路，但生产修复优先走 preview edge cleanup 目标函数优化。

原因：

- 独立 alpha map 的 freeform 与 constrained 两条路都还没有找到安全且稳定的生产解
- 当前更直接的问题是：现有 preview cleanup 指标抓不到“平坦背景上的淡白边带”
- 这个问题更适合通过局部 halo 指标和更强 cleanup preset 解决

当前优先推进的是：

1. 用 alpha 边带与外圈邻域的亮度差量化 halo
2. 让 preview edge cleanup 的候选筛选直接压制这种局部残影
3. 保持 learned preview alpha 仅作为后续离线研究线

## 技术路线

### 路线 A：经验标定 preview alpha map

对每组样本：

1. 将原图缩放到 preview 尺寸
2. 在候选 watermark ROI 内，按通道反推 alpha
3. 对多组样本做鲁棒聚合，得到 preview alpha 模板

优点：

- 最贴近真实 preview 文件
- 不必先假设 Gemini 的缩放核

风险：

- 如果 preview 来源链路不稳定，单模板可能不够

### 路线 B：从标准 alpha map 推导 preview alpha map

方法：

1. 从标准 `48 / 96` alpha map 出发
2. 施加缩放、亚像素偏移、模糊核
3. 拟合到 preview 样本

优点：

- 结构更可解释

风险：

- 参数空间大，早期推进成本更高

当前结论：先做路线 A，尽快拿到第一张可验证的 preview alpha 模板。

## 当前推进状态

### 已完成

- 确认 preview 残影问题与 userscript 页面链路无关
- 确认源图路径明显优于 preview 路径
- 确认值得尝试 preview 专用 alpha map
- 新增活文档：`docs/2026-04-02-preview-alpha-map.md`
- 新增核心标定函数：`src/core/previewAlphaCalibration.js`
- 新增离线脚本：`scripts/calibrate-preview-alpha.js`
- 新增测试：
  - `tests/core/previewAlphaCalibration.test.js`
  - `tests/scripts/previewAlphaCalibration.test.js`

### 进行中

- 实现 preview alpha 标定工具链
- 增加测试，验证从“原图 + preview 图”能反推出稳定 alpha

### 待验证

- `21:9 preview` 是否能通过标定模板把残留进一步压低
- preview 模板是否按尺寸分桶即可稳定工作
- 是否需要额外记录 preview 专用 warp / blur 参数

## 实施约束

- 不回退原图路径现有行为
- preview 专用逻辑必须只作用于 preview 图
- 先做离线标定与验证，不直接改线上默认模板
- 每次推进都要记录到这份文档

## 下一步

1. 写 preview alpha 标定的核心单测
2. 实现最小标定函数，输入为“原图 + preview 图 + ROI”
3. 增加一个脚本，输出可检查的 preview alpha 产物
4. 用现有 `21-9` / `9-16` 配对样本做第一次离线实验

## 2026-04-02 第一轮实验结果

### 产物

已生成：

- `.artifacts/preview-alpha-map/preview-alpha-map.json`

当前脚本命令：

```bash
node scripts/calibrate-preview-alpha.js \
  --pair src/assets/samples/21-9.webp src/assets/samples/21-9-preview.png \
  --pair src/assets/samples/9-16.webp src/assets/samples/9-16-preview.png
```

### 当前输出

- size `30`: `1` 个样本
- size `35`: `1` 个样本

### 当前观察

- 工具链已经能自动：
  - 读取 `source + preview` 配对样本
  - 在 preview 图上复用现有检测逻辑定位 ROI
  - 将 source 缩放到 preview 尺寸
  - 反推出第一版 preview alpha 数据
- 当前还只有单样本标定，因此结果只能算“候选 alpha”
- `35px` 桶里已经出现明显高值像素，说明：
  - 预览图与缩放后的 source 之间仍有真实差异
  - 单纯逐像素反推会把这部分差异也吸收到 alpha 里
  - 这正是下一轮需要约束和清洗的部分

## 2026-04-02 第二轮实验结果

### 新增内容

- `previewAlphaCalibration.js` 新增：
  - `blurAlphaMap`
  - `fitConstrainedPreviewAlphaModel`
- 标定脚本现在会同时输出：
  - `buckets`：自由反推 alpha
  - `constrainedBuckets`：基于标准 alpha 的受限拟合 alpha

### 实验目标

验证“标准 alpha + shift/scale/blur/gain 拟合”是否能替代自由反推，避免亮斑式过拟合。

### 结果

对 `21-9-preview`：

- `current`：仍有可见残影
- `freeform calibrated`：明显过拟合，出现亮白菱形
- `constrained calibrated`：比自由反推稳，但仍保留明显菱形轮廓

实验结论：

- 自由反推 alpha 不能直接用于 preview 修复
- 受限拟合比自由反推安全，但单独使用仍不足以消除 `21:9 preview` 的可见残影
- 当前受限搜索里，较优解反而接近：
  - 无 blur
  - 轻微 scale 调整
  - 再叠加现有 edge cleanup

这说明：

- “preview watermark = 标准 alpha 经过 blur” 这个假设至少不完整
- 真正有效的方向更可能是：
  - 标准 alpha 的轻微几何修正
  - 再结合 preview 专用边缘清理
  - 而不是试图直接学习一整张新的 alpha 图

### 当前判断更新

下一步不应直接把 `constrainedBuckets` 接入生产路径。

更合理的路线是：

1. 保留标准 alpha 为主骨架
2. 在 preview 路径里增加更明确的参数拟合记录
3. 把 edge cleanup 的触发条件和目标函数改成：
   - 压残影轮廓
   - 同时避免亮斑 / 发灰

### 下一轮重点

1. 给反推 alpha 增加平滑 / 去噪 / 置信约束
2. 把标定结果可视化，便于人工判断是否接近真实 watermark 形状
3. 累积更多 preview 配对样本，避免单样本模板过拟合

## 2026-04-03 第三轮结果

### 本轮改动

- `src/core/restorationMetrics.js`
  - 新增 `assessAlphaBandHalo(...)`
  - 量化 preview ROI 中 `alpha 0.12 ~ 0.35` 边带与外圈邻域的亮度差
- `src/core/watermarkProcessor.js`
  - preview edge cleanup 增加更强的 `radius=4 / strength=1.4 / maxAlpha=0.35` preset
  - 候选评分加入 `halo` 惩罚
  - 当基线 halo 明显偏亮时，要求候选必须实质降低 halo
- `tests/regression/sampleAssetsRemoval.test.js`
  - `21-9-preview.png` 新增更严格回归：
    - `processedGradientScore < 0.15`
    - `halo delta < 4`

### 结果

`21-9-preview.png` 当前处理结果从：

- `processedGradient ≈ 0.1753`
- `haloDelta ≈ 9.54`

下降到：

- `processedGradient ≈ 0.1125`
- `haloDelta ≈ -0.29`

这次变化和用户目测问题是一致的：原先那种平坦背景上的淡白菱形边带，已经从“明显偏亮”压到接近背景。

### 验证

- `node --test tests/regression/sampleAssetsRemoval.test.js --test-name-pattern "21-9-preview|9-16-preview"`
- `node --test tests/regression/realPagePreviewRemoval.test.js`
- `pnpm test`

以上都已通过。

### 当前判断

- learned preview alpha 仍可继续研究，但不应阻塞当前生产修复
- 对 `21-9-preview` 这类平坦背景样本，问题核心更像是局部 halo 残影，而不是定位或整张 alpha 模型错误
- 下一轮如果还要继续优化，应优先观察：
  - 更强 real-page preview fixture 是否也需要单独 halo 约束
  - 是否要把 halo 指标扩展到更多 alpha band，而不只是当前中低 alpha 边带
