package com.moneymatters.app.sms;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Which senders' messages are read at all (SECURITY.md T19, §9).
 *
 * Banks and payment services send from alphanumeric business headers ("VM-HDFCBK",
 * "AX-SBIUPI-T") that a person cannot set on a phone-to-phone SMS, so release
 * builds read those only: a message from a phone number is never parsed, and a
 * stranger cannot text the app a fake transaction. TRAI's "-P" suffix marks
 * promotional traffic, which is skipped without reading it.
 *
 * Debug builds also accept phone numbers, so a developer can send a controlled
 * test SMS from another phone or an emulator.
 */
public final class SenderPolicy {

    private static final Pattern BUSINESS_HEADER = Pattern.compile("[A-Z0-9][A-Z0-9 ._-]{1,19}");
    private static final Pattern PHONE_NUMBER = Pattern.compile("\\+?[0-9]{3,15}");

    private SenderPolicy() {}

    /**
     * The kind of sender, for debug diagnostics — never the sender itself:
     * "phone", "header", "promotional" or "invalid".
     */
    public static String shape(String sender) {
        if (sender == null || sender.trim().isEmpty()) return "invalid";
        String header = sender.trim().toUpperCase(Locale.ROOT);
        if (PHONE_NUMBER.matcher(header).matches()) return "phone";
        if (header.endsWith("-P")) return "promotional";
        return accepts(sender, false) ? "header" : "invalid";
    }

    public static boolean accepts(String sender, boolean allowPhoneNumbers) {
        if (sender == null) return false;
        String header = sender.trim().toUpperCase(Locale.ROOT);
        if (header.isEmpty()) return false;
        boolean hasLetter = false;
        for (int i = 0; i < header.length(); i++) {
            if (Character.isLetter(header.charAt(i))) {
                hasLetter = true;
                break;
            }
        }
        if (!hasLetter) return allowPhoneNumbers && PHONE_NUMBER.matcher(header).matches();
        if (header.endsWith("-P")) return false;
        return BUSINESS_HEADER.matcher(header).matches();
    }
}
