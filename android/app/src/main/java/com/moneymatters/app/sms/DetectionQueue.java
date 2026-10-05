package com.moneymatters.app.sms;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Detected candidates waiting for the app — SECURITY.md §9 rule 4: what little
 * is stored locally is encrypted. Each entry is the candidate's JSON
 * (extracted fields only; the message text is never stored) plus what the app
 * needs to finish it: its confirmation key, whether it was marked for adding
 * automatically, where it came from and when it was sent. Sealed with
 * AES-256-GCM under a key that lives in the Android Keystore and never leaves
 * it.
 *
 * Fingerprints already queued or finished are remembered, so the same message
 * delivered twice — or found again by an inbox import — is kept once. A
 * fingerprint is a SHA-256 of extracted fields, not message text.
 *
 * The last day's live captures are remembered too — direction, amount, time and
 * fingerprint, never a payee or text — so a payment app's notification and the
 * bank's SMS for the same payment are kept once (src/domain/transactions/
 * ingest/samePayment.ts).
 */
final class DetectionQueue {

    static final String SOURCE_SMS = "sms";
    static final String SOURCE_NOTIFICATION = "notification";
    static final String SOURCE_IMPORT = "import";

    static final class Entry {
        final String id;
        final long receivedAt;
        final long sentAt;
        final String source;
        final boolean auto;
        final String requestId;
        final String candidateJson;

        Entry(JSONObject entry) throws Exception {
            this.id = entry.getString("id");
            this.receivedAt = entry.getLong("receivedAt");
            this.sentAt = entry.optLong("sentAt", receivedAt);
            this.source = entry.optString("source", SOURCE_SMS);
            this.auto = entry.optBoolean("auto", false);
            this.requestId = entry.optString("requestId", "");
            this.candidateJson = entry.getString("candidate");
        }
    }

    private static final String PREFS = "mm_sms_detections";
    private static final String ENTRY = "d:";
    private static final String SEEN = "seen";
    private static final String RECENT = "recent";
    private static final long RECENT_FOR_MS = 24L * 60 * 60 * 1000;
    private static final int RECENT_LIMIT = 200;
    private static final int SEEN_LIMIT = 2000;
    private static final String KEY_ALIAS = "money_matters_detections";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String TRANSFORM = "AES/GCM/NoPadding";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    private DetectionQueue() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Queues a candidate; `null` when its fingerprint was seen before. */
    static synchronized String add(
        Context context,
        String candidateJson,
        String fingerprint,
        String requestId,
        boolean auto,
        String source,
        long sentAt,
        long receivedAt) throws Exception {
        SharedPreferences prefs = prefs(context);
        Set<String> seen = seen(prefs);
        if (seen.contains(fingerprint)) return null;

        String id = UUID.randomUUID().toString();
        JSONObject entry = new JSONObject();
        entry.put("id", id);
        entry.put("receivedAt", receivedAt);
        entry.put("sentAt", sentAt);
        entry.put("source", source);
        entry.put("auto", auto);
        entry.put("requestId", requestId);
        entry.put("candidate", candidateJson);
        seen.add(fingerprint);
        prefs.edit()
            .putString(ENTRY + id, encrypt(entry.toString()))
            .putString(SEEN, String.join(",", trim(seen)))
            .apply();
        return id;
    }

    static synchronized List<Entry> list(Context context) {
        List<Entry> entries = new ArrayList<>();
        for (Map.Entry<String, ?> stored : prefs(context).getAll().entrySet()) {
            if (!stored.getKey().startsWith(ENTRY) || !(stored.getValue() instanceof String)) continue;
            try {
                entries.add(new Entry(new JSONObject(decrypt((String) stored.getValue()))));
            } catch (Exception unreadable) {
                // A record that cannot be decrypted (e.g. the key was reset) is dropped.
                prefs(context).edit().remove(stored.getKey()).apply();
            }
        }
        return entries;
    }

    static synchronized Entry get(Context context, String id) {
        String sealed = prefs(context).getString(ENTRY + id, null);
        if (sealed == null) return null;
        try {
            return new Entry(new JSONObject(decrypt(sealed)));
        } catch (Exception unreadable) {
            return null;
        }
    }

