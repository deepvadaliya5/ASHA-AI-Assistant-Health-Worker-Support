/**
 * lang.js — Multi-lingual support module (English / Hindi)
 * Manages language state and DOM translations.
 */

const LANG_KEY = "asha_language";

export const translations = {
  en: {
    navTitle:        "ASHA AI Assistant",
    navSubtitle:     "Health Worker Support System",
    symptomsTitle:   "Report Symptoms",
    symptomsSubtitle:"Enter patient symptoms to get AI-powered guidance",
    patientIdLabel:  "Patient ID (optional)",
    patientIdPlaceholder: "e.g. ASHA-2024-001",
    symptomsLabel:   "Select or Type Symptoms",
    symptomsInputPlaceholder: "Type symptom and press Enter",
    commonSymptoms:  "Quick Select:",
    additionalNotes: "Additional Notes",
    notesPlaceholder:"Describe the patient's condition, duration, severity...",
    analyzeBtn:      "Analyze Symptoms",
    chatPlaceholder: "Ask about symptoms, treatments, schemes...",
    sendBtn:         "Send",
    langToggle:      "हिंदी",
    voiceStart:      "Start Voice",
    voiceStop:       "Stop Recording",
    sourcesTitle:    "Research Sources",
    noSources:       "No web sources mined for this query.",
    patientInfo:     "Patient Information",
    feverAlert:      "Fever Follow-up Alert",
    blocked:         "⚠️ This assistant only handles health-related queries. Please ask about symptoms, treatments, or health programs.",
  },
  hi: {
    navTitle:        "आशा AI सहायक",
    navSubtitle:     "स्वास्थ्य कार्यकर्ता सहायता प्रणाली",
    symptomsTitle:   "लक्षण दर्ज करें",
    symptomsSubtitle:"AI-आधारित मार्गदर्शन के लिए रोगी के लक्षण दर्ज करें",
    patientIdLabel:  "रोगी ID (वैकल्पिक)",
    patientIdPlaceholder: "जैसे. आशा-2024-001",
    symptomsLabel:   "लक्षण चुनें या टाइप करें",
    symptomsInputPlaceholder: "लक्षण टाइप करें और Enter दबाएं",
    commonSymptoms:  "त्वरित चयन:",
    additionalNotes: "अतिरिक्त विवरण",
    notesPlaceholder:"रोगी की स्थिति, अवधि, गंभीरता का वर्णन करें...",
    analyzeBtn:      "लक्षण विश्लेषण करें",
    chatPlaceholder: "लक्षण, उपचार, योजनाओं के बारे में पूछें...",
    sendBtn:         "भेजें",
    langToggle:      "English",
    voiceStart:      "वॉयस शुरू करें",
    voiceStop:       "रिकॉर्डिंग बंद करें",
    sourcesTitle:    "शोध स्रोत",
    noSources:       "इस प्रश्न के लिए कोई वेब स्रोत नहीं मिला।",
    patientInfo:     "रोगी जानकारी",
    feverAlert:      "बुखार फॉलो-अप अलर्ट",
    blocked:         "⚠️ यह सहायक केवल स्वास्थ्य संबंधी प्रश्नों को संभालता है। कृपया लक्षण, उपचार या स्वास्थ्य कार्यक्रमों के बारे में पूछें।",
  },
};

export function getLang() {
  return localStorage.getItem(LANG_KEY) || "en";
}

export function setLang(lang) {
  localStorage.setItem(LANG_KEY, lang);
  applyLang(lang);
}

export function toggleLang() {
  const current = getLang();
  const next = current === "en" ? "hi" : "en";
  setLang(next);
  return next;
}

export function t(key) {
  const lang = getLang();
  return translations[lang]?.[key] || translations.en[key] || key;
}

export function applyLang(lang) {
  document.documentElement.lang = lang;
  document.body.classList.toggle("lang-hi", lang === "hi");

  // Update all [data-i18n] elements
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const text = translations[lang]?.[key];
    if (text !== undefined) {
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        el.placeholder = text;
      } else {
        el.textContent = text;
      }
    }
  });

  // Update [data-i18n-placeholder] elements
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    const text = translations[lang]?.[key];
    if (text) el.placeholder = text;
  });

  // Dispatch custom event for components that need to react
  document.dispatchEvent(new CustomEvent("langChange", { detail: { lang } }));
}

// Auto-apply on module load
applyLang(getLang());
