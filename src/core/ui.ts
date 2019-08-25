import {dim2, vec2} from "./math"

/** Represents the scale factor for a HiDPI display. Provides methods useful for doing the
  * calculations needed to create scale-independent interfaces. */
export class Scale {

  /** An unscaled (1.0) scale factor singleton. */
  static ONE = new Scale(1)

  /** The inverse of `this` scale. */
  readonly inv :Scale

  constructor (readonly factor :number, _inv? :Scale) {
    if (factor <= 0) throw new Error(`Scale factor must be > 0 (got ${factor}`)
    this.inv = _inv || new Scale(1/factor, this)
  }

  /** Returns `length` scaled by this scale factor. */
  scaled (length :number) :number { return length * this.factor }
  /** Scales `size` by this scale factor, writing the result into `into` or a newly created `dim2`.
    * @return `into` or the newly created `dim2`. */
  scaledDim (size :dim2, into? :dim2) :dim2 {
    return dim2.scale(into || dim2.create(), size, this.factor) }
  /** Scales `size` by this scale factor, writing the result into `into` or a newly created `vec2`.
    * @return `into` or the newly created `vec2`. */
  scaledVec (size :vec2, into? :vec2) :vec2 {
    return vec2.scale(into || vec2.create(), size, this.factor) }

  /** Rounds the supplied length to the nearest length that corresponds to an integer pixel length
    * after this scale factor is applied. For example, for a scale factor of 3,
    * `roundToNearestPixel(8.4) == 8.33`, which corresponds to exactly (8.33 * 3) = 25 pixels. */
  roundToNearestPixel (length :number) :number {
    return Math.round(length * this.factor) / this.factor
  }

  toString() { return `x${this.factor}` }
}

/** Returns a CSS style that represents the specified value. */
export function getValueStyle (value :any) :string {
  switch (typeof value) {
    case "boolean":
      return value ? "#C0C0C0" : "#808080"

    case "number":
      const str = getValueStyleComponent(value)
      return `rgb(${str}, ${str}, ${str})`

    case "object":
      // we look for a getStyle function, as used in Three.js Color instances
      if (value.getStyle) return value.getStyle()
  }
  return "#808080"
}

/** Maps a numeric value to a CSS color component string (0-255). */
export function getValueStyleComponent (value :number) :string {
  // atan maps entire number range asymptotically to [-pi/2, pi/2]
  const base = 255 * (Math.atan(value) / Math.PI + 0.5)
  // quantize to six bits to avoid excess redraw
  return String(base & 0xFC)
}
