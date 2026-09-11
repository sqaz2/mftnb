# MFTNB estimator audit and corrective build

Audit date: 2026-09-11. Repository: sqaz2/mftnb. Baseline commit: `00a185918dbe91c943198c54c228eb845f3b240f`.

## Decision and release status

The old public calculator was not supported by a documented MFTNB rate card or completed-job timing data. This build removes its unsupported automatic prices, durations and crew assignments while retaining the guided intake, editable review, downloadable move plan and submission workflow. It is a **review-first quote request**, not a newly calibrated automatic estimator. No competing company's prices have been adopted as MFTNB rates.

The code is prepared for review on `fix/estimator-audit-red-deer`; production deployment and real email/Google Sheets delivery have not been verified. Do not describe branch tests as proof that mftnb.com has changed.

## Evidence and reproduction

The baseline model was introduced in PR #11, merged on 2025-11-20. Its testing section states that tests were not run. The inspected source and PR contain no provenance for item-handling minutes, crew productivity, regional rates, minimum hours or travel policy.

Source: https://github.com/sqaz2/mftnb/pull/11

The reported input was 100 boxes, 20 small items, 20 two-person items, 5 fragile items, a 15-metre carry, 0.5 flights at each end, no elevator, tight stacking and budget priority 1. With the additional assumption of shoulder-season weather, the original calculation yields about 10.1 on-site hours and automatically assigns four movers. That reproduces the software's output; it does not validate the job duration. The screenshots do not establish whether the fragile pieces were additional items or overlapped other categories, so the new form explicitly asks that distinction and re-asks old inventory rather than silently converting it.

Original source: https://github.com/sqaz2/mftnb/blob/00a185918dbe91c943198c54c228eb845f3b240f/script.js

## Findings and corrections

| Finding | Correction in this build |
| --- | --- |
| A $120 travel fee was unconditional; addresses were never used by the model. | Remove the invented flat fee. Ask whether work is same-property, transport, loading-only or unloading-only. Inter-address transport and any crew call-out/depot charges are explicitly different concepts. Unknown fees are not presented as waived fees. |
| Two identical transport addresses were accepted without clarification. | Conservatively compare case, whitespace and basic punctuation. Require correction or selection of same-property work; preserve unit numbers and never infer a route from a city name alone. |
| $85/hour was interpreted as per mover, without documented approval or clear crew-rate wording. | No public rate is assumed. Separate tested pricing arithmetic requires an explicit per-crew/per-mover basis and approved rate source. |
| Item minutes and multipliers lacked calibration; the model treated doubling crew as halving all work time. | Remove public predictions rather than assert a new unvalidated crew-productivity formula. Crew and elapsed time require human review until real jobs support a model. |
| Four movers were triggered by more than 140 counted units; fragile items were added as extra inventory. | Count boxes, other one-person items and two-person items uniquely. Fragility is a subset for care, with validation against the known total. No threshold automatically orders a crew. |
| No elevator added 15% even on a ground-floor job; a 15m carry added 30%; budget priority 1 added 12%; heavy-item and weather multipliers compounded further. | Collect actual route/access conditions and customer priorities without arbitrary multipliers, ground-floor penalties or budget-induced slower work. Remove the unsafe stacking-speed trade-off. |
| Extras/specialty work were collected but not included reliably in quoted figures. | Explicit review for equipment, packing, assembly, storage and other extras; no implication that an automatic total covers them. |
| Empty form showed a minimum job and price. Missing numeric inputs could become zero; payload `|| ''` dropped legitimate zeros. | Missing/unknown quantities remain distinct from zero. No price on an empty form. Validate whole item counts, non-negative bounded inputs and half-flight stairs. |
| Editing required restarting; stale answers could contradict changed move scope. | Back and per-answer Edit controls, retained textarea values, conditional questions and validation of the currently relevant answers. Hidden old destination data is excluded from on-site move notes. |
| An HTTP-success HTML/empty response could be interpreted as successful submission and clear the draft. | Require JSON with `ok === true`. Preserve details on failure/ambiguous receipt, prevent duplicate clicks, time out stalled requests and reset verification after attempts, including widget ID 0. |
| The repository's Apps Script saves/emails only a limited set of fields, discarding many newer fields. | Put the complete current move plan in the existing `notes` field as a backward-compatible bridge; retain structured fields for future migration. This is tested against the documented request shape, not proof of live delivery. |
| Persistent browser storage retained personal move details indefinitely. | Use a tab-session draft. Migrate valid old contact/details once, remove the old local-storage entry after a successful session write, and ask again for inventory/access affected by changed semantics. On storage failure, continue without claiming persistence. |

## Red Deer pricing checks: context, not calibration

Checked primary business pages on 2026-09-11:

