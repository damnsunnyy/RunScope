import { dailySeries, filterRunsByWindow, groupByWorkflow, medianRunDuration, reliability } from './metrics.mjs';

const $ = (selector) => document.querySelector(selector);
const state = { owner: 'damnsunnyy', repo: 'Portfolio', workflows: [], runs: [], period: 30, visibleRuns: 10, branch: 'all', event: 'all', lastUpdated: null };
const apiBase = 'https://api.github.com';
const apiHeaders = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function repoSlug() { return `${state.owner}/${state.repo}`; }

function prettyDate(value, options = { month: 'short', day: 'numeric' }) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : new Intl.DateTimeFormat(undefined, options).format(date);
}

function durationLabel(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function statusName(run) {
  if (run.status !== 'completed') return run.status === 'in_progress' ? 'Running' : 'Queued';
  const labels = { success: 'Passed', failure: 'Failed', cancelled: 'Cancelled', skipped: 'Skipped', timed_out: 'Timed out', action_required: 'Needs action', neutral: 'Neutral', stale: 'Stale' };
  return labels[run.conclusion] || 'Completed';
}

function statusClass(run) {
  if (run.status !== 'completed') return 'pending';
  if (run.conclusion === 'success') return 'success';
  if (run.conclusion === 'failure' || run.conclusion === 'timed_out' || run.conclusion === 'action_required') return 'failure';
  return 'neutral';
}

function safeRunUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === 'github.com' && url.pathname.includes('/actions/runs/') ? url.href : '#';
  } catch { return '#'; }
}

function setStatus(message, ready = false) {
  $('#connection-label').textContent = message;
  $('#dashboard').setAttribute('aria-busy', String(!ready));
  $('#load-button').disabled = !ready && message === 'FETCHING LIVE WORKFLOW DATA';
  $('#refresh-button').disabled = !ready;
}

function setError(message) {
  const banner = $('#error-banner');
  banner.textContent = message;
  banner.hidden = !message;
}

function updateSelect(select, values, selected, label) {
  const options = values.map((value) => `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(value === 'all' ? label : value)}</option>`);
  select.innerHTML = options.join('');
}

function renderFilters() {
  const branches = [...new Set(state.runs.map((run) => run.head_branch).filter(Boolean))].sort(collator.compare);
  const events = [...new Set(state.runs.map((run) => run.event).filter(Boolean))].sort(collator.compare);
  updateSelect($('#branch-select'), ['all', ...branches], state.branch, 'ALL BRANCHES');
  updateSelect($('#event-select'), ['all', ...events], state.event, 'ALL EVENTS');
}

function renderMetrics(runs) {
  const value = reliability(runs);
  const active = runs.filter((run) => ['queued', 'in_progress', 'requested', 'waiting', 'pending'].includes(run.status)).length;
  const duration = medianRunDuration(runs.filter((run) => run.conclusion === 'success'));
  $('#success-rate').innerHTML = value.rate === null ? '—<small>%</small>' : `${value.rate}<small>%</small>`;
  $('#success-count').textContent = value.decisive ? `${value.passed} passed · ${value.decisive} decisive runs` : 'No passed or failed runs yet';
  $('#median-duration').textContent = durationLabel(duration);
  $('#failure-count').textContent = value.failed;
  $('#failure-foot').textContent = value.failed ? `${value.failed} failed of ${value.completed} completed` : 'No failures in this window';
  $('#workflow-count').textContent = state.workflows.length;
  $('#run-count').textContent = `${state.runs.length} of latest 100 runs loaded`;
  $('#window-runs').textContent = runs.length;
  $('#active-runs').textContent = active;
  $('#reliability-score').textContent = value.score ?? '—';
  $('#score-track').style.width = `${value.score ?? 0}%`;
  const tag = $('#signal-tag');
  tag.className = 'signal-tag';
  if (value.rate === null) {
    tag.textContent = 'NO SAMPLE';
    $('#reliability-copy').textContent = 'No completed pass/fail runs in this window. Try a longer window or another branch.';
  } else if (value.decisive < 5) {
    tag.textContent = 'SMALL SAMPLE';
    tag.classList.add('signal-caution');
    $('#reliability-copy').textContent = `The success rate is ${value.rate}% across ${value.decisive} decisive runs. Read it as an early signal; the sample is small.`;
  } else if (value.rate >= 90) {
    tag.textContent = 'STEADY';
    tag.classList.add('signal-good');
    $('#reliability-copy').textContent = `${value.rate}% of decisive runs passed. Watch the trend alongside release impact and recovery time.`;
  } else if (value.rate >= 70) {
    tag.textContent = 'WATCH';
    tag.classList.add('signal-caution');
    $('#reliability-copy').textContent = `${value.rate}% of decisive runs passed. Review failure patterns before the next release.`;
  } else {
    tag.textContent = 'NEEDS REVIEW';
    tag.classList.add('signal-bad');
    $('#reliability-copy').textContent = `${value.rate}% of decisive runs passed. Open the latest failed run and trace the first failing job.`;
  }
}

