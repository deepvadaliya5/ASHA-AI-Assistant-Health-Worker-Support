<div align="center">

# 🏥 ASHA AI Assistant

### AI-Powered Health Guidance for India's Grassroots Health Workers

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Gemini](https://img.shields.io/badge/Gemini-1.5_Flash-4285F4?style=flat-square&logo=google&logoColor=white)](https://aistudio.google.com)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![GenAI Features](https://img.shields.io/badge/GenAI_Features-16_Active-FF6B35?style=flat-square)](#-genai-features)
[![Made for India](https://img.shields.io/badge/Made_for-Rural_India-FF9933?style=flat-square)](https://nhm.gov.in/index1.php?lang=1&level=1&sublinkid=150&lid=226)

**ASHA AI** is a full-stack GenAI health assistant built specifically for ASHA (Accredited Social Health Activist) workers in rural India — the 1 million+ frontline health workers who are often a community's only access to medical guidance.

[Features](#-genai-features) · [Demo](#-demo) · [Setup](#-setup) · [API](#-api-reference) · [Architecture](#-architecture)

## Live Link: https://asha-ai-assistant-health-worker-support.onrender.com/

</div>

---

## 🌍 The Problem

India's 1.07 million ASHA workers serve remote villages with no doctors, no internet, and no real-time medical support. They rely on paper booklets and memory to diagnose and triage patients. Missed diagnoses, delayed referrals, and untreated outbreaks cost lives.

**ASHA AI solves this** — giving every health worker an AI doctor in their pocket, grounded in live medical research, available in Hindi and English, and working through voice for low-literacy users.

---

## ✨ GenAI Features

| # | Feature | Technology |
|---|---------|-----------|
| 1 | **Health Gatekeeper** | Gemini intent classifier — blocks non-medical queries before any processing |
| 2 | **Dynamic Web Mining** | Live Google News RSS constructed per symptom — real RAG, no static database |
| 3 | **Semantic Ranking** | `text-embedding-004` + Cosine Similarity — surfaces most relevant articles |
| 4 | **Action-First AI Response** | Structured Gemini prompt — Immediate Actions always before research |
| 5 | **Multi-turn Conversation Memory** | Full history sent to Gemini — remembers context across the session |
| 6 | **Gemini Vision — Photo Analysis** | Upload rash/wound photo → Gemini visually diagnoses |
| 7 | **AI Triage Scoring** | 0–100 urgency score + reasoning per consultation |
| 8 | **Smart Follow-up Questions** | Gemini generates 3 contextual next questions after each response |
| 9 | **AI 5-Day Treatment Plan** | Step-by-step home care, medicines, diet, monitoring checklist |
| 10 | **Outbreak Detector** | Gemini analyses 7-day log clusters for disease outbreak alerts |
| 11 | **Gemini Audio Transcription** | MediaRecorder → Gemini fallback when Web Speech API unavailable |
| 12 | **Differential Diagnosis** | Confidence-ranked conditions with ICD codes, urgency, red flags |
| 13 | **Drug Interaction Checker** | Pairwise severity analysis for PHC medicines |
| 14 | **Pregnancy Risk Screener** | Full ANC assessment — BP, Hb, danger signs, referral decision |
| 15 | **Mini-EMR + Fever Alerts** | Patient ID tracking, 3-day fever follow-up across visits |
| 16 | **Community Analytics Dashboard** | Symptom trends, risk distribution, triage breakdown, outbreak heatmap |

---

## 🖥️ Demo

```
Patient: "Bukhar aur sar dard hai, 11 din se"
         (Fever and headache for 11 days)

ASHA AI Response:
  🚨 FEVER ALERT — 11 days fever detected. Referral recommended.
  🎯 Triage Score: 82/100 — HIGH PRIORITY

  ## IMMEDIATE ACTIONS
  1. Check temperature immediately
  2. Perform Malaria RDT test
  3. Check for neck stiffness (meningitis sign)
  ...

  Smart Follow-ups:
  💬 Does the fever spike at a specific time of day?
  💬 Any recent travel to malaria-endemic area?
  💬 Is the patient able to drink fluids?
```

---

## 🚀 Setup

### Prerequisites
- **Node.js 18+** — [Download](https://nodejs.org)
- **OpenAI API Key** — [API keys](https://platform.openai.com/api-keys)

### Install

```bash
git clone https://github.com/yourusername/asha-ai-assistant.git
cd asha-ai-assistant
npm install
```

### Configure

```bash
cp .env.example .env
```

Open `.env` and add your key:
```env
OPENAI_API_KEY=your_openai_api_key_here
# Optional overrides:
# OPENAI_CHAT_MODEL=gpt-4o-mini
# OPENAI_EMBED_MODEL=text-embedding-3-small
```

### Run

```bash
npm start
```

Open **[http://localhost:3000](http://localhost:3000)**

> **For voice input on localhost**, enable Chrome's mic permission:
> Go to `chrome://flags/#unsafely-treat-insecure-origin-as-secure` → add `http://localhost:3000` → Relaunch

---

## 📁 Project Structure

```
asha-ai/
│
├── server.js              # Express backend — all 16 GenAI endpoints
├── package.json
├── .env.example
│
├── data/
│   └── logs.json          # Auto-created — EMR store + analytics data
│
├── css/
│   └── style.css          # Full UI — green medical theme, Hindi font support
│
├── js/
│   ├── chat.js            # Main controller — fetch, triage, follow-ups, image upload
│   ├── voice.js           # Dual-mode voice — Web Speech API + Gemini transcription fallback
│   ├── lang.js            # English ↔ Hindi toggle, [data-i18n] DOM translation
│   ├── mining.js          # Article card renderer + ## section HTML formatter
│   └── logger.js          # Session event telemetry → sessionStorage
│
├── index.html             # Landing page
├── symptoms.html          # Symptom picker + patient ID + risk preview
├── chat.html              # Main AI chat — triage panel, follow-ups, photo upload
├── analytics.html         # Community health dashboard
├── diagnose.html          # Differential diagnosis with confidence bars
├── drugs.html             # Drug interaction checker
└── pregnancy.html         # ANC pregnancy risk screener
```

---

## 🔄 How It Works

### Full Request Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│  USER                                                           │
│  symptoms.html → picks symptoms → sessionStorage → chat.html   │
└──────────────────────────┬──────────────────────────────────────┘
                           │ POST /api/chat
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  SERVER (server.js)                                             │
│                                                                 │
│  1. isHealthQuery()     ← Gemini classifier (blocks non-health)│
│  2. mineHealthArticles()← Google News RSS fetch + XML parse    │
│  3. semanticRank()      ← text-embedding-004 + cosine sim      │
│  4. generateResponse()  ← Gemini 1.5 Flash + conversation mem  │
│  5. getTriageScore()    ← Gemini 0-100 urgency score           │
│  6. generateFollowups() ← Gemini 3 smart follow-up questions   │
│  7. appendLog()         ← Write to data/logs.json (EMR)        │
│  8. checkFeverFollowup()← Scan logs for 3-day fever pattern    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ JSON response
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  CLIENT (chat.js)                                               │
│                                                                 │
│  formatAIResponse()  → ## sections → structured HTML           │
│  renderTriage()      → 0-100 score dial in sidebar             │
│  renderFollowups()   → clickable question buttons              │
│  renderArticleCards()→ ranked source cards with relevance %    │
└─────────────────────────────────────────────────────────────────┘
```

### Voice Input Flow

```
Click 🎤
  │
  ├── Web Speech API (en-IN → en-US → en-GB → en)
  │     └── success → transcript → sendMessage()
  │     └── all fail (network error on HTTP localhost)
  │           │
  └── Gemini Transcription Fallback
        │
        ├── MediaRecorder captures mic audio
        ├── Blob → base64 → POST /api/transcribe
        ├── Gemini reads audio → returns text
        └── transcript → sendMessage()
```

---

## 📡 API Reference

### Core Chat

```http
POST /api/chat
Content-Type: application/json

{
  "query": "Patient has fever for 11 days and headache",
  "symptoms": ["Fever", "Headache"],
  "language": "en",
  "patientId": "ASHA-2024-001",
  "history": [{ "role": "user", "content": "..." }]
}
```

**Response:**
```json
{
  "response": "## IMMEDIATE ACTIONS\n1. ...",
  "blocked": false,
  "triage": { "score": 82, "level": "high", "reasoning": "..." },
  "articles": [{ "title": "...", "link": "...", "relevance": 87 }],
  "followups": ["Does fever spike at night?", "Any chills?", "Recent travel?"],
  "feverAlert": { "alert": true, "days": 11, "message": "..." }
}
```

### Clinical Endpoints

| Method | Endpoint | Input | Output |
|--------|----------|-------|--------|
| `POST` | `/api/diagnose` | symptoms, age, gender, duration | ranked conditions, confidence %, ICD codes |
| `POST` | `/api/drug-interaction` | drug names array | pairwise severity, mechanism, ASHA advice |
| `POST` | `/api/pregnancy-screen` | BP, Hb, weeks, symptoms | risk score, danger signs, referral decision |
| `POST` | `/api/treatment-plan` | symptoms, diagnosis, age | 5-day care plan, medicines, diet |
| `POST` | `/api/analyze-image` | base64 image | visual diagnosis, observations, actions |
| `POST` | `/api/transcribe` | base64 audio | Gemini transcript text |
| `GET`  | `/api/analytics` | — | trends, risk distribution, fever alerts |
| `GET`  | `/api/outbreak-check` | — | disease cluster alerts |

---

## 🏗️ Architecture

### Technology Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Backend | Node.js 18 + Express | Native fetch, ESM modules, zero config |
| AI Model | Gemini 1.5 Flash | Fast, multilingual, vision + audio capable |
| Embeddings | text-embedding-004 | 768-dim vectors for semantic search |
| XML Parsing | fast-xml-parser | Google News RSS → article objects |
| Voice Input | Web Speech API + MediaRecorder | Dual fallback for HTTP localhost |
| Data Store | Flat JSON file | No database needed — zero deployment friction |
| Frontend | Vanilla JS ES Modules | No bundler — instant load in field conditions |
| i18n | Custom lang.js | Hindi Devanagari + English, switchable live |

### Design Principles

- **Offline-resilient** — AI response works even if RSS mining fails (graceful degradation)
- **Field-first** — Action steps always first, no scrolling required for critical info
- **Zero-friction deploy** — `npm install && npm start` — no Docker, no database, no cloud
- **Privacy-local** — All patient data stays in `data/logs.json` on the local machine

---

## 🌐 Supported Government Schemes

ASHA AI automatically references relevant schemes in every response:

| Scheme | Full Name |
|--------|-----------|
| **JSSK** | Janani Shishu Suraksha Karyakram — free maternal care |
| **PMSMA** | Pradhan Mantri Surakshit Matritva Abhiyan — free ANC on 9th |
| **RBSK** | Rashtriya Bal Swasthya Karyakram — child health screening |
| **NTEP** | National TB Elimination Programme — DOTS treatment |
| **POSHAN** | National Nutrition Mission — malnutrition tracking |
| **UIP** | Universal Immunization Programme — vaccination schedule |
| **JSY** | Janani Suraksha Yojana — institutional delivery incentive |

---

## 🤝 Contributing

Pull requests are welcome. For major changes, please open an issue first.

1. Fork the repo
2. Create your feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgements

- **India's 1.07 million ASHA workers** — for their tireless service in the most remote corners of the country
- **National Health Mission (NHM)** — for the ASHA program framework
- **Google DeepMind** — for the Gemini API and text-embedding-004
- **WHO** — for ICD-10 disease classification standards used in differential diagnosis

---

<div align="center">

**Built with ❤️ for rural India**

*"Healthcare is not a privilege — it is a right."*

</div>
