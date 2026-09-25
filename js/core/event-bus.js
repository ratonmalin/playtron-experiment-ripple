export class EventBus {

    constructor() {
        this.listeners = new Map();
    }

    on(eventType, callback) {
        if (!this.listeners.has(eventType)) {
            this.listeners.set(eventType, new Set());
        }

        this.listeners
            .get(eventType)
            .add(callback);

        return () => {
            this.off(eventType, callback);
        };
    }

    off(eventType, callback) {
        const listeners = this.listeners.get(eventType);

        if (!listeners) {
            return;
        }

        listeners.delete(callback);

        if (listeners.size === 0) {
            this.listeners.delete(eventType);
        }
    }

    emit(event) {
        const listeners = this.listeners.get(event.type);

        if (!listeners) {
            return;
        }

        for (const callback of listeners) {
            callback(event);
        }
    }
}
