export const SCALES = [
    {
        id: "major",
        label: "MAJEURE",
        // Ionian palette, extended with the octave so 16 inputs
        // can remain distinct without leaving the harmonic family.
        intervals: [0, 2, 4, 5, 7, 9, 11, 12]
    },
    {
        id: "minor",
        label: "MINEURE",
        // Natural minor palette.
        intervals: [0, 2, 3, 5, 7, 8, 10, 12]
    },
    {
        id: "suspended",
        label: "SUSPENDUE",
        // Suspended / open palette: no third, with a strong 4th/5th character.
        intervals: [0, 2, 5, 7, 9, 10, 12, 14]
    }
];

const PLAYTRON_ROOT_NOTE = 50;
const KEYBOARD_ROOT_NOTE = 50;
const PLAYTRON_INPUT_COUNT = 16;
const PLAYTRON_MAX_SCALE_STEP = PLAYTRON_INPUT_COUNT - 1;

export class ScaleManager {
    constructor() {
        this.index = 0;
        this.activeNotes = new Map();
        this.playtronRawNotes = [];
    }

    get currentScale() {
        return SCALES[this.index];
    }

    get label() {
        return this.currentScale.label;
    }

    next() {
        const releases = [];

        for (const active of this.activeNotes.values()) {
            releases.push({
                ...active.event,
                type: "noteoff",
                note: active.mappedNote,
                velocity: 0,
                rawNote: active.event.note
            });
        }

        this.activeNotes.clear();
        this.index = (this.index + 1) % SCALES.length;

        return {
            scale: this.currentScale,
            releases
        };
    }

    transform(event) {
        if (
            !event ||
            !Number.isFinite(event.note) ||
            (event.type !== "noteon" && event.type !== "noteoff")
        ) {
            return event;
        }

        const key =
            event.source +
            "-" +
            event.channel +
            "-" +
            event.note;

        if (event.type === "noteon") {
            const mappedNote =
                event.source === "midi"
                    ? this.mapPlaytronNote(event.note)
                    : this.isDiscreteInstrumentSource(event.source)
                        ? this.mapKeyboardNote(event.note)
                        : event.note;

            this.activeNotes.set(key, {
                event,
                mappedNote
            });

            return {
                ...event,
                rawNote: event.note,
                note: mappedNote
            };
        }

        const active = this.activeNotes.get(key);

        const mappedNote =
            active?.mappedNote ??
            (
                event.source === "midi"
                    ? this.mapPlaytronNote(event.note)
                    : this.isDiscreteInstrumentSource(event.source)
                        ? this.mapKeyboardNote(event.note)
                        : event.note
            );

        this.activeNotes.delete(key);

        return {
            ...event,
            rawNote: event.note,
            note: mappedNote
        };
    }

    isDiscreteInstrumentSource(source) {
        return source === "keyboard" || source === "touch";
    }

    mapPlaytronNote(note) {
        if (!Number.isFinite(note)) {
            return PLAYTRON_ROOT_NOTE;
        }

        if (!this.playtronRawNotes.includes(note)) {
            this.playtronRawNotes.push(note);
            this.playtronRawNotes.sort((a, b) => a - b);

            if (this.playtronRawNotes.length > PLAYTRON_INPUT_COUNT) {
                this.playtronRawNotes.shift();
            }
        }

        const index = Math.max(
            0,
            this.playtronRawNotes.indexOf(note)
        );

        return this.scaleNote(
            PLAYTRON_ROOT_NOTE,
            index
        );
    }

    mapKeyboardNote(note) {
        const keyboardIndex = Math.max(
            0,
            Math.min(
                PLAYTRON_MAX_SCALE_STEP,
                Math.round(note - 60)
            )
        );

        return this.scaleNote(
            KEYBOARD_ROOT_NOTE,
            keyboardIndex
        );
    }

    scaleNote(rootNote, scaleSteps) {
        const intervals = this.currentScale.intervals;
        const octave = Math.floor(scaleSteps / intervals.length);
        const degree = scaleSteps % intervals.length;

        return (
            rootNote +
            octave * 12 +
            intervals[degree]
        );
    }

    quantize(note) {
        const intervals = this.currentScale.intervals;
        const relative = note - KEYBOARD_ROOT_NOTE;
        const octave = Math.floor(relative / 12);

        let nearestNote = null;
        let nearestDistance = Infinity;

        for (const octaveOffset of [-1, 0, 1]) {
            for (const interval of intervals) {
                const candidate =
                    KEYBOARD_ROOT_NOTE +
                    (octave + octaveOffset) * 12 +
                    interval;

                const distance = Math.abs(candidate - note);

                if (distance < nearestDistance) {
                    nearestNote = candidate;
                    nearestDistance = distance;
                }
            }
        }

        return nearestNote;
    }

    resetHeldNotes() {
        this.activeNotes.clear();
    }
}
