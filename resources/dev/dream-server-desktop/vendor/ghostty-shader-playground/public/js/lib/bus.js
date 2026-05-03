export class Bus {
  listeners = [];

  emit(data) {
    this.listeners.forEach((fn) => fn(data));
  }

  subscribe(fn) {
    this.listeners.push(fn);
    return { unsubscribe: () => this.unsubscribe(fn) };
  }

  unsubscribe(fn) {
    this.listeners = this.listeners.filter((listener) => listener !== fn);
  }
}
