# Address confirmation and travel in the existing estimator

The estimator keeps its current guided questions, editable answers, styling, move-plan download, Turnstile verification and Google Apps Script delivery. Address confirmation, Google selection and driving-time calculations live inside that flow.

## Activation status

The integration is implemented, but automatic Google address selection and travel are not enabled in the shipped configuration. No Google Maps browser key or owner-confirmed shop pin was available. Customers can enter an address, its municipality and a separate unit/lot, check a Google Maps search link, explicitly confirm the entered details and submit for staff review. The plan labels the pin unverified and says **Travel estimate unavailable—staff review required**. Missing travel is null, never zero.

The owner supplied: **6834 59th ave, 806 Mustang Acres**. This has not been geocoded, assigned a municipality or treated as an exact pin. Do not enable routing from a guessed street entrance or the centre of Mustang Acres.

## Google configuration

1. Use the business's Google Cloud project, with Maps billing enabled. Enable **Maps JavaScript API**, **Places API (New)**, **Routes API**, and **Maps Embed API**. The embed is the selected-address pin preview.
2. Create a browser key with **Websites / HTTP referrer** restrictions for `https://mftnb.com/*` and `https://www.mftnb.com/*`. Add only a specific staging origin if needed. Restrict the key's APIs to the four above. Set appropriate quotas and billing alerts in that project. A browser key is publicly visible by design; never use an unrestricted server key or service-account credential.
3. Put that restricted browser key in `browserKey` in `maps-config.js`. This enables the address selector even while the shop remains unconfirmed.
4. Ask the owner to open Google Maps and share the exact dropped pin at the shop's vehicle entrance, along with its full address and municipality. Confirm whether **806** is the unit/lot and how **Mustang Acres** fits the address. Fill `shop.formattedAddress`, `municipality`, `unit`, numeric `lat` and `lng`, and optionally `placeId`. Record the actual `confirmedBy` and ISO `confirmedAt`; set `confirmed: true` only after that confirmation. Routing uses those exact shop coordinates.
5. Publish via this repository's existing Cloudflare Pages connection. Increment the `maps-config.js` cache version in `index.html` whenever configuration changes.
6. On the actual production origin, select a real pickup and destination, check their municipalities and pins, confirm each, and verify all three driving legs against Google Maps. Also exercise a wrong/missing API key and a loading-only job. Do not send test leads to the production office unless the owner explicitly wants them.

No Google account changes, billing activation or API usage with real credentials were performed as part of the unconfigured release. The automated browser tests mock Google and cannot prove a real key's restrictions, billing or quota settings.

## Calculation and staff review

- Transport: shop → pickup + loading/work + pickup → drop-off + unloading/work + drop-off → shop.
- Loading-only, unloading-only and same-property: shop → work address + on-site work + work address → shop. A stale second address is excluded.
- Google Routes returns **driving time only**. This implementation uses `TRAFFIC_UNAWARE`, labels that limitation, preserves waypoint order, and requests one round trip. Driving is not a truck-clearance or access guarantee; staff review the road/access conditions and any Google route warnings.
- Display times round to the nearest minute; raw seconds are kept for staff arithmetic. This display rounding does not introduce a billing increment or minimum.
- Public requests retain null on-site hours, crew size, total billable hours and price. No rates, fees, minimums, work durations or surcharges are introduced.
- `priceReviewedMove(plan, state, settings)` combines the currently valid travel with an explicitly staff-reviewed `plan.crewHours` (all on-site work, in crew-clock hours), then calls the existing `priceReviewedPlan`. The plan still requires reviewer/evidence, scope, crew size, rate basis, rate, minimum, billing increment, fees and tax. The two driving-hour fields are supplied from the confirmed route, preventing double counting. `estimatedBillableJobHours` is the unrounded on-site + travel sum; `billedCrewHours` uses only the staff-supplied minimum/increment. This function is not invoked by the public form and accepts no customer-supplied staff approval.
- This static website has no authenticated staff review screen. Use the existing staff process to review on-site time and pricing. A future staff UI should call the same arithmetic from a trusted staff context, and revalidate travel before billing; customer-submitted browser data is not an authorized final invoice.

## Saved drafts, editing and failure handling

Google selections capture the full address, prominent municipality, separate unit/lot, place ID, coordinates and customer confirmation. A Google Maps pin preview and link help customers catch identically named streets in nearby towns. Manual entry is always available and clearly marked for staff pin verification.

Typing or changing the unit immediately clears confirmation and previous travel. Changing scope, date/time or the shop also invalidates old routes. Asynchronous results are accepted only if the same location and route are still current. Drafts keep location confirmations in session storage, but do not restore travel totals or staff approvals. Routes expire after one hour. Empty, malformed, timed-out or denied results all require staff review. Submission waits while a route request is running, then remains possible if travel is unavailable. Existing drafts re-ask address confirmation without losing contact or inventory answers.

Confirmed locations and travel are sent as structured fields and included in `notes` and `cheatSheet`. The deployed Apps Script already saves and emails `notes`, so this release does not require changing the endpoint, Sheets columns, office recipient or backend deployment. End-to-end office email/Sheets receipt was not tested with live leads.

## Verification

```bash
node --check maps-config.js
node --check travel.js
node --check script.js
node --test tests/*.test.cjs
python -m pip install playwright==1.63.0
python -m playwright install chromium
python tests/browser_smoke.py
python tests/browser_travel.py
```

For an existing Chromium binary, set `MFTNB_CHROMIUM_EXECUTABLE`. Set `MFTNB_SCREENSHOTS` to a scratch output directory to capture address/travel layout samples. Browser fixtures are synthetic and every external service is mocked. They cover duplicate streets in different towns, input and unit changes, late place/route responses, shop gating, all four work scopes, Maps failures/retry, download/submission content, legacy behavior and widths of 360, 390, 768 and 1280 pixels.

Official references:

- [Place Autocomplete widget](https://developers.google.com/maps/documentation/javascript/place-autocomplete-new)
- [Routes library request and response fields](https://developers.google.com/maps/documentation/javascript/reference/route)
- [Get a route](https://developers.google.com/maps/documentation/javascript/routes/get-a-route)
- [Embed a map and referrer policy](https://developers.google.com/maps/documentation/embed/embedding-map)
- [API key security practices](https://developers.google.com/maps/api-security-best-practices)
