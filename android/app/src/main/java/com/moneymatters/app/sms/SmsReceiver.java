package com.moneymatters.app.sms;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.os.Build;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import android.util.Log;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Receives incoming SMS — declared in AndroidManifest.xml, so Android delivers
 * to it even when the app is not running (SMS_RECEIVED is exempt from the
 * implicit-broadcast limits). `android:permission="android.permission.BROADCAST_SMS"`
 * means only the system can send it this broadcast (SECURITY.md T19).
 *
 * Its only job: if the user turned detection on, pass messages from bank and
 * payment senders to TransactionDetector, off the main thread. `goAsync()` keeps
 * the broadcast alive for the parse instead of a WorkManager job, whose input
 * would be written, unencrypted, to WorkManager's database.
 */
public final class SmsReceiver extends BroadcastReceiver {

    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();

    private static final String TAG = "MMDetection";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        Context app = context.getApplicationContext();
        // Debug builds read phone-number senders too (controlled tests) and log which stage a
        // message reached — stages and counts only, never the sender or the text.
        boolean debuggable = (app.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        boolean enabled = CaptureSettings.isEnabled(app);
        boolean supported = ParserSandbox.isSupported(app);
        if (debuggable) Log.i(TAG, "SMS_RECEIVED: enabled=" + enabled + " supported=" + supported);
        if (!enabled || !supported) return;

        SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (parts == null || parts.length == 0) return;
        String[] senders = new String[parts.length];
        String[] bodies = new String[parts.length];
        long[] sentAts = new long[parts.length];
        for (int i = 0; i < parts.length; i++) {
            senders[i] = parts[i].getDisplayOriginatingAddress();
            bodies[i] = parts[i].getMessageBody();
            sentAts[i] = parts[i].getTimestampMillis();
        }

        List<IncomingSms> accepted = new ArrayList<>();
        StringBuilder shapes = new StringBuilder();
        for (IncomingSms sms : IncomingSms.assemble(senders, bodies, sentAts)) {
            if (SenderPolicy.accepts(sms.sender, debuggable)) accepted.add(sms);
            shapes.append(shapes.length() == 0 ? "" : ",").append(SenderPolicy.shape(sms.sender));
        }
        if (debuggable) {
            Log.i(TAG, "parts=" + parts.length + " senders=" + shapes + " accepted=" + accepted.size());
        }
        if (accepted.isEmpty() || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        PendingResult pending = goAsync();
        WORKER.execute(() -> {
            try {
                for (IncomingSms sms : accepted) {
                    TransactionDetector.detect(app, sms.body, sms.sentAt, DetectionQueue.SOURCE_SMS, debuggable);
                }
            } finally {
                pending.finish();
            }
        });
    }
}