function renderChart(runs) {
  const days = Number(state.period);
  const series = dailySeries(runs, days);
  const width = 760;
  const height = 184;
  const left = 6;
  const right = 6;
  const top = 8;
  const base = 166;
  const maxValue = Math.max(1, ...series.map((day) => day.success + day.failure));
  const step = (width - left - right) / series.length;
  const barWidth = Math.max(2, Math.min(16, step * 0.58));
  const bars = series.map((day, index) => {
    const count = day.success + day.failure;
    const x = left + index * step + (step - barWidth) / 2;
    const totalHeight = Math.min(base - top, (count / maxValue) * (base - top));
    const failureHeight = count ? totalHeight * day.failure / count : 0;
    const successHeight = totalHeight - failureHeight;
    const ySuccess = base - totalHeight;
    const label = `${prettyDate(day.date, { weekday: 'short', month: 'short', day: 'numeric' })}: ${day.success} passed, ${day.failure} failed`;
    const success = successHeight ? `<rect x="${x.toFixed(2)}" y="${ySuccess.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${successHeight.toFixed(2)}" rx="2" fill="#b6f26d"/>` : '';
    const failure = failureHeight ? `<rect x="${x.toFixed(2)}" y="${base - failureHeight}" width="${barWidth.toFixed(2)}" height="${failureHeight.toFixed(2)}" rx="2" fill="#fa777d"/>` : '';
    return `<g><title>${escapeHtml(label)}</title>${success}${failure}</g>`;
  }).join('');
  const grid = [45, 86, 126, 166].map((y) => `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#ffffff10" stroke-dasharray="3 6"/>`).join('');
  $('#chart-wrap').innerHTML = `<svg class="trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily passed and failed workflow runs for the last ${days} days">${grid}<line x1="0" y1="${base}" x2="${width}" y2="${base}" stroke="#ffffff22"/>${bars}</svg>`;
  $('#chart-start').textContent = prettyDate(series[0].date);
  $('#chart-mid').textContent = prettyDate(series[Math.floor(series.length / 2)].date);
  $('#chart-end').textContent = 'TODAY';
  $('#trend-subtitle').textContent = `Daily completed runs · latest ${state.runs.length} runs in the selected window`;
}

function renderWorkflowRows() {
  const groups = groupByWorkflow(state.runs);
  const byId = new Map(groups.map((group) => [String(group.id), group]));
  const workflows = [...state.workflows].sort((a, b) => collator.compare(a.name, b.name));
  const rows = workflows.map((workflow) => {
    const group = byId.get(String(workflow.id));
    const lastRun = group?.latest;
    const last = lastRun ? `<a class="result-link ${statusClass(lastRun)}" href="${escapeHtml(safeRunUrl(lastRun.html_url))}" target="_blank" rel="noreferrer"><i></i>${escapeHtml(statusName(lastRun))} ↗</a>` : '<span class="muted">No recent run</span>';
    return `<tr><th scope="row"><span class="workflow-name">${escapeHtml(workflow.name)}</span><small>${escapeHtml(workflow.path?.split('/').at(-1) || workflow.state || 'GitHub Actions')}</small></th><td>${group?.runs.length ?? 0}</td><td>${group?.rate === null || group?.rate === undefined ? '—' : `${group.rate}%`}</td><td>${durationLabel(group?.medianDuration)}</td><td>${last}</td></tr>`;
  });
  $('#workflow-rows').innerHTML = rows.length ? rows.join('') : '<tr><td colspan="5" class="empty-row">No GitHub Actions workflows were returned for this repository.</td></tr>';
}

function renderFailures(runs) {
  const failed = runs.filter((run) => run.status === 'completed' && ['failure', 'timed_out', 'action_required'].includes(run.conclusion));
  const groups = groupByWorkflow(failed).slice(0, 4);
  if (!groups.length) {
    $('#failure-patterns').innerHTML = '<div class="no-failures"><span>✓</span><div><b>No recent failures</b><small>No failed runs were found in this selected window.</small></div></div>';
    return;
  }
  $('#failure-patterns').innerHTML = groups.map((group, index) => {
    const latest = group.latest;
    return `<a class="failure-item" href="${escapeHtml(safeRunUrl(latest?.html_url))}" target="_blank" rel="noreferrer"><span class="failure-number">0${index + 1}</span><span class="failure-copy"><b>${escapeHtml(group.name)}</b><small>${group.failed} failed · latest ${escapeHtml(prettyDate(latest?.created_at))}</small></span><span class="failure-arrow">↗</span></a>`;
  }).join('');
}

