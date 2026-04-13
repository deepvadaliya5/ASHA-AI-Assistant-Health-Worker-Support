/**
 * chat.js v4.0 — Hackathon Edition
 * Uses: triage scoring, follow-up questions, conversation memory,
 * image upload (vision), outbreak alerts, treatment plan
 */

import { getLang, toggleLang, applyLang } from "./lang.js";
import { startListening, stopListening, getIsListening, speak, stopSpeaking, isSpeaking, isVoiceSupported } from "./voice.js";
import { logEvent } from "./logger.js";
import { renderArticleCards, showMiningSkeleton, formatAIResponse } from "./mining.js";

// ─── DOM ──────────────────────────────────────────────────────────────────────
const chatMessages     = document.getElementById("chatMessages");
const chatInput        = document.getElementById("chatInput");
const sendBtn          = document.getElementById("sendBtn");
const voiceBtn         = document.getElementById("voiceBtn");
const langBtn          = document.getElementById("langToggleBtn");
const sourcesContainer = document.getElementById("sourcesContainer");
const patientInfoEl    = document.getElementById("patientInfo");
const feverAlertEl     = document.getElementById("feverAlert");
const triageEl         = document.getElementById("triagePanel");
const followupsEl      = document.getElementById("followupsPanel");

// ─── State ────────────────────────────────────────────────────────────────────
let symptoms = [];
let patientId = null;
let conversationHistory = []; // multi-turn memory
let isFetching = false;

// ─── Init from symptoms.html ──────────────────────────────────────────────────
function initFromState() {
  const stored = sessionStorage.getItem("asha_query_state");
  if (!stored) return;
  try {
    const state = JSON.parse(stored);
    symptoms  = state.symptoms  || [];
    patientId = state.patientId || null;
    if (patientInfoEl && (patientId || symptoms.length)) {
      patientInfoEl.innerHTML = `
        ${patientId ? `<div class="patient-id-badge">👤 ${patientId}</div>` : ""}
        ${symptoms.length ? `<div class="text-sm text-muted mt-2">Symptoms: ${symptoms.join(", ")}</div>` : ""}`;
    }
    if (state.query) {
      setTimeout(() => sendMessage(state.query), 400);
      sessionStorage.removeItem("asha_query_state");
    }
  } catch (e) { console.warn("State parse error:", e); }
}

// ─── Message Rendering ────────────────────────────────────────────────────────
function addMessage(role, content, isHTML = false) {
  const wrap = document.createElement("div");
  wrap.className = `message ${role}`;
  const av = document.createElement("div");
  av.className = "msg-avatar";
  av.textContent = role === "user" ? "👤" : "⚕️";
  const bub = document.createElement("div");
  bub.className = "msg-bubble";
  if (isHTML) bub.innerHTML = content; else bub.textContent = content;
  wrap.appendChild(av); wrap.appendChild(bub);
  chatMessages.appendChild(wrap);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return bub;
}

