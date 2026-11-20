package com.arizo.manage.plugins

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.provider.Telephony
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.arizo.manage.MainActivity
import com.arizo.manage.R
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONObject
import java.io.File
import java.security.SecureRandom
import java.text.Normalizer

/**
 * Bank SMS & notification capture (PROMPT.md §5.1, §6.1).
 *
 * - BankSmsReceiver (SMS_RECEIVED) runs even when the app is killed. It drops OTP/2FA and promo
 *   messages natively, keeps only bank-transaction-looking text, seals it with the Keystore queue
 *   public key (ArizoSecurityPlugin.sealForQueue: no DEK, no DB) and posts a generic notification.
 * - BankNotificationListener reads alerts only from the packages the user selected.
 * - The historical scanner (opt-in) seals past inbox SMS from a chosen window.
 * - JS lists sealed items with pending() and opens them only through ArizoSecurity.openQueueItem,
 *   which refuses while the vault is locked.
 *
 * Nothing here logs message content. Permissions are requested only when the user turns a switch on.
 */
@CapacitorPlugin(
    name = "ArizoSms",
    permissions = [Permission(alias = "sms", strings = [Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS])],
)
class ArizoSmsPlugin : Plugin() {

    @PluginMethod
    fun status(call: PluginCall) = call.resolve(statusObj())

    @PluginMethod
    fun setSmsEnabled(call: PluginCall) {
        val on = call.getBoolean("enabled") ?: false
        SmsPrefs.setSms(context, on)
        setReceiverEnabled(on)
        if (on && getPermissionState("sms") != PermissionState.GRANTED) {
            requestPermissionForAlias("sms", call, "smsPermsCallback")
        } else {
            call.resolve(statusObj())
        }
    }

    @PermissionCallback
    private fun smsPermsCallback(call: PluginCall) = call.resolve(statusObj())

    @PluginMethod
    fun setNotificationsEnabled(call: PluginCall) {
        val on = call.getBoolean("enabled") ?: false
        val pkgs = call.getArray("packages")?.toList<String>()?.filter { it.matches(Regex("^[A-Za-z0-9_.]{3,200}$")) } ?: emptyList()
        SmsPrefs.setPush(context, on, pkgs.toSet())
        call.resolve(statusObj())
    }

    @PluginMethod
    fun openNotificationAccess(call: PluginCall) {
        val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { context.startActivity(intent) }
        call.resolve()
    }

    /** Android 13+ Restricted Settings: "Allow restricted settings" lives in App Info's menu. */
    @PluginMethod
    fun openAppInfo(call: PluginCall) {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { context.startActivity(intent) }
        call.resolve()
    }

    /** Launcher apps (visible through the <queries> LAUNCHER entry, no QUERY_ALL_PACKAGES). */
    @PluginMethod
    fun listApps(call: PluginCall) {
        val pm = context.packageManager
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        @Suppress("DEPRECATION")
        val apps = pm.queryIntentActivities(launcher, 0)
            .map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
            .filter { it.first != context.packageName }
            .distinctBy { it.first }
            .sortedBy { it.second.lowercase() }
        val arr = JSArray()
        apps.forEach { (p, l) -> arr.put(JSObject().put("packageName", p).put("label", l)) }
        call.resolve(JSObject().put("apps", arr))
    }

    @PluginMethod
    fun pending(call: PluginCall) {
        val arr = JSArray()
        SmsQueue.list(context).forEach { arr.put(it) }
        call.resolve(JSObject().put("items", arr))
    }

    @PluginMethod
    fun ack(call: PluginCall) {
        call.getArray("ids")?.toList<String>()?.forEach { SmsQueue.delete(context, it) }
        call.resolve()
    }

