import {glMatrix, quat, vec2, vec3} from "gl-matrix"

export * from "gl-matrix"

export const vec2zero = vec2.create()
export const vec2one = vec2.fromValues(1, 1)

export const vec3zero = vec3.create()
export const vec3unitZ = vec3.fromValues(0, 0, 1)

export const quatIdentity = quat.create()

const toFixedString = (n :number, digits? :number) =>
  digits === undefined ? n.toString() : n.toLocaleString(undefined, {maximumFractionDigits: digits})

/** Converts a number to a string of the form `Sw.f` where `S` is `+` or `-`, optionally rounding
  * to the specified number of decimal digits. */
export const numToString = (n :number, digits? :number) =>
  `${n >= 0 ? "+" : ""}${toFixedString(n, digits)}`

/** Converts a 2D position to a string of the form `Sx.xSy.y`, optionally rounding to the specified
  * number of decimal digits. */
export const posToString = (x :number, y :number, digits? :number) =>
  numToString(x, digits) + numToString(y, digits)

/** Converts a 2D size to a string of the form `WxH`, optionally rounding to the specified number
  * of decimal digits. */
export const sizeToString = (w :number, h :number, digits? :number) =>
  `${toFixedString(w, digits)}x${toFixedString(h, digits)}`

/** Converts a 2D vector to a string of the form `Sx.xSy.y`, optionally rounding to the specified
  * number of decimal digits. */
export const vec2ToString = (v :vec2, digits? :number) => posToString(v[0], v[1])

/** Returns `val` clamped to the range `[min, max]`. */
export const clamp = (val :number, min :number, max :number) => Math.min(Math.max(min, val), max)

/** Converts a value in degrees to radians. */
export const toRadian = glMatrix.toRadian

const radiansToDegrees = 180 / Math.PI

/** Converts a value in radians to degrees. */
export const toDegree = (radians :number) => radians * radiansToDegrees

export class dim2 extends Float32Array {

  static create () :dim2 {
    return new Float32Array(2)
  }

  static fromValues (width :number, height :number) :dim2 {
    return dim2.set(dim2.create(), width, height)
  }

  static set (out :dim2, width :number, height :number) :dim2 {
    out[0] = width
    out[1] = height
    return out
  }

  static copy (out :dim2, src :dim2) :dim2 {
    out[0] = src[0]
    out[1] = src[1]
    return out
  }

  static isEmpty (d :dim2) :boolean {
    return d[0] <= 0 || d[1] <= 0
  }

  static eq (a :dim2, b :dim2) :boolean {
    return a[0] === b[0] && a[1] === b[1]
  }

  static scale (out :dim2, d :dim2, s :number) :dim2 {
    return dim2.set(out, d[0]*s, d[1]*s)
  }

  static ceil (out :dim2, d :dim2) :dim2 {
    out[0] = Math.ceil(d[0])
    out[1] = Math.ceil(d[1])
    return out
  }

  static floor (out :dim2, d :dim2) :dim2 {
    out[0] = Math.floor(d[0])
    out[1] = Math.floor(d[1])
    return out
  }

  static round (out :dim2, src :dim2) :dim2 {
    out[0] = Math.round(src[0])
    out[1] = Math.round(src[1])
    return out
  }

  static toString (d :dim2, digits? :number) :string {
    return sizeToString(d[0], d[1], digits)
  }
}

export class rect extends Float32Array {

  static create () :rect {
    return new Float32Array(4)
  }

  static fromValues (x :number, y :number, width :number, height :number) :rect {
    return rect.set(rect.create(), x, y, width, height)
  }

  static fromPosSize (pos :vec2, size :dim2) :rect {
    return rect.set(rect.create(), pos[0], pos[1], size[0], size[1])
  }

  static set (out :rect, x :number, y :number, width :number, height :number) :rect {
    out[0] = x
    out[1] = y
    out[2] = width
    out[3] = height
    return out
  }

