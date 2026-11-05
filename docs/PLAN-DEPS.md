# Dependency Update Plan

Bring every npm package to its latest stable major, and move the runtime to Node 24 LTS. Work happens on `chore/deps-update`, with one commit per phase so any phase can be reverted on its own.

## Status

| Phase | Status |
| :--- | :--- |
| 1. Security and runtime majors | **Done**, committed `5740092` |
| 2. Remove `drizzle-kit` | **Done**, committed `280726e` |
| 3. Node 24 via Volta | **Done**, committed `b036fb9` |
| 4. Vite 8, plugin-react 6, Vitest 5 | **Done**, committed `f481b97` |
| 5. TypeScript 7 | **Done**, committed `28054bb` |
| 6. Final checks | **Done**; committed `302a508` |

## Decisions

- **Runtime:** Node 24 LTS (24.22.2 at time of writing), pinned per project with Volta. Volta 2.0.2 is installed, so the project can use 24 while other repos stay on 22.
- **TypeScript:** try 7.0.2. If it breaks in ways that aren't trivial to fix, pin 6.0.3, the last JS-based release.
- **Drizzle:** stay on `drizzle-orm` 0.45.x. 1.0 is still `rc`, so revisit it once 1.0 is tagged `latest`.
- **`drizzle-kit`:** remove it. Migrations are hand-written in `src/server/db/migrations.ts` and nothing calls the kit (see `PLAN-STAGE5.md`). Removing it also clears the dev `esbuild` advisory it pulls in.

## Current State

After phase 1:

- `npm audit --omit=dev`: 0 vulnerabilities.
- `npm audit`: 7 dev-only advisories. 2 are critical, in `tinypool` through vitest 3. 1 is in `esbuild` through `drizzle-kit`. The rest are vitest 3 internals.
- `tsc -b` is clean, 196/196 tests pass, and `vite build` succeeds.
- Still behind:

| Package | Current | Target | Blocked by |
| :--- | :--- | :--- | :--- |
| `vite` | 6.4.5 | 8.x | none |
| `@vitejs/plugin-react` | 4.7.0 | 6.x | needs vite 8 |
| `vitest` | 3.2.7 | 5.x | needs Node `^22.12 \|\| ^24` |
| `typescript` | 5.9.3 | 7.0.2 | none |
| `@types/node` | 22.x | 24.x | Node 24 runtime |
| `tsx` | 4.x | latest 4.x | none |

## Phase 1: Security and runtime majors [Done]

**Status:** Done, committed `5740092`.

`@fastify/static` 10, `drizzle-orm` 0.45, `zod` 4, `better-sqlite3` 13, `lucide-react` 1, `concurrently` 10, `@types/better-sqlite3` 9, plus minor bumps.

- [x] Review the diff and commit: `chore: update security and runtime dependencies`

## Phase 2: Remove `drizzle-kit` [Done]

**Status:** Done, committed `280726e`.

1. `npm uninstall drizzle-kit`
2. Check: `grep -rn drizzle-kit .` should only match docs.
3. Verify: `npx tsc -b && npm test`
4. Commit: `chore: remove unused drizzle-kit`

## Phase 3: Node 24 via Volta [Done]

**Status:** Done, committed `b036fb9`.

1. `volta pin node@24`. This writes `"volta": { "node": "24.22.2" }` to `package.json`.
2. Add `"engines": { "node": ">=24" }` to `package.json` so npm warns on older runtimes.
3. `npm install -D @types/node@^24`
4. Rebuild the native module against the new ABI: `npm rebuild better-sqlite3`. If no prebuilt binary is found, reinstall it with `rm -rf node_modules && npm ci`.
5. Verify:
   - `node -v` inside the repo prints v24.x, and v22 outside it.
   - `npx tsc -b && npm test && npm run build`
   - Start the app against a **copy** of the DB (`DB_PATH=<copy> npm start`). The dev server migrates the real DB live, so don't point it at that. Check that the server starts, tasks load and a backup can be made.
6. Commit: `chore: pin Node 24 with Volta`

If Node 24 breaks something, revert this commit; nothing else depends on it.

## Phase 4: Vite 8, plugin-react 6, Vitest 5 [Done]

**Status:** Done, committed `f481b97`.

These move together because plugin-react 6 needs vite 8, and vitest 5 is the release that clears the `tinypool` advisory.

1. `npm install -D vite@^8 @vitejs/plugin-react@^6 vitest@^5 @tailwindcss/vite@latest`
   - **Note:** this fails with `ERESOLVE`, because the installed vitest 3 peers on `vite@^5 || ^6` and npm won't replace both in one step. What worked: `npm uninstall @vitejs/plugin-react vitest`, then `npm install -D vite@^8`, then `npm install -D @vitejs/plugin-react@^6`, then `npm install -D vitest@^5`.
