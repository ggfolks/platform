import {Vector3, Quaternion} from "three"

import {Float32ArrayComponent, ID} from "../entity/entity"

const DefaultTransform = new Float32Array([
  0, 0, 0, // position
  0, 0, 0, 1, // quaternion
  1, 1, 1, // scale
])

// offsets into the transform buffer for our various properties
const PX = 0
const PY = 1
const PZ = 2
const QX = 3
const QY = 4
const QZ = 5
const QW = 6
const SX = 7
const SY = 8
const SZ = 9

const oldValue = new Float32Array(DefaultTransform.length)
const newValue = new Float32Array(DefaultTransform.length)

/** The canonical id of the transform component. */
export const CanonicalTransformId = "trans"

/** A 3D transform for an entity. Includes position, quaternion, and scale. */
export class TransformComponent extends Float32ArrayComponent {

  constructor (id = CanonicalTransformId, batchBits = 8) { super(id, DefaultTransform, batchBits) }

  /** Sets the position of entity `id` to `position`. */
  updatePosition (id :ID, position :Vector3) {
    this.read(id, oldValue)
    const batch = this.batch(id), start = this.start(id)
    batch[start+PX] = position.x
    batch[start+PY] = position.y
    batch[start+PZ] = position.z
    this.read(id, newValue)
    this._noteUpdated(id, newValue, oldValue)
  }

  /** Sets the quaternion of entity `id` to `quaternion`. */
  updateQuaternion (id :ID, quaternion :Quaternion) {
    this.read(id, oldValue)
    const batch = this.batch(id), start = this.start(id)
    batch[start+QX] = quaternion.x
    batch[start+QY] = quaternion.y
    batch[start+QZ] = quaternion.z
    batch[start+QW] = quaternion.w
    this.read(id, newValue)
    this._noteUpdated(id, newValue, oldValue)
  }

  /** Sets the scale of entity `id` to `scale`. */
  updateScale (id :ID, scale :Vector3) {
    this.read(id, oldValue)
    const batch = this.batch(id), start = this.start(id)
    batch[start+SX] = scale.x
    batch[start+SY] = scale.y
    batch[start+SZ] = scale.z
    this.read(id, newValue)
    this._noteUpdated(id, newValue, oldValue)
  }

  /** Copies the position of entity `id` into `into`.
    * @return the supplied `into` vector. */
  readPosition (id :ID, into :Vector3) :Vector3 {
    const batch = this.batch(id), start = this.start(id)
    return into.set(batch[start+PX], batch[start+PY], batch[start+PZ])
  }

  /** Copies the quaternion of entity `id` into `into`.
    * @return the supplied `into` vector. */
  readQuaternion (id :ID, into :Quaternion) :Quaternion {
    const batch = this.batch(id), start = this.start(id)
    return into.set(batch[start+QX], batch[start+QY], batch[start+QZ], batch[start+QW])
  }

  /** Copies the scale of entity `id` into `into`.
    * @return the supplied `into` vector. */
  readScale (id :ID, into :Vector3) :Vector3 {
    const batch = this.batch(id), start = this.start(id)
    return into.set(batch[start+SX], batch[start+SY], batch[start+SZ])
  }
}
