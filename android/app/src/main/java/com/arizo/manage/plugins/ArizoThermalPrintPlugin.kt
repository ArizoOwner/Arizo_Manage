package com.arizo.manage.plugins

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.content.Context
import android.os.Build
import android.util.Base64
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.OutputStream
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Optional ESC/POS thermal printing (58/80 mm). JS renders the receipt and builds the raster bytes
 * (src/core/print/escpos.ts); this plugin only moves bytes to the printer.
 *
 * - Off by default (SharedPreferences switch). BLUETOOTH_CONNECT (Android 12+) is requested only in
 *   setEnabled(true); older Android needs no runtime permission for bonded devices.
 * - Bluetooth: classic SPP (RFCOMM) to an already-paired printer chosen by address. No discovery/scan.
 * - Wi-Fi: raw TCP (usually port 9100) to a private LAN IPv4 address only (10/8, 172.16/12, 192.168/16,
 *   169.254/16). Hostnames are refused, so no DNS lookup can happen. This is the only socket the app opens,
 *   and it is opened from native code only; the WebView firewall stays untouched.
 * - Job bytes are never logged or written to disk.
 */
@CapacitorPlugin(
    name = "ArizoThermalPrint",
    permissions = [Permission(alias = "bt", strings = [Manifest.permission.BLUETOOTH_CONNECT])],
)
class ArizoThermalPrintPlugin : Plugin() {
    private val io = Executors.newSingleThreadExecutor()
    private val prefs by lazy { context.getSharedPreferences("arizo_thermal", Context.MODE_PRIVATE) }

    private fun needsBtPermission() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    private fun btGranted() = !needsBtPermission() || getPermissionState("bt") == PermissionState.GRANTED

    @SuppressLint("MissingPermission")
    private fun statusObj(): JSObject {
        val enabled = prefs.getBoolean("enabled", false)
        val bonded = JSArray()
        if (enabled && btGranted()) {
            val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
            runCatching { adapter?.bondedDevices }.getOrNull()?.forEach { d ->
                bonded.put(JSObject().put("name", runCatching { d.name }.getOrNull() ?: "").put("address", d.address))
            }
        }
        return JSObject().put("enabled", enabled).put("bluetoothPermission", btGranted()).put("bonded", bonded)
    }

    @PluginMethod
    fun status(call: PluginCall) = call.resolve(statusObj())

    @PluginMethod
    fun setEnabled(call: PluginCall) {
        val on = call.getBoolean("enabled") ?: false
        prefs.edit().putBoolean("enabled", on).apply()
        if (on && !btGranted()) requestPermissionForAlias("bt", call, "btPermsCallback") else call.resolve(statusObj())
    }

    @PermissionCallback
    private fun btPermsCallback(call: PluginCall) = call.resolve(statusObj())

    private fun bytesOf(call: PluginCall): ByteArray? {
        val b64 = call.getString("b64") ?: return null
        val bytes = runCatching { Base64.decode(b64, Base64.NO_WRAP) }.getOrNull() ?: return null
        return if (bytes.isEmpty() || bytes.size > MAX_JOB) null else bytes
    }

    private fun send(call: PluginCall, open: () -> Pair<OutputStream, AutoCloseable>) {
        if (!prefs.getBoolean("enabled", false)) return call.reject("Thermal printing is off", "DISABLED")
        val bytes = bytesOf(call) ?: return call.reject("Invalid print job", "BAD_JOB")
        io.execute {
            try {
                val (out, closer) = open()
                closer.use {
                    var i = 0
                    while (i < bytes.size) {
                        val n = minOf(CHUNK, bytes.size - i)
                        out.write(bytes, i, n)
                        out.flush()
                        i += n
                    }
                }
                call.resolve()
            } catch (e: SecurityException) {
                call.reject("Bluetooth permission missing", "NO_PERMISSION")
            } catch (e: Exception) {
                // Never echo the exception message: it can contain the address.
                call.reject("Printer unreachable", "UNREACHABLE")
            }
        }
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    fun printBluetooth(call: PluginCall) {
        val address = call.getString("address") ?: return call.reject("No printer", "BAD_TARGET")
        if (!ADDRESS.matches(address)) return call.reject("No printer", "BAD_TARGET")
        if (!btGranted()) return call.reject("Bluetooth permission missing", "NO_PERMISSION")
        send(call) {
            val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
            val device = adapter.bondedDevices.firstOrNull { it.address == address } ?: throw IllegalStateException("not bonded")
            adapter.cancelDiscovery()
            val socket = device.createRfcommSocketToServiceRecord(SPP)
            socket.connect()
            socket.outputStream to socket
        }
    }

    @PluginMethod
    fun printTcp(call: PluginCall) {
        val host = call.getString("host") ?: return call.reject("Bad address", "BAD_TARGET")
        val port = call.getInt("port") ?: 9100
        val ip = privateLanIp(host) ?: return call.reject("Only local-network printers are allowed", "NOT_LAN")
        if (port !in 1..65535) return call.reject("Bad port", "BAD_TARGET")
        send(call) {
            val socket = Socket()
            socket.connect(InetSocketAddress(ip, port), 4000)
            socket.soTimeout = 8000
            socket.getOutputStream() to socket
        }
    }

    companion object {
        private const val MAX_JOB = 4 * 1024 * 1024
        private const val CHUNK = 4096
        private val SPP: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
        private val ADDRESS = Regex("^[0-9A-F]{2}(:[0-9A-F]{2}){5}$")
        private val DOTTED = Regex("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$")

        /** A literal private IPv4 (no DNS), or null. Mirrors isPrivateLanIp in src/core/print/deliver.ts. */
        fun privateLanIp(host: String): InetAddress? {
            val m = DOTTED.matchEntire(host.trim()) ?: return null
            val o = m.groupValues.drop(1).map { it.toInt() }
            if (o.any { it > 255 }) return null
            val (a, b) = o[0] to o[1]
            val lan = a == 10 || (a == 172 && b in 16..31) || (a == 192 && b == 168) || (a == 169 && b == 254)
            if (!lan) return null
            return Inet4Address.getByAddress(o.map { it.toByte() }.toByteArray())
        }
    }
}
