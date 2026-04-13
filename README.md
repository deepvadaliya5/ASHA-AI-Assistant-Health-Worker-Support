# 🩺 ASHA AI Assistant – Health Worker Support

## 🌐 Live Demo

👉 https://asha-ai-assistant-health-worker-support.onrender.com/

---

## 📌 Overview

ASHA AI Assistant is a web-based support system designed to assist health workers (like ASHA workers) in accessing medical information, performing basic diagnostics, and improving communication through AI-powered tools.

The system integrates multiple modules such as chat assistance, symptom analysis, drug information, and voice interaction to streamline healthcare support in low-resource environments.

---

## 🚀 Features

* 💬 **AI Chat Assistant**
  Provides instant responses to health-related queries.

* 🧠 **Symptom Analysis**
  Helps in identifying possible conditions based on symptoms.

* 💊 **Drug Information System**
  Displays details about medicines and usage.

* 🩻 **Diagnosis Support**
  Assists in preliminary health condition evaluation.

* 🌍 **Multi-language Support**
  Improves accessibility for diverse users.

* 🎙️ **Voice Interaction**
  Enables hands-free usage for field workers.

* 📊 **Analytics Dashboard**
  Tracks usage and interaction insights.

---

## 📁 Project Structure

```
ASHA-AI-ASSISTANT-HEALTH/
│
├── css/
│   └── style.css
│
├── data/
│
├── js/
│   ├── chat.js
│   ├── lang.js
│   ├── logger.js
│   ├── mining.js
│   └── voice.js
│
├── node_modules/
│
├── .env
├── .gitignore
│
├── analytics.html
├── chat.html
├── diagnose.html
├── drugs.html
├── index.html
├── pregnancy.html
├── symptoms.html
│
├── package.json
├── package-lock.json
├── server.js
│
└── README.md
```

---

## ⚙️ Tech Stack

* **Frontend:** HTML, CSS, JavaScript
* **Backend:** Node.js
* **Hosting:** Render
* **Other Tools:** Voice APIs, Logging system, Data processing scripts

---

## 🧠 Core Concepts Used

* Modular JavaScript architecture
* Client-server communication
* Basic NLP/chat logic
* Data-driven symptom mapping
* Logging and analytics tracking

---

## 🛠️ Setup Instructions

### 1. Clone the repository

```bash
git clone <your-repo-link>
cd ASHA-AI-ASSISTANT-HEALTH
```

### 2. Install dependencies

```bash
npm install
```

### 3. Setup environment variables

Create a `.env` file and add required keys:

```
PORT=3000
```

### 4. Run the server

```bash
node server.js
```

### 5. Open in browser

```
http://localhost:3000
```

---

## 📊 How It Works (High-Level)

1. User interacts via UI (chat / forms / voice)
2. Requests are processed using JS modules
3. Backend (`server.js`) handles logic & responses
4. Data files + scripts support diagnosis & responses
5. Output is rendered dynamically to user

---

## 🔮 Future Improvements

* Integration with real medical APIs
* Machine learning-based diagnosis
* Mobile app version
* Offline functionality for rural areas
* Enhanced multilingual NLP

---

## 👨‍💻 Author

Developed as a project to support healthcare workers with AI-driven assistance.

---

## 📄 License

This project is for educational and research purposes.
