// Slice s26 — the audio and image file views plus their view-type constants.
// Both are editable file views; the media element is produced by the inherited
// display helpers (env().Dc / env().xc) into a container div.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

/** `var EZ` — view type string of the audio view. */
export const s26AudioViewType = "audio";
/** `var SZ` — view type string of the image view. */
export const s26ImageViewType = "image";

/** `var MZ` — AudioView: plays audio files through the shared audio display helper. */
export function s26AudioView(host) {
  const Base = host.EditableFileView;
  function AudioView() {
    const self = Base.apply(this, arguments) || this;
    self.icon = "lucide-file-audio";
    return self;
  }
  inherit(AudioView, Base);
  AudioView.prototype.getViewType = function () { return s26AudioViewType; };
  AudioView.prototype.canAcceptExtension = function (ext) { return host.audioExtensions.contains(ext); };
  AudioView.prototype.onLoadFile = async function (file) {
    const app = this.app;
    const el = this.contentEl;
    env().Kc(el);
    el.empty();
    const container = el.createDiv("audio-container");
    await AudioView.displayInEl(file, app, container);
  };
  AudioView.displayInEl = async function (file, app, containerEl) {
    const path = app.vault.getResourcePath(file);
    return env().Dc(containerEl, path);
  };
  AudioView.VIEW_TYPE = s26AudioViewType;
  return AudioView;
}

/** `var xZ` — ImageView: renders image files through the shared image display helper. */
export function s26ImageView(host) {
  const Base = host.EditableFileView;
  function ImageView() {
    const self = Base.apply(this, arguments) || this;
    self.icon = "lucide-image";
    return self;
  }
  inherit(ImageView, Base);
  ImageView.prototype.getViewType = function () { return s26ImageViewType; };
  ImageView.prototype.canAcceptExtension = function (ext) { return host.imageExtensions.contains(ext); };
  ImageView.prototype.onLoadFile = async function (file) {
    const app = this.app;
    const el = this.contentEl;
    el.empty();
    const container = el.createDiv("image-container");
    await ImageView.displayInEl(file, app, container);
  };
  ImageView.displayInEl = async function (file, app, containerEl) {
    const path = app.vault.getResourcePath(file);
    return env().xc(containerEl, path);
  };
  ImageView.VIEW_TYPE = s26ImageViewType;
  return ImageView;
}
