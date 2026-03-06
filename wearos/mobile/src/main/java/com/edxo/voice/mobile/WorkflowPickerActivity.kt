package com.edxo.voice.mobile

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
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import kotlin.concurrent.thread

class WorkflowPickerActivity : AppCompatActivity() {

    private data class WorkflowItem(val id: Int, val name: String)

    private val workflows = mutableListOf<WorkflowItem>()
    private lateinit var listView: ListView
    private lateinit var progressBar: ProgressBar

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFF0D1117.toInt())
            setPadding(32, 64, 32, 32)
        }

        val title = TextView(this).apply {
            text = "Workflows"
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 20f
            gravity = Gravity.CENTER
        }
        root.addView(title)

        progressBar = ProgressBar(this).apply { visibility = View.VISIBLE }
        root.addView(progressBar, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { gravity = Gravity.CENTER_HORIZONTAL; topMargin = 32 })

        listView = ListView(this).apply {
            visibility = View.GONE
            divider = null
            setOnItemClickListener { _, _, position, _ ->
                val item = workflows[position]
                setResult(Activity.RESULT_OK, Intent().apply {
                    putExtra("workflow_id", item.id)
                    putExtra("workflow_name", item.name)
                })
                finish()
            }
        }
        root.addView(listView, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f
        ))

        setContentView(root)
        loadWorkflows()
    }

    private fun loadWorkflows() {
        val token = getSharedPreferences("edxo_voice", MODE_PRIVATE).getString("auth_token", null)
        if (token.isNullOrEmpty()) {
            Toast.makeText(this, "Non connecte", Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        thread {
            try {
                val wsUrl = getSharedPreferences("edxo_voice", MODE_PRIVATE)
                    .getString("server_url", BuildConfig.BACKEND_WS_URL) ?: BuildConfig.BACKEND_WS_URL
                val baseUrl = wsUrl.replace("wss://", "https://").replace("ws://", "http://")
                    .replace("/api/voice-relay/ws", "")

                val request = Request.Builder()
                    .url("$baseUrl/api/voice-relay/workflows")
                    .header("Authorization", "Bearer $token")
                    .build()

                val response = OkHttpClient().newCall(request).execute()
                val body = response.body?.string() ?: "[]"

                if (!response.isSuccessful) {
                    runOnUiThread {
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
                    listView.visibility = View.VISIBLE
                    listView.adapter = object : BaseAdapter() {
                        override fun getCount() = workflows.size
                        override fun getItem(p: Int) = workflows[p]
                        override fun getItemId(p: Int) = workflows[p].id.toLong()
                        override fun getView(p: Int, cv: View?, parent: ViewGroup?): View {
                            val tv = (cv as? TextView) ?: TextView(this@WorkflowPickerActivity).apply {
                                setTextColor(0xFFFFFFFF.toInt())
                                textSize = 16f
                                setPadding(24, 20, 24, 20)
                            }
                            tv.text = workflows[p].name
                            return tv
                        }
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    Toast.makeText(this, e.message ?: "Erreur", Toast.LENGTH_SHORT).show()
                    finish()
                }
            }
        }
    }
}
