package com.arizo.manage.plugins

import android.database.Cursor
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import net.zetetic.database.sqlcipher.SQLiteConnection
import net.zetetic.database.sqlcipher.SQLiteDatabase
import net.zetetic.database.sqlcipher.SQLiteDatabaseHook
import org.json.JSONArray
import java.io.File
import java.util.Arrays
import java.util.concurrent.Executors

/**
 * Hardware-keyed SQLCipher engine (PROMPT.md §2.1, §5.1). Implements the JS SqlExecutor contract:
 *   open()   — takes the DEK from ArizoSecurityPlugin (native memory only), keys the DB, zeroizes it,
 *              asserts PRAGMA cipher_version, enables WAL, secure_delete and foreign keys.
 *   query()  — parameterized SELECT → rows.
 *   batch()  — parameterized statements in ONE transaction; any failure rolls everything back.
 *   close()  — closes the DB (on lock).
 * All DB work runs on one background thread so the UI thread never blocks.
 */
@CapacitorPlugin(name = "ArizoSqlCipher")
class ArizoSqlCipherPlugin : Plugin() {

    private val io = Executors.newSingleThreadExecutor()
    @Volatile private var db: SQLiteDatabase? = null

    override fun load() {
        System.loadLibrary("sqlcipher")
    }

    private fun dbFile(vaultId: String): File {
        require(Regex("^[A-Za-z0-9-]{1,64}$").matches(vaultId)) { "bad vault id" }
        return File(context.getDatabasePath("x").parentFile, "arizo-$vaultId.db").apply { parentFile?.mkdirs() }
    }

    private fun run(call: PluginCall, block: () -> Unit) = io.execute {
        try {
            block()
        } catch (e: Exception) {
            // Never echo SQL or values back: messages carry only the error class / constraint kind.
            val unique = e.message?.contains("UNIQUE constraint failed") == true
            call.reject(if (unique) "UNIQUE constraint failed" else "sql error", if (unique) "UNIQUE" else "SQL_ERROR")
        }
    }

    private fun live(): SQLiteDatabase = db?.takeIf { it.isOpen } ?: throw IllegalStateException("vault is locked")

    @PluginMethod
    fun open(call: PluginCall) = run(call) {
        val vaultId = call.getString("vaultId") ?: throw IllegalArgumentException("vaultId")
        if (db?.isOpen == true) return@run call.resolve()
        val dek = ArizoSecurityPlugin.takeDek() ?: return@run call.reject("unlock first", "LOCKED")
        try {
            val hook = object : SQLiteDatabaseHook {
                override fun preKey(connection: SQLiteConnection) {}
                override fun postKey(connection: SQLiteConnection) {}
            }
            // Raw 32-byte key: SQLCipher uses it directly (no PBKDF2), the Keystore already protects it.
            val opened = SQLiteDatabase.openOrCreateDatabase(dbFile(vaultId), dek, null, null, hook)
            val cipher = opened.rawQuery("PRAGMA cipher_version", arrayOf<String>()).use { c -> if (c.moveToFirst()) c.getString(0) else null }
            if (cipher.isNullOrEmpty()) {
                opened.close()
                throw IllegalStateException("SQLCipher not active")
            }
            // Every PRAGMA goes through rawQuery: SQLCipher's execSQL throws "Queries can be performed using
            // SQLiteDatabase query or rawQuery methods only" for a statement that returns a row, and
            // `secure_delete = ON` returns one. That made every open fail, so the vault never opened.
            try {
                for (p in listOf("PRAGMA journal_mode = WAL", "PRAGMA secure_delete = ON", "PRAGMA foreign_keys = ON")) {
                    opened.rawQuery(p, arrayOf<String>()).use { it.moveToFirst() }
                }
            } catch (e: Exception) {
                opened.close()
                throw e
            }
            db = opened
            call.resolve(JSObject().put("cipherVersion", cipher))
        } finally {
            Arrays.fill(dek, 0)
        }
    }

    @PluginMethod
    fun query(call: PluginCall) = run(call) {
        val sql = call.getString("sql") ?: throw IllegalArgumentException("sql")
        val params = bindArgs((call.getArray("params", JSArray()) ?: JSArray()))
        val rows = JSArray()
        live().rawQuery(sql, *params).use { c -> while (c.moveToNext()) rows.put(rowOf(c)) }
        call.resolve(JSObject().put("rows", rows))
    }

    @PluginMethod
    fun batch(call: PluginCall) = run(call) {
        val stmts = call.getArray("statements", JSArray()) ?: JSArray()
        val d = live()
        d.beginTransaction()
        try {
            for (i in 0 until stmts.length()) {
                val s = stmts.getJSONObject(i)
                d.execSQL(s.getString("sql"), bindArgs(s.optJSONArray("params") ?: JSONArray()))
            }
            d.setTransactionSuccessful()
        } finally {
            d.endTransaction()
        }
        call.resolve()
    }

    @PluginMethod
    fun close(call: PluginCall) = run(call) {
        db?.close()
        db = null
        call.resolve()
    }

    /** Wipe All Data: delete the vault DB and its WAL/SHM files. */
    @PluginMethod
    fun destroy(call: PluginCall) = run(call) {
        val vaultId = call.getString("vaultId") ?: throw IllegalArgumentException("vaultId")
        db?.close()
        db = null
        val f = dbFile(vaultId)
        listOf(f, File(f.path + "-wal"), File(f.path + "-shm"), File(f.path + "-journal")).forEach { it.delete() }
        call.resolve()
    }

    private fun bindArgs(arr: JSONArray): Array<Any?> = Array(arr.length()) { i ->
        when (val v = arr.opt(i)) {
            null, org.json.JSONObject.NULL -> null
            is Int, is Long -> (v as Number).toLong()
            is Double -> if (v % 1.0 == 0.0) v.toLong() else v
            is Boolean -> if (v) 1L else 0L
            else -> v.toString()
        }
    }

    private fun rowOf(c: Cursor): JSObject {
        val o = JSObject()
        for (i in 0 until c.columnCount) {
            val name = c.getColumnName(i)
            when (c.getType(i)) {
                Cursor.FIELD_TYPE_NULL -> o.put(name, org.json.JSONObject.NULL)
                Cursor.FIELD_TYPE_INTEGER -> o.put(name, c.getLong(i))
                Cursor.FIELD_TYPE_FLOAT -> o.put(name, c.getDouble(i))
                else -> o.put(name, c.getString(i))
            }
        }
        return o
    }
}
