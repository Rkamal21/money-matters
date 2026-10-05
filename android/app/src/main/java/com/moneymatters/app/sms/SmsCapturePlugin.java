package com.moneymatters.app.sms;

import android.Manifest;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The bridge between the detectors and the app (src/platform/sms/smsCapture.ts).
 * It moves candidates, switches and permission states — never message text.
 */
@CapacitorPlugin(
    name = "SmsCapture",
    permissions = {
        @Permission(alias = "sms", strings = {Manifest.permission.RECEIVE_SMS}),
        @Permission(alias = "inbox", strings = {Manifest.permission.READ_SMS}),
        @Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS}),
    })
public class SmsCapturePlugin extends Plugin {

    private static final ExecutorService IMPORTER = Executors.newSingleThreadExecutor();
    private static volatile SmsCapturePlugin active;
    private JSObject opened;

    @Override
    public void load() {
        active = this;
        opened = openedIn(getActivity().getIntent());
    }

    @Override
    protected void handleOnDestroy() {
        if (active == this) active = null;
    }

    /** A notification (or its Undo) tapped while the app is already running. */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        JSObject data = openedIn(intent);
        if (data != null) notifyListeners("detectionOpened", data, true);
    }

    /** Called by TransactionDetector, from its worker thread, when the app is alive. */
    static void detectionAdded(String id) {
        SmsCapturePlugin plugin = active;
        if (plugin == null) return;
        new Handler(Looper.getMainLooper()).post(() -> {
            JSObject data = new JSObject();
            data.put("id", id);
            plugin.notifyListeners("detectionAdded", data);
        });
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject status = permissionStates();
        status.put("supported", ParserSandbox.isSupported(getContext()));
        status.put("enabled", CaptureSettings.isEnabled(getContext()));
        status.put("autoAdd", CaptureSettings.autoAdd(getContext()));
        status.put("paymentApps", CaptureSettings.paymentApps(getContext()));
        status.put(
            "notificationAccess",
            NotificationManagerCompat.getEnabledListenerPackages(getContext()).contains(getContext().getPackageName()));
        call.resolve(status);
    }

    @PluginMethod
    public void requestCapturePermissions(PluginCall call) {
        String[] aliases = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            ? new String[] {"sms", "notifications"}
            : new String[] {"sms"};
        requestPermissionForAliases(aliases, call, "permissionsResult");
    }

    /** READ_SMS, asked only when the user chooses to import past messages. */
    @PluginMethod
    public void requestInboxPermission(PluginCall call) {
        requestPermissionForAlias("inbox", call, "permissionsResult");
    }

    @PermissionCallback
    private void permissionsResult(PluginCall call) {
        call.resolve(permissionStates());
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        CaptureSettings.setEnabled(getContext(), Boolean.TRUE.equals(call.getBoolean("enabled", false)));
        call.resolve();
    }

    @PluginMethod
    public void setAutoAdd(PluginCall call) {
        CaptureSettings.setAutoAdd(getContext(), Boolean.TRUE.equals(call.getBoolean("enabled", true)));
        call.resolve();
    }

    @PluginMethod
    public void setPaymentApps(PluginCall call) {
        CaptureSettings.setPaymentApps(getContext(), Boolean.TRUE.equals(call.getBoolean("enabled", false)));
        call.resolve();
    }

    /** Android's Notification access screen — straight to Money Matters' switch where Android allows it. */
    @PluginMethod
    public void openNotificationAccess(PluginCall call) {
        ComponentName listener = new ComponentName(getContext(), PaymentNotificationListener.class);
        Intent settings = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
            ? new Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, listener.flattenToString())
            : new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(settings);
        } catch (android.content.ActivityNotFoundException missing) {
            getContext().startActivity(
                new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        call.resolve();
    }

    @PluginMethod
    public void syncContext(PluginCall call) {
        String rules = call.getString("rules", "[]");
        String categories = call.getString("categories", "[]");
        String accounts = call.getString("accounts", "[]");
        String currency = call.getString("currency", "");
        try {
            new JSONArray(rules);
            new JSONArray(categories);
            new JSONArray(accounts);
        } catch (Exception malformed) {
            call.reject("rules, categories and accounts must be JSON arrays");
            return;
        }
        CaptureSettings.setContext(getContext(), rules, categories, currency == null ? "" : currency, accounts);
        call.resolve();
    }

    @PluginMethod
    public void listPending(PluginCall call) {
        JSArray detections = new JSArray();
        for (DetectionQueue.Entry entry : DetectionQueue.list(getContext())) {
            JSObject item = new JSObject();
            item.put("id", entry.id);
            item.put("receivedAt", entry.receivedAt);
            item.put("sentAt", entry.sentAt);
            item.put("source", entry.source);
            item.put("auto", entry.auto);
            item.put("requestId", entry.requestId);
            item.put("candidate", entry.candidateJson);
            detections.put(item);
        }
        JSObject result = new JSObject();
        result.put("detections", detections);
        call.resolve(result);
    }

    /** Confirmed or ignored by the user, or taken back by Undo: out of the queue, notification gone. */
    @PluginMethod
    public void remove(PluginCall call) {
        String id = call.getString("id");
        if (id == null) {
            call.reject("id is required");
            return;
        }
        DetectionQueue.remove(getContext(), id);
        DetectionNotifier.cancel(getContext(), id);
        call.resolve();
    }

    /**
     * Added to the ledger by the app. Out of the queue; the notification becomes
     * "added" with Undo, or goes away when `notice` is absent (an import, or a
     * message already in the ledger).
     */
    @PluginMethod
    public void settle(PluginCall call) {
        String id = call.getString("id");
        if (id == null) {
            call.reject("id is required");
            return;
        }
        DetectionQueue.remove(getContext(), id);
        JSObject notice = call.getObject("notice");
        if (notice == null) {
            DetectionNotifier.cancel(getContext(), id);
        } else {
            DetectionNotifier.show(
                getContext(),
                id,
                call.getString("requestId", ""),
                notice.getString("title", ""),
                notice.getString("text", ""),
                notice.getString("publicText", ""),
                true);
        }
        call.resolve();
    }

    /** The app found a reason to ask after all: kept for review, its notification says so. */
    @PluginMethod
    public void hold(PluginCall call) {
        String id = call.getString("id");
        JSObject notice = call.getObject("notice");
        if (id == null || notice == null) {
            call.reject("id and notice are required");
            return;
        }
        DetectionQueue.Entry entry = DetectionQueue.get(getContext(), id);
        if (entry == null) {
            call.resolve();
            return;
        }
        try {
            DetectionQueue.markHeld(getContext(), id);
        } catch (Exception failure) {
            call.reject("could not update the detection");
            return;
        }
        if (!DetectionQueue.SOURCE_IMPORT.equals(entry.source)) {
            DetectionNotifier.show(
                getContext(),
                id,
                entry.requestId,
                notice.getString("title", ""),
                notice.getString("text", ""),
                notice.getString("publicText", ""),
                false);
        }
        call.resolve();
    }

    /**
     * Reads bank messages from the inbox since `days` ago and queues their
     * candidates, silently — the app adds or lists them next. Needs READ_SMS
     * and detection turned on. Resolves with counts, never content.
     */
    @PluginMethod
    public void importInbox(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !ParserSandbox.isSupported(getContext())) {
            call.reject("unsupported");
            return;
        }
        if (getPermissionState("inbox") != PermissionState.GRANTED) {
            call.reject("inbox permission not granted");
            return;
        }
        if (!CaptureSettings.isEnabled(getContext())) {
            call.reject("detection is off");
            return;
        }
        int days = Math.max(1, Math.min(365, call.getInt("days", 90)));
        long since = System.currentTimeMillis() - days * 86_400_000L;
        boolean debuggable = (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        IMPORTER.execute(() -> {
            try {
                InboxImporter.Counts counts = InboxImporter.run(getContext(), since, debuggable);
                JSObject result = new JSObject();
                result.put("messages", counts.messages);
                result.put("fromBanks", counts.fromBanks);
                result.put("queued", counts.queued);
                result.put("alreadyFound", counts.seen);
                result.put("notTransactions", counts.rejected);
                call.resolve(result);
            } catch (Exception failure) {
                call.reject("import failed: " + failure.getClass().getSimpleName());
            }
        });
    }

    @PluginMethod
    public void takeOpenedDetection(PluginCall call) {
        JSObject result = opened == null ? new JSObject() : opened;
        // JSONObject.put(key, null) removes the key; send an explicit JSON null instead.
        if (opened == null) result.put("id", JSONObject.NULL);
        opened = null;
        call.resolve(result);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent settings = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.fromParts("package", getContext().getPackageName(), null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(settings);
        call.resolve();
    }

    private JSObject permissionStates() {
        JSObject states = new JSObject();
        states.put("sms", getPermissionState("sms").toString());
        states.put("inbox", getPermissionState("inbox").toString());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            states.put("notifications", getPermissionState("notifications").toString());
        } else {
            boolean on = NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
            states.put("notifications", (on ? PermissionState.GRANTED : PermissionState.DENIED).toString());
        }
        return states;
    }

    private static JSObject openedIn(Intent intent) {
        if (intent == null) return null;
        String action = intent.getAction();
        boolean undo = DetectionNotifier.ACTION_UNDO.equals(action);
        if (!undo && !DetectionNotifier.ACTION_OPEN.equals(action)) return null;
        String id = intent.getStringExtra(DetectionNotifier.EXTRA_ID);
        if (id == null) return null;
        JSObject data = new JSObject();
        data.put("id", id);
        data.put("requestId", intent.getStringExtra(DetectionNotifier.EXTRA_REQUEST));
        data.put("action", undo ? "undo" : "open");
        return data;
    }
}
