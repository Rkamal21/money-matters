package com.moneymatters.app.sms;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * The user's switches, and the context the app hands down so a message that
 * arrives while the app is closed is still categorised and, when it is clear,
 * marked for adding: merchant rules, category kinds and names, the ledger
 * currency, and the accounts' types and last digits. None of it is message
 * content.
 */
final class CaptureSettings {

    private static final String PREFS = "mm_sms_capture";
    private static final String ENABLED = "enabled";
    private static final String AUTO_ADD = "autoAdd";
    private static final String PAYMENT_APPS = "paymentApps";
    private static final String RULES = "rules";
    private static final String CATEGORIES = "categories";
    private static final String CURRENCY = "currency";
    private static final String ACCOUNTS = "accounts";

    private CaptureSettings() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean isEnabled(Context context) {
        return prefs(context).getBoolean(ENABLED, false);
    }

    static void setEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(ENABLED, enabled).apply();
    }

    /** "Add clear transactions automatically" — on unless the user turned it off. */
    static boolean autoAdd(Context context) {
        return prefs(context).getBoolean(AUTO_ADD, true);
    }

    static void setAutoAdd(Context context, boolean autoAdd) {
        prefs(context).edit().putBoolean(AUTO_ADD, autoAdd).apply();
    }

    /** Read payment-app notifications too — off until the user turns it on. */
    static boolean paymentApps(Context context) {
        return prefs(context).getBoolean(PAYMENT_APPS, false);
    }

    static void setPaymentApps(Context context, boolean on) {
        prefs(context).edit().putBoolean(PAYMENT_APPS, on).apply();
    }

    static String rulesJson(Context context) {
        return prefs(context).getString(RULES, "[]");
    }

    static String categoriesJson(Context context) {
        return prefs(context).getString(CATEGORIES, "[]");
    }

    /** Empty until the app has run once: then nothing is marked for adding. */
    static String currency(Context context) {
        return prefs(context).getString(CURRENCY, "");
    }

    static String accountsJson(Context context) {
        return prefs(context).getString(ACCOUNTS, "[]");
    }

    static void setContext(
        Context context, String rulesJson, String categoriesJson, String currency, String accountsJson) {
        prefs(context).edit()
            .putString(RULES, rulesJson)
            .putString(CATEGORIES, categoriesJson)
            .putString(CURRENCY, currency)
            .putString(ACCOUNTS, accountsJson)
            .apply();
    }
}
