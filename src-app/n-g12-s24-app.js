// g12 clean-room: published-site search box and the standalone published-app
// bootstrap (DOM skeleton, navigation, theme, popstate, post-processing).
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { ng12PublishSite } from "./n-g12-s24-site.js";
import { ng12PublishNavView, ng12PublishOutlineView } from "./n-g12-s09-tree.js";
import { ng12PublishGraphView, ng12PublishPageView } from "./n-g12-s09-views.js";
import { extensionOf } from "./path.js";

const ng12aDoc = () => env().activeDocument || document;
const ng12aWin = () => env().activeWindow || window;

// ------------------------------------------------------------------ search
let ng12SearchClass = null;
export function ng12PublishSearch() {
  if (ng12SearchClass) return ng12SearchClass;
  const Component = env().jm;

  class Ng12Search extends Component {
    constructor(app) {
      super();
      this.app = app;
      this.containerEl = null;
      this.inputEl = null;
      this.resultsEl = null;
      this._timer = 0;
      this._results = [];
    }

    build(containerEl) {
      this.containerEl = containerEl.createDiv("search-container");
      this.inputEl = this.containerEl.createEl("input", {
        cls: "search-input",
        attr: { type: "search", placeholder: "Search" },
      });
      this.resultsEl = this.containerEl.createDiv("search-results");
      this.containerEl.hide();
      let debounce;
      this.inputEl.addEventListener("input", () => {
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this.runQuery(), 200);
      });
      this.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && this._results.length) {
          this.app.navigate(this._results[0].path, "");
        }
      });
    }

    async runQuery() {
      const query = (this.inputEl.value || "").trim();
      this.resultsEl.empty();
      this._results = [];
      if (!query) {
        this.containerEl.hide();
        return;
      }
      const site = this.app.site;
      const index = site.searchIndex || {};
      const q = query.toLowerCase();
      const scored = [];
      for (const path of Object.keys(index)) {
        const entry = index[path] || {};
        const title = String(entry.title || "").toLowerCase();
        const text = String(entry.text || "").toLowerCase();
        let score = 0;
        if (title.includes(q)) score += 10;
        if (text.includes(q)) score += 1;
        if (score > 0) scored.push({ path, score });
      }
      scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
      this._results = scored.slice(0, 20);
      for (const item of this._results) {
        const row = this.resultsEl.createDiv({ cls: "search-result", text: item.path });
        row.addEventListener("click", () => this.app.navigate(item.path, ""));
      }
      this.containerEl.show();
    }

    updateOptions() {
      const site = this.app.site;
      const show = !!(site && site.getConfig("showSearch")) && !env().Fc;
      if (this.containerEl) this.containerEl.toggleVisibility(show);
      if (this.app.containerEl) {
        this.app.containerEl.toggleClass("has-search", show);
      }
    }
  }

  ng12SearchClass = Ng12Search;
  return Ng12Search;
}

// --------------------------------------------------------------------- app
const ng12MemoryThemes = new Map();

