# Browser Demo for store-solid

Real, runnable Vite + SolidJS browser demo exercising the **actual** `store-solid` from `../../src` (via Vite alias) with live jsondb operations.

Focus: mutate/pipe-style via `.key.mutate(...)` using real operators (where + update sugar/fn, insert, deleteKey) across:
- Flat arrays (optimized fast path)
- Nested objects + deep key paths
- 5-level deep nesting (sugar patch)
- Edge cases (empty arrays, nulls, mixed)

## Run (Bun preferred)

```bash
# From repo root
bun --cwd examples/browser-demo install
bun --cwd examples/browser-demo run dev
```

Dev server runs on http://localhost:5174 (see vite.config.ts).

Rich UI:
- Live updating data for 4 shapes (reactive via Solid memos + proxy signals)
- Manual buttons per shape
- "Run Full Automated Suite" — performs sequenced ops, emits detailed console logs
- Visible + console logs for Playwright (tagged [DEMO:jsondb], DEV actions, etc.)
- Timing per op (easy to extend for deep-vs-flat perf visuals)

## For Playwright verification

See `test/browser/store-reactivity.spec.ts` (and playwright.config.ts webServer).

It starts the dev server, drives the suite button, captures console (jsondb/reactivity), takes screenshots after key states, asserts no-crash + expected markers + log content.

## Data model (płaski vs zagnieżdżony)

Podstawowy model w store-solid to **zagnieżdżone drzewa JSON** (nested objects) — naturalne dla typowych aplikacji.

- Płaskie tablice (flat arrays of objects) są bardzo częstym przypadkiem i mają dedykowane szybkie ścieżki w bridge (hot path).
- Nie robiliśmy czystego modelu "nodes + edges" (jak grafowa baza danych), bo dla hierarchicznych danych JSON byłby to overkill i straciłby prostotę dostępu przez ścieżki.
- Mieszanka (główne dane jako nested tree + zoptymalizowane flat arrays) to obecnie najlepszy kompromis pod względem prostoty, wydajności i parności z oryginałem.

Jeśli Twój przypadek użycia jest mocno grafowy (social graph, rekomendacje, knowledge graph) — wtedy czysty nodes+edges ma sens, ale to już inna architektura.

## Extend

- Add larger N to makeFlat() for perf visuals
- Add timing bars / charts in a new "perf comparison" card
- New data shapes or operators (replace, moveTo etc) — import from `store-solid/jsondb/synced/operators/*`
- All changes stay minimal and high-signal.
