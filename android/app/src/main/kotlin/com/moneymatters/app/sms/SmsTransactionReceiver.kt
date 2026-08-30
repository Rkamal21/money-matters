package com.moneymatters.app.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.telephony.SmsMessage
import android.util.Log
import com.moneymatters.app.data.AppDatabase
import com.moneymatters.app.data.SmsTransactionEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Listens for [Telephony.Sms.Intents.SMS_RECEIVED_ACTION], filters transaction-like SMS,
 * extracts an amount when possible, persists rows in Room, and logs to Logcat.
 */
class SmsTransactionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val segments = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        if (segments.isEmpty()) return

        val body = segments.joinToString(separator = "") { it.messageBody.orEmpty() }
        if (body.isBlank()) return
        if (!TransactionSmsAnalyzer.isTransactionRelated(body)) return

        val first = segments[0]
        val sender =
            first.displayOriginatingAddress?.takeIf { it.isNotBlank() }
                ?: first.originatingAddress?.takeIf { it.isNotBlank() }
                ?: "unknown"

        val amount = TransactionSmsAnalyzer.extractAmount(body)
        val receivedAt = segments.maxOf { smsReceivedAtMillis(it) }
        val category = MerchantCategorizer.categoryFromMessage(body)

        Log.i(
            TAG,
            "Transaction SMS | amount=$amount | category=$category | sender=$sender | message=$body",
        )

        val entity = SmsTransactionEntity(
            amount = amount,
            sender = sender,
            messageBody = body,
            receivedAtMillis = receivedAt,
            category = category,
        )

        val pendingResult = goAsync()
        val appContext = context.applicationContext
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                val id = AppDatabase.getInstance(appContext).smsTransactionDao().insert(entity)
                Log.i(
                    TAG,
                    "Stored transaction rowId=$id amount=${entity.amount} category=${entity.category} sender=${entity.sender}",
                )
            } finally {
                pendingResult.finish()
            }
        }
    }

    private fun smsReceivedAtMillis(sms: SmsMessage): Long {
        val t = sms.timestampMillis
        return if (t > 0L) t else System.currentTimeMillis()
    }

    companion object {
        private const val TAG = "SmsTransaction"
    }
}
