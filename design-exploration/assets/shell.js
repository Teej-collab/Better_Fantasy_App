// THE WEEKEND — Redesign Exploration — shared phone-shell interaction logic.
// Pure DOM, no framework, no network calls. Reused across all 3 directions.

function initShell(root) {
  const scope = root || document;

  function showScreen(name) {
    scope.querySelectorAll('.screen').forEach((el) => {
      el.classList.toggle('active', el.dataset.screen === name);
      el.hidden = el.dataset.screen !== name;
    });
    scope.querySelectorAll('[data-nav-target]').forEach((el) => {
      el.classList.toggle('active', el.dataset.navTarget === name);
    });
    const screenEl = scope.querySelector('.screen[data-screen="' + name + '"]');
    if (screenEl) screenEl.scrollTop = 0;
    closeDrawer();
  }

  scope.querySelectorAll('[data-nav-target]').forEach((el) => {
    el.addEventListener('click', () => showScreen(el.dataset.navTarget));
  });

  // Segmented controls (e.g. League: Overview / Standings / Activity)
  scope.querySelectorAll('.segmented').forEach((seg) => {
    seg.querySelectorAll('button[data-pane]').forEach((btn) => {
      btn.addEventListener('click', () => {
        seg.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const paneGroup = btn.closest('[data-pane-group]') || scope;
        const groupName = seg.dataset.paneGroup;
        scope.querySelectorAll('[data-pane-of="' + groupName + '"]').forEach((p) => {
          p.hidden = p.dataset.pane !== btn.dataset.pane;
        });
      });
    });
  });

  // Bottom sheets (player detail, etc.)
  scope.querySelectorAll('[data-open-sheet]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.openSheet;
      const sheet = scope.querySelector('#' + id);
      const backdrop = scope.querySelector('#' + id + '-backdrop');
      if (sheet) sheet.classList.add('open');
      if (backdrop) backdrop.classList.add('open');
    });
  });
  scope.querySelectorAll('[data-close-sheet]').forEach((el) => {
    el.addEventListener('click', () => {
      const sheet = el.closest('.sheet') || scope.querySelector('#' + el.dataset.closeSheet);
      const backdrop = sheet ? scope.querySelector('#' + sheet.id + '-backdrop') : null;
      if (sheet) sheet.classList.remove('open');
      if (backdrop) backdrop.classList.remove('open');
    });
  });

  // Hamburger drawer (Direction C)
  function closeDrawer() {
    const drawer = scope.querySelector('.drawer');
    const backdrop = scope.querySelector('.drawer-backdrop');
    if (drawer) drawer.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
  }
  scope.querySelectorAll('[data-open-drawer]').forEach((el) => {
    el.addEventListener('click', () => {
      const drawer = scope.querySelector('.drawer');
      const backdrop = scope.querySelector('.drawer-backdrop');
      if (drawer) drawer.classList.add('open');
      if (backdrop) backdrop.classList.add('open');
    });
  });
  scope.querySelectorAll('[data-close-drawer]').forEach((el) => {
    el.addEventListener('click', closeDrawer);
  });

  // Generic show/hide toggle — used by Settings' "preview a state" demo
  // buttons (offline banner, loading skeleton) so those states can be
  // inspected without wiring real network conditions into a prototype.
  scope.querySelectorAll('[data-toggle-target]').forEach((el) => {
    el.addEventListener('click', () => {
      const target = scope.querySelector('#' + el.dataset.toggleTarget);
      if (!target) return;
      target.hidden = !target.hidden;
      if (el.dataset.toggleLabel) {
        const showing = !target.hidden;
        el.textContent = showing ? el.dataset.toggleLabelOn || 'Hide' : el.dataset.toggleLabel;
      }
    });
  });

  // Accent swatch picker (Settings) — purely visual selection state
  scope.querySelectorAll('.accent-picker').forEach((picker) => {
    picker.querySelectorAll('.accent-swatch').forEach((sw) => {
      sw.addEventListener('click', () => {
        picker.querySelectorAll('.accent-swatch').forEach((s) => s.classList.remove('selected'));
        sw.classList.add('selected');
      });
    });
  });

  // Intro carousel — dot indicator follows native scroll-snap position;
  // a "Next" control (if present) advances programmatically. Works from
  // real touch swipe too, since both just move .carousel-track's
  // scrollLeft.
  scope.querySelectorAll('.carousel-track').forEach((track) => {
    const dots = scope.querySelectorAll('[data-dots-for="' + track.dataset.carousel + '"] .dot');
    function syncDots() {
      const idx = Math.round(track.scrollLeft / track.clientWidth);
      dots.forEach((d, i) => d.classList.toggle('active', i === idx));
    }
    track.addEventListener('scroll', () => requestAnimationFrame(syncDots));
    syncDots();
  });
  scope.querySelectorAll('[data-carousel-next]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const track = scope.querySelector('.carousel-track[data-carousel="' + btn.dataset.carouselNext + '"]');
      if (!track) return;
      const max = track.scrollWidth - track.clientWidth;
      const next = Math.min(track.scrollLeft + track.clientWidth, max);
      if (track.scrollLeft >= max - 4) {
        const target = btn.dataset.carouselEnd;
        if (target) showScreen(target);
        return;
      }
      track.scrollTo({ left: next, behavior: 'smooth' });
    });
  });

  // League picker — tap to select (visual only, no real auth)
  scope.querySelectorAll('.league-pick-card').forEach((card) => {
    card.addEventListener('click', () => {
      const group = card.closest('[data-league-picker]');
      if (group) group.querySelectorAll('.league-pick-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });

  // Watch Party — mic/camera controls toggle an "off" visual state; the
  // matching tile in the grid (if data-tile-for names it) mirrors mute
  // state onto its name-bar icon. Leave/invite buttons are inert here
  // (real navigation, not a toggle).
  scope.querySelectorAll('.wp-control-btn[data-toggle-mute], .wp-control-btn[data-toggle-camera]').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('off');
      const tileId = btn.dataset.toggleMute || btn.dataset.toggleCamera;
      const tile = tileId ? scope.querySelector('#' + tileId) : null;
      if (!tile) return;
      if (btn.dataset.toggleMute) tile.classList.toggle('muted', btn.classList.contains('off'));
      if (btn.dataset.toggleCamera) tile.classList.toggle('camera-off', btn.classList.contains('off'));
    });
  });

  // Watch Party — collapse/expand the fantasy overlay strip during a call
  scope.querySelectorAll('[data-toggle-fantasy-strip]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const strip = scope.querySelector('#' + btn.dataset.toggleFantasyStrip);
      if (strip) strip.classList.toggle('collapsed');
    });
  });

  // Optional deep link for review purposes: index.html?screen=gamecast
  const requested = new URLSearchParams(location.search).get('screen');
  if (requested && scope.querySelector('.screen[data-screen="' + requested + '"]')) {
    showScreen(requested);
  }

  // Live clock in status bar
  scope.querySelectorAll('.js-clock').forEach((el) => {
    const now = new Date();
    let h = now.getHours();
    const m = now.getMinutes().toString().padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    el.textContent = h + ':' + m;
  });

  // Simple count-up for score numbers marked data-countup
  scope.querySelectorAll('[data-countup]').forEach((el) => {
    const target = parseFloat(el.dataset.countup);
    if (Number.isNaN(target)) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = target.toFixed(1);
      return;
    }
    let start = null;
    const duration = 900;
    function step(ts) {
      if (!start) start = ts;
      const p = Math.min(1, (ts - start) / duration);
      el.textContent = (target * p).toFixed(1);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
}

document.addEventListener('DOMContentLoaded', () => initShell(document));
