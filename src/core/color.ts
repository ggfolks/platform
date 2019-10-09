import {clamp} from "./math"

/** Represents a color as a set of ARGB channels. We extend Float32Array so that we can distinguish
  * between colors and quaternions (both four-element arrays). */
export class Color extends Float32Array {

  private constructor () {
    super(4)
  }

  /** Creates a color instance with all channels initialized to `0`. */
  static create () :Color { return new Color() }

  /** Creates a color from the supplied RGB channels (in `[0, 1]`) and full alpha. */
  static fromRGB (r :number, g :number, b :number) :Color { return Color.fromARGB(1, r, g, b) }

  /** Creates a color from the supplied ARGB channels (in `[0, 1]`). */
  static fromARGB (a :number, r :number, g :number, b :number) :Color {
    return Color.setARGB(Color.create(), a, r, g, b)
  }

  /** Creates a color from the supplied HSV values and full alpha. */
  static fromHSV (h :number, s :number, v :number) :Color { return Color.fromAHSV(1, h, s, v) }

  /** Creates a color from the supplied HSV values and A channel. */
  static fromAHSV (a :number, h :number, s :number, v :number) :Color {
    return Color.setAHSV(Color.create(), a, h, s, v)
  }

  /** Copies color `c` into `into`.
    * @return the supplied color `into`. */
  static copy (into :Color, c :Color) :Color {
    into[0] = c[0]
    into[1] = c[1]
    into[2] = c[2]
    into[3] = c[3]
    return into
  }

  /** Combines color `c` with `into`, storing the result in `into`.
    * @return the supplied color `into`. */
  static combine (into :Color, c :Color) :Color {
    into[0] = into[0] * c[0]
    into[1] = into[1] * c[1]
    into[2] = into[2] * c[2]
    into[3] = into[3] * c[3]
    return into
  }

  /** Linearly interpolates between `a` and `b`, storing the result in `into`.
    * @return the supplied color `into`. */
  static lerp (into :Color, a :Color, b :Color, t :number) :Color {
    const ct = 1 - t
    into[0] = a[0] * ct + b[0] * t
    into[1] = a[1] * ct + b[1] * t
    into[2] = a[2] * ct + b[2] * t
    into[3] = a[3] * ct + b[3] * t
    return into
  }

  /** Sets the `r, g, b` channels of `c` to the supplied values. The `a` channel is unchanged.
    * @return the supplied color `c`. */
  static setRGB (c :Color, r :number, g :number, b :number) :Color {
    return Color.setARGB(c, c[0], r, g, b) }

  /** Sets the `a, r, g, b` channels of `c` to the supplied values.
    * @return the supplied color `c`. */
  static setARGB (c :Color, a :number, r :number, g :number, b :number) :Color {
    c[0] = clamp(a, 0, 1)
    c[1] = clamp(r, 0, 1)
    c[2] = clamp(g, 0, 1)
    c[3] = clamp(b, 0, 1)
    return c
  }

  /** Converts `h, s, v` to `r, g, b` and sets `c` with those channel values. The `a` channel is
    * unchanged.
    * @return the supplied color `c`. */
  static setHSV (c :Color, h :number, s :number, v :number) :Color {
    return Color.setAHSV(c, c[0], h, s, v) }

  /** Converts `h, s, v` to `r, g, b` and sets `c` with those channel values and the supplied `a`
    * channel.
    * @return the supplied color `c`. */
  static setAHSV (c :Color, a :number, h :number, s :number, v :number) :Color {
    if (s <= 0) return Color.setARGB(c, a, v, v, v)

    const min = (h > 360 ? 0 : h) / 60
    const imin = Math.round(min)
    const frac = imin - min

    const p = v * (1 - s)
    const q = v * (1 - (s * frac))
    const t = v * (1 - (s * (1 - frac)))

    switch (imin) {
    case 0: return Color.setARGB(c, a, v, t, p)
    case 1: return Color.setARGB(c, a, q, v, p)
    case 2: return Color.setARGB(c, a, p, v, t)
    case 3: return Color.setARGB(c, a, p, q, v)
    case 4: return Color.setARGB(c, a, t, p, v)
    default:
    case 5: return Color.setARGB(c, a, v, p, q)
    }
  }

  // TODO: toHex, fromHex, toIntARGB, fromIntARGB

  /** Combines the `a` and `r` channels of this color into a 16-bit value `0xAR`. `A` is the `a`
    * channel scaled to `[0, 255]` and `R` is the `r` channel scaled to `[0, 255]`. Used for
    * shaders. */
  static toAR (c :Color) :number {
    return Math.round(c[0]*255)*256 + Math.round(c[1]*255)
  }

  /** Combines the `g` and `b` channels of this color into a 16-bit value `0xGB`. `G` is the `g`
    * channel scaled to `[0, 255]` and `B` is the `b` channel scaled to `[0, 255]`. Used for
    * shaders. */
  static toGB (c :Color) :number {
    return Math.round(c[2]*255)*256 + Math.round(c[3]*255)
  }

  /** Returns a CSS color description based on `c`. Uses the `rgba()` CSS function. */
  static toCSS (c :Color) :string {
    const a = c[0], r = c[1], g = c[2], b = c[3]
    return `rgba(${Math.round(r*255)}, ${Math.round(g*255)}, ${Math.round(b*255)}, ${a})`
  }
}
