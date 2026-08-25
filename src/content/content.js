(() => {
  const RESERVED = new Set([
    "",
    "settings",
    "notifications",
    "pulls",
    "issues",
    "marketplace",
    "explore",
    "topics",
    "collections",
    "events",
    "sponsors",
    "login",
    "join",
    "logout",
    "session",
    "auth",
    "organizations",
    "orgs",
    "search",
    "about",
    "pricing",
    "features",
    "enterprise",
    "security",
    "team",
    "customer-stories",
    "readme",
    "github-copilot",
    "codespaces",
    "new",
    "account",
    "dashboard",
    "stars",
    "watching",
    "home",
    "site",
    "apps",
    "integrations",
    "nonprofit",
    "education",
  ]);

  let currentUsername = null;
  let panelOpen = false;
  let lastPayload = null;
  let lastError = null;
  let loading = false;
  let loadPhase = "";
  let activeTab = "profile"; // profile | repos | code | signals
  let showSettings = false;
  let keyStatus = null;

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

  function barUnits(score) {
    if (score == null) return 0;
    return Math.max(0, Math.min(10, score));
  }

  function relativeTime(iso) {
    if (!iso) return "—";
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
    if (days < 1) return "today";
    if (days < 30) return `${days}d ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  }

  function ensureUi() {
    if (state.host) return;

    if (!document.getElementById("pokegit-font-link")) {
      const fabFonts = document.createElement("link");
      fabFonts.id = "pokegit-font-link";
      fabFonts.rel = "stylesheet";
      fabFonts.href = chrome.runtime.getURL("src/panel/fonts.css");
      document.documentElement.appendChild(fabFonts);
    }

    const fab = document.createElement("button");
    fab.id = "pokegit-fab";
    fab.type = "button";
    fab.hidden = true;
    fab.setAttribute("aria-label", "Analyze GitHub profile with PokéGit");
    fab.innerHTML = `<span class="pokegit-fab-mark" aria-hidden="true"></span><span class="pokegit-fab-label">Analyze Profile</span>`;
    fab.addEventListener("click", () => openPanel(true));

    const host = document.createElement("div");
    host.id = "pokegit-panel-host";
    host.style.cssText = "pointer-events:none;position:fixed;inset:0;z-index:2147483646;";
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
      <aside class="pokegit-panel" role="dialog" aria-modal="true" aria-label="PokéGit analysis">
        <header class="pokegit-header">
          <div>
            <div class="pokegit-brand-name">✨ Poké<span>Git</span></div>
            <div class="pokegit-brand-sub">GitHub profile intelligence</div>
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

    wrap.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", closePanel);
    });

    wrap.querySelector("[data-settings]")?.addEventListener("click", () => {
      showSettings = !showSettings;
      wrap.querySelector("[data-settings]")?.classList.toggle("is-active", showSettings);
      updateTabsVisibility();
      renderBody();
    });

    wrap.querySelectorAll("[data-tab]").forEach((el) => {
      el.addEventListener("click", () => {
        activeTab = el.getAttribute("data-tab");
        showSettings = false;
        wrap.querySelector("[data-settings]")?.classList.remove("is-active");
        wrap.querySelectorAll("[data-tab]").forEach((t) => {
          t.classList.toggle("is-active", t === el);
        });
        updateTabsVisibility();
        renderBody();
      });
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && panelOpen) closePanel();
    });

    document.documentElement.appendChild(fab);
    document.documentElement.appendChild(host);

    state.fab = fab;
    state.host = host;
    state.shadow = shadow;
  }

  function updateTabsVisibility() {
    const tabs = state.shadow?.querySelector("[data-tabs]");
    if (!tabs) return;
    tabs.hidden = showSettings;
  }

  function setFabVisible(visible) {
    ensureUi();
    state.fab.hidden = !visible;
    if (!visible) closePanel();
  }

  function openPanel(forceRefresh = false) {
    ensureUi();
    panelOpen = true;
    showSettings = false;
    activeTab = "profile";
    state.host.style.pointerEvents = "auto";
    state.shadow.querySelector(".pokegit-backdrop")?.classList.add("is-open");
    state.shadow.querySelector(".pokegit-panel")?.classList.add("is-open");
    state.shadow.querySelector("[data-settings]")?.classList.remove("is-active");
    state.shadow.querySelectorAll("[data-tab]").forEach((t) => {
      t.classList.toggle("is-active", t.getAttribute("data-tab") === "profile");
    });
    updateTabsVisibility();

    if (forceRefresh || (!lastPayload && !loading)) {
      analyze();
    } else {
      renderBody();
    }
  }

  function closePanel() {
    panelOpen = false;
    if (!state.shadow) return;
    state.host.style.pointerEvents = "none";
    state.shadow.querySelector(".pokegit-backdrop")?.classList.remove("is-open");
    state.shadow.querySelector(".pokegit-panel")?.classList.remove("is-open");
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
    loadPhase = "Starting…";
    showSettings = false;
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
      loadPhase = "";
      renderBody();
    }
  }

  function renderBody() {
    if (!state.shadow) return;
    const body = state.shadow.querySelector("[data-body]");
    if (!body) return;

    state.shadow.querySelector("[data-settings]")?.classList.toggle("is-active", showSettings);
    updateTabsVisibility();

    if (showSettings) {
      renderSettingsView(body);
      return;
    }

    if (loading) {
      body.innerHTML = `
        <div class="pg-state">
          <div class="pg-spinner" aria-hidden="true"></div>
          <h3>Analyzing @${escapeHtml(currentUsername)}</h3>
          <p>Pulling public repos, scoring signals, assigning Pokémon, writing a short summary.</p>
          <p class="pg-phase">${escapeHtml(loadPhase)}</p>
        </div>`;
      return;
    }

    if (lastError) {
      const rateLimited = lastError.status === 403 || lastError.status === 429;
      body.innerHTML = `
        <div class="pg-state">
          <h3>Couldn’t analyze profile</h3>
          <p>${escapeHtml(lastError.message || "Unknown error")}</p>
          ${rateLimited ? `<p>GitHub rate limit hit. Add a token in Settings.</p>` : ""}
          <div class="pg-error-actions">
            <button type="button" class="pg-btn pg-btn-primary" data-retry>Retry</button>
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
      body.innerHTML = `<div class="pg-state"><p>Click Analyze Profile to begin.</p></div>`;
      return;
    }

    if (lastPayload.insufficient) {
      body.innerHTML = renderInsufficient(lastPayload);
      return;
    }

    if (activeTab === "profile") body.innerHTML = renderProfileTab(lastPayload);
    else if (activeTab === "repos") body.innerHTML = renderReposTab(lastPayload);
    else if (activeTab === "code") body.innerHTML = renderCodeTab(lastPayload);
    else body.innerHTML = renderSignalsTab(lastPayload);
  }

  async function renderSettingsView(body) {
    body.innerHTML = `<div class="pg-state"><div class="pg-spinner"></div></div>`;
    await refreshKeyStatus();

    const gh = keyStatus?.github;
    const oa = keyStatus?.openai;
    const localNote = keyStatus?.usingLocalEnv
      ? `<p class="pg-keys-status">Using keys from your local <code>.env</code>. You don't need to paste them here.</p>`
      : `<p class="pg-keys-status is-warn">No local .env detected. Paste keys below. They stay in this browser only.</p>`;

    const ghLocked = gh?.source === "local";
    const oaLocked = oa?.source === "local";

    body.innerHTML = `
      <div class="pg-keys">
        <h3 class="pg-card-title" style="margin-bottom:0">Settings</h3>
        <p class="pg-keys-lede">GitHub helps with rate limits. OpenAI powers the “What stands out” summary.</p>
        ${localNote}
        <div class="pg-field">
          <label for="pg-github">GitHub token</label>
          <input id="pg-github" type="password" autocomplete="off" placeholder="${
            ghLocked ? "Loaded from .env" : gh?.hint ? `Saved · ${escapeAttr(gh.hint)}` : "ghp_… or github_pat_…"
          }" ${ghLocked ? "disabled" : ""} />
          <p class="pg-hint">${
            ghLocked
              ? "Loaded from your local .env on this machine"
              : "Leave blank to keep the current saved token."
          }</p>
        </div>
        <div class="pg-field">
          <label for="pg-openai">OpenAI API key</label>
          <input id="pg-openai" type="password" autocomplete="off" placeholder="${
            oaLocked ? "Loaded from .env" : oa?.hint ? `Saved · ${escapeAttr(oa.hint)}` : "sk-…"
          }" ${oaLocked ? "disabled" : ""} />
          <p class="pg-hint">${
            oaLocked ? "Loaded from your local .env on this machine" : "Optional. Used for gpt-4o-mini summaries."
          }</p>
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
      </div>`;

    body.querySelector("[data-back]")?.addEventListener("click", () => {
      showSettings = false;
      renderBody();
    });

    body.querySelector("[data-clear]")?.addEventListener("click", async () => {
      const msg = body.querySelector("[data-msg]");
      const res = await chrome.runtime.sendMessage({ type: "POKEGIT_CLEAR_KEYS" });
      if (!res?.ok) {
        if (msg) {
          msg.style.color = "#a12a0a";
          msg.textContent = res?.error || "Couldn’t clear.";
        }
        return;
      }
      keyStatus = res.status;
      const ghInput = body.querySelector("#pg-github");
      const oaInput = body.querySelector("#pg-openai");
      if (ghInput) ghInput.value = "";
      if (oaInput) oaInput.value = "";
      if (msg) {
        msg.style.color = "#0f7a4f";
        msg.textContent = "Cleared device-saved keys.";
      }
      await renderSettingsView(body);
    });

    body.querySelector("[data-save]")?.addEventListener("click", async () => {
      const msg = body.querySelector("[data-msg]");
      const githubInput = body.querySelector("#pg-github");
      const openaiInput = body.querySelector("#pg-openai");
      const payload = {};
      if (!ghLocked && githubInput) payload.githubToken = githubInput.value;
      if (!oaLocked && openaiInput) payload.openaiApiKey = openaiInput.value;

      const res = await chrome.runtime.sendMessage({
        type: "POKEGIT_SAVE_KEYS",
        ...payload,
      });
      if (!res?.ok) {
        if (msg) {
          msg.style.color = "#a12a0a";
          msg.textContent = res?.error || "Couldn’t save.";
        }
        return;
      }
      keyStatus = res.status;
      // Wipe values from the DOM immediately after save
      if (githubInput) githubInput.value = "";
      if (openaiInput) openaiInput.value = "";
      if (msg) {
        msg.style.color = "#0f7a4f";
        msg.textContent = "Saved on this device. Analyzing…";
      }
      showSettings = false;
      analyze();
    });
  }

  function renderScoreBars(scores) {
    const rows = [
      ["Code Quality", scores.codeQuality],
      ["Testing", scores.testing],
      ["Maintenance", scores.maintenance],
      ["Documentation", scores.documentation],
    ];

    return rows
      .map(([label, score]) => {
        const v = barUnits(score);
        const width = score == null ? 0 : v * 10;
        const display = score == null ? "—" : v.toFixed(1);
        return `
          <div class="pg-bar-row">
            <div class="pg-bar-label">${escapeHtml(label)}</div>
            <div class="pg-bar-track"><div class="pg-bar-fill" style="width:${width}%"></div></div>
            <div class="pg-bar-val">${display}</div>
          </div>`;
      })
      .join("");
  }

  function identityBlock(user) {
    const role =
      user.bio?.split(/[.\n]/)[0]?.trim() ||
      [user.company, user.location].filter(Boolean).join(" · ") ||
      "GitHub engineer";
    return `
      <div class="pg-hero">
        <img class="pg-avatar" src="${escapeAttr(user.avatarUrl)}" alt="" width="64" height="64" />
        <div class="pg-identity">
          <p class="pg-handle">@${escapeHtml(user.login)}</p>
          <p class="pg-role">${escapeHtml(role)}</p>
          ${
            user.location || user.company
              ? `<p class="pg-meta">${escapeHtml(
                  [user.company, user.location].filter(Boolean).join(" · ")
                )}</p>`
              : ""
          }
        </div>
      </div>`;
  }

  function renderFlags(summary) {
    const greens = summary?.greens || [];
    const reds = summary?.reds || [];
    if (!greens.length && !reds.length) {
      return `<p class="pg-stands-empty">${escapeHtml(summary?.text || "No signals yet.")}</p>`;
    }
    const greenList = greens
      .map((g) => `<li><span class="pg-flag-mark" aria-hidden="true">✓</span>${escapeHtml(g)}</li>`)
      .join("");
    const redList = reds
      .map((r) => `<li><span class="pg-flag-mark" aria-hidden="true">!</span>${escapeHtml(r)}</li>`)
      .join("");
    return `
      <div class="pg-flags">
        ${
          greens.length
            ? `<div class="pg-flag-col pg-flag-green">
                <h4>Green flags</h4>
                <ul>${greenList}</ul>
              </div>`
            : ""
        }
        ${
          reds.length
            ? `<div class="pg-flag-col pg-flag-red">
                <h4>Red flags</h4>
                <ul>${redList}</ul>
              </div>`
            : ""
        }
      </div>`;
  }

  function renderInsufficient(payload) {
    return `
      ${identityBlock(payload.user)}
      <div class="pg-card">
        <h3 class="pg-card-title">Not enough public data</h3>
        <p style="margin:0;font-size:14px;line-height:1.5;color:#3d4a5c">${escapeHtml(
          payload.insufficientReason || payload.summary?.text || "Not enough public data."
        )}</p>
      </div>`;
  }

  function renderProfileTab(payload) {
    const { user, profileScores, summary } = payload;
    return `
      ${identityBlock(user)}
      <div class="pg-card">
        <h3 class="pg-card-title">Engineering Profile</h3>
        <div class="pg-bars">${renderScoreBars(profileScores)}</div>
      </div>
      <div class="pg-stands">
        <h3>What stands out</h3>
        ${renderFlags(summary)}
      </div>`;
  }

  function renderReposTab(payload) {
    const repos = payload.analyzedRepos || [];
    if (!repos.length) {
      return `<div class="pg-empty">No repositories in this analysis.</div>`;
    }

    const cards = repos
      .map((item) => {
        const { repo, pokemon, scores } = item;
        const tip = pokemon.signal || pokemon.blurb || pokemon.name;
        return `
          <a class="pg-repo" href="${escapeAttr(repo.htmlUrl)}" target="_blank" rel="noopener noreferrer">
            <div class="pg-repo-mark" data-tip="${escapeAttr(`${pokemon.name}: ${tip}`)}" tabindex="0">
              <span class="pg-repo-emoji">${pokemon.emoji}</span>
              <span class="pg-tip" role="tooltip">${escapeHtml(pokemon.name)}: ${escapeHtml(tip)}</span>
            </div>
            <div class="pg-repo-text">
              <div class="pg-repo-title">
                <span class="pg-repo-name">${escapeHtml(repo.name)}</span>
                <span class="pg-repo-poke">${escapeHtml(pokemon.name)}</span>
              </div>
              <p class="pg-repo-blurb">${escapeHtml(pokemon.blurb)}</p>
              <div class="pg-repo-foot">
                <span>★ ${repo.stargazers || 0}</span>
                <span>${escapeHtml(repo.language || "—")}</span>
                <span>${escapeHtml(relativeTime(repo.pushedAt))}</span>
                <span>Maint ${scores.maintenance}</span>
              </div>
            </div>
          </a>`;
      })
      .join("");

    return `
      <div class="pg-card" style="padding-top:6px;padding-bottom:6px">
        <div class="pg-repo-list">${cards}</div>
      </div>`;
  }

  function renderCodeTab(payload) {
    const repos = payload.analyzedRepos || [];
    const withTests = repos.filter((r) => r.signals?.hasTests).length;
    const withCi = repos.filter((r) => r.signals?.hasCi).length;
    const withDocs = repos.filter((r) => r.signals?.hasDocs || r.signals?.hasReadme).length;
    const langs = {};
    for (const item of repos) {
      const lang = item.repo.language;
      if (lang) langs[lang] = (langs[lang] || 0) + 1;
    }
    const langChips = Object.entries(langs)
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `<span class="pg-lang-chip">${escapeHtml(name)} <em>×${n}</em></span>`)
      .join("");

    const rows = repos
      .map((item) => {
        const s = item.signals || {};
        const bits = [
          s.hasTests ? "tests" : null,
          s.hasCi ? "CI" : null,
          s.hasReadme ? "README" : null,
          s.hasDocs ? "docs" : null,
        ].filter(Boolean);
        return `
          <div class="pg-activity-row">
            <span>${escapeHtml(item.repo.name)}</span>
            <strong>${bits.length ? escapeHtml(bits.join(" · ")) : "few structure signals"}</strong>
          </div>`;
      })
      .join("");

    return `
      <h3 class="pg-section-title">Code signals</h3>
      <div class="pg-card">
        <div class="pg-activity">
          <div class="pg-activity-row"><span>Repos with tests</span><strong>${withTests}/${repos.length}</strong></div>
          <div class="pg-activity-row"><span>Repos with CI</span><strong>${withCi}/${repos.length}</strong></div>
          <div class="pg-activity-row"><span>Repos with README/docs</span><strong>${withDocs}/${repos.length}</strong></div>
        </div>
      </div>
      <h3 class="pg-section-title">Languages in sample</h3>
      <div class="pg-langs">${langChips || `<span class="pg-empty">No language data</span>`}</div>
      <h3 class="pg-section-title">Per repo</h3>
      <div class="pg-card">
        <div class="pg-activity">${rows}</div>
      </div>`;
  }

  function renderSignalsTab(payload) {
    const { analyzedRepos, summary, profileScores } = payload;
    const dormant = analyzedRepos.filter((a) => a.pokemon?.name === "Snorlax").length;
    const active = analyzedRepos.filter((a) => {
      const days = (Date.now() - new Date(a.repo.pushedAt).getTime()) / (1000 * 60 * 60 * 24);
      return days < 180;
    }).length;
    const topPoke = {};
    for (const a of analyzedRepos) {
      const n = a.pokemon?.name;
      if (n) topPoke[n] = (topPoke[n] || 0) + 1;
    }
    const pokeLine = Object.entries(topPoke)
      .sort((a, b) => b[1] - a[1])
      .map(([n, c]) => `${n}×${c}`)
      .join(" · ");

    const ranked = [
      ["Maintenance", profileScores.maintenance],
      ["Testing", profileScores.testing],
      ["Code quality", profileScores.codeQuality],
      ["Documentation", profileScores.documentation],
    ].sort((a, b) => (b[1] || 0) - (a[1] || 0));

    return `
      <div class="pg-stands" style="margin-bottom:16px">
        <h3>What stands out</h3>
        ${renderFlags(summary)}
      </div>
      <h3 class="pg-section-title">Activity shape</h3>
      <div class="pg-card">
        <div class="pg-activity">
          <div class="pg-activity-row"><span>Active in last 6 months</span><strong>${active}/${analyzedRepos.length}</strong></div>
          <div class="pg-activity-row"><span>Quiet / dormant</span><strong>${dormant}</strong></div>
          <div class="pg-activity-row"><span>Strongest</span><strong>${escapeHtml(ranked[0][0])} (${ranked[0][1] ?? "—"})</strong></div>
          <div class="pg-activity-row"><span>Thinner</span><strong>${escapeHtml(ranked[ranked.length - 1][0])} (${ranked[ranked.length - 1][1] ?? "—"})</strong></div>
          <div class="pg-activity-row"><span>Party mix</span><strong>${escapeHtml(pokeLine || "—")}</strong></div>
        </div>
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
    }
    setFabVisible(Boolean(username));
  }

  let lastHref = location.href;
  const mo = new MutationObserver(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      syncToLocation();
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  const _pushState = history.pushState;
  history.pushState = function (...args) {
    _pushState.apply(this, args);
    queueMicrotask(syncToLocation);
  };
  window.addEventListener("popstate", syncToLocation);

  syncToLocation();
})();
