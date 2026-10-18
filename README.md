# RunScope

**A read-only GitHub Actions health dashboard for public repositories.** RunScope turns workflow history into a few useful delivery signals: success rate, median successful run time, failure patterns, per-workflow reliability, and a daily run trend.

**[Open the live dashboard](https://damnsunnyy.github.io/RunScope/)** · **[See the portfolio](https://damnsunnyy.github.io/Portfolio/)**

## Why I built it

I am moving toward DevOps and wanted a practical way to study delivery pipelines. RunScope uses the public GitHub Actions API to make CI/CD history easier to inspect. Start with `damnsunnyy/Portfolio`, or enter another public `owner/repo` and compare the workflow signals.

## What it does

- Reads public workflow and run history from the GitHub REST API; it has no account sign-in and requests no write permissions.
- Shows pass rate, successful-run median duration, completed failures, active runs, and a daily trend for 7, 30, or 90 days.
- Breaks results down by workflow and links each result back to the corresponding GitHub run.
- Filters recent runs by branch and event, then exports the collected report as JSON.
- Adapts to smaller screens and honors reduced-motion preferences.

## How the numbers work

- **Success rate:** successful runs divided by runs whose conclusion is `success` or `failure`. Cancelled, skipped, neutral, and in-progress runs are excluded.
- **Median duration:** successful completed runs only, using `run_started_at` and `updated_at`.
- **Reliability signal:** a small exploratory score based on success rate and sample size. It is not an SLO, uptime claim, or incident severity measure.
- **Time window:** filters the latest 100 runs returned by the API. If a repository has more than 100 runs in the selected period, older runs in that period will be missing from the chart and rates.
- **Failure patterns:** groups failed, timed-out, and action-required runs by workflow.

The API is unauthenticated and subject to GitHub's public rate limit. RunScope explains API errors in the interface and does not proxy or cache requests on a server. Your repository query remains in the page URL so you can share a read-only view; no repository data is saved by the app.

## Architecture

The interface is a static HTML/CSS/JavaScript site. `src/metrics.mjs` contains pure functions for durations, date windows, reliability, workflow groups, and trend buckets. `src/app.js` fetches GitHub data and renders the dashboard without a framework or third-party runtime dependency.

GitHub Actions checks JavaScript syntax and runs the metric unit tests on pushes and pull requests. Successful pushes to `main` deploy the site to GitHub Pages. The deployment uses the repository's built-in `GITHUB_TOKEN`; no deploy key or user secret is required.

## Run locally

```sh
npm test
npm run check
python3 -m http.server 8000
```

Open `http://localhost:8000`. A local HTTP server is needed because the app uses JavaScript modules.

## Limits and next steps

This is a read-only analytics view, not a hosted runner, log viewer, alerting service, or deployment controller. The dashboard does not retrieve logs or artifacts. Public API responses are limited to the latest 100 runs, and current run timestamps can change while work is in progress. A future iteration could add paginated history, workflow duration percentiles, release and rollback events, and authenticated private-repository access through a server-side integration.

## License

MIT. See [LICENSE](LICENSE).
