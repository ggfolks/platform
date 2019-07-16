import {
  RGBAFormat,
  BufferAttribute,
  BufferGeometry,
  CubeTexture,
  DataTexture,
  FloatType,
  Group,
  Mesh,
  ShaderMaterial,
  Sphere,
} from "three"

/** Depicts a planet using a set of heightfields. */
export class Planet {
  readonly group = new Group( )

  private _material = new ShaderMaterial()
  private _texture = new CubeTexture(createNoiseImages(6))
  private _mesh = new Mesh(getSphereGeometry(6), this._material)

  constructor () {
    this.group.add(this._mesh)
    this._material.vertexShader = SPHERE_VERTEX_SHADER
    this._material.fragmentShader = SPHERE_FRAGMENT_SHADER
    this._texture.format = RGBAFormat
    this._texture.type = FloatType
    this._texture.needsUpdate = true
    this._material.uniforms.height = {value: this._texture}
  }

  /** Releases the resources held by the planet. */
  dispose () {
    this._material.dispose()
    this._texture.dispose()
  }
}

/** Returns an array of (six) placeholder noise images. */
function createNoiseImages (divs :number) {
  const textures :DataTexture[] = []
  const dim = 2 ** divs
  for (let side = 0; side < 6; side++) {
    const data = new Float32Array(dim * dim * 4)
    for (let idx = 0; idx < data.length; ) {
      const value = Math.random() * 0.1 - 0.05
      data[idx++] = value
      data[idx++] = value
      data[idx++] = value
      data[idx++] = value
    }
    const texture = new DataTexture(data, dim, dim)
    texture.needsUpdate = true
    textures.push(texture)
  }
  return textures
}

const sphereGeometry :Map<number, BufferGeometry> = new Map()

/** Returns the geometry to use for a cube-tesselated sphere. */
function getSphereGeometry (divs :number) {
  let geometry = sphereGeometry.get(divs)
  if (!geometry) {
    sphereGeometry.set(divs, geometry = new BufferGeometry())
    const dim = 2 ** divs
    const max = dim - 1
    const position = new Float32Array(6 * dim * dim * 3)
    let idx = 0
    for (let side = 0; side < 6; side++) {
      const axis = side >> 1
      const sign = side & 1 ? 1 : -1
      const up = (axis + 1) % 3
      const right = (axis + 2) % 3
      for (let yy = 0; yy < dim; yy++) {
        for (let xx = 0; xx < dim; xx++) {
          position[idx + axis] = sign
          position[idx + up] = yy / max * 2 - 1
          position[idx + right] = (1 - xx / max * 2) * sign
          idx += 3
        }
      }
    }
    geometry.addAttribute("position", new BufferAttribute(position, 3))
    const index = new Uint32Array(6 * max * max * 2 * 3)
    idx = 0
    for (let side = 0; side < 6; side++) {
      for (let yy = 0; yy < max; yy++) {
        for (let xx = 0; xx < max; xx++) {
          const base = (side * dim + yy) * dim + xx

          index[idx++] = base
          index[idx++] = base + 1
          index[idx++] = base + dim + 1

          index[idx++] = base
          index[idx++] = base + dim + 1
          index[idx++] = base + dim
        }
      }
    }
    geometry.setIndex(new BufferAttribute(index, 1))
    geometry.boundingSphere = new Sphere()
    geometry.boundingSphere.radius = 1.5
  }
  return geometry
}

const SPHERE_VERTEX_SHADER = `
uniform samplerCube height;
varying vec3 v_Position;
void main() {
  v_Position = position;
  float heightValue = textureCube(height, position).a;
  vec3 direction = normalize(position) * (1.0 + heightValue);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(direction, 1.0);
}
`

const SPHERE_FRAGMENT_SHADER = `
uniform samplerCube height;
varying vec3 v_Position;
void main() {
  float value = 10.0 * (textureCube(height, v_Position).r + 0.05);
  gl_FragColor = vec4(value, value, value, 1.0);
}
`
