/**
 *
 * @param render
 * @param interval
 */
function createIntervalRunner(render, interval) {
  const state = { stopped: false, running: false };
  let skipWait = null;

  /**
   *
   */
  async function cycle() {
    if (state.stopped) {
      state.running = false;
      return;
    }
    state.running = true;
    await render();
    await new Promise((resolve) => {
      skipWait = resolve;
      setTimeout(resolve, interval);
    });
    skipWait = null;
    if (!state.stopped) cycle();
    else state.running = false;
  }

  // Start the first cycle
  cycle();

  return {
    skipToNext: () => {
      if (skipWait) skipWait();
    },
    stop: () => {
      state.stopped = true;
      if (skipWait) skipWait();
    },
    resume: () => {
      if (!state.running) {
        state.stopped = false;
        cycle();
      }
    },
  };
}

module.exports = {
  createIntervalRunner,
};
