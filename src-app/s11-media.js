// Media views and embeds: audio / image / video file views plus the generic
// "media-embed" base used for ![[...]] embeds of media files.
import { env } from "./env.js";



/** ES5-style inheritance (function + prototype), same pattern as the other own modules. */
export function s11Inherit(child, base) {
  Object.setPrototypeOf(child, base);
  child.prototype = Object.create(base.prototype, { constructor: { value: child, writable: true, configurable: true } });
}

// ---- view type names (original: EZ / SZ / QZ declarators) ----
export const s11ViewTypeAudio = "audio";
export const s11ViewTypeImage = "image";
export const s11ViewTypeVideo = "video";

/** Stops any playing media inside a container element (original: Kc helper, reached via env). */
function s11ClearMedia(el) {
  env().Kc(el);
}

// ---- AudioView (original: MZ) ----
export function s11AudioView(host) {
  function AudioView() {
    const self = host.EditableFileView.apply(this, arguments) || this;
    self.icon = "lucide-file-audio";
    return self;
  }
  s11Inherit(AudioView, host.EditableFileView);
  const proto = AudioView.prototype;
  proto.getViewType = function () { return s11ViewTypeAudio; };
  proto.canAcceptExtension = function (extension) { return host.audioExtensions.contains(extension); };
  proto.onLoadFile = async function (file) {
    const app = this.app;
    s11ClearMedia(this.contentEl);
    this.contentEl.empty();
    const container = this.contentEl.createDiv("audio-container");
    await env().Dc(container, app.vault.getResourcePath(file));
  };
  AudioView.displayInEl = function (file, app, containerEl) {
    return env().Dc(containerEl, app.vault.getResourcePath(file));
  };
  AudioView.VIEW_TYPE = s11ViewTypeAudio;
  return AudioView;
}

// ---- ImageView (original: xZ) ----
export function s11ImageView(host) {
  function ImageView() {
    const self = host.EditableFileView.apply(this, arguments) || this;
    self.icon = "lucide-image";
    return self;
  }
  s11Inherit(ImageView, host.EditableFileView);
  const proto = ImageView.prototype;
  proto.getViewType = function () { return s11ViewTypeImage; };
  proto.canAcceptExtension = function (extension) { return host.mediaExtensions.contains(extension); };
  proto.onLoadFile = async function (file) {
    const app = this.app;
    this.contentEl.empty();
    const container = this.contentEl.createDiv("image-container");
    await env().xc(container, app.vault.getResourcePath(file));
  };
  ImageView.displayInEl = function (file, app, containerEl) {
    return env().xc(containerEl, app.vault.getResourcePath(file));
  };
  ImageView.VIEW_TYPE = s11ViewTypeImage;
  return ImageView;
}

// ---- VideoView (original: XZ) ----
export function s11VideoView(host) {
  function VideoView() {
    const self = host.EditableFileView.apply(this, arguments) || this;
    self.icon = "lucide-video";
    return self;
  }
  s11Inherit(VideoView, host.EditableFileView);
  const proto = VideoView.prototype;
  proto.getViewType = function () { return s11ViewTypeVideo; };
  proto.canAcceptExtension = function (extension) { return host.videoExtensions.contains(extension); };
  proto.onLoadFile = async function (file) {
    const app = this.app;
    s11ClearMedia(this.contentEl);
    this.contentEl.empty();
    const container = this.contentEl.createDiv("video-container");
    await env().Ac(container, app.vault.getResourcePath(file));
  };
  VideoView.displayInEl = function (file, app, containerEl) {
    return env().Ac(containerEl, app.vault.getResourcePath(file));
  };
  VideoView.VIEW_TYPE = s11ViewTypeVideo;
  return VideoView;
}

// ---- MediaEmbed (original: eJ): base class for media file embeds ----
export function s11MediaEmbed(host) {
  function MediaEmbed(ctx, file) {
    const self = host.Component.call(this) || this;
    self.app = ctx.app;
    self.containerEl = ctx.containerEl;
    self.file = file;
    self.containerEl.addClass("media-embed");
    return self;
  }
  s11Inherit(MediaEmbed, host.Component);
  MediaEmbed.prototype.onunload = function () {
    s11ClearMedia(this.containerEl);
    host.Component.prototype.onunload.call(this);
  };
  s11MediaEmbedClass = MediaEmbed;
  return MediaEmbed;
}

// ---- ImageEmbed (original: tJ) ----
export function s11ImageEmbed(host) {
  function ImageEmbed(ctx, file) {
    const self = s11MediaEmbedResult().call(this, ctx, file) || this;
    self.containerEl.addClass("image-embed");
    return self;
  }
  s11Inherit(ImageEmbed, s11MediaEmbedResult());
  ImageEmbed.prototype.loadFile = function () {
    return host.ImageView.displayInEl(this.file, this.app, this.containerEl);
  };
  return ImageEmbed;
}

// ---- AudioEmbed (original: nJ) ----
export function s11AudioEmbed(host) {
  function AudioEmbed(ctx, file) {
    const self = s11MediaEmbedResult().call(this, ctx, file) || this;
    self.containerEl.addClass("audio-embed");
    return self;
  }
  s11Inherit(AudioEmbed, s11MediaEmbedResult());
  AudioEmbed.prototype.loadFile = function () {
    return host.AudioView.displayInEl(this.file, this.app, this.containerEl);
  };
  return AudioEmbed;
}

// ---- VideoEmbed (original: iJ) ----
export function s11VideoEmbed(host) {
  function VideoEmbed(ctx, file) {
    const self = s11MediaEmbedResult().call(this, ctx, file) || this;
    self.containerEl.addClass("video-embed");
    return self;
  }
  s11Inherit(VideoEmbed, s11MediaEmbedResult());
  VideoEmbed.prototype.loadFile = function () {
    return host.VideoView.displayInEl(this.file, this.app, this.containerEl);
  };
  return VideoEmbed;
}

// The media-embed base class: the factory result is cached because the embed
// subclasses' declarators always run after the base class's own.
let s11MediaEmbedClass = null;
function s11MediaEmbedResult() {
  return s11MediaEmbedClass || env().eJ;
}