    /** Opt-in historical scan of the SMS inbox for the last `days` (30 / 90 / 365). */
    @PluginMethod
    fun scanInbox(call: PluginCall) {
        val days = (call.getInt("days") ?: 30).coerceIn(1, 365)
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
            return call.reject("no permission", "NO_PERMISSION")
        }
        Thread {
            var scanned = 0
            var queued = 0
            try {
                val since = System.currentTimeMillis() - days * 86_400_000L
                context.contentResolver.query(
                    Telephony.Sms.Inbox.CONTENT_URI,
                    arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE),
                    "${Telephony.Sms.DATE} >= ?",
                    arrayOf(since.toString()),
                    "${Telephony.Sms.DATE} DESC",
                )?.use { c ->
                    val total = c.count
                    while (c.moveToNext() && scanned < MAX_SCAN) {
                        scanned++
                        val body = c.getString(1) ?: continue
                        if (SmsFilter.accept(body) && SmsQueue.seal(context, body, "sms_auto", c.getString(0) ?: "", c.getLong(2))) queued++
                        if (scanned % 50 == 0) notifyListeners("scanProgress", JSObject().put("done", scanned).put("total", total))
                    }
                }
                call.resolve(JSObject().put("scanned", scanned).put("queued", queued))
            } catch (e: Exception) {
                call.reject("scan failed", "SCAN_FAILED")
            }
        }.start()
    }

    private fun setReceiverEnabled(on: Boolean) {
        context.packageManager.setComponentEnabledSetting(
            ComponentName(context, BankSmsReceiver::class.java),
            if (on) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            PackageManager.DONT_KILL_APP,
        )
    }

    private fun statusObj(): JSObject {
        val smsPerm = ContextCompat.checkSelfPermission(context, Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED
        val listenerOn = NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
        return JSObject()
            .put("smsPermission", smsPerm)
            .put("notificationAccess", listenerOn)
            .put("smsEnabled", SmsPrefs.sms(context))
            .put("notificationsEnabled", SmsPrefs.push(context))
            .put("packages", JSArray(SmsPrefs.packages(context).toList()))
            .put("queued", SmsQueue.count(context))
            .put("restrictedSettings", restrictedSettingsLikely())
    }

    /** Sideloaded (no store installer) on Android 13+ → SMS/listener access starts as restricted. */
    private fun restrictedSettingsLikely(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false
        val installer = runCatching { context.packageManager.getInstallSourceInfo(context.packageName).installingPackageName }.getOrNull()
        return installer == null || installer !in STORES
    }

    companion object {
        private const val MAX_SCAN = 5000
        private val STORES = setOf("com.android.vending", "com.google.android.feedback")
    }
}

/** Non-sensitive feature switches. The receiver must read them while the app is not running. */
object SmsPrefs {
    private const val FILE = "arizo_sms_prefs"
    private fun p(c: Context) = c.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    fun sms(c: Context) = p(c).getBoolean("sms", false)
    fun push(c: Context) = p(c).getBoolean("push", false)
    fun packages(c: Context): Set<String> = p(c).getStringSet("packages", emptySet()) ?: emptySet()
    fun setSms(c: Context, on: Boolean) = p(c).edit().putBoolean("sms", on).apply()
    fun setPush(c: Context, on: Boolean, pkgs: Set<String>) = p(c).edit().putBoolean("push", on).putStringSet("packages", pkgs).apply()
}

/** Native pre-filter: OTP/2FA and promotions are dropped first; then only bank-like text passes. */
object SmsFilter {
    private val OTP = listOf(
        "رمز پویا", "رمزپویا", "رمز دوم", "رمزدوم", "یکبار مصرف", "یک بار مصرف", "رمز موقت", "کد تایید", "کد تأیید", "کدتایید",
        "کد احراز", "کد ورود", "کد امنیتی", "ورود به", "otp", "verification code", "2fa", "cvv", "one-time", "one time pass",
        "security code", "login code", "passcode",
    )
    private val SPAM = listOf("جایزه", "قرعه کشی", "تخفیف ویژه", "برنده", "promo", "prize", "winner")
    private val BANK = listOf(
        "برداشت", "واریز", "مانده", "موجودی", "خرید", "مبلغ", "انتقال", "پرداخت", "کسر", "debited", "credited", "debit", "credit",
        "balance", "purchase", "spent", "paid", "received", "withdrawal", "deposit", "transaction",
    )
    private val INVISIBLE = Regex("[\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\u0640\\uFEFF]")

    fun normalize(s: String): String = Normalizer.normalize(s, Normalizer.Form.NFC)
        .replace('ي', 'ی').replace('ى', 'ی').replace('ك', 'ک')
        .replace(INVISIBLE, "")
        .replace(Regex("\\s+"), " ")
        .lowercase()

    fun accept(raw: String): Boolean {
        if (raw.length > 2000) return false
        val s = normalize(raw)
        if (OTP.any { s.contains(it) } || SPAM.any { s.contains(it) }) return false
        return BANK.any { s.contains(it) } && s.any { it.isDigit() }
    }
}