function addTypingIndicator() {
  const w = document.createElement("div");
  w.className = "message assistant"; w.id = "typingIndicator";
  w.innerHTML = `<div class="msg-avatar">⚕️</div><div class="msg-bubble"><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div>`;
  chatMessages.appendChild(w);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeTypingIndicator() { document.getElementById("typingIndicator")?.remove(); }

// ─── Triage Panel ─────────────────────────────────────────────────────────────
function renderTriage(triage) {
  if (!triageEl || !triage) return;
  const colors = { critical: "#c0392b", high: "#d68910", medium: "#1565c0", low: "#1a6b3c" };
  const bgs    = { critical: "#fdecea", high: "#fef9e7", medium: "#e3f2fd", low: "#e8f5ee" };
  const c = colors[triage.level] || colors.medium;
  const bg = bgs[triage.level] || bgs.medium;
  triageEl.innerHTML = `
    <div style="border:1.5px solid ${c}30;border-radius:10px;padding:12px;background:${bg};">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
        <div style="width:36px;height:36px;border-radius:50%;background:${c};color:white;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.8rem;flex-shrink:0;">${triage.score}</div>
        <div>
          <div style="font-weight:700;font-size:0.82rem;color:${c};text-transform:uppercase;">${triage.level} priority</div>
          <div style="font-size:0.75rem;color:var(--clr-text-2);">AI Triage Score</div>
        </div>
      </div>
      <div style="font-size:0.78rem;color:var(--clr-text-2);line-height:1.5;">${triage.reasoning || ""}</div>
    </div>`;
  triageEl.classList.remove("hidden");
}

// ─── Follow-up Questions ──────────────────────────────────────────────────────
function renderFollowups(questions) {
  if (!followupsEl || !questions?.length) return;
  followupsEl.innerHTML = `
    <div style="margin-bottom:8px;font-size:0.78rem;font-weight:600;color:var(--clr-text-2);text-transform:uppercase;letter-spacing:.5px;">Ask Next</div>
    ${questions.map(q => `
      <button class="followup-btn" onclick="window.sendQuickQuery(this.dataset.q)" data-q="${esc(q)}"
        style="display:block;width:100%;text-align:left;padding:7px 10px;margin-bottom:5px;border:1px solid var(--clr-border);border-radius:8px;background:var(--clr-surface-2);font-size:0.8rem;cursor:pointer;transition:all .15s;color:var(--clr-text);"
        onmouseover="this.style.borderColor='var(--clr-primary)';this.style.background='var(--clr-primary-lt)'"
        onmouseout="this.style.borderColor='var(--clr-border)';this.style.background='var(--clr-surface-2)'">
        💬 ${esc(q)}
      </button>`).join("")}`;
  followupsEl.classList.remove("hidden");
}

window.sendQuickQuery = (q) => { if (chatInput) { chatInput.value = q; sendMessage(q); } };

// ─── Core Send ────────────────────────────────────────────────────────────────
async function sendMessage(text) {
  const query = (text || chatInput?.value || "").trim();
  if (!query || isFetching) return;
  isFetching = true;
  if (chatInput) chatInput.value = "";
  if (sendBtn) sendBtn.disabled = true;

  addMessage("user", query);
  conversationHistory.push({ role: "user", content: query });
  logEvent("query_sent", { query, lang: getLang(), patientId });
  showMiningSkeleton(sourcesContainer, 3);
  addTypingIndicator();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query, symptoms,
        language: getLang(),
        patientId,
        history: conversationHistory.slice(-8), // send last 8 turns for memory
      }),
    });

    const rawText = await res.text();
    if (!rawText?.trim()) {
      if (res.status === 405) {
        throw new Error(
          "Server rejected POST (HTTP 405). Run the app with npm start and open http://localhost:3000 — do not use Live Server, file://, or another static host.",
        );
      }
      throw new Error(`Empty response (HTTP ${res.status}). Check the terminal running node server.js.`);
    }

    let data;
    try { data = JSON.parse(rawText); }
    catch { throw new Error("Server error: " + rawText.replace(/<[^>]*>/g," ").slice(0,200)); }

    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    removeTypingIndicator();

    if (data.blocked) {
      addMessage("assistant", data.response);
    } else {
      const html = formatAIResponse(data.response);
      addMessage("assistant", html, true);
      conversationHistory.push({ role: "assistant", content: data.response });

      renderArticleCards(data.articles, sourcesContainer, getLang());
      renderTriage(data.triage);
      renderFollowups(data.followups);

      if (data.feverAlert && feverAlertEl) {
        feverAlertEl.innerHTML = `<div class="alert alert-danger"><span class="alert-icon">🌡️</span><div>${data.feverAlert.message}</div></div>`;
        feverAlertEl.classList.remove("hidden");
      }
      logEvent("query_success", { query, articlesFound: data.articles?.length });
    }
  } catch (err) {
    removeTypingIndicator();
    addMessage("assistant", `❌ ${err.message}`);
    logEvent("query_error", { query, error: err.message });
    console.error("[Chat]", err);
  } finally {
    isFetching = false;
    if (sendBtn) sendBtn.disabled = false;
    chatInput?.focus();
  }
}

