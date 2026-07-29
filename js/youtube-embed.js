/*
 * Reusable YouTube embed: hover to play, click to toggle sound, optionally
 * looping a start/end segment. Used by blog posts loaded into .sub-tab-content
 * via fetch()+innerHTML (see index.html), so this file re-executes on every
 * load — init() is idempotent via the data-yt-ready guard.
 *
 * Markup:
 *   <div class="subtab-about-image youtube-embed" style="--image-padding: 12px;">
 *     <figure>
 *       <div class="youtube-embed-wrapper">
 *         <div class="youtube-embed-mount" data-video-id="VIDEO_ID" data-start="40" data-end="60"></div>
 *         <div class="youtube-embed-hitbox" title="Hover to play, click to toggle sound"></div>
 *       </div>
 *       <figcaption>...</figcaption>
 *     </figure>
 *   </div>
 *   <script src="js/youtube-embed.js"></script>
 *
 * data-start/data-end are optional (in seconds); omit both to play the full video.
 */
(function () {
  'use strict';

  function loadIframeAPI(callback) {
    if (window.YT && window.YT.Player) {
      callback();
      return;
    }
    var prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () {
      if (prevReady) prevReady();
      callback();
    };
    if (!document.getElementById('youtube-iframe-api')) {
      var tag = document.createElement('script');
      tag.id = 'youtube-iframe-api';
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }
  }

  function createPlayer(mount) {
    mount.dataset.ytReady = '1';

    var videoId = mount.dataset.videoId;
    if (!videoId) return;
    var start = parseInt(mount.dataset.start, 10) || 0;
    var end = parseInt(mount.dataset.end, 10) || undefined;

    // Grab the wrapper/hitbox before YT.Player replaces `mount` with its
    // iframe, since `mount` is detached from the DOM once that swap happens.
    var wrapper = mount.closest('.youtube-embed-wrapper');
    var hitbox = wrapper ? wrapper.querySelector('.youtube-embed-hitbox') : null;

    var playerVars = { mute: 1, controls: 0, start: start, playsinline: 1 };
    if (end) playerVars.end = end;

    var player = new YT.Player(mount, {
      host: 'https://www.youtube-nocookie.com',
      videoId: videoId,
      playerVars: playerVars,
      events: {
        onStateChange: function (e) {
          if (e.data === YT.PlayerState.ENDED) {
            player.seekTo(start, true);
            player.playVideo();
          }
        }
      }
    });

    if (hitbox) {
      // Hover plays/pauses; click toggles sound. Sound is only ever
      // unmuted from a click, since browsers won't allow unmuted
      // autoplay/hover to keep a video playing.
      hitbox.addEventListener('mouseenter', function () { player.playVideo(); });
      hitbox.addEventListener('mouseleave', function () { player.pauseVideo(); });
      hitbox.addEventListener('click', function () {
        if (player.isMuted()) {
          player.unMute();
        } else {
          player.mute();
        }
      });
    }
  }

  function init() {
    var mounts = document.querySelectorAll('.youtube-embed-mount:not([data-yt-ready])');
    if (!mounts.length) return;
    loadIframeAPI(function () {
      mounts.forEach(createPlayer);
    });
  }

  window.YouTubeEmbed = { init: init };
  init();
})();
