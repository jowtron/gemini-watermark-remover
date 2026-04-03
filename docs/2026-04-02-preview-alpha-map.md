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

## 2026-04-03 第四轮结果

### 新诊断

在第三轮之后，用户继续反馈“仍有轻微残影”。

结合截图与定向量化，这一轮确认了两个更细的根因：

1. `21-9-preview` 这种平坦背景样本，已经不再是整块发白，而是尾部轮廓型残影。
2. `real-page-preview-strong` 这种强样本，并不是没有更好的 cleanup 候选，而是：
   - preview cleanup 的二次进入门槛过于保守
   - 尾部 cleanup 要求的最小梯度收益过高

换句话说，当前问题已经从“有没有 cleanup”变成了“cleanup 是否允许在 residual 阶段继续收尾”。

### 本轮改动

- `src/core/watermarkProcessor.js`
  - `PREVIEW_EDGE_CLEANUP_GRADIENT_THRESHOLD` 从 `0.24` 下调到 `0.1`
  - 新增 preview cleanup 多轮接受上限：`PREVIEW_EDGE_CLEANUP_MAX_APPLIED_PASSES = 3`
  - 当基线已经进入 residual 阶段时：
    - `baselineGradient <= 0.16` 允许更小的 `minGradientImprovement = 0.005`
    - `halo` 很强时允许更宽松的 `minGradientImprovement = 0.01`
  - 当 `halo` 明显偏亮时，允许在 `spatial <= 0.18` 的范围内继续尝试 cleanup，而不再死卡 `0.08`

### 结果

`21-9-preview.png` 在当前实现里进一步变成：

- `source = standard+preview-anchor+validated+warp+edge-cleanup+edge-cleanup+edge-cleanup`
- `spatial ≈ 0.0133`
- `gradient ≈ 0.0473`
- `haloDelta ≈ -1.18`

`real-page-preview-strong-1024x559.png` 当前变成：

- `source = standard+preview-anchor+validated+edge-cleanup+edge-cleanup`
- `spatial ≈ 0.1375`
- `gradient ≈ 0.2826`
- `haloDelta ≈ 2.28`

和第三轮相比，这一轮的改进点不是“更大力一次”，而是“允许 residual 阶段继续做安全的小收尾”。

### 验证

- `node --test tests/regression/sampleAssetsRemoval.test.js --test-name-pattern "21-9-preview\\.png should use preview-anchor edge cleanup to reduce residual watermark edges"`
- `node --test tests/regression/realPagePreviewRemoval.test.js --test-name-pattern "real Gemini strong preview fixture should keep aggressive edge cleanup without profile overrides"`
- `pnpm test`

以上都已通过。

### 当前判断

- 当前主线仍然应该是 preview cleanup 规则细化，而不是回到整张 learned alpha map
- 第四轮已经证明：
  - residual 阶段需要单独的接受规则
  - 低梯度尾部轮廓不能再用第一轮 cleanup 的门槛来判断
  - strong preview 的剩余问题也更像 cleanup gate，而不是 template 错位

## 2026-04-03 第五轮结果

### 本轮目标

验证一个更根本的方向：

- 不再继续把问题只当作“preview 上直接减 watermark”
- 而是先把 preview 看成一个前向渲染结果
- 再尝试做最小逆求解

本轮只实现离线实验能力，不接生产路径。

### 新增实验能力

- `src/core/previewAlphaCalibration.js`
  - 新增 `renderPreviewWatermarkObservation(...)`
  - 新增 `fitPreviewRenderModel(...)`
  - 新增 `restorePreviewRegionWithRenderModel(...)`
- `tests/core/previewAlphaCalibration.test.js`
  - 新增 synthetic 前向模型拟合测试
  - 新增 synthetic 逆求解优于直接反混合的测试

### synthetic 结果

在合成数据里，如果 preview 观测满足：

- 标准 alpha 经 `shift/scale/alpha-blur`
- 再经过一次 composite blur

那么：

- `fitPreviewRenderModel(...)` 能正确恢复 composite blur
- `restorePreviewRegionWithRenderModel(...)` 明显优于直接 `removeWatermark(...)`

这说明“前向模型 + 逆求解”这条技术路线本身是成立的。

### 真实样本结果

对真实样本对做离线实验后，观察到：

- `21-9-preview.png`
  - 当前生产输出相对 `source-resized` 的 ROI 平均绝对误差约 `37.19`
  - 实验性逆求解后约 `27.84`
