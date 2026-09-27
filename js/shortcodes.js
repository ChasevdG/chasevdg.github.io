// ---------------------------------------------------------------------------
// Emoji shortcodes
// ---------------------------------------------------------------------------
// Type a shortcode like :idk: or \moon anywhere in your content HTML and it is
// replaced with an inline emoji. Both syntaxes work for every entry:
//
//   :idk:   or  \idk    ->  assets/emojis/emoji.png   (custom image)
//   :moon:  or  \moon   ->  🌝                        (Unicode emoji)
//   :cool:  or  \cool   ->  😎
//
// To add a new emoji, add one line to the EMOJI map below. The value is either
// an image path (drop the file in assets/emojis/) or a Unicode emoji character.
//
// The \name form only matches a known name followed by a non-letter, so
// \moon matches but \mooncake does not. Math inside $...$ / \(...\) is left
// alone so it can't clash with LaTeX commands.
//
// Works on the static About tab and on any content loaded into a (sub)tab,
// because a MutationObserver watches the tab containers for new content.
// The :name: syntax is safe next to MathJax (which only owns $...$ / \(...\)).
// ---------------------------------------------------------------------------

(function () {
  "use strict";

  // name  ->  image path relative to the site root, OR a Unicode emoji
  const EMOJI = {
    idk: "assets/emojis/emoji.png",
    moon: "\u{1F31D}", // 🌝 full moon face
    cool: "\u{1F60E}", // 😎 smiling face with sunglasses
    // shrug: "assets/emojis/shrug.png",
    // orange: "assets/emojis/orange.png",
  };

  // Matches :name: (letters/digits/_/+/-) or \name (letters only, not followed
  // by another letter).
  const TOKEN = /:([a-z0-9_+\-]+):|\\([a-z]+)(?![a-z])/gi;

  // Inline math spans, so we never replace inside them before MathJax runs.
  const MATH = /\$\$[\s\S]*?\$\$|\$[^$]*?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g;

  function isImage(value) {
    return /[\/.]/.test(value);
  }

  function hasTrigger(text) {
    return text.indexOf(":") !== -1 || text.indexOf("\\") !== -1;
  }

  // Elements whose text we should never touch.
  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "TEXTAREA", "CODE", "PRE", "NOSCRIPT",
  ]);

  // Inject styling for the inline emoji once.
  function injectStyle() {
    if (document.getElementById("emoji-shortcode-style")) return;
    const style = document.createElement("style");
    style.id = "emoji-shortcode-style";
    style.textContent =
      ".emoji-shortcode{height:1.2em;width:auto;vertical-align:-0.25em;" +
      "display:inline-block;margin:0 0.05em;}" +
      ".emoji-shortcode-char{font-style:normal;line-height:1;margin:0 0.05em;" +
      "font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif;}";
    (document.head || document.documentElement).appendChild(style);
  }

  function isSkippable(node) {
    for (let el = node.parentNode; el && el.nodeType === 1; el = el.parentNode) {
      const tag = el.tagName;
      if (SKIP_TAGS.has(tag)) return true;
      // Leave MathJax's own DOM alone.
      if (tag === "MJX-CONTAINER") return true;
      if (el.classList && (el.classList.contains("MathJax") ||
                           el.classList.contains("mjx-chtml"))) return true;
    }
    return false;
  }

  function makeEmoji(name, token) {
    const value = EMOJI[name];
    if (!isImage(value)) {
      const span = document.createElement("span");
      span.className = "emoji-shortcode-char";
      span.textContent = value;
      span.setAttribute("role", "img");
      span.setAttribute("aria-label", name);
      span.title = token;
      return span;
    }
    const img = document.createElement("img");
    img.src = EMOJI[name];
    img.alt = token;
    img.title = token;
    img.className = "emoji-shortcode";
    img.setAttribute("draggable", "false");
    img.loading = "lazy";
    return img;
  }

  // Replace shortcodes inside a single text node.
  function processTextNode(textNode) {
    const text = textNode.nodeValue;
    if (!hasTrigger(text)) return;

    // Record math ranges so tokens inside them are skipped.
    const mathRanges = [];
    let m;
    MATH.lastIndex = 0;
    while ((m = MATH.exec(text)) !== null) {
      mathRanges.push([m.index, m.index + m[0].length]);
    }
    const inMath = function (i) {
      return mathRanges.some(function (r) { return i >= r[0] && i < r[1]; });
    };

    TOKEN.lastIndex = 0;
    let match, lastIndex = 0, found = false;
    const frag = document.createDocumentFragment();

    while ((match = TOKEN.exec(text)) !== null) {
      const name = (match[1] || match[2]).toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(EMOJI, name)) continue;
      if (inMath(match.index)) continue;
      found = true;
      if (match.index > lastIndex) {
        frag.appendChild(
          document.createTextNode(text.slice(lastIndex, match.index))
        );
      }
      frag.appendChild(makeEmoji(name, match[0]));
      lastIndex = match.index + match[0].length;
    }

    if (!found) return;
    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    textNode.parentNode.replaceChild(frag, textNode);
  }

  // Walk a subtree and process every eligible text node.
  function processTree(root) {
    if (!root) return;
    if (root.nodeType === 3) { // text node passed directly
      if (!isSkippable(root)) processTextNode(root);
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9) return;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          if (!hasTrigger(node.nodeValue)) return NodeFilter.FILTER_REJECT;
          if (isSkippable(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(processTextNode);
  }

  let observer = null;

  function withObserverPaused(fn) {
    if (observer) observer.disconnect();
    try { fn(); }
    finally {
      if (observer) {
        document.querySelectorAll(".tab-content, .sub-tab-content").forEach(function (el) {
          observer.observe(el, { childList: true, subtree: true });
        });
      }
    }
  }

  function init() {
    injectStyle();

    // First pass over everything already in the page (e.g. the About tab).
    withObserverPaused(function () {
      processTree(document.body);
    });

    // Watch the tab containers so fetched content gets processed too.
    observer = new MutationObserver(function (mutations) {
      const roots = [];
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (n) {
          if (n.nodeType === 1 || n.nodeType === 3) roots.push(n);
        });
      });
      if (!roots.length) return;
      withObserverPaused(function () {
        roots.forEach(processTree);
      });
    });

    document.querySelectorAll(".tab-content, .sub-tab-content").forEach(function (el) {
      observer.observe(el, { childList: true, subtree: true });
    });
  }

  // Expose a manual hook in case you ever want to re-run it by hand.
  window.renderEmojiShortcodes = function (root) {
    withObserverPaused(function () { processTree(root || document.body); });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
