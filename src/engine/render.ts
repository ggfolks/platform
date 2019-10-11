import {vec2, vec3} from "../core/math"
import {Color} from "../core/color"
import {Disposable} from "../core/util"
import {Component, Transform} from "./game"

/** Top-level interface to render engine. */
export interface RenderEngine extends Disposable {

  /** Creates a new material.
    * @return the newly created material instance. */
  createMaterial () :Material

  /** Casts a ray into the scene, finding all intersections.
    * @param origin the origin of the ray in world space.
    * @param direction the direction of the ray in world space.
    * @param [minDistance=0] the minimum intersection distance.
    * @param [maxDistance=Infinity] the maximum intersection distance.
    * @param [target] an array to populate; otherwise, a new one will be created.
    * @return the array of hit objects. */
  raycastAll (
    origin :vec3,
    direction :vec3,
    minDistance? :number,
    maxDistance? :number,
    target? :RaycastHit[],
  ) :RaycastHit[]

  /** Updates the render engine. Should be called once per frame. */
  update () :void
}

/** Describes a single raycast intersection. */
export interface RaycastHit {

  /** The distance to the intersection. */
  distance :number

  /** The world space intersection point. */
  point :vec3

  /** The transform of the object that we hit. */
  transform :Transform

  /** The texture coordinates of the intersection point. */
  textureCoord? :vec2

  /** The index of the intersected triangle. */
  triangleIndex? :number
}

/** Renders the mesh specified by the `meshFilter`. */
export interface MeshRenderer extends Component {

  /** The first material assigned to the renderer. */
  material :Material

  /** The array of materials assigned to the renderer. */
  materials :Material[]
}

/** The available material types. */
export type MaterialType = "basic" | "standard"

/** Represents a single material. */
export interface Material extends Disposable {

  /** The material type. */
  type :MaterialType

  /** The material color. */
  color :Color
}

/** Represents a camera attached to a game object. */
export interface Camera extends Component {

  /** The camera's aspect ratio (width over height). */
  aspect :number

  /** The camera's vertical field of view in degrees. */
  fieldOfView :number

  /** Converts a point in viewport coordinates (0,0 to 1,1) to a direction in world space for this
    * camera.
    * @param coords the coordinates to convert.
    * @param [target] an optional vector to hold the result.
    * @return the direction in world space. */
  viewportPointToDirection (coords :vec2, target? :vec3) :vec3
}

/** The available light types. */
export type LightType = "ambient" | "directional"

/** Represents a light attached to a game object. */
export interface Light extends Component {

  /** The light type. */
  lightType :LightType

  /** The light color. */
  color :Color
}
