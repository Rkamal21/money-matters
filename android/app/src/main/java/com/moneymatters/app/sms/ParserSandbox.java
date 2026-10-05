package com.moneymatters.app.sms;

import android.content.Context;
import android.os.Build;
import androidx.annotation.RequiresApi;
import androidx.javascriptengine.JavaScriptIsolate;
import androidx.javascriptengine.JavaScriptSandbox;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/**
 * Runs the app's transaction parser — src/domain/transactions/ingest, compiled
 * into assets/sms-parser.js by scripts/build-sms-parser.mjs — in a
 * JavaScriptSandbox: an isolated V8 with no network, no storage and no DOM.
 * There is no Java parser; this is the same code the app runs.
 *
 * A Session loads the parser once and parses many messages — an inbox import —
 * without paying for a new sandbox each time.
 */
final class ParserSandbox {

    static final String ASSET = "sms-parser.js";
    private static final long TIMEOUT_SECONDS = 8;
    private static String script;

    private ParserSandbox() {}

    /** Android 8+ with a WebView able to host the sandbox, and the parser bundled. */
    static boolean isSupported(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
        try {
            return JavaScriptSandbox.isSupported() && load(context) != null;
        } catch (IOException missing) {
            return false;
        }
    }

    /** Parses one message; returns the bridge's JSON (see src/platform/sms/parserBridge.ts). */
    @RequiresApi(api = Build.VERSION_CODES.O)
    static String parse(Context context, String inputJson) throws Exception {
        try (Session session = open(context)) {
            return session.parse(inputJson);
        }
    }

    @RequiresApi(api = Build.VERSION_CODES.O)
    static Session open(Context context) throws Exception {
        String code = load(context);
        JavaScriptSandbox sandbox =
            JavaScriptSandbox.createConnectedInstanceAsync(context).get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        try {
            JavaScriptIsolate isolate = sandbox.createIsolate();
            isolate.evaluateJavaScriptAsync(code + "\n;'ready'").get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
            return new Session(sandbox, isolate);
        } catch (Exception failure) {
            sandbox.close();
            throw failure;
        }
    }

    static final class Session implements AutoCloseable {
        private final JavaScriptSandbox sandbox;
        private final JavaScriptIsolate isolate;

        private Session(JavaScriptSandbox sandbox, JavaScriptIsolate isolate) {
            this.sandbox = sandbox;
            this.isolate = isolate;
        }

        @RequiresApi(api = Build.VERSION_CODES.O)
        String parse(String inputJson) throws Exception {
            String call = "MoneyMattersSms.parse(" + JSONObject.quote(inputJson) + ")";
            return isolate.evaluateJavaScriptAsync(call).get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        }

        @Override
        public void close() {
            isolate.close();
            sandbox.close();
        }
    }

    private static synchronized String load(Context context) throws IOException {
        if (script == null) {
            try (InputStream in = context.getAssets().open(ASSET)) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                for (int read; (read = in.read(buffer)) != -1; ) out.write(buffer, 0, read);
                script = out.toString(StandardCharsets.UTF_8.name());
            }
        }
        return script;
    }
}
