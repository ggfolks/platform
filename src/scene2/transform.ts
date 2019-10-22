import {vec2, mat2d} from "../core/math"
import {Prop, VProp} from "../core/util"

// offsets into the transform buffer for our various properties
// note: these must be kept in sync with entity.ts
const OX = 6
const OY = 7
const TX = 8
const TY = 9
const SX = 10
const SY = 11
const RO  = 12
const DT  = 13

/** Creates a transform array with the supplied initial values. Used to specify initial values for
  * transform components. */
export function makeTransform (ox :number, oy :number, tx :number, ty :number,
                               sx :number, sy :number, rot :number) :Float32Array {
  const trans = Transform.Default.slice(0)
  trans[OX] = ox
  trans[OY] = oy
  trans[TX] = tx
  trans[TY] = ty
  trans[SX] = sx
  trans[SY] = sy
  trans[RO] = rot
  return trans
}

export function updateMatrix (data :Float32Array, offset :number) {
  const ox = data[offset+OX], oy = data[offset+OY]
  const tx = data[offset+TX], ty = data[offset+TY]
  const sx = data[offset+SX], sy = data[offset+SY]
  const rot = data[offset+RO], sina = Math.sin(rot), cosa = Math.cos(rot)
  const sxc = sx * cosa, syc = sy * cosa, sxs = sx * sina, sys = -sy * sina
  data[offset+0] = sxc
  data[offset+1] = sxs
  data[offset+2] = sys
  data[offset+3] = syc
  data[offset+4] = tx - ox*sxc - oy*sys
  data[offset+5] = ty - ox*sxs - oy*syc
  data[offset+DT] = 0
}

export function multiplyMatrix (i :Float32Array, io :number,
                                a :Float32Array, ao :number,
                                b :Float32Array, bo :number) {
  const a0 = a[ao+0], a1 = a[ao+1], a2 = a[ao+2], a3 = a[ao+3], a4 = a[ao+4], a5 = a[ao+5]
  const b0 = b[bo+0], b1 = b[bo+1], b2 = b[bo+2], b3 = b[bo+3], b4 = b[bo+4], b5 = b[bo+5]
  i[io+0] = a0 * b0 + a2 * b1
  i[io+1] = a1 * b0 + a3 * b1
  i[io+2] = a0 * b2 + a2 * b3
  i[io+3] = a1 * b2 + a3 * b3
  i[io+4] = a0 * b4 + a2 * b5 + a4
  i[io+5] = a1 * b4 + a3 * b5 + a5
}

/** A 2D transform which contains individual components for translation, rotation, scale and origin
  * and a combined transform matrix. When individual components are changed, the transform is marked
  * dirty, and one should call [[updateMatrix]] to recompute the transform matrix from the
  * individual components. */
export class Transform {

  /** An array initialized with the default transform. */
  static Default = new Float32Array([
    1, 0, 0, 1, 0, 0, // mat2d transform
    0, 0, // origin x/y
    0, 0, // translation x/y
    1, 1, // scale x/y
    0, 1, // rotation, dirty
  ])

  constructor (readonly data :Float32Array = Transform.Default.slice()) {}

  get originX () :number { return this.data[OX] }
  get originY () :number { return this.data[OY] }

  get oxProp () :Prop<number> { return this.prop(OX) }
  get oyProp () :Prop<number> { return this.prop(OY) }
  get originProp () :VProp<vec2> { return this.vprop(OX) }

  get tx () :number { return this.data[TX] }
  get ty () :number { return this.data[TY] }

  get txProp () :Prop<number> { return this.prop(TX) }
  get tyProp () :Prop<number> { return this.prop(TY) }
  get translationProp () :VProp<vec2> { return this.vprop(TX) }

  get scaleX () :number { return this.data[SX] }
  get scaleY () :number { return this.data[SY] }