    /** The app found a reason to ask the user after all: no longer marked for adding. */
    static synchronized void markHeld(Context context, String id) throws Exception {
        String sealed = prefs(context).getString(ENTRY + id, null);
        if (sealed == null) return;
        JSONObject entry = new JSONObject(decrypt(sealed));
        entry.put("auto", false);
        prefs(context).edit().putString(ENTRY + id, encrypt(entry.toString())).apply();
    }

    static synchronized void remove(Context context, String id) {
        prefs(context).edit().remove(ENTRY + id).apply();
    }

    /** Remembers a fingerprint without queuing it: a message that repeats another. */
    static synchronized void markSeen(Context context, String fingerprint) {
        SharedPreferences prefs = prefs(context);
        Set<String> seen = seen(prefs);
        seen.add(fingerprint);
        prefs.edit().putString(SEEN, String.join(",", trim(seen))).apply();
    }

    /** The last day's live captures, for the parser bridge's `recent`. */
    static synchronized JSONArray recent(Context context) {
        JSONArray kept = new JSONArray();
        String sealed = prefs(context).getString(RECENT, null);
        if (sealed == null) return kept;
        try {
            JSONArray all = new JSONArray(decrypt(sealed));
            long cutoff = System.currentTimeMillis() - RECENT_FOR_MS;
            for (int i = Math.max(0, all.length() - RECENT_LIMIT); i < all.length(); i++) {
                JSONObject capture = all.getJSONObject(i);
                if (capture.optLong("seenAt", 0) >= cutoff) kept.put(capture);
            }
        } catch (Exception unreadable) {
            prefs(context).edit().remove(RECENT).apply();
        }
        return kept;
    }

    /** The detection queued for a remembered capture, if it is still waiting. */
    static synchronized Entry pendingFor(Context context, String fingerprint) {
        JSONArray all = recent(context);
        for (int i = 0; i < all.length(); i++) {
            JSONObject capture = all.optJSONObject(i);
            if (capture != null && fingerprint.equals(capture.optString("fingerprint"))) {
                String id = capture.optString("detectionId", "");
                return id.isEmpty() ? null : get(context, id);
            }
        }
        return null;
    }

    /**
     * Remembers a capture (the bridge's `capture`), queued as `detectionId` or not
     * at all; `pairedWith` marks the earlier capture it repeats, so neither pairs again.
     */
    static synchronized void remember(
        Context context, JSONObject capture, String detectionId, String pairedWith) throws Exception {
        JSONArray all = recent(context);
        for (int i = 0; i < all.length(); i++) {
            JSONObject other = all.getJSONObject(i);
            if (pairedWith != null && pairedWith.equals(other.optString("fingerprint"))) other.put("paired", true);
        }
        JSONObject kept = new JSONObject(capture.toString());
        kept.put("paired", pairedWith != null);
        kept.put("detectionId", detectionId == null ? "" : detectionId);
        kept.put("seenAt", System.currentTimeMillis());
        all.put(kept);
        prefs(context).edit().putString(RECENT, encrypt(all.toString())).apply();
    }

    private static Set<String> seen(SharedPreferences prefs) {
        String joined = prefs.getString(SEEN, "");
        Set<String> seen = new LinkedHashSet<>();
        if (!joined.isEmpty()) seen.addAll(Arrays.asList(joined.split(",")));
        return seen;
    }

    private static List<String> trim(Set<String> seen) {
        List<String> all = new ArrayList<>(seen);
        return all.size() <= SEEN_LIMIT ? all : all.subList(all.size() - SEEN_LIMIT, all.size());
    }

    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return generator.generateKey();
    }

    private static String encrypt(String plain) throws Exception {
        Cipher cipher = Cipher.getInstance(TRANSFORM);
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = cipher.getIV();
        byte[] sealed = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        ByteBuffer out = ByteBuffer.allocate(iv.length + sealed.length).put(iv).put(sealed);
        return Base64.encodeToString(out.array(), Base64.NO_WRAP);
    }

    private static String decrypt(String encoded) throws Exception {
        byte[] all = Base64.decode(encoded, Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance(TRANSFORM);
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, all, 0, IV_BYTES));
        return new String(cipher.doFinal(all, IV_BYTES, all.length - IV_BYTES), StandardCharsets.UTF_8);
    }
}