- `9-16-preview.png`
  - 当前生产输出相对 `source-resized` 的 ROI 平均绝对误差约 `9.19`
  - 实验性逆求解后约 `7.20`

但同时出现了一个更重要的现象：

- 拟合到的最佳前向模型并不稳定地选择 `compositeBlurRadius > 0`
- 真实样本里，拟合常常仍然偏向：
  - `compositeBlurRadius = 0`
  - 轻微 `shift/scale`
  - 小幅 `alphaGain` 调整

这和 synthetic 结果不同。

### 新判断

这说明当前更根本的障碍并不是“还没把前向模型写出来”，而是：

- `source-resized` 不是 preview 的真实 clean truth
- preview 背景本身就和 `source-resized` 有系统差异
- 用 `source-resized` 去拟合 preview 渲染链路，会把背景差异错误吸收到 watermark 模型里

换句话说，真实问题已经从：

- “如何学习 preview watermark”

变成了：

- “如何在没有真实 clean preview 的前提下，从 preview 自身恢复 clean ROI”

### 当前最根本的方向更新

如果继续深挖，真正该做的不是继续依赖 `source-resized` 配对，而是二选一：

1. 原图路径优先
   - 如果能拿到原图，就只处理原图，再按 preview 的显示链路生成预览
   - 这是最干净的根法

2. preview-only 逆问题
   - 不再把 `source-resized` 当作 clean truth
   - 改成从 preview 邻域构造 clean prior
   - 在 ROI 内解：
     - watermark 参数
     - clean 背景
     - 局部平滑 / 纹理连续性

当前判断里，第二条才是“只有 preview 栅格文件时”的真正根法。

### 验证

- `node --test tests/core/previewAlphaCalibration.test.js tests/scripts/previewAlphaCalibration.test.js`

以上已通过。

## 2026-04-03 第六轮结果

### 本轮目标

继续沿 `preview-only inverse problem` 推进，但不再只停留在“四边线性插值 prior”。

本轮的核心问题是：

- 现有 `buildPreviewNeighborhoodPrior(...)` 只是把左右、上下边界做一次线性混合
- 这对平滑底色有效
- 但对用户截图里那种沿菱形轮廓残留的轻微残影，内部连续性约束还不够

### 本轮改动

- `src/core/previewAlphaCalibration.js`
  - `buildPreviewNeighborhoodPrior(...)` 从简单边界插值升级为：
    - 先用四边插值做初值
    - 再把 ROI 外真实 preview 像素作为固定边界
    - 在 ROI 内做多轮 harmonic / diffusion 型松弛
- `tests/core/previewAlphaCalibration.test.js`
  - 新增一个 diagonal harmonic background synthetic 用例
  - 要求新的 prior 明显优于旧的“四边线性插值基线”

### synthetic 结果

新测试确认：

- 在对角线 / 鞍形背景上，旧 prior 和简单边界插值基线完全等价
- harmonic prior 能明显优于该基线
- 这说明“只看四边摘要值”确实会丢失 ROI 内部的连续性结构

### 真实样本观察

仍然用 `source-resized` 作为近似参考时，当前 harmonic prior 的离线结果表现为：

- `21-9-preview.png`
  - 当前生产输出相对 `source-resized` 的 ROI 平均绝对误差约 `37.19`
  - 当前 preview-only harmonic prior 恢复后约 `34.81`
  - 说明有改善，但仍然不够大
- `9-16-preview.png`
  - 当前生产输出相对 `source-resized` 的 ROI 平均绝对误差约 `9.19`
  - 当前 preview-only harmonic prior 恢复后约 `7.32`
  - 说明较平稳样本上 prior 升级更有效

额外 sweep 后观察到：

- `21-9-preview` 在更大的 `priorRadius` 与更强 `blendStrength` 下还能再小幅下降
- 但收益仍然有限，远不到“根治残影”的程度

### 新判断

这轮结果很关键，因为它把下一步该做什么进一步收窄了：

1. 现在的问题已经不再是 prior 太弱到完全没法用。
2. `21-9-preview` 这种 stubborn 样本上，真正的瓶颈更像是 `fitPreviewOnlyRenderModel(...)` 的评分目标不对齐。

当前 `preview-only` 拟合主要还是在最小化：

