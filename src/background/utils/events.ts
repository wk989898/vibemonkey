type EventHandler<T> = (data: T, type: string) => void;
type EventMap<T> = Record<string, EventHandler<T>[] | undefined>;

export default function getEventEmitter<T = unknown>() {
  const events: EventMap<T> = {};
  return { on, off, fire };

  function on(type: string, func: EventHandler<T>) {
    let list = events[type];
    if (!list) {
      list = [];
      events[type] = list;
    }
    list.push(func);
  }
  function off(type: string, func: EventHandler<T>) {
    const list = events[type];
    if (list) {
      const i = list.indexOf(func);
      if (i >= 0) list.splice(i, 1);
    }
  }
  function fire(type: string, data: T) {
    const list = events[type];
    if (list) {
      list.forEach((func) => {
        func(data, type);
      });
    }
  }
}
