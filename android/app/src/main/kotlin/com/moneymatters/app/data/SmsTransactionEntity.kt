package com.moneymatters.app.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "sms_transactions")
data class SmsTransactionEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val amount: String?,
    val sender: String,
    val messageBody: String,
    val receivedAtMillis: Long,
    val category: String,
)
