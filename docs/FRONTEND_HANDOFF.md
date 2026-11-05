# BeautyMatch frontend handoff

Implemented on `feat/recommendation-ui`. No merge or push was performed.

## Preview now (Windows, no Frappe required)

From the repository root:

```powershell
npm ci
npm run dev
```

Open:

- http://127.0.0.1:4173/beautymatch/result?demo=1
- http://127.0.0.1:4173/beautymatch/dashboard?demo=1

The preview serves the same template, CSS, JavaScript and assets as Frappe. It does **not** emulate a Frappe server: `/api/` returns 503. Consultation and login links explain that those pages require Frappe. Stop the preview with Ctrl+C. Node 20+ is recommended; this implementation was checked with the locally installed Node runtime.

The demo notice stays visible. Select 0/1/2/3 products, connection error, or CREATED/PENDING/failed feedback in the demo controls. These controls call a separate adapter and never write to CRM. Live failures never silently select demo data.

## Use with Frappe v15

Use the existing Bench site with CRM and BeautyMatch installed. Ensure `apps/beautymatch` contains this working tree, including the new `api/frontend.py` and `public/` assets. If copying changes into a separate Bench checkout, copy the new files as well; uncommitted changes do not travel through a Git clone.

From the Bench directory:

```bash
bench --site crm.localhost list-apps
# Only if beautymatch is available in apps/ but not installed on this site:
bench --site crm.localhost install-app beautymatch
bench build --app beautymatch
bench --site crm.localhost clear-cache
bench start
```

For the Docker setup in the parent folder, first start Docker Desktop and the existing Compose services. Enter the existing Frappe container with `docker compose exec frappe bash`, then work in `/home/frappe/frappe-bench`. The repository is mounted at `/workspace/beautymatch`. No Docker files or initialization script were changed.

Log in at http://crm.localhost:8000/login as an authorized Sales User, Sales Manager, System Manager or Administrator. Use the existing http://crm.localhost:8000/beautymatch/consultation form in the **same tab**; it redirects to `/beautymatch/result`. Open `/beautymatch/dashboard` for analytics. Use the hostname configured on your site if it differs.

No frontend bundler or production npm runtime is needed. Frappe serves the checked-in ES modules, CSS, images and licensed Inter font files from `/assets/beautymatch/`.

## Files and ownership

| Files | Purpose |
| --- | --- |
| `beautymatch/www/beautymatch/result.html`, `result.py` | Native Frappe results route and uncached, session-specific context |
| `beautymatch/www/beautymatch/dashboard.html`, `dashboard.py` | Native Frappe dashboard route and context |
| `beautymatch/templates/beautymatch_app.html` | Shared standalone page shell, Vietnamese language, CSRF meta token |
| `beautymatch/public/css/beautymatch.css` | Responsive tokens, typography, cards, charts, dialogs and motion |
| `beautymatch/public/js/app.mjs` | Results, feedback, history, dashboard filters, CSV and dialog interactions |
| `beautymatch/public/js/components.mjs` | Reusable cards, profile, loading/empty/error states, chart and safe-content helpers |
| `beautymatch/public/js/api.mjs` | Live API transport, request deduplication, timeout, handoff validation and feedback status interpretation |
| `beautymatch/public/js/demo-api.mjs` | Explicit demo adapter, separate from live transport |
| `beautymatch/public/demo/products.json`, `public/images/*` | Demo catalog metadata, product imagery and leaf mark |
| `beautymatch/public/fonts/*` | Self-hosted Inter Latin/Vietnamese fonts and OFL license |
| `beautymatch/api/frontend.py` | New read-only, permission-scoped projections and private-identifier transport bridge |
| `scripts/preview_frontend.mjs`, `prepare_frontend_assets.py` | Local preview and optional asset refresh |
| `package.json`, `package-lock.json`, `playwright.config.mjs` | Preview and verification tooling |
| `tests/frontend/api.test.mjs`, `tests/browser/beautymatch.spec.mjs`, `tests/test_frontend_api.py` | Transport, browser/accessibility and projection tests |
| `.gitignore` | Ignore browser test artifacts |

