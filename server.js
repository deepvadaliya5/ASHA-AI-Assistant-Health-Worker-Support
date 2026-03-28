/**
 * ASHA AI Assistant — server.js v4.0 HACKATHON EDITION
 * ─────────────────────────────────────────────────────
 * GenAI Features:
 *  1.  Health Gatekeeper         — Gemini intent classifier
 *  2.  Dynamic Web Mining        — Live Google News RSS per symptom
 *  3.  Semantic Ranking          — text-embedding-004 + cosine similarity
 *  4.  Action-First AI Response  — Structured Gemini prompt
 *  5.  Multi-turn Memory         — Full conversation history sent to Gemini
 *  6.  Gemini Vision             — Photo symptom analysis (base64 image)
 *  7.  AI Triage Scoring         — 0-100 urgency score per consultation
 *  8.  Smart Follow-up Questions — Gemini generates 3 contextual next questions
 *  9.  AI Treatment Plan         — Step-by-step home care + referral plan
 * 10.  Outbreak Detector         — Gemini analyses log clusters for alerts
 * 11.  Voice Transcription       — Gemini fallback when Web Speech fails
 * 12.  Mini-EMR + Fever Alerts   — 3-day fever follow-up tracking
 * 13.  Differential Diagnosis    — Confidence-ranked conditions
 * 14.  Drug Interaction Checker  — Pairwise severity analysis
 * 15.  Pregnancy Risk Screener   — Full ANC assessment
 * 16.  Community Analytics       — Symptom trends + risk distribution
 */

import express from "express";
import cors from "cors";
import { XMLParser } from "fast-xml-parser";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Load .env ────────────────────────────────────────────────────────────────
try {
  const raw = await fs.readFile(path.join(__dirname, ".env"), "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (k && !process.env[k]) process.env[k] = v;
  }
  console.log("[ENV] Loaded .env");
} catch { console.log("[ENV] No .env — using system env"); }

if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "your_gemini_api_key_here") {
  console.error("\n❌  GEMINI_API_KEY not set. Add it to your .env file.\n");
  process.exit(1);
}

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "20mb" })); // increased for base64 images
app.use(express.static(__dirname));

// ─── Gemini Models ────────────────────────────────────────────────────────────
const genAI          = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const flash          = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
const flashVision    = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); // same model, vision-capable
const embedModel     = genAI.getGenerativeModel({ model: "text-embedding-004" });

// ─── Log Store ────────────────────────────────────────────────────────────────
const LOGS_FILE = path.join(__dirname, "data", "logs.json");

async function readLogs() {
  try { return JSON.parse(await fs.readFile(LOGS_FILE, "utf8")); }
  catch { return []; }
}

async function appendLog(entry) {
  const logs = await readLogs();
  logs.push(entry);
  await fs.mkdir(path.dirname(LOGS_FILE), { recursive: true });
  await fs.writeFile(LOGS_FILE, JSON.stringify(logs, null, 2));
}

