/**
 * mining.js — Client-side module to display Dynamic Web Mining results.
 * Renders ranked article cards in the chat sidebar.
 */

/**
 * Render mined article cards into a container element.
 * @param {Array}  articles  - Array of { title, link, source, relevance }
 * @param {Element} container - DOM element to render into
 * @param {string}  lang     - 'en' | 'hi'
 */
export function renderArticleCards(articles, container, lang = "en") {
  if (!container) return;

  container.innerHTML = "";

  if (!articles?.length) {
    container.innerHTML = `
      <p class="text-sm text-muted" style="padding: 8px 0;">
        ${lang === "hi" ? "कोई स्रोत नहीं मिला।" : "No web sources found for this query."}
      </p>`;
    return;
  }

  articles.forEach((article, idx) => {
    const card = document.createElement("a");
    card.href = article.link || "#";
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    card.className = "article-card";
    card.style.display = "block";
    card.style.marginBottom = "8px";
    card.style.animationDelay = `${idx * 0.07}s`;

    const relevanceColor = article.relevance >= 70
      ? "var(--clr-primary)"
      : article.relevance >= 40
        ? "var(--clr-warning)"
        : "var(--clr-text-3)";

    card.innerHTML = `
      <div class="article-title">${sanitize(article.title)}</div>
      <div class="article-meta mt-2">
        <span class="article-source">📰 ${sanitize(article.source || "News")}</span>
        <span class="relevance-badge" style="background: ${relevanceColor}18; color: ${relevanceColor};">
          ${article.relevance || "—"}% match
        </span>
      </div>`;

    container.appendChild(card);
  });
}

/**
 * Show a "mining in progress" skeleton state.
 */
export function showMiningSkeleton(container, count = 3) {
  if (!container) return;
  container.innerHTML = Array.from({ length: count }, () => `
    <div class="article-card" style="margin-bottom: 8px;">
      <div style="height: 12px; background: var(--clr-border); border-radius: 4px; margin-bottom: 8px; animation: shimmer 1.2s ease infinite;"></div>
      <div style="height: 10px; background: var(--clr-border); border-radius: 4px; width: 60%; animation: shimmer 1.2s ease 0.2s infinite;"></div>
    </div>`).join("");

  if (!document.getElementById("shimmer-style")) {
    const style = document.createElement("style");
    style.id = "shimmer-style";
    style.textContent = `
      @keyframes shimmer {
        0%   { opacity: 0.6; }
        50%  { opacity: 1;   }
        100% { opacity: 0.6; }
      }`;
    document.head.appendChild(style);
  }
}

/**
 * Basic XSS sanitizer for article content.
 */
function sanitize(str = "") {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Format the AI response text into structured HTML sections.
 * Converts ## headings and bullet points into clean HTML.
 */
export function formatAIResponse(rawText) {
  const sections = rawText.split(/(?=##\s)/);
  let html = "";

  sections.forEach((section) => {
    if (!section.trim()) return;

    if (section.startsWith("## ")) {
      const lines = section.split("\n");
      const heading = lines[0].replace(/^##\s*/, "").trim();
      const body = lines.slice(1).join("\n");

      const icon = getSectionIcon(heading);
      const formattedBody = formatBody(body);

      html += `
        <div class="ai-section">
          <h2>${icon} ${sanitize(heading)}</h2>
          ${formattedBody}
        </div>`;
    } else {
      html += `<p style="margin-bottom:8px; line-height:1.65; font-size:0.9rem;">${sanitize(section.trim())}</p>`;
    }
  });

  return html || `<p>${sanitize(rawText)}</p>`;
}

function formatBody(text) {
  const lines = text.trim().split("\n").filter((l) => l.trim());
  let html = "";
  let inList = false;

  lines.forEach((line) => {
    const trimmed = line.trim();
    const isBullet = /^[•\-\*]\s/.test(trimmed);
    const isNumbered = /^\d+\.\s/.test(trimmed);

    if (isBullet) {
      if (!inList) { html += "<ul>"; inList = "ul"; }
      else if (inList === "ol") { html += "</ol><ul>"; inList = "ul"; }
      html += `<li>${sanitize(trimmed.replace(/^[•\-\*]\s/, ""))}</li>`;
    } else if (isNumbered) {
      if (!inList) { html += "<ol>"; inList = "ol"; }
      else if (inList === "ul") { html += "</ul><ol>"; inList = "ol"; }
      html += `<li>${sanitize(trimmed.replace(/^\d+\.\s/, ""))}</li>`;
    } else {
      if (inList === "ul") { html += "</ul>"; inList = false; }
      if (inList === "ol") { html += "</ol>"; inList = false; }
      if (trimmed) html += `<p style="margin-bottom:6px; font-size:0.9rem;">${sanitize(trimmed)}</p>`;
    }
  });

  if (inList === "ul") html += "</ul>";
  if (inList === "ol") html += "</ol>";
  return html;
}

function getSectionIcon(heading) {
  const upper = heading.toUpperCase();
  if (upper.includes("IMMEDIATE") || upper.includes("तत्काल")) return "🚨";
  if (upper.includes("CONDITION")  || upper.includes("स्थिति"))  return "🩺";
  if (upper.includes("REFER")      || upper.includes("रेफर"))    return "🏥";
  if (upper.includes("SCHEME")     || upper.includes("योजना"))   return "📋";
  if (upper.includes("RESEARCH")   || upper.includes("शोध"))     return "🔬";
  if (upper.includes("NUTRITION")  || upper.includes("पोषण"))    return "🥗";
  if (upper.includes("FOLLOW")     || upper.includes("अनुवर्ती")) return "📅";
  return "📌";
}