2. `vite.config.ts`: replace `__dirname` with `import.meta.dirname`. The package is ESM, and Vite 8's Rolldown-based config loader shouldn't be relied on to inject CJS globals.
3. Vite 8 swaps esbuild/Rollup for Rolldown/Oxc. The config has no `rollupOptions`, `esbuild` or `optimizeDeps` keys, so no other config changes are expected. Read the startup warnings for deprecated options anyway.
4. Vitest 4/5 changes: the tests only use `vi.fn` (11 places) and `vi.useFakeTimers` (1). Fix any `vi.fn` generic signature errors that `tsc` reports, using the `vi.fn<(…) => R>()` form.
5. Verify:
   - `npm test`: 196 tests pass.
   - `npm run build`: build succeeds, with bundle size about the same as before.
   - `npm run dev`: the UI loads on :5444, `/api` proxies to :3444, and HMR works on a component edit. Use a DB copy for the API.
   - `npm audit`: the `tinypool` and `@vitest/mocker` advisories are gone.
6. Commit: `chore: update to vite 8 and vitest 5`

## Phase 5: TypeScript 7 [Done]

**Status:** Done, committed `28054bb` (TypeScript 7.0.2; the fallback was not needed).

1. `npm install -D typescript@^7`
2. `npx tsc -b`. TS 7 drops legacy options. The current `tsconfig.json` already uses `moduleResolution: bundler`, `paths` without `baseUrl` and target ES2022, so it should hold. Fix any new type errors.
   - **Result:** one error. TS 7 checks side-effect imports by default (`noUncheckedSideEffectImports`), so `import './index.css'` in `src/client/main.tsx` failed with TS2882. Fixed by adding `src/client/vite-env.d.ts` with `/// <reference types="vite/client" />`, the standard Vite declaration file. It also types `import.meta.env` and asset imports.
3. Delete the stale `tsconfig.tsbuildinfo` (gitignored) if `tsc -b` complains about it.
4. Verify: `npx tsc -b && npm test && npm run build`
5. **Fallback:** if `tsc -b` fails in ways that aren't trivial to fix (build mode gaps, compiler crashes, many false errors), run `npm install -D typescript@6.0.3`, record why here, and revisit at 7.1.
6. Editor: VS Code uses the workspace TS for diagnostics. With TS 7, install the TypeScript native preview extension, or keep the built-in TS service for editing.
7. Commit: `chore: update to typescript 7`, or `chore: update to typescript 6` for the fallback.

## Phase 6: Final checks [Done]

**Status:** Done. `npm update` committed as `9e89b7c`; the tidy-ups committed as `302a508`. Merge to `main` still to do.

- [x] `npm update`: in-range patch bumps (`@tanstack/react-query` 5.106.1, `lucide-react` 1.69.0 and some sub-dependencies). Lock file only.

- [x] `npm outdated` lists only `@types/node` 26, held deliberately to match Node 24. (`drizzle-orm` 1.0 is an rc, so `npm outdated` doesn't list it.)
- [x] `npm audit` reports 0 vulnerabilities, including dev.
- [x] `npx tsc -b && npm test && npm run build` all pass (196 tests).
- [x] Run the app on a DB copy. Check task CRUD, markdown notes, the calendar, the ADO import dialog, backup and export.
   - Ran the built app from `npm start` on port 3555, with the DB copy and backups in the scratchpad. Through the API: create, edit, status note, delete, backup and export all worked, unknown `/api` routes return 404, and an encoded `..%2f` path returns the SPA page, not the file. In the browser: the task list, calendar month view, task drawer (markdown bold and checklist rendered) and the ADO fetch dialog all loaded with no console errors. No server errors were logged.
   - Not covered: dev-mode HMR and the Vite `/api` proxy.
- [x] Tidy-up: raised the minimum versions in `package.json` to the installed versions with `npx npm-check-updates -u --target minor` (react and react-dom 19.3.1, tsx 4.23.15, tailwind-merge 3.7.0, @types/react and @types/react-dom 19.3.0, lucide-react 1.69.0, @tanstack/react-query 5.106.1). Nothing installed changed.
- [x] Tidy-up: approved the install scripts for `better-sqlite3` and `esbuild` (`npm install-scripts approve`), which adds an `allowScripts` block to `package.json`. Approvals are pinned to exact versions, so a version bump of either needs approving again. Checked with a clean `rm -rf node_modules && npm ci`: no warnings, better-sqlite3 loads, and tsc, tests, build and audit all pass.

## Deferred

- **`drizzle-orm` / `drizzle-kit` 1.0:** wait for a stable release, then review the relational-query and migrator changes.
- **Renovate or Dependabot:** skipped for now. Add one if manual updates start lagging again.
