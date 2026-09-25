export class TouchInput {
    constructor(eventBus, keyboardElement, keyboardMapping) {
        this.eventBus = eventBus;
        this.keyboardElement = keyboardElement;
        this.keyboardMapping = keyboardMapping;
        this.notes = Object.values(keyboardMapping);
        this.activePointers = new Map();

        this.handlePointerDown = this.handlePointerDown.bind(this);
        this.handlePointerMove = this.handlePointerMove.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
        this.handlePointerCancel = this.handlePointerCancel.bind(this);
    }

    start() {
        document.addEventListener(
            "pointerdown",
            this.handlePointerDown,
            { passive: false }
        );
        document.addEventListener(
            "pointermove",
            this.handlePointerMove,
            { passive: false }
        );
        document.addEventListener(
            "pointerup",
            this.handlePointerUp
        );
        document.addEventListener(
            "pointercancel",
            this.handlePointerCancel
        );
    }

    stop() {
        document.removeEventListener(
            "pointerdown",
            this.handlePointerDown
        );
        document.removeEventListener(
            "pointermove",
            this.handlePointerMove
        );
        document.removeEventListener(
            "pointerup",
            this.handlePointerUp
        );
        document.removeEventListener(
            "pointercancel",
            this.handlePointerCancel
        );

        this.releaseAll();
    }

    handlePointerDown(event) {
        if (event.pointerType !== "touch") return;
        if (this.isInterfaceControl(event.target)) return;


        const note = this.getNoteAtX(event.clientX);

        if (note === null) return;

        event.preventDefault();

        if (this.activePointers.has(event.pointerId)) {
            return;
        }

        this.activePointers.set(
            event.pointerId,
            { note }
        );

        this.emitNoteOn(note);
    }

    handlePointerMove(event) {
        if (event.pointerType !== "touch") return;

        const active =
            this.activePointers.get(event.pointerId);

        if (!active) return;

        event.preventDefault();

        const note =
            this.getNoteAtX(event.clientX);

        if (note === null || note === active.note) {
            return;
        }

        this.emitNoteOff(active.note);

        active.note = note;

        this.emitNoteOn(note);
    }

    handlePointerUp(event) {
        if (event.pointerType !== "touch") return;

        this.releasePointer(event.pointerId);
    }

    handlePointerCancel(event) {
        if (event.pointerType !== "touch") return;

        this.releasePointer(event.pointerId);
    }

    releasePointer(pointerId) {
        const active =
            this.activePointers.get(pointerId);

        if (!active) return;

        this.emitNoteOff(active.note);
        this.activePointers.delete(pointerId);
    }

    releaseAll() {
        for (const pointerId of this.activePointers.keys()) {
            this.releasePointer(pointerId);
        }
    }

    getNoteAtX(clientX) {
        if (!this.keyboardElement || this.notes.length === 0) {
            return null;
        }

        const rect =
            this.keyboardElement.getBoundingClientRect();

        if (rect.width <= 0) return null;

        const normalized =
            Math.max(
                0,
                Math.min(
                    0.999999,
                    (clientX - rect.left) / rect.width
                )
            );

        const index =
            Math.floor(
                normalized * this.notes.length
            );

        return this.notes[index] ?? null;
    }

    isInterfaceControl(target) {
        if (!(target instanceof Element)) {
            return false;
        }

        return Boolean(
            target.closest(
                "button, a, input, textarea, select"
            )
        );
    }

    emitNoteOn(note) {
        this.eventBus.emit({
            type: "noteon",
            note,
            velocity: 1,
            channel: 0,
            source: "touch",
            timestamp: performance.now()
        });
    }

    emitNoteOff(note) {
        this.eventBus.emit({
            type: "noteoff",
            note,
            velocity: 0,
            channel: 0,
            source: "touch",
            timestamp: performance.now()
        });
    }
}
