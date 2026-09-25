export class Voice {

    constructor(
        audioContext,
        destination,
        reverbInput,
        { note, velocity }
    ) {
        this.audioContext = audioContext;
        this.destination = destination;
        this.reverbInput = reverbInput;

        this.note = note;
        this.velocity = velocity;

        this.oscillatorA = null;
        this.oscillatorB = null;
        this.oscillatorC = null;

        this.oscillatorAGain = null;
        this.oscillatorBGain = null;
        this.oscillatorCGain = null;

        this.filter = null;
        this.gain = null;
        this.reverbSend = null;
        this.panner = null;

        this.lfo = null;
        this.lfoGain = null;

        this.filterLfo = null;
        this.filterLfoGain = null;

        this.isReleased = false;
        this.releaseTimer = null;
        this.startedAt = null;
        this.maxHoldTimer = null;

        this.systemCount = 1;
        this.nearestDistance = null;
    }


    start() {

        const context = this.audioContext;
        const now = context.currentTime;
        this.startedAt = now;

        const frequency =
            440 * Math.pow(
                2,
                (this.note - 69) / 12
            );


        /*
         * NOTE PRINCIPALE
         */

        this.oscillatorA =
            context.createOscillator();

        this.oscillatorA.type = "sine";

        this.oscillatorA.frequency
            .setValueAtTime(
                frequency,
                now
            );


        /*
         * SECONDE COUCHE
         */

        this.oscillatorB =
            context.createOscillator();

        this.oscillatorB.type = "sine";

        this.oscillatorB.frequency
            .setValueAtTime(
                frequency,
                now
            );

        this.oscillatorB.detune
            .setValueAtTime(
                5,
                now
            );


        /*
         * OCTAVE SUPÉRIEURE
         *
         * Conservée comme dans la version
         * qui fonctionnait.
         */

        this.oscillatorC =
            context.createOscillator();

        this.oscillatorC.type = "sine";

        this.oscillatorC.frequency
            .setValueAtTime(
                frequency * 2,
                now
            );

        this.oscillatorC.detune
            .setValueAtTime(
                -4,
                now
            );


        /*
         * MIXAGE DES OSCILLATEURS
         *
         * La fondamentale reste dominante.
         * Les couches aiguës sont volontairement
         * discrètes pour éviter le côté perçant.
         */

        this.oscillatorAGain = context.createGain();
        this.oscillatorBGain = context.createGain();
        this.oscillatorCGain = context.createGain();

        this.oscillatorAGain.gain.setValueAtTime(0.72, now);
        this.oscillatorBGain.gain.setValueAtTime(0.24, now);
        this.oscillatorCGain.gain.setValueAtTime(0.08, now);

        this.oscillatorA.connect(this.oscillatorAGain);
        this.oscillatorB.connect(this.oscillatorBGain);
        this.oscillatorC.connect(this.oscillatorCGain);


        /*
         * FILTRE
         */

        this.filter =
            context.createBiquadFilter();

        this.filter.type = "lowpass";

        const filterBase =
            850 +
            ((this.note - 48) / 31) * 1050;

        this.filter.frequency
            .setValueAtTime(
                Math.max(700, Math.min(1900, filterBase)),
                now
            );

        this.filter.Q
            .setValueAtTime(
                0.25,
                now
            );


        /*
         * MODULATION TRÈS LENTE DU FILTRE
         */

        this.filterLfo =
            context.createOscillator();

        this.filterLfoGain =
            context.createGain();

        this.filterLfo.type = "sine";

        this.filterLfo.frequency
            .setValueAtTime(
                0.05,
                now
            );

        this.filterLfoGain.gain
            .setValueAtTime(
                280,
                now
            );

        this.filterLfo.connect(
            this.filterLfoGain
        );

        this.filterLfoGain.connect(
            this.filter.frequency
        );


        /*
         * PETIT MOUVEMENT DE HAUTEUR
         */

        this.lfo =
            context.createOscillator();

        this.lfoGain =
            context.createGain();

        this.lfo.type = "sine";

        this.lfo.frequency
            .setValueAtTime(
                0.08,
                now
            );

        this.lfoGain.gain
            .setValueAtTime(
                1.2 + this.velocity * 0.8,
                now
            );

        this.lfo.connect(
            this.lfoGain
        );

        this.lfoGain.connect(
            this.oscillatorA.detune
        );

        this.lfoGain.connect(
            this.oscillatorB.detune
        );

        this.lfoGain.connect(
            this.oscillatorC.detune
        );


        /*
         * ENVELOPPE
         */

        this.gain =
            context.createGain();

        const peakGain =
            0.095 * this.velocity;

        this.gain.gain
            .setValueAtTime(
                0.0001,
                now
            );


        /*
         * ATTAQUE
         */

        this.gain.gain
            .exponentialRampToValueAtTime(
                Math.max(
                    peakGain,
                    0.0002
                ),
                now + 0.07
            );


        /*
         * POSITION STÉRÉO
         */

        this.panner =
            context.createStereoPanner();

        const pan =
            ((this.note - 48) / 31) * 0.5 - 0.25;

        this.panner.pan
            .setValueAtTime(
                pan,
                now
            );


        /*
         * SEND REVERB
         */

        this.reverbSend =
            context.createGain();

        this.reverbSend.gain
            .setValueAtTime(
                1.15,
                now
            );


        /*
         * ROUTING
         */

        this.oscillatorAGain.connect(this.filter);
        this.oscillatorBGain.connect(this.filter);
        this.oscillatorCGain.connect(this.filter);

        this.filter.connect(
            this.gain
        );


        /*
         * SIGNAL DIRECT
         */

        this.gain.connect(
            this.panner
        );

        this.panner.connect(
            this.destination
        );


        /*
         * SIGNAL REVERB
         */

        this.gain.connect(
            this.reverbSend
        );

        this.reverbSend.connect(
            this.reverbInput
        );


        /*
         * DÉMARRAGE
         */

        this.lfo.start(now);
        this.filterLfo.start(now);

        this.oscillatorA.start(now);
        this.oscillatorB.start(now);
        this.oscillatorC.start(now);

        // A MIDI controller can lose a Note Off (USB disconnect, browser
        // visibility change, device state change). Never leave a voice alive
        // forever in that case.
        this.maxHoldTimer = window.setTimeout(
            () => this.release(),
            12000
        );
    }


    setSystemState({ count = 1, nearestDistance = null } = {}) {
        if (!this.audioContext || !this.gain || this.isReleased) {
            return;
        }

        this.systemCount = Math.max(1, count);
        this.nearestDistance = nearestDistance;

        const now = this.audioContext.currentTime;
        const proximity = Number.isFinite(nearestDistance)
            ? Math.max(0, Math.min(1, 1 - nearestDistance / 12))
            : 0;

        const complexity = Math.max(
            0,
            Math.min(1, (this.systemCount - 1) / 4)
        );

        // The audio has distinct physical regimes rather than merely
        // getting louder as more notes are added.
        const systemLevel = Math.min(4, this.systemCount - 1);
        const filterDepth =
            280 +
            proximity * 420 +
            systemLevel * 180;

        const pitchDepth =
            1.2 +
            this.velocity * 0.8 +
            proximity * 1.1 +
            systemLevel * 0.45;

        const upperLayer =
            0.08 +
            proximity * 0.08 +
            systemLevel * 0.055;

        const reverbAmount =
            1.15 +
            proximity * 0.32 +
            systemLevel * 0.16;

        const filterRate =
            0.05 +
            systemLevel * 0.055 +
            proximity * 0.025;

        this.filterLfo?.frequency.setTargetAtTime(
            filterRate,
            now,
            1.4
        );

        this.filterLfoGain?.gain.setTargetAtTime(
            filterDepth,
            now,
            1.2
        );

        this.lfoGain?.gain.setTargetAtTime(
            pitchDepth,
            now,
            1.4
        );

        this.oscillatorCGain?.gain.setTargetAtTime(
            upperLayer,
            now,
            1.6
        );

        this.reverbSend?.gain.setTargetAtTime(
            reverbAmount,
            now,
            1.8
        );

        const internalDetune =
            5 +
            systemLevel * 2.2 +
            proximity * 3.5;

        this.oscillatorB?.detune.setTargetAtTime(
            internalDetune,
            now,
            1.5
        );
    }


    release(force = false) {

        if (this.isReleased) {
            return;
        }

        this.isReleased = true;

        const context = this.audioContext;
        const now = context.currentTime;

        const currentGain =
            Math.max(
                this.gain.gain.value,
                0.0001
            );

        const heldFor =
            Math.max(
                0,
                now - (this.startedAt ?? now)
            );

        const releaseTime = force
            ? 0.12
            : heldFor < 0.45
                ? 1.1
                : heldFor < 2
                    ? 1.8
                    : 2.6;

        /*
         * RELEASE ADAPTATIF
         *
         * Une note brève disparaît plus vite.
         * Une note tenue conserve une longue traîne.
         */

        this.gain.gain
            .cancelScheduledValues(now);

        this.gain.gain
            .setValueAtTime(
                currentGain,
                now
            );

        this.gain.gain
            .exponentialRampToValueAtTime(
                0.0001,
                now + releaseTime
            );

        this.reverbSend?.gain
            .cancelScheduledValues(now);

        this.reverbSend?.gain
            .setValueAtTime(
                Math.max(this.reverbSend.gain.value, 0.0001),
                now
            );

        this.reverbSend?.gain
            .exponentialRampToValueAtTime(
                0.0001,
                now + Math.min(releaseTime, 2.2)
            );


        this.oscillatorA.stop(
            now + releaseTime + 0.1
        );

        this.oscillatorB.stop(
            now + releaseTime + 0.1
        );

        this.oscillatorC.stop(
            now + releaseTime + 0.1
        );

        this.lfo.stop(
            now + releaseTime + 0.1
        );

        this.filterLfo.stop(
            now + releaseTime + 0.1
        );


        if (this.maxHoldTimer !== null) {
            clearTimeout(this.maxHoldTimer);
            this.maxHoldTimer = null;
        }

        this.releaseTimer =
            window.setTimeout(
                () => {
                    this.disconnect();
                },
                (releaseTime + 0.35) * 1000
            );
    }


    disconnect() {

        if (this.releaseTimer !== null) {

            clearTimeout(
                this.releaseTimer
            );

            this.releaseTimer = null;
        }


        try {
            this.oscillatorA?.disconnect();
        } catch {}

        try {
            this.oscillatorAGain?.disconnect();
        } catch {}

        try {
            this.oscillatorB?.disconnect();
        } catch {}

        try {
            this.oscillatorBGain?.disconnect();
        } catch {}

        try {
            this.oscillatorC?.disconnect();
        } catch {}

        try {
            this.oscillatorCGain?.disconnect();
        } catch {}

        try {
            this.filter?.disconnect();
        } catch {}

        try {
            this.gain?.disconnect();
        } catch {}

        try {
            this.reverbSend?.disconnect();
        } catch {}

        try {
            this.panner?.disconnect();
        } catch {}

        try {
            this.lfo?.disconnect();
        } catch {}

        try {
            this.lfoGain?.disconnect();
        } catch {}

        try {
            this.filterLfo?.disconnect();
        } catch {}

        try {
            this.filterLfoGain?.disconnect();
        } catch {}


        this.oscillatorA = null;
        this.oscillatorB = null;
        this.oscillatorC = null;

        this.oscillatorAGain = null;
        this.oscillatorBGain = null;
        this.oscillatorCGain = null;

        this.filter = null;
        this.gain = null;
        this.reverbSend = null;
        this.panner = null;

        this.lfo = null;
        this.lfoGain = null;

        this.filterLfo = null;
        this.filterLfoGain = null;
    }
}
