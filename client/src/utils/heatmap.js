// Shared building blocks for GitHub-style heatmaps (HabitHeatmap, PlannerHeatmap):
// a common progress→intensity mapping and the cell class for "no data" days.

export const EMPTY_CELL = 'bg-ink-900/[.07]';

export function levelFor(ratio) {
  if (ratio >= 1) return 3;
  if (ratio >= 0.65) return 2;
  if (ratio >= 0.35) return 1;
  return 0;
}
