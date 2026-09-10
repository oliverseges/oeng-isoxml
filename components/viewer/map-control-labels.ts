import {
  createI18n,
  DEFAULT_LOCALE,
  type SupportedLocale,
} from "@/lib/client/i18n";

export function executedOutlierControlLabel(
  hideOutliers: boolean,
  outlierCount: number,
  locale: SupportedLocale = DEFAULT_LOCALE,
): string {
  const i18n = createI18n(locale);
  if (outlierCount <= 0) {
    return hideOutliers
      ? i18n.t("map.outliers.noneHidden")
      : i18n.t("map.outliers.noneDetected");
  }

  return hideOutliers
    ? i18n.t("map.outliers.show", { count: outlierCount })
    : i18n.t("map.outliers.hide", { count: outlierCount });
}
