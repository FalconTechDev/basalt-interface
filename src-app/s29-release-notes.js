// s29: the release-notes view (was u0 / h0).
//
// Fetches the matching "Release notes/vX.Y.md" file from the docs repository, renders its
// frontmatter date and markdown body, and offers collapsible patch-note blocks for earlier
// patch versions of the same minor series.

import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { parseVersion } from "./text.js";
import { frontmatterBounds } from "./notes-utils.js";
import { s04RawFileUrl, s04Request } from "./s04-http.js";
import { s29ReleaseNotesRepo, s29ReleaseNotesViewType } from "./s29-support.js";

function s29ParseReleaseDocument(text, host) {
  const bounds = frontmatterBounds(text);
  const frontmatter = bounds.frontmatter ? host.parseYaml(bounds.frontmatter) || {} : {};
  return { frontmatter, content: text.slice(bounds.contentStart) };
}

function s29ReleaseDate(frontmatter, i18n) {
  if (!Object.hasOwn(frontmatter, "date") || typeof frontmatter.date !== "string") return null;
  return window.moment(frontmatter.date).format("MMMM D, YYYY");
}

function s29AppendReleaseHtml(container, content, host) {
  const tree = host.markdownTree(content);
  const html = host.treeToHtml(tree);
  container.appendChild(host.sanitizeHtml(html));
}

export function defineReleaseNotesView(host) {
  const i18n = () => host.i18n.interface.releaseNotes;

  function ReleaseNotesView(app) {
    const self = host.ItemView.call(this, app) || this;
    self.canDropAnywhere = true;
    self.navigation = true;
    self.version = "";
    self.contentEl.addClass("release-notes-view");
    return self;
  }
  inherit(ReleaseNotesView, host.ItemView);
  const proto = ReleaseNotesView.prototype;

  proto.getDisplayText = function () {
    return i18n().tabTitle({ version: this.version });
  };

  proto.getViewType = function () {
    return s29ReleaseNotesViewType;
  };

  proto.getIcon = function () {
    return "lucide-book-up";
  };

  proto.getState = function () {
    const state = host.ItemView.prototype.getState.call(this);
    state.currentVersion = this.version;
    return state;
  };

  proto.setState = async function (state, eState) {
    const previous = this.version;
    await host.ItemView.prototype.setState.call(this, state, eState);
    const wanted = state.currentVersion;
    if (wanted && /^(\d+)\.(\d+)(\.\d+)?$/.test(wanted)) this.version = wanted;
    if (!this.version) this.version = env().gte;
    if (previous !== this.version) this.render();
  };

  proto.fetchReleaseNotes = async function (version) {
    const url = s04RawFileUrl(s29ReleaseNotesRepo, "Release%20notes/v" + version + ".md");
    try {
      return await s04Request({ url, throw: true }).text;
    } catch (error) {
      return error && error.status === 404
        ? i18n().msgMissingReleaseNotes({ version })
        : i18n().msgFailedToLoad({ version });
    }
  };

  proto.showPatchNotes = async function (container, version) {
    if (container.hasChildNodes()) return;
    await env().Uv(container, async () => {
      const text = await this.fetchReleaseNotes(version);
      const { frontmatter, content } = s29ParseReleaseDocument(text, host);
      const date = s29ReleaseDate(frontmatter, i18n);
      if (date) container.createEl("p", { cls: "u-small", text: i18n().msgReleaseDate({ date }) });
      s29AppendReleaseHtml(container, content, host);
    });
  };

  function patchCallout(meta, populate) {
    return createDiv("callout is-collapsed is-collapsible", (callout) => {
      callout.setAttribute("data-callout", meta.type);
      callout.createDiv({ cls: "callout-title" }, (titleEl) => {
        titleEl.createDiv({ cls: "callout-title-inner", text: meta.title });
        const fold = titleEl.createDiv("callout-fold", (icon) => host.setIcon(icon, "lucide-chevron-down"));
        titleEl.addEventListener("mousedown", (event) => event.preventDefault());
        titleEl.addEventListener("click", () => {
          const wasCollapsed = callout.hasClass("is-collapsed");
          host.collapseElement(content, !wasCollapsed, true);
          callout.toggleClass("is-collapsed", !wasCollapsed);
          fold.toggleClass("is-collapsed", !wasCollapsed);
          if (meta.onClick) meta.onClick.call(meta, content);
        });
        fold.addClass("is-collapsed");
      });
      const content = callout.createDiv("callout-content");
      if (populate) populate(content);
      content.hide();
      callout.addClass("is-collapsed");
    });
  }

  proto.render = async function () {
    const contentEl = this.contentEl;
    contentEl.empty();
    const scroller = contentEl.createDiv("cm-scroller");
    const readable = this.app.vault.getConfig("readableLineLength");
    scroller.toggleClass("is-readable-line-width", readable);
    const preview = scroller.createDiv("markdown-preview-view markdown-rendered");

    const parts = parseVersion(this.version);
    if (!parts || parts.length === 0) return;
    const series = parts.slice(0, -1);
    const lastPart = parts[parts.length - 1];

    if (lastPart > 0) {
      preview.appendChild(patchCallout({
        title: i18n().labelRelease({ version: this.version }),
        type: "attention",
        onClick: (box) => this.showPatchNotes(box, this.version),
      }));
    }
    if (lastPart > 1) {
      preview.appendChild(patchCallout({ title: "Other versions", type: "" }, (box) => {
        for (let n = lastPart - 1; n >= 0; n--) {
          const version = series.concat([n]).join(".");
          box.appendChild(patchCallout({
            title: i18n().labelRelease({ version }),
            type: "info",
            onClick: (inner) => this.showPatchNotes(inner, version),
          }));
        }
      }));
    }
    preview.createEl("hr");

    const releaseVersion = series.join(".");
    const text = await this.fetchReleaseNotes(releaseVersion);
    const { frontmatter, content } = s29ParseReleaseDocument(text, host);
    preview.createEl("h1", { text: i18n().labelRelease({ version: releaseVersion }) });
    const date = s29ReleaseDate(frontmatter, i18n);
    if (date) preview.createEl("p", { cls: "u-small", text: i18n().msgReleaseDate({ date }) });
    s29AppendReleaseHtml(preview, content, host);
    env().eb(preview, s29ReleaseNotesRepo);
    preview.createEl("section", { cls: "footnotes" }, (section) => {
      section.createEl("hr");
      section.createEl("p", { cls: "footnote", text: "A complete list of previous changes can be found on " }, (p) => {
        p.createEl("a", {
          href: "https://github.com/FalconTechDev/basalt/releases",
          text: "our changelog",
          cls: "external-link",
        });
        p.appendText(".");
      });
    });
  };

  return ReleaseNotesView;
}
