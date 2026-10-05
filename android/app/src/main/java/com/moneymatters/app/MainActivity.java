package com.moneymatters.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.moneymatters.app.sms.SmsCapturePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins are registered before the bridge starts.
        registerPlugin(SmsCapturePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
