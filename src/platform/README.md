# `platform/` — device capability ports

Interfaces for anything the browser and the Android WebView do differently, plus one implementation
per target. **No file under `features/` imports `@capacitor/*`** — it imports a port from here
([ARCHITECTURE.md §M.1](../../docs/ARCHITECTURE.md)).

The point is that a native capability arriving later (biometrics, SMS ingestion in M12) is a new
implementation behind an existing interface, not a change to feature code.

**Milestone 0 state:** empty. The first port lands with M11 (Capacitor).
