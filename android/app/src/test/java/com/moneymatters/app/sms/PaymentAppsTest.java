package com.moneymatters.app.sms;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PaymentAppsTest {

    @Test
    public void readsUpiAndBankApps() {
        for (String app : new String[] {
            "com.google.android.apps.nbu.paisa.user", "com.phonepe.app", "net.one97.paytm", "in.org.npci.upiapp",
            "com.sbi.lotusintouch",
        }) {
            assertTrue(app, PaymentApps.accepts(app, false));
        }
    }

    @Test
    public void neverReadsMessagingOrOtherApps() {
        for (String app : new String[] {
            "com.whatsapp", "com.google.android.apps.messaging", "com.android.chrome", "com.instagram.android",
        }) {
            assertFalse(app, PaymentApps.accepts(app, true));
        }
        assertFalse(PaymentApps.accepts(null, true));
    }

    @Test
    public void readsTheShellOnlyInDebugBuilds() {
        assertFalse(PaymentApps.accepts("com.android.shell", false));
        assertTrue(PaymentApps.accepts("com.android.shell", true));
    }
}
