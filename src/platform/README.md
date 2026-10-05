# `platform/` — device capability ports

Interfaces for anything the browser and the Android WebView do differently, plus one implementation
per target. **No file under `features/` imports `@capacitor/*`** — it imports a port from here
([ARCHITECTURE.md §M.1](../../docs/ARCHITECTURE.md)).

The point is that a native capability arriving later (biometrics, SMS ingestion in M12) is a new
implementation behind an existing interface, not a change to feature code.

| Port                    | Android                                                          | Web                                                            |
| ----------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| `navigation/systemBack` | the Back button and gesture, via `@capacitor/app`                | nothing: the browser's own                                     |
| `app/lifecycle`         | the app returning to the foreground                              | nothing                                                        |
| `storage/authStorage`   | the session in app preferences, moved from localStorage once     | `undefined`: supabase-js keeps localStorage                    |
| `storage/deviceStore`   | app-private preferences for the offline cache and outbox         | `null`: no financial data in browser storage (SECURITY.md T20) |
| `sms/*`                 | SMS, payment-app notifications and inbox import (SMS-CAPTURE.md) | unavailable                                                    |

`data/` may use a port too: the Supabase client takes its session storage from here.
