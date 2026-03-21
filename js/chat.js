/**
 * chat.js — Main Chat Controller for ASHA AI (v2.1 patched)
 */

import { getLang, toggleLang, applyLang, t } from "./lang.js";
import { startListening, stopListening, getIsListening, speak, isVoiceSupported } from "./voice.js";
import { logEvent } from "./logger.js";
import { renderArticleCards, showMiningSkeleton, formatAIResponse } from "./mining.js";

// ─── DOM References ───────────────────────────────────────────────────────────
const chatMessages     = document.getElementById("chatMessages");
const chatInput        = document.getElementById("chatInput");
const sendBtn          = document.getElementById("sendBtn");
const voiceBtn         = document.getElementById("voiceBtn");
const langBtn          = document.getElementById("langToggleBtn");
const sourcesContainer = document.getElementById("sourcesContainer");
const patientInfoEl    = document.getElementById("patientInfo");
const feverAlertEl     = document.getElementById("feverAlert");

// ─── Session State ────────────────────────────────────────────────────────────
let symptoms = [];
let patientId = null;
let conversationHistory = [];
let isFetching = false;

// ─── Init from symptoms.html state ───────────────────────────────────────────
function initFromState() {
  const stored = sessionStorage.getItem("asha_query_state");
  if (!stored) return;
  try {
    const state = JSON.parse(stored);
    symptoms  = state.symptoms  || [];
    patientId = state.patientId || null;

    if (patientId && patientInfoEl) {
      patientInfoEl.innerHTML = `
        <div class="patient-id-badge">👤 ${patientId}</div>
        ${symptoms.length ? `<div class="text-sm text-muted mt-2">Symptoms: ${symptoms.join(", ")}</div>` : ""}`;
    }

    if (state.query) {
      setTimeout(() => sendMessage(state.query), 400);
      sessionStorage.removeItem("asha_query_state");
    }
  } catch (e) {
    console.warn("Could not parse query state:", e);
  }
}

// ─── Message Rendering ────────────────────────────────────────────────────────
function addMessage(role, content, isHTML = false) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = role === "user" ? "👤" : "⚕️";

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  if (isHTML) {
    bubble.innerHTML = content;
  } else {
    bubble.textContent = content;
  }

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  chatMessages.appendChild(wrapper);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return bubble;
}

function addTypingIndicator() {
  const wrapper = document.createElement("div");
  wrapper.className = "message assistant";
  wrapper.id = "typingIndicator";
  wrapper.innerHTML = `
    <div class="msg-avatar">⚕️</div>
    <div class="msg-bubble">
      <div class="typing-dots">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>`;
  chatMessages.appendChild(wrapper);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeTypingIndicator() {
  document.getElementById("typingIndicator")?.remove();
}

// ─── Core Send Message ────────────────────────────────────────────────────────
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
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        symptoms,
        language: getLang(),
        patientId,
      }),
    });

    // Read raw text FIRST — prevents "Unexpected end of JSON" masking the real error
    const rawText = await response.text();

    if (!rawText || !rawText.trim()) {
      throw new Error(`Server returned empty body (HTTP ${response.status}). Check your terminal for the error.`);
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      // Server sent HTML error page or plain text — strip tags and show it
      const preview = rawText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
      throw new Error(`Server error: ${preview}`);
    }

    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    removeTypingIndicator();

    if (data.blocked) {
      addMessage("assistant", data.response);
    } else {
      const formattedHTML = formatAIResponse(data.response);
      addMessage("assistant", formattedHTML, true);
      conversationHistory.push({ role: "assistant", content: data.response });

      renderArticleCards(data.articles, sourcesContainer, getLang());

      if (data.feverAlert && feverAlertEl) {
        feverAlertEl.innerHTML = `
          <div class="alert alert-danger">
            <span class="alert-icon">🌡️</span>
            <div>${data.feverAlert.message}</div>
          </div>`;
        feverAlertEl.classList.remove("hidden");
      }

      logEvent("query_success", { query, articlesFound: data.articles?.length });
    }

  } catch (err) {
    removeTypingIndicator();
    addMessage("assistant", `❌ ${err.message}`);
    logEvent("query_error", { query, error: err.message });
    console.error("[Chat Error]", err);
  } finally {
    isFetching = false;
    if (sendBtn) sendBtn.disabled = false;
    chatInput?.focus();
  }
}

// ─── Voice Button ─────────────────────────────────────────────────────────────
function setupVoiceButton() {
  if (!voiceBtn) return;

  if (!isVoiceSupported()) {
    voiceBtn.disabled = true;
    voiceBtn.title = "Voice not supported in this browser";
    return;
  }

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
            voiceBtn.classList.remove("recording");
            voiceBtn.textContent = "🎤";
            sendMessage(transcript);
          }
        },
        (error) => {
          voiceBtn.classList.remove("recording");
          voiceBtn.textContent = "🎤";
          addMessage("assistant", `🎤 ${error}`);
        },
        () => {
          voiceBtn.classList.remove("recording");
          voiceBtn.textContent = "🎤";
        }
      );
      voiceBtn.classList.add("recording");
      voiceBtn.textContent = "⏹";
    }
  });
}

// ─── Language Toggle ──────────────────────────────────────────────────────────
function setupLangButton() {
  if (!langBtn) return;
  langBtn.addEventListener("click", () => {
    const newLang = toggleLang();
    langBtn.textContent = newLang === "hi" ? "English" : "हिंदी";
  });
}

// ─── Input Handlers ───────────────────────────────────────────────────────────
function setupInputHandlers() {
  sendBtn?.addEventListener("click", () => sendMessage());

  chatInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  chatInput?.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
  });
}

// ─── Welcome Message ──────────────────────────────────────────────────────────
function showWelcomeMessage() {
  if (sessionStorage.getItem("asha_query_state")) return;
  const lang = getLang();
  const msg = lang === "hi"
    ? "नमस्ते! मैं आपका ASHA AI सहायक हूँ। रोगी के लक्षण बताएं।"
    : "Namaste! I'm your ASHA AI Assistant. Describe the patient's symptoms and I'll provide immediate, actionable medical guidance grounded in real-time health research.";
  addMessage("assistant", msg);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  applyLang(getLang());
  setupInputHandlers();
  setupVoiceButton();
  setupLangButton();
  showWelcomeMessage();
  initFromState();
  chatInput?.focus();
});

// Expose for quick-query buttons in chat.html
window.sendMessage = sendMessage;
