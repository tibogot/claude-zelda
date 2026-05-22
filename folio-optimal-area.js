/**
 * Port of folio View optimal-area ground footprint (for rain / leaves follow).
 */
import * as THREE from "three/webgpu";

const _floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _raycaster = new THREE.Raycaster();
const _near = new THREE.Vector3();
const _far = new THREE.Vector3();
const _ndc = new THREE.Vector2();

/**
 * @param {THREE.PerspectiveCamera} camera
 * @param {THREE.Vector3} [focusXZ] optional focus offset (folio focusPoint)
 */
export function computeOptimalArea(camera, focusXZ = null) {
  const savedPosition = camera.position.clone();
  const savedQuaternion = camera.quaternion.clone();

  _raycaster.setFromCamera(new THREE.Vector2(1, -1), camera);
  _raycaster.ray.intersectPlane(_floorPlane, _near);
  const q0 = { x: _near.x, z: _near.z };

  _raycaster.setFromCamera(new THREE.Vector2(-1, 1), camera);
  _raycaster.ray.intersectPlane(_floorPlane, _far);
  const q2 = { x: _far.x, z: _far.z };

  const centerA = {
    x: (q0.x + q2.x) * 0.5,
    z: (q0.z + q2.z) * 0.5,
  };

  _raycaster.setFromCamera(new THREE.Vector2(-1, -1), camera);
  _raycaster.ray.intersectPlane(_floorPlane, _near);
  const q3 = { x: _near.x, z: _near.z };

  _raycaster.setFromCamera(new THREE.Vector2(1, 1), camera);
  _raycaster.ray.intersectPlane(_floorPlane, _far);
  const q1 = { x: _far.x, z: _far.z };

  const centerB = {
    x: (q3.x + q1.x) * 0.5,
    z: (q3.z + q1.z) * 0.5,
  };

  const basePosition = new THREE.Vector3(
    (centerA.x + centerB.x) * 0.5,
    0,
    (centerA.z + centerB.z) * 0.5
  );

  const radius = basePosition.distanceTo(_far);

  camera.position.copy(savedPosition);
  camera.quaternion.copy(savedQuaternion);

  const position = basePosition.clone();
  if (focusXZ) {
    position.x += focusXZ.x;
    position.z += focusXZ.z;
  }

  return { basePosition, position, radius };
}
