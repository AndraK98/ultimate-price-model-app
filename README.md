# Capucinne Inquiry Atelier

Internal browser-based jewelry inquiry app built with Next.js, TypeScript, App Router, route handlers, and a repository layer that can run in mock mode or Google Sheets read-only catalog mode.

## What it does

- Search and review stones
- Search and review settings
- Attach catalog stones and settings to a custom project
- Run the price model to generate cost and quote outputs
- Save custom project records with estimated material cost and quote
- Run AI-assisted approximation for non-catalog stones or pieces
- Persist inquiry and valuation logs for later prompt/process refinement

## Architecture

- `app/` UI and route handlers
- `components/` dashboard UI
- `lib/repositories/` mock repository and Google Sheets repository
- `lib/services/quote-service.ts` shared quote logic
- `lib/ai/` valuation provider abstraction with mock and Gemini implementations
- `storage/mock-db.json` runtime mock persistence file, created automatically on first run
- `storage/activity-db.json` runtime local log file for inquiries and valuations when using the read-only Sheets catalog

## Quick start

1. Install dependencies

```bash
npm install
```

2. Copy the environment template

```powershell
Copy-Item .env.example .env.local
```

3. Start the app

```bash
npm run dev
```

4. Open `http://localhost:3000`

With no Google Sheets credentials configured, the app uses seeded local mock data immediately.

On Vercel or other serverless platforms, runtime local storage automatically falls back to a writable temp directory instead of the read-only deployment bundle.

The dashboard also shows live readiness, mapped sheet names, and which environment variables are still missing before the app can switch from mock mode to the read-only Google Sheets catalog and Gemini.

## Main workflow

1. Search the stone database.
2. Search the setting database.
3. Attach the chosen stone and setting to a custom project.
4. Let the price model calculate costs and estimated quote.
5. If the catalog does not contain the correct stone, use AI approximation with images and notes.
6. Save the custom project so the quote trail stays in local app storage without modifying the source workbook.

## Environment variables

Core:

- `DATA_MODE=auto|mock|sheets`
- `GOLD_PRICE_PER_GRAM`
- `QUOTE_MARGIN_MULTIPLIER` fallback multiplier when setting complexity is unavailable
- `VALUATION_PROVIDER=gemini`

Google Sheets:

- `GOOGLE_SPREADSHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_SHEET_STONES`
- `GOOGLE_SHEET_SETTINGS`
- `GOOGLE_SHEET_METAL_PRICING`
- `GOOGLE_SHEET_INQUIRIES`
- `GOOGLE_SHEET_VALUATIONS`

Gemini:

- `GEMINI_API_KEY`
- `GEMINI_MODEL`

## Google Sheets catalog mode

The app reads catalog data from these tabs:

- `Stones`
- `Settings`
- `Metal & Pricing Variables`
- `Inquiries`
- `Valuations`

Canonical headers expected by the app:

`Stones`

- `stone_id`
- `name`
- `shape`
- `color`
- `carat`
- `size_mm`
- `quality`
- `price_per_carat`
- `status`
- `notes`
- `created_by`
- `created_at`

`Settings`

- `setting_id`
- `style`
- `metal`
- `ring_size`
- `dimensions_mm`
- `complexity_level`
- `gold_weight_g`
- `labor_cost`
- `base_price`
- `stone_capacity`
- `status`
- `created_by`
- `created_at`

Notes:

- `DATA_MODE=auto` uses Sheets only when the required Google credentials are present.
- `DATA_MODE=sheets` requires valid Google credentials.
- The Google service account only needs read access to the source spreadsheet.
- Stones and settings are read from Google Sheets, but inquiries and valuations are stored locally in `storage/activity-db.json`.
- On Vercel/serverless, those runtime files are stored in a temp directory and are ephemeral between cold starts or redeploys.
- The repository can read legacy workbook-style `Stones` and `Settings - Rings` layouts as a migration aid.
- In the legacy `Settings - Rings` layout, complexity can be read from the `Complexity Level` column, the `Complexity` column, or the cell directly to the right of `Setting Master SKU` so the app can follow the existing workbook formula.
- Metal rates are read from `Metal & Pricing Variables!B18:B20` where `B18=gold`, `B19=silver`, and `B20=platinum`.
- The app does not write back into the source workbook.

## Quote logic

The MVP quote engine uses:

- `metalCost = gold_weight_g * selectedMetalPricePerGram`
- `stoneCost = carat * price_per_carat` for catalog stones
- `materialCost = metalCost + stoneCost + labor_cost + base_price`
- `selectedMetalPricePerGram` is read from `Metal & Pricing Variables!B18:B20` based on whether the setting metal is gold, silver, or platinum
- `quoteMarginMultiplier` from setting complexity:
- `1 -> 2.5`
- `2 -> 2.7`
- `3 -> 2.8`
- `4 -> 2.9`
- `5 -> 3.0`
- If the setting reference contains a comma, the app treats it as a ring set and uses `2.8`
- If the metal sheet is unavailable, the app falls back to `GOLD_PRICE_PER_GRAM`
- If complexity is unavailable, the app falls back to `QUOTE_MARGIN_MULTIPLIER`
- `estimatedQuote = materialCost * quoteMarginMultiplier`

Inquiry creation uses setting gold weight by default and respects manual gold-weight overrides.

## AI valuation behavior

- Gemini is used when `VALUATION_PROVIDER=gemini` and `GEMINI_API_KEY` is present.
- The Gemini provider uses the official `@google/genai` SDK.
- The valuation path enables Google Search grounding so Gemini can fetch live market context when needed, such as gold pricing, precious metal references, and comparable jewelry pricing.
- If Gemini is not configured, AI valuation and AI catalog filtering return a setup error instead of falling back.
- The app does not claim to learn from employee usage automatically.
- Instead, it logs valuation requests and outputs locally so the business can improve prompts or process quality later without modifying the source workbook.

## Baseline workbook alignment

The included mock seed data and repository mapping were shaped against the pricing workbook you provided:

- `Stones`
- `Settings - Rings`
- `FINAL PRICING RINGS`
- `Master Popisi-Shopify`
- `Metal & Pricing Variables`

For the MVP, the workbook is treated as reference structure and pricing context. The web app itself uses Google Sheets tabs as the system of record.

## API routes

- `GET /api/stones`
- `GET /api/settings`
- `GET/POST /api/inquiries`
- `GET/POST /api/valuations`

## Verification

Recommended checks:

```bash
npm run typecheck
npm run build
```
