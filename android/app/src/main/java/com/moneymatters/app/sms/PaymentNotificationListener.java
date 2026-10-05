package com.moneymatters.app.sms;

import android.app.Notification;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Payment-app notifications as a second source — for the payments a bank no
 * longer texts about (several banks stopped SMS alerts for small UPI
 * payments). Android binds this service only after the user grants
 * Notification access in system settings; it runs only while detection and
 * "payment apps" are both turned on in Money Matters.
 *
 * Only notifications from PaymentApps are read: title and text, joined with
 * ". ", handed to TransactionDetector exactly like an SMS body, and gone after
 * the parse. Group summaries and ongoing notifications (progress, "payment in
 * progress") are skipped. A re-posted notification carries the same time and
 * text, so its fingerprint was seen and it is kept once.
 */
public final class PaymentNotificationListener extends NotificationListenerService {

    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();

    @Override
    public void onNotificationPosted(StatusBarNotification posted) {
        Context app = getApplicationContext();
        boolean debuggable = (app.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (!PaymentApps.accepts(posted.getPackageName(), debuggable)) return;
        if (!CaptureSettings.isEnabled(app) || !CaptureSettings.paymentApps(app)) return;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !ParserSandbox.isSupported(app)) return;

        Notification notification = posted.getNotification();
        if ((notification.flags & (Notification.FLAG_GROUP_SUMMARY | Notification.FLAG_ONGOING_EVENT)) != 0) {
            return;
        }
        String text = textOf(notification.extras);
        if (text.isEmpty()) return;
        long sentAt = notification.when > 0 ? notification.when : posted.getPostTime();
        if (debuggable) Log.i(TransactionDetector.TAG, "NOTIFICATION_POSTED: payment app");

        WORKER.execute(() -> TransactionDetector.detect(
            app, text, sentAt, DetectionQueue.SOURCE_NOTIFICATION, debuggable));
    }

    /** "Title. Text" — the big text when the app gives one, as people read it. */
    private static String textOf(Bundle extras) {
        if (extras == null) return "";
        CharSequence title = extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence body = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
        if (body == null || body.length() == 0) body = extras.getCharSequence(Notification.EXTRA_TEXT);
        String head = title == null ? "" : title.toString().trim();
        String tail = body == null ? "" : body.toString().trim();
        if (head.isEmpty()) return tail;
        if (tail.isEmpty()) return head;
        return head.matches(".*[.!?:]$") ? head + " " + tail : head + ". " + tail;
    }
}
