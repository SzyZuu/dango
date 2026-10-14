package com.serifpersia.dango

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.*
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

class NodeService : Service() {

    companion object {
        const val TAG = "DangoNode"
        const val CHANNEL_ID = "dango_node"
        const val NOTIFICATION_ID = 1
        const val NODE_PORT = 3000
        const val DANGO_PACKAGE = "@serifpersia/dango"
        const val ACTION_STOP = "com.serifpersia.dango.STOP"

        private const val SERVER_URL = "http://localhost:$NODE_PORT"
        private const val HEALTH_URL = "$SERVER_URL/api/health"
        private const val SHUTDOWN_URL = "$SERVER_URL/api/internal/shutdown"

        var isRunning = false
            private set
        var onStatusChange: ((Boolean) -> Unit)? = null
        var onLogLine: ((String) -> Unit)? = null

        fun start(context: Context) {
            context.startForegroundService(Intent(context, NodeService::class.java))
        }

        fun stop(context: Context) {
            try {
                context.startService(Intent(context, NodeService::class.java).apply {
                    action = ACTION_STOP
                })
            } catch (_: Exception) {
                try {
                    context.stopService(Intent(context, NodeService::class.java))
                } catch (_: Exception) {}
            }
        }
    }

    private var nodeProcess: Process? = null
    private var stopJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()

        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "dango:node_cpu_wakelock"
        ).apply {
            setReferenceCounted(false)
            acquire(24 * 60 * 60 * 1000L)
        }

        val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        wifiLock = wifiManager?.createWifiLock(
            WifiManager.WIFI_MODE_FULL_HIGH_PERF,
            "dango:node_wifi_lock"
        )?.apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                if (stopJob?.isActive != true) {
                    stopJob = scope.launch {
                        requestShutdown()
                        stopNode()
                        releaseLocks()
                        stopForeground(STOP_FOREGROUND_REMOVE)
                        stopSelf()
                    }
                }
                return START_NOT_STICKY
            }
            else -> {
                startForeground(NOTIFICATION_ID, buildNotification("Starting server..."))
                if (!isRunning) {
                    scope.launch { startDango() }
                }
            }
        }
        return START_STICKY
    }

    // The server flushes its sync snapshot on this endpoint, so every stop path
    // (activity, tray action) goes through here rather than killing node outright.
    private suspend fun requestShutdown() {
        updateNotification("Syncing and shutting down...")
        postShutdown()
        for (i in 1..20) {
            when (healthCode()) {
                null -> return
                503 -> {
                    awaitPortClosed(15000)
                    return
                }
            }
            delay(1000)
        }
        awaitPortClosed(5000)
    }

    private fun postShutdown() {
        var conn: HttpURLConnection? = null
        try {
            conn = URL(SHUTDOWN_URL).openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.connectTimeout = 3000
            conn.readTimeout = 3000
            conn.connect()
            try {
                conn.inputStream.use { it.readBytes() }
            } catch (_: Exception) {
            }
        } catch (_: Exception) {
        } finally {
            try {
                conn?.disconnect()
            } catch (_: Exception) {
            }
        }
    }

    private fun healthCode(): Int? {
        var conn: HttpURLConnection? = null
        return try {
            conn = URL(HEALTH_URL).openConnection() as HttpURLConnection
            conn.connectTimeout = 1500
            conn.readTimeout = 1500
            conn.connect()
            conn.responseCode
        } catch (_: Exception) {
            null
        } finally {
            try {
                conn?.disconnect()
            } catch (_: Exception) {
            }
        }
    }

    private suspend fun awaitPortClosed(timeoutMs: Long) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (healthCode() == null) return
            delay(500)
        }
    }

    private fun releaseLocks() {
        try {
            if (wakeLock?.isHeld == true) wakeLock?.release()
        } catch (_: Exception) {}
        try {
            if (wifiLock?.isHeld == true) wifiLock?.release()
        } catch (_: Exception) {}
    }

    override fun onDestroy() {
        stopNode()
        releaseLocks()
        stopForeground(STOP_FOREGROUND_REMOVE)
        scope.cancel()
        super.onDestroy()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
    }

    private fun startDango() {
        try {
            val payloadDir = File(filesDir, "payload")
            val dataDir = File(filesDir, "data")
            dataDir.mkdirs()

            val nativeLibDir = applicationInfo.nativeLibraryDir
            val nodeBin = File(nativeLibDir, "libnode.so")
            val libDir = File(payloadDir, "lib")
            val dangoDir = File(payloadDir, "lib/node_modules/$DANGO_PACKAGE")

            if (!dangoDir.exists()) {
                Log.e(TAG, "Dango not installed at ${dangoDir.absolutePath}")
                return
            }

            val orchestrator = File(dangoDir, "orchestrator.js")
            val serverJs = File(dangoDir, "server/dist/server.js")
            val entryPoint = if (serverJs.exists()) serverJs else orchestrator

            if (!entryPoint.exists()) {
                Log.e(TAG, "No entry point found at ${entryPoint.absolutePath}")
                return
            }

            Log.i(TAG, "Starting dango: ${entryPoint.absolutePath}")
            updateNotification("Starting dango server...")

            val args = mutableListOf(nodeBin.absolutePath, entryPoint.absolutePath)
            if (entryPoint.name == "orchestrator.js") {
                args.add("prod")
            }

            val pb = ProcessBuilder(args)
            pb.directory(dangoDir)
            pb.environment().apply {
                put("HOME", dataDir.absolutePath)
                put("PATH", "$nativeLibDir:${payloadDir.absolutePath}/bin:/system/bin")
                put("LD_LIBRARY_PATH", libDir.absolutePath)
                put("OPENSSL_CONF", File(payloadDir, "etc/tls/openssl.cnf").absolutePath)
                put("PORT", NODE_PORT.toString())
                put("PREFIX", payloadDir.absolutePath)
                put("npm_config_prefix", payloadDir.absolutePath)
                put("NODE_PATH", File(payloadDir, "lib/node_modules").absolutePath)
            }
            pb.redirectErrorStream(true)

            nodeProcess = pb.start()
            isRunning = true
            onStatusChange?.invoke(true)

            val reader = BufferedReader(InputStreamReader(nodeProcess!!.inputStream))
            while (nodeProcess?.isAlive == true) {
                val line = reader.readLine() ?: break
                Log.i(TAG, line)
                onLogLine?.invoke(line)
                if (line.contains("running at") || line.contains("Listening on")) {
                    updateNotification("dango running on port $NODE_PORT")
                }
            }

            val exitCode = nodeProcess?.waitFor() ?: -1
            Log.w(TAG, "Dango exited with code $exitCode")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start dango", e)
        } finally {
            isRunning = false
            onStatusChange?.invoke(false)
        }
    }

    fun stopNode() {
        nodeProcess?.let { proc ->
            try {
                proc.destroy()
                if (!proc.waitFor(5, TimeUnit.SECONDS)) {
                    proc.destroyForcibly()
                }
            } catch (_: Exception) {}
        }
        nodeProcess = null
        isRunning = false
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "dango server",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "dango server status"
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun buildNotification(text: String): Notification {
        val contentIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, NodeService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("dango")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_send)
            .setContentIntent(contentIntent)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopIntent)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(text: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, buildNotification(text))
    }
}
