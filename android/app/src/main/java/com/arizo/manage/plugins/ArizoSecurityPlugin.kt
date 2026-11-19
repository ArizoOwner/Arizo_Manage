package com.arizo.manage.plugins

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.arizo.manage.MainActivity
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.spec.MGF1ParameterSpec
import java.util.Arrays
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

/**
 * Android key management (PROMPT.md §5.1, §5.2).
 *
 * Vault DEK: 32 random bytes, stored only as ciphertext, in up to two slots:
 *   1. PIN slot — AES-GCM(KEK_pin, DEK); KEK_pin = Argon2id(PIN), computed in the JS crypto worker.
 *   2. Bio slot — AES-GCM(KS_bio, DEK); KS_bio is a Keystore AES key (StrongBox when present) that
 *                 needs BIOMETRIC_STRONG for every use and is invalidated by a new biometric enrolment.
 * The unwrapped DEK lives only in native memory: ArizoSqlCipherPlugin takes it and zeroizes it.
 * JS never sees DEK bytes.
 *
 * Pending SMS queue: an RSA-OAEP keypair in the Keystore. Receivers seal with the public key while
 * the app is locked or killed (hybrid: random AES-256-GCM key wrapped by RSA). Opening needs the
 * private key, and openQueueItem refuses unless the vault is unlocked.
 */
@CapacitorPlugin(name = "ArizoSecurity")
class ArizoSecurityPlugin : Plugin() {

