/**
 * ══════════════════════════════════════════════════════════════════════════════
 * SETTLEMENT CELEBRATION PLUGIN
 * Vibrant animations & effects triggered on successful payment settlement
 * ══════════════════════════════════════════════════════════════════════════════
 */

const CelebrationPlugin = (() => {
    // ── Configuration ────────────────────────────────────────────────────────
    const config = {
        confettiCount: 60,
        burstDuration: 3000,
        particleFallDuration: 3500,
        hornDuration: 800,
        colors: [
            '#3b82f6', '#60a5fa',  // Blues
            '#10b981', '#6ee7b7',  // Greens
            '#f59e0b', '#fbbf24',  // Ambers
            '#ef4444', '#f87171',  // Reds
            '#8b5cf6', '#a78bfa'   // Purples
        ]
    };

    // ── HTML & CSS Injection ─────────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById('celebration-plugin-styles')) return;

        const styleSheet = document.createElement('style');
        styleSheet.id = 'celebration-plugin-styles';
        styleSheet.textContent = `
            /* ── Celebration Container ────────────────────────────────────── */
            .celebration-container {
                position: fixed;
                inset: 0;
                pointer-events: none;
                z-index: 99998;
                overflow: hidden;
            }

            /* ── Confetti Particle ────────────────────────────────────────── */
            .confetti-particle {
                position: absolute;
                width: 8px;
                height: 8px;
                pointer-events: none;
                opacity: 1;
            }

            .confetti-particle.circle {
                border-radius: 50%;
            }

            .confetti-particle.square {
                border-radius: 2px;
            }

            .confetti-particle.triangle {
                width: 0;
                height: 0;
                border-left: 4px solid transparent;
                border-right: 4px solid transparent;
                border-bottom: 8px solid currentColor;
            }

            @keyframes confetti-fall {
                to {
                    transform: translateY(100vh) rotateZ(360deg);
                    opacity: 0;
                }
            }

            .confetti-falling {
                animation: confetti-fall linear forwards;
            }

            /* ── Burst Effect (expanding circles) ──────────────────────────── */
            @keyframes burst-expand {
                0% {
                    transform: scale(0) translate(-50%, -50%);
                    opacity: 1;
                }
                100% {
                    transform: scale(1) translate(-50%, -50%);
                    opacity: 0;
                }
            }

            @keyframes burst-ring {
                0% {
                    r: 0;
                    opacity: 0.8;
                }
                100% {
                    r: 300px;
                    opacity: 0;
                }
            }

            .celebration-burst {
                position: fixed;
                pointer-events: none;
            }

            .burst-circle {
                position: absolute;
                border: 3px solid;
                border-radius: 50%;
                animation: burst-expand 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
            }

            /* ── Horn/Trumpet Effect ──────────────────────────────────────── */
            @keyframes horn-glow {
                0%, 100% {
                    opacity: 0;
                    transform: scale(0.5) translate(-50%, -50%);
                }
                50% {
                    opacity: 1;
                    transform: scale(1) translate(-50%, -50%);
                }
            }

            @keyframes horn-wave {
                0% {
                    transform: translate(-50%, -50%) scale(0.8);
                    opacity: 1;
                }
                100% {
                    transform: translate(-50%, -50%) scale(2.5);
                    opacity: 0;
                }
            }

            .horn-burst {
                position: fixed;
                top: 50%;
                left: 50%;
                pointer-events: none;
                z-index: 99999;
                width: 80px;
                height: 80px;
                transform: translate(-50%, -50%);
            }

            .horn-core {
                position: absolute;
                inset: 0;
                background: radial-gradient(circle, #fbbf24 0%, #f59e0b 100%);
                border-radius: 50%;
                box-shadow: 0 0 40px rgba(251, 191, 36, 0.8);
                animation: horn-glow 0.6s ease-in-out;
            }

            .horn-wave-ring {
                position: absolute;
                inset: 0;
                border: 3px solid #fbbf24;
                border-radius: 50%;
                animation: horn-wave 0.8s ease-out;
            }

            .horn-note {
                position: fixed;
                font-size: 48px;
                font-weight: bold;
                color: #fbbf24;
                text-shadow: 0 0 20px rgba(251, 191, 36, 0.8);
                pointer-events: none;
                font-style: italic;
            }

            @keyframes note-float {
                0% {
                    transform: translate(0, 0) scale(1);
                    opacity: 1;
                }
                100% {
                    transform: translate(var(--tx), -120px) scale(0.3);
                    opacity: 0;
                }
            }

            .horn-note-float {
                animation: note-float 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
            }

            /* ── Success Pulse ────────────────────────────────────────────── */
            @keyframes success-pulse {
                0% {
                    transform: scale(1);
                    opacity: 1;
                }
                50% {
                    transform: scale(1.1);
                }
                100% {
                    transform: scale(1);
                    opacity: 0;
                }
            }

            .success-checkmark {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                pointer-events: none;
                z-index: 99999;
            }

            .checkmark-circle {
                width: 120px;
                height: 120px;
                border: 4px solid #10b981;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 60px;
                color: #10b981;
                animation: success-pulse 0.8s ease-out;
                box-shadow: 0 0 60px rgba(16, 185, 129, 0.4);
            }

            /* ── Shimmer/Glitter Effect ──────────────────────────────────── */
            @keyframes shimmer {
                0%, 100% {
                    opacity: 0.3;
                    transform: scale(1);
                }
                50% {
                    opacity: 1;
                    transform: scale(1.2);
                }
            }

            .shimmer-star {
                position: fixed;
                width: 4px;
                height: 4px;
                pointer-events: none;
                border-radius: 50%;
                animation: shimmer 0.6s ease-in-out forwards;
            }

            /* ── Mobile responsiveness ────────────────────────────────────── */
            @media (max-height: 600px) {
                .confetti-particle {
                    width: 6px;
                    height: 6px;
                }
                .horn-burst {
                    width: 60px;
                    height: 60px;
                }
                .horn-note {
                    font-size: 36px;
                }
                .checkmark-circle {
                    width: 90px;
                    height: 90px;
                    font-size: 45px;
                    border-width: 3px;
                }
            }
        `;
        document.head.appendChild(styleSheet);
    }

    // ── Sound Effects using Web Audio API ────────────────────────────────────
    function playHornSound(duration = 800) {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Create horn sound using oscillators
            const now = audioContext.currentTime;
            const endTime = now + (duration / 1000);
            
            // Main horn note (trumpet-like)
            const osc1 = audioContext.createOscillator();
            osc1.type = 'triangle';
            osc1.frequency.setValueAtTime(523.25, now); // C5
            osc1.frequency.exponentialRampToValueAtTime(587.33, endTime); // D5
            
            // Harmonic overtone
            const osc2 = audioContext.createOscillator();
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(1046.5, now); // C6 (octave)
            osc2.frequency.exponentialRampToValueAtTime(1174.66, endTime);
            
            // Gain envelope
            const gainEnv = audioContext.createGain();
            gainEnv.gain.setValueAtTime(0.15, now);
            gainEnv.gain.exponentialRampToValueAtTime(0.01, endTime);
            
            // Connect and play
            osc1.connect(gainEnv);
            osc2.connect(gainEnv);
            gainEnv.connect(audioContext.destination);
            
            osc1.start(now);
            osc2.start(now);
            osc1.stop(endTime);
            osc2.stop(endTime);
            
            // Success beep sequence
            setTimeout(() => {
                const beep1 = audioContext.createOscillator();
                beep1.type = 'sine';
                beep1.frequency.value = 800;
                const beep1Gain = audioContext.createGain();
                beep1Gain.gain.setValueAtTime(0.1, now);
                beep1Gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
                beep1.connect(beep1Gain);
                beep1Gain.connect(audioContext.destination);
                beep1.start(now);
                beep1.stop(now + 0.1);
            }, 100);
        } catch (e) {
            console.log('Web Audio API not available', e);
        }
    }

    // ── Confetti Particle Generation ─────────────────────────────────────────
    function createConfetti(x, y) {
        const container = document.createElement('div');
        container.className = 'celebration-container';
        document.body.appendChild(container);

        for (let i = 0; i < config.confettiCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'confetti-particle';
            
            // Random shape
            const shapes = ['circle', 'square', 'triangle'];
            const shape = shapes[Math.floor(Math.random() * shapes.length)];
            particle.classList.add(shape);
            
            // Random color
            const color = config.colors[Math.floor(Math.random() * config.colors.length)];
            particle.style.backgroundColor = color;
            particle.style.color = color;
            
            // Random initial position (spread from center)
            const angle = (Math.random() * Math.PI * 2);
            const velocity = 4 + Math.random() * 8;
            const startX = window.innerWidth / 2 + Math.cos(angle) * velocity * 10;
            const startY = window.innerHeight / 2 + Math.sin(angle) * velocity * 10;
            
            particle.style.left = startX + 'px';
            particle.style.top = startY + 'px';
            
            // Random horizontal drift
            const driftX = (Math.random() - 0.5) * 200;
            const driftY = window.innerHeight;
            
            container.appendChild(particle);
            
            // Trigger animation
            setTimeout(() => {
                particle.classList.add('confetti-falling');
                particle.style.setProperty('--duration', config.particleFallDuration + 'ms');
                particle.style.animation = `confetti-fall ${config.particleFallDuration}ms linear forwards`;
                particle.style.transform = `translate(${driftX}px, ${driftY}px) rotateZ(${Math.random() * 720}deg)`;
            }, Math.random() * 50);
        }

        // Cleanup
        setTimeout(() => {
            container.remove();
        }, config.particleFallDuration + 100);
    }

    // ── Burst Effect (expanding rings) ───────────────────────────────────────
    function createBurst(x, y) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.position = 'fixed';
        svg.style.inset = '0';
        svg.style.pointerEvents = 'none';
        svg.style.zIndex = '99998';
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        
        document.body.appendChild(svg);

        // Create multiple burst rings
        const ringCount = 4;
        for (let i = 0; i < ringCount; i++) {
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            const color = config.colors[i % config.colors.length];
            circle.setAttribute('cx', cx);
            circle.setAttribute('cy', cy);
            circle.setAttribute('r', '0');
            circle.setAttribute('fill', 'none');
            circle.setAttribute('stroke', color);
            circle.setAttribute('stroke-width', '2');
            circle.style.filter = 'drop-shadow(0 0 10px ' + color + ')';
            
            svg.appendChild(circle);
            
            // Animate burst
            setTimeout(() => {
                let radius = 0;
                const startTime = Date.now();
                const duration = 800;
                
                const animate = () => {
                    const elapsed = Date.now() - startTime;
                    const progress = Math.min(elapsed / duration, 1);
                    
                    radius = progress * 300;
                    circle.setAttribute('r', radius);
                    
                    const opacity = 1 - progress;
                    circle.style.opacity = opacity.toString();
                    
                    if (progress < 1) {
                        requestAnimationFrame(animate);
                    }
                };
                animate();
            }, i * 80);
        }

        // Cleanup
        setTimeout(() => {
            svg.remove();
        }, config.burstDuration);
    }

    // ── Horn/Trumpet Visual Effect ───────────────────────────────────────────
    function createHornEffect() {
        const container = document.createElement('div');
        container.className = 'horn-burst';
        container.style.top = '50%';
        container.style.left = '50%';
        
        const core = document.createElement('div');
        core.className = 'horn-core';
        container.appendChild(core);
        
        // Create wave rings
        for (let i = 0; i < 3; i++) {
            const wave = document.createElement('div');
            wave.className = 'horn-wave-ring';
            wave.style.animationDelay = (i * 0.15) + 's';
            container.appendChild(wave);
        }
        
        document.body.appendChild(container);

        // Create floating music notes
        const notes = ['♪', '♫', '♪'];
        notes.forEach((note, idx) => {
            setTimeout(() => {
                const noteEl = document.createElement('div');
                noteEl.className = 'horn-note horn-note-float';
                noteEl.textContent = note;
                
                const angle = (idx - 1) * 30; // -30, 0, 30 degrees
                const distance = 150;
                const tx = Math.sin((angle * Math.PI) / 180) * distance;
                
                noteEl.style.top = '50%';
                noteEl.style.left = '50%';
                noteEl.style.setProperty('--tx', tx + 'px');
                
                document.body.appendChild(noteEl);
                
                setTimeout(() => noteEl.remove(), 1200);
            }, idx * 120);
        });

        // Cleanup
        setTimeout(() => {
            container.remove();
        }, 1000);
    }

    // ── Shimmer/Glitter Effect ──────────────────────────────────────────────
    function createShimmers() {
        const shimmerCount = 20;
        
        for (let i = 0; i < shimmerCount; i++) {
            const shimmer = document.createElement('div');
            shimmer.className = 'shimmer-star';
            
            const x = Math.random() * window.innerWidth;
            const y = Math.random() * window.innerHeight;
            
            shimmer.style.left = x + 'px';
            shimmer.style.top = y + 'px';
            shimmer.style.backgroundColor = config.colors[Math.floor(Math.random() * config.colors.length)];
            shimmer.style.animationDelay = (Math.random() * 0.3) + 's';
            
            document.body.appendChild(shimmer);
            
            setTimeout(() => shimmer.remove(), 900);
        }
    }

    // ── Success Checkmark ───────────────────────────────────────────────────
    function createSuccessCheckmark() {
        const container = document.createElement('div');
        container.className = 'success-checkmark';
        
        const circle = document.createElement('div');
        circle.className = 'checkmark-circle';
        circle.innerHTML = '✓';
        
        container.appendChild(circle);
        document.body.appendChild(container);

        setTimeout(() => {
            container.remove();
        }, 1000);
    }

    // ── Main Celebration Trigger ────────────────────────────────────────────
    function celebrate(options = {}) {
        // Ensure styles are injected
        injectStyles();
        
        const {
            playSound = true,
            showConfetti = true,
            showBurst = true,
            showHorn = true,
            showCheckmark = true
        } = options;

        // Play horn sound
        if (playSound) {
            playHornSound(config.hornDuration);
        }

        // Trigger animations in sequence
        const startTime = Date.now();
        
        if (showCheckmark) {
            createSuccessCheckmark();
        }
        
        if (showBurst) {
            setTimeout(() => createBurst(), 100);
        }
        
        if (showHorn) {
            setTimeout(() => createHornEffect(), 150);
        }
        
        if (showConfetti) {
            setTimeout(() => createConfetti(), 200);
        }

        // Add shimmer for extra pop
        setTimeout(() => createShimmers(), 300);
    }

    // ── Public API ───────────────────────────────────────────────────────────
    return {
        celebrate,
        // Allow fine-tuned control
        celebrateMinimal: () => celebrate({ showConfetti: true, playSound: true }),
        celebrateFull: () => celebrate({ 
            playSound: true, 
            showConfetti: true, 
            showBurst: true, 
            showHorn: true,
            showCheckmark: true 
        }),
        // Custom celebration
        customCelebrate: (options) => celebrate(options)
    };
})();

// Export for use in Node/module environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CelebrationPlugin;
}
