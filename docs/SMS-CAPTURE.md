# Automatic transaction capture (Android)

How a bank SMS, a payment-app notification or a past inbox message becomes a transaction — added
automatically when it is clear, waiting for review when it is not — and what it takes to ship. The
pipeline is [ARCHITECTURE.md §M.3](./ARCHITECTURE.md) and [ROADMAP.md M12](./ROADMAP.md); the
decision is [ADR-0015](./adr/0015-sms-ingestion-policy-gated.md) (amended 2026-10-04); the privacy
rules are [SECURITY.md §9](./SECURITY.md) and are binding.

```
 bank SMS ──► SmsReceiver (manifest receiver; runs with the app closed)
 payment app ► PaymentNotificationListener (after the user grants Notification access)
 inbox ──────► InboxImporter (once, when the user taps "Import past messages")
                 │  opted in? sender a bank/payment header, or an allow-listed app?
                 ▼
               TransactionDetector ─► ParserSandbox: JavaScriptSandbox running assets/sms-parser.js
                 │                     = src/domain/transactions/ingest, the app's own parser,
                 │                     plus autoAdd.ts (clear?) and samePayment.ts (a repeat?)
                 │  rejected (OTP, promo, balance, failed, malformed…) → dropped, no trace
                 │  the same message again, or the other half of one payment → kept once
                 ▼
               DetectionQueue: the candidate only, AES-GCM encrypted (Android Keystore key)
                 ▼
               DetectionNotifier: clear  → "Money Matters added a ₹486 payment at Swiggy to Food." [Undo]
                 │                unclear → "Money Matters detected a ₹150 payment at Amit."
                 ▼
               the app (DetectionListener → autoAdd.ts), as soon as it is running:
                 clear, and nothing alike in the ledger → saveTransaction → ledger, origin recorded
                 anything to ask → /detected: ReviewCandidate → Confirm / Edit / Ignore / one transfer
                 ▼
               Transactions, balances, dashboard, budget, safe daily limit update as for manual entry
```

There is **one parser**: `scripts/build-sms-parser.mjs` compiles the TypeScript parser into
`android/app/src/main/assets/sms-parser.js` (generated, gitignored; `npm run cap:sync` builds it).
`src/platform/sms/nativeBundle.test.ts` runs that exact bundle in a bare V8 context and checks it
agrees with the app's parser.

## When a transaction is added without a tap

`src/domain/transactions/ingest/autoAdd.ts`, one pure module, run twice: in the sandbox when the
message arrives (to word the notification) and in the app before it saves (the only place that can
see the ledger). A detection is added automatically only if **all** of these hold:

| Check | Why |
|---|---|
| The user's switch *Add clear transactions automatically* is on (default on) | It is their decision |
| The message says which way the money went | An unknown direction is never saved as an expense |
| The amount is in the ledger currency | A USD figure is never recorded as rupees |
| There is a payee, and a rule gives its category at ≥ 0.9 confidence — the entry form's own pre-fill threshold — for a category that exists and is not archived | No guessed "Other" |
| There is a date, and the duplicate key is not the weak undated one | A repeat must be recognisable |
| The account is certain: the one bank, savings or card account whose last digits the message shows, or the user's only such account | Digits that match no account (a card the user never added) are never guessed onto another |
| No transaction with the same amount and type within a day is already in the ledger | A typed entry, or a second chai — a person decides |
| No opposite movement of the same amount on another account within two days | Half of a transfer between the user's own accounts — review offers *Record as one transfer* |

Anything else waits on **Settings → Detected transactions**. Confirming one there **teaches the
payee's category** (a personal rule at 0.95), so the payee's next payment is added automatically.

**When the write happens.** The ledger can only be written by the app — native code would need the
user's session, and sharing its rotating refresh token risks signing them out. So: app open or in the
background → added within seconds; app not running → the detection is queued (encrypted) and
notified as added, and written the moment the app opens. The web dashboard on another device sees it
after that.

**Undo** in the notification opens the app, which deletes the row (or, if it was not written yet,
just drops it). The message's fingerprint stays remembered, so it does not come back. A tap on the
notification opens the transaction to edit — or, for one waiting, to review.

## Files

