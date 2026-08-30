package com.moneymatters.app.data

import androidx.room.Dao
import androidx.room.Insert

@Dao
interface SmsTransactionDao {

    @Insert
    suspend fun insert(entity: SmsTransactionEntity): Long
}