  static clone (src :rect) :rect {
    return rect.copy(rect.create(), src)
  }

  static copy (out :rect, src :rect) :rect {
    out[0] = src[0]
    out[1] = src[1]
    out[2] = src[2]
    out[3] = src[3]
    return out
  }

  static isEmpty (r :rect) :boolean {
    return r[2] <= 0 || r[3] <= 0
  }

  static eq (a :rect, b :rect) :boolean {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
  }

  static pos (r :rect, into = vec2.create()) :vec2 {
    return vec2.set(into, r[0], r[1])
  }

  static size (r :rect, into = dim2.create()) :dim2 {
    return dim2.set(into, r[2], r[3])
  }

  static contains (r :rect, pos :vec2) :boolean {
    const rx = r[0], ry = r[1], rw = r[2], rh = r[3], px = pos[0], py = pos[1]
    return (px >= rx && px <= rx+rw && py >= ry && py <= ry+rh)
  }

  static containsRect (a :rect, b :rect) :boolean {
    const ax = a[0], ay = a[1], bx = b[0], by = b[1]
    return bx >= ax && by >= ay && bx + b[2] <= ax + a[2] && by + b[3] <= ay + a[3]
  }

  static intersects (r1 :rect, r2 :rect) :boolean {
    const x2 = r2[0], y2 = r2[1], w2 = r2[2], h2 = r2[3]
    return rect.intersectsXYWH(r1, x2, y2, w2, h2)
  }

  static intersectsPS (r1 :rect, pos2 :vec2, size2 :dim2) :boolean {
    const x2 = pos2[0], y2 = pos2[1], w2 = size2[0], h2 = size2[1]
    return rect.intersectsXYWH(r1, x2, y2, w2, h2)
  }

  static intersectsXYWH (r :rect, x :number, y :number, w :number, h :number) :boolean {
    if (rect.isEmpty(r)) return false
    const x1 = r[0], y1 = r[1], w1 = r[2], h1 = r[3], x2 = x1+w1, y2 = y1+h1
    return (x+w > x1) && (x < x2) && (y+h > y1) && (y < y2)
  }

  static union (out :rect, a :rect, b :rect) :rect {
    if (rect.isEmpty(a)) return rect.copy(out, b)
    else if (rect.isEmpty(b)) return rect.copy(out, a)
    const ax = a[0], ay = a[1], bx = b[0], by = b[1]
    const x1 = Math.min(ax, bx)
    const y1 = Math.min(ay, by)
    const x2 = Math.max(ax + a[2], bx + b[2])
    const y2 = Math.max(ay + a[3], by + b[3])
    return rect.set(out, x1, y1, x2 - x1, y2 - y1)
  }

  static expand (out :rect, src :rect, amount :number) :rect {
    const amount2 = amount * 2
    return rect.set(out, src[0] - amount, src[1] - amount, src[2] + amount2, src[3] + amount2)
  }

  static zero (out :rect) :rect {
    return rect.set(out, 0, 0, 0, 0)
  }

  static right (r :rect) :number {
    return r[2] + r[0]
  }

  static bottom (r :rect) :number {
    return r[3] + r[1]
  }

  static toString (d :dim2, digits? :number) :string {
    return `${sizeToString(d[3], d[4], digits)}${posToString(d[0], d[1], digits)}`
  }
}

/** A 3D plane. */
export class Plane extends Float32Array {

  private constructor () {
    super(4)
  }

  /** Creates an invalid plane instance (zero normal). */
  static create () :Plane { return new Plane() }

  /** Sets a plane based on the plane normal and a point on the plane.
    * @param out the plane to hold the result.
    * @param normal the plane normal vector.
    * @param point the point on the plane.
    * @return the target plane. */
  static setFromNormalAndCoplanarPoint (out :Plane, normal :vec3, point :vec3) :Plane {
    out[0] = normal[0]
    out[1] = normal[1]
    out[2] = normal[2]
    out[3] = -vec3.dot(normal, point)
    return out
  }

