# Capucinne Inquiry Atelier

Internal browser-based jewelry inquiry app built with Next.js, TypeScript, App Router, route handlers, and a repository layer that can run in mock mode or Google Sheets read-only catalog mode.

## What it does

- Search and review stones
- Search and review settings
- Attach catalog stones and settings to a custom project
- Run the price model to generate cost and quote outputs
- Save custom project records with estimated material cost and quote
- Run AI-assisted approximation for non-catalog stones or pieces
- Persist inquiry logs, approximation threads, and AI knowledge context through Google Drive

## Architecture

- `app/` UI and route handlers
- `components/` dashboard UI
- `lib/repositories/` mock repository and Google Sheets repository
- `lib/services/quote-service.ts` shared quote logic
- `lib/ai/` Gemini valuation and catalog-assist providers
- `lib/drive/` Google Drive client and knowledge retrieval services
- `storage/mock-db.json` runtime mock catalog persistence file, created automatically on first run
- Google Drive folders for chats, approximations, and custom listing logs when Drive is configured

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

When Google Drive is configured, the app writes approximation threads and custom listing logs directly to Drive instead of local runtime JSON files.

The dashboard also shows live readiness, mapped sheet names, and which environment variables are still missing before the app can switch from mock mode to the read-only Google Sheets catalog and Gemini.

## Main workflow

1. Search the stone database.
2. Search the setting database.
3. Attach the chosen stone and setting to a custom project.
4. Let the price model calculate costs and estimated quote.
5. If the catalog does not contain the correct stone, use AI approximation with Gemini.
6. Save the custom project so the quote trail stays in Google Drive without modifying the source workbook.

## Environment variables

Core:

- `DATA_MODE=auto|mock|sheets`
- `GOLD_PRICE_PER_GRAM`
- `QUOTE_MARGIN_MULTIPLIER` fallback multiplier when setting complexity is unavailable
- `VALUATION_PROVIDER=gemini`
- `BASIC_AUTH_USER` optional browser username for deployed environments
- `BASIC_AUTH_PASSWORD` optional browser password gate for deployed environments

Google Sheets:

- `GOOGLE_SPREADSHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_DRIVE_PARENT_FOLDER_ID`
- `GOOGLE_DRIVE_ASSISTANT_FOLDER_ID` optional explicit parent for `Chats`
- `GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID`
- `GOOGLE_DRIVE_CHATS_FOLDER_ID` optional explicit `Chats` folder
- `GOOGLE_DRIVE_CUSTOM_LISTINGS_FOLDER_ID` optional explicit `custom-listings` folder
- `GOOGLE_DRIVE_APPROXIMATIONS_FOLDER_ID` optional explicit `approximations` folder
- `GOOGLE_SHEET_STONES`
- `GOOGLE_SHEET_SETTINGS`
- `GOOGLE_SHEET_METAL_PRICING`
- `GOOGLE_SHEET_INQUIRIES`
- `GOOGLE_SHEET_VALUATIONS`

Gemini:

- `GEMINI_API_KEY`
- `GEMINI_MODEL`

## Password protection

The app includes Basic Auth middleware for browser access.

- Set `BASIC_AUTH_PASSWORD` in Vercel to enable it.
- Set `BASIC_AUTH_USER` in Vercel to choose the browser username.
- Leave it empty locally if you do not want the browser prompt during development.
- Username is whatever you set in `BASIC_AUTH_USER`.
- Password is whatever you set in `BASIC_AUTH_PASSWORD`.

The middleware protects page routes and leaves API/static asset paths untouched.

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
- Stones and settings are read from Google Sheets, while chats, approximations, and custom listing logs are stored in Google Drive when the Drive folder IDs are configured.
- The app creates or reuses:
  - `Chats/` under the configured assistant folder or the direct parent of the knowledge folder
  - `custom-listings/` under the configured Drive parent folder
  - `approximations/` under the configured Drive parent folder
- If explicit folder IDs are provided, the app uses those exact Drive folders instead of resolving by name.
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
- Instead, it reads relevant manual knowledge files from Google Drive, records which knowledge files were used, and stores the approximation thread in Drive so the business can refine prompts and knowledge files over time.

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
- `POST /api/valuations/:valuationId/messages`

## Verification

Recommended checks:

```bash
npm run typecheck
npm run build
```
