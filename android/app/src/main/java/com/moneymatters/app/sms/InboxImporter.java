package com.moneymatters.app.sms;

import android.content.Context;
import android.database.Cursor;
import android.os.Build;
import android.provider.Telephony;
import androidx.annotation.RequiresApi;

/**
 * "Import past messages": reads the SMS inbox since a date, keeps the messages
 * from bank and payment senders (SenderPolicy, as for live SMS), and runs each
 * through the same parser in one sandbox session. Candidates join the
 * encrypted queue silently; nothing is notified, and the text of every message
 * — read or skipped — goes no further than the parser (SECURITY.md §9).
 *
 * A message already captured live, or found by an earlier import, has a
 * fingerprint the queue has seen, and is skipped.
 */
final class InboxImporter {

    static final class Counts {
        int messages;
        int fromBanks;
        int queued;
        int seen;
        int rejected;
    }

    private static final String[] COLUMNS = {
        Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE, Telephony.Sms.DATE_SENT,
    };

    private InboxImporter() {}

    @RequiresApi(api = Build.VERSION_CODES.O)
    static Counts run(Context context, long since, boolean debuggable) throws Exception {
        Counts counts = new Counts();
        try (Cursor cursor = context.getContentResolver().query(
                 Telephony.Sms.Inbox.CONTENT_URI,
                 COLUMNS,
                 Telephony.Sms.DATE + " >= ?",
                 new String[] {Long.toString(since)},
                 Telephony.Sms.DATE + " ASC");
             ParserSandbox.Session session = ParserSandbox.open(context)) {
            if (cursor == null) return counts;
            while (cursor.moveToNext()) {
                counts.messages++;
                String sender = cursor.getString(0);
                String body = cursor.getString(1);
                if (body == null || !SenderPolicy.accepts(sender, debuggable)) continue;
                counts.fromBanks++;
                // The SMS centre's send time, as a live SMS reports it: one message, one duplicate key.
                long sent = cursor.getLong(3);
                long sentAt = sent > 0 ? sent : cursor.getLong(2);
                String outcome = TransactionDetector.detectWith(
                    session, context, body, sentAt, DetectionQueue.SOURCE_IMPORT, false, debuggable);
                if (TransactionDetector.QUEUED.equals(outcome)) counts.queued++;
                else if (TransactionDetector.SEEN.equals(outcome)) counts.seen++;
                else counts.rejected++;
            }
        }
        return counts;
    }
}
