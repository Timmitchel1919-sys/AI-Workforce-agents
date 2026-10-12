export function determineNotificationChannels(severity) {
    switch (severity) {
        case "critical":
            return ["in-app", "email", "whatsapp", "push"];
        case "high":
            return ["in-app", "email"];
        case "medium":
        case "low":
        case "info":
        default:
            return ["in-app"];
    }
}
/**
 * In-memory notification publisher for local tests, audits, and decoupled worker queues.
 */
export class InMemoryAlertPublisher {
    events = [];
    async publish(event) {
        this.events.push({ ...event });
    }
    getPublishedEvents() {
        return [...this.events];
    }
    clear() {
        this.events.length = 0;
    }
}
