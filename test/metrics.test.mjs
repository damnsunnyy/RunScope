import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dailySeries, durationSeconds, filterRunsByWindow, groupByWorkflow, median,
  medianRunDuration, reliability,
} from '../src/metrics.mjs';

const now = Date.parse('2026-10-18T12:00:00.000Z');
function run(overrides = {}) {
  return {
    id: Math.random(), workflow_id: 12, name: 'Deploy', status: 'completed', conclusion: 'success',
    created_at: '2026-10-17T10:00:00.000Z', run_started_at: '2026-10-17T10:00:00.000Z',
    updated_at: '2026-10-17T10:02:30.000Z', head_branch: 'main', event: 'push', html_url: 'https://github.com/o/r/actions/runs/1',
    ...overrides,
  };
}

test('median handles empty, odd, and even collections', () => {
  assert.equal(median([]), null);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([8, 2]), 5);
});

test('duration uses run start and updated timestamps and rejects invalid ranges', () => {
  assert.equal(durationSeconds(run()), 150);
  assert.equal(durationSeconds(run({ updated_at: '2026-10-17T09:00:00.000Z' })), null);
  assert.equal(durationSeconds(run({ run_started_at: null })), 150);
});

test('reliability excludes cancelled, skipped, and in-progress runs', () => {
  const value = reliability([
    run(), run({ id: 2, conclusion: 'failure' }), run({ id: 3, conclusion: 'cancelled' }),
    run({ id: 4, status: 'in_progress', conclusion: null }), run({ id: 5, conclusion: 'skipped' }),
  ]);
  assert.deepEqual(value, { completed: 4, decisive: 2, passed: 1, failed: 1, rate: 50, score: 39 });
});

test('date window excludes older and future runs', () => {
  const filtered = filterRunsByWindow([
    run(), run({ id: 2, created_at: '2026-09-01T00:00:00.000Z' }),
    run({ id: 3, created_at: '2026-10-19T00:00:00.000Z' }),
  ], 30, now);
  assert.equal(filtered.length, 1);
});

test('workflow groups include reliability, successful median, and latest run', () => {
  const grouped = groupByWorkflow([
    run(), run({ id: 2, conclusion: 'failure', updated_at: '2026-10-17T10:01:00.000Z' }),
    run({ id: 3, workflow_id: 5, name: 'Checks', created_at: '2026-10-18T09:00:00.000Z', run_started_at: '2026-10-18T09:00:00.000Z', updated_at: '2026-10-18T09:01:00.000Z' }),
  ]);
  assert.equal(grouped[0].name, 'Deploy');
  assert.equal(grouped[0].failed, 1);
  assert.equal(grouped[0].medianDuration, 150);
  assert.equal(grouped.find((item) => item.name === 'Checks').latest.id, 3);
  assert.equal(medianRunDuration([run({ conclusion: 'failure' })]), null);
});

test('daily series allocates successful and failed completed runs to UTC days', () => {
  const series = dailySeries([
    run({ created_at: '2026-10-18T09:00:00.000Z' }),
    run({ id: 2, conclusion: 'failure', created_at: '2026-10-18T10:00:00.000Z' }),
    run({ id: 3, status: 'in_progress', conclusion: null }),
  ], 7, now);
  assert.equal(series.length, 7);
  assert.equal(series.at(-1).success, 1);
  assert.equal(series.at(-1).failure, 1);
  assert.equal(series.reduce((sum, day) => sum + day.success + day.failure, 0), 2);
});