* Red Deer Pro Movers publishes **$170/hour for two movers with a truck/equipment** and **$220/hour for three with a truck**. It bills from shop departure to return. Red Deer fuel is included; out-of-town fuel may be added. This demonstrates why local fuel inclusion does not mean all travel time is free. Source: https://www.reddeerpromovers.ca/meet-the-team
* Wildrose's Red Deer service page advertises **starting** rates of **$129/hour for two movers with a truck** and **$179/hour for three with a truck**. It lists a Calgary address. Starting prices do not establish an all-in quote, an in-property labour rate or a Red Deer market average. Source: https://wildrosemoving.com/red-deer-movers/

Neither business validates MFTNB's rates or the reported job's correct crew/duration. No competitor number is a production default or a calibration observation in this build.

## Pricing arithmetic that is ready for later use

`priceReviewedPlan()` is a pure, tested function, **not called by the public form**. It separates on-site crew-clock hours from worker-hours, per-crew versus per-mover rates, inter-address driving, depot driving, a call-out fee, a transport fee, minimum hours, billing increments and explicit tax. Monetary components round in cents. It refuses missing inputs and inter-address transport charges on non-transport scopes.

The `approvedBy` and `evidenceRef` fields are provenance requirements, **not authentication or authorization**. A future staff interface must enforce approval server-side; never accept a customer's browser values as an authorized quotation. The arithmetic assumes one stated hourly crew rate for the specified billable time. More complex truck, labour, overtime or tax policies need their own reviewed rules rather than being squeezed into that assumption. Synthetic prices in tests are not MFTNB prices.

## Validation performed

* `node --check script.js`: passed.
* `node --test tests/estimator.test.cjs`: **76 tests passed, 0 failed**.
* `python tests/browser_smoke.py`: **9 offline Chromium DOM scenarios passed**.

The browser harness loads the actual HTML/script via `set_content`, mocks storage, Turnstile and network responses, and never sends a real lead. Coverage includes the full guided flow, invalid and unknown counts, editing, scope switching, complete legacy-compatible notes, stale draft migration, strict receipt handling, verification expiry/widget ID 0, duplicate clicks, quick-contact handling and injected text.

These are logic and offline DOM tests. The harness strips external styles/media and cannot substantiate pixel layout, a live domain deployment, production Turnstile configuration, actual Sheets persistence or email delivery. A 360px viewport is exercised for DOM interaction, not a visual accessibility certification.

Run unit tests with Node 22 or later. For the optional offline browser harness, install Python Playwright and make Chromium available on PATH, or install the Chromium build managed by Playwright.

## Remaining server-side audit findings

The repository's Apps Script source still needs a separately tested and deployed hardening change: server-side consent enforcement; allowlisted request fields and bounded strings; formula-safe spreadsheet writes; and strict verification of expected Turnstile action/hostname. Its present action check only logs a mismatch. This frontend does not make the old endpoint secure against hand-crafted requests. Do not turn off human verification as a workaround.

Google documents that `appendRow` treats a leading `=` as a formula: https://developers.google.com/apps-script/reference/spreadsheet/sheet#appendrowrowcontents

Cloudflare documents mandatory server-side validation, single-use/expiring tokens and contextual validation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

No compatible Apps Script deployment or Cloudflare release connection was available in this audit. Existing backend source was not rewritten or deployed. The complete-plan-in-notes bridge avoids requiring a schema migration just to retain this form's details, but does not resolve those server-hardening findings. Review published privacy/retention and automatic-email promises with the operator as part of rollout.

## Requirements before automatic numeric estimates return

Obtain Chris's approved, dated rate card: labour-only versus truck-inclusive rates; crew sizes; whether rates are per crew or per mover; minimums and billing increments; Red Deer boundaries; depot/call-out/fuel policies; extras; tax treatment; and what a written quote includes. Do not infer any of these from the old hard-coded values.

Collect anonymized completed jobs by scope: unique inventory, fragile subset, pickup/destination access separately, actual crew size, on-site elapsed time, loading/unloading and driving time, packing/assembly and other extra work, equipment and truck usage, actual billable time and final charge components. Keep customer names, addresses and private records out of the public repository.

Use representative completed jobs to develop a duration model; reserve different jobs for checking prediction error. Report errors by move type and difficult-access conditions. Quote ranges must reflect that measured uncertainty, not a universal minus-30/plus-45-minute band. Start with human-reviewed suggestions, and retain review-only handling for specialty items, unknown counts, long-distance work and poorly represented cases.

## Release checklist

1. Review and merge the code change through the repository's normal process; confirm the actual hosting connection rather than assuming a merge publishes the site.
2. Verify the served `script.js` contains `2026-09-11-review-first` and the extra stylesheet loads. Check the complete page visually on a phone and desktop with the production CSS.
3. Confirm both forms' real Turnstile keys/actions/hostnames; submit an explicitly approved test lead and verify the full notes arrive in the Sheet and emails. No such production test was sent during this audit.
4. Check same-property work, a normal Red Deer transport move, load-only, unknown inventory, a piano, changed destination and failed submission. Confirm no unsupported numeric quote is shown.
5. Complete the backend hardening and data-policy review. Keep unsupported automatic pricing disabled until the rate/timing requirements above are met.