/** Sealed queue on disk (noBackupFilesDir). Each item: sealed text + source, sender, time. */
object SmsQueue {
    private const val DIR = "sms_queue"
    private const val MAX_ITEMS = 2000
    private val rng = SecureRandom()

    private fun dir(c: Context) = File(c.noBackupFilesDir, DIR).apply { mkdirs() }

    fun seal(c: Context, text: String, source: String, sender: String, at: Long): Boolean {
        if (count(c) >= MAX_ITEMS) return false
        val plain = text.toByteArray(Charsets.UTF_8)
        return try {
            val sealed = ArizoSecurityPlugin.sealForQueue(plain)
            val id = ByteArray(12).also { rng.nextBytes(it) }.joinToString("") { "%02x".format(it) }
            val json = JSONObject()
                .put("id", id)
                .put("b64", Base64.encodeToString(sealed, Base64.NO_WRAP))
                .put("source", source)
                .put("sender", sender.take(120))
                .put("received_at", at)
            File(dir(c), "$id.json").writeText(json.toString())
            true
        } catch (e: Exception) {
            false // no vault yet (queue key missing): nothing is kept
        } finally {
            java.util.Arrays.fill(plain, 0)
        }
    }

    fun list(c: Context): List<JSObject> = dir(c).listFiles { f -> f.name.endsWith(".json") }.orEmpty().mapNotNull {
        runCatching { JSObject(it.readText()) }.getOrNull()
    }

    fun count(c: Context) = dir(c).listFiles { f -> f.name.endsWith(".json") }?.size ?: 0

    fun delete(c: Context, id: String) {
        if (id.matches(Regex("^[0-9a-f]{24}$"))) File(dir(c), "$id.json").delete()
    }

    fun clear(c: Context) {
        dir(c).listFiles()?.forEach { it.delete() }
    }
}

/** Privacy-safe capture notification: generic text only, never an amount (PROMPT.md §1.2). */
object CaptureNotifier {
    private const val CHANNEL = "arizo_capture"
    private const val ID = 7105

    fun notify(c: Context) {
        if (!NotificationManagerCompat.from(c).areNotificationsEnabled()) return
        val nm = c.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, c.getString(R.string.capture_channel), NotificationManager.IMPORTANCE_DEFAULT))
        }
        val open = android.app.PendingIntent.getActivity(
            c, 0, Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(c, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(c.getString(R.string.capture_title))
            .setContentText(c.getString(R.string.capture_text))
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(
                NotificationCompat.Builder(c, CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(c.getString(R.string.capture_title)).build(),
            )
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(c).notify(ID, n)
        } catch (e: SecurityException) {
            // POST_NOTIFICATIONS not granted: the message is still queued, just silently.
        }
    }
}

/** SMS_RECEIVED. Disabled as a component until the user turns SMS capture on. */
class BankSmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION || !SmsPrefs.sms(context)) return
        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        // Multipart messages arrive as several PDUs from the same sender.
        val bySender = LinkedHashMap<String, StringBuilder>()
        var at = System.currentTimeMillis()
        for (m in parts) {
            if (m == null) continue
            bySender.getOrPut(m.originatingAddress ?: "") { StringBuilder() }.append(m.messageBody ?: "")
            at = m.timestampMillis
        }
        var sealed = false
        for ((sender, body) in bySender) {
            val text = body.toString()
            if (SmsFilter.accept(text) && SmsQueue.seal(context, text, "sms_auto", sender, at)) sealed = true
        }
        if (sealed) CaptureNotifier.notify(context)
    }
}

/** Bank app alerts, strictly limited to the packages the user switched on. */
class BankNotificationListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val c = applicationContext
        if (!SmsPrefs.push(c) || sbn.packageName !in SmsPrefs.packages(c) || sbn.packageName == c.packageName) return
        val ex = sbn.notification?.extras ?: return
        val title = ex.getCharSequence(android.app.Notification.EXTRA_TITLE)?.toString().orEmpty()
        val text = (ex.getCharSequence(android.app.Notification.EXTRA_BIG_TEXT) ?: ex.getCharSequence(android.app.Notification.EXTRA_TEXT))?.toString().orEmpty()
        val full = if (title.isNotBlank()) "$title\n$text" else text
        // The bank app already showed its own alert, so no second notification here.
        if (SmsFilter.accept(full)) SmsQueue.seal(c, full, "notification_auto", sbn.packageName, sbn.postTime)
    }
}
