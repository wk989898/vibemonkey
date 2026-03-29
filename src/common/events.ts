type EventData<TType extends string, TData> = {
  type: TType;
  data: TData;
  defaultPrevented: boolean;
  preventDefault(): void;
};

type EventHandler<TType extends string, TData> = (event: EventData<TType, TData>) => void;

export default class EventEmitter<TType extends string = string, TData = unknown> {
  events: Partial<Record<TType, EventHandler<TType, TData>[]>>;

  allowed?: readonly TType[];

  constructor(allowed?: readonly TType[]) {
    this.events = {};
    this.allowed = allowed;
  }

  checkType(type: TType) {
    if (this.allowed && !this.allowed.includes(type)) {
      throw new Error(`Unknown event type: ${type}`);
    }
  }

  on(type: TType, handle: EventHandler<TType, TData>) {
    this.checkType(type);
    const { events } = this;
    let handlers = events[type];
    if (!handlers) {
      handlers = [];
      events[type] = handlers;
    }
    return () => this.off(type, handle);
  }

  off(type: TType, handle: EventHandler<TType, TData>) {
    this.checkType(type);
    const handlers = this.events[type];
    if (handlers) {
      const i = handlers.indexOf(handle);
      if (i >= 0) handlers.splice(i, 1);
    }
  }

  emit(type: TType, data: TData) {
    this.checkType(type);
    const handlers = this.events[type];
    if (handlers) {
      const evt = {
        type,
        data,
        defaultPrevented: false,
        preventDefault() {
          evt.defaultPrevented = true;
        },
      };
      handlers.some((handle) => {
        handle(evt);
        return evt.defaultPrevented;
      });
    }
  }
}
