package com.moneymatters.app.sms;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * One incoming SMS, reassembled. A long bank message arrives as several parts
 * in one broadcast; they are joined in order, per sender. The earliest part's
 * SMS-centre timestamp is the message's send time — identical when the same
 * SMS is delivered again, different for a second message with the same words.
 *
 * The body lives only in memory, for the length of one parse.
 */
public final class IncomingSms {

    public final String sender;
    public final String body;
    public final long sentAt;

    IncomingSms(String sender, String body, long sentAt) {
        this.sender = sender;
        this.body = body;
        this.sentAt = sentAt;
    }

    /** Parts as Android delivers them: parallel arrays, in arrival order. */
    public static List<IncomingSms> assemble(String[] senders, String[] bodies, long[] sentAts) {
        Map<String, StringBuilder> text = new LinkedHashMap<>();
        Map<String, Long> earliest = new LinkedHashMap<>();
        for (int i = 0; i < senders.length; i++) {
            String sender = senders[i] == null ? "" : senders[i];
            String body = bodies[i] == null ? "" : bodies[i];
            StringBuilder joined = text.get(sender);
            if (joined == null) {
                joined = new StringBuilder();
                text.put(sender, joined);
                earliest.put(sender, sentAts[i]);
            }
            joined.append(body);
            Long first = earliest.get(sender);
            if (first == null || sentAts[i] < first) earliest.put(sender, sentAts[i]);
        }
        List<IncomingSms> messages = new ArrayList<>();
        for (Map.Entry<String, StringBuilder> entry : text.entrySet()) {
            Long sentAt = earliest.get(entry.getKey());
            messages.add(new IncomingSms(entry.getKey(), entry.getValue().toString(), sentAt == null ? 0L : sentAt));
        }
        return messages;
    }
}
