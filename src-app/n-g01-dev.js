// g01 clean-room: desktop developer commands — devtools, eval, CDP, DOM/CSS,
// console/error capture, screenshot, mobile emulation, app control.
import { ng01Clock, ng01Stamp, ng01WebContents, ng01IsFsAdapter } from "./n-g01-util.js";

const NG01_CONSOLE_RING = 200;
const NG01_ERROR_RING = 50;
const NG01_TYPO_PROPS = ["color", "font-family", "font-size", "font-weight", "line-height", "text-align"];
const NG01_CSS_DUMP_PROPS = ["display", "position", "width", "height", "margin", "padding", "color", "background-color", "font-family", "font-size", "font-weight", "border", "flex", "grid", "opacity", "visibility", "z-index"];

export function ng01RegisterDev(cli, host) {
  const app = cli.app;

  // ------------------------------------------------------------ capture state

  const consoleBuf = [];
  const errorBuf = [];
  let debuggerAttached = false;
  let consoleCapturing = false;
  let inspectDomainsEnabled = false;

  const pushBounded = (buf, entry, max) => {
    buf.push(entry);
    if (buf.length > max) buf.splice(0, buf.length - max);
  };

  const onDebuggerMessage = (event, method, params) => {
    if (method !== "Runtime.consoleAPICalled" || !params) return;
    let level = params.type || "log";
    if (level === "warning") level = "warn";
    const parts = (params.args || []).map((a) => {
      if (a.type === "undefined") return "undefined";
      if (a.type === "string") return a.value;
      if (a.value !== undefined) return String(a.value);
      if (a.preview) {
        const props = a.preview.properties || [];
        if (props.length) return "{" + props.map((p) => p.name + ": " + (p.value !== undefined ? p.value : "…")).join(", ") + "}";
      }
      return a.description || a.type || "";
    });
    pushBounded(consoleBuf, { ts: Date.now(), level, message: parts.join(" ") }, NG01_CONSOLE_RING);
  };

  const wc = () => ng01WebContents();

  const ensureDebugger = async () => {
    const contents = wc();
    if (!contents) throw "No web contents available.";
    if (!debuggerAttached) {
      try { contents.debugger.attach("1.3"); } catch (e) { /* already attached */ }
      contents.debugger.on("message", onDebuggerMessage);
      debuggerAttached = true;
    }
    return contents.debugger;
  };

  const sendCdp = async (method, params) => {
    const dbg = await ensureDebugger();
    return dbg.sendCommand(method, params || {});
  };

  const startCapture = async () => {
    await sendCdp("Runtime.enable");
    await sendCdp("DOM.enable");
    await sendCdp("CSS.enable");
    inspectDomainsEnabled = true;
    consoleCapturing = true;
  };

  const ensureInspectDomains = async () => {
    await ensureDebugger();
    if (!inspectDomainsEnabled) {
      const dbg = wc().debugger;
      await dbg.sendCommand("DOM.enable", {});
      await dbg.sendCommand("CSS.enable", {});
      inspectDomainsEnabled = true;
    }
  };

  // window error + unhandledrejection capture (always on for desktop)
  window.addEventListener("error", (e) => {
    pushBounded(errorBuf, { ts: Date.now(), message: e.message || "Unknown error", stack: e.error && e.error.stack ? e.error.stack : "" }, NG01_ERROR_RING);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    pushBounded(errorBuf, { ts: Date.now(), message: reason && reason.message ? reason.message : String(reason), stack: reason && reason.stack ? reason.stack : "" }, NG01_ERROR_RING);
  });

  // ------------------------------------------------------------ app control

  cli.registerHandler("devtools", "Toggle developer tools", null, () => {
    const contents = wc();
    if (!contents) throw "No web contents available.";
    if (contents.isDevToolsOpened && contents.isDevToolsOpened()) contents.closeDevTools();
    else contents.openDevTools();
    return "Toggled dev tools.";
  });

  cli.registerHandler("reload", "Reload the app", null, () => {
    setTimeout(() => window.location.reload(), 10);
    return "Reloading...";
  });

  cli.registerHandler("restart", "Restart the app", null, () => {
    if (window.electron && window.electron.ipcRenderer) {
      try { window.electron.ipcRenderer.sendSync("relaunch"); } catch (e) {}
      setTimeout(() => window.location.reload(), 100);
    } else {
      setTimeout(() => window.location.reload(), 10);
    }
    return "Restarting...";
  });

  // ------------------------------------------------------------ eval

  cli.registerHandler("eval", "Evaluate JavaScript", {
    code: { value: "<js>", description: "JavaScript to evaluate", required: true },
  }, async (args) => {
    const lines = [];
    const origLog = console.log, origWarn = console.warn, origError = console.error;
    const fmtArg = (a) => {
      if (typeof a === "string") return a;
      try { return JSON.stringify(a); } catch (e) { return String(a); }
    };
    console.log = (...a) => lines.push(a.map(fmtArg).join(" "));
    console.warn = (...a) => lines.push("[warn] " + a.map(fmtArg).join(" "));
    console.error = (...a) => lines.push("[error] " + a.map(fmtArg).join(" "));
    let result;
    let evalError = null;
    try {
      result = window.eval(String(args.code));
    } catch (e) {
      evalError = e;
    } finally {
      console.log = origLog; console.warn = origWarn; console.error = origError;
    }
    if (evalError) lines.push("Error: " + (evalError.message || String(evalError)));
    else if (result !== undefined) {
      if (result === null) lines.push("=> null");
      else if (typeof result === "object") lines.push("=> " + JSON.stringify(result, null, 2));
      else lines.push("=> " + String(result));
    }
    if (lines.length === 0) return "(no output)";
    return lines.join("\n");
  });

  // ------------------------------------------------------------ mobile

  cli.registerHandler("dev:mobile", "Toggle mobile emulation", {
    on: { description: "Enable emulation" },
    off: { description: "Disable emulation" },
  }, (args) => {
    const current = !!localStorage.getItem("EmulateMobile");
    let target;
    if (args.on !== undefined) target = true;
    else if (args.off !== undefined) target = false;
    else target = !current;
    if (target === current) return `Mobile emulation is already ${target ? "enabled" : "disabled"}.`;
    app.emulateMobile(target);
    return `Mobile emulation ${target ? "enabled" : "disabled"}. Reloading...`;
  });

  // ------------------------------------------------------------ debugger

  cli.registerHandler("dev:debug", "Attach/detach debugger", {
    on: { description: "Attach and start capture" },
    off: { description: "Detach and stop capture" },
  }, async (args) => {
    const contents = wc();
    if (!contents) throw "No web contents available.";
    if (args.off !== undefined) {
      if (!debuggerAttached) return "Debugger is already detached.";
      try { contents.debugger.detach(); } catch (e) {}
      debuggerAttached = false;
      consoleCapturing = false;
      inspectDomainsEnabled = false;
      consoleBuf.length = 0;
      return "Debugger detached.";
    }
    if (args.on !== undefined) {
      if (debuggerAttached) return "Debugger is already attached.";
      await startCapture();
      return "Debugger attached.";
    }
    return debuggerAttached ? "Debugger is attached." : "Debugger is detached.";
  });

  // ------------------------------------------------------------ errors

  cli.registerHandler("dev:errors", "Recent errors", {
    clear: { description: "Clear the buffer" },
  }, (args) => {
    if (args.clear !== undefined) {
      const n = errorBuf.length;
      errorBuf.length = 0;
      return `Cleared ${n} errors.`;
    }
    if (errorBuf.length === 0) return "No errors captured.";
    return errorBuf.map((e) => ng01Clock(e.ts) + " " + e.message + (e.stack ? "\n" + e.stack : "")).join("\n");
  });

  // ------------------------------------------------------------ console

  cli.registerHandler("dev:console", "Captured console output", {
    clear: { description: "Clear the buffer" },
    limit: { value: "<n>", description: "Max entries (default 50)" },
    level: { value: "<lvl>", description: "Filter by level" },
  }, (args) => {
    if (!debuggerAttached) throw 'Debugger not attached. Use "dev:debug on" to attach the debugger first.';
    if (args.clear !== undefined) {
      const n = consoleBuf.length;
      consoleBuf.length = 0;
      return `Cleared ${n} console messages.`;
    }
    let limit = args.limit !== undefined ? parseInt(args.limit, 10) : 50;
    if (isNaN(limit) || limit < 1) limit = 50;
    const level = args.level !== undefined ? String(args.level) : "";
    const entries = consoleBuf.filter((e) => !level || e.level === level);
    const shown = entries.slice(-limit);
    if (shown.length === 0) return "No console messages.";
    return shown.map((e) => {
      const tag = e.level === "log" ? "" : ` [${e.level.toUpperCase()}]`;
      return `${ng01Clock(e.ts)}${tag} ${e.message}`;
    }).join("\n");
  });

  // ------------------------------------------------------------ cdp

  cli.registerHandler("dev:cdp", "Send a CDP command", {
    method: { value: "<method>", description: "CDP method name", required: true },
    params: { value: "<json>", description: "JSON parameters" },
  }, async (args) => {
    let params = {};
    if (args.params !== undefined) {
      try { params = JSON.parse(String(args.params)); }
      catch (e) { throw `Invalid params JSON: ${e.message}`; }
    }
    const result = await sendCdp(String(args.method), params);
    return JSON.stringify(result, null, 2);
  });

  // ------------------------------------------------------------ screenshot

  cli.registerHandler("dev:screenshot", "Capture a screenshot", {
    path: { value: "<file>", description: "Output path (vault-relative or absolute)" },
  }, async (args) => {
    const contents = wc();
    if (!contents || !contents.capturePage) throw "Screenshots are only available on desktop.";
    const image = await contents.capturePage();
    const png = image.toPNG();
    let target;
    if (args.path !== undefined && ng01IsFsAdapter(app)) {
      const nodePath = window.require("path");
      target = nodePath.isAbsolute(String(args.path)) ? String(args.path) : nodePath.join(app.vault.adapter.getBasePath(), String(args.path));
    } else {
      const nodePath = window.require("path");
      const nodeOs = window.require("os");
      const stamp = ng01Stamp(Date.now()).replace(/[:]/g, "-");
      target = nodePath.join(nodeOs.tmpdir(), `basalt-screenshot-${stamp}.png`);
    }
    const ofs = window.require("original-fs");
    await ofs.promises.mkdir(nodeDirname(target), { recursive: true });
    await ofs.promises.writeFile(target, png);
    return target;
  });

  function nodeDirname(p) { return window.require("path").dirname(p); }

  // ------------------------------------------------------------ css / dom

  cli.registerHandler("dev:css", "Inspect matched CSS for a selector", {
    selector: { value: "<css>", description: "CSS selector", required: true },
    prop: { value: "<name>", description: "Only this property" },
  }, async (args) => {
    const selector = String(args.selector);
    await ensureInspectDomains();
    const doc = await sendCdp("DOM.getDocument", { depth: 1 });
    let nodeId;
    try {
      const found = await sendCdp("DOM.querySelector", { nodeId: doc.root.nodeId, selector });
      nodeId = found.nodeId;
    } catch (e) {
      throw `Invalid selector: ${e.message || e}`;
    }
    if (!nodeId) throw `No element found for selector: ${selector}`;
    const matched = await sendCdp("CSS.getMatchedStylesForNode", { nodeId });
    const prop = args.prop !== undefined ? String(args.prop) : "";
    const lines = [];
    const pushProps = (props, indent) => {
      for (const p of props || []) {
        if (prop && p.name !== prop) continue;
        lines.push(indent + p.name + ": " + p.value + (p.important ? " !important" : ""));
      }
    };
    const inline = matched.inlineStyle && matched.inlineStyle.cssProperties;
    if (inline && inline.length) {
      lines.push("Inline styles:");
      pushProps(inline, "  ");
    }
    const rules = matched.matchedCSSRules || [];
    const ruleLines = [];
    for (const entry of rules) {
      const rule = entry.rule || {};
      const sels = (rule.selectorList && rule.selectorList.selectors || []).map((s) => s.text).join(", ");
      const origin = entry.origin || rule.origin || "";
      let header = sels || "(unknown)";
      if (origin === "user-agent") header = "[browser default] " + header;
      const line = rule.styleRange && rule.styleRange.startLine !== undefined ? ` (line ${rule.styleRange.startLine})` : "";
      const before = lines.length;
      const props = rule.style && rule.style.cssProperties;
      if (prop) {
        const hit = (props || []).filter((p) => p.name === prop);
        if (hit.length) { ruleLines.push(`  ${header}${line}`); pushProps(hit, "    "); }
      } else if (props && props.length) {
        ruleLines.push(`  ${header}${line}`);
        pushProps(props, "    ");
      }
      void before;
    }
    if (ruleLines.length) {
      lines.push("Matched rules:");
      lines.push(...ruleLines);
    }
    if (!prop) {
      const inherited = (matched.inherited || []).slice(0, 3);
      const inhLines = [];
      for (const group of inherited) {
        const gRules = group.matchedCSSRules || [];
        for (const entry of gRules) {
          const rule = entry.rule || {};
          const sels = (rule.selectorList && rule.selectorList.selectors || []).map((s) => s.text).join(", ");
          const props = (rule.style && rule.style.cssProperties || []).filter((p) => NG01_TYPO_PROPS.includes(p.name));
          if (!props.length) continue;
          inhLines.push(`  ${sels || "(unknown)"}`);
          pushProps(props, "    ");
        }
      }
      if (inhLines.length) {
        lines.push("Inherited:");
        lines.push(...inhLines);
      }
    }
    if (lines.length === 0) throw "No styles found.";
    return lines.join("\n");
  });

  cli.registerHandler("dev:dom", "Inspect DOM elements", {
    selector: { value: "<css>", description: "CSS selector", required: true },
    total: { description: "Return match count" },
    text: { description: "Return textContent" },
    inner: { description: "Return innerHTML instead of outerHTML" },
    all: { description: "Return all matches" },
    attr: { value: "<name>", description: "Return attribute value" },
    css: { value: "<prop>", description: "Computed style dump (value ignored)" },
  }, async (args) => {
    const mode = args.attr !== undefined ? "attr" : args.css !== undefined ? "css" : args.text !== undefined ? "text" : "html";
    const all = args.all !== undefined;
    const inner = args.inner !== undefined;
    const expression = `(() => {
      let els;
      try { els = Array.from(document.querySelectorAll(${JSON.stringify(String(args.selector))})); }
      catch (e) { return { __error: String(e && e.message || e) }; }
      const mode = ${JSON.stringify(mode)};
      const inner = ${JSON.stringify(inner)};
      const attr = ${JSON.stringify(args.attr !== undefined ? String(args.attr) : "")};
      const pick = (el) => {
        if (mode === "attr") { const v = el.getAttribute(attr); return v === null ? "(null)" : v; }
        if (mode === "css") {
          const cs = getComputedStyle(el);
          return ${JSON.stringify(NG01_CSS_DUMP_PROPS)}.map((p) => p + ": " + cs.getPropertyValue(p)).join("\\n");
        }
        if (mode === "text") return (el.textContent || "").trim();
        return inner ? el.innerHTML : el.outerHTML;
      };
      return { count: els.length, values: els.map(pick) };
    })()`;
    let result;
    try {
      result = await sendCdp("Runtime.evaluate", { expression, returnByValue: true });
    } catch (e) {
      throw `Invalid selector: ${e.message || e}`;
    }
    const payload = result && result.result;
    const value = payload && payload.value !== undefined ? payload.value : null;
    if (!value) throw "Invalid selector: evaluation failed";
    if (value.__error) throw `Invalid selector: ${value.__error}`;
    if (args.total !== undefined) return String(value.count);
    if (value.count === 0) return "No elements found.";
    const chosen = all ? value.values : [value.values[0]];
    return chosen.join("\n\n");
  });
}
