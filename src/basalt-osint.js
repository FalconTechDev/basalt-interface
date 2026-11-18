// OSINT module: account checks (email / username) through verified endpoints only —
// public JSON APIs and real 404 pages, no holehe-style guessing — plus a dork
// generator that runs searches through DuckDuckGo lite and opens Google/Bing/Yandex.
(() => {
  "use strict";

  // ---------- MD5 for Gravatar (js-md5 0.8.3, MIT) ----------
  const md5 = (() => {
    window.JS_MD5_NO_NODE_JS = true; window.JS_MD5_NO_COMMON_JS = true; window.JS_MD5_NO_ARRAY_BUFFER = true;
    /**
     * [js-md5]{@link https://github.com/emn178/js-md5}
     *
     * @namespace md5
     * @version 0.8.0
     * @author Chen, Yi-Cyuan [emn178@gmail.com]
     * @copyright Chen, Yi-Cyuan 2014-2023
     * @license MIT
     */
    !function(){"use strict";function t(t){if(t)b[0]=b[16]=b[1]=b[2]=b[3]=b[4]=b[5]=b[6]=b[7]=b[8]=b[9]=b[10]=b[11]=b[12]=b[13]=b[14]=b[15]=0,this.blocks=b,this.buffer8=a;else if(u){var r=new ArrayBuffer(68);this.buffer8=new Uint8Array(r),this.blocks=new Uint32Array(r)}else this.blocks=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];this.h0=this.h1=this.h2=this.h3=this.start=this.bytes=this.hBytes=0,this.finalized=this.hashed=!1,this.first=!0}function r(r,e){var i,s=_(r);if(r=s[0],s[1]){var h,n=[],a=r.length,o=0;for(i=0;i<a;++i)(h=r.charCodeAt(i))<128?n[o++]=h:h<2048?(n[o++]=192|h>>>6,n[o++]=128|63&h):h<55296||h>=57344?(n[o++]=224|h>>>12,n[o++]=128|h>>>6&63,n[o++]=128|63&h):(h=65536+((1023&h)<<10|1023&r.charCodeAt(++i)),n[o++]=240|h>>>18,n[o++]=128|h>>>12&63,n[o++]=128|h>>>6&63,n[o++]=128|63&h);r=n}r.length>64&&(r=new t(!0).update(r).array());var f=[],u=[];for(i=0;i<64;++i){var c=r[i]||0;f[i]=92^c,u[i]=54^c}t.call(this,e),this.update(u),this.oKeyPad=f,this.inner=!0,this.sharedMemory=e}var e="input is invalid type",i="object"==typeof window,s=i?window:{};s.JS_MD5_NO_WINDOW&&(i=!1);var h=!i&&"object"==typeof self,n=!s.JS_MD5_NO_NODE_JS&&"object"==typeof process&&process.versions&&process.versions.node;n?s=global:h&&(s=self);var a,o=!s.JS_MD5_NO_COMMON_JS&&"object"==typeof module&&module.exports,f="function"==typeof define&&define.amd,u=!s.JS_MD5_NO_ARRAY_BUFFER&&"undefined"!=typeof ArrayBuffer,c="0123456789abcdef".split(""),y=[128,32768,8388608,-2147483648],p=[0,8,16,24],d=["hex","array","digest","buffer","arrayBuffer","base64"],l="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".split(""),b=[];if(u){var v=new ArrayBuffer(68);a=new Uint8Array(v),b=new Uint32Array(v)}var w=Array.isArray;!s.JS_MD5_NO_NODE_JS&&w||(w=function(t){return"[object Array]"===Object.prototype.toString.call(t)});var A=ArrayBuffer.isView;!u||!s.JS_MD5_NO_ARRAY_BUFFER_IS_VIEW&&A||(A=function(t){return"object"==typeof t&&t.buffer&&t.buffer.constructor===ArrayBuffer});var _=function(t){var r=typeof t;if("string"===r)return[t,!0];if("object"!==r||null===t)throw new Error(e);if(u&&t.constructor===ArrayBuffer)return[new Uint8Array(t),!1];if(!w(t)&&!A(t))throw new Error(e);return[t,!1]},B=function(r){return function(e){return new t(!0).update(e)[r]()}},g=function(t){var r,i=require("crypto"),h=require("buffer").Buffer;r=h.from&&!s.JS_MD5_NO_BUFFER_FROM?h.from:function(t){return new h(t)};return function(s){if("string"==typeof s)return i.createHash("md5").update(s,"utf8").digest("hex");if(null===s||void 0===s)throw new Error(e);return s.constructor===ArrayBuffer&&(s=new Uint8Array(s)),w(s)||A(s)||s.constructor===h?i.createHash("md5").update(r(s)).digest("hex"):t(s)}},m=function(t){return function(e,i){return new r(e,!0).update(i)[t]()}};t.prototype.update=function(t){if(this.finalized)throw new Error("finalize already called");var r=_(t);t=r[0];for(var e,i,s=r[1],h=0,n=t.length,a=this.blocks,o=this.buffer8;h<n;){if(this.hashed&&(this.hashed=!1,a[0]=a[16],a[16]=a[1]=a[2]=a[3]=a[4]=a[5]=a[6]=a[7]=a[8]=a[9]=a[10]=a[11]=a[12]=a[13]=a[14]=a[15]=0),s)if(u)for(i=this.start;h<n&&i<64;++h)(e=t.charCodeAt(h))<128?o[i++]=e:e<2048?(o[i++]=192|e>>>6,o[i++]=128|63&e):e<55296||e>=57344?(o[i++]=224|e>>>12,o[i++]=128|e>>>6&63,o[i++]=128|63&e):(e=65536+((1023&e)<<10|1023&t.charCodeAt(++h)),o[i++]=240|e>>>18,o[i++]=128|e>>>12&63,o[i++]=128|e>>>6&63,o[i++]=128|63&e);else for(i=this.start;h<n&&i<64;++h)(e=t.charCodeAt(h))<128?a[i>>>2]|=e<<p[3&i++]:e<2048?(a[i>>>2]|=(192|e>>>6)<<p[3&i++],a[i>>>2]|=(128|63&e)<<p[3&i++]):e<55296||e>=57344?(a[i>>>2]|=(224|e>>>12)<<p[3&i++],a[i>>>2]|=(128|e>>>6&63)<<p[3&i++],a[i>>>2]|=(128|63&e)<<p[3&i++]):(e=65536+((1023&e)<<10|1023&t.charCodeAt(++h)),a[i>>>2]|=(240|e>>>18)<<p[3&i++],a[i>>>2]|=(128|e>>>12&63)<<p[3&i++],a[i>>>2]|=(128|e>>>6&63)<<p[3&i++],a[i>>>2]|=(128|63&e)<<p[3&i++]);else if(u)for(i=this.start;h<n&&i<64;++h)o[i++]=t[h];else for(i=this.start;h<n&&i<64;++h)a[i>>>2]|=t[h]<<p[3&i++];this.lastByteIndex=i,this.bytes+=i-this.start,i>=64?(this.start=i-64,this.hash(),this.hashed=!0):this.start=i}return this.bytes>4294967295&&(this.hBytes+=this.bytes/4294967296<<0,this.bytes=this.bytes%4294967296),this},t.prototype.finalize=function(){if(!this.finalized){this.finalized=!0;var t=this.blocks,r=this.lastByteIndex;t[r>>>2]|=y[3&r],r>=56&&(this.hashed||this.hash(),t[0]=t[16],t[16]=t[1]=t[2]=t[3]=t[4]=t[5]=t[6]=t[7]=t[8]=t[9]=t[10]=t[11]=t[12]=t[13]=t[14]=t[15]=0),t[14]=this.bytes<<3,t[15]=this.hBytes<<3|this.bytes>>>29,this.hash()}},t.prototype.hash=function(){var t,r,e,i,s,h,n=this.blocks;this.first?r=((r=((t=((t=n[0]-680876937)<<7|t>>>25)-271733879<<0)^(e=((e=(-271733879^(i=((i=(-1732584194^2004318071&t)+n[1]-117830708)<<12|i>>>20)+t<<0)&(-271733879^t))+n[2]-1126478375)<<17|e>>>15)+i<<0)&(i^t))+n[3]-1316259209)<<22|r>>>10)+e<<0:(t=this.h0,r=this.h1,e=this.h2,r=((r+=((t=((t+=((i=this.h3)^r&(e^i))+n[0]-680876936)<<7|t>>>25)+r<<0)^(e=((e+=(r^(i=((i+=(e^t&(r^e))+n[1]-389564586)<<12|i>>>20)+t<<0)&(t^r))+n[2]+606105819)<<17|e>>>15)+i<<0)&(i^t))+n[3]-1044525330)<<22|r>>>10)+e<<0),r=((r+=((t=((t+=(i^r&(e^i))+n[4]-176418897)<<7|t>>>25)+r<<0)^(e=((e+=(r^(i=((i+=(e^t&(r^e))+n[5]+1200080426)<<12|i>>>20)+t<<0)&(t^r))+n[6]-1473231341)<<17|e>>>15)+i<<0)&(i^t))+n[7]-45705983)<<22|r>>>10)+e<<0,r=((r+=((t=((t+=(i^r&(e^i))+n[8]+1770035416)<<7|t>>>25)+r<<0)^(e=((e+=(r^(i=((i+=(e^t&(r^e))+n[9]-1958414417)<<12|i>>>20)+t<<0)&(t^r))+n[10]-42063)<<17|e>>>15)+i<<0)&(i^t))+n[11]-1990404162)<<22|r>>>10)+e<<0,r=((r+=((t=((t+=(i^r&(e^i))+n[12]+1804603682)<<7|t>>>25)+r<<0)^(e=((e+=(r^(i=((i+=(e^t&(r^e))+n[13]-40341101)<<12|i>>>20)+t<<0)&(t^r))+n[14]-1502002290)<<17|e>>>15)+i<<0)&(i^t))+n[15]+1236535329)<<22|r>>>10)+e<<0,r=((r+=((i=((i+=(r^e&((t=((t+=(e^i&(r^e))+n[1]-165796510)<<5|t>>>27)+r<<0)^r))+n[6]-1069501632)<<9|i>>>23)+t<<0)^t&((e=((e+=(t^r&(i^t))+n[11]+643717713)<<14|e>>>18)+i<<0)^i))+n[0]-373897302)<<20|r>>>12)+e<<0,r=((r+=((i=((i+=(r^e&((t=((t+=(e^i&(r^e))+n[5]-701558691)<<5|t>>>27)+r<<0)^r))+n[10]+38016083)<<9|i>>>23)+t<<0)^t&((e=((e+=(t^r&(i^t))+n[15]-660478335)<<14|e>>>18)+i<<0)^i))+n[4]-405537848)<<20|r>>>12)+e<<0,r=((r+=((i=((i+=(r^e&((t=((t+=(e^i&(r^e))+n[9]+568446438)<<5|t>>>27)+r<<0)^r))+n[14]-1019803690)<<9|i>>>23)+t<<0)^t&((e=((e+=(t^r&(i^t))+n[3]-187363961)<<14|e>>>18)+i<<0)^i))+n[8]+1163531501)<<20|r>>>12)+e<<0,r=((r+=((i=((i+=(r^e&((t=((t+=(e^i&(r^e))+n[13]-1444681467)<<5|t>>>27)+r<<0)^r))+n[2]-51403784)<<9|i>>>23)+t<<0)^t&((e=((e+=(t^r&(i^t))+n[7]+1735328473)<<14|e>>>18)+i<<0)^i))+n[12]-1926607734)<<20|r>>>12)+e<<0,r=((r+=((h=(i=((i+=((s=r^e)^(t=((t+=(s^i)+n[5]-378558)<<4|t>>>28)+r<<0))+n[8]-2022574463)<<11|i>>>21)+t<<0)^t)^(e=((e+=(h^r)+n[11]+1839030562)<<16|e>>>16)+i<<0))+n[14]-35309556)<<23|r>>>9)+e<<0,r=((r+=((h=(i=((i+=((s=r^e)^(t=((t+=(s^i)+n[1]-1530992060)<<4|t>>>28)+r<<0))+n[4]+1272893353)<<11|i>>>21)+t<<0)^t)^(e=((e+=(h^r)+n[7]-155497632)<<16|e>>>16)+i<<0))+n[10]-1094730640)<<23|r>>>9)+e<<0,r=((r+=((h=(i=((i+=((s=r^e)^(t=((t+=(s^i)+n[13]+681279174)<<4|t>>>28)+r<<0))+n[0]-358537222)<<11|i>>>21)+t<<0)^t)^(e=((e+=(h^r)+n[3]-722521979)<<16|e>>>16)+i<<0))+n[6]+76029189)<<23|r>>>9)+e<<0,r=((r+=((h=(i=((i+=((s=r^e)^(t=((t+=(s^i)+n[9]-640364487)<<4|t>>>28)+r<<0))+n[12]-421815835)<<11|i>>>21)+t<<0)^t)^(e=((e+=(h^r)+n[15]+530742520)<<16|e>>>16)+i<<0))+n[2]-995338651)<<23|r>>>9)+e<<0,r=((r+=((i=((i+=(r^((t=((t+=(e^(r|~i))+n[0]-198630844)<<6|t>>>26)+r<<0)|~e))+n[7]+1126891415)<<10|i>>>22)+t<<0)^((e=((e+=(t^(i|~r))+n[14]-1416354905)<<15|e>>>17)+i<<0)|~t))+n[5]-57434055)<<21|r>>>11)+e<<0,r=((r+=((i=((i+=(r^((t=((t+=(e^(r|~i))+n[12]+1700485571)<<6|t>>>26)+r<<0)|~e))+n[3]-1894986606)<<10|i>>>22)+t<<0)^((e=((e+=(t^(i|~r))+n[10]-1051523)<<15|e>>>17)+i<<0)|~t))+n[1]-2054922799)<<21|r>>>11)+e<<0,r=((r+=((i=((i+=(r^((t=((t+=(e^(r|~i))+n[8]+1873313359)<<6|t>>>26)+r<<0)|~e))+n[15]-30611744)<<10|i>>>22)+t<<0)^((e=((e+=(t^(i|~r))+n[6]-1560198380)<<15|e>>>17)+i<<0)|~t))+n[13]+1309151649)<<21|r>>>11)+e<<0,r=((r+=((i=((i+=(r^((t=((t+=(e^(r|~i))+n[4]-145523070)<<6|t>>>26)+r<<0)|~e))+n[11]-1120210379)<<10|i>>>22)+t<<0)^((e=((e+=(t^(i|~r))+n[2]+718787259)<<15|e>>>17)+i<<0)|~t))+n[9]-343485551)<<21|r>>>11)+e<<0,this.first?(this.h0=t+1732584193<<0,this.h1=r-271733879<<0,this.h2=e-1732584194<<0,this.h3=i+271733878<<0,this.first=!1):(this.h0=this.h0+t<<0,this.h1=this.h1+r<<0,this.h2=this.h2+e<<0,this.h3=this.h3+i<<0)},t.prototype.hex=function(){this.finalize();var t=this.h0,r=this.h1,e=this.h2,i=this.h3;return c[t>>>4&15]+c[15&t]+c[t>>>12&15]+c[t>>>8&15]+c[t>>>20&15]+c[t>>>16&15]+c[t>>>28&15]+c[t>>>24&15]+c[r>>>4&15]+c[15&r]+c[r>>>12&15]+c[r>>>8&15]+c[r>>>20&15]+c[r>>>16&15]+c[r>>>28&15]+c[r>>>24&15]+c[e>>>4&15]+c[15&e]+c[e>>>12&15]+c[e>>>8&15]+c[e>>>20&15]+c[e>>>16&15]+c[e>>>28&15]+c[e>>>24&15]+c[i>>>4&15]+c[15&i]+c[i>>>12&15]+c[i>>>8&15]+c[i>>>20&15]+c[i>>>16&15]+c[i>>>28&15]+c[i>>>24&15]},t.prototype.toString=t.prototype.hex,t.prototype.digest=function(){this.finalize();var t=this.h0,r=this.h1,e=this.h2,i=this.h3;return[255&t,t>>>8&255,t>>>16&255,t>>>24&255,255&r,r>>>8&255,r>>>16&255,r>>>24&255,255&e,e>>>8&255,e>>>16&255,e>>>24&255,255&i,i>>>8&255,i>>>16&255,i>>>24&255]},t.prototype.array=t.prototype.digest,t.prototype.arrayBuffer=function(){this.finalize();var t=new ArrayBuffer(16),r=new Uint32Array(t);return r[0]=this.h0,r[1]=this.h1,r[2]=this.h2,r[3]=this.h3,t},t.prototype.buffer=t.prototype.arrayBuffer,t.prototype.base64=function(){for(var t,r,e,i="",s=this.array(),h=0;h<15;)t=s[h++],r=s[h++],e=s[h++],i+=l[t>>>2]+l[63&(t<<4|r>>>4)]+l[63&(r<<2|e>>>6)]+l[63&e];return t=s[h],i+=l[t>>>2]+l[t<<4&63]+"=="},(r.prototype=new t).finalize=function(){if(t.prototype.finalize.call(this),this.inner){this.inner=!1;var r=this.array();t.call(this,this.sharedMemory),this.update(this.oKeyPad),this.update(r),t.prototype.finalize.call(this)}};var O=function(){var r=B("hex");n&&(r=g(r)),r.create=function(){return new t},r.update=function(t){return r.create().update(t)};for(var e=0;e<d.length;++e){var i=d[e];r[i]=B(i)}return r}();O.md5=O,O.md5.hmac=function(){var t=m("hex");t.create=function(t){return new r(t)},t.update=function(r,e){return t.create(r).update(e)};for(var e=0;e<d.length;++e){var i=d[e];t[i]=m(i)}return t}(),o?module.exports=O:(s.md5=O,f&&define(function(){return O}))}();
    const f = window.md5; delete window.md5; delete window.JS_MD5_NO_NODE_JS; delete window.JS_MD5_NO_COMMON_JS; delete window.JS_MD5_NO_ARRAY_BUFFER;
    return f;
  })();

  // ---------- HTTP ----------
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
  async function http(url, opts) {
    opts = opts || {};
    const timeout = opts.timeout || 12000;
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), timeout) : 0;
    try {
      if (typeof requestUrl === "function") {
        const headers = Object.assign({ "User-Agent": UA }, opts.headers || {});
        const r = await requestUrl({ url, method: opts.method || "GET", headers, body: opts.body, throw: false, ...(ctl ? { signal: ctl.signal } : {}) });
        return { status: r.status, text: () => Promise.resolve(typeof r.text === "string" ? r.text : JSON.stringify(r.json || "")), json: () => Promise.resolve(r.json), headers: r.headers || {} };
      }
      const res = await fetch(url, { method: opts.method || "GET", headers: Object.assign({ "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }, opts.headers || {}), body: opts.body, signal: ctl ? ctl.signal : undefined });
      const text = await res.text();
      return { status: res.status, text: () => Promise.resolve(text), json: async () => JSON.parse(text), headers: {} };
    } finally { if (t) clearTimeout(t); }
  }

  // ---------- site adapters ----------
  // kind "status": 200 = exists, 404 = missing. kind "json": fn parses body.
  // kind "html": fn checks markers. kind "api": fn(url) -> url, then json check.
  const SITES = [
    // --- real JSON APIs (most reliable) ---
    { n: "GitHub", u: (x) => "https://api.github.com/users/" + x, kind: "json", ok: (j) => !!(j && j.login), url: (x) => "https://github.com/" + x },
    { n: "GitLab", u: (x) => "https://gitlab.com/api/v4/users?username=" + x, kind: "json", ok: (j) => Array.isArray(j) && j.length > 0, url: (x) => "https://gitlab.com/" + x },
    { n: "Bitbucket", u: (x) => "https://api.bitbucket.org/2.0/users/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://bitbucket.org/" + x },
    { n: "Replit", u: (x) => "https://replit.com/@" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://replit.com/@" + x },
    { n: "Dev.to", u: (x) => "https://dev.to/api/users/by_username?url=" + x, kind: "json", ok: (j) => !!(j && j.username), url: (x) => "https://dev.to/" + x },
    { n: "Codeforces", u: (x) => "https://codeforces.com/api/user.info?handles=" + x, kind: "json", ok: (j) => j && j.status === "OK", url: (x) => "https://codeforces.com/profiles/" + x },
    { n: "Lichess", u: (x) => "https://lichess.org/api/user/" + x, kind: "json", ok: (j) => !!(j && j.username), url: (x) => "https://lichess.org/@/" + x },
    { n: "Chess.com", u: (x) => "https://api.chess.com/pub/player/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.chess.com/member/" + x },
    { n: "StackOverflow", u: (x) => "https://api.stackexchange.com/2.3/users?inname=" + x + "&site=stackoverflow&filter=default", kind: "json", ok: (j) => j && j.items && j.items.some((i) => i.display_name && i.display_name.toLowerCase().replace(/\s+/g, "") === x.toLowerCase()), url: (x) => "https://stackoverflow.com/users/" + x },
    { n: "Docker Hub", u: (x) => "https://hub.docker.com/v2/users/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://hub.docker.com/u/" + x },
    { n: "Keybase", u: (x) => "https://keybase.io/_/api/1.0/user/lookup.json?username=" + x + "&fields=basics", kind: "json", ok: (j) => j && j.status && j.status.code === 0, url: (x) => "https://keybase.io/" + x },
    { n: "Gravatar", u: (x) => "https://en.gravatar.com/" + x + ".json", kind: "status", okS: [200], badS: [404], url: (x) => "https://gravatar.com/" + x },
    { n: "Duolingo", u: (x) => "https://www.duolingo.com/2017-06-30/users?username=" + x, kind: "json", ok: (j) => !!(j && j.users && j.users.length), url: (x) => "https://www.duolingo.com/profile/" + x },
    { n: "Epic Games", u: (x) => "https://account-public-service-prod.ol.epicgames.com/account/api/public/account/displayName/" + encodeURIComponent(x), kind: "status", okS: [200], badS: [404, 400], url: (x) => "https://www.epicgames.com/id/login" },
    { n: "Twitch", u: (x) => "https://api.twitch.tv/helix/users?login=" + x, kind: "json", headers: { "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko" }, ok: (j) => j && j.data && j.data.length > 0, url: (x) => "https://www.twitch.tv/" + x },
    // --- 404 / marker pages ---
    { n: "Medium", u: (x) => "https://medium.com/@" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://medium.com/@" + x },
    { n: "YouTube", u: (x) => "https://www.youtube.com/@" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.youtube.com/@" + x },
    { n: "DeviantArt", u: (x) => "https://www.deviantart.com/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.deviantart.com/" + x },
    { n: "Behance", u: (x) => "https://www.behance.net/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.behance.net/" + x },
    { n: "Dribbble", u: (x) => "https://dribbble.com/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://dribbble.com/" + x },
    { n: "Pinterest", u: (x) => "https://www.pinterest.com/" + x + "/", kind: "status", okS: [200], badS: [404], url: (x) => "https://www.pinterest.com/" + x + "/" },
    { n: "SoundCloud", u: (x) => "https://soundcloud.com/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://soundcloud.com/" + x },
    { n: "Last.fm", u: (x) => "https://www.last.fm/user/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.last.fm/user/" + x },
    { n: "Letterboxd", u: (x) => "https://letterboxd.com/" + x + "/", kind: "status", okS: [200], badS: [404], url: (x) => "https://letterboxd.com/" + x + "/" },
    { n: "Goodreads", u: (x) => "https://www.goodreads.com/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.goodreads.com/" + x },
    { n: "About.me", u: (x) => "https://about.me/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://about.me/" + x },
    { n: "Linktree", u: (x) => "https://linktr.ee/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://linktr.ee/" + x },
    { n: "Ko-fi", u: (x) => "https://ko-fi.com/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://ko-fi.com/" + x },
    { n: "BuyMeACoffee", u: (x) => "https://www.buymeacoffee.com/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.buymeacoffee.com/" + x },
    { n: "CodePen", u: (x) => "https://codepen.io/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://codepen.io/" + x },
    { n: "Observable", u: (x) => "https://observablehq.com/@" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://observablehq.com/@" + x },
    { n: "itch.io", u: (x) => "https://" + x + ".itch.io", kind: "status", okS: [200], badS: [404], url: (x) => "https://" + x + ".itch.io" },
    { n: "Mixcloud", u: (x) => "https://www.mixcloud.com/" + x + "/", kind: "status", okS: [200], badS: [404], url: (x) => "https://www.mixcloud.com/" + x + "/" },
    { n: "Fiverr", u: (x) => "https://www.fiverr.com/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.fiverr.com/" + x },
    { n: "Kaggle", u: (x) => "https://www.kaggle.com/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.kaggle.com/" + x },
    { n: "Codecademy", u: (x) => "https://www.codecademy.com/profiles/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.codecademy.com/profiles/" + x },
    { n: "freeCodeCamp forum", u: (x) => "https://forum.freecodecamp.org/u/" + x + ".json", kind: "status", okS: [200], badS: [404], url: (x) => "https://forum.freecodecamp.org/u/" + x },
    { n: "Steam", u: (x) => "https://steamcommunity.com/id/" + x, kind: "html", url: (x) => "https://steamcommunity.com/id/" + x, ok: (s) => !/profile could not be found|The specified profile/i.test(s), bad: (s) => /profile could not be found|The specified profile/i.test(s) },
    { n: "Telegram", u: (x) => "https://t.me/" + x, kind: "html", url: (x) => "https://t.me/" + x, ok: (s) => /tgme_page_title|tgme_page_extra|property="og:title"/.test(s) && !/If you have Telegram, you can contact/i.test(s.slice(0, 20000)), bad: (s) => /tgme_page_extra[^<]*<|page not found/i.test(s) && !/tgme_page_title/.test(s) },
    { n: "TikTok", u: (x) => "https://www.tiktok.com/@" + x, kind: "html", url: (x) => "https://www.tiktok.com/@" + x, ok: (s, st) => st === 200 && !/Couldn't find this account|user not found/i.test(s), bad: (s, st) => st === 404 || /Couldn't find this account/i.test(s) },
    { n: "Instagram", u: (x) => "https://www.instagram.com/" + x + "/", kind: "status", okS: [200], badS: [404], url: (x) => "https://www.instagram.com/" + x + "/" },
    { n: "Snapchat", u: (x) => "https://www.snapchat.com/add/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.snapchat.com/add/" + x },
    { n: "Roblox (по нику)", u: (x) => "https://users.roblox.com/v1/usernames/users", kind: "post", body: (x) => JSON.stringify({ usernames: [x], excludeBannedUsers: false }), ok: (j) => j && j.data && j.data.length > 0, url: (x) => "https://www.roblox.com/users.aspx" },
    { n: "VSCO", u: (x) => "https://vsco.co/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://vsco.co/" + x },
    { n: "Patreon", u: (x) => "https://www.patreon.com/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.patreon.com/" + x },
    { n: "Substack", u: (x) => "https://" + x + ".substack.com", kind: "status", okS: [200], badS: [404], url: (x) => "https://" + x + ".substack.com" },
    // --- round 2: more verified endpoints ---
    // JSON APIs
    { n: "Bluesky", u: (x) => "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=" + encodeURIComponent(x.indexOf(".") >= 0 ? x : x + ".bsky.social"), kind: "json", ok: (j) => !!(j && j.handle), url: (x) => "https://bsky.app/profile/" + x },
    { n: "Steem", u: (x) => "https://api.steemit.com/@" + x, kind: "json", ok: (j) => !!(j && j.name), url: (x) => "https://steemit.com/@" + x },
    { n: "Hive", u: (x) => "https://api.hive.blog/@" + x, kind: "json", ok: (j) => !!(j && j.name), url: (x) => "https://peakd.com/@" + x },
    { n: "EOS", u: (x) => "https://eos.greymass.com/v1/chain/get_account?account_name=" + x, kind: "json", ok: (j) => !!(j && j.account_name), url: (x) => "https://bloks.io/account/" + x },
    { n: "Speedrun.com", u: (x) => "https://www.speedrun.com/api/v1/users?lookup=" + x + "&top=1", kind: "json", ok: (j) => j && j.data && j.data.length > 0, url: (x) => "https://www.speedrun.com/users/" + x },
    { n: "BoardGameGeek", u: (x) => "https://boardgamegeek.com/xmlapi2/user?name=" + x, kind: "xml", ok: (t) => /<user\s/.test(t), url: (x) => "https://boardgamegeek.com/user/" + x },
    { n: "RubyGems", u: (x) => "https://rubygems.org/profiles/" + x + ".json", kind: "status", okS: [200], badS: [404], url: (x) => "https://rubygems.org/profiles/" + x },
    { n: "Packagist", u: (x) => "https://packagist.org/users/" + x + ".json", kind: "status", okS: [200], badS: [404], url: (x) => "https://packagist.org/users/" + x },
    { n: "Minecraft", u: (x) => "https://api.ashcon.app/mojang/v2/user/" + x, kind: "status", okS: [200], badS: [404, 400], url: (x) => "https://namemc.com/profile/" + x },
    { n: "Wikipedia EN", u: (x) => "https://en.wikipedia.org/w/api.php?action=query&meta=users&ususers=" + x + "&format=json&formatversion=2", kind: "json", ok: (j) => j && j.query && j.query.users && j.query.users[0] && !j.query.users[0].missing, url: (x) => "https://en.wikipedia.org/wiki/User:" + x },
    { n: "Wikipedia RU", u: (x) => "https://ru.wikipedia.org/w/api.php?action=query&meta=users&ususers=" + x + "&format=json&formatversion=2", kind: "json", ok: (j) => j && j.query && j.query.users && j.query.users[0] && !j.query.users[0].missing, url: (x) => "https://ru.wikipedia.org/wiki/Участник:" + x },
    { n: "Kitsu", u: (x) => "https://kitsu.io/api/edge/users?filter%5Bname%5D=" + x + "&page%5Blimit%5D=1", kind: "json", ok: (j) => j && j.data && j.data.length > 0, url: (x) => "https://kitsu.io/users/" + x },
    { n: "Shikimori", u: (x) => "https://shikimori.one/api/users?nickname=" + x, kind: "json", ok: (j) => Array.isArray(j) && j.length > 0, url: (x) => "https://shikimori.one/" + x },
    { n: "MyAnimeList", u: (x) => "https://myanimelist.net/profile/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://myanimelist.net/profile/" + x },
    { n: "AniList", u: () => "https://graphql.anilist.co", kind: "post", body: (x) => JSON.stringify({ query: "query{User(name:\"" + x.replace(/"/g, "") + "\"){id}}" }), headers: { "Content-Type": "application/json" }, ok: (j) => !!(j && j.data && j.data.User), url: (x) => "https://anilist.co/user/" + x },
    { n: "Bangumi", u: (x) => "https://api.bgm.tv/search/user/" + x + "?type=1&responseGroup=small", kind: "json", ok: (j) => j && j.list && j.list.length > 0, url: (x) => "https://bgm.tv/user/" + x },
    { n: "Backloggd", u: (x) => "https://backloggd.com/u/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://backloggd.com/u/" + x },
    { n: "GNOME GitLab", u: (x) => "https://gitlab.gnome.org/api/v4/users?username=" + x, kind: "json", ok: (j) => Array.isArray(j) && j.length > 0, url: (x) => "https://gitlab.gnome.org/" + x },
    { n: "KDE Invent", u: (x) => "https://invent.kde.org/api/v4/users?username=" + x, kind: "json", ok: (j) => Array.isArray(j) && j.length > 0, url: (x) => "https://invent.kde.org/" + x },
    { n: "Debian Salsa", u: (x) => "https://salsa.debian.org/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://salsa.debian.org/" + x },
    { n: "SourceHut", u: (x) => "https://sr.ht/~" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://sr.ht/~" + x },
    { n: "Codeberg", u: (x) => "https://codeberg.org/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://codeberg.org/" + x },
    { n: "GitVerse", u: (x) => "https://gitverse.ru/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://gitverse.ru/" + x },
    { n: "Gitee", u: (x) => "https://gitee.com/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://gitee.com/" + x },
    { n: "AUR", u: (x) => "https://aur.archlinux.org/account/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://aur.archlinux.org/account/" + x },
    { n: "Neocities", u: (x) => "https://" + x + ".neocities.org", kind: "status", okS: [200], badS: [404], url: (x) => "https://" + x + ".neocities.org" },
    { n: "Bear Blog", u: (x) => "https://" + x + ".bearblog.dev", kind: "status", okS: [200], badS: [404], url: (x) => "https://" + x + ".bearblog.dev" },
    { n: "Write.as", u: (x) => "https://write.as/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://write.as/" + x },
    { n: "npm", u: (x) => "https://registry.npmjs.org/-/v1/search?text=maintainer:" + x + "&size=1", kind: "json", ok: (j) => j && j.objects && j.objects.length > 0, url: (x) => "https://www.npmjs.com/~" + x },
    { n: "PyPI", u: (x) => "https://pypi.org/user/" + x + "/", kind: "status", okS: [200], badS: [404], url: (x) => "https://pypi.org/user/" + x + "/" },
    { n: "Crates.io", u: (x) => "https://crates.io/users/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://crates.io/users/" + x },
    { n: "Hex", u: (x) => "https://hex.pm/users/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://hex.pm/users/" + x },
    { n: "LuaRocks", u: (x) => "https://luarocks.org/users/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://luarocks.org/users/" + x },
    { n: "NuGet", u: (x) => "https://www.nuget.org/profiles/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.nuget.org/profiles/" + x },
    { n: "CPAN", u: (x) => "https://fastapi.metacpan.org/v1/author/" + x, kind: "status", okS: [200], badS: [404, 400], url: (x) => "https://metacpan.org/author/" + x },
    { n: "Chocolatey", u: (x) => "https://community.chocolatey.org/profiles/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://community.chocolatey.org/profiles/" + x },
    { n: "Clang/LLVM Discourse", u: (x) => "https://discourse.llvm.org/u/" + x + ".json", kind: "status", okS: [200], badS: [404], url: (x) => "https://discourse.llvm.org/u/" + x },
    { n: "Ruby / Rails Discuss", u: (x) => "https://discuss.rubyonrails.org/u/" + x + ".json", kind: "status", okS: [200], badS: [404], url: (x) => "https://discuss.rubyonrails.org/u/" + x },
    // social / media / RU
    { n: "Habr", u: (x) => "https://habr.com/ru/users/" + x + "/", kind: "status", okS: [200], badS: [404], url: (x) => "https://habr.com/ru/users/" + x + "/" },
    { n: "Pikabu", u: (x) => "https://pikabu.ru/@" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://pikabu.ru/@" + x },
    { n: "Drive2", u: (x) => "https://www.drive2.ru/users/" + x + "/", kind: "status", okS: [200], badS: [404], url: (x) => "https://www.drive2.ru/users/" + x + "/" },
    { n: "Qiita", u: (x) => "https://qiita.com/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://qiita.com/" + x },
    { n: "Zenn", u: (x) => "https://zenn.dev/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://zenn.dev/" + x },
    { n: "Wantedly", u: (x) => "https://www.wantedly.com/id/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.wantedly.com/id/" + x },
    { n: "Quora", u: (x) => "https://www.quora.com/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.quora.com/" + x },
    { n: "Xing", u: (x) => "https://www.xing.com/profile/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.xing.com/profile/" + x },
    { n: "Mastodon", u: (x) => "https://mastodon.social/@" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://mastodon.social/@" + x },
    { n: "Pixelfed", u: (x) => "https://pixelfed.social/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://pixelfed.social/" + x },
    { n: "Gab", u: (x) => "https://gab.com/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://gab.com/" + x },
    { n: "Minds", u: (x) => "https://www.minds.com/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.minds.com/" + x },
    { n: "Odysee", u: (x) => "https://odysee.com/@" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://odysee.com/@" + x },
    { n: "Vimeo", u: (x) => "https://vimeo.com/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://vimeo.com/" + x },
    { n: "Dailymotion", u: (x) => "https://www.dailymotion.com/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.dailymotion.com/" + x },
    { n: "Kick", u: (x) => "https://kick.com/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://kick.com/" + x },
    { n: "DLive", u: (x) => "https://dlive.tv/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://dlive.tv/" + x },
    { n: "LibraryThing", u: (x) => "https://www.librarything.com/profile/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.librarything.com/profile/" + x },
    { n: "Academia.edu", u: (x) => "https://www.academia.edu/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.academia.edu/" + x },
    { n: "Mendeley", u: (x) => "https://www.mendeley.com/profiles/" + x + "/", kind: "status", okS: [200], badS: [404], url: (x) => "https://www.mendeley.com/profiles/" + x + "/" },
    { n: "Slideshare", u: (x) => "https://www.slideshare.net/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.slideshare.net/" + x },
    { n: "Issuu", u: (x) => "https://issuu.com/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://issuu.com/" + x },
    { n: "ArtStation", u: (x) => "https://www.artstation.com/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.artstation.com/" + x },
    { n: "Sketchfab", u: (x) => "https://sketchfab.com/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://sketchfab.com/" + x },
    { n: "OpenGameArt", u: (x) => "https://opengameart.org/users/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://opengameart.org/users/" + x },
    { n: "Game Jolt", u: (x) => "https://gamejolt.com/@" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://gamejolt.com/@" + x },
    { n: "Kongregate", u: (x) => "https://www.kongregate.com/accounts/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.kongregate.com/accounts/" + x },
    { n: "Newgrounds", u: (x) => "https://" + x + ".newgrounds.com", kind: "status", okS: [200], badS: [404], url: (x) => "https://" + x + ".newgrounds.com" },
    { n: "Scratch", u: (x) => "https://scratch.mit.edu/users/" + x + "/", kind: "status", okS: [200], badS: [404], url: (x) => "https://scratch.mit.edu/users/" + x + "/" },
    { n: "Fur Affinity", u: (x) => "https://www.furaffinity.net/user/" + x + "/", kind: "status", okS: [200], badS: [404], url: (x) => "https://www.furaffinity.net/user/" + x + "/" },
    { n: "Weasyl", u: (x) => "https://www.weasyl.com/~" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.weasyl.com/~" + x },
    { n: "InkBunny", u: (x) => "https://inkbunny.net/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://inkbunny.net/" + x },
    { n: "RetroAchievements", u: (x) => "https://retroachievements.org/user/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://retroachievements.org/user/" + x },
    { n: "AtCoder", u: (x) => "https://atcoder.jp/users/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://atcoder.jp/users/" + x },
    { n: "CodeChef", u: (x) => "https://www.codechef.com/users/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.codechef.com/users/" + x },
    { n: "HackerRank", u: (x) => "https://www.hackerrank.com/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.hackerrank.com/" + x },
    { n: "HackerEarth", u: (x) => "https://www.hackerearth.com/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.hackerearth.com/" + x },
    { n: "TopCoder", u: (x) => "https://www.topcoder.com/members/" + x + "/profile", kind: "status", okS: [200], badS: [404], url: (x) => "https://www.topcoder.com/members/" + x + "/profile" },
    { n: "SPOJ", u: (x) => "https://www.spoj.com/users/" + x + "/", kind: "status", okS: [200], badS: [404], url: (x) => "https://www.spoj.com/users/" + x + "/" },
    { n: "Project Euler", u: (x) => "https://projecteuler.net/progress/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://projecteuler.net/progress/" + x },
    { n: "AOJ", u: (x) => "https://judge.u-aizu.ac.jp/onlinejudge/user.jsp?id=" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://judge.u-aizu.ac.jp/onlinejudge/user.jsp?id=" + x },
    { n: "GeeksforGeeks", u: (x) => "https://auth.geeksforgeeks.org/user/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.geeksforgeeks.org/user/" + x + "/" },
    { n: "Val Town", u: (x) => "https://www.val.town/u/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://www.val.town/u/" + x },
    { n: "CodeSandbox", u: (x) => "https://codesandbox.io/u/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://codesandbox.io/u/" + x },
    { n: "JSFiddle", u: (x) => "https://jsfiddle.net/user/" + x + "/show/", kind: "status", okS: [200], badS: [404], url: (x) => "https://jsfiddle.net/user/" + x + "/show/" },
    { n: "Glitch", u: (x) => "https://glitch.com/@" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://glitch.com/@" + x },
    { n: "Vercel", u: (x) => "https://vercel.com/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://vercel.com/" + x },
    { n: "Buildkite", u: (x) => "https://buildkite.com/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://buildkite.com/" + x },
    { n: "Lobste.rs", u: (x) => "https://lobste.rs/u/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://lobste.rs/u/" + x },
    { n: "Hacker News", u: (x) => "https://news.ycombinator.com/user?id=" + x, kind: "html", url: (x) => "https://news.ycombinator.com/user?id=" + x, ok: (s) => !/No such user|User doesn't exist/i.test(s), bad: (s) => /No such user|User doesn't exist/i.test(s) },
    { n: "Quizlet", u: (x) => "https://quizlet.com/" + x, kind: "status", okS: [200], badS: [404], url: (x) => "https://quizlet.com/" + x },
  ];

  // email-specific checks (real services, not guesses)
  const EMAIL_SITES = [
    { n: "Gravatar", desc: "публичный профиль", u: (e) => "https://www.gravatar.com/" + md5(e.trim().toLowerCase()) + ".json", kind: "status", okS: [200], badS: [404], url: (e) => "https://gravatar.com/" + md5(e.trim().toLowerCase()) },
    { n: "LeakCheck", desc: "утечки данных", u: (e) => "https://leakcheck.io/api/public?check=" + encodeURIComponent(e), kind: "json", ok: (j) => j && j.success === true && j.found === true, url: () => "https://leakcheck.io/" },
    { n: "ProxyNova COMB", desc: "база комбо-утечек", u: (e) => "https://api.proxynova.com/comb?query=" + encodeURIComponent(e) + "&start=0&limit=5", kind: "json", ok: (j) => j && j.count > 0, url: () => "https://www.proxynova.com/tools/comb" },
    { n: "EmailRep", desc: "репутация адреса", u: (e) => "https://emailrep.io/" + encodeURIComponent(e), kind: "json", ok: (j) => !!(j && j.status === "valid" && !j.suspicious), url: () => "https://emailrep.io/" },
    { n: "Disify", desc: "одноразовый/спам-домен (yes = подозрительный)", u: (e) => "https://api.disify.com/api/email/" + encodeURIComponent(e), kind: "json", ok: (j) => !!(j && (j.disposable === true || j.format === false || j.dns === false || j.spam === true)), url: () => "https://disify.com/" },
    { n: "BigDataCloud", desc: "валидация ящика", u: (e) => "https://api.bigdatacloud.net/data/email-validate?email=" + encodeURIComponent(e), kind: "json", ok: (j) => !!(j && j.valid === true), url: () => "https://www.bigdatacloud.com/" },
    { n: "MailCheck", desc: "проверка существования", u: (e) => "https://api.mailcheck.ai/email/" + encodeURIComponent(e), kind: "json", ok: (j) => !!(j && j.valid === true), url: () => "https://mailcheck.ai/" },
  ];

  const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
  // markers that mean "the site answered 200 but the profile/page is actually missing"
  const TR_NOTFOUND = [
    "page not found", "404 not found", "profile not found", "user not found", "account not found",
    "doesn't exist", "does not exist", "no such user", "not available", "isn't available",
    "nothing here", "page you are looking for", "page you requested", "we can't find",
    "couldn't find", "not be found", "страница не найдена", "не найден", "ничего не найдено", "не существует",
  ];

  async function checkSite(site, value) {
    const res = { site: site.n, desc: site.desc || "", status: "err", detail: "", url: site.url ? site.url(value) : "" };
    try {
      let r;
      if (site.kind === "post") {
        r = await http(site.u(value), { method: "POST", headers: { "Content-Type": "application/json" }, body: site.body(value) });
      } else {
        r = await http(site.u(value), site.headers ? { headers: site.headers } : {});
      }
      const st = r.status;
      if (site.kind === "status") {
        if (site.okS && site.okS.includes(st)) res.status = "yes";
        else if (site.badS && site.badS.includes(st)) res.status = "no";
        else res.status = "unknown";
        res.detail = "HTTP " + st;
      } else if (site.kind === "json") {
        try {
          const j = await r.json();
          res.status = site.ok(j) ? "yes" : (st === 404 ? "no" : "unknown");
          res.detail = site.desc || "";
        } catch (e) { res.status = st === 404 ? "no" : "unknown"; res.detail = "HTTP " + st; }
      } else if (site.kind === "html" || site.kind === "xml") {
        const body = await r.text();
        if (site.ok(body, st)) res.status = "yes";
        else if (site.bad && site.bad(body, st)) res.status = "no";
        else res.status = st === 404 ? "no" : "unknown";
        res.detail = "HTTP " + st;
      } else { res.status = "unknown"; res.detail = "HTTP " + st; }
      // second pass for plain 200s: many SPAs return 200 with a "not found" page inside —
      // fetch the profile page once and look for negative markers before trusting "yes"
      if (res.status === "yes" && site.kind === "status" && site.verify !== false && site.url) {
        try {
          const pv = await http(site.url(value), { timeout: 10000 });
          const body = (await pv.text()).slice(0, 300000).toLowerCase();
          if (TR_NOTFOUND.some((m) => body.includes(m))) {
            res.status = "unknown";
            res.detail = "HTTP 200, но страница похожа на «не найдено»";
          }
        } catch (e) { /* keep the 200 evidence */ }
      }
    } catch (e) {
      res.status = "err";
      res.detail = String(e && e.message || e).slice(0, 80);
    }
    return res;
  }

  // ---------- UI ----------
  const css = document.createElement("style");
  css.textContent = `
.bso-ov{position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
.bso{width:min(760px,92vw);max-height:86vh;background:var(--background-primary);color:var(--text-normal);border:1px solid var(--background-modifier-border-hover);box-shadow:0 12px 48px rgba(0,0,0,.45);display:flex;flex-direction:column;font-size:var(--font-ui-small)}
.bso-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--background-modifier-border)}
.bso-head b{font-size:var(--font-ui-medium)}
.bso-tabs{display:flex;gap:4px;margin-left:10px}
.bso-tab{padding:4px 12px;cursor:pointer;color:var(--text-muted);border:1px solid transparent}
.bso-tab.is-on{color:var(--interactive-accent);border-color:var(--interactive-accent);background:var(--background-modifier-hover)}
.bso-x{margin-left:auto;cursor:pointer;color:var(--text-faint);padding:4px}.bso-x:hover{color:var(--text-normal)}
.bso-body{padding:12px 14px;overflow-y:auto;display:flex;flex-direction:column;gap:10px}
.bso-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.bso input[type=text],.bso textarea{flex:1;min-width:200px;padding:7px 10px;font:inherit;font-size:var(--font-ui-small);color:var(--text-normal);background:var(--background-secondary);border:1px solid var(--background-modifier-border);outline:none}
.bso input[type=text]:focus,.bso textarea:focus{border-color:var(--interactive-accent)}
.bso textarea{min-height:110px;resize:vertical;font-family:var(--font-monospace)}
.bso button{padding:6px 14px;font:inherit;font-size:var(--font-ui-small);cursor:pointer;color:var(--text-normal);background:var(--background-secondary);border:1px solid var(--background-modifier-border-hover)}
.bso button:hover{border-color:var(--interactive-accent);color:var(--interactive-accent)}
.bso button.pri{background:var(--interactive-accent);color:var(--text-on-accent,#fff);border-color:var(--interactive-accent)}
.bso .hint{color:var(--text-faint);font-size:var(--font-ui-smaller)}
.bso-prog{height:5px;background:var(--background-modifier-border);overflow:hidden}
.bso-prog i{display:block;height:100%;width:0;background:var(--interactive-accent);transition:width .2s}
.bso-list{display:flex;flex-direction:column;border:1px solid var(--background-modifier-border)}
.bso-item{display:flex;align-items:center;gap:10px;padding:6px 10px;border-bottom:1px solid var(--background-modifier-border)}
.bso-item:last-child{border-bottom:0}
.bso-item .nm{flex:1;min-width:0}
.bso-item .nm b{font-weight:500}
.bso-item .nm small{display:block;color:var(--text-faint);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bso-st{flex:none;font-size:10px;padding:2px 8px;text-transform:uppercase;letter-spacing:.05em;border:1px solid var(--background-modifier-border)}
.bso-st.yes{color:var(--color-green,#2ea043);border-color:var(--color-green,#2ea043)}
.bso-st.no{color:var(--text-faint)}
.bso-st.unknown{color:var(--text-warning,#d29922);border-color:var(--text-warning,#d29922)}
.bso-st.err{color:var(--text-error,#f85149);border-color:var(--text-error,#f85149)}
.bso-item a{color:var(--interactive-accent);text-decoration:none;font-size:var(--font-ui-smaller);flex:none}
.bso-engines{display:flex;gap:6px;flex-wrap:wrap}
.bso-engines button{font-size:var(--font-ui-smaller);padding:4px 10px}
.bso-dork{display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-bottom:1px dashed var(--background-modifier-border);font-family:var(--font-monospace);font-size:var(--font-ui-smaller)}
.bso-dork code{flex:1;word-break:break-all;color:var(--text-muted)}
.bso-dork button{flex:none;padding:2px 8px;font-size:10px}
`;
  document.head.appendChild(css);

  function openPanel() {
    document.querySelectorAll(".bso-ov").forEach((e) => e.remove());
    const ov = document.createElement("div"); ov.className = "bso-ov";
    const box = document.createElement("div"); box.className = "bso";
    const head = document.createElement("div"); head.className = "bso-head";
    head.innerHTML = "<b>OSINT</b>";
    const tabs = document.createElement("div"); tabs.className = "bso-tabs";
    const tAcc = document.createElement("div"); tAcc.className = "bso-tab is-on"; tAcc.textContent = "Аккаунты";
    const tDork = document.createElement("div"); tDork.className = "bso-tab"; tDork.textContent = "Дорки";
    tabs.append(tAcc, tDork);
    const x = document.createElement("div"); x.className = "bso-x"; x.innerHTML = "✕"; x.title = "Закрыть (Esc)";
    head.append(tabs, x);
    const body = document.createElement("div"); body.className = "bso-body";
    box.append(head, body);
    ov.appendChild(box);
    document.body.appendChild(ov);
    const close = () => ov.remove();
    x.addEventListener("click", close);
    ov.addEventListener("pointerdown", (e) => { if (e.target === ov) close(); });
    const onKey = (e) => { if (e.key === "Escape") { document.removeEventListener("keydown", onKey, true); close(); } };
    document.addEventListener("keydown", onKey, true);
    ov.addEventListener("remove", () => document.removeEventListener("keydown", onKey, true), { once: true });

    // ---------- accounts tab ----------
    function accountsTab() {
      body.textContent = "";
      const hint = document.createElement("div"); hint.className = "hint";
      hint.textContent = "Реальные проверки: публичные API и страницы с честным 404. «Найден» = аккаунт точно существует, «Нет» = сайт ответил, что такого нет, «?» = сайт не дал однозначного ответа (капча/редирект), «ошибка» = запрос не прошёл.";
      body.appendChild(hint);
      const inp = document.createElement("input"); inp.type = "text"; inp.placeholder = "email@example.com или никнеймы через запятую/пробел";
      const row = document.createElement("div"); row.className = "bso-row"; row.appendChild(inp);
      const go = document.createElement("button"); go.className = "pri"; go.textContent = "Проверить";
      const stopB = document.createElement("button"); stopB.textContent = "Стоп"; stopB.style.display = "none";
      const exp = document.createElement("button"); exp.textContent = "В заметку"; exp.style.display = "none";
      row.append(go, stopB, exp);
      const prog = document.createElement("div"); prog.className = "bso-prog"; prog.innerHTML = "<i></i>";
      const cnt = document.createElement("div"); cnt.className = "hint";
      const fRow = document.createElement("div"); fRow.className = "bso-row";
      const fOnly = document.createElement("input"); fOnly.type = "checkbox"; fOnly.checked = true;
      const fLab = document.createElement("label"); fLab.className = "hint"; fLab.style.cssText = "display:flex;gap:6px;align-items:center;cursor:pointer";
      fLab.append(fOnly, document.createTextNode("Показывать только найденные"));
      fRow.appendChild(fLab);
      const list = document.createElement("div"); list.className = "bso-list";
      body.append(row, prog, cnt, fRow, list);
      let running = false, stopped = false, results = [];
      const sitesFor = (v) => isEmail(v) ? EMAIL_SITES.concat(SITES.filter((s) => s.emailToo)) : SITES.filter((s) => s.kind !== "skip");
      // several values at once: comma / space / newline separated (max 8)
      const valuesOf = () => inp.value.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
      go.addEventListener("click", async () => {
        const vals = valuesOf();
        if (!vals.length || running) return;
        running = true; stopped = false; results = [];
        go.disabled = true; stopB.style.display = ""; exp.style.display = "none";
        list.textContent = ""; prog.querySelector("i").style.width = "0%";
        const totalSites = vals.reduce((n, v) => n + sitesFor(v).length, 0);
        let doneN = 0;
        for (const v of vals) {
          if (stopped) break;
          const head = document.createElement("div"); head.className = "bso-item"; head.dataset.st = "head";
          head.innerHTML = "<div class=\"nm\"><b></b><small>" + sitesFor(v).length + " проверок</small></div>";
          head.querySelector("b").textContent = "=== " + v + " ===";
          head.querySelector("small").style.display = "none";
          list.appendChild(head);
          const sites = sitesFor(v);
          let i = 0;
          const workers = Array.from({ length: 5 }, async () => {
            while (i < sites.length && !stopped) {
              const s = sites[i++];
              const r = await checkSite(s, v);
              r.value = v;
              results.push(r); doneN++;
              prog.querySelector("i").style.width = Math.round(100 * doneN / totalSites) + "%";
              cnt.textContent = doneN + "/" + totalSites + (stopped ? " — остановлено" : "");
              renderRow(r);
            }
          });
          await Promise.all(workers);
        }
        running = false; go.disabled = false; stopB.style.display = "none"; exp.style.display = "";
        cnt.textContent = "Готово: " + results.filter((r) => r.status === "yes").length + " найдено из " + results.length + " проверок";
      });
      stopB.addEventListener("click", () => { stopped = true; });
      const renderRow = (r) => {
        const it = document.createElement("div"); it.className = "bso-item";
        const nm = document.createElement("div"); nm.className = "nm";
        nm.innerHTML = "<b></b>" + (r.desc ? "<small></small>" : "") + (r.detail ? "<small></small>" : "");
        nm.querySelector("b").textContent = r.site;
        const smalls = nm.querySelectorAll("small");
        if (r.desc && smalls[0]) smalls[0].textContent = r.desc;
        if (r.detail && smalls[smalls.length - 1] && smalls.length) smalls[smalls.length - 1].textContent = r.detail;
        const st = document.createElement("div"); st.className = "bso-st " + r.status;
        st.textContent = { yes: "найден", no: "нет", unknown: "?", err: "ошибка" }[r.status] || r.status;
        it.append(nm, st);
        it.dataset.st = r.status;
        it.style.display = fOnly.checked && r.status !== "yes" ? "none" : "";
        if (r.url) { const a = document.createElement("a"); a.href = "#"; a.textContent = "открыть"; a.addEventListener("click", (e) => { e.preventDefault(); openUrl(r.url); }); it.appendChild(a); }
        list.appendChild(it);
      };
      fOnly.addEventListener("change", () => { list.querySelectorAll(".bso-item").forEach((it) => { it.style.display = fOnly.checked && it.dataset.st !== "yes" && it.dataset.st !== "head" ? "none" : ""; }); });
      exp.addEventListener("click", () => {
        const vals = [...new Set(results.map((r) => r.value || ""))];
        const parts = vals.map((v) => {
          const rs = results.filter((r) => (r.value || "") === v);
          const yes = rs.filter((r) => r.status === "yes"), no = rs.filter((r) => r.status === "no");
          return "## " + v + "\n\n### Найденные аккаунты / сервисы\n" +
            (yes.length ? yes.map((r) => "- **" + r.site + "**" + (r.url ? " — " + r.url : "") + (r.desc ? " (" + r.desc + ")" : "")).join("\n") : "- нет") +
            "\n\n### Проверено, аккаунта нет\n" + (no.length ? no.map((r) => "- " + r.site).join("\n") : "- нет") +
            "\n\n### Неопределённо / ошибки\n" + rs.filter((r) => r.status !== "yes" && r.status !== "no").map((r) => "- " + r.site + " (" + r.status + ")").join("\n");
        });
        const md = "# OSINT: " + vals.join(", ") + "\n\n" + parts.join("\n\n") + "\n";
        saveNote("OSINT-" + vals.join("_").replace(/[^\w@.-]+/g, "_").slice(0, 60) + ".md", md);
      });
    }

    // ---------- dorks tab ----------
    function dorksTab() {
      body.textContent = "";
      const hint = document.createElement("div"); hint.className = "hint";
      hint.textContent = "Собери запрос и прогони: «Поиск» — через DuckDuckGo прямо здесь, кнопки — откроют выдачу в Google / Bing / Yandex.";
      body.appendChild(hint);
      const inp = document.createElement("input"); inp.type = "text"; inp.placeholder = "email, ник, домен или фраза";
      const opts = document.createElement("div"); opts.className = "bso-row";
      const mk = (label, checked, fn) => { const l = document.createElement("label"); l.className = "hint"; l.style.cssText = "display:flex;gap:5px;align-items:center;cursor:pointer"; const c = document.createElement("input"); c.type = "checkbox"; c.checked = checked; c.addEventListener("change", fn); l.append(c, document.createTextNode(label)); opts.appendChild(l); return c; };
      const oAcc = mk("Аккаунты", true, build), oFiles = mk("Файлы и документы", true, build), oMail = mk("Почта", false, build), oImg = mk("Картинки/видео", false, build), oExact = mk("Точная фраза", true, build);
      const out = document.createElement("div"); out.style.cssText = "display:flex;flex-direction:column;gap:0;max-height:300px;overflow-y:auto";
      const engines = document.createElement("div"); engines.className = "bso-engines";
      const row = document.createElement("div"); row.className = "bso-row"; row.appendChild(inp);
      const goB = document.createElement("button"); goB.className = "pri"; goB.textContent = "Сгенерировать";
      row.appendChild(goB);
      body.append(row, opts, out, engines);
      let dorks = [];
      function build() {
        const v = inp.value.trim(); dorks = [];
        out.textContent = ""; engines.textContent = "";
        if (!v) return;
        const q = oExact.checked ? '"' + v + '"' : v;
        if (oAcc.checked) { dorks.push(["Аккаунты", q + " (site:instagram.com OR site:tiktok.com OR site:twitter.com OR site:facebook.com OR site:linkedin.com OR site:t.me OR site:github.com)"]); dorks.push(["Профили", q + " (site:linktr.ee OR site:about.me OR site:carrd.co OR site:beacons.ai)"]); }
        if (oFiles.checked) { dorks.push(["Документы", q + " (filetype:pdf OR filetype:doc OR filetype:docx OR filetype:xls OR filetype:xlsx)"]); dorks.push(["Утечки/данные", q + " (filetype:sql OR filetype:csv OR filetype:log OR filetype:bak OR filetype:env)"]); dorks.push(["Конфиги", q + " (intext:\"password\" OR intext:\"passwd\" OR intext:\"api_key\" OR intext:\"secret\")"]); }
        if (oMail.checked) dorks.push(["Почта в текстах", "intext:\"" + v + "\" -site:google.com"]);
        if (oImg.checked) dorks.push(["Изображения", q + " (site:instagram.com OR site:facebook.com OR site:vk.com OR site:t.me)"]);
        dorks.push(["Всё вместе", q]);
        dorks.forEach(([tag, d]) => {
          const r = document.createElement("div"); r.className = "bso-dork";
          const c = document.createElement("code"); c.textContent = tag + ":  " + d;
          const cp = document.createElement("button"); cp.textContent = "копия";
          cp.addEventListener("click", () => { navigator.clipboard.writeText(d).then(() => notice("Скопировано")); });
          r.append(c, cp); out.appendChild(r);
        });
        const mkEng = (label, fn) => { const b = document.createElement("button"); b.textContent = label; b.addEventListener("click", fn); engines.appendChild(b); };
        mkEng("Google", () => dorks.forEach(([, d]) => openUrl("https://www.google.com/search?q=" + encodeURIComponent(d))));
        mkEng("Bing", () => dorks.forEach(([, d]) => openUrl("https://www.bing.com/search?q=" + encodeURIComponent(d))));
        mkEng("Яндекс", () => dorks.forEach(([, d]) => openUrl("https://yandex.ru/search/?text=" + encodeURIComponent(d))));
        const ddg = document.createElement("button"); ddg.textContent = "DuckDuckGo (прямо здесь)"; ddg.className = "pri";
        ddg.addEventListener("click", runDdg);
        engines.appendChild(ddg);
      }
      async function runDdg() {
        if (!dorks.length) return;
        ddg.disabled = true; ddg.textContent = "Ищу…";
        try {
          const res = document.createElement("div"); res.className = "hint"; res.style.marginTop = "8px"; res.textContent = "Результаты DuckDuckGo:";
          body.appendChild(res);
          for (const [tag, d] of dorks.slice(0, 4)) {
            const h = document.createElement("div"); h.className = "hint"; h.textContent = "— " + tag + " —"; body.appendChild(h);
            let links = [];
            try {
              const r = await http("https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(d));
              const t = await r.text();
              const re = /<a[^>]+class='result-link'[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
              let m; while ((m = re.exec(t)) && links.length < 8) links.push({ u: m[1].replace(/&amp;/g, "&"), t: m[2].replace(/<[^>]+>/g, "").trim() });
            } catch (e) { links = []; }
            if (!links.length) { const d2 = document.createElement("div"); d2.className = "hint"; d2.textContent = "  (нет результата / блок)"; body.appendChild(d2); continue; }
            for (const l of links) {
              const a = document.createElement("a"); a.href = l.u; a.target = "_blank"; a.textContent = l.t || l.u; a.style.cssText = "display:block;padding:3px 0 3px 12px;color:var(--interactive-accent);text-decoration:none;font-size:var(--font-ui-smaller);overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
              body.appendChild(a);
            }
          }
        } finally { ddg.disabled = false; ddg.textContent = "DuckDuckGo (прямо здесь)"; }
      }
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") build(); });
      goB.addEventListener("click", build);
    }

    tAcc.onclick = () => { tAcc.classList.add("is-on"); tDork.classList.remove("is-on"); accountsTab(); };
    tDork.onclick = () => { tDork.classList.add("is-on"); tAcc.classList.remove("is-on"); dorksTab(); };
    accountsTab();
  }

  function openUrl(u) { try { window.require("electron").shell.openExternal(u); } catch (e) { window.open(u, "_blank"); } }
  const notice = (m) => { try { new window.__bsApi.Notice(m, 3500); } catch (e) { console.log(m); } };
  async function saveNote(name, text) {
    try {
      const dir = app.vault.configDir;
      const p = dir + "/osint";
      if (!(await app.vault.adapter.exists(p))) await app.vault.createFolder(p).catch(() => {});
      const f = app.vault.getAbstractFileByPath(p + "/" + name);
      if (f) await app.vault.modify(f, text); else await app.vault.create(p + "/" + name, text);
      notice("Сохранено: " + p + "/" + name);
    } catch (e) { notice("Не удалось сохранить: " + e.message); }
  }

  // ---------- boot ----------
  const t = setInterval(() => {
    if (!(window.app && app.vault && app.workspace && app.workspace.layoutReady && app.commands)) return;
    clearInterval(t);
    app.commands.addCommand({
      id: "osint:panel", name: "OSINT: панель (аккаунты и дорки)",
      callback: () => openPanel(),
    });
    try {
      const ribbon = app.workspace.leftRibbon || app.workspace.rightRibbon;
      if (ribbon && ribbon.addRibbonIcon) ribbon.addRibbonIcon("lucide-search", "OSINT-панель", () => openPanel());
    } catch (e) { /* optional */ }
    console.info("[basalt-osint] ready");
  }, 800);
})();
