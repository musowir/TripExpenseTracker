/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🎉 REFINED PARTY CELEBRATION — Context-Blended Edition 🎉
 * Particles stay behind the face. Matches the app's dark, neon-accent design.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const PartyFaceCelebration = (() => {
    let threeScriptLoaded = false;

    function loadThreeJS() {
        return new Promise((resolve) => {
            if (typeof THREE !== 'undefined') {
                threeScriptLoaded = true;
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
            script.onload = () => { threeScriptLoaded = true; resolve(); };
            script.onerror = () => { console.warn('Three.js failed, fallback to 2D'); resolve(); };
            document.head.appendChild(script);
        });
    }

    function injectStyles() {
        if (document.getElementById('party-face-styles')) return;

        const styleSheet = document.createElement('style');
        styleSheet.id = 'party-face-styles';
        styleSheet.textContent = `
            /* ── 3D Container — transparent overlay, no backdrop filter ── */
            .party-face-3d-container {
                position: fixed;
                inset: 0;
                z-index: 99999;
                pointer-events: none;
            }

            #partyCanvas {
                display: block;
                width: 100%;
                height: 100%;
            }

            /* ── 2D Fallback Container ───────────────────────────────── */
            .party-face-2d-container {
                position: fixed;
                inset: 0;
                z-index: 99999;
                pointer-events: none;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            /* ── The Emoji — refined glow matching your accent palette ── */
            .party-face-emoji-2d {
                font-size: 220px;
                line-height: 1;
                position: relative;
                z-index: 10;
                filter: 
                    drop-shadow(0 0 8px rgba(96, 165, 250, 0.6))
                    drop-shadow(0 0 20px rgba(59, 130, 246, 0.4))
                    drop-shadow(0 0 40px rgba(96, 165, 250, 0.2));
                animation: party-bounce-in 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) forwards,
                           party-celebrate 3.0s 0.55s ease-in-out forwards;
            }

            @keyframes party-bounce-in {
                0% { transform: scale(0) rotate(-15deg); opacity: 0; }
                60% { transform: scale(1.15) rotate(3deg); opacity: 1; }
                100% { transform: scale(1) rotate(0deg); opacity: 1; }
            }

            @keyframes party-celebrate {
                0% { transform: scale(1) rotate(0deg); }
                15% { transform: scale(1.08) rotate(-5deg); }
                30% { transform: scale(1.05) rotate(5deg); }
                45% { transform: scale(1.1) rotate(-3deg); }
                60% { transform: scale(1.03) rotate(2deg); }
                75% { transform: scale(0.95) rotate(0deg); }
                90% { transform: scale(0.4) rotate(15deg); opacity: 0.8; }
                100% { transform: scale(0) rotate(45deg); opacity: 0; }
            }

            /* ── Confetti — behind emoji (z-index 5) ─────────────────── */
            .party-confetti-2d {
                position: absolute;
                top: 50%;
                left: 50%;
                pointer-events: none;
                z-index: 5;
                animation: confetti-burst 3.2s ease-out forwards;
            }

            @keyframes confetti-burst {
                0% { 
                    opacity: 1;
                    transform: translate(0, 0) scale(1) rotate(0deg);
                }
                60% { opacity: 0.8; }
                100% {
                    opacity: 0;
                    transform: 
                        translate(var(--tx), var(--ty)) 
                        scale(0.2) 
                        rotate(var(--spin));
                }
            }

            /* ── Soft Ambient Glow — behind everything (z-index 1) ────── */
            .party-ambient-glow {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                pointer-events: none;
                z-index: 1;
                width: 400px;
                height: 400px;
                border-radius: 50%;
                background: radial-gradient(
                    circle,
                    rgba(59, 130, 246, 0.12) 0%,
                    rgba(96, 165, 250, 0.06) 30%,
                    rgba(16, 185, 129, 0.04) 60%,
                    transparent 80%
                );
                animation: glow-pulse 3.2s ease-out forwards;
            }

            @keyframes glow-pulse {
                0% { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
                15% { transform: translate(-50%, -50%) scale(1.3); opacity: 1; }
                50% { transform: translate(-50%, -50%) scale(1.0); opacity: 0.7; }
                100% { transform: translate(-50%, -50%) scale(0.6); opacity: 0; }
            }

            /* ── Mobile ──────────────────────────────────────────────── */
            @media (max-width: 768px) {
                .party-face-emoji-2d { font-size: 150px; }
                .party-ambient-glow { width: 280px; height: 280px; }
                .party-confetti-2d { width: 10px; height: 10px; }
            }

            @media (max-width: 480px) {
                .party-face-emoji-2d { font-size: 120px; }
                .party-ambient-glow { width: 220px; height: 220px; }
                .party-confetti-2d { width: 8px; height: 8px; }
            }
        `;
        document.head.appendChild(styleSheet);
    }

    function setup3DScene(canvas) {
        const scene = new THREE.Scene();
        scene.background = null;

        const camera = new THREE.PerspectiveCamera(
            75, 
            window.innerWidth / window.innerHeight, 
            0.1, 
            1000
        );
        camera.position.z = 5;

        const renderer = new THREE.WebGLRenderer({ 
            canvas, 
            alpha: true, 
            antialias: true 
        });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // ── Lighting — matches your app's dark, blue-accent theme ──────
        const ambientLight = new THREE.AmbientLight(0x334466, 0.6);
        scene.add(ambientLight);

        const pointLight1 = new THREE.PointLight(0x60a5fa, 2.0);
        pointLight1.position.set(3, 3, 6);
        scene.add(pointLight1);

        const pointLight2 = new THREE.PointLight(0x3b82f6, 2.0);
        pointLight2.position.set(-3, 2, 6);
        scene.add(pointLight2);

        const pointLight3 = new THREE.PointLight(0x10b981, 1.5);
        pointLight3.position.set(0, -3, 6);
        scene.add(pointLight3);

        const pointLight4 = new THREE.PointLight(0xf59e0b, 1.2);
        pointLight4.position.set(3, -2, 5);
        scene.add(pointLight4);

        return { scene, camera, renderer };
    }

    function create3DPartyFace() {
        const group = new THREE.Group();

        const geometry = new THREE.IcosahedronGeometry(1, 8);

        // Canvas texture — clean, recognizable party face
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        // Base yellow
        ctx.fillStyle = '#FFD93D';
        ctx.beginPath();
        ctx.arc(256, 256, 200, 0, Math.PI * 2);
        ctx.fill();

        // Eyes
        ctx.fillStyle = '#1a1a2e';
        ctx.beginPath();
        ctx.arc(180, 180, 40, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(330, 180, 40, 0, Math.PI * 2);
        ctx.fill();

        // Eye highlights
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(170, 170, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(320, 170, 8, 0, Math.PI * 2);
        ctx.fill();

        // Smile
        ctx.strokeStyle = '#1a1a2e';
        ctx.lineWidth = 18;
        ctx.beginPath();
        ctx.arc(256, 320, 80, 0, Math.PI, false);
        ctx.stroke();

        // Accent sparkles — using your app's accent colors
        const sparkleColors = ['#60a5fa', '#3b82f6', '#10b981', '#f59e0b'];
        for (let i = 0; i < 24; i++) {
            const angle = (i / 24) * Math.PI * 2;
            const radius = 215;
            const x = 256 + Math.cos(angle) * radius;
            const y = 256 + Math.sin(angle) * radius;
            ctx.fillStyle = sparkleColors[i % sparkleColors.length];
            ctx.beginPath();
            ctx.arc(x, y, 6, 0, Math.PI * 2);
            ctx.fill();
        }

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.MeshPhongMaterial({
            map: texture,
            emissive: 0x334466,
            emissiveIntensity: 0.25,
            shininess: 80
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);

        return group;
    }

    function create3DParticles() {
        // ── Your app's palette ─────────────────────────────────────────
        const palette = [
            0x60a5fa, 0x3b82f6, 0x10b981, 0xf59e0b,
            0x38bdf8, 0x818cf8, 0x34d399, 0xfbbf24,
            0x93c5fd, 0x6ee7b7, 0xfcd34d, 0xa78bfa
        ];

        const particles = [];

        const makeGeometry = () => {
            const r = Math.random();
            if (r < 0.35) {
                // Small faceted gem
                return new THREE.IcosahedronGeometry(Math.random() * 0.1 + 0.05, 3);
            } else if (r < 0.65) {
                // Flat ribbon/rectangle
                return new THREE.BoxGeometry(
                    Math.random() * 0.12 + 0.04,
                    Math.random() * 0.06 + 0.02,
                    Math.random() * 0.03 + 0.01
                );
            } else if (r < 0.85) {
                // Star-like (thin torus)
                return new THREE.TorusGeometry(
                    Math.random() * 0.05 + 0.02,
                    Math.random() * 0.02 + 0.01,
                    5,
                    8
                );
            } else {
                // Tiny cone
                return new THREE.ConeGeometry(
                    Math.random() * 0.06 + 0.03,
                    Math.random() * 0.08 + 0.04,
                    4
                );
            }
        };

        for (let i = 0; i < 150; i++) {
            const geometry = makeGeometry();
            const color = palette[Math.floor(Math.random() * palette.length)];
            const material = new THREE.MeshPhongMaterial({
                color,
                emissive: color,
                emissiveIntensity: 0.5,
                shininess: 25,
                transparent: true,
                opacity: 1
            });

            const particle = new THREE.Mesh(geometry, material);
            particle.castShadow = true;

            // ── CRITICAL: Spawn behind the face (radius 1.0) ──────────
            const angle = Math.random() * Math.PI * 2;
            const elevation = Math.random() * Math.PI * 0.5 - Math.PI * 0.2;
            const dist = 1.05 + Math.random() * 0.8;
            
            particle.position.set(
                Math.cos(angle) * Math.cos(elevation) * dist,
                Math.sin(elevation) * dist,
                -0.3 - Math.random() * 3.0  // Always negative z (behind)
            );

            // Velocity — outward, z always toward more negative
            const speed = Math.random() * 0.18 + 0.06;
            const vAngle = Math.random() * Math.PI * 2;
            const vElev = Math.random() * Math.PI * 0.4;
            
            particle.velocity = {
                x: Math.cos(vAngle) * Math.cos(vElev) * speed,
                y: Math.sin(vElev) * speed,
                z: -Math.abs(Math.sin(vAngle) * Math.cos(vElev) * speed) - 0.03
            };

            particle.rotationVelocity = {
                x: (Math.random() - 0.5) * 0.15,
                y: (Math.random() - 0.5) * 0.15,
                z: (Math.random() - 0.5) * 0.15
            };

            particle.life = 1;
            particle.lifeDecay = 0.005 + Math.random() * 0.005;
            particle.material = material;

            particles.push(particle);
        }

        return particles;
    }

    function animate3DScene(scene, camera, renderer, partyFace, particles, duration) {
        return new Promise((resolve) => {
            const startTime = Date.now();
            let animationFrame = null;
            let shakeIntensity = 0;

            function frame() {
                const elapsed = Date.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);

                // ── Face animation — tasteful, not chaotic ────────────
                if (progress < 0.2) {
                    // Bounce in
                    const bp = progress / 0.2;
                    const bounce = Math.sin(bp * Math.PI * 2.5) * 0.4;
                    partyFace.scale.setScalar(
                        Math.sin(bp * Math.PI) * 0.5 + 0.5 + bounce
                    );
                    shakeIntensity = bp * 0.08;
                } else if (progress < 0.8) {
                    // Gentle dance
                    const dp = (progress - 0.2) / 0.6;
                    partyFace.rotation.x = Math.sin(dp * Math.PI * 4) * 0.35;
                    partyFace.rotation.y = Math.sin(dp * Math.PI * 3.5) * 0.35;
                    partyFace.rotation.z = Math.cos(dp * Math.PI * 3) * 0.2;
                    partyFace.position.y = Math.sin(dp * Math.PI * 2) * 0.2;
                    partyFace.position.x = Math.cos(dp * Math.PI * 1.5) * 0.15;
                    shakeIntensity = 0.04;
                } else {
                    // Exit
                    const ep = (progress - 0.8) / 0.2;
                    partyFace.scale.setScalar(Math.max(0, 1 - ep));
                    partyFace.rotation.x += 0.08;
                    partyFace.rotation.y += 0.1;
                    shakeIntensity = (1 - ep) * 0.08;
                }

                // ── Particles — strictly behind ───────────────────────
                particles.forEach(p => {
                    p.position.x += p.velocity.x;
                    p.position.y += p.velocity.y;
                    p.position.z += p.velocity.z;

                    // Force particles behind face
                    if (p.position.z > -0.15) {
                        p.position.z = -0.2;
                        p.velocity.z = -Math.abs(p.velocity.z) * 0.7;
                    }

                    p.rotation.x += p.rotationVelocity.x;
                    p.rotation.y += p.rotationVelocity.y;
                    p.rotation.z += p.rotationVelocity.z;

                    p.life -= p.lifeDecay;

                    if (progress >= 0.8) {
                        const ep = (progress - 0.8) / 0.2;
                        p.scale.setScalar(Math.max(0, 1 - ep));
                        p.material.opacity = Math.max(0, p.life * (1 - ep));
                    } else {
                        p.material.opacity = Math.max(0, p.life);
                    }

                    // Subtle physics
                    p.velocity.y -= 0.0015;
                    p.velocity.x *= 0.992;
                    p.velocity.z *= 0.992;
                });

                // ── Subtle camera movement ────────────────────────────
                camera.position.x = (Math.random() - 0.5) * shakeIntensity * 0.2;
                camera.position.y = (Math.random() - 0.5) * shakeIntensity * 0.2;
                camera.position.z = 5 + (Math.random() - 0.5) * shakeIntensity * 0.15;
                camera.lookAt(0, 0, 0);

                renderer.render(scene, camera);

                if (progress < 1) {
                    animationFrame = requestAnimationFrame(frame);
                } else {
                    resolve();
                }
            }

            animationFrame = requestAnimationFrame(frame);

            const handleResize = () => {
                camera.aspect = window.innerWidth / window.innerHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(window.innerWidth, window.innerHeight);
            };
            window.addEventListener('resize', handleResize);

            setTimeout(() => {
                window.removeEventListener('resize', handleResize);
                if (animationFrame) cancelAnimationFrame(animationFrame);
            }, duration + 100);
        });
    }

    function celebrate2D() {
        playPartySound();
        injectStyles();

        const container = document.createElement('div');
        container.className = 'party-face-2d-container';

        // Ambient glow — behind everything
        const glow = document.createElement('div');
        glow.className = 'party-ambient-glow';
        container.appendChild(glow);

        // Confetti — behind emoji
        const confettiColors = [
            '#60a5fa', '#3b82f6', '#10b981', '#f59e0b',
            '#38bdf8', '#818cf8', '#34d399', '#fbbf24',
            '#93c5fd', '#6ee7b7'
        ];

        for (let i = 0; i < 70; i++) {
            const confetti = document.createElement('div');
            confetti.className = 'party-confetti-2d';

            const size = Math.random() * 12 + 5;
            confetti.style.width = size + 'px';
            confetti.style.height = size + 'px';
            confetti.style.backgroundColor = confettiColors[i % confettiColors.length];

            // Shape variety
            if (Math.random() > 0.6) {
                confetti.style.borderRadius = '50%';
            } else if (Math.random() > 0.5) {
                confetti.style.borderRadius = '2px';
                confetti.style.transform = 'rotate(45deg)';
            } else {
                confetti.style.borderRadius = '0';
                confetti.style.width = (size * 2.5) + 'px';
                confetti.style.height = (size * 0.6) + 'px';
            }

            const angle = (360 / 70) * i + (Math.random() - 0.5) * 25;
            const distance = 120 + Math.random() * 220;
            const tx = Math.cos((angle * Math.PI) / 180) * distance;
            const ty = Math.sin((angle * Math.PI) / 180) * distance * 0.8 - 30;

            confetti.style.setProperty('--tx', tx + 'px');
            confetti.style.setProperty('--ty', ty + 'px');
            confetti.style.setProperty('--spin', (Math.random() * 720 - 360) + 'deg');

            container.appendChild(confetti);
        }

        // The emoji — on top
        const emoji = document.createElement('div');
        emoji.className = 'party-face-emoji-2d';
        emoji.textContent = '🥳';
        container.appendChild(emoji);

        document.body.appendChild(container);
        setTimeout(() => container.remove(), 3200);
    }

    function playPartySound() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const now = audioContext.currentTime;

            const notes = [
                { freq: 523.25, dur: 0.12 },
                { freq: 587.33, dur: 0.12 },
                { freq: 659.25, dur: 0.12 },
                { freq: 783.99, dur: 0.15 },
                { freq: 659.25, dur: 0.10 },
                { freq: 783.99, dur: 0.20 },
                { freq: 987.77, dur: 0.20 },
                { freq: 1046.50, dur: 0.30 }
            ];

            notes.forEach((note, idx) => {
                const osc = audioContext.createOscillator();
                osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
                osc.frequency.value = note.freq;

                const gain = audioContext.createGain();
                gain.gain.setValueAtTime(0.15, now + idx * 0.13);
                gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.13 + note.dur);

                osc.connect(gain);
                gain.connect(audioContext.destination);
                osc.start(now + idx * 0.13);
                osc.stop(now + idx * 0.13 + note.dur);
            });
        } catch (e) {
            // Web Audio unavailable — silent celebration is fine
        }
    }

    async function celebrate() {
        await loadThreeJS();
        playPartySound();
        injectStyles();

        if (!threeScriptLoaded || typeof THREE === 'undefined') {
            celebrate2D();
            return;
        }

        try {
            const container = document.createElement('div');
            container.className = 'party-face-3d-container';

            const canvas = document.createElement('canvas');
            canvas.id = 'partyCanvas';
            container.appendChild(canvas);
            document.body.appendChild(container);

            const { scene, camera, renderer } = setup3DScene(canvas);

            const partyFace = create3DPartyFace();
            scene.add(partyFace);

            const particles = create3DParticles();
            particles.forEach(p => scene.add(p));

            await animate3DScene(scene, camera, renderer, partyFace, particles, 3200);

            renderer.dispose();
            container.remove();
        } catch (e) {
            console.warn('3D celebration failed, using 2D fallback:', e);
            // Clean up any partial DOM
            const existing = document.querySelector('.party-face-3d-container');
            if (existing) existing.remove();
            celebrate2D();
        }
    }

    return {
        celebrate,
        celebrateFull: celebrate,
        show: celebrate,
        showFull: celebrate
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PartyFaceCelebration;
}