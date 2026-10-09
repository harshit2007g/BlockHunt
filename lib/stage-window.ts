export function stageOpen(
  value:
    | { open?: unknown; started_at?: unknown; duration_ms?: unknown }
    | null
    | undefined,
) {
  if (
    !value?.open ||
    typeof value.started_at !== "string" ||
    typeof value.duration_ms !== "number"
  )
    return false;
  const start = new Date(value.started_at).getTime();
  return (
    Number.isFinite(start) &&
    value.duration_ms > 0 &&
    Date.now() < start + value.duration_ms
  );
}
