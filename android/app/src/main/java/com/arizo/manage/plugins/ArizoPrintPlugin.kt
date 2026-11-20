package com.arizo.manage.plugins

import android.content.Context
import android.print.PrintAttributes
import android.print.PrintManager
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Native printing of the current WebView document through Android's PrintManager
 * (system print dialog, Mopria / vendor print services, "Save as PDF").
 *
 * The page is already showing the invoice/receipt/statement; its `@media print` stylesheet hides the
 * app and `@page` sets the paper. Chromium's WebView print adapter lays it out as vector pages, and
 * Persian is shaped by the WebView's own HarfBuzz text stack, so glyphs and ligatures stay crisp.
 * No file is written by this plugin and nothing leaves the device except through the print service
 * the user picks.
 */
@CapacitorPlugin(name = "ArizoPrint")
class ArizoPrintPlugin : Plugin() {

    @PluginMethod
    fun print(call: PluginCall) {
        val jobName = (call.getString("jobName") ?: "Arizo").replace(Regex("[^\\p{L}\\p{N}._-]"), "_").take(80)
        activity.runOnUiThread {
            val pm = activity.getSystemService(Context.PRINT_SERVICE) as? PrintManager
            if (pm == null) {
                call.resolve(JSObject().put("state", "unavailable"))
                return@runOnUiThread
            }
            val adapter = bridge.webView.createPrintDocumentAdapter(jobName)
            val attrs = PrintAttributes.Builder()
                .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                .setMinMargins(PrintAttributes.Margins.NO_MARGINS) // margins come from the CSS @page rule
                .build()
            pm.print(jobName, adapter, attrs)
            // The dialog is asynchronous; the job's later state belongs to the print service.
            call.resolve(JSObject().put("state", "started"))
        }
    }
}