// ─── Image Upload (vision analysis) ───────────────────────────────────────────
function setupImageUpload() {
  const btn = document.getElementById("imageUploadBtn");
  const input = document.getElementById("imageFileInput");
  if (!btn || !input) return;

  btn.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      addMessage("assistant", "❌ Image too large. Please use an image under 4MB."); return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(",")[1];
      const mimeType = file.type || "image/jpeg";

      // Show preview
      addMessage("user", `📸 Analyzing image: ${file.name}`);
      addTypingIndicator();

      try {
        const res = await fetch("/api/analyze-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: base64, mimeType, symptoms, language: getLang() }),
        });
        const data = await res.json();
        removeTypingIndicator();
        if (data.error) throw new Error(data.error);

        let html = `<div style="font-size:0.82rem;">`;
        if (data.observations?.length) {
          html += `<div style="font-weight:700;margin-bottom:6px;color:var(--clr-primary);">📷 Image Observations</div>`;
          data.observations.forEach(o => { html += `<div style="margin-bottom:3px;">• ${esc(o)}</div>`; });
        }
        if (data.possibleConditions?.length) {
          html += `<div style="font-weight:700;margin:10px 0 6px;color:var(--clr-primary);">🩺 Possible Conditions</div>`;
          data.possibleConditions.forEach(c => {
            html += `<div style="margin-bottom:4px;"><strong>${esc(c.condition)}</strong> (${c.confidence}%) — ${esc(c.reasoning)}</div>`;
          });
        }
        if (data.immediateActions?.length) {
          html += `<div style="font-weight:700;margin:10px 0 6px;color:var(--clr-danger);">⚡ Immediate Actions</div>`;
          data.immediateActions.forEach((a, i) => { html += `<div>${i+1}. ${esc(a)}</div>`; });
        }
        if (data.doNotDo?.length) {
          html += `<div style="font-weight:700;margin:10px 0 6px;color:var(--clr-warning);">🚫 Do NOT Do</div>`;
          data.doNotDo.forEach(d => { html += `<div style="margin-bottom:3px;">• ${esc(d)}</div>`; });
        }
        if (data.disclaimer) html += `<div style="margin-top:10px;font-size:0.75rem;color:var(--clr-text-3);font-style:italic;">${esc(data.disclaimer)}</div>`;
        html += `</div>`;
        addMessage("assistant", html, true);
      } catch (e) { removeTypingIndicator(); addMessage("assistant", `❌ Image analysis: ${e.message}`); }
    };
    reader.readAsDataURL(file);
    input.value = "";
  });
}

// ─── Voice ────────────────────────────────────────────────────────────────────
function setupVoiceButton() {
  if (!voiceBtn) return;
  if (!isVoiceSupported()) { voiceBtn.disabled = true; voiceBtn.title = "Voice not supported in this browser"; return; }
  voiceBtn.addEventListener("click", () => {
    if (getIsListening()) {
      stopListening();
      voiceBtn.classList.remove("recording");
      voiceBtn.textContent = "🎤";
    } else {
      startListening(
        (transcript, isFinal) => {
          if (chatInput) chatInput.value = transcript;
          if (isFinal && transcript.trim()) {
            voiceBtn.classList.remove("recording"); voiceBtn.textContent = "🎤";
            sendMessage(transcript);
          }
        },
        (error) => { voiceBtn.classList.remove("recording"); voiceBtn.textContent = "🎤"; addMessage("assistant", `🎤 ${error}`); },
        () => { voiceBtn.classList.remove("recording"); voiceBtn.textContent = "🎤"; }
      );
      voiceBtn.classList.add("recording"); voiceBtn.textContent = "⏹";
    }
  });
}

// ─── Read Aloud ───────────────────────────────────────────────────────────────
document.getElementById("speakLastBtn")?.addEventListener("click", () => {
  const btn = document.getElementById("speakLastBtn");
  if (isSpeaking()) { stopSpeaking(); btn.textContent = "🔊 Read Aloud"; return; }
  const msgs = document.querySelectorAll(".message.assistant .msg-bubble");
  const last = msgs[msgs.length - 1];
  if (last) { speak(last.innerText, () => { btn.textContent = "🔊 Read Aloud"; }); btn.textContent = "⏹ Stop"; }
});

