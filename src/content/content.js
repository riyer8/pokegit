(() => {
  const RESERVED = new Set([
    "", "settings", "notifications", "pulls", "issues", "marketplace", "explore", "topics",
    "collections", "events", "sponsors", "login", "join", "logout", "session", "auth",
    "organizations", "orgs", "search", "about", "pricing", "features", "enterprise",
    "security", "team", "customer-stories", "readme", "github-copilot", "codespaces", "new",
    "account", "dashboard", "stars", "watching", "home", "site", "apps", "integrations",
    "nonprofit", "education",
  ]);

  const SCORE_ROWS = [
    ["Architecture", "architecture", "🏗"],
    ["Testing", "testing", "🧪"],
    ["Maintenance", "maintenance", "🔄"],
    ["Documentation", "documentation", "📚"],
    ["Complexity", "complexity", "🛠"],
    ["Activity", "activity", "🚀"],
  ];

  const POKE_LEGEND = [
    { name: "Pikachu", emoji: "⚡", meaning: "Small, focused, useful", personality: "Small but energetic" },
    { name: "Dragonite", emoji: "🐉", meaning: "Large, mature, powerful", personality: "Mature powerhouse" },
    { name: "Alakazam", emoji: "🧙", meaning: "Complex / technical work", personality: "Complex thinker" },
    { name: "Blastoise", emoji: "🛡️", meaning: "Robust / defensive", personality: "Built to hold the line" },
    { name: "Blissey", emoji: "🌸", meaning: "Exceptional testing & CI", personality: "Protects everything with tests" },
    { name: "Golem", emoji: "🪨", meaning: "Infrastructure / ops", personality: "Infrastructure bedrock" },
    { name: "Umbreon", emoji: "🌙", meaning: "Security-flavored work", personality: "Security-minded" },
    { name: "Sylveon", emoji: "🧚", meaning: "Frontend / design", personality: "Interface-first" },
    { name: "Ditto", emoji: "🌀", meaning: "Experimental / prototype", personality: "Shapeshifting experiment" },
    { name: "Snorlax", emoji: "😴", meaning: "Dormant or inactive", personality: "Quiet for now" },
    { name: "Eevee", emoji: "🦊", meaning: "Early-stage / still taking shape", personality: "Still evolving" },
  ];

  const POKE_BY_NAME = Object.fromEntries(POKE_LEGEND.map((p) => [p.name, p]));

  const DISCLAIMER =
    "Experimental score based on publicly observable repository signals. Not an objective assessment of engineering ability.";

  let currentUsername = null;
  let panelOpen = false;
  let lastPayload = null;
  let lastError = null;
  let loading = false;
  let activeTab = "profile";
  let showSettings = false;
  let keyStatus = null;
  let expandedRepos = new Set();

  const state = { fab: null, host: null, shadow: null };

  function parseProfileUsername(pathname = location.pathname) {
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length !== 1) return null;
    const candidate = parts[0];
    if (RESERVED.has(candidate.toLowerCase())) return null;
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(candidate)) return null;
    return candidate;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, "&#39;");
  }

  /** Escape text, then wrap Pokémon codewords with colored hover tips. */
  function linkPokemonTerms(text) {
    const escaped = escapeHtml(text);
    const names = POKE_LEGEND.map((p) => p.name).sort((a, b) => b.length - a.length);
    const re = new RegExp(`\\b(${names.join("|")})\\b`, "g");
    return escaped.replace(re, (match) => {
      const p = POKE_BY_NAME[match];
      if (!p) return match;
      const tip = `${p.emoji} ${p.name}: ${p.personality || p.meaning}`;
      return `<span class="pg-poke-term" tabindex="0"><span class="pg-poke-term-label">${match}</span><span class="pg-tip" role="tooltip">${escapeHtml(tip)}</span></span>`;
    });
  }

  function renderPokeLegend() {
    const rows = POKE_LEGEND.map(
      (p) => `
        <div class="pg-legend-row">
          <span class="pg-legend-emoji" aria-hidden="true">${p.emoji}</span>
          <div class="pg-legend-copy">
            <span class="pg-legend-name">${escapeHtml(p.name)}</span>
            <span class="pg-legend-personality">“${escapeHtml(p.personality)}”</span>
            <span class="pg-legend-meaning">${escapeHtml(p.meaning)}</span>
          </div>
        </div>`
    ).join("");
    return `
      <div class="pg-legend">
        <h3 class="pg-card-title">Pokémon key</h3>
        <p class="pg-keys-lede">Each repo gets one of these as visual shorthand, with a reason.</p>
        <div class="pg-legend-list">${rows}</div>
      </div>`;
  }

  function relativeTime(iso) {
    if (!iso) return "—";
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
    if (days < 1) return "today";
    if (days < 30) return `${days}d ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  }

  function githubColorMode() {
    const mode = document.documentElement.getAttribute("data-color-mode");
    if (mode === "dark" || mode === "light") return mode;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme() {
    const panel = state.shadow?.querySelector(".pokegit-panel");
    if (!panel) return;
    panel.setAttribute("data-theme", githubColorMode());
  }

  /** Small FAB only — never mounts the overlay until the user opens the panel. */
  function ensureFab() {
    if (state.fab) return;

    const fab = document.createElement("button");
    fab.id = "pokegit-fab";
    fab.type = "button";
    fab.hidden = true;
    fab.setAttribute("aria-label", "Open PokéGit");
    fab.innerHTML = `<span class="pokegit-fab-mark" aria-hidden="true"></span>`;
    fab.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPanel(true);
    });
    document.documentElement.appendChild(fab);
    state.fab = fab;
  }

  /** Full panel overlay — created lazily on first open. */
  function ensurePanel() {
    if (state.host) return;

    if (!document.getElementById("pokegit-font-link")) {
      const fabFonts = document.createElement("link");
      fabFonts.id = "pokegit-font-link";
      fabFonts.rel = "stylesheet";
      fabFonts.href = chrome.runtime.getURL("src/panel/fonts.css");
      document.documentElement.appendChild(fabFonts);
    }

    const host = document.createElement("div");
    host.id = "pokegit-panel-host";
    host.hidden = true;
    host.style.cssText =
      "display:none;pointer-events:none;position:fixed;inset:0;z-index:2147483646;";
    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = chrome.runtime.getURL("src/panel/panel.css");
    shadow.appendChild(style);

    const fonts = document.createElement("link");
    fonts.rel = "stylesheet";
    fonts.href = chrome.runtime.getURL("src/panel/fonts.css");
    shadow.appendChild(fonts);

    const wrap = document.createElement("div");
    wrap.className = "pokegit-shell";
    wrap.innerHTML = `
      <div class="pokegit-backdrop" data-close></div>
      <aside class="pokegit-panel" role="dialog" aria-modal="true" aria-label="PokéGit analysis" data-theme="light">
        <header class="pokegit-header">
          <div>
            <div class="pokegit-brand-name">✨ Poké<span>Git</span></div>
            <div class="pokegit-brand-sub">Public GitHub engineering profile</div>
          </div>
          <div class="pokegit-header-actions">
            <button type="button" class="pokegit-icon-btn" data-settings title="Settings" aria-label="Settings">⚙</button>
            <button type="button" class="pokegit-close" data-close aria-label="Close">×</button>
          </div>
        </header>
        <nav class="pokegit-tabs" role="tablist" data-tabs>
          <button type="button" class="pokegit-tab is-active" data-tab="profile" role="tab">Profile</button>
          <button type="button" class="pokegit-tab" data-tab="repos" role="tab">Repos</button>
          <button type="button" class="pokegit-tab" data-tab="code" role="tab">Code</button>
          <button type="button" class="pokegit-tab" data-tab="signals" role="tab">Signals</button>
        </nav>
        <div class="pokegit-body" data-body></div>
      </aside>
    `;
    shadow.appendChild(wrap);

    wrap.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", closePanel));
    wrap.querySelector("[data-settings]")?.addEventListener("click", () => {
      showSettings = !showSettings;
      updateTabsVisibility();
      renderBody();
    });
    wrap.querySelectorAll("[data-tab]").forEach((el) => {
      el.addEventListener("click", () => {
        activeTab = el.getAttribute("data-tab");
        showSettings = false;
        wrap.querySelectorAll("[data-tab]").forEach((t) => t.classList.toggle("is-active", t === el));
        updateTabsVisibility();
        renderBody();
      });
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && panelOpen) closePanel();
    });

    document.documentElement.appendChild(host);
    state.host = host;
    state.shadow = shadow;
  }

  function updateTabsVisibility() {
    const tabs = state.shadow?.querySelector("[data-tabs]");
    if (tabs) tabs.hidden = showSettings;
    state.shadow?.querySelector("[data-settings]")?.classList.toggle("is-active", showSettings);
  }

  function openPanel(forceRefresh = false) {
    if (!currentUsername) return;
    ensurePanel();
    panelOpen = true;
    showSettings = false;
    activeTab = "profile";
    applyTheme();

    state.host.hidden = false;
    state.host.style.display = "block";
    state.host.style.pointerEvents = "auto";
    // next frame so CSS transition can run from closed state
    requestAnimationFrame(() => {
      state.shadow.querySelector(".pokegit-backdrop")?.classList.add("is-open");
      state.shadow.querySelector(".pokegit-panel")?.classList.add("is-open");
    });
    state.shadow.querySelectorAll("[data-tab]").forEach((t) => {
      t.classList.toggle("is-active", t.getAttribute("data-tab") === "profile");
    });
    updateTabsVisibility();
    if (forceRefresh || (!lastPayload && !loading)) analyze();
    else renderBody();
  }

  function closePanel() {
    panelOpen = false;
    if (!state.host || !state.shadow) return;
    state.shadow.querySelector(".pokegit-backdrop")?.classList.remove("is-open");
    state.shadow.querySelector(".pokegit-panel")?.classList.remove("is-open");
    state.host.style.pointerEvents = "none";
    // fully detach overlay from paint after close animation
    window.setTimeout(() => {
      if (panelOpen) return;
      state.host.hidden = true;
      state.host.style.display = "none";
    }, 280);
  }

  async function refreshKeyStatus() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "POKEGIT_GET_KEY_STATUS" });
      if (res?.ok) keyStatus = res.status;
    } catch {
      keyStatus = null;
    }
  }

  async function analyze() {
    if (!currentUsername) return;
    loading = true;
    lastError = null;
    showSettings = false;
    expandedRepos = new Set();
    updateTabsVisibility();
    renderBody();

    try {
      const response = await chrome.runtime.sendMessage({
        type: "POKEGIT_ANALYZE_PROFILE",
        username: currentUsername,
        force: true,
      });
      if (!response?.ok) {
        throw Object.assign(new Error(response?.error?.message || "Analyze failed"), response?.error || {});
      }
      lastPayload = response.payload;
      await refreshKeyStatus();
    } catch (err) {
      lastError = err;
      lastPayload = null;
      await refreshKeyStatus();
      if ((err.status === 403 || err.status === 429) && !keyStatus?.github?.present) {
        showSettings = true;
        updateTabsVisibility();
      }
    } finally {
      loading = false;
      renderBody();
    }
  }

  function renderBody() {
    if (!state.shadow) return;
    const body = state.shadow.querySelector("[data-body]");
    if (!body) return;
    applyTheme();
    updateTabsVisibility();

    if (showSettings) {
      renderSettingsView(body);
      return;
    }

    if (loading) {
      body.innerHTML = `
        <div class="pg-state pg-loading-state">
          <div class="pg-pokeball-load" aria-hidden="true"></div>
          <h3>Analyzing @${escapeHtml(currentUsername)}</h3>
          <ul class="pg-load-steps">
            <li class="is-on">Fetching public profile</li>
            <li class="is-on">Inspecting top repositories</li>
            <li class="is-pulse">Scoring signals &amp; assigning Pokémon</li>
            <li>Writing observations</li>
          </ul>
        </div>`;
      return;
    }

    if (lastError) {
      const rateLimited = lastError.status === 403 || lastError.status === 429;
      const notFound = lastError.status === 404;
      body.innerHTML = `
        <div class="pg-state pg-error-state">
          <div class="pg-error-mark" aria-hidden="true">!</div>
          <h3>Couldn't analyze this profile</h3>
          <p>${escapeHtml(
            notFound
              ? "Invalid or missing GitHub profile."
              : lastError.message || "Try again."
          )}</p>
          ${rateLimited ? `<p>GitHub rate limit hit. Add a token in Settings.</p>` : ""}
          <div class="pg-error-actions">
            <button type="button" class="pg-btn pg-btn-primary" data-retry>Try again</button>
            <button type="button" class="pg-btn pg-btn-ghost" data-goto-settings>Settings</button>
          </div>
        </div>`;
      body.querySelector("[data-retry]")?.addEventListener("click", analyze);
      body.querySelector("[data-goto-settings]")?.addEventListener("click", () => {
        showSettings = true;
        renderBody();
      });
      return;
    }

    if (!lastPayload) {
      body.innerHTML = `<div class="pg-state"><p>Click the PokéGit button to begin.</p></div>`;
      return;
    }

    if (lastPayload.insufficient) {
      body.innerHTML = renderInsufficient(lastPayload);
      return;
    }

    if (activeTab === "profile") body.innerHTML = renderProfileTab(lastPayload);
    else if (activeTab === "repos") {
      body.innerHTML = renderReposTab(lastPayload);
      wireRepoExpands(body);
    } else if (activeTab === "code") body.innerHTML = renderCodeTab(lastPayload);
    else body.innerHTML = renderSignalsTab(lastPayload);
  }

  async function renderSettingsView(body) {
    body.innerHTML = `<div class="pg-state"><div class="pg-spinner"></div></div>`;
    await refreshKeyStatus();
    const gh = keyStatus?.github;
    const oa = keyStatus?.openai;
    const ghLocked = gh?.source === "local";
    const oaLocked = oa?.source === "local";
    const localNote = keyStatus?.usingLocalEnv
      ? `<p class="pg-keys-status">Using keys from your local .env on this machine.</p>`
      : `<p class="pg-keys-status is-warn">Paste keys below. They stay on this device only.</p>`;

    body.innerHTML = `
      <div class="pg-keys">
        <h3 class="pg-card-title">Settings</h3>
        <p class="pg-keys-lede">GitHub token helps with rate limits. OpenAI powers richer insights.</p>
        ${localNote}
        <div class="pg-field">
          <label for="pg-github">GitHub token</label>
          <input id="pg-github" type="password" autocomplete="off" placeholder="${
            ghLocked ? "Loaded from .env" : gh?.hint || "ghp_… or github_pat_…"
          }" ${ghLocked ? "disabled" : ""} />
        </div>
        <div class="pg-field">
          <label for="pg-openai">OpenAI API key</label>
          <input id="pg-openai" type="password" autocomplete="off" placeholder="${
            oaLocked ? "Loaded from .env" : oa?.hint || "sk-…"
          }" ${oaLocked ? "disabled" : ""} />
        </div>
        <div class="pg-keys-actions">
          ${
            ghLocked && oaLocked
              ? `<button type="button" class="pg-btn pg-btn-primary" data-back>Back</button>`
              : `<button type="button" class="pg-btn pg-btn-primary" data-save>Save keys</button>
                 <button type="button" class="pg-btn pg-btn-ghost" data-clear>Clear saved</button>
                 <button type="button" class="pg-btn pg-btn-ghost" data-back>Back</button>`
          }
        </div>
        <p class="pg-keys-msg" data-msg></p>
        ${renderPokeLegend()}
      </div>`;

    body.querySelector("[data-back]")?.addEventListener("click", () => {
      showSettings = false;
      renderBody();
    });
    body.querySelector("[data-clear]")?.addEventListener("click", async () => {
      const res = await chrome.runtime.sendMessage({ type: "POKEGIT_CLEAR_KEYS" });
      if (res?.ok) keyStatus = res.status;
      renderSettingsView(body);
    });
    body.querySelector("[data-save]")?.addEventListener("click", async () => {
      const msg = body.querySelector("[data-msg]");
      const githubInput = body.querySelector("#pg-github");
      const openaiInput = body.querySelector("#pg-openai");
      const payload = {};
      if (!ghLocked && githubInput) payload.githubToken = githubInput.value;
      if (!oaLocked && openaiInput) payload.openaiApiKey = openaiInput.value;
      const res = await chrome.runtime.sendMessage({ type: "POKEGIT_SAVE_KEYS", ...payload });
      if (!res?.ok) {
        if (msg) {
          msg.style.color = "#a12a0a";
          msg.textContent = res?.error || "Couldn't save.";
        }
        return;
      }
      if (githubInput) githubInput.value = "";
      if (openaiInput) openaiInput.value = "";
      showSettings = false;
      analyze();
    });
  }

  function renderScoreBars(scores, animate = true) {
    return SCORE_ROWS.map(([label, key, icon], i) => {
      const score = scores?.[key];
      const v = score == null ? 0 : Math.max(0, Math.min(10, score));
      const display = score == null ? "—" : v.toFixed(1);
      const delay = animate ? `style="--pg-i:${i}"` : "";
      return `
        <div class="pg-bar-row ${animate ? "pg-anim-bar" : ""}" ${delay}>
          <div class="pg-bar-label">${icon} ${escapeHtml(label)}</div>
          <div class="pg-bar-track"><div class="pg-bar-fill" style="width:${v * 10}%"></div></div>
          <div class="pg-bar-val">${display}</div>
        </div>`;
    }).join("");
  }

  function kindBadge(kind) {
    const k = kind || "inferred";
    const label = k === "observed" ? "Observed" : k === "uncertain" ? "Uncertain" : "Inferred";
    return `<span class="pg-kind pg-kind-${escapeAttr(k)}">${label}</span>`;
  }

  function insightItems(items) {
    if (!items?.length) return [];
    return items.map((item) => {
      if (typeof item === "string") return { text: item, kind: "inferred", evidence: [] };
      return item;
    });
  }

  function renderGlance(payload) {
    const user = payload.user;
    const glance = payload.glance || {};
    const summary = payload.summary || {};
    const headline =
      glance.headline ||
      summary.glanceHeadline ||
      user.bio?.split(/[.\n]/)[0]?.trim() ||
      "Public GitHub engineer";
    const oneLiner = glance.oneLiner || summary.oneLiner || summary.style || "";
    const strongest = glance.strongest?.length
      ? glance.strongest
      : SCORE_ROWS.slice(0, 4).map(([label, key, icon]) => ({
          label,
          key,
          icon,
          score: payload.profileScores?.[key],
        }));

    const bars = strongest
      .filter((d) => d.score != null)
      .map((d, i) => {
        const v = Math.max(0, Math.min(10, d.score));
        return `
          <div class="pg-bar-row pg-anim-bar" style="--pg-i:${i}">
            <div class="pg-bar-label">${d.icon} ${escapeHtml(d.label)}</div>
            <div class="pg-bar-track"><div class="pg-bar-fill" style="width:${v * 10}%"></div></div>
            <div class="pg-bar-val">${v.toFixed(1)}</div>
          </div>`;
      })
      .join("");

    return `
      <section class="pg-glance pg-anim-in">
        <div class="pg-glance-top">
          <img class="pg-avatar pg-avatar-sm" src="${escapeAttr(user.avatarUrl)}" alt="" width="48" height="48" />
          <div>
            <p class="pg-handle">@${escapeHtml(user.login)}</p>
            <p class="pg-glance-archetype">${escapeHtml(headline)}</p>
          </div>
        </div>
        <p class="pg-glance-label">Strongest signals</p>
        <div class="pg-bars pg-glance-bars">${bars}</div>
        ${
          oneLiner
            ? `<p class="pg-glance-quote">“${escapeHtml(oneLiner.replace(/^["“]|["”]$/g, ""))}”</p>`
            : ""
        }
      </section>`;
  }

  function renderObservations(observations = []) {
    if (!observations.length) return "";
    const cards = observations
      .map(
        (o, i) => `
        <article class="pg-obs pg-anim-fade" style="--pg-i:${i}">
          <div class="pg-obs-head">
            <span class="pg-obs-icon" aria-hidden="true">${o.icon || "✦"}</span>
            <div class="pg-obs-titles">
              <h4>${escapeHtml(o.title)}</h4>
              ${kindBadge(o.kind)}
            </div>
          </div>
          <p>${linkPokemonTerms(o.body)}</p>
          ${
            o.evidence?.length
              ? `<ul class="pg-evidence">${o.evidence
                  .map((e) => `<li><span class="pg-check">✓</span>${escapeHtml(e)}</li>`)
                  .join("")}</ul>`
              : ""
          }
        </article>`
      )
      .join("");
    return `
      <section class="pg-obs-section">
        <h3 class="pg-section-title">Interesting signals</h3>
        ${cards}
      </section>`;
  }

  function renderEvidenceBlock(evidence = []) {
    if (!evidence.length) return "";
    const rows = evidence
      .map(
        (e) => `
        <li class="${e.ok ? "is-ok" : "is-miss"}">
          <span class="pg-check">${e.ok ? "✓" : "·"}</span>
          ${escapeHtml(e.text)}
        </li>`
      )
      .join("");
    return `
      <section class="pg-evidence-block pg-anim-fade" style="--pg-i:2">
        <h3 class="pg-section-title">Why we think this</h3>
        <ul class="pg-evidence">${rows}</ul>
      </section>`;
  }

  function renderLabeledList(title, items, cls) {
    const list = insightItems(items);
    if (!list.length) return "";
    return `
      <div class="pg-flag-col ${cls}">
        <h4>${title}</h4>
        <ul>
          ${list
            .map(
              (i) => `
            <li>
              <div class="pg-flag-item">
                <div class="pg-flag-item-top">
                  ${kindBadge(i.kind)}
                  <span>${linkPokemonTerms(i.text)}</span>
                </div>
                ${
                  i.evidence?.length
                    ? `<ul class="pg-evidence pg-evidence-tight">${i.evidence
                        .map((e) => `<li><span class="pg-check">✓</span>${escapeHtml(e)}</li>`)
                        .join("")}</ul>`
                    : ""
                }
              </div>
            </li>`
            )
            .join("")}
        </ul>
      </div>`;
  }

  function renderAiCard(ai) {
    if (!ai) return "";
    return `
      <div class="pg-ai-card pg-anim-fade" style="--pg-i:3">
        <h4>🤖 AI-assisted development</h4>
        <div class="pg-ai-meta">
          <span>Signal: <strong>${escapeHtml(ai.label || ai.level)}</strong></span>
          <span>Confidence: <strong>${escapeHtml(ai.confidence || "low")}</strong></span>
        </div>
        <p>${linkPokemonTerms(ai.summary || "")}</p>
        ${
          ai.evidence?.length
            ? `<ul class="pg-ai-evidence">${ai.evidence
                .map((e) => `<li>${linkPokemonTerms(e)}</li>`)
                .join("")}</ul>`
            : ""
        }
      </div>`;
  }

  function renderInsightBlocks(summary) {
    const style = summary?.style
      ? `<p class="pg-style">${linkPokemonTerms(summary.style)}</p>`
      : "";
    return `
      ${style}
      ${summary?.unavailable ? `<p class="pg-ai-fallback">AI insights unavailable. Showing structured GitHub signals instead.</p>` : ""}
      <div class="pg-flags">
        ${renderLabeledList("Strengths", summary?.strengths, "pg-flag-green")}
        ${renderLabeledList("Interesting", summary?.interesting, "pg-flag-interesting")}
        ${renderLabeledList("Potential concerns", summary?.concerns, "pg-flag-red")}
      </div>
      ${renderAiCard(summary?.aiAssistance)}`;
  }

  function renderInsufficient(payload) {
    return `
      <div class="pg-card pg-anim-in">
        <p class="pg-handle">@${escapeHtml(payload.user.login)}</p>
        <h3 class="pg-card-title">Not enough public information</h3>
        <p class="pg-style">${escapeHtml(
          payload.insufficientReason || "Not enough public information to generate a meaningful profile."
        )}</p>
      </div>`;
  }

  function renderProfileTab(payload) {
    if (payload.insufficient) return renderInsufficient(payload);
    const { profileScores, summary, observations, evidence } = payload;
    return `
      ${renderGlance(payload)}
      ${renderObservations(observations)}
      ${renderEvidenceBlock(evidence)}
      <div class="pg-card pg-anim-fade" style="--pg-i:1">
        <h3 class="pg-card-title">Full scoreboard</h3>
        <div class="pg-bars">${renderScoreBars(profileScores)}</div>
        <p class="pg-disclaimer">${escapeHtml(DISCLAIMER)}</p>
      </div>
      <div class="pg-stands pg-anim-fade" style="--pg-i:2">
        <h3>What stands out</h3>
        ${renderInsightBlocks(summary)}
      </div>`;
  }

  function renderRepoDrilldown(item) {
    const { repo, pokemon, scores, signals, drilldown } = item;
    const dd = drilldown || {};
    const scoreRows = [
      ["Quality", scores.architecture],
      ["Testing", scores.testing],
      ["Maintenance", scores.maintenance],
      ["Complexity", scores.complexity],
    ]
      .map(
        ([label, v]) => `
        <div class="pg-mini-score">
          <span>${escapeHtml(label)}</span>
          <strong>${v == null ? "—" : Number(v).toFixed(1)}</strong>
        </div>`
      )
      .join("");

    const checks = (dd.checks || [])
      .map(
        (c) => `
        <li class="${c.ok ? "is-ok" : "is-miss"}">
          <span class="pg-check">${c.ok ? "✓" : "·"}</span>
          ${escapeHtml(c.text)}
        </li>`
      )
      .join("");

    const interesting = (dd.interesting || [])
      .map((t) => `<li>• ${escapeHtml(t)}</li>`)
      .join("");

    return `
      <div class="pg-drill">
        <p class="pg-drill-role">${escapeHtml(dd.roleGuess || repo.language || "Project")}</p>
        <div class="pg-mini-scores">${scoreRows}</div>
        <div class="pg-drill-why">
          <h4>${escapeHtml(dd.whyTitle || `Why ${pokemon.name}?`)}</h4>
          <p>${linkPokemonTerms(dd.whyBody || pokemon.why || pokemon.signal)}</p>
        </div>
        ${
          checks
            ? `<div class="pg-drill-block"><h4>Signals</h4><ul class="pg-evidence">${checks}</ul></div>`
            : ""
        }
        ${
          interesting
            ? `<div class="pg-drill-block"><h4>Interesting</h4><ul class="pg-interesting-list">${interesting}</ul></div>`
            : ""
        }
        <div class="pg-repo-foot">
          <span>★ ${repo.stargazers || 0}</span>
          <span>${escapeHtml(repo.language || "—")}</span>
          <span>Updated ${escapeHtml(relativeTime(repo.pushedAt))}</span>
          <span>Tests ${signals.hasTests ? "yes" : "no"}</span>
          <span>CI ${signals.hasCi ? "yes" : "no"}</span>
        </div>
        <a class="pg-repo-link" href="${escapeAttr(repo.htmlUrl)}" target="_blank" rel="noopener noreferrer">Open on GitHub →</a>
      </div>`;
  }

  function renderReposTab(payload) {
    const repos = payload.analyzedRepos || [];
    if (!repos.length) return `<div class="pg-empty">No repositories in this analysis.</div>`;

    const cards = repos
      .map((item, i) => {
        const { repo, pokemon } = item;
        const open = expandedRepos.has(repo.id);
        const tip = pokemon.personality
          ? `${pokemon.name}: ${pokemon.personality}`
          : `${pokemon.name}: ${pokemon.signal || pokemon.blurb}`;
        return `
          <div class="pg-repo ${open ? "is-open" : ""}" data-repo-id="${repo.id}" style="--pg-i:${i}">
            <button type="button" class="pg-repo-head" data-expand="${repo.id}" aria-expanded="${open ? "true" : "false"}">
              <div class="pg-repo-mark" data-tip="${escapeAttr(tip)}">
                <span class="pg-repo-emoji">${pokemon.emoji}</span>
                <span class="pg-tip" role="tooltip">${escapeHtml(tip)}</span>
              </div>
              <div class="pg-repo-text">
                <div class="pg-repo-title">
                  <span class="pg-repo-name">${escapeHtml(repo.name)}</span>
                  <span class="pg-repo-poke">${escapeHtml(pokemon.name)}</span>
                </div>
                <p class="pg-repo-blurb">${escapeHtml(pokemon.personality || pokemon.blurb)}</p>
                ${
                  pokemon.why
                    ? `<p class="pg-repo-why-preview">${escapeHtml(pokemon.why)}</p>`
                    : ""
                }
              </div>
              <span class="pg-repo-chevron" aria-hidden="true">${open ? "▾" : "▸"}</span>
            </button>
            <div class="pg-repo-body" ${open ? "" : "hidden"}>
              ${renderRepoDrilldown(item)}
            </div>
          </div>`;
      })
      .join("");

    return `
      <p class="pg-meta" style="margin-bottom:10px">
        Showing ${repos.length} of ${payload.repoUniverseSize ?? "?"} owned non-fork repos
        ${payload.forkCount ? ` · ${payload.forkCount} forks excluded` : ""}
      </p>
      <div class="pg-card pg-repo-card pg-anim-in">${cards}</div>`;
  }

  function wireRepoExpands(body) {
    body.querySelectorAll("[data-expand]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = Number(btn.getAttribute("data-expand"));
        const card = btn.closest(".pg-repo");
        if (!card) return;

        const opening = !expandedRepos.has(id);
        if (opening) expandedRepos.add(id);
        else expandedRepos.delete(id);

        card.classList.toggle("is-open", opening);
        btn.setAttribute("aria-expanded", opening ? "true" : "false");

        const chevron = btn.querySelector(".pg-repo-chevron");
        if (chevron) chevron.textContent = opening ? "▾" : "▸";

        const panel = card.querySelector(".pg-repo-body");
        if (panel) {
          if (opening) {
            panel.hidden = false;
            panel.classList.remove("is-collapsing");
            panel.classList.add("is-expanding");
          } else {
            panel.classList.remove("is-expanding");
            panel.hidden = true;
          }
        }
      });
    });
  }

  function renderCodeTab(payload) {
    const repos = payload.analyzedRepos || [];
    const withTests = repos.filter((r) => r.signals?.hasTests).length;
    const withCi = repos.filter((r) => r.signals?.hasCi).length;
    const withDocs = repos.filter((r) => r.signals?.hasDocs || r.signals?.hasReadme).length;
    const langs = (payload.languageSummary || [])
      .map((l) => `<span class="pg-lang-chip">${escapeHtml(l.name)} <em>${l.percent}%</em></span>`)
      .join("");

    return `
      <h3 class="pg-section-title">Code signals</h3>
      <div class="pg-card pg-anim-in">
        <div class="pg-activity">
          <div class="pg-activity-row"><span>Repos with tests</span><strong>${withTests}/${repos.length}</strong></div>
          <div class="pg-activity-row"><span>Repos with CI</span><strong>${withCi}/${repos.length}</strong></div>
          <div class="pg-activity-row"><span>Repos with README/docs</span><strong>${withDocs}/${repos.length}</strong></div>
        </div>
      </div>
      <h3 class="pg-section-title">Languages</h3>
      <div class="pg-langs">${langs || `<span class="pg-empty">No language data</span>`}</div>
      ${renderEvidenceBlock(payload.evidence || [])}`;
  }

  function renderSignalsTab(payload) {
    return `
      <div class="pg-stands">
        <h3>Insights</h3>
        ${renderObservations(payload.observations || [])}
        ${renderInsightBlocks(payload.summary)}
        ${renderEvidenceBlock(payload.evidence || [])}
      </div>`;
  }

  function syncToLocation() {
    const username = parseProfileUsername();
    if (username !== currentUsername) {
      currentUsername = username;
      lastPayload = null;
      lastError = null;
      activeTab = "profile";
      showSettings = false;
      expandedRepos = new Set();
      // Leaving a profile page should never leave the overlay up
      if (!username) closePanel();
    }
    // Only the pokéball on profile pages — nothing else until clicked
    if (username) {
      ensureFab();
      state.fab.hidden = false;
    } else if (state.fab) {
      state.fab.hidden = true;
    }
  }

  let lastHref = location.href;
  let navTimer = null;
  function onNavigated() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    // debounce SPA transitions so we don't flicker the FAB mid-nav
    clearTimeout(navTimer);
    navTimer = setTimeout(syncToLocation, 50);
  }

  const mo = new MutationObserver(() => {
    onNavigated();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // Theme only when panel is actually open
  const themeMo = new MutationObserver(() => {
    if (panelOpen) applyTheme();
  });
  themeMo.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-color-mode", "data-dark-theme"],
  });

  const _pushState = history.pushState;
  history.pushState = function (...args) {
    _pushState.apply(this, args);
    queueMicrotask(onNavigated);
  };
  const _replaceState = history.replaceState;
  history.replaceState = function (...args) {
    _replaceState.apply(this, args);
    queueMicrotask(onNavigated);
  };
  window.addEventListener("popstate", onNavigated);

  syncToLocation();
})();
