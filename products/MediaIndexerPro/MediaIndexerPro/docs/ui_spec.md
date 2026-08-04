# MediaIndexerPro UI Design Specification

## Page Layout

```
┌─────────────────────────────────────────────────┐
│  Nav Bar: 📊 MediaIndexerPro  | 刷新按钮  | 时间 │
├─────────────────────────────────────────────────┤
│  Stats Cards Row (4 cards, responsive grid)     │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐          │
│  │总文件数│ │总大小 │ │ 图片  │ │ 视频  │          │
│  └──────┘ └──────┘ └──────┘ └──────┘          │
├─────────────────────────────────────────────────┤
│  Screenshot Preview Section (if exists)         │
├─────────────────────────────────────────────────┤
│  Search + Filter Bar                            │
│  [🔍 搜索文件名...      ] [全部类型 ▼]          │
├─────────────────────────────────────────────────┤
│  Files Table                                    │
│  ┌────────┬──────┬──────┬──────────┬──────────┐ │
│  │ 文件名  │ 类型 │ 大小 │ 修改时间  │ 路径     │ │
│  ├────────┼──────┼──────┼──────────┼──────────┤ │
│  │ 🖼️ x  │ 图片 │ 1KB │ 2026-... │ photos/  │ │
│  └────────┴──────┴──────┴──────────┴──────────┘ │
└─────────────────────────────────────────────────┘
```

## Color Scheme

- **Background**: `bg-gray-50` (#F9FAFB)
- **Nav**: White background, shadow-sm border-b
- **Title**: `text-gray-900` (#111827)
- **Subtitle**: `text-gray-500` (#6B7280)
- **Card backgrounds**: White, rounded-xl shadow-sm border
- **Primary button**: `bg-blue-600` text-white
- **Table header**: `bg-gray-50`
- **Table rows**: White with hover `bg-gray-100` (#F3F4F6)
- **Type badges**:
  - Image: `bg-blue-50 text-blue-700`
  - Video: `bg-pink-50 text-pink-700`
  - Audio: `bg-green-50 text-green-700`
  - Document: `bg-yellow-50 text-yellow-700`

## Typography

- **Page title**: 2xl, font-bold
- **Card numbers**: 2xl, font-bold
- **Table headers**: xs, uppercase, tracking-wider
- **Table cells**: sm, font-medium (name), sm, text-gray-500 (other)
- **Badges**: xs, font-medium, rounded-full

## Spacing

- **Nav**: px-4 sm:px-6 lg:px-8, py-4
- **Main**: max-w-7xl, mx-auto, px-4 sm:px-6 lg:px-8, py-8
- **Cards grid**: gap-6, mb-8
- **Filter bar**: p-4, mb-6, gap-4
- **Table cells**: px-6 py-4

## Responsive Behavior

- **Mobile (<640px)**: Stats cards stack 1 column, search+filter stack vertically
- **Tablet (640-1024px)**: Stats cards 2 columns
- **Desktop (>1024px)**: Stats cards 4 columns, full table with all columns
- **Table**: Overflow-x-auto on mobile for horizontal scroll

## Accessibility (ARIA)

- Nav has `role="navigation"` and `aria-label="Main navigation"`
- Search input has `aria-label="Search files"`
- Type filter select has `aria-label="Filter by file type"`
- Table has `role="table"` and `aria-label="Media files list"`
- Refresh button has `aria-label="Refresh data"`
- Stats cards have `aria-label` for screen readers

## Required Elements

1. Navigation bar with title + refresh button + timestamp
2. Stats cards showing: total files, total size, per-type counts
3. Screenshot preview section (conditional)
4. Search input with placeholder
5. Type filter dropdown
6. Files table with 5 columns
7. Empty state message when no files
8. Type badges with icons
