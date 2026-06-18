import * as THREE from "three";

/**
 * Authored parkour geometry for the character physics lab.
 * Returns every mesh that should be baked into the collision BVH.
 *
 * @param {THREE.Scene} scene
 * @returns {THREE.Mesh[]}
 */
export function buildParkourCourse(scene) {
  const collidables = [];
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x6f8f5a,
    roughness: 0.95,
    metalness: 0,
  });

  function addColliderMesh(mesh) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.updateMatrixWorld(true);
    scene.add(mesh);
    collidables.push(mesh);
    return mesh;
  }

  function addGroundMesh(w, l, y, color = 0x6f8f5a) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.2, l),
      groundMat.clone(),
    );
    mesh.material.color.setHex(color);
    mesh.position.set(0, y - 0.1, 0);
    mesh.receiveShadow = true;
    scene.add(mesh);
    collidables.push(mesh);
    return mesh;
  }

  function addPlatform({ x, z, w, l, h = 0.25, y = 0, color = 0x6f8f5a }) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, l),
      groundMat.clone(),
    );
    mesh.material.color.setHex(color);
    mesh.position.set(x, y + h * 0.5, z);
    return addColliderMesh(mesh);
  }

  function addStep({ x, z, w, h, l, color = 0x5a7048 }) {
    const hw = w * 0.5;
    const hl = l * 0.5;
    const topY = h;
    const frontZ = z - hl;

    const visual = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, l),
      groundMat.clone(),
    );
    visual.material.color.setHex(color);
    visual.castShadow = true;
    visual.receiveShadow = true;
    visual.position.set(x, h * 0.5, z);
    scene.add(visual);

    const topPositions = new Float32Array([
      x - hw, topY, z - hl,
      x + hw, topY, z - hl,
      x + hw, topY, z + hl,
      x - hw, topY, z + hl,
    ]);
    const topGeo = new THREE.BufferGeometry();
    topGeo.setAttribute("position", new THREE.BufferAttribute(topPositions, 3));
    topGeo.setIndex([0, 1, 2, 0, 2, 3]);
    topGeo.computeVertexNormals();
    addColliderMesh(
      new THREE.Mesh(topGeo, new THREE.MeshStandardMaterial({ visible: false })),
    );

    // Front riser blocks walking through the tread at ground level.
    const riserPositions = new Float32Array([
      x - hw, 0, frontZ,
      x + hw, 0, frontZ,
      x + hw, topY, frontZ,
      x - hw, topY, frontZ,
    ]);
    const riserGeo = new THREE.BufferGeometry();
    riserGeo.setAttribute("position", new THREE.BufferAttribute(riserPositions, 3));
    riserGeo.setIndex([0, 1, 2, 0, 2, 3]);
    riserGeo.computeVertexNormals();
    const riser = new THREE.Mesh(
      riserGeo,
      new THREE.MeshStandardMaterial({ visible: false }),
    );
    riser.visible = false;
    return addColliderMesh(riser);
  }

  const RAMP_THICKNESS = 0.28;
  const _corner = new THREE.Vector3();

  function addRamp({ x, z, w, l, angleDeg, y = 0, color = 0x7a9060 }) {
    const angle = THREE.MathUtils.degToRad(angleDeg);
    const hw = w * 0.5;
    const hh = RAMP_THICKNESS * 0.5;
    const hl = l * 0.5;

    // Shared pivot so collision top-face matches the visible box exactly.
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    pivot.rotation.x = -angle;
    scene.add(pivot);

    const visual = new THREE.Mesh(
      new THREE.BoxGeometry(w, RAMP_THICKNESS, l),
      groundMat.clone(),
    );
    visual.material.color.setHex(color);
    visual.castShadow = true;
    visual.receiveShadow = true;
    pivot.add(visual);

    pivot.updateMatrixWorld(true);
    const wm = pivot.matrixWorld;
    const localCorners = [
      [-hw, hh, -hl],
      [hw, hh, -hl],
      [hw, hh, hl],
      [-hw, hh, hl],
    ];
    const positions = new Float32Array(localCorners.length * 3);
    for (let i = 0; i < localCorners.length; i++) {
      const [lx, ly, lz] = localCorners[i];
      _corner.set(lx, ly, lz).applyMatrix4(wm);
      positions[i * 3] = _corner.x;
      positions[i * 3 + 1] = _corner.y;
      positions[i * 3 + 2] = _corner.z;
    }

    const colliderGeo = new THREE.BufferGeometry();
    colliderGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    colliderGeo.setIndex([0, 1, 2, 0, 2, 3]);
    colliderGeo.computeVertexNormals();

    const collider = new THREE.Mesh(
      colliderGeo,
      new THREE.MeshStandardMaterial({ visible: false }),
    );
    collider.visible = false;
    addColliderMesh(collider);

    return collider;
  }

  function addWall({ x, z, w, h, l, color = 0x804040 }) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, l),
      new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
    );
    mesh.position.set(x, h * 0.5, z);
    return addColliderMesh(mesh);
  }

  addGroundMesh(88, 88, 0, 0x4d5c44);
  addPlatform({ x: 0, z: 0, w: 18, l: 18, h: 0.15, color: 0x8a9a7a });

  // Crouch bar — underside at 1.85 over the plaza (~1.7 clearance above feet).
  // Standing capsule is blocked; crouch to pass under. Two legs so it reads as
  // a gate (legs sit outside the 8-wide walkway).
  addPlatform({ x: 0, z: -6, w: 9, l: 1.0, h: 0.35, y: 1.85, color: 0x9a5a5a });
  addWall({ x: -4.7, z: -6, w: 0.3, h: 1.85, l: 1.0, color: 0x7a4a4a });
  addWall({ x: 4.7, z: -6, w: 0.3, h: 1.85, l: 1.0, color: 0x7a4a4a });

  // Climbable staircase — rise 0.25 (< CAP_R) so the baseline ground-ray
  // step-up handles it without autostep. Tread depth (l=1.5) overlaps the step
  // spacing (1.35) so treads are CONTIGUOUS — gaps would break the ground ray.
  for (let i = 0; i < 10; i++) {
    addStep({
      x: 0,
      z: 11 + i * 1.35,
      w: 7,
      h: 0.25 * (i + 1),
      l: 1.5,
      color: 0x4a6340 + i * 0x020202,
    });
  }
  addPlatform({ x: 0, z: 28, w: 10, l: 8, h: 0.35, y: 3.2, color: 0x6a7f58 });
  addPlatform({ x: 0, z: 36, w: 8, l: 6, h: 0.4, y: 4.8, color: 0x7a9068 });
  addRamp({ x: 8, z: 32, w: 4, l: 10, angleDeg: 28, y: 2.2, color: 0x708060 });

  const eastPads = [
    { x: 14, z: -4, y: 0, w: 3.5, l: 3.5 },
    { x: 18, z: 2, y: 0.8, w: 3, l: 3 },
    { x: 14, z: 8, y: 1.6, w: 3, l: 3 },
    { x: 20, z: 14, y: 2.4, w: 2.8, l: 2.8 },
    { x: 15, z: 20, y: 3.2, w: 2.6, l: 2.6 },
    { x: 22, z: 26, y: 4, w: 2.5, l: 2.5 },
  ];
  for (const pad of eastPads) {
    addPlatform({
      x: pad.x,
      z: pad.z,
      w: pad.w,
      l: pad.l,
      h: 0.35,
      y: pad.y,
      color: 0x5c7a9a,
    });
  }

  addPlatform({ x: -16, z: -2, w: 2, l: 14, h: 0.2, y: 1.2, color: 0x9a7a5c });
  for (let i = 0; i < 6; i++) {
    addPlatform({
      x: -20 - (i % 2) * 2.5,
      z: 4 + i * 3.5,
      w: 2.2,
      l: 2.2,
      h: 0.3,
      y: 0.4 + i * 0.55,
      color: 0x8a6a4a,
    });
  }

  addRamp({ x: -6, z: -14, w: 5, l: 7, angleDeg: 18, color: 0x6a8060 });
  addRamp({ x: 6, z: -16, w: 5, l: 8, angleDeg: 24, color: 0x6a8060 });
  addWall({ x: -10, z: -10, w: 0.35, h: 2.5, l: 6, color: 0x705050 });
  addWall({ x: 10, z: -12, w: 0.35, h: 3, l: 7, color: 0x705050 });

  addPlatform({ x: 0, z: 22, w: 5, l: 2.5, h: 0.3, y: 2.8, color: 0x7a8a6a });
  addPlatform({ x: 0, z: 31, w: 5, l: 2.5, h: 0.3, y: 2.8, color: 0x7a8a6a });
  addPlatform({ x: 0, z: 26.5, w: 6, l: 4, h: 0.15, y: -1.2, color: 0x3a4038 });

  addWall({ x: 28, z: 8, w: 0.5, h: 4, l: 24, color: 0x604848 });
  addWall({ x: 5, z: 5, w: 0.12, h: 2.8, l: 4, color: 0x606878 });

  addWall({ x: -8, z: 16, w: 5, h: 0.35, l: 0.35, color: 0x505860 });
  addWall({ x: -8, z: 20, w: 5, h: 0.35, l: 0.35, color: 0x505860 });
  addWall({ x: -10.2, z: 18, w: 0.35, h: 1.45, l: 4.5, color: 0x505860 });
  addWall({ x: -5.8, z: 18, w: 0.35, h: 1.45, l: 4.5, color: 0x505860 });

  const grid = new THREE.GridHelper(88, 88, 0x223018, 0x33401f);
  grid.position.y = 0.02;
  grid.material.transparent = true;
  grid.material.opacity = 0.22;
  scene.add(grid);

  return collidables;
}

/** Lab respawn markers — press R cycle or pick from UI. */
export const PARKOUR_SPAWNS = [
  { id: "spawn", label: "Spawn plaza", x: 0, y: 2.2, z: 0 },
  { id: "stairs", label: "Stair top", x: 0, y: 4.2, z: 28 },
  { id: "zigzag", label: "East zigzag", x: 22, y: 5.2, z: 26 },
  { id: "beam", label: "Balance beam", x: -16, y: 2.8, z: -2 },
  { id: "tunnel", label: "Low tunnel", x: -8, y: 2.2, z: 15 },
  { id: "gap", label: "Gap jump", x: 0, y: 3.8, z: 22 },
  { id: "crouch", label: "Crouch bar", x: 0, y: 1.0, z: -1.5 },
  { id: "elevator", label: "Elevator", x: -14, y: 1.5, z: -12 },
  { id: "slider", label: "Slider", x: 14, y: 1.5, z: 12 },
];