    companion object {
        private const val KS = "AndroidKeyStore"
        private const val BIO_ALIAS = "arizo.bio.v1"
        private const val QUEUE_ALIAS = "arizo.queue.v1"
        private const val VAULT_DIR = "vault_meta"
        private const val CLIP_CLEAR_MS = 45_000L
        private const val CLIP_LABEL = "arizo"

        private val lockObj = Any()
        @Volatile private var dekForDb: ByteArray? = null
        @Volatile private var dekForBio: ByteArray? = null
        @Volatile var unlocked: Boolean = false
            private set

        /** ArizoSqlCipherPlugin takes ownership (and must zeroize) the DEK. One-shot. */
        fun takeDek(): ByteArray? = synchronized(lockObj) { dekForDb.also { dekForDb = null } }

        internal fun setDek(dek: ByteArray) = synchronized(lockObj) {
            dekForDb?.let { Arrays.fill(it, 0) }
            dekForBio?.let { Arrays.fill(it, 0) }
            dekForDb = dek
            dekForBio = null // only verifyKek(forBiometric) creates the enrolment copy, on demand
            unlocked = true
        }

        internal fun takeDekForBio(): ByteArray? = synchronized(lockObj) { dekForBio.also { dekForBio = null } }

        internal fun lockNow() = synchronized(lockObj) {
            dekForDb?.let { Arrays.fill(it, 0) }
            dekForBio?.let { Arrays.fill(it, 0) }
            dekForDb = null
            dekForBio = null
            unlocked = false
        }

        /** For SMS receivers (Phase 5): seal a payload with the queue public key. Needs no DEK. */
        fun sealForQueue(plain: ByteArray): ByteArray {
            val ks = KeyStore.getInstance(KS).apply { load(null) }
            val pub = ks.getCertificate(QUEUE_ALIAS)?.publicKey ?: throw IllegalStateException("queue key missing")
            val aes = ByteArray(32).also { SecureRandom().nextBytes(it) }
            try {
                val rsa = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding")
                rsa.init(Cipher.ENCRYPT_MODE, pub, oaep())
                val wrapped = rsa.doFinal(aes)
                val gcm = Cipher.getInstance("AES/GCM/NoPadding")
                gcm.init(Cipher.ENCRYPT_MODE, SecretKeySpec(aes, "AES"))
                val ct = gcm.doFinal(plain)
                // [2-byte wrapped length][wrapped AES key][12-byte iv][ciphertext||tag]
                return byteArrayOf((wrapped.size shr 8).toByte(), wrapped.size.toByte()) + wrapped + gcm.iv + ct
            } finally {
                Arrays.fill(aes, 0)
            }
        }

        // AndroidKeyStore supports MGF1-SHA1 for the OAEP mask; the OAEP digest itself is SHA-256.
        private fun oaep() = OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT)
    }

    private val rng = SecureRandom()
    private val main = Handler(Looper.getMainLooper())
    private var clipClear: Runnable? = null

    private fun metaDir() = File(context.filesDir, VAULT_DIR).apply { mkdirs() }
    private fun metaFile(name: String) = File(metaDir(), name)
    private fun unb64(s: String): ByteArray = Base64.decode(s, Base64.NO_WRAP)

    // ---- AES-GCM over raw keys (PIN slot); same layout as the web keyring: iv(12) || ct||tag ----

    private fun gcmSeal(key: ByteArray, plain: ByteArray, aad: ByteArray): ByteArray {
        val iv = ByteArray(12).also { rng.nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        c.updateAAD(aad)
        return iv + c.doFinal(plain)
    }

    private fun gcmOpen(key: ByteArray, sealed: ByteArray, aad: ByteArray): ByteArray {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, sealed, 0, 12))
        c.updateAAD(aad)
        return c.doFinal(sealed, 12, sealed.size - 12)
    }

    private fun slotAad(vaultId: String) = "arizo/slot/v1|$vaultId".toByteArray()

    // ---- Keystore keys ----

    private fun keyStore(): KeyStore = KeyStore.getInstance(KS).apply { load(null) }

    private fun generateBioKey(strongBox: Boolean): SecretKey {
        val b = KeyGenParameterSpec.Builder(BIO_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) b.setIsStrongBoxBacked(true)
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KS).apply { init(b.build()) }.generateKey()
    }

    /** StrongBox first; fall back to the TEE when the device has no StrongBox. */
    private fun createBioKey(): SecretKey = try {
        generateBioKey(strongBox = true)
    } catch (e: Exception) {
        generateBioKey(strongBox = false)
    }

    private fun ensureQueueKey() {
        if (keyStore().containsAlias(QUEUE_ALIAS)) return
        val spec = KeyGenParameterSpec.Builder(QUEUE_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(2048)
            .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA1)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
            .build()
        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, KS).apply { initialize(spec) }.generateKeyPair()
    }

    private fun dropBioSlot() {
        runCatching { keyStore().deleteEntry(BIO_ALIAS) }
        metaFile("bio.slot").delete()
    }

    // ---- Plugin API ----

    @PluginMethod
    fun status(call: PluginCall) {
        val bm = BiometricManager.from(context)
        val strongBox = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
            context.packageManager.hasSystemFeature("android.hardware.strongbox_keystore")
        call.resolve(JSObject().apply {
            put("biometricAvailable", bm.canAuthenticate(BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS)
            put("biometricEnrolled", metaFile("bio.slot").exists() && keyStore().containsAlias(BIO_ALIAS))
            put("strongBox", strongBox)
            put("vaultInitialized", metaFile("pin.slot").exists())
            put("unlocked", unlocked)
        })
    }

    /** First run: fresh DEK, wrapped by the PIN-derived KEK (kekB64, 32 bytes) for vaultId. */
    @PluginMethod
    fun createVault(call: PluginCall) {
        val kek = call.getString("kekB64")?.let(::unb64)
        val vaultId = call.getString("vaultId")
        if (kek == null || kek.size != 32 || vaultId.isNullOrBlank()) {
            kek?.let { Arrays.fill(it, 0) }
            return call.reject("bad args", "BAD_ARGS")
        }
        if (metaFile("pin.slot").exists()) {
            Arrays.fill(kek, 0)
            return call.reject("vault exists", "VAULT_EXISTS")
        }
        val dek = ByteArray(32).also { rng.nextBytes(it) }
        try {
            metaFile("pin.slot").writeBytes(gcmSeal(kek, dek, slotAad(vaultId)))
            metaFile("vault.id").writeText(vaultId)
            ensureQueueKey()
            setDek(dek.copyOf())
            call.resolve(JSObject().put("vaultId", vaultId))
        } catch (e: Exception) {
            call.reject("create failed", "CREATE_FAILED")
        } finally {
            Arrays.fill(dek, 0)
            Arrays.fill(kek, 0)
        }
    }

    /** PIN unlock: kekB64 = Argon2id(PIN) from the JS worker. Rejects BAD_PIN. */
    @PluginMethod
    fun unlockWithKek(call: PluginCall) {
        val kek = call.getString("kekB64")?.let(::unb64) ?: return call.reject("bad args", "BAD_ARGS")
        try {
            val vaultId = metaFile("vault.id").readText()
            setDek(gcmOpen(kek, metaFile("pin.slot").readBytes(), slotAad(vaultId)))
            call.resolve(JSObject().put("vaultId", vaultId))
        } catch (e: AEADBadTagException) {
            call.reject("bad pin", "BAD_PIN")
        } catch (e: Exception) {
            call.reject("unlock failed", "UNLOCK_FAILED")
        } finally {
            Arrays.fill(kek, 0)
        }
    }

    /**
     * Re-authentication while the vault is already open: checks the PIN KEK without touching the
     * open database. For biometric enrolment it refreshes the one-shot copy enableBiometric needs.
     */
    @PluginMethod
    fun verifyKek(call: PluginCall) {
        val kek = call.getString("kekB64")?.let(::unb64) ?: return call.reject("bad args", "BAD_ARGS")
        val forBio = call.getBoolean("forBiometric") ?: false
        var dek: ByteArray? = null
        try {
            dek = gcmOpen(kek, metaFile("pin.slot").readBytes(), slotAad(metaFile("vault.id").readText()))
            if (forBio) synchronized(lockObj) {
                dekForBio?.let { Arrays.fill(it, 0) }
                dekForBio = dek.copyOf()
            }
            call.resolve()
        } catch (e: AEADBadTagException) {
            call.reject("bad pin", "BAD_PIN")
        } catch (e: Exception) {
            call.reject("verify failed", "VERIFY_FAILED")
        } finally {
            dek?.let { Arrays.fill(it, 0) }
            Arrays.fill(kek, 0)
        }
    }

    /** Wrap the just-unlocked DEK under a biometric-bound Keystore key. Call right after an unlock. */
    @PluginMethod
    fun enableBiometric(call: PluginCall) {
        val dek = takeDekForBio() ?: return call.reject("unlock first", "LOCKED")
        dropBioSlot()
        val cipher = try {
            Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, createBioKey()) }
        } catch (e: Exception) {
            Arrays.fill(dek, 0)
            return call.reject("keystore unavailable", "KEYSTORE")
        }
        prompt(call, cipher, "فعال‌سازی ورود با اثر انگشت", onDone = { Arrays.fill(dek, 0) }) { c ->
            metaFile("bio.slot").writeBytes(c.iv + c.doFinal(dek))
            call.resolve()
        }
    }

    /** Biometric unlock. A new enrolment invalidates the key: rejects BIO_INVALIDATED, and the UI falls back to PIN. */
    @PluginMethod
    fun unlockWithBiometric(call: PluginCall) {
        val slotFile = metaFile("bio.slot")
        val key = keyStore().getKey(BIO_ALIAS, null) as? SecretKey
        if (!slotFile.exists() || key == null) return call.reject("not enrolled", "BIO_NOT_ENROLLED")
        val slot = slotFile.readBytes()
        val cipher = try {
            Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, slot, 0, 12)) }
        } catch (e: KeyPermanentlyInvalidatedException) {
            dropBioSlot()
            return call.reject("biometrics changed", "BIO_INVALIDATED")
        }
        prompt(call, cipher, "باز کردن گاوصندوق آریزو") { c ->
            setDek(c.doFinal(slot, 12, slot.size - 12))
            call.resolve(JSObject().put("vaultId", metaFile("vault.id").readText()))
        }
    }

    /** PIN change: re-wrap the DEK from the old KEK to the new KEK, atomically on disk. */
    @PluginMethod
    fun rewrapPin(call: PluginCall) {
        val oldK = call.getString("oldKekB64")?.let(::unb64)
        val newK = call.getString("newKekB64")?.let(::unb64)
        if (oldK == null || newK == null) {
            oldK?.let { Arrays.fill(it, 0) }
            newK?.let { Arrays.fill(it, 0) }
            return call.reject("bad args", "BAD_ARGS")
        }
        var dek: ByteArray? = null
        try {
            val vaultId = metaFile("vault.id").readText()
            dek = gcmOpen(oldK, metaFile("pin.slot").readBytes(), slotAad(vaultId))
            val tmp = metaFile("pin.slot.tmp")
            tmp.writeBytes(gcmSeal(newK, dek, slotAad(vaultId)))
            if (!tmp.renameTo(metaFile("pin.slot"))) throw IllegalStateException("rename failed")
            call.resolve()
        } catch (e: AEADBadTagException) {
            call.reject("bad pin", "BAD_PIN")
        } catch (e: Exception) {
            call.reject("rewrap failed", "REWRAP_FAILED")
        } finally {
            dek?.let { Arrays.fill(it, 0) }
            Arrays.fill(oldK, 0)
            Arrays.fill(newK, 0)
        }
    }

    /** Drop key material from memory. SQLCipher closes through its own plugin. */
    @PluginMethod
    fun lock(call: PluginCall) {
        lockNow()
        call.resolve()
    }

    /** Wipe All Data: destroy every wrapped key, so the encrypted database is unreadable forever. */
    @PluginMethod
    fun destroyVault(call: PluginCall) {
        lockNow()
        dropBioSlot()
        runCatching { keyStore().deleteEntry(QUEUE_ALIAS) }
        metaDir().listFiles()?.forEach { it.delete() }
        call.resolve()
    }

    /** Open one sealed queue item. Refuses while locked. */
    @PluginMethod
    fun openQueueItem(call: PluginCall) {
        if (!unlocked) return call.reject("locked", "LOCKED")
        val sealed = call.getString("b64")?.let(::unb64) ?: return call.reject("bad args", "BAD_ARGS")
        var aes: ByteArray? = null
        try {
            val len = ((sealed[0].toInt() and 0xff) shl 8) or (sealed[1].toInt() and 0xff)
            val priv = keyStore().getKey(QUEUE_ALIAS, null) as PrivateKey
            val rsa = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding").apply { init(Cipher.DECRYPT_MODE, priv, oaep()) }
            aes = rsa.doFinal(sealed, 2, len)
            val off = 2 + len
            val gcm = Cipher.getInstance("AES/GCM/NoPadding")
            gcm.init(Cipher.DECRYPT_MODE, SecretKeySpec(aes, "AES"), GCMParameterSpec(128, sealed, off, 12))
            val plain = gcm.doFinal(sealed, off + 12, sealed.size - off - 12)
            call.resolve(JSObject().put("text", String(plain, Charsets.UTF_8)))
            Arrays.fill(plain, 0)
        } catch (e: Exception) {
            call.reject("queue item unreadable", "QUEUE_BAD")
        } finally {
            aes?.let { Arrays.fill(it, 0) }
        }
    }

    /** Copy card/Sheba flagged EXTRA_IS_SENSITIVE (hidden from clipboard previews); auto-clear after 45 s. */
    @PluginMethod
    fun copySensitive(call: PluginCall) {
        val text = call.getString("text") ?: return call.reject("bad args", "BAD_ARGS")
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = ClipData.newPlainText(CLIP_LABEL, text)
        clip.description.extras = PersistableBundle().apply {
            putBoolean(if (Build.VERSION.SDK_INT >= 33) ClipDescription.EXTRA_IS_SENSITIVE else "android.content.extra.IS_SENSITIVE", true)
        }
        cm.setPrimaryClip(clip)
        clipClear?.let(main::removeCallbacks)
        clipClear = Runnable {
            val current = cm.primaryClip ?: return@Runnable
            if (current.description.label == CLIP_LABEL) {
                if (Build.VERSION.SDK_INT >= 28) cm.clearPrimaryClip() else cm.setPrimaryClip(ClipData.newPlainText("", ""))
            }
        }.also { main.postDelayed(it, CLIP_CLEAR_MS) }
        call.resolve()
    }

    /** FLAG_SECURE control: allowForMs > 0 lifts it temporarily (max 2 minutes), then it returns. */
    @PluginMethod
    fun setScreenshotAllowed(call: PluginCall) {
        val ms = (call.getInt("allowForMs") ?: 0).coerceIn(0, 120_000)
        val act = activity as? MainActivity ?: return call.reject("no activity", "NO_ACTIVITY")
        act.setSecureFlag(ms == 0)
        if (ms > 0) main.postDelayed({ act.setSecureFlag(true) }, ms.toLong())
        call.resolve()
    }

    private fun prompt(call: PluginCall, cipher: Cipher, title: String, onDone: () -> Unit = {}, onOk: (Cipher) -> Unit) {
        val act = activity as? FragmentActivity ?: run {
            onDone()
            return call.reject("no activity", "NO_ACTIVITY")
        }
        act.runOnUiThread {
            val cb = object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    try {
                        val c = result.cryptoObject?.cipher ?: throw IllegalStateException("no cipher")
                        onOk(c)
                    } catch (e: Exception) {
                        call.reject("biometric crypto failed", "BIO_FAILED")
                    } finally {
                        onDone()
                    }
                }

                override fun onAuthenticationError(code: Int, msg: CharSequence) {
                    onDone()
                    val cancelled = code == BiometricPrompt.ERROR_USER_CANCELED ||
                        code == BiometricPrompt.ERROR_NEGATIVE_BUTTON || code == BiometricPrompt.ERROR_CANCELED
                    call.reject(if (cancelled) "cancelled" else "biometric error", if (cancelled) "BIO_CANCELLED" else "BIO_ERROR")
                }
            }
            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setNegativeButtonText("استفاده از رمز")
                .setAllowedAuthenticators(BIOMETRIC_STRONG)
                .setConfirmationRequired(false)
                .build()
            BiometricPrompt(act, ContextCompat.getMainExecutor(act), cb).authenticate(info, BiometricPrompt.CryptoObject(cipher))
        }
    }
}