| Where | What |
|---|---|
| `android/app/src/main/java/com/moneymatters/app/sms/SmsReceiver.java` | Receives `SMS_RECEIVED`; checks opt-in and sender; parses off the main thread (`goAsync`) |
| `…/sms/PaymentNotificationListener.java`, `PaymentApps.java` | Payment-app notifications; the package allow-list (JVM-tested) |
| `…/sms/InboxImporter.java` | Reads the inbox since a date through the same detector, silently |
| `…/sms/SenderPolicy.java`, `IncomingSms.java` | Which SMS senders are read; multi-part reassembly (JVM-tested) |
| `…/sms/ParserSandbox.java`, `TransactionDetector.java` | Runs the bundled parser; queues the candidate; pairs a payment's SMS and notification; notifies |
| `…/sms/DetectionQueue.java` | Encrypted queue of candidates; seen fingerprints; the last day's captures (figures only) |
| `…/sms/DetectionNotifier.java` | Notification channel, "added"/"detected" text, lock-screen version, tap and Undo |
| `…/sms/CaptureSettings.java`, `SmsCapturePlugin.java` | Switches and synced context; the Capacitor bridge (`SmsCapture`) |
| `src/domain/transactions/ingest/` | Parser, fingerprint, `review.ts`, `autoAdd.ts`, `samePayment.ts` |
| `src/platform/sms/` | Port (`smsCapture.ts`), candidate JSON, notification text, the bundle entry |
| `src/features/transactions/detection/` | `DetectionListener` + `autoAdd.ts` (the app's pass, Undo), `DetectedTransactionsPage`, `SmsDetectionSetup`, `PaymentAppsCard`, `InboxImportCard`, `ReviewCandidate` |
| `supabase/migrations/20261004120000_transaction_origin.sql` | `record_transaction_origin`: provenance, and the import's opening-balance shift |

## Permissions

| Permission | Purpose | Requested | If denied |
|---|---|---|---|
| `RECEIVE_SMS` | Receive incoming SMS | Only after **Agree and turn on** on *Detected transactions*, which first shows the disclosure (why / what / how — including that clear transactions are added automatically) | No SMS is read; the app works fully; the screen says how to allow it. Not asked again. |
| `POST_NOTIFICATIONS` (Android 13+) | "Transaction added / detected" notifications | With `RECEIVE_SMS` | Detection still works; results show in the app only |
| `READ_SMS` | Read past bank messages, once | Only after **Agree and import** on the *Import past messages* card, with its own disclosure | No import; live detection unaffected |
| Notification access (`BIND_NOTIFICATION_LISTENER_SERVICE` on the service) | Read allow-listed payment-app notifications | **Agree and open settings** on the *payment apps* card (its own disclosure, which says Android shows a listener every notification) opens Android's Notification access screen; the user grants it there | No payment-app capture; SMS unaffected |
| `BROADCAST_SMS` | *Not requested.* `android:permission` on the receiver, so only the system can deliver to it (SECURITY.md T19) | — | — |

Not requested: `SEND_SMS`, `RECEIVE_MMS`, `RECEIVE_WAP_PUSH`. `android.hardware.telephony` is
`required="false"`. On Android 13+ for apps not installed from a store, SMS and Notification access
are *restricted settings*: Settings → Apps → Money Matters → ⋮ → **Allow restricted settings** first
(the app's screens say so).

## Background behaviour

- `SMS_RECEIVED` is exempt from Android 8's implicit-broadcast limits: the receiver runs whether the
  app is open, in the background, or not running (Android starts the process). The notification
  listener is bound by the system while access is granted. Verified on the emulator: open,
  backgrounded, and process killed.
- **Force stop** puts an app in the stopped state; Android delivers nothing to it until it is opened.
- Some OEM builds (OnePlus/OPPO "auto-launch", aggressive battery managers) can block starting a
  closed app's process. If capture only works while the app is open, allow background activity /
  auto-launch for Money Matters.
- Needs Android 8+ with a WebView that supports JavaScriptSandbox. Otherwise the screen says the
  device is unsupported and nothing runs.
- RCS chat messages are not SMS and do not reach the receiver.

## Privacy (SECURITY.md §9)

| Rule | How |
|---|---|
| Never log the body | No log line contains message text; failures log the exception class only. Debug builds log stage markers (`parsed: sms candidate`, `queued: yes`) — never content. Verified: nothing Money Matters logged during the emulator suite contains message text. Capacitor logs plugin calls in debug builds only; they carry candidate fields (amount, payee), never the message. |
| Never persist the body | The text exists in memory for one parse. The queue stores the candidate; the pairing memory stores direction, amount, time and fingerprint. No WorkManager (it would write inputs unencrypted). |
| Never transmit the body | Parsing is on-device. The ledger receives only the transaction's fields through `saveTransaction`. Unconfirmed detections never leave the phone. |
| Encrypt what is stored | AES-256-GCM, key in the Android Keystore (`DetectionQueue`), for candidates and the pairing memory. |
| Least privilege, asked at opt-in | Each permission at the moment its feature is turned on, after its own disclosure. |
| Never auto-trust an uncertain parse | The table above; Undo; an off switch; review for everything else. |
| Read only what is needed | SMS: alphanumeric business headers only in release builds (`VM-HDFCBK`), TRAI `-P` promotional headers skipped, phone numbers never read — nobody can text the app a fake transaction. Notifications: the `PaymentApps` allow-list; everything else dropped before its content is read; messaging apps never. **Debug builds** also read phone-number senders and `adb shell cmd notification post`, for controlled tests. |
| Notification content | Amount, payee and category only; never account digits, references or balances. Lock screen: "Money Matters added a transaction." / "…found a transaction to review." |

`bank-messages.local` (real messages for local testing) stays gitignored, denied by the dev server
(`server.fs.deny`), served only to this computer by the dev-only `/__dev/bank-messages` endpoint, and
is in neither the web build nor the APK.

## Duplicates

1. **The same message twice** (re-delivery, re-post, or found again by an import) — its fingerprint
   (the bank reference, or the send time plus amount, direction, payee and account) was seen; it is
   skipped on the device.
2. **One payment, an SMS and a notification** — they share no reference, so they are paired by
   direction, amount and send time (within 15 minutes), one to one: the second is dropped, and if the
   notification's detection is still waiting the SMS replaces it (it names the account). Two ₹20
   chais — two SMS, two notifications — stay two payments.
3. **Added twice** — the ledger key `client_request_id` is derived from the fingerprint, so the
   database's unique index writes one row.
4. **Different payments that look alike** — a similar row within a day stops automatic adding; the
   review screen warns but lets a person add it.

## Importing past messages and balances

*Import past messages* reads bank SMS from the last 90 days through the same parser, silently (no
notifications), then runs the automatic pass: clear ones are added, the rest wait for review (with
*Ignore all from inbox*). Messages captured live are recognised and skipped.

An account's opening balance is the balance before its first tracked transaction, and the user typed
it when creating the account — so it already contains every earlier payment. Adding those payments
would wrongly move today's balance. `record_transaction_origin` therefore absorbs an imported
payment sent before the account's `created_at` into `opening_balance_minor`, in the same database
transaction that records its origin, exactly once. Verified on the emulator: importing 16 old
messages left the bank balance unchanged to the paisa. Deleting such a row later changes today's
balance by its amount, as for any back-dated entry.

## Building and testing

```bash
npm run cap:sync                       # web build + sms-parser.js + cap sync
cd android && ./gradlew assembleDebug  # JAVA_HOME = Android Studio's JBR (Java 21)
./gradlew testDebugUnitTest            # SenderPolicy, IncomingSms, PaymentApps
```

For a device or emulator against the local stack, load the app from the Vite dev server: in the
**generated** (gitignored) files, set `server: { url: "http://<PC-address>:5173", cleartext: true }`
in `android/app/src/main/assets/capacitor.config.json` and `android:usesCleartextTraffic="true"` on
`<application>` in `android/capacitor-cordova-android-plugins/src/main/AndroidManifest.xml` —
never in committed files. The emulator reaches the PC at `10.0.2.2`.

```bash
adb emu sms send 5551234 "<message>"                                   # an SMS (debug builds read it)
adb shell cmd notification allow_listener com.moneymatters.app/com.moneymatters.app.sms.PaymentNotificationListener
adb shell "cmd notification post -S bigtext -t '₹320 paid to Swiggy' tag 'Paid from HDFC Bank'"
```

`adb shell` joins its arguments with spaces, unquoted — pass the notification command as one quoted
string, or the title stops at its first word.

## Google Play

Checked on 2026-10-03/04:
[Use of SMS or Call Log permission groups](https://support.google.com/googleplay/android-developer/answer/10208820),
its [preview effective 2027-01-27](https://support.google.com/googleplay/android-developer/answer/17225965),
[Permissions Declaration Form](https://support.google.com/googleplay/android-developer/answer/9214102),
[Prominent Disclosure and Consent](https://support.google.com/googleplay/android-developer/answer/11150561),
[Permissions and APIs that Access Sensitive Information](https://support.google.com/googleplay/android-developer/answer/16558241),
[User Data](https://support.google.com/googleplay/android-developer/answer/10144311).

- `RECEIVE_SMS` and `READ_SMS` are **restricted**. An app that is not the default SMS handler may use
  them only under an approved exception. **"SMS-based money management" — "apps that track and
  manage budget"** — is a listed exception (eligible: `READ_SMS`, `RECEIVE_MMS`, `RECEIVE_SMS`,
  `RECEIVE_WAP_PUSH`), and the 2027 preview keeps it. Approval is case by case.
- Required for them: a **Permissions Declaration Form** with the release (core functionality,
  reviewer instructions, a **demo video**, **test credentials** because the feature is behind
  sign-in). Review can take weeks.
- **Notification access** has no declaration form of its own on those pages. It falls under the
  sensitive-permissions and User Data policies: necessary for core functionality, a prominent
  disclosure with consent before the request (implemented, and it names the apps read), and reading
  other apps' notifications for undisclosed purposes counts as spyware. Re-check at submission.
- Required for all: a **privacy policy** covering on-device message processing and automatic adding,
  the in-app disclosures (implemented: *Agree and turn on*, *Agree and import*, *Agree and open
  settings*, each with *Not now*, none re-asked after a refusal), and an accurate **Data safety**
  form (transaction fields are collected and synced; message and notification text is not).

**Status: not submittable yet.** Before a release:
1. File and get approval for the Permissions Declaration (SMS-based money management) for
   `RECEIVE_SMS` and `READ_SMS`. Until then a release containing them cannot be published.
2. Publish the privacy policy; complete the Data safety form.
3. Ship a release build pointed at the hosted Supabase over HTTPS (no cleartext, no live-reload
   `server.url`), signed with the release key, and apply migration `20261004120000`.
4. If the declaration is refused: ship with SMS capture removed (payment apps and manual entry
   remain), and build CSV/statement import — ADR-0015's ranked fallback.
