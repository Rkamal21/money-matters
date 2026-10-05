package com.moneymatters.app.sms;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.moneymatters.app.MainActivity;
import com.moneymatters.app.R;

/**
 * "Money Matters added a ₹486 payment at Swiggy to Food." or "Money Matters
 * detected a ₹486 payment at Swiggy." The text comes from the parser bundle
 * (src/platform/sms/notice.ts): an amount, a payee and a category, never
 * account digits, references or balances. On a locked screen only a neutral
 * public version shows.
 *
 * Tapping opens the transaction — to edit one that was added, to review one
 * that was not. One that was added also offers Undo, which opens the app to
 * take it back out: removing a saved transaction is the app's job.
 */
final class DetectionNotifier {

    static final String ACTION_OPEN = "com.moneymatters.app.OPEN_DETECTION";
    static final String ACTION_UNDO = "com.moneymatters.app.UNDO_DETECTION";
    static final String EXTRA_ID = "detectionId";
    static final String EXTRA_REQUEST = "requestId";
    private static final String CHANNEL = "detected_transactions";
    private static final int NOTIFICATION_ID = 1;

    private DetectionNotifier() {}

    static boolean canNotify(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    /** Posts, or replaces, the notification for one detection. `added`: it carries Undo. */
    static void show(
        Context context, String id, String requestId, String title, String text, String publicText, boolean added) {
        if (!canNotify(context)) return;
        ensureChannel(context);

        NotificationCompat.Builder locked = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_detected)
            .setContentTitle(title)
            .setContentText(publicText);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_detected)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(intent(context, ACTION_OPEN, id, requestId, 0))
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(locked.build());
        if (added) builder.addAction(0, "Undo", intent(context, ACTION_UNDO, id, requestId, 1));

        try {
            NotificationManagerCompat.from(context).notify(id, NOTIFICATION_ID, builder.build());
        } catch (SecurityException revoked) {
            // Permission withdrawn between the check and the post: the detection still waits in the app.
        }
    }

    static void cancel(Context context, String id) {
        NotificationManagerCompat.from(context).cancel(id, NOTIFICATION_ID);
    }

    private static PendingIntent intent(Context context, String action, String id, String requestId, int slot) {
        Intent open = new Intent(context, MainActivity.class)
            .setAction(action)
            .putExtra(EXTRA_ID, id)
            .putExtra(EXTRA_REQUEST, requestId)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(
            context, id.hashCode() * 2 + slot, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL, "Detected transactions", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("Payments found in bank SMS and payment apps: added, or waiting for your review");
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
}