let ng12AppClass = null;
export function ng12PublishApp() {
  if (ng12AppClass) return ng12AppClass;
  const Events = env().VT;
  const NavView = ng12PublishNavView;
  const OutlineView = ng12PublishOutlineView;
  const GraphView = ng12PublishGraphView;
  const PageView = ng12PublishPageView;
  const SearchView = ng12PublishSearch;
  const SiteClass = ng12PublishSite;

  class Ng12PublishApp {
    constructor() {
      Events.call(this);
      this.siteInfo = (typeof window !== "undefined" && window.siteInfo) || {};
      this.site = new (SiteClass)({}, this.siteInfo);
      this.containerEl = null;
      this.render = null;
      this.nav = null;
      this.outline = null;
      this.graph = null;
      this.search = null;
      this.keymap = env().Bg.init ? env().Bg.init() : null;
      this.scope = new (env().Ng)();
      this._started = false;
      this._boundPop = null;
      this._boundResize = null;
    }

    get currentFilepath() {
      return this.render ? this.render.currentFilepath : null;
    }

    async start() {
      if (this._started) return;
      this._started = true;
      const doc = ng12aDoc();
      const win = ng12aWin();

      // robots meta present from first paint
      let robots = doc.querySelector('meta[name="robots"]');
      if (!robots) {
        robots = doc.createElement("meta");
        robots.setAttribute("name", "robots");
        doc.head.appendChild(robots);
      }
      this._robotsEl = robots;
      this._updateRobots();

      this.buildDom();
      this.installHelpers();
      this.installHooks();
      await this.loadSiteData();
      this.mountViews();
      this.applyTheme();
      this.navigateFromLocation(false);
      this.trigger("ready");
    }

    _updateRobots() {
      if (!this._robotsEl) return;
      const noindex = !!(this.site && this.site.getConfig("noindex"));
      this._robotsEl.setAttribute("content", noindex || !this._firstRenderDone ? "noindex" : "index");
    }

    buildDom() {
      const doc = ng12aDoc();
      const root = (this.containerEl = env().createDiv("published-container print"));
      const body = root.createDiv("site-body");

      // left column
      const left = body.createDiv("site-body-left-column");
      const leftInner = left.createDiv("site-body-left-column-inner");
      this.logoEl = leftInner.createDiv("site-body-left-column-site-logo");
      this.nameEl = leftInner.createDiv("site-body-left-column-site-name");
      this.themeToggleEl = leftInner.createDiv("site-body-left-column-site-theme-toggle clickable-icon");
      env().tv(this.themeToggleEl, "lucide-sun-moon");
      env().Mv(this.themeToggleEl, "Toggle theme");
      this.themeToggleEl.addEventListener("click", () => this.toggleTheme());
      this.navContainerEl = leftInner.createDiv("nav-column");
      this.search = new (SearchView())(this);
      this.search.build(this.navContainerEl);

      // center column
      const center = body.createDiv("site-body-center-column");
      const header = center.createDiv("site-header");
      this.headerLogoEl = header.createDiv("site-header-logo");
      this.headerTextEl = header.createDiv("site-header-text");
      this.renderContainerEl = center.createDiv("render-container");
      this.renderInnerEl = this.renderContainerEl.createDiv("render-container-inner");
      this.footerEl = center.createDiv("site-footer");
      this.notFoundEl = center.createDiv("not-found-container");
      this.notFoundEl.setText("Page not found");

      // right column
      const right = body.createDiv("site-body-right-column");
      const rightInner = right.createDiv("site-body-right-column-inner");
      this.outlineContainerEl = rightInner.createDiv("outline-column");
      this.graphContainerEl = rightInner.createDiv("graph-column");

      doc.body.appendChild(root);
      this._updateHeaderText();
    }

    _updateHeaderText() {
      const siteName = this.site.getSiteName();
      if (this.nameEl) this.nameEl.setText(siteName);
      if (this.headerTextEl) this.headerTextEl.setText(siteName);
      const logo = this.site.getSiteLogoUrl();
      if (logo && this.logoEl) {
        const img = this.logoEl.createEl("img", { attr: { src: this.site.getPublicHref(logo) } });
        img.style.maxHeight = "40px";
      }
      if (logo && this.headerLogoEl) {
        this.headerLogoEl.createEl("img", { attr: { src: this.site.getPublicHref(logo) } });
      }
      document.title = siteName + " | Basalt Publish";
    }

    installHelpers() {
      const win = ng12aWin();
      win.publish = this;
      // single shared <style> for applyCss
      win.applyCss = (css) => {
        const doc = ng12aDoc();
        let style = doc.getElementById("basalt-publish-css");
        if (!style) {
          style = doc.createElement("style");
          style.id = "basalt-publish-css";
          style.setAttribute("type", "text/css");
          doc.head.appendChild(style);
        }
        style.textContent = css;
      };
      win.applyCssByLink = (url) => {
        const doc = ng12aDoc();
        if (doc.querySelector('link[href="' + url + '"]')) return;
        const link = doc.createElement("link");
        link.rel = "stylesheet";
        link.href = url;
        doc.head.appendChild(link);
      };
      // minimal CommonJS shim for published-site plugins
      const modules = {};
      win.require = (name) => {
        if (modules[name]) return modules[name].exports;
        const module = { exports: {} };
        modules[name] = module;
        return module.exports;
      };
      win.define = (name, deps, factory) => {
        const resolved = (deps || []).map((d) => win.require(d));
        const module = { exports: {} };
        modules[name] = module;
        const result = typeof factory === "function" ? factory(...resolved) : factory;
        if (result !== undefined) module.exports = result;
        return module.exports;
      };
    }

    installHooks() {
      const win = ng12aWin();
      this._boundPop = () => this.navigateFromLocation(true);
      win.addEventListener("popstate", this._boundPop);
      this._boundResize = () => {
        if (this.render && this.render.onResize) this.render.onResize();
        if (this.graph && this.graph.onResize) this.graph.onResize();
      };
      win.addEventListener("resize", this._boundResize);
      this.installPurifyHooks();
    }

    installPurifyHooks() {
      // DOMPurify hooks: sandbox iframes, nofollow external links
      const doc = ng12aDoc();
      const obs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.tagName === "IFRAME" && !node.hasAttribute("sandbox")) {
              node.setAttribute("sandbox", "allow-scripts");
            }
            const links = node.tagName === "A" ? [node] : node.querySelectorAll ? node.querySelectorAll("a") : [];
            for (const a of links) {
              const href = a.getAttribute("href") || "";
              const internal = href.startsWith(this.site.pathprefix);
              if (internal) a.removeAttribute("rel");
              else {
                const rel = (a.getAttribute("rel") || "")
                  .split(/\s+/).filter((t) => t && t !== "nofollow");
                rel.push("nofollow");
                a.setAttribute("rel", rel.join(" "));
              }
            }
          }
        }
      });
      obs.observe(doc.body, { childList: true, subtree: true });
      this._purifyObserver = obs;
    }

    async loadSiteData() {
      const site = this.site;
      const origin = site.origin;
      const id = site.id;
      try {
        const [cacheData, optionsData] = await Promise.all([
          env().ajaxPromise({ url: origin + "/cache/" + encodeURIComponent(id), withCredentials: true }).catch(() => null),
          env().ajaxPromise({ url: origin + "/options/" + encodeURIComponent(id), withCredentials: true }).catch(() => null),
        ]);
        if (cacheData) {
          const parsed = typeof cacheData === "string" ? JSON.parse(cacheData) : cacheData;
          const data = parsed && parsed.cache !== undefined ? parsed.cache : parsed;
          site.cache.load(data || {});
        }
        if (optionsData) {
          const parsed = typeof optionsData === "string" ? JSON.parse(optionsData) : optionsData;
          const opts = parsed && parsed.options !== undefined ? parsed.options : parsed;
          if (opts && typeof opts === "object") {
            site.options = Object.assign({}, site.options, opts);
            site.trigger("options-updated");
          }
        }
      } catch (e) {
        console.error(e);
      }
    }

    mountViews() {
      this.render = new (PageView())(this);
      this.renderInnerEl.appendChild(this.render.renderContainerEl);
      this.nav = new (NavView())(this, this.navContainerEl);
      this.outline = new (OutlineView())(this, this.outlineContainerEl);
      this.graph = new (GraphView())(this, this.graphContainerEl);
      this.search.updateOptions();
      if (this.themeToggleEl) {
        const showToggle = this.site.getConfig("showThemeToggle");
        this.themeToggleEl.toggleVisibility(showToggle);
      }
    }

    navigateFromLocation(push) {
      const win = ng12aWin();
      let pathname = win.location.pathname || "/";
      const prefix = "/" + encodeURIComponent(this.site.slug) + "/";
      let rel = pathname;
      if (this.site.customUrl) {
        // custom domain serves at root
        rel = pathname.replace(/^\/+/, "");
      } else if (pathname.indexOf(prefix) === 0) {
        rel = pathname.slice(prefix.length);
      } else {
        this.showNotFound();
        return;
      }
      rel = decodeURIComponent(rel.split("?")[0].split("#")[0]);
      const hash = win.location.hash || "";
      const subpath = hash ? hash : "";
      let path = rel || this.site.getIndexPath();
      if (!path.endsWith(".md") && this.site.cache.has(path + ".md")) path += ".md";
      const dest = this.site.cache.getLinktextDest(path, "");
      this.navigate(dest || path, "", null, subpath);
    }

    navigate(path, sourcePath, event, subpath) {
      const site = this.site;
      let resolved = path;
      if (sourcePath) {
        resolved = site.cache.getLinktextDest(path, sourcePath) || path;
      }
      resolved = resolved || site.getIndexPath();
      const publicHref = site.getPublicHref(resolved) + (subpath || "");
      const win = ng12aWin();
      try {
        win.history.pushState(null, "", publicHref);
      } catch (e) {}
      this._firstRenderDone = true;
      this._updateRobots();
      if (this.notFoundEl) this.notFoundEl.hide();
      if (this.render && this.render.loadFile) {
        this.render.loadFile(resolved, subpath || "");
      }
      if (this.nav && this.nav.onNavigated) this.nav.onNavigated();
      this.trigger("navigated");
      site.trigger("navigated");
      const title = resolved ? resolved.split("/").pop() : "";
      document.title = (title ? title.replace(/\.md$/, "") + " | " : "") + site.getSiteName() + " | Basalt Publish";
    }

    showNotFound() {
      if (this.notFoundEl) this.notFoundEl.show();
      document.title = "Page not found | " + this.site.getSiteName();
    }

    closeRenderer(view) {
      if (view && view.renderContainerEl && view.renderContainerEl.remove) {
        view.renderContainerEl.remove();
      }
    }

    toggleTheme() {
      const current = this._theme();
      const next = current === "dark" ? "light" : "dark";
      this._setTheme(next);
    }

    _theme() {
      try {
        return ng12Storage().getItem(this._themeKey()) || this.site.getConfig("defaultTheme") || "light";
      } catch (e) {
        return "light";
      }
    }

    _themeKey() {
      return this.site.slug + ":theme";
    }

    _setTheme(theme) {
      try {
        ng12Storage().setItem(this._themeKey(), theme);
      } catch (e) {}
      this.applyTheme(theme);
    }

    applyTheme(theme) {
      const t = theme || this._theme();
      const resolved = t === "system"
        ? (matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : t;
      if (this.containerEl) {
        this.containerEl.setAttribute("data-theme", resolved);
        this.containerEl.toggleClass("theme-dark", resolved === "dark");
      }
    }

    registerMarkdownPostProcessor(fn) {
      const processors = env().Gz.postProcessors || (env().Gz.postProcessors = []);
      processors.push(fn);
    }

    registerMarkdownCodeBlockProcessor(lang, fn) {
      const helper = env().Gz.createCodeBlockPostProcessor;
      if (helper) {
        const wrapped = helper(lang, fn);
        this.registerMarkdownPostProcessor(wrapped);
      }
    }
  }

  ng12AppClass = Ng12PublishApp;
  return Ng12PublishApp;
}
