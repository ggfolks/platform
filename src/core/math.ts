import {vec2} from "gl-matrix"

export * from "gl-matrix"

export const vec2zero = vec2.create()
export const vec2one = vec2.fromValues(1, 1)

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

  static toString (d :dim2) :string {
    return `${d[0]}x${d[1]}`
  }
}

export class rect extends Float32Array {

  static create () :rect {
    return new Float32Array(4)
  }

  static fromValues (x :number, y :number, width :number, height :number) :rect {
    return rect.set(rect.create(), x, y, width, height)
  }

  static set (out :rect, x :number, y :number, width :number, height :number) :rect {
    out[0] = x
    out[1] = y
    out[2] = width
    out[3] = height
    return out
  }

  static isEmpty (r :rect) :boolean {
    return r[2] <= 0 || r[3] <= 0
  }

  static eq (a :rect, b :rect) :boolean {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
  }

  static pos (r :rect) :vec2 {
    return vec2.fromValues(r[0], r[1])
  }

  static size (r :rect) :dim2 {
    return dim2.fromValues(r[2], r[3])
  }

  static intersects (r1 :rect, r2 :rect) :boolean {
    const [x2, y2, w2, h2] = r2
    return rect.intersectsXYWH(r1, x2, y2, w2, h2)
  }

  static intersectsPS (r1 :rect, pos2 :vec2, size2 :dim2) :boolean {
    const [x2, y2] = pos2, [w2, h2] = size2
    return rect.intersectsXYWH(r1, x2, y2, w2, h2)
  }

  static intersectsXYWH (r :rect, x :number, y :number, w :number, h :number) :boolean {
    if (rect.isEmpty(r)) return false
    const [x1, y1, w1, h1] = r, x2 = x1+w1, y2 = y1+h1
    return (x+w > x1) && (x < x2) && (y+h > y1) && (y < y2)
  }

  static right (r :rect) :number {
    return r[2] + r[0]
  }

  static bottom (r :rect) :number {
    return r[3] + r[1]
  }

  static toString (d :dim2) :string {
    const [x, y] = d, pre = (x :number) => x<0 ? "" : "+"
    return `${d[3]}x${d[4]}${pre(x)}${x}${pre(y)}${y}`
  }
}

export function clamp (val :number, min :number, max :number) {
  return Math.min(Math.max(min, val), max)
}
