"use client";

import { useEffect, useRef } from "react";

/**
 * The app's ambient background, for real — a WebGL scene (three.js), not a
 * handful of blurred CSS circles. Replaces `.sl-glows` (globals.css still
 * has the dark-mode-only version of that effect; this runs, visibly, in
 * both themes).
 *
 * A handful of floating brand-colored shapes (icosahedron, torus, octahedron)
 * that slowly tumble, drift, and lean gently toward the cursor — nothing
 * clickable sits behind them (`pointer-events: none`), so this never
 * competes with the real UI, only sits behind it.
 *
 * Imperative three.js, not @react-three/fiber: one `useEffect` owns the
 * whole scene's lifetime (create → animate → dispose), which is the plain,
 * version-agnostic way to drop a WebGL scene into a React tree without
 * pinning to a renderer library's own React-version support.
 */
export function Scene3D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let disposed = false;
    let frameId = 0;
    let pointerX = 0;
    let pointerY = 0;

    // Dynamic import: three.js never needs to be in the server bundle, and
    // every caller of this component is already "use client".
    import("three").then((THREE) => {
      if (disposed) return;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(
        45,
        window.innerWidth / window.innerHeight,
        0.1,
        100
      );
      camera.position.z = 11;

      const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);

      scene.add(new THREE.AmbientLight(0xffffff, 0.7));
      const key = new THREE.DirectionalLight(0xffb199, 1.2);
      key.position.set(4, 6, 8);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0x1c4e4a, 1);
      rim.position.set(-6, -3, -4);
      scene.add(rim);

      // Brand palette (docs/decisions/design-decisions.md's coral/teal/cream),
      // each shape a different geometry so the set reads as varied, not
      // repeated.
      const specs = [
        {
          geometry: new THREE.IcosahedronGeometry(1.5, 0),
          color: 0xffb199,
          position: [-4.2, 1.6, -2] as const,
          scale: 1,
        },
        {
          geometry: new THREE.TorusGeometry(1.1, 0.4, 16, 48),
          color: 0x1c6a62,
          position: [4.6, -1.2, -3] as const,
          scale: 1,
        },
        {
          geometry: new THREE.OctahedronGeometry(1.2, 0),
          color: 0xffede3,
          position: [2.4, 2.6, -4] as const,
          scale: 0.9,
        },
        {
          geometry: new THREE.IcosahedronGeometry(0.9, 1),
          color: 0xff8a61,
          position: [-3, -2.4, -3.5] as const,
          scale: 0.8,
        },
      ];

      const meshes = specs.map((spec) => {
        const material = new THREE.MeshStandardMaterial({
          color: spec.color,
          roughness: 0.35,
          metalness: 0.15,
          transparent: true,
          opacity: 0.85,
        });
        const mesh = new THREE.Mesh(spec.geometry, material);
        mesh.position.set(spec.position[0], spec.position[1], spec.position[2]);
        mesh.scale.setScalar(spec.scale);
        scene.add(mesh);
        return mesh;
      });

      function resize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
      }
      window.addEventListener("resize", resize);

      function handlePointer(event: PointerEvent) {
        pointerX = (event.clientX / window.innerWidth) * 2 - 1;
        pointerY = (event.clientY / window.innerHeight) * 2 - 1;
      }
      window.addEventListener("pointermove", handlePointer);

      const clock = new THREE.Clock();

      function renderOnce() {
        renderer.render(scene, camera);
      }

      function tick() {
        const t = clock.getElapsedTime();
        meshes.forEach((mesh, i) => {
          mesh.rotation.x = t * (0.08 + i * 0.015);
          mesh.rotation.y = t * (0.1 + i * 0.02);
          mesh.position.y += Math.sin(t * 0.6 + i) * 0.0015;
        });
        // A gentle parallax lean toward the cursor, camera-side so it reads
        // as depth rather than moving the shapes themselves.
        camera.position.x += (pointerX * 1.2 - camera.position.x) * 0.02;
        camera.position.y += (-pointerY * 0.8 - camera.position.y) * 0.02;
        camera.lookAt(0, 0, 0);

        renderOnce();
        frameId = requestAnimationFrame(tick);
      }

      if (reduceMotion) {
        renderOnce();
      } else {
        tick();
      }

      canvas.dataset.ready = "true";

      // Stashed on the element so the outer cleanup (outside this async
      // callback) can reach everything created in here.
      (canvas as HTMLCanvasElement & { __scene3d?: () => void }).__scene3d =
        () => {
          cancelAnimationFrame(frameId);
          window.removeEventListener("resize", resize);
          window.removeEventListener("pointermove", handlePointer);
          meshes.forEach((mesh) => {
            mesh.geometry.dispose();
            (mesh.material as InstanceType<typeof THREE.Material>).dispose();
          });
          renderer.dispose();
        };
    });

    return () => {
      disposed = true;
      (canvas as HTMLCanvasElement & { __scene3d?: () => void }).__scene3d?.();
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="sl-scene3d" />;
}
