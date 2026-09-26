const VERSION = new URL(import.meta.url).searchParams.get("v") || "unknown";

const keyboardModule = await import(`./config/keyboard.js?v=${VERSION}`);
const eventBusModule = await import(`./core/event-bus.js?v=${VERSION}`);
const keyboardInputModule = await import(`./input/keyboard.js?v=${VERSION}`);
const touchInputModule = await import(`./input/touch.js?v=${VERSION}`);
const audioModule = await import(`./audio/audio.js?v=${VERSION}`);
const midiModule = await import(`./input/midi.js?v=${VERSION}`);
const visualModule = await import(`./visuals/visual-engine.js?v=${VERSION}`);
const { KEYBOARD_MAPPING, midiToNoteName } = keyboardModule;
const { ScaleManager } = await import(`./config/scales.js?v=${VERSION}`);
const { EventBus } = eventBusModule;
const { KeyboardInput } = keyboardInputModule;
const { TouchInput } = touchInputModule;
const { AudioEngine } = audioModule;
const { MidiInput } = midiModule;
const { VisualEngine } = visualModule;

const eventBus = new EventBus();
const scaleManager = new ScaleManager();
const scaledInputBus = {
    emit(event) {
        eventBus.emit(scaleManager.transform(event));
    }
};

const keyboardElement = document.querySelector("#keyboard");
const keyboard = new KeyboardInput(scaledInputBus);
const touch = new TouchInput(scaledInputBus, keyboardElement, KEYBOARD_MAPPING);
const audioEngine = new AudioEngine(eventBus);
const midiInput = new MidiInput(scaledInputBus);
const visualEngine = new VisualEngine(eventBus);

const scaleButton = document.querySelector("#scale-button");
const fullscreenButton = document.querySelector("#fullscreen-button");

function updateScaleButton() {
    if (!scaleButton) return;

    scaleButton.textContent = `GAMME · ${scaleManager.label}`;
    scaleButton.setAttribute(
        "aria-label",
        `Changer de gamme · actuelle : ${scaleManager.label}`
    );
}

function updateFullscreenButton() {
    if (!fullscreenButton) return;

    fullscreenButton.textContent =
        document.fullscreenElement ? "EXIT FULL SCREEN" : "FULL SCREEN";
}

if (scaleButton) {
    scaleButton.addEventListener("click", async () => {
        try {
            await audioEngine.start();
        } catch (error) {
            console.warn("[AUDIO] Setup gesture failed:", error);
        }

        const { releases } = scaleManager.next();
        for (const event of releases) {
            eventBus.emit(event);
        }

        updateScaleButton();
        eventBus.emit({
            type: "scalechange",
            index: scaleManager.index,
            scale: scaleManager.currentScale
        });
    });
}

if (fullscreenButton) {
    fullscreenButton.addEventListener("click", async () => {
        try {
            await audioEngine.start();
        } catch (error) {
            console.warn("[AUDIO] Setup gesture failed:", error);
        }

        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
            } else {
                await document.documentElement.requestFullscreen();
            }
        } catch (error) {
            console.warn("[UI] Fullscreen unavailable:", error);
        }

        updateFullscreenButton();
    });

    document.addEventListener("fullscreenchange", updateFullscreenButton);
}

function createKeyboardUI() {
    if (!keyboardElement) return;

    keyboardElement.innerHTML = "";

    for (const [key, midiNote] of Object.entries(KEYBOARD_MAPPING)) {
        const element = document.createElement("div");
        element.className = "key";
        element.dataset.key = key;

        element.innerHTML = `
            <span class="key-note">${midiToNoteName(scaleManager.mapKeyboardNote(midiNote))}</span>
        `;

        keyboardElement.appendChild(element);
    }
}

const activeKeyboardNotes = new Map();

function findKeyForNote(note) {
    for (const [key, midiNote] of Object.entries(KEYBOARD_MAPPING)) {
        if (midiNote === note) return key;
    }
    return null;
}

function updateKeyboardKey(event) {
    if (
        !keyboardElement ||
        (event.source !== "keyboard" && event.source !== "touch")
    ) {
        return;
    }

    const rawNote = Number.isFinite(event.rawNote) ? event.rawNote : event.note;
    const key = findKeyForNote(rawNote);
    if (!key) return;

    const element = keyboardElement.querySelector(`[data-key="${key}"]`);
    if (!element) return;

    if (event.type === "noteon") {
        activeKeyboardNotes.set(
            event.note,
            (activeKeyboardNotes.get(event.note) || 0) + 1
        );
        element.classList.add("active");
        return;
    }

    const count = Math.max(
        0,
        (activeKeyboardNotes.get(event.note) || 1) - 1
    );

    if (count === 0) {
        activeKeyboardNotes.delete(event.note);
        element.classList.remove("active");
    } else {
        activeKeyboardNotes.set(event.note, count);
    }
}

eventBus.on("noteon", updateKeyboardKey);
eventBus.on("noteoff", updateKeyboardKey);

createKeyboardUI();
updateScaleButton();
updateFullscreenButton();

// Publish the initial scale explicitly so every subsystem starts from
// the same musical state instead of relying on constructor defaults.
eventBus.emit({
    type: "scalechange",
    index: scaleManager.index,
    scale: scaleManager.currentScale
});

keyboard.start();
touch.start();
midiInput.start();
visualEngine.start();

console.log("[GARDEN] Ready", VERSION);