function filteredRuns() {
  return state.runs.filter((run) => (state.branch === 'all' || run.head_branch === state.branch) && (state.event === 'all' || run.event === state.event));
}

function renderRunList() {
  const runs = filteredRuns();
  const shown = runs.slice(0, state.visibleRuns);
  if (!shown.length) {
    $('#run-list').innerHTML = '<p class="empty-row">No runs match these filters.</p>';
    $('#more-runs').hidden = true;
    return;
  }
  $('#run-list').innerHTML = shown.map((run) => {
    const href = safeRunUrl(run.html_url);
    const title = run.display_title || run.head_commit?.message?.split('\n')[0] || run.name || 'Workflow run';
    return `<article class="run-row"><span class="run-status ${statusClass(run)}"><i></i><span class="visually-hidden">${escapeHtml(statusName(run))}</span></span><div class="run-main"><a class="run-title" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a><span class="run-meta"><b>${escapeHtml(run.name || 'Unnamed workflow')}</b><span>${escapeHtml(run.head_branch || 'unknown branch')}</span><span>${escapeHtml(run.event || 'unknown event')}</span><span>#${escapeHtml(run.run_number ?? run.id)}</span></span></div><span class="run-result ${statusClass(run)}">${escapeHtml(statusName(run))}</span><span class="run-duration">${durationLabel(run.status === 'completed' ? durationFor(run) : null)}</span><time datetime="${escapeHtml(run.created_at)}">${escapeHtml(prettyDate(run.created_at))}</time><a class="open-run" href="${escapeHtml(href)}" target="_blank" rel="noreferrer" aria-label="Open ${escapeHtml(run.name)} run in GitHub">↗</a></article>`;
  }).join('');
  $('#more-runs').hidden = runs.length <= state.visibleRuns;
}

function durationFor(run) {
  const start = Date.parse(run.run_started_at || run.created_at || '');
  const end = Date.parse(run.updated_at || '');
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? Math.round((end - start) / 1000) : null;
}

function render() {
  const inWindow = filterRunsByWindow(state.runs, Number(state.period));
  $('#repo-title').textContent = state.repo;
  $('#repo-description').textContent = `${repoSlug()} · ${state.workflows.length} workflows discovered`;
  $('#repo-link').href = `https://github.com/${encodeURIComponent(state.owner)}/${encodeURIComponent(state.repo)}`;
  $('#terminal-path').textContent = `${repoSlug()}/actions/runs`;
  $('#freshness').textContent = state.lastUpdated ? `UPDATED ${prettyDate(state.lastUpdated, { hour: 'numeric', minute: '2-digit' })}` : 'LIVE WORKFLOW DATA';
  renderMetrics(inWindow);
  renderChart(inWindow);
  renderWorkflowRows();
  renderFailures(inWindow);
  renderRunList();
  $('#export-button').disabled = state.runs.length === 0;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: apiHeaders });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 403 && payload.message?.toLowerCase().includes('rate limit')) {
      throw new Error('GitHub’s public API rate limit has been reached. Wait a minute or sign in to GitHub and try again later.');
    }
    if (response.status === 404) throw new Error('Repository not found. Check the owner/repo spelling and make sure the repository is public.');
    throw new Error(payload.message || `GitHub returned HTTP ${response.status}.`);
  }
  return { payload, remaining: response.headers.get('x-ratelimit-remaining') };
}