- `rendered(prior, alpha params)` 与 `preview` 的 ROI 内 L1 差异

但这不等价于：

- 去水印后是否和 ROI 外边界连续
- 去水印后是否真正压掉 watermark correlation / residual contour

换句话说，下一步更值得做的不是继续换一版 prior，而是给 `preview-only` 拟合目标补上：

- 恢复后边界连续性 penalty
- 恢复后 watermark residual / contour penalty
- 必要时再加局部纹理保真项

### 验证

- `node --test tests/core/previewAlphaCalibration.test.js tests/scripts/previewAlphaCalibration.test.js`
- `pnpm test`

以上已通过。

## 2026-04-03 第七轮结果

### 本轮目标

把 `preview-only` 的评分目标再往前推一步，但保持改动仍然只在离线研究链路。

上一轮已经确认：

- harmonic prior 本身已经不再是完全无效的
- 真正的问题是 `fitPreviewOnlyRenderModel(...)` 仍然只在拟合 watermark 参数
- 它没有把“最终恢复出来的 clean ROI”真正纳入目标函数

### 本轮改动

- `src/core/previewAlphaCalibration.js`
  - `fitPreviewOnlyRenderModel(...)` 改成两段式：
    1. 先用旧的 prior forward score 粗选 `alpha / shift / blur`
    2. 再在固定 alpha candidate 上搜索 `blendStrength`
  - 新增 final restored output 的 inverse-consistency 打分
  - 新增 preview 边界连续性评分
- `tests/core/previewAlphaCalibration.test.js`
  - 新增 synthetic 回归：
    - 当 `blendStrength` 可搜索时，拟合器必须真正考虑最终恢复结果，而不能只看 prior 的 forward render
- `scripts/calibrate-preview-alpha.js`
  - preview-only 标定现在会输出：
    - `blendStrength`
    - `previewOnlyDiagnostics.forwardScore`
    - `previewOnlyDiagnostics.inverseScore`
    - `previewOnlyDiagnostics.boundaryScore`
  - 当前离线脚本默认会搜索：
    - `blendStrengthCandidates = [0.55, 0.7, 0.85, 1]`
    - `boundaryContinuityWeight = 5`

### 本轮关键判断

本轮最重要的发现不是某个固定参数，而是：

1. 如果把 `blendStrength` 和 alpha 参数一起联合搜索，优化会退化到“更像原 preview”的方向。
2. 更稳的做法是：
   - 先粗定 alpha candidate
   - 再单独 refine `blendStrength`

这说明当前 preview-only 逆问题里，`blendStrength` 更像“恢复阶段参数”，而不是前向 watermark 参数本身。

### 真实样本结果

当前脚本默认配置下，preview-only 会输出：

- `21-9-preview.png`
  - `shift = (0, 0, 1.01)`
  - `blendStrength = 1`
  - `forwardScore ≈ 12.22`
  - `inverseScore ≈ 3.89`
  - `boundaryScore ≈ 7.80`
  - 相对 `source-resized` 的 ROI 平均绝对误差约：
    - 生产输出 `≈ 37.19`
    - preview-only 当前结果 `≈ 34.70`
- `9-16-preview.png`
  - `shift = (0, 0.5, 0.99)`
  - `blendStrength = 1`
  - `forwardScore ≈ 7.17`
  - `inverseScore ≈ 2.03`
  - `boundaryScore ≈ 3.85`
  - 相对 `source-resized` 的 ROI 平均绝对误差约：
    - 生产输出 `≈ 9.19`
    - preview-only 当前结果 `≈ 7.05`

### 新判断

这轮之后，问题边界更清楚了：

- preview-only 现在已经不只是：
  - “构造一个 prior”
  - “拟合一个 alpha 参数”
- 它已经开始显式地把：
  - 最终恢复结果
  - 再正向渲染一致性
  - 边界连续性
  一起纳入评分

但 `21-9-preview` 仍然只获得有限改善，说明：

- 当前 boundary penalty 的方向是对的
- 但量纲和权重还比较粗
- 下一步更值得做的是：
  - 校准 boundary score 的尺度
  - 或进一步搜索 `priorRadiusCandidates`
  - 而不是再回去堆新的 cleanup 规则

### 验证

- `node --test tests/core/previewAlphaCalibration.test.js tests/scripts/previewAlphaCalibration.test.js`

以上已通过。

## 2026-04-03 第八轮结果

### 本轮目标

