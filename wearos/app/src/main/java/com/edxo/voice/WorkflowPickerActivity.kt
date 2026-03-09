package com.edxo.voice

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import kotlin.concurrent.thread

/**
 * Displays a list of available workflows. The user picks one and it's
 * returned to the calling activity (MainActivity).
 */
class WorkflowPickerActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_WORKFLOW_ID = "workflow_id"
        const val EXTRA_WORKFLOW_NAME = "workflow_name"
    }

    private data class WorkflowItem(val id: Int, val name: String)

    private val workflows = mutableListOf<WorkflowItem>()
    private lateinit var listView: ListView
    private lateinit var progressBar: ProgressBar
    private lateinit var swipeRefresh: SwipeRefreshLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFF000000.toInt())
            setPadding(8, 16, 8, 8)
        }

        val title = TextView(this).apply {
            text = "Workflows"
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 14f
            gravity = Gravity.CENTER
        }
        root.addView(title, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ))

        progressBar = ProgressBar(this).apply { visibility = View.VISIBLE }
        root.addView(progressBar, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { gravity = Gravity.CENTER_HORIZONTAL; topMargin = 16 })

        listView = ListView(this).apply {
            visibility = View.GONE
            clipToPadding = false
            setPadding(0, 0, 0, 80)
            setOnItemClickListener { _, _, position, _ ->
                val item = workflows[position]
                setResult(Activity.RESULT_OK, Intent().apply {
                    putExtra(EXTRA_WORKFLOW_ID, item.id)
                    putExtra(EXTRA_WORKFLOW_NAME, item.name)
                })
                finish()
            }
        }

        swipeRefresh = SwipeRefreshLayout(this).apply {
            addView(listView)
            setOnRefreshListener { loadWorkflows() }
            visibility = View.GONE
        }
        root.addView(swipeRefresh, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            0, 1f
        ))

        setContentView(root)
        loadWorkflows()
    }

    private fun loadWorkflows() {
        val token = getSharedPreferences("edxo_voice", MODE_PRIVATE)
            .getString("auth_token", null)

        if (token.isNullOrEmpty()) {
            Toast.makeText(this, "Non connecte", Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        thread {
            try {
                val wsUrl = getSharedPreferences("edxo_voice", MODE_PRIVATE)
                    .getString("server_url", BuildConfig.BACKEND_WS_URL)
                    ?: BuildConfig.BACKEND_WS_URL
                val baseUrl = wsUrl
                    .replace("wss://", "https://")
                    .replace("ws://", "http://")
                    .replace("/api/voice-relay/ws", "")

                val request = Request.Builder()
                    .url("$baseUrl/api/voice-relay/workflows")
                    .header("Authorization", "Bearer $token")
                    .header("Cache-Control", "no-cache, no-store")
                    .header("Pragma", "no-cache")
                    .build()

                val response = OkHttpClient().newCall(request).execute()
                val body = response.body?.string() ?: "[]"

                if (!response.isSuccessful) {
                    if (response.code == 401 && TokenRefresher.refresh(this)) {
                        // Retry with new token
                        runOnUiThread { loadWorkflows() }
                        return@thread
                    }
                    runOnUiThread {
                        swipeRefresh.isRefreshing = false
                        Toast.makeText(this, "Erreur ${response.code}", Toast.LENGTH_SHORT).show()
                        finish()
                    }
                    return@thread
                }

                val arr = JSONArray(body)
                val items = (0 until arr.length()).map { i ->
                    val obj = arr.getJSONObject(i)
                    WorkflowItem(obj.getInt("id"), obj.getString("name"))
                }

                runOnUiThread {
                    workflows.clear()
                    workflows.addAll(items)
                    progressBar.visibility = View.GONE
                    swipeRefresh.visibility = View.VISIBLE
                    swipeRefresh.isRefreshing = false
                    listView.visibility = View.VISIBLE
                    listView.adapter = object : BaseAdapter() {
                        override fun getCount() = workflows.size
                        override fun getItem(p: Int) = workflows[p]
                        override fun getItemId(p: Int) = workflows[p].id.toLong()
                        override fun getView(p: Int, cv: View?, parent: ViewGroup?): View {
                            val tv = (cv as? TextView) ?: TextView(this@WorkflowPickerActivity).apply {
                                setTextColor(0xFFFFFFFF.toInt())
                                textSize = 13f
                                setPadding(16, 12, 16, 12)
                            }
                            tv.text = workflows[p].name
                            return tv
                        }
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    swipeRefresh.isRefreshing = false
                    Toast.makeText(this, e.message ?: "Erreur", Toast.LENGTH_SHORT).show()
                    finish()
                }
            }
        }
    }
}
