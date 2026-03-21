/**
 * ASHA AI Assistant - Backend Server (v2.1 — patched)
 * Node.js/Express + Gemini AI + Dynamic Web Mining
 *
 * FIXES in this version:
 *  - Removed node-fetch (uses Node 18 native fetch)
 *  - Built-in .env loader (no dotenv dependency)
 *  - Bulletproof JSON parsing in Health Gatekeeper
 *  - Early API key validation with clear error message
 *  - Per-step try/catch so one failure doesn't crash the whole request
 */

import express from "express";
import cors from "cors";
import { XMLParser } from "fast-xml-parser";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Load .env manually (no dotenv dependency) ────────────────────────────────
try {
  const envPath = path.join(__dirname, ".env");
  const envContent = await fs.readFile(envPath, "utf8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) process.env[key] = val;
  }
  console.log("[ENV] Loaded .env file");
} catch {
  console.log("[ENV] No .env file — using system environment variables");
}

// ─── Validate API Key early ───────────────────────────────────────────────────
if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "your_gemini_api_key_here") {
  console.error("\n❌  GEMINI_API_KEY is not set.");
  console.error("    1. Copy .env.example → .env");
  console.error("    2. Paste your key from https://aistudio.google.com/app/apikey\n");
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ─── Gemini Setup ─────────────────────────────────────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel   = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

// ─── Log Store (data/logs.json) ───────────────────────────────────────────────
const LOGS_FILE = path.join(__dirname, "data", "logs.json");

async function readLogs() {
  try {
    const raw = await fs.readFile(LOGS_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function appendLog(entry) {
  const logs = await readLogs();
  logs.push(entry);
  await fs.mkdir(path.dirname(LOGS_FILE), { recursive: true });
  await fs.writeFile(LOGS_FILE, JSON.stringify(logs, null, 2));
}

// ─── FEATURE 1: Health Gatekeeper ─────────────────────────────────────────────
async function isHealthQuery(query) {
  const prompt = `You are a strict medical intent classifier for ASHA health workers in rural India.
Classify if the following query is related to health, medicine, symptoms, diseases, nutrition,
maternal health, child health, or public health programs in India.

Query: "${query}"

IMPORTANT: Respond with ONLY a raw JSON object on ONE LINE. No markdown, no backticks, no extra text.
Format: {"isHealth": true, "confidence": 0.95}`;

  try {
    const result = await geminiModel.generateContent(prompt);
    const raw = result.response.text().trim();
    // Strip markdown fences if Gemini adds them anyway
    const cleaned = raw
      .replace(/^```json\s*/im, "")
      .replace(/^```\s*/im, "")
      .replace(/\s*```$/im, "")
      .trim();
    // Extract the first JSON object — handles extra commentary
    const match = cleaned.match(/\{[\s\S]*?\}/);
    if (!match) {
      console.warn("[Gatekeeper] No JSON found in response:", raw.slice(0, 100));
      return true; // fail-open
    }
    const parsed = JSON.parse(match[0]);
    const pass = parsed.isHealth === true && (parsed.confidence ?? 1) > 0.6;
    console.log(`[Gatekeeper] isHealth=${pass}, confidence=${parsed.confidence}`);
    return pass;
  } catch (e) {
    console.warn("[Gatekeeper] Parse error — failing open:", e.message);
    return true;
  }
}

// ─── FEATURE 2: Dynamic Web Mining ───────────────────────────────────────────
async function mineHealthArticles(symptoms) {
  const query = symptoms.join(" ") + " India health treatment";
  const encodedQuery = encodeURIComponent(query);
  const rssUrl = `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-IN&gl=IN&ceid=IN:en`;

  console.log("[Mining] Fetching RSS:", rssUrl.slice(0, 80) + "...");

  try {
    const response = await fetch(rssUrl, {
      headers: { "User-Agent": "ASHA-AI-Health-Bot/2.0" },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      console.warn("[Mining] RSS status:", response.status);
      return [];
    }

    const xml = await response.text();
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(xml);

    const items = parsed?.rss?.channel?.item || [];
    const articles = (Array.isArray(items) ? items : [items]).slice(0, 20);

    console.log(`[Mining] Found ${articles.length} articles`);

    return articles.map((item) => ({
      title:   item.title || "",
      snippet: (item.description || "").replace(/<[^>]*>/g, ""),
      link:    item.link || "",
      pubDate: item.pubDate || "",
      source:  item.source?.["#text"] || item.source || "Google News",
    }));
  } catch (err) {
    console.warn("[Mining] Fetch failed:", err.message);
    return [];
  }
}

// ─── FEATURE 3: Semantic Ranking (Cosine Similarity) ─────────────────────────
async function getEmbedding(text) {
  try {
    const result = await embeddingModel.embedContent(text.slice(0, 500));
    return result.embedding.values;
  } catch (e) {
    console.warn("[Embedding] Failed:", e.message);
    return null;
  }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return (magA && magB) ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
}

async function semanticRank(query, articles) {
  if (!articles.length) return [];

  const queryVec = await getEmbedding(query);
  if (!queryVec) {
    console.warn("[Semantic] Could not embed query — returning top 5 by order");
    return articles.slice(0, 5).map((a) => ({ ...a, score: 0 }));
  }

  const scored = await Promise.all(
    articles.map(async (article) => {
      const text = `${article.title} ${article.snippet}`;
      const vec = await getEmbedding(text);
      return { ...article, score: cosineSimilarity(queryVec, vec) };
    })
  );

  return scored.sort((a, b) => b.score - a.score).slice(0, 5);
}

// ─── FEATURE 4: Action-First AI Response ─────────────────────────────────────
async function generateASHAResponse(query, symptoms, articles, language, patientId) {
  const context = articles
    .map((a, i) => `[${i + 1}] ${a.title}: ${a.snippet}`)
    .join("\n") || "No recent articles found.";

  const langInstruction = language === "hi"
    ? "Respond entirely in Hindi (Devanagari script). Use simple language an ASHA worker can understand."
    : "Respond in clear, simple English suitable for a rural health worker in India.";

  const prompt = `You are ASHA AI — a specialized medical assistant for Accredited Social Health Activists (ASHA) in rural India.

Patient ID: ${patientId || "Not provided"}
Symptoms Reported: ${symptoms.join(", ") || "See query"}
User Query: "${query}"

Recent Health Research (live-mined from Google News):
${context}

${langInstruction}

Structure your response using EXACTLY these section headers (with ## prefix):

## IMMEDIATE ACTIONS
(Numbered list of first-aid steps the ASHA worker must do RIGHT NOW)

## POSSIBLE CONDITIONS
(Bullet list of likely diagnoses given symptoms)

## WHEN TO REFER
(Clear criteria: refer to PHC/hospital if...)

## GOVERNMENT SCHEMES
(Relevant schemes: JSSK, RBSK, POSHAN, NTEP, UIP, etc.)

## RESEARCH INSIGHTS
(Brief summary citing the mined articles above by number)

RULES:
- Use bullet symbol • for unordered lists, NOT asterisks
- Numbered lists for action steps
- Keep language simple and field-ready
- If fever is present for 3+ days, add a FEVER ALERT line at the top
- Never discuss non-medical topics`;

  const result = await geminiModel.generateContent(prompt);
  return result.response.text();
}

// ─── FEATURE 7: Fever Follow-up (Mini-EMR) ───────────────────────────────────
function checkFeverFollowup(logs, patientId) {
  const feverLogs = logs.filter(
    (l) =>
      l.patientId === patientId &&
      Array.isArray(l.symptoms) &&
      l.symptoms.some((s) =>
        s.toLowerCase().includes("fever") || s.toLowerCase().includes("bukhar")
      )
  );

  if (!feverLogs.length) return null;

  const earliest = Math.min(...feverLogs.map((l) => new Date(l.timestamp).getTime()));
  const days = Math.floor((Date.now() - earliest) / 86400000);

  if (days >= 3) {
    return {
      alert: true,
      days,
      message: `⚠️ FOLLOW-UP ALERT: Patient ${patientId} has fever logged for ${days} days. Immediate referral recommended.`,
    };
  }
  return null;
}

// ─── MAIN CHAT ENDPOINT ───────────────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  const { query, symptoms = [], language = "en", patientId } = req.body;

  if (!query?.trim()) {
    return res.status(400).json({ error: "Query is required." });
  }

  console.log(`\n[Chat] Query: "${query.slice(0, 80)}" | Lang: ${language} | Patient: ${patientId || "anon"}`);

  try {
    // Step 1: Gatekeeper
    const isHealth = await isHealthQuery(query);
    if (!isHealth) {
      const refusal = language === "hi"
        ? "मैं केवल स्वास्थ्य और चिकित्सा से संबंधित प्रश्नों का उत्तर दे सकता हूँ।"
        : "I can only assist with health and medical topics. Please ask a health-related question.";
      return res.json({ response: refusal, blocked: true, articles: [] });
    }

    // Step 2: Web Mining
    const articles = await mineHealthArticles([query, ...symptoms]);

    // Step 3: Semantic Ranking
    const ranked = await semanticRank(query, articles);

    // Step 4: AI Response
    const aiResponse = await generateASHAResponse(query, symptoms, ranked, language, patientId);

    // Step 5: Log entry
    const logEntry = {
      id: Date.now().toString(),
      patientId: patientId || "ANON",
      query,
      symptoms,
      language,
      timestamp: new Date().toISOString(),
      articlesFound: articles.length,
    };
    await appendLog(logEntry).catch((e) => console.warn("[Log] Write failed:", e.message));

    // Step 6: Fever alert
    const logs = await readLogs();
    const feverAlert = patientId ? checkFeverFollowup(logs, patientId) : null;

    console.log(`[Chat] Done — articles: ${ranked.length}, feverAlert: ${!!feverAlert}`);

    return res.json({
      response: aiResponse,
      blocked: false,
      articles: ranked.map(({ title, link, source, score }) => ({
        title,
        link,
        source,
        relevance: Math.round((score || 0) * 100),
      })),
      feverAlert,
      logId: logEntry.id,
    });

  } catch (err) {
    console.error("[Chat] Unhandled error:", err);
    return res.status(500).json({
      error: err.message || "AI service temporarily unavailable. Please retry.",
    });
  }
});

// ─── ANALYTICS ENDPOINT ───────────────────────────────────────────────────────
app.get("/api/analytics", async (req, res) => {
  try {
    const logs = await readLogs();
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recent = logs.filter((l) => new Date(l.timestamp).getTime() > cutoff);

    const symptomFreq = {};
    recent.forEach((l) => {
      (l.symptoms || []).forEach((s) => {
        const k = s.toLowerCase().trim();
        symptomFreq[k] = (symptomFreq[k] || 0) + 1;
      });
    });

    const topSymptoms = Object.entries(symptomFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([symptom, count]) => ({ symptom, count }));

    const HIGH_KW = ["fever", "unconscious", "bleeding", "seizure", "breathe", "chest pain"];
    const riskDistribution = { high: 0, medium: 0, low: 0 };
    recent.forEach((l) => {
      const text = [...(l.symptoms || []), l.query || ""].join(" ").toLowerCase();
      if (HIGH_KW.some((k) => text.includes(k))) riskDistribution.high++;
      else if ((l.symptoms || []).length >= 3)    riskDistribution.medium++;
      else                                         riskDistribution.low++;
    });

    const dailyTrend = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().split("T")[0];
      dailyTrend.push({
        date: dayStr,
        count: recent.filter((l) => l.timestamp?.startsWith(dayStr)).length,
      });
    }

    const uniquePatients = new Set(recent.map((l) => l.patientId)).size;
    const patientIds = [...new Set(logs.map((l) => l.patientId).filter(Boolean))];
    const feverAlerts = patientIds.map((pid) => checkFeverFollowup(logs, pid)).filter(Boolean);

    return res.json({
      totalConsultations: recent.length,
      uniquePatients,
      topSymptoms,
      riskDistribution,
      dailyTrend,
      feverAlerts,
    });
  } catch (err) {
    console.error("[Analytics]", err);
    return res.status(500).json({ error: "Analytics unavailable." });
  }
});

// ─── Common Symptoms ──────────────────────────────────────────────────────────
app.get("/api/symptoms/common", (_req, res) => {
  res.json({
    symptoms: [
      "Fever", "Cough", "Diarrhea", "Vomiting", "Headache",
      "Body ache", "Skin rash", "Breathlessness", "Chest pain",
      "Abdominal pain", "Jaundice", "Swollen limbs", "Malaria symptoms",
      "TB symptoms", "Dengue fever", "Typhoid", "Anemia signs",
    ],
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║   ASHA AI Assistant — Server Online   ║
  ║   http://localhost:${PORT}               ║
  ╚═══════════════════════════════════════╝
  `);
});

// ════════════════════════════════════════════════════════════════════════════
// CLINICAL UPGRADE v3.0 — 3 New Features
// 1. Differential Diagnosis with Confidence Scores
// 2. Drug Interaction Checker
// 3. Pregnancy Risk Screener (ANC)
// ════════════════════════════════════════════════════════════════════════════

// ─── FEATURE A: Differential Diagnosis Confidence Meter ──────────────────────
// Takes symptoms array, returns ranked conditions with % confidence scores.
app.post("/api/diagnose", async (req, res) => {
  const { symptoms = [], age, gender, duration, language = "en" } = req.body;

  if (!symptoms.length) {
    return res.status(400).json({ error: "At least one symptom is required." });
  }

  const langNote = language === "hi"
    ? "Respond in Hindi (Devanagari script)."
    : "Respond in English.";

  const prompt = `You are a clinical decision support AI for ASHA workers in rural India.

Patient Profile:
- Symptoms: ${symptoms.join(", ")}
- Age: ${age || "Unknown"}
- Gender: ${gender || "Unknown"}
- Duration: ${duration || "Unknown"}

${langNote}

Analyze these symptoms and provide a differential diagnosis list.
You MUST respond with ONLY a raw JSON object — no markdown, no backticks, no explanation.

Format exactly like this:
{
  "diagnoses": [
    {
      "condition": "Malaria",
      "confidence": 82,
      "reasoning": "High fever, chills, body ache typical of P. vivax malaria",
      "urgency": "high",
      "action": "RDT test immediately, refer to PHC if positive",
      "icdCode": "B54"
    }
  ],
  "redFlags": ["Fever >3 days", "Altered consciousness"],
  "recommendedTests": ["Malaria RDT", "CBC", "Blood smear"],
  "referralNeeded": true,
  "summary": "One sentence clinical summary"
}

Rules:
- List 3 to 6 most likely conditions
- confidence is integer 0-100, all must sum to roughly 200 (overlapping differential)
- urgency is one of: "critical", "high", "medium", "low"
- Focus on diseases common in rural India
- redFlags are symptoms that if present mean immediate referral`;

  try {
    const result = await geminiModel.generateContent(prompt);
    const raw = result.response.text().trim();
    const cleaned = raw
      .replace(/^```json\s*/im, "").replace(/^```\s*/im, "").replace(/\s*```$/im, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON in response");
    const data = JSON.parse(match[0]);
    return res.json(data);
  } catch (err) {
    console.error("[Diagnose]", err.message);
    return res.status(500).json({ error: "Diagnosis service unavailable. " + err.message });
  }
});

// ─── FEATURE B: Drug Interaction Checker ─────────────────────────────────────
// Takes 2+ drug names, returns interaction severity and clinical advice.
app.post("/api/drug-interaction", async (req, res) => {
  const { drugs = [], language = "en" } = req.body;

  if (drugs.length < 2) {
    return res.status(400).json({ error: "Please provide at least 2 drug names." });
  }

  const langNote = language === "hi"
    ? "Respond in Hindi (Devanagari script)."
    : "Respond in English.";

  const prompt = `You are a clinical pharmacology assistant for ASHA/ANM workers in rural India.

Drugs to check: ${drugs.join(", ")}

${langNote}

Check all pair-wise interactions between these drugs.
Respond with ONLY a raw JSON object — no markdown, no backticks.

Format:
{
  "interactions": [
    {
      "drug1": "Aspirin",
      "drug2": "Ibuprofen",
      "severity": "moderate",
      "effect": "Increased risk of GI bleeding",
      "mechanism": "Both inhibit COX enzymes",
      "clinicalAdvice": "Avoid combination. Use paracetamol instead.",
      "ashaAction": "Do not give both. Refer to ANM or doctor."
    }
  ],
  "safeToUse": false,
  "overallRisk": "moderate",
  "summary": "One sentence summary for ASHA worker",
  "commonSubstitutes": ["Paracetamol for pain relief"]
}

Severity levels: "none", "mild", "moderate", "severe", "contraindicated"
overallRisk: "safe", "low", "moderate", "high", "critical"
If no interactions found, return interactions as empty array and safeToUse as true.
Focus on drugs commonly available in Indian PHC/sub-centre settings.`;

  try {
    const result = await geminiModel.generateContent(prompt);
    const raw = result.response.text().trim();
    const cleaned = raw
      .replace(/^```json\s*/im, "").replace(/^```\s*/im, "").replace(/\s*```$/im, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON in response");
    const data = JSON.parse(match[0]);
    return res.json(data);
  } catch (err) {
    console.error("[DrugInteraction]", err.message);
    return res.status(500).json({ error: "Drug checker unavailable. " + err.message });
  }
});

// ─── FEATURE C: Pregnancy Risk Screener (ANC) ────────────────────────────────
// Full ANC assessment — gestational age, vitals, symptoms → risk level + actions.
app.post("/api/pregnancy-screen", async (req, res) => {
  const {
    patientId, age, gestationalWeeks,
    systolic, diastolic, weight, hemoglobin,
    symptoms = [], previousComplications = [],
    language = "en"
  } = req.body;

  const langNote = language === "hi"
    ? "Respond in Hindi (Devanagari script). Use simple language."
    : "Respond in English suitable for an ASHA worker.";

  const prompt = `You are an expert maternal health AI for ASHA workers in rural India under the JSSK and PMSMA programs.

ANC Patient Data:
- Patient ID: ${patientId || "Unknown"}
- Mother's Age: ${age || "Unknown"} years
- Gestational Age: ${gestationalWeeks || "Unknown"} weeks
- Blood Pressure: ${systolic || "?"}/${diastolic || "?"} mmHg
- Weight: ${weight || "Unknown"} kg
- Hemoglobin: ${hemoglobin || "Unknown"} g/dL
- Current Symptoms: ${symptoms.join(", ") || "None reported"}
- Previous Complications: ${previousComplications.join(", ") || "None"}

${langNote}

Provide a complete ANC risk assessment.
Respond with ONLY a raw JSON object — no markdown, no backticks.

Format:
{
  "riskLevel": "high",
  "riskScore": 75,
  "trimester": "third",
  "dangerSigns": [
    { "sign": "BP 150/100", "meaning": "Pre-eclampsia risk", "action": "Immediate referral to PHC" }
  ],
  "findings": [
    { "parameter": "Hemoglobin", "value": "8.5 g/dL", "status": "low", "interpretation": "Severe anemia" }
  ],
  "immediateActions": ["Check urine for protein", "Start iron-folic acid supplementation"],
  "referralDecision": {
    "refer": true,
    "urgency": "within 24 hours",
    "facility": "PHC or CHC",
    "reason": "Severe anemia + elevated BP"
  },
  "nextANCDate": "Within 2 weeks",
  "govtSchemes": ["JSSK — free delivery", "PMSMA — free ANC on 9th", "Janani Suraksha Yojana"],
  "nutritionAdvice": "Eat iron-rich foods: spinach, jaggery, lentils",
  "summary": "One sentence summary for the ASHA worker"
}

riskLevel: "low", "medium", "high", "critical"
Danger signs to always check: BP>140/90, Hb<7, severe headache, blurred vision, swollen face/hands, reduced fetal movement, bleeding.`;

  try {
    const result = await geminiModel.generateContent(prompt);
    const raw = result.response.text().trim();
    const cleaned = raw
      .replace(/^```json\s*/im, "").replace(/^```\s*/im, "").replace(/\s*```$/im, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON in response");
    const data = JSON.parse(match[0]);

    // Log pregnancy screening to EMR
    await appendLog({
      id: Date.now().toString(),
      type: "anc_screen",
      patientId: patientId || "ANON",
      gestationalWeeks,
      riskLevel: data.riskLevel,
      symptoms,
      language,
      timestamp: new Date().toISOString(),
    }).catch(() => {});

    return res.json(data);
  } catch (err) {
    console.error("[PregnancyScreen]", err.message);
    return res.status(500).json({ error: "Pregnancy screener unavailable. " + err.message });
  }
});
