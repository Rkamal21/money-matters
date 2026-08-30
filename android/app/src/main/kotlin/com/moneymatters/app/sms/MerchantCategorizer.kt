package com.moneymatters.app.sms

/**
 * Maps merchant names appearing in SMS / descriptions to expense categories.
 * First matching rule wins (order matters if a message could match multiple patterns).
 */
object MerchantCategorizer {

    private val MERCHANT_RULES: List<Pair<Regex, String>> = listOf(
        Regex("(?i)swiggy") to "Food",
        Regex("(?i)amazon") to "Shopping",
        Regex("(?i)uber") to "Travel",
    )

    fun categoryFromMessage(body: String): String {
        for ((pattern, category) in MERCHANT_RULES) {
            if (pattern.containsMatchIn(body)) return category
        }
        return "Other"
    }
}
