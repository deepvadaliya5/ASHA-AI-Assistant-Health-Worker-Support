/**
 * logger.js — Client-side event logger for ASHA AI
 * Stores interaction metadata in sessionStorage for the current session.
 */

const LOGGER_KEY = "asha_session_log";

function getLog() {
  try {
    return JSON.parse(sessionStorage.getItem(LOGGER_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLog(entries) {
  sessionStorage.setItem(LOGGER_KEY, JSON.stringify(entries));
}

export function logEvent(type, data) {
  const entries = getLog();
  entries.push({
    type,
    data,
    timestamp: new Date().toISOString(),
    sessionId: getSessionId(),
  });
  saveLog(entries);
}

export function getSessionLog() {
  return getLog();
}

export function clearSessionLog() {
  sessionStorage.removeItem(LOGGER_KEY);
}

export function getSessionId() {
  let sid = sessionStorage.getItem("asha_session_id");
  if (!sid) {
    sid = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    sessionStorage.setItem("asha_session_id", sid);
  }
  return sid;
}

// Log page entry
logEvent("page_view", { page: window.location.pathname });
