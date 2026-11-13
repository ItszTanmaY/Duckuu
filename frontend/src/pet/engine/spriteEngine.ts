import { PetEmotion } from '@/types/api';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  text?: string;
  color?: string;
  size?: number;
}

export class SpriteEngine {
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private frameCount = 0;
  private particles: Particle[] = [];

  // Physics & Position
  public x = 110;
  public y = 160;
  public vx = 0;
  public vy = 0;
  public isDragging = false;
  public isGrounded = true;
  public facingDirection: 'left' | 'right' = 'right';

  // Ground level relative to canvas bottom
  public readonly groundY = 168;
  private readonly gravity = 0.55;

  constructor(ctx: CanvasRenderingContext2D, width: number, height: number) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;
    this.y = this.groundY;
  }

  public update(emotion: PetEmotion): void {
    this.frameCount++;

    // Physics update
    if (this.isDragging) {
      this.isGrounded = false;
      this.vy = 0;
    } else {
      // Gravity
      if (this.y < this.groundY) {
        this.vy += this.gravity;
        this.y += this.vy;
        this.isGrounded = false;
      }
      if (this.y >= this.groundY) {
        this.y = this.groundY;
        this.vy = 0;
        this.isGrounded = true;
      }

      // Roaming / Walking locomotion
      if ((emotion === 'roaming' || emotion === 'walking') && this.isGrounded) {
        const speed = 0.85;
        if (this.facingDirection === 'right') {
          this.x += speed;
          if (this.x > this.width - 48) {
            this.facingDirection = 'left';
          }
        } else {
          this.x -= speed;
          if (this.x < 48) {
            this.facingDirection = 'right';
          }
        }
      }
    }

    // Spawn state-specific particles
    this.handleStateParticles(emotion);

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life++;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
      }
    }
  }

  private handleStateParticles(emotion: PetEmotion): void {
    // Sleeping Zzz
    if (emotion === 'sleeping' && this.frameCount % 50 === 0) {
      this.particles.push({
        x: this.x + (this.facingDirection === 'right' ? 16 : -16),
        y: this.y - 30,
        vx: (Math.random() - 0.5) * 0.35 + (this.facingDirection === 'right' ? 0.3 : -0.3),
        vy: -0.65,
        life: 0,
        maxLife: 75,
        text: 'z',
        color: 'rgba(147, 197, 253, 0.95)',
        size: 13 + Math.random() * 5
      });
    }

    // Annoyed angry marks 💢
    if (emotion === 'annoyed' && this.frameCount % 24 === 0) {
      this.particles.push({
        x: this.x + (Math.random() - 0.5) * 22,
        y: this.y - 48,
        vx: (Math.random() - 0.5) * 0.9,
        vy: -0.9,
        life: 0,
        maxLife: 35,
        text: '💢',
        size: 14
      });
    }

    // Happy sparkles & hearts ✨ 💖
    if ((emotion === 'happy' || (emotion as string) === 'in_love') && this.frameCount % 22 === 0) {
      this.particles.push({
        x: this.x + (Math.random() - 0.5) * 32,
        y: this.y - 38 - Math.random() * 12,
        vx: (Math.random() - 0.5) * 0.7,
        vy: -0.85,
        life: 0,
        maxLife: 42,
        text: Math.random() > 0.4 ? '✨' : '💖',
        size: 13
      });
    }

    // Listening musical notes ♪ ♫
    if ((emotion === 'listening' || emotion === 'vibing') && this.frameCount % 26 === 0) {
      this.particles.push({
        x: this.x + (this.facingDirection === 'right' ? 22 : -22),
        y: this.y - 46,
        vx: (Math.random() - 0.5) * 0.7 + (this.facingDirection === 'right' ? 0.3 : -0.3),
        vy: -0.75,
        life: 0,
        maxLife: 55,
        text: Math.random() > 0.5 ? '♪' : '♫',
        color: '#F472B6',
        size: 15
      });
    }

    // Roaming / Walking dust puffs 💨
    if ((emotion === 'roaming' || emotion === 'walking') && this.frameCount % 18 === 0) {
      this.particles.push({
        x: this.x + (this.facingDirection === 'right' ? -18 : 18),
        y: this.groundY + 16,
        vx: (this.facingDirection === 'right' ? -0.7 : 0.7) + (Math.random() - 0.5) * 0.3,
        vy: -0.3,
        life: 0,
        maxLife: 20,
        text: '💨',
        size: 11
      });
    }

    // Sad / Crying tear particles 💧
    if (emotion === 'sad' && this.frameCount % 24 === 0) {
      this.particles.push({
        x: this.x + (Math.random() > 0.5 ? -13 : 13),
        y: this.y - 18,
        vx: (Math.random() - 0.5) * 0.4,
        vy: 1.1,
        life: 0,
        maxLife: 35,
        text: '💧',
        size: 13
      });
    }

    // Done celebration stars ⭐
    if (emotion === 'done' && this.frameCount % 12 === 0) {
      this.particles.push({
        x: this.x + (Math.random() - 0.5) * 38,
        y: this.y - 32,
        vx: (Math.random() - 0.5) * 1.5,
        vy: -1.1,
        life: 0,
        maxLife: 38,
        text: '⭐',
        size: 14
      });
    }
  }

  public render(emotion: PetEmotion): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    ctx.save();

    // Body oscillations and squash/stretch based on character design sheet
    const time = this.frameCount * 0.08;
    let bobY = 0;
    let squishX = 1;
    let squishY = 1;
    let tiltAngle = 0;

    switch (emotion) {
      case 'idle':
        // Gentle, cute breathing rhythm
        bobY = Math.sin(time * 0.7) * 1.2;
        squishY = 1 + Math.sin(time * 0.7) * 0.025;
        squishX = 1 - Math.sin(time * 0.7) * 0.015;
        break;
      case 'blinking':
        bobY = 0;
        squishY = 1;
        squishX = 1;
        break;
      case 'roaming':
      case 'walking':
        // Adorable waddling step
        bobY = Math.abs(Math.sin(time * 2.2)) * -4;
        tiltAngle = Math.sin(time * 2.2) * 0.08;
        squishY = 1 + Math.abs(Math.sin(time * 2.2)) * 0.04;
        break;
      case 'sitting':
        // Cozy resting squat on window edge or desk
        bobY = 4;
        squishY = 0.88;
        squishX = 1.08;
        break;
      case 'happy':
      case 'done':
        // Joyful, cheerful bouncy hops
        bobY = Math.abs(Math.sin(time * 2.8)) * -8;
        squishX = 1 + Math.cos(time * 2.8) * 0.05;
        squishY = 1 - Math.cos(time * 2.8) * 0.05;
        break;
      case 'annoyed':
        // Tiny irritated shiver / stomp
        bobY = (Math.random() - 0.5) * 1.5;
        tiltAngle = (Math.sin(time * 4) * Math.PI) / 38;
        break;
      case 'sad':
        // Drooping body posture with slow sad breathing
        bobY = 3 + Math.sin(time * 1.2) * 1.0;
        squishY = 0.96;
        squishX = 1.03;
        break;
      case 'surprised':
        // Sudden alert hop
        bobY = -5;
        squishY = 1.08;
        squishX = 0.95;
        break;
      case 'vibing':
      case 'listening':
        // Gentle head-bopping to music
        bobY = Math.sin(time * 1.8) * 2.5;
        tiltAngle = Math.sin(time * 1.8) * 0.07;
        break;
      case 'thinking':
        // Curious tilted head looking upward
        tiltAngle = (9 * Math.PI) / 180;
        bobY = Math.sin(time * 0.8) * 1.0;
        break;
      case 'confused':
        tiltAngle = (-11 * Math.PI) / 180;
        break;
      case 'sleeping':
        // Cozy flat puddle loaf squish
        squishY = 0.72 + Math.sin(time * 0.4) * 0.03;
        squishX = 1.18;
        bobY = 5;
        break;
      case 'speaking':
        // Natural speech bounce rhythm
        bobY = Math.sin(time * 2.5) * 1.6;
        squishY = 1 + Math.sin(time * 2.5) * 0.02;
        break;
    }

    if (this.isDragging) {
      bobY = -12;
      squishY = 1.09;
      squishX = 0.94;
    }

    const drawX = this.x;
    const drawY = this.y + bobY;

    // 1. Soft ambient ground shadow (fades when airborne)
    const heightAboveGround = this.groundY - this.y;
    if (heightAboveGround < 60) {
      const shadowScale = Math.max(0.3, 1 - heightAboveGround / 60);
      const isSleeping = emotion === 'sleeping';
      const shadowRadiusX = isSleeping ? 38 : 30;
      ctx.beginPath();
      ctx.ellipse(this.x, this.groundY + 20, shadowRadiusX * shadowScale, 6.5 * shadowScale, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(60, 36, 21, ${0.22 * shadowScale})`;
      ctx.fill();
    }

    // 2. Render duck body and features
    ctx.save();
    ctx.translate(drawX, drawY);
    ctx.rotate(tiltAngle);
    ctx.scale(
      (this.facingDirection === 'left' ? -1 : 1) * squishX,
      squishY
    );

    this.drawDuckAnatomy(ctx, emotion);

    ctx.restore();

    // 3. Render floating particles
    this.renderParticles(ctx);

    ctx.restore();
  }

  private drawDuckAnatomy(ctx: CanvasRenderingContext2D, emotion: PetEmotion): void {
    const time = this.frameCount * 0.1;
    const isSleeping = emotion === 'sleeping';

    // Character Design Sheet Visual Palette
    const COLOR_BODY = '#FDE872';        // Pastel buttery warm yellow
    const COLOR_OUTLINE = '#3C2415';     // Soft warm dark-brown outline
    const COLOR_BEAK = '#F27420';        // Vibrant warm orange
    const COLOR_FEET = '#F27420';        // Matching warm orange feet
    const COLOR_TONGUE = '#EF4444';      // Cheerful tongue red
    const COLOR_BLUSH = 'rgba(244, 63, 94, 0.42)'; // Rosy cheeks

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // -------------------------------------------------------------
    // 1. FEET (Rendered under body)
    // -------------------------------------------------------------
    if (!isSleeping) {
      ctx.fillStyle = COLOR_FEET;
      ctx.strokeStyle = COLOR_OUTLINE;
      ctx.lineWidth = 2.4;

      if (!this.isDragging && this.isGrounded) {
        const isWalking = emotion === 'roaming' || emotion === 'walking';
        const isSitting = emotion === 'sitting';
        const leftFootBob = isWalking ? Math.sin(time * 2.2) * 4 : 0;
        const rightFootBob = isWalking ? -Math.sin(time * 2.2) * 4 : 0;

        if (isSitting) {
          // Relaxed feet resting under belly
          ctx.beginPath();
          ctx.ellipse(-15, 20, 8.5, 4, 0.12, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.beginPath();
          ctx.ellipse(15, 20, 8.5, 4, -0.12, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          // Left foot
          ctx.beginPath();
          ctx.ellipse(-13, 20 - leftFootBob, 9, 4.5, 0.08, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // Right foot
          ctx.beginPath();
          ctx.ellipse(13, 20 - rightFootBob, 9, 4.5, -0.08, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      } else {
        // Dangling feet when airborne / dragged
        ctx.beginPath();
        ctx.ellipse(-10, 22, 5.5, 7.5, 0.22, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(10, 22, 5.5, 7.5, -0.22, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // -------------------------------------------------------------
    // 2. CHUBBY PEAR BODY & HEAD (Seamless unified silhouette)
    // -------------------------------------------------------------
    ctx.fillStyle = COLOR_BODY;
    ctx.strokeStyle = COLOR_OUTLINE;
    ctx.lineWidth = 2.6;

    if (isSleeping) {
      // Sleeping Loaf / Puddle Pose from sheet
      ctx.beginPath();
      ctx.moveTo(-36, 17);
      ctx.bezierCurveTo(-42, 4, -30, -12, -10, -16);
      ctx.bezierCurveTo(10, -18, 34, -10, 38, 6);
      ctx.bezierCurveTo(42, 14, 38, 20, 24, 20);
      ctx.bezierCurveTo(0, 21, -24, 21, -36, 17);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      // Upright Chubby Pear Silhouette
      ctx.beginPath();
      // Top of head dome
      ctx.moveTo(0, -48);
      // Right forehead down to right chubby cheek
      ctx.bezierCurveTo(18, -48, 28, -36, 27, -22);
      // Right waist curving out into wide chubby belly
      ctx.bezierCurveTo(26, -10, 36, -2, 36, 10);
      // Right bottom curve into base
      ctx.bezierCurveTo(36, 20, 18, 21, 0, 21);
      // Left bottom curve from base
      ctx.bezierCurveTo(-18, 21, -36, 20, -36, 10);
      // Left chubby belly into waist
      ctx.bezierCurveTo(-36, -2, -26, -10, -27, -22);
      // Left cheek up to forehead dome
      ctx.bezierCurveTo(-28, -36, -18, -48, 0, -48);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Subtle warm gradient shadow at the base for soft depth
      const bellyShadow = ctx.createLinearGradient(0, 6, 0, 21);
      bellyShadow.addColorStop(0, 'rgba(252, 211, 77, 0)');
      bellyShadow.addColorStop(1, 'rgba(245, 158, 11, 0.22)');
      ctx.fillStyle = bellyShadow;
      ctx.beginPath();
      ctx.ellipse(0, 14, 28, 6.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // -------------------------------------------------------------
    // 3. WINGS / FLIPPERS
    // -------------------------------------------------------------
    ctx.fillStyle = COLOR_BODY;
    ctx.strokeStyle = COLOR_OUTLINE;
    ctx.lineWidth = 2.4;

    if (!isSleeping) {
      if (emotion === 'happy' || emotion === 'vibing' || emotion === 'done') {
        // Wings raised high joyfully \o/
        const flap = Math.sin(time * 3) * 3;
        // Left raised wing
        ctx.beginPath();
        ctx.ellipse(-30, -16 + flap, 6.5, 13, -0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Right raised wing
        ctx.beginPath();
        ctx.ellipse(30, -16 - flap, 6.5, 13, 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (emotion === 'roaming') {
        // Waddling wing swings
        const wingSwing = Math.sin(time * 2.2) * 5;
        ctx.beginPath();
        ctx.ellipse(-29, -2 + wingSwing, 6.5, 12, -0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(29, -2 - wingSwing, 6.5, 12, 0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (emotion === 'speaking') {
        // Expressive wing gesturing while talking
        const gesture = Math.sin(time * 3.5) * 3;
        ctx.beginPath();
        ctx.ellipse(-28, -4 + gesture, 6.5, 12, -0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(29, -6 - gesture, 6.5, 12, 0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (emotion === 'surprised') {
        // One wing raised in shock/surprise!
        ctx.beginPath();
        ctx.ellipse(-28, 0, 6.5, 12, -0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(26, -16, 6.5, 12, 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (emotion === 'sad') {
        // Wings drooped sad at sides
        ctx.beginPath();
        ctx.ellipse(-28, 4, 6.5, 12, 0.05, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(28, 4, 6.5, 12, -0.05, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (emotion === 'working' || emotion === 'annoyed') {
        // Holding the iconic butter knife from the character sheet!
        // Left wing
        ctx.beginPath();
        ctx.ellipse(-28, -2, 6.5, 12, -0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Right wing clutching knife
        ctx.beginPath();
        ctx.ellipse(18, 4, 6.5, 10, -1.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // The cute Butter Knife (peaceful yet menacing meme)
        ctx.fillStyle = '#CBD5E1'; // Silver blade
        ctx.strokeStyle = COLOR_OUTLINE;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(12, 2);
        ctx.lineTo(-14, 2);
        ctx.quadraticCurveTo(-20, 3, -16, 8);
        ctx.lineTo(12, 8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Knife handle
        ctx.fillStyle = '#854D0E';
        ctx.beginPath();
        ctx.roundRect(10, 3, 10, 4, 1.5);
        ctx.fill();
        ctx.stroke();
      } else {
        // Default resting cute stubby flippers at sides
        ctx.beginPath();
        ctx.ellipse(-28, -2, 6.5, 12, -0.18, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(28, -2, 6.5, 12, 0.18, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // -------------------------------------------------------------
    // 4. BEAK (Plump rounded orange oval)
    // -------------------------------------------------------------
    ctx.fillStyle = COLOR_BEAK;
    ctx.strokeStyle = COLOR_OUTLINE;
    ctx.lineWidth = 2.2;

    const beakY = isSleeping ? 4 : -18;
    const beakX = isSleeping ? 8 : 0;

    if (isSleeping) {
      // Sleeping relaxed resting beak
      ctx.beginPath();
      ctx.ellipse(beakX, beakY, 9, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (emotion === 'speaking') {
      // Audio-synced animated beak: rhythmic mouth flapping
      const mouthCycle = Math.abs(Math.sin(time * 12));
      const mouthGap = mouthCycle * 7;

      if (mouthCycle > 0.25) {
        // Inner mouth cavity when open
        ctx.fillStyle = '#8A1C14';
        ctx.beginPath();
        ctx.ellipse(beakX, beakY, 9, 3 + mouthGap * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();

        // Red tongue
        ctx.fillStyle = COLOR_TONGUE;
        ctx.beginPath();
        ctx.arc(beakX, beakY + mouthGap * 0.2, 3, 0, Math.PI);
        ctx.fill();

        // Upper beak rim
        ctx.fillStyle = COLOR_BEAK;
        ctx.beginPath();
        ctx.ellipse(beakX, beakY - mouthGap * 0.4, 9, 4, 0, 0, Math.PI);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Lower beak rim
        ctx.beginPath();
        ctx.ellipse(beakX, beakY + mouthGap * 0.5, 8, 3.5, 0, Math.PI, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Speech vibration accent ticks \ | / next to beak from sheet
        ctx.strokeStyle = COLOR_OUTLINE;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(beakX + 13, beakY - 4);
        ctx.lineTo(beakX + 17, beakY - 7);
        ctx.moveTo(beakX + 14, beakY);
        ctx.lineTo(beakX + 19, beakY);
        ctx.moveTo(beakX + 13, beakY + 4);
        ctx.lineTo(beakX + 17, beakY + 7);
        ctx.stroke();
      } else {
        // Closed beak during pauses
        ctx.beginPath();
        ctx.ellipse(beakX, beakY, 9.5, 5.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    } else if (emotion === 'happy') {
      // Open smiling crescent beak with pink tongue
      ctx.beginPath();
      ctx.arc(beakX, beakY - 1, 9, 0.1, Math.PI - 0.1);
      ctx.closePath();
      ctx.fillStyle = '#8A1C14';
      ctx.fill();
      ctx.stroke();

      // Tongue
      ctx.fillStyle = COLOR_TONGUE;
      ctx.beginPath();
      ctx.arc(beakX, beakY + 3, 4, Math.PI, 0);
      ctx.fill();

      // Upper rim of beak
      ctx.fillStyle = COLOR_BEAK;
      ctx.beginPath();
      ctx.ellipse(beakX, beakY - 2, 9, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (emotion === 'sad') {
      // Slightly downturned sad trembling beak
      const tremble = Math.sin(time * 8) * 0.4;
      ctx.beginPath();
      ctx.ellipse(beakX, beakY + 1.5 + tremble, 9, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (emotion === 'surprised') {
      // Small open "o" beak from sheet
      ctx.beginPath();
      ctx.ellipse(beakX, beakY, 5.5, 6.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#8A1C14';
      ctx.beginPath();
      ctx.ellipse(beakX, beakY + 0.5, 3.5, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Classic cute horizontal rounded oval beak
      ctx.beginPath();
      ctx.ellipse(beakX, beakY, 9.5, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // -------------------------------------------------------------
    // 5. EYES AND FACIAL EXPRESSIONS
    // -------------------------------------------------------------
    this.drawEyes(ctx, emotion, isSleeping);

    // -------------------------------------------------------------
    // 6. ACCESSORIES & SPECIAL EMOTES (Headphones, lightbulb, etc.)
    // -------------------------------------------------------------
    if (emotion === 'listening') {
      // Dark padded headphones with cyan accents from sheet
      ctx.strokeStyle = '#1E293B';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, -32, 28, Math.PI * 0.88, Math.PI * 0.12);
      ctx.stroke();

      // Left earcup
      ctx.fillStyle = '#334155';
      ctx.strokeStyle = COLOR_OUTLINE;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.roundRect(-30, -36, 8, 16, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#38BDF8';
      ctx.beginPath();
      ctx.arc(-26, -28, 2, 0, Math.PI * 2);
      ctx.fill();

      // Right earcup
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.roundRect(22, -36, 8, 16, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#38BDF8';
      ctx.beginPath();
      ctx.arc(26, -28, 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (emotion === 'thinking') {
      // Thought bubble with glowing lightbulb (from "Thinking Hard" on sheet)
      ctx.save();
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = COLOR_OUTLINE;
      ctx.lineWidth = 1.6;

      ctx.beginPath();
      ctx.arc(16, -38, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(22, -45, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Main cloud bubble
      ctx.beginPath();
      ctx.arc(32, -54, 9, 0, Math.PI * 2);
      ctx.arc(38, -60, 8, 0, Math.PI * 2);
      ctx.arc(46, -55, 9, 0, Math.PI * 2);
      ctx.arc(40, -48, 8, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.font = '13px sans-serif';
      ctx.fillText('💡', 31, -50);
      ctx.restore();
    } else if (emotion === 'surprised') {
      // Exclamation mark above head
      ctx.fillStyle = '#EF4444';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText('!', 18, -46);
    }
  }

  private drawEyes(ctx: CanvasRenderingContext2D, emotion: PetEmotion, isSleeping: boolean): void {
    const COLOR_OUTLINE = '#3C2415';

    if (isSleeping) {
      // Peaceful curved sleeping eyes on resting loaf face
      ctx.strokeStyle = COLOR_OUTLINE;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(-4, 0, 3.5, 0.1, Math.PI - 0.1);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(18, 0, 3.5, 0.1, Math.PI - 0.1);
      ctx.stroke();
      return;
    }

    const eyeY = -24;
    const leftEyeX = -13;
    const rightEyeX = 13;

    switch (emotion) {
      case 'blinking': {
        // Dedicated blink curves ⌒ ⌒
        ctx.strokeStyle = COLOR_OUTLINE;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(leftEyeX, eyeY + 1, 3.5, 0.1, Math.PI - 0.1);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(rightEyeX, eyeY + 1, 3.5, 0.1, Math.PI - 0.1);
        ctx.stroke();
        break;
      }

      case 'happy':
        // Smiling arc eyes ^ ^ with rosy blush
        ctx.strokeStyle = COLOR_OUTLINE;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(leftEyeX, eyeY + 1, 3.8, Math.PI + 0.2, -0.2);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(rightEyeX, eyeY + 1, 3.8, Math.PI + 0.2, -0.2);
        ctx.stroke();

        // Rosy pink blush cheeks
        ctx.fillStyle = 'rgba(244, 63, 94, 0.45)';
        ctx.beginPath();
        ctx.arc(-19, eyeY + 8, 4.5, 0, Math.PI * 2);
        ctx.arc(19, eyeY + 8, 4.5, 0, Math.PI * 2);
        ctx.fill();
        break;

      case 'listening': {
        // Contented listening eyes ⌒ ⌒
        ctx.strokeStyle = COLOR_OUTLINE;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(leftEyeX, eyeY + 1, 3.5, 0.1, Math.PI - 0.1);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(rightEyeX, eyeY + 1, 3.5, 0.1, Math.PI - 0.1);
        ctx.stroke();

        // Soft blush
        ctx.fillStyle = 'rgba(244, 63, 94, 0.35)';
        ctx.beginPath();
        ctx.arc(-19, eyeY + 8, 4, 0, Math.PI * 2);
        ctx.arc(19, eyeY + 8, 4, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'annoyed':
        // Slanted determined / angry eyes \ /
        ctx.strokeStyle = '#991B1B';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(leftEyeX - 4, eyeY - 2);
        ctx.lineTo(leftEyeX + 4, eyeY + 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(rightEyeX + 4, eyeY - 2);
        ctx.lineTo(rightEyeX - 4, eyeY + 2);
        ctx.stroke();
        break;

      case 'sad': {
        // Droopy sad eyes with blue teardrops
        ctx.fillStyle = COLOR_OUTLINE;
        ctx.beginPath();
        ctx.arc(leftEyeX, eyeY + 1, 2.6, 0, Math.PI * 2);
        ctx.arc(rightEyeX, eyeY + 1, 2.6, 0, Math.PI * 2);
        ctx.fill();

        // Blue teardrops resting on outer edge of eyes
        ctx.fillStyle = '#60A5FA';
        ctx.beginPath();
        ctx.ellipse(leftEyeX - 4, eyeY + 3, 2.2, 3, 0.2, 0, Math.PI * 2);
        ctx.ellipse(rightEyeX + 4, eyeY + 3, 2.2, 3, -0.2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'surprised': {
        // Wide alert round eyes with white highlights
        ctx.fillStyle = COLOR_OUTLINE;
        ctx.beginPath();
        ctx.arc(leftEyeX, eyeY - 1, 3.8, 0, Math.PI * 2);
        ctx.arc(rightEyeX, eyeY - 1, 3.8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(leftEyeX + 1.2, eyeY - 2.2, 1.4, 0, Math.PI * 2);
        ctx.arc(rightEyeX + 1.2, eyeY - 2.2, 1.4, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'thinking':
        // Eyes looking up and to the right
        ctx.fillStyle = COLOR_OUTLINE;
        ctx.beginPath();
        ctx.arc(leftEyeX + 2, eyeY - 2, 2.8, 0, Math.PI * 2);
        ctx.arc(rightEyeX + 2, eyeY - 2, 2.8, 0, Math.PI * 2);
        ctx.fill();
        break;

      case 'confused':
        // Wide curious eyes
        ctx.fillStyle = COLOR_OUTLINE;
        ctx.beginPath();
        ctx.arc(leftEyeX, eyeY, 3.8, 0, Math.PI * 2);
        ctx.arc(rightEyeX, eyeY, 3.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(leftEyeX + 1, eyeY - 1, 1.4, 0, Math.PI * 2);
        ctx.arc(rightEyeX + 1, eyeY - 1, 1.4, 0, Math.PI * 2);
        ctx.fill();
        break;

      case 'speaking': {
        // Expressive eyes while talking with natural blinks
        const blinkCycle = this.frameCount % 120;
        const isBlinking = blinkCycle > 114;
        if (isBlinking) {
          ctx.strokeStyle = COLOR_OUTLINE;
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(leftEyeX, eyeY + 1, 3.8, Math.PI + 0.2, -0.2);
          ctx.arc(rightEyeX, eyeY + 1, 3.8, Math.PI + 0.2, -0.2);
          ctx.stroke();
        } else {
          ctx.fillStyle = COLOR_OUTLINE;
          ctx.beginPath();
          ctx.arc(leftEyeX, eyeY, 2.8, 0, Math.PI * 2);
          ctx.arc(rightEyeX, eyeY, 2.8, 0, Math.PI * 2);
          ctx.fill();
        }
        // Subtle cheerful speech blush
        ctx.fillStyle = 'rgba(244, 63, 94, 0.35)';
        ctx.beginPath();
        ctx.arc(-19, eyeY + 8, 4, 0, Math.PI * 2);
        ctx.arc(19, eyeY + 8, 4, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      default: {
        // Natural blinking every ~3.5 seconds
        const blinkCycle = this.frameCount % 200;
        const isBlinking = blinkCycle > 192;

        if (isBlinking) {
          // Check if squint blink (> <) or curve blink (⌒ ⌒)
          const isSquint = Math.floor(this.frameCount / 200) % 2 === 0;
          if (isSquint) {
            // Squint blink > < from reference sheet
            ctx.strokeStyle = COLOR_OUTLINE;
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.moveTo(leftEyeX - 3.5, eyeY - 2.5);
            ctx.lineTo(leftEyeX + 1.5, eyeY);
            ctx.lineTo(leftEyeX - 3.5, eyeY + 2.5);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(rightEyeX + 3.5, eyeY - 2.5);
            ctx.lineTo(rightEyeX - 1.5, eyeY);
            ctx.lineTo(rightEyeX + 3.5, eyeY + 2.5);
            ctx.stroke();

            // 3 cute radiating tick marks beside right eye from sheet
            ctx.strokeStyle = '#F59E0B';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(rightEyeX + 6, eyeY - 4);
            ctx.lineTo(rightEyeX + 9, eyeY - 6);
            ctx.moveTo(rightEyeX + 7, eyeY);
            ctx.lineTo(rightEyeX + 10, eyeY);
            ctx.moveTo(rightEyeX + 6, eyeY + 4);
            ctx.lineTo(rightEyeX + 9, eyeY + 6);
            ctx.stroke();
          } else {
            // Cute blink curves ⌒ ⌒
            ctx.strokeStyle = COLOR_OUTLINE;
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.arc(leftEyeX, eyeY + 1, 3.5, 0.1, Math.PI - 0.1);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(rightEyeX, eyeY + 1, 3.5, 0.1, Math.PI - 0.1);
            ctx.stroke();
          }
        } else {
          // Round dark brown beady dots
          ctx.fillStyle = COLOR_OUTLINE;
          ctx.beginPath();
          ctx.arc(leftEyeX, eyeY, 2.8, 0, Math.PI * 2);
          ctx.arc(rightEyeX, eyeY, 2.8, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
    }
  }

  private renderParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const alpha = 1 - p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      if (p.text) {
        ctx.font = `${p.size || 14}px sans-serif`;
        ctx.fillStyle = p.color || '#FFFFFF';
        ctx.fillText(p.text, p.x, p.y);
      }
      ctx.restore();
    }
  }
}