继续把 `preview-only` 评分目标做实，但这次聚焦在另一个前一轮暴露出来的问题：

- `priorRadius` 已经证明会显著影响结果
- 但如果只按全局最小 `forwardScore` 选 candidate，会把 `priorRadius` 误判成“只是一个更前面的粗筛参数”

实际上，`priorRadius` 会影响：

- 邻域 prior 的形态
- 后续 restore 的边界连续性
- 最终 `blendStrength` refine 的可行空间

所以它不能只按前向拟合优劣决定。

### 本轮改动

- `src/core/previewAlphaCalibration.js`
  - `fitPreviewOnlyRenderModel(...)` 新增 `priorRadiusCandidates`
  - 搜索流程改成：
    1. 对每个 `priorRadius` 单独求一个最优 alpha candidate
    2. 再把这些 candidate 放到最终评分阶段统一比较
  - 不再让“全局最小 forward-only prior”直接抢占最终结果
- `tests/core/previewAlphaCalibration.test.js`
  - 新增 `priorRadius` 搜索回归
  - 新增“跨 `priorRadius` 的最终评分比较”回归
- `scripts/calibrate-preview-alpha.js`
  - preview-only 默认搜索现在改为：
    - `blendStrengthCandidates = [0.55, 0.7, 0.85, 1]`
    - `priorRadiusCandidates = [4, 6, 8, 10]`
    - `boundaryContinuityWeight = 12`

### 新增测试结论

本轮补的两个新回归分别证明：

1. `priorRadius` 搜索本身是必要的。
2. 即使搜索了 `priorRadius`，也不能只看哪一个半径的 `forwardScore` 最小。
   - 必须先保留每个半径自己的候选
   - 再在最终 restore 评分阶段比较

这两点都已经通过新的 synthetic 回归固定下来。

### 真实样本结果

按当前脚本默认配置，preview-only 当前会收敛到：

- `21-9-preview.png`
  - `shift = (0, 0, 1.01)`
  - `priorRadius = 8`
  - `blendStrength = 1`
  - `forwardScore ≈ 12.37`
  - `inverseScore ≈ 3.93`
  - `boundaryScore ≈ 7.79`
  - 相对 `source-resized` 的 ROI 平均绝对误差约：
    - 生产输出 `≈ 37.19`
    - preview-only 当前结果 `≈ 34.60`
- `9-16-preview.png`
  - `shift = (0, 0.5, 0.99)`
  - `priorRadius = 6`
  - `blendStrength = 1`
  - `forwardScore ≈ 7.17`
  - `inverseScore ≈ 2.03`
  - `boundaryScore ≈ 3.85`
  - 相对 `source-resized` 的 ROI 平均绝对误差约：
    - 生产输出 `≈ 9.19`
    - preview-only 当前结果 `≈ 7.05`

和第七轮相比，这一轮最关键的变化不是绝对数值跳很多，而是：

- `21-9-preview` 不再被固定在 `priorRadius = 6`
- preview-only 搜索链路开始真正具备“多尺度 prior 候选比较”的能力

### 当前判断

到这一步，preview-only 方向的最小验证链路已经比第七轮完整很多：

- 搜 `alpha / shift / blur`
- 搜 `blendStrength`
- 搜 `priorRadius`
- 并且 `priorRadius` 不再只受 forward-only 粗筛控制

剩下最值得继续做的不是继续加更多自由度，而是：

1. 重新标定 boundary score 的量纲
2. 让 `boundaryContinuityWeight` 更可解释，而不是继续靠手工 sweep 常数

因为 `21-9-preview` 这种 stubborn 样本当前仍然只获得有限改善，说明：

- 多尺度 prior 已经有用
- 但最终评分函数还没有完全对齐用户目测的“残余轮廓感”

### 验证

- `node --test tests/core/previewAlphaCalibration.test.js tests/scripts/previewAlphaCalibration.test.js`

以上已通过。

## 2026-04-03 第九轮结果

### 本轮目标

继续推进上一轮留下的核心问题：

- `boundaryScore` 的方向基本是对的
- 但它一直是绝对通道差量纲
- 不同样本的边界本底对比度不同，导致同一组 `boundaryContinuityWeight` 很难解释

这轮不再加新的自由度，先把 boundary 指标本身去量纲。

### 本轮改动

