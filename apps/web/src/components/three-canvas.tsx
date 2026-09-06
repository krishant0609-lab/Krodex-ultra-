/**
 * KRODEX Three.js WebGL Background
 *
 * Quantum matrix grid with sine-wave vertex animation,
 * floating holographic crystal, color palette cycling,
 * and mouse-tracking parallax.
 */

'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface StageRef {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  matrixMesh: THREE.Mesh;
  crystalGroup: THREE.Group;
  time: number;
  mouse: { x: number; y: number };
  targetMouse: { x: number; y: number };
}

const PALETTE = [
  { r: 0.902, g: 0.800, b: 0.627 }, // champagne
  { r: 0.220, g: 0.741, b: 0.973 }, // sapphire
  { r: 0.635, g: 0.608, b: 0.996 }, // lavender
  { r: 0.063, g: 0.725, b: 0.510 }, // emerald
];

function lerpColor(a: typeof PALETTE[0], b: typeof PALETTE[0], t: number) {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

export default function THREECanvas() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mountRef.current) return;
    const container = mountRef.current;
    const w = container.clientWidth;
    const h = container.clientHeight;

    /* ── Renderer ────────────────────────────────────── */
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    /* ── Scene & camera ─────────────────────────────── */
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(58, w / h, 0.1, 120);
    camera.position.set(0, 0, 18);

    /* ── Matrix grid ────────────────────────────────── */
    const COLS = 60, ROWS = 38;
    const GAP_X = 0.55, GAP_Y = 0.55;
    const geo = new THREE.BoxGeometry(0.28, 0.28, 0.06, 1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
    const matrixMesh = new THREE.InstancedMesh(geo, mat, COLS * ROWS);
    const dummy = new THREE.Object3D();
    const colOffsets = new Float32Array(COLS * ROWS);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        colOffsets[i] = (Math.random() - 0.5) * Math.PI * 3;
        dummy.position.set(
          (c - COLS / 2) * GAP_X,
          (r - ROWS / 2) * GAP_Y,
          0
        );
        dummy.updateMatrix();
        matrixMesh.setMatrixAt(i, dummy.matrix);
      }
    }
    matrixMesh.instanceMatrix.needsUpdate = true;
    scene.add(matrixMesh);

    /* ── Crystal group ──────────────────────────────── */
    const crystalGroup = new THREE.Group();
    crystalGroup.position.set(0, 0, 2);
    scene.add(crystalGroup);

    const octaGeo = new THREE.OctahedronGeometry(2.2, 2);
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0xe6cca0,
      wireframe: true,
      transparent: true,
      opacity: 0.55,
    });
    const octa = new THREE.Mesh(octaGeo, wireMat);
    crystalGroup.add(octa);

    // Inner solid octa
    const solidMat = new THREE.MeshBasicMaterial({
      color: 0xe6cca0,
      transparent: true,
      opacity: 0.12,
    });
    const solid = new THREE.Mesh(octaGeo, solidMat);
    crystalGroup.add(solid);

    // Orbiting satellite crystals
    const satMat = new THREE.MeshBasicMaterial({
      color: 0xa29bfe,
      transparent: true,
      opacity: 0.7,
    });
    for (let i = 0; i < 4; i++) {
      const sGeo = new THREE.OctahedronGeometry(0.32, 1);
      const s = new THREE.Mesh(sGeo, satMat);
      s.userData.angleOffset = (i / 4) * Math.PI * 2;
      s.userData.radius = 4.5 + i * 0.5;
      s.userData.speed = 0.18 + i * 0.06;
      s.userData.yOffset = (i - 2) * 1.4;
      crystalGroup.add(s);
    }

    /* ── Palette cycling ────────────────────────────── */
    let paletteIndex = 0;
    let paletteMix = 0;
    let lastPaletteTime = 0;
    const PALETTE_DURATION = 2200; // ms

    /* ── Mouse tracking ──────────────────────────────── */
    const mouse = { x: 0, y: 0 };
    const targetMouse = { x: 0, y: 0 };

    const onMouseMove = (e: MouseEvent) => {
      targetMouse.x = (e.clientX / window.innerWidth - 0.5) * 2;
      targetMouse.y = -(e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener('mousemove', onMouseMove, { passive: true });

    /* ── Resize handler ─────────────────────────────── */
    const onResize = () => {
      const nw = container.clientWidth;
      const nh = container.clientHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener('resize', onResize);

    /* ── Stage ref ─────────────────────────────────── */
    const stageRef: StageRef = {
      scene,
      camera,
      renderer,
      matrixMesh,
      crystalGroup,
      time: 0,
      mouse,
      targetMouse,
    };

    /* ── Animation loop ─────────────────────────────── */
    let rafId: number;
    let lastTime = 0;

    const animate = (now: number) => {
      rafId = requestAnimationFrame(animate);
      const delta = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      const t = now * 0.001;
      stageRef.time = t;

      // Smooth mouse
      mouse.x += (targetMouse.x - mouse.x) * 0.04;
      mouse.y += (targetMouse.y - mouse.y) * 0.04;

      // Palette cycling
      if (now - lastPaletteTime > PALETTE_DURATION) {
        paletteIndex = (paletteIndex + 1) % PALETTE.length;
        lastPaletteTime = now;
        paletteMix = 0;
      }
      paletteMix = Math.min(1, paletteMix + delta * 0.9);
      const nextIdx = (paletteIndex + 1) % PALETTE.length;
      const col = lerpColor(PALETTE[paletteIndex]!, PALETTE[nextIdx]!, paletteMix);

      // Sync to CSS
      document.documentElement.style.setProperty(
        '--accent-1',
        `${(col.r * 255) | 0}, ${(col.g * 255) | 0}, ${(col.b * 255) | 0}`
      );
      document.documentElement.style.setProperty(
        '--accent-2',
        `${(PALETTE[(paletteIndex + 2) % PALETTE.length]!.r * 255) | 0}, ${(PALETTE[(paletteIndex + 2) % PALETTE.length]!.g * 255) | 0}, ${(PALETTE[(paletteIndex + 2) % PALETTE.length]!.b * 255) | 0}`
      );

      // Matrix grid sine-wave vertex animation
      const im = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const i = r * COLS + c;
          matrixMesh.getMatrixAt(i, im);
          im.decompose(pos, quat, scl);

          const wave =
            Math.sin(pos.x * 0.55 + t * 0.9 + colOffsets[i]!) * 0.18 +
            Math.sin(pos.y * 0.45 + t * 0.7 + colOffsets[i]! * 1.3) * 0.14;

          pos.z = wave;
          // Color: fade based on wave amplitude
          const intensity = 0.22 + Math.abs(wave) * 2.5;
          const cr = col.r * intensity;
          const cg = col.g * intensity;
          const cb = col.b * intensity;
          matrixMesh.setColorAt(
            i,
            new THREE.Color(cr, cg, cb)
          );

          im.compose(pos, quat, scl);
          matrixMesh.setMatrixAt(i, im);
        }
      }
      matrixMesh.instanceMatrix.needsUpdate = true;
      if (matrixMesh.instanceColor) matrixMesh.instanceColor.needsUpdate = true;

      // Crystal rotation + mouse parallax
      const lerpFactor = 0.04;
      const targetRX = mouse.y * 0.22;
      const targetRY = -mouse.x * 0.28;
      crystalGroup.rotation.x += (targetRX - crystalGroup.rotation.x) * lerpFactor;
      crystalGroup.rotation.y += (targetRY + t * 0.09 - crystalGroup.rotation.y) * lerpFactor;

      // Satellite orbits
      crystalGroup.children.forEach((child, idx) => {
        if (idx === 0 || idx === 1) return; // skip main octa
        const s = child as THREE.Mesh;
        const { angleOffset, radius, speed, yOffset } = s.userData;
        const angle = angleOffset + t * speed;
        s.position.set(
          Math.cos(angle) * radius,
          yOffset + Math.sin(t * 0.4 + angleOffset) * 0.8,
          Math.sin(angle) * radius
        );
        s.rotation.x = t * 0.5;
        s.rotation.z = t * 0.3;
      });

      // Wireframe hue cycling
      const wireColor = new THREE.Color(col.r, col.g, col.b);
      (crystalGroup.children[0] as THREE.Mesh).material = new THREE.MeshBasicMaterial({
        color: wireColor,
        wireframe: true,
        transparent: true,
        opacity: 0.5,
      });
      (crystalGroup.children[1] as THREE.Mesh).material = new THREE.MeshBasicMaterial({
        color: wireColor,
        transparent: true,
        opacity: 0.1,
      });

      // Camera subtle parallax
      camera.position.x += (mouse.x * 1.8 - camera.position.x) * 0.025;
      camera.position.y += (mouse.y * 1.2 - camera.position.y) * 0.025;
      camera.lookAt(scene.position);

      renderer.render(scene, camera);
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={mountRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    />
  );
}
