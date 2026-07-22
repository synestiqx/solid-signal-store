# SolidStore Browser Demo

Runnable Vite and Solid example using the library source through the same public
`solidstore`, `solidstore/jsnq`, and `solidstore/devtools` entry names used by consumers.

The visible demo contains three focused views:

- Store: callable proxy reads, nested assignments, dynamic keys, JSNQ mutation,
  batch on/off, and both wake modes on a 160-cell board.
- Design: nested `design.componentA.*` state drives dimensions and CSS properties.
- Dashboard: a separately named store updates realtime metrics in a batch.

Run from the repository root:

```sh
bun run demo:install
bun run dev
```

Build and browser verification:

```sh
bun run browser-demo:build
bun run test:browser
```

The additional `/jsnq-browser-bench.html` page is used by Playwright for a real
browser benchmark of flat and deeply nested JSNQ operations.
