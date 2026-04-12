// ── Sound system using Web Audio API (no external files needed) ──
// Generates subtle UI sounds programmatically

const Sounds = (() => {
  let ctx = null;
  let enabled = true;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  function playTone({ freq = 440, freq2 = null, type = 'sine', duration = 0.08, gain = 0.06, attack = 0.005, decay = 0.05 }) {
    if (!enabled) return;
    try {
      const c = getCtx();
      const osc = c.createOscillator();
      const gainNode = c.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, c.currentTime);
      if (freq2) osc.frequency.linearRampToValueAtTime(freq2, c.currentTime + duration);

      gainNode.gain.setValueAtTime(0, c.currentTime);
      gainNode.gain.linearRampToValueAtTime(gain, c.currentTime + attack);
      gainNode.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);

      osc.connect(gainNode);
      gainNode.connect(c.destination);

      osc.start(c.currentTime);
      osc.stop(c.currentTime + duration + 0.01);
    } catch(e) {}
  }

  return {
    copy()    { playTone({ freq: 880, freq2: 1100, duration: 0.1, gain: 0.05, type: 'sine' }); },
    delete()  { playTone({ freq: 400, freq2: 280,  duration: 0.1, gain: 0.04, type: 'sine' }); },
    favorite(){ playTone({ freq: 660, freq2: 880,  duration: 0.12, gain: 0.06, type: 'triangle' }); },
    open()    { playTone({ freq: 660, freq2: 880,  duration: 0.15, gain: 0.04, type: 'sine' }); },
    close()   { playTone({ freq: 500, freq2: 380,  duration: 0.12, gain: 0.04, type: 'sine' }); },
    tab()     { playTone({ freq: 740, duration: 0.07, gain: 0.04, type: 'sine' }); },
    emoji()   { playTone({ freq: 900, freq2: 1200, duration: 0.1,  gain: 0.04, type: 'sine' }); },
    toggle(v) { enabled = v; }
  };
})();

window.Sounds = Sounds;
