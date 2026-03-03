/**
 * Footstep audio system using Web Audio API.
 * Loads a pool of sounds, plays a random one on each foot plant.
 * Usage: const footstepAudio = await createFootstepAudio('sounds');
 *        footstepAudio.play(isRunning, volume);
 */
export async function createFootstepAudio(basePath = 'sounds') {
  // steps (4).mp3 excluded — doesn't sound right
  const files = [
    'steps.mp3',
    'steps1.mp3',
    'steps2.mp3',
    'steps (2).mp3',
    'steps (3).mp3',
    'steps (5).mp3',
    'steps (6).mp3',
    'steps (7).mp3',
  ];

  const ctx = new AudioContext();

  const buffers = (await Promise.all(
    files.map(async (f) => {
      try {
        const res = await fetch(`${basePath}/${f}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await ctx.decodeAudioData(await res.arrayBuffer());
      } catch (e) {
        console.warn(`[footsteps] could not load "${f}":`, e.message);
        return null;
      }
    })
  )).filter(Boolean);

  if (buffers.length === 0) {
    console.warn('[footsteps] no sounds loaded — check path:', basePath);
    return { play() {} };
  }

  console.log(`[footsteps] loaded ${buffers.length} sounds`);
  let lastIdx = -1;

  function _pickBuffer() {
    let idx;
    do { idx = Math.floor(Math.random() * buffers.length); }
    while (buffers.length > 1 && idx === lastIdx);
    lastIdx = idx;
    return buffers[idx];
  }

  function _playRaw(pitchRate, volume) {
    if (ctx.state === 'suspended') ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = _pickBuffer();
    src.playbackRate.value = pitchRate;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start();
  }

  return {
    play(isRunning = false, volume = 0.38) {
      _playRaw(isRunning ? 1.35 : 1.0, volume);
    },
    // Lower pitch + louder = heavier landing thud
    playLanding(volume = 0.6) {
      _playRaw(0.72, volume);
    },
  };
}
