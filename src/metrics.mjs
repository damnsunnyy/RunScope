export function completedRuns(runs) {
  return runs.filter((run) => run.status === 'completed');
}

export function durationSeconds(run) {
  const start = Date.parse(run.run_started_at || run.created_at || '');
  const end = Date.parse(run.updated_at || '');
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? Math.round((end - start) / 1000)
    : null;
}

export function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function reliability(runs) {
  const completed = completedRuns(runs);
  const decisive = completed.filter((run) => ['success', 'failure'].includes(run.conclusion));
  const passed = decisive.filter((run) => run.conclusion === 'success').length;
  const failed = decisive.length - passed;
  const rate = decisive.length ? Math.round((passed / decisive.length) * 100) : null;
  const sampleFactor = Math.min(decisive.length / 10, 1);
  const score = rate === null ? null : Math.round(rate * (0.72 + 0.28 * sampleFactor));
  return { completed: completed.length, decisive: decisive.length, passed, failed, rate, score };
}

export function medianRunDuration(runs) {
  return median(runs.filter((run) => run.status === 'completed' && run.conclusion === 'success')
    .map(durationSeconds).filter((seconds) => seconds !== null));
}

export function filterRunsByWindow(runs, days, now = Date.now()) {
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return runs.filter((run) => {
    const created = Date.parse(run.created_at || '');
    return Number.isFinite(created) && created >= cutoff && created <= now;
  });
}

export function groupByWorkflow(runs) {
  const groups = new Map();
  for (const run of runs) {
    const id = String(run.workflow_id ?? run.name ?? 'unknown');
    if (!groups.has(id)) groups.set(id, { id, name: run.name || 'Unnamed workflow', runs: [] });
    groups.get(id).runs.push(run);
  }
  return [...groups.values()].map((workflow) => ({
    ...workflow,
    ...reliability(workflow.runs),
    medianDuration: medianRunDuration(workflow.runs),
    latest: [...workflow.runs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] || null,
  })).sort((a, b) => (b.failed - a.failed) || (a.rate ?? 101) - (b.rate ?? 101) || b.runs.length - a.runs.length);
}

export function dailySeries(runs, days, now = Date.now()) {
  const dayMs = 24 * 60 * 60 * 1000;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const start = today.getTime() - (days - 1) * dayMs;
  const buckets = Array.from({ length: days }, (_, index) => ({
    date: new Date(start + index * dayMs), success: 0, failure: 0, other: 0,
  }));
  for (const run of completedRuns(runs)) {
    const created = Date.parse(run.created_at || '');
    const index = Math.floor((created - start) / dayMs);
    if (index < 0 || index >= buckets.length) continue;
    if (run.conclusion === 'success') buckets[index].success += 1;
    else if (run.conclusion === 'failure') buckets[index].failure += 1;
    else buckets[index].other += 1;
  }
  return buckets;
}
