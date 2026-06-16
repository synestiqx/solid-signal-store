# store-solid — Architektura (Premium Quality, Minimal Code, Zero Duplication) — v2 Hardened

**Status:** High-level principles only.  
**Single source of truth for implementation:** `PLAN.md` (v2 — after Critic review).

**Nienaruszalne zasady (po recenzji Critica):**

1. **Zero duplication from line 1** — mechanicznie egzekwowane (patrz PLAN.md § "Mechanical Duplication Prevention").
2. **Jsondb jest prawie nietykalny** — tylko jeden dozwolony plik: `src/jsondb/solid-pipeline-bridge.ts`. Żadne inne pliki w `jsondb/` nie mogą być modyfikowane względem oryginału z `store4/store/jsondb/`.
3. **Maksymalny minimalizm** — każdy plik i linia musi mieć uzasadnienie. Surowe budżety LOC (patrz PLAN.md).
4. **Pełna parność API + observable behavior** — włącznie z subtelnymi kontraktami (cursor prefetch side-effects, root mutation key-diff, proxy identity, devtools event shapes, FinalizationRegistry/GC cleanup).
5. **Solid jako podstawa** — nie walczymy z frameworkiem. Automatyczny tracking + `batch()` + `createMemo` zastępują prawie cały poprzedni system wersjonowania.
6. **Klasy tylko gdy dają realną wartość** (testowalność, organizacja, pojedyncza odpowiedzialność). Zero nadmiarowych plików.

**Zalecana finalna struktura katalogów (po poprawkach Critica):**

```
store4/store-solid/
├── src/
│   ├── index.ts
│   ├── types/
│   ├── utils/                  # skopiowane czyste rzeczy (PathUtils + guards + errors + array-query-*)
│   ├── core/
│   │   ├── SolidStore.ts       # jedyny orchestrator (CreateStore + SignalStore + większość logiki)
│   │   ├── rx-interop.ts
│   │   └── batcher.ts          # tylko re-export + minimalne helpery
│   ├── proxy/
│   │   └── solid-proxy.ts      # #1 najwyższa dźwignia (< 320 LOC hard cap)
│   ├── array/
│   │   └── solid-array.ts
│   ├── jsondb/
│   │   └── solid-pipeline-bridge.ts   # JEDYNY nowy plik pod jsondb
│   └── devtools/
│       └── solid-devtools.ts
├── PLAN.md                     # <--- JEDYNE wiążące źródło implementacji
├── ARCHITECTURE.md             # ten plik (zasady wysokopoziomowe)
└── README.md
```

**Co znika prawie całkowicie** (patrz szczegóły i budżety w PLAN.md):
- Cały system wersjonowania (VersionManager, bump*, ancestor logic, trackProjection, DependencyTracker itd.)
- Większość manualnego schedulingu i wakeup

**Najwyższe dźwignie (kolejność implementacji):**
1. `proxy/solid-proxy.ts`
2. `core/SolidStore.ts`
3. `jsondb/solid-pipeline-bridge.ts`
4. `array/solid-array.ts`

Wszystkie decyzje szczegółowe, kontrakty, budżety LOC, fazy i wymagania po recenzji Critica znajdują się w **PLAN.md**.

Ten plik jest tylko manifestem filozofii. Nie implementuj na jego podstawie — czytaj PLAN.md.
