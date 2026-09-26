const PALETTES = {
    major: [
        "#8BE8FF", "#A7FFD6", "#FFE58A", "#FFB7C9",
        "#CDB8FF", "#8FD7FF", "#B8F0D0", "#FFD1A6"
    ],
    minor: [
        "#8DA7FF", "#B59CFF", "#70D8D0", "#9DB8FF",
        "#D29BFF", "#72B8E8", "#A5A0FF", "#7FD0C2"
    ],
    suspended: [
        "#8DEFFF", "#B9F5D0", "#B8C7FF", "#F3D7A1",
        "#9FDFFF", "#D1B8FF", "#A8F0E0", "#C9D5FF"
    ]
};

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgba(color, alpha) {
    return `rgba(${color.r},${color.g},${color.b},${alpha})`;
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function easeOutCubic(t) {
    return 1 - Math.pow(1 - clamp(t, 0, 1), 3);
}

function easeInOutSine(t) {
    return -(Math.cos(Math.PI * clamp(t, 0, 1)) - 1) / 2;
}

export class VisualEngine {
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.canvas = document.querySelector("#visual-field");
        this.ctx = this.canvas.getContext("2d");
        this.idle = document.querySelector("#idle-message");

        this.scaleId = "major";
        this.garden = [];
        this.drops = [];
        this.impacts = [];
        this.last = performance.now();
        this.lastActivity = performance.now();
        this.dpr = 1;

        this.noteColors = new Map();
        this.noteColumns = new Map();
        this.nextFlowerId = 1;
        this.activeNotes = new Set();
        this.chordPulse = null;
        this.chordArmed = true;
        this.chordTrees = [];
        this.sunProgress = 0;

        this.handleNoteOn = this.handleNoteOn.bind(this);
        this.handleNoteOff = this.handleNoteOff.bind(this);
        this.handleScale = this.handleScale.bind(this);
        this.frame = this.frame.bind(this);

        eventBus.on("noteon", this.handleNoteOn);
        eventBus.on("noteoff", this.handleNoteOff);
        eventBus.on("scalechange", this.handleScale);
    }

    start() {
        this.resize();
        addEventListener("resize", () => this.resize());
        requestAnimationFrame(this.frame);
    }

    resize() {
        this.dpr = Math.min(devicePixelRatio || 1, 2);
        this.canvas.width = Math.floor(innerWidth * this.dpr);
        this.canvas.height = Math.floor(innerHeight * this.dpr);
        this.canvas.style.width = innerWidth + "px";
        this.canvas.style.height = innerHeight + "px";
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    handleScale(event) {
        this.scaleId = event.scale?.id || "major";
        this.lastActivity = performance.now();

        // Existing plants keep their identity, but newly grown plants use
        // the palette of the current scale.
        for (const flower of this.garden) {
            flower.restingColor = this.colorForNote(flower.note);
        }
    }

    palette() {
        return PALETTES[this.scaleId] || PALETTES.major;
    }

    colorForNote(note) {
        const key = this.scaleId + ":" + Math.round(note);
        if (!this.noteColors.has(key)) {
            const palette = this.palette();
            const noteIndex = Math.abs(Math.round(note) - 50);
            this.noteColors.set(
                key,
                hexToRgb(palette[noteIndex % palette.length])
            );
        }
        return this.noteColors.get(key);
    }

    columnForNote(note) {
        const key = Math.round(note);

        if (!this.noteColumns.has(key)) {
            // ScaleManager maps Playtron inputs onto two octaves of scale
            // degrees. Use that musical degree as the physical garden slot,
            // so two different notes can never accidentally share a column.
            const intervalsByScale = {
                major: [0, 2, 4, 5, 7, 9, 11, 12],
                minor: [0, 2, 3, 5, 7, 8, 10, 12],
                suspended: [0, 2, 5, 7, 9, 10, 12, 14]
            };

            const intervals = intervalsByScale[this.scaleId] || intervalsByScale.major;
            const relative = key - 50;
            let bestIndex = 0;
            let bestDistance = Infinity;

            for (let octave = 0; octave < 2; octave++) {
                for (let degree = 0; degree < intervals.length; degree++) {
                    const candidate = octave * 12 + intervals[degree];
                    const distance = Math.abs(relative - candidate);

                    if (distance < bestDistance) {
                        bestDistance = distance;
                        bestIndex = octave * intervals.length + degree;
                    }
                }
            }

            bestIndex = clamp(bestIndex, 0, 15);
            const normalized = bestIndex / 15;
            this.noteColumns.set(key, normalized);
        }

        return this.noteColumns.get(key);
    }

    handleNoteOn(event) {
        this.lastActivity = performance.now();

        const note = Math.round(event.note);
        const velocity = clamp(Number(event.velocity) || 0.7, 0.1, 1);

        const previousActiveCount = this.activeNotes.size;
        this.activeNotes.add(note);

        if (previousActiveCount < 3 && this.activeNotes.size >= 3 && this.chordArmed) {
            this.triggerChord();
            this.chordArmed = false;
        }
        const color = this.colorForNote(note);
        const column = this.columnForNote(note);

        // A note always has its own place in the garden. Repeated notes feed
        // the same plant instead of creating an unreadable pile of flowers.
        let flower = this.garden.find(item => item.note === note);

        if (flower && flower.state === "returning") {
            flower.state = "growing";
            flower.targetGrowth = flower.growth;
            flower.returnStarted = null;
        }

        if (!flower) {
            const w = innerWidth;
            const h = innerHeight;

            flower = {
                id: this.nextFlowerId++,
                note,
                x: lerp(w * 0.12, w * 0.88, column),
                groundY: h * (0.78 + ((note * 17) % 5) * 0.008),
                height: h * (0.12 + ((Math.abs(note) * 13) % 9) * 0.012),
                lean: (((note * 29) % 100) / 100 - 0.5) * 0.18,
                phase: ((note * 1.618) % TAU),
                species: Math.abs(note) % 3,
                color,
                restingColor: color,
                growth: 0,
                targetGrowth: 0,
                age: 0,
                lastFed: performance.now(),
                state: "growing",
                feedCount: 0
            };

            this.garden.push(flower);
        } else {
            flower.state = "growing";
            flower.returnStarted = null;
        }

        const w = innerWidth;
        const targetX = flower.x;
        const startY = this.cloudYForX(targetX);

        this.drops.push({
            x: targetX,
            y: startY,
            startY,
            targetY: flower.groundY,
            speed: 430 + velocity * 180,
            size: 3.2 + velocity * 1.8,
            color,
            progress: 0,
            note,
            flowerId: flower.id
        });

        if (this.drops.length > 28) {
            this.drops.splice(0, this.drops.length - 28);
        }
    }

    handleNoteOff(event) {
        this.lastActivity = performance.now();
        this.activeNotes.delete(Math.round(event.note));

        if (this.activeNotes.size < 3) {
            this.chordArmed = true;
        }
    }

    triggerChord() {
        const notes = [...this.activeNotes];
        const points = notes
            .map(note => this.garden.find(flower => flower.note === note))
            .filter(Boolean)
            .map(flower => ({
                x: flower.x,
                y: this.cloudYForX(flower.x),
                color: flower.restingColor
            }));

        if (points.length < 3) return;

        this.chordPulse = {
            age: 0,
            life: 2.2,
            points
        };

        const minX = Math.min(...points.map(p => p.x));
        const maxX = Math.max(...points.map(p => p.x));
        const center = (minX + maxX) * 0.5;

        for (let i = 0; i < 7; i++) {
            const spread = Math.max(70, maxX - minX + 120);
            this.chordTrees.push({
                x: center + (i - 3) * (spread / 6) + Math.sin(i * 2.4) * 18,
                groundY: innerHeight * (0.78 + (i % 2) * 0.012),
                height: 45 + (i % 3) * 18,
                age: 0,
                life: 18,
                side: i % 2 ? 1 : -1
            });
        }
    }

    frame(now) {
        const dt = Math.min((now - this.last) / 1000, 0.05);
        this.last = now;

        const w = innerWidth;
        const h = innerHeight;

        this.ctx.fillStyle = "rgba(3, 5, 5, 0.18)";
        this.ctx.fillRect(0, 0, w, h);

        this.updateDrops(dt);
        this.updateGarden(dt, now);
        this.updateImpacts(dt);

        if (this.chordPulse) {
            this.chordPulse.age += dt;
            if (this.chordPulse.age >= this.chordPulse.life) {
                this.chordPulse = null;
            }
        }

        const idleFor = now - this.lastActivity;
        const sunTarget = idleFor > 10000 ? 1 : 0;
        this.sunProgress = lerp(
            this.sunProgress,
            sunTarget,
            1 - Math.exp(-0.18 * dt)
        );

        this.updateTrees(dt);

        this.drawAtmosphere(now, w, h);
        this.drawGround(w, h);
        this.drawDrops();
        this.drawGarden(now);
        this.drawTrees(now);
        this.drawChordEffect();
        this.drawSunAndIdleText(w, h);

        const idleFor = now - this.lastActivity;
        const sleeping = idleFor > 10000;

        if (this.idle) {
            this.idle.classList.remove("visible");
        }

        requestAnimationFrame(this.frame);
    }

    cloudYForX(x) {
        const w = innerWidth;
        const h = innerHeight;
        const normalized = clamp(x / Math.max(1, w), 0, 1);

        // A gentle variation keeps the clouds from forming a rigid row.
        return h * (0.13 + 0.055 * Math.sin(normalized * Math.PI * 2.2));
    }

    updateDrops(dt) {
        for (let i = this.drops.length - 1; i >= 0; i--) {
            const drop = this.drops[i];

            drop.y += drop.speed * dt;
            drop.progress = clamp(
                (drop.y - drop.startY) /
                Math.max(1, drop.targetY - drop.startY),
                0,
                1
            );

            if (drop.y >= drop.targetY) {
                this.impacts.push({
                    x: drop.x,
                    y: drop.targetY,
                    color: drop.color,
                    age: 0,
                    life: 1.15
                });

                const flower = this.garden.find(
                    item => item.id === drop.flowerId
                );

                if (flower) {
                    flower.lastFed = performance.now();
                    flower.feedCount++;

                    if (!flower.overwatered && flower.targetGrowth < 0.995) {
                        flower.targetGrowth = Math.min(
                            1,
                            flower.targetGrowth + 0.22
                        );

                        if (flower.targetGrowth >= 0.995) {
                            flower.overwatered = true;
                        }
                    } else if (flower.overwatered) {
                        // Once fully grown, each new drop pushes the plant
                        // back toward the soil. It can disappear completely.
                        flower.targetGrowth = Math.max(
                            0,
                            flower.targetGrowth - 0.24
                        );

                        if (flower.targetGrowth <= 0) {
                            flower.overwatered = false;
                        }
                    }
                }

                this.drops.splice(i, 1);
            }
        }
    }

    updateGarden(dt, now) {
        const inactivity = now - this.lastActivity;

        for (let i = this.garden.length - 1; i >= 0; i--) {
            const flower = this.garden[i];
            flower.age += dt;

            const responseRate = flower.state === "returning" ? 0.32 : 1.35;

            flower.growth = lerp(
                flower.growth,
                flower.targetGrowth,
                1 - Math.exp(-responseRate * dt)
            );

            // The garden only begins returning after a genuinely quiet pause.
            if (
                inactivity > 10000 &&
                flower.state !== "returning"
            ) {
                flower.state = "returning";
                flower.returnStarted = now;
            }

            if (flower.state === "returning") {
                const sleepProgress = clamp(
                    (now - flower.returnStarted) / 15000,
                    0,
                    1
                );

                flower.growth = 1 - easeInOutSine(sleepProgress);

                if (sleepProgress >= 1) {
                    this.garden.splice(i, 1);
                }
            }
        }
    }

    updateImpacts(dt) {
        for (let i = this.impacts.length - 1; i >= 0; i--) {
            this.impacts[i].age += dt;
            if (this.impacts[i].age > this.impacts[i].life) {
                this.impacts.splice(i, 1);
            }
        }
    }

    drawAtmosphere(now, w, h) {
        const c = this.ctx;
        c.save();

        // One soft cloud exists for every musical slot. The note label is
        // always visible, even before the corresponding flower is grown.
        const slotNotes = [];
        for (let i = 0; i < 16; i++) {
            const note = 50 + i;
            slotNotes.push({
                note,
                x: lerp(w * 0.08, w * 0.92, i / 15)
            });
        }

        c.strokeStyle = "rgba(215, 225, 220, 0.26)";
        c.fillStyle = "rgba(205, 218, 213, 0.035)";
        c.lineWidth = 0.9;
        c.lineCap = "round";
        c.lineJoin = "round";

        for (const slot of slotNotes) {
            const cloudY = this.cloudYForX(slot.x);
            const width = Math.min(88, Math.max(62, w * 0.055));
            const r = width * 0.13;

            // Soft Toy Story-like cloud silhouette, translated into line art:
            // rounded bumps, a soft base, no sharp mathematical contour.
            c.beginPath();
            c.moveTo(slot.x - width * 0.50, cloudY + 4);
            c.bezierCurveTo(
                slot.x - width * 0.48, cloudY - 5,
                slot.x - width * 0.38, cloudY - 8,
                slot.x - width * 0.27, cloudY - 6
            );
            c.bezierCurveTo(
                slot.x - width * 0.23, cloudY - 17,
                slot.x - width * 0.08, cloudY - 19,
                slot.x + width * 0.01, cloudY - 9
            );
            c.bezierCurveTo(
                slot.x + width * 0.09, cloudY - 21,
                slot.x + width * 0.27, cloudY - 19,
                slot.x + width * 0.30, cloudY - 7
            );
            c.bezierCurveTo(
                slot.x + width * 0.43, cloudY - 9,
                slot.x + width * 0.51, cloudY - 2,
                slot.x + width * 0.50, cloudY + 4
            );
            c.bezierCurveTo(
                slot.x + width * 0.34, cloudY + 9,
                slot.x - width * 0.30, cloudY + 9,
                slot.x - width * 0.50, cloudY + 4
            );
            c.stroke();

            c.font = "10px system-ui, sans-serif";
            c.textAlign = "center";
            c.textBaseline = "middle";
            c.fillStyle = "rgba(225, 235, 230, 0.62)";
            c.fillText(this.noteName(slot.note), slot.x, cloudY + 1);
        }

        c.restore();
    }

    noteName(note) {
        const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
        const midi = Math.round(note);
        const octave = Math.floor(midi / 12) - 1;
        return names[((midi % 12) + 12) % 12] + octave;
    }

    drawGround(w, h) {
        const c = this.ctx;
        const y = h * 0.78;

        c.save();
        c.strokeStyle = "rgba(180, 205, 195, 0.18)";
        c.lineWidth = 1.05;
        c.beginPath();

        for (let x = 0; x <= w; x += 12) {
            const yy =
                y +
                Math.sin(x * 0.005) * 3 +
                Math.sin(x * 0.012) * 1.2;

            if (x === 0) c.moveTo(x, yy);
            else c.lineTo(x, yy);
        }

        c.stroke();
        c.restore();
    }

    drawDrops() {
        const c = this.ctx;

        for (const drop of this.drops) {
            const t = easeOutCubic(drop.progress);
            const stretch = lerp(1.8, 0.65, t);

            c.save();
            c.translate(drop.x, drop.y);
            c.scale(1, stretch);
            c.strokeStyle = rgba(drop.color, 0.78);
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(0, -drop.size * 1.5);
            c.bezierCurveTo(
                drop.size * 0.85,
                -drop.size * 0.25,
                drop.size * 0.8,
                drop.size * 0.7,
                0,
                drop.size
            );
            c.bezierCurveTo(
                -drop.size * 0.8,
                drop.size * 0.7,
                -drop.size * 0.85,
                -drop.size * 0.25,
                0,
                -drop.size * 1.5
            );
            c.stroke();
            c.restore();
        }

        for (const impact of this.impacts) {
            const t = clamp(impact.age / impact.life, 0, 1);
            const radius = 4 + easeOutCubic(t) * 24;
            const alpha = (1 - t) * 0.55;

            c.save();
            c.strokeStyle = rgba(impact.color, alpha);
            c.lineWidth = 0.8;
            c.beginPath();
            c.ellipse(
                impact.x,
                impact.y,
                radius,
                radius * 0.22,
                0,
                0,
                TAU
            );
            c.stroke();
            c.restore();
        }
    }

    updateTrees(dt) {
        for (let i = this.chordTrees.length - 1; i >= 0; i--) {
            const tree = this.chordTrees[i];
            tree.age += dt;
            if (tree.age >= tree.life) {
                this.chordTrees.splice(i, 1);
            }
        }
    }

    drawTrees(now) {
        const c = this.ctx;

        for (const tree of this.chordTrees) {
            const grow = easeOutCubic(clamp(tree.age / 2.8, 0, 1));
            const fade = Math.min(1, tree.age / 0.5) * (tree.age > tree.life - 2 ? (tree.life - tree.age) / 2 : 1);
            const h = tree.height * grow;

            c.save();
            c.strokeStyle = "rgba(170, 205, 190, " + (0.62 * fade) + ")";
            c.lineWidth = 0.9;
            c.lineCap = "round";
            c.lineJoin = "round";

            c.beginPath();
            c.moveTo(tree.x, tree.groundY);
            c.bezierCurveTo(
                tree.x + tree.side * h * 0.05,
                tree.groundY - h * 0.35,
                tree.x - tree.side * h * 0.05,
                tree.groundY - h * 0.72,
                tree.x,
                tree.groundY - h
            );
            c.stroke();

            for (let j = 0; j < 4; j++) {
                const yy = tree.groundY - h * (0.38 + j * 0.15);
                const branch = h * (0.12 + j * 0.015);
                c.beginPath();
                c.moveTo(tree.x, yy);
                c.bezierCurveTo(
                    tree.x + tree.side * branch,
                    yy - branch * 0.55,
                    tree.x + tree.side * branch * 1.35,
                    yy - branch * 0.2,
                    tree.x + tree.side * branch * 1.05,
                    yy + branch * 0.12
                );
                c.stroke();
            }

            c.restore();
        }
    }

    drawSunAndIdleText(w, h) {
        const p = clamp(this.sunProgress, 0, 1);
        if (p < 0.005) return;

        const c = this.ctx;
        const cx = w * 0.78;
        const cy = h * 0.22;
        const radius = 24 * p;

        c.save();
        c.globalAlpha = p * 0.75;
        c.strokeStyle = "rgba(255, 225, 150, 0.8)";
        c.lineWidth = 1.0;
        c.beginPath();
        c.arc(cx, cy, radius, 0, TAU);
        c.stroke();

        for (let i = 0; i < 12; i++) {
            const a = i * TAU / 12;
            const r1 = radius + 8;
            const r2 = radius + 13;
            c.beginPath();
            c.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
            c.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
            c.stroke();
        }

        // Reuse the project's existing idle message text when available.
        const message = this.idle?.dataset?.idleText || this.idle?.textContent?.trim();
        if (message) {
            c.font = "12px system-ui, sans-serif";
            c.textAlign = "center";
            c.fillStyle = "rgba(225, 235, 230, 0.55)";
            c.fillText(message, cx, cy + radius + 30);
        }

        c.restore();
    }

    drawChordEffect() {
        const pulse = this.chordPulse;
        if (!pulse || pulse.points.length < 3) return;

        const c = this.ctx;
        const t = clamp(pulse.age / pulse.life, 0, 1);
        const attack = easeOutCubic(Math.min(1, pulse.age / 0.35));
        const fade = 1 - easeInOutSine(Math.max(0, (pulse.age - 0.75) / 1.45));

        const cx = pulse.points.reduce((sum, p) => sum + p.x, 0) / pulse.points.length;
        const cy = pulse.points.reduce((sum, p) => sum + p.y, 0) / pulse.points.length;

        c.save();
        c.lineCap = "round";
        c.lineJoin = "round";

        // The chord briefly turns the separate clouds into one precise
        // geometric system.
        c.lineWidth = 1.1;
        c.strokeStyle = "rgba(225, 240, 235, " + (0.38 * fade) + ")";
        c.beginPath();

        pulse.points.forEach((p, i) => {
            if (i === 0) c.moveTo(p.x, p.y);
            else c.lineTo(p.x, p.y);
        });
        c.closePath();
        c.stroke();

        // A second, quieter inner triangle makes the event feel like a
        // resonance rather than a generic flash.
        c.lineWidth = 0.65;
        c.strokeStyle = "rgba(225, 240, 235, " + (0.24 * fade) + ")";
        c.beginPath();
        pulse.points.forEach((p, i) => {
            const x = lerp(cx, p.x, 0.72);
            const y = lerp(cy, p.y, 0.72);
            if (i === 0) c.moveTo(x, y);
            else c.lineTo(x, y);
        });
        c.closePath();
        c.stroke();

        for (let ring = 0; ring < 3; ring++) {
            const radius = 8 + attack * (42 + ring * 20);
            const ringAlpha = (1 - ring * 0.22) * fade * 0.28;

            c.strokeStyle = "rgba(225, 240, 235, " + ringAlpha + ")";
            c.lineWidth = ring === 0 ? 1.1 : 0.65;
            c.beginPath();
            c.ellipse(
                cx,
                cy,
                radius,
                radius * 0.34,
                0,
                0,
                TAU
            );
            c.stroke();
        }

        // Small points of light travel outward from the resonance center.
        for (const point of pulse.points) {
            const x = lerp(cx, point.x, attack);
            const y = lerp(cy, point.y, attack);
            c.fillStyle = rgba(point.color, 0.72 * fade);
            c.beginPath();
            c.arc(x, y, 1.8 + attack * 1.8, 0, TAU);
            c.fill();
        }

        c.restore();
    }

    drawGarden(now) {
        for (const flower of this.garden) {
            this.drawFlower(flower, now);
        }
    }

    drawFlower(flower, now) {
        const c = this.ctx;
        const growth = clamp(flower.growth, 0, 1);
        if (growth < 0.005) return;

        const y = flower.groundY;
        const h = flower.height * easeOutCubic(growth);
        const lean = flower.lean * h;
        const topX = flower.x + lean;

        c.save();
        c.strokeStyle = rgba(flower.restingColor, 0.78);
        c.lineWidth = 0.9;
        c.lineCap = "round";
        c.lineJoin = "round";

        // Stem: a slightly curved mathematical trajectory.
        c.beginPath();
        c.moveTo(flower.x, y);
        c.bezierCurveTo(
            flower.x + lean * 0.15,
            y - h * 0.32,
            topX - lean * 0.15,
            y - h * 0.68,
            topX,
            y - h
        );
        c.stroke();

        if (growth > 0.24) {
            this.drawLeaf(
                c,
                flower.x + lean * 0.35,
                y - h * 0.43,
                h * 0.16,
                -1,
                flower.restingColor
            );
        }

        if (growth > 0.48) {
            this.drawLeaf(
                c,
                flower.x + lean * 0.65,
                y - h * 0.66,
                h * 0.18,
                1,
                flower.restingColor
            );
        }

        if (growth > 0.67) {
            const bloom = easeInOutSine((growth - 0.67) / 0.33);
            this.drawBloom(
                c,
                topX,
                y - h,
                Math.min(h * 0.28, 30) * bloom,
                flower.species,
                flower.restingColor,
                flower.phase + now * 0.00004
            );
        }

        c.restore();
    }

    drawLeaf(c, x, y, size, direction, color) {
        c.save();
        c.strokeStyle = rgba(color, 0.58);
        c.lineWidth = 0.75;
        c.beginPath();
        c.moveTo(x, y);
        c.bezierCurveTo(
            x + size * direction * 0.55,
            y - size * 0.72,
            x + size * direction * 1.05,
            y - size * 0.25,
            x + size * direction,
            y + size * 0.1
        );
        c.bezierCurveTo(
            x + size * direction * 0.55,
            y + size * 0.12,
            x + size * direction * 0.2,
            y + size * 0.02,
            x,
            y
        );
        c.stroke();
        c.restore();
    }

    drawBloom(c, x, y, radius, species, color, phase) {
        if (radius <= 0.2) return;

        const petals =
            species === 0 ? 5 :
            species === 1 ? 6 : 4;

        c.save();
        c.translate(x, y);
        c.rotate(phase * 0.18);
        c.strokeStyle = rgba(color, 0.84);
        c.lineWidth = 0.85;

        for (let i = 0; i < petals; i++) {
            const angle = (i / petals) * TAU;
            const px = Math.cos(angle) * radius * 0.78;
            const py = Math.sin(angle) * radius * 0.78;

            c.save();
            c.rotate(angle);

            if (species === 2) {
                c.beginPath();
                c.ellipse(
                    radius * 0.48,
                    0,
                    radius * 0.62,
                    radius * 0.23,
                    0,
                    0,
                    TAU
                );
                c.stroke();
            } else {
                c.beginPath();
                c.moveTo(0, 0);
                c.bezierCurveTo(
                    radius * 0.28,
                    -radius * 0.5,
                    radius * 0.82,
                    -radius * 0.46,
                    radius * 1.05,
                    0
                );
                c.bezierCurveTo(
                    radius * 0.82,
                    radius * 0.46,
                    radius * 0.28,
                    radius * 0.5,
                    0,
                    0
                );
                c.stroke();
            }

            c.restore();
        }

        c.beginPath();
        c.arc(0, 0, Math.max(1.1, radius * 0.16), 0, TAU);
        c.stroke();

        c.restore();
    }
}
