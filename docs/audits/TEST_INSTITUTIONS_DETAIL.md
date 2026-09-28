# Enterprise module test checklist

**Module:** Institutions detail  
**Date (UTC):** 2026-09-28

## 0. Screen inventory

Overview, classes, grades, schedule, schedule section, plus `/institutions/:id/overview/report`.

## 1. Functionality

| Check                 | Result                   |
| --------------------- | ------------------------ |
| Gateway overview unit | 3 passed                 |
| Class service unit    | 16 passed                |
| Conflict label unit   | 1 passed                 |
| Page matrix G-804     | 209 passed (matrix file) |

## 2. E2E (Playwright)

`apps/web/e2e/16d-institutions-detail-live.spec.ts` with `E2E_BACKEND_READY=1`, gateway `:3000`, web `:3001`, principal Priya Sharma, Sunrise tenant.

Both tests passed (overview KPIs + report; classes / grades / schedule / section withdraw cancel).

`getByTestId(...).filter({ visible: true })` used for streamed regions. Quoted paths are in the spec for G-804. No skips inside the tests when the flag is set (`test.skip` only when the flag is absent).

## 3. UX / a11y

Captures viewed. See `UX_INSTITUTIONS_DETAIL.md` and `A11Y_INSTITUTIONS_DETAIL.md`. Axe: **EXTERNALLY_UNVERIFIED**.

## 4. Multidevice captures

Desktop 1440, tablet 834, mobile 390 for prototype and live under `docs/audits/captures/institutions-detail/`. Desktop and mobile also have `*-prototype-vs-live.png` pairs.

## 5. Security

See `SEC_INSTITUTIONS_DETAIL.md`.

## 6. CI / production gates

Not run on the merge commit. Disposition: **OPEN** until CI Aggregate (Required) and the E2E backend-ready live gate finish on the PR.

## 7. Residual risks / waivers

- Section breadcrumb still shortens the section UUID.
- Bulk enroll still accepts a raw id if it is not in the loaded student options.
- Grade 8 utilization exceeds 100% because the demo seed enrolls most generated students in Grade 8.

## Done criteria

Local e2e and unit tests passed. Production-ready is not claimed.
