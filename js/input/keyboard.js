import { KEYBOARD_MAPPING } from "../config/keyboard.js";

export class KeyboardInput {

    constructor(eventBus) {
        this.eventBus = eventBus;

        this.activeKeys = new Set();
        this.keyToNote = new Map();

        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleKeyUp = this.handleKeyUp.bind(this);
        this.handleBlur = this.handleBlur.bind(this);
    }

    start() {
        window.addEventListener(
            "keydown",
            this.handleKeyDown
        );

        window.addEventListener(
            "keyup",
            this.handleKeyUp
        );

        window.addEventListener(
            "blur",
            this.handleBlur
        );
    }

    stop() {
        window.removeEventListener(
            "keydown",
            this.handleKeyDown
        );

        window.removeEventListener(
            "keyup",
            this.handleKeyUp
        );

        window.removeEventListener(
            "blur",
            this.handleBlur
        );

        this.releaseAll();
    }

    handleKeyDown(event) {

        if (this.shouldIgnoreKeyboardEvent(event)) {
            return;
        }

        const key = event.key.toLowerCase();
        const note = KEYBOARD_MAPPING[key];

        if (note === undefined) {
            return;
        }

        // Ignore browser-generated key repetition.
        if (event.repeat) {
            return;
        }

        // Protect against duplicate note-on events.
        if (this.activeKeys.has(key)) {
            return;
        }

        this.activeKeys.add(key);

        event.preventDefault();

        this.eventBus.emit({
            type: "noteon",
            note,
            velocity: 1,
            channel: 0,
            source: "keyboard",
            timestamp: performance.now()
        });
    }

    handleKeyUp(event) {

        if (this.shouldIgnoreKeyboardEvent(event)) {
            return;
        }

        const key = event.key.toLowerCase();
        const note = KEYBOARD_MAPPING[key];

        if (note === undefined) {
            return;
        }

        if (!this.activeKeys.has(key)) {
            return;
        }

        this.activeKeys.delete(key);

        event.preventDefault();

        this.eventBus.emit({
            type: "noteoff",
            note,
            velocity: 0,
            channel: 0,
            source: "keyboard",
            timestamp: performance.now()
        });
    }

    handleBlur() {
        this.releaseAll();
    }

    releaseAll() {

        for (const key of this.activeKeys) {

            const note = KEYBOARD_MAPPING[key];

            if (note === undefined) {
                continue;
            }

            this.eventBus.emit({
                type: "noteoff",
                note,
                velocity: 0,
                channel: 0,
                source: "keyboard",
                timestamp: performance.now()
            });
        }

        this.activeKeys.clear();
    }

    shouldIgnoreKeyboardEvent(event) {

        const target = event.target;

        if (!target) {
            return false;
        }

        const tagName = target.tagName?.toLowerCase();

        if (
            tagName === "input" ||
            tagName === "textarea" ||
            tagName === "select"
        ) {
            return true;
        }

        if (target.isContentEditable) {
            return true;
        }

        return false;
    }
}
