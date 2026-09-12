# GIT008 动效模板库

供 `modules/video_factory`（HyperFrames 渲染 / 分镜组装管道）直接复用。
模板使用 `string.Template` 占位符（`$title` / `$scenes` 等），由
`modules/video_factory/storyboard.py` 在组装工作区时替换。

## 目录

```text
templates/
└── hyperframes/
    ├── hyperframes.json   # HyperFrames registry 配置骨架
    ├── index.html         # 整片外壳（画布 / CSS 变量 / GSAP 时间线）
    └── scene.html         # 文字卡分镜片段（hero_title / text_card / callout）
```

## 约定

- `index.html` 必须保留 `data-composition-id="root"` 根节点与
  `window.__timelines["root"]` GSAP 时间线，供 `hyperframes lint/validate/render`
  契约校验。
- 分镜场景类型：`hero_title` / `text_card` / `callout`（文字卡）、`image`、
  `video`、`composition`（内嵌 HTML 动效）。
- 本地图片/视频/音频在组装时自动复制进工作区 `assets/`，模板内引用相对路径。

