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
        this.ctx = this.canvas?.getContext("2d") || null;
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
        this.trees = [
            { id: "left", side: -1, xRatio: 0.075, groundYRatio: 0.78, heightRatio: 0.68, widthRatio: 0.16, growth: 0, targetGrowth: 0 },
            { id: "right", side: 1, xRatio: 0.925, groundYRatio: 0.78, heightRatio: 0.68, widthRatio: 0.16, growth: 0, targetGrowth: 0 }
        ];
        this.chordLatched = false;
        this.sunReveal = 0;

        this.handleNoteOn = this.handleNoteOn.bind(this);
        this.handleNoteOff = this.handleNoteOff.bind(this);
        this.handleScale = this.handleScale.bind(this);
        this.frame = this.frame.bind(this);

        eventBus.on("noteon", this.handleNoteOn);
        eventBus.on("noteoff", this.handleNoteOff);
        eventBus.on("scalechange", this.handleScale);
    }

    start() {
        if (!this.canvas || !this.ctx) {
            console.error("[VISUALS] Canvas unavailable.");
            return;
        }

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
        this.noteColumns.clear();
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
                major: [0, 2, 4, 5, 7, 9, 11],
                minor: [0, 2, 3, 5, 7, 8, 10],
                suspended: [0, 2, 5, 7, 9, 10, 11]
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
        this.activeNotes.add(note);

        // A chord is three or more notes held together. Trigger only once
        // per chord, so a sustained chord grows one small grove rather than
        // spawning a tree on every incoming note.
        if (this.activeNotes.size >= 3 && !this.chordLatched) {
            this.growChordTrees([...this.activeNotes]);
            this.chordLatched = true;
        }
        const color = this.colorForNote(note);
        const column = this.columnForNote(note);

        // Repeated notes feed the same plant instead of creating a pile of flowers.
        let flower = this.garden.find(item => item.note === note);

        if (flower && flower.state === "returning") {
            flower.state = "growing";
            flower.targetGrowth = flower.growth;
            flower.returnStarted = null;
            flower.returnStartGrowth = null;
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
                restingColor: color,
                growth: 0,
                targetGrowth: 0,
                age: 0,
                state: "growing",
                overwatered: false
            };

            this.garden.push(flower);
        } else {
            flower.state = "growing";
            flower.returnStarted = null;
        }

        const targetX = flower.x;
        const startY = innerHeight * 0.10;

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
            this.chordLatched = false;
        }
    }

    growChordTrees(notes) {
        const amount = clamp(0.16 + notes.length * 0.035, 0.16, 0.28);
        for (const tree of this.trees) {
            tree.targetGrowth = Math.min(1, tree.targetGrowth + amount);
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
        this.updateTrees(dt);
        this.updateImpacts(dt);

        const idleFor = now - this.lastActivity;
        const sunTarget = idleFor > 18000 ? 1 : 0;
        this.sunReveal = lerp(this.sunReveal, sunTarget, 1 - Math.exp(-0.35 * dt));

        this.drawSun(w, h);
        this.drawGround(w, h);
        this.drawDrops();
        this.drawGarden(now);

        const sleeping = idleFor > 10000;

        if (this.idle) {
            this.idle.classList.toggle(
                "visible",
                this.garden.length === 0 && sleeping
            );
        }

        requestAnimationFrame(this.frame);
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

            if (inactivity > 10000 && flower.state !== "returning") {
                flower.state = "returning";
                flower.returnStarted = now;
                flower.returnStartGrowth = clamp(Math.max(flower.growth, flower.targetGrowth), 0, 1);
            }

            if (flower.state === "returning") {
                const sleepProgress = clamp((now - flower.returnStarted) / 15000, 0, 1);
                flower.growth = flower.returnStartGrowth * (1 - easeInOutSine(sleepProgress));
                flower.targetGrowth = flower.growth;

                if (sleepProgress >= 1 || flower.growth <= 0.005) {
                    this.garden.splice(i, 1);
                }
                continue;
            }

            flower.growth = lerp(
                flower.growth,
                flower.targetGrowth,
                1 - Math.exp(-1.35 * dt)
            );
        }
    }

    updateTrees(dt) {
        for (const tree of this.trees) {
            tree.growth = lerp(
                tree.growth,
                tree.targetGrowth,
                1 - Math.exp(-0.22 * dt)
            );
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

    drawSun(w, h) {
        if (this.sunReveal < 0.001) return;

        const c = this.ctx;
        const horizon = h * 0.78;
        const radius = Math.min(w, h) * 0.225;
        const x = w * 0.5;
        const rise = easeInOutSine(this.sunReveal);
        const y = lerp(horizon + radius, h * 0.42, rise);

        c.save();
        c.globalAlpha = this.sunReveal;

        const halo = c.createRadialGradient(x, y, radius * 0.35, x, y, radius * 2.35);
        halo.addColorStop(0, "rgba(255, 238, 164, 0.28)");
        halo.addColorStop(0.25, "rgba(255, 190, 96, 0.20)");
        halo.addColorStop(0.58, "rgba(247, 126, 83, 0.08)");
        halo.addColorStop(1, "rgba(247, 126, 83, 0)");
        c.fillStyle = halo;
        c.beginPath();
        c.arc(x, y, radius * 2.35, 0, TAU);
        c.fill();

        const disc = c.createRadialGradient(x - radius * 0.22, y - radius * 0.25, radius * 0.08, x, y, radius);
        disc.addColorStop(0, "rgba(255, 248, 205, 0.98)");
        disc.addColorStop(0.42, "rgba(255, 211, 121, 0.96)");
        disc.addColorStop(0.78, "rgba(247, 145, 82, 0.94)");
        disc.addColorStop(1, "rgba(214, 91, 72, 0.90)");
        c.fillStyle = disc;
        c.beginPath();
        c.arc(x, y, radius, 0, TAU);
        c.fill();

        c.strokeStyle = "rgba(255, 248, 213, 0.72)";
        c.lineWidth = 1.2;
        c.beginPath();
        c.arc(x, y, radius, 0, TAU);
        c.stroke();

        c.fillStyle = "rgba(38, 22, 20, 0.72)";
        c.font = "300 " + Math.max(11, Math.min(20, radius * 0.105)) + "px Inter, system-ui, sans-serif";
        c.textAlign = "center";
        c.textBaseline = "middle";

        const lines = ["HEY,", "REVEILLEZ MOI,", "JE SUIS LA"];
        const lineHeight = radius * 0.22;
        lines.forEach((line, i) => c.fillText(line, x, y + (i - 1) * lineHeight));

        c.restore();
    }

    drawGround(w, h) {
        const c = this.ctx;
        const y = h * 0.78;
        c.save();
        c.strokeStyle = "rgba(248, 249, 244, 0.94)";
        c.lineWidth = 7.5;
        c.lineCap = "butt";
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(w, y);
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

    drawGarden(now) {
        for (const flower of this.garden) {
            this.drawFlower(flower, now);
        }
        for (const tree of this.trees) {
            this.drawTree(tree);
        }
    }

    drawTree(tree) {
        const c = this.ctx;
        const growth = clamp(tree.growth, 0, 1);
        if (growth < 0.005) return;

        const h = innerHeight * tree.heightRatio * easeInOutSine(growth);
        const trunkW = innerHeight * tree.widthRatio * (0.72 + 0.28 * easeInOutSine(growth));
        const y = innerHeight * tree.groundYRatio;
        const x = innerWidth * tree.xRatio;
        const side = tree.side;

        c.save();
        c.globalAlpha = 0.9;
        c.strokeStyle = "rgba(211, 222, 215, 0.86)";
        c.lineCap = "round";
        c.lineJoin = "round";

        c.lineWidth = 1.35;
        c.beginPath();
        c.moveTo(x - trunkW * 0.16, y);
        c.bezierCurveTo(x - trunkW * 0.30, y - h * 0.25, x - trunkW * 0.18, y - h * 0.58, x - trunkW * 0.06, y - h);
        c.stroke();
        c.beginPath();
        c.moveTo(x + trunkW * 0.16, y);
        c.bezierCurveTo(x + trunkW * 0.30, y - h * 0.25, x + trunkW * 0.18, y - h * 0.58, x + trunkW * 0.06, y - h);
        c.stroke();

        c.lineWidth = 0.65;
        c.strokeStyle = "rgba(194, 209, 201, 0.58)";
        for (let i = 1; i < 10; i++) {
            const t = i / 10;
            const yy = y - h * t;
            const half = trunkW * (0.13 + 0.05 * Math.sin(i * 1.7));
            const bend = Math.sin(i * 2.15) * trunkW * 0.07;
            c.beginPath();
            c.moveTo(x - half + bend, yy + h * 0.035);
            c.bezierCurveTo(x - half * 0.65, yy - h * 0.08, x + half * 0.65, yy - h * 0.12, x + half - bend, yy - h * 0.025);
            c.stroke();
        }

        c.lineWidth = 1.0;
        c.strokeStyle = "rgba(207, 220, 212, 0.72)";
        const levels = [0.42, 0.57, 0.69, 0.80, 0.89];
        for (let i = 0; i < levels.length; i++) {
            const level = levels[i];
            const yy = y - h * level;
            const direction = i % 2 === 0 ? side : -side;
            const length = trunkW * (0.95 - i * 0.08);

            c.beginPath();
            c.moveTo(x, yy);
            c.quadraticCurveTo(x + direction * length * 0.32, yy - h * 0.035, x + direction * length, yy - h * (0.13 - i * 0.012));
            c.stroke();

            c.lineWidth = 0.55;
            c.beginPath();
            c.moveTo(x + direction * length * 0.58, yy - h * 0.075);
            c.quadraticCurveTo(x + direction * length * 0.78, yy - h * 0.14, x + direction * length * 0.98, yy - h * 0.16);
            c.stroke();
            c.lineWidth = 1.0;
        }

        c.lineWidth = 0.85;
        c.strokeStyle = "rgba(197, 213, 204, 0.58)";
        c.beginPath();
        c.moveTo(x, y - h);
        c.bezierCurveTo(x + side * trunkW * 0.45, y - h * 0.98, x + side * trunkW * 1.25, y - h * 0.91, x + side * trunkW * 1.45, y - h * 0.78);
        c.stroke();

        c.restore();
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
