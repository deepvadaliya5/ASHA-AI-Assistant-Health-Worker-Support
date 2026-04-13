/**
 * voice.js v5.0 — Dual-mode voice input
 *
 * Mode A: Web Speech API (works on HTTPS or Chrome with flag enabled)
 *         Tries locale chain: en-IN → en-US → en-GB → en
 *
 * Mode B: MediaRecorder + Whisper transcription fallback
 *         Records audio → sends base64 to /api/transcribe → OpenAI returns text
 *         Works on HTTP localhost without any Chrome flags
 */

import { getLang } from "./lang.js";

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let recognizer    = null;
let isListening   = false;
let localeIndex   = 0;
let useServerTranscribeFallback = false; // after Web Speech keeps failing

// ─── Locale fallback chain ────────────────────────────────────────────────────
const LOCALE_CHAIN = {
  en: ["en-IN", "en-US", "en-GB", "en"],
  hi: ["hi-IN", "hi", "en-IN", "en-US"],
};

export function isVoiceSupported() {
  // Always true — server transcription fallback even if Web Speech unsupported
  return !!(SpeechRecognition || navigator.mediaDevices?.getUserMedia);
}

export function startListening(onResult, onError, onEnd) {
  if (useServerTranscribeFallback || !SpeechRecognition) {
    _startMediaRecorderTranscribe(onResult, onError, onEnd);
    return;
  }
  _startWebSpeech(onResult, onError, onEnd, localeIndex);
}

// ─── MODE A: Web Speech API ───────────────────────────────────────────────────
function _startWebSpeech(onResult, onError, onEnd, idx) {
  if (isListening) { stopListening(); return; }

  const lang   = getLang();
  const chain  = LOCALE_CHAIN[lang] || LOCALE_CHAIN.en;
  const locale = chain[Math.min(idx, chain.length - 1)];
  console.log(`[Voice] Web Speech locale: ${locale}`);

  recognizer = new SpeechRecognition();
  recognizer.continuous      = false;
  recognizer.interimResults  = true;
  recognizer.lang            = locale;
  recognizer.maxAlternatives = 1;

  recognizer.onstart  = () => { isListening = true; };

  recognizer.onresult = (event) => {
    localeIndex = idx; // lock to working locale
    let transcript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    const isFinal = event.results[event.results.length - 1].isFinal;
    onResult?.(transcript, isFinal);
  };

  recognizer.onerror = (event) => {
    isListening = false;
    console.warn(`[Voice] Web Speech error (${locale}):`, event.error);

    if (event.error === "network") {
      const nextIdx = idx + 1;
      const chain   = LOCALE_CHAIN[getLang()] || LOCALE_CHAIN.en;

      if (nextIdx < chain.length) {
        // Try next locale
        console.log(`[Voice] Trying next locale...`);
        setTimeout(() => _startWebSpeech(onResult, onError, onEnd, nextIdx), 300);
        return;
      }

      // All Web Speech locales failed — switch permanently to server transcription
      console.log("[Voice] All locales failed — switching to server transcription");
      useServerTranscribeFallback = true;
      _startMediaRecorderTranscribe(onResult, onError, onEnd);
      return;
    }

    const messages = {
      "not-allowed":         "Microphone blocked. Click the 🔒 in your browser address bar → allow microphone → refresh.",
      "no-speech":           "No speech detected. Please speak clearly and try again.",
      "aborted":             "Voice cancelled.",
      "audio-capture":       "No microphone found. Please connect one.",
      "service-not-allowed": "Voice service blocked. Using server transcription instead.",
    };

    if (event.error === "service-not-allowed") {
      useServerTranscribeFallback = true;
      _startMediaRecorderTranscribe(onResult, onError, onEnd);
      return;
    }

    onError?.(messages[event.error] || `Voice error: ${event.error}`);
  };

  recognizer.onend = () => { isListening = false; onEnd?.(); };

  try { recognizer.start(); }
  catch (e) { isListening = false; onError?.("Could not start voice: " + e.message); }
}

