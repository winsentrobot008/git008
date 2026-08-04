# 素材编辑与剪辑 (Media Editing)

## 编辑面板

通过详情面板的 "✂ Edit" 按钮打开底部编辑面板。

## 支持的操作

### 1. Trim (裁剪)
从视频中截取一段：
- Start: 起始时间（秒）
- Duration: 持续时间（秒）
- API: `POST /api/media/edit` with `operation=trim`

### 2. Compress (压缩)
降低视频码率以减小文件大小：
- CRF: 28（值越大质量越低）
- API: `POST /api/media/edit` with `operation=compress`

### 3. Transcode (转码)
转换为不同格式：
- MP4 / WebM / GIF
- API: `POST /api/media/edit` with `operation=transcode`

### 4. Color Filter (颜色滤镜)
应用情绪风格滤镜：

| 滤镜 | 效果 | 使用情绪 |
|------|------|----------|
| Warm | 暖色调 | 温暖、希望 |
| Cold | 冷色调 | 孤独、悲伤 |
| Vintage | 复古 | 释怀 |
| B&W | 黑白 | 悲伤、迷茫 |
| Sepia | 棕褐色 | 释怀、平静 |

### 5. Subtitle (字幕)
在视频上叠加字幕文字：
- 字体: SimHei
- 位置: 底部居中
- API: `POST /api/media/edit` with `operation=subtitle`

### 6. Image to Video (图片转视频)

将图片转换为带 Ken Burns 动效的视频：

| 动效 | 效果 |
|------|------|
| ken_burns | 缩放 + 平移 |
| blur_bg | 模糊背景填充 |
| static | 静态显示 |

API: `POST /api/media/image_to_video`

## 版本管理

每次编辑操作自动：
1. 生成新的 media ID
2. 设置 `parent_id` 指向原素材
3. 版本号递增
4. 可通过 `GET /api/media/versions/{id}` 查看历史
5. 可通过 `POST /api/media/rollback/{id}` 回滚
