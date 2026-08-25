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

  let pageMode = null; // "profile" | "repo" | null
  let currentUsername = null;
  let currentOwner = null;
  let currentRepo = null;
  let panelOpen = false;
  let lastPayload = null;
  let lastError = null;
  let loading = false;
  let activeTab = "profile";
  let showSettings = false;
  let keyStatus = null;
  let expandedRepos = new Set();
  let historyList = [];
  let compareUsername = "";
  let compareResult = null;
  let compareLoading = false;
  let compareError = null;
  let repoSort = "interesting";
  let repoLangFilter = "all";
  let repoPokeFilter = "all";
  let loggedInUser = null;

  const NON_REPO_SECONDS = new Set([
    "followers", "following", "stars", "packages", "projects", "sponsors",
    "repositories", "achievements", "overview", "discussions", "pulse",
    "security", "settings", "wiki",
  ]);

  const state = { fab: null, host: null, shadow: null };
  let contextDead = false;

  /** False after the extension is reloaded/disabled while this tab stays open. */
  function extensionAlive() {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch {
      return false;
    }
  }

  function markContextDead() {
    if (contextDead) return;
    contextDead = true;
    panelOpen = false;
    try {
      if (state.fab) {
        state.fab.remove();
        state.fab = null;
      }
    } catch {
      state.fab = null;
    }
    try {
      if (state.host) {
        state.host.remove();
        state.host = null;
        state.shadow = null;
      }
    } catch {
      state.host = null;
      state.shadow = null;
    }
  }

  function extUrl(path) {
    if (!extensionAlive()) {
      markContextDead();
      return null;
    }
    try {
      return chrome.runtime.getURL(path);
    } catch {
      markContextDead();
      return null;
    }
  }

  async function extSend(message) {
    if (!extensionAlive()) {
      markContextDead();
      throw new Error("PokéGit was reloaded. Refresh this GitHub tab, then try again.");
    }
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (err) {
      const msg = String(err?.message || err || "");
      if (/extension context invalidated|receiving end does not exist/i.test(msg)) {
        markContextDead();
        throw new Error("PokéGit was reloaded. Refresh this GitHub tab, then try again.");
      }
      throw err;
    }
  }

  function detectLoggedInUser() {
    const meta =
      document.querySelector('meta[name="user-login"]')?.getAttribute("content") ||
      document.querySelector('meta[name="octolytics-actor-login"]')?.getAttribute("content");
    if (meta && meta.trim()) return meta.trim();
    const fromHref = document.querySelector('a[href^="/"][data-login]')?.getAttribute("data-login");
    if (fromHref) return fromHref.trim();
    return null;
  }

  function isOwnProfile() {
    loggedInUser = detectLoggedInUser();
    if (!loggedInUser || !currentUsername) return false;
    return loggedInUser.toLowerCase() === currentUsername.toLowerCase();
  }

  function parseProfileUsername(pathname = location.pathname) {
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length !== 1) return null;
    const candidate = parts[0];
    if (RESERVED.has(candidate.toLowerCase())) return null;
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(candidate)) return null;
    return candidate;
  }

  function parseRepoContext(pathname = location.pathname) {
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const [owner, repo] = parts;
    if (RESERVED.has(owner.toLowerCase())) return null;
    if (NON_REPO_SECONDS.has(repo.toLowerCase())) return null;
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(owner)) return null;
    if (!/^[A-Za-z0-9._-]+$/.test(repo)) return null;
    return { owner, repo };
  }

  function parsePageContext() {
    const username = parseProfileUsername();
    if (username) return { mode: "profile", username, owner: null, repo: null };

    // Profile subpaths that are not repositories (followers, stars, etc.)
    const parts = location.pathname.split("/").filter(Boolean);
    if (
      parts.length === 2 &&
      NON_REPO_SECONDS.has(parts[1].toLowerCase()) &&
      !RESERVED.has(parts[0].toLowerCase()) &&
      /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(parts[0])
    ) {
      return { mode: "profile", username: parts[0], owner: null, repo: null };
    }

    const r = parseRepoContext();
    if (r) return { mode: "repo", username: null, owner: r.owner, repo: r.repo };
    return { mode: null, username: null, owner: null, repo: null };
  }

  function canAnalyze() {
    if (pageMode === "profile") return Boolean(currentUsername);
    if (pageMode === "repo") return Boolean(currentOwner && currentRepo);
    return false;
  }

  function contextKey(ctx = { mode: pageMode, username: currentUsername, owner: currentOwner, repo: currentRepo }) {
    if (ctx.mode === "profile") return `profile:${(ctx.username || "").toLowerCase()}`;
    if (ctx.mode === "repo") return `repo:${(ctx.owner || "").toLowerCase()}/${(ctx.repo || "").toLowerCase()}`;
    return "none";
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

  /**
   * Escape HTML, then render a safe subset of inline markdown
   * (bold, italic, code, links). Optionally highlight Pokémon names.
   */
  function formatRichText(text, { poke = false } = {}) {
    let s = escapeHtml(text);
    // Links: [label](url) — only http(s)
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => {
      return `<a class="pg-md-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
    // Inline code
    s = s.replace(/`([^`]+)`/g, '<code class="pg-md-code">$1</code>');
    // Bold
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    // Italic
    s = s.replace(/(^|[^*])\*([^*]+)\*([^*]|$)/g, "$1<em>$2</em>$3");
    s = s.replace(/(^|[^_])_([^_]+)_([^_]|$)/g, "$1<em>$2</em>$3");
    // Stray heading markers left in prose
    s = s.replace(/^#{1,6}\s+/gm, "");
    if (poke) {
      const names = POKE_LEGEND.map((p) => p.name).sort((a, b) => b.length - a.length);
      const re = new RegExp(`\\b(${names.join("|")})\\b`, "g");
      s = s.replace(re, (match) => {
        const p = POKE_BY_NAME[match];
        if (!p) return match;
        const tip = `${p.emoji} ${p.name}: ${p.personality || p.meaning}`;
        return `<span class="pg-poke-term" tabindex="0"><span class="pg-poke-term-label">${match}</span><span class="pg-tip" role="tooltip">${escapeHtml(tip)}</span></span>`;
      });
    }
    return s;
  }

  /** Escape text, then wrap Pokémon codewords with colored hover tips. */
  function linkPokemonTerms(text) {
    return formatRichText(text, { poke: true });
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
    if (!iso) return "-";
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
    if (state.fab || contextDead) return;
    if (!extensionAlive()) {
      markContextDead();
      return;
    }

    const fab = document.createElement("button");
    fab.id = "pokegit-fab";
    fab.type = "button";
    fab.hidden = true;
    fab.setAttribute("aria-label", "Open PokéGit");
    fab.innerHTML = `<span class="pokegit-fab-mark" aria-hidden="true"></span>`;
    fab.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!extensionAlive()) {
        markContextDead();
        return;
      }
      openPanel(false);
    });
    document.documentElement.appendChild(fab);
    state.fab = fab;
  }

  /** Full panel overlay — created lazily on first open. */
  function ensurePanel() {
    if (state.host) return;
    if (!extensionAlive()) {
      markContextDead();
      return;
    }

    const fontsUrl = extUrl("src/panel/fonts.css");
    const cssUrl = extUrl("src/panel/panel.css");
    if (!fontsUrl || !cssUrl) return;

    if (!document.getElementById("pokegit-font-link")) {
      const fabFonts = document.createElement("link");
      fabFonts.id = "pokegit-font-link";
      fabFonts.rel = "stylesheet";
      fabFonts.href = fontsUrl;
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
    style.href = cssUrl;
    shadow.appendChild(style);

    const fonts = document.createElement("link");
    fonts.rel = "stylesheet";
    fonts.href = fontsUrl;
    shadow.appendChild(fonts);

    const wrap = document.createElement("div");
    wrap.className = "pokegit-shell";
    wrap.innerHTML = `
      <div class="pokegit-backdrop" data-close></div>
      <aside class="pokegit-panel" role="dialog" aria-modal="true" aria-label="PokéGit analysis" data-theme="light">
        <header class="pokegit-header">
          <div>
            <div class="pokegit-brand-name">Poké<span>Git</span></div>
            <div class="pokegit-brand-sub" data-brand-sub>a chrome extension that analyzes public github profiles.</div>
          </div>
          <div class="pokegit-header-actions">
            <button type="button" class="pokegit-icon-btn" data-settings title="Settings" aria-label="Settings">⚙</button>
            <button type="button" class="pokegit-close" data-close aria-label="Close">×</button>
          </div>
        </header>
        <nav class="pokegit-tabs" role="tablist" data-tabs>
          <button type="button" class="pokegit-tab is-active" data-tab="profile" data-mode="profile" role="tab">Profile</button>
          <button type="button" class="pokegit-tab" data-tab="repos" data-mode="profile" role="tab">Repos</button>
          <button type="button" class="pokegit-tab" data-tab="compare" data-mode="profile" role="tab">Compare</button>
          <button type="button" class="pokegit-tab" data-tab="overview" data-mode="repo" role="tab" hidden>Overview</button>
          <button type="button" class="pokegit-tab" data-tab="about" data-mode="both" role="tab">About</button>
        </nav>
        <nav class="pokegit-tabs pokegit-tabs-secondary" role="tablist" data-tabs-secondary hidden>
          <button type="button" class="pokegit-tab pokegit-tab-improve" data-tab="improvements" role="tab">Improvements</button>
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
        wrap.querySelectorAll("[data-tab]").forEach((t) =>
          t.classList.toggle("is-active", t.getAttribute("data-tab") === activeTab)
        );
        updateTabsVisibility();
        renderBody();
      });
    });

    document.addEventListener(
      "keydown",
      (e) => {
        if (!panelOpen || !state.host) return;
        const inPanel = e.composedPath().includes(state.host);
        if (!inPanel) return;

        // Keep Escape for closing; block everything else from GitHub shortcuts.
        // Shadow DOM retargets focus, so GitHub thinks keys aren't in an input.
        if (e.key === "Escape") {
          closePanel();
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
        e.stopPropagation();
      },
      true
    );
    document.addEventListener(
      "keyup",
      (e) => {
        if (!panelOpen || !state.host) return;
        if (e.composedPath().includes(state.host)) e.stopPropagation();
      },
      true
    );
    document.addEventListener(
      "keypress",
      (e) => {
        if (!panelOpen || !state.host) return;
        if (e.composedPath().includes(state.host)) e.stopPropagation();
      },
      true
    );

    document.documentElement.appendChild(host);
    state.host = host;
    state.shadow = shadow;
  }

  function updateBrandCopy() {
    const sub = state.shadow?.querySelector("[data-brand-sub]");
    if (!sub) return;
    sub.textContent =
      pageMode === "repo"
        ? "a chrome extension that analyzes public github repositories."
        : "a chrome extension that analyzes public github profiles.";
  }

  function defaultTabForMode() {
    return pageMode === "repo" ? "overview" : "profile";
  }

  function updateTabsVisibility() {
    const tabs = state.shadow?.querySelector("[data-tabs]");
    const secondary = state.shadow?.querySelector("[data-tabs-secondary]");
    if (tabs) {
      tabs.hidden = showSettings;
      tabs.querySelectorAll("[data-tab]").forEach((t) => {
        const mode = t.getAttribute("data-mode") || "both";
        let visible = !showSettings;
        if (mode === "profile") visible = visible && pageMode === "profile";
        else if (mode === "repo") visible = visible && pageMode === "repo";
        t.hidden = !visible;
        t.classList.toggle("is-active", visible && t.getAttribute("data-tab") === activeTab);
      });
    }
    const own =
      !showSettings &&
      pageMode === "profile" &&
      Boolean(lastPayload) &&
      !lastPayload.insufficient &&
      isOwnProfile();
    if (secondary) {
      secondary.hidden = !own;
      if (!own && activeTab === "improvements") {
        activeTab = defaultTabForMode();
      }
    }
    state.shadow?.querySelector("[data-settings]")?.classList.toggle("is-active", showSettings);
    updateBrandCopy();
  }

  function openPanel(forceRefresh = false) {
    if (!canAnalyze() || contextDead) return;
    if (!extensionAlive()) {
      markContextDead();
      return;
    }
    ensurePanel();
    if (!state.host) return;
    panelOpen = true;
    showSettings = false;
    activeTab = defaultTabForMode();
    applyTheme();
    updateBrandCopy();

    state.host.hidden = false;
    state.host.style.display = "block";
    state.host.style.pointerEvents = "auto";
    // next frame so CSS transition can run from closed state
    requestAnimationFrame(() => {
      state.shadow.querySelector(".pokegit-backdrop")?.classList.add("is-open");
      state.shadow.querySelector(".pokegit-panel")?.classList.add("is-open");
    });
    updateTabsVisibility();
    if (forceRefresh || (!lastPayload && !loading)) analyze(Boolean(forceRefresh));
    else renderBody();
  }

  function closePanel() {
    panelOpen = false;
    const host = state.host;
    const shadow = state.shadow;
    if (!host || !shadow) return;
    shadow.querySelector(".pokegit-backdrop")?.classList.remove("is-open");
    shadow.querySelector(".pokegit-panel")?.classList.remove("is-open");
    host.style.pointerEvents = "none";
    // fully detach overlay from paint after close animation
    window.setTimeout(() => {
      if (panelOpen) return;
      // Host may have been torn down (reload / navigation) while the timer was pending.
      if (state.host !== host) return;
      host.hidden = true;
      host.style.display = "none";
    }, 280);
  }

  async function refreshKeyStatus() {
    try {
      const res = await extSend({ type: "POKEGIT_GET_KEY_STATUS" });
      if (res?.ok) keyStatus = res.status;
    } catch {
      keyStatus = null;
    }
  }

  async function refreshHistory() {
    try {
      const res = await extSend({ type: "POKEGIT_GET_HISTORY" });
      if (res?.ok) historyList = res.history || [];
    } catch {
      /* ignore */
    }
  }

  function formatAnalyzedAt(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 36) return `${hrs}h ago`;
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  async function analyze(force = true) {
    if (!canAnalyze()) return;
    loading = true;
    lastError = null;
    showSettings = false;
    expandedRepos = new Set();
    updateTabsVisibility();
    renderBody();

    try {
      const response =
        pageMode === "repo"
          ? await extSend({
              type: "POKEGIT_ANALYZE_REPO",
              owner: currentOwner,
              repo: currentRepo,
              force: Boolean(force),
            })
          : await extSend({
              type: "POKEGIT_ANALYZE_PROFILE",
              username: currentUsername,
              force: Boolean(force),
            });
      if (!response?.ok) {
        throw Object.assign(new Error(response?.error?.message || "Analyze failed"), response?.error || {});
      }
      lastPayload = response.payload;
      await refreshKeyStatus();
      await refreshHistory();
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

  async function runCompare(force = false) {
    const right = (compareUsername || "").trim().replace(/^@/, "");
    if (!currentUsername || !right) {
      compareError = "Enter a second GitHub username.";
      renderBody();
      return;
    }
    compareLoading = true;
    compareError = null;
    renderBody();
    try {
      const res = await extSend({
        type: "POKEGIT_COMPARE_PROFILES",
        leftUsername: currentUsername,
        rightUsername: right,
        force: Boolean(force),
      });
      if (!res?.ok) throw new Error(res?.error?.message || "Compare failed");
      compareResult = res.comparison;
      await refreshHistory();
    } catch (err) {
      compareResult = null;
      compareError = err.message || "Compare failed";
    } finally {
      compareLoading = false;
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
      const subject =
        pageMode === "repo"
          ? `${escapeHtml(currentOwner)}/${escapeHtml(currentRepo)}`
          : `@${escapeHtml(currentUsername)}`;
      const steps =
        pageMode === "repo"
          ? `<li class="is-on">Fetching repository metadata</li>
            <li class="is-on">Reading README &amp; root layout</li>
            <li class="is-pulse">Scoring structure, tests &amp; AI signals</li>
            <li>Writing the breakdown</li>`
          : `<li class="is-on">Fetching public profile</li>
            <li class="is-on">Inspecting top repositories</li>
            <li class="is-pulse">Scoring signals &amp; assigning Pokémon</li>
            <li>Writing observations</li>`;
      body.innerHTML = `
        <div class="pg-state pg-loading-state">
          <div class="pg-pokeball-load" aria-hidden="true"></div>
          <h3>Analyzing ${subject}</h3>
          <ul class="pg-load-steps">${steps}</ul>
        </div>`;
      return;
    }

    if (lastError) {
      const rateLimited = lastError.status === 403 || lastError.status === 429;
      const notFound = lastError.status === 404;
      const subject = pageMode === "repo" ? "repository" : "profile";
      body.innerHTML = `
        <div class="pg-state pg-error-state">
          <div class="pg-error-mark" aria-hidden="true">!</div>
          <h3>Couldn't analyze this ${subject}</h3>
          <p>${escapeHtml(
        notFound
          ? pageMode === "repo"
            ? "Repository not found, private, or unavailable via the public API."
            : "Invalid or missing GitHub profile."
          : lastError.message || "Try again."
      )}</p>
          ${rateLimited ? `<p>GitHub rate limit hit. Add a token in Settings.</p>` : ""}
          <div class="pg-error-actions">
            <button type="button" class="pg-btn pg-btn-primary" data-retry>Try again</button>
            <button type="button" class="pg-btn pg-btn-ghost" data-goto-settings>Settings</button>
          </div>
        </div>`;
      body.querySelector("[data-retry]")?.addEventListener("click", () => analyze(true));
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

    if (pageMode === "repo" || lastPayload.mode === "repo") {
      if (activeTab === "about") {
        body.innerHTML = renderAboutTab(lastPayload);
      } else {
        body.innerHTML = renderRepoOverview(lastPayload);
        body.querySelector("[data-refresh]")?.addEventListener("click", () => analyze(true));
      }
      return;
    }

    if (activeTab === "profile") {
      body.innerHTML = renderProfileTab(lastPayload);
      body.querySelector("[data-refresh]")?.addEventListener("click", () => analyze(true));
    } else if (activeTab === "repos") {
      body.innerHTML = renderReposTab(lastPayload);
      wireRepoExpands(body);
      wireRepoFilters(body);
    } else if (activeTab === "compare") {
      body.innerHTML = renderCompareTab(lastPayload);
      wireCompare(body);
    } else if (activeTab === "improvements" && isOwnProfile()) {
      body.innerHTML = renderImprovementsTab(lastPayload);
    } else {
      body.innerHTML = renderAboutTab(lastPayload);
    }
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
          <input id="pg-github" type="password" autocomplete="off" placeholder="${ghLocked ? "Loaded from .env" : gh?.hint || "ghp_… or github_pat_…"
      }" ${ghLocked ? "disabled" : ""} />
        </div>
        <div class="pg-field">
          <label for="pg-openai">OpenAI API key</label>
          <input id="pg-openai" type="password" autocomplete="off" placeholder="${oaLocked ? "Loaded from .env" : oa?.hint || "sk-…"
      }" ${oaLocked ? "disabled" : ""} />
        </div>
        <div class="pg-keys-actions">
          ${ghLocked && oaLocked
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
      const res = await extSend({ type: "POKEGIT_CLEAR_KEYS" });
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
      const res = await extSend({ type: "POKEGIT_SAVE_KEYS", ...payload });
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
      const display = score == null ? "-" : v.toFixed(1);
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

  function renderKindLegend() {
    return `
      <p class="pg-kind-legend">
        <span class="pg-kind pg-kind-observed">Observed</span> seen in public data
        <span class="pg-kind-sep">·</span>
        <span class="pg-kind pg-kind-inferred">Inferred</span> reasoned from patterns
        <span class="pg-kind-sep">·</span>
        <span class="pg-kind pg-kind-uncertain">Uncertain</span> can't tell from GitHub alone
      </p>`;
  }

  function insightItems(items) {
    if (!items?.length) return [];
    return items.map((item) => {
      if (typeof item === "string") return { text: item, kind: "inferred", evidence: [] };
      return item;
    });
  }

  function scoreTone(score) {
    if (score == null || Number.isNaN(Number(score))) return "muted";
    const v = Number(score);
    if (v >= 7.5) return "good";
    if (v >= 5) return "mid";
    return "thin";
  }

  function renderScorePills(scores, limit = 4) {
    const rows = SCORE_ROWS.map(([label, key, icon]) => ({
      label,
      key,
      icon,
      score: scores?.[key],
    }))
      .filter((d) => d.score != null)
      .sort((a, b) => Number(b.score) - Number(a.score))
      .slice(0, limit);

    if (!rows.length) return "";
    return `
      <div class="pg-pills">
        ${rows
          .map(
            (d) => `
          <span class="pg-pill pg-pill-${scoreTone(d.score)}">
            <span class="pg-pill-icon" aria-hidden="true">${d.icon}</span>
            <span class="pg-pill-label">${escapeHtml(d.label)}</span>
            <strong>${Number(d.score).toFixed(1)}</strong>
          </span>`
          )
          .join("")}
      </div>`;
  }

  function renderSnapChips(chips = []) {
    if (!chips.length) return "";
    return `
      <div class="pg-snaps">
        ${chips
          .map(
            (c) => `
          <span class="pg-snap pg-snap-${escapeAttr(c.tone || "muted")}">
            <span class="pg-snap-k">${escapeHtml(c.label)}</span>
            <strong>${escapeHtml(c.value)}</strong>
          </span>`
          )
          .join("")}
      </div>`;
  }

  function renderHighlightItems(items, emptyText) {
    const list = insightItems(items).slice(0, 5);
    if (!list.length) {
      return emptyText ? `<p class="pg-section-lede">${escapeHtml(emptyText)}</p>` : "";
    }
    return `
      <ul class="pg-highlight-list">
        ${list
          .map(
            (i) => `
          <li>
            <span class="pg-highlight-text">${linkPokemonTerms(i.text)}</span>
            ${kindBadge(i.kind)}
          </li>`
          )
          .join("")}
      </ul>`;
  }

  function renderGlance(payload) {
    const user = payload.user;
    const glance = payload.glance || {};
    const summary = payload.summary || {};
    const headline =
      glance.headline || summary.glanceHeadline || user.name || `@${user.login}`;
    const oneLiner = (glance.oneLiner || summary.oneLiner || summary.style || "")
      .replace(/^["“]|["”]$/g, "");
    const scores = payload.profileScores || {};

    return `
      <section class="pg-glance pg-anim-in">
        <div class="pg-glance-top">
          <img class="pg-avatar pg-avatar-sm" src="${escapeAttr(user.avatarUrl)}" alt="" width="48" height="48" />
          <div class="pg-glance-id">
            <p class="pg-handle">@${escapeHtml(user.login)}</p>
            <p class="pg-glance-archetype">${escapeHtml(headline)}</p>
          </div>
        </div>
        ${
          oneLiner
            ? `<p class="pg-takeaway">${formatRichText(oneLiner)}</p>`
            : ""
        }
        <p class="pg-glance-label">Strongest public signals</p>
        ${renderScorePills(scores, 4)}
      </section>`;
  }

  function renderObservations(observations = [], opts = {}) {
    const list = (observations || []).slice(0, opts.limit || 4);
    if (!list.length) return "";
    const cards = list
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
              ? `<details class="pg-mini-details">
                  <summary>Evidence</summary>
                  <ul class="pg-evidence">${o.evidence
                    .map((e) => `<li><span class="pg-check">✓</span>${escapeHtml(e)}</li>`)
                    .join("")}</ul>
                </details>`
              : ""
          }
        </article>`
      )
      .join("");
    return `
      <section class="pg-block pg-obs-section">
        <h3 class="pg-section-title">${escapeHtml(opts.title || "What stands out")}</h3>
        <p class="pg-section-lede">${escapeHtml(
          opts.lede || "The highest-signal patterns across the public sample."
        )}</p>
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
      <details class="pg-details pg-anim-fade" style="--pg-i:2">
        <summary>Signal checklist</summary>
        <p class="pg-section-lede">Raw public checks behind the reading above.</p>
        <ul class="pg-evidence">${rows}</ul>
      </details>`;
  }

  function renderLabeledList(title, items, cls, mark) {
    const list = insightItems(items);
    if (!list.length) return "";
    return `
      <div class="pg-flag-col ${cls}">
        <h4>${title}</h4>
        <ul class="pg-highlight-list">
          ${list
            .slice(0, 5)
            .map(
              (i) => `
            <li>
              <span class="pg-flag-mark" aria-hidden="true">${mark}</span>
              <span class="pg-highlight-text">${linkPokemonTerms(i.text)}</span>
              ${kindBadge(i.kind)}
            </li>`
            )
            .join("")}
        </ul>
      </div>`;
  }

  function renderAiCard(ai) {
    if (!ai) return "";
    const level = String(ai.label || ai.level || "none");
    const tone =
      /high/i.test(level) ? "mid" : /low|none/i.test(level) ? "muted" : "mid";
    return `
      <section class="pg-block pg-ai-card pg-anim-fade" style="--pg-i:3">
        <div class="pg-ai-head">
          <h3 class="pg-section-title">AI tooling signal</h3>
          <span class="pg-pill pg-pill-${tone}"><strong>${escapeHtml(level)}</strong></span>
        </div>
        <p class="pg-meta">Confidence: ${escapeHtml(ai.confidence || "low")} · never a % of code</p>
        <p class="pg-prose">${linkPokemonTerms(ai.summary || "")}</p>
        ${
          ai.evidence?.length
            ? `<ul class="pg-ai-evidence">${ai.evidence
                .map((e) => `<li>${linkPokemonTerms(e)}</li>`)
                .join("")}</ul>`
            : `<p class="pg-section-lede">No strong public tooling markers. That does not prove AI was unused.</p>`
        }
      </section>`;
  }

  function renderRepoOverview(payload) {
    const repo = payload.repo || {};
    const pokemon = payload.pokemon || {};
    const about = payload.about || {};
    const how = payload.howToTest || {};
    const structure = payload.structure || {};
    const langs = payload.languages || [];
    const scores = payload.scores || {};
    const analyzedLabel = formatAnalyzedAt(payload.analyzedAt || payload.fetchedAt);
    const tip = pokemon.personality
      ? `${pokemon.name}: ${pokemon.personality}`
      : `${pokemon.name}: ${pokemon.signal || pokemon.blurb || ""}`;

    const goods = [];
    for (const n of structure.notes || []) {
      if (n.ok) goods.push(n.text);
    }
    for (const [label, key] of SCORE_ROWS) {
      if ((scores[key] || 0) >= 7.5) {
        goods.push(`${label} reads strong (${Number(scores[key]).toFixed(1)}/10)`);
      }
    }
    if (how.hasTests) goods.push("Automated tests are visible in the public tree");
    if (how.hasCi) goods.push("CI / Actions config is present");
    if (repo.license) goods.push(`License is clear (${repo.license})`);
    const uniqueGoods = [...new Set(goods)].slice(0, 5);

    const watch = (structure.notes || [])
      .filter((n) => !n.ok)
      .map((n) => n.text)
      .slice(0, 3);

    const commands = (how.commands || [])
      .map(
        (c) => `
        <li>
          <code class="pg-cmd">${escapeHtml(c.cmd)}</code>
          <span class="pg-cmd-via">${escapeHtml(c.via)}</span>
        </li>`
      )
      .join("");

    const langLine = langs
      .slice(0, 4)
      .map((l) => `${l.name} ${l.percent}%`)
      .join(" · ");

    const snaps = [
      {
        label: "Structure",
        value: `${structure.score ?? "-"}/10`,
        tone: scoreTone(structure.score),
      },
      {
        label: "Tests",
        value: how.hasTests ? "visible" : "not clear",
        tone: how.hasTests ? "good" : "thin",
      },
      {
        label: "CI",
        value: how.hasCi ? "configured" : "not clear",
        tone: how.hasCi ? "good" : "thin",
      },
      {
        label: "AI signal",
        value: payload.aiAssistance?.label || payload.aiAssistance?.level || "none",
        tone: "muted",
      },
    ];

    return `
      <div class="pg-repo-page pg-anim-in">
        <header class="pg-glance pg-repo-hero-card">
          <div class="pg-repo-page-hero">
            <div class="pg-repo-page-mark" data-tip="${escapeAttr(tip)}">
              <span class="pg-repo-emoji">${pokemon.emoji || "🦊"}</span>
              <span class="pg-tip" role="tooltip">${escapeHtml(tip)}</span>
            </div>
            <div class="pg-repo-page-id">
              <p class="pg-meta">
                <a class="pg-inline-link" href="${escapeAttr(
                  repo.owner?.login ? `https://github.com/${repo.owner.login}` : "#"
                )}" target="_blank" rel="noopener noreferrer">@${escapeHtml(
      repo.owner?.login || currentOwner || ""
    )}</a>
                ${repo.isFork ? " · fork" : ""}
                ${repo.archived ? " · archived" : ""}
              </p>
              <h2 class="pg-repo-page-title">${escapeHtml(repo.name || currentRepo || "")}</h2>
              <p class="pg-repo-page-poke">
                <strong>${escapeHtml(pokemon.name || "Eevee")}</strong>
                · ${escapeHtml(pokemon.personality || pokemon.blurb || "Taking shape")}
              </p>
            </div>
            <button type="button" class="pg-btn pg-btn-ghost pg-refresh" data-refresh title="Refresh analysis">↻</button>
          </div>
          <p class="pg-takeaway">${formatRichText(
            about.blurb || about.summary || repo.description || "Limited public description for this repository."
          )}</p>
          ${renderSnapChips(snaps)}
          <div class="pg-meta-bar">
            <span>
              ★ ${repo.stargazers || 0}
              · ${escapeHtml(repo.language || "Unknown")}
              · Updated ${escapeHtml(relativeTime(repo.pushedAt))}
              ${analyzedLabel ? ` · ${escapeHtml(analyzedLabel)}` : ""}
              ${payload.fromCache ? " · cached" : ""}
            </span>
          </div>
        </header>

        ${
          uniqueGoods.length
            ? `<section class="pg-block pg-block-good">
                <h3 class="pg-section-title">What looks strong</h3>
                <ul class="pg-highlight-list pg-highlight-good">
                  ${uniqueGoods
                    .map((t) => `<li><span class="pg-highlight-text">${escapeHtml(t)}</span></li>`)
                    .join("")}
                </ul>
              </section>`
            : ""
        }

        ${
          watch.length
            ? `<section class="pg-block pg-block-watch">
                <h3 class="pg-section-title">Gaps from public signals</h3>
                <ul class="pg-highlight-list pg-highlight-watch">
                  ${watch
                    .map((t) => `<li><span class="pg-highlight-text">${escapeHtml(t)}</span></li>`)
                    .join("")}
                </ul>
              </section>`
            : ""
        }

        <section class="pg-block">
          <div class="pg-repo-section-head">
            <h3 class="pg-section-title">About this repo</h3>
            ${about.fromReadme ? kindBadge("observed") : kindBadge("inferred")}
          </div>
          <p class="pg-prose">${formatRichText(
            about.summary || "Not enough README or description text to summarize."
          )}</p>
          ${
            (about.bullets || []).length
              ? `<ul class="pg-fact-list">${(about.bullets || [])
                  .slice(0, 6)
                  .map((b) => `<li>${formatRichText(b)}</li>`)
                  .join("")}</ul>`
              : ""
          }
          ${langLine ? `<p class="pg-meta" style="margin-top:10px">${escapeHtml(langLine)}</p>` : ""}
        </section>

        <section class="pg-block pg-block-action">
          <div class="pg-repo-section-head">
            <h3 class="pg-section-title">How to test it</h3>
            ${kindBadge(how.kind || "uncertain")}
          </div>
          <p class="pg-prose">${escapeHtml(how.verdict || "")}</p>
          ${
            commands
              ? `<ul class="pg-cmd-list">${commands}</ul>`
              : `<p class="pg-section-lede">No single public test command stood out. Check the README and Actions tab.</p>`
          }
          ${
            (how.workflows || []).length
              ? `<p class="pg-meta" style="margin-top:10px">Workflows: ${escapeHtml(
                  (how.workflows || []).slice(0, 4).join(", ")
                )}</p>`
              : ""
          }
        </section>

        <section class="pg-block">
          <div class="pg-repo-section-head">
            <h3 class="pg-section-title">Structure</h3>
            <span class="pg-structure-score">${escapeHtml(String(structure.score ?? "-"))}/10</span>
          </div>
          <p class="pg-prose">
            Reads as <strong>${escapeHtml(structure.label || "mixed")}</strong> from the public root layout
            ${
              structure.architectureScore != null
                ? `(architecture signal ${escapeHtml(String(structure.architectureScore))}/10)`
                : ""
            }.
          </p>
          ${renderScorePills(scores, 6)}
          ${
            (structure.rootFiles || []).length
              ? `<details class="pg-mini-details">
                  <summary>Root files seen</summary>
                  <div class="pg-langs">${(structure.rootFiles || [])
                    .slice(0, 20)
                    .map((f) => `<span class="pg-lang-chip">${escapeHtml(f)}</span>`)
                    .join("")}</div>
                </details>`
              : ""
          }
          <p class="pg-disclaimer">${escapeHtml(DISCLAIMER)}</p>
        </section>

        ${renderAiCard(payload.aiAssistance)}

        ${
          pokemon.why
            ? `<section class="pg-block">
                <h3 class="pg-section-title">Why ${escapeHtml(pokemon.name)}?</h3>
                <p class="pg-prose">${linkPokemonTerms(pokemon.why)}</p>
              </section>`
            : ""
        }

        <a class="pg-repo-link" href="${escapeAttr(
          repo.htmlUrl || `https://github.com/${currentOwner}/${currentRepo}`
        )}" target="_blank" rel="noopener noreferrer">Open on GitHub →</a>
      </div>`;
  }

  function renderInsightBlocks(summary) {
    const strengths = renderLabeledList("Good characteristics", summary?.strengths, "pg-flag-green", "+");
    const concerns = renderLabeledList("Watch outs", summary?.concerns, "pg-flag-red", "!");
    const interesting = renderLabeledList("Also interesting", summary?.interesting, "pg-flag-interesting", "·");
    const style = summary?.style
      ? `<p class="pg-prose pg-style-lead">${linkPokemonTerms(summary.style)}</p>`
      : "";
    return `
      ${style}
      ${summary?.unavailable ? `<p class="pg-ai-fallback">AI insights unavailable. Showing structured GitHub signals instead.</p>` : ""}
      <div class="pg-flags">
        ${strengths || `<p class="pg-section-lede">No clear green flags from this public sample yet.</p>`}
        ${concerns}
        ${interesting}
      </div>
      ${renderAiCard(summary?.aiAssistance)}`;
  }

  function renderInsufficient(payload) {
    return `
      <div class="pg-card pg-anim-in">
        <p class="pg-handle">@${escapeHtml(payload.user.login)}</p>
        <h3 class="pg-card-title">Not enough public information</h3>
        <p class="pg-prose">${escapeHtml(
      payload.insufficientReason || "Not enough public information to generate a meaningful profile."
    )}</p>
      </div>`;
  }

  function renderProfileTab(payload) {
    if (payload.insufficient) return renderInsufficient(payload);
    const { profileScores, summary, observations, evidence, surprises } = payload;
    const repos = payload.analyzedRepos || [];
    const withTests = repos.filter((r) => r.signals?.hasTests).length;
    const withCi = repos.filter((r) => r.signals?.hasCi).length;
    const when = formatAnalyzedAt(payload.analyzedAt || payload.fetchedAt);
    const cacheNote = payload.fromCache
      ? ` · from local cache`
      : payload.previousAnalyzedAt
        ? ` · refreshed (earlier: ${formatAnalyzedAt(payload.previousAnalyzedAt)})`
        : "";

    const topObs = [...(surprises || []), ...(observations || [])]
      .filter((o, i, arr) => arr.findIndex((x) => x.id === o.id || x.title === o.title) === i)
      .slice(0, 4);

    return `
      ${renderGlance(payload)}
      <div class="pg-meta-bar">
        <span>Analyzed ${escapeHtml(when || "just now")}${escapeHtml(cacheNote)}</span>
        <button type="button" class="pg-link-btn" data-refresh>Refresh</button>
      </div>

      <section class="pg-block pg-block-good pg-anim-fade" style="--pg-i:0">
        <h3 class="pg-section-title">Good characteristics</h3>
        <p class="pg-section-lede">Strengths visible from public repos. Not a seniority grade.</p>
        ${renderHighlightItems(summary?.strengths, "Nothing clear enough to call a strength yet.")}
      </section>

      ${renderObservations(topObs, {
        title: "What stands out",
        lede: "Highest-signal patterns with evidence you can check.",
        limit: 4,
      })}

      ${
        insightItems(summary?.concerns).length
          ? `<section class="pg-block pg-block-watch pg-anim-fade" style="--pg-i:1">
              <h3 class="pg-section-title">Watch outs</h3>
              <p class="pg-section-lede">Gaps in the public sample. Often fixable, not a verdict.</p>
              ${renderHighlightItems(summary?.concerns)}
            </section>`
          : ""
      }

      <section class="pg-block pg-anim-fade" style="--pg-i:2">
        <h3 class="pg-section-title">Score snapshot</h3>
        <p class="pg-section-lede">Experimental readings of public signals across ${repos.length} repos.</p>
        ${renderScorePills(profileScores, 6)}
        <div class="pg-activity pg-activity-compact">
          <div class="pg-activity-row"><span>Repos with tests</span><strong>${withTests}/${repos.length}</strong></div>
          <div class="pg-activity-row"><span>Repos with CI</span><strong>${withCi}/${repos.length}</strong></div>
        </div>
        <details class="pg-mini-details">
          <summary>Full score bars</summary>
          <div class="pg-bars">${renderScoreBars(profileScores, false)}</div>
          <p class="pg-disclaimer">${escapeHtml(DISCLAIMER)}</p>
        </details>
      </section>

      ${renderAiCard(summary?.aiAssistance)}

      ${
        insightItems(summary?.interesting).length
          ? `<section class="pg-block pg-anim-fade" style="--pg-i:3">
              <h3 class="pg-section-title">Also interesting</h3>
              ${renderHighlightItems(summary?.interesting)}
            </section>`
          : ""
      }

      ${
        summary?.style
          ? `<section class="pg-block">
              <h3 class="pg-section-title">AI reading</h3>
              ${renderKindLegend()}
              <p class="pg-prose">${linkPokemonTerms(summary.style)}</p>
            </section>`
          : ""
      }

      ${renderEvidenceBlock(evidence)}`;
  }

  function renderSurprises(surprises = []) {
    return renderObservations(surprises, {
      title: "Why this is interesting",
      lede: "Only shown when cross-repo patterns have real evidence.",
      limit: 3,
    });
  }

  function renderRepoDrilldown(item) {
    const { repo, pokemon, scores, signals, drilldown } = item;
    const dd = drilldown || {};
    const scoreRows = [
      ["Quality", scores.architecture],
      ["Testing", scores.testing],
      ["Maintenance", scores.maintenance],
      ["Complexity", scores.complexity],
      ["Docs", scores.documentation],
      ["Activity", scores.activity],
    ]
      .map(
        ([label, v]) => `
        <div class="pg-mini-score">
          <span>${escapeHtml(label)}</span>
          <strong>${v == null ? "-" : Number(v).toFixed(1)}</strong>
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
        <p class="pg-drill-role">${escapeHtml(dd.roleGuess || repo.language || "Project")} · “${escapeHtml(
      dd.personality || pokemon.personality || pokemon.blurb
    )}”</p>
        <div class="pg-mini-scores">${scoreRows}</div>
        <div class="pg-drill-why">
          <h4>${escapeHtml(dd.whyTitle || `Why ${pokemon.name}?`)}</h4>
          <p>${linkPokemonTerms(dd.whyBody || pokemon.why || pokemon.signal)}</p>
        </div>
        ${checks
        ? `<div class="pg-drill-block"><h4>Signals</h4><ul class="pg-evidence">${checks}</ul></div>`
        : ""
      }
        ${interesting
        ? `<div class="pg-drill-block"><h4>Interesting</h4><ul class="pg-interesting-list">${interesting}</ul></div>`
        : ""
      }
        <div class="pg-repo-foot">
          <span>★ ${repo.stargazers || 0}</span>
          <span>${escapeHtml(repo.language || "-")}</span>
          <span>Updated ${escapeHtml(relativeTime(repo.pushedAt))}</span>
          <span>Tests ${signals.hasTests ? "yes" : "no"}</span>
          <span>CI ${signals.hasCi ? "yes" : "no"}</span>
        </div>
        <a class="pg-repo-link" href="${escapeAttr(repo.htmlUrl)}" target="_blank" rel="noopener noreferrer">Open on GitHub →</a>
      </div>`;
  }

  function filterSortRepos(repos) {
    let list = [...(repos || [])];
    if (repoLangFilter !== "all") {
      list = list.filter((a) => (a.repo.language || "Other") === repoLangFilter);
    }
    if (repoPokeFilter !== "all") {
      list = list.filter((a) => a.pokemon?.name === repoPokeFilter);
    }

    const quality = (a) =>
      ((a.scores?.architecture || 0) + (a.scores?.testing || 0) + (a.scores?.maintenance || 0)) / 3;

    list.sort((a, b) => {
      if (repoSort === "stars") return (b.repo.stargazers || 0) - (a.repo.stargazers || 0);
      if (repoSort === "activity") {
        return new Date(b.repo.pushedAt) - new Date(a.repo.pushedAt);
      }
      if (repoSort === "quality") return quality(b) - quality(a);
      if (repoSort === "pokemon") {
        return String(a.pokemon?.name || "").localeCompare(String(b.pokemon?.name || ""));
      }
      // interesting: quality + activity + stars blend
      const score = (x) => {
        const days = (Date.now() - new Date(x.repo.pushedAt).getTime()) / 864e5;
        const recency = Math.max(0, 1 - days / 365);
        return quality(x) * 1.2 + Math.log10((x.repo.stargazers || 0) + 1) * 1.5 + recency * 3;
      };
      return score(b) - score(a);
    });
    return list;
  }

  function renderReposTab(payload) {
    const all = payload.analyzedRepos || [];
    if (!all.length) return `<div class="pg-empty">No repositories in this analysis.</div>`;

    const langs = [...new Set(all.map((a) => a.repo.language || "Other"))].sort();
    const pokes = [...new Set(all.map((a) => a.pokemon?.name).filter(Boolean))].sort();
    const repos = filterSortRepos(all);

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
                ${pokemon.why
            ? `<p class="pg-repo-why-preview"><span class="pg-why-label">Why ${escapeHtml(
              pokemon.name
            )}?</span> ${escapeHtml(pokemon.why)}</p>`
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

    const langOpts = langs
      .map(
        (l) =>
          `<option value="${escapeAttr(l)}" ${repoLangFilter === l ? "selected" : ""}>${escapeHtml(l)}</option>`
      )
      .join("");
    const pokeOpts = pokes
      .map(
        (p) =>
          `<option value="${escapeAttr(p)}" ${repoPokeFilter === p ? "selected" : ""}>${escapeHtml(p)}</option>`
      )
      .join("");

    return `
      <p class="pg-meta" style="margin-bottom:10px">
        ${repos.length} shown · ${all.length} analyzed of ${payload.repoUniverseSize ?? "?"} owned non-fork
        ${payload.forkCount ? ` · ${payload.forkCount} forks excluded` : ""}
      </p>
      <div class="pg-repo-filters">
        <label>Sort
          <select data-repo-sort>
            <option value="interesting" ${repoSort === "interesting" ? "selected" : ""}>Most interesting</option>
            <option value="activity" ${repoSort === "activity" ? "selected" : ""}>Activity</option>
            <option value="stars" ${repoSort === "stars" ? "selected" : ""}>Stars</option>
            <option value="quality" ${repoSort === "quality" ? "selected" : ""}>Quality signals</option>
            <option value="pokemon" ${repoSort === "pokemon" ? "selected" : ""}>Pokémon</option>
          </select>
        </label>
        <label>Language
          <select data-repo-lang>
            <option value="all">All</option>
            ${langOpts}
          </select>
        </label>
        <label>Pokémon
          <select data-repo-poke>
            <option value="all">All</option>
            ${pokeOpts}
          </select>
        </label>
      </div>
      <div class="pg-card pg-repo-card pg-anim-in">${cards || `<div class="pg-empty">No repos match these filters.</div>`}</div>`;
  }

  function wireRepoFilters(body) {
    body.querySelector("[data-repo-sort]")?.addEventListener("change", (e) => {
      repoSort = e.target.value;
      body.innerHTML = renderReposTab(lastPayload);
      wireRepoExpands(body);
      wireRepoFilters(body);
    });
    body.querySelector("[data-repo-lang]")?.addEventListener("change", (e) => {
      repoLangFilter = e.target.value;
      body.innerHTML = renderReposTab(lastPayload);
      wireRepoExpands(body);
      wireRepoFilters(body);
    });
    body.querySelector("[data-repo-poke]")?.addEventListener("change", (e) => {
      repoPokeFilter = e.target.value;
      body.innerHTML = renderReposTab(lastPayload);
      wireRepoExpands(body);
      wireRepoFilters(body);
    });
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

  function renderCompareTab(payload) {
    const historyOpts = (historyList || [])
      .filter((h) => h.login?.toLowerCase() !== currentUsername?.toLowerCase())
      .slice(0, 8)
      .map(
        (h) =>
          `<button type="button" class="pg-chip" data-compare-pick="${escapeAttr(h.login)}">@${escapeHtml(
            h.login
          )}</button>`
      )
      .join("");

    let resultHtml = "";
    if (compareLoading) {
      resultHtml = `<div class="pg-state"><div class="pg-spinner"></div><p>Comparing public signals…</p></div>`;
    } else if (compareError) {
      resultHtml = `<div class="pg-empty">${escapeHtml(compareError)}</div>`;
    } else if (compareResult) {
      const { left, right, differences, similarities, disclaimer } = compareResult;
      const diffCards = (differences || [])
        .map(
          (d) => `
          <article class="pg-obs">
            <div class="pg-obs-titles"><h4>${escapeHtml(d.title)}</h4>${kindBadge(d.kind)}</div>
            <p>${linkPokemonTerms(d.body)}</p>
            ${d.evidence?.length
              ? `<ul class="pg-evidence">${d.evidence
                .map((e) => `<li><span class="pg-check">✓</span>${escapeHtml(e)}</li>`)
                .join("")}</ul>`
              : ""
            }
          </article>`
        )
        .join("");
      const simCards = (similarities || [])
        .map(
          (d) => `
          <article class="pg-obs pg-obs-sim">
            <div class="pg-obs-titles"><h4>${escapeHtml(d.title)}</h4>${kindBadge(d.kind)}</div>
            <p>${linkPokemonTerms(d.body)}</p>
          </article>`
        )
        .join("");

      resultHtml = `
        <div class="pg-compare-heads">
          <div>
            <p class="pg-handle">@${escapeHtml(left.user.login)}</p>
            <p class="pg-glance-archetype">${escapeHtml(
        left.glance?.headline || left.summary?.glanceHeadline || "-"
      )}</p>
          </div>
          <div class="pg-compare-vs">vs</div>
          <div>
            <p class="pg-handle">@${escapeHtml(right.user.login)}</p>
            <p class="pg-glance-archetype">${escapeHtml(
        right.glance?.headline || right.summary?.glanceHeadline || "-"
      )}</p>
          </div>
        </div>
        <p class="pg-disclaimer">${escapeHtml(disclaimer)}</p>
        <h3 class="pg-section-title">Meaningful differences</h3>
        ${diffCards || `<p class="pg-section-lede">These profiles look surprisingly similar on the public sample.</p>`}
        ${simCards
          ? `<h3 class="pg-section-title" style="margin-top:16px">Where they rhyme</h3>${simCards}`
          : ""
        }`;
    }

    return `
      <div class="pg-compare pg-anim-in">
        <h3 class="pg-card-title">Compare profiles</h3>
        <p class="pg-section-lede">
          Contrast @${escapeHtml(payload.user.login)} with another public profile.
          Descriptive only. Never a "who is better" scoreboard.
        </p>
        <div class="pg-compare-form">
          <input type="text" class="pg-input" data-compare-input placeholder="GitHub username"
            value="${escapeAttr(compareUsername)}" autocomplete="off" spellcheck="false" />
          <button type="button" class="pg-btn pg-btn-primary" data-compare-run>Compare</button>
        </div>
        ${historyOpts
        ? `<p class="pg-meta" style="margin:10px 0 6px">Recent on this device</p><div class="pg-chip-row">${historyOpts}</div>`
        : ""
      }
        <div class="pg-compare-result">${resultHtml}</div>
      </div>`;
  }

  function wireCompare(body) {
    const input = body.querySelector("[data-compare-input]");
    const stopGitHubKeys = (e) => {
      e.stopPropagation();
    };
    input?.addEventListener("input", () => {
      compareUsername = input.value;
    });
    ["keydown", "keyup", "keypress"].forEach((type) => {
      input?.addEventListener(type, stopGitHubKeys);
    });
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runCompare(false);
      }
    });
    body.querySelector("[data-compare-run]")?.addEventListener("click", () => runCompare(false));
    body.querySelectorAll("[data-compare-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        compareUsername = btn.getAttribute("data-compare-pick") || "";
        runCompare(false);
      });
    });
  }

  function renderImprovementsTab(payload) {
    const pack = payload.improvements;
    if (!pack?.actions?.length) {
      return `
        <div class="pg-improve pg-anim-in">
          <div class="pg-improve-bg" aria-hidden="true"></div>
          <div class="pg-improve-inner">
            <p class="pg-improve-kicker">For @${escapeHtml(payload.user.login)} only</p>
            <h3 class="pg-improve-title">Improvements</h3>
            <p class="pg-style">Not enough public signals yet to suggest concrete next steps. Ship a little more in public, then refresh.</p>
          </div>
        </div>`;
    }

    const actions = pack.actions
      .map(
        (a, i) => `
        <article class="pg-improve-card pg-anim-fade" style="--pg-i:${i}">
          <div class="pg-improve-card-top">
            <span class="pg-improve-priority pg-priority-${escapeAttr(a.priority)}">${escapeHtml(
          a.priority
        )}</span>
            <h4>${escapeHtml(a.title)}</h4>
          </div>
          <p>${escapeHtml(a.why)}</p>
          <ol class="pg-improve-steps">
            ${(a.steps || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
          </ol>
          ${
            a.evidence?.length
              ? `<ul class="pg-evidence">${a.evidence
                  .map((e) => `<li><span class="pg-check">✓</span>${escapeHtml(e)}</li>`)
                  .join("")}</ul>`
              : ""
          }
        </article>`
      )
      .join("");

    const starters = (pack.starters || [])
      .map(
        (s, i) => `
        <article class="pg-starter-card pg-anim-fade" style="--pg-i:${i + 2}">
          <div class="pg-starter-emoji" aria-hidden="true">${s.emoji || "✦"}</div>
          <div>
            <h4>${escapeHtml(s.title)}</h4>
            <p>${escapeHtml(s.pitch)}</p>
            <p class="pg-starter-leap"><strong>Leap from:</strong> ${escapeHtml(s.leapFrom)}</p>
            <div class="pg-starter-tags">${(s.stack || [])
              .map((t) => `<span>${escapeHtml(t)}</span>`)
              .join("")}</div>
          </div>
        </article>`
      )
      .join("");

    return `
      <div class="pg-improve pg-anim-in">
        <div class="pg-improve-bg" aria-hidden="true"></div>
        <div class="pg-improve-inner">
          <p class="pg-improve-kicker">Logged in as @${escapeHtml(
            loggedInUser || payload.user.login
          )} · your public profile only</p>
          <h3 class="pg-improve-title">Improvements</h3>
          <p class="pg-improve-lede">
            Actionable ways to level up what strangers see. Based on this analysis, not private repos.
          </p>
          <h4 class="pg-improve-section">Do these next</h4>
          <div class="pg-improve-list">${actions}</div>
          <h4 class="pg-improve-section">Starter projects to leap from</h4>
          <p class="pg-section-lede">Small public projects you can spin up this week using what you already know.</p>
          <div class="pg-starter-list">${starters}</div>
        </div>
      </div>`;
  }

  function renderAboutTab(payload) {
    const rem = payload?.rateLimitRemaining;
    const isRepo = pageMode === "repo" || payload?.mode === "repo";
    return `
      <div class="pg-about pg-anim-in">
        <h3 class="pg-card-title">What PokéGit is</h3>
        <p class="pg-style">
          ${
            isRepo
              ? "a chrome extension that analyzes public github repositories (and profiles)."
              : "a chrome extension that analyzes public github profiles."
          }
        </p>
        ${renderPokeLegend()}
        <div class="pg-card" style="margin-top:16px">
          <h3 class="pg-card-title">How to read this</h3>
          ${renderKindLegend()}
          <ul class="pg-about-list">
            <li><strong>Observed</strong>: visible in public data (tests, CI, languages, push dates).</li>
            <li><strong>Inferred</strong>: a reasonable interpretation of those patterns.</li>
            <li><strong>Uncertain</strong>: public GitHub alone can’t settle it.</li>
            ${
              isRepo
                ? `<li><strong>Repo mode</strong>: blends README text with root layout, manifests, languages, and workflow files. Never a private-code audit.</li>`
                : ""
            }
          </ul>
          <p class="pg-disclaimer">${escapeHtml(DISCLAIMER)}</p>
          ${rem != null ? `<p class="pg-meta">GitHub API remaining (approx): ${escapeHtml(String(rem))}</p>` : ""}
        </div>
      </div>`;
  }

  function syncToLocation() {
    if (contextDead || !extensionAlive()) {
      markContextDead();
      return;
    }
    const ctx = parsePageContext();
    const nextKey = contextKey(ctx);
    const prevKey = contextKey();
    const changed = nextKey !== prevKey;

    if (changed) {
      pageMode = ctx.mode;
      currentUsername = ctx.username;
      currentOwner = ctx.owner;
      currentRepo = ctx.repo;
      lastPayload = null;
      lastError = null;
      activeTab = defaultTabForMode();
      showSettings = false;
      expandedRepos = new Set();
      compareResult = null;
      compareError = null;
      compareUsername = "";
      repoSort = "interesting";
      repoLangFilter = "all";
      repoPokeFilter = "all";

      if (!ctx.mode) {
        closePanel();
      } else if (panelOpen) {
        // Stay open across profile ↔ repo SPA navigation and re-analyze
        ensurePanel();
        updateTabsVisibility();
        analyze(false);
      }
    }

    if (ctx.mode) {
      ensureFab();
      if (state.fab) state.fab.hidden = false;
      if (state.shadow) updateTabsVisibility();
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
