package com.moneymatters.app.sms;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * Whose notifications are read: UPI payment apps and bank apps, by package
 * name — the notification-listener counterpart of SenderPolicy. Android shows
 * a listener every notification on the phone; anything not from one of these
 * packages is dropped before its content is looked at.
 *
 * Messaging and social apps are never on the list, even ones with a payments
 * feature: their notifications are people's conversations.
 */
final class PaymentApps {

    private static final Set<String> PACKAGES = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        // UPI payment apps
        "com.google.android.apps.nbu.paisa.user", // Google Pay
        "com.phonepe.app",
        "net.one97.paytm",
        "in.org.npci.upiapp", // BHIM
        "com.dreamplug.androidapp", // CRED
        "com.mobikwik_new",
        "com.freecharge.android",
        // Bank apps
        "com.sbi.lotusintouch", // SBI YONO
        "com.csam.icici.bank.imobile", // ICICI iMobile
        "com.snapwork.hdfc", // HDFC Bank
        "com.axis.mobile",
        "com.msf.kbank.mobile" // Kotak
    )));

    /** Debug builds also read `cmd notification post` from the shell, for controlled tests. */
    private static final String SHELL = "com.android.shell";

    private PaymentApps() {}

    static boolean accepts(String packageName, boolean debuggable) {
        if (packageName == null) return false;
        return PACKAGES.contains(packageName) || (debuggable && SHELL.equals(packageName));
    }
}