// ─── JSON Parser (bulletproof) ────────────────────────────────────────────────
function parseGeminiJSON(raw) {
  const cleaned = raw.trim()
    .replace(/^```json\s*/im, "").replace(/^```\s*/im, "").replace(/\s*```$/im, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object in Gemini response");
  return JSON.parse(match[0]);
}

// ─── 1. HEALTH GATEKEEPER ─────────────────────────────────────────────────────
async function isHealthQuery(query) {
  const prompt = `Medical intent classifier for ASHA health workers in rural India.
Is this query related to: health, medicine, symptoms, disease, nutrition, maternal health, child health, public health, government health schemes, or medical emergencies?

Query: "${query}"

Respond with ONLY one line of raw JSON: {"isHealth": true, "confidence": 0.95}`;

  try {
    const r = await flash.generateContent(prompt);
    const parsed = parseGeminiJSON(r.response.text());
    const pass = parsed.isHealth === true && (parsed.confidence ?? 1) > 0.55;
    console.log(`[Gate] isHealth=${pass} conf=${parsed.confidence}`);
    return pass;
  } catch (e) {
    console.warn("[Gate] fail-open:", e.message);
    return true;
  }
}

// ─── 2. DYNAMIC WEB MINING ───────────────────────────────────────────────────
async function mineHealthArticles(symptoms) {
  const q = encodeURIComponent(symptoms.join(" ") + " India health treatment 2024");
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "ASHA-AI/4.0" },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml);
    const items = parsed?.rss?.channel?.item || [];
    return (Array.isArray(items) ? items : [items]).slice(0, 20).map(i => ({
      title:   i.title || "",
      snippet: (i.description || "").replace(/<[^>]*>/g, ""),
      link:    i.link || "",
      source:  i.source?.["#text"] || i.source || "Google News",
    }));
  } catch (e) {
    console.warn("[Mining]", e.message);
    return [];
  }
}

// ─── 3. SEMANTIC RANKING ──────────────────────────────────────────────────────
async function embed(text) {
  try {
    const r = await embedModel.embedContent(text.slice(0, 500));
    return r.embedding.values;
  } catch { return null; }
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; ma += a[i]*a[i]; mb += b[i]*b[i]; }
  return (ma && mb) ? dot / (Math.sqrt(ma) * Math.sqrt(mb)) : 0;
}

async function semanticRank(query, articles) {
  if (!articles.length) return [];
  const qv = await embed(query);
  if (!qv) return articles.slice(0, 5).map(a => ({ ...a, score: 0 }));
  const scored = await Promise.all(articles.map(async a => ({
    ...a, score: cosine(qv, await embed(`${a.title} ${a.snippet}`))
  })));
  return scored.sort((a, b) => b.score - a.score).slice(0, 5);
}

// ─── 4+5. ACTION-FIRST AI RESPONSE WITH CONVERSATION MEMORY ──────────────────
async function generateASHAResponse(query, symptoms, articles, language, patientId, history = []) {
  const ctx = articles.map((a, i) => `[${i+1}] ${a.title}: ${a.snippet}`).join("\n") || "No articles found.";
  const langNote = language === "hi"
    ? "Respond entirely in Hindi (Devanagari script). Simple language for rural ASHA worker."
    : "Respond in clear simple English for a rural health worker in India.";

  const systemPrompt = `You are ASHA AI — a specialist medical assistant for Accredited Social Health Activists in rural India.
Patient ID: ${patientId || "Unknown"} | Symptoms: ${symptoms.join(", ") || "see query"}
Live Health Research: ${ctx}
${langNote}

STRUCTURE YOUR RESPONSE with these EXACT ## headers in this order:
## IMMEDIATE ACTIONS
(Numbered first-aid steps — do these RIGHT NOW)
## POSSIBLE CONDITIONS  
(Bullet list of likely diagnoses)
## WHEN TO REFER
(Clear referral criteria for PHC/hospital)
## GOVERNMENT SCHEMES
(Relevant: JSSK, RBSK, POSHAN, NTEP, UIP, JSY, PMSMA)
## RESEARCH INSIGHTS
(Cite mined articles by number)

RULES: Use • bullets not asterisks. Numbered lists for actions. If fever 3+ days → add FEVER ALERT at top. Simple field-ready language.`;

  // Build multi-turn conversation for memory
  const messages = [];
  for (const h of history.slice(-6)) { // keep last 6 turns for context
    messages.push({ role: h.role, parts: [{ text: h.content }] });
  }
  messages.push({ role: "user", parts: [{ text: query }] });

  try {
    const chat = flash.startChat({
      history: messages.slice(0, -1),
      systemInstruction: systemPrompt,
    });
    const r = await chat.sendMessage(query);
    return r.response.text();
  } catch {
    // Fallback to single-turn if chat fails
    const r = await flash.generateContent(`${systemPrompt}\n\nQuery: ${query}`);
    return r.response.text();
  }
}

// ─── 7. AI TRIAGE SCORING ─────────────────────────────────────────────────────
async function getTriageScore(query, symptoms) {
  const prompt = `You are an emergency triage AI for rural India healthcare.
Symptoms: ${symptoms.join(", ")} | Query: "${query}"

Return ONLY raw JSON: {"score": 72, "level": "high", "reasoning": "Fever 11 days suggests typhoid/malaria — needs immediate testing"}
score: 0-100 (100=life-threatening). level: "critical"|"high"|"medium"|"low"`;

  try {
    const r = await flash.generateContent(prompt);
    return parseGeminiJSON(r.response.text());
  } catch { return { score: 50, level: "medium", reasoning: "Assessment unavailable" }; }
}

// ─── 8. SMART FOLLOW-UP QUESTIONS ────────────────────────────────────────────
async function generateFollowups(query, symptoms, aiResponse, language) {
  const lang = language === "hi" ? "Hindi" : "English";
  const prompt = `Based on this ASHA worker consultation:
Symptoms: ${symptoms.join(", ")}
Query: "${query}"
AI Response summary: ${aiResponse.slice(0, 400)}

Generate exactly 3 smart follow-up questions the ASHA worker should ask the patient next.
Questions should help narrow diagnosis or assess severity.
Respond in ${lang}. Return ONLY raw JSON:
{"questions": ["Q1?", "Q2?", "Q3?"]}`;

  try {
    const r = await flash.generateContent(prompt);
    const parsed = parseGeminiJSON(r.response.text());
    return parsed.questions || [];
  } catch { return []; }
}

// ─── 9. AI TREATMENT PLAN ─────────────────────────────────────────────────────
app.post("/api/treatment-plan", async (req, res) => {
  const { symptoms = [], diagnosis, patientId, age, language = "en" } = req.body;
  if (!symptoms.length && !diagnosis) return res.status(400).json({ error: "Symptoms or diagnosis required." });

  const langNote = language === "hi" ? "Respond in Hindi (Devanagari)." : "Respond in English.";
  const prompt = `You are a treatment planning AI for ASHA workers in rural India.
Patient ID: ${patientId || "Unknown"} | Age: ${age || "Unknown"}
Symptoms: ${symptoms.join(", ")} | Likely Diagnosis: ${diagnosis || "Unknown"}
${langNote}

Create a complete 5-day treatment and monitoring plan.
Return ONLY raw JSON:
{
  "diagnosis": "Most likely condition",
  "homeCare": [
    {"day": "Day 1-2", "actions": ["Action 1", "Action 2"], "medicines": ["Medicine + dose"], "diet": "Dietary advice"}
  ],
  "monitoringChecklist": ["Check temperature twice daily", "Watch for rash"],
  "referralTriggers": ["If fever >103F", "If unconscious"],
  "preventionAdvice": "How to prevent spread to family",
  "followUpDate": "Return in 3 days if no improvement",
  "ashaInstructions": "What ASHA worker should do at each visit"
}`;

  try {
    const r = await flash.generateContent(prompt);
    return res.json(parseGeminiJSON(r.response.text()));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── 6. GEMINI VISION — PHOTO SYMPTOM ANALYSIS ───────────────────────────────
app.post("/api/analyze-image", async (req, res) => {
  const { imageBase64, mimeType = "image/jpeg", symptoms = [], language = "en" } = req.body;
  if (!imageBase64) return res.status(400).json({ error: "Image data required." });

  const langNote = language === "hi" ? "Respond in Hindi (Devanagari)." : "Respond in English.";
  const prompt = `You are a medical image analysis AI for ASHA workers in rural India.
Additional reported symptoms: ${symptoms.join(", ") || "None"}
${langNote}

Analyze this medical image (could be skin rash, wound, tongue, eye, swelling, etc.)

Return ONLY raw JSON:
{
  "observations": ["What you see in the image"],
  "possibleConditions": [{"condition": "Measles", "confidence": 80, "reasoning": "..."}],
  "urgency": "high",
  "immediateActions": ["Action 1"],
  "referralNeeded": true,
  "doNotDo": ["Do not apply oil", "Do not burst blisters"],
  "disclaimer": "This is AI analysis only — confirm with a doctor"
}`;

  try {
    const r = await flashVision.generateContent([
      prompt,
      { inlineData: { data: imageBase64, mimeType } }
    ]);
    return res.json(parseGeminiJSON(r.response.text()));
  } catch (e) {
    return res.status(500).json({ error: "Image analysis failed: " + e.message });
  }
});

// ─── 11. GEMINI VOICE TRANSCRIPTION FALLBACK ──────────────────────────────────
app.post("/api/transcribe", async (req, res) => {
  const { audioBase64, mimeType = "audio/webm", language = "en" } = req.body;
  if (!audioBase64) return res.status(400).json({ error: "Audio data required." });

  const prompt = language === "hi"
    ? "यह एक ASHA स्वास्थ्य कार्यकर्ता की आवाज़ है। इस ऑडियो को हिंदी में transcribe करें। केवल transcribed text लौटाएं।"
    : "This is an ASHA health worker speaking about patient symptoms. Transcribe this audio accurately. Return ONLY the transcribed text, nothing else.";

  try {
    const r = await flashVision.generateContent([
      prompt,
      { inlineData: { data: audioBase64, mimeType } }
    ]);
    return res.json({ transcript: r.response.text().trim() });
  } catch (e) {
    return res.status(500).json({ error: "Transcription failed: " + e.message });
  }
});

// ─── 10. OUTBREAK DETECTOR ───────────────────────────────────────────────────
app.get("/api/outbreak-check", async (req, res) => {
  try {
    const logs = await readLogs();
    const last7 = logs.filter(l => (Date.now() - new Date(l.timestamp)) < 7 * 86400000);
    if (last7.length < 3) return res.json({ alerts: [], message: "Not enough data for outbreak detection." });

    const symptomSummary = {};
    last7.forEach(l => (l.symptoms || []).forEach(s => {
      const k = s.toLowerCase();
      symptomSummary[k] = (symptomSummary[k] || 0) + 1;
    }));

    const prompt = `You are an epidemiology AI for rural India public health surveillance.
In the last 7 days, ${last7.length} consultations reported these symptoms:
${JSON.stringify(symptomSummary)}

Analyze for potential disease outbreaks or clusters.
Return ONLY raw JSON:
{
  "alerts": [
    {
      "disease": "Possible Dengue cluster",
      "affectedCount": 8,
      "riskLevel": "high",
      "symptoms": ["fever", "rash"],
      "action": "Report to PHC immediately. Check for stagnant water.",
      "reportTo": "Block Medical Officer"
    }
  ],
  "overallRisk": "medium",
  "recommendation": "One sentence for ASHA worker"
}
Return empty alerts array if no clusters detected.`;

    const r = await flash.generateContent(prompt);
    return res.json(parseGeminiJSON(r.response.text()));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── MAIN CHAT ENDPOINT (with all new GenAI features) ─────────────────────────
app.post("/api/chat", async (req, res) => {
  const { query, symptoms = [], language = "en", patientId, history = [] } = req.body;
  if (!query?.trim()) return res.status(400).json({ error: "Query is required." });

  console.log(`\n[Chat] "${query.slice(0, 70)}" | lang:${language} | patient:${patientId || "anon"}`);

  try {
    // Step 1: Gatekeeper
    const isHealth = await isHealthQuery(query);
    if (!isHealth) {
      const msg = language === "hi"
        ? "मैं केवल स्वास्थ्य और चिकित्सा विषयों में सहायता कर सकता हूँ।"
        : "I can only assist with health and medical topics. Please ask a health-related question.";
      return res.json({ response: msg, blocked: true, articles: [], triage: null, followups: [] });
    }

    // Steps 2+3: Mine + Rank (parallel with triage scoring)
    const [articles, triageResult] = await Promise.all([
      mineHealthArticles([query, ...symptoms]),
      getTriageScore(query, symptoms),
    ]);

    const ranked = await semanticRank(query, articles);

    // Steps 4+5: Generate response + follow-ups (parallel)
    const [aiResponse, followups] = await Promise.all([
      generateASHAResponse(query, symptoms, ranked, language, patientId, history),
      generateFollowups(query, symptoms, "", language),
    ]);

    // Step 12: EMR Logging
    const logEntry = {
      id: Date.now().toString(),
      patientId: patientId || "ANON",
      query, symptoms, language,
      triageScore: triageResult.score,
      triageLevel: triageResult.level,
      timestamp: new Date().toISOString(),
      articlesFound: articles.length,
    };
    await appendLog(logEntry).catch(e => console.warn("[Log]", e.message));

    // Fever alert check
    const logs = await readLogs();
    const feverAlert = patientId ? checkFeverFollowup(logs, patientId) : null;

    console.log(`[Chat] Done — triage:${triageResult.level}(${triageResult.score}) articles:${ranked.length}`);

    return res.json({
      response: aiResponse,
      blocked: false,
      triage: triageResult,
      articles: ranked.map(({ title, link, source, score }) => ({
        title, link, source, relevance: Math.round((score || 0) * 100),
      })),
      followups,
      feverAlert,
      logId: logEntry.id,
    });

  } catch (err) {
    console.error("[Chat Error]", err);
    return res.status(500).json({ error: err.message || "AI service unavailable. Please retry." });
  }
});

// ─── FEVER FOLLOW-UP (EMR) ────────────────────────────────────────────────────
function checkFeverFollowup(logs, patientId) {
  const feverLogs = logs.filter(l =>
    l.patientId === patientId &&
    Array.isArray(l.symptoms) &&
    l.symptoms.some(s => s.toLowerCase().includes("fever") || s.toLowerCase().includes("bukhar"))
  );
  if (!feverLogs.length) return null;
  const earliest = Math.min(...feverLogs.map(l => new Date(l.timestamp).getTime()));
  const days = Math.floor((Date.now() - earliest) / 86400000);
  if (days >= 3) return {
    alert: true, days,
    message: `⚠️ FOLLOW-UP ALERT: Patient ${patientId} has fever logged for ${days} days. Immediate referral recommended.`,
  };
  return null;
}

// ─── ANALYTICS ────────────────────────────────────────────────────────────────
app.get("/api/analytics", async (req, res) => {
  try {
    const logs = await readLogs();
    const cutoff = Date.now() - 30 * 86400000;
    const recent = logs.filter(l => new Date(l.timestamp).getTime() > cutoff);

    const symptomFreq = {};
    recent.forEach(l => (l.symptoms || []).forEach(s => {
      const k = s.toLowerCase().trim();
      symptomFreq[k] = (symptomFreq[k] || 0) + 1;
    }));

    const topSymptoms = Object.entries(symptomFreq)
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([symptom, count]) => ({ symptom, count }));

    const HIGH_KW = ["fever", "unconscious", "bleeding", "seizure", "breathe", "chest pain"];
    const riskDistribution = { high: 0, medium: 0, low: 0 };
    recent.forEach(l => {
      const txt = [...(l.symptoms || []), l.query || ""].join(" ").toLowerCase();
      if (HIGH_KW.some(k => txt.includes(k))) riskDistribution.high++;
      else if ((l.symptoms || []).length >= 3)  riskDistribution.medium++;
      else                                        riskDistribution.low++;
    });

    const dailyTrend = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const day = d.toISOString().split("T")[0];
      dailyTrend.push({ date: day, count: recent.filter(l => l.timestamp?.startsWith(day)).length });
    }

    // Triage level breakdown (new in v4)
    const triageSummary = { critical: 0, high: 0, medium: 0, low: 0 };
    recent.forEach(l => { if (l.triageLevel) triageSummary[l.triageLevel] = (triageSummary[l.triageLevel] || 0) + 1; });

    const uniquePatients = new Set(recent.map(l => l.patientId)).size;
    const patientIds = [...new Set(logs.map(l => l.patientId).filter(Boolean))];
    const feverAlerts = patientIds.map(pid => checkFeverFollowup(logs, pid)).filter(Boolean);

    return res.json({
      totalConsultations: recent.length, uniquePatients,
      topSymptoms, riskDistribution, triageSummary, dailyTrend, feverAlerts,
      avgTriageScore: recent.length
        ? Math.round(recent.reduce((s, l) => s + (l.triageScore || 50), 0) / recent.length)
        : 0,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── CLINICAL ENDPOINTS ───────────────────────────────────────────────────────
app.post("/api/diagnose", async (req, res) => {
  const { symptoms = [], age, gender, duration, language = "en" } = req.body;
  if (!symptoms.length) return res.status(400).json({ error: "At least one symptom required." });
  const langNote = language === "hi" ? "Respond in Hindi (Devanagari)." : "Respond in English.";
  const prompt = `Clinical decision support AI for ASHA workers in rural India.
Patient: ${age || "?"}yr ${gender || ""} | Symptoms: ${symptoms.join(", ")} | Duration: ${duration || "Unknown"}
${langNote}
Return ONLY raw JSON:
{"diagnoses":[{"condition":"Malaria","confidence":82,"reasoning":"...","urgency":"high","action":"RDT test","icdCode":"B54"}],
"redFlags":["Fever >3 days"],"recommendedTests":["Malaria RDT","CBC"],"referralNeeded":true,"summary":"..."}
List 3-6 conditions. urgency: critical/high/medium/low. Focus on rural India diseases.`;
  try {
    const r = await flash.generateContent(prompt);
    return res.json(parseGeminiJSON(r.response.text()));
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

app.post("/api/drug-interaction", async (req, res) => {
  const { drugs = [], language = "en" } = req.body;
  if (drugs.length < 2) return res.status(400).json({ error: "At least 2 drugs required." });
  const langNote = language === "hi" ? "Respond in Hindi (Devanagari)." : "Respond in English.";
  const prompt = `Clinical pharmacology AI for ASHA/ANM workers in rural India.
Check interactions between: ${drugs.join(", ")}
${langNote}
Return ONLY raw JSON:
{"interactions":[{"drug1":"Aspirin","drug2":"Ibuprofen","severity":"moderate","effect":"GI bleeding risk","mechanism":"Both inhibit COX","clinicalAdvice":"Avoid","ashaAction":"Do not give both"}],
"safeToUse":false,"overallRisk":"moderate","summary":"...","commonSubstitutes":["Paracetamol"]}
severity: none/mild/moderate/severe/contraindicated`;
  try {
    const r = await flash.generateContent(prompt);
    return res.json(parseGeminiJSON(r.response.text()));
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

app.post("/api/pregnancy-screen", async (req, res) => {
  const { patientId, age, gestationalWeeks, systolic, diastolic, weight, hemoglobin, symptoms = [], previousComplications = [], language = "en" } = req.body;
  const langNote = language === "hi" ? "Respond in Hindi (Devanagari)." : "Respond in English.";
  const prompt = `Maternal health AI for ASHA workers under JSSK/PMSMA programs in rural India.
ANC Data: Patient ${patientId||"?"} | Age ${age||"?"}yr | ${gestationalWeeks||"?"}wk | BP ${systolic||"?"}/${diastolic||"?"} | Wt ${weight||"?"}kg | Hb ${hemoglobin||"?"}g/dL
Symptoms: ${symptoms.join(", ")||"none"} | Previous: ${previousComplications.join(", ")||"none"}
${langNote}
Return ONLY raw JSON:
{"riskLevel":"high","riskScore":75,"trimester":"third","dangerSigns":[{"sign":"BP 150/100","meaning":"Pre-eclampsia","action":"Refer immediately"}],
"findings":[{"parameter":"Hemoglobin","value":"8.5","status":"low","interpretation":"Severe anemia"}],
"immediateActions":["Check urine protein"],"referralDecision":{"refer":true,"urgency":"24 hours","facility":"PHC","reason":"..."},
"nextANCDate":"2 weeks","govtSchemes":["JSSK","PMSMA"],"nutritionAdvice":"Iron-rich foods...","summary":"..."}`;
  try {
    const r = await flash.generateContent(prompt);
    const data = parseGeminiJSON(r.response.text());
    await appendLog({ id: Date.now().toString(), type: "anc_screen", patientId: patientId||"ANON", gestationalWeeks, riskLevel: data.riskLevel, symptoms, language, timestamp: new Date().toISOString() }).catch(() => {});
    return res.json(data);
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

app.get("/api/symptoms/common", (_req, res) => res.json({ symptoms: [
  "Fever","Cough","Diarrhea","Vomiting","Headache","Body ache","Skin rash",
  "Breathlessness","Chest pain","Abdominal pain","Jaundice","Swollen limbs",
  "Fatigue","Loss of appetite","Malaria symptoms","Anemia signs","TB symptoms","Dengue fever","Typhoid",
]}));

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`
  ╔══════════════════════════════════════════════╗
  ║  ASHA AI v4.0 — HACKATHON EDITION           ║
  ║  http://localhost:${PORT}                      ║
  ║  GenAI Features: 16 active                  ║
  ╚══════════════════════════════════════════════╝
`));