  get scaleXProp () :Prop<number> { return this.prop(SX) }
  get scaleYProp () :Prop<number> { return this.prop(SY) }
  get scaleProp () :VProp<vec2> { return this.vprop(SX) }

  get rotation () :number { return this.data[RO] }
  get rotationProp () :Prop<number> { return this.prop(RO) }

  get dirty () :boolean { return this.data[DT] !== 0 }

  /** Copies the origin of this transform into `into`.
    * @return the supplied `into` vector. */
  readOrigin (into :vec2) :vec2 {
    const data = this.data
    return vec2.set(into, data[OX], data[OY])
  }

  /** Copies the translation this transform into `into`.
    * @return the supplied `into` vector. */
  readTranslation (into :vec2) :vec2 {
    const data = this.data
    return vec2.set(into, data[TX], data[TY])
  }

  /** Copies the scale of this transform into `into`.
    * @return the supplied `into` vector. */
  readScale (into :vec2) :vec2 {
    const data = this.data
    return vec2.set(into, data[SX], data[SY])
  }

  /** Reads the transform matrix for entity `id`. */
  readMatrix (into :mat2d) :mat2d {
    const data = this.data
    into[0] = data[0]
    into[1] = data[1]
    into[2] = data[2]
    into[3] = data[3]
    into[4] = data[4]
    into[5] = data[5]
    return into
  }

  /** Sets the origin to `origin`. */
  updateOrigin (origin :vec2) {
    const data = this.data
    data[OX] = origin[0]
    data[OY] = origin[1]
    data[DT] = 1
  }

  /** Sets the translation to `trans`. */
  updateTranslation (trans :vec2) {
    const data = this.data
    data[TX] = trans[0]
    data[TY] = trans[1]
    data[DT] = 1
  }

  /** Updates the translation to its current value plus `delta` times `scale`.
    * This is commonly used to apply velocity scaled by a time delta. */
  applyDeltaTranslation (delta :vec2, scale :number) {
    const data = this.data
    data[TX] += delta[0]*scale
    data[TY] += delta[1]*scale
    data[DT] = 1
  }

  /** Sets the scale to `scale`. */
  updateScale (scale :vec2) {
    const data = this.data
    data[SX] = scale[0]
    data[SY] = scale[1]
    data[DT] = 1
  }

  /** Sets the rotation to `rot` (in radians). */
  updateRotation (rot :number) {
    const data = this.data
    data[RO] = rot
    data[DT] = 1
  }

  /** Recomputes the transform matrix from the individual components.
    * @param parent an optional parent matrix to pre-multiply to ours. */
  updateMatrix (parent? :Transform) {
    const data = this.data
    updateMatrix(data, 0)
    if (parent) multiplyMatrix(data, 0, parent.data, 0, data, 0)
  }

  /** Performs the inverse of this transform on `point`, storing the result in `into`.
    * @return the vector passed as `into`. */
  inverseTransform (into :vec2, point :vec2) :vec2 {
    const data = this.data
    const m00 = data[0], m01 = data[1], m10 = data[2], m11 = data[3], tx = data[4], ty = data[5]
    const x = point[0] - tx, y = point[1] - ty, det = m00 * m11 - m01 * m10
    // determinant is zero; matrix is not invertible
    if (Math.abs(det) === 0) throw new Error(`Can't invert transform`)
    const rdet = 1 / det
    return vec2.set(into, (x * m11 - y * m10) * rdet, (y * m00 - x * m01) * rdet)
  }

  private prop (field :number) :Prop<number> {
    const data = this.data
    return {
      get current () { return data[field] },
      update (v :number) { data[field] = v ; data[DT] = 1 }
    }
  }

  private vprop (field :number) :VProp<vec2> {
    const data = this.data
    return {
      read (into :vec2) {
        into[0] = data[field]
        into[1] = data[field+1]
        return into
      },
      update (v :vec2) {
        data[field] = v[0]
        data[field+1] = v[1]
        data[DT] = 1
      }
    }
  }
}
