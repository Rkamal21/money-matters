package com.moneymatters.app.sms;

import android.content.Context;
import android.os.Build;
import android.util.Log;
import androidx.annotation.RequiresApi;
import java.time.Instant;
import java.time.ZoneId;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * One message in — a bank SMS, a payment-app notification, or an inbox
 * message being imported — at most one queued candidate out, and, for a live
 * message, one notification.
 *
 * The text is handed to the parser and goes no further: it is never logged,
 * never written to disk, never sent anywhere (SECURITY.md §9). What is kept is
 * the parser's candidate — amount, payee, date, reference, category,
 * confidence, fingerprint — encrypted in DetectionQueue. A rejected message
 * (OTP, promotion, balance alert, failed payment…) leaves no trace at all.
 *
 * A live message that repeats one from the other source — the notification
 * for a payment whose SMS already arrived, or the reverse — is kept once. The
 * SMS wins when the notification's detection is still waiting: it names the
 * account.
 */
final class TransactionDetector {

    static final String TAG = "MMDetection";

    /** What became of one message, for counts and debug markers — never its content. */
    static final String QUEUED = "queued";
    static final String SEEN = "seen";
    static final String REJECTED = "rejected";
    static final String ERROR = "error";

    private TransactionDetector() {}

    /** A live message: parse, queue, notify. Never throws. */
    @RequiresApi(api = Build.VERSION_CODES.O)
    static void detect(Context context, String text, long sentAt, String source, boolean debuggable) {
        try (ParserSandbox.Session session = ParserSandbox.open(context)) {
            detectWith(session, context, text, sentAt, source, true, debuggable);
        } catch (Exception failure) {
            // The class only: a message could carry part of the text.
            Log.w(TAG, "Detection skipped: " + failure.getClass().getSimpleName());
        }
    }

    /** Parses one message in an open session and queues its candidate. Returns QUEUED, SEEN, REJECTED or ERROR. */
    @RequiresApi(api = Build.VERSION_CODES.O)
    static String detectWith(
        ParserSandbox.Session session,
        Context context,
        String text,
        long sentAt,
        String source,
        boolean notify,
        boolean debuggable) throws Exception {
        boolean live = !DetectionQueue.SOURCE_IMPORT.equals(source);
        JSONObject input = new JSONObject();
        input.put("text", text);
        input.put("sentAt", sentAt);
        input.put(
            "receivedOn", Instant.ofEpochMilli(sentAt).atZone(ZoneId.systemDefault()).toLocalDate().toString());
        input.put("rules", new JSONArray(CaptureSettings.rulesJson(context)));
        input.put("categories", new JSONArray(CaptureSettings.categoriesJson(context)));
        input.put("currency", CaptureSettings.currency(context));
        input.put("accounts", new JSONArray(CaptureSettings.accountsJson(context)));
        input.put("autoAdd", CaptureSettings.autoAdd(context));
        input.put("source", source);
        if (live) input.put("recent", DetectionQueue.recent(context));

        JSONObject result = new JSONObject(session.parse(input.toString()));
        String status = result.optString("status");
        // Debug builds: the outcome and rejection code only (e.g. "rejected otp").
        if (debuggable) Log.i(TAG, "parsed: " + source + " " + status + " " + result.optString("reason"));
        if (!"candidate".equals(status)) return "rejected".equals(status) ? REJECTED : ERROR;

        JSONObject candidate = result.getJSONObject("candidate");
        JSONObject notice = result.getJSONObject("notice");
        String requestId = result.getString("requestId");
        boolean auto = result.optBoolean("auto", false);
        String fingerprint = candidate.getJSONObject("fingerprint").getString("value");
        JSONObject capture = result.optJSONObject("capture");
        String samePaymentAs = result.isNull("samePaymentAs") ? null : result.optString("samePaymentAs", null);

        if (samePaymentAs != null) {
            DetectionQueue.Entry earlier = DetectionQueue.pendingFor(context, samePaymentAs);
            boolean replace = DetectionQueue.SOURCE_SMS.equals(source)
                && earlier != null
                && DetectionQueue.SOURCE_NOTIFICATION.equals(earlier.source);
            if (!replace) {
                DetectionQueue.markSeen(context, fingerprint);
                if (capture != null) DetectionQueue.remember(context, capture, null, samePaymentAs);
                if (debuggable) Log.i(TAG, "queued: no (same payment as an earlier " + source + " capture)");
                return SEEN;
            }
            DetectionQueue.remove(context, earlier.id);
            DetectionNotifier.cancel(context, earlier.id);
            if (debuggable) Log.i(TAG, "replacing the notification's detection with the SMS's");
        }

        String id = DetectionQueue.add(
            context, candidate.toString(), fingerprint, requestId, auto, source, sentAt, System.currentTimeMillis());
        if (debuggable) Log.i(TAG, id == null ? "queued: no (seen before)" : "queued: yes auto=" + auto);
        if (id == null) return SEEN; // the same message again
        if (capture != null) DetectionQueue.remember(context, capture, id, samePaymentAs);

        if (notify) {
            DetectionNotifier.show(
                context,
                id,
                requestId,
                notice.getString("title"),
                notice.getString("text"),
                notice.getString("publicText"),
                auto);
            SmsCapturePlugin.detectionAdded(id);
        }
        return QUEUED;
    }
}
