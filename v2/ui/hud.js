export function createHud() {
  const el = document.getElementById("hud");
  return {
    update({ perf, toolState, sculptSystem }) {
      if (!el) return;
      const lines = [
        `fps: ${perf.fps.toFixed(1)}  frame: ${perf.frameMs.toFixed(2)} ms`,
        `chunks active: ${perf.activeChunks}  tris≈ ${perf.trisApprox.toLocaleString()}`,
        `stream created/remesh/unload: ${perf.stream.created}/${perf.stream.remeshed}/${perf.stream.unloaded}`,
        `queues create/remesh/unload: ${perf.queues.create}/${perf.queues.remesh}/${perf.queues.unload}`,
        `mode: ${toolState.mode} (${toolState.sculptMode})`,
        `brush radius=${toolState.brush.radius.toFixed(1)} strength=${toolState.brush.strength.toFixed(2)} shape=${toolState.brush.falloff.toFixed(2)}`,
        `LMB raise · Shift+LMB lower · Ctrl+LMB smooth · Alt+LMB flatten`,
        `wheel: Shift = radius, Alt = strength`,
        `undo=${sculptSystem.undoStack.length} redo=${sculptSystem.redoStack.length}`,
      ];
      el.textContent = lines.join("\n");
    },
  };
}