`matching_engine.py`, `profile.py`, `recommendation.py`, `feedback.py`, `dashboard.py`, DocTypes and the existing consultation form are unchanged. There are no schema migrations. The fetched `origin/feat/recommendation-api` API files matched this branch at implementation time.

## API contracts and integration

All endpoint names below are relative to `/api/method/` and use the Frappe `{message: ...}` envelope. Credentials remain same-origin; POSTs send the session CSRF token.

| Frontend operation | Real implementation and parameters |
| --- | --- |
| Generate | POST `beautymatch.api.recommendation.generate_recommendations` with **exactly** `crm_lead`, `beauty_profile`, `request_id`, `profile_version` from the existing handoff |
| Retrieve saved result | Existing `beautymatch.api.recommendation.get_recommendation_result(recommendation_session)`, called through the new read bridge |
| Customer history | Existing **`get_consultation_history(crm_lead, limit=20, start=0)`**, called through the bridge; the logical client operation is named `get_customer_history` |
| Feedback | POST `beautymatch.api.feedback.submit_feedback` with `recommendation_session`, `recommendation_item`, `feedback` and optional enum `rejection_reason` for Not Interested |
| Profile/photos | New `beautymatch.api.frontend.get_result_context(recommendation_session)`, called through the bridge |
| Requested dashboard | GET new `beautymatch.api.frontend.get_dashboard_data(start_date, end_date)`, which calls existing **`beautymatch.api.dashboard.get_dashboard`** and adds real computed metrics |

The existing backend does **not** contain functions named `get_customer_history` or `get_dashboard_data`. Its dashboard exposes `total_sessions`, `total_recommendations`, `interested_rate`, `follow_up_tasks`, `sessions_by_day` and `feedback_distribution`. The new module adds the requested fields without changing that contract or inventing values.

`frontend.read` accepts POST `{operation, parameters}` for only three allowlisted operations: result, history, and result context. It directly invokes their existing functions, retaining role and CRM Lead checks. This bridges GET-only APIs without putting Lead, profile, request or session identifiers into URL query strings. It cannot dispatch arbitrary methods or perform writes. Date filters are the only API query parameters the client creates.

The new context projection exposes only the stored non-contact `PROFILE_FIELDS` and catalog assets for recommended products. This is necessary because the existing result response excludes `profile_snapshot`, `image_url`, and `product_url`; Sales Users also lack generic Product/Beauty Profile DocType read permissions. It does not expose names, email addresses or phone numbers.

### Dashboard definitions

- `total_sessions`: the existing dashboard's count within the inclusive date range, scoped to visible CRM Leads.
- `leads_with_profile`: distinct visible Leads with a consultation in that range and a currently Active, consented Beauty Profile.
- `interest_rate`: alias of the existing `interested_rate`; percentage of explicitly answered recommendation items that are Interested. Unanswered items are excluded from the denominator.
- `average_top1_score`: mean stored `final_match_score` for `rank == 1` in the selected sessions. No Top-1 values means `null`, rendered as `—`.
- `top_skin_concerns`: count sessions whose stored profile snapshot selects each concern. A session may contribute to several concerns.
- `top_interested_products`: count Interested items by product, with stored product name snapshots; at most five rows.

Charts are dependency-free responsive bar charts with accessible numeric labels and expandable data tables. CSV exports the actual loaded date range and datasets, quotes values, includes a UTF-8 BOM and protects spreadsheet formula cells.

### Request identity and feedback status

The consultation form already writes:

```js
sessionStorage.setItem('beautymatch_pending_v1', JSON.stringify({
  crm_lead, beauty_profile, request_id, profile_version
}));
```