async function loadRepository(slug) {
  const parts = slug.trim().replace(/^\/+|\/+$/g, '').split('/');
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_.-]{1,100}$/.test(part))) {
    setError('Use a repository in owner/repo format, such as octocat/Hello-World.');
    return;
  }
  state.owner = parts[0];
  state.repo = parts[1];
  state.visibleRuns = 10;
  state.branch = 'all';
  state.event = 'all';
  setError('');
  $('#repo-input').value = repoSlug();
  $('#load-button').disabled = true;
  $('#load-button').querySelector('.button-label').textContent = 'READING WORKFLOWS…';
  $('#refresh-button').disabled = true;
  $('#export-button').disabled = true;
  $('#dashboard').setAttribute('aria-busy', 'true');
  $('#repo-title').textContent = state.repo;
  $('#repo-description').textContent = 'Loading public workflow history…';
  $('#terminal-path').textContent = `${repoSlug()}/actions/runs`;
  $('#connection-label').textContent = 'CONNECTING TO PUBLIC API';
  $('#freshness').textContent = 'FETCHING LIVE WORKFLOW DATA…';
  $('#workflow-rows').innerHTML = '<tr><td colspan="5" class="empty-row">Loading workflows…</td></tr>';
  $('#failure-patterns').innerHTML = '<p class="empty-row">Loading failure patterns…</p>';
  $('#run-list').innerHTML = '<p class="empty-row">Loading recent runs…</p>';
  try {
    const root = `${apiBase}/repos/${encodeURIComponent(state.owner)}/${encodeURIComponent(state.repo)}`;
    const [workflowResult, runResult, repositoryResult] = await Promise.all([
      fetchJson(`${root}/actions/workflows?per_page=100`),
      fetchJson(`${root}/actions/runs?per_page=100`),
      fetchJson(root),
    ]);
    state.workflows = workflowResult.payload.workflows || [];
    state.runs = runResult.payload.workflow_runs || [];
    state.repository = repositoryResult.payload;
    state.lastUpdated = new Date();
    state.rateRemaining = runResult.remaining;
    renderFilters();
    render();
    $('#repo-description').textContent = state.repository.description ? `${state.repository.description} · ${state.runs.length} recent runs loaded` : `${repoSlug()} · ${state.runs.length} recent runs loaded`;
    $('#connection-label').textContent = 'CONNECTED · PUBLIC WORKFLOW HISTORY';
    const rateNote = state.rateRemaining ? ` · ${state.rateRemaining} API requests left` : '';
    $('#freshness').textContent = `LIVE DATA · ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(state.lastUpdated)}${rateNote}`;
    setStatus('CONNECTED · PUBLIC WORKFLOW HISTORY', true);
    const query = new URLSearchParams(location.search);
    if (query.get('repo') !== repoSlug()) {
      query.set('repo', repoSlug());
      history.replaceState(null, '', `${location.pathname}?${query}`);
    }
  } catch (error) {
    setError(error.message || 'Could not load this repository. Try again in a moment.');
    $('#connection-label').textContent = 'CONNECTION NEEDS ATTENTION';
    $('#freshness').textContent = 'DATA COULD NOT BE LOADED';
    $('#repo-description').textContent = 'No data was stored. Correct the repository or wait for the public API to recover.';
    $('#workflow-rows').innerHTML = '<tr><td colspan="5" class="empty-row">No workflow data available.</td></tr>';
    $('#failure-patterns').innerHTML = '<p class="empty-row">Failure analysis is unavailable.</p>';
    $('#run-list').innerHTML = '<p class="empty-row">Recent runs are unavailable.</p>';
    $('#success-rate').innerHTML = '—<small>%</small>';
    $('#median-duration').textContent = '—';
    $('#failure-count').textContent = '—';
    $('#workflow-count').textContent = '—';
    $('#chart-wrap').innerHTML = '<div class="empty-chart">Workflow history is unavailable.</div>';
    $('#reliability-score').textContent = '—';
    $('#signal-tag').textContent = 'NO DATA';
    $('#reliability-copy').textContent = 'Check the repository and try again.';
    $('#score-track').style.width = '0%';
    setStatus('CONNECTION NEEDS ATTENTION', true);
  } finally {
    $('#load-button').disabled = false;
    $('#load-button').querySelector('.button-label').textContent = 'ANALYZE REPOSITORY';
    $('#refresh-button').disabled = false;
    $('#dashboard').setAttribute('aria-busy', 'false');
  }
}

$('#repo-form').addEventListener('submit', (event) => {
  event.preventDefault();
  loadRepository($('#repo-input').value);
});
$('#refresh-button').addEventListener('click', () => loadRepository(repoSlug()));
$('#period-select').addEventListener('change', () => { state.period = Number($('#period-select').value); render(); });
$('#branch-select').addEventListener('change', () => { state.branch = $('#branch-select').value; state.visibleRuns = 10; renderRunList(); });
$('#event-select').addEventListener('change', () => { state.event = $('#event-select').value; state.visibleRuns = 10; renderRunList(); });
$('#more-runs').addEventListener('click', () => { state.visibleRuns += 10; renderRunList(); });
$('#export-button').addEventListener('click', () => {
  if (!state.runs.length) return;
  const report = { generated_at: new Date().toISOString(), repository: repoSlug(), window_days: state.period, scope: 'latest 100 GitHub Actions workflow runs', metrics: reliability(filterRunsByWindow(state.runs, state.period)), workflows: groupByWorkflow(state.runs), runs: state.runs };
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  link.download = `${state.owner}-${state.repo}-runscope-report.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});

const initialRepo = new URLSearchParams(location.search).get('repo') || repoSlug();
$('#repo-input').value = initialRepo;
loadRepository(initialRepo);