// ─── Treatment Plan ───────────────────────────────────────────────────────────
document.getElementById("treatmentPlanBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("treatmentPlanBtn");
  if (!symptoms.length && conversationHistory.length < 2) {
    addMessage("assistant", "Please describe symptoms first before generating a treatment plan."); return;
  }
  btn.disabled = true; btn.textContent = "⏳ Generating...";
  addTypingIndicator();
  try {
    const res = await fetch("/api/treatment-plan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symptoms, language: getLang(), patientId }),
    });
    const data = await res.json(); removeTypingIndicator();
    if (data.error) throw new Error(data.error);
    let html = `<div style="font-size:0.85rem;">
      <div style="font-weight:700;color:var(--clr-primary);margin-bottom:10px;">📋 5-Day Treatment Plan — ${esc(data.diagnosis||"")}</div>`;
    (data.homeCare||[]).forEach(day => {
      html += `<div style="border:1px solid var(--clr-border);border-radius:8px;padding:10px;margin-bottom:8px;">
        <div style="font-weight:600;margin-bottom:6px;color:var(--clr-primary);">${esc(day.day)}</div>
        ${(day.actions||[]).map(a=>`<div>• ${esc(a)}</div>`).join("")}
        ${day.medicines?.length ? `<div style="margin-top:4px;color:var(--clr-info);font-size:0.8rem;">💊 ${day.medicines.join(", ")}</div>` : ""}
        ${day.diet ? `<div style="margin-top:4px;color:var(--clr-primary);font-size:0.8rem;">🥗 ${esc(day.diet)}</div>` : ""}
      </div>`;
    });
    if (data.referralTriggers?.length) {
      html += `<div style="background:var(--clr-danger-lt);border-radius:8px;padding:10px;margin-bottom:8px;">
        <div style="font-weight:600;color:var(--clr-danger);margin-bottom:4px;">🚨 Refer IMMEDIATELY if:</div>
        ${data.referralTriggers.map(t=>`<div>• ${esc(t)}</div>`).join("")}</div>`;
    }
    if (data.followUpDate) html += `<div style="font-weight:500;margin-top:6px;">📅 ${esc(data.followUpDate)}</div>`;
    html += `</div>`;
    addMessage("assistant", html, true);
  } catch(e) { removeTypingIndicator(); addMessage("assistant", `❌ ${e.message}`); }
  finally { btn.disabled = false; btn.textContent = "📋 Treatment Plan"; }
});

// ─── Outbreak Check ───────────────────────────────────────────────────────────
document.getElementById("outbreakBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("outbreakBtn");
  btn.disabled = true; btn.textContent = "⏳ Scanning...";
  try {
    const res = await fetch("/api/outbreak-check");
    const data = await res.json();
    if (data.alerts?.length) {
      let html = `<div style="font-size:0.85rem;">`;
      data.alerts.forEach(a => {
        html += `<div class="alert alert-${a.riskLevel==="high"?"danger":"warning"}" style="margin-bottom:8px;">
          <span class="alert-icon">🦠</span>
          <div><strong>${esc(a.disease)}</strong> — ${a.affectedCount} cases<br>
          <span style="font-size:0.8rem;">${esc(a.action)}</span></div></div>`;
      });
      html += `<div style="font-size:0.8rem;color:var(--clr-text-2);">${esc(data.recommendation||"")}</div></div>`;
      addMessage("assistant", html, true);
    } else {
      addMessage("assistant", `✅ No outbreak clusters detected in your area. ${data.message || "Continue routine monitoring."}`);
    }
  } catch(e) { addMessage("assistant", `❌ Outbreak check: ${e.message}`); }
  finally { btn.disabled = false; btn.textContent = "🦠 Check Outbreak"; }
});

// ─── Lang / Input / Welcome ───────────────────────────────────────────────────
langBtn?.addEventListener("click", () => {
  const l = toggleLang();
  if (langBtn) langBtn.textContent = l === "hi" ? "English" : "हिंदी";
});

sendBtn?.addEventListener("click", () => sendMessage());
chatInput?.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
chatInput?.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
});

document.getElementById("clearChatBtn")?.addEventListener("click", () => {
  if (confirm("Clear chat history?")) {
    chatMessages.innerHTML = "";
    conversationHistory = [];
    if (triageEl)    { triageEl.innerHTML = "";    triageEl.classList.add("hidden"); }
    if (followupsEl) { followupsEl.innerHTML = ""; followupsEl.classList.add("hidden"); }
    if (sourcesContainer) sourcesContainer.innerHTML = `<p class="text-sm text-muted">No sources yet.</p>`;
  }
});

function showWelcomeMessage() {
  if (sessionStorage.getItem("asha_query_state")) return;
  const lang = getLang();
  addMessage("assistant", lang === "hi"
    ? "नमस्ते! मैं ASHA AI सहायक हूँ। रोगी के लक्षण बताएं — मैं तत्काल कार्रवाई, AI ट्राइज स्कोर, और अनुवर्ती प्रश्न प्रदान करूंगा।"
    : "Namaste! I'm ASHA AI v4.0. Describe symptoms for immediate actions, AI triage scoring, smart follow-up questions, and real-time research. You can also upload a photo 📸 for visual analysis.");
}

function esc(s="") { const d=document.createElement("div"); d.textContent=String(s); return d.innerHTML; }

document.addEventListener("DOMContentLoaded", () => {
  applyLang(getLang());
  if (langBtn) langBtn.textContent = getLang() === "hi" ? "English" : "हिंदी";
  setupVoiceButton();
  setupImageUpload();
  showWelcomeMessage();
  initFromState();
  chatInput?.focus();
});
