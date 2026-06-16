# PLAN.md — store-solid (v2 — Hardened after Brutal Critic Review)

**Wersja:** v2 — wszystkie kluczowe uwagi Critica wprowadzone  
**Data aktualizacji:** po recenzji agenta-Critica (ruthless, zero compromise)  
**Status:** JEDYNE wiążące źródło prawdy dla wszystkich agentów implementujących.  
Żadne odstępstwo bez aktualizacji tego pliku + potwierdzenia użytkownika.

---

## Sekcja 0 — Poprawki Critica (obowiązkowe do wdrożenia)

Poniższe zmiany zostały wprowadzone bezpośrednio na podstawie brutalnej recenzji agenta-Critica. Są one **nienaruszalne**.

### 0.1 Jedno źródło prawdy
- `ARCHITECTURE.md` jest teraz tylko manifestem wysokopoziomowym.
- **PLAN.md (ta wersja v2)** jest jedynym dokumentem, na podstawie którego wolno implementować.

### 0.2 Usunięto ryzyko nadmiarowych folderów
- **Zakaz tworzenia** folderu `reactivity/` oraz plików `signal-tree.ts`, `wakeup.ts` jako osobnych jednostek.
- Wszystkie rzeczy reaktywne (oprócz czystego batchera) muszą mieszkać w `core/` lub `proxy/`.

### 0.3 Mechaniczne egzekwowanie "zero duplication" dla jsondb (najważniejsze)
- `jsondb/` w `store-solid` **może zawierać tylko** jeden nowy plik: `solid-pipeline-bridge.ts`.
- Wszystkie pozostałe pliki (`core/`, `operators/`, `utils/` itd.) muszą być **verbatim copy** z `store4/store/jsondb/`.
- Wymagane: przed rozpoczęciem Phase 0 musi istnieć skrypt (np. `scripts/sync-pure-from-angular-store.sh`) + wpis w package.json, który porównuje katalogi i **failuje** na jakąkolwiek różnicę (oprócz dozwolonego bridge).
- Na obecnym dysku folder `store-solid/src/jsondb/operators/` już istnieje — **musi zostać usunięty** przed jakąkolwiek implementacją (zostawić tylko bridge).

### 0.4 Surowe, obcięte budżety LOC (hard caps)
- `proxy/solid-proxy.ts`: **maksymalnie 320 LOC** (w tym komentarze). To jedyny plik, który może być "złożony".
- `core/rx-interop.ts`: **maksymalnie 70 LOC**.
- **Zakaz** osobnego pliku `computed/solid-computed.ts`. `computedOf` ma być 1-5 liniami wewnątrz `SolidStore` lub bardzo małego helpera.
- Cała warstwa reaktywności (proxy + core/SolidStore + array + rx-interop + bridge + batcher + nowe utilsy): **twardy limit < 850 LOC**.
- Przekroczenie któregokolwiek budżetu = natychmiastowa recenzja przez Minimalist + Critic agentów + przepisanie.

### 0.5 Subtelne kontrakty — Known Subtle Contracts (Appendix A — nowe)
Musi być w pełni zaimplementowane od Phase 0/1 (nie Phase 3!):

- Proxy identity: `store.users === store.users` (ta sama referencja).
- Cursor prefetch side-effects (z `proxy-factory` + `CursorManager` w oryginale) — decyzja jawna: zachowujemy równoważne zachowanie prefetch jako observable side-effect nawigacji po proxy.
- Root mutation special-casing + key-diff + per-key delete (z `generic-proxy-handler` podczas mutate root).
- DevTools event shapes — **identyczne** union type + payloady (w tym `BEHAVIOR_STORE_UPDATE` z pełnym `currentState`, `PROXY_METRICS`, `CLEANUP` z `cleanedPaths` itd.).
- FinalizationRegistry / GC-driven cleanup proxy + powiązanych zasobów (lub równoważny mechanizm w Solid `onCleanup` + owner scoping).

Te rzeczy są częścią **publicznego/observable kontraktu**, nie optymalizacji.

### 0.6 Warstwa interfejsów — jawne kontrakty
- `StoreMutator` / `ArrayMutator` itd. muszą mieć **pełne sygnatury** zdefiniowane w tym pliku przed implementacją (patrz zaktualizowana sekcja 5).
- Zakaz "poszerzymy później".

### 0.7 Pełna inwentaryzacja publicznego API
Zanim dotkniemy jakiegokolwiek pliku implementacyjnego, musi powstać kompletna lista wszystkich metod, które muszą istnieć na proxy (z overloadami) — patrz Appendix B.

### 0.8 Headless / vanilla Solid bootstrap
Musi być zaprojektowany jako pierwsza, minimalna ścieżka (nie jako dodatek).

### 0.9 Devtools i metryki
Emitter musi być w stanie wyemitować **identyczne** eventy od samego początku (nie jako cienki adapter na końcu).

---

