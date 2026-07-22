// js/ask-ai.js
// Ask AI tab of the floating assistant panel.
//
// Owns: tab switching between Ask AI / Team Chat panes, the ask flow
// (POST /api/ask-ai/ask via ServerAPI), and rendering of answers per the
// rag-brain public-assistant contract (answer, citations, disclaimer,
// humanEscalationRequired, recommendedPage, conversationId).
//
// Does NOT own: panel open/close (chat.js bindFloatPanel) or anything
// inside .chat-container (chat.js).

(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const AskAI = {
    conversationId: null,
    pending: false,

    init() {
      const panel = document.getElementById('chatFloatPanel');
      if (!panel || !document.getElementById('askAiPane')) return;
      this.bindTabs();
      this.bindForm();
      this.restoreTab();
      this.appendIntro();
    },

    // ── Tabs ────────────────────────────────────
    bindTabs() {
      const askTab = document.getElementById('fabTabAsk');
      const chatTab = document.getElementById('fabTabChat');
      if (askTab) askTab.addEventListener('click', () => this.setTab('ask'));
      if (chatTab) chatTab.addEventListener('click', () => this.setTab('chat'));
    },

    setTab(tab) {
      const panel = document.getElementById('chatFloatPanel');
      const askTab = document.getElementById('fabTabAsk');
      const chatTab = document.getElementById('fabTabChat');
      if (!panel || !askTab || !chatTab) return;

      panel.classList.toggle('tab-ask', tab === 'ask');
      panel.classList.toggle('tab-chat', tab === 'chat');
      askTab.classList.toggle('is-active', tab === 'ask');
      chatTab.classList.toggle('is-active', tab === 'chat');
      askTab.setAttribute('aria-selected', tab === 'ask' ? 'true' : 'false');
      chatTab.setAttribute('aria-selected', tab === 'chat' ? 'true' : 'false');
      Utils.setStorage('msfg_fab_tab', tab);

      if (tab === 'ask') {
        const input = document.getElementById('askAiInput');
        if (input && panel.classList.contains('is-open')) input.focus();
      }
    },

    restoreTab() {
      // Unread team-chat badge wins: the red dot promised chat content.
      // (Badge is currently never shown by chat.js — this is future-proofing.)
      const badge = document.getElementById('chatFabBadge');
      const badgeVisible = badge && badge.style.display !== 'none';
      const saved = Utils.getStorage('msfg_fab_tab', 'ask');
      this.setTab(badgeVisible ? 'chat' : (saved === 'chat' ? 'chat' : 'ask'));
    },

    // ── Ask flow ────────────────────────────────
    bindForm() {
      const form = document.getElementById('askAiForm');
      const newBtn = document.getElementById('askAiNewBtn');
      if (form) form.addEventListener('submit', (e) => { e.preventDefault(); this.send(); });
      if (newBtn) newBtn.addEventListener('click', () => this.reset());
    },

    reset() {
      this.conversationId = null;
      const list = document.getElementById('askAiMessages');
      if (list) list.innerHTML = '';
      this.appendIntro();
    },

    appendIntro() {
      const list = document.getElementById('askAiMessages');
      if (!list || list.children.length) return;
      const el = document.createElement('div');
      el.className = 'ask-ai-msg ask-ai-msg-assistant';
      el.innerHTML = '<div class="ask-ai-bubble">Hi! Ask me how to do anything in the dashboard — or where to find it.</div>';
      list.appendChild(el);
    },

    currentPageRoute() {
      // NOTE: this dashboard is a single long-scroll page (index.html) — there
      // is no client-side router and no code anywhere toggles an "active"
      // class on a section based on the current route (verified: collapsible.js
      // only toggles .collapsed for accordion state, not route). So there is no
      // real "current section" signal to read here. We fall back to the URL
      // hash (unused today, but harmless and forward-compatible if section
      // deep-linking is ever added) and otherwise send nothing rather than a
      // fabricated section id — the backend field is optional/nullable.
      const hash = (window.location.hash || '').replace(/^#/, '').trim();
      return hash || null;
    },

    async send() {
      if (this.pending) return;
      const input = document.getElementById('askAiInput');
      const question = ((input && input.value) || '').trim();
      if (!question) return;
      input.value = '';

      this.appendUser(question);
      this.setPending(true);
      try {
        const body = { question };
        const pageRoute = this.currentPageRoute();
        if (pageRoute) body.pageRoute = pageRoute;
        if (this.conversationId) body.conversationId = this.conversationId;
        const resp = await ServerAPI.post('/ask-ai/ask', body);
        this.conversationId = resp.conversationId || this.conversationId;
        this.appendAnswer(resp);
      } catch (err) {
        this.appendError((err && err.message) || 'Something went wrong. Try again.');
      } finally {
        this.setPending(false);
      }
    },

    setPending(on) {
      this.pending = on;
      const btn = document.getElementById('askAiSendBtn');
      if (btn) btn.disabled = on;

      const list = document.getElementById('askAiMessages');
      if (!list) return;
      let typing = document.getElementById('askAiTyping');
      if (on) {
        if (!typing) {
          typing = document.createElement('div');
          typing.id = 'askAiTyping';
          typing.className = 'ask-ai-msg ask-ai-msg-assistant ask-ai-typing';
          typing.innerHTML = '<div class="ask-ai-bubble">Thinking…</div>';
          list.appendChild(typing);
        }
        list.scrollTop = list.scrollHeight;
      } else if (typing) {
        typing.remove();
      }
    },

    // ── Rendering ───────────────────────────────
    appendUser(text) {
      const list = document.getElementById('askAiMessages');
      if (!list) return;
      const el = document.createElement('div');
      el.className = 'ask-ai-msg ask-ai-msg-user';
      el.innerHTML = '<div class="ask-ai-bubble">' + esc(text) + '</div>';
      list.appendChild(el);
      list.scrollTop = list.scrollHeight;
    },

    appendError(message) {
      const list = document.getElementById('askAiMessages');
      if (!list) return;
      const el = document.createElement('div');
      el.className = 'ask-ai-msg ask-ai-msg-assistant ask-ai-error';
      el.innerHTML = '<div class="ask-ai-bubble">' + esc(message) + '</div>';
      list.appendChild(el);
      list.scrollTop = list.scrollHeight;
    },

    appendAnswer(resp) {
      const list = document.getElementById('askAiMessages');
      if (!list) return;
      const el = document.createElement('div');
      el.className = 'ask-ai-msg ask-ai-msg-assistant';

      const paragraphs = String(resp.answer || 'No answer returned.')
        .split(/\n{2,}/)
        .map((p) => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>')
        .join('');

      let html = '<div class="ask-ai-bubble">' + paragraphs;

      if (resp.humanEscalationRequired) {
        html += '<div class="ask-ai-escalation"><i class="fas fa-user-friends"></i> Worth confirming with a teammate — I\'m not fully sure on this one.</div>';
      }
      if (resp.recommendedPage) {
        html += '<button type="button" class="btn btn-sm btn-primary ask-ai-goto" data-page="' + esc(resp.recommendedPage) + '"><i class="fas fa-arrow-right"></i> Take me there</button>';
      }
      if (Array.isArray(resp.citations) && resp.citations.length) {
        const items = resp.citations.map((c) => {
          const parts = [c.source_name, c.document_name, c.section]
            .filter(Boolean)
            .map((v) => esc(String(v).replace(/\n/g, ' ')));
          return parts.length ? '<li>' + parts.join(' — ') + '</li>' : '';
        }).filter(Boolean).join('');
        if (items) {
          html += '<details class="ask-ai-citations"><summary>Sources</summary><ul>' + items + '</ul></details>';
        }
      }
      if (resp.disclaimer) {
        html += '<div class="ask-ai-disclaimer">' + esc(resp.disclaimer) + '</div>';
      }
      html += '</div>';
      el.innerHTML = html;

      const goto = el.querySelector('.ask-ai-goto');
      if (goto) goto.addEventListener('click', () => this.goTo(goto.getAttribute('data-page')));

      list.appendChild(el);
      list.scrollTop = list.scrollHeight;
    },

    goTo(page) {
      const id = String(page || '').replace(/^#/, '').trim();
      if (!id) return;
      // No client-side router exists on this dashboard (single long-scroll
      // page), and recommendedPage is a short engine slug (e.g. "pipeline"
      // per backend/tests/services/askAi.service.test.js) rather than a DOM
      // id — real section ids follow a "<slug>Section" convention (e.g.
      // #pipelineSection). Try both forms and scroll into view; otherwise
      // fall back to a hash change (harmless no-op today, forward-compatible
      // if section deep-linking is ever added).
      const target = document.getElementById(id) || document.getElementById(id + 'Section');
      if (target && typeof target.scrollIntoView === 'function') {
        // Instant (not smooth) — smooth scrolling silently no-ops in some
        // embedded/throttled browser contexts, and a jump is always visible.
        target.scrollIntoView({ block: 'start' });
      } else {
        window.location.hash = id;
      }
    },
  };

  window.AskAI = AskAI;
})();