The result page validates these identifiers and never replaces the request UUID. Concurrent identical calls share one promise. A successful generated session is cached in `beautymatch_result_v1`, keyed by its original request ID; reload fetches that stored session. Timeout retries use the same request ID, so the existing backend's idempotency/locks protect a committed request whose response was lost. Feedback disables both buttons on the affected card and relies on the backend's existing task idempotency. Feedback is not automatically retried.

The **current live feedback API** returns `status: "Follow-up Created"` with `follow_up_task`, or `"Feedback Received"`; it does not currently return CREATED/PENDING. The UI preserves the returned status and shows a created-follow-up message only when a task is returned or the API explicitly says CREATED. If an API returns PENDING, that exact state is shown. It never relabels a failed request as success. CREATED/PENDING are directly exercisable in demo mode. Rejection reasons use the backend's exact five Vietnamese enum values and can be omitted.

## Mock data and assets

Only `?demo=1` activates mocks. Demo profiles, scores (94/88/82), explanations, aggregate numbers, history IDs and feedback results are synthetic. Demo product names, snapshot prices, ingredient text and URLs are copied from `data/BeautyMatch_Hasaki_Dataset_Verified.csv`; they are not live commerce prices or verified suitability claims.

Three photos come from the catalog's Hasaki URLs. The demo uses CSS viewports to display the product regions of those promotional banners; source files are unchanged. Live image URLs stay dynamic, with a labeled fallback for missing/broken photos. A missing product URL opens an accessible product-information dialog. Image source URLs remain in the CSV; `scripts/prepare_frontend_assets.py` can refresh them with network access. Inter is self-hosted under the included SIL OFL license. No generated skincare claim is introduced into live data.

## Verification

```powershell
npm run check
npm test
npm run test:e2e
npm run format:check
python -m unittest discover -s tests -p "test_*.py" -v
```

Playwright is configured for installed Google Chrome. On a machine without Chrome, install it or adjust `channel` in `playwright.config.mjs` to the available Playwright browser. Browser tests create a local server automatically and save screenshots in ignored `test-results/`.

Verified: 8 Node transport/security tests; 31 offline Python tests (27 existing + 4 projection/access tests); 10 desktop/mobile browser cases, including all demo states, real-adapter HTTP fixtures, retry identity, duplicate click suppression, feedback failure/optional reason/PENDING flows, charts, filters, CSV, focus restoration, image loading, no horizontal overflow, console page errors and Axe accessibility scans.

**Verification limits:** Docker daemon was not running and Frappe is not installed in the host Python environment. Browser “live” transport cases use explicit contract fixtures, not a real database. Before production, run Consultation → Generate → Reload → Feedback → CRM Task → History → Dashboard on the Bench site, verify role/Lead restrictions using two staff accounts, and confirm repeated Interested clicks create only one task. These live acceptance checks have not been claimed as passed.

The native route shells explicitly extend the shared HTML document, avoiding Frappe v15's automatic `templates/web.html` wrapping of source fragments. The session CSRF token is provided by each route controller. Relevant framework behavior was checked against the official [v15 template renderer](https://github.com/frappe/frappe/blob/version-15/frappe/website/page_renderers/template_page.py), [JSON request parsing](https://github.com/frappe/frappe/blob/version-15/frappe/app.py), and [session token implementation](https://github.com/frappe/frappe/blob/version-15/frappe/sessions.py).

## Figma status

The supplied file is [BeautyMatch / Untitled](https://www.figma.com/design/QpzljOe4tKR8V0p95WLncI/Untitled?node-id=0-1). Figma MCP exposed the screen/component hierarchy, including recommendation, mobile dashboard, feedback, empty, skeleton, profile, button and KPI components. The first root design-context request could not resolve a selected layer. Subsequent reads reached the Figma Starter MCP call limit, so high-fidelity screen renders, asset extraction and write operations were unavailable.

**No Figma screens were modified; the originals are preserved.** The implementation follows the accessible structural context and the requested BeautyMatch brand direction. Exact visual parity with every existing Figma screen was not verified, and editable Figma improvements remain outstanding until MCP access is available.
