package com.moneymatters.app.sms;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.List;
import org.junit.Test;

public class SenderPolicyTest {

    @Test
    public void readsBankAndPaymentHeaders() {
        for (String sender : new String[] {"VM-HDFCBK", "AX-SBIUPI", "JD-AIRBNK-S", "AD-ICICIT-T", "HDFCBK", "Amazon"}) {
            assertTrue(sender, SenderPolicy.accepts(sender, false));
        }
    }

    @Test
    public void skipsPromotionalHeaders() {
        assertFalse(SenderPolicy.accepts("VM-OFFERS-P", false));
        assertFalse(SenderPolicy.accepts("vm-shopit-p", true));
    }

    @Test
    public void neverReadsAPhoneNumberInRelease() {
        assertFalse(SenderPolicy.accepts("+919876543210", false));
        assertFalse(SenderPolicy.accepts("9876543210", false));
    }

    @Test
    public void readsAPhoneNumberInDebugForControlledTests() {
        assertTrue(SenderPolicy.accepts("+919876543210", true));
        assertTrue(SenderPolicy.accepts("5551234", true));
    }

    @Test
    public void rejectsEmptyAndMalformedSenders() {
        assertFalse(SenderPolicy.accepts(null, true));
        assertFalse(SenderPolicy.accepts("   ", true));
        assertFalse(SenderPolicy.accepts("12", true));
        assertFalse(SenderPolicy.accepts("A-VERY-LONG-HEADER-THAT-IS-NOT-REAL", false));
        assertFalse(SenderPolicy.accepts("HDFC<script>", false));
    }

    @Test
    public void assemblesAMultiPartMessageInOrderWithItsEarliestTimestamp() {
        List<IncomingSms> messages = IncomingSms.assemble(
            new String[] {"VM-HDFCBK", "VM-HDFCBK", "AX-SBIUPI"},
            new String[] {"Rs.486.00 debited from A/c XX1234 ", "to SWIGGY", "Rs 10 credited"},
            new long[] {2000L, 1000L, 3000L});
        assertEquals(2, messages.size());
        assertEquals("VM-HDFCBK", messages.get(0).sender);
        assertEquals("Rs.486.00 debited from A/c XX1234 to SWIGGY", messages.get(0).body);
        assertEquals(1000L, messages.get(0).sentAt);
        assertEquals("Rs 10 credited", messages.get(1).body);
    }

    @Test
    public void treatsMissingPartsAsEmpty() {
        List<IncomingSms> messages = IncomingSms.assemble(new String[] {null}, new String[] {null}, new long[] {5L});
        assertEquals(1, messages.size());
        assertEquals("", messages.get(0).body);
    }
}
