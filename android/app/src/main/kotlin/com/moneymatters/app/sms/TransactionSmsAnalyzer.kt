package com.moneymatters.app.sms

import java.util.Locale

/**
 * Keyword checks and amount extraction for bank / UPI style SMS.
 */
object TransactionSmsAnalyzer {

    private val KEYWORD_DEBIT_CREDIT_UPI = listOf("debited", "credited", "upi")
    private val RS_WORD = Regex("""(?i)\brs\.?\b""")
    private val AMOUNT_AFTER_PREFIX = Regex(
        """(?i)(?:rs\.?|inr|₹)\s*:?\s*([\d,]+(?:\.\d{1,2})?)\b"""
    )
    private val AMOUNT_BEFORE_SUFFIX = Regex(
        """([\d,]+(?:\.\d{1,2})?)\s*(?:(?:rs\.?|inr)\b)"""
    )
    private val AMOUNT_NEAR_ACTION = Regex(
        """(?i)(?:debited|credited|spent|paid|received|transfer(?:red)?)[^\d]{0,40}([\d,]+(?:\.\d{1,2})?)\b"""
    )

    fun isTransactionRelated(body: String): Boolean {
        val lower = body.lowercase(Locale.ROOT)
        if (KEYWORD_DEBIT_CREDIT_UPI.any { lower.contains(it) }) return true
        if (lower.contains("inr") || body.contains('₹')) return true
        return RS_WORD.containsMatchIn(body)
    }

    fun extractAmount(body: String): String? {
        AMOUNT_AFTER_PREFIX.find(body)?.groupValues?.get(1)?.let { return normalizeAmount(it) }
        AMOUNT_BEFORE_SUFFIX.find(body)?.groupValues?.get(1)?.let { return normalizeAmount(it) }
        AMOUNT_NEAR_ACTION.find(body)?.groupValues?.get(1)?.let { return normalizeAmount(it) }
        return null
    }

    private fun normalizeAmount(raw: String): String = raw.replace(",", "").trim()
}
