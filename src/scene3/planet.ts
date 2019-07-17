import {
  BackSide,
  BoxBufferGeometry,
  BufferAttribute,
  BufferGeometry,
  CubeCamera,
  FloatType,
  Group,
  Mesh,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Sphere,
  Texture,
  Vector4,
  WebGLRenderer,
} from "three"

/** Depicts a planet using a set of heightfields. */
export class Planet {
  readonly group = new Group( )

  private _material = new ShaderMaterial()
  private _texture :Texture
  private _mesh = new Mesh(getSphereGeometry(6), this._material)

  constructor (renderer :WebGLRenderer) {
    this.group.add(this._mesh)
    this._material.vertexShader = SPHERE_VERTEX_SHADER
    this._material.fragmentShader = SPHERE_FRAGMENT_SHADER
    this._texture = generateHeightTexture(renderer, 6)
    this._material.uniforms.height = {value: this._texture}
  }

  /** Releases the resources held by the planet. */
  dispose () {
    this._material.dispose()
    this._texture.dispose()
  }
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

const PLANES_PER_PASS = 256;

/** Generates a height texture using the method described at http://paulbourke.net/fractals/noise/
 * (Modeling fake planets). */
function generateHeightTexture (renderer :WebGLRenderer, divs :number) {
  const dim = 2 ** divs

  // create two cameras to ping-pong between
  const cameras :CubeCamera[] = []
  for (let ii = 0; ii < 2; ii++) {
    // @ts-ignore type definition lacks CubeCamera options
    cameras.push(new CubeCamera(0.1, 1.0, dim, {
      format: RGBAFormat,
      type: FloatType,
      depthBuffer: false,
      stencilBuffer: false,
    }))
  }

  // create scene with cube-textured box
  const scene = new Scene()
  const material = new ShaderMaterial()
  material.side = BackSide
  material.vertexShader = GENERATE_VERTEX_SHADER
  material.fragmentShader = GENERATE_FRAGMENT_SHADER
  const planes :Vector4[] = []
  material.uniforms.planes = {value: planes}
  for (let ii = 0; ii < PLANES_PER_PASS; ii++) {
    planes.push(new Vector4())
  }
  const box = new Mesh(new BoxBufferGeometry(), material)
  scene.add(box)

  // ping-pong over several iterations
  let camera = 0
  for (let ii = 0; ii < 8; ii++) {
    material.uniforms.height = {value: cameras[camera].renderTarget.texture}

    // fill up the uniforms
    for (let jj = 0; jj < PLANES_PER_PASS; jj++) {
      const plane = planes[jj]
      plane
        .set(Math.random()*2-1, Math.random()*2-1, Math.random()*2-1, 0.0)
        .normalize()
      plane.w = Math.random()*2-1
    }

    // switch to other camera
    camera = 1 - camera

    // render to the texture
    cameras[camera].update(renderer, scene)
  }

  // dispose of one target and return the texture from the other
  cameras[1 - camera].renderTarget.dispose()
  return cameras[camera].renderTarget.texture
}

const GENERATE_VERTEX_SHADER = `
varying vec3 v_Position;
void main() {
  v_Position = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const GENERATE_FRAGMENT_SHADER = `
uniform samplerCube height;
uniform vec4 planes[${PLANES_PER_PASS}];
varying vec3 v_Position;
void main() {
  float value = textureCube(height, v_Position).r;
  vec4 point = vec4(normalize(v_Position), 1.0);
  for (int ii = 0; ii < ${PLANES_PER_PASS}; ii++) {
    value += 0.001 * (step(0.0, dot(point, planes[ii])) * 2.0 - 1.0);
  }
  gl_FragColor = vec4(value, value, value, 1.0);
}
`

const SPHERE_VERTEX_SHADER = `
uniform samplerCube height;
varying vec3 v_Position;
void main() {
  v_Position = position;
  float heightValue = textureCube(height, position).r;
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
