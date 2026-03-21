/**
 * voice.js — Web Speech API Module
 * Handles voice input (Speech Recognition) and output (Speech Synthesis).
 */

import { getLang } from "./lang.js";

// ─── Speech Recognition (Voice Input) ────────────────────────────────────────
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

let recognizer = null;
let isListening = false;

export function isVoiceSupported() {
  return !!SpeechRecognition;
}

/**
 * Start voice recognition.
 * @param {Function} onResult  - Called with transcript string
 * @param {Function} onError   - Called on error
 * @param {Function} onEnd     - Called when recognition ends
 */
export function startListening(onResult, onError, onEnd) {
  if (!SpeechRecognition) {
    onError?.("Speech recognition is not supported in this browser. Please use Chrome or Edge.");
    return;
  }

  if (isListening) {
    stopListening();
    return;
  }

  recognizer = new SpeechRecognition();
  recognizer.continuous = false;
  recognizer.interimResults = true;
  recognizer.lang = getLang() === "hi" ? "hi-IN" : "en-IN";
  recognizer.maxAlternatives = 1;

  recognizer.onresult = (event) => {
    let transcript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    const isFinal = event.results[event.results.length - 1].isFinal;
    onResult?.(transcript, isFinal);
  };

  recognizer.onerror = (event) => {
    isListening = false;
    const messages = {
      "not-allowed": "Microphone access denied. Please allow microphone permissions.",
      "no-speech":   "No speech detected. Please try again.",
      "network":     "Network error during voice recognition.",
    };
    onError?.(messages[event.error] || `Voice error: ${event.error}`);
  };

  recognizer.onend = () => {
    isListening = false;
    onEnd?.();
  };

  recognizer.onstart = () => {
    isListening = true;
  };

  try {
    recognizer.start();
  } catch (e) {
    onError?.("Could not start voice recognition: " + e.message);
  }
}

export function stopListening() {
  if (recognizer && isListening) {
    recognizer.stop();
    isListening = false;
  }
}

export function getIsListening() {
  return isListening;
}

// ─── Speech Synthesis (Voice Output) ─────────────────────────────────────────
let currentUtterance = null;

/**
 * Speak text aloud using Web Speech Synthesis.
 * @param {string} text - Text to speak
 * @param {Function} onEnd - Callback when speech ends
 */
export function speak(text, onEnd) {
  if (!window.speechSynthesis) return;

  // Cancel any ongoing speech
  stopSpeaking();

  // Strip markdown and clean text for TTS
  const clean = text
    .replace(/##\s*/g, "")
    .replace(/\*\*/g, "")
    .replace(/[•·]/g, ",")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .trim();

  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = getLang() === "hi" ? "hi-IN" : "en-IN";
  utterance.rate = 0.9;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  // Prefer Indian English / Hindi voice if available
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(
    (v) => v.lang === utterance.lang || v.lang.startsWith("hi") || v.lang.includes("IN")
  );
  if (preferred) utterance.voice = preferred;

  utterance.onend = () => onEnd?.();
  utterance.onerror = (e) => console.warn("[TTS Error]", e.error);

  currentUtterance = utterance;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (window.speechSynthesis?.speaking) {
    window.speechSynthesis.cancel();
  }
  currentUtterance = null;
}

export function isSpeaking() {
  return window.speechSynthesis?.speaking || false;
}

// Preload voices (some browsers require this)
if (window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };
}
