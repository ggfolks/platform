import {BufferAttribute, BufferGeometry, Math as ThreeMath, Vector3} from "three"

/** Generates a heightfield in the format used by Cannon using a simple diamond-square algorithm. */
export function generateHeightfield (divs :number, scale :number, roughness = 0.7) {
  const dim = 2 ** divs + 1
  const heightfield :Float32Array[] = []
  for (let xx = 0; xx < dim; xx++) {
    heightfield.push(new Float32Array(dim))
  }
  // initial corners
  const max = dim - 1
  heightfield[0][0] = ThreeMath.randFloatSpread(scale)
  heightfield[0][max] = ThreeMath.randFloatSpread(scale)
  heightfield[max][0] = ThreeMath.randFloatSpread(scale)
  heightfield[max][max] = ThreeMath.randFloatSpread(scale)
  for (let ii = divs; ii > 0; ii--) {
    // decrease the scale on each iteration
    scale *= roughness

    const size = 2 ** ii
    const halfSize = size / 2

    // diamond step
    for (let xx = 0; xx < max; xx += size) {
      for (let yy = 0; yy < max; yy += size) {
        const sum =
          heightfield[xx][yy] +
          heightfield[xx][yy + size] +
          heightfield[xx + size][yy] +
          heightfield[xx + size][yy + size]
        heightfield[xx + halfSize][yy + halfSize] = sum * 0.25 + ThreeMath.randFloatSpread(scale)
      }
    }

    // square step
    let odd = false
    for (let xx = -halfSize; xx < max; xx += halfSize) {
      for (let yy = odd ? -halfSize : 0; yy < max; yy += size) {
        let sum = 0
        let count = 0
        if (xx >= 0) {
          sum += heightfield[xx][yy + halfSize]
          count++
        }
        if (xx + size <= max) {
          sum += heightfield[xx + size][yy + halfSize]
          count++
        }
        if (yy >= 0) {
          sum += heightfield[xx + halfSize][yy]
          count++
        }
        if (yy + size <= max) {
          sum += heightfield[xx + halfSize][yy + size]
          count++
        }
        heightfield[xx + halfSize][yy + halfSize] = sum / count + ThreeMath.randFloatSpread(scale)
      }
      odd = !odd
    }
  }
  return heightfield
}

/**
 * Creates geometry for the supplied Cannon-style heightfield.
 *
 * @param heightfield the heightfield data.
 * @param elementSize the spacing between heightfield elements on X/Y.
 * @param [normalExaggeration=1] the scale by which to exaggerate the normals.
 */
export function createHeightfieldGeometry (heightfield :Float32Array[],
                                           elementSize :number,
                                           normalExaggeration = 1) {
  const geometry = new BufferGeometry()
  const width = heightfield.length
  const maxX = width - 1
  const height = heightfield[0].length
  const maxY = height - 1
  const position = new Float32Array(width * height * 3)
  const normal = new Float32Array(width * height * 3)
  let idx = 0
  const right = new Vector3()
  const up = new Vector3()
  const ortho = new Vector3()
  const singleSpan = elementSize / normalExaggeration
  const doubleSpan = singleSpan * 2
  for (let xx = 0; xx < width; xx++) {
    for (let yy = 0; yy < height; yy++) {
      position[idx] = xx * elementSize
      position[idx + 1] = yy * elementSize
      position[idx + 2] = heightfield[xx][yy]

      if (xx === 0) {
        right.set(singleSpan, 0, heightfield[xx + 1][yy] - heightfield[xx][yy])
      } else if (xx === maxX) {
        right.set(singleSpan, 0, heightfield[xx][yy] - heightfield[xx - 1][yy])
      } else {
        right.set(doubleSpan, 0, heightfield[xx + 1][yy] - heightfield[xx - 1][yy])
      }

      if (yy === 0) {
        up.set(0, singleSpan, heightfield[xx][yy + 1] - heightfield[xx][yy])
      } else if (yy === maxY) {
        up.set(0, singleSpan, heightfield[xx][yy] - heightfield[xx][yy - 1])
      } else {
        up.set(0, doubleSpan, heightfield[xx][yy + 1] - heightfield[xx][yy - 1])
      }

      ortho.crossVectors(right, up).normalize()

      normal[idx++] = ortho.x
      normal[idx++] = ortho.y
      normal[idx++] = ortho.z
    }
  }
  geometry.addAttribute("position", new BufferAttribute(position, 3))
  geometry.addAttribute("normal", new BufferAttribute(normal, 3))
  const widthMinusOne = width - 1
  const heightMinusOne = height - 1
  const index = new Uint32Array(widthMinusOne * heightMinusOne * 2 * 3)
  idx = 0
  for (let xx = 0; xx < widthMinusOne; xx++) {
    for (let yy = 0; yy < heightMinusOne; yy++) {
      const base = xx * height + yy
      index[idx++] = base
      index[idx++] = base + height
      index[idx++] = base + 1

      index[idx++] = base + 1
      index[idx++] = base + height
      index[idx++] = base + height + 1
    }
  }
  geometry.setIndex(new BufferAttribute(index, 1))
  geometry.computeBoundingSphere()
  return geometry
}
