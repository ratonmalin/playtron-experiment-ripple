const VERSION =
    new URL(import.meta.url).searchParams.get("v") || "unknown";

console.log("[AUDIO ENGINE] Loaded version:", VERSION);

const voiceModule =
    await import(`./voice.js?v=${VERSION}`);

const { Voice } = voiceModule;

export class AudioEngine {

    constructor(eventBus) {
        this.eventBus = eventBus;
        this.audioContext = null;
        this.masterGain = null;
        this.compressor = null;
        this.reverbInput = null;
        this.reverb = null;
        this.reverbGain = null;
        this.activeVoices = new Map();
        this.pendingNotes = new Map();
        this.maxVoices = 16;
        this.started = false;

        this.handleEvent = this.handleEvent.bind(this);
        this.handleUserGesture = this.handleUserGesture.bind(this);

        document.addEventListener(
            "pointerdown",
            this.handleUserGesture,
            { passive: true }
        );
        document.addEventListener(
            "keydown",
            this.handleUserGesture,
            { passive: true }
        );

        eventBus.on("noteon", this.handleEvent);
        eventBus.on("noteoff", this.handleEvent);

        this.handleWindowBlur = () => this.panic();
        this.handleVisibilityChange = () => {
            if (document.visibilityState !== "visible") {
                this.panic();
            }
        };

        window.addEventListener("blur", this.handleWindowBlur);
        document.addEventListener(
            "visibilitychange",
            this.handleVisibilityChange
        );

        console.log("[AUDIO ENGINE] Constructor version:", VERSION);
    }

    async handleUserGesture() {
        if (this.started) return;

        try {
            await this.start();
        } catch (error) {
            console.warn("[AUDIO] User gesture could not unlock audio:", error);
        }
    }

    async start() {
        if (!this.audioContext) {
            const AudioContext =
                window.AudioContext ||
                window.webkitAudioContext;

            if (!AudioContext) {
                throw new Error("Web Audio API indisponible.");
            }

            this.audioContext = new AudioContext();

            this.masterGain =
                this.audioContext.createGain();

            this.masterGain.gain.value = 0.42;

            this.compressor =
                this.audioContext.createDynamicsCompressor();

            this.compressor.threshold.value = -24;
            this.compressor.knee.value = 30;
            this.compressor.ratio.value = 1.5;
            this.compressor.attack.value = 0.08;
            this.compressor.release.value = 1.2;

            this.createReverb();

            this.masterGain.connect(this.compressor);
            this.compressor.connect(this.audioContext.destination);
        }

        if (this.audioContext.state === "suspended") {
            await this.audioContext.resume();
        }

        if (this.audioContext.state !== "running") {
            throw new Error(
                `AudioContext state: ${this.audioContext.state}`
            );
        }

        this.started = true;

        console.log("[AUDIO ENGINE] Running version:", VERSION);
    }

    createReverb() {
        const context = this.audioContext;

        this.reverbInput = context.createGain();

        const duration = 2.8;
        const decay = 5.5;
        const sampleRate = context.sampleRate;
        const length = Math.floor(sampleRate * duration);

        const impulse =
            context.createBuffer(2, length, sampleRate);

        for (let channel = 0; channel < 2; channel++) {
            const data = impulse.getChannelData(channel);

            for (let i = 0; i < length; i++) {
                const time = i / sampleRate;

                const envelope =
                    Math.pow(
                        1 - time / duration,
                        decay
                    );

                const noise = Math.random() * 2 - 1;
                const stereo = channel === 0 ? 1 : 0.92;

                data[i] = noise * envelope * stereo;
            }
        }

        this.reverb =
            context.createConvolver();

        this.reverb.buffer = impulse;

        this.reverbGain =
            context.createGain();

        this.reverbGain.gain.value = 0.58;

        const reverbFilter =
            context.createBiquadFilter();

        reverbFilter.type = "lowpass";
        reverbFilter.frequency.value = 2600;
        reverbFilter.Q.value = 0.2;

        this.reverbInput.connect(this.reverb);
        this.reverb.connect(reverbFilter);
        reverbFilter.connect(this.reverbGain);
        this.reverbGain.connect(this.masterGain);
    }

