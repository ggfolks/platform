import {dim2} from "./math"

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
  /** Returns a new `dim2` containing `size` scaled by this scale factor. */
  scaledDim (size :dim2) :dim2 { return dim2.scale(dim2.create(), size, this.factor) }

  /** Rounds the supplied length to the nearest length that corresponds to an integer pixel length
    * after this scale factor is applied. For example, for a scale factor of 3,
    * `roundToNearestPixel(8.4) == 8.33`, which corresponds to exactly (8.33 * 3) = 25 pixels. */
  roundToNearestPixel (length :number) :number {
    return Math.round(length * this.factor) / this.factor
  }
}