  /** Finds the intersection, if any, between a ray and a plane.
    * @param plane the plane to check against.
    * @param origin the origin of the ray.
    * @param direction the direction of the ray.
    * @return the distance to the intersection, or a negative value/NaN if there isn't one (that is,
    * the result is valid if >= 0). */
  static intersectRay (plane :Plane, origin :vec3, direction :vec3) :number {
    return (-plane[3] - Plane._dot(plane, origin)) / Plane._dot(plane, direction)
  }

  /** Computes the dot product of the plane normal with a point. */
  private static _dot (plane :Plane, point :vec3) {
    return plane[0] * point[0] + plane[1] * point[1] + plane[2] * point[2]
  }
}

/** A set of Euler angles in degrees and XYZ order. */
export class Euler extends Float32Array {

  private constructor () {
    super(3)
  }

  /** Creates a new set of Euler angles set to zero. */
  static create () :Euler { return new Euler() }

  /** Creates a new set of Euler angles from components. */
  static fromValues (x :number, y :number, z :number) :Euler {
    return Euler.set(Euler.create(), x, y, z)
  }

  static set :(out :Euler, x :number, y :number, z :number) => Euler = vec3.set as any

  /** Sets a set of Euler angles from a quaternion. */
  static fromQuat (out :Euler, q :quat) :Euler {
    // https://en.wikipedia.org/wiki/Conversion_between_quaternions_and_Euler_angles#Quaternion_to_Euler_Angles_Conversion
    // (note that on that page, [x, y, z, w] = [q1, q2, q3, q0])
    const q0 = q[3]
    const q1 = q[0]
    const q2 = q[1]
    const q3 = q[2]
    return Euler.set(
      out,
      toDegree(Math.atan2(2 * (q0*q1 + q2*q3), 1 - 2 * (q1*q1 + q2*q2))),
      toDegree(Math.asin(2 * (q0*q2 - q3*q1))),
      toDegree(Math.atan2(2 * (q0*q3 + q1*q2), 1 - 2 * (q2*q2 + q3*q3))),
    )
  }

  /** Rounds the Euler angles to the nearest integer. */
  static round :(out :Euler, a :Euler) => Euler = vec3.round as any

  /** Compares two sets of Euler angles for equality. */
  static equals :(a :Euler, b :Euler) => boolean = vec3.equals as any
}

/** Combines an origin point and a direction vector. */
export class Ray {

  private constructor (readonly origin = vec3.create(), readonly direction = vec3.create()) {}

  /** Creates a new set of Euler angles set to zero.
    * @param [origin] if provided, the origin vector to reference (not copy).
    * @param [direction] if provided, the direction vector to reference (not copy). */
  static create (origin? :vec3, direction? :vec3) :Ray { return new Ray(origin, direction) }

  /** Gets a point along the ray. */
  static getPoint (out :vec3, ray :Ray, distance :number) :vec3 {
    return vec3.scaleAndAdd(out, ray.origin, ray.direction, distance)
  }
}

/** An axis-aligned bounding box. */
export class Bounds {

  private constructor (readonly min = vec3.create(), readonly max = vec3.create()) {}

  /** Creates a new set of bounds set to zero.
    * @param [min] if provided, the min vector to reference (not copy).
    * @param [max] if provided, the max vector to reference (not copy). */
  static create (min? :vec3, max? :vec3) :Bounds { return new Bounds(min, max) }

  /** Clones the provided bounds. */
  static clone (bounds :Bounds) :Bounds {
    return Bounds.create(vec3.clone(bounds.min), vec3.clone(bounds.max))
  }

  /** Sets the bounds to zero. */
  static zero (out :Bounds) :Bounds {
    // @ts-ignore zero does exist on vec3
    vec3.zero(out.min)
    // @ts-ignore ibid
    vec3.zero(out.max)
    return out
  }
}
