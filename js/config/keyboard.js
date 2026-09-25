export const KEYBOARD_MAPPING = {
    a: 60, // C4
    z: 61, // C#4
    e: 62, // D4
    r: 63, // D#4
    t: 64, // E4
    y: 65, // F4
    u: 66, // F#4
    i: 67, // G4
    o: 68, // G#4
    p: 69, // A4
    q: 70, // A#4
    s: 71, // B4
    d: 72, // C5
    f: 73, // C#5
    g: 74, // D5
    h: 75, // D#5
    j: 76  // E5
};

export const MIDI_NOTE_NAMES = [
    "Do",
    "Do♯",
    "Ré",
    "Ré♯",
    "Mi",
    "Fa",
    "Fa♯",
    "Sol",
    "Sol♯",
    "La",
    "La♯",
    "Si"
];

export function midiToNoteName(midiNote) {
    const noteIndex = midiNote % 12;
    const octave = Math.floor(midiNote / 12) - 1;

    return `${MIDI_NOTE_NAMES[noteIndex]} ${octave}`;
}