    handleEvent(event) {
        if (!event || !Number.isFinite(event.note)) {
            return;
        }

        if (event.type !== "noteon" && event.type !== "noteoff") {
            return;
        }

        const pendingKey =
            `${event.source}-${event.channel}-${Number.isFinite(event.rawNote) ? event.rawNote : event.note}`;

        if (!this.started) {
            if (event.type === "noteon") {
                this.pendingNotes.set(pendingKey, event);
            } else {
                this.pendingNotes.delete(pendingKey);
            }

            this.start()
                .then(() => {
                    for (const [key, pendingEvent] of this.pendingNotes) {
                        this.pendingNotes.delete(key);
                        if (pendingEvent.type === "noteon") {
                            this.noteOn(pendingEvent);
                        }
                    }
                })
                .catch(error => {
                    console.warn("[AUDIO] Waiting for user interaction:", error);
                    this.pendingNotes.clear();
                });

            return;
        }

        if (event.type === "noteon") {
            this.noteOn(event);
        }

        if (event.type === "noteoff") {
            this.noteOff(event);
        }
    }

    noteOn(event) {
        if (!this.audioContext || !this.masterGain) return;

        const audioNote = event.note;
        const voiceKey =
            Number.isFinite(event.rawNote)
                ? event.rawNote
                : event.note;

        const voiceId =
            `${event.source}-${event.channel}-${voiceKey}`;

        if (this.activeVoices.has(voiceId)) {
            return;
        }

        if (this.activeVoices.size >= this.maxVoices) {
            const oldestId = this.activeVoices.keys().next().value;
            const oldestVoice = this.activeVoices.get(oldestId);

            if (oldestVoice) {
                try {
                    oldestVoice.release();
                } catch (error) {
                    console.warn("[AUDIO] Voice limit recovery:", error);
                }
            }

            this.activeVoices.delete(oldestId);
        }

        const velocity = Math.max(
            0,
            Math.min(
                1,
                Number.isFinite(event.velocity) ? event.velocity : 1
            )
        );

        const voice =
            new Voice(
                this.audioContext,
                this.masterGain,
                this.reverbInput,
                {
                    note: audioNote,
                    velocity
                }
            );

        this.activeVoices.set(voiceId, voice);
        voice.start();
        this.updateSystemState();
    }

    updateSystemState() {
        const voices = [...this.activeVoices.values()];
        const count = voices.length;

        for (const voice of voices) {
            let nearestDistance = Infinity;

            for (const other of voices) {
                if (other === voice) continue;

                nearestDistance = Math.min(
                    nearestDistance,
                    Math.abs(other.note - voice.note)
                );
            }

            voice.setSystemState({
                count,
                nearestDistance: Number.isFinite(nearestDistance)
                    ? nearestDistance
                    : null
            });
        }
    }

    noteOff(event) {
        const voiceKey =
            Number.isFinite(event.rawNote)
                ? event.rawNote
                : event.note;

        const voiceId =
            `${event.source}-${event.channel}-${voiceKey}`;

        const voice = this.activeVoices.get(voiceId);

        if (!voice) {
            return;
        }

        voice.release();
        this.activeVoices.delete(voiceId);
        this.updateSystemState();
    }

    panic() {
        this.pendingNotes.clear();

        for (const voice of this.activeVoices.values()) {
            try {
                voice.release(true);
            } catch (error) {
                console.warn("[AUDIO] Panic release:", error);
            }
        }

        this.activeVoices.clear();
    }

    async resume() {
        if (!this.audioContext) {
            return;
        }

        if (this.audioContext.state === "suspended") {
            await this.audioContext.resume();
        }
    }
}
