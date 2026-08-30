package com.moneymatters.app.data

/**
 * @param amount Transaction amount in major currency units (e.g. rupees).
 * @param category User or inferred category label.
 * @param date Epoch milliseconds (UTC) for when the expense occurred.
 * @param source Origin of the record (e.g. "sms", "manual").
 */
data class Expense(
    val amount: Double,
    val category: String,
    val date: Long,
    val source: String,
)
