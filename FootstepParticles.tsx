import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export interface FootstepParticleSpawnOptions {
  position: THREE.Vector3;
  normal?: THREE.Vector3;
  slopeFactor?: number;
}

export interface FootstepParticlesHandle {
  spawn: (options: FootstepParticleSpawnOptions) => void;
}

const MAX_PARTICLES = 48;
const PARTICLE_LIFETIME = 0.45;

export const FootstepParticles = forwardRef<FootstepParticlesHandle>(
  (_, ref) => {
    const groupRef = useRef<THREE.Group>(null);
    const spritesRef = useRef<THREE.Sprite[]>([]);
    const velocitiesRef = useRef<Array<THREE.Vector3>>([]);
    const lifetimesRef = useRef(new Float32Array(MAX_PARTICLES));
    const initialScalesRef = useRef(new Float32Array(MAX_PARTICLES));
    const activeRef = useRef<boolean[]>(Array(MAX_PARTICLES).fill(false));
    const cursorRef = useRef(0);

    const texture = useMemo(() => {
      const size = 128;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (context) {
        const gradient = context.createRadialGradient(
          size / 2,
          size / 2,
          size * 0.15,
          size / 2,
          size / 2,
          size * 0.5
        );
        gradient.addColorStop(0, "rgba(255,255,255,0.7)");
        gradient.addColorStop(0.4, "rgba(255,255,255,0.35)");
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, size, size);
      }
      const tex = new THREE.CanvasTexture(canvas);
      if ("encoding" in tex && "sRGBEncoding" in THREE) {
        (tex as any).encoding = (THREE as any).sRGBEncoding;
      }
      tex.needsUpdate = true;
      return tex;
    }, []);

    const baseMaterial = useMemo(() => {
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      return material;
    }, [texture]);

    useEffect(() => {
      if (!groupRef.current) {
        return;
      }

      for (let i = 0; i < MAX_PARTICLES; i += 1) {
        const material = baseMaterial.clone();
        material.opacity = 0;
        const sprite = new THREE.Sprite(material);
        sprite.visible = false;
        sprite.scale.setScalar(0.1);
        groupRef.current.add(sprite);
        spritesRef.current[i] = sprite;
        velocitiesRef.current[i] = new THREE.Vector3();
      }

      return () => {
        spritesRef.current.forEach((sprite) => {
          if (sprite.material) {
            (sprite.material as THREE.Material).dispose();
          }
          sprite.removeFromParent();
        });
        spritesRef.current = [];
        texture.dispose();
      };
    }, [baseMaterial, texture]);

    useImperativeHandle(
      ref,
      () => ({
        spawn: ({ position, normal, slopeFactor = 0 }) => {
          if (!groupRef.current || spritesRef.current.length === 0) {
            return;
          }

          const index = cursorRef.current;
          cursorRef.current = (cursorRef.current + 1) % MAX_PARTICLES;

          const sprite = spritesRef.current[index];
          const velocity = velocitiesRef.current[index];

          if (!sprite || !velocity) {
            return;
          }

          sprite.visible = true;
          sprite.position.copy(position);

          const up =
            normal && normal.lengthSq() > 0 ? normal.clone() : undefined;
          const lateralStrength = THREE.MathUtils.lerp(0.4, 1.1, slopeFactor);
          const upwardStrength = THREE.MathUtils.lerp(
            0.55,
            0.8,
            1 - slopeFactor
          );

          const randomDir = new THREE.Vector3(
            Math.random() - 0.5,
            0,
            Math.random() - 0.5
          )
            .normalize()
            .multiplyScalar(0.25 + Math.random() * 0.45);

          velocity.copy(randomDir).multiplyScalar(lateralStrength);

          if (up) {
            const upward = up.clone().multiplyScalar(upwardStrength);
            velocity.add(upward);
          } else {
            velocity.y += upwardStrength;
          }

          lifetimesRef.current[index] = PARTICLE_LIFETIME;
          const initialScale = 0.35 + Math.random() * 0.2;
          initialScalesRef.current[index] = initialScale;
          sprite.scale.setScalar(initialScale);

          const material = sprite.material as THREE.SpriteMaterial;
          material.opacity = 0.55;
          activeRef.current[index] = true;
        },
      }),
      []
    );

    useFrame((_, delta) => {
      if (!groupRef.current) {
        return;
      }

      const sprites = spritesRef.current;
      const lifetimes = lifetimesRef.current;
      const velocities = velocitiesRef.current;
      const initialScales = initialScalesRef.current;
      const active = activeRef.current;

      for (let i = 0; i < MAX_PARTICLES; i += 1) {
        if (!active[i]) continue;

        lifetimes[i] -= delta;

        const sprite = sprites[i];
        const velocity = velocities[i];

        if (!sprite || !velocity) continue;

        if (lifetimes[i] <= 0) {
          sprite.visible = false;
          active[i] = false;
          const material = sprite.material as THREE.SpriteMaterial;
          material.opacity = 0;
          continue;
        }

        sprite.position.addScaledVector(velocity, delta);
        velocity.multiplyScalar(0.84);

        const t = lifetimes[i] / PARTICLE_LIFETIME;
        const baseScale = initialScales[i];
        const currentScale = baseScale * (1 + (1 - t) * 0.45);
        sprite.scale.setScalar(currentScale);

        const material = sprite.material as THREE.SpriteMaterial;
        material.opacity = 0.55 * Math.pow(t, 0.6);
      }
    });

    return <group ref={groupRef} />;
  }
);

FootstepParticles.displayName = "FootstepParticles";
