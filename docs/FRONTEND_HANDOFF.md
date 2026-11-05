# BeautyMatch frontend handoff

The real `/crm` SPA now uses the BeautyMatch theme through Frappe's supported
`page_renderer` extension, native CRM branding/menu settings and a Lead HTML field.
See [CRM visual integration](CRM_VISUAL_INTEGRATION.md) for the installed-version
audit, file manifest, verification, deployment and rollback instructions.

The visual redesign is documented in [Botanical Cinema](BOTANICAL_CINEMA.md), including responsive screens, original artwork, actual screenshots and verification.

The current implementation and Vietnamese delivery report are documented in
[BAO_CAO_HOAN_THIEN.md](BAO_CAO_HOAN_THIEN.md). It includes the file manifest,
actual API contracts, test evidence, local commands, demo scenarios and limitations.

The integrated application starts at **http://localhost:8000/beautymatch**.
Use the existing authorized Frappe CRM login and keep the consultation/result
journey in the same tab so sessionStorage carries the identifiers safely.

Routes:

- `/beautymatch`: permission-filtered customer picker and real-data input presets.
- `/beautymatch/consultation`: existing TASK2 form, selected Lead context and retry.
- `/beautymatch/result`: persisted recommendation snapshots and real feedback.
- `/beautymatch/customer`: profile, Lead Summary, paginated history and task links.
- `/beautymatch/dashboard`: TASK4 all-time KPIs, charts and CSV.

The live catalog now contains three additional, explicitly labeled local demo
copies of existing CSV products; original catalog records were not changed.
Real matching was verified for **3, 2, 1 and 0 results**, reusing the same Lead.
Normal Interested feedback currently returns **PENDING** because the original
follow-up assignee setting remains unset. Real CREATED/task deduplication,
cancellation and reopening were verified in a rolled-back transaction.

Stable TASK2/TASK3/TASK4 source APIs and matching algorithm remain unchanged.
The adapter uses canonical `session_id` and `item_id`, unwraps Frappe's
`response.message`, preserves request identity and reads the previous cache format.
TASK4 requires a rejection reason and does not accept date filters for
`get_dashboard_data()`; the live UI follows those contracts.

Mock data is isolated in `demo-api.mjs`, enabled only with `?demo=1` on result or
dashboard, clearly labeled and never used as a silent API-error fallback.
`npm run dev` serves only the UI preview; use the Frappe site for the complete CRM
workflow. Run `npm run check`, `npm test`, `npm run test:e2e` and `npm run test:live`
from the repository. The live test creates one labeled synthetic Lead and six
consultations per successful run; credentials stay in memory, and existing CRM
records are not deleted.

All changes remain uncommitted on `feat/recommendation-ui`; no push, merge or PR.