- `src/core/previewAlphaCalibration.js`
  - 新增 `measurePreviewBoundaryMetrics(...)`
  - boundary 诊断现在会同时输出：
    - `boundaryRawScore`
    - `boundaryPreviewScore`
    - `boundaryContrastScore`
    - `boundaryNormalizer`
    - `boundaryScore`
  - 其中当前 `boundaryScore` 已改为归一化后的分数，而不是绝对通道差
- `fitPreviewOnlyRenderModel(...)`
  - 最终评分阶段改为使用归一化后的 boundary 分数
- `scripts/calibrate-preview-alpha.js`
  - 离线脚本现在会把上述 boundary 诊断一并写入产物
- `tests/core/previewAlphaCalibration.test.js`
  - 新增 synthetic 回归，证明：
    - 在“相同相对边界改善、不同绝对对比度”的两个样本里
    - raw boundary 会随对比度一起放大
    - normalized boundary 会保持接近

### synthetic 结论

这轮新增的红测固定了一个此前只有直觉、没有回归保护的问题：

- 如果两个候选在“相对边界改善比例”上等价
- 仅仅因为一个样本的边界本底对比度更高
- raw boundary 就会把它判得更重

归一化后，这种跨样本量纲偏差被压掉了。

### 真实样本结果

按当前脚本默认配置：

- `blendStrengthCandidates = [0.55, 0.7, 0.85, 1]`
- `priorRadiusCandidates = [4, 6, 8, 10]`
- `boundaryContinuityWeight = 12`

当前离线结果变成：

- `21-9-preview.png`
  - `shift = (0, 0, 1.01)`
  - `priorRadius = 4`
  - `blendStrength = 0.55`
  - `forwardScore ≈ 11.959259`
  - `inverseScore ≈ 2.593704`
  - `boundaryScore ≈ 0.733149`
  - `boundaryRawScore ≈ 8.64751`
  - `boundaryPreviewScore ≈ 11.795019`
  - 相对 `source-resized` 的 ROI 平均绝对误差约：
    - 生产输出 `≈ 37.19`
    - preview-only 当前结果 `≈ 35.15`
- `9-16-preview.png`
  - `shift = (0, 0.5, 0.99)`
  - `priorRadius = 6`
  - `blendStrength = 0.55`
  - `forwardScore ≈ 7.173061`
  - `inverseScore ≈ 1.163265`
  - `boundaryScore ≈ 0.866071`
  - `boundaryRawScore ≈ 4.041667`
  - `boundaryPreviewScore ≈ 4.666667`
  - 相对 `source-resized` 的 ROI 平均绝对误差约：
    - 生产输出 `≈ 9.19`
    - preview-only 当前结果 `≈ 7.85`

### 本轮关键判断

这轮最重要的结果不是数值大跳，而是问题边界又收紧了一步：

1. 先前 raw boundary 的确带有明显跨样本量纲偏差。
   - 旧诊断里，`21-9-preview` 的 raw boundary 明显大于 `9-16-preview`
   - 但归一化后，反而是：
     - `21-9-preview boundaryScore ≈ 0.73`
     - `9-16-preview boundaryScore ≈ 0.87`
   - 这说明 raw 数字大，不等于相对边界连续性更差。

2. 但“只把 boundary 去量纲”还不够。
   - 归一化后，拟合器明显更偏向较低的 `blendStrength = 0.55`
   - 这表明当前最终评分里，真正开始主导的已经不是 boundary 量纲，而是 `inverseScore`

3. 因此，下一步更该怀疑的是：
   - `inverse consistency` 本身和用户目测残影之间并不完全对齐
   - 现在的问题已经从“boundary 权重太手工”进一步收敛成：
     - 如何让最终评分更直接对应“残余轮廓感”

### 当前结论更新

当前可以明确说：

- boundary 去量纲这步是必要的
- 它让不同样本的诊断终于能放在一个更可比较的尺度上
- 但它没有直接解决 stubborn 样本仍有残影的问题

下一步最值得做的，不再是继续 sweep `boundaryContinuityWeight`，而是二选一：

1. 把 boundary 项改成“相对 preview baseline 的改善量”而不只是归一化绝对值
2. 给最终评分再补一个更直接针对 residual contour 的项，而不只依赖 `inverseScore`

### 验证

- `node --test tests/core/previewAlphaCalibration.test.js tests/scripts/previewAlphaCalibration.test.js`
- `pnpm test`

以上已通过。
