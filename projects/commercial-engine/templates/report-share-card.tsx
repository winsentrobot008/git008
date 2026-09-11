/**
 * report-share-card — 静态报告分享卡模板（Report Sharing）
 *
 * 用于把一次 AI 营养分析结果渲染为可分享的静态卡片
 * （社交分享 / 截图 / 导出），供各套娃应用复用统一视觉与字段契约。
 *
 * 字段契约（与 analyze-text / analyze-image 返回结构一致）：
 *   records[].food / calories / protein_g / fat_g / carbs_g
 *   totals: totalKcal / totalProtein / totalFat / totalCarbs
 */

import type { JSX } from "react";

export interface ShareFoodRecord {
  food: string;
  grams: number;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
}

export interface ReportShareCardTemplateProps {
  title: string;
  subtitle: string;
  records: ShareFoodRecord[];
  totals: {
    totalKcal: number;
    totalProtein: number;
    totalFat: number;
    totalCarbs: number;
  };
  footer?: string;
}

export default function ReportShareCardTemplate({
  title,
  subtitle,
  records,
  totals,
  footer,
}: ReportShareCardTemplateProps): JSX.Element {
  return (
    <div className="report-share-card">
      <div className="report-share-header">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="report-share-totals">
        <span className="total-kcal">{totals.totalKcal} kcal</span>
        <span>P {totals.totalProtein}g</span>
        <span>F {totals.totalFat}g</span>
        <span>C {totals.totalCarbs}g</span>
      </div>
      <ul className="report-share-items">
        {records.map((r, i) => (
          <li key={`${r.food}-${i}`}>
            <span className="food-name">{r.food}</span>
            <span className="food-meta">
              {r.grams}g · {r.calories} kcal · P{r.protein_g} F{r.fat_g} C{r.carbs_g}
            </span>
          </li>
        ))}
      </ul>
      {footer && <div className="report-share-footer">{footer}</div>}
    </div>
  );
}