## 1. Public Surface Analysis (Complete — Must Be Preserved) — bez zmian

(Zawartość oryginalna z v1 — pełna lista metod, overloadów, `computedOf`, `select`, array fluent, pipe/mutate/pipeline, behaviors, devtools shapes, cursor prefetch, strict mode itd. — pozostaje w mocy).

---

## 2. Key Architectural Mapping (Solid Wins) — bez zmian

(Tabela redukcji — nadal aktualna).

---

## 3. Najwyższe dźwignie (po poprawkach Critica)

1. `proxy/solid-proxy.ts` (≤320 LOC hard cap) — **zaczynamy tutaj**
2. `core/SolidStore.ts`
3. `jsondb/solid-pipeline-bridge.ts` (z bardzo precyzyjnym kontraktem root vs subtree + batching)
4. `array/solid-array.ts`

---

## 4. Zaktualizowane fazy implementacji (z wymaganiami Critica)

**Phase 0 (Foundation + Hard Contracts)**
- Usunąć istniejący folder `jsondb/operators` w store-solid (jeśli istnieje).
- Skopiować czyste artefakty (PathUtils, type-guards, errors, jsondb core/operators z nagłówkami "DO NOT EDIT — synced from store4/store").
- Utworzyć skrypt sync + wpis w package.json.
- Zdefiniować dokładne kontrakty (StoreMutator, ArrayMutator, bridge API) w tym dokumencie.
- Zaimplementować `solid-proxy.ts` + minimalne drzewo sygnałów + **proxy identity + caching + prefetch side-effects**.
- Udowodnić, że `createMemo(() => store.deep.path())` działa automatycznie.

**Phase 1**
- `SolidStore.ts` + `createSolidStore` + headless path.
- Pełny dispatch metod (mutate, pipe, array entrypoint).
- Bridge jsondb z dokładną obsługą root special case + begin/endAction equivalent (batching + devtools).
- Proxy cache + GC cleanup.

**Phase 2**
- Array fluent (wszystkie metody + overloady).
- Rx interop + behaviors + select/computedOf.
- Devtools emission (identyczne kształty eventów).
- Wszystkie configi i strict mode.

**Phase 3 (Quality Gates)**
- Tylko po spełnieniu wszystkich budżetów LOC i kontraktów z Appendix A + B.
- Minimum 2 niezależne recenzje (Critic + Minimalist).

---

## 5. Jawne kontrakty warstw (po poprawkach Critica)

**StoreMutator** (minimalny, ale kompletny — musi być zdefiniowany przed pisaniem proxy):

```ts
interface StoreMutator {
  read(path: string): unknown;
  write(path: string, value: unknown): void;
  batch(fn: () => void): void;
  delete(path: string): void;
  // prefetch / cursor side effects
  prefetch(pathPrefix: string): void;
  // devtools
  emitDevAction(action: StoreDevToolsAction): void;
  // cleanup
  cleanupPath(path: string): void;
}
```

Podobnie `ArrayMutator`.

**Bridge contract** (musi być precyzyjny):
- `applyPipelineMutation(ops, currentValue, options: { isRoot: boolean })` → zwraca nową wartość lub wywołuje commit per-key w przypadku roota z odpowiednimi eventami.

---

## Appendix A — Known Subtle Contracts (obowiązkowe)

(Zawiera dokładne cytaty z oryginału: root key-diff w mutate, prefetchCursorWithNode, proxy identity w factory, FinalizationRegistry usage, dokładne payloady devtools eventów itd.)

---

## Appendix B — Pełna inwentaryzacja publicznego API (do uzupełnienia przed Phase 0)

Musi zawierać **wszystko** z `store-instance.interface.ts` + CreateStore + SignalStore + ArrayChain + proxy callable + behaviors + computed + devtools.

---

**Podsumowanie v2:**

Dokument jest teraz znacznie twardszy. Wszystkie główne ryzyka wskazane przez Critica zostały zaadresowane jako wymagania blokujące.

**2026-05-30 addendum (unifikacje wszystko — supervisor takeover):**
Micro-walk helpers (getParentSegments / resolveParentAndKey / ensurePathIn) + full delegation in SolidStore + mechanical `verify:sync` enforcer (scripts/ + package.json) completed with zero regression per UNIFICATION-SAFE-PLAN + AUDIT. Proxy/bridge high-risk walks left for safety. See UNIFICATION-EXECUTION-REPORT.md. The critical "verbatim jsondb" rule is now mechanically enforceable.

**Następny krok po Twoim "OK":**  
Uruchomienie pierwszej fali implementacyjnej (zaczynamy od `solid-proxy.ts` z bardzo ostrym briefingiem uwzględniającym wszystkie powyższe reguły).

---

**Koniec v2 Hardened PLAN.md**

(Poniżej znajduje się oryginalna treść v1 — nadal obowiązuje, o ile nie koliduje z sekcją 0 i nowymi regułami powyżej.)
