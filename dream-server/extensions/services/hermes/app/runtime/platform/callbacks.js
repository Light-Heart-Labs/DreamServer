const { EventEmitter } = require("events");

class RuntimeCallbacks extends EventEmitter {
  safeEmit(eventName, payload = {}) {
    try {
      this.emit(eventName, payload);
    } catch (error) {
      this.emit("callback_error", {
        eventName,
        message: error?.message || "Callback failed."
      });
    }
  }
}

module.exports = {
  RuntimeCallbacks
};