// ─── MODE B: MediaRecorder → /api/transcribe (Whisper) ───────────────────────
let mediaRecorder   = null;
let audioChunks     = [];
let isRecording     = false;
let recordingStream = null;

async function _startMediaRecorderTranscribe(onResult, onError, onEnd) {
  if (isRecording) { _stopMediaRecorder(); return; }

  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    onError?.("Microphone access denied. Click the 🔒 in your address bar and allow microphone access.");
    return;
  }

  // Pick best supported format
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "audio/ogg";

  audioChunks  = [];
  mediaRecorder = new MediaRecorder(recordingStream, { mimeType });
  isRecording   = true;
  isListening   = true;

  // Show interim feedback
  onResult?.("🎙️ Recording... speak now", false);

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    isRecording = false;
    isListening = false;
    recordingStream?.getTracks().forEach(t => t.stop());

    if (!audioChunks.length) { onEnd?.(); return; }

    const blob = new Blob(audioChunks, { type: mimeType });

    // Show "transcribing" state
    onResult?.("⏳ Transcribing audio...", false);

    try {
      const base64 = await _blobToBase64(blob);
      const res    = await fetch("/api/transcribe", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          audioBase64: base64,
          mimeType,
          language: getLang(),
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.transcript?.trim()) {
        onResult?.(data.transcript.trim(), true); // isFinal = true
      } else {
        onError?.("Could not transcribe audio. Please speak more clearly or type your query.");
      }
    } catch (e) {
      console.error("[Transcribe]", e);
      onError?.("Transcription failed: " + e.message + ". Please type your query.");
    }

    onEnd?.();
  };

  mediaRecorder.onerror = (e) => {
    isRecording = false;
    isListening = false;
    onError?.("Recording error: " + e.error);
  };

  // Auto-stop after 10 seconds
  mediaRecorder.start();
  setTimeout(() => {
    if (isRecording) stopListening();
  }, 10000);
}

function _stopMediaRecorder() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    isRecording = false;
    isListening = false;
  }
}

function _blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ─── Public controls ──────────────────────────────────────────────────────────
export function stopListening() {
  if (recognizer && isListening && !isRecording) {
    recognizer.stop();
    isListening = false;
  }
  if (isRecording) _stopMediaRecorder();
}

export function getIsListening() { return isListening || isRecording; }

// ─── Speech Synthesis ─────────────────────────────────────────────────────────
let _speaking = false;

export function speak(text, onEnd) {
  if (!window.speechSynthesis) return;
  stopSpeaking();

  const clean = text
    .replace(/##\s*/g, "").replace(/\*\*/g, "")
    .replace(/[•·]/g, ",").replace(/\n{2,}/g, ". ").replace(/\n/g, " ").trim();

  // Split into <180 char chunks (Chrome TTS cutoff bug fix)
  const sentences = clean.match(/[^.!?]+[.!?]*/g) || [clean];
  const chunks = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > 180 && cur) { chunks.push(cur.trim()); cur = s; }
    else cur += " " + s;
  }
  if (cur.trim()) chunks.push(cur.trim());

  let idx = 0;
  function next() {
    if (idx >= chunks.length) { _speaking = false; onEnd?.(); return; }
    const utt   = new SpeechSynthesisUtterance(chunks[idx++]);
    utt.lang    = getLang() === "hi" ? "hi-IN" : "en-US"; // en-US more reliable on Windows
    utt.rate    = 0.9; utt.pitch = 1.0; utt.volume = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const pick   = voices.find(v => v.lang.startsWith(getLang() === "hi" ? "hi" : "en"))
                || voices[0];
    if (pick) utt.voice = pick;
    utt.onend  = next;
    utt.onerror = (e) => { if (e.error !== "interrupted") console.warn("[TTS]", e.error); next(); };
    _speaking = true;
    window.speechSynthesis.speak(utt);
  }
  next();
}

export function stopSpeaking() {
  if (window.speechSynthesis?.speaking) window.speechSynthesis.cancel();
  _speaking = false;
}

export function isSpeaking() { return _speaking || window.speechSynthesis?.speaking || false; }

// Prime voice list
if (window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}
